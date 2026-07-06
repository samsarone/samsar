export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', dir: 'ltr' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', dir: 'ltr' },
  { code: 'zh', name: 'Chinese', nativeName: '简体中文', dir: 'ltr' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', dir: 'ltr' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr' },
  { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतम्', dir: 'ltr' },
  { code: 'la', name: 'Latin', nativeName: 'Latina', dir: 'ltr' },
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
  cn: 'zh',
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
