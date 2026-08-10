export const GPT_56_SOL_INFERENCE_MODEL = 'gpt-5.6-sol';
export const DEFAULT_INFERENCE_MODEL = GPT_56_SOL_INFERENCE_MODEL;
export const GPT_56_SOL_REASONING_EFFORT = 'high';
export const GPT_56_SOL_XHIGH_REASONING_EFFORT = 'xhigh';
export const GEMINI_31_PRO_INFERENCE_MODEL = 'gemini-3.1-pro';
export const DEFAULT_GEMINI_31_PRO_VERTEX_MODEL = 'gemini-3.1-pro-preview';
export const QWEN_38_INFERENCE_MODEL = 'QWEN3.8';
export const QWEN_38_MAX_MODEL = 'qwen3.8-max';
export const ALIBABA_QWEN_MODEL_ENV = 'ALIBABA_QWEN_MODEL';
export const ALIBABA_QWEN_TEXT_MODEL_ENV = 'ALIBABA_QWEN_TEXT_MODEL';
export const KIMI_K3_INFERENCE_MODEL = 'kimi-k3';
export const KIMI_K3_PROVIDER_MODEL = KIMI_K3_INFERENCE_MODEL;

const GEMINI_ALIASES = new Set([
  GEMINI_31_PRO_INFERENCE_MODEL,
  'gemini-3.1-pro-preview',
  'gemini-3-pro',
  'gemini-3-pro-preview',
]);
const QWEN_ALIASES = new Set([
  QWEN_38_INFERENCE_MODEL.toLowerCase(),
  QWEN_38_MAX_MODEL,
  'qwen-3.8',
  'qwen-3.8-max',
  'qwen/qwen3.8-max',
]);
const QWEN_ALIAS_TOKENS = new Set([
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
  'kimi k3',
  'moonshot k3',
  'moonshot kimi k3',
]);
const KIMI_K3_ALIAS_TOKENS = new Set([
  'KIMIK3',
  'KIMI3',
  'MOONSHOTK3',
  'MOONSHOTKIMIK3',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeAliasToken(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function normalizeGPT56SolReasoningEffort(value, fallback = null) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === GPT_56_SOL_REASONING_EFFORT ||
    normalized === GPT_56_SOL_XHIGH_REASONING_EFFORT
    ? normalized
    : fallback;
}

export function getGPT56SolReasoningEffort(model, requestedEffort = null) {
  return normalizeGPT56SolReasoningEffort(requestedEffort) ||
    (normalizeAliasToken(model).includes('XHIGH') ||
      normalizeAliasToken(model).includes('EXTRAHIGH')
      ? GPT_56_SOL_XHIGH_REASONING_EFFORT
      : GPT_56_SOL_REASONING_EFFORT);
}

export function isQwenInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return QWEN_ALIASES.has(normalized) || QWEN_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

export function isKimiK3InferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return KIMI_K3_ALIASES.has(normalized) ||
    KIMI_K3_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

export function normalizeInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();

  if (!normalized) {
    return DEFAULT_INFERENCE_MODEL;
  }

  if (normalized === DEFAULT_INFERENCE_MODEL || normalized.startsWith(`${DEFAULT_INFERENCE_MODEL}-`)) {
    return DEFAULT_INFERENCE_MODEL;
  }

  if (GEMINI_ALIASES.has(normalized)) {
    return GEMINI_31_PRO_INFERENCE_MODEL;
  }

  if (isQwenInferenceModel(value)) {
    return QWEN_38_INFERENCE_MODEL;
  }

  if (isKimiK3InferenceModel(value)) {
    return KIMI_K3_INFERENCE_MODEL;
  }

  return DEFAULT_INFERENCE_MODEL;
}

export function isGeminiInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('gemini-') || normalizeInferenceModel(normalized) === GEMINI_31_PRO_INFERENCE_MODEL;
}

export function normalizeGeminiProviderModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  return GEMINI_ALIASES.has(normalized) ? DEFAULT_GEMINI_31_PRO_VERTEX_MODEL : normalized;
}

export function getProviderModelForInferenceModel(value, { env = process.env } = {}) {
  if (isQwenInferenceModel(value)) {
    return normalizeString(env?.[ALIBABA_QWEN_MODEL_ENV]) ||
      normalizeString(env?.[ALIBABA_QWEN_TEXT_MODEL_ENV]) ||
      QWEN_38_MAX_MODEL;
  }
  if (isGeminiInferenceModel(value)) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized.startsWith('gemini-') && !GEMINI_ALIASES.has(normalized)) {
      return normalized;
    }

    return DEFAULT_GEMINI_31_PRO_VERTEX_MODEL;
  }
  if (isKimiK3InferenceModel(value)) {
    return KIMI_K3_PROVIDER_MODEL;
  }

  return DEFAULT_INFERENCE_MODEL;
}
