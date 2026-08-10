export const GPT_56_SOL_INFERENCE_MODEL = 'gpt-5.6-sol';
export const GPT_56_SOL_XHIGH_INFERENCE_MODEL = 'gpt-5.6-sol-xhigh';
export const DEFAULT_INFERENCE_MODEL = GPT_56_SOL_INFERENCE_MODEL;
export const GPT_56_SOL_REASONING_EFFORT = 'high';
export const GPT_56_SOL_XHIGH_REASONING_EFFORT = 'xhigh';
export const GEMINI_31_PRO_INFERENCE_MODEL = 'gemini-3.1-pro';
export const DEFAULT_GEMINI_31_PRO_VERTEX_MODEL = 'gemini-3.1-pro-preview';
export const QWEN_38_INFERENCE_MODEL = 'QWEN3.8';
export const DEFAULT_QWEN_38_MAX_MODEL = 'qwen3.8-max';
export const KIMI_K3_INFERENCE_MODEL = 'kimi-k3';
export const KIMIK3 = 'KIMIK3';

const GEMINI_ALIASES = new Set([
  GEMINI_31_PRO_INFERENCE_MODEL,
  'gemini-3.1-pro-preview',
  'gemini-3-pro',
  'gemini-3-pro-preview',
]);

const QWEN_38_ALIASES = new Set([
  QWEN_38_INFERENCE_MODEL.toLowerCase(),
  DEFAULT_QWEN_38_MAX_MODEL,
  'qwen-3.8',
  'qwen-3.8-max',
  'qwen/qwen3.8-max',
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
  KIMIK3,
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

function isQwen38Alias(value) {
  const normalized = normalizeString(value).toLowerCase();
  return QWEN_38_ALIASES.has(normalized) || QWEN_38_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

export function isKimiInferenceModel(value) {
  return KIMI_K3_ALIASES.has(normalizeString(value).toLowerCase()) ||
    KIMI_K3_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

export function normalizeInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return DEFAULT_INFERENCE_MODEL;
  }
  if (normalized === DEFAULT_INFERENCE_MODEL || normalized.startsWith(`${DEFAULT_INFERENCE_MODEL}-`)) {
    const token = normalizeAliasToken(value);
    return token.includes('XHIGH') || token.includes('EXTRAHIGH')
      ? GPT_56_SOL_XHIGH_INFERENCE_MODEL
      : DEFAULT_INFERENCE_MODEL;
  }
  if (GEMINI_ALIASES.has(normalized)) {
    return GEMINI_31_PRO_INFERENCE_MODEL;
  }
  if (isQwen38Alias(value)) {
    return QWEN_38_INFERENCE_MODEL;
  }
  if (isKimiInferenceModel(value)) {
    return KIMI_K3_INFERENCE_MODEL;
  }
  return DEFAULT_INFERENCE_MODEL;
}

export function getGPT56SolReasoningEffort(model, requestedEffort = null) {
  const normalizedEffort = normalizeString(requestedEffort).toLowerCase();
  if (normalizedEffort === 'high' || normalizedEffort === 'xhigh') {
    return normalizedEffort;
  }
  return normalizeInferenceModel(model) === GPT_56_SOL_XHIGH_INFERENCE_MODEL
    ? GPT_56_SOL_XHIGH_REASONING_EFFORT
    : GPT_56_SOL_REASONING_EFFORT;
}

export function isGeminiInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('gemini-') || normalizeInferenceModel(normalized) === GEMINI_31_PRO_INFERENCE_MODEL;
}

export function isQwenInferenceModel(value) {
  return isQwen38Alias(value);
}

export function normalizeGeminiProviderModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  return GEMINI_ALIASES.has(normalized) ? DEFAULT_GEMINI_31_PRO_VERTEX_MODEL : normalized;
}

export function getProviderModelForInferenceModel(value) {
  if (isGeminiInferenceModel(value)) {
    return (
      normalizeGeminiProviderModel(process.env.GOOGLE_GEMINI_31_PRO_MODEL) ||
      normalizeGeminiProviderModel(process.env.GOOGLE_GEMINI_PRO_MODEL) ||
      DEFAULT_GEMINI_31_PRO_VERTEX_MODEL
    );
  }
  if (isQwenInferenceModel(value)) {
    return DEFAULT_QWEN_38_MAX_MODEL;
  }
  if (isKimiInferenceModel(value)) {
    return KIMI_K3_INFERENCE_MODEL;
  }
  if (normalizeInferenceModel(value) === GPT_56_SOL_XHIGH_INFERENCE_MODEL) {
    return GPT_56_SOL_INFERENCE_MODEL;
  }
  return DEFAULT_INFERENCE_MODEL;
}

export function getDefaultUserInferenceModel() {
  return normalizeInferenceModel(
    process.env.USER_INFERENCE_MODEL ||
    process.env.DEFAULT_USER_INFERENCE_MODEL ||
    DEFAULT_INFERENCE_MODEL
  );
}

export function isGPT56SolInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === GPT_56_SOL_INFERENCE_MODEL ||
    normalized === 'gpt-5.6' ||
    normalized.startsWith(`${GPT_56_SOL_INFERENCE_MODEL}-`);
}
