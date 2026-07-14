import { getLanguageStringFromLanguageCode } from '../../consts/LanguageCodes.js';
import {
  SUPPORTED_LANGUAGES,
  normalizeDetectedLanguageCode,
  normalizeSupportedLanguage,
} from '../../consts/SupportedLanguages.js';

const AUTO_LANGUAGE = 'auto';

function buildInvalidSubtitleLanguageError() {
  const supportedCodes = SUPPORTED_LANGUAGES.map((code) => code.toUpperCase()).join(', ');
  const error = new Error(`subtitle_language must be one of: ${supportedCodes}.`);
  error.status = 400;
  return error;
}

export function resolveSpeechLanguageCode(language = 'auto') {
  if (typeof language !== 'string') {
    return AUTO_LANGUAGE;
  }

  const normalized = language.trim();
  if (!normalized || normalized.toLowerCase() === 'auto') {
    return AUTO_LANGUAGE;
  }

  return normalizeSupportedLanguage(normalized) || AUTO_LANGUAGE;
}

export function normalizeDetectedSpeechLanguage(language) {
  return normalizeDetectedLanguageCode(language);
}

export function resolveSubtitleLanguageOption(
  payload = {},
  speechLanguage = 'auto',
  { allowPropagatedSameAsAudio = false } = {},
) {
  const speechLanguageCode = resolveSpeechLanguageCode(speechLanguage);
  const rawSubtitleLanguage = payload?.subtitle_language ?? payload?.subtitleLanguage;
  const propagatedExplicitFlag = payload?.subtitle_language_explicit ?? payload?.subtitleLanguageExplicit;

  let subtitleLanguage = speechLanguageCode;
  let subtitleLanguageExplicit = false;
  if (rawSubtitleLanguage !== undefined && rawSubtitleLanguage !== null) {
    if (typeof rawSubtitleLanguage !== 'string') {
      throw buildInvalidSubtitleLanguageError();
    }

    const trimmed = rawSubtitleLanguage.trim();
    if (trimmed) {
      const isPropagatedSameAsAudioValue =
        allowPropagatedSameAsAudio &&
        propagatedExplicitFlag === false && trimmed.toLowerCase() === speechLanguageCode;
      if (!isPropagatedSameAsAudioValue) {
        subtitleLanguage = normalizeSupportedLanguage(trimmed);
        if (!subtitleLanguage) {
          throw buildInvalidSubtitleLanguageError();
        }
        subtitleLanguageExplicit = true;
      }
    }
  }

  if (propagatedExplicitFlag === true && subtitleLanguage !== AUTO_LANGUAGE) {
    subtitleLanguageExplicit = true;
  }

  return {
    speechLanguageCode,
    subtitleLanguage,
    subtitleLanguageString: subtitleLanguage === AUTO_LANGUAGE
      ? null
      : getLanguageStringFromLanguageCode(subtitleLanguage) || subtitleLanguage,
    subtitleLanguageExplicit,
    translationRequired:
      speechLanguageCode !== AUTO_LANGUAGE && subtitleLanguage !== speechLanguageCode,
    translationDecisionPending:
      speechLanguageCode === AUTO_LANGUAGE && subtitleLanguageExplicit,
  };
}

export async function buildSpeechSubtitleTextMap(sounds = [], {
  subtitlesEnabled = true,
  speechLanguageCode = AUTO_LANGUAGE,
  subtitleLanguage = AUTO_LANGUAGE,
  subtitleLanguageString,
  subtitleLanguageExplicit = false,
  inferenceModel,
  translateSpeech,
} = {}) {
  const subtitleTextBySound = new Map();
  const soundList = Array.isArray(sounds) ? sounds : [];
  const normalizedSpeechLanguage = resolveSpeechLanguageCode(speechLanguageCode);
  const shouldResolveAutoSpeech = subtitlesEnabled && normalizedSpeechLanguage === AUTO_LANGUAGE;
  const knownTranslationRequired =
    subtitlesEnabled &&
    normalizedSpeechLanguage !== AUTO_LANGUAGE &&
    subtitleLanguage !== normalizedSpeechLanguage;

  if ((shouldResolveAutoSpeech || knownTranslationRequired) && typeof translateSpeech !== 'function') {
    throw new Error('translateSpeech is required to resolve speech subtitles.');
  }

  for (const sound of soundList) {
    if (!sound || String(sound.type || '').trim().toLowerCase() !== 'speech') {
      continue;
    }

    const speechText = typeof sound.audio === 'string' ? sound.audio : '';
    let subtitleText = speechText;
    let speechLanguage = normalizedSpeechLanguage;
    let layerSubtitleLanguage = subtitleLanguageExplicit
      ? subtitleLanguage
      : normalizedSpeechLanguage;
    let translationRequired = knownTranslationRequired;

    if (shouldResolveAutoSpeech && speechText.trim()) {
      const resolution = await translateSpeech(
        speechText,
        subtitleLanguageExplicit ? subtitleLanguageString : null,
        inferenceModel,
        {
          detectSourceLanguage: true,
          returnMetadata: true,
          targetLanguageCode: subtitleLanguageExplicit ? subtitleLanguage : null,
        },
      );
      speechLanguage = normalizeDetectedSpeechLanguage(resolution?.sourceLanguage);
      if (!speechLanguage) {
        throw new Error('Speech language detection returned an invalid language code.');
      }
      layerSubtitleLanguage = subtitleLanguageExplicit ? subtitleLanguage : speechLanguage;
      translationRequired =
        subtitleLanguageExplicit && speechLanguage !== layerSubtitleLanguage;
      subtitleText = translationRequired ? resolution?.text : speechText;
    } else if (knownTranslationRequired && speechText.trim()) {
      subtitleText = await translateSpeech(
        speechText,
        subtitleLanguageString,
        inferenceModel,
        { targetLanguageCode: subtitleLanguage },
      );
    }

    if (typeof subtitleText !== 'string' || (speechText.trim() && !subtitleText.trim())) {
      throw new Error('Speech subtitle translation returned empty text.');
    }
    subtitleTextBySound.set(sound, {
      subtitleText: translationRequired ? subtitleText.trim() : speechText,
      subtitleLanguage: layerSubtitleLanguage,
      speechLanguage,
      subtitleTranslationRequired: translationRequired,
    });
  }

  return subtitleTextBySound;
}

export function buildSpeechSubtitleLayerFields(metadata = {}, subtitlesEnabled = true) {
  const subtitleTranslationRequired =
    subtitlesEnabled && metadata.subtitleTranslationRequired === true;

  return {
    subtitleText: typeof metadata.subtitleText === 'string' ? metadata.subtitleText : '',
    subtitleLanguage: metadata.subtitleLanguage || null,
    speechLanguage: metadata.speechLanguage || null,
    subtitleTranslationRequired,
    addTranscriptionsRequired: subtitlesEnabled && !subtitleTranslationRequired,
    subtitleWordAnimation: subtitleTranslationRequired ? 'none' : 'highlight',
  };
}
