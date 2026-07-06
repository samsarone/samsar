export const LANGUAGE_CODE_TO_NAME = {
  AF: 'Afrikaans',
  AR: 'Arabic',
  BG: 'Bulgarian',
  BN: 'Bengali',
  CS: 'Czech',
  DA: 'Danish',
  DE: 'German',
  EL: 'Greek',
  EN: 'English',
  ES: 'Spanish',
  ET: 'Estonian',
  FA: 'Persian',
  FI: 'Finnish',
  FR: 'French',
  HE: 'Hebrew',
  HI: 'Hindi',
  HR: 'Croatian',
  HU: 'Hungarian',
  ID: 'Indonesian',
  IT: 'Italian',
  JA: 'Japanese',
  JP: 'Japanese',
  KO: 'Korean',
  KR: 'Korean',
  LA: 'Latin',
  LT: 'Lithuanian',
  LV: 'Latvian',
  MS: 'Malay',
  NL: 'Dutch',
  NO: 'Norwegian',
  PL: 'Polish',
  PT: 'Portuguese',
  RO: 'Romanian',
  RU: 'Russian',
  SA: 'Sanskrit',
  SK: 'Slovak',
  SL: 'Slovenian',
  SV: 'Swedish',
  SW: 'Swahili',
  TA: 'Tamil',
  TH: 'Thai',
  TR: 'Turkish',
  UK: 'Ukrainian',
  VI: 'Vietnamese',
  ZH: 'Chinese',
  CN: 'Chinese',
  'ZH-CN': 'Chinese (Simplified)',
  'ZH-TW': 'Chinese (Traditional)',
  'EN-GB': 'English',
  'EN-US': 'English',
  'PT-BR': 'Portuguese (Brazilian)',
  'PT-PT': 'Portuguese (Portugal)',
  'ES-MX': 'Spanish (Mexico)',
};

export function getLanguageStringFromLanguageCode(languageCode) {
  if (typeof languageCode !== 'string') {
    return null;
  }

  const trimmed = languageCode.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase() === 'auto') {
    return null;
  }

  const normalizedCode = trimmed.replace('_', '-').toUpperCase();

  if (LANGUAGE_CODE_TO_NAME[normalizedCode]) {
    return LANGUAGE_CODE_TO_NAME[normalizedCode];
  }

  const baseCode = normalizedCode.split('-')[0];
  if (baseCode && LANGUAGE_CODE_TO_NAME[baseCode]) {
    return LANGUAGE_CODE_TO_NAME[baseCode];
  }

  if (trimmed.length > 3 || trimmed.includes(' ')) {
    return trimmed;
  }

  return null;
}
