import { buildSecureMediaDeliveryUrl, normalizeProviderMediaUrl, primeCDNCache } from './AWS.js';

const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');

function normalizeObjectKey(value) {
  const rawValue = typeof value === 'string' ? value.trim() : '';
  if (!rawValue) {
    return '';
  }
  if (/^https?:\/\//i.test(rawValue)) {
    try {
      return decodeURIComponent(new URL(rawValue).pathname).replace(/^\/+/, '');
    } catch {
      return rawValue.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
    }
  }
  return rawValue.replace(/^\/+/, '');
}

function getAiVideoUploadRelativePath(aiVideoLayer) {
  const normalizedPath = normalizeObjectKey(aiVideoLayer);
  const match = normalizedPath.match(/(?:^|\/)ai_video\/generations\/(.+)$/);
  return match?.[1] || null;
}

function isSecureAssetReference(value) {
  return normalizeObjectKey(value).startsWith(`${SECURE_ASSET_PREFIX}/`);
}

async function primeAndReturn(url) {
  const providerUrl = await normalizeProviderMediaUrl(url);
  await primeCDNCache(providerUrl, { requireSuccess: true });
  return providerUrl;
}

export async function resolveProviderAiVideoUrl({ layer, userId }) {
  const existingRemoteLink = typeof layer?.aiVideoRemoteLink === 'string'
    ? layer.aiVideoRemoteLink.trim()
    : '';

  if (existingRemoteLink) {
    const remoteLink = isSecureAssetReference(existingRemoteLink)
      ? buildSecureMediaDeliveryUrl(existingRemoteLink)
      : existingRemoteLink;

    try {
      return await primeAndReturn(remoteLink);
    } catch (error) {
      if (isSecureAssetReference(existingRemoteLink)) {
        throw error;
      }
    }

    return primeAndReturn(buildSecureMediaDeliveryUrl(existingRemoteLink));
  }

  const aiVideoRelativePath = getAiVideoUploadRelativePath(layer?.aiVideoLayer);
  if (!aiVideoRelativePath || !userId) {
    return null;
  }

  const signedRemoteLink = buildSecureMediaDeliveryUrl(
    `user_resources/${userId}/ai_videos/${aiVideoRelativePath}`
  );
  return primeAndReturn(signedRemoteLink);
}
