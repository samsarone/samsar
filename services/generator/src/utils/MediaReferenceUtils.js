import fs from 'fs';
import path from 'path';

import {
  buildSecureMediaDeliveryUrl,
  primeCDNCache,
  uploadImageToCDN,
} from './AWS.js';
import { getCurrentEnvironment } from './Environment.js';
import { resolveFreshManagedProviderMediaUrl } from './ProviderMediaTunnel.js';

const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const SECURE_ASSET_PREFIX_PATTERN = SECURE_ASSET_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MEDIA_KEY_PREFIX_PATTERN = new RegExp(`^(${SECURE_ASSET_PREFIX_PATTERN}|assets|generations|temp_images|video|ai_video)/`);
const DOCKER_GATEWAY_MEDIA_KEY_PATTERN = /^(assets_v2|assets)\//;
const DATA_URL_MEDIA_TYPES_BY_EXTENSION = Object.freeze({
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
});
const DEFAULT_RUNTIME_CONFIG_PATH = '/persistent/config/samsar.config.json';

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldUseDockerLocalMedia() {
  const configuredMode = normalizeString(process.env.SAMSAR_MEDIA_DELIVERY_MODE || process.env.MEDIA_DELIVERY_MODE)
    .toLowerCase();
  if (configuredMode === 'docker-local' || configuredMode === 'local-filesystem') {
    return true;
  }
  if (configuredMode === 's3-cloudfront' || configuredMode === 'external-s3') {
    return false;
  }
  return getCurrentEnvironment() === 'docker' &&
    !isTruthyEnv(process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED || process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED);
}

function isProbablyPublicUrl(value) {
  if (!isHttpUrl(value)) {
    return false;
  }

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === 'media-gateway' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local')
    ) {
      return false;
    }
    if (/^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isPrivateOrLocalHostname(hostname = '') {
  const normalized = normalizeString(hostname).toLowerCase();
  return normalized === 'localhost' ||
    normalized === 'media-gateway' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.local') ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

function getConfiguredOwnedMediaHostnames() {
  const hostnames = new Set();
  for (const value of [
    ...readRuntimeManagedTunnelUrls(),
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL,
    process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
    process.env.PUBLIC_API_BASE_URL,
    process.env.PROCESSOR_API,
    process.env.PROCESSOR_URL,
    ...(!shouldUseDockerLocalMedia()
      ? [process.env.PUBLIC_STATIC_CDN_URL, process.env.STATIC_CDN_URL]
      : []),
  ]) {
    try {
      hostnames.add(new URL(value).hostname.toLowerCase());
    } catch {}
  }
  return hostnames;
}

function isConfiguredS3MediaUrl(url) {
  const hostname = url.hostname.toLowerCase();
  const bucketName = normalizeString(
    process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET,
  ).toLowerCase();
  if (!bucketName) return false;
  if (hostname === `${bucketName}.s3.amazonaws.com` || hostname.startsWith(`${bucketName}.s3.`)) {
    return true;
  }
  if (hostname !== 's3.amazonaws.com' && !hostname.startsWith('s3.')) {
    return false;
  }
  try {
    return decodeURIComponent(url.pathname).replace(/^\/+/, '').startsWith(`${bucketName}/`);
  } catch {
    return false;
  }
}

function getDockerMediaKeyFromPathname(pathname) {
  let referencePath = '';
  try {
    referencePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return '';
  }
  if (MEDIA_KEY_PREFIX_PATTERN.test(referencePath)) return referencePath;
  const parts = referencePath.split('/').filter(Boolean);
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join('/');
    if (MEDIA_KEY_PREFIX_PATTERN.test(candidate)) return candidate;
  }
  return '';
}

function isTunnelHostname(hostname) {
  const normalized = normalizeString(hostname).toLowerCase();
  return normalized.endsWith('.trycloudflare.com') ||
    normalized.endsWith('.loca.lt') ||
    normalized.endsWith('.share.zrok.io');
}

function isOwnedDockerMediaUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      isPrivateOrLocalHostname(hostname) ||
      getConfiguredOwnedMediaHostnames().has(hostname) ||
      (!shouldUseDockerLocalMedia() && isConfiguredS3MediaUrl(url))
    ) {
      return true;
    }
    if (!isTunnelHostname(hostname)) return false;
    const mediaKey = getDockerMediaKeyFromPathname(url.pathname);
    return Boolean(mediaKey && resolveLocalMediaReferencePath(mediaKey));
  } catch {
    return false;
  }
}

function buildInvalidProviderMediaReferenceError(value) {
  const error = new Error(
    `Docker provider media reference is not a mounted Samsar asset or an independently public URL: ${String(value || '').split('?')[0]}`,
  );
  error.name = 'SamsarProviderMediaReferenceError';
  error.code = 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID';
  error.retryable = false;
  error.mediaReference = value;
  return error;
}

function assertConfiguredDockerExternalMediaDelivery(value) {
  const bucket = normalizeString(
    process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET,
  );
  const cdnBase = normalizeString(process.env.STATIC_CDN_URL);
  let parsedCdnBase;
  try {
    parsedCdnBase = new URL(cdnBase);
  } catch {}
  if (
    !bucket ||
    !parsedCdnBase ||
    parsedCdnBase.protocol !== 'https:' ||
    isPrivateOrLocalHostname(parsedCdnBase.hostname)
  ) {
    const error = buildInvalidProviderMediaReferenceError(value);
    error.message = 'Docker external-S3 provider media requires an explicitly configured bucket and public HTTPS STATIC_CDN_URL.';
    throw error;
  }
}

async function buildConfiguredDockerCloudMediaUrl(reference, original, options = {}) {
  assertConfiguredDockerExternalMediaDelivery(original);
  const signedUrl = buildSecureMediaDeliveryUrl(reference);
  if (!signedUrl || !isProbablyPublicUrl(signedUrl) || !/^https:\/\//i.test(signedUrl)) {
    throw buildInvalidProviderMediaReferenceError(original);
  }
  if (options.prime !== false) {
    await primeCDNCache(signedUrl, { requireSuccess: true });
  }
  return signedUrl;
}

function isDockerOwnedOrUnsafeMediaReference(value) {
  const normalized = normalizeString(value);
  if (!normalized) return false;
  if (/^(file|blob):/i.test(normalized) || !isHttpUrl(normalized)) return true;
  return isOwnedDockerMediaUrl(normalized) || !isProbablyPublicUrl(normalized);
}

function isTunnelMediaBaseUrl(value) {
  const normalized = normalizeString(value).replace(/\/+$/, '');
  if (!normalized) {
    return false;
  }
  const explicitTunnelUrl = normalizeString(process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL).replace(/\/+$/, '');
  if (explicitTunnelUrl && normalized === explicitTunnelUrl) {
    return true;
  }
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname.endsWith('.trycloudflare.com') ||
      hostname.endsWith('.loca.lt') ||
      hostname.endsWith('.share.zrok.io');
  } catch {
    return false;
  }
}

function getDataUrlMediaType(localPath = '', mediaKind = 'image') {
  return DATA_URL_MEDIA_TYPES_BY_EXTENSION[path.extname(localPath).toLowerCase()] ||
    (mediaKind === 'video' ? 'video/mp4' : mediaKind === 'audio' ? 'audio/mpeg' : 'image/png');
}

async function buildDataUrlFromFile(localPath, mediaKind) {
  const buffer = await fs.promises.readFile(localPath);
  return `data:${getDataUrlMediaType(localPath, mediaKind)};base64,${buffer.toString('base64')}`;
}

function readRuntimeManagedTunnelUrls() {
  const urls = [];
  const configPaths = [
    process.env.SAMSAR_RUNTIME_CONFIG_FILE,
    process.env.SAMSAR_CONFIG_FILE,
    DEFAULT_RUNTIME_CONFIG_PATH,
  ].map(normalizeString).filter(Boolean).filter((value, index, list) => list.indexOf(value) === index);
  for (const configPath of configPaths) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const localTunnel = config?.localMediaTunnel || {};
      const legacyTunnel = config?.mediaTunnel || {};
      urls.push(
        ...(localTunnel.enabled === false ? [] : [localTunnel.publicUrl, localTunnel.url]),
        ...(legacyTunnel.enabled === false ? [] : [legacyTunnel.publicUrl, legacyTunnel.url]),
        config?.publicUrls?.media,
      );
    } catch (error) {
      console.warn('[MediaReferenceUtils] Unable to read runtime tunnel config', {
        configPath,
        error: error?.message || error,
      });
    }
  }
  return urls;
}

function getDockerMediaBaseCandidates(options = {}) {
  if (options.preferInternalDockerUrl === true) {
    return [normalizeString(process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL) ||
      normalizeString(process.env.MEDIA_PUBLIC_URL || process.env.STATIC_CDN_URL)].filter(Boolean);
  }
  return [
    ...readRuntimeManagedTunnelUrls(),
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
  ]
    .map((value) => normalizeString(value).replace(/\/+$/, ''))
    .filter(Boolean)
    .filter(isProbablyPublicUrl)
    .filter(isTunnelMediaBaseUrl)
    .filter((value, index, list) => list.indexOf(value) === index);
}

async function buildDockerMediaUrl(reference, localPath = '', options = {}) {
  const referencePath = getReferencePath(reference).replace(/^[\\/]+/, '');
  const assetsV2Root = getProcessorAssetsRoot(SECURE_ASSET_PREFIX).replace(/\\/g, '/').replace(/\/+$/, '');
  const assetsRoot = getProcessorAssetsRoot('assets').replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedLocalPath = normalizeString(localPath).replace(/\\/g, '/');
  const mediaKey = normalizedLocalPath.startsWith(`${assetsV2Root}/`)
    ? `assets_v2/${normalizedLocalPath.slice(assetsV2Root.length + 1)}`
    : normalizedLocalPath.startsWith(`${assetsRoot}/`)
      ? `assets/${normalizedLocalPath.slice(assetsRoot.length + 1)}`
      : DOCKER_GATEWAY_MEDIA_KEY_PATTERN.test(referencePath)
        ? referencePath
        : '';

  if (!mediaKey) {
    throw buildInvalidProviderMediaReferenceError(reference);
  }

  if (options.preferInternalDockerUrl === true) {
    const internalBase = getDockerMediaBaseCandidates(options)[0];
    if (!internalBase) {
      throw new Error('An internal Docker media URL is required for this operation.');
    }
    return `${internalBase.replace(/\/+$/, '')}/${mediaKey.replace(/^\/+/, '')}`;
  }

  return resolveFreshManagedProviderMediaUrl({
    mediaPath: mediaKey,
    getBaseUrlCandidates: () => getDockerMediaBaseCandidates(options),
    serviceName: 'samsar_generator_vision',
    expectedContentTypePrefix: ['image', 'video', 'audio'].includes(
      normalizeString(options.mediaKind).toLowerCase(),
    )
      ? `${normalizeString(options.mediaKind).toLowerCase()}/`
      : '',
  });
}

function withoutQuery(value) {
  return typeof value === 'string' ? value.split('?')[0] : value;
}

function getProcessorAssetsRoot(folderName = 'assets') {
  const currentEnv = getCurrentEnvironment();
  if (currentEnv === 'docker' || currentEnv === 'staging') {
    if (folderName === 'assets_v2') {
      return process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
    }
    if (folderName === 'assets') {
      return process.env.SAMSAR_ASSETS_ROOT || '/assets';
    }
    return `/${folderName}`;
  }
  return path.join(process.cwd(), '..', 'samsar_processor', folderName);
}

function stripQueryAndHash(value) {
  return value.split('?')[0].split('#')[0];
}

function getReferencePath(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  if (/^https?:\/\//i.test(normalized)) {
    try {
      return decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '');
    } catch {
      return normalized.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
    }
  }
  if (normalized.startsWith('file://')) {
    try {
      return new URL(normalized).pathname;
    } catch {
      return normalized.replace(/^file:\/\//i, '');
    }
  }
  return stripQueryAndHash(normalized);
}

function getMediaKeyReference(value) {
  const normalizedValue = normalizeString(value);
  if (isHttpUrl(normalizedValue) && !isOwnedDockerMediaUrl(normalizedValue)) {
    return value;
  }
  const referencePath = getReferencePath(value).replace(/^[\\/]+/, '');
  return MEDIA_KEY_PREFIX_PATTERN.test(referencePath) ? referencePath : value;
}

function getDockerProviderMediaKeyReference(value) {
  const referencePath = getReferencePath(value).replace(/^[\\/]+/, '');
  if (!referencePath) {
    return '';
  }

  const normalizedValue = normalizeString(value);
  if (!isHttpUrl(normalizedValue) && MEDIA_KEY_PREFIX_PATTERN.test(referencePath)) {
    return referencePath;
  }

  if (!isHttpUrl(normalizedValue) || !isOwnedDockerMediaUrl(normalizedValue)) {
    return '';
  }

  if (MEDIA_KEY_PREFIX_PATTERN.test(referencePath)) {
    return referencePath;
  }

  const pathParts = referencePath.split('/').filter(Boolean);
  for (let index = 1; index < pathParts.length; index += 1) {
    const candidate = pathParts.slice(index).join('/');
    if (MEDIA_KEY_PREFIX_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  return '';
}

function getExistingFilePath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
    }
  }
  return null;
}

export function resolveLocalMediaReferencePath(reference) {
  const normalizedReference = normalizeString(reference);
  if (isHttpUrl(normalizedReference) && !isOwnedDockerMediaUrl(normalizedReference)) {
    return null;
  }
  const referencePath = getReferencePath(reference);
  if (!referencePath) {
    return null;
  }

  const normalized = referencePath.replace(/^[\\/]+/, '');
  if (path.isAbsolute(referencePath) && !MEDIA_KEY_PREFIX_PATTERN.test(normalized)) {
    return getExistingFilePath([referencePath]);
  }

  const assetRelativePath = normalized.replace(/^assets\//, '');
  const secureRelativePath = normalized.replace(new RegExp(`^${SECURE_ASSET_PREFIX_PATTERN}/`), '');
  const generationRelativePath = normalized.startsWith('generations/')
    ? normalized.slice('generations/'.length)
    : normalized;

  return getExistingFilePath([
    normalized.startsWith(`${SECURE_ASSET_PREFIX}/`)
      ? path.join(getProcessorAssetsRoot(SECURE_ASSET_PREFIX), secureRelativePath)
      : null,
    normalized.startsWith('assets/')
      ? path.join(getProcessorAssetsRoot('assets'), assetRelativePath)
      : null,
    normalized.startsWith('generations/')
      ? path.join(getProcessorAssetsRoot('assets'), 'generations', generationRelativePath)
      : null,
    normalized.startsWith('generations/')
      ? path.join(getProcessorAssetsRoot(SECURE_ASSET_PREFIX), 'generations', generationRelativePath)
      : null,
    path.join(process.cwd(), normalized),
    path.join(getProcessorAssetsRoot(SECURE_ASSET_PREFIX), normalized),
    path.join(getProcessorAssetsRoot('assets'), normalized),
    path.join(getProcessorAssetsRoot('assets'), 'generations', path.basename(normalized)),
  ]);
}

function getUploadRemoteName(reference, localPath) {
  const referencePath = getReferencePath(reference).replace(/^[\\/]+/, '');
  if (referencePath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return referencePath;
  }
  if (referencePath.startsWith('assets/')) {
    return referencePath.replace(/^assets\//, '');
  }
  if (referencePath.startsWith('generations/')) {
    return referencePath;
  }
  return path.basename(localPath || referencePath || `media_${Date.now()}.png`);
}

export async function getAccessibleMediaUrlForProvider(reference, options = {}) {
  const normalized = normalizeString(reference);
  if (!normalized || normalized.startsWith('data:')) {
    return normalized;
  }

  const isDocker = getCurrentEnvironment() === 'docker';
  const dockerMediaKeyReference = isDocker ? getDockerProviderMediaKeyReference(normalized) : '';
  const localPath = resolveLocalMediaReferencePath(normalized);
  if (localPath) {
    if (options.preferDataUrl === true) {
      return await buildDataUrlFromFile(localPath, options.mediaKind);
    }
    if (isDocker) {
      if (!shouldUseDockerLocalMedia()) {
        return buildConfiguredDockerCloudMediaUrl(
          dockerMediaKeyReference || getMediaKeyReference(normalized),
          normalized,
          options,
        );
      }
      return buildDockerMediaUrl(dockerMediaKeyReference || normalized, localPath, options);
    }
    return await uploadImageToCDN(localPath, getUploadRemoteName(normalized, localPath));
  }

  const mediaKeyReference = getMediaKeyReference(normalized);
  if (isDocker && dockerMediaKeyReference) {
    if (shouldUseDockerLocalMedia()) {
      return buildDockerMediaUrl(dockerMediaKeyReference, '', options);
    }
    return buildConfiguredDockerCloudMediaUrl(dockerMediaKeyReference, normalized, options);
  }

  if (isDocker && mediaKeyReference !== normalized) {
    if (shouldUseDockerLocalMedia()) {
      return buildDockerMediaUrl(mediaKeyReference, '', options);
    }
    return buildConfiguredDockerCloudMediaUrl(mediaKeyReference, normalized, options);
  }

  if (isDocker) {
    if (isDockerOwnedOrUnsafeMediaReference(normalized)) {
      throw buildInvalidProviderMediaReferenceError(normalized);
    }
    return normalized;
  }

  const signedUrl = buildSecureMediaDeliveryUrl(mediaKeyReference);
  if (signedUrl) {
    if (isDocker) {
      return signedUrl;
    }
    if (options.prime !== false) {
      try {
        await primeCDNCache(signedUrl, { requireSuccess: options.requirePrimeSuccess !== false });
      } catch (error) {
        if (isHttpUrl(normalized)) {
          console.error('[MediaReferenceUtils] Falling back to original media URL after CDN prime failure', {
            url: withoutQuery(normalized),
            signedUrl: withoutQuery(signedUrl),
            error: error?.message || error,
          });
          return normalized;
        }
        throw error;
      }
    }
    return signedUrl;
  }

  return normalized;
}

export async function getAccessibleMediaUrlsForProvider(references = [], options = {}) {
  const results = [];
  const seen = new Set();
  for (const reference of references) {
    const accessibleUrl = await getAccessibleMediaUrlForProvider(reference, options);
    if (!accessibleUrl || seen.has(accessibleUrl)) {
      continue;
    }
    seen.add(accessibleUrl);
    results.push(accessibleUrl);
  }
  return results;
}
