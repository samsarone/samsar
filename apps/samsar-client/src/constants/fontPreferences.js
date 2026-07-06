import { SUPPORTED_LANGUAGES } from './supportedLanguages.js';

const LATIN_FONTS = ['Rampart One', 'Montserrat', 'Arial', 'sans-serif'];
const EN_FR_FONTS = ['Poppins', 'Montserrat', 'Arial', 'sans-serif'];
const CYRILLIC_FONTS = ['Arial', 'sans-serif'];
const JP_FONTS = ['Noto Sans JP', 'M PLUS Rounded 1c', 'Hiragino Sans', 'Yu Gothic UI', 'sans-serif'];
const KR_FONTS = ['Noto Sans KR', 'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'sans-serif'];
const ZH_SC_FONTS = ['Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'];
const ZH_TC_FONTS = ['Noto Sans TC', 'Source Han Sans TC', 'PingFang TC', 'Microsoft JhengHei', 'sans-serif'];
const TH_FONTS = ['Sarabun', 'Tahoma', 'Leelawadee UI', 'sans-serif'];
const AR_FONTS = ['Noto Sans Arabic', 'Cairo', 'Geeza Pro', 'Segoe UI', 'sans-serif'];
const HI_FONTS = [
  'Noto Sans Devanagari',
  'Mukta',
  'Hind',
  'Noto Serif Devanagari',
  'Kohinoor Devanagari',
  'sans-serif',
];
const BN_FONTS = [
  'Noto Sans Bengali',
  'Hind Siliguri',
  'Noto Serif Bengali',
  'sans-serif',
];
const SA_FONTS = HI_FONTS;
const HE_FONTS = ['Noto Sans Hebrew', 'Rubik', 'Arial Hebrew', 'sans-serif'];

const LANGUAGE_FONT_ALIASES = {
  jp: 'ja',
  cn: 'zh',
  'zh-hans': 'zh',
  'zh-hant': 'zh-tw',
};

const LANGUAGE_FONT_OPTIONS = {
  default: LATIN_FONTS,
  en: EN_FR_FONTS,
  fr: EN_FR_FONTS,
  es: LATIN_FONTS,
  de: LATIN_FONTS,
  pt: LATIN_FONTS,
  it: LATIN_FONTS,
  nl: LATIN_FONTS,
  sv: LATIN_FONTS,
  ru: CYRILLIC_FONTS,
  ja: JP_FONTS,
  ko: KR_FONTS,
  th: TH_FONTS,
  ar: AR_FONTS,
  bn: BN_FONTS,
  hi: HI_FONTS,
  he: HE_FONTS,
  la: LATIN_FONTS,
  sa: SA_FONTS,
  zh: ZH_SC_FONTS,
  'zh-cn': ZH_SC_FONTS,
  'zh-tw': ZH_TC_FONTS,
};

const normalizeLanguageCode = (languageCode = '') => {
  if (typeof languageCode !== 'string') return '';
  const normalized = languageCode.trim().toLowerCase();
  if (!normalized) return '';
  const base = normalized.split('-')[0];
  return LANGUAGE_FONT_ALIASES[normalized] || LANGUAGE_FONT_ALIASES[base] || normalized;
};

export const getFontOptionsForLanguage = (languageCode = '') => {
  const normalized = normalizeLanguageCode(languageCode);
  const base = normalized.split('-')[0];
  return (
    LANGUAGE_FONT_OPTIONS[normalized] ||
    LANGUAGE_FONT_OPTIONS[base] ||
    LANGUAGE_FONT_OPTIONS.default
  );
};

const buildDefaultFontPreferences = () => {
  const defaults = {};
  SUPPORTED_LANGUAGES.forEach((language) => {
    const options = getFontOptionsForLanguage(language.code);
    const defaultFont = options[0] || LATIN_FONTS[0];
    defaults[language.code] = {
      expressGenerationTextFont: defaultFont,
      expressGenerationSpeakerFont: defaultFont,
    };
  });
  return defaults;
};

export const mergeFontPreferencesWithDefaults = (fontPreferences = {}) => {
  const defaults = buildDefaultFontPreferences();
  const merged = { ...defaults };

  if (!fontPreferences || typeof fontPreferences !== 'object') {
    return merged;
  }

  Object.entries(fontPreferences).forEach(([languageCode, prefs]) => {
    if (!prefs || typeof prefs !== 'object') return;
    const normalized = normalizeLanguageCode(languageCode);
    if (!normalized) return;

    const textFont =
      typeof prefs.expressGenerationTextFont === 'string' ? prefs.expressGenerationTextFont.trim() : '';
    const speakerFont =
      typeof prefs.expressGenerationSpeakerFont === 'string' ? prefs.expressGenerationSpeakerFont.trim() : '';

    merged[normalized] = {
      ...(merged[normalized] || {}),
      ...(textFont ? { expressGenerationTextFont: textFont } : {}),
      ...(speakerFont ? { expressGenerationSpeakerFont: speakerFont } : {}),
    };
  });

  return merged;
};
