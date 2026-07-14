export const SUPPORTED_LANGUAGES = [
  'en', 'es', 'fr', 'ja', 'th', 'zh', 'bn', 'hi', 'sa', 'la'
];

const LANGUAGE_CODE_ALIASES = {
  jp: 'ja',
  cn: 'zh',
};

const DETECTED_LANGUAGE_CODE_ALIASES = {
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  fre: 'fr',
  jpn: 'ja',
  tha: 'th',
  zho: 'zh',
  chi: 'zh',
  cmn: 'zh',
  ben: 'bn',
  hin: 'hi',
  san: 'sa',
  lat: 'la',
};

export function normalizeSupportedLanguage(code = '') {
  if (!code || typeof code !== 'string') return null;

  const trimmed = code.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase().replace(/_/g, '-');
  const canonical = normalized.split('-')[0];
  const resolved = LANGUAGE_CODE_ALIASES[canonical] || canonical;

  return SUPPORTED_LANGUAGES.includes(resolved) ? resolved : null;
}

export function isSupportedLanguage(code = '') {
  if (!code) return false;
  const normalized = code.toLowerCase();
  return SUPPORTED_LANGUAGES.includes(normalized);
}

export function normalizeDetectedLanguageCode(code = '') {
  if (typeof code !== 'string') return null;

  const normalized = code.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === 'auto') return null;

  const baseCode = normalized.split('-')[0];
  const aliasedCode = DETECTED_LANGUAGE_CODE_ALIASES[baseCode] || baseCode;
  const supportedLanguage = normalizeSupportedLanguage(aliasedCode);
  if (supportedLanguage) return supportedLanguage;

  return /^[a-z]{2,3}$/.test(aliasedCode) ? aliasedCode : null;
}
