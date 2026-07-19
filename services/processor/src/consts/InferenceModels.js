export const INFERENCE_MODELS = Object.freeze({
  Inference: 'gpt-5.6-sol',
  PublicationMetadata: 'gpt-5.6-luna',
});

export const INFERENCE_REASONING_EFFORTS = Object.freeze({
  Inference: 'xhigh',
  PublicationMetadata: 'xhigh',
});

export const INFERENCE_MODEL_KEYS = Object.freeze({
  GPT_56_SOL: INFERENCE_MODELS.Inference,
  GEMINI_31_PRO: 'gemini-3.1-pro',
  QWEN_37: 'QWEN3.7',
});

export const INFERENCE_PROVIDER_MODEL_KEYS = Object.freeze({
  [INFERENCE_MODEL_KEYS.GPT_56_SOL]: INFERENCE_MODELS.Inference,
  [INFERENCE_MODEL_KEYS.GEMINI_31_PRO]: 'gemini-3.1-pro-preview',
  [INFERENCE_MODEL_KEYS.QWEN_37]: 'qwen3.7-max',
});

export const DEFAULT_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.GPT_56_SOL;
export const GPT_56_SOL_REASONING_EFFORT = INFERENCE_REASONING_EFFORTS.Inference;
export const PUBLICATION_METADATA_INFERENCE_SETTINGS = Object.freeze({
  model: INFERENCE_MODELS.PublicationMetadata,
  reasoning: Object.freeze({
    effort: INFERENCE_REASONING_EFFORTS.PublicationMetadata,
  }),
});

export function getPublicationMetadataInferenceSettings(value) {
  const inferenceModel = normalizeInferenceModel(value);

  if (!isOpenAIInferenceModel(inferenceModel)) {
    return { model: inferenceModel };
  }

  return PUBLICATION_METADATA_INFERENCE_SETTINGS;
}

export const GEMINI_31_PRO_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.GEMINI_31_PRO;
export const DEFAULT_GEMINI_31_PRO_VERTEX_MODEL =
  INFERENCE_PROVIDER_MODEL_KEYS[GEMINI_31_PRO_INFERENCE_MODEL];
export const QWEN_37_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.QWEN_37;
export const QWEN_37_MAX_MODEL = INFERENCE_PROVIDER_MODEL_KEYS[QWEN_37_INFERENCE_MODEL];
export const QWEN_37_PLUS_MODEL = 'qwen3.7-plus';

export const SUPPORTED_INFERENCE_MODEL_VALUES = Object.freeze([
  DEFAULT_INFERENCE_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  QWEN_37_INFERENCE_MODEL,
]);

const CONFIGURED_OPENAI_INFERENCE_MODELS = new Set(Object.values(INFERENCE_MODELS));

const GEMINI_31_PRO_ALIASES = new Set([
  GEMINI_31_PRO_INFERENCE_MODEL,
  'gemini-3.1-pro-preview',
  'gemini-3.1-pro',
  'gemini-3-pro',
  'gemini-3-pro-preview',
]);

const GEMINI_31_PRO_ALIAS_TOKENS = new Set([
  'GEMINI31',
  'GEMINI31PRO',
  'GEMINI31PROPREVIEW',
  'GEMINI3PRO',
  'GEMINI3PROPREVIEW',
  'GOOGLEGEMINI31PRO',
  'GOOGLEGEMINI31',
  'GOOGLEGEMINI31PROPREVIEW',
  'GOOGLEGEMINI3PRO',
  'GOOGLEGEMINI3PROPREVIEW',
]);

const QWEN_37_ALIASES = new Set([
  QWEN_37_INFERENCE_MODEL.toLowerCase(),
  QWEN_37_MAX_MODEL,
  QWEN_37_PLUS_MODEL,
]);

const QWEN_37_ALIAS_TOKENS = new Set([
  'QWEN37',
  'QWEN37MAX',
  'QWEN37PLUS',
  'ALIBABAQWEN37',
  'ALIBABAQWEN37MAX',
  'ALIBABAQWEN37PLUS',
  'ALIBABACLOUDQWEN37',
  'DASHSCOPEQWEN37',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeAliasToken(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function isGemini31ProAlias(value) {
  const normalized = normalizeString(value).toLowerCase();
  return GEMINI_31_PRO_ALIASES.has(normalized) ||
    GEMINI_31_PRO_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

function isQwen37Alias(value) {
  const normalized = normalizeString(value).toLowerCase();
  return QWEN_37_ALIASES.has(normalized) ||
    QWEN_37_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

export function normalizeInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();

  if (!normalized) {
    return DEFAULT_INFERENCE_MODEL;
  }

  if (normalized === DEFAULT_INFERENCE_MODEL || normalized.startsWith(`${DEFAULT_INFERENCE_MODEL}-`)) {
    return DEFAULT_INFERENCE_MODEL;
  }

  if (isGemini31ProAlias(value)) {
    return GEMINI_31_PRO_INFERENCE_MODEL;
  }

  if (isQwen37Alias(value)) {
    return QWEN_37_INFERENCE_MODEL;
  }

  return DEFAULT_INFERENCE_MODEL;
}

export function isOpenAIInferenceModel(value) {
  return CONFIGURED_OPENAI_INFERENCE_MODELS.has(normalizeString(value).toLowerCase());
}

export function normalizeOpenAIInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return isOpenAIInferenceModel(normalized)
    ? normalized
    : normalizeInferenceModel(value);
}

export function getReasoningEffortForInferenceModel(value) {
  const model = normalizeOpenAIInferenceModel(value);
  return model === INFERENCE_MODELS.PublicationMetadata
    ? INFERENCE_REASONING_EFFORTS.PublicationMetadata
    : INFERENCE_REASONING_EFFORTS.Inference;
}

export function getDefaultUserInferenceModel() {
  return normalizeInferenceModel(
    process.env.USER_INFERENCE_MODEL ||
    process.env.DEFAULT_USER_INFERENCE_MODEL
  );
}

export function isGeminiInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('gemini-') || isGemini31ProAlias(value);
}

export function isQwenInferenceModel(value) {
  return isQwen37Alias(value);
}

export function normalizeGeminiProviderModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  return isGemini31ProAlias(value) ? DEFAULT_GEMINI_31_PRO_VERTEX_MODEL : normalized;
}

export function getProviderModelForInferenceModel(value, { vision = false } = {}) {
  if (isQwenInferenceModel(value)) {
    return vision ? QWEN_37_PLUS_MODEL : QWEN_37_MAX_MODEL;
  }

  if (isGeminiInferenceModel(value)) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized.startsWith('gemini-') && !GEMINI_31_PRO_ALIASES.has(normalized)) {
      return normalized;
    }

    return INFERENCE_PROVIDER_MODEL_KEYS[GEMINI_31_PRO_INFERENCE_MODEL];
  }

  return INFERENCE_PROVIDER_MODEL_KEYS[DEFAULT_INFERENCE_MODEL];
}
