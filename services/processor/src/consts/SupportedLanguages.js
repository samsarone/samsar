export const SUPPORTED_LANGUAGES = [
  'en', 'es', 'fr', 'ja', 'th', 'zh', 'bn', 'hi', 'sa', 'la'
];

const LANGUAGE_CODE_ALIASES = {
  jp: 'ja',
  cn: 'zh',
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
