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

function isTemporaryTunnelUrl(value) {
  if (!/^https?:\/\//i.test(value || '')) {
    return false;
  }
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.endsWith('.trycloudflare.com')
      || hostname.endsWith('.loca.lt')
      || hostname.endsWith('.share.zrok.io');
  } catch {
    return false;
  }
}

function buildCanonicalSecureAssetReference(value) {
  const normalizedKey = normalizeObjectKey(value);
  if (!normalizedKey) {
    return null;
  }
  const secureKey = normalizedKey.startsWith(`${SECURE_ASSET_PREFIX}/`)
    ? normalizedKey
    : `${SECURE_ASSET_PREFIX}/${normalizedKey}`;
  return `/${secureKey}`;
}

/**
 * Return the stable media reference stored on generation queue records.
 *
 * Provider URLs (including short-lived tunnel URLs) are intentionally not
 * created here. The ai-video-layer-generator resolves this reference at the
 * final provider dispatch boundary, so every provider attempt receives a
 * freshly validated public URL while queue and session state remain durable.
 */
export function getCanonicalAiVideoReference({ layer, userId }) {
  const existingRemoteLink = typeof layer?.aiVideoRemoteLink === 'string'
    ? layer.aiVideoRemoteLink.trim()
    : '';

  // A non-temporary secure remote reference identifies the object that was
  // actually uploaded. Prefer it when it differs from the conventional local
  // path mapping (legacy/custom producers may use another valid object key).
  if (
    existingRemoteLink
    && isSecureAssetReference(existingRemoteLink)
    && !isTemporaryTunnelUrl(existingRemoteLink)
  ) {
    return /^https?:\/\//i.test(existingRemoteLink)
      ? existingRemoteLink
      : buildCanonicalSecureAssetReference(existingRemoteLink);
  }

  const aiVideoRelativePath = getAiVideoUploadRelativePath(layer?.aiVideoLayer);
  if (aiVideoRelativePath && userId) {
    return buildCanonicalSecureAssetReference(
      `user_resources/${userId}/ai_videos/${aiVideoRelativePath}`
    );
  }

  if (!existingRemoteLink) {
    return null;
  }

  // Canonicalize stored object keys without rewriting independently hosted
  // third-party URLs that happen to contain a Samsar-looking path.
  if (!/^https?:\/\//i.test(existingRemoteLink) && isSecureAssetReference(existingRemoteLink)) {
    return buildCanonicalSecureAssetReference(existingRemoteLink);
  }

  return existingRemoteLink;
}

async function primeAndReturn(url) {
  const providerUrl = await normalizeProviderMediaUrl(url, { mediaKind: 'video' });
  await primeCDNCache(providerUrl, { requireSuccess: true });
  return providerUrl;
}

export async function resolveProviderAiVideoUrl({ layer, userId }) {
  const canonicalReference = getCanonicalAiVideoReference({ layer, userId });
  if (!canonicalReference) {
    return null;
  }

  const providerReference = isSecureAssetReference(canonicalReference)
    ? buildSecureMediaDeliveryUrl(canonicalReference)
    : canonicalReference;
  return primeAndReturn(providerReference);
}
