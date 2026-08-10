import {
  INFERENCE_MODEL_OPTIONS,
  normalizeSupportedInferenceModel,
} from './InferenceModels.js';
import { IMAGE_MODEL_PRICES, VIDEO_MODEL_PRICES } from './ModelPrices.js';

function modelKey(model) {
  return typeof model?.key === 'string' ? model.key.trim() : '';
}

export const BRANCHED_INFERENCE_MODEL_OPTIONS = Object.freeze(
  INFERENCE_MODEL_OPTIONS.filter((model) => model.isBranchedInferenceModel === true),
);

export const BRANCHED_IMAGE_MODEL_KEYS = Object.freeze(
  IMAGE_MODEL_PRICES
    .filter((model) => model.isExpressModel === true && model.isBranchedImageModel === true)
    .map(modelKey)
    .filter(Boolean),
);

export const BRANCHED_VIDEO_MODEL_KEYS = Object.freeze(
  VIDEO_MODEL_PRICES
    .filter((model) => model.isExpressModel === true && model.isBranchedVideoModel === true)
    .map(modelKey)
    .filter(Boolean),
);

const BRANCHED_INFERENCE_MODEL_VALUES = new Set(
  BRANCHED_INFERENCE_MODEL_OPTIONS.map((model) => model.value),
);
const BRANCHED_IMAGE_MODEL_KEY_SET = new Set(BRANCHED_IMAGE_MODEL_KEYS);
const BRANCHED_VIDEO_MODEL_KEY_SET = new Set(BRANCHED_VIDEO_MODEL_KEYS);

export function isBranchedInferenceModel(value) {
  const normalized = normalizeSupportedInferenceModel(value);
  return normalized !== null && BRANCHED_INFERENCE_MODEL_VALUES.has(normalized);
}

export function isBranchedImageModel(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return BRANCHED_IMAGE_MODEL_KEY_SET.has(normalized);
}

export function isBranchedVideoModel(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return BRANCHED_VIDEO_MODEL_KEY_SET.has(normalized);
}
