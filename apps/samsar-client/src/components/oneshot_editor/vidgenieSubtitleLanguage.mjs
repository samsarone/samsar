function normalizeLanguageValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export const DEFAULT_VIDGENIE_SUBTITLES_ENABLED = false;
export const VIDGENIE_SUBTITLE_PREFERENCE_VERSION = 2;

export function resolveInitialVidgenieSubtitlesEnabled(preferences = {}) {
  return preferences?.subtitlePreferenceVersion === VIDGENIE_SUBTITLE_PREFERENCE_VERSION &&
    preferences?.enableSubtitles === true;
}

export function resolveSubtitleLanguageOverride({
  enableSubtitles,
  audioLanguage,
  subtitleLanguage,
}) {
  if (!enableSubtitles) {
    return null;
  }

  const normalizedAudioLanguage = normalizeLanguageValue(audioLanguage);
  const normalizedSubtitleLanguage = normalizeLanguageValue(subtitleLanguage);

  if (
    !normalizedSubtitleLanguage ||
    normalizedSubtitleLanguage === 'auto' ||
    normalizedSubtitleLanguage === normalizedAudioLanguage
  ) {
    return null;
  }

  return normalizedSubtitleLanguage;
}

export function buildVidgenieLanguageFields({
  audioLanguage,
  enableSubtitles,
  subtitleLanguage,
}) {
  const language = normalizeLanguageValue(audioLanguage) || 'auto';
  const subtitleLanguageOverride = resolveSubtitleLanguageOverride({
    enableSubtitles,
    audioLanguage: language,
    subtitleLanguage,
  });

  return {
    language,
    enable_subtitles: enableSubtitles === true,
    ...(subtitleLanguageOverride
      ? { subtitle_language: subtitleLanguageOverride }
      : {}),
  };
}
