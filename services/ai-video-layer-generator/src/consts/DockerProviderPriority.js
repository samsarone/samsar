import fs from 'node:fs';
import path from 'node:path';
import { isStandaloneEdition } from '../utils/Environment.js';

export const DOCKER_VIDEO_PROVIDER = Object.freeze({
  ALIBABA_CLOUD: 'alibabaCloud',
  GOOGLE_CLOUD: 'googleCloud',
  FAL: 'fal',
  RUNWAY: 'runway',
  SAMSAR: 'samsar',
});

export const DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  'VEO3.1': [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ],
  'VEO3.1FAST': [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ],
  'VEO3.1I2V': [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ],
  'VEO3.1I2VFAST': [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ],
  RUNWAYML: [
    DOCKER_VIDEO_PROVIDER.RUNWAY,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ],
  HAPPYHORSEI2V: [
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
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
  'SEEDANCE2.0T2V',
  'SEEDANCET2V',
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
  'SEEDANCE2.0T2V',
  'SEEDANCET2V',
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

function getSavedVideoProviderPriority(model) {
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

export function normalizeVideoModelKey(model) {
  return normalizeString(model).toUpperCase();
}

function hasEnvCredential(...keys) {
  return keys.some((key) => Boolean(normalizeString(process.env[key])));
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
  return false;
}

export function getDockerVideoProviderPriority(model, { generationType = '' } = {}) {
  const normalizedModel = normalizeVideoModelKey(model);
  const normalizedGenerationType = normalizeString(generationType).toLowerCase();

  if (normalizedGenerationType === 'lip_sync' || DOCKER_FAL_LIP_SYNC_MODELS.includes(normalizedModel)) {
    return [DOCKER_VIDEO_PROVIDER.FAL, DOCKER_VIDEO_PROVIDER.SAMSAR];
  }

  const savedPriority = getSavedVideoProviderPriority(normalizedModel);
  if (normalizedGenerationType !== 'sound_effect' && savedPriority.length > 0) {
    return savedPriority;
  }

  if (
    normalizedGenerationType === 'sound_effect' ||
    DOCKER_FAL_SOUND_EFFECT_MODELS.includes(normalizedModel)
  ) {
    const modelPriority = DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel] || [];
    return modelPriority.length
      ? [...modelPriority]
      : [DOCKER_VIDEO_PROVIDER.FAL, DOCKER_VIDEO_PROVIDER.SAMSAR];
  }

  if (DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel]) {
    return DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel];
  }

  if (DOCKER_FAL_VIDEO_MODELS.includes(normalizedModel) || normalizedModel.startsWith('KLING')) {
    return [DOCKER_VIDEO_PROVIDER.FAL, DOCKER_VIDEO_PROVIDER.SAMSAR];
  }

  return hasSamsarVideoCredential() ? [DOCKER_VIDEO_PROVIDER.SAMSAR] : [];
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
  const currentIndex = providers.indexOf(normalizedCurrentProvider);
  if (currentIndex < 0) {
    return providers.find((provider) => provider !== normalizedCurrentProvider) || '';
  }
  return providers.slice(currentIndex + 1).find(Boolean) || '';
}

export function promoteDockerVideoProvider(model, provider) {
  if (!isDockerVideoProviderRoutingEnabled()) {
    return false;
  }
  const normalizedModel = normalizeVideoModelKey(model);
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedModel || !normalizedProvider || !isVideoProviderConfigured(normalizedProvider)) {
    return false;
  }

  const { filePath, value } = readAvailableModelsConfig();
  if (!value || !filePath) {
    return false;
  }
  const modelProviders = value.modelProviders && typeof value.modelProviders === 'object'
    ? { ...value.modelProviders }
    : {};
  const modelProviderPriority = value.modelProviderPriority &&
    typeof value.modelProviderPriority === 'object'
    ? { ...value.modelProviderPriority }
    : {};
  const existingPriority = uniqueProviders(
    getSavedModelProviderEntry(modelProviderPriority, normalizedModel) ||
      DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel] ||
      [],
  );
  const existingModelKey = Object.keys(modelProviders).find(
    (key) => normalizeVideoModelKey(key) === normalizedModel,
  ) || normalizedModel;
  const existingPriorityKey = Object.keys(modelProviderPriority).find(
    (key) => normalizeVideoModelKey(key) === normalizedModel,
  ) || normalizedModel;

  modelProviders[existingModelKey] = normalizedProvider;
  modelProviderPriority[existingPriorityKey] = [
    normalizedProvider,
    ...existingPriority.filter((candidate) => candidate !== normalizedProvider),
  ];
  const nextValue = {
    ...value,
    providers: [...new Set([...(Array.isArray(value.providers) ? value.providers : []), normalizedProvider])],
    modelProviders,
    modelProviderPriority,
  };
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const fileMode = fs.statSync(filePath).mode & 0o777;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(nextValue, null, 2)}\n`, { mode: fileMode });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
  return true;
}
