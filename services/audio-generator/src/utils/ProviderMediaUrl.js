import fs from 'fs';
import path from 'path';

import { buildSecureMediaDeliveryUrl, primeCDNCache } from '../AWS.js';
import { resolveFreshManagedProviderMediaUrl } from './ProviderMediaTunnel.js';

const DEFAULT_RUNTIME_CONFIG_PATH = '/persistent/config/samsar.config.json';
const MEDIA_PREFIXES = new Set([
  'assets_v2', 'assets', 'generations', 'temp_images', 'user_resources', 'video', 'ai_video',
]);
const LOCAL_HOSTS = new Set([
  '0.0.0.0', '127.0.0.1', '::1', 'host.docker.internal', 'localhost', 'media-gateway',
]);
const MEDIA_KIND_CONFIG = Object.freeze({
  image: Object.freeze({ expectedContentTypePrefix: 'image/' }),
  video: Object.freeze({ expectedContentTypePrefix: 'video/' }),
  audio: Object.freeze({ expectedContentTypePrefix: 'audio/' }),
});
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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function isDockerRuntime() {
  return normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
}

function shouldUseLocalDockerMedia() {
  const mode = normalizeString(
    process.env.SAMSAR_MEDIA_DELIVERY_MODE || process.env.MEDIA_DELIVERY_MODE,
  ).toLowerCase();
  if (mode === 'docker-local' || mode === 'local-filesystem') return true;
  if (mode === 's3-cloudfront' || mode === 'external-s3') return false;
  return isDockerRuntime() && !isTruthy(
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED ||
    process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED,
  );
}

function normalizeMediaKind(value) {
  const mediaKind = normalizeString(value).toLowerCase() || 'image';
  if (!MEDIA_KIND_CONFIG[mediaKind]) {
    throw new TypeError('mediaKind must be one of image, video, or audio.');
  }
  return mediaKind;
}

function buildInvalidReferenceError(value, reason, mediaKind) {
  const error = new Error(
    `Provider ${mediaKind} reference is not provider-accessible: ${reason}.`,
  );
  error.name = 'SamsarProviderMediaReferenceError';
  error.code = 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID';
  error.retryable = false;
  error.reference = normalizeString(value).split('?')[0].split('#')[0];
  error.mediaKind = mediaKind;
  return error;
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeHostname(value) {
  return normalizeString(value).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isPrivateOrLocalHostname(value) {
  const hostname = normalizeHostname(value);
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.local') ||
    /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || /^169\.254\./.test(hostname) ||
    /^f[cd][0-9a-f]{2}:/i.test(hostname) || /^fe[89ab][0-9a-f]:/i.test(hostname);
}

function isPublicHttpUrl(value) {
  const parsed = typeof value === 'string' ? parseHttpUrl(value) : value;
  return Boolean(parsed && !isPrivateOrLocalHostname(parsed.hostname));
}

function isTunnelHostname(value) {
  const hostname = normalizeHostname(value);
  return hostname.endsWith('.trycloudflare.com') || hostname.endsWith('.loca.lt') ||
    hostname.endsWith('.share.zrok.io');
}

function normalizeBaseUrl(value) {
  return normalizeString(value).replace(/\/+$/, '');
}

function uniqueBaseUrls(values) {
  return values.map(normalizeBaseUrl).filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function readRuntimeMediaConfig() {
  const managed = [];
  const local = [];
  const cloud = [];
  const buckets = [];
  const paths = uniqueBaseUrls([
    process.env.SAMSAR_RUNTIME_CONFIG_FILE,
    process.env.SAMSAR_CONFIG_FILE,
    DEFAULT_RUNTIME_CONFIG_PATH,
  ]);
  for (const configPath of paths) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const localTunnel = config?.localMediaTunnel || {};
      const legacyTunnel = config?.mediaTunnel || {};
      const localTunnelUrls = localTunnel.enabled === false ? [] : [localTunnel.publicUrl, localTunnel.url];
      const legacyTunnelUrls = legacyTunnel.enabled === false ? [] : [legacyTunnel.publicUrl, legacyTunnel.url];
      managed.push(...localTunnelUrls, ...legacyTunnelUrls);
      local.push(
        ...localTunnelUrls,
        ...legacyTunnelUrls,
        config?.publicUrls?.media,
      );
      cloud.push(
        config?.storage?.staticCdnUrl,
        config?.storage?.publicMediaBaseUrl,
        config?.storage?.externalMediaPublicBaseUrl,
      );
      buckets.push(config?.storage?.mediaBucketName);
    } catch (error) {
      console.warn('[ProviderMediaUrl] Unable to read runtime media config', {
        configPath,
        error: error?.message || error,
      });
    }
  }
  return {
    managed: uniqueBaseUrls(managed),
    local: uniqueBaseUrls(local),
    cloud: uniqueBaseUrls(cloud),
    buckets: buckets.map(normalizeString).filter(Boolean),
  };
}

function getManagedTunnelBaseUrlCandidates() {
  const runtime = readRuntimeMediaConfig();
  const explicitlyManaged = uniqueBaseUrls([
    ...runtime.managed,
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
  ]);
  const tunnelShapedFallbacks = uniqueBaseUrls([
    ...runtime.local,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
  ]).filter((value) => {
    const parsed = parseHttpUrl(value);
    return parsed && isTunnelHostname(parsed.hostname);
  });
  return uniqueBaseUrls([...explicitlyManaged, ...tunnelShapedFallbacks]).filter((value) => {
    const url = parseHttpUrl(value);
    return url?.protocol === 'https:' && isPublicHttpUrl(url);
  });
}

function urlMatchesBase(url, baseValue) {
  const base = parseHttpUrl(baseValue);
  if (!base || base.origin !== url.origin) return false;
  const basePath = base.pathname.replace(/\/+$/, '');
  return !basePath || basePath === '/' || url.pathname === basePath ||
    url.pathname.startsWith(`${basePath}/`);
}

function isConfiguredLocalUrl(url) {
  const runtime = readRuntimeMediaConfig();
  const bases = uniqueBaseUrls([
    ...runtime.local,
    ...LOCAL_MEDIA_BASE_URL_ENV_KEYS.map((key) => process.env[key]),
  ]);
  return bases.some((base) => urlMatchesBase(url, base));
}

function isManagedTunnelUrl(url) {
  return getManagedTunnelBaseUrlCandidates().some((base) => urlMatchesBase(url, base));
}

function getConfiguredCloudBaseUrlCandidates() {
  const runtime = readRuntimeMediaConfig();
  return uniqueBaseUrls([
    ...runtime.cloud,
    process.env.STATIC_CDN_URL,
    process.env.PUBLIC_STATIC_CDN_URL,
    process.env.LEGACY_STATIC_CDN_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
  ]).filter((base) => {
    const parsed = parseHttpUrl(base);
    return parsed?.protocol === 'https:' && isPublicHttpUrl(parsed) && !isTunnelHostname(parsed.hostname);
  });
}

function getConfiguredMediaBucketNames() {
  const runtime = readRuntimeMediaConfig();
  return [
    process.env.MEDIA_BUCKET_NAME,
    process.env.STATIC_CDN_BUCKET,
    ...runtime.buckets,
  ].map(normalizeString).map((value) => value.toLowerCase()).filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function isKnownCloudMediaUrl(url) {
  const bases = getConfiguredCloudBaseUrlCandidates();
  if (bases.some((base) => urlMatchesBase(url, base))) return true;
  let objectPath = '';
  try {
    objectPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return false;
  }
  const hostname = normalizeHostname(url.hostname);
  return getConfiguredMediaBucketNames().some((bucket) =>
    hostname === `${bucket}.s3.amazonaws.com` || hostname.startsWith(`${bucket}.s3.`) ||
    ((hostname === 's3.amazonaws.com' || hostname.startsWith('s3.')) &&
      objectPath.startsWith(`${bucket}/`)));
}

function decodeSafeSegments(value, original, mediaKind) {
  let decoded = normalizeString(value);
  try {
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    throw buildInvalidReferenceError(original, 'the path has invalid encoding', mediaKind);
  }
  if (decoded.includes('\\') || decoded.includes('\0')) {
    throw buildInvalidReferenceError(original, 'the path contains unsafe characters', mediaKind);
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw buildInvalidReferenceError(original, 'the path contains traversal segments', mediaKind);
  }
  return segments;
}

function canonicalizeMediaKey(segments, original, mediaKind) {
  for (let index = 0; index < segments.length; index += 1) {
    const prefix = segments[index];
    if (!MEDIA_PREFIXES.has(prefix)) continue;
    const candidate = segments.slice(index).join('/');
    return prefix === 'assets_v2' || prefix === 'assets'
      ? candidate
      : `assets_v2/${candidate}`;
  }
  return '';
}

function getMediaKeyFromPath(value, original, mediaKind) {
  return canonicalizeMediaKey(decodeSafeSegments(value, original, mediaKind), original, mediaKind);
}

function getMediaKeyFromFilesystemPath(value, original, mediaKind) {
  const clean = value.split('?')[0].split('#')[0];
  const logical = clean.replace(/^\/+/, '');
  if (MEDIA_PREFIXES.has(logical.split('/')[0])) {
    return getMediaKeyFromPath(logical, original, mediaKind);
  }
  const absolute = path.resolve(clean);
  const roots = [
    [path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2'), 'assets_v2'],
    [path.resolve(process.env.SAMSAR_ASSETS_ROOT || '/assets'), 'assets'],
  ];
  for (const [root, prefix] of roots) {
    if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) continue;
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (relative) return `${prefix}/${relative}`;
  }
  return '';
}

function mediaKeyMapsToExistingMountedFile(mediaKey) {
  const normalizedKey = normalizeString(mediaKey).replace(/^\/+/, '');
  const candidates = [];
  if (normalizedKey.startsWith('assets_v2/')) {
    candidates.push(path.join(
      process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2',
      normalizedKey.slice('assets_v2/'.length),
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

function classifyReference(value, mediaKind) {
  const parsed = parseHttpUrl(value);
  if (parsed) {
    decodeSafeSegments(parsed.pathname, value, mediaKind);
    const managedTunnel = isManagedTunnelUrl(parsed);
    const mediaKey = getMediaKeyFromPath(parsed.pathname, value, mediaKind);
    const recoverableStaleTunnel = !managedTunnel && isTunnelHostname(parsed.hostname) &&
      Boolean(mediaKey) && mediaKeyMapsToExistingMountedFile(mediaKey);
    const ownedLocal = isPrivateOrLocalHostname(parsed.hostname) ||
      managedTunnel || isConfiguredLocalUrl(parsed) || recoverableStaleTunnel;
    const ownedCloud = !shouldUseLocalDockerMedia() && isKnownCloudMediaUrl(parsed);
    if (ownedLocal || ownedCloud) {
      if (!mediaKey) {
        throw buildInvalidReferenceError(
          value, 'the owned URL does not contain a supported media asset key', mediaKind,
        );
      }
      return { type: 'owned', mediaKey };
    }
    if (!isPublicHttpUrl(parsed)) {
      throw buildInvalidReferenceError(value, 'the URL is not publicly reachable', mediaKind);
    }
    return { type: 'public', url: value };
  }
  if (/^https?:/i.test(value) || value.includes('://') && !/^file:/i.test(value)) {
    throw buildInvalidReferenceError(value, 'the URL is malformed or uses an unsupported protocol', mediaKind);
  }

  let filesystemReference = value;
  if (/^file:/i.test(value)) {
    try {
      const fileUrl = new URL(value);
      if (fileUrl.protocol !== 'file:') throw new Error('unsupported protocol');
      filesystemReference = fileUrl.pathname;
    } catch {
      throw buildInvalidReferenceError(value, 'the file URL is malformed', mediaKind);
    }
  }
  const mediaKey = getMediaKeyFromFilesystemPath(filesystemReference, value, mediaKind);
  if (!mediaKey) {
    throw buildInvalidReferenceError(
      value, 'the local path cannot be mapped to a mounted media asset', mediaKind,
    );
  }
  return { type: 'owned', mediaKey };
}

function validateProviderUrl(value, mediaKind, reason) {
  const parsed = parseHttpUrl(value);
  if (!parsed || parsed.protocol !== 'https:' || isPrivateOrLocalHostname(parsed.hostname)) {
    throw buildInvalidReferenceError(value, reason, mediaKind);
  }
  return value;
}

function getMountedMediaPath(mediaKey) {
  const normalizedKey = normalizeString(mediaKey).replace(/^\/+/, '');
  if (normalizedKey.startsWith('assets_v2/')) {
    return path.join(
      path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2'),
      normalizedKey.slice('assets_v2/'.length),
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
  const mediaKind = normalizeMediaKind(options.mediaKind);
  const normalized = normalizeString(value);
  if (!normalized || /^data:/i.test(normalized)) return null;

  const reference = classifyReference(normalized, mediaKind);
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
 * Resolve a media reference at the final outbound provider boundary. Local
 * Docker assets always use a freshly exact-probed managed URL; external-S3
 * mode only permits a public HTTPS CDN/S3 delivery URL.
 */
export async function getAccessibleProviderMediaUrl(value, options = {}) {
  const normalizedOptions = typeof options === 'string' ? { mediaKind: options } : options || {};
  const mediaKind = normalizeMediaKind(normalizedOptions.mediaKind);
  const normalized = normalizeString(value);
  if (!normalized) {
    throw buildInvalidReferenceError(value, 'the reference is empty', mediaKind);
  }
  if (/^data:/i.test(normalized)) {
    const escaped = mediaKind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^data:${escaped}/[a-z0-9.+-]+(?:;[^,]*)?,.+$`, 'is').test(normalized)) {
      throw buildInvalidReferenceError(value, `the data URL is not a valid ${mediaKind} payload`, mediaKind);
    }
    return normalized;
  }

  const reference = classifyReference(normalized, mediaKind);
  if (reference.type === 'public') return reference.url;

  if (isDockerRuntime() && shouldUseLocalDockerMedia()) {
    const resolveManagedUrl = normalizedOptions.resolveManagedUrl || resolveFreshManagedProviderMediaUrl;
    return resolveManagedUrl({
      mediaPath: reference.mediaKey,
      getBaseUrlCandidates: getManagedTunnelBaseUrlCandidates,
      serviceName: normalizeString(normalizedOptions.serviceName) || 'samsar_audio_generator',
      expectedContentTypePrefix: MEDIA_KIND_CONFIG[mediaKind].expectedContentTypePrefix,
      ...(normalizedOptions.fetchImpl ? { fetchImpl: normalizedOptions.fetchImpl } : {}),
    });
  }

  const configuredCloudBases = getConfiguredCloudBaseUrlCandidates();
  if (!configuredCloudBases.length || !getConfiguredMediaBucketNames().length) {
    throw buildInvalidReferenceError(
      value,
      'external S3 delivery is enabled without an explicitly configured bucket and public HTTPS CDN',
      mediaKind,
    );
  }
  const buildCloudUrl = normalizedOptions.buildCloudUrl || buildSecureMediaDeliveryUrl;
  const primeCloudUrl = normalizedOptions.primeCloudUrl || primeCDNCache;
  const publicUrl = buildCloudUrl(reference.mediaKey);
  validateProviderUrl(
    publicUrl,
    mediaKind,
    'the media asset could not be mapped to configured public HTTPS S3/CloudFront delivery',
  );
  const parsedPublicUrl = parseHttpUrl(publicUrl);
  if (!configuredCloudBases.some((base) => urlMatchesBase(parsedPublicUrl, base))) {
    throw buildInvalidReferenceError(
      value,
      'the generated provider URL does not use the configured public HTTPS CDN',
      mediaKind,
    );
  }
  await primeCloudUrl(publicUrl, { requireSuccess: true });
  return publicUrl;
}
