import fs from 'node:fs';

import { getDeploymentEdition, isStandaloneEdition } from '../utils/Environment.js';

export const DOCKER_ADAPTER_PROVIDER = Object.freeze({
  ALIBABA_CLOUD: 'alibabaCloud',
  GOOGLE_CLOUD: 'googleCloud',
  FAL: 'fal',
  OPENAI: 'openai',
  SAMSAR: 'samsar',
  GMICLOUD: 'gmicloud',
});

const ALIBABA_QWEN_IMAGE_3_PRO_KEY_TYPES = new Set([
  '',
  'pay_as_you_go',
]);
const ALIBABA_QWEN_IMAGE_3_PRO_ENDPOINT_TYPES = new Set([
  '',
  'pay_as_you_go',
]);

export const DOCKER_IMAGE_GENERATION_PROVIDER_PRIORITY = Object.freeze({
  QWENIMAGE3PRO: [
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
  ],
  'WAN2.7PRO': [
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  NANOBANANA2: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
    DOCKER_ADAPTER_PROVIDER.FAL,
  ],
  NANOBANANAPRO: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
    DOCKER_ADAPTER_PROVIDER.FAL,
  ],
  GPTIMAGE2: [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
    DOCKER_ADAPTER_PROVIDER.FAL,
  ],
  SEEDREAM: [
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  GPTIMAGE1: [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  DALLE3: [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  IMAGEN3: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  IMAGEN3FLASH: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  GEMMA3: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
});

export const DOCKER_IMAGE_EDIT_PROVIDER_PRIORITY = Object.freeze({
  NANOBANANA2EDIT: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  NANOBANANAPROEDIT: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  NANOBANANAEDIT: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  GPTIMAGE2EDIT: [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  GPTIMAGE1EDIT: [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  BRIA_ERASER: [
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  BRIA_GENFILL: [
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
});

export const DOCKER_FAL_IMAGE_GENERATION_MODELS = Object.freeze([
  'FLUX1PRO',
  'FLUX1DEV',
  'FLUX1.1PRO',
  'FLUX1.1ULTRA',
  'RECRAFTV3',
  'RECRAFT20B',
  'SDV3.5',
  'SANA',
  'SANA4.5B',
  'SANASPRINT',
  'PHOTON',
  'PHOTONFLASH',
  'IMAGEN4',
  'LUMINAV2',
  'REVE',
  'IDEOGRAMV3',
  'HIDREAMI1',
  'FLITE',
  'SEEDREAM',
  'HUNYUAN',
]);

export const DOCKER_FAL_IMAGE_EDIT_MODELS = Object.freeze([
  'FLUX1PROFILL',
  'FLUX1.1PROULTRAREDUX',
  'FLUX1.1PROREDUX',
  'BRIA_ERASER',
  'BRIA_GENFILL',
  'BRIA_BACKGROUNDREMOVE',
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

const DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH =
  '/persistent/config/model-adapter-preferences.json';

const IMAGE_EDIT_PREFERENCE_MODEL_KEYS = Object.freeze({
  NANOBANANA2EDIT: 'NANOBANANA2',
  NANOBANANAPROEDIT: 'NANOBANANAPRO',
  NANOBANANAEDIT: 'NANOBANANA2',
  GPTIMAGE2EDIT: 'GPTIMAGE2',
  GPTIMAGE1EDIT: 'GPTIMAGE1',
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModelKey(model) {
  return normalizeString(model).toUpperCase();
}

function normalizeAdapterProvider(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['alibaba', 'alibabacloud', 'aliyun', 'dashscope', 'qwen'].includes(normalized)) {
    return DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD;
  }
  if (['google', 'googlecloud', 'gcp', 'vertex', 'vertexai'].includes(normalized)) {
    return DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD;
  }
  if (normalized === 'fal') {
    return DOCKER_ADAPTER_PROVIDER.FAL;
  }
  if (normalized === 'openai') {
    return DOCKER_ADAPTER_PROVIDER.OPENAI;
  }
  if (normalized === 'samsar') {
    return DOCKER_ADAPTER_PROVIDER.SAMSAR;
  }
  if (['gmi', 'gmicloud', 'genblaze'].includes(normalized)) {
    return DOCKER_ADAPTER_PROVIDER.GMICLOUD;
  }
  return '';
}

function uniqueAdapterProviders(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map(normalizeAdapterProvider).filter(Boolean))];
}

function applyHostedFalPriority(priority = []) {
  const normalizedPriority = uniqueAdapterProviders(priority);
  const falIndex = normalizedPriority.indexOf(DOCKER_ADAPTER_PROVIDER.FAL);
  const samsarIndex = normalizedPriority.indexOf(DOCKER_ADAPTER_PROVIDER.SAMSAR);
  if (falIndex < 0 || samsarIndex < 0 || falIndex < samsarIndex) {
    return normalizedPriority;
  }
  normalizedPriority.splice(falIndex, 1);
  normalizedPriority.splice(samsarIndex, 0, DOCKER_ADAPTER_PROVIDER.FAL);
  return normalizedPriority;
}

function getModelAdapterPreferencesPath() {
  return normalizeString(process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH) ||
    DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH;
}

function readSavedModelAdapterPriorityMap() {
  if (!isStandaloneEdition()) {
    return {};
  }

  const filePath = getModelAdapterPreferencesPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const priorityMap =
      parsed?.modelProviderPriority || parsed?.model_provider_priority;
    return priorityMap && typeof priorityMap === 'object' && !Array.isArray(priorityMap)
      ? priorityMap
      : {};
  } catch {
    return {};
  }
}

function findSavedModelAdapterPriority(priorityMap, modelKeys = []) {
  const normalizedModelKeys = [
    ...new Set(
      modelKeys.map(normalizeModelKey).filter(Boolean),
    ),
  ];
  if (normalizedModelKeys.length === 0) {
    return [];
  }

  for (const normalizedModelKey of normalizedModelKeys) {
    const matchingEntry = Object.entries(priorityMap).find(
      ([modelKey]) => normalizeModelKey(modelKey) === normalizedModelKey,
    );
    if (matchingEntry) {
      return uniqueAdapterProviders(matchingEntry[1]);
    }
  }
  return [];
}

function applySavedModelAdapterPriority(defaultPriority, modelKeys = []) {
  if (!isStandaloneEdition()) {
    return defaultPriority;
  }

  const normalizedDefaultPriority = uniqueAdapterProviders(defaultPriority);
  const compatibleProviders = new Set(normalizedDefaultPriority);
  const savedPriority = findSavedModelAdapterPriority(
    readSavedModelAdapterPriorityMap(),
    modelKeys,
  ).filter((provider) => compatibleProviders.has(provider));

  if (savedPriority.length === 0) {
    return defaultPriority;
  }

  return [
    ...savedPriority,
    ...normalizedDefaultPriority.filter((provider) => !savedPriority.includes(provider)),
  ];
}

function hasEnvCredential(...keys) {
  return keys.some((key) => Boolean(normalizeString(process.env[key])));
}

function hasGmiCloudModelMapping(model, modality = 'image', env = process.env) {
  const catalogPath = normalizeString(env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH);
  if (!catalogPath) return false;
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    return Boolean(normalizeString(catalog?.models?.[normalizeModelKey(model)]?.[modality]?.modelId));
  } catch {
    return false;
  }
}

function isFalseyEnv(value) {
  return ['0', 'false', 'no', 'off'].includes(normalizeString(value).toLowerCase());
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

export function isDockerAdapterRoutingEnabled() {
  if (isFalseyEnv(process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED)) {
    return false;
  }
  if (isTruthyEnv(process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED)) {
    return true;
  }
  return isStandaloneEdition() || normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'staging';
}

export function hasOpenAIAdapterCredential() {
  return hasEnvCredential('OPENAI_API_KEY');
}

export function hasFalAdapterCredential() {
  return hasEnvCredential('FAL_API_KEY');
}

export function hasAlibabaCloudAdapterCredential() {
  return hasEnvCredential(
    'ALIBABA_API_KEY',
    'DASHSCOPE_API_KEY',
    'ALIBABA_CLOUD_API_KEY',
    'QWEN_API_KEY',
  );
}

export function hasAlibabaQwenImage3ProCredential(env = process.env) {
  const hasApiKey = [
    'ALIBABA_API_KEY',
    'DASHSCOPE_API_KEY',
    'ALIBABA_CLOUD_API_KEY',
    'QWEN_API_KEY',
  ].some((key) => Boolean(normalizeString(env?.[key])));
  if (!hasApiKey) {
    return false;
  }

  const keyType = normalizeString(env?.ALIBABA_API_KEY_TYPE).toLowerCase();
  const endpointType = normalizeString(env?.ALIBABA_API_ENDPOINT_TYPE).toLowerCase();
  return ALIBABA_QWEN_IMAGE_3_PRO_KEY_TYPES.has(keyType) &&
    ALIBABA_QWEN_IMAGE_3_PRO_ENDPOINT_TYPES.has(endpointType);
}

export function hasSamsarAdapterCredential() {
  return hasEnvCredential('SAMSAR_API_KEY');
}

export function hasGmiCloudAdapterCredential() {
  return isTruthyEnv(process.env.SAMSAR_GENBLAZE_ENABLED);
}

export function hasGoogleCloudAdapterCredential() {
  if (hasEnvCredential(...GOOGLE_CLOUD_CREDENTIAL_KEYS)) {
    return true;
  }

  return hasEnvCredential(...GOOGLE_CLOUD_PROJECT_KEYS) &&
    hasEnvCredential(...GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS);
}

export function isAdapterProviderConfigured(provider) {
  if (provider === DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD) {
    return hasAlibabaCloudAdapterCredential();
  }
  if (provider === DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD) {
    return hasGoogleCloudAdapterCredential();
  }
  if (provider === DOCKER_ADAPTER_PROVIDER.FAL) {
    return hasFalAdapterCredential();
  }
  if (provider === DOCKER_ADAPTER_PROVIDER.OPENAI) {
    return hasOpenAIAdapterCredential();
  }
  if (provider === DOCKER_ADAPTER_PROVIDER.SAMSAR) {
    return hasSamsarAdapterCredential();
  }
  if (provider === DOCKER_ADAPTER_PROVIDER.GMICLOUD) {
    return hasGmiCloudAdapterCredential();
  }
  return false;
}

export function getDockerImageGenerationProviderPriority(model) {
  const normalizedModel = normalizeModelKey(model);
  if (
    normalizedModel === 'QWENIMAGE3PRO' &&
    (!isDockerAdapterRoutingEnabled() || !hasAlibabaQwenImage3ProCredential())
  ) {
    return [];
  }
  let defaultPriority;
  if (
    normalizedModel === 'NANOBANANAPRO' &&
    getDeploymentEdition() === 'production'
  ) {
    defaultPriority = [
      DOCKER_ADAPTER_PROVIDER.FAL,
      DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
      DOCKER_ADAPTER_PROVIDER.SAMSAR,
    ];
  } else if (DOCKER_IMAGE_GENERATION_PROVIDER_PRIORITY[normalizedModel]) {
    defaultPriority = DOCKER_IMAGE_GENERATION_PROVIDER_PRIORITY[normalizedModel];
  } else if (DOCKER_FAL_IMAGE_GENERATION_MODELS.includes(normalizedModel)) {
    defaultPriority = [DOCKER_ADAPTER_PROVIDER.FAL, DOCKER_ADAPTER_PROVIDER.SAMSAR];
  } else {
    defaultPriority = hasSamsarAdapterCredential()
      ? [DOCKER_ADAPTER_PROVIDER.SAMSAR]
      : [];
  }

  let deploymentPriority = isStandaloneEdition()
    ? defaultPriority
    : applyHostedFalPriority(defaultPriority)
      .filter((provider) => provider !== DOCKER_ADAPTER_PROVIDER.GMICLOUD);
  if (!hasGmiCloudModelMapping(normalizedModel)) {
    deploymentPriority = deploymentPriority.filter(
      (provider) => provider !== DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    );
  }
  return applySavedModelAdapterPriority(deploymentPriority, [normalizedModel]);
}

export function getDockerImageEditProviderPriority(model) {
  const normalizedModel = normalizeModelKey(model);
  let defaultPriority;
  if (
    normalizedModel === 'NANOBANANAPROEDIT' &&
    getDeploymentEdition() === 'production'
  ) {
    defaultPriority = [
      DOCKER_ADAPTER_PROVIDER.FAL,
      DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
      DOCKER_ADAPTER_PROVIDER.SAMSAR,
    ];
  } else if (DOCKER_IMAGE_EDIT_PROVIDER_PRIORITY[normalizedModel]) {
    defaultPriority = DOCKER_IMAGE_EDIT_PROVIDER_PRIORITY[normalizedModel];
  } else if (
    DOCKER_FAL_IMAGE_EDIT_MODELS.includes(normalizedModel) ||
    normalizedModel.startsWith('FLUX')
  ) {
    defaultPriority = [DOCKER_ADAPTER_PROVIDER.FAL, DOCKER_ADAPTER_PROVIDER.SAMSAR];
  } else {
    defaultPriority = hasSamsarAdapterCredential()
      ? [DOCKER_ADAPTER_PROVIDER.SAMSAR]
      : [];
  }

  let deploymentPriority = isStandaloneEdition()
    ? defaultPriority
    : defaultPriority.filter((provider) => provider !== DOCKER_ADAPTER_PROVIDER.GMICLOUD);
  if (!hasGmiCloudModelMapping(normalizedModel)) {
    deploymentPriority = deploymentPriority.filter(
      (provider) => provider !== DOCKER_ADAPTER_PROVIDER.GMICLOUD,
    );
  }

  return applySavedModelAdapterPriority(deploymentPriority, [
    normalizedModel,
    IMAGE_EDIT_PREFERENCE_MODEL_KEYS[normalizedModel],
  ]);
}

export function resolveConfiguredProvider(providerPriority = []) {
  return providerPriority.find(isAdapterProviderConfigured) || '';
}

function getConfiguredProviders(providerPriority = []) {
  return providerPriority.filter(isAdapterProviderConfigured);
}

function resolveNextConfiguredProvider(providerPriority = [], currentProvider = '') {
  const configuredProviders = getConfiguredProviders(providerPriority);
  const normalizedCurrentProvider = normalizeAdapterProvider(currentProvider);
  const currentIndex = configuredProviders.indexOf(normalizedCurrentProvider);
  if (currentIndex < 0) {
    return configuredProviders.find(
      (provider) => provider !== normalizedCurrentProvider,
    ) || '';
  }
  return configuredProviders[currentIndex + 1] || '';
}

export function resolveDockerImageGenerationProvider(model) {
  if (!isDockerAdapterRoutingEnabled()) {
    return '';
  }
  return resolveConfiguredProvider(getDockerImageGenerationProviderPriority(model));
}

export function getConfiguredDockerImageGenerationProviders(model) {
  if (!isDockerAdapterRoutingEnabled()) {
    return [];
  }
  return getConfiguredProviders(getDockerImageGenerationProviderPriority(model));
}

export function resolveNextDockerImageGenerationProvider(model, currentProvider) {
  if (!isDockerAdapterRoutingEnabled()) {
    return '';
  }
  return resolveNextConfiguredProvider(
    getDockerImageGenerationProviderPriority(model),
    currentProvider,
  );
}

export function resolveGPTImageTwoGenerationProvider(persistedProvider = '') {
  const normalizedPersistedProvider = normalizeAdapterProvider(persistedProvider);
  if (
    normalizedPersistedProvider === DOCKER_ADAPTER_PROVIDER.FAL ||
    normalizedPersistedProvider === DOCKER_ADAPTER_PROVIDER.GMICLOUD
  ) {
    return normalizedPersistedProvider;
  }

  // Production text-to-image generation uses FAL. Standalone and staging
  // retain their user-supplied adapter priority below.
  if (getDeploymentEdition() === 'production') {
    return DOCKER_ADAPTER_PROVIDER.FAL;
  }

  return resolveDockerImageGenerationProvider('GPTIMAGE2') ||
    DOCKER_ADAPTER_PROVIDER.OPENAI;
}

export function resolveWan27ImageGenerationProvider(persistedProvider = '') {
  const normalizedPersistedProvider = normalizeAdapterProvider(persistedProvider);
  if (normalizedPersistedProvider === DOCKER_ADAPTER_PROVIDER.FAL ||
    normalizedPersistedProvider === DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD) {
    return normalizedPersistedProvider;
  }

  return (isDockerAdapterRoutingEnabled()
    ? resolveDockerImageGenerationProvider('WAN2.7PRO')
    : '') ||
    DOCKER_ADAPTER_PROVIDER.FAL;
}

export function resolveDockerImageEditProvider(model) {
  if (!isDockerAdapterRoutingEnabled()) {
    return '';
  }
  return resolveConfiguredProvider(getDockerImageEditProviderPriority(model));
}

export function getConfiguredDockerImageEditProviders(model) {
  if (!isDockerAdapterRoutingEnabled()) {
    return [];
  }
  return getConfiguredProviders(getDockerImageEditProviderPriority(model));
}

export function resolveNextDockerImageEditProvider(model, currentProvider) {
  if (!isDockerAdapterRoutingEnabled()) {
    return '';
  }
  return resolveNextConfiguredProvider(
    getDockerImageEditProviderPriority(model),
    currentProvider,
  );
}
