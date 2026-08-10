export const INFERENCE_MODELS = Object.freeze({
  Inference: 'gpt-5.6-sol',
  BranchedInferenceExtraHigh: 'gpt-5.6-sol-xhigh',
  PublicationMetadata: 'gpt-5.6-luna',
});

export const INFERENCE_REASONING_EFFORTS = Object.freeze({
  Inference: 'high',
  BranchedInferenceExtraHigh: 'xhigh',
  PublicationMetadata: 'xhigh',
});

export const INFERENCE_REASONING_EFFORT_VALUES = Object.freeze([
  INFERENCE_REASONING_EFFORTS.Inference,
  INFERENCE_REASONING_EFFORTS.BranchedInferenceExtraHigh,
]);

export const INFERENCE_MODEL_KEYS = Object.freeze({
  GPT_56_SOL: INFERENCE_MODELS.Inference,
  GPT_56_SOL_XHIGH: INFERENCE_MODELS.BranchedInferenceExtraHigh,
  GEMINI_31_PRO: 'gemini-3.1-pro',
  QWEN_38: 'QWEN3.8',
  KIMI_K3: 'kimi-k3',
});

export const INFERENCE_PROVIDER_MODEL_KEYS = Object.freeze({
  [INFERENCE_MODEL_KEYS.GPT_56_SOL]: INFERENCE_MODELS.Inference,
  [INFERENCE_MODEL_KEYS.GPT_56_SOL_XHIGH]: INFERENCE_MODELS.Inference,
  [INFERENCE_MODEL_KEYS.GEMINI_31_PRO]: 'gemini-3.1-pro-preview',
  [INFERENCE_MODEL_KEYS.QWEN_38]: 'qwen3.8-max',
  [INFERENCE_MODEL_KEYS.KIMI_K3]: 'kimi-k3',
});

export const DEFAULT_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.GPT_56_SOL;
export const GPT_56_SOL_XHIGH_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.GPT_56_SOL_XHIGH;
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
export const QWEN_38_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.QWEN_38;
export const QWEN_38_MAX_MODEL = INFERENCE_PROVIDER_MODEL_KEYS[QWEN_38_INFERENCE_MODEL];
export const ALIBABA_QWEN_MODEL_ENV = 'ALIBABA_QWEN_MODEL';
export const ALIBABA_QWEN_TEXT_MODEL_ENV = 'ALIBABA_QWEN_TEXT_MODEL';
export const KIMI_K3_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.KIMI_K3;
export const KIMI_K3_PROVIDER_MODEL =
  INFERENCE_PROVIDER_MODEL_KEYS[KIMI_K3_INFERENCE_MODEL];

export const SUPPORTED_INFERENCE_MODEL_VALUES = Object.freeze([
  DEFAULT_INFERENCE_MODEL,
  GPT_56_SOL_XHIGH_INFERENCE_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  QWEN_38_INFERENCE_MODEL,
  KIMI_K3_INFERENCE_MODEL,
]);

export const INFERENCE_MODEL_OPTIONS = Object.freeze([
  Object.freeze({
    label: 'gpt-5.6-sol',
    value: DEFAULT_INFERENCE_MODEL,
    providerModel: INFERENCE_MODELS.Inference,
    availabilityModel: INFERENCE_MODELS.Inference,
    reasoningEffort: INFERENCE_REASONING_EFFORTS.Inference,
    isBranchedInferenceModel: true,
  }),
  Object.freeze({
    label: 'GPT 5.6 Sol Extra High',
    value: GPT_56_SOL_XHIGH_INFERENCE_MODEL,
    providerModel: INFERENCE_MODELS.Inference,
    availabilityModel: INFERENCE_MODELS.Inference,
    reasoningEffort: INFERENCE_REASONING_EFFORTS.BranchedInferenceExtraHigh,
    isBranchedInferenceModel: true,
    exposeInCatalog: false,
  }),
  Object.freeze({
    label: 'Gemini 3.1 Pro',
    value: GEMINI_31_PRO_INFERENCE_MODEL,
    providerModel: DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
    availabilityModel: GEMINI_31_PRO_INFERENCE_MODEL,
    isBranchedInferenceModel: false,
  }),
  Object.freeze({
    label: 'Qwen 3.8 Max',
    value: QWEN_38_INFERENCE_MODEL,
    providerModel: QWEN_38_MAX_MODEL,
    availabilityModel: QWEN_38_INFERENCE_MODEL,
    isBranchedInferenceModel: false,
  }),
  Object.freeze({
    label: 'Kimi K3',
    value: KIMI_K3_INFERENCE_MODEL,
    providerModel: KIMI_K3_PROVIDER_MODEL,
    availabilityModel: KIMI_K3_INFERENCE_MODEL,
    isBranchedInferenceModel: false,
  }),
]);

const CONFIGURED_OPENAI_INFERENCE_MODELS = new Set(Object.values(INFERENCE_MODELS));

const GPT_56_SOL_ALIAS_TOKENS = new Set([
  'GPT56',
  'GPT56SOL',
  'GPT56HIGH',
  'GPT56SOLHIGH',
]);

const GPT_56_SOL_XHIGH_ALIAS_TOKENS = new Set([
  'GPT56XHIGH',
  'GPT56SOLXHIGH',
  'GPT56EXTRAHIGH',
  'GPT56SOLEXTRAHIGH',
]);

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

const QWEN_38_ALIASES = new Set([
  QWEN_38_INFERENCE_MODEL.toLowerCase(),
  QWEN_38_MAX_MODEL,
  `qwen/${QWEN_38_MAX_MODEL}`,
]);

const QWEN_38_ALIAS_TOKENS = new Set([
  'QWEN38',
  'QWEN38MAX',
  'ALIBABAQWEN38',
  'ALIBABAQWEN38MAX',
  'ALIBABACLOUDQWEN38',
  'ALIBABACLOUDQWEN38MAX',
  'DASHSCOPEQWEN38',
  'DASHSCOPEQWEN38MAX',
]);

const KIMI_K3_ALIASES = new Set([
  KIMI_K3_INFERENCE_MODEL,
  'kimi-k3-latest',
]);

const KIMI_K3_ALIAS_TOKENS = new Set([
  'KIMIK3',
  'KIMI3',
  'MOONSHOTKIMIK3',
  'MOONSHOTK3',
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

function isQwen38Alias(value) {
  const normalized = normalizeString(value).toLowerCase();
  return QWEN_38_ALIASES.has(normalized) ||
    QWEN_38_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

function isKimiK3Alias(value) {
  const normalized = normalizeString(value).toLowerCase();
  return KIMI_K3_ALIASES.has(normalized) ||
    KIMI_K3_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

export function normalizeSupportedInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (
    normalized === GPT_56_SOL_XHIGH_INFERENCE_MODEL ||
    GPT_56_SOL_XHIGH_ALIAS_TOKENS.has(normalizeAliasToken(value))
  ) {
    return GPT_56_SOL_XHIGH_INFERENCE_MODEL;
  }

  if (
    normalized === DEFAULT_INFERENCE_MODEL ||
    GPT_56_SOL_ALIAS_TOKENS.has(normalizeAliasToken(value))
  ) {
    return DEFAULT_INFERENCE_MODEL;
  }

  if (isGemini31ProAlias(value)) {
    return GEMINI_31_PRO_INFERENCE_MODEL;
  }

  if (isQwen38Alias(value)) {
    return QWEN_38_INFERENCE_MODEL;
  }

  if (isKimiK3Alias(value)) {
    return KIMI_K3_INFERENCE_MODEL;
  }

  return null;
}

export function normalizeInferenceModel(value) {
  const supportedModel = normalizeSupportedInferenceModel(value);
  if (supportedModel) {
    return supportedModel;
  }

  const normalized = normalizeString(value).toLowerCase();
  if (normalized.startsWith(`${DEFAULT_INFERENCE_MODEL}-`)) {
    return DEFAULT_INFERENCE_MODEL;
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

export function normalizeInferenceReasoningEffort(value, fallback = null) {
  const normalized = normalizeString(value).toLowerCase();
  return INFERENCE_REASONING_EFFORT_VALUES.includes(normalized)
    ? normalized
    : fallback;
}

export function getReasoningEffortForInferenceModel(value, requestedEffort = null) {
  const model = normalizeOpenAIInferenceModel(value);
  if (model === INFERENCE_MODELS.PublicationMetadata) {
    return INFERENCE_REASONING_EFFORTS.PublicationMetadata;
  }

  const normalizedRequestedEffort = normalizeInferenceReasoningEffort(requestedEffort);
  if (normalizedRequestedEffort) {
    return normalizedRequestedEffort;
  }

  return model === GPT_56_SOL_XHIGH_INFERENCE_MODEL
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
  return isQwen38Alias(value);
}

export function isKimiInferenceModel(value) {
  return isKimiK3Alias(value);
}

export function normalizeGeminiProviderModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  return isGemini31ProAlias(value) ? DEFAULT_GEMINI_31_PRO_VERTEX_MODEL : normalized;
}

export function getProviderModelForInferenceModel(
  value,
  { env = process.env } = {},
) {
  const openAIModel = normalizeOpenAIInferenceModel(value);
  if (isOpenAIInferenceModel(openAIModel)) {
    return INFERENCE_PROVIDER_MODEL_KEYS[openAIModel] || openAIModel;
  }

  if (isKimiInferenceModel(value)) {
    return KIMI_K3_PROVIDER_MODEL;
  }

  if (isQwenInferenceModel(value)) {
    return normalizeString(env?.[ALIBABA_QWEN_MODEL_ENV]) ||
      normalizeString(env?.[ALIBABA_QWEN_TEXT_MODEL_ENV]) ||
      QWEN_38_MAX_MODEL;
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
