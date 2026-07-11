export const GPT_56_SOL_INFERENCE_MODEL = 'gpt-5.6-sol';
export const DEFAULT_INFERENCE_MODEL = GPT_56_SOL_INFERENCE_MODEL;
export const GPT_56_SOL_REASONING_EFFORT = 'xhigh';
export const GEMINI_31_PRO_INFERENCE_MODEL = 'gemini-3.1-pro';
export const DEFAULT_GEMINI_31_PRO_VERTEX_MODEL = 'gemini-3.1-pro-preview';

const GEMINI_ALIASES = new Set([
  GEMINI_31_PRO_INFERENCE_MODEL,
  'gemini-3.1-pro-preview',
  'gemini-3-pro',
  'gemini-3-pro-preview',
]);

const GEMINI_ALIAS_TOKENS = new Set([
  'GEMINI31PRO',
  'GEMINI31PROPREVIEW',
  'GEMINI3PRO',
  'GEMINI3PROPREVIEW',
  'GOOGLEGEMINI31PRO',
  'GOOGLEGEMINI31PROPREVIEW',
  'GOOGLEGEMINI3PRO',
  'GOOGLEGEMINI3PROPREVIEW',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeAliasToken(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function isGemini31ProAlias(value) {
  const normalized = normalizeString(value).toLowerCase();
  return GEMINI_ALIASES.has(normalized) || GEMINI_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

export function normalizeInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return DEFAULT_INFERENCE_MODEL;
  if (normalized === DEFAULT_INFERENCE_MODEL || normalized.startsWith(`${DEFAULT_INFERENCE_MODEL}-`)) {
    return DEFAULT_INFERENCE_MODEL;
  }
  if (isGemini31ProAlias(value)) {
    return GEMINI_31_PRO_INFERENCE_MODEL;
  }
  return DEFAULT_INFERENCE_MODEL;
}

export function isGeminiInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('gemini-') || isGemini31ProAlias(value);
}

export function normalizeGeminiProviderModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  return isGemini31ProAlias(value) ? DEFAULT_GEMINI_31_PRO_VERTEX_MODEL : normalized;
}

export function getProviderModelForInferenceModel(value) {
  if (isGeminiInferenceModel(value)) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized.startsWith('gemini-') && !GEMINI_ALIASES.has(normalized)) {
      return normalized;
    }

    return (
      normalizeGeminiProviderModel(process.env.GOOGLE_GEMINI_31_PRO_MODEL) ||
      normalizeGeminiProviderModel(process.env.GOOGLE_GEMINI_PRO_MODEL) ||
      DEFAULT_GEMINI_31_PRO_VERTEX_MODEL
    );
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
