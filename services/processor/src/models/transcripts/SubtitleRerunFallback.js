import { resolveSubtitleFont } from '../../consts/SubtitleFonts.js';

const DEFAULT_FRAMES_PER_SECOND = 24;

const LANGUAGE_ALIASES = Object.freeze({
  eng: 'en',
  spa: 'es',
  fre: 'fr',
  fra: 'fr',
  jpn: 'ja',
  jp: 'ja',
  tha: 'th',
  zho: 'zh',
  chi: 'zh',
  cn: 'zh',
  ben: 'bn',
  hin: 'hi',
  san: 'sa',
  lat: 'la',
});

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeComparableLanguage(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === 'auto') {
    return '';
  }

  const exactAlias = LANGUAGE_ALIASES[normalized];
  if (exactAlias) {
    return exactAlias;
  }

  const baseLanguage = normalized.split('-')[0];
  return LANGUAGE_ALIASES[baseLanguage] || baseLanguage;
}

function firstConcreteLanguage(...values) {
  for (const value of values) {
    if (normalizeComparableLanguage(value)) {
      return value.trim();
    }
  }
  return '';
}

function getPositiveNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function isTranslatedSubtitleAudioLayer(audioLayer = {}, session = {}) {
  const speechLanguage = firstConcreteLanguage(
    audioLayer.speechLanguage,
    audioLayer.languageCode,
    session.sessionLanguage,
  );
  const subtitleLanguage = firstConcreteLanguage(
    audioLayer.subtitleLanguage,
    session.subtitleLanguage,
  );
  const normalizedSpeechLanguage = normalizeComparableLanguage(speechLanguage);
  const normalizedSubtitleLanguage = normalizeComparableLanguage(subtitleLanguage);

  return audioLayer.subtitleTranslationRequired === true || Boolean(
    normalizedSpeechLanguage &&
    normalizedSubtitleLanguage &&
    normalizedSpeechLanguage !== normalizedSubtitleLanguage
  );
}

export function buildTranslatedSubtitleRerunFallback({
  audioLayer = {},
  session = {},
  canvasDimensions = {},
  framesPerSecond = DEFAULT_FRAMES_PER_SECOND,
} = {}) {
  if (!isTranslatedSubtitleAudioLayer(audioLayer, session)) {
    return null;
  }

  const subtitleText = firstNonEmptyString(
    audioLayer.subtitleText,
    audioLayer.subtitle_text,
  );
  if (!subtitleText) {
    return null;
  }

  const effectiveFramesPerSecond = getPositiveNumber(framesPerSecond) ||
    DEFAULT_FRAMES_PER_SECOND;
  const startTime = Number(audioLayer.startTime);
  const endTime = Number(audioLayer.endTime);
  const inferredDuration = Number.isFinite(startTime) && Number.isFinite(endTime)
    ? endTime - startTime
    : null;
  const durationSeconds = getPositiveNumber(
    audioLayer.duration,
    inferredDuration,
    1 / effectiveFramesPerSecond,
  );
  const width = getPositiveNumber(canvasDimensions.width) || 1024;
  const height = getPositiveNumber(canvasDimensions.height) || 1024;
  const fontSize = width < 1024 ? 42 : 48;
  const breakTextWidth = Math.max(1, width - 200);
  const subtitleLanguage = firstConcreteLanguage(
    audioLayer.subtitleLanguage,
    session.subtitleLanguage,
  );
  const audioLanguage = firstConcreteLanguage(
    audioLayer.speechLanguage,
    audioLayer.languageCode,
    session.sessionLanguage,
  );
  const fontFamily = resolveSubtitleFont(
    subtitleLanguage || audioLanguage || 'en',
    undefined,
  );
  const speakerFontFamily = resolveSubtitleFont(
    subtitleLanguage || audioLanguage || 'en',
    undefined,
  );
  const speaker = firstNonEmptyString(
    audioLayer.subtitleSpeakerCharacterName,
    audioLayer.subtitle_speaker_character_name,
    audioLayer.speakerCharacterName,
  );

  return {
    type: 'text',
    subType: 'subtitle',
    text: subtitleText,
    subtitleText,
    audioLayerId: audioLayer?._id?.toString?.() || null,
    subtitleLanguage: subtitleLanguage || null,
    audioLanguage: audioLanguage || null,
    subtitleTranslationRequired: true,
    subtitleRenderMode: 'static',
    isStaticSubtitle: true,
    animations: [],
    words: [],
    wordAnimation: null,
    textAccent: null,
    breakTextWidth,
    ...(speaker
      ? {
        speaker,
        showSpeaker: true,
        speakerFont: speakerFontFamily,
        speakerFontFamily,
      }
      : { showSpeaker: false }),
    config: {
      width: breakTextWidth,
      height: 90,
      fontSize,
      fontFamily,
      fillColor: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 3,
      textAlign: 'center',
      fontEmphasis: 'bold',
      autoWrap: true,
      staticSubtitle: true,
      x: width / 2,
      y: Math.round(height * 0.9),
      frameOffset: 0,
      frameDuration: Math.max(
        1,
        Math.floor(durationSeconds * effectiveFramesPerSecond),
      ),
      rotationAngle: 0,
      speakerFontFamily,
      speakerFontSize: Math.round(fontSize * 0.78),
      speakerFillColor: '#FFD166',
      speakerStrokeColor: '#000000',
      speakerStrokeWidth: 3,
      speakerFontEmphasis: 'bold',
    },
  };
}

export function resolveGeneratedSubtitleLayers(rawLayers, {
  requireNonEmpty = false,
  ...fallbackOptions
} = {}) {
  if (Array.isArray(rawLayers) && rawLayers.length > 0) {
    return rawLayers;
  }

  const translatedFallback = buildTranslatedSubtitleRerunFallback(fallbackOptions);
  if (translatedFallback) {
    return [translatedFallback];
  }

  if (requireNonEmpty) {
    const audioLayerId = fallbackOptions.audioLayer?._id?.toString?.() || 'unknown';
    throw new Error(
      `Subtitle regeneration produced no subtitle layers for audio layer ${audioLayerId}.`,
    );
  }

  return [];
}
