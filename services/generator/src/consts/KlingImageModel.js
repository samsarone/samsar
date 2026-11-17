export const KLING_IMAGE_MODEL = 'KLINGIMAGE4';
export const KLING_IMAGE_FAL_ENDPOINT = 'kling/v4/text-to-image';

export const KLING_IMAGE_ASPECT_RATIOS = Object.freeze([
  'auto', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9',
]);
export const KLING_IMAGE_RESOLUTIONS = Object.freeze(['2K', '4K', '8K']);
export const KLING_IMAGE_APP_RESOLUTION = '720p';
export const KLING_IMAGE_APP_DIMENSIONS = Object.freeze({
  '16:9': Object.freeze({ width: 1280, height: 720 }),
  '9:16': Object.freeze({ width: 720, height: 1280 }),
});

export function getKlingImageOutputDimensions(payload = {}) {
  if (String(payload.resolution || '').trim().toLowerCase() !== KLING_IMAGE_APP_RESOLUTION) return null;
  const aspectRatio = String(payload.aspectRatio || payload.aspect_ratio || '16:9').trim();
  const dimensions = KLING_IMAGE_APP_DIMENSIONS[aspectRatio];
  if (!dimensions) {
    throw Object.assign(new Error('Kling Image 4 720p output requires a 16:9 or 9:16 aspect ratio.'), { status: 400 });
  }
  return dimensions;
}

// Existing Studio and agent rows use the shared image schema's 1k default.
// Kling starts at 2K; preserve an explicitly supported higher resolution.
export function getKlingImageResolution(payload = {}) {
  const resolution = String(payload.resolution || '').trim().toUpperCase();
  return KLING_IMAGE_RESOLUTIONS.includes(resolution) ? resolution : '2K';
}

export function buildKlingImageInput(payload = {}) {
  const count = Number(payload.numImages ?? payload.num_images ?? 1);
  if (count !== 1) {
    throw Object.assign(new Error('Kling Image 4 currently supports one image per request.'), { status: 400 });
  }
  const outputDimensions = getKlingImageOutputDimensions(payload);
  const aspectRatio = String(payload.aspectRatio || payload.aspect_ratio || (outputDimensions ? '16:9' : '1:1')).trim();
  return {
    prompt: payload.prompt,
    result_type: 'single',
    num_images: 1,
    resolution: getKlingImageResolution(payload),
    aspect_ratio: KLING_IMAGE_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1',
  };
}
