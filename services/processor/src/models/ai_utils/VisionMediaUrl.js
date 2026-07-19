import fs from 'fs';
import path from 'path';

import { buildSecureMediaDeliveryUrl, primeCDNCache } from '../AWS.js';
import { resolveFreshManagedProviderMediaUrl } from '../../utils/ProviderMediaTunnel.js';

const DEFAULT_RUNTIME_CONFIG_PATH = '/persistent/config/samsar.config.json';
const DOCKER_SECURE_ASSET_PREFIX = 'assets_v2';
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const SECURE_ASSET_PREFIX_PATTERN = SECURE_ASSET_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LEGACY_MEDIA_KEY_PREFIX_PATTERN = new RegExp(
  `^(${SECURE_ASSET_PREFIX_PATTERN}|assets|generations|temp_images|video|ai_video)/`,
);
const DOCKER_MEDIA_KEY_PREFIX_PATTERN = new RegExp(
  `^(${DOCKER_SECURE_ASSET_PREFIX}|assets|generations|temp_images|user_resources|video|ai_video)/`,
);
const LOCAL_MEDIA_HOSTS = new Set([
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'localhost',
  'media-gateway',
]);
const LOCAL_MEDIA_BASE_URL_ENV_KEYS = [
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'MEDIA_PUBLIC_URL',
  'SAMSAR_INTERNAL_MEDIA_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_LOCAL_MEDIA_BASE_URL',
  'SAMSAR_LOCAL_MEDIA_BASE_URL',
  'PUBLIC_API_BASE_URL',
  'PUBLIC_BASE_URL',
  'API_SERVER',
  'PROCESSOR_API',
  'PROCESSOR_URL',
];
const PROVIDER_MEDIA_KIND_CONFIG = Object.freeze({
  image: Object.freeze({
    expectedContentTypePrefix: 'image/',
    defaultServiceName: 'samsar_processor_vision',
  }),
  video: Object.freeze({
    expectedContentTypePrefix: 'video/',
    defaultServiceName: 'samsar_processor_video',
  }),
  audio: Object.freeze({
    expectedContentTypePrefix: 'audio/',
    defaultServiceName: 'samsar_processor_audio',
  }),
});

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isDataUrl(value) {
  return /^data:/i.test(value);
}

function isValidMediaDataUrl(value, mediaKind) {
  const escapedMediaKind = mediaKind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^data:${escapedMediaKind}/[a-z0-9.+-]+(?:;[^,]*)?,.+$`,
    'is',
  ).test(value);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function withoutQuery(value) {
  return typeof value === 'string' ? value.split('?')[0].split('#')[0] : value;
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function isDockerRuntime() {
  return normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
}

function shouldUseDockerLocalMedia() {
  const configuredMode = normalizeString(
    process.env.SAMSAR_MEDIA_DELIVERY_MODE || process.env.MEDIA_DELIVERY_MODE,
  ).toLowerCase();
  if (configuredMode === 'docker-local' || configuredMode === 'local-filesystem') {
    return true;
  }
  if (configuredMode === 's3-cloudfront' || configuredMode === 'external-s3') {
    return false;
  }
  return isDockerRuntime() && !isTruthyEnv(
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED || process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED,
  );
}

function getProviderMediaKindConfig(mediaKind = 'image') {
  const normalizedMediaKind = normalizeString(mediaKind).toLowerCase() || 'image';
  const config = PROVIDER_MEDIA_KIND_CONFIG[normalizedMediaKind];
  if (!config) {
    throw new TypeError('mediaKind must be one of image, video, or audio.');
  }
  return { mediaKind: normalizedMediaKind, ...config };
}

function buildInvalidReferenceError(value, reason, mediaKind = 'image') {
  const isVisionImage = mediaKind === 'image';
  const error = new Error(
    `${isVisionImage ? 'Vision image' : `Provider ${mediaKind}`} reference is not provider-accessible: ${reason}.`,
  );
  error.name = isVisionImage
    ? 'SamsarVisionMediaReferenceError'
    : 'SamsarProviderMediaReferenceError';
  error.code = isVisionImage
    ? 'SAMSAR_VISION_MEDIA_REFERENCE_INVALID'
    : 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID';
  error.retryable = false;
  error.reference = withoutQuery(normalizeString(value));
  error.mediaKind = mediaKind;
  return error;
}

function assertConfiguredDockerExternalMediaDelivery(value, mediaKind) {
  const bucket = normalizeString(
    process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET,
  );
  const cdnBase = normalizeString(process.env.STATIC_CDN_URL);
  const parsedCdnBase = parseHttpUrl(cdnBase);
  if (
    !bucket ||
    !parsedCdnBase ||
    parsedCdnBase.protocol !== 'https:' ||
    isPrivateOrLocalHostname(parsedCdnBase.hostname)
  ) {
    throw buildInvalidReferenceError(
      value,
      'external S3 delivery is enabled without an explicitly configured bucket and public HTTPS STATIC_CDN_URL',
      mediaKind,
    );
  }
}

function parseHttpUrl(value) {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }
    return parsedUrl;
  } catch {
    return null;
  }
}

function normalizeHostname(value) {
  return normalizeString(value).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isPrivateOrLocalHostname(value) {
  const hostname = normalizeHostname(value);
  return LOCAL_MEDIA_HOSTS.has(hostname) ||
    hostname.endsWith('.local') ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname);
}

function isProbablyPublicHttpUrl(value) {
  const parsedUrl = typeof value === 'string' ? parseHttpUrl(value) : value;
  return Boolean(parsedUrl && !isPrivateOrLocalHostname(parsedUrl.hostname));
}

function isTunnelHostname(value) {
  const hostname = normalizeHostname(value);
  return hostname.endsWith('.trycloudflare.com') ||
    hostname.endsWith('.loca.lt') ||
    hostname.endsWith('.share.zrok.io');
}

function normalizeBaseUrl(value) {
  return normalizeString(value).replace(/\/+$/, '');
}

function uniqueBaseUrls(values = []) {
  return values
    .map(normalizeBaseUrl)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function getRuntimeConfigPaths() {
  return [
    process.env.SAMSAR_RUNTIME_CONFIG_FILE,
    process.env.SAMSAR_CONFIG_FILE,
    DEFAULT_RUNTIME_CONFIG_PATH,
  ]
    .map(normalizeString)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function readRuntimeMediaConfigUrls() {
  const managedTunnelUrls = [];
  const localDeliveryUrls = [];
  const configuredCloudUrls = [];
  const configuredBucketNames = [];

  for (const configPath of getRuntimeConfigPaths()) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const localTunnel = config?.localMediaTunnel || {};
      const legacyTunnel = config?.mediaTunnel || {};
      const enabledLocalTunnelUrls = localTunnel.enabled === false
        ? []
        : [localTunnel.publicUrl, localTunnel.url];
      const enabledLegacyTunnelUrls = legacyTunnel.enabled === false
        ? []
        : [legacyTunnel.publicUrl, legacyTunnel.url];
      managedTunnelUrls.push(...enabledLocalTunnelUrls, ...enabledLegacyTunnelUrls);
      localDeliveryUrls.push(
        ...enabledLocalTunnelUrls,
        ...enabledLegacyTunnelUrls,
        config?.publicUrls?.media,
      );
      configuredCloudUrls.push(
        config?.storage?.staticCdnUrl,
        config?.storage?.publicMediaBaseUrl,
        config?.storage?.externalMediaPublicBaseUrl,
      );
      configuredBucketNames.push(
        config?.storage?.mediaBucketName,
        config?.storage?.bucketName,
        config?.storage?.staticCdnBucket,
      );
    } catch (error) {
      console.warn('[VisionMediaUrl] Unable to read runtime media config', {
        configPath,
        error: error?.message || error,
      });
    }
  }

  return {
    managedTunnelUrls: uniqueBaseUrls(managedTunnelUrls),
    localDeliveryUrls: uniqueBaseUrls(localDeliveryUrls),
    configuredCloudUrls: uniqueBaseUrls(configuredCloudUrls),
    configuredBucketNames: configuredBucketNames.map(normalizeString).filter(Boolean),
  };
}

function getManagedTunnelBaseUrlCandidates() {
  const runtimeUrls = readRuntimeMediaConfigUrls();
  const explicitlyManaged = uniqueBaseUrls([
    ...runtimeUrls.managedTunnelUrls,
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
  ]);
  const tunnelShapedFallbacks = uniqueBaseUrls([
    ...runtimeUrls.localDeliveryUrls,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
  ]).filter((value) => {
    const parsedUrl = parseHttpUrl(value);
    return parsedUrl && isTunnelHostname(parsedUrl.hostname);
  });

  return uniqueBaseUrls([...explicitlyManaged, ...tunnelShapedFallbacks])
    .filter((value) => {
      const parsedUrl = parseHttpUrl(value);
      return parsedUrl?.protocol === 'https:' && isProbablyPublicHttpUrl(parsedUrl);
    });
}

function urlMatchesBaseUrl(url, baseUrl) {
  const parsedBase = parseHttpUrl(baseUrl);
  if (!parsedBase || parsedBase.origin !== url.origin) {
    return false;
  }
  const basePath = parsedBase.pathname.replace(/\/+$/, '');
  return !basePath || basePath === '/' || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
}

function isConfiguredLocalDeliveryUrl(url) {
  const runtimeUrls = readRuntimeMediaConfigUrls();
  const configuredBases = uniqueBaseUrls([
    ...LOCAL_MEDIA_BASE_URL_ENV_KEYS.map((key) => process.env[key]),
    ...runtimeUrls.localDeliveryUrls,
  ]);
  return configuredBases.some((baseUrl) => urlMatchesBaseUrl(url, baseUrl));
}

function isManagedTunnelUrl(url) {
  return getManagedTunnelBaseUrlCandidates().some((baseUrl) => urlMatchesBaseUrl(url, baseUrl));
}

function isKnownCloudMediaUrl(url) {
  const runtimeUrls = readRuntimeMediaConfigUrls();
  const configuredStaticBases = uniqueBaseUrls([
    ...runtimeUrls.configuredCloudUrls,
    process.env.STATIC_CDN_URL,
    process.env.PUBLIC_STATIC_CDN_URL,
    process.env.LEGACY_STATIC_CDN_URL,
  ]);
  if (configuredStaticBases.some((baseUrl) => urlMatchesBaseUrl(url, baseUrl))) {
    return true;
  }

  const mediaBucketNames = [
    process.env.MEDIA_BUCKET_NAME,
    process.env.STATIC_CDN_BUCKET,
    ...runtimeUrls.configuredBucketNames,
  ]
    .map(normalizeString)
    .map((value) => value.toLowerCase())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  if (!mediaBucketNames.length) return false;
  const hostname = normalizeHostname(url.hostname);
  let objectPath = '';
  try {
    objectPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return false;
  }
  return mediaBucketNames.some((mediaBucketName) =>
    hostname === `${mediaBucketName}.s3.amazonaws.com` ||
    hostname.startsWith(`${mediaBucketName}.s3.`) ||
    ((hostname === 's3.amazonaws.com' || hostname.startsWith('s3.')) &&
      objectPath.startsWith(`${mediaBucketName}/`)));
}

function safelyDecodePath(value, originalReference, mediaKind = 'image') {
  let decoded = normalizeString(value);
  try {
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    }
  } catch {
    throw buildInvalidReferenceError(originalReference, 'the path has invalid encoding', mediaKind);
  }

  if (decoded.includes('\\') || decoded.includes('\0')) {
    throw buildInvalidReferenceError(originalReference, 'the path contains unsafe characters', mediaKind);
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw buildInvalidReferenceError(originalReference, 'the path contains traversal segments', mediaKind);
  }
  return segments;
}

function canonicalizeDockerMediaKey(value) {
  if (value.startsWith(`${DOCKER_SECURE_ASSET_PREFIX}/`) || value.startsWith('assets/')) {
    return value;
  }
  return `${DOCKER_SECURE_ASSET_PREFIX}/${value}`;
}

function isLogicalDockerAssetRoute(value) {
  const normalized = normalizeString(value).replace(/^\/+/, '');
  return normalized.startsWith(`${DOCKER_SECURE_ASSET_PREFIX}/`)
    || normalized.startsWith('assets/');
}

function getMediaKeyFromPath(value, originalReference, options = {}) {
  const segments = safelyDecodePath(value, originalReference, options.mediaKind);
  const prefixPattern = options.canonicalizeDocker === true
    ? DOCKER_MEDIA_KEY_PREFIX_PATTERN
    : LEGACY_MEDIA_KEY_PREFIX_PATTERN;
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = segments.slice(index).join('/');
    if (prefixPattern.test(candidate)) {
      return options.canonicalizeDocker === true
        ? canonicalizeDockerMediaKey(candidate)
        : candidate;
    }
  }
  return '';
}

function getMediaKeyFromFilesystemPath(value, originalReference, mediaKind = 'image') {
  const cleanPath = withoutQuery(value);
  const absoluteFilesystemReference = path.isAbsolute(cleanPath)
    && !isLogicalDockerAssetRoute(cleanPath);
  if (!absoluteFilesystemReference) {
    const directKey = getMediaKeyFromPath(cleanPath, originalReference, {
      canonicalizeDocker: true,
      mediaKind,
    });
    if (directKey) {
      return directKey;
    }
  }

  const absolutePath = path.resolve(cleanPath);
  const roots = [
    [path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2'), DOCKER_SECURE_ASSET_PREFIX],
    [path.resolve(process.env.SAMSAR_ASSETS_ROOT || '/assets'), 'assets'],
  ];
  for (const [rootPath, prefix] of roots) {
    if (absolutePath === rootPath || !absolutePath.startsWith(`${rootPath}${path.sep}`)) {
      continue;
    }
    const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');
    if (relativePath) {
      return `${prefix}/${relativePath}`;
    }
  }
  return '';
}

function dockerMediaKeyMapsToExistingFile(mediaKey) {
  const normalizedKey = normalizeString(mediaKey).replace(/^\/+/, '');
  const candidates = [];
  if (normalizedKey.startsWith(`${DOCKER_SECURE_ASSET_PREFIX}/`)) {
    candidates.push(path.join(
      process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2',
      normalizedKey.slice(`${DOCKER_SECURE_ASSET_PREFIX}/`.length),
    ));
  } else if (normalizedKey.startsWith('assets/')) {
    candidates.push(path.join(
      process.env.SAMSAR_ASSETS_ROOT || '/assets',
      normalizedKey.slice('assets/'.length),
    ));
  }
  return candidates.some((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function getDockerProviderMediaReference(value, mediaKind) {
  if (isHttpUrl(value)) {
    const parsedUrl = parseHttpUrl(value);
    if (!parsedUrl) {
      throw buildInvalidReferenceError(value, 'the HTTP URL is malformed', mediaKind);
    }
    safelyDecodePath(parsedUrl.pathname, value, mediaKind);

    const isLocalReference = isPrivateOrLocalHostname(parsedUrl.hostname);
    const isManagedReference = isManagedTunnelUrl(parsedUrl);
    const isConfiguredLocalReference = isConfiguredLocalDeliveryUrl(parsedUrl);
    const isCloudReference = isKnownCloudMediaUrl(parsedUrl);
    const mediaKey = getMediaKeyFromPath(parsedUrl.pathname, value, {
      canonicalizeDocker: true,
      mediaKind,
    });
    const isRecoverableStaleTunnelReference = !isManagedReference &&
      isTunnelHostname(parsedUrl.hostname) &&
      Boolean(mediaKey) &&
      dockerMediaKeyMapsToExistingFile(mediaKey);

    if (
      isLocalReference ||
      isManagedReference ||
      isConfiguredLocalReference ||
      isRecoverableStaleTunnelReference ||
      (!shouldUseDockerLocalMedia() && isCloudReference)
    ) {
      if (!mediaKey) {
        throw buildInvalidReferenceError(
          value,
          'the owned URL does not contain a supported media asset key',
          mediaKind,
        );
      }
      return { type: 'owned', mediaKey };
    }

    if (!isProbablyPublicHttpUrl(parsedUrl)) {
      throw buildInvalidReferenceError(value, 'the URL is not publicly reachable', mediaKind);
    }
    return { type: 'public', url: value };
  }

  if (/^https?:/i.test(value) || value.includes('://')) {
    throw buildInvalidReferenceError(
      value,
      'the URL is malformed or uses an unsupported protocol',
      mediaKind,
    );
  }

  let filesystemReference = value;
  if (/^file:/i.test(value)) {
    try {
      const fileUrl = new URL(value);
      if (fileUrl.protocol !== 'file:') {
        throw new Error('Unsupported file protocol');
      }
      filesystemReference = fileUrl.pathname;
    } catch {
      throw buildInvalidReferenceError(value, 'the file URL is malformed', mediaKind);
    }
  }

  const mediaKey = getMediaKeyFromFilesystemPath(filesystemReference, value, mediaKind);
  if (!mediaKey) {
    throw buildInvalidReferenceError(
      value,
      'the local path cannot be mapped to a mounted media asset',
      mediaKind,
    );
  }
  return { type: 'owned', mediaKey };
}

async function getDockerAccessibleProviderMediaUrl(value, {
  mediaKind,
  expectedContentTypePrefix,
  serviceName,
}) {
  const reference = getDockerProviderMediaReference(value, mediaKind);
  if (reference.type === 'public') {
    return reference.url;
  }

  if (shouldUseDockerLocalMedia()) {
    return resolveFreshManagedProviderMediaUrl({
      mediaPath: reference.mediaKey,
      getBaseUrlCandidates: getManagedTunnelBaseUrlCandidates,
      serviceName,
      expectedContentTypePrefix,
    });
  }

  assertConfiguredDockerExternalMediaDelivery(value, mediaKind);
  const signedUrl = buildSecureMediaDeliveryUrl(reference.mediaKey);
  if (!signedUrl || !isHttpUrl(signedUrl)) {
    throw buildInvalidReferenceError(
      value,
      'the media asset could not be mapped to configured S3/CloudFront delivery',
      mediaKind,
    );
  }
  await primeCDNCache(signedUrl, { requireSuccess: true });
  return signedUrl;
}

function shouldAttemptMediaSigning(value) {
  return isHttpUrl(value) || LEGACY_MEDIA_KEY_PREFIX_PATTERN.test(value.replace(/^\/+/, ''));
}

function getLegacyMediaKeyReference(value, mediaKind) {
  if (!isHttpUrl(value)) {
    return value;
  }
  const parsedUrl = parseHttpUrl(value);
  if (!parsedUrl) {
    return value;
  }
  try {
    const pathname = safelyDecodePath(parsedUrl.pathname, value, mediaKind).join('/');
    return LEGACY_MEDIA_KEY_PREFIX_PATTERN.test(pathname) ? pathname : value;
  } catch {
    return value;
  }
}

async function getLegacyAccessibleProviderMediaUrl(value, mediaKind) {
  if (isHttpUrl(value)) {
    const parsedUrl = parseHttpUrl(value);
    const isOwnedDeliveryUrl = parsedUrl && (
      isKnownCloudMediaUrl(parsedUrl) || isConfiguredLocalDeliveryUrl(parsedUrl)
    );
    if (!isOwnedDeliveryUrl) {
      return value;
    }
  }
  if (!shouldAttemptMediaSigning(value)) {
    return value;
  }

  const signedUrl = buildSecureMediaDeliveryUrl(getLegacyMediaKeyReference(value, mediaKind));
  if (!signedUrl) {
    return value;
  }

  try {
    await primeCDNCache(signedUrl, { requireSuccess: true });
  } catch (error) {
    if (isHttpUrl(value)) {
      console.error('[VisionMediaUrl] Falling back to original media URL after CDN prime failure', {
        url: withoutQuery(value),
        signedUrl: withoutQuery(signedUrl),
        error: error?.message || error,
      });
      return value;
    }
    throw error;
  }
  return signedUrl;
}

/**
 * Resolve a provider-facing media URL at the outbound request boundary.
 * Docker-owned media is mapped through a freshly probed managed tunnel (or
 * configured external S3/CloudFront delivery); arbitrary local references are
 * never forwarded to the provider.
 */
export async function getAccessibleProviderMediaUrl(value, options = {}) {
  const normalizedOptions = typeof options === 'string'
    ? { mediaKind: options }
    : (options || {});
  const mediaConfig = getProviderMediaKindConfig(normalizedOptions.mediaKind);
  const serviceName = normalizeString(normalizedOptions.serviceName)
    || mediaConfig.defaultServiceName;
  const normalized = normalizeString(value);
  if (!normalized) {
    if (isDockerRuntime()) {
      throw buildInvalidReferenceError(value, 'the reference is empty', mediaConfig.mediaKind);
    }
    return normalized;
  }
  if (isDataUrl(normalized)) {
    if (isDockerRuntime() && !isValidMediaDataUrl(normalized, mediaConfig.mediaKind)) {
      throw buildInvalidReferenceError(
        value,
        `the data URL is not a valid ${mediaConfig.mediaKind} payload`,
        mediaConfig.mediaKind,
      );
    }
    return normalized;
  }

  return isDockerRuntime()
    ? getDockerAccessibleProviderMediaUrl(normalized, {
      ...mediaConfig,
      serviceName,
    })
    : getLegacyAccessibleProviderMediaUrl(normalized, mediaConfig.mediaKind);
}

export async function getAccessibleVisionImageUrl(value) {
  return getAccessibleProviderMediaUrl(value, {
    mediaKind: 'image',
    serviceName: 'samsar_processor_vision',
  });
}
