export const SUPPORTED_LANGUAGES = [
  { code: "en", name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: "th", name: 'Thai', nativeName: 'ไทย', dir: 'ltr' },
  { code: "ja", name: 'Japanese', nativeName: '日本語', dir: 'ltr' },
];

const LANGUAGE_NAME_TO_CODE = SUPPORTED_LANGUAGES.reduce((acc, lang) => {
  if (lang.name) {
    acc[lang.name.toLowerCase()] = lang.code;
  }
  if (lang.nativeName) {
    acc[lang.nativeName.toLowerCase()] = lang.code;
  }
  return acc;
}, {});

const LANGUAGE_CODE_ALIASES = {
  jp: 'ja',
  eng: 'en',
  tha: 'th',
  jpn: 'ja',
};

export const resolveLanguageCode = (languageValue, fallback = 'auto') => {
  if (typeof languageValue !== 'string') {
    return fallback;
  }
  const normalized = languageValue.trim();
  if (!normalized) {
    return fallback;
  }
  const lowered = normalized.toLowerCase();
  if (lowered === 'auto') {
    return 'auto';
  }
  const normalizedCode = lowered.replace(/_/g, '-');
  const baseCode = normalizedCode.split('-')[0];
  const aliasedCode = LANGUAGE_CODE_ALIASES[baseCode] || baseCode;

  const direct = SUPPORTED_LANGUAGES.find((lang) => lang.code === aliasedCode);
  if (direct) {
    return direct.code;
  }
  return LANGUAGE_NAME_TO_CODE[lowered] || LANGUAGE_NAME_TO_CODE[aliasedCode] || fallback;
};
