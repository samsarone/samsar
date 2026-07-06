import { EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL } from './pricing/ExpressVideoPricingDistribution.js';
import { IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS } from './ExpressVideoModelOptions.js';

export const IMAGE_LIST_TO_VIDEO_DEFAULT_VIDEO_MODEL = 'RUNWAYML';

export const IMAGE_LIST_TO_VIDEO_PUBLIC_VIDEO_MODELS = IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS;

export const IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ALIASES = Object.freeze(
  Object.fromEntries(IMAGE_LIST_TO_VIDEO_PUBLIC_VIDEO_MODELS.map((modelKey) => [modelKey, modelKey])),
);

export const IMAGE_LIST_TO_VIDEO_CREDITS_PER_SECOND_BY_MODEL = Object.freeze(
  Object.fromEntries(
    IMAGE_LIST_TO_VIDEO_PUBLIC_VIDEO_MODELS.map((modelKey) => [
      modelKey,
      EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL[modelKey],
    ]),
  ),
);

export const IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ERROR_MESSAGE =
  `video_model must be one of: ${IMAGE_LIST_TO_VIDEO_PUBLIC_VIDEO_MODELS.join(', ')}.`;

export function normalizeImageListToVideoModel(value, options = {}) {
  const requestedVideoModel = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const modelKey = requestedVideoModel || IMAGE_LIST_TO_VIDEO_DEFAULT_VIDEO_MODEL;
  if (options.allowCustomImageToVideo === true && modelKey === 'CUSTOM_IMAGE_TO_VIDEO') {
    return 'CUSTOM_IMAGE_TO_VIDEO';
  }
  return IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ALIASES[modelKey] || null;
}

export function getImageListToVideoCreditsPerSecond(videoModel) {
  const normalizedVideoModel =
    normalizeImageListToVideoModel(videoModel, { allowCustomImageToVideo: true }) ||
    IMAGE_LIST_TO_VIDEO_DEFAULT_VIDEO_MODEL;
  if (normalizedVideoModel === 'CUSTOM_IMAGE_TO_VIDEO') {
    return 0;
  }
  return IMAGE_LIST_TO_VIDEO_CREDITS_PER_SECOND_BY_MODEL[normalizedVideoModel] ?? 60;
}
