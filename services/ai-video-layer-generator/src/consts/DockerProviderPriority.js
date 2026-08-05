import fs from 'node:fs';
import path from 'node:path';
import { isStandaloneEdition } from '../utils/Environment.js';

export const DOCKER_VIDEO_PROVIDER = Object.freeze({
  ALIBABA_CLOUD: 'alibabaCloud',
  GOOGLE_CLOUD: 'googleCloud',
  FAL: 'fal',
  RUNWAY: 'runway',
  SAMSAR: 'samsar',
  GMICLOUD: 'gmicloud',
});

export const DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  'VEO3.1': [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  'VEO3.1FAST': [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  'VEO3.1I2V': [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  'VEO3.1I2VFAST': [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  'VEO3.1FLIV': [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  RUNWAYML: [
    DOCKER_VIDEO_PROVIDER.RUNWAY,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ],
  HAPPYHORSEI2V: [
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  SEEDANCEI2V: [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  'SEEDANCE2.0I2V': [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  KLINGIMGTOVID3PRO: [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  KLINGIMGTOVIDTURBO: [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  KLINGIMGTOVIDPRO: [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  'KLINGIMGTOVID2.1MASTER': [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  'KLINGIMGTOVID2.1PRO': [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  'KLINGIMGTOVID2.1STANDARD': [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
  HAILUOPRO: [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ],
});

export const DOCKER_FAL_VIDEO_MODELS = Object.freeze([
  'SDVIDEO',
  'KLINGIMGTOVID3PRO',
  'KLINGIMGTOVIDTURBO',
  'KLING',
  'HAILUOPRO',
  'HAIPER2.0',
  'SKYREELSI2V',
  'VEO',
  'PIXVERSEI2V',
  'PIXVERSEI2VFAST',
  'WANI2V',
  'WANI2V5B',
  'VEOI2V',
  'PIKA2.2I2V',
  'MAGIDISTILLED',
  'VIDUI2V',
  'SEEDANCEI2V',
  'SEEDANCE2.0I2V',
  'HAPPYHORSEI2V',
  'MIRELOAI',
  'COSMOS3SUPERI2V',
  'VEO3.1FLIV',
]);

export const DOCKER_FAL_LIP_SYNC_MODELS = Object.freeze([
  'SYNCLIPSYNC',
  'LATENTSYNC',
  'KLINGLIPSYNC',
  'HUMMINGBIRDLIPSYNC',
  'CREATIFYLIPSYNC',
]);

export const DOCKER_FAL_SOUND_EFFECT_MODELS = Object.freeze([
  'MMAUDIOV2',
  'MIRELOAI',
  'SEEDANCEI2V',
  'SEEDANCE2.0I2V',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
]);

const GOOGLE_CLOUD_CREDENTIAL_KEYS = Object.freeze([
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

const GOOGLE_CLOUD_PROJECT_KEYS = Object.freeze([
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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAvailableModelsPath() {
  return normalizeString(process.env.SAMSAR_AVAILABLE_MODELS_PATH) ||
    (isDockerVideoProviderRoutingEnabled()
      ? '/persistent/config/available-models.json'
      : path.join(process.cwd(), 'runtime', 'config', 'available-models.json'));
}

function getModelAdapterPreferencesPath() {
  return normalizeString(process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH) ||
    '/persistent/config/model-adapter-preferences.json';
}

function normalizeProvider(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['alibaba', 'alibabacloud', 'dashscope', 'qwen'].includes(normalized)) {
    return DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD;
  }
  if (['google', 'googlecloud', 'vertex', 'vertexai'].includes(normalized)) {
    return DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD;
  }
  if (normalized === 'fal') {
    return DOCKER_VIDEO_PROVIDER.FAL;
  }
  if (['runway', 'runwayml'].includes(normalized)) {
    return DOCKER_VIDEO_PROVIDER.RUNWAY;
  }
  if (normalized === 'samsar') {
    return DOCKER_VIDEO_PROVIDER.SAMSAR;
  }
  if (['gmi', 'gmicloud', 'genblaze'].includes(normalized)) {
    return DOCKER_VIDEO_PROVIDER.GMICLOUD;
  }
  return '';
}

function readAvailableModelsConfig() {
  const filePath = getAvailableModelsPath();
  if (!fs.existsSync(filePath)) {
    return { filePath, value: null };
  }
  try {
    return { filePath, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch {
    return { filePath, value: null };
  }
}

function getSavedModelProviderEntry(entries = {}, normalizedModel = '') {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return undefined;
  }
  const matchingKey = Object.keys(entries).find(
    (key) => normalizeVideoModelKey(key) === normalizedModel,
  );
  return matchingKey ? entries[matchingKey] : undefined;
}

function uniqueProviders(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(normalizeProvider).filter(Boolean))];
}

function applyHostedFalPriority(priority = []) {
  const normalizedPriority = uniqueProviders(priority);
  const falIndex = normalizedPriority.indexOf(DOCKER_VIDEO_PROVIDER.FAL);
  const samsarIndex = normalizedPriority.indexOf(DOCKER_VIDEO_PROVIDER.SAMSAR);
  if (falIndex < 0 || samsarIndex < 0 || falIndex < samsarIndex) {
    return normalizedPriority;
  }
  normalizedPriority.splice(falIndex, 1);
  normalizedPriority.splice(samsarIndex, 0, DOCKER_VIDEO_PROVIDER.FAL);
  return normalizedPriority;
}

function getLegacySavedVideoProviderPriority(model) {
  if (!isDockerVideoProviderRoutingEnabled()) {
    return [];
  }
  const normalizedModel = normalizeVideoModelKey(model);
  const { value } = readAvailableModelsConfig();
  if (!value) {
    return [];
  }
  const savedPriority = uniqueProviders(
    getSavedModelProviderEntry(value.modelProviderPriority, normalizedModel),
  );
  const savedPrimary = normalizeProvider(
    getSavedModelProviderEntry(value.modelProviders, normalizedModel),
  );
  return savedPrimary
    ? [savedPrimary, ...savedPriority.filter((provider) => provider !== savedPrimary)]
    : savedPriority;
}

function getStandaloneVideoProviderPreference(model) {
  if (!isStandaloneEdition()) {
    return [];
  }
  const filePath = getModelAdapterPreferencesPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return uniqueProviders(
      getSavedModelProviderEntry(
        value?.modelProviderPriority || value?.model_provider_priority,
        normalizeVideoModelKey(model),
      ),
    );
  } catch (error) {
    console.error('[docker_video_provider_priority] failed to read model adapter preferences', {
      filePath,
      message: error?.message || String(error),
    });
    return [];
  }
}

function applyProviderPreferenceOrder(defaultPriority = [], savedPreference = []) {
  const normalizedDefault = uniqueProviders(defaultPriority);
  const allowedProviders = new Set(normalizedDefault);
  const preferredProviders = uniqueProviders(savedPreference)
    .filter((provider) => allowedProviders.has(provider));
  return [
    ...preferredProviders,
    ...normalizedDefault.filter((provider) => !preferredProviders.includes(provider)),
  ];
}

export function normalizeVideoModelKey(model) {
  return normalizeString(model).toUpperCase();
}

function hasEnvCredential(...keys) {
  return keys.some((key) => Boolean(normalizeString(process.env[key])));
}

export function hasGmiCloudVideoModelMapping(model, env = process.env) {
  const catalogPath = normalizeString(env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH);
  if (!catalogPath) return false;
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (normalizeProvider(catalog?.provider) !== DOCKER_VIDEO_PROVIDER.GMICLOUD) {
      return false;
    }
    const normalizedModel = normalizeVideoModelKey(model);
    const route = catalog?.models?.[normalizedModel]?.video;
    const modelId = normalizeString(route?.modelId);
    if (!modelId) return false;
    if (normalizedModel === 'SEEDANCE2.0I2V') {
      return modelId === 'seedance-2-0-260128' && route?.operation === 'video.generate';
    }
    return true;
  } catch {
    return false;
  }
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function isFalseyEnv(value) {
  return ['0', 'false', 'no', 'off'].includes(normalizeString(value).toLowerCase());
}

export function isDockerVideoProviderRoutingEnabled() {
  if (isFalseyEnv(process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED)) {
    return false;
  }
  if (isTruthyEnv(process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED)) {
    return true;
  }
  return isStandaloneEdition() || normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'staging';
}

export function hasGoogleCloudVideoCredential() {
  if (hasEnvCredential(...GOOGLE_CLOUD_CREDENTIAL_KEYS)) {
    return true;
  }
  return hasEnvCredential(...GOOGLE_CLOUD_PROJECT_KEYS) &&
    hasEnvCredential(...GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS);
}

export function hasFalVideoCredential() {
  return hasEnvCredential('FAL_API_KEY');
}

export function hasAlibabaCloudVideoCredential() {
  return hasEnvCredential(
    'ALIBABA_API_KEY',
    'DASHSCOPE_API_KEY',
    'ALIBABA_CLOUD_API_KEY',
    'QWEN_API_KEY',
  );
}

export function hasRunwayVideoCredential() {
  return hasEnvCredential('RUNWAY_API_KEY', 'RUNWAYML_API_KEY');
}

export function hasSamsarVideoCredential() {
  return hasEnvCredential('SAMSAR_API_KEY');
}

export function hasGmiCloudVideoCredential(env = process.env) {
  return isTruthyEnv(env.SAMSAR_GENBLAZE_ENABLED);
}

export function isVideoProviderConfigured(provider) {
  if (provider === DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD) {
    return hasAlibabaCloudVideoCredential();
  }
  if (provider === DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD) {
    return hasGoogleCloudVideoCredential();
  }
  if (provider === DOCKER_VIDEO_PROVIDER.FAL) {
    return hasFalVideoCredential();
  }
  if (provider === DOCKER_VIDEO_PROVIDER.RUNWAY) {
    return hasRunwayVideoCredential();
  }
  if (provider === DOCKER_VIDEO_PROVIDER.SAMSAR) {
    return hasSamsarVideoCredential();
  }
  if (provider === DOCKER_VIDEO_PROVIDER.GMICLOUD) {
    return hasGmiCloudVideoCredential();
  }
  return false;
}

export function getDockerVideoProviderPriority(model, { generationType = '' } = {}) {
  const normalizedModel = normalizeVideoModelKey(model);
  const normalizedGenerationType = normalizeString(generationType).toLowerCase();

  if (normalizedGenerationType === 'lip_sync' || DOCKER_FAL_LIP_SYNC_MODELS.includes(normalizedModel)) {
    return [DOCKER_VIDEO_PROVIDER.FAL, DOCKER_VIDEO_PROVIDER.SAMSAR];
  }

  let defaultPriority;
  if (
    normalizedGenerationType === 'sound_effect' ||
    DOCKER_FAL_SOUND_EFFECT_MODELS.includes(normalizedModel)
  ) {
    const modelPriority = DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel] || [];
    defaultPriority = modelPriority.length
      ? [...modelPriority]
      : [DOCKER_VIDEO_PROVIDER.FAL, DOCKER_VIDEO_PROVIDER.SAMSAR];
  } else if (DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel]) {
    defaultPriority = [...DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel]];
  } else if (DOCKER_FAL_VIDEO_MODELS.includes(normalizedModel) || normalizedModel.startsWith('KLING')) {
    defaultPriority = [DOCKER_VIDEO_PROVIDER.FAL, DOCKER_VIDEO_PROVIDER.SAMSAR];
  } else {
    defaultPriority = hasSamsarVideoCredential() ? [DOCKER_VIDEO_PROVIDER.SAMSAR] : [];
  }

  if (!isStandaloneEdition()) {
    defaultPriority = applyHostedFalPriority(defaultPriority)
      .filter((provider) => provider !== DOCKER_VIDEO_PROVIDER.GMICLOUD);
  }
  if (!hasGmiCloudVideoModelMapping(normalizedModel)) {
    defaultPriority = defaultPriority.filter(
      (provider) => provider !== DOCKER_VIDEO_PROVIDER.GMICLOUD,
    );
  }

  if (normalizedGenerationType === 'sound_effect') {
    return defaultPriority;
  }

  if (isStandaloneEdition()) {
    return applyProviderPreferenceOrder(
      defaultPriority,
      getStandaloneVideoProviderPreference(normalizedModel),
    );
  }

  // Preserve the existing staging/explicit-routing behavior. Standalone
  // installations use the administrator-owned preference file above.
  const legacySavedPriority = getLegacySavedVideoProviderPriority(normalizedModel);
  return legacySavedPriority.length > 0 ? legacySavedPriority : defaultPriority;
}

export function resolveConfiguredVideoProvider(providerPriority = []) {
  return providerPriority.find(isVideoProviderConfigured) || '';
}

export function resolveDockerVideoProvider(model, options = {}) {
  if (!isDockerVideoProviderRoutingEnabled()) {
    return '';
  }
  const providerPriority = getDockerVideoProviderPriority(model, options);
  const preferredProvider = normalizeProvider(options.preferredProvider);
  if (
    preferredProvider &&
    providerPriority.includes(preferredProvider) &&
    isVideoProviderConfigured(preferredProvider)
  ) {
    return preferredProvider;
  }
  return resolveConfiguredVideoProvider(providerPriority);
}

export function getConfiguredDockerVideoProviders(model, options = {}) {
  if (!isDockerVideoProviderRoutingEnabled()) {
    return [];
  }
  return getDockerVideoProviderPriority(model, options).filter(isVideoProviderConfigured);
}

export function resolveNextDockerVideoProvider(model, currentProvider, options = {}) {
  const providers = getConfiguredDockerVideoProviders(model, options);
  const normalizedCurrentProvider = normalizeProvider(currentProvider);
  const attemptedProviders = new Set(
    uniqueProviders(options.attemptedProviders || options.excludeProviders || []),
  );
  const currentIndex = providers.indexOf(normalizedCurrentProvider);
  if (currentIndex < 0) {
    return providers.find(
      (provider) => provider !== normalizedCurrentProvider && !attemptedProviders.has(provider),
    ) || '';
  }
  return providers.slice(currentIndex + 1).find(
    (provider) => !attemptedProviders.has(provider),
  ) || '';
}
