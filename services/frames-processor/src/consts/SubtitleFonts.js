export const DEFAULT_LATIN_SUBTITLE_FONT = 'Rampart One';
const LATIN_FONTS = [DEFAULT_LATIN_SUBTITLE_FONT, 'Montserrat', 'Arial', 'sans-serif'];
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
  jpn: 'ja',
  cn: 'zh-cn',
  kr: 'ko',
  kor: 'ko',
  'zh-hans': 'zh-cn',
  'zh-hant': 'zh-tw',
  'pt-br': 'pt',
  'pt-pt': 'pt',
  'es-mx': 'es',
  eng: 'en',
  fre: 'fr',
  fra: 'fr',
  deu: 'de',
  ger: 'de',
  rus: 'ru',
  ita: 'it',
  por: 'pt',
  spa: 'es',
  zho: 'zh',
  chi: 'zh',
  ara: 'ar',
  ben: 'bn',
  hin: 'hi',
  heb: 'he',
  lat: 'la',
  san: 'sa',
  tha: 'th',
};

export const LANGUAGE_SUBTITLE_FONT_MAP = {
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

export function getSubtitleFontsForLanguage(languageCode) {
  if (!languageCode || typeof languageCode !== 'string') {
    return LANGUAGE_SUBTITLE_FONT_MAP.default;
  }

  const normalized = languageCode.trim().toLowerCase();
  const base = normalized.split('-')[0];

  const lookupOrder = [
    normalized,
    LANGUAGE_FONT_ALIASES[normalized],
    base,
    LANGUAGE_FONT_ALIASES[base],
  ].filter(Boolean);

  for (const key of lookupOrder) {
    const fonts = LANGUAGE_SUBTITLE_FONT_MAP[key];
    if (fonts) {
      return fonts;
    }
  }

  return LANGUAGE_SUBTITLE_FONT_MAP.default;
}

export function resolveSubtitleFont(languageCode, requestedFont) {
  const fontsForLang = getSubtitleFontsForLanguage(languageCode);
  const defaultFont = fontsForLang[0] || LANGUAGE_SUBTITLE_FONT_MAP.default[0];

  if (requestedFont && typeof requestedFont === 'string') {
    const trimmed = requestedFont.trim();
    if (trimmed.length === 0) {
      return defaultFont;
    }

    const lowerRequested = trimmed.toLowerCase();
    const lowerFonts = fontsForLang.map((font) => font.toLowerCase());

    if (lowerFonts.includes(lowerRequested)) {
      return trimmed;
    }

    if (
      lowerRequested === DEFAULT_LATIN_SUBTITLE_FONT.toLowerCase() ||
      lowerRequested === 'montserrat' ||
      lowerRequested === 'poppins' ||
      lowerRequested === 'arial' ||
      lowerRequested === 'inter' ||
      lowerRequested === 'sans-serif'
    ) {
      if (fontsForLang !== LANGUAGE_SUBTITLE_FONT_MAP.default) {
        return defaultFont;
      }
    }

    return trimmed;
  }

  return defaultFont;
}
