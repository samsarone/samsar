import { normalizeSupportedInferenceModel } from './InferenceModels.js';
import { normalizeStoredGPTImageModelKey } from './GPTImageModelKeys.js';
import { normalizeKlingModelKey } from '../utils/KlingModel.js';
import { getReasoningModelBase, resolveInferenceEffort } from '../inference/ReasoningModels.js';

export const CREATE_DURATIONS = Object.freeze([10, 30, 60, 90, 120, 180]);
export const CREATE_ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1']);
export const SYSTEM_CREATE_DEFAULTS = Object.freeze({
  inferenceModel: 'claude-opus-5.5',
  imageModel: 'GPTIMAGE2.5',
  videoModel: 'KLINGIMGTOVID4',
  inferenceEffort: 'high',
  duration: 30,
  aspectRatio: '16:9',
  enableSubtitles: false,
});

const text = (value) => typeof value === 'string' ? value.trim() : '';

// Keep this read path free of availability checks and writes. A removed model
// remains visible as an unavailable preference instead of being silently reset.
export function resolveCreateDefaults(user = {}) {
  const saved = user?.createDefaults || {};
  const rawModel = text(saved.inferenceModel) || text(user?.selectedInferenceModel) || SYSTEM_CREATE_DEFAULTS.inferenceModel;
  const inferenceModel = normalizeSupportedInferenceModel(rawModel) || rawModel;
  const legacyEffort = typeof user?.$isDefault === 'function' && user.$isDefault('selectedInferenceEffort')
    ? undefined : user?.selectedInferenceEffort;
  return {
    inferenceModel: getReasoningModelBase(inferenceModel),
    imageModel: normalizeStoredGPTImageModelKey(text(saved.imageModel) || text(user?.agentImageModel)) || SYSTEM_CREATE_DEFAULTS.imageModel,
    videoModel: normalizeKlingModelKey(text(saved.videoModel) || text(user?.agentVideoModel)) || SYSTEM_CREATE_DEFAULTS.videoModel,
    inferenceEffort: resolveInferenceEffort(inferenceModel, saved.inferenceEffort || legacyEffort),
    duration: CREATE_DURATIONS.includes(saved.duration) ? saved.duration : SYSTEM_CREATE_DEFAULTS.duration,
    aspectRatio: CREATE_ASPECT_RATIOS.includes(saved.aspectRatio) ? saved.aspectRatio : SYSTEM_CREATE_DEFAULTS.aspectRatio,
    enableSubtitles: typeof saved.enableSubtitles === 'boolean' ? saved.enableSubtitles : SYSTEM_CREATE_DEFAULTS.enableSubtitles,
  };
}
