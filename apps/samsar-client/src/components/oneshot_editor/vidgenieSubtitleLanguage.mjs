function normalizeLanguageValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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
