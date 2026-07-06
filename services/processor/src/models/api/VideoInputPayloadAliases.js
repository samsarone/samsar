function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeVideoPayload(payload = {}) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {};
}

export function normalizeImageToVideoStartImagePayload(payload = {}) {
  const normalizedPayload = normalizeVideoPayload(payload);
  if (Array.isArray(normalizedPayload.image_urls) && normalizedPayload.image_urls.length > 0) {
    return normalizedPayload;
  }
  if (Array.isArray(normalizedPayload.imageUrls) && normalizedPayload.imageUrls.length > 0) {
    normalizedPayload.image_urls = normalizedPayload.imageUrls;
    return normalizedPayload;
  }

  const imageUrl =
    normalizeString(normalizedPayload.image_url) ||
    normalizeString(normalizedPayload.imageUrl) ||
    normalizeString(normalizedPayload.image) ||
    normalizeString(normalizedPayload.start_image_url) ||
    normalizeString(normalizedPayload.startImageUrl) ||
    normalizeString(normalizedPayload.start_image) ||
    normalizeString(normalizedPayload.startImage);
  if (imageUrl) {
    normalizedPayload.image_urls = [imageUrl];
  }
  return normalizedPayload;
}
