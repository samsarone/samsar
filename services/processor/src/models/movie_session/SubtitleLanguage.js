import { getLanguageStringFromLanguageCode } from '../../consts/LanguageCodes.js';
import {
  SUPPORTED_LANGUAGES,
  normalizeDetectedLanguageCode,
  normalizeSupportedLanguage,
} from '../../consts/SupportedLanguages.js';
import {
  getSubtitleAlignmentMapCoverage,
  normalizeSubtitleAlignmentMap,
} from './SubtitleAlignmentMapping.js';

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

function normalizeTranslatedSubtitleResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      text: typeof result === 'string' ? result : '',
      subtitleAlignmentMap: [],
      subtitleSpeakerCharacterName: null,
    };
  }

  const subtitleSpeakerCharacterName = typeof result.subtitleSpeakerCharacterName === 'string'
    ? result.subtitleSpeakerCharacterName.trim()
    : '';
  return {
    text: typeof result.text === 'string' ? result.text : '',
    subtitleAlignmentMap: normalizeSubtitleAlignmentMap(result.subtitleAlignmentMap),
    subtitleSpeakerCharacterName: subtitleSpeakerCharacterName || null,
  };
}

function isSpeechAudioLayer(audioLayer = {}) {
  return String(audioLayer?.generationType || '').trim().toLowerCase() === 'speech';
}

function hasLocalizedSubtitleSpeakerName(audioLayer = {}) {
  return typeof audioLayer?.subtitleSpeakerCharacterName === 'string' &&
    Boolean(audioLayer.subtitleSpeakerCharacterName.trim());
}

function hasTranslatedSubtitleText(audioLayer = {}) {
  return typeof audioLayer?.subtitleText === 'string' && Boolean(audioLayer.subtitleText.trim());
}

function resolveLayerSpeechLanguage(audioLayer = {}, sessionSpeechLanguage = AUTO_LANGUAGE) {
  return normalizeDetectedSpeechLanguage(
    audioLayer.speechLanguage || audioLayer.languageCode || sessionSpeechLanguage,
  );
}

function resolveLayerSubtitleLanguage(audioLayer = {}, sessionSubtitleLanguage) {
  return normalizeSupportedLanguage(audioLayer.subtitleLanguage) ||
    normalizeSupportedLanguage(sessionSubtitleLanguage);
}

function getTranslatedSubtitleWordAnimation(audioLayer = {}) {
  const currentAnimation = typeof audioLayer.subtitleWordAnimation === 'string'
    ? audioLayer.subtitleWordAnimation.trim()
    : '';
  return currentAnimation && currentAnimation !== 'none' ? currentAnimation : 'highlight';
}

function applyPlannedAudioLayerUpdates(plannedUpdates = []) {
  plannedUpdates.forEach(({ audioLayer, fields }) => {
    Object.entries(fields).forEach(([key, value]) => {
      audioLayer[key] = value;
    });
  });
}

export async function backfillTranslatedSubtitleMetadataForRerun(audioLayers = [], {
  sessionSpeechLanguage = AUTO_LANGUAGE,
  sessionSubtitleLanguage,
  sessionSubtitleLanguageString,
  sessionTranslationRequired = false,
  inferenceModel,
  translateSpeech,
} = {}) {
  const layerList = Array.isArray(audioLayers) ? audioLayers : [];
  const plannedUpdates = [];

  for (const audioLayer of layerList) {
    if (!isSpeechAudioLayer(audioLayer)) {
      continue;
    }

    const subtitleLanguage = resolveLayerSubtitleLanguage(
      audioLayer,
      sessionSubtitleLanguage,
    );
    if (!subtitleLanguage) {
      continue;
    }

    const knownSpeechLanguage = resolveLayerSpeechLanguage(
      audioLayer,
      sessionSpeechLanguage,
    );
    const declaredTranslationRequired =
      audioLayer.subtitleTranslationRequired === true || sessionTranslationRequired === true;
    const knownTranslationRequired = Boolean(
      knownSpeechLanguage && knownSpeechLanguage !== subtitleLanguage,
    );

    if (!declaredTranslationRequired && !knownTranslationRequired) {
      continue;
    }
    if (knownSpeechLanguage && knownSpeechLanguage === subtitleLanguage) {
      continue;
    }

    const speechText = typeof audioLayer.prompt === 'string' ? audioLayer.prompt : '';
    if (!speechText.trim()) {
      continue;
    }

    const speakerCharacterName = typeof audioLayer.speakerCharacterName === 'string'
      ? audioLayer.speakerCharacterName.trim()
      : '';
    const currentAlignmentMap = normalizeSubtitleAlignmentMap(audioLayer.subtitleAlignmentMap);
    const currentAlignmentCoverage = getSubtitleAlignmentMapCoverage(
      currentAlignmentMap,
      speechText,
      audioLayer.subtitleText,
    );
    const metadataNeedsInference =
      !hasTranslatedSubtitleText(audioLayer) ||
      !currentAlignmentCoverage.isComplete ||
      (speakerCharacterName && !hasLocalizedSubtitleSpeakerName(audioLayer));
    const operationalFlagsNeedRepair =
      audioLayer.addTranscriptionsRequired !== true ||
      getTranslatedSubtitleWordAnimation(audioLayer) !== audioLayer.subtitleWordAnimation;

    if (!metadataNeedsInference && !operationalFlagsNeedRepair) {
      continue;
    }

    if (!metadataNeedsInference) {
      plannedUpdates.push({
        audioLayer,
        fields: {
          addTranscriptionsRequired: true,
          subtitleWordAnimation: getTranslatedSubtitleWordAnimation(audioLayer),
        },
      });
      continue;
    }

    if (typeof translateSpeech !== 'function') {
      throw new Error('translateSpeech is required to backfill translated subtitle metadata.');
    }

    const subtitleLanguageString = getLanguageStringFromLanguageCode(subtitleLanguage) ||
      sessionSubtitleLanguageString || subtitleLanguage;
    const resolution = await translateSpeech(
      speechText,
      subtitleLanguageString,
      inferenceModel,
      {
        targetLanguageCode: subtitleLanguage,
        includeSubtitleAlignment: true,
        speakerCharacterName,
        ...(!knownSpeechLanguage
          ? {
            detectSourceLanguage: true,
            returnMetadata: true,
          }
          : {}),
      },
    );
    const normalizedResolution = normalizeTranslatedSubtitleResult(resolution);
    const detectedSpeechLanguage = !knownSpeechLanguage
      ? normalizeDetectedSpeechLanguage(resolution?.sourceLanguage)
      : knownSpeechLanguage;
    const translationRequired = !knownSpeechLanguage
      ? resolution?.translationRequired === true
      : knownTranslationRequired;

    if (!detectedSpeechLanguage) {
      throw new Error('Subtitle rerun backfill returned an invalid speech language.');
    }

    if (!translationRequired) {
      plannedUpdates.push({
        audioLayer,
        fields: {
          subtitleText: speechText,
          subtitleLanguage: detectedSpeechLanguage,
          speechLanguage: detectedSpeechLanguage,
          subtitleTranslationRequired: false,
          subtitleAlignmentMap: [],
          subtitleSpeakerCharacterName: null,
          addTranscriptionsRequired: true,
          subtitleWordAnimation: getTranslatedSubtitleWordAnimation(audioLayer),
        },
      });
      continue;
    }

    if (!normalizedResolution.text.trim()) {
      throw new Error('Subtitle rerun backfill returned empty translated text.');
    }
    if (!normalizedResolution.subtitleAlignmentMap.length) {
      throw new Error('Subtitle rerun backfill returned an empty alignment map.');
    }
    const backfillAlignmentCoverage = getSubtitleAlignmentMapCoverage(
      normalizedResolution.subtitleAlignmentMap,
      speechText,
      normalizedResolution.text,
    );
    if (!backfillAlignmentCoverage.sourceMatches) {
      throw new Error(
        'Subtitle rerun backfill alignment map does not completely cover the source speech.',
      );
    }
    if (!backfillAlignmentCoverage.translationMatches) {
      throw new Error(
        'Subtitle rerun backfill alignment map does not completely cover the translated speech.',
      );
    }
    if (speakerCharacterName && !normalizedResolution.subtitleSpeakerCharacterName) {
      throw new Error('Subtitle rerun backfill returned an empty localized speaker name.');
    }

    plannedUpdates.push({
      audioLayer,
      fields: {
        subtitleText: normalizedResolution.text.trim(),
        subtitleLanguage,
        speechLanguage: detectedSpeechLanguage,
        subtitleTranslationRequired: true,
        subtitleAlignmentMap: normalizedResolution.subtitleAlignmentMap,
        subtitleSpeakerCharacterName: speakerCharacterName
          ? normalizedResolution.subtitleSpeakerCharacterName
          : null,
        addTranscriptionsRequired: true,
        subtitleWordAnimation: getTranslatedSubtitleWordAnimation(audioLayer),
      },
    });
  }

  applyPlannedAudioLayerUpdates(plannedUpdates);
  return {
    audioLayers: layerList,
    updatedCount: plannedUpdates.length,
  };
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
    let subtitleAlignmentMap = [];
    let subtitleSpeakerCharacterName = null;
    const speakerCharacterName = typeof sound.speakerCharacterName === 'string'
      ? sound.speakerCharacterName.trim()
      : '';

    if (shouldResolveAutoSpeech && speechText.trim()) {
      const resolution = await translateSpeech(
        speechText,
        subtitleLanguageExplicit ? subtitleLanguageString : null,
        inferenceModel,
        {
          detectSourceLanguage: true,
          returnMetadata: true,
          targetLanguageCode: subtitleLanguageExplicit ? subtitleLanguage : null,
          includeSubtitleAlignment: subtitleLanguageExplicit,
          speakerCharacterName: subtitleLanguageExplicit ? speakerCharacterName : null,
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
      if (translationRequired) {
        const normalizedResolution = normalizeTranslatedSubtitleResult(resolution);
        subtitleAlignmentMap = normalizedResolution.subtitleAlignmentMap;
        subtitleSpeakerCharacterName = normalizedResolution.subtitleSpeakerCharacterName;
      }
    } else if (knownTranslationRequired && speechText.trim()) {
      const resolution = await translateSpeech(
        speechText,
        subtitleLanguageString,
        inferenceModel,
        {
          targetLanguageCode: subtitleLanguage,
          includeSubtitleAlignment: true,
          speakerCharacterName,
        },
      );
      const normalizedResolution = normalizeTranslatedSubtitleResult(resolution);
      subtitleText = normalizedResolution.text;
      subtitleAlignmentMap = normalizedResolution.subtitleAlignmentMap;
      subtitleSpeakerCharacterName = normalizedResolution.subtitleSpeakerCharacterName;
    }

    if (typeof subtitleText !== 'string' || (speechText.trim() && !subtitleText.trim())) {
      throw new Error('Speech subtitle translation returned empty text.');
    }
    if (translationRequired && speechText.trim() && !subtitleAlignmentMap.length) {
      throw new Error('Speech subtitle translation returned an empty alignment map.');
    }
    if (translationRequired && speechText.trim()) {
      const alignmentCoverage = getSubtitleAlignmentMapCoverage(
        subtitleAlignmentMap,
        speechText,
        subtitleText,
      );
      if (!alignmentCoverage.sourceMatches) {
        throw new Error(
          'Speech subtitle translation alignment map does not completely cover the source speech.',
        );
      }
      if (!alignmentCoverage.translationMatches) {
        throw new Error(
          'Speech subtitle translation alignment map does not completely cover the translated speech.',
        );
      }
    }
    if (translationRequired && speakerCharacterName && !subtitleSpeakerCharacterName) {
      throw new Error('Speech subtitle translation returned an empty localized speaker name.');
    }
    subtitleTextBySound.set(sound, {
      subtitleText: translationRequired ? subtitleText.trim() : speechText,
      subtitleLanguage: layerSubtitleLanguage,
      speechLanguage,
      subtitleTranslationRequired: translationRequired,
      subtitleAlignmentMap: translationRequired ? subtitleAlignmentMap : [],
      subtitleSpeakerCharacterName: translationRequired
        ? subtitleSpeakerCharacterName
        : null,
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
    subtitleAlignmentMap: subtitleTranslationRequired
      ? normalizeSubtitleAlignmentMap(metadata.subtitleAlignmentMap)
      : [],
    subtitleSpeakerCharacterName: subtitleTranslationRequired &&
      typeof metadata.subtitleSpeakerCharacterName === 'string'
      ? metadata.subtitleSpeakerCharacterName.trim() || null
      : null,
    addTranscriptionsRequired: subtitlesEnabled,
    subtitleWordAnimation: 'highlight',
  };
}
