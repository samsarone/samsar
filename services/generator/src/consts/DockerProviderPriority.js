export const DOCKER_ADAPTER_PROVIDER = Object.freeze({
  ALIBABA_CLOUD: 'alibabaCloud',
  GOOGLE_CLOUD: 'googleCloud',
  FAL: 'fal',
  OPENAI: 'openai',
  SAMSAR: 'samsar',
});

export const DOCKER_IMAGE_GENERATION_PROVIDER_PRIORITY = Object.freeze({
  'WAN2.7PRO': [
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  NANOBANANA2: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  NANOBANANAPRO: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  GPTIMAGE2: [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
    DOCKER_ADAPTER_PROVIDER.FAL,
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
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  NANOBANANAPROEDIT: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  NANOBANANAEDIT: [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  GPTIMAGE2EDIT: [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ],
  GPTIMAGE1EDIT: [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModelKey(model) {
  return normalizeString(model).toUpperCase();
}

function hasEnvCredential(...keys) {
  return keys.some((key) => Boolean(normalizeString(process.env[key])));
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
  const currentEnv = normalizeString(process.env.CURRENT_ENV).toLowerCase();
  return currentEnv === 'docker' || currentEnv === 'staging';
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

export function hasSamsarAdapterCredential() {
  return hasEnvCredential('SAMSAR_API_KEY');
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
  return false;
}

export function getDockerImageGenerationProviderPriority(model) {
  const normalizedModel = normalizeModelKey(model);
  if (
    normalizedModel === 'NANOBANANAPRO' &&
    normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'production'
  ) {
    return [
      DOCKER_ADAPTER_PROVIDER.FAL,
      DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
      DOCKER_ADAPTER_PROVIDER.SAMSAR,
    ];
  }
  if (DOCKER_IMAGE_GENERATION_PROVIDER_PRIORITY[normalizedModel]) {
    return DOCKER_IMAGE_GENERATION_PROVIDER_PRIORITY[normalizedModel];
  }
  if (DOCKER_FAL_IMAGE_GENERATION_MODELS.includes(normalizedModel)) {
    return [DOCKER_ADAPTER_PROVIDER.FAL, DOCKER_ADAPTER_PROVIDER.SAMSAR];
  }
  return hasSamsarAdapterCredential() ? [DOCKER_ADAPTER_PROVIDER.SAMSAR] : [];
}

export function getDockerImageEditProviderPriority(model) {
  const normalizedModel = normalizeModelKey(model);
  if (DOCKER_IMAGE_EDIT_PROVIDER_PRIORITY[normalizedModel]) {
    return DOCKER_IMAGE_EDIT_PROVIDER_PRIORITY[normalizedModel];
  }
  if (DOCKER_FAL_IMAGE_EDIT_MODELS.includes(normalizedModel) || normalizedModel.startsWith('FLUX')) {
    return [DOCKER_ADAPTER_PROVIDER.FAL, DOCKER_ADAPTER_PROVIDER.SAMSAR];
  }
  return hasSamsarAdapterCredential() ? [DOCKER_ADAPTER_PROVIDER.SAMSAR] : [];
}

export function resolveConfiguredProvider(providerPriority = []) {
  return providerPriority.find(isAdapterProviderConfigured) || '';
}

export function resolveDockerImageGenerationProvider(model) {
  if (!isDockerAdapterRoutingEnabled()) {
    return '';
  }
  return resolveConfiguredProvider(getDockerImageGenerationProviderPriority(model));
}

export function resolveGPTImageTwoGenerationProvider(persistedProvider = '') {
  if (normalizeString(persistedProvider) === DOCKER_ADAPTER_PROVIDER.FAL) {
    return DOCKER_ADAPTER_PROVIDER.FAL;
  }

  // Hosted production text-to-image generation uses FAL. Docker and staging
  // retain their user-supplied adapter priority below.
  const currentEnv = normalizeString(process.env.CURRENT_ENV).toLowerCase();
  if (currentEnv === 'production') {
    return DOCKER_ADAPTER_PROVIDER.FAL;
  }

  return resolveDockerImageGenerationProvider('GPTIMAGE2') ||
    DOCKER_ADAPTER_PROVIDER.OPENAI;
}

export function resolveWan27ImageGenerationProvider(persistedProvider = '') {
  const normalizedPersistedProvider = normalizeString(persistedProvider);
  if (normalizedPersistedProvider === DOCKER_ADAPTER_PROVIDER.FAL ||
    normalizedPersistedProvider === DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD) {
    return normalizedPersistedProvider;
  }

  // Hosted generation uses FAL. Docker keeps its configured native-first
  // provider priority through resolveDockerImageGenerationProvider().
  const currentEnv = normalizeString(process.env.CURRENT_ENV).toLowerCase();
  if (currentEnv !== 'docker' && currentEnv !== 'staging') {
    return DOCKER_ADAPTER_PROVIDER.FAL;
  }

  return resolveDockerImageGenerationProvider('WAN2.7PRO') ||
    DOCKER_ADAPTER_PROVIDER.FAL;
}

export function resolveDockerImageEditProvider(model) {
  if (!isDockerAdapterRoutingEnabled()) {
    return '';
  }
  return resolveConfiguredProvider(getDockerImageEditProviderPriority(model));
}
