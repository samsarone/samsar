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
  return normalizeString(process.env.MEDIA_PUBLIC_URL || process.env.STATIC_CDN_URL);
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
    return `/${mediaKey.replace(/^\/+/, '')}`;
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

  const localPath = resolveLocalMediaReferencePath(normalized);
  if (localPath) {
    if (options.preferDataUrl === true) {
      return await buildDataUrlFromFile(localPath);
    }
    if (getCurrentEnvironment() === 'docker') {
      return buildDockerMediaUrl(normalized, localPath, options);
    }
    return await uploadImageToCDN(localPath, getUploadRemoteName(normalized, localPath));
  }

  const signedUrl = buildSecureMediaDeliveryUrl(getMediaKeyReference(normalized));
  if (signedUrl) {
    if (getCurrentEnvironment() === 'docker') {
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
