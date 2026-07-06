import path from 'path';
import fsExtra from 'fs-extra';

function stripLeadingSlash(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(/^\//, '').split('?')[0].split('#')[0];
}

function stripPublicAssetsPrefix(value) {
  return stripLeadingSlash(value)
    .replace(/^assets_v2\//, '')
    .replace(/^assets\//, '');
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value.trim());
}

function resolveImageMimeTypeFromExtension(filePath) {
  const extension = path.extname(filePath || '').toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.avif') {
    return 'image/avif';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  if (extension === '.tif' || extension === '.tiff') {
    return 'image/tiff';
  }
  return 'image/png';
}

function normalizeLocalAssetCandidate(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith('data:image') || isHttpUrl(trimmed)) {
    return null;
  }
  const normalized = stripLeadingSlash(trimmed);
  if (!normalized || normalized.includes('..')) {
    return null;
  }
  return normalized;
}

async function localAssetToDataUrl(value, assetsRoot) {
  const normalized = normalizeLocalAssetCandidate(value);
  if (!normalized) {
    return null;
  }

  const filePath = path.join(assetsRoot, stripPublicAssetsPrefix(normalized));
  const exists = await fsExtra.pathExists(filePath);
  if (!exists) {
    return null;
  }

  const buffer = await fsExtra.readFile(filePath);
  const mimeType = resolveImageMimeTypeFromExtension(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function shouldSkipOutroTileSource(value) {
  if (typeof value !== 'string') {
    return true;
  }
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === 'server_generated_outro_image' ||
    trimmed === 'server_generated_outro_background' ||
    trimmed === 'server_generated_outro_qr' ||
    trimmed === 'server_generated_outro_cta_image' ||
    trimmed === 'server_generated_outro_tile'
  ) {
    return true;
  }
  return trimmed.includes('outro_focus') || trimmed.includes('video/outro/');
}

function expandOutroTileSourceCandidates(value, { allowGenerationFileNameFallback = false } = {}) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return [];
  }

  const candidates = [trimmed];
  if (
    allowGenerationFileNameFallback &&
    !isImageDataUrl(trimmed) &&
    !isHttpUrl(trimmed)
  ) {
    const normalized = stripLeadingSlash(trimmed);
    if (normalized && !normalized.includes('/') && !normalized.includes('..')) {
      candidates.push(`generations/${normalized}`);
    }
  }

  return [...new Set(candidates)];
}

async function resolveOutroTileSourceValue(value, assetsRoot, options = {}) {
  const candidates = expandOutroTileSourceCandidates(value, options);
  for (const candidate of candidates) {
    if (shouldSkipOutroTileSource(candidate)) {
      continue;
    }
    if (candidate.startsWith('data:image') || isHttpUrl(candidate)) {
      return candidate;
    }
    const localDataUrl = await localAssetToDataUrl(candidate, assetsRoot);
    if (localDataUrl) {
      return localDataUrl;
    }
  }
  return null;
}

async function resolveOutroTileImageSource(item, assetsRoot) {
  if (!item || typeof item !== 'object' || item.type !== 'image') {
    return null;
  }

  const sourceCandidates = [
    item.src,
    item.effective_url,
    item.effectiveUrl,
    item.enhanced_url,
    item.enhancedUrl,
    item.image_url,
    item.imageUrl,
    item.url,
    item.image,
  ];

  for (const candidate of sourceCandidates) {
    const imageSource = await resolveOutroTileSourceValue(candidate, assetsRoot, {
      allowGenerationFileNameFallback: true,
    });
    if (imageSource) {
      return imageSource;
    }
  }

  return null;
}

async function resolveOutroTileSourceFromValues(values, assetsRoot) {
  for (const candidate of values) {
    const imageSource = await resolveOutroTileSourceValue(candidate, assetsRoot, {
      allowGenerationFileNameFallback: true,
    });
    if (imageSource) {
      return imageSource;
    }
  }
  return null;
}

async function resolveTopOutroTileImageSource(activeItemList, assetsRoot, fallbackActiveItemList = null) {
  if (!Array.isArray(activeItemList)) {
    return null;
  }

  for (let index = activeItemList.length - 1; index >= 0; index -= 1) {
    const imageSource = await resolveOutroTileImageSource(activeItemList[index], assetsRoot);
    if (imageSource) {
      return imageSource;
    }
    if (Array.isArray(fallbackActiveItemList)) {
      const fallbackImageSource = await resolveOutroTileImageSource(fallbackActiveItemList[index], assetsRoot);
      if (fallbackImageSource) {
        return fallbackImageSource;
      }
    }
  }

  return null;
}

async function resolveLayerOutroTileImageSource(layer, assetsRoot) {
  const imageSession = layer?.imageSession;
  const activeItemList = imageSession?.activeItemList;
  const previousActiveItemList = imageSession?.previousActiveItemList;

  const activeImageSource = await resolveTopOutroTileImageSource(
    activeItemList,
    assetsRoot,
    previousActiveItemList,
  );
  if (activeImageSource) {
    return activeImageSource;
  }

  const previousImageSource = await resolveTopOutroTileImageSource(previousActiveItemList, assetsRoot);
  if (previousImageSource) {
    return previousImageSource;
  }

  return await resolveOutroTileSourceFromValues([
    imageSession?.activeSelectedImage,
    imageSession?.activeGeneratedImage,
    imageSession?.activeEditedImage,
    imageSession?.activeOutpaintedImage,
    imageSession?.videoRenderStartFrameImage,
    imageSession?.videoRenderEndFrameImage,
    imageSession?.activeImageRemoteLink,
    layer?.aiLayerStartFrame,
    layer?.aiLayerEndFrame,
    Array.isArray(layer?.frames) ? layer.frames[0] : null,
  ], assetsRoot);
}

export async function collectGeneratedOutroTileInputs({
  sessionData,
  assetsRoot,
  outroLayerIndex,
}) {
  const imageListPayload = [];
  const imageUrls = [];
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    if (layerIndex === outroLayerIndex) {
      continue;
    }

    if (imageUrls.length >= 8) {
      break;
    }

    const imageSource = await resolveLayerOutroTileImageSource(layers[layerIndex], assetsRoot);
    if (!imageSource || imageUrls.includes(imageSource)) {
      continue;
    }

    imageUrls.push(imageSource);
    imageListPayload.push({
      image_url: imageSource,
      title: '',
    });
  }

  return { imageListPayload, imageUrls };
}
