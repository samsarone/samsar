import { parseReasoningModelChoice } from './inferenceModelChoices.mjs';
import { normalizeStoredGPTImageModelKey } from './imageModelAvailability.mjs';
import { normalizeKlingModelKey } from './KlingModel.mjs';

export const DEFAULT_TEXT_MODEL = 'claude-opus-5.5';
// GPT Image 2.6 uses the existing routing and pricing key.
export const DEFAULT_IMAGE_MODEL = 'GPTIMAGE2.5';
export const DEFAULT_VIDEO_MODEL = 'KLINGIMGTOVID4';
export const CREATE_DURATION_OPTIONS = Object.freeze([10, 30, 60, 90, 120, 180]);
export const CREATE_ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1']);

function textModel(value) {
  const saved = typeof value === 'string' ? value.trim() : '';
  const choice = parseReasoningModelChoice(saved);
  return choice
    ? `${choice.model}${choice.effort === 'xhigh' ? '-xhigh' : ''}`
    : saved || DEFAULT_TEXT_MODEL;
}

export function resolveGenerationModelDefaults(user = {}) {
  return {
    inferenceModel: textModel(user?.selectedInferenceModel),
    assistantModel: textModel(user?.selectedAssistantModel),
    imageModel: normalizeStoredGPTImageModelKey(user?.agentImageModel) || DEFAULT_IMAGE_MODEL,
    videoModel: normalizeKlingModelKey(user?.agentVideoModel) || DEFAULT_VIDEO_MODEL,
  };
}

// Account defaults are separate from the other editors' model preferences.
// Older accounts inherit their existing choices until they save Create defaults.
export function resolveCreateDefaults(user = {}) {
  const legacy = resolveGenerationModelDefaults(user);
  const saved = user?.createDefaults || {};
  const inferenceModel = textModel(saved.inferenceModel || legacy.inferenceModel);
  const reasoning = parseReasoningModelChoice(inferenceModel);
  const effort = saved.inferenceEffort || user?.selectedInferenceEffort || reasoning?.effort;
  return {
    inferenceModel: reasoning?.model || inferenceModel,
    imageModel: normalizeStoredGPTImageModelKey(saved.imageModel || legacy.imageModel),
    videoModel: normalizeKlingModelKey(saved.videoModel || legacy.videoModel),
    inferenceEffort: effort === 'xhigh' ? 'xhigh' : 'high',
    duration: CREATE_DURATION_OPTIONS.includes(saved.duration) ? saved.duration : 30,
    aspectRatio: CREATE_ASPECT_RATIOS.includes(saved.aspectRatio) ? saved.aspectRatio : '16:9',
    enableSubtitles: saved.enableSubtitles === true,
  };
}

export function resolvePreferredGenerationModelOption(
  options = [],
  { savedValue, userValue, defaultValue, normalize = (value) => value } = {},
) {
  for (const value of [savedValue, userValue, defaultValue]) {
    if (!value) continue;
    const option = options.find((candidate) => (candidate.value || candidate.key) === normalize(value));
    if (option) return option;
  }
  return options[0] || null;
}
