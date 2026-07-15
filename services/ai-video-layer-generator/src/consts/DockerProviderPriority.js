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
  const currentEnv = normalizeString(process.env.CURRENT_ENV).toLowerCase();
  return currentEnv === 'docker' || currentEnv === 'staging';
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
  return resolveConfiguredVideoProvider(getDockerVideoProviderPriority(model, options));
}
