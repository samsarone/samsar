export const GPT_56_SOL_INFERENCE_MODEL = 'gpt-5.6-sol';
export const DEFAULT_INFERENCE_MODEL = GPT_56_SOL_INFERENCE_MODEL;
export const GPT_56_SOL_REASONING_EFFORT = 'high';
export const GEMINI_31_PRO_INFERENCE_MODEL = 'gemini-3.1-pro';
export const DEFAULT_GEMINI_31_PRO_VERTEX_MODEL = 'gemini-3.1-pro-preview';
export const QWEN_37_INFERENCE_MODEL = 'QWEN3.7';
export const QWEN_38_MAX_PREVIEW_MODEL = 'qwen3.8-max-preview';
export const QWEN_37_MAX_MODEL = 'qwen3.7-max';
export const QWEN_37_PLUS_MODEL = 'qwen3.7-plus';
export const ALIBABA_QWEN_TEXT_MODEL_ENV = 'ALIBABA_QWEN_TEXT_MODEL';

const GEMINI_ALIASES = new Set([
  GEMINI_31_PRO_INFERENCE_MODEL,
  'gemini-3.1-pro-preview',
  'gemini-3-pro',
  'gemini-3-pro-preview',
]);
const QWEN_ALIASES = new Set([
  QWEN_37_INFERENCE_MODEL.toLowerCase(),
  QWEN_37_MAX_MODEL,
  QWEN_37_PLUS_MODEL,
  QWEN_38_MAX_PREVIEW_MODEL,
  'qwen3.7',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen-3.7',
  'qwen-3.7-max',
  'qwen-3.7-plus',
]);
const QWEN_ALIAS_TOKENS = new Set([
  'QWEN37',
  'QWEN37MAX',
  'QWEN37PLUS',
  'ALIBABAQWEN37',
  'ALIBABACLOUDQWEN37',
  'DASHSCOPEQWEN37',
  'QWEN38',
  'QWEN38MAX',
  'QWEN38MAXPREVIEW',
  'ALIBABAQWEN38',
  'ALIBABAQWEN38MAXPREVIEW',
  'ALIBABACLOUDQWEN38',
  'ALIBABACLOUDQWEN38MAXPREVIEW',
  'DASHSCOPEQWEN38',
  'DASHSCOPEQWEN38MAXPREVIEW',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeAliasToken(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function isQwenInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return QWEN_ALIASES.has(normalized) || QWEN_ALIAS_TOKENS.has(normalizeAliasToken(value));
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
    return QWEN_37_INFERENCE_MODEL;
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

export function getProviderModelForInferenceModel(value, { vision = false, env = process.env } = {}) {
  if (isQwenInferenceModel(value)) {
    return vision
      ? QWEN_37_PLUS_MODEL
      : normalizeString(env?.[ALIBABA_QWEN_TEXT_MODEL_ENV]) || QWEN_37_MAX_MODEL;
  }
  if (isGeminiInferenceModel(value)) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized.startsWith('gemini-') && !GEMINI_ALIASES.has(normalized)) {
      return normalized;
    }

    return DEFAULT_GEMINI_31_PRO_VERTEX_MODEL;
  }

  return DEFAULT_INFERENCE_MODEL;
}
