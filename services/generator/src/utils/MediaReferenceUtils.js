import fs from 'fs';
import path from 'path';

import {
  buildSecureMediaDeliveryUrl,
  primeCDNCache,
  uploadImageToCDN,
} from './AWS.js';
import { getCurrentEnvironment } from './Environment.js';

const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const SECURE_ASSET_PREFIX_PATTERN = SECURE_ASSET_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MEDIA_KEY_PREFIX_PATTERN = new RegExp(`^(${SECURE_ASSET_PREFIX_PATTERN}|assets|generations|temp_images|video|ai_video)/`);
const DATA_URL_MEDIA_TYPES_BY_EXTENSION = Object.freeze({
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

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

function getDataUrlMediaType(localPath = '') {
  return DATA_URL_MEDIA_TYPES_BY_EXTENSION[path.extname(localPath).toLowerCase()] || 'image/png';
}

async function buildDataUrlFromFile(localPath) {
  const buffer = await fs.promises.readFile(localPath);
  return `data:${getDataUrlMediaType(localPath)};base64,${buffer.toString('base64')}`;
}

function getDockerMediaBase(options = {}) {
  if (options.preferInternalDockerUrl === true) {
    return normalizeString(process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL) ||
      normalizeString(process.env.MEDIA_PUBLIC_URL || process.env.STATIC_CDN_URL);
  }
  return [
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    process.env.MEDIA_PUBLIC_URL,
  ]
    .map((value) => normalizeString(value).replace(/\/+$/, ''))
    .filter(Boolean)
    .filter(isProbablyPublicUrl)
    .filter(isTunnelMediaBaseUrl)[0] || '';
}

function buildDockerMediaUrl(reference, localPath = '', options = {}) {
  const referencePath = getReferencePath(reference).replace(/^[\\/]+/, '');
  const assetsV2Root = getProcessorAssetsRoot(SECURE_ASSET_PREFIX).replace(/\\/g, '/').replace(/\/+$/, '');
  const assetsRoot = getProcessorAssetsRoot('assets').replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedLocalPath = normalizeString(localPath).replace(/\\/g, '/');
  const mediaKey =
    MEDIA_KEY_PREFIX_PATTERN.test(referencePath)
      ? referencePath
      : normalizedLocalPath.startsWith(`${assetsV2Root}/`)
        ? `${SECURE_ASSET_PREFIX}/${normalizedLocalPath.slice(assetsV2Root.length + 1)}`
        : normalizedLocalPath.startsWith(`${assetsRoot}/`)
          ? normalizedLocalPath.slice(assetsRoot.length + 1)
          : referencePath;

  if (!mediaKey) {
    return normalizeString(reference);
  }

  const mediaBase = getDockerMediaBase(options);
  if (!mediaBase) {
    throw new Error(
      'A tunneled media URL is required before sending local Docker media to remote vision providers. ' +
      'Run scripts/start-local-media-tunnel.sh or configure s3-cloudfront media delivery.'
    );
  }

  return `${mediaBase.replace(/\/+$/, '')}/${mediaKey.replace(/^\/+/, '')}`;
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
  const referencePath = getReferencePath(value).replace(/^[\\/]+/, '');
  return MEDIA_KEY_PREFIX_PATTERN.test(referencePath) ? referencePath : value;
}

function getDockerProviderMediaKeyReference(value) {
  const referencePath = getReferencePath(value).replace(/^[\\/]+/, '');
  if (!referencePath) {
    return '';
  }

  if (MEDIA_KEY_PREFIX_PATTERN.test(referencePath)) {
    return referencePath;
  }

  if (!isHttpUrl(normalizeString(value))) {
    return '';
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
      return await buildDataUrlFromFile(localPath);
    }
    if (isDocker) {
      if (!shouldUseDockerLocalMedia()) {
        const signedUrl = buildSecureMediaDeliveryUrl(dockerMediaKeyReference || getMediaKeyReference(normalized));
        if (signedUrl) {
          return signedUrl;
        }
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
    const signedDockerUrl = buildSecureMediaDeliveryUrl(dockerMediaKeyReference);
    if (signedDockerUrl) {
      return signedDockerUrl;
    }
  }

  if (isDocker && mediaKeyReference !== normalized) {
    if (shouldUseDockerLocalMedia()) {
      return buildDockerMediaUrl(mediaKeyReference, '', options);
    }
    const signedDockerUrl = buildSecureMediaDeliveryUrl(mediaKeyReference);
    if (signedDockerUrl) {
      return signedDockerUrl;
    }
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
