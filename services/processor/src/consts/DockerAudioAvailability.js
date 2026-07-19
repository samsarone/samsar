import {
  TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH,
  TTS_PROVIDER_ELEVENLABS,
  TTS_PROVIDER_GOOGLE,
  TTS_PROVIDER_OPENAI,
  normalizeTTSSpeakerGender,
} from './TTSSpeakers.js';

const GOOGLE_NATIVE_CREDENTIAL_KEYS = Object.freeze([
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

const GOOGLE_PROJECT_KEYS = Object.freeze([
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PROJECT_ID',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'PROJECT_ID',
]);

const GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS = Object.freeze([
  'K_SERVICE',
  'GAE_SERVICE',
  'FUNCTION_TARGET',
  'GCE_METADATA_HOST',
]);

const DEFAULT_GOOGLE_TTS_SPEAKER_DETAILS = Object.freeze([
  Object.freeze({
    provider: TTS_PROVIDER_GOOGLE,
    value: 'en-US-Standard-F',
    voiceId: 'en-US-Standard-F',
    label: 'en-US Standard F',
    shortLabel: 'Standard F',
    name: 'en-US-Standard-F',
    languageCode: 'en-US',
    languageCodes: Object.freeze(['en-US']),
    Gender: 'F',
    gender: 'FEMALE',
    genderLabel: 'Female',
    previewRequiresAuth: true,
  }),
  Object.freeze({
    provider: TTS_PROVIDER_GOOGLE,
    value: 'en-US-Standard-D',
    voiceId: 'en-US-Standard-D',
    label: 'en-US Standard D',
    shortLabel: 'Standard D',
    name: 'en-US-Standard-D',
    languageCode: 'en-US',
    languageCodes: Object.freeze(['en-US']),
    Gender: 'M',
    gender: 'MALE',
    genderLabel: 'Male',
    previewRequiresAuth: true,
  }),
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return normalizeString(value).toUpperCase();
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function isFalseyEnv(value) {
  return ['0', 'false', 'no', 'off'].includes(normalizeString(value).toLowerCase());
}

function hasEnvCredential(...keys) {
  return keys.some((key) => Boolean(normalizeString(process.env[key])));
}

function normalizeStringList(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  values.forEach((value) => {
    const trimmed = normalizeString(value);
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  return normalized;
}

function toPlainSpeakerOptions(speakerOptions = null) {
  if (!speakerOptions || typeof speakerOptions !== 'object' || Array.isArray(speakerOptions)) {
    return null;
  }

  if (typeof speakerOptions.toObject === 'function') {
    return speakerOptions.toObject();
  }

  return speakerOptions;
}

function getGoogleLanguageCodeFromSpeakerValue(speakerValue = '') {
  const languageMatch = normalizeString(speakerValue).match(/^[a-z]{2,3}(?:-[A-Z0-9]{2,4})?/);
  return languageMatch?.[0] || '';
}

function normalizeGoogleSpeakerDetail(rawSpeaker = {}) {
  if (!rawSpeaker || typeof rawSpeaker !== 'object' || Array.isArray(rawSpeaker)) {
    return null;
  }

  const value =
    normalizeString(rawSpeaker.value) ||
    normalizeString(rawSpeaker.voiceId) ||
    normalizeString(rawSpeaker.name);
  if (!value) {
    return null;
  }

  const voiceId = normalizeString(rawSpeaker.voiceId) || value;
  const languageCodes = Array.isArray(rawSpeaker.languageCodes)
    ? rawSpeaker.languageCodes.map(normalizeString).filter(Boolean)
    : [];
  const languageCode =
    normalizeString(rawSpeaker.languageCode) ||
    languageCodes[0] ||
    getGoogleLanguageCodeFromSpeakerValue(value);

  return {
    ...rawSpeaker,
    provider: TTS_PROVIDER_GOOGLE,
    value,
    voiceId,
    label: normalizeString(rawSpeaker.label) || voiceId,
    shortLabel: normalizeString(rawSpeaker.shortLabel),
    name: normalizeString(rawSpeaker.name) || voiceId,
    languageCode,
    languageCodes: languageCodes.length > 0 ? languageCodes : (languageCode ? [languageCode] : []),
    Gender: normalizeTTSSpeakerGender(
      rawSpeaker.Gender || rawSpeaker.genderCode || rawSpeaker.gender || rawSpeaker.ssmlGender
    ),
  };
}

function cloneDefaultGoogleSpeakerDetails() {
  return DEFAULT_GOOGLE_TTS_SPEAKER_DETAILS.map((speaker) => ({
    ...speaker,
    languageCodes: [...speaker.languageCodes],
  }));
}

function buildGoogleSpeakerOptions(source = null) {
  const speakerOptions = toPlainSpeakerOptions(source);
  const selectedGoogleSpeakers = normalizeStringList(speakerOptions?.googleSpeakers);
  const selectedSet = new Set(selectedGoogleSpeakers);
  const seen = new Set();
  const details = [];

  const rawDetails = Array.isArray(speakerOptions?.googleSpeakerDetails)
    ? speakerOptions.googleSpeakerDetails
    : [];
  rawDetails.forEach((rawSpeaker) => {
    const speaker = normalizeGoogleSpeakerDetail(rawSpeaker);
    if (!speaker || seen.has(speaker.value) || (selectedSet.size > 0 && !selectedSet.has(speaker.value))) {
      return;
    }
    seen.add(speaker.value);
    details.push(speaker);
  });

  selectedGoogleSpeakers.forEach((speakerValue) => {
    if (seen.has(speakerValue)) {
      return;
    }

    const defaultSpeaker = cloneDefaultGoogleSpeakerDetails()
      .find((speaker) => speaker.value === speakerValue);
    if (defaultSpeaker) {
      seen.add(defaultSpeaker.value);
      details.push(defaultSpeaker);
      return;
    }

    const languageCode = getGoogleLanguageCodeFromSpeakerValue(speakerValue);
    seen.add(speakerValue);
    details.push({
      provider: TTS_PROVIDER_GOOGLE,
      value: speakerValue,
      voiceId: speakerValue,
      name: speakerValue,
      label: speakerValue,
      shortLabel: speakerValue,
      languageCode,
      languageCodes: languageCode ? [languageCode] : [],
      Gender: null,
      gender: '',
      genderLabel: '',
      naturalSampleRateHertz: null,
      voiceType: '',
      previewRequiresAuth: true,
    });
  });

  const genders = new Set(details.map((speaker) => speaker.Gender).filter(Boolean));
  if (!genders.has('F') || !genders.has('M')) {
    cloneDefaultGoogleSpeakerDetails().forEach((speaker) => {
      if (!seen.has(speaker.value)) {
        seen.add(speaker.value);
        details.push(speaker);
      }
    });
  }

  return {
    googleSpeakers: details.map((speaker) => speaker.value),
    googleSpeakerDetails: details,
  };
}

export function hasOpenAICredential() {
  return hasEnvCredential('OPENAI_API_KEY');
}

export function hasFalCredential() {
  return hasEnvCredential('FAL_API_KEY');
}

export function hasElevenLabsCredential() {
  return hasEnvCredential('ELEVENLABS_API_TOKEN', 'ELEVENLABS_API_KEY');
}

export function hasSamsarCredential() {
  return hasEnvCredential('SAMSAR_API_KEY');
}

export function isSubtitleGenerationAvailable() {
  const isDockerInstall = normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
  if (!isDockerInstall) {
    return true;
  }
  return hasOpenAICredential() || hasSamsarCredential();
}

export function buildSubtitleConfigurationError() {
  const error = new Error(
    'Subtitle generation requires an OpenAI API key or Samsar API key in this Docker deployment.',
  );
  error.code = 'SUBTITLE_PROVIDER_NOT_CONFIGURED';
  error.status = 503;
  error.statusCode = 503;
  return error;
}

export function assertSubtitleGenerationAvailable() {
  if (!isSubtitleGenerationAvailable()) {
    throw buildSubtitleConfigurationError();
  }
}

export function applyDockerSubtitleAvailability(payload = {}) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    isSubtitleGenerationAvailable()
  ) {
    return payload;
  }

  const normalizedPayload = {
    ...payload,
    enable_subtitles: false,
    enableSubtitles: false,
    add_subtitles: false,
    addSubtitles: false,
    subtitle_translation_required: false,
    subtitleTranslationRequired: false,
    subtitles_translation_required: false,
    subtitlesTranslationRequired: false,
    translate_subtitles: false,
    translateSubtitles: false,
    subtitle_language_explicit: false,
    subtitleLanguageExplicit: false,
  };

  // A requested subtitle language implies subtitle generation in the normal
  // request parser. Remove it before validation when Docker cannot run the
  // OpenAI-backed subtitle pipeline.
  delete normalizedPayload.subtitle_language;
  delete normalizedPayload.subtitleLanguage;

  return normalizedPayload;
}

export function hasGoogleCloudCredential() {
  if (hasEnvCredential(...GOOGLE_NATIVE_CREDENTIAL_KEYS)) {
    return true;
  }

  return hasEnvCredential(...GOOGLE_PROJECT_KEYS) &&
    hasEnvCredential(...GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS);
}

export function isDockerAudioAvailabilityFilteringEnabled() {
  if (isFalseyEnv(process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED)) {
    return false;
  }
  if (isTruthyEnv(process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED)) {
    return true;
  }
  return normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
}

export function getAvailableDockerTTSProviders() {
  const providers = [];
  if (hasOpenAICredential() || hasSamsarCredential()) {
    providers.push(TTS_PROVIDER_OPENAI);
  }
  if (hasGoogleCloudCredential() || hasSamsarCredential()) {
    providers.push(TTS_PROVIDER_GOOGLE);
  }
  if (hasElevenLabsCredential() || hasFalCredential() || hasSamsarCredential()) {
    providers.push(TTS_PROVIDER_ELEVENLABS);
  }
  return providers;
}

export function isDockerTTSProviderAvailable(ttsProvider) {
  if (!isDockerAudioAvailabilityFilteringEnabled()) {
    return true;
  }
  const normalizedProvider = normalizeKey(ttsProvider);
  if (normalizedProvider === TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH) {
    return true;
  }
  return getAvailableDockerTTSProviders().includes(normalizedProvider);
}

function pickDefaultDockerTTSProvider() {
  const available = new Set(getAvailableDockerTTSProviders());
  if (available.has(TTS_PROVIDER_ELEVENLABS)) return TTS_PROVIDER_ELEVENLABS;
  if (available.has(TTS_PROVIDER_GOOGLE)) return TTS_PROVIDER_GOOGLE;
  if (available.has(TTS_PROVIDER_OPENAI)) return TTS_PROVIDER_OPENAI;
  return '';
}

function buildSpeakerOptionsForProvider(provider, source = null) {
  const speakerOptions = toPlainSpeakerOptions(source);
  const normalizedProvider = normalizeKey(provider);

  if (normalizedProvider === TTS_PROVIDER_OPENAI) {
    return {
      allowOpenAI: true,
      allowElevenLabs: false,
      allowGoogle: false,
      openAISpeakers: normalizeStringList(speakerOptions?.openAISpeakers),
      elevenLabsSpeakers: [],
      googleSpeakers: [],
      googleSpeakerDetails: [],
    };
  }

  if (normalizedProvider === TTS_PROVIDER_ELEVENLABS) {
    return {
      allowOpenAI: false,
      allowElevenLabs: true,
      allowGoogle: false,
      openAISpeakers: [],
      elevenLabsSpeakers: normalizeStringList(speakerOptions?.elevenLabsSpeakers),
      googleSpeakers: [],
      googleSpeakerDetails: [],
    };
  }

  if (normalizedProvider === TTS_PROVIDER_GOOGLE) {
    return {
      allowOpenAI: false,
      allowElevenLabs: false,
      allowGoogle: true,
      openAISpeakers: [],
      elevenLabsSpeakers: [],
      ...buildGoogleSpeakerOptions(speakerOptions),
    };
  }

  return null;
}

export function resolveDockerSpeakerOptionsForTTSProvider(ttsProvider, speakerOptions = null) {
  if (!isDockerAudioAvailabilityFilteringEnabled()) {
    return null;
  }

  const normalizedProvider = normalizeKey(ttsProvider);
  if (!normalizedProvider || normalizedProvider === TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH) {
    return null;
  }
  if (!isDockerTTSProviderAvailable(normalizedProvider)) {
    return null;
  }

  return buildSpeakerOptionsForProvider(normalizedProvider, speakerOptions);
}

export function filterDockerSpeakerOptions(speakerOptions = null) {
  if (!isDockerAudioAvailabilityFilteringEnabled()) {
    return speakerOptions;
  }

  const available = new Set(getAvailableDockerTTSProviders());
  const source = toPlainSpeakerOptions(speakerOptions);

  const openAISpeakers = available.has(TTS_PROVIDER_OPENAI)
    ? normalizeStringList(source?.openAISpeakers)
    : [];
  const elevenLabsSpeakers = available.has(TTS_PROVIDER_ELEVENLABS)
    ? normalizeStringList(source?.elevenLabsSpeakers)
    : [];
  const hasGooglePreference =
    source?.allowGoogle === true ||
    normalizeStringList(source?.googleSpeakers).length > 0 ||
    (Array.isArray(source?.googleSpeakerDetails) && source.googleSpeakerDetails.length > 0);
  const googleOptions = available.has(TTS_PROVIDER_GOOGLE) && hasGooglePreference
    ? buildGoogleSpeakerOptions(source)
    : { googleSpeakers: [], googleSpeakerDetails: [] };

  const filtered = {
    allowOpenAI: available.has(TTS_PROVIDER_OPENAI) && (source?.allowOpenAI === true || openAISpeakers.length > 0),
    allowElevenLabs: available.has(TTS_PROVIDER_ELEVENLABS) && (source?.allowElevenLabs === true || elevenLabsSpeakers.length > 0),
    allowGoogle: available.has(TTS_PROVIDER_GOOGLE) && hasGooglePreference && (source?.allowGoogle === true || googleOptions.googleSpeakers.length > 0),
    openAISpeakers,
    elevenLabsSpeakers,
    googleSpeakers: googleOptions.googleSpeakers,
    googleSpeakerDetails: googleOptions.googleSpeakerDetails,
  };

  const hasUsablePreference =
    filtered.allowOpenAI ||
    filtered.allowElevenLabs ||
    filtered.allowGoogle ||
    filtered.openAISpeakers.length > 0 ||
    filtered.elevenLabsSpeakers.length > 0 ||
    filtered.googleSpeakers.length > 0;

  if (hasUsablePreference) {
    return filtered;
  }

  const defaultProvider = pickDefaultDockerTTSProvider();
  return defaultProvider
    ? buildSpeakerOptionsForProvider(defaultProvider, source)
    : filtered;
}

function normalizeBackingTrackModel(model) {
  const normalizedModel = normalizeKey(model);
  return normalizedModel === 'LYRIA2' ? 'LYRIA3' : normalizedModel;
}

export function getAvailableDockerBackingTrackModels() {
  const models = [];
  if (hasGoogleCloudCredential() || hasSamsarCredential()) {
    models.push('LYRIA3');
  }
  if (hasElevenLabsCredential() || hasFalCredential() || hasSamsarCredential()) {
    models.push('ELEVENLABS_MUSIC');
  }
  return models;
}

export function isDockerBackingTrackModelAvailable(model) {
  if (!isDockerAudioAvailabilityFilteringEnabled()) {
    return true;
  }
  const normalizedModel = normalizeBackingTrackModel(model);
  return getAvailableDockerBackingTrackModels().includes(normalizedModel);
}

export function resolveDockerBackingTrackModel(model, fallbackModel = 'ELEVENLABS_MUSIC') {
  const normalizedModel = normalizeBackingTrackModel(model || fallbackModel);
  if (!isDockerAudioAvailabilityFilteringEnabled()) {
    return normalizedModel;
  }

  if (isDockerBackingTrackModelAvailable(normalizedModel)) {
    return normalizedModel;
  }

  const normalizedFallback = normalizeBackingTrackModel(fallbackModel);
  if (isDockerBackingTrackModelAvailable(normalizedFallback)) {
    return normalizedFallback;
  }

  const available = getAvailableDockerBackingTrackModels();
  if (available.includes('ELEVENLABS_MUSIC')) return 'ELEVENLABS_MUSIC';
  if (available.includes('LYRIA3')) return 'LYRIA3';
  return normalizedModel;
}

function makeDockerAvailabilityError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'DOCKER_AUDIO_PROVIDER_UNAVAILABLE';
  return error;
}

export function assertDockerTTSProviderAvailable(ttsProvider) {
  if (!ttsProvider || !isDockerAudioAvailabilityFilteringEnabled()) {
    return;
  }

  const normalizedProvider = normalizeKey(ttsProvider);
  if (normalizedProvider === TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH) {
    return;
  }

  if (!isDockerTTSProviderAvailable(normalizedProvider)) {
    throw makeDockerAvailabilityError(
      `tts_model ${normalizedProvider} is not available for this Docker installation. Configure the matching provider or Samsar API key.`
    );
  }
}

export function assertDockerBackingTrackModelAvailable(model) {
  if (!model || !isDockerAudioAvailabilityFilteringEnabled()) {
    return;
  }

  const normalizedModel = normalizeBackingTrackModel(model);
  if (!isDockerBackingTrackModelAvailable(normalizedModel)) {
    throw makeDockerAvailabilityError(
      `backingtrack_model ${normalizedModel} is not available for this Docker installation. Configure the matching provider or Samsar API key.`
    );
  }
}

export function resolveDockerTTSProvider(ttsProvider, fallbackProvider = null) {
  const normalizedProvider = normalizeKey(ttsProvider);
  if (!isDockerAudioAvailabilityFilteringEnabled()) {
    return normalizedProvider || ttsProvider;
  }

  if (!normalizedProvider || normalizedProvider === TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH) {
    return normalizedProvider || ttsProvider;
  }

  if (isDockerTTSProviderAvailable(normalizedProvider)) {
    return normalizedProvider;
  }

  const normalizedFallback = normalizeKey(fallbackProvider);
  if (normalizedFallback && isDockerTTSProviderAvailable(normalizedFallback)) {
    return normalizedFallback;
  }

  return pickDefaultDockerTTSProvider() || normalizedProvider;
}
