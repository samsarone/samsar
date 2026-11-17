import {
  GENERATION_CREDITS_PER_USD,
  GENERATION_PRICING_MULTIPLIER,
} from './pricing/GenerationPricingPolicy.js';

export const KLING_IMAGE_V4_MODEL_KEY = 'KLINGIMAGE4';
export const KLING_IMAGE_V4_BASE_COST_USD = 0.063;
export const KLING_IMAGE_V4_STUDIO_CREDITS = Number((
  KLING_IMAGE_V4_BASE_COST_USD * GENERATION_PRICING_MULTIPLIER * GENERATION_CREDITS_PER_USD
).toFixed(4));
export const KLING_IMAGE_V4_RESOLUTIONS = Object.freeze(['2K', '4K', '8K']);
export const KLING_IMAGE_V4_ASPECT_RATIOS = Object.freeze([
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9',
]);
export const KLING_IMAGE_V4_APP_ASPECT_RATIOS = Object.freeze(['16:9', '9:16']);
export const KLING_IMAGE_V4_APP_RESOLUTION = '720p';

function invalidRequest(message) {
  return Object.assign(new Error(message), { status: 400, statusCode: 400 });
}

// Studio and agent images follow the video canvas. Fal renders at its native
// 2K minimum; the image worker delivers 1280x720 or 720x1280 to the editor.
export function normalizeKlingImageAppRequestOptions({ aspectRatio } = {}) {
  const normalizedAspectRatio = aspectRatio === undefined || aspectRatio === null || aspectRatio === ''
    ? '16:9'
    : typeof aspectRatio === 'string' ? aspectRatio.trim() : aspectRatio;
  if (!KLING_IMAGE_V4_APP_ASPECT_RATIOS.includes(normalizedAspectRatio)) {
    throw invalidRequest(`Kling Image 4 at 720p aspect_ratio must be one of: ${KLING_IMAGE_V4_APP_ASPECT_RATIOS.join(', ')}.`);
  }
  return { aspectRatio: normalizedAspectRatio, resolution: KLING_IMAGE_V4_APP_RESOLUTION };
}

// Run at workflow admission as well as image enqueue, so unsupported canvases
// cannot reserve workflow credits before the image stage discovers the error.
export function assertKlingImageAppPayload(payload = {}) {
  const model = payload.image_model || payload.imageModel;
  if (typeof model !== 'string' || model.trim().toUpperCase() !== KLING_IMAGE_V4_MODEL_KEY) return;
  normalizeKlingImageAppRequestOptions({ aspectRatio: payload.aspect_ratio || payload.aspectRatio });
}

export function normalizeKlingImageRequestOptions({ aspectRatio, resolution } = {}) {
  const normalizedResolution = resolution === undefined || resolution === null || resolution === ''
    ? '2K'
    : typeof resolution === 'string' ? resolution.trim().toUpperCase() : resolution;
  if (normalizedResolution === '720P') {
    return normalizeKlingImageAppRequestOptions({ aspectRatio });
  }
  const normalizedAspectRatio = aspectRatio === undefined || aspectRatio === null || aspectRatio === ''
    ? '1:1'
    : typeof aspectRatio === 'string' ? aspectRatio.trim().toLowerCase() : aspectRatio;
  if (![...KLING_IMAGE_V4_ASPECT_RATIOS, 'auto'].includes(normalizedAspectRatio)) {
    throw invalidRequest(`Kling Image 4 aspect_ratio must be one of: ${KLING_IMAGE_V4_ASPECT_RATIOS.join(', ')}, auto.`);
  }
  if (!KLING_IMAGE_V4_RESOLUTIONS.includes(normalizedResolution)) {
    throw invalidRequest(`Kling Image 4 resolution must be one of: ${KLING_IMAGE_V4_RESOLUTIONS.join(', ')}, 720p.`);
  }
  return { aspectRatio: normalizedAspectRatio, resolution: normalizedResolution };
}
