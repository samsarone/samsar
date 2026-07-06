import { buildSecureMediaDeliveryUrl, primeCDNCache } from '../AWS.js';

const MEDIA_KEY_PREFIX_PATTERN = /^\/?(assets_v2|assets|generations|temp_images|video|ai_video)\//;

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isDataUrl(value) {
  return /^data:/i.test(value);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function withoutQuery(value) {
  return typeof value === 'string' ? value.split('?')[0] : value;
}

function shouldAttemptMediaSigning(value) {
  if (/^https?:\/\//i.test(value)) {
    return true;
  }
  return MEDIA_KEY_PREFIX_PATTERN.test(value);
}

function getMediaKeyReference(value) {
  if (!/^https?:\/\//i.test(value)) {
    return value;
  }
  try {
    const pathName = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, '');
    return MEDIA_KEY_PREFIX_PATTERN.test(pathName) ? pathName : value;
  } catch {
    return value;
  }
}

export async function getAccessibleVisionImageUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized || isDataUrl(normalized) || !shouldAttemptMediaSigning(normalized)) {
    return normalized;
  }

  const signedUrl = buildSecureMediaDeliveryUrl(getMediaKeyReference(normalized));
  if (!signedUrl) {
    return normalized;
  }

  try {
    await primeCDNCache(signedUrl, { requireSuccess: true });
  } catch (error) {
    if (isHttpUrl(normalized)) {
      console.error('[VisionMediaUrl] Falling back to original image URL after CDN prime failure', {
        url: withoutQuery(normalized),
        signedUrl: withoutQuery(signedUrl),
        error: error?.message || error,
      });
      return normalized;
    }
    throw error;
  }
  return signedUrl;
}
