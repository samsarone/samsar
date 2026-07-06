export const INFERENCE_MODEL_KEYS = Object.freeze({
  GPT_55: 'gpt-5.5',
  GEMINI_31_PRO: 'gemini-3.1-pro',
});

export const INFERENCE_PROVIDER_MODEL_KEYS = Object.freeze({
  [INFERENCE_MODEL_KEYS.GPT_55]: 'gpt-5.5',
  [INFERENCE_MODEL_KEYS.GEMINI_31_PRO]: 'gemini-3.1-pro-preview',
});

export const DEFAULT_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.GPT_55;
export const GEMINI_31_PRO_INFERENCE_MODEL = INFERENCE_MODEL_KEYS.GEMINI_31_PRO;
export const DEFAULT_GEMINI_31_PRO_VERTEX_MODEL =
  INFERENCE_PROVIDER_MODEL_KEYS[GEMINI_31_PRO_INFERENCE_MODEL];

export const SUPPORTED_INFERENCE_MODEL_VALUES = Object.freeze([
  DEFAULT_INFERENCE_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
]);

const GEMINI_31_PRO_ALIASES = new Set([
  GEMINI_31_PRO_INFERENCE_MODEL,
  'gemini-3.1-pro-preview',
  'gemini-3.1-pro',
  'gemini-3-pro',
  'gemini-3-pro-preview',
]);

const GEMINI_31_PRO_ALIAS_TOKENS = new Set([
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
  return GEMINI_31_PRO_ALIASES.has(normalized) ||
    GEMINI_31_PRO_ALIAS_TOKENS.has(normalizeAliasToken(value));
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

  return DEFAULT_INFERENCE_MODEL;
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

export function normalizeGeminiProviderModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  return isGemini31ProAlias(value) ? DEFAULT_GEMINI_31_PRO_VERTEX_MODEL : normalized;
}

export function getProviderModelForInferenceModel(value) {
  if (isGeminiInferenceModel(value)) {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized.startsWith('gemini-') && !GEMINI_31_PRO_ALIASES.has(normalized)) {
      return normalized;
    }

    return INFERENCE_PROVIDER_MODEL_KEYS[GEMINI_31_PRO_INFERENCE_MODEL];
  }

  return INFERENCE_PROVIDER_MODEL_KEYS[DEFAULT_INFERENCE_MODEL];
}
