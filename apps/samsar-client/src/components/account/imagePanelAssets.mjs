const IMAGE_SOURCE_FIELDS = [
  'displayUrl',
  'imageUrl',
  'assetPath',
  'thumbnailPath',
  'thumbnail',
  'url',
];

export function resolveImagePanelAssetSource(image = {}) {
  for (const field of IMAGE_SOURCE_FIELDS) {
    const value = image?.[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function normalizeImagePanelAssetKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const trimmedValue = value.trim();
  let normalizedValue = trimmedValue;
  try {
    if (/^https?:\/\//i.test(trimmedValue)) {
      const parsedUrl = new URL(trimmedValue);
      normalizedValue = decodeURIComponent(parsedUrl.pathname);
    }
  } catch {
    normalizedValue = trimmedValue;
  }

  return normalizedValue
    .split(/[?#]/, 1)[0]
    .replace(/^\/+/, '')
    .replace(/^assets\/generations\//, 'generations/');
}

function isIntermediateImage(image = {}) {
  if (image?.isIntermediate === true || image?.intermediate === true || image?.isFinal === false) {
    return true;
  }

  const generationType = typeof image?.generationType === 'string'
    ? image.generationType.trim().toLowerCase()
    : '';

  return [
    'filter_pass',
    'intermediate',
    'scene_intermediate',
    'scene_preview',
  ].includes(generationType);
}

export function getUniqueVisibleImagePanelItems(items = []) {
  const seenAssetKeys = new Set();

  return (Array.isArray(items) ? items : []).filter((image) => {
    if (!image || isIntermediateImage(image)) {
      return false;
    }

    const assetKey = normalizeImagePanelAssetKey(resolveImagePanelAssetSource(image));
    if (!assetKey || seenAssetKeys.has(assetKey)) {
      return false;
    }

    seenAssetKeys.add(assetKey);
    return true;
  });
}
