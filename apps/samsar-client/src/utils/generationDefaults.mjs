import { parseReasoningModelChoice } from './inferenceModelChoices.mjs';
import { normalizeStoredGPTImageModelKey } from './imageModelAvailability.mjs';
import { normalizeKlingModelKey } from './KlingModel.mjs';

export const DEFAULT_TEXT_MODEL = 'claude-opus-5.5';
// GPT Image 2.6 uses the existing routing and pricing key.
export const DEFAULT_IMAGE_MODEL = 'GPTIMAGE2.5';
export const DEFAULT_VIDEO_MODEL = 'KLINGIMGTOVID4';

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
