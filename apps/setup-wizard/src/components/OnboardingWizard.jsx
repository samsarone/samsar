import { useEffect, useMemo, useRef, useState } from 'react';
import SamsarClient from 'samsar-js';
import {
  buildDockerAvailableModelsFromEnabledProviders,
  buildDockerAvailableModelsFromProviderResults,
  buildDockerCapabilityFamilyAvailability,
  buildExpressPipelineAvailability,
  getDockerModelDisplayName,
  orderDockerProviderKeys,
} from '../constants/dockerModelAvailability.js';

const API_BASE_URL = (import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002').replace(/\/+$/, '');
const SAMSAR_API_BASE_URL = (import.meta.env.VITE_SAMSAR_API_URL || 'https://api.samsar.one/v1').replace(/\/+$/, '');
const SAMSAR_API_KEY_VALIDATION_URL = `${SAMSAR_API_BASE_URL.replace(/\/v1$/, '')}/v2/external/api_key/validate`;
const samsarApiClient = new SamsarClient({ baseUrl: SAMSAR_API_BASE_URL });
const EMPTY_AVAILABLE = {
  providers: [],
  models: [],
  actions: [],
  modelProviders: {},
  modelProviderPriority: {},
};

const STEPS = [
  { id: 1, label: 'Providers', description: 'Add credentials' },
  { id: 2, label: 'Services', description: 'Review access' },
  { id: 3, label: 'Mail & Data', description: 'Storage and email' },
  { id: 4, label: 'Domain', description: 'Proxy access' },
  { id: 5, label: 'Admin', description: 'Secure access' },
];
const SETUP_POLL_INTERVAL_MS = 1200;
const WIZARD_STORAGE_KEY = 'samsar.setupWizard.session.v1';
const WIZARD_STORAGE_VERSION = 7;

const PROVIDERS = [
  {
    key: 'openai',
    title: 'OpenAI',
    type: 'native',
    field: 'openaiApiKey',
    inputType: 'password',
    placeholder: 'OpenAI API key',
    requiredFor: 'GPT inference and assistants, GPT Image generation and editing, and OpenAI text-to-speech.',
    pricingUrl: 'https://developers.openai.com/api/docs/pricing',
    keysUrl: 'https://platform.openai.com/api-keys',
    credentialLabel: 'API key',
  },
  {
    key: 'googleCloud',
    title: 'Gemini 3.1',
    type: 'native',
    field: 'googleCredentialsJson',
    inputType: 'textarea',
    placeholder: 'Paste service account JSON or base64 JSON',
    requiredFor: 'Gemini inference plus Google image, video, speech, and music models.',
    pricingUrl: 'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing',
    keysUrl: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
    credentialLabel: 'Service account JSON',
  },
  {
    key: 'kimi',
    title: 'Kimi K3',
    type: 'native',
    field: 'kimiK3ApiKey',
    inputType: 'password',
    placeholder: 'Kimi API key',
    requiredFor: 'Native Kimi K3 text, strict structured-output, assistant, and latest vision inference with high reasoning.',
    pricingUrl: 'https://platform.kimi.ai/docs/pricing/chat-k3',
    keysUrl: 'https://platform.kimi.ai/',
    credentialLabel: 'API key',
  },
  {
    key: 'openrouter',
    title: 'OpenRouter',
    type: 'native',
    field: 'openrouterApiKey',
    inputType: 'password',
    placeholder: 'OpenRouter API key',
    requiredFor: 'Fallback inference for supported GPT, Gemini, and Qwen 3.7 Plus text and vision models.',
    pricingUrl: 'https://openrouter.ai/pricing',
    keysUrl: 'https://openrouter.ai/settings/keys',
    credentialLabel: 'API key',
  },
  {
    key: 'alibabaCloud',
    title: 'Alibaba Cloud',
    type: 'native',
    field: 'alibabaApiKey',
    inputType: 'password',
    placeholder: 'Alibaba Cloud Model Studio API key',
    requiredFor: 'Qwen 3.7 Plus inference, Wan image generation, and Happy Horse video.',
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
    keysUrl: 'https://modelstudio.console.alibabacloud.com/',
    credentialLabel: 'API key',
    endpointField: 'alibabaApiHost',
    endpointLabel: 'API host or OpenAI-compatible endpoint (optional)',
    endpointPlaceholder: 'workspace-id.ap-southeast-1.maas.aliyuncs.com',
    endpointHelp: 'Leave blank to use the international Model Studio endpoint.',
  },
  {
    key: 'fal',
    title: 'Fal',
    type: 'native',
    field: 'falApiKey',
    inputType: 'password',
    placeholder: 'FAL API key',
    requiredFor: 'Broad media access for image, video, speech, music, lip sync, and sound effects.',
    pricingUrl: 'https://fal.ai/pricing',
    keysUrl: 'https://fal.ai/dashboard/keys',
    credentialLabel: 'API key',
  },
  {
    key: 'elevenlabs',
    title: 'ElevenLabs',
    type: 'native',
    field: 'elevenLabsApiKey',
    inputType: 'password',
    placeholder: 'ElevenLabs API key',
    requiredFor: 'Direct speech and backing-track music generation.',
    pricingUrl: 'https://elevenlabs.io/pricing',
    keysUrl: 'https://elevenlabs.io/app/settings/api-keys',
    credentialLabel: 'API key',
  },
  {
    key: 'runway',
    title: 'RunwayML',
    type: 'native',
    field: 'runwayApiKey',
    inputType: 'password',
    placeholder: 'Runway API key',
    requiredFor: 'Runway video generation and image-to-video.',
    pricingUrl: 'https://docs.dev.runwayml.com/guides/pricing/',
    keysUrl: 'https://docs.dev.runwayml.com/guides/setup/',
    credentialLabel: 'API key',
  },
  {
    key: 'samsar',
    title: 'Samsar-js',
    type: 'samsar',
    field: 'samsarApiKey',
    inputType: 'password',
    placeholder: 'sk_live_...',
    requiredFor: 'Universal access to every model using Samsar credits. Direct provider keys take priority when both are configured.',
    pricingUrl: 'https://docs.samsar.one/pricing',
    keysUrl: 'https://app.samsar.one/account/apiKeys',
    credentialLabel: 'API key',
    badge: 'All model access',
  },
];
const NATIVE_PROVIDERS = PROVIDERS.filter((provider) => provider.type === 'native');
const STANDARD_NATIVE_PROVIDERS = NATIVE_PROVIDERS.filter(
  (provider) => provider.key !== 'alibabaCloud' && provider.key !== 'openrouter',
);
const PROVIDER_GROUPS = [
  {
    key: 'inference',
    title: 'Inference',
    description: 'Choose a primary provider for agent reasoning, text, and vision.',
    providerKeys: ['openai', 'googleCloud', 'kimi', 'alibabaCloud'],
  },
  {
    key: 'fallbacks',
    title: 'Fallbacks',
    description: 'Fill model gaps with universal access or route supported inference through OpenRouter.',
    providerKeys: ['samsar', 'openrouter'],
    featured: true,
  },
  {
    key: 'media',
    title: 'Media',
    description: 'Enable dedicated image, video, speech, music, lip-sync, and sound-effect models.',
    providerKeys: ['fal', 'elevenlabs', 'runway'],
  },
].map((group) => ({
  ...group,
  providers: group.providerKeys.map((providerKey) => PROVIDERS.find((provider) => provider.key === providerKey)),
}));
const PROVIDER_MODELS_BY_KEY = Object.fromEntries(PROVIDERS.map((provider) => [
  provider.key,
  buildDockerAvailableModelsFromEnabledProviders([provider.key]).models
    .map((modelKey) => ({
      modelKey,
      label: getDockerModelDisplayName(modelKey, provider.key),
    }))
    .sort((leftModel, rightModel) => leftModel.label.localeCompare(rightModel.label)),
]));

const SERVICES = [
  { key: 'processor', label: 'Processor API', required: true },
  { key: 'setupWizard', label: 'Setup wizard', required: true },
  { key: 'generator', label: 'Image generator' },
  { key: 'assistantQueryProcessor', label: 'Assistant query processor' },
  { key: 'audioGenerator', label: 'Audio generator' },
  { key: 'aiVideoLayerGenerator', label: 'AI video layer generator' },
  { key: 'videoGenerator', label: 'Video renderer' },
  { key: 'framesProcessor', label: 'Frames processor' },
  { key: 'expressVideoListener', label: 'Express video listener' },
];
const LOGGER_SERVICE_KEY = 'logger';
const CAPABILITY_FAMILIES = {
  gpt56: {
    key: 'gpt56',
    label: 'GPT 5.6 Sol',
    providerKeys: ['openai', 'openrouter', 'samsar'],
    modelKeys: ['gpt-5.6-sol'],
  },
  gemini: {
    key: 'gemini',
    label: 'Gemini',
    providerKeys: ['googleCloud', 'openrouter', 'samsar'],
    modelKeys: ['gemini-3.1-pro'],
  },
  qwen: {
    key: 'qwen',
    label: 'Qwen',
    providerKeys: ['alibabaCloud', 'openrouter', 'samsar'],
    modelKeys: ['QWEN3.7'],
  },
  kimiK3: {
    key: 'kimiK3',
    label: 'Kimi K3',
    providerKeys: ['kimi', 'samsar'],
    modelKeys: ['KIMIK3'],
  },
  gptAssistant: {
    key: 'gptAssistant',
    label: 'GPT Assistant',
    providerKeys: ['openai', 'openrouter', 'samsar'],
    modelKeys: ['gpt-5.6-sol'],
  },
  geminiAssistant: {
    key: 'geminiAssistant',
    label: 'Gemini Assistant',
    providerKeys: ['googleCloud', 'openrouter', 'samsar'],
    modelKeys: ['gemini-3.1-pro'],
  },
  qwenAssistant: {
    key: 'qwenAssistant',
    label: 'Qwen Assistant',
    providerKeys: ['alibabaCloud', 'openrouter', 'samsar'],
    modelKeys: ['QWEN3.7'],
  },
  kimiK3Assistant: {
    key: 'kimiK3Assistant',
    label: 'Kimi K3 Assistant',
    providerKeys: ['kimi', 'samsar'],
    modelKeys: ['KIMIK3'],
  },
  openaiImage: {
    key: 'openaiImage',
    label: 'OpenAI Image',
    providerKeys: ['openai', 'samsar'],
    modelKeys: ['GPTIMAGE2'],
  },
  seedream: {
    key: 'seedream',
    label: 'Seedream',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['SEEDREAM'],
  },
  nanoBanana2: {
    key: 'nanoBanana2',
    label: 'NanoBanana 2',
    providerKeys: ['googleCloud', 'fal', 'samsar'],
    modelKeys: ['NANOBANANA2'],
  },
  nanoBananaPro: {
    key: 'nanoBananaPro',
    label: 'NanoBanana Pro',
    providerKeys: ['googleCloud', 'fal', 'samsar'],
    modelKeys: ['NANOBANANAPRO'],
  },
  wan27Pro: {
    key: 'wan27Pro',
    label: 'Wan2.7 Pro',
    providerKeys: ['alibabaCloud', 'fal', 'samsar'],
    modelKeys: ['WAN2.7PRO'],
  },
  veo: {
    key: 'veoI2V',
    label: 'VEO 3.1 I2V',
    providerKeys: ['googleCloud', 'fal', 'samsar'],
    modelKeys: ['VEO3.1I2V'],
  },
  veoFast: {
    key: 'veoFastI2V',
    label: 'VEO 3.1 Fast I2V',
    providerKeys: ['googleCloud', 'fal', 'samsar'],
    modelKeys: ['VEO3.1I2VFAST'],
  },
  seedance: {
    key: 'seedance',
    label: 'Seedance',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['SEEDANCEI2V'],
  },
  kling: {
    key: 'kling',
    label: 'Kling',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['KLINGIMGTOVID3PRO', 'KLINGIMGTOVIDTURBO'],
  },
  cosmos: {
    key: 'cosmos',
    label: 'Cosmos 3',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['COSMOS3SUPERI2V'],
  },
  happyHorse: {
    key: 'happyHorse',
    label: 'Happy Horse',
    providerKeys: ['alibabaCloud', 'fal', 'samsar'],
    modelKeys: ['HAPPYHORSEI2V'],
  },
  runway: {
    key: 'runway',
    label: 'Runway',
    providerKeys: ['runway', 'samsar'],
    modelKeys: ['RUNWAYML'],
  },
  hummingbirdLipSync: {
    key: 'hummingbirdLipSync',
    label: 'HummingBird Lip Sync',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['HUMMINGBIRDLIPSYNC'],
  },
  latentSync: {
    key: 'latentSync',
    label: 'Latent Sync',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['LATENTSYNC'],
  },
  syncLipSync: {
    key: 'syncLipSync',
    label: 'Sync Lip Sync',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['SYNCLIPSYNC'],
  },
  klingLipSync: {
    key: 'klingLipSync',
    label: 'Kling Lip Sync',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['KLINGLIPSYNC'],
  },
  creatifyLipSync: {
    key: 'creatifyLipSync',
    label: 'Creatify Lip Sync',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['CREATIFYLIPSYNC'],
  },
  openaiTts: {
    key: 'openaiTts',
    label: 'OpenAI TTS',
    providerKeys: ['openai', 'samsar'],
    modelKeys: ['OPENAI_TTS'],
  },
  googleTts: {
    key: 'googleTts',
    label: 'Google TTS',
    providerKeys: ['googleCloud', 'samsar'],
    modelKeys: ['GOOGLE_TTS'],
  },
  elevenlabsSpeech: {
    key: 'elevenlabsSpeech',
    label: 'ElevenLabs Speech',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['ELEVENLABS'],
  },
  soundEffects: {
    key: 'mmAudio',
    label: 'MMAudio V2',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['MMAUDIOV2'],
  },
  mirelo: {
    key: 'mirelo',
    label: 'Mirelo AI',
    providerKeys: ['fal', 'samsar'],
    modelKeys: ['MIRELOAI'],
  },
  lyria: {
    key: 'lyria',
    label: 'Lyria',
    providerKeys: ['googleCloud', 'samsar'],
    modelKeys: ['LYRIA3'],
  },
  elevenlabsMusic: {
    key: 'elevenlabsMusic',
    label: 'ElevenLabs Music',
    providerKeys: ['elevenlabs', 'fal', 'samsar'],
    modelKeys: ['ELEVENLABS_MUSIC'],
  },
};
const SETUP_SERVICE_CATALOG = [
  {
    key: 'samsarStudio',
    label: 'Samsar Studio',
    category: 'Core',
    description: 'Video workspace, projects, library, and account UI.',
    alwaysAvailable: true,
  },
  {
    key: 'imageEditor',
    label: 'Image Editor',
    category: 'Core',
    description: 'Canvas editing, uploads, layers, and manual image operations.',
    alwaysAvailable: true,
  },
  {
    key: 'searchApi',
    label: 'Search API',
    category: 'Text API',
    description: 'Embedding-backed search over external records.',
    providerKeys: ['openai', 'samsar'],
  },
  {
    key: 'recommendationsApi',
    label: 'Recommendations API',
    category: 'Text API',
    description: 'Similarity and recommendation endpoints for external records.',
    providerKeys: ['openai', 'samsar'],
  },
  {
    key: 'inference',
    label: 'Inference',
    category: 'Inference',
    description: 'Chat, reasoning, and vision inference families available for provider-backed model calls.',
    modelFamilies: [
      CAPABILITY_FAMILIES.gpt56,
      CAPABILITY_FAMILIES.gemini,
      CAPABILITY_FAMILIES.kimiK3,
      CAPABILITY_FAMILIES.qwen,
    ],
  },
  {
    key: 'assistant',
    label: 'Assistant',
    category: 'Inference',
    description: 'Assistant workflows backed by the configured GPT, Gemini, Kimi, or Qwen provider families.',
    modelFamilies: [
      CAPABILITY_FAMILIES.gptAssistant,
      CAPABILITY_FAMILIES.geminiAssistant,
      CAPABILITY_FAMILIES.kimiK3Assistant,
      CAPABILITY_FAMILIES.qwenAssistant,
    ],
  },
  {
    key: 'imageGeneration',
    label: 'Image Generation',
    category: 'Generative Media',
    description: 'Public text-to-image model families used by VidGenie and external video generation.',
    modelFamilies: [
      CAPABILITY_FAMILIES.openaiImage,
      CAPABILITY_FAMILIES.seedream,
      CAPABILITY_FAMILIES.nanoBanana2,
      CAPABILITY_FAMILIES.nanoBananaPro,
      CAPABILITY_FAMILIES.wan27Pro,
    ],
  },
  {
    key: 'videoGeneration',
    label: 'Video Generation',
    category: 'Generative Media',
    description: 'Public image-to-video model families and their native or Samsar fallback providers.',
    modelFamilies: [
      CAPABILITY_FAMILIES.runway,
      CAPABILITY_FAMILIES.veo,
      CAPABILITY_FAMILIES.veoFast,
      CAPABILITY_FAMILIES.cosmos,
      CAPABILITY_FAMILIES.seedance,
      CAPABILITY_FAMILIES.kling,
      CAPABILITY_FAMILIES.happyHorse,
    ],
  },
  {
    key: 'lipSync',
    label: 'Lip Sync',
    category: 'Generative Media',
    description: 'Lip sync and character video layer model families.',
    modelFamilies: [
      CAPABILITY_FAMILIES.hummingbirdLipSync,
      CAPABILITY_FAMILIES.latentSync,
      CAPABILITY_FAMILIES.syncLipSync,
      CAPABILITY_FAMILIES.klingLipSync,
      CAPABILITY_FAMILIES.creatifyLipSync,
    ],
  },
  {
    key: 'tts',
    label: 'TTS',
    category: 'Generative Media',
    description: 'Text-to-speech provider families for voice and narration layers.',
    modelFamilies: [CAPABILITY_FAMILIES.openaiTts, CAPABILITY_FAMILIES.googleTts, CAPABILITY_FAMILIES.elevenlabsSpeech],
  },
  {
    key: 'soundEffects',
    label: 'Sound Effects',
    category: 'Generative Media',
    description: 'Sound effect generation and audio layer model families.',
    modelFamilies: [CAPABILITY_FAMILIES.soundEffects, CAPABILITY_FAMILIES.mirelo],
  },
  {
    key: 'music',
    label: 'Music',
    category: 'Generative Media',
    description: 'Backing-track and music generation model families.',
    modelFamilies: [CAPABILITY_FAMILIES.lyria, CAPABILITY_FAMILIES.elevenlabsMusic],
  },
];

const DEFAULT_CREDENTIALS = Object.freeze({
  samsarApiKey: '',
  openaiApiKey: '',
  openrouterApiKey: '',
  googleCredentialsJson: '',
  kimiK3ApiKey: '',
  alibabaApiKey: '',
  alibabaApiHost: '',
  falApiKey: '',
  elevenLabsApiKey: '',
  runwayApiKey: '',
});
const CREDENTIAL_PLACEHOLDER_VALUES = new Set(
  PROVIDERS
    .map((provider) => provider.placeholder)
    .filter(Boolean),
);
const DEFAULT_DATA_CONFIG = Object.freeze({
  databaseMode: 'local',
  mongoConnectionString: '',
  storageMode: 'local',
  s3Bucket: 'samsar-resources',
  s3Region: 'us-east-1',
  s3Endpoint: '',
  s3ForcePathStyle: false,
  s3AccessKeyId: '',
  s3SecretAccessKey: '',
  staticCdnUrl: '',
  cloudFrontKeyPairId: '',
  cloudFrontPrivateKey: '',
  cloudFrontPrivateKeyBase64: '',
  cloudFrontSignedUrlTtlSeconds: '604800',
});
const DEFAULT_MAIL_CONFIG = Object.freeze({
  provider: 'none',
  fromAddress: '',
  replyToAddress: '',
  smtpHost: '',
  smtpPort: '587',
  smtpSecure: false,
  smtpUser: '',
  smtpPassword: '',
  sesRegion: 'us-east-1',
  sesAccessKeyId: '',
  sesSecretAccessKey: '',
  sesSessionToken: '',
});
const DEFAULT_REVERSE_PROXY_CONFIG = Object.freeze({
  enabled: false,
  accessType: 'publicDomain',
  clientHost: '',
  processorHost: '',
  machineIp: '',
  openFirewallPorts: false,
  sslEnabled: false,
  sslEmail: '',
});
const DEFAULT_ADMIN_CONFIG = Object.freeze({
  organizationName: '',
  email: '',
  password: '',
  confirmPassword: '',
});

function buildDefaultServices() {
  return {
    ...Object.fromEntries(SERVICES.map((service) => [service.key, true])),
    [LOGGER_SERVICE_KEY]: true,
  };
}

function clampStep(value, fallback = 1) {
  const numericValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.min(STEPS.length, Math.max(1, numericValue));
}

function sanitizeCredentialValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed || CREDENTIAL_PLACEHOLDER_VALUES.has(trimmed)) {
    return '';
  }
  return value;
}

function normalizeCredentialSet(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_CREDENTIALS).map(([key, fallback]) => [
      key,
      sanitizeCredentialValue(value?.[key]) || fallback,
    ]),
  );
}

function pickCredentials(value = {}) {
  return normalizeCredentialSet(value);
}

function pickServices(value = {}) {
  const defaults = buildDefaultServices();
  return {
    ...Object.fromEntries(SERVICES.map((service) => [
      service.key,
      service.required ? true : typeof value?.[service.key] === 'boolean' ? value[service.key] : defaults[service.key],
    ])),
    [LOGGER_SERVICE_KEY]: typeof value?.[LOGGER_SERVICE_KEY] === 'boolean'
      ? value[LOGGER_SERVICE_KEY]
      : defaults[LOGGER_SERVICE_KEY],
  };
}

function pickDataConfig(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_DATA_CONFIG).map(([key, fallback]) => [
      key,
      typeof fallback === 'boolean'
        ? typeof value?.[key] === 'boolean' ? value[key] : fallback
        : typeof value?.[key] === 'string' ? value[key] : fallback,
    ]),
  );
}

function pickMailConfig(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_MAIL_CONFIG).map(([key, fallback]) => [
      key,
      typeof fallback === 'boolean'
        ? typeof value?.[key] === 'boolean' ? value[key] : fallback
        : typeof value?.[key] === 'string' ? value[key] : fallback,
    ]),
  );
}

function pickReverseProxyConfig(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_REVERSE_PROXY_CONFIG).map(([key, fallback]) => [
      key,
      typeof fallback === 'boolean'
        ? typeof value?.[key] === 'boolean' ? value[key] : fallback
        : typeof value?.[key] === 'string' ? value[key] : fallback,
    ]),
  );
}

function pickAdminConfig(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_ADMIN_CONFIG).map(([key, fallback]) => [
      key,
      typeof value?.[key] === 'string' ? value[key] : fallback,
    ]),
  );
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isAlibabaTokenPlanEndpoint(value) {
  const configured = normalizeText(value);
  if (!configured) return false;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(configured) ? configured : `https://${configured}`);
    return url.hostname.toLowerCase().includes('token-plan');
  } catch {
    return false;
  }
}

function normalizeSecretText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTemporaryAwsAccessKeyId(value) {
  return normalizeText(value).toUpperCase().startsWith('ASIA');
}

function normalizeMailProvider(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (['none', 'smtp', 'ses'].includes(normalized)) {
    return normalized;
  }
  return 'none';
}

function normalizeReverseProxyAccessType(value) {
  const normalized = normalizeText(value);
  if (['publicDomain', 'publicIp', 'privateIp'].includes(normalized)) {
    return normalized;
  }
  return 'publicDomain';
}

function normalizeMailConfig(mailConfig = {}) {
  const provider = normalizeMailProvider(mailConfig.provider);
  const sesAccessKeyId = normalizeText(mailConfig.sesAccessKeyId);
  const sesUsesTemporaryCredentials = isTemporaryAwsAccessKeyId(sesAccessKeyId);
  return {
    provider,
    fromAddress: normalizeText(mailConfig.fromAddress),
    replyToAddress: normalizeText(mailConfig.replyToAddress),
    smtpHost: normalizeText(mailConfig.smtpHost),
    smtpPort: normalizeText(mailConfig.smtpPort) || (mailConfig.smtpSecure ? '465' : '587'),
    smtpSecure: Boolean(mailConfig.smtpSecure),
    smtpUser: normalizeText(mailConfig.smtpUser),
    smtpPassword: typeof mailConfig.smtpPassword === 'string' ? mailConfig.smtpPassword : '',
    sesRegion: normalizeText(mailConfig.sesRegion) || 'us-east-1',
    sesAccessKeyId,
    sesSecretAccessKey: normalizeSecretText(mailConfig.sesSecretAccessKey),
    sesSessionToken: sesUsesTemporaryCredentials ? normalizeSecretText(mailConfig.sesSessionToken) : '',
  };
}

function normalizeHostInput(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  try {
    const parsedUrl = new URL(/^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`);
    return parsedUrl.hostname.toLowerCase();
  } catch {
    return normalized
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split(':')[0]
      .toLowerCase();
  }
}

function buildUrlForHost(host, useHttps = false) {
  const normalizedHost = normalizeHostInput(host);
  return normalizedHost ? `${useHttps ? 'https' : 'http'}://${normalizedHost}` : '';
}

function buildUrlForHostPath(host, pathName = '', useHttps = false) {
  const baseUrl = buildUrlForHost(host, useHttps);
  const normalizedPath = normalizeText(pathName).replace(/^\/+/, '');
  return baseUrl && normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
}

function normalizeReverseProxyConfig(reverseProxyConfig = {}) {
  const accessType = normalizeReverseProxyAccessType(reverseProxyConfig.accessType);
  const enabled = Boolean(reverseProxyConfig.enabled);
  const sslEnabled = enabled && accessType === 'publicDomain' && Boolean(reverseProxyConfig.sslEnabled);
  const isIpAccess = accessType === 'publicIp' || accessType === 'privateIp';
  const machineIp = normalizeHostInput(reverseProxyConfig.machineIp || reverseProxyConfig.clientHost || reverseProxyConfig.processorHost);
  return {
    enabled,
    accessType,
    clientHost: isIpAccess ? machineIp : normalizeHostInput(reverseProxyConfig.clientHost),
    processorHost: isIpAccess ? machineIp : normalizeHostInput(reverseProxyConfig.processorHost),
    machineIp: isIpAccess ? machineIp : normalizeText(reverseProxyConfig.machineIp),
    openFirewallPorts: Boolean(reverseProxyConfig.openFirewallPorts),
    sslEnabled,
    sslEmail: normalizeText(reverseProxyConfig.sslEmail).toLowerCase(),
  };
}

function buildReverseProxyDeploymentConfig(reverseProxyConfig = {}, validationResult = null) {
  const normalized = normalizeReverseProxyConfig(reverseProxyConfig);
  if (!normalized.enabled) {
    return {
      enabled: false,
      accessType: normalized.accessType,
      openFirewallPorts: false,
      ssl: { enabled: false },
    };
  }

  const useHttps = normalized.sslEnabled;
  const clientApp = buildUrlForHost(normalized.clientHost, useHttps);
  const processorApi = normalized.accessType === 'publicIp' || normalized.accessType === 'privateIp'
    ? buildUrlForHostPath(normalized.machineIp, 'api', useHttps)
    : buildUrlForHost(normalized.processorHost, useHttps);
  return {
    enabled: true,
    accessType: normalized.accessType,
    clientHost: normalized.clientHost,
    processorHost: normalized.processorHost,
    machineIp: normalized.machineIp,
    openFirewallPorts: normalized.openFirewallPorts,
    ssl: {
      enabled: normalized.sslEnabled,
      email: normalized.sslEnabled ? normalized.sslEmail : '',
    },
    publicUrls: {
      clientApp,
      processorApi,
      media: processorApi,
    },
    validation: validationResult?.config || validationResult || null,
  };
}

function buildMailDeploymentConfig(mailConfig = {}, mailValidationResult = null) {
  const provider = normalizeMailProvider(mailConfig.provider);
  if (provider === 'none') {
    return {
      configured: false,
      provider: 'none',
    };
  }
  return {
    configured: true,
    provider,
    fromAddress: normalizeText(mailConfig.fromAddress),
    replyToAddress: normalizeText(mailConfig.replyToAddress) || normalizeText(mailConfig.fromAddress),
    validation: mailValidationResult?.config || {
      provider,
      configured: true,
      validated: Boolean(mailValidationResult?.ok),
    },
  };
}

function normalizeAdminConfig(adminConfig = {}) {
  return {
    organizationName: normalizeText(adminConfig.organizationName),
    email: normalizeText(adminConfig.email).toLowerCase(),
    password: typeof adminConfig.password === 'string' ? adminConfig.password : '',
  };
}

function parseMongoConnectionString(value) {
  const mongoUrl = normalizeText(value);
  if (!mongoUrl) {
    return null;
  }
  try {
    const parsedUrl = new URL(mongoUrl);
    if (!['mongodb:', 'mongodb+srv:'].includes(parsedUrl.protocol)) {
      return null;
    }
    return {
      scheme: parsedUrl.protocol.replace(':', ''),
      hosts: parsedUrl.host,
      database: parsedUrl.pathname.replace(/^\/+/, '') || 'SamsarOne',
      username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : '',
      authSource: parsedUrl.searchParams.get('authSource') || '',
      tls: parsedUrl.searchParams.get('tls') || parsedUrl.searchParams.get('ssl') || '',
    };
  } catch {
    return null;
  }
}

function ensureTrailingSlash(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function buildInfrastructureConfig(dataConfig = {}) {
  const databaseMode = dataConfig.databaseMode === 'remote' ? 'remote' : 'local';
  const storageMode = dataConfig.storageMode === 'externalS3' ? 'externalS3' : 'local';
  const remoteMongoUrl = normalizeText(dataConfig.mongoConnectionString);
  const staticCdnUrl = ensureTrailingSlash(dataConfig.staticCdnUrl);

  return {
    database: databaseMode === 'remote'
      ? {
        mode: 'remote',
        provider: 'remote-mongo',
        mongoUrl: remoteMongoUrl,
        parsed: parseMongoConnectionString(remoteMongoUrl),
      }
      : {
        mode: 'local',
        provider: 'local-mongo',
        mongoUrl: 'mongodb://mongo:27017/SamsarOne',
      },
    storage: storageMode === 'externalS3'
      ? {
        mode: 'external-s3',
        provider: 's3-compatible',
        mediaBucketName: normalizeText(dataConfig.s3Bucket),
        staticCdnUrl,
        secureAssetPrefix: 'assets_v2',
        accessKeyId: normalizeText(dataConfig.s3AccessKeyId),
        secretAccessKey: normalizeText(dataConfig.s3SecretAccessKey),
        region: normalizeText(dataConfig.s3Region) || 'us-east-1',
        s3Endpoint: normalizeText(dataConfig.s3Endpoint),
        s3ForcePathStyle: Boolean(dataConfig.s3ForcePathStyle),
        externalMediaPublishEnabled: true,
        cloudFront: {
          keyPairId: normalizeText(dataConfig.cloudFrontKeyPairId),
          privateKey: dataConfig.cloudFrontPrivateKey || '',
          privateKeyBase64: normalizeText(dataConfig.cloudFrontPrivateKeyBase64),
          signedUrlTtlSeconds: normalizeText(dataConfig.cloudFrontSignedUrlTtlSeconds) || '604800',
        },
      }
      : {
        mode: 'local-minio',
        provider: 's3-compatible',
        mediaBucketName: 'samsar-resources',
        staticCdnUrl: `${API_BASE_URL}/`,
        secureAssetPrefix: 'assets_v2',
        accessKeyId: 'samsar',
        secretAccessKey: 'samsar-local-password',
        region: 'us-east-1',
        s3Endpoint: 'http://minio:9000',
        s3ForcePathStyle: true,
        externalMediaPublishEnabled: false,
      },
  };
}

function buildServicePayload(services, infrastructure) {
  return {
    ...services,
    localMongo: infrastructure.database.provider === 'local-mongo',
    minio: infrastructure.storage.mode === 'local-minio',
    mediaGateway: infrastructure.storage.mode === 'local-minio',
  };
}

function serializeSetupRun(setupRun) {
  if (!setupRun?.id) {
    return null;
  }
  return {
    ...setupRun,
    logs: Array.isArray(setupRun.logs) ? setupRun.logs.slice(-80) : [],
  };
}

function readStoredWizardState() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(WIZARD_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    const parsedValue = JSON.parse(rawValue);
    if (parsedValue?.version !== WIZARD_STORAGE_VERSION) {
      return null;
    }
    return parsedValue;
  } catch {
    return null;
  }
}

function buildInitialWizardState() {
  const storedState = readStoredWizardState();
  const restoredCredentials = pickCredentials(storedState?.credentials);
  const restoredValidationResult = sanitizeValidationResultForStorage(
    storedState?.validationResult,
    restoredCredentials,
  );
  const requiresProviderCredentialReentry = getProviderCredentialReentryKeys(restoredValidationResult).length > 0;
  const restoredStep = requiresProviderCredentialReentry ? 1 : clampStep(storedState?.step, 1);
  const restoredMaxStep = requiresProviderCredentialReentry
    ? 1
    : Math.max(restoredStep, clampStep(storedState?.maxStep, restoredStep));

  return {
    step: restoredStep,
    maxStep: restoredMaxStep,
    credentials: restoredCredentials,
    services: pickServices(storedState?.services),
    mailConfig: pickMailConfig(storedState?.mailConfig),
    mailValidationResult: storedState?.mailValidationResult || null,
    dataConfig: pickDataConfig(storedState?.dataConfig),
    reverseProxyConfig: pickReverseProxyConfig(storedState?.reverseProxyConfig),
    reverseProxyValidationResult: storedState?.reverseProxyValidationResult || null,
    adminConfig: pickAdminConfig(storedState?.adminConfig),
    validationResult: restoredValidationResult,
    setupRun: serializeSetupRun(storedState?.setupRun),
    setupStartError: typeof storedState?.setupStartError === 'string' ? storedState.setupStartError : '',
  };
}

function writeStoredWizardState(state) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(
      WIZARD_STORAGE_KEY,
      JSON.stringify({
        version: WIZARD_STORAGE_VERSION,
        ...state,
        validationResult: sanitizeValidationResultForStorage(state.validationResult, state.credentials),
        setupRun: serializeSetupRun(state.setupRun),
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Best-effort restore only; storage can be unavailable in restricted browser modes.
  }
}

function clearStoredWizardState() {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(WIZARD_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures; in-memory state is still reset.
    }
  }
}

function getProviderStatus(results, providerKey) {
  return results?.providers?.[providerKey] || null;
}

function stripValidationToken(validation) {
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) {
    return validation;
  }
  const { validationToken: _validationToken, ...sanitizedValidation } = validation;
  return sanitizedValidation;
}

function sanitizeValidationResultForStorage(validationResult, credentials = {}) {
  if (!validationResult) {
    return null;
  }

  const providers = Object.fromEntries(
    Object.entries(validationResult.providers || {}).map(([providerKey, providerValidation]) => {
      const sanitizedValidation = stripValidationToken(providerValidation);
      const provider = PROVIDERS.find((candidate) => candidate.key === providerKey);
      const requiresCredentialReentry = (
        (
          providerKey === 'openrouter' ||
          providerKey === 'alibabaCloud' ||
          providerKey === 'kimi'
        ) &&
        providerValidation?.ok === true &&
        provider &&
        !hasCredentialValue(credentials, provider)
      );
      if (!requiresCredentialReentry) {
        return [providerKey, sanitizedValidation];
      }
      return [providerKey, {
        ...sanitizedValidation,
        ok: false,
        status: 'credential_required',
        message: `Re-enter the ${provider.title} credential before continuing setup.`,
      }];
    }),
  );

  return {
    providers,
    available: buildAvailableFromProviderResults(providers),
  };
}

function getProviderCredentialReentryKeys(validationResult = {}) {
  return Object.entries(validationResult?.providers || {})
    .filter(([, providerValidation]) => providerValidation?.status === 'credential_required')
    .map(([providerKey]) => providerKey);
}

function sanitizeDeploymentPayloadForDisplay(payload = {}) {
  return {
    ...payload,
    providers: Object.fromEntries(
      Object.entries(payload.providers || {}).map(([providerKey, providerConfig]) => [
        providerKey,
        {
          ...providerConfig,
          validation: stripValidationToken(providerConfig?.validation),
        },
      ]),
    ),
  };
}

function hasCredentialValue(credentials, provider) {
  return Boolean(sanitizeCredentialValue(credentials[provider.field]));
}

function hasAnyCredentialValue(credentials) {
  return PROVIDERS.some((provider) => hasCredentialValue(credentials, provider));
}

function hasStandardNativeCredentialValue(credentials) {
  return STANDARD_NATIVE_PROVIDERS.some((provider) => hasCredentialValue(credentials, provider));
}

function buildNativeCredentialPayload(credentials) {
  const sanitizedCredentials = normalizeCredentialSet(credentials);
  return STANDARD_NATIVE_PROVIDERS
    .reduce((payload, provider) => {
      payload[provider.field] = sanitizedCredentials[provider.field];
      if (provider.endpointField) {
        payload[provider.endpointField] = sanitizedCredentials[provider.endpointField];
      }
      return payload;
    }, {});
}

function providerResult(provider, status, extra = {}) {
  return {
    provider,
    status,
    ok: status === 'valid' || status === 'format_valid' || status === 'configured',
    ...extra,
  };
}

function parseJsonOrBase64Json(value) {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch (jsonError) {
    try {
      return JSON.parse(atob(trimmed));
    } catch {
      throw jsonError;
    }
  }
}

function buildAvailableFromProviderResults(providerResults = {}) {
  return buildDockerAvailableModelsFromProviderResults(providerResults);
}

function buildLocalNativeCredentialResult(credentials) {
  const providerResults = {};
  STANDARD_NATIVE_PROVIDERS
    .filter((provider) => hasCredentialValue(credentials, provider))
    .forEach((provider) => {
      if (provider.key === 'googleCloud') {
        try {
          const parsedCredentials = parseJsonOrBase64Json(credentials[provider.field]);
          providerResults[provider.key] = providerResult(provider.key, 'format_valid', {
            validationMode: 'local_format',
            projectId: parsedCredentials.project_id || null,
            clientEmail: parsedCredentials.client_email || null,
          });
        } catch (error) {
          providerResults[provider.key] = providerResult(provider.key, 'invalid', {
            validationMode: 'local_format',
            message: error?.message || 'Google Cloud credentials must be valid JSON or base64 JSON.',
          });
        }
        return;
      }

      providerResults[provider.key] = providerResult(provider.key, 'configured', {
        validationMode: 'deferred_processor',
        message: 'Saved to deployment config; live validation will run after samsar-processor starts.',
      });
    });

  return {
    providers: providerResults,
    available: buildAvailableFromProviderResults(providerResults),
  };
}

function isLocalProcessorUnavailable(error) {
  return error?.message === 'Failed to fetch' || error?.name === 'TypeError';
}

function getSamsarApiErrorMessage(error) {
  const body = error?.body;
  if (body && typeof body === 'object' && typeof body.message === 'string') {
    return body.message;
  }
  return error?.message || 'Invalid Samsar API key.';
}

function buildInvalidSamsarResult(error) {
  return {
    providers: {
      samsar: {
        provider: 'samsar',
        status: 'invalid',
        ok: false,
        statusCode: error?.status || null,
        message: getSamsarApiErrorMessage(error),
      },
    },
    available: { providers: [], models: [], actions: [] },
  };
}

async function fetchSamsarApiKeyValidation(samsarApiKey) {
  const response = await fetch(SAMSAR_API_KEY_VALIDATION_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${samsarApiKey}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.message || 'Invalid Samsar API key.');
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function buildSamsarApiKeyResult(data = {}) {
  const isValid = data?.valid !== false;
  const providerStatus = {
    samsar: {
      ...data,
      provider: 'samsar',
      status: isValid ? 'valid' : 'invalid',
      ok: isValid,
    },
  };
  return {
    providers: providerStatus,
    available: isValid ? buildAvailableFromProviderResults(providerStatus) : EMPTY_AVAILABLE,
  };
}

function mergeValidationResults(results) {
  const resolvedResults = results.filter(Boolean);
  const providers = Object.assign({}, ...resolvedResults.map((result) => result.providers || {}));
  return {
    providers,
    available: buildAvailableFromProviderResults(providers),
  };
}

function uniqueInOrder(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function orderProviderKeys(providerKeys = []) {
  return orderDockerProviderKeys(uniqueInOrder(providerKeys));
}

function getEnabledProviderKeys(validationResult = {}) {
  return orderProviderKeys(Object.entries(validationResult?.providers || {})
    .filter(([, result]) => Boolean(result?.ok || result === true))
    .map(([provider]) => provider));
}

function formatProviderList(providerKeys = [], separator = ' or ') {
  return providerKeys.map(formatConfiguredProviderName).join(separator);
}

function getServiceProviderKeys(service) {
  return orderProviderKeys([
    ...(service.providerKeys || []),
    ...(service.modelFamilies || []).flatMap((family) => family.providerKeys || []),
  ]);
}

function buildCapabilityFamilyAvailability(family, enabledProviderSet) {
  return buildDockerCapabilityFamilyAvailability(family, [...enabledProviderSet]);
}

function buildSetupServiceAvailability(validationResult = {}) {
  const enabledProviderSet = new Set(getEnabledProviderKeys(validationResult));
  return SETUP_SERVICE_CATALOG.map((service) => {
    const families = (service.modelFamilies || []).map((family) => buildCapabilityFamilyAvailability(family, enabledProviderSet));
    const providerKeys = getServiceProviderKeys(service);
    const enabledProviderKeys = providerKeys.filter((providerKey) => enabledProviderSet.has(providerKey));
    const availableFamilies = families.filter((family) => family.isAvailable);
    const lockedFamilies = families.filter((family) => !family.isAvailable);
    return {
      ...service,
      providerKeys,
      enabledProviderKeys,
      families,
      availableFamilies,
      lockedFamilies,
      isAvailable: Boolean(service.alwaysAvailable || enabledProviderKeys.length || availableFamilies.length),
    };
  });
}

function getInvalidEnteredProviders(credentials, validationResult) {
  return PROVIDERS.filter((provider) => {
    if (!hasCredentialValue(credentials, provider)) {
      return false;
    }
    return !getProviderStatus(validationResult, provider.key)?.ok;
  });
}

function buildDeploymentPayload(
  credentials,
  services,
  dataConfig,
  validationResult,
  mailConfig,
  mailValidationResult,
  reverseProxyConfig,
  reverseProxyValidationResult,
) {
  const sanitizedCredentials = normalizeCredentialSet(credentials);
  const infrastructure = buildInfrastructureConfig(dataConfig);
  const reverseProxy = buildReverseProxyDeploymentConfig(reverseProxyConfig, reverseProxyValidationResult);
  return {
    providers: {
      samsar: { enabled: Boolean(sanitizedCredentials.samsarApiKey), validation: getProviderStatus(validationResult, 'samsar') },
      openai: { enabled: Boolean(sanitizedCredentials.openaiApiKey), validation: getProviderStatus(validationResult, 'openai') },
      openrouter: { enabled: Boolean(sanitizedCredentials.openrouterApiKey), validation: getProviderStatus(validationResult, 'openrouter') },
      googleCloud: { enabled: Boolean(sanitizedCredentials.googleCredentialsJson), validation: getProviderStatus(validationResult, 'googleCloud') },
      kimi: { enabled: Boolean(sanitizedCredentials.kimiK3ApiKey), validation: getProviderStatus(validationResult, 'kimi') },
      alibabaCloud: { enabled: Boolean(sanitizedCredentials.alibabaApiKey), validation: getProviderStatus(validationResult, 'alibabaCloud') },
      fal: { enabled: Boolean(sanitizedCredentials.falApiKey), validation: getProviderStatus(validationResult, 'fal') },
      elevenlabs: { enabled: Boolean(sanitizedCredentials.elevenLabsApiKey), validation: getProviderStatus(validationResult, 'elevenlabs') },
      runway: { enabled: Boolean(sanitizedCredentials.runwayApiKey), validation: getProviderStatus(validationResult, 'runway') },
    },
    services: buildServicePayload(services, infrastructure),
    infrastructure,
    mail: buildMailDeploymentConfig(mailConfig, mailValidationResult),
    reverseProxy,
    publicUrls: reverseProxy.enabled ? reverseProxy.publicUrls : {},
    available: validationResult?.available || { providers: [], models: [], actions: [] },
  };
}

function getSetupStepIndicator(status) {
  if (status === 'complete') return '✓';
  if (status === 'running') return '...';
  if (status === 'failed') return '!';
  return '';
}

function getSetupStepClassName(status) {
  return ['setup-step', status ? `setup-step-${status}` : ''].filter(Boolean).join(' ');
}

function formatPortList(ports = []) {
  const normalizedPorts = [...new Set((Array.isArray(ports) ? ports : [ports])
    .map((port) => Number.parseInt(String(port), 10))
    .filter((port) => Number.isFinite(port)))]
    .sort((left, right) => left - right);
  if (!normalizedPorts.length) {
    return 'ports';
  }
  if (normalizedPorts.length === 1) {
    return `port ${normalizedPorts[0]}`;
  }
  return `ports ${normalizedPorts.slice(0, -1).join(', ')} and ${normalizedPorts.at(-1)}`;
}

async function checkUrlFromBrowser(check = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(check.url, {
      cache: 'no-store',
      mode: 'no-cors',
      signal: controller.signal,
    });
    return {
      ...check,
      reachable: true,
      checkedFrom: 'browser',
      message: `${check.label || 'Endpoint'} was reachable from this browser at ${check.url}.`,
    };
  } catch (error) {
    return {
      ...check,
      reachable: false,
      checkedFrom: 'browser',
      message: `${check.label || 'Endpoint'} was not reachable from this browser at ${check.url}: ${error?.message || String(error)}.`,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function checkExternalAccessFromBrowser(externalAccess = {}) {
  const checks = Array.isArray(externalAccess.checks) ? externalAccess.checks : [];
  const browserChecks = await Promise.all(checks.map(checkUrlFromBrowser));
  const failedChecks = browserChecks.filter((check) => !check.reachable);
  return {
    ...externalAccess,
    ok: failedChecks.length === 0,
    source: 'browser',
    checks: browserChecks,
    checkedAt: new Date().toISOString(),
    message: failedChecks.length
      ? `${failedChecks.length} external endpoint${failedChecks.length === 1 ? '' : 's'} did not respond from this browser.`
      : 'External client and API URLs responded from this browser.',
  };
}

function SetupProgressPage({
  setupRun,
  setupError,
  onRetry,
  onBack,
  onOpenPorts,
  isOpeningPorts,
  openPortsResult,
  openPortsError,
  browserExternalAccess,
  isCheckingBrowserExternalAccess,
  mode = 'setup',
}) {
  const isComplete = setupRun?.status === 'completed';
  const isFailed = setupRun?.status === 'failed';
  const currentStep = setupRun?.steps?.find((item) => item.status === 'running');
  const logs = setupRun?.logs || [];
  const isMaintenance = mode === 'maintenance';
  const externalAccess = setupRun?.externalAccess;
  const displayExternalAccess = browserExternalAccess || externalAccess;
  const externalAccessWarning = displayExternalAccess && displayExternalAccess.ok === false && !displayExternalAccess.skipped;
  const externalPorts = displayExternalAccess?.ports || [];
  const remediation = displayExternalAccess?.remediation;

  return (
    <section className="setup-progress-panel">
      <div className="setup-progress-header">
        <div>
          <div className="eyebrow">{isMaintenance ? 'Docker update' : 'Docker setup'}</div>
          <h2>
            {isMaintenance
              ? isComplete ? 'Containers are updated' : isFailed ? 'Update needs attention' : 'Updating local containers'
              : isComplete ? 'Containers are ready' : isFailed ? 'Setup needs attention' : 'Setting up local containers'}
          </h2>
        </div>
        <span className={`setup-status-pill setup-status-${setupRun?.status || 'starting'}`}>
          {isComplete ? 'Complete' : isFailed ? 'Failed' : 'Running'}
        </span>
      </div>

      <div className="setup-progress-layout">
        <div className="setup-step-list">
          {(setupRun?.steps || []).map((item) => (
            <div className={getSetupStepClassName(item.status)} key={item.id}>
              <span className="setup-step-marker">{getSetupStepIndicator(item.status)}</span>
              <div>
                <strong>{item.label}</strong>
                {item.message && <small>{item.message}</small>}
              </div>
            </div>
          ))}
        </div>

        <div className="setup-live-panel">
          <h3>{currentStep?.label || (isComplete ? 'Opening Samsar client' : 'Setup status')}</h3>
          <p>
            {isComplete && (isMaintenance
              ? 'The local stack has been rebuilt and restarted.'
              : 'The local stack is ready. Redirecting to the authenticated Samsar client.')}
            {isFailed && (setupRun?.error || setupError || 'Setup failed. Review the latest log output and retry.')}
            {!isComplete && !isFailed && (isMaintenance
              ? 'Keep this page open while Docker pulls, rebuilds, and restarts the selected services.'
              : 'Keep this page open while Docker builds and starts the selected services.')}
          </p>
          {setupRun?.redirectUrl && (
            <a className="setup-client-link" href={setupRun.redirectUrl}>
              Open Samsar client
            </a>
          )}
          {!!logs.length && (
            <div className="setup-log" aria-label="Setup log">
              {logs.slice(-10).map((entry, index) => (
                <div key={`${entry.at}-${index}`}>{entry.message}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isCheckingBrowserExternalAccess && (
        <section className="data-config-card">
          <div className="data-config-card-header">
            <h3>External access</h3>
            <span>Checking</span>
          </div>
          <p>Checking the final client and API URLs from this browser.</p>
        </section>
      )}

      {externalAccessWarning && (
        <section className="data-config-card proxy-warning-card">
          <div className="data-config-card-header">
            <h3>External access</h3>
            <span>{formatPortList(externalPorts)}</span>
          </div>
          <p>{displayExternalAccess.message || `External access did not respond on ${formatPortList(externalPorts)}.`}</p>
          {!!displayExternalAccess.checks?.length && (
            <ul className="external-check-list">
              {displayExternalAccess.checks.map((check) => (
                <li key={check.url}>
                  <strong>{check.label}</strong>
                  <span>{check.message}</span>
                </li>
              ))}
            </ul>
          )}
          {remediation && (
            <div className="external-remediation">
              <strong>{remediation.title}</strong>
              <p>{remediation.message}</p>
              {!!remediation.commands?.length && (
                <div className="external-command-list">
                  {remediation.commands.map((command) => (
                    <code key={command}>{command}</code>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="proxy-action-row">
            <button
              type="button"
              className="secondary-action"
              onClick={() => onOpenPorts?.(externalPorts)}
              disabled={isOpeningPorts}
            >
              {isOpeningPorts ? 'Opening ports...' : 'Open required ports'}
            </button>
          </div>
          {openPortsResult?.ok && <div className="success-banner">{openPortsResult.message || 'Port rule command completed.'}</div>}
          {openPortsError && <div className="error-banner">{openPortsError}</div>}
        </section>
      )}

      {(setupError || isFailed) && (
        <div className="setup-error-actions">
          <button type="button" className="secondary-action" onClick={onBack}>
            Back
          </button>
          <button type="button" className="primary-action flow-primary" onClick={onRetry}>
            {isMaintenance ? 'Retry update' : 'Retry setup'}
          </button>
        </div>
      )}
    </section>
  );
}

function formatConfiguredProviderName(key) {
  const provider = PROVIDERS.find((item) => item.key === key);
  return provider?.title || key;
}

function SetupAuthGate({
  password,
  error,
  isUnlocking,
  onPasswordChange,
  onUnlock,
}) {
  return (
    <section className="existing-install-panel">
      <div className="existing-install-header">
        <div>
          <div className="eyebrow">Protected setup</div>
          <h2>Unlock setup actions</h2>
          <p>Enter the Docker admin password to continue this setup or recovery run.</p>
        </div>
        <span className="setup-status-pill setup-status-starting">Locked</span>
      </div>
      <section className="data-config-card admin-create-card">
        <div className="data-field-grid single">
          <label className="data-field">
            <span>Admin password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </label>
        </div>
        <div className="existing-install-actions">
          <button
            type="button"
            className="primary-action flow-primary"
            onClick={onUnlock}
            disabled={isUnlocking || !password}
          >
            {isUnlocking ? 'Unlocking...' : 'Unlock'}
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </section>
    </section>
  );
}

function ExistingInstallHome({
  installStatus,
  isRefreshing,
  actionError,
  adminConfig,
  adminConfigError,
  adminBootstrapError,
  isBootstrappingAdmin,
  setupAuthRequired,
  isSetupAuthenticated,
  setupAuthPassword,
  setupAuthError,
  isUnlockingSetup,
  onAdminChange,
  onBootstrapAdmin,
  onSetupAuthPasswordChange,
  onUnlockSetup,
  onRefresh,
  onUpdateContainers,
  onDeleteAndRecreate,
  isResetting,
}) {
  const config = installStatus?.config || {};
  const providers = Object.entries(config.providers || {})
    .filter(([, provider]) => provider?.enabled || provider?.configured)
    .map(([key]) => formatConfiguredProviderName(key));
  const services = config.services || {};
  const runningCount = installStatus?.compose?.running || 0;
  const totalCount = installStatus?.compose?.total || 0;
  const setupActionsLocked = Boolean(setupAuthRequired && !isSetupAuthenticated);
  const needsAdminBootstrap = !setupActionsLocked && config.security?.dockerSetupConfigured !== true;

  return (
    <section className="existing-install-panel">
      <div className="existing-install-header">
        <div>
          <div className="eyebrow">Docker installation</div>
          <h2>Existing configuration</h2>
          <p>
            {runningCount > 0
              ? `${runningCount} of ${totalCount} local containers are running.`
              : `${totalCount} local containers are configured.`}
          </p>
        </div>
        <span className={`setup-status-pill ${runningCount > 0 ? 'setup-status-completed' : 'setup-status-starting'}`}>
          {runningCount > 0 ? 'Running' : 'Configured'}
        </span>
      </div>

      {!setupActionsLocked && (
        <div className="existing-config-grid">
          <section className="existing-config-card">
            <h3>Providers</h3>
            <ul>
              {(providers.length ? providers : ['No provider credentials configured']).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="existing-config-card">
            <h3>Data</h3>
            <ul>
              <li>{config.database?.mode === 'remote' ? 'Remote MongoDB' : 'Local MongoDB'}</li>
              <li>{config.storage?.mode === 'external-s3' ? 'External S3 / CloudFront' : 'Local MinIO media'}</li>
              {config.storage?.staticCdnUrl && <li>{config.storage.staticCdnUrl}</li>}
            </ul>
          </section>
          <section className="existing-config-card">
            <h3>Services</h3>
            <ul>
              <li>{services.workers ? 'Workers enabled' : 'Core services only'}</li>
              <li>{services.logger ? 'Grafana logger enabled' : 'Grafana logger disabled'}</li>
              <li>{services.reverseProxy ? 'Nginx reverse proxy enabled' : 'Reverse proxy disabled'}</li>
              <li>{installStatus?.readiness?.processor ? 'Processor ready' : 'Processor not ready'}</li>
              <li>{installStatus?.readiness?.client ? 'Client ready' : 'Client not ready'}</li>
            </ul>
          </section>
        </div>
      )}

      {needsAdminBootstrap && (
        <section className="data-config-card admin-create-card">
          <div className="data-config-card-header">
            <h3>Create Admin user</h3>
          </div>
          <div className="data-field-grid">
            <label className="data-field">
              <span>Admin email</span>
              <input
                type="email"
                value={adminConfig.email}
                placeholder="admin@example.com"
                autoComplete="email"
                onChange={(event) => onAdminChange('email', event.target.value)}
              />
            </label>
            <label className="data-field">
              <span>Organization name / username</span>
              <input
                value={adminConfig.organizationName}
                placeholder="Acme Studio or admin"
                onChange={(event) => onAdminChange('organizationName', event.target.value)}
              />
            </label>
            <label className="data-field">
              <span>Password</span>
              <input
                type="password"
                value={adminConfig.password}
                autoComplete="new-password"
                onChange={(event) => onAdminChange('password', event.target.value)}
              />
            </label>
            <label className="data-field">
              <span>Confirm password</span>
              <input
                type="password"
                value={adminConfig.confirmPassword}
                autoComplete="new-password"
                onChange={(event) => onAdminChange('confirmPassword', event.target.value)}
              />
            </label>
          </div>
          <div className="existing-install-actions">
            <button
              type="button"
              className="primary-action flow-primary"
              onClick={onBootstrapAdmin}
              disabled={isBootstrappingAdmin || setupActionsLocked}
            >
              {isBootstrappingAdmin ? 'Preparing admin...' : 'Submit and Continue'}
            </button>
          </div>
          {adminConfigError && <div className="error-banner">{adminConfigError}</div>}
          {adminBootstrapError && <div className="error-banner">{adminBootstrapError}</div>}
        </section>
      )}

      {setupActionsLocked && (
        <section className="data-config-card admin-create-card">
          <div className="data-config-card-header">
            <h3>Unlock setup actions</h3>
          </div>
          <div className="data-field-grid single">
            <label className="data-field">
              <span>Admin password</span>
              <input
                type="password"
                value={setupAuthPassword}
                autoComplete="current-password"
                onChange={(event) => onSetupAuthPasswordChange(event.target.value)}
              />
            </label>
          </div>
          <div className="existing-install-actions">
            <button
              type="button"
              className="primary-action flow-primary"
              onClick={onUnlockSetup}
              disabled={isUnlockingSetup}
            >
              {isUnlockingSetup ? 'Unlocking...' : 'Unlock'}
            </button>
          </div>
          {setupAuthError && <div className="error-banner">{setupAuthError}</div>}
        </section>
      )}

      {actionError && <div className="error-banner">{actionError}</div>}

      <div className="existing-install-actions">
        <button type="button" className="secondary-action" onClick={onRefresh} disabled={isRefreshing || isResetting}>
          {isRefreshing ? 'Refreshing...' : 'Refresh status'}
        </button>
        <button type="button" className="primary-action flow-primary" onClick={onUpdateContainers} disabled={isResetting || setupActionsLocked}>
          Update containers
        </button>
        <button type="button" className="reset-confirm-action" onClick={onDeleteAndRecreate} disabled={isResetting || setupActionsLocked}>
          {isResetting ? 'Deleting...' : 'Delete and recreate'}
        </button>
      </div>
    </section>
  );
}

function ResetConfirmDialog({ isOpen, isResetting, resetError, onCancel, onConfirm }) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="reset-dialog-backdrop">
      <section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-dialog-title">
        <div className="reset-dialog-icon" aria-hidden="true">↺</div>
        <div className="reset-dialog-copy">
          <h2 id="reset-dialog-title">Reset setup</h2>
          <p>
            This clears the wizard state, stops the local Docker Compose stack, removes orphan containers, and deletes generated local runtime config.
          </p>
        </div>
        {resetError && <div className="error-banner">{resetError}</div>}
        <div className="reset-dialog-actions">
          <button type="button" className="secondary-action" onClick={onCancel} disabled={isResetting}>
            Cancel
          </button>
          <button type="button" className="reset-confirm-action" onClick={onConfirm} disabled={isResetting}>
            {isResetting ? 'Resetting...' : 'Reset'}
          </button>
        </div>
      </section>
    </div>
  );
}

function ExpressPipelineWarningDialog({ missingRequirements, onReviewProviders, onContinue }) {
  if (!missingRequirements?.length) {
    return null;
  }

  return (
    <div className="reset-dialog-backdrop">
      <section
        className="reset-dialog express-warning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="express-warning-dialog-title"
      >
        <div className="express-warning-dialog-icon" aria-hidden="true">!</div>
        <div className="reset-dialog-copy">
          <h2 id="express-warning-dialog-title">Express model access is incomplete</h2>
          <p>
            Express generation and the agent will not be available until at least one model is enabled for each missing type:
          </p>
          <ul className="express-missing-list" aria-label="Missing model types">
            {missingRequirements.map((requirement) => <li key={requirement.key}>{requirement.label}</li>)}
          </ul>
          <p>
            Optionally add a Samsar-js key by getting credits and enabling an API key{' '}
            <a href="https://app.samsar.one" target="_blank" rel="noreferrer">here</a>
            {' '}to enable access to all models.
          </p>
        </div>
        <div className="reset-dialog-actions express-warning-actions">
          <button type="button" className="secondary-action" onClick={onContinue}>
            Continue without Express
          </button>
          <button type="button" className="primary-action" onClick={onReviewProviders} autoFocus>
            Review providers
          </button>
        </div>
      </section>
    </div>
  );
}

async function validateSamsarCredential(credentials) {
  const samsarApiKey = credentials.samsarApiKey.trim();
  if (!samsarApiKey) {
    return null;
  }

  try {
    const result = await samsarApiClient.validateProcessorApiKey(samsarApiKey);
    return buildSamsarApiKeyResult(result.data);
  } catch (error) {
    if (error?.status && error.status < 500) {
      return buildInvalidSamsarResult(error);
    }

    try {
      return buildSamsarApiKeyResult(await fetchSamsarApiKeyValidation(samsarApiKey));
    } catch (fallbackError) {
      if (fallbackError?.status && fallbackError.status < 500) {
        return buildInvalidSamsarResult(fallbackError);
      }
      const statusText = error?.status || fallbackError?.status
        ? `status ${error?.status || fallbackError?.status}`
        : 'network request failed';
      throw new Error(
        `Unable to validate the Samsar API key at ${SAMSAR_API_KEY_VALIDATION_URL} (${statusText}: ${getSamsarApiErrorMessage(fallbackError || error)}).`,
      );
    }
  }
}

async function validateNativeCredentials(credentials) {
  if (!hasStandardNativeCredentialValue(credentials)) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/external/providers/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildNativeCredentialPayload(credentials)),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.message || 'Credential validation failed.');
    }
    return body;
  } catch (error) {
    if (isLocalProcessorUnavailable(error)) {
      return buildLocalNativeCredentialResult(credentials);
    }
    throw error;
  }
}

async function validateAlibabaCredential(credentials, headers = {}) {
  const apiKey = credentials.alibabaApiKey.trim();
  if (!apiKey) {
    return null;
  }

  const response = await fetch('/api/setup/providers/alibaba/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      alibabaApiKey: apiKey,
      alibabaApiHost: credentials.alibabaApiHost.trim(),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || 'Alibaba Cloud credential validation failed.');
  }
  return body;
}

async function validateOpenRouterCredential(credentials, headers = {}) {
  const apiKey = credentials.openrouterApiKey.trim();
  if (!apiKey) {
    return null;
  }

  const response = await fetch('/api/setup/providers/openrouter/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ openrouterApiKey: apiKey }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || 'OpenRouter credential validation failed.');
  }
  return body;
}

function getInitialColorMode() {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  return window.localStorage.getItem('colorMode') === 'light' ? 'light' : 'dark';
}

export default function OnboardingWizard() {
  const wizardShellRef = useRef(null);
  const adminEmailInputRef = useRef(null);
  const [initialWizardState] = useState(buildInitialWizardState);
  const [step, setStep] = useState(initialWizardState.step);
  const [colorMode, setColorMode] = useState(getInitialColorMode);
  const [credentials, setCredentials] = useState(initialWizardState.credentials);
  const [services, setServices] = useState(initialWizardState.services);
  const [mailConfig, setMailConfig] = useState(initialWizardState.mailConfig);
  const [mailValidationResult, setMailValidationResult] = useState(initialWizardState.mailValidationResult);
  const [mailValidationError, setMailValidationError] = useState('');
  const [isValidatingMail, setIsValidatingMail] = useState(false);
  const [dataConfig, setDataConfig] = useState(initialWizardState.dataConfig);
  const [reverseProxyConfig, setReverseProxyConfig] = useState(initialWizardState.reverseProxyConfig);
  const [reverseProxyValidationResult, setReverseProxyValidationResult] = useState(initialWizardState.reverseProxyValidationResult);
  const [reverseProxyValidationError, setReverseProxyValidationError] = useState('');
  const [isValidatingReverseProxy, setIsValidatingReverseProxy] = useState(false);
  const [ipDiscoveryResult, setIpDiscoveryResult] = useState(null);
  const [ipDiscoveryError, setIpDiscoveryError] = useState('');
  const [isDiscoveringIps, setIsDiscoveringIps] = useState(false);
  const [firewallResult, setFirewallResult] = useState(null);
  const [firewallError, setFirewallError] = useState('');
  const [isOpeningFirewallPorts, setIsOpeningFirewallPorts] = useState(false);
  const [adminConfig, setAdminConfig] = useState(initialWizardState.adminConfig);
  const [adminConfigError, setAdminConfigError] = useState('');
  const [existingAdminBootstrapError, setExistingAdminBootstrapError] = useState('');
  const [isBootstrappingExistingAdmin, setIsBootstrappingExistingAdmin] = useState(false);
  const [setupAuthPassword, setSetupAuthPassword] = useState('');
  const [setupAuthError, setSetupAuthError] = useState('');
  const [isSetupAuthenticated, setIsSetupAuthenticated] = useState(false);
  const [isUnlockingSetup, setIsUnlockingSetup] = useState(false);
  const [validationResult, setValidationResult] = useState(initialWizardState.validationResult);
  const [validationError, setValidationError] = useState('');
  const [dataConfigError, setDataConfigError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isConfigCopied, setIsConfigCopied] = useState(false);
  const [isStartingSetup, setIsStartingSetup] = useState(false);
  const [setupRun, setSetupRun] = useState(initialWizardState.setupRun);
  const [setupStartError, setSetupStartError] = useState(initialWizardState.setupStartError);
  const [browserExternalAccess, setBrowserExternalAccess] = useState(null);
  const [isCheckingBrowserExternalAccess, setIsCheckingBrowserExternalAccess] = useState(false);
  const [maxStep, setMaxStep] = useState(initialWizardState.maxStep);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [installStatus, setInstallStatus] = useState(null);
  const [isLoadingInstallStatus, setIsLoadingInstallStatus] = useState(true);
  const [installActionError, setInstallActionError] = useState('');
  const [maintenanceRun, setMaintenanceRun] = useState(null);
  const [maintenanceStartError, setMaintenanceStartError] = useState('');
  const [expressWarningMissingRequirements, setExpressWarningMissingRequirements] = useState([]);
  const [providerDrawersOpen, setProviderDrawersOpen] = useState({
    inference: true,
    fallbacks: true,
    media: true,
  });

  const deploymentPayload = useMemo(
    () => buildDeploymentPayload(
      credentials,
      services,
      dataConfig,
      validationResult,
      mailConfig,
      mailValidationResult,
      reverseProxyConfig,
      reverseProxyValidationResult,
    ),
    [credentials, dataConfig, mailConfig, mailValidationResult, reverseProxyConfig, reverseProxyValidationResult, services, validationResult],
  );
  const displayDeploymentPayload = useMemo(
    () => sanitizeDeploymentPayloadForDisplay(deploymentPayload),
    [deploymentPayload],
  );
  const setupServiceAvailability = useMemo(
    () => buildSetupServiceAvailability(validationResult),
    [validationResult],
  );
  const configuredProviderKeys = useMemo(
    () => getEnabledProviderKeys(validationResult),
    [validationResult],
  );
  const enteredProviderKeys = useMemo(
    () => PROVIDERS.filter((provider) => hasCredentialValue(credentials, provider)).map((provider) => provider.key),
    [credentials],
  );
  const enteredProviderAvailability = useMemo(
    () => buildDockerAvailableModelsFromEnabledProviders(enteredProviderKeys),
    [enteredProviderKeys],
  );
  const expressPipelineAvailability = useMemo(
    () => buildExpressPipelineAvailability(validationResult?.available || enteredProviderAvailability),
    [enteredProviderAvailability, validationResult],
  );
  const availableSetupServiceCount = setupServiceAvailability.filter((service) => service.isAvailable).length;
  const activeStep = STEPS.find((item) => item.id === step) || STEPS[0];
  const normalizedReverseProxyConfig = normalizeReverseProxyConfig(reverseProxyConfig);
  const reverseProxyUsesDomain = normalizedReverseProxyConfig.accessType === 'publicDomain';
  const reverseProxyUsesPublicIp = normalizedReverseProxyConfig.accessType === 'publicIp';
  const reverseProxyHostLabel = reverseProxyUsesDomain
    ? 'domain / subdomain'
    : reverseProxyUsesPublicIp
      ? 'public IP'
      : 'private IP';
  const reverseProxyHostPlaceholder = reverseProxyUsesDomain
    ? 'app.example.com'
    : reverseProxyUsesPublicIp
      ? '203.0.113.10'
      : '192.168.1.25';
  const detectedPublicIp = ipDiscoveryResult?.publicIp || '';
  const publicIpReachability = ipDiscoveryResult?.publicIpReachability || {};
  const publicIpReachabilityChecked = Boolean(publicIpReachability.checked);
  const publicIpReachable = Boolean(publicIpReachability.reachable);
  const publicIpHardBlocked = Boolean(ipDiscoveryResult?.runtime?.dockerDesktop && publicIpReachabilityChecked && !publicIpReachable);
  const publicIpSelectionDisabled = Boolean(detectedPublicIp && publicIpHardBlocked);
  const detectedPrivateIps = Array.isArray(ipDiscoveryResult?.privateIps) ? ipDiscoveryResult.privateIps : [];
  const detectedPrivateIp = ipDiscoveryResult?.recommendedPrivateIp || detectedPrivateIps[0] || '';
  const recommendedReverseProxyIp = reverseProxyUsesPublicIp
    ? publicIpSelectionDisabled ? '' : detectedPublicIp
    : detectedPrivateIp;
  const reverseProxyCanEnableSsl = Boolean(
    normalizedReverseProxyConfig.enabled &&
    reverseProxyUsesDomain &&
    reverseProxyValidationResult?.ok,
  );
  const reverseProxyRequiredPorts = normalizedReverseProxyConfig.sslEnabled ? [80, 443] : [80];
  const reverseProxyRequiredPortLabel = reverseProxyRequiredPorts.length === 1 ? '80' : '80 / 443';
  const reverseProxyRequiredPortText = reverseProxyRequiredPorts.length === 1 ? 'port 80' : 'ports 80 and 443';
  const sesAccessKeyUsesTemporaryCredentials = isTemporaryAwsAccessKeyId(mailConfig.sesAccessKeyId);
  const setupAuthRequired = Boolean(installStatus?.setupAuthRequired || installStatus?.config?.security?.setupWizardPasswordConfigured);
  const shouldShowExistingInstall = Boolean(installStatus?.installed && !setupRun && !maintenanceRun);
  const isInitialInstallStatusLoading = Boolean(isLoadingInstallStatus && !installStatus && !setupRun && !maintenanceRun);
  const wizardViewKey = isInitialInstallStatusLoading
    ? 'loading'
    : maintenanceRun?.id
      ? `maintenance-${maintenanceRun.id}`
      : setupRun?.id
        ? `setup-${setupRun.id}`
        : shouldShowExistingInstall
          ? 'existing-install'
          : `step-${step}`;

  const toggleProviderDrawer = (drawerKey) => {
    setProviderDrawersOpen((currentValue) => ({
      ...currentValue,
      [drawerKey]: !currentValue[drawerKey],
    }));
  };

  const buildSetupHeaders = (headers = {}, password = setupAuthPassword) => ({
    ...headers,
    ...(password ? { 'x-samsar-setup-admin-password': password } : {}),
  });

  const handleSetupAuthFailure = (body = {}) => {
    setIsSetupAuthenticated(false);
    setSetupAuthError(body?.message || 'Enter the Docker admin password to manage this setup wizard.');
  };

  const renderProviderRow = (provider) => {
    const isSamsarProvider = provider.type === 'samsar';
    const providerModels = PROVIDER_MODELS_BY_KEY[provider.key] || [];
    const rowClassName = [
      'provider-row',
      isSamsarProvider ? 'provider-row-featured' : 'provider-row-native',
    ].filter(Boolean).join(' ');

    return (
      <section className={rowClassName} key={provider.key}>
        <div className="provider-meta">
          <div className="provider-heading">
            <label className="provider-title" htmlFor={`${provider.key}-credential`}>
              {provider.title}
            </label>
            <a className="provider-key-link" href={provider.keysUrl} target="_blank" rel="noreferrer">
              Get key
            </a>
          </div>
          <span className="provider-subtext">{provider.requiredFor}</span>
          <div className="provider-meta-actions">
            {provider.badge && <span className="provider-badge">{provider.badge}</span>}
            <a className="provider-pricing-link" href={provider.pricingUrl} target="_blank" rel="noreferrer">
              Pricing
            </a>
          </div>
          <div className="provider-model-access">
            <span className="provider-model-access-label">
              Enables {providerModels.length} {providerModels.length === 1 ? 'model' : 'models'}
            </span>
            <div className="provider-model-list" aria-label={`${provider.title} enabled models`}>
              {providerModels.map((model) => (
                <span className="provider-model-chip" key={model.modelKey}>{model.label}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="provider-control">
          <label className="credential-label" htmlFor={`${provider.key}-credential`}>
            {provider.credentialLabel}
          </label>
          {provider.inputType === 'textarea' ? (
            <textarea
              id={`${provider.key}-credential`}
              value={credentials[provider.field]}
              placeholder={provider.placeholder}
              autoComplete="new-password"
              data-lpignore="true"
              onChange={(event) => updateCredential(provider.field, event.target.value)}
              spellCheck="false"
            />
          ) : (
            <input
              id={`${provider.key}-credential`}
              type={provider.inputType}
              value={credentials[provider.field]}
              placeholder={provider.placeholder}
              autoComplete="new-password"
              data-lpignore="true"
              onChange={(event) => updateCredential(provider.field, event.target.value)}
            />
          )}
          {provider.endpointField && (
            <>
              <label className="credential-label" htmlFor={`${provider.key}-endpoint`}>
                {provider.endpointLabel}
              </label>
              <input
                id={`${provider.key}-endpoint`}
                type="text"
                value={credentials[provider.endpointField]}
                placeholder={provider.endpointPlaceholder}
                autoComplete="off"
                data-lpignore="true"
                onChange={(event) => updateCredential(provider.endpointField, event.target.value)}
                spellCheck="false"
              />
              {provider.endpointHelp && <small className="provider-endpoint-help">{provider.endpointHelp}</small>}
            </>
          )}
        </div>
      </section>
    );
  };

  useEffect(() => {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(colorMode === 'dark' ? 'theme-dark' : 'theme-light');
    window.localStorage.setItem('colorMode', colorMode);
  }, [colorMode]);

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      wizardShellRef.current?.scrollTo?.({ top: 0, behavior: 'auto' });
      window.scrollTo({ top: 0, behavior: 'auto' });
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [wizardViewKey]);

  useEffect(() => {
    if (step !== 5 || setupRun || shouldShowExistingInstall || maintenanceRun || isInitialInstallStatusLoading) {
      return undefined;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      adminEmailInputRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [isInitialInstallStatusLoading, maintenanceRun, setupRun, shouldShowExistingInstall, step]);

  const refreshInstallStatus = async () => {
    setIsLoadingInstallStatus(true);
    try {
      const response = await fetch('/api/setup/install-status', {
        cache: 'no-store',
        headers: buildSetupHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.message || 'Unable to read local installation status.');
      }
      setInstallStatus(body);
      setInstallActionError('');
      if (!body?.setupAuthRequired) {
        setIsSetupAuthenticated(false);
        setSetupAuthError('');
      }
      if (body?.installed && setupRun?.status !== 'running') {
        setSetupRun(null);
        setSetupStartError('');
      }
      return body;
    } catch (error) {
      setInstallActionError(error?.message || 'Unable to read local installation status.');
      return null;
    } finally {
      setIsLoadingInstallStatus(false);
    }
  };

  useEffect(() => {
    void refreshInstallStatus();
  }, []);

  useEffect(() => {
    writeStoredWizardState({
      step,
      maxStep,
	      credentials: {
          ...credentials,
          kimiK3ApiKey: '',
          alibabaApiKey: '',
          openrouterApiKey: '',
        },
	      services,
	      mailConfig: {
        ...mailConfig,
        smtpPassword: '',
        sesSecretAccessKey: '',
        sesSessionToken: '',
      },
	      mailValidationResult,
	      dataConfig,
        reverseProxyConfig,
        reverseProxyValidationResult,
	      adminConfig: {
        ...adminConfig,
        password: '',
        confirmPassword: '',
      },
	      validationResult,
	      setupRun,
	      setupStartError,
	    });
	  }, [adminConfig, credentials, dataConfig, mailConfig, mailValidationResult, maxStep, reverseProxyConfig, reverseProxyValidationResult, services, setupRun, setupStartError, step, validationResult]);

  useEffect(() => {
    if (!setupRun?.id || setupRun.status === 'completed' || setupRun.status === 'failed') {
      return undefined;
    }

    let isCancelled = false;

    const refreshSetupStatus = async () => {
      try {
        const response = await fetch(`/api/setup/status?id=${encodeURIComponent(setupRun.id)}`, {
          cache: 'no-store',
          headers: buildSetupHeaders(),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) {
            handleSetupAuthFailure(body);
          }
          if (response.status === 404) {
            const recoveryResponse = await fetch(`/api/setup/recover?id=${encodeURIComponent(setupRun.id)}`, {
              cache: 'no-store',
              headers: buildSetupHeaders(),
            });
            const recoveryBody = await recoveryResponse.json().catch(() => ({}));
            if (recoveryResponse.ok) {
              setSetupRun(recoveryBody);
              setSetupStartError('');
              return;
            }
          }
          throw new Error(body?.message || 'Unable to read setup status.');
        }
        if (!isCancelled) {
          setSetupRun(body);
        }
      } catch (error) {
        if (!isCancelled) {
          setSetupStartError(error?.message || 'Unable to read setup status.');
        }
      }
    };

    const intervalId = window.setInterval(refreshSetupStatus, SETUP_POLL_INTERVAL_MS);
    void refreshSetupStatus();

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [setupAuthPassword, setupRun?.id, setupRun?.status]);

  useEffect(() => {
    if (!maintenanceRun?.id || maintenanceRun.status === 'completed' || maintenanceRun.status === 'failed') {
      return undefined;
    }

    let isCancelled = false;

    const refreshMaintenanceStatus = async () => {
      try {
        const response = await fetch(`/api/setup/maintenance/status?id=${encodeURIComponent(maintenanceRun.id)}`, {
          cache: 'no-store',
          headers: buildSetupHeaders(),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) {
            handleSetupAuthFailure(body);
          }
          throw new Error(body?.message || 'Unable to read update status.');
        }
        if (!isCancelled) {
          setMaintenanceRun(body);
          if (body?.status === 'completed') {
            void refreshInstallStatus();
          }
        }
      } catch (error) {
        if (!isCancelled) {
          setMaintenanceStartError(error?.message || 'Unable to read update status.');
        }
      }
    };

    const intervalId = window.setInterval(refreshMaintenanceStatus, SETUP_POLL_INTERVAL_MS);
    void refreshMaintenanceStatus();

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [maintenanceRun?.id, maintenanceRun?.status, setupAuthPassword]);

  useEffect(() => {
    if (
      !setupRun?.id ||
      setupRun.status !== 'failed' ||
      !String(setupRun.error || '').includes('no longer available')
    ) {
      return undefined;
    }

    let isCancelled = false;
    const recoverMissingSetupRun = async () => {
      try {
        const response = await fetch(`/api/setup/recover?id=${encodeURIComponent(setupRun.id)}`, {
          cache: 'no-store',
          headers: buildSetupHeaders(),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) {
            handleSetupAuthFailure(body);
          }
          throw new Error(body?.message || 'Unable to recover setup status.');
        }
        if (!isCancelled) {
          setSetupRun(body);
          setSetupStartError('');
        }
      } catch (error) {
        if (!isCancelled) {
          setSetupStartError(error?.message || 'Unable to recover setup status.');
        }
      }
    };

    void recoverMissingSetupRun();

    return () => {
      isCancelled = true;
    };
  }, [setupAuthPassword, setupRun?.error, setupRun?.id, setupRun?.status]);

  useEffect(() => {
    if (setupRun?.status !== 'completed' || !setupRun.redirectUrl || setupRun.externalAccess?.remoteInstall) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      window.location.assign(setupRun.redirectUrl);
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [setupRun?.externalAccess?.remoteInstall, setupRun?.redirectUrl, setupRun?.status]);

  useEffect(() => {
    const completedRun = setupRun?.status === 'completed'
      ? setupRun
      : maintenanceRun?.status === 'completed'
        ? maintenanceRun
        : null;
    const externalAccess = completedRun?.externalAccess;
    if (!externalAccess || externalAccess.skipped || !externalAccess.checks?.length) {
      setBrowserExternalAccess(null);
      setIsCheckingBrowserExternalAccess(false);
      return undefined;
    }

    let isCancelled = false;
    setIsCheckingBrowserExternalAccess(true);
    setBrowserExternalAccess(null);
    checkExternalAccessFromBrowser(externalAccess)
      .then((result) => {
        if (!isCancelled) {
          setBrowserExternalAccess(result);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setBrowserExternalAccess({
            ...externalAccess,
            ok: false,
            source: 'browser',
            message: error?.message || 'Unable to check external access from this browser.',
          });
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsCheckingBrowserExternalAccess(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    maintenanceRun?.externalAccess?.checkedAt,
    maintenanceRun?.id,
    maintenanceRun?.status,
    setupRun?.externalAccess?.checkedAt,
    setupRun?.id,
    setupRun?.status,
  ]);

  const updateCredential = (field, value) => {
    setCredentials((current) => normalizeCredentialSet({ ...current, [field]: value }));
    setValidationResult(null);
    setValidationError('');
    setExpressWarningMissingRequirements([]);
    setMaxStep(1);
  };

  const updateService = (key, checked) => {
    setServices((current) => ({ ...current, [key]: checked }));
  };

  const updateMailConfig = (field, value) => {
    setMailConfig((current) => {
      const nextValue = pickMailConfig({ ...current, [field]: value });
      if (field === 'smtpSecure') {
        const secure = Boolean(value);
        const currentPort = normalizeText(current.smtpPort);
        nextValue.smtpSecure = secure;
        if (secure && (!currentPort || currentPort === '587')) {
          nextValue.smtpPort = '465';
        } else if (!secure && (!currentPort || currentPort === '465')) {
          nextValue.smtpPort = '587';
        }
      }
      if (field === 'sesAccessKeyId' && !isTemporaryAwsAccessKeyId(value)) {
        nextValue.sesSessionToken = '';
      }
      return nextValue;
    });
    setMailValidationResult(null);
    setMailValidationError('');
    if (step < 4) {
      setMaxStep((currentMaxStep) => Math.min(currentMaxStep, 3));
    }
  };

  const updateDataConfig = (field, value) => {
    setDataConfig((current) => ({ ...current, [field]: value }));
    setDataConfigError('');
    if (step < 4) {
      setMaxStep((currentMaxStep) => Math.min(currentMaxStep, 3));
    }
  };

  const getDetectedIpForAccessType = (accessType, result = ipDiscoveryResult) => (
    accessType === 'publicIp'
      ? publicIpSelectionDisabled ? '' : result?.publicIp || ''
      : result?.recommendedPrivateIp || result?.privateIps?.[0] || ''
  );

  const updateReverseProxyConfig = (field, value) => {
    setReverseProxyConfig((current) => {
      const nextValue = pickReverseProxyConfig({ ...current, [field]: value });
      if (field === 'accessType' && value === 'publicIp' && publicIpSelectionDisabled) {
        return current;
      }
      if (field === 'accessType' && value !== 'publicDomain') {
        nextValue.sslEnabled = false;
        nextValue.sslEmail = '';
        nextValue.machineIp = getDetectedIpForAccessType(value) || nextValue.machineIp;
        nextValue.clientHost = nextValue.machineIp;
        nextValue.processorHost = nextValue.machineIp;
      }
      if (field === 'machineIp' && nextValue.accessType !== 'publicDomain') {
        nextValue.clientHost = value;
        nextValue.processorHost = value;
      }
      return nextValue;
    });
    if (!['sslEnabled', 'sslEmail', 'openFirewallPorts'].includes(field)) {
      setReverseProxyValidationResult(null);
      setReverseProxyValidationError('');
    }
    if (field !== 'openFirewallPorts') {
      setFirewallError('');
      setFirewallResult(null);
    }
    if (step < 5) {
      setMaxStep((currentMaxStep) => Math.min(currentMaxStep, 4));
    }
  };

  const applyDetectedReverseProxyIp = (accessType = normalizedReverseProxyConfig.accessType, result = ipDiscoveryResult) => {
    const detectedIp = getDetectedIpForAccessType(accessType, result);
    if (detectedIp) {
      updateReverseProxyConfig('machineIp', detectedIp);
    }
    return detectedIp;
  };

  const updateAdminConfig = (field, value) => {
    setAdminConfig((current) => pickAdminConfig({ ...current, [field]: value }));
    setAdminConfigError('');
    setExistingAdminBootstrapError('');
  };

  const goToStep = (targetStep) => {
    setStep(Math.min(maxStep, Math.max(1, targetStep)));
  };

  const validateCredentials = async (setupPassword = setupAuthPassword) => {
    if (!hasAnyCredentialValue(credentials)) {
      const emptyResult = {
        providers: {},
        available: { providers: [], models: [], actions: [] },
      };
      setValidationResult(emptyResult);
      setValidationError('');
      return emptyResult;
    }

    setIsValidating(true);
    setValidationError('');
    try {
      const body = mergeValidationResults([
        await validateSamsarCredential(credentials),
        await validateAlibabaCredential(credentials, buildSetupHeaders({}, setupPassword)),
        await validateOpenRouterCredential(credentials, buildSetupHeaders({}, setupPassword)),
        await validateNativeCredentials(credentials),
      ]);
      setValidationResult(body);
      const invalidProviders = getInvalidEnteredProviders(credentials, body);
      if (invalidProviders.length) {
        const invalidNames = invalidProviders.map((provider) => provider.title).join(', ');
        throw new Error(`Could not validate: ${invalidNames}. Check the entered credential values and try again.`);
      }
      return body;
    } catch (error) {
      const message = error?.message === 'Failed to fetch'
        ? `Unable to reach the local processor API at ${API_BASE_URL}. Start samsar-processor before validating native provider credentials.`
        : error?.message || 'Credential validation failed.';
      setValidationError(message);
      return null;
    } finally {
      setIsValidating(false);
    }
  };

  const continueFromProviders = async () => {
    const result = await validateCredentials();
    if (!result) {
      return;
    }
    const expressAvailability = buildExpressPipelineAvailability(result.available);
    if (!expressAvailability.isReady) {
      setExpressWarningMissingRequirements(expressAvailability.missingRequirements);
      return;
    }
    setMaxStep(2);
    setStep(2);
  };

  const continueWithoutExpressPipeline = () => {
    setExpressWarningMissingRequirements([]);
    setMaxStep(2);
    setStep(2);
  };

  const continueFromServices = async () => {
    let result = validationResult;
    if (!result) {
      result = await validateCredentials();
    }
    if (!result) {
      setStep(1);
      return;
    }
    setMaxStep(3);
    setStep(3);
  };

  const validateMailConfiguration = async () => {
    const normalizedMail = normalizeMailConfig(mailConfig);
    if (normalizedMail.provider === 'none') {
      const skippedResult = {
        ok: true,
        provider: 'none',
        configured: false,
        message: 'Mail provider skipped.',
        config: buildMailDeploymentConfig({ provider: 'none' }),
      };
      setMailValidationResult(skippedResult);
      setMailValidationError('');
      return skippedResult;
    }

    setIsValidatingMail(true);
    setMailValidationError('');
    try {
      const response = await fetch('/api/setup/mail/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mail: normalizedMail }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.message || 'Mail validation failed.');
      }
      setMailValidationResult(body);
      return body;
    } catch (error) {
      setMailValidationError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || 'Mail validation failed.',
      );
      return null;
    } finally {
      setIsValidatingMail(false);
    }
  };

  const validateDataConfig = () => {
    if (dataConfig.databaseMode === 'remote') {
      const mongoUrl = normalizeText(dataConfig.mongoConnectionString);
      if (!mongoUrl) {
        setDataConfigError('Enter a MongoDB connection string or choose local MongoDB.');
        return false;
      }
      if (!parseMongoConnectionString(mongoUrl)) {
        setDataConfigError('MongoDB connection string must start with mongodb:// or mongodb+srv://.');
        return false;
      }
    }

    if (dataConfig.storageMode === 'externalS3') {
      const missingFields = [
        ['s3Bucket', 'S3 bucket'],
        ['s3Region', 'S3 region'],
        ['s3AccessKeyId', 'S3 access key'],
        ['s3SecretAccessKey', 'S3 secret key'],
        ['staticCdnUrl', 'public CDN base URL'],
      ].filter(([field]) => !normalizeText(dataConfig[field]));
      if (missingFields.length) {
        setDataConfigError(`External S3 requires: ${missingFields.map(([, label]) => label).join(', ')}.`);
        return false;
      }
      try {
        const publicCdnUrl = new URL(normalizeText(dataConfig.staticCdnUrl));
        if (
          publicCdnUrl.protocol !== 'https:' ||
          publicCdnUrl.username ||
          publicCdnUrl.password ||
          publicCdnUrl.search ||
          publicCdnUrl.hash
        ) {
          throw new Error('invalid public CDN URL');
        }
      } catch {
        setDataConfigError('Public CDN base URL must be HTTPS and must not contain credentials, a query, or a fragment.');
        return false;
      }
      if (
        (normalizeText(dataConfig.cloudFrontKeyPairId) || normalizeText(dataConfig.cloudFrontPrivateKey) || normalizeText(dataConfig.cloudFrontPrivateKeyBase64)) &&
        (!normalizeText(dataConfig.cloudFrontKeyPairId) || (!normalizeText(dataConfig.cloudFrontPrivateKey) && !normalizeText(dataConfig.cloudFrontPrivateKeyBase64)))
      ) {
        setDataConfigError('CloudFront signing requires both a key pair ID and a private key or base64 private key.');
        return false;
      }
    }

    setDataConfigError('');
    return true;
  };

  const continueFromMailAndData = async () => {
    if (!validateDataConfig()) {
      return;
    }
    const mailResult = await validateMailConfiguration();
    if (!mailResult) {
      return;
    }
    setMaxStep(4);
    setStep(4);
  };

  const validateReverseProxyConfiguration = async () => {
    const normalizedProxy = normalizeReverseProxyConfig(reverseProxyConfig);
    if (!normalizedProxy.enabled) {
      const skippedResult = {
        ok: true,
        enabled: false,
        message: 'Reverse proxy skipped.',
        config: buildReverseProxyDeploymentConfig({ enabled: false }),
      };
      setReverseProxyValidationResult(skippedResult);
      setReverseProxyValidationError('');
      return skippedResult;
    }

    setIsValidatingReverseProxy(true);
    setReverseProxyValidationError('');
    try {
      const response = await fetch('/api/setup/reverse-proxy/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reverseProxy: normalizedProxy }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.message || 'Reverse proxy validation failed.');
      }
      setReverseProxyValidationResult(body);
      return body;
    } catch (error) {
      setReverseProxyValidationError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || 'Reverse proxy validation failed.',
      );
      return null;
    } finally {
      setIsValidatingReverseProxy(false);
    }
  };

  const discoverReverseProxyIps = async ({ autofill = true } = {}) => {
    setIsDiscoveringIps(true);
    setIpDiscoveryError('');
    try {
      const response = await fetch('/api/setup/reverse-proxy/ip-candidates', {
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body?.message || 'Unable to detect system IP addresses.');
      }
      setIpDiscoveryResult(body);
      if (autofill && normalizedReverseProxyConfig.accessType !== 'publicDomain') {
        applyDetectedReverseProxyIp(normalizedReverseProxyConfig.accessType, body);
      }
      return body;
    } catch (error) {
      setIpDiscoveryError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || 'Unable to detect system IP addresses.',
      );
      return null;
    } finally {
      setIsDiscoveringIps(false);
    }
  };

  const unlockSetupActions = async () => {
    setIsUnlockingSetup(true);
    setSetupAuthError('');
    try {
      const response = await fetch('/api/setup/auth/check', {
        method: 'POST',
        headers: buildSetupHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body?.message || 'Unable to unlock setup actions.');
      }
      setIsSetupAuthenticated(true);
      setSetupAuthError('');
      await refreshInstallStatus();
      return body;
    } catch (error) {
      setIsSetupAuthenticated(false);
      setSetupAuthError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || 'Unable to unlock setup actions.',
      );
      return null;
    } finally {
      setIsUnlockingSetup(false);
    }
  };

  const openFirewallPorts = async (ports = reverseProxyRequiredPorts) => {
    const targetPorts = Array.isArray(ports) && ports.length ? ports : reverseProxyRequiredPorts;
    const targetPortText = formatPortList(targetPorts);
    setIsOpeningFirewallPorts(true);
    setFirewallError('');
    setFirewallResult(null);
    try {
      const response = await fetch('/api/setup/firewall/open-web-ports', {
        method: 'POST',
        headers: buildSetupHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ports: targetPorts, source: 'setup-wizard-user-action' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        if (response.status === 401) {
          handleSetupAuthFailure(body);
        }
        throw new Error(body?.message || `Unable to open ${targetPortText} automatically.`);
      }
      setFirewallResult(body);
      if (targetPorts.includes(80) || targetPorts.includes(443)) {
        updateReverseProxyConfig('openFirewallPorts', true);
      }
      return body;
    } catch (error) {
      setFirewallError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || `Unable to open ${targetPortText} automatically.`,
      );
      return null;
    } finally {
      setIsOpeningFirewallPorts(false);
    }
  };

  const continueFromReverseProxy = async () => {
    const result = await validateReverseProxyConfiguration();
    if (!result) {
      return;
    }
    setMaxStep(5);
    setStep(5);
  };

  const validateAdminConfig = () => {
    const normalizedAdmin = normalizeAdminConfig(adminConfig);
    if (!normalizedAdmin.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedAdmin.email)) {
      setAdminConfigError('Enter a valid admin email.');
      return false;
    }
    if (normalizedAdmin.password.length < 8) {
      setAdminConfigError('Admin password must be at least 8 characters.');
      return false;
    }
    if (adminConfig.password !== adminConfig.confirmPassword) {
      setAdminConfigError('Admin passwords do not match.');
      return false;
    }
    setAdminConfigError('');
    return true;
  };

  const copyConfig = async () => {
    await navigator.clipboard?.writeText(JSON.stringify(displayDeploymentPayload, null, 2));
    setIsConfigCopied(true);
    window.setTimeout(() => setIsConfigCopied(false), 1600);
  };

  const submitDeployment = async () => {
    const credentialReentryKeys = getProviderCredentialReentryKeys(validationResult);
    if (credentialReentryKeys.length) {
      const providerNames = credentialReentryKeys
        .map((providerKey) => PROVIDERS.find((provider) => provider.key === providerKey)?.title || providerKey)
        .join(', ');
      setSetupRun(null);
      setStep(1);
      setMaxStep(1);
      setValidationError(`Re-enter and validate the redacted provider credentials: ${providerNames}.`);
      return;
    }
    if (!validateAdminConfig()) {
      return;
    }

    const normalizedAdmin = normalizeAdminConfig(adminConfig);
    const requestAuthPassword = setupAuthPassword || normalizedAdmin.password;
    setIsStartingSetup(true);
    setSetupStartError('');
    setBrowserExternalAccess(null);
    setIsCheckingBrowserExternalAccess(false);
    setSetupAuthPassword(normalizedAdmin.password);
    setIsSetupAuthenticated(true);
    setSetupAuthError('');

    try {
      const freshValidationResult = await validateCredentials(requestAuthPassword);
      if (!freshValidationResult) {
        return;
      }
      const mailValidation = mailValidationResult || await validateMailConfiguration();
      if (!mailValidation) {
        return;
      }
      const freshDeploymentPayload = buildDeploymentPayload(
        credentials,
        services,
        dataConfig,
        freshValidationResult,
        mailConfig,
        mailValidation,
        reverseProxyConfig,
        reverseProxyValidationResult,
      );
      const response = await fetch('/api/setup/start', {
        method: 'POST',
        headers: buildSetupHeaders({ 'Content-Type': 'application/json' }, requestAuthPassword),
        body: JSON.stringify({
          deployment: freshDeploymentPayload,
          credentials: normalizeCredentialSet(credentials),
          mail: normalizeMailConfig(mailConfig),
          admin: normalizedAdmin,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          handleSetupAuthFailure(body);
        }
        throw new Error(body?.message || 'Unable to start Docker setup.');
      }
      setSetupRun(body);
      setInstallStatus(null);
    } catch (error) {
      setSetupStartError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || 'Unable to start Docker setup.',
      );
    } finally {
      setIsStartingSetup(false);
    }
  };

  const bootstrapExistingAdmin = async () => {
    if (!validateAdminConfig()) {
      return;
    }

    const normalizedAdmin = normalizeAdminConfig(adminConfig);
    setIsBootstrappingExistingAdmin(true);
    setExistingAdminBootstrapError('');

    try {
      const response = await fetch('/api/setup/admin/bootstrap-existing', {
        method: 'POST',
        headers: buildSetupHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ admin: normalizedAdmin }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          handleSetupAuthFailure(body);
        }
        throw new Error(body?.message || 'Unable to prepare admin access.');
      }
      setSetupAuthPassword(normalizedAdmin.password);
      setIsSetupAuthenticated(true);
      setSetupAuthError('');
      await refreshInstallStatus();
      if (body.redirectUrl) {
        window.location.assign(body.redirectUrl);
      }
    } catch (error) {
      setExistingAdminBootstrapError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || 'Unable to prepare admin access.',
      );
    } finally {
      setIsBootstrappingExistingAdmin(false);
    }
  };

  const updateContainers = async () => {
    setMaintenanceStartError('');
    setInstallActionError('');
    setBrowserExternalAccess(null);
    setIsCheckingBrowserExternalAccess(false);

    try {
      const response = await fetch('/api/setup/maintenance/update-restart', {
        method: 'POST',
        headers: buildSetupHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          handleSetupAuthFailure(body);
        }
        throw new Error(body?.message || 'Unable to update local containers.');
      }
      setMaintenanceRun(body);
    } catch (error) {
      setInstallActionError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || 'Unable to update local containers.',
      );
    }
  };

  const retryContainerUpdate = () => {
    setMaintenanceRun(null);
    setMaintenanceStartError('');
    void updateContainers();
  };

  const retryDeploymentSetup = () => {
    setSetupRun(null);
    setSetupStartError('');
    void submitDeployment();
  };

  const resetLocalWizardState = () => {
    clearStoredWizardState();
    setStep(1);
    setMaxStep(1);
    setCredentials(pickCredentials());
    setServices(buildDefaultServices());
    setMailConfig(pickMailConfig());
    setMailValidationResult(null);
    setMailValidationError('');
    setDataConfig(pickDataConfig());
    setReverseProxyConfig(pickReverseProxyConfig());
    setReverseProxyValidationResult(null);
    setReverseProxyValidationError('');
    setFirewallResult(null);
    setFirewallError('');
    setAdminConfig(pickAdminConfig());
    setValidationResult(null);
    setValidationError('');
    setExpressWarningMissingRequirements([]);
    setDataConfigError('');
    setAdminConfigError('');
    setExistingAdminBootstrapError('');
    setIsConfigCopied(false);
    setSetupRun(null);
    setSetupStartError('');
    setBrowserExternalAccess(null);
    setIsCheckingBrowserExternalAccess(false);
    setResetError('');
    setSetupAuthPassword('');
    setSetupAuthError('');
    setIsSetupAuthenticated(false);
  };

  const openResetConfirm = () => {
    setResetError('');
    setIsResetConfirmOpen(true);
  };

  const closeResetConfirm = () => {
    if (!isResetting) {
      setIsResetConfirmOpen(false);
      setResetError('');
    }
  };

  const confirmReset = async () => {
    setIsResetting(true);
    setResetError('');

    try {
      const response = await fetch('/api/setup/reset', {
        method: 'POST',
        headers: buildSetupHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ runId: setupRun?.id || '' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          handleSetupAuthFailure(body);
        }
        throw new Error(body?.message || 'Unable to reset local setup.');
      }
      resetLocalWizardState();
      setInstallStatus({ installed: false, hasRuntimeConfig: false, compose: { total: 0, running: 0, containers: [] } });
      setMaintenanceRun(null);
      setMaintenanceStartError('');
      setIsResetConfirmOpen(false);
    } catch (error) {
      setResetError(
        error?.message === 'Failed to fetch'
          ? 'Unable to reach the local setup service. Rebuild and run the setup wizard Docker container.'
          : error?.message || 'Unable to reset local setup.',
      );
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <main ref={wizardShellRef} className={`wizard-shell ${colorMode === 'dark' ? 'theme-dark' : 'theme-light'}`}>
      <div className="wizard-chrome">
        <header className="wizard-topbar">
          <div className="wizard-brand">
            <span className="brand-mark">S</span>
            <div>
              <div className="eyebrow">Samsar deployment</div>
              <h1>Startup wizard</h1>
            </div>
          </div>

          <nav className="step-nav topbar-step-nav" aria-label="Setup steps">
            {!shouldShowExistingInstall && !maintenanceRun && STEPS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`step-button ${item.id === step ? 'active' : ''} ${item.id < step ? 'complete' : ''}`}
                disabled={item.id > maxStep}
                onClick={() => goToStep(item.id)}
              >
                <span className="step-index">{item.id}</span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </nav>

          <div className="topbar-actions">
            <button
              type="button"
              className="icon-action topbar-reset-action"
              aria-label="Reset setup"
              title="Reset setup"
              onClick={openResetConfirm}
              disabled={isResetting}
            >
              <span aria-hidden="true">↺</span>
            </button>
            <div className="theme-toggle" role="group" aria-label="Color mode">
              <button
                type="button"
                className={colorMode === 'light' ? 'active' : ''}
                onClick={() => setColorMode('light')}
              >
                Light
              </button>
              <button
                type="button"
                className={colorMode === 'dark' ? 'active' : ''}
                onClick={() => setColorMode('dark')}
              >
                Dark
              </button>
            </div>
          </div>
        </header>
      </div>

      {isInitialInstallStatusLoading ? (
        <section className="wizard-panel loading-panel">
          <div className="panel-header">
            <h2>Checking local Docker install</h2>
            <p>Reading the current runtime configuration and Docker container state.</p>
          </div>
        </section>
      ) : setupAuthRequired && !isSetupAuthenticated ? (
        <SetupAuthGate
          password={setupAuthPassword}
          error={setupAuthError}
          isUnlocking={isUnlockingSetup}
          onPasswordChange={(value) => {
            setSetupAuthPassword(value);
            setSetupAuthError('');
          }}
          onUnlock={unlockSetupActions}
        />
      ) : maintenanceRun ? (
        <SetupProgressPage
          setupRun={maintenanceRun}
          setupError={maintenanceStartError}
          onRetry={retryContainerUpdate}
          onBack={() => {
            setMaintenanceRun(null);
            setMaintenanceStartError('');
            void refreshInstallStatus();
          }}
          onOpenPorts={openFirewallPorts}
          isOpeningPorts={isOpeningFirewallPorts}
          openPortsResult={firewallResult}
          openPortsError={firewallError}
          browserExternalAccess={browserExternalAccess}
          isCheckingBrowserExternalAccess={isCheckingBrowserExternalAccess}
          mode="maintenance"
        />
      ) : setupRun ? (
        <SetupProgressPage
          setupRun={setupRun}
          setupError={setupStartError}
          onRetry={retryDeploymentSetup}
          onBack={() => {
            setSetupRun(null);
            setSetupStartError('');
          }}
          onOpenPorts={openFirewallPorts}
          isOpeningPorts={isOpeningFirewallPorts}
          openPortsResult={firewallResult}
          openPortsError={firewallError}
          browserExternalAccess={browserExternalAccess}
          isCheckingBrowserExternalAccess={isCheckingBrowserExternalAccess}
        />
      ) : shouldShowExistingInstall ? (
        <ExistingInstallHome
          installStatus={installStatus}
          isRefreshing={isLoadingInstallStatus}
          actionError={installActionError}
          adminConfig={adminConfig}
          adminConfigError={adminConfigError}
          adminBootstrapError={existingAdminBootstrapError}
          isBootstrappingAdmin={isBootstrappingExistingAdmin}
          setupAuthRequired={setupAuthRequired}
          isSetupAuthenticated={isSetupAuthenticated}
          setupAuthPassword={setupAuthPassword}
          setupAuthError={setupAuthError}
          isUnlockingSetup={isUnlockingSetup}
          onAdminChange={updateAdminConfig}
          onBootstrapAdmin={bootstrapExistingAdmin}
          onSetupAuthPasswordChange={(value) => {
            setSetupAuthPassword(value);
            setSetupAuthError('');
          }}
          onUnlockSetup={unlockSetupActions}
          onRefresh={refreshInstallStatus}
          onUpdateContainers={updateContainers}
          onDeleteAndRecreate={openResetConfirm}
          isResetting={isResetting}
        />
      ) : (
      <section className="wizard-panel">
        <div className="panel-header">
          <h2>{step === 1 ? 'Add optional provider configurations to enable specific models.' : activeStep.label}</h2>
	          <p>
                {step === 1 && 'Choose only the adapters you need. Each provider shows every model its credential enables.'}
	            {step === 2 && 'Available services are derived from the credentials validated in Providers.'}
	            {step === 3 && 'Choose data storage, logging, and optional SMTP or Amazon SES email.'}
                {step === 4 && 'Optionally expose Studio and the processor API through nginx.'}
	            {step === 5 && 'Create the Docker admin user and review the deployment.'}
	          </p>
	        </div>

        {step === 1 && (
          <>
            <div className="provider-list">
              {PROVIDER_GROUPS.map((group) => (
                <section
                  className={`provider-drawer ${group.featured ? 'provider-drawer-featured' : ''}`}
                  key={group.key}
                >
                  <button
                    type="button"
                    className="provider-drawer-header"
                    aria-expanded={providerDrawersOpen[group.key]}
                    onClick={() => toggleProviderDrawer(group.key)}
                  >
                    <span>
                      <strong>{group.title}</strong>
                      <small>{group.description}</small>
                    </span>
                    <span className="provider-drawer-toggle" aria-hidden="true">
                      {providerDrawersOpen[group.key] ? '-' : '+'}
                    </span>
                  </button>
                  {providerDrawersOpen[group.key] && (
                    <div className="provider-drawer-body">
                      {group.providers.map(renderProviderRow)}
                    </div>
                  )}
                </section>
              ))}
            </div>
            {isAlibabaTokenPlanEndpoint(credentials.alibabaApiHost) && (
              <div className="warning-banner" role="status">
                Token plan API key is unsuitable for production server
              </div>
            )}
            {enteredProviderKeys.length > 0 && expressPipelineAvailability.isReady && (
              <div className="success-banner express-readiness-banner" role="status">
                <strong>Express pipeline ready.</strong>
                <span>You have enabled the minimum model set for Express generation and the agent.</span>
              </div>
            )}
            {validationError && <div className="error-banner">{validationError}</div>}
          </>
	        )}

	        {step === 2 && (
	          <>
	            <div className="availability-summary">
	              <section className="availability-summary-card">
	                <span className="availability-count">{availableSetupServiceCount}</span>
	                <span>
	                  <strong>Available services</strong>
	                  <small>{SETUP_SERVICE_CATALOG.length} total mapped services</small>
	                </span>
	              </section>
	              <section className="availability-summary-card">
	                <span className="availability-count">{configuredProviderKeys.length}</span>
	                <span>
	                  <strong>Configured providers</strong>
	                  <small>{configuredProviderKeys.length ? formatProviderList(configuredProviderKeys, ', ') : 'Core access only'}</small>
	                </span>
	              </section>
	            </div>

	            <div className="service-list service-capability-list">
	              {setupServiceAvailability.map((service) => (
	                <article
	                  className={`service-capability-row ${service.isAvailable ? 'service-capability-available' : 'service-capability-locked'}`}
	                  key={service.key}
	                >
	                  <div className="service-capability-main">
	                    <div className="service-capability-heading">
	                      <span className="service-category">{service.category}</span>
	                      <strong>{service.label}</strong>
	                      <span className={`service-status-badge ${service.isAvailable ? 'available' : 'locked'}`}>
	                        {service.isAvailable ? 'Available' : 'Locked'}
	                      </span>
	                    </div>
	                    <p>{service.description}</p>
	                    {service.families.length > 0 && (
	                      <div className="capability-family-grid" aria-label={`${service.label} model type availability`}>
	                        <div className="capability-family-group available">
	                          <span className="capability-family-title">Available</span>
	                          <div className="capability-family-list">
	                            {service.availableFamilies.length ? (
	                              service.availableFamilies.map((family) => (
	                                <span className="capability-family-chip available" key={family.key}>
	                                  <strong>{family.label}</strong>
	                                  <small>{formatProviderList(family.enabledProviderKeys, ', ')}</small>
	                                </span>
	                              ))
	                            ) : (
	                              <span className="capability-family-empty">None</span>
	                            )}
	                          </div>
	                        </div>
	                        {service.lockedFamilies.length > 0 && (
	                          <div className="capability-family-group locked">
	                            <span className="capability-family-title">Unavailable</span>
	                            <div className="capability-family-list">
	                              {service.lockedFamilies.map((family) => (
	                                <span className="capability-family-chip locked" key={family.key}>
	                                  <strong>{family.label}</strong>
	                                  <small>Needs {formatProviderList(family.providerKeys)}</small>
	                                </span>
	                              ))}
	                            </div>
	                          </div>
	                        )}
	                      </div>
	                    )}
	                  </div>
	                  <div className="service-capability-auth">
	                    {service.alwaysAvailable ? (
	                      <span>No credential required</span>
	                    ) : service.isAvailable ? (
	                      <span>Enabled by {formatProviderList(service.enabledProviderKeys, ', ')}</span>
	                    ) : (
	                      <span>Add {formatProviderList(service.providerKeys)}</span>
	                    )}
	                  </div>
	                </article>
	              ))}
	            </div>
	          </>
	        )}

        {step === 3 && (
          <>
            <div className="data-config-layout mail-config-layout">
              <section className="data-config-card">
                <div className="data-config-card-header">
                  <h3>Email provider</h3>
                  <span>{mailConfig.provider === 'none' ? 'Disabled' : mailConfig.provider.toUpperCase()}</span>
                </div>
                <div className="data-option-grid">
                  <label className={`data-option-card ${mailConfig.provider === 'none' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="mail-provider"
                      checked={mailConfig.provider === 'none'}
                      onChange={() => updateMailConfig('provider', 'none')}
                    />
                    <span>
                      <strong>No email</strong>
                      <small>Skip forgot password, confirmation, task completion, and setup welcome emails.</small>
                    </span>
                  </label>
                  <label className={`data-option-card ${mailConfig.provider === 'smtp' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="mail-provider"
                      checked={mailConfig.provider === 'smtp'}
                      onChange={() => updateMailConfig('provider', 'smtp')}
                    />
                    <span>
                      <strong>SMTP</strong>
                      <small>Use an SMTP host, port, username, and password from your email provider.</small>
                    </span>
                  </label>
                  <label className={`data-option-card ${mailConfig.provider === 'ses' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="mail-provider"
                      checked={mailConfig.provider === 'ses'}
                      onChange={() => updateMailConfig('provider', 'ses')}
                    />
                    <span>
                      <strong>Amazon SES API</strong>
                      <small>Use an IAM access key with SES send permissions and a verified sender identity.</small>
                    </span>
                  </label>
                </div>
              </section>

              {mailConfig.provider !== 'none' && (
                <section className="data-config-card">
                  <div className="data-config-card-header">
                    <h3>Sender identity</h3>
                    <span>{mailValidationResult?.ok ? 'Verified' : 'Required'}</span>
                  </div>
                  <div className="data-field-grid">
                    <label className="data-field">
                      <span>From address</span>
                      <input
                        name="samsar-mail-from-address"
                        value={mailConfig.fromAddress}
                        placeholder="Samsar <no-reply@example.com>"
                        autoComplete="off"
                        onChange={(event) => updateMailConfig('fromAddress', event.target.value)}
                      />
                    </label>
                    <label className="data-field">
                      <span>Reply-to address</span>
                      <input
                        name="samsar-mail-reply-to-address"
                        value={mailConfig.replyToAddress}
                        placeholder="Optional"
                        autoComplete="off"
                        onChange={(event) => updateMailConfig('replyToAddress', event.target.value)}
                      />
                    </label>
                  </div>
                </section>
              )}

              {mailConfig.provider === 'smtp' && (
                <section className="data-config-card">
                  <div className="data-config-card-header">
                    <h3>SMTP credentials</h3>
                    <span>{mailConfig.smtpSecure ? 'TLS wrapper' : 'STARTTLS'}</span>
                  </div>
                  <div className="data-field-grid">
                    <label className="data-field">
                      <span>Host</span>
                      <input
                        name="samsar-smtp-host"
                        value={mailConfig.smtpHost}
                        placeholder="smtp.example.com"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => updateMailConfig('smtpHost', event.target.value)}
                      />
                    </label>
                    <label className="data-field">
                      <span>Port</span>
                      <input
                        name="samsar-smtp-port"
                        inputMode="numeric"
                        value={mailConfig.smtpPort}
                        placeholder={mailConfig.smtpSecure ? '465' : '587'}
                        autoComplete="off"
                        onChange={(event) => updateMailConfig('smtpPort', event.target.value)}
                      />
                    </label>
                    <label className="data-field">
                      <span>Username</span>
                      <input
                        name="samsar-smtp-username"
                        value={mailConfig.smtpUser}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => updateMailConfig('smtpUser', event.target.value)}
                      />
                    </label>
                    <label className="data-field">
                      <span>Password</span>
                      <input
                        name="samsar-smtp-password"
                        type="password"
                        value={mailConfig.smtpPassword}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => updateMailConfig('smtpPassword', event.target.value)}
                      />
                    </label>
                    <label className="data-field data-checkbox-field">
                      <input
                        type="checkbox"
                        checked={Boolean(mailConfig.smtpSecure)}
                        onChange={(event) => updateMailConfig('smtpSecure', event.target.checked)}
                      />
                      <span>Use TLS wrapper on connect</span>
                    </label>
                  </div>
                </section>
              )}

              {mailConfig.provider === 'ses' && (
                <section className="data-config-card">
                  <div className="data-config-card-header">
                    <h3>Amazon SES credentials</h3>
                    <span>{mailConfig.sesRegion || 'us-east-1'}</span>
                  </div>
                  <div className="data-field-grid">
                    <label className="data-field">
                      <span>Region</span>
                      <input
                        name="samsar-ses-region"
                        value={mailConfig.sesRegion}
                        placeholder="us-east-1"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => updateMailConfig('sesRegion', event.target.value)}
                      />
                    </label>
                    <label className="data-field">
                      <span>Access key ID</span>
                      <input
                        name="samsar-ses-access-key-id"
                        value={mailConfig.sesAccessKeyId}
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        onChange={(event) => updateMailConfig('sesAccessKeyId', event.target.value)}
                      />
                    </label>
                    <label className="data-field">
                      <span>Secret access key</span>
                      <input
                        name="samsar-ses-secret-access-key"
                        type="password"
                        value={mailConfig.sesSecretAccessKey}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => updateMailConfig('sesSecretAccessKey', event.target.value)}
                      />
                    </label>
                    {sesAccessKeyUsesTemporaryCredentials && (
                      <label className="data-field">
                        <span>Session token</span>
                        <input
                          name="samsar-ses-session-token"
                          type="password"
                          value={mailConfig.sesSessionToken}
                          placeholder="Required for temporary credentials"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => updateMailConfig('sesSessionToken', event.target.value)}
                        />
                      </label>
                    )}
                  </div>
                </section>
              )}
            </div>
            {mailValidationResult?.ok && (
              <div className="success-banner mail-status-banner">{mailValidationResult.message || 'Mail configuration verified.'}</div>
            )}
            {mailValidationError && <div className="error-banner mail-status-banner">{mailValidationError}</div>}
          </>
        )}

	        {step === 3 && (
	          <>
	            <div className="data-config-layout data-primary-layout">
	              <section className="data-config-card">
	                <div className="data-config-card-header">
	                  <h3>Database</h3>
	                  <span>{dataConfig.databaseMode === 'remote' ? 'Remote MongoDB' : 'Local container'}</span>
	                </div>
	                <div className="data-option-grid">
	                  <label className={`data-option-card ${dataConfig.databaseMode === 'local' ? 'selected' : ''}`}>
	                    <input
	                      type="radio"
	                      name="database-mode"
	                      checked={dataConfig.databaseMode === 'local'}
	                      onChange={() => updateDataConfig('databaseMode', 'local')}
	                    />
	                    <span>
	                      <strong>Local MongoDB</strong>
	                      <small>Starts the bundled MongoDB container and keeps data in the Docker volume.</small>
	                    </span>
	                  </label>
	                  <label className={`data-option-card ${dataConfig.databaseMode === 'remote' ? 'selected' : ''}`}>
	                    <input
	                      type="radio"
	                      name="database-mode"
	                      checked={dataConfig.databaseMode === 'remote'}
	                      onChange={() => updateDataConfig('databaseMode', 'remote')}
	                    />
	                    <span>
	                      <strong>Remote MongoDB</strong>
	                      <small>Uses your managed MongoDB connection string and skips the local MongoDB container.</small>
	                    </span>
	                  </label>
	                </div>
	                {dataConfig.databaseMode === 'remote' && (
	                  <div className="data-field-grid single">
	                    <label className="data-field">
	                      <span>MongoDB connection string</span>
	                      <input
	                        type="password"
	                        value={dataConfig.mongoConnectionString}
	                        placeholder="mongodb+srv://user:password@cluster.example/SamsarOne"
	                        onChange={(event) => updateDataConfig('mongoConnectionString', event.target.value)}
	                      />
	                    </label>
	                    {parseMongoConnectionString(dataConfig.mongoConnectionString) && (
	                      <div className="data-parse-summary">
	                        {parseMongoConnectionString(dataConfig.mongoConnectionString).scheme} /
	                        {' '}{parseMongoConnectionString(dataConfig.mongoConnectionString).hosts} /
	                        {' '}{parseMongoConnectionString(dataConfig.mongoConnectionString).database}
	                      </div>
	                    )}
	                  </div>
	                )}
	              </section>

	              <section className="data-config-card">
	                <div className="data-config-card-header">
	                  <h3>Media storage</h3>
	                  <span>{dataConfig.storageMode === 'externalS3' ? 'External S3' : 'Local MinIO'}</span>
	                </div>
	                <div className="data-option-grid">
	                  <label className={`data-option-card ${dataConfig.storageMode === 'local' ? 'selected' : ''}`}>
	                    <input
	                      type="radio"
	                      name="storage-mode"
	                      checked={dataConfig.storageMode === 'local'}
	                      onChange={() => updateDataConfig('storageMode', 'local')}
	                    />
	                    <span>
	                      <strong>Local MinIO</strong>
	                      <small>Starts local S3-compatible storage and local media gateway URLs for normal local use.</small>
	                    </span>
	                  </label>
	                  <label className={`data-option-card ${dataConfig.storageMode === 'externalS3' ? 'selected' : ''}`}>
	                    <input
	                      type="radio"
	                      name="storage-mode"
	                      checked={dataConfig.storageMode === 'externalS3'}
	                      onChange={() => updateDataConfig('storageMode', 'externalS3')}
	                    />
	                    <span>
	                      <strong>External S3 / CloudFront</strong>
	                      <small>Publishes local media to your bucket and sends signed CloudFront URLs when signing keys are provided.</small>
	                    </span>
	                  </label>
	                </div>
	                {dataConfig.storageMode === 'externalS3' && (
	                  <div className="data-field-grid">
	                    <label className="data-field">
	                      <span>Bucket</span>
	                      <input
	                        value={dataConfig.s3Bucket}
	                        placeholder="samsar-resources"
	                        onChange={(event) => updateDataConfig('s3Bucket', event.target.value)}
	                      />
	                    </label>
	                    <label className="data-field">
	                      <span>Region</span>
	                      <input
	                        value={dataConfig.s3Region}
	                        placeholder="us-east-1"
	                        onChange={(event) => updateDataConfig('s3Region', event.target.value)}
	                      />
	                    </label>
	                    <label className="data-field">
	                      <span>S3 endpoint</span>
	                      <input
	                        value={dataConfig.s3Endpoint}
	                        placeholder="Optional for AWS S3"
	                        onChange={(event) => updateDataConfig('s3Endpoint', event.target.value)}
	                      />
	                    </label>
	                    <label className="data-field">
	                      <span>Public CDN base URL</span>
	                      <input
	                        required
	                        value={dataConfig.staticCdnUrl}
	                        placeholder="https://cdn.example.com/"
	                        onChange={(event) => updateDataConfig('staticCdnUrl', event.target.value)}
	                      />
	                    </label>
	                    <label className="data-field">
	                      <span>Access key</span>
	                      <input
	                        type="password"
	                        value={dataConfig.s3AccessKeyId}
	                        onChange={(event) => updateDataConfig('s3AccessKeyId', event.target.value)}
	                      />
	                    </label>
	                    <label className="data-field">
	                      <span>Secret key</span>
	                      <input
	                        type="password"
	                        value={dataConfig.s3SecretAccessKey}
	                        onChange={(event) => updateDataConfig('s3SecretAccessKey', event.target.value)}
	                      />
	                    </label>
	                    <label className="data-field data-checkbox-field">
	                      <input
	                        type="checkbox"
	                        checked={Boolean(dataConfig.s3ForcePathStyle)}
	                        onChange={(event) => updateDataConfig('s3ForcePathStyle', event.target.checked)}
	                      />
	                      <span>Use path-style S3 URLs</span>
	                    </label>
	                    <label className="data-field">
	                      <span>CloudFront key pair ID</span>
	                      <input
	                        value={dataConfig.cloudFrontKeyPairId}
	                        placeholder="Optional"
	                        onChange={(event) => updateDataConfig('cloudFrontKeyPairId', event.target.value)}
	                      />
	                    </label>
	                    <label className="data-field">
	                      <span>Signed URL TTL seconds</span>
	                      <input
	                        inputMode="numeric"
	                        value={dataConfig.cloudFrontSignedUrlTtlSeconds}
	                        onChange={(event) => updateDataConfig('cloudFrontSignedUrlTtlSeconds', event.target.value)}
	                      />
	                    </label>
	                    <label className="data-field">
	                      <span>CloudFront private key</span>
	                      <textarea
	                        value={dataConfig.cloudFrontPrivateKey}
	                        placeholder="Optional PEM private key"
	                        onChange={(event) => updateDataConfig('cloudFrontPrivateKey', event.target.value)}
	                        spellCheck="false"
	                      />
	                    </label>
	                    <label className="data-field">
	                      <span>Private key base64</span>
	                      <textarea
	                        value={dataConfig.cloudFrontPrivateKeyBase64}
	                        placeholder="Optional alternative to PEM"
	                        onChange={(event) => updateDataConfig('cloudFrontPrivateKeyBase64', event.target.value)}
	                        spellCheck="false"
	                      />
	                    </label>
	                  </div>
	                )}
	              </section>

	              <section className="data-config-card">
	                <div className="data-config-card-header">
	                  <h3>Grafana logger</h3>
	                  <span>{services[LOGGER_SERVICE_KEY] ? 'Enabled' : 'Disabled'}</span>
	                </div>
	                <div className="data-option-grid single">
	                  <label className={`data-option-card ${services[LOGGER_SERVICE_KEY] ? 'selected' : ''}`}>
	                    <input
	                      type="checkbox"
	                      checked={Boolean(services[LOGGER_SERVICE_KEY])}
	                      onChange={(event) => updateService(LOGGER_SERVICE_KEY, event.target.checked)}
	                    />
	                    <span>
	                      <strong>Include Grafana log viewer</strong>
	                      <small>Starts Grafana, Loki, and Promtail with the default Docker log dashboard for this Samsar instance.</small>
	                    </span>
	                  </label>
	                </div>
	              </section>
	            </div>
	            {dataConfigError && <div className="error-banner data-status-banner">{dataConfigError}</div>}
	          </>
	        )}

	        {step === 4 && (
            <>
              <div className="data-config-layout">
                <section className="data-config-card">
                  <div className="data-config-card-header">
                    <h3>Reverse proxy</h3>
                    <span>{normalizedReverseProxyConfig.enabled ? 'Enabled' : 'Skipped'}</span>
                  </div>
                  <div className="data-option-grid single">
                    <label className={`data-option-card ${normalizedReverseProxyConfig.enabled ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(reverseProxyConfig.enabled)}
                        onChange={(event) => updateReverseProxyConfig('enabled', event.target.checked)}
                      />
                      <span>
                        <strong>Enable nginx reverse proxy</strong>
                        <small>Skip this to keep localhost and temporary tunnel URLs for public provider access.</small>
                      </span>
                    </label>
                  </div>
                </section>

                {normalizedReverseProxyConfig.enabled && (
                  <>
                    <section className="data-config-card">
                      <div className="data-config-card-header">
                        <h3>Access type</h3>
                        <span>{reverseProxyHostLabel}</span>
                      </div>
                      <div className="data-option-grid">
                        <label className={`data-option-card ${normalizedReverseProxyConfig.accessType === 'publicDomain' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="reverse-proxy-access"
                            checked={normalizedReverseProxyConfig.accessType === 'publicDomain'}
                            onChange={() => updateReverseProxyConfig('accessType', 'publicDomain')}
                          />
                          <span>
                            <strong>Domain / subdomain</strong>
                            <small>Use DNS records and optionally secure access with Let's Encrypt.</small>
                          </span>
                        </label>
                        <label className={`data-option-card ${normalizedReverseProxyConfig.accessType === 'publicIp' ? 'selected' : ''} ${publicIpSelectionDisabled ? 'disabled' : ''}`}>
                          <input
                            type="radio"
                            name="reverse-proxy-access"
                            checked={normalizedReverseProxyConfig.accessType === 'publicIp'}
                            disabled={publicIpSelectionDisabled}
                            onChange={() => updateReverseProxyConfig('accessType', 'publicIp')}
                          />
                          <span>
                            <strong>Public IP</strong>
                            <small>{publicIpSelectionDisabled ? 'Detected public IP is not reachable on port 80 from this setup.' : 'Use a static public IP without DNS or automatic SSL.'}</small>
                          </span>
                        </label>
                        <label className={`data-option-card ${normalizedReverseProxyConfig.accessType === 'privateIp' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="reverse-proxy-access"
                            checked={normalizedReverseProxyConfig.accessType === 'privateIp'}
                            onChange={() => updateReverseProxyConfig('accessType', 'privateIp')}
                          />
                          <span>
                            <strong>Private IP</strong>
                            <small>Use an intranet IP. Public AI providers cannot fetch private-only media.</small>
                          </span>
                        </label>
                      </div>
                    </section>

                    <section className="data-config-card">
                      <div className="data-config-card-header">
                        <h3>Domain configuration</h3>
                        <span>{reverseProxyUsesDomain ? 'DNS required' : 'IP access'}</span>
                      </div>
                      {reverseProxyUsesDomain ? (
                        <div className="data-field-grid">
                          <label className="data-field">
                            <span>Studio {reverseProxyHostLabel}</span>
                            <input
                              value={reverseProxyConfig.clientHost}
                              placeholder={reverseProxyHostPlaceholder}
                              onChange={(event) => updateReverseProxyConfig('clientHost', event.target.value)}
                            />
                          </label>
                          <label className="data-field">
                            <span>Processor API {reverseProxyHostLabel}</span>
                            <input
                              value={reverseProxyConfig.processorHost}
                              placeholder="api.example.com"
                              onChange={(event) => updateReverseProxyConfig('processorHost', event.target.value)}
                            />
                          </label>
                          <label className="data-field">
                            <span>Machine public IP</span>
                            <input
                              value={reverseProxyConfig.machineIp}
                              placeholder="203.0.113.10"
                              onChange={(event) => updateReverseProxyConfig('machineIp', event.target.value)}
                            />
                          </label>
                          <div className="data-parse-summary proxy-dns-hint">
                            Add A records for both domains pointing to this machine IP in your DNS provider.
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="proxy-action-row">
                            <button
                              type="button"
                              className="secondary-action"
                              onClick={() => discoverReverseProxyIps({ autofill: true })}
                              disabled={isDiscoveringIps}
                            >
                              {isDiscoveringIps ? 'Detecting IPs...' : 'Detect and autofill IP'}
                            </button>
                            {recommendedReverseProxyIp && (
                              <button
                                type="button"
                                className="secondary-action"
                                onClick={() => applyDetectedReverseProxyIp()}
                              >
                                Use {recommendedReverseProxyIp}
                              </button>
                            )}
                          </div>
                          <div className="data-field-grid single">
                            <label className="data-field">
                              <span>Machine {reverseProxyHostLabel}</span>
                              <input
                                value={reverseProxyConfig.machineIp}
                                placeholder={reverseProxyHostPlaceholder}
                                onChange={(event) => updateReverseProxyConfig('machineIp', event.target.value)}
                              />
                            </label>
                          </div>
                          <p className="proxy-copy">
                            Studio will use {normalizedReverseProxyConfig.machineIp ? buildUrlForHost(normalizedReverseProxyConfig.machineIp) : `http://${reverseProxyHostPlaceholder}`}. Processor API and media will use {normalizedReverseProxyConfig.machineIp ? buildUrlForHostPath(normalizedReverseProxyConfig.machineIp, 'api') : `http://${reverseProxyHostPlaceholder}/api`}.
                          </p>
                          {(detectedPublicIp || detectedPrivateIps.length > 0) && (
                            <div className="data-parse-summary">
                              {detectedPublicIp && (
                                <span>
                                  Public IP: {detectedPublicIp}
                                  {publicIpReachabilityChecked ? publicIpReachable ? ' (port 80 reachable)' : ' (port 80 not reachable)' : ''}
                                </span>
                              )}
                              {detectedPrivateIps.length > 0 && <span>Private IPs: {detectedPrivateIps.join(', ')}</span>}
                            </div>
                          )}
                          {reverseProxyUsesPublicIp && publicIpSelectionDisabled && (
                            <div className="error-banner">
                              {publicIpReachability.message || 'Public IP access is not reachable on port 80. Use Private IP for this network unless router or ISP forwarding is configured.'}
                            </div>
                          )}
                          {reverseProxyUsesPublicIp && !publicIpSelectionDisabled && publicIpReachabilityChecked && !publicIpReachable && (
                            <div className="success-banner">
                              Public IP is selected. Setup will try to open the required ports, then the final stage will check browser reachability and show cloud firewall steps if needed.
                            </div>
                          )}
                          {ipDiscoveryError && <div className="error-banner">{ipDiscoveryError}</div>}
                        </>
                      )}
                    </section>

                    <section className="data-config-card">
                      <div className="data-config-card-header">
                        <h3>External ports</h3>
                        <span>{reverseProxyRequiredPortLabel}</span>
                      </div>
                      <div className="data-option-grid single">
                        <label className="data-option-card selected">
                          <input
                            type="checkbox"
                            checked
                            readOnly
                            disabled
                          />
                          <span>
                            <strong>Setup will try automatically</strong>
                            <small>Attempts host firewall rules for {reverseProxyRequiredPortText}. Cloud firewalls and routers may still need provider settings.</small>
                          </span>
                        </label>
                      </div>
                      <div className="proxy-action-row">
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={openFirewallPorts}
                          disabled={isOpeningFirewallPorts}
                        >
                          {isOpeningFirewallPorts ? 'Opening ports...' : `Open ${reverseProxyRequiredPortLabel}`}
                        </button>
                      </div>
                      {firewallResult?.ok && (
                        <div className="success-banner">{firewallResult.message || 'Port rule command completed.'}</div>
                      )}
                      {firewallError && <div className="error-banner">{firewallError}</div>}
                    </section>

                    {reverseProxyUsesDomain && (
                      <section className="data-config-card">
                        <div className="data-config-card-header">
                          <h3>SSL</h3>
                          <span>{reverseProxyConfig.sslEnabled ? "Let's Encrypt" : 'Optional'}</span>
                        </div>
                        <div className="data-option-grid single">
                          <label className={`data-option-card ${reverseProxyConfig.sslEnabled ? 'selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={Boolean(reverseProxyConfig.sslEnabled)}
                              disabled={!reverseProxyCanEnableSsl}
                              onChange={(event) => updateReverseProxyConfig('sslEnabled', event.target.checked)}
                            />
                            <span>
                              <strong>Secure domains with SSL</strong>
                              <small>Available after DNS validation. Ports 80 and 443 are used for certificate setup, then port 80 is closed if Samsar opened it.</small>
                            </span>
                          </label>
                        </div>
                        {reverseProxyConfig.sslEnabled && (
                          <div className="data-field-grid single">
                            <label className="data-field">
                              <span>Let's Encrypt email</span>
                              <input
                                type="email"
                                value={reverseProxyConfig.sslEmail}
                                placeholder="admin@example.com"
                                onChange={(event) => updateReverseProxyConfig('sslEmail', event.target.value)}
                              />
                            </label>
                          </div>
                        )}
                      </section>
                    )}

                    <section className="data-config-card proxy-warning-card">
                      <div className="data-config-card-header">
                        <h3>Production access</h3>
                        <span>Public exposure</span>
                      </div>
                      <p className="proxy-copy">
                        Your machine must allow {reverseProxyRequiredPortText}. Public access exposes this instance, so use a strong admin password.
                      </p>
                      <div className="proxy-action-row">
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={validateReverseProxyConfiguration}
                          disabled={isValidatingReverseProxy}
                        >
                          {isValidatingReverseProxy ? 'Validating...' : 'Validate access'}
                        </button>
                      </div>
                    </section>
                  </>
                )}
              </div>
              {reverseProxyValidationResult?.ok && (
                <div className="success-banner">{reverseProxyValidationResult.message || 'Reverse proxy configuration validated.'}</div>
              )}
              {reverseProxyValidationError && <div className="error-banner">{reverseProxyValidationError}</div>}
            </>
          )}

	        {step === 5 && (
	          <>
	            <div className="data-config-layout">
	              <section className="data-config-card admin-create-card">
	                <div className="data-config-card-header">
	                  <h3>Create Admin user</h3>
	                </div>
	                <div className="data-field-grid">
		                  <label className="data-field">
		                    <span>Admin email</span>
		                    <input
	                      ref={adminEmailInputRef}
	                      type="email"
	                      value={adminConfig.email}
	                      placeholder="admin@example.com"
	                      autoComplete="email"
	                      onChange={(event) => updateAdminConfig('email', event.target.value)}
	                    />
	                  </label>
	                  <label className="data-field">
	                    <span>Organization name / username</span>
	                    <input
	                      value={adminConfig.organizationName}
	                      placeholder="Acme Studio or admin"
	                      onChange={(event) => updateAdminConfig('organizationName', event.target.value)}
	                    />
	                  </label>
	                  <label className="data-field">
	                    <span>Password</span>
	                    <input
	                      type="password"
	                      value={adminConfig.password}
	                      autoComplete="new-password"
	                      onChange={(event) => updateAdminConfig('password', event.target.value)}
	                    />
	                  </label>
	                  <label className="data-field">
	                    <span>Confirm password</span>
	                    <input
	                      type="password"
	                      value={adminConfig.confirmPassword}
	                      autoComplete="new-password"
	                      onChange={(event) => updateAdminConfig('confirmPassword', event.target.value)}
	                    />
	                  </label>
	                </div>
	              </section>
	            </div>
	            <div className="summary-grid">
	              <section>
                <h3>Providers</h3>
                <ul>
                  {(validationResult?.available?.providers || []).map((provider) => <li key={provider}>{provider}</li>)}
                </ul>
              </section>
              <section>
                <h3>Models</h3>
                <ul>
                  {(validationResult?.available?.models || []).map((model) => <li key={model}>{model}</li>)}
                </ul>
              </section>
              <section>
                <h3>Actions</h3>
                <ul>
	                  {(validationResult?.available?.actions || []).map((action) => <li key={action}>{action}</li>)}
	                </ul>
	              </section>
	              <section>
	                <h3>Data</h3>
	                <ul>
	                  <li>{deploymentPayload.infrastructure.database.provider === 'local-mongo' ? 'Local MongoDB' : 'Remote MongoDB'}</li>
	                  <li>{deploymentPayload.infrastructure.storage.mode === 'local-minio' ? 'Local MinIO storage' : 'External S3 storage'}</li>
	                  <li>{deploymentPayload.services.logger ? 'Grafana logger enabled' : 'Grafana logger disabled'}</li>
	                </ul>
	              </section>
	              <section>
	                <h3>Mail</h3>
	                <ul>
	                  <li>{deploymentPayload.mail.configured ? `${deploymentPayload.mail.provider.toUpperCase()} enabled` : 'Email disabled'}</li>
	                  {deploymentPayload.mail.fromAddress && <li>{deploymentPayload.mail.fromAddress}</li>}
	                </ul>
	              </section>
	              <section>
	                <h3>Access</h3>
	                <ul>
	                  <li>{deploymentPayload.reverseProxy.enabled ? 'Nginx reverse proxy enabled' : 'Localhost access'}</li>
                    {deploymentPayload.reverseProxy.publicUrls?.clientApp && <li>{deploymentPayload.reverseProxy.publicUrls.clientApp}</li>}
                    {deploymentPayload.reverseProxy.publicUrls?.processorApi && <li>{deploymentPayload.reverseProxy.publicUrls.processorApi}</li>}
                    {deploymentPayload.reverseProxy.ssl?.enabled && <li>SSL via Let's Encrypt</li>}
	                </ul>
	              </section>
	              <section>
	                <h3>Admin</h3>
	                <ul>
	                  <li>{normalizeText(adminConfig.organizationName) || 'Organization name / username not set'}</li>
	                  <li>{normalizeText(adminConfig.email) || 'Admin email required'}</li>
	                </ul>
	              </section>
	            </div>
	            <section className="config-section" aria-label="Deployment config">
              <div className="config-section-header">
                <h3>Config</h3>
                <button
                  type="button"
                  className="icon-action config-copy-action"
                  onClick={copyConfig}
                  aria-label={isConfigCopied ? 'Config copied' : 'Copy config'}
                  title={isConfigCopied ? 'Config copied' : 'Copy config'}
                >
                  <span aria-hidden="true">{isConfigCopied ? '✓' : '⧉'}</span>
                </button>
              </div>
              <textarea className="config-preview" readOnly value={JSON.stringify(displayDeploymentPayload, null, 2)} />
            </section>
            {adminConfigError && <div className="error-banner">{adminConfigError}</div>}
            {setupStartError && <div className="error-banner">{setupStartError}</div>}
          </>
        )}

        <footer className="wizard-flow-actions">
          <button type="button" className="secondary-action" onClick={() => goToStep(step - 1)} disabled={step === 1}>
            Back
          </button>
          {step === 1 && (
            <button type="button" className="primary-action flow-primary" onClick={continueFromProviders} disabled={isValidating}>
              {isValidating ? 'Validating credentials...' : 'Continue'}
            </button>
          )}
          {step === 2 && (
            <button type="button" className="primary-action flow-primary" onClick={continueFromServices} disabled={isValidating}>
              {isValidating ? 'Validating...' : 'Continue'}
            </button>
          )}
	          {step === 3 && (
	            <button type="button" className="primary-action flow-primary" onClick={continueFromMailAndData} disabled={isValidatingMail}>
	              {isValidatingMail ? 'Verifying mail...' : 'Continue'}
	            </button>
	          )}
	          {step === 4 && (
	            <button type="button" className="primary-action flow-primary" onClick={continueFromReverseProxy} disabled={isValidatingReverseProxy}>
	              {isValidatingReverseProxy ? 'Validating access...' : 'Continue'}
	            </button>
	          )}
	          {step === 5 && (
	            <button type="button" className="primary-action flow-primary" onClick={submitDeployment} disabled={isStartingSetup}>
	              {isStartingSetup ? 'Starting setup...' : 'Submit and Continue'}
	            </button>
          )}
        </footer>
      </section>
      )}
      <ResetConfirmDialog
        isOpen={isResetConfirmOpen}
        isResetting={isResetting}
        resetError={resetError}
        onCancel={closeResetConfirm}
        onConfirm={confirmReset}
      />
      <ExpressPipelineWarningDialog
        missingRequirements={expressWarningMissingRequirements}
        onReviewProviders={() => setExpressWarningMissingRequirements([])}
        onContinue={continueWithoutExpressPipeline}
      />
    </main>
  );
}
