import fs from 'fs';

import { isStandaloneEdition } from '../util/environmentUtils.js';

const DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH =
  '/persistent/config/model-adapter-preferences.json';

export const DOCKER_AUDIO_PROVIDER = Object.freeze({
  GOOGLE_CLOUD: 'googleCloud',
  OPENAI: 'openai',
  FAL: 'fal',
  ELEVENLABS: 'elevenlabs',
  REPLICATE: 'replicate',
  SAMSAR: 'samsar',
  GMICLOUD: 'gmicloud',
  CUSTOM: 'custom',
});

export const GENBLAZE_SPEECH_MODEL_BY_TTS_PROVIDER = Object.freeze({
  OPENAI: 'OPENAI_TTS',
  ELEVENLABS: 'ELEVENLABS',
});

const GOOGLE_NATIVE_CREDENTIAL_KEYS = Object.freeze([
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

const GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS = Object.freeze([
  'K_SERVICE',
  'GAE_SERVICE',
  'FUNCTION_TARGET',
  'GCE_METADATA_HOST',
]);

export const DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER = Object.freeze({
  OPENAI: Object.freeze([
    DOCKER_AUDIO_PROVIDER.OPENAI,
    DOCKER_AUDIO_PROVIDER.GMICLOUD,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
  GOOGLE: Object.freeze([
    DOCKER_AUDIO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
  // Samsar's ElevenLabs speaker ids are credential-scoped. A credential-bound
  // GMICloud model route does not guarantee those voices, so use Samsar-js as
  // the configured fallback instead of sending these requests to GenBlaze.
  ELEVENLABS: Object.freeze([
    DOCKER_AUDIO_PROVIDER.ELEVENLABS,
    DOCKER_AUDIO_PROVIDER.FAL,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
  PLAYAI: Object.freeze([
    DOCKER_AUDIO_PROVIDER.FAL,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
});

export const DOCKER_MUSIC_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  LYRIA3: Object.freeze([
    DOCKER_AUDIO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
  LYRIA2: Object.freeze([
    DOCKER_AUDIO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
  ELEVENLABS_MUSIC: Object.freeze([
    DOCKER_AUDIO_PROVIDER.ELEVENLABS,
    DOCKER_AUDIO_PROVIDER.FAL,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
  CASSETTEAI: Object.freeze([
    DOCKER_AUDIO_PROVIDER.FAL,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
  AUDIOCRAFT: Object.freeze([
    DOCKER_AUDIO_PROVIDER.REPLICATE,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
});

export const DOCKER_SOUND_EFFECT_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  SDAUDIO: Object.freeze([
    DOCKER_AUDIO_PROVIDER.FAL,
    DOCKER_AUDIO_PROVIDER.SAMSAR,
  ]),
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return normalizeString(value).toUpperCase();
}

function uniqueAudioAdapters(value) {
  const adapters = Array.isArray(value) ? value : [];
  return [...new Set(adapters.map(normalizeAudioAdapter).filter(Boolean))];
}

function readSavedAudioAdapterPriority(modelKeys = []) {
  if (!isStandaloneEdition()) {
    return [];
  }

  const filePath = normalizeString(process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH) ||
    DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH;
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const priorityMap = parsed?.modelProviderPriority || parsed?.model_provider_priority;
    if (!priorityMap || typeof priorityMap !== 'object' || Array.isArray(priorityMap)) {
      return [];
    }
    const normalizedModelKeys = new Set(modelKeys.map(normalizeKey).filter(Boolean));
    const matchingEntry = Object.entries(priorityMap).find(
      ([modelKey]) => normalizedModelKeys.has(normalizeKey(modelKey)),
    );
    return uniqueAudioAdapters(matchingEntry?.[1]);
  } catch {
    return [];
  }
}

function applySavedAudioAdapterPriority(defaultPriority, modelKeys = []) {
  if (!isStandaloneEdition()) {
    return defaultPriority;
  }
  const normalizedDefault = uniqueAudioAdapters(defaultPriority);
  const compatibleAdapters = new Set(normalizedDefault);
  const savedPriority = readSavedAudioAdapterPriority(modelKeys)
    .filter((adapter) => compatibleAdapters.has(adapter));
  if (savedPriority.length === 0) {
    return defaultPriority;
  }
  return [
    ...savedPriority,
    ...normalizedDefault.filter((adapter) => !savedPriority.includes(adapter)),
  ];
}

export function normalizeAudioAdapter(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['google', 'googlecloud', 'gcp', 'vertex', 'vertexai'].includes(normalized)) {
    return DOCKER_AUDIO_PROVIDER.GOOGLE_CLOUD;
  }
  if (['gmi', 'gmicloud', 'genblaze'].includes(normalized)) {
    return DOCKER_AUDIO_PROVIDER.GMICLOUD;
  }
  if (['elevenlabs', 'elevenlabsnative', 'nativeelevenlabs'].includes(normalized)) {
    return DOCKER_AUDIO_PROVIDER.ELEVENLABS;
  }
  if (['custom', 'customadapter'].includes(normalized)) {
    return DOCKER_AUDIO_PROVIDER.CUSTOM;
  }
  return Object.values(DOCKER_AUDIO_PROVIDER).find((provider) => (
    provider.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized
  )) || '';
}

function isTruthyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isFalseyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off';
}

function hasEnvCredential(...keys) {
  return keys.some((key) => Boolean(normalizeString(process.env[key])));
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

export function hasReplicateCredential() {
  return hasEnvCredential('REPLICATE_API_TOKEN', 'REPLICATE_API_KEY');
}

export function hasSamsarCredential() {
  return hasEnvCredential('SAMSAR_API_KEY');
}

export function getGenBlazeSpeechLogicalModel(ttsProvider) {
  return GENBLAZE_SPEECH_MODEL_BY_TTS_PROVIDER[normalizeKey(ttsProvider)] || '';
}

export function getGenBlazeSpeechModelMapping(ttsProvider, env = process.env) {
  if (!isTruthyEnv(env.SAMSAR_GENBLAZE_ENABLED)) {
    return null;
  }

  const logicalModel = getGenBlazeSpeechLogicalModel(ttsProvider);
  const catalogPath = normalizeString(env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH);
  if (!logicalModel || !catalogPath) {
    return null;
  }

  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const route = catalog?.models?.[logicalModel]?.audio;
    const modelId = normalizeString(route?.modelId);
    const operation = normalizeString(route?.operation);
    if (!modelId || (operation && operation !== 'audio.generate')) {
      return null;
    }
    return Object.freeze({
      logicalModel,
      modelId,
      operation: operation || 'audio.generate',
    });
  } catch {
    return null;
  }
}

export function hasGenBlazeSpeechModelMapping(ttsProvider, env = process.env) {
  return Boolean(getGenBlazeSpeechModelMapping(ttsProvider, env));
}

export function hasGoogleCloudCredential() {
  if (hasEnvCredential(...GOOGLE_NATIVE_CREDENTIAL_KEYS)) {
    return true;
  }

  const hasProject = hasEnvCredential(
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_PROJECT_ID',
    'GCP_PROJECT',
    'GCLOUD_PROJECT',
    'PROJECT_ID',
  );

  return hasProject && hasEnvCredential(...GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS);
}

function hasProviderCredential(provider) {
  if (provider === DOCKER_AUDIO_PROVIDER.OPENAI) return hasOpenAICredential();
  if (provider === DOCKER_AUDIO_PROVIDER.GOOGLE_CLOUD) return hasGoogleCloudCredential();
  if (provider === DOCKER_AUDIO_PROVIDER.FAL) return hasFalCredential();
  if (provider === DOCKER_AUDIO_PROVIDER.ELEVENLABS) return hasElevenLabsCredential();
  if (provider === DOCKER_AUDIO_PROVIDER.REPLICATE) return hasReplicateCredential();
  if (provider === DOCKER_AUDIO_PROVIDER.SAMSAR) return hasSamsarCredential();
  return false;
}

export function isDockerAudioProviderRoutingEnabled() {
  if (isFalseyEnv(process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED)) {
    return false;
  }
  if (isTruthyEnv(process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED)) {
    return true;
  }
  return isStandaloneEdition();
}

export function shouldForceSamsarExternalAudioProvider() {
  return hasSamsarCredential() && isTruthyEnv(process.env.SAMSAR_FORCE_EXTERNAL_AUDIO);
}

function isPendingExternalAudioRequest(payload = {}) {
  return normalizeKey(payload?.status || 'INIT') === 'PENDING' &&
    Boolean(normalizeString(payload?.externalAudioRoute));
}

function isPendingGenBlazeSpeechRequest(payload = {}) {
  if (normalizeKey(payload?.status || 'INIT') !== 'PENDING') {
    return false;
  }

  const selectedProvider = normalizeString(
    payload?.externalProvider || payload?.audioAdapterProvider,
  ).toLowerCase().replace(/[^a-z0-9]/g, '');
  return Boolean(normalizeString(payload?.genblazeRequestId)) ||
    ['gmi', 'gmicloud', 'genblaze'].includes(selectedProvider);
}

function resolvePriority(priority, payload = {}, options = {}) {
  const status = normalizeKey(payload?.status || 'INIT');
  const submittedAdapter = normalizeAudioAdapter(payload?.submittedAdapter);
  if (status === 'PENDING' && submittedAdapter) {
    return submittedAdapter;
  }

  if (isPendingGenBlazeSpeechRequest(payload)) {
    return DOCKER_AUDIO_PROVIDER.GMICLOUD;
  }

  if (isPendingExternalAudioRequest(payload)) {
    return hasSamsarCredential() ? DOCKER_AUDIO_PROVIDER.SAMSAR : '';
  }

  if (status !== 'INIT') {
    return '';
  }

  if (shouldForceSamsarExternalAudioProvider()) {
    return DOCKER_AUDIO_PROVIDER.SAMSAR;
  }

  if (!isDockerAudioProviderRoutingEnabled()) {
    return '';
  }

  for (const provider of priority || []) {
    if (provider === DOCKER_AUDIO_PROVIDER.GMICLOUD) {
      if (hasGenBlazeSpeechModelMapping(options.ttsProvider)) {
        return provider;
      }
      continue;
    }
    if (hasProviderCredential(provider)) {
      return provider;
    }
  }

  return '';
}

export function resolveDockerSpeechProvider(ttsProvider, payload = {}) {
  const normalizedTtsProvider = normalizeKey(ttsProvider);
  const priority = applySavedAudioAdapterPriority(
    DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER[normalizedTtsProvider],
    [payload?.model, normalizedTtsProvider, getGenBlazeSpeechLogicalModel(normalizedTtsProvider)],
  );
  return resolvePriority(priority, payload, { ttsProvider });
}

export function resolveDockerMusicProvider(model, payload = {}) {
  const normalizedModel = normalizeKey(model);
  const priority = applySavedAudioAdapterPriority(
    DOCKER_MUSIC_PROVIDER_PRIORITY_BY_MODEL[normalizedModel],
    [normalizedModel],
  );
  return resolvePriority(priority, payload);
}

export function resolveDockerSoundEffectProvider(model, payload = {}) {
  const normalizedModel = normalizeKey(model);
  const priority = applySavedAudioAdapterPriority(
    DOCKER_SOUND_EFFECT_PROVIDER_PRIORITY_BY_MODEL[normalizedModel],
    [normalizedModel],
  );
  return resolvePriority(priority, payload);
}

export function hasDockerSpeechProviderPriority(ttsProvider) {
  return Boolean(DOCKER_SPEECH_PROVIDER_PRIORITY_BY_TTS_PROVIDER[normalizeKey(ttsProvider)]);
}

export function hasDockerMusicProviderPriority(model) {
  return Boolean(DOCKER_MUSIC_PROVIDER_PRIORITY_BY_MODEL[normalizeKey(model)]);
}

export function hasDockerSoundEffectProviderPriority(model) {
  return Boolean(DOCKER_SOUND_EFFECT_PROVIDER_PRIORITY_BY_MODEL[normalizeKey(model)]);
}

export function isInitialDockerAudioRoutingRequest(payload = {}) {
  return isDockerAudioProviderRoutingEnabled() &&
    normalizeKey(payload?.status || 'INIT') === 'INIT';
}
