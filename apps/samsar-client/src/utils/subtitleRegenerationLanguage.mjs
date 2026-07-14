const SUPPORTED_LANGUAGE_CODES = new Set([
  'en',
  'es',
  'fr',
  'ja',
  'th',
  'zh',
  'bn',
  'hi',
  'sa',
  'la',
]);

const LANGUAGE_ALIASES = Object.freeze({
  cn: 'zh',
  jp: 'ja',
});

const LANGUAGE_NAMES = Object.freeze({
  english: 'en',
  spanish: 'es',
  french: 'fr',
  japanese: 'ja',
  thai: 'th',
  chinese: 'zh',
  bengali: 'bn',
  hindi: 'hi',
  sanskrit: 'sa',
  latin: 'la',
});

function normalizeLanguageCode(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return '';
  }

  if (LANGUAGE_NAMES[normalized]) {
    return LANGUAGE_NAMES[normalized];
  }

  const baseCode = normalized.replace(/_/g, '-').split('-')[0];
  const aliasedCode = LANGUAGE_ALIASES[baseCode] || baseCode;
  return SUPPORTED_LANGUAGE_CODES.has(aliasedCode) ? aliasedCode : '';
}

function readFirstLanguage(candidates, fieldNames) {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    for (const fieldName of fieldNames) {
      const languageCode = normalizeLanguageCode(candidate[fieldName]);
      if (languageCode) {
        return languageCode;
      }
    }
  }

  return '';
}

function getSessionLanguageCandidates(sessionDetails) {
  const session = sessionDetails?.session && typeof sessionDetails.session === 'object'
    ? sessionDetails.session
    : null;

  return [
    sessionDetails,
    session,
    sessionDetails?.input,
    session?.input,
    sessionDetails?.requestInput,
    session?.requestInput,
    sessionDetails?.expressGenerationInput,
    session?.expressGenerationInput,
    sessionDetails?.generationInput,
    session?.generationInput,
  ];
}

export function resolveSessionAudioLanguage(sessionDetails) {
  const candidates = getSessionLanguageCandidates(sessionDetails);
  const directLanguage = readFirstLanguage(candidates, [
    'speechLanguage',
    'speech_language',
    'sessionLanguage',
    'session_language',
    'language',
    'languageCode',
    'language_code',
    'langauge',
  ]);

  if (directLanguage) {
    return directLanguage;
  }

  const audioLayers = [
    sessionDetails?.audioLayers,
    sessionDetails?.session?.audioLayers,
  ].find(Array.isArray) || [];

  return readFirstLanguage(audioLayers, [
    'speechLanguage',
    'speech_language',
    'language',
    'languageCode',
    'language_code',
  ]);
}

export function resolveSessionSubtitleLanguage(sessionDetails) {
  return readFirstLanguage(getSessionLanguageCandidates(sessionDetails), [
    'subtitleLanguage',
    'subtitle_language',
  ]);
}

export function resolveSubtitleRegenerationDefault(sessionDetails) {
  return (
    resolveSessionSubtitleLanguage(sessionDetails) ||
    resolveSessionAudioLanguage(sessionDetails)
  );
}

export function resolveSubtitleRegenerationLanguage({
  selectedLanguage,
  audioLanguage,
} = {}) {
  return normalizeLanguageCode(selectedLanguage) || normalizeLanguageCode(audioLanguage);
}

export function buildSubtitleRegenerationLanguageFields({
  selectedLanguage,
  audioLanguage,
} = {}) {
  const subtitleLanguage = resolveSubtitleRegenerationLanguage({
    selectedLanguage,
    audioLanguage,
  });

  return subtitleLanguage
    ? { subtitle_language: subtitleLanguage }
    : {};
}

export function isTranslatedSubtitleRegeneration({
  selectedLanguage,
  audioLanguage,
} = {}) {
  const normalizedAudioLanguage = normalizeLanguageCode(audioLanguage);
  const normalizedSubtitleLanguage = resolveSubtitleRegenerationLanguage({
    selectedLanguage,
    audioLanguage,
  });

  return Boolean(
    normalizedAudioLanguage &&
    normalizedSubtitleLanguage &&
    normalizedSubtitleLanguage !== normalizedAudioLanguage
  );
}
