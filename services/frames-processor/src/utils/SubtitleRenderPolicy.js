import { resolveSubtitleFont } from '../consts/SubtitleFonts.js';

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

export function normalizeComparableSubtitleLanguage(languageCode = '') {
  if (typeof languageCode !== 'string') {
    return '';
  }

  const normalized = languageCode.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === 'auto') {
    return '';
  }

  const exactAlias = LANGUAGE_ALIASES[normalized];
  if (exactAlias) {
    return exactAlias;
  }

  const baseCode = normalized.split('-')[0];
  return LANGUAGE_ALIASES[baseCode] || baseCode;
}

function firstConcreteLanguage(...values) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (normalizeComparableSubtitleLanguage(trimmed)) {
      return trimmed;
    }
  }
  return '';
}

function findItemAudioLayer(session = {}, item = {}) {
  const audioLayerId = item.audioLayerId?.toString?.() || '';
  if (!audioLayerId || !Array.isArray(session.audioLayers)) {
    return null;
  }

  return session.audioLayers.find(
    (audioLayer) => audioLayer?._id?.toString?.() === audioLayerId,
  ) || null;
}

export function getSubtitleTranslationContext(session = {}, item = {}) {
  const audioLayer = findItemAudioLayer(session, item) || {};
  const audioLanguage = firstConcreteLanguage(
    item.audioLanguage,
    item.audio_language,
    audioLayer.speechLanguage,
    audioLayer.speech_language,
    audioLayer.languageCode,
    audioLayer.language_code,
    session.sessionLanguage,
    session.session_language,
    session.language,
  );
  const subtitleLanguage = firstConcreteLanguage(
    item.subtitleLanguage,
    item.subtitle_language,
    audioLayer.subtitleLanguage,
    audioLayer.subtitle_language,
    session.subtitleLanguage,
    session.subtitle_language,
    audioLanguage,
  );
  const normalizedAudioLanguage = normalizeComparableSubtitleLanguage(audioLanguage);
  const normalizedSubtitleLanguage = normalizeComparableSubtitleLanguage(subtitleLanguage);
  const translationRequired =
    item.subtitleTranslationRequired === true ||
    item.subtitle_translation_required === true ||
    audioLayer.subtitleTranslationRequired === true ||
    audioLayer.subtitle_translation_required === true ||
    session.subtitleTranslationRequired === true ||
    session.subtitle_translation_required === true;

  return {
    audioLanguage,
    subtitleLanguage,
    translationRequired,
    isTranslated:
      session.enableSubtitles !== false &&
      Boolean(normalizedAudioLanguage) &&
      Boolean(normalizedSubtitleLanguage) &&
      normalizedAudioLanguage !== normalizedSubtitleLanguage,
  };
}

export function isStaticSubtitleItem(item = {}, session = {}) {
  if (item?.type !== 'text' || item?.subType !== 'subtitle') {
    return false;
  }

  if (item.isStaticSubtitle === true || item.subtitleRenderMode === 'static') {
    return true;
  }

  return getSubtitleTranslationContext(session, item).isTranslated;
}

function prepareStaticSubtitleItem(item, session) {
  const translationContext = getSubtitleTranslationContext(session, item);
  const targetLanguage = firstConcreteLanguage(
    item.subtitleLanguage,
    item.subtitle_language,
    translationContext.subtitleLanguage,
    translationContext.audioLanguage,
  );
  const existingConfig = item.config || {};
  const fontFamily = resolveSubtitleFont(
    targetLanguage,
    existingConfig.fontFamily || item.fontFamily,
  );
  const speakerFontFamily = resolveSubtitleFont(
    targetLanguage,
    existingConfig.speakerFontFamily || item.speakerFontFamily || item.speakerFont || fontFamily,
  );
  const breakTextWidth = existingConfig.breakTextWidth ?? item.breakTextWidth;
  const { animation: _ignoredAnimation, ...itemWithoutLegacyAnimation } = item;

  return {
    ...itemWithoutLegacyAnimation,
    config: {
      ...existingConfig,
      fontFamily,
      speakerFontFamily,
      autoWrap: true,
      ...(breakTextWidth != null ? { breakTextWidth } : {}),
      staticSubtitle: true,
    },
    animations: [],
    words: [],
    wordAnimation: null,
    textAccent: null,
    speakerFont: speakerFontFamily,
    speakerFontFamily,
    subtitleLanguage: targetLanguage || null,
    audioLanguage: translationContext.audioLanguage || item.audioLanguage || null,
    subtitleRenderMode: 'static',
    isStaticSubtitle: true,
  };
}

export function prepareLayerSubtitlesForRendering(layer = {}, session = {}) {
  const activeItemList = layer?.imageSession?.activeItemList;
  if (!Array.isArray(activeItemList) || activeItemList.length === 0) {
    return layer;
  }

  let changed = false;
  const preparedActiveItemList = activeItemList.map((item) => {
    if (!isStaticSubtitleItem(item, session)) {
      return item;
    }
    changed = true;
    return prepareStaticSubtitleItem(item, session);
  });

  if (!changed) {
    return layer;
  }

  return {
    ...layer,
    imageSession: {
      ...layer.imageSession,
      activeItemList: preparedActiveItemList,
    },
  };
}
