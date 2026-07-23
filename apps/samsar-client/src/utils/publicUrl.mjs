export const HOSTED_GALLERY_URL = 'https://gallery.samsar.one';

export function normalizePublicUrl(value, fallback) {
  const configuredValue = typeof value === 'string' ? value.trim() : '';
  const fallbackValue = typeof fallback === 'string' ? fallback.trim() : '';

  return (configuredValue || fallbackValue).replace(/\/+$/, '');
}

export function resolvePublisherUrl(value) {
  return normalizePublicUrl(value, HOSTED_GALLERY_URL);
}
