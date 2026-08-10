import fs from 'node:fs';

import { isProductionEdition, isStandaloneEdition } from '../utils/EnvironmentUtils.js';
import {
  applyModelAdapterPreferenceOrder,
  normalizeModelAdapterModelKey,
  readModelAdapterPreferences,
} from '../models/api/ModelAdapterPreferences.js';

export const DOCKER_PROVIDER = Object.freeze({
  ALIBABA_CLOUD: 'alibabaCloud',
  GOOGLE_CLOUD: 'googleCloud',
  FAL: 'fal',
  GMICLOUD: 'gmicloud',
  OPENAI: 'openai',
  RUNWAY: 'runway',
  SAMSAR: 'samsar',
});

export const QWEN_IMAGE_3_PRO_MODEL_KEY = 'QWENIMAGE3PRO';

export const DOCKER_IMAGE_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  [QWEN_IMAGE_3_PRO_MODEL_KEY]: [DOCKER_PROVIDER.ALIBABA_CLOUD],
  'WAN2.7PRO': [DOCKER_PROVIDER.ALIBABA_CLOUD, DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR],
  GPTIMAGE2: [
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
  ],
  GPTIMAGE1: [DOCKER_PROVIDER.OPENAI, DOCKER_PROVIDER.SAMSAR],
  DALLE3: [DOCKER_PROVIDER.OPENAI, DOCKER_PROVIDER.SAMSAR],
  NANOBANANA2: [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR],
  NANOBANANAPRO: [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR],
  IMAGEN3: [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.SAMSAR],
  IMAGEN3FLASH: [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.SAMSAR],
  GEMMA3: [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.SAMSAR],
});

export const DOCKER_FAL_IMAGE_MODELS = Object.freeze([
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

export const DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  'VEO3.1': [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR],
  'VEO3.1FAST': [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR],
  'VEO3.1I2V': [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR],
  'VEO3.1I2VFAST': [DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR],
  RUNWAYML: [DOCKER_PROVIDER.RUNWAY, DOCKER_PROVIDER.SAMSAR],
  HAPPYHORSEI2V: [DOCKER_PROVIDER.ALIBABA_CLOUD, DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR],
  // GMICloud selection happens in the video worker, but the processor must
  // keep this provider-billed model off the Samsar external route.
  'SEEDANCE2.0I2V': [DOCKER_PROVIDER.FAL],
  'SEEDANCE2.5I2V': [
    DOCKER_PROVIDER.GMICLOUD,
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.FAL,
  ],
});

export const DOCKER_FAL_VIDEO_MODELS = Object.freeze([
  'SDVIDEO',
  'KLING',
  'KLINGIMGTOVID3PRO',
  'KLINGIMGTOVIDTURBO',
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
  'SEEDANCE2.5I2V',
  'HAPPYHORSEI2V',
  'MMAUDIOV2',
  'MIRELOAI',
  'COSMOS3SUPERI2V',
  'VEO3.1FLIV',
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

export function normalizeDockerModelKey(model) {
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

export function isDockerProviderRoutingEnabled() {
  if (isFalseyEnv(process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED)) {
    return false;
  }
  if (isTruthyEnv(process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED)) {
    return true;
  }
  return isStandaloneEdition();
}

export function hasGoogleCloudCredential() {
  if (hasEnvCredential(...GOOGLE_CLOUD_CREDENTIAL_KEYS)) {
    return true;
  }
  return hasEnvCredential(...GOOGLE_CLOUD_PROJECT_KEYS) &&
    hasEnvCredential(...GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS);
}

export function hasFalCredential() {
  return hasEnvCredential('FAL_API_KEY');
}

export function hasAlibabaCloudCredential(env = process.env) {
  return [
    'ALIBABA_API_KEY',
    'DASHSCOPE_API_KEY',
    'ALIBABA_CLOUD_API_KEY',
    'QWEN_API_KEY',
  ].some((key) => Boolean(normalizeString(env?.[key])));
}

const ALIBABA_QWEN_IMAGE_3_PRO_KEY_TYPES = new Set([
  '',
  'pay_as_you_go',
]);
const ALIBABA_QWEN_IMAGE_3_PRO_ENDPOINT_TYPES = new Set([
  '',
  'pay_as_you_go',
]);

export function isAlibabaQwenImage3ProCredentialEligible({
  keyType = '',
  endpointType = '',
} = {}) {
  return ALIBABA_QWEN_IMAGE_3_PRO_KEY_TYPES.has(normalizeString(keyType).toLowerCase()) &&
    ALIBABA_QWEN_IMAGE_3_PRO_ENDPOINT_TYPES.has(
      normalizeString(endpointType).toLowerCase(),
    );
}

export function isAlibabaQwenImage3ProAvailable(env = process.env) {
  return isStandaloneEdition(env) &&
    hasAlibabaCloudCredential(env) &&
    isAlibabaQwenImage3ProCredentialEligible({
      keyType: env?.ALIBABA_API_KEY_TYPE,
      endpointType: env?.ALIBABA_API_ENDPOINT_TYPE,
    });
}

export function hasOpenAICredential() {
  return hasEnvCredential('OPENAI_API_KEY');
}

export function hasRunwayCredential() {
  return hasEnvCredential('RUNWAY_API_KEY', 'RUNWAYML_API_KEY');
}

export function hasSamsarCredential() {
  return hasEnvCredential('SAMSAR_API_KEY');
}

export function hasGmiCloudSeedance25Credential(env = process.env) {
  if (!isTruthyEnv(env.SAMSAR_GENBLAZE_ENABLED)) return false;
  const catalogPath = normalizeString(env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH);
  if (!catalogPath || !fs.existsSync(catalogPath)) return false;
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const route = catalog?.provider === 'gmicloud'
      ? catalog?.models?.['SEEDANCE2.5I2V']?.video
      : null;
    return route?.modelId === 'seedance-2-5-260628' &&
      route?.operation === 'video.generate';
  } catch {
    return false;
  }
}

export function isDockerProviderConfigured(provider) {
  if (provider === DOCKER_PROVIDER.ALIBABA_CLOUD) return hasAlibabaCloudCredential();
  if (provider === DOCKER_PROVIDER.GOOGLE_CLOUD) return hasGoogleCloudCredential();
  if (provider === DOCKER_PROVIDER.FAL) return hasFalCredential();
  if (provider === DOCKER_PROVIDER.GMICLOUD) return hasGmiCloudSeedance25Credential();
  if (provider === DOCKER_PROVIDER.OPENAI) return hasOpenAICredential();
  if (provider === DOCKER_PROVIDER.RUNWAY) return hasRunwayCredential();
  if (provider === DOCKER_PROVIDER.SAMSAR) return hasSamsarCredential();
  return false;
}

export function getDockerImageProviderPriority(model) {
  const normalizedModel = normalizeDockerModelKey(model);
  let defaultPriority;
  if (
    normalizedModel === QWEN_IMAGE_3_PRO_MODEL_KEY &&
    !isAlibabaQwenImage3ProAvailable()
  ) {
    return [];
  }
  if (
    normalizedModel === 'NANOBANANAPRO' &&
    isProductionEdition()
  ) {
    return [DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.SAMSAR];
  }
  if (DOCKER_IMAGE_PROVIDER_PRIORITY_BY_MODEL[normalizedModel]) {
    defaultPriority = DOCKER_IMAGE_PROVIDER_PRIORITY_BY_MODEL[normalizedModel];
  } else if (DOCKER_FAL_IMAGE_MODELS.includes(normalizedModel)) {
    defaultPriority = [DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR];
  } else {
    defaultPriority = hasSamsarCredential() ? [DOCKER_PROVIDER.SAMSAR] : [];
  }
  const savedPriority = readModelAdapterPreferences().modelProviderPriority[
    normalizeModelAdapterModelKey(normalizedModel)
  ];
  return applyModelAdapterPreferenceOrder(defaultPriority, savedPriority);
}

export function getDockerVideoProviderPriority(model) {
  const normalizedModel = normalizeDockerModelKey(model);
  let defaultPriority;
  if (normalizedModel === 'SEEDANCE2.5I2V' && isProductionEdition()) {
    defaultPriority = [DOCKER_PROVIDER.GMICLOUD];
  } else if (DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel]) {
    defaultPriority = DOCKER_VIDEO_PROVIDER_PRIORITY_BY_MODEL[normalizedModel];
  } else if (
    DOCKER_FAL_VIDEO_MODELS.includes(normalizedModel) ||
    normalizedModel.startsWith('KLING')
  ) {
    defaultPriority = [DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR];
  } else {
    defaultPriority = hasSamsarCredential() ? [DOCKER_PROVIDER.SAMSAR] : [];
  }
  const savedPriority = readModelAdapterPreferences().modelProviderPriority[
    normalizeModelAdapterModelKey(normalizedModel)
  ];
  return applyModelAdapterPreferenceOrder(defaultPriority, savedPriority);
}

export function resolveConfiguredDockerProvider(providerPriority = []) {
  return providerPriority.find(isDockerProviderConfigured) || '';
}

export function resolveDockerImageProvider(model) {
  if (!isDockerProviderRoutingEnabled()) return '';
  return resolveConfiguredDockerProvider(getDockerImageProviderPriority(model));
}

export function resolveDockerVideoProvider(model) {
  if (!isDockerProviderRoutingEnabled()) return '';
  return resolveConfiguredDockerProvider(getDockerVideoProviderPriority(model));
}

export function getConfiguredDockerImageProviders(model) {
  if (!isDockerProviderRoutingEnabled()) return [];
  return getDockerImageProviderPriority(model).filter(isDockerProviderConfigured);
}

export function getConfiguredDockerVideoProviders(model) {
  if (!isDockerProviderRoutingEnabled()) return [];
  return getDockerVideoProviderPriority(model).filter(isDockerProviderConfigured);
}

function resolveNextConfiguredProvider(providers, currentProvider) {
  const normalizedCurrentProvider = normalizeString(currentProvider);
  const currentIndex = providers.indexOf(normalizedCurrentProvider);
  if (currentIndex < 0) {
    return providers.find((provider) => provider !== normalizedCurrentProvider) || '';
  }
  return providers.slice(currentIndex + 1).find(Boolean) || '';
}

export function resolveNextDockerImageProvider(model, currentProvider) {
  return resolveNextConfiguredProvider(
    getConfiguredDockerImageProviders(model),
    currentProvider,
  );
}

export function resolveNextDockerVideoProvider(model, currentProvider) {
  return resolveNextConfiguredProvider(
    getConfiguredDockerVideoProviders(model),
    currentProvider,
  );
}
