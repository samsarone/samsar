import fs from 'node:fs';
import path from 'node:path';

import {
  resolveFreshManagedProviderMediaUrl,
  resolveReachableConfiguredProviderMediaUrl,
} from './ProviderMediaTunnel.js';
import { isDockerRuntime as isConfiguredDockerRuntime } from './DeploymentEnvironment.js';

const DEFAULT_RUNTIME_CONFIG_PATH = '/persistent/config/samsar.config.json';
const DOCKER_ASSETS_V2_PREFIX = 'assets_v2';
const DOCKER_MEDIA_KEY_PREFIX_PATTERN = /^(assets_v2|assets|generations|temp_images|temp_audio|temp_video|music|audio|avatar_voiceover|sound_effects|user_resources|video|ai_video)\//;
const LOCAL_MEDIA_HOSTS = new Set([
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'localhost',
  'media-gateway',
]);
const LOCAL_MEDIA_BASE_URL_ENV_KEYS = [
  'SAMSAR_PROVIDER_MEDIA_BASE_URL',
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
    defaultServiceName: 'samsar_assistant_query_processor_image',
  }),
  video: Object.freeze({
    expectedContentTypePrefix: 'video/',
    defaultServiceName: 'samsar_assistant_query_processor_video',
  }),
  audio: Object.freeze({
    expectedContentTypePrefix: 'audio/',
    defaultServiceName: 'samsar_assistant_query_processor_audio',
  }),
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function parseHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function isPublicHttpsUrl(value) {
  const parsed = typeof value === 'string' ? parseHttpUrl(value) : value;
  return Boolean(parsed && parsed.protocol === 'https:' && !isPrivateOrLocalHostname(parsed.hostname));
}

function isTunnelHostname(value) {
  const hostname = normalizeHostname(value);
  return hostname.endsWith('.trycloudflare.com') ||
    hostname.endsWith('.loca.lt') ||
    hostname.endsWith('.share.zrok.io');
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function isDockerRuntime() {
  return isConfiguredDockerRuntime();
}

function shouldUseDockerLocalMedia() {
  const mode = normalizeString(
    process.env.SAMSAR_MEDIA_DELIVERY_MODE || process.env.MEDIA_DELIVERY_MODE,
  ).toLowerCase();
  if (mode === 'docker-local' || mode === 'local-filesystem') return true;
  if (mode === 's3-cloudfront' || mode === 'external-s3') return false;
  return isDockerRuntime() && !isTruthyEnv(
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED ||
    process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED,
  );
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

function readRuntimeMediaConfig() {
  const managedTunnelUrls = [];
  const localDeliveryUrls = [];
  const configuredCdnUrls = [];
  const configuredBucketNames = [];

  for (const configPath of getRuntimeConfigPaths()) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const localTunnel = config?.localMediaTunnel || {};
      const legacyTunnel = config?.mediaTunnel || {};
      const localTunnelUrls = localTunnel.enabled === false
        ? []
        : [localTunnel.publicUrl, localTunnel.url];
      const legacyTunnelUrls = legacyTunnel.enabled === false
        ? []
        : [legacyTunnel.publicUrl, legacyTunnel.url];
      managedTunnelUrls.push(...localTunnelUrls, ...legacyTunnelUrls);
      localDeliveryUrls.push(
        ...localTunnelUrls,
        ...legacyTunnelUrls,
        config?.publicUrls?.media,
      );
      configuredCdnUrls.push(
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
      console.warn('[ProviderMediaUrl] Unable to read runtime media config', {
        configPath,
        error: error?.message || error,
      });
    }
  }

  return { managedTunnelUrls, localDeliveryUrls, configuredCdnUrls, configuredBucketNames };
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

function getManagedTunnelBaseUrlCandidates() {
  const runtime = readRuntimeMediaConfig();
  const stablePublicUrls = uniqueBaseUrls([
    process.env.SAMSAR_PROVIDER_MEDIA_BASE_URL,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
    ...runtime.localDeliveryUrls,
  ]).filter((value) => {
    const parsed = parseHttpUrl(value);
    return parsed && !isTunnelHostname(parsed.hostname);
  });
  const explicitManagedUrls = uniqueBaseUrls([
    ...runtime.managedTunnelUrls,
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
  ]);
  const tunnelShapedFallbacks = uniqueBaseUrls([
    ...runtime.localDeliveryUrls,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
  ]).filter((value) => {
    const parsed = parseHttpUrl(value);
    return parsed && isTunnelHostname(parsed.hostname);
  });

  return uniqueBaseUrls([...stablePublicUrls, ...explicitManagedUrls, ...tunnelShapedFallbacks])
    .filter(isPublicHttpsUrl);
}

function getConfiguredCdnBaseUrlCandidates() {
  const runtime = readRuntimeMediaConfig();
  return uniqueBaseUrls([
    ...runtime.configuredCdnUrls,
    process.env.PUBLIC_STATIC_CDN_URL,
    process.env.STATIC_CDN_URL,
    process.env.LEGACY_STATIC_CDN_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
  ])
    .filter(isPublicHttpsUrl)
    .filter((value) => {
      const parsed = parseHttpUrl(value);
      return parsed && !isTunnelHostname(parsed.hostname);
    });
}

function getConfiguredMediaBucketNames() {
  const runtime = readRuntimeMediaConfig();
  return [
    process.env.MEDIA_BUCKET_NAME,
    process.env.STATIC_CDN_BUCKET,
    ...runtime.configuredBucketNames,
  ]
    .map(normalizeString)
    .map((value) => value.toLowerCase())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function urlMatchesBaseUrl(url, baseUrl) {
  const parsedBase = parseHttpUrl(baseUrl);
  if (!parsedBase || parsedBase.origin !== url.origin) return false;
  const basePath = parsedBase.pathname.replace(/\/+$/, '');
  return !basePath || basePath === '/' ||
    url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
}

function isConfiguredOwnedMediaUrl(url) {
  const runtime = readRuntimeMediaConfig();
  const configuredBases = uniqueBaseUrls([
    ...LOCAL_MEDIA_BASE_URL_ENV_KEYS.map((key) => process.env[key]),
    ...runtime.localDeliveryUrls,
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    ...(!shouldUseDockerLocalMedia()
      ? [
        ...runtime.configuredCdnUrls,
        process.env.PUBLIC_STATIC_CDN_URL,
        process.env.STATIC_CDN_URL,
        process.env.LEGACY_STATIC_CDN_URL,
      ]
      : []),
  ]);
  return configuredBases.some((baseUrl) => urlMatchesBaseUrl(url, baseUrl));
}

function withoutQuery(value) {
  return typeof value === 'string' ? value.split('?')[0].split('#')[0] : value;
}

function buildInvalidReferenceError(value, reason, mediaKind) {
  const error = new Error(
    `Provider ${mediaKind} reference is not externally accessible: ${reason}.`,
  );
  error.name = 'SamsarProviderMediaReferenceError';
  error.code = 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID';
  error.retryable = false;
  error.reference = withoutQuery(normalizeString(value));
  error.mediaKind = mediaKind;
  return error;
}

function safelyDecodePath(value, originalReference, mediaKind) {
  let decoded = normalizeString(value);
  try {
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
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
  if (value.startsWith(`${DOCKER_ASSETS_V2_PREFIX}/`) || value.startsWith('assets/')) return value;
  return `${DOCKER_ASSETS_V2_PREFIX}/${value}`;
}

function isLogicalDockerAssetRoute(value) {
  const normalized = normalizeString(value).replace(/^\/+/, '');
  return normalized.startsWith(`${DOCKER_ASSETS_V2_PREFIX}/`) || normalized.startsWith('assets/');
}

function getMediaKeyFromPath(value, originalReference, mediaKind) {
  const segments = safelyDecodePath(value, originalReference, mediaKind);
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = segments.slice(index).join('/');
    if (DOCKER_MEDIA_KEY_PREFIX_PATTERN.test(candidate)) {
      return canonicalizeDockerMediaKey(candidate);
    }
  }
  return '';
}

function getMediaKeyFromFilesystemPath(value, originalReference, mediaKind) {
  const cleanPath = withoutQuery(value);
  const absoluteFilesystemReference = path.isAbsolute(cleanPath) && !isLogicalDockerAssetRoute(cleanPath);
  if (!absoluteFilesystemReference) {
    const directKey = getMediaKeyFromPath(cleanPath, originalReference, mediaKind);
    if (directKey) return directKey;
  }

  const absolutePath = path.resolve(cleanPath);
  const roots = [
    [path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2'), DOCKER_ASSETS_V2_PREFIX],
    [path.resolve(process.env.SAMSAR_ASSETS_ROOT || '/assets'), 'assets'],
  ];
  for (const [rootPath, prefix] of roots) {
    if (absolutePath === rootPath || !absolutePath.startsWith(`${rootPath}${path.sep}`)) continue;
    const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');
    if (relativePath) return `${prefix}/${relativePath}`;
  }
  return '';
}

function mediaKeyMapsToExistingMountedFile(mediaKey) {
  const normalizedKey = normalizeString(mediaKey).replace(/^\/+/, '');
  const candidates = [];
  if (normalizedKey.startsWith(`${DOCKER_ASSETS_V2_PREFIX}/`)) {
    candidates.push(path.join(
      process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2',
      normalizedKey.slice(`${DOCKER_ASSETS_V2_PREFIX}/`.length),
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
  if (/^https?:/i.test(value)) {
    const parsedUrl = parseHttpUrl(value);
    if (!parsedUrl) {
      throw buildInvalidReferenceError(value, 'the HTTP URL is malformed', mediaKind);
    }
    safelyDecodePath(parsedUrl.pathname, value, mediaKind);

    const mediaKey = getMediaKeyFromPath(parsedUrl.pathname, value, mediaKind);
    const configuredOwned = isConfiguredOwnedMediaUrl(parsedUrl);
    const recoverableStaleTunnel = !configuredOwned &&
      isTunnelHostname(parsedUrl.hostname) && Boolean(mediaKey) &&
      mediaKeyMapsToExistingMountedFile(mediaKey);
    const owned = isPrivateOrLocalHostname(parsedUrl.hostname) ||
      configuredOwned || recoverableStaleTunnel;
    if (owned) {
      if (!mediaKey) {
        throw buildInvalidReferenceError(
          value,
          'the owned URL does not contain a supported mounted-media key',
          mediaKind,
        );
      }
      return { type: 'owned', mediaKey };
    }

    if (!isPublicHttpsUrl(parsedUrl)) {
      throw buildInvalidReferenceError(value, 'the URL is not public HTTPS', mediaKind);
    }
    return { type: 'public', url: value };
  }

  if (value.includes('://') && !/^file:/i.test(value)) {
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
      if (fileUrl.protocol !== 'file:') throw new Error('Unsupported protocol');
      filesystemReference = fileUrl.pathname;
    } catch {
      throw buildInvalidReferenceError(value, 'the file URL is malformed', mediaKind);
    }
  }

  const mediaKey = getMediaKeyFromFilesystemPath(filesystemReference, value, mediaKind);
  if (!mediaKey) {
    throw buildInvalidReferenceError(
      value,
      'the local path cannot be mapped to /assets_v2 or /assets',
      mediaKind,
    );
  }
  return { type: 'owned', mediaKey };
}

function getMediaKindConfig(mediaKind = 'image') {
  const normalizedKind = normalizeString(mediaKind).toLowerCase() || 'image';
  const config = PROVIDER_MEDIA_KIND_CONFIG[normalizedKind];
  if (!config) throw new TypeError('mediaKind must be one of image, video, or audio.');
  return { mediaKind: normalizedKind, ...config };
}

function isValidMediaDataUrl(value, mediaKind) {
  const escapedKind = mediaKind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^data:${escapedKind}/[a-z0-9.+-]+(?:;[^,]*)?,.+$`, 'is').test(value);
}

function getMountedMediaPath(mediaKey) {
  const normalizedKey = normalizeString(mediaKey).replace(/^\/+/, '');
  if (normalizedKey.startsWith(`${DOCKER_ASSETS_V2_PREFIX}/`)) {
    return path.join(
      path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2'),
      normalizedKey.slice(`${DOCKER_ASSETS_V2_PREFIX}/`.length),
    );
  }
  if (normalizedKey.startsWith('assets/')) {
    return path.join(
      path.resolve(process.env.SAMSAR_ASSETS_ROOT || '/assets'),
      normalizedKey.slice('assets/'.length),
    );
  }
  return null;
}

/** Read owned mounted media for provider APIs that embed bytes inline. */
export async function readMountedProviderMediaBufferIfAvailable(value, options = {}) {
  const mediaConfig = getMediaKindConfig(options.mediaKind);
  const normalized = normalizeString(value);
  if (!normalized || /^data:/i.test(normalized)) return null;

  const reference = getDockerProviderMediaReference(normalized, mediaConfig.mediaKind);
  if (reference.type !== 'owned') return null;
  const filePath = getMountedMediaPath(reference.mediaKey);
  if (!filePath) return null;

  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) return null;
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Resolve a typed provider media reference immediately before dispatch.
 * Docker-owned assets use either the currently probed Compose tunnel or an
 * explicitly configured public HTTPS CDN. Arbitrary public HTTPS/data URLs
 * remain independent and unchanged; local, private, or malformed values fail.
 */
export async function getAccessibleProviderMediaUrl(value, options = {}) {
  const normalizedOptions = typeof options === 'string' ? { mediaKind: options } : (options || {});
  const mediaConfig = getMediaKindConfig(normalizedOptions.mediaKind);
  const serviceName = normalizeString(normalizedOptions.serviceName) || mediaConfig.defaultServiceName;
  const normalized = normalizeString(value);

  if (!isDockerRuntime()) return normalized;
  if (!normalized) {
    throw buildInvalidReferenceError(value, 'the reference is empty', mediaConfig.mediaKind);
  }
  if (/^data:/i.test(normalized)) {
    if (!isValidMediaDataUrl(normalized, mediaConfig.mediaKind)) {
      throw buildInvalidReferenceError(
        value,
        `the data URL is not a valid ${mediaConfig.mediaKind} payload`,
        mediaConfig.mediaKind,
      );
    }
    return normalized;
  }

  const reference = getDockerProviderMediaReference(normalized, mediaConfig.mediaKind);
  if (reference.type === 'public') return reference.url;

  if (shouldUseDockerLocalMedia()) {
    return resolveFreshManagedProviderMediaUrl({
      mediaPath: reference.mediaKey,
      getBaseUrlCandidates: getManagedTunnelBaseUrlCandidates,
      serviceName,
      expectedContentTypePrefix: mediaConfig.expectedContentTypePrefix,
      fetchImpl: normalizedOptions.fetchImpl,
    });
  }

  const configuredCdnUrls = getConfiguredCdnBaseUrlCandidates();
  if (!configuredCdnUrls.length || !getConfiguredMediaBucketNames().length) {
    throw buildInvalidReferenceError(
      value,
      'external S3 delivery is enabled without an explicitly configured bucket and public HTTPS CDN',
      mediaConfig.mediaKind,
    );
  }
  return resolveReachableConfiguredProviderMediaUrl({
    mediaPath: reference.mediaKey,
    baseUrls: configuredCdnUrls,
    expectedContentTypePrefix: mediaConfig.expectedContentTypePrefix,
    serviceName,
    fetchImpl: normalizedOptions.fetchImpl,
  });
}
