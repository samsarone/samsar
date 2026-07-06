import { TTS_PROVIDER_OPENAI } from '../../consts/TTSSpeakers.js';

export const OPENAI_TTS_LANGUAGE_CODES = new Set(['sa', 'la']);

const LANGUAGE_NAME_ALIASES = {
  sanskrit: 'sa',
  latin: 'la',
};
const CUSTOM_ADAPTER_OPERATION_KEYS = [
  'text_to_video',
  'image_to_video',
  'text_to_image',
  'text_to_music',
  'text_to_sound_effect',
];

export function normalizeTTSLanguageCode(language = '') {
  if (typeof language !== 'string') {
    return '';
  }

  const normalized = language.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) {
    return '';
  }

  const canonical = normalized.split('-')[0];
  return LANGUAGE_NAME_ALIASES[canonical] || canonical;
}

export function isOpenAITTSForcedLanguage(language = '') {
  return OPENAI_TTS_LANGUAGE_CODES.has(normalizeTTSLanguageCode(language));
}

export function resolveTTSProviderForLanguage(language, provider) {
  if (isOpenAITTSForcedLanguage(language)) {
    return TTS_PROVIDER_OPENAI;
  }

  return provider;
}

export function resolveCustomAdaptersForTTSLanguagePolicy(customAdapters, language) {
  if (!isOpenAITTSForcedLanguage(language)) {
    return customAdapters;
  }

  if (!customAdapters || typeof customAdapters !== 'object' || Array.isArray(customAdapters)) {
    return customAdapters;
  }

  if (!Object.prototype.hasOwnProperty.call(customAdapters, 'text_to_speech')) {
    return customAdapters;
  }

  const { text_to_speech, ...remainingAdapters } = customAdapters;
  const hasRemainingOperation = CUSTOM_ADAPTER_OPERATION_KEYS.some((key) => (
    typeof remainingAdapters[key] === 'string' && remainingAdapters[key].trim()
  ));

  return hasRemainingOperation ? remainingAdapters : null;
}
