import { EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL } from './pricing/ExpressVideoPricingDistribution.js';
import { isVideoModelTemporarilyDisabled } from './VideoModelAvailability.js';

export const EXPRESS_VIDEO_IMAGE_MODEL_KEYS = Object.freeze([
  'GPTIMAGE2',
  'NANOBANANAPRO',
  'SEEDREAM',
  'QWENIMAGE3PRO',
  'WAN2.7PRO',
]);

export const STANDALONE_PROVIDER_BILLED_EXPRESS_VIDEO_MODEL_KEYS = Object.freeze([
  'SEEDANCE2.0I2V',
  'SEEDANCE2.5I2V',
]);

export const EXPRESS_VIDEO_VIDEO_MODEL_KEYS = Object.freeze([
  ...new Set([
    ...Object.keys(EXPRESS_VIDEO_CREDITS_PER_SECOND_BY_MODEL),
    ...STANDALONE_PROVIDER_BILLED_EXPRESS_VIDEO_MODEL_KEYS,
  ]),
].filter((modelKey) => !isVideoModelTemporarilyDisabled(modelKey)));

export const TEXT_TO_VIDEO_IMAGE_MODEL_KEYS = EXPRESS_VIDEO_IMAGE_MODEL_KEYS;
export const TEXT_TO_VIDEO_VIDEO_MODEL_KEYS = EXPRESS_VIDEO_VIDEO_MODEL_KEYS;
export const IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS = EXPRESS_VIDEO_IMAGE_MODEL_KEYS;
export const IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS = EXPRESS_VIDEO_VIDEO_MODEL_KEYS;
