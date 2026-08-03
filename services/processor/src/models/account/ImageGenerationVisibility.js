function normalizeSessionId(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return value?.toString?.() || String(value);
}

export function normalizeGeneratedImageAssetKey(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  let normalizedValue = trimmedValue;
  try {
    if (/^https?:\/\//i.test(trimmedValue)) {
      const parsedUrl = new URL(trimmedValue);
      normalizedValue = decodeURIComponent(parsedUrl.pathname);
    }
  } catch {
    normalizedValue = trimmedValue;
  }

  normalizedValue = normalizedValue
    .split(/[?#]/, 1)[0]
    .replace(/^\/+/, '')
    .replace(/^assets\/generations\//, 'generations/');

  return normalizedValue;
}

function isExplicitIntermediate(item = {}) {
  if (item?.isIntermediate === true || item?.intermediate === true || item?.isFinal === false) {
    return true;
  }

  const generationType = typeof item?.generationType === 'string'
    ? item.generationType.trim().toLowerCase()
    : '';

  return [
    'filter_pass',
    'intermediate',
    'scene_intermediate',
    'scene_preview',
  ].includes(generationType);
}

function collectFinalSceneImageKeys(session = {}) {
  const finalImageKeys = new Set();
  const layers = Array.isArray(session?.layers) ? session.layers : [];

  layers.forEach((layer) => {
    [
      layer?.imageSession?.activeGeneratedImage,
      layer?.imageSession?.activeEditedImage,
      layer?.activeImageCandidate?.src,
    ].forEach((assetPath) => {
      const assetKey = normalizeGeneratedImageAssetKey(assetPath);
      if (assetKey) {
        finalImageKeys.add(assetKey);
      }
    });
  });

  return finalImageKeys;
}

/**
 * Scene generation can persist several internal candidates in GeneratedImage.
 * For video sessions only the active image for each scene belongs in the user
 * image library. Image-studio sessions and standalone/legacy generations keep
 * their full user-visible history.
 */
export function filterVisibleGeneratedImages(generatedImages = [], sessions = []) {
  const videoSessionsById = new Map();

  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (session?.sessionType === 'image') {
      return;
    }

    const sessionId = normalizeSessionId(session?._id || session?.sessionId);
    if (!sessionId) {
      return;
    }

    videoSessionsById.set(sessionId, collectFinalSceneImageKeys(session));
  });

  const seenAssets = new Set();
  const visibleImages = [];

  (Array.isArray(generatedImages) ? generatedImages : []).forEach((item) => {
    if (!item || isExplicitIntermediate(item)) {
      return;
    }

    const assetKey = normalizeGeneratedImageAssetKey(item.url);
    if (!assetKey || seenAssets.has(assetKey)) {
      return;
    }

    const sessionId = normalizeSessionId(item.sessionId);
    const finalSceneImageKeys = videoSessionsById.get(sessionId);
    const generationType = typeof item?.generationType === 'string'
      ? item.generationType.trim().toLowerCase()
      : 'generate';
    if (finalSceneImageKeys && generationType === 'generate' && !finalSceneImageKeys.has(assetKey)) {
      return;
    }

    seenAssets.add(assetKey);
    visibleImages.push(item);
  });

  return visibleImages;
}
