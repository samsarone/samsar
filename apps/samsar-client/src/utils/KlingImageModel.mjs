export const KLING_IMAGE_V4_MODEL_KEY = 'KLINGIMAGE4';
export const KLING_IMAGE_V4_RESOLUTION = '720p';
export const KLING_IMAGE_V4_ASPECT_RATIOS = Object.freeze([
  '16:9', '9:16',
]);

// fal generates at 2K before the worker fits the standard 720p app output.
// Its $0.063 base plus the Studio 20% markup, at 100 credits/USD, is unchanged.
export const KLING_IMAGE_V4_STUDIO_CREDITS_PER_IMAGE = 7.56;

export function getKlingImageAppRequestOptions(model) {
  return model === KLING_IMAGE_V4_MODEL_KEY ? { resolution: KLING_IMAGE_V4_RESOLUTION } : {};
}
