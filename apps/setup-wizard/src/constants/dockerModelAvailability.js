export const DOCKER_PROVIDER = Object.freeze({
  OPENAI: 'openai',
  GOOGLE_CLOUD: 'googleCloud',
  ALIBABA_CLOUD: 'alibabaCloud',
  OPENROUTER: 'openrouter',
  FAL: 'fal',
  ELEVENLABS: 'elevenlabs',
  RUNWAY: 'runway',
  SAMSAR: 'samsar',
});

export const DOCKER_PROVIDER_DISPLAY_ORDER = Object.freeze([
  DOCKER_PROVIDER.OPENAI,
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.ALIBABA_CLOUD,
  DOCKER_PROVIDER.OPENROUTER,
  DOCKER_PROVIDER.FAL,
  DOCKER_PROVIDER.ELEVENLABS,
  DOCKER_PROVIDER.RUNWAY,
  DOCKER_PROVIDER.SAMSAR,
]);

export const DOCKER_NANO_BANANA_MODELS = Object.freeze(['NANOBANANA2', 'NANOBANANAPRO']);
export const DOCKER_VEO_MODELS = Object.freeze(['VEO3.1I2V', 'VEO3.1I2VFAST']);
export const DOCKER_FAL_VIDEO_MODELS = Object.freeze([
  'COSMOS3SUPERI2V',
  'SEEDANCEI2V',
  'KLINGIMGTOVID3PRO',
  'KLINGIMGTOVIDTURBO',
  'HAPPYHORSEI2V',
]);
export const DOCKER_LIP_SYNC_MODELS = Object.freeze([
  'SYNCLIPSYNC',
  'LATENTSYNC',
  'KLINGLIPSYNC',
  'HUMMINGBIRDLIPSYNC',
  'CREATIFYLIPSYNC',
]);
export const DOCKER_SOUND_EFFECT_MODELS = Object.freeze(['MMAUDIOV2', 'MIRELOAI']);

const OPENAI_OR_SAMSAR = Object.freeze([DOCKER_PROVIDER.OPENAI, DOCKER_PROVIDER.SAMSAR]);
const GOOGLE_OR_SAMSAR = Object.freeze([DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.SAMSAR]);
const OPENAI_INFERENCE_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.OPENAI,
  DOCKER_PROVIDER.OPENROUTER,
  DOCKER_PROVIDER.SAMSAR,
]);
const GOOGLE_INFERENCE_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.OPENROUTER,
  DOCKER_PROVIDER.SAMSAR,
]);
const ALIBABA_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.ALIBABA_CLOUD,
  DOCKER_PROVIDER.OPENROUTER,
  DOCKER_PROVIDER.SAMSAR,
]);
const ALIBABA_FAL_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.ALIBABA_CLOUD,
  DOCKER_PROVIDER.FAL,
  DOCKER_PROVIDER.SAMSAR,
]);
const FAL_OR_SAMSAR = Object.freeze([DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR]);
const ELEVENLABS_FAL_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.ELEVENLABS,
  DOCKER_PROVIDER.FAL,
  DOCKER_PROVIDER.SAMSAR,
]);
const GOOGLE_FAL_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.FAL,
  DOCKER_PROVIDER.SAMSAR,
]);
const MODERATION_CAPABLE_PROVIDERS = Object.freeze([
  DOCKER_PROVIDER.OPENAI,
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
]);

export const DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  'gpt-5.6-sol': OPENAI_INFERENCE_OR_SAMSAR,
  'gemini-3.1-pro': GOOGLE_INFERENCE_OR_SAMSAR,
  'QWEN3.7': ALIBABA_OR_SAMSAR,
  GPTIMAGE2: OPENAI_OR_SAMSAR,
  GPTIMAGE2EDIT: OPENAI_OR_SAMSAR,
  SEEDREAM: FAL_OR_SAMSAR,
  NANOBANANA2: GOOGLE_FAL_OR_SAMSAR,
  NANOBANANA2EDIT: GOOGLE_FAL_OR_SAMSAR,
  NANOBANANAPRO: GOOGLE_FAL_OR_SAMSAR,
  NANOBANANAPROEDIT: GOOGLE_FAL_OR_SAMSAR,
  'WAN2.7PRO': ALIBABA_FAL_OR_SAMSAR,
  RUNWAYML: [DOCKER_PROVIDER.RUNWAY, DOCKER_PROVIDER.SAMSAR],
  'VEO3.1I2V': GOOGLE_FAL_OR_SAMSAR,
  'VEO3.1I2VFAST': GOOGLE_FAL_OR_SAMSAR,
  COSMOS3SUPERI2V: FAL_OR_SAMSAR,
  SEEDANCEI2V: FAL_OR_SAMSAR,
  KLINGIMGTOVID3PRO: FAL_OR_SAMSAR,
  KLINGIMGTOVIDTURBO: FAL_OR_SAMSAR,
  HAPPYHORSEI2V: ALIBABA_FAL_OR_SAMSAR,
  LYRIA3: GOOGLE_OR_SAMSAR,
  OPENAI_TTS: OPENAI_OR_SAMSAR,
  GOOGLE_TTS: GOOGLE_OR_SAMSAR,
  ELEVENLABS: ELEVENLABS_FAL_OR_SAMSAR,
  ELEVENLABS_MUSIC: ELEVENLABS_FAL_OR_SAMSAR,
  MMAUDIOV2: FAL_OR_SAMSAR,
  MIRELOAI: FAL_OR_SAMSAR,
  SYNCLIPSYNC: FAL_OR_SAMSAR,
  LATENTSYNC: FAL_OR_SAMSAR,
  KLINGLIPSYNC: FAL_OR_SAMSAR,
  HUMMINGBIRDLIPSYNC: FAL_OR_SAMSAR,
  CREATIFYLIPSYNC: FAL_OR_SAMSAR,
});

export const DOCKER_MODEL_ACTIONS_BY_MODEL = Object.freeze({
  'gpt-5.6-sol': ['chat', 'assistant', 'moderation', 'recommendations', 'search'],
  'gemini-3.1-pro': ['chat', 'assistant', 'moderation'],
  'QWEN3.7': ['chat', 'assistant'],
  GPTIMAGE2: ['image'],
  GPTIMAGE2EDIT: ['image_edit'],
  SEEDREAM: ['image'],
  NANOBANANA2: ['image'],
  NANOBANANA2EDIT: ['image_edit'],
  NANOBANANAPRO: ['image'],
  NANOBANANAPROEDIT: ['image_edit'],
  'WAN2.7PRO': ['image'],
  RUNWAYML: ['video'],
  'VEO3.1I2V': ['video'],
  'VEO3.1I2VFAST': ['video'],
  COSMOS3SUPERI2V: ['video'],
  SEEDANCEI2V: ['video'],
  KLINGIMGTOVID3PRO: ['video'],
  KLINGIMGTOVIDTURBO: ['video'],
  HAPPYHORSEI2V: ['video'],
  LYRIA3: ['audio'],
  OPENAI_TTS: ['audio'],
  GOOGLE_TTS: ['audio'],
  ELEVENLABS: ['audio'],
  ELEVENLABS_MUSIC: ['audio'],
  MMAUDIOV2: ['sound_effect', 'audio'],
  MIRELOAI: ['sound_effect', 'audio'],
  SYNCLIPSYNC: ['lip_sync'],
  LATENTSYNC: ['lip_sync'],
  KLINGLIPSYNC: ['lip_sync'],
  HUMMINGBIRDLIPSYNC: ['lip_sync'],
  CREATIFYLIPSYNC: ['lip_sync'],
});

export const DOCKER_MODEL_DISPLAY_NAME_BY_MODEL = Object.freeze({
  'gpt-5.6-sol': 'GPT 5.6 Sol',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'QWEN3.7': 'Qwen 3.7',
  GPTIMAGE2: 'GPT Image 2',
  GPTIMAGE2EDIT: 'GPT Image 2 Edit',
  SEEDREAM: 'Seedream',
  NANOBANANA2: 'Nano Banana 2',
  NANOBANANA2EDIT: 'Nano Banana 2 Edit',
  NANOBANANAPRO: 'Nano Banana Pro',
  NANOBANANAPROEDIT: 'Nano Banana Pro Edit',
  'WAN2.7PRO': 'Wan 2.7 Pro',
  RUNWAYML: 'RunwayML',
  'VEO3.1I2V': 'Veo 3.1 Image to Video',
  'VEO3.1I2VFAST': 'Veo 3.1 Fast Image to Video',
  COSMOS3SUPERI2V: 'Cosmos 3 Super Image to Video',
  SEEDANCEI2V: 'Seedance Image to Video',
  KLINGIMGTOVID3PRO: 'Kling 3 Pro Image to Video',
  KLINGIMGTOVIDTURBO: 'Kling Turbo Image to Video',
  HAPPYHORSEI2V: 'Happy Horse Image to Video',
  LYRIA3: 'Lyria 3',
  OPENAI_TTS: 'OpenAI Text to Speech',
  GOOGLE_TTS: 'Google Text to Speech',
  ELEVENLABS: 'ElevenLabs Speech',
  ELEVENLABS_MUSIC: 'ElevenLabs Music',
  MMAUDIOV2: 'MMAudio V2',
  MIRELOAI: 'Mirelo AI',
  SYNCLIPSYNC: 'Sync Lip Sync',
  LATENTSYNC: 'LatentSync',
  KLINGLIPSYNC: 'Kling Lip Sync',
  HUMMINGBIRDLIPSYNC: 'Hummingbird Lip Sync',
  CREATIFYLIPSYNC: 'Creatify Lip Sync',
});

export const EXPRESS_PIPELINE_REQUIREMENTS = Object.freeze([
  Object.freeze({
    key: 'inference',
    label: 'Inference',
    modelKeys: Object.freeze(['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7']),
  }),
  Object.freeze({
    key: 'imageGeneration',
    label: 'Image generation',
    actions: Object.freeze(['image']),
  }),
  Object.freeze({
    key: 'video',
    label: 'Video',
    actions: Object.freeze(['video']),
  }),
  Object.freeze({
    key: 'speech',
    label: 'Speech',
    modelKeys: Object.freeze(['OPENAI_TTS', 'GOOGLE_TTS', 'ELEVENLABS']),
  }),
  Object.freeze({
    key: 'backingTrack',
    label: 'Backing track',
    modelKeys: Object.freeze(['LYRIA3', 'ELEVENLABS_MUSIC']),
  }),
  Object.freeze({
    key: 'lipSync',
    label: 'Lip sync',
    actions: Object.freeze(['lip_sync']),
  }),
  Object.freeze({
    key: 'soundEffect',
    label: 'Sound effect',
    actions: Object.freeze(['sound_effect']),
  }),
]);

const NORMALIZED_MODEL_KEY_TO_CANONICAL = Object.freeze(
  Object.fromEntries(
    Object.keys(DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL).map((modelKey) => [
      normalizeDockerModelKey(modelKey),
      modelKey,
    ]),
  ),
);

export function normalizeDockerModelKey(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function normalizeDockerProviderKey(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const compact = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'google' || compact === 'googlecloud' || compact === 'gcp') {
    return DOCKER_PROVIDER.GOOGLE_CLOUD;
  }
  if (
    compact === 'alibaba' ||
    compact === 'alibabacloud' ||
    compact === 'aliyun' ||
    compact === 'dashscope' ||
    compact === 'qwen'
  ) {
    return DOCKER_PROVIDER.ALIBABA_CLOUD;
  }
  if (compact === 'runway' || compact === 'runwayml') {
    return DOCKER_PROVIDER.RUNWAY;
  }
  if (compact === 'openai') {
    return DOCKER_PROVIDER.OPENAI;
  }
  if (compact === 'openrouter' || compact === 'openrouterai') {
    return DOCKER_PROVIDER.OPENROUTER;
  }
  if (compact === 'fal') {
    return DOCKER_PROVIDER.FAL;
  }
  if (compact === 'elevenlabs' || compact === 'elevenlab') {
    return DOCKER_PROVIDER.ELEVENLABS;
  }
  if (compact === 'samsar' || compact === 'samsarapikey' || compact === 'samsarapi') {
    return DOCKER_PROVIDER.SAMSAR;
  }
  return value.trim();
}

export function orderDockerProviderKeys(providerKeys = []) {
  return [...new Set(providerKeys.map(normalizeDockerProviderKey).filter(Boolean))]
    .sort((leftProvider, rightProvider) => {
      const leftIndex = DOCKER_PROVIDER_DISPLAY_ORDER.indexOf(leftProvider);
      const rightIndex = DOCKER_PROVIDER_DISPLAY_ORDER.indexOf(rightProvider);
      const resolvedLeftIndex = leftIndex === -1 ? DOCKER_PROVIDER_DISPLAY_ORDER.length : leftIndex;
      const resolvedRightIndex = rightIndex === -1 ? DOCKER_PROVIDER_DISPLAY_ORDER.length : rightIndex;
      return resolvedLeftIndex - resolvedRightIndex;
    });
}

export function getCanonicalDockerModelKey(modelKey) {
  const normalizedModelKey = normalizeDockerModelKey(modelKey);
  return NORMALIZED_MODEL_KEY_TO_CANONICAL[normalizedModelKey] || '';
}

export function getDockerModelDisplayName(modelKey) {
  const canonicalModelKey = getCanonicalDockerModelKey(modelKey);
  return DOCKER_MODEL_DISPLAY_NAME_BY_MODEL[canonicalModelKey] || canonicalModelKey || modelKey;
}

export function getDockerModelProviderPriority(modelKey) {
  const canonicalModelKey = getCanonicalDockerModelKey(modelKey);
  return canonicalModelKey
    ? [...DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL[canonicalModelKey]]
    : [];
}

export function getDockerProviderPriorityForModels(modelKeys = []) {
  return orderDockerProviderKeys(
    modelKeys.flatMap((modelKey) => getDockerModelProviderPriority(modelKey)),
  );
}

export function resolveDockerModelProvider(modelKey, enabledProviderKeys = []) {
  const enabledProviderSet = new Set(orderDockerProviderKeys(enabledProviderKeys));
  return getDockerModelProviderPriority(modelKey).find((provider) => enabledProviderSet.has(provider)) || '';
}

export function buildDockerAvailableModelsFromEnabledProviders(enabledProviderKeys = []) {
  const providers = orderDockerProviderKeys(enabledProviderKeys);
  const models = [];
  const actions = new Set();
  const modelProviders = {};
  const modelProviderPriority = {};

  for (const [modelKey, providerPriority] of Object.entries(DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL)) {
    const provider = providerPriority.find((providerKey) => providers.includes(providerKey));
    if (!provider) {
      continue;
    }
    models.push(modelKey);
    modelProviders[modelKey] = provider;
    modelProviderPriority[modelKey] = [...providerPriority];
    const modelActions = DOCKER_MODEL_ACTIONS_BY_MODEL[modelKey] || [];
    const providerActions = provider === DOCKER_PROVIDER.OPENROUTER
      ? modelActions.filter((action) => action === 'chat' || action === 'assistant')
      : modelActions;
    providerActions.forEach((action) => actions.add(action));
  }

  if (providers.some((provider) => MODERATION_CAPABLE_PROVIDERS.includes(provider))) {
    actions.add('moderation');
  }

  return {
    providers,
    models: models.sort(),
    actions: [...actions].sort(),
    modelProviders,
    modelProviderPriority,
  };
}

export function buildDockerAvailableModelsFromProviderResults(providerResults = {}) {
  const enabledProviderKeys = Object.entries(providerResults)
    .filter(([, result]) => Boolean(result?.ok || result === true))
    .map(([provider]) => provider);
  return buildDockerAvailableModelsFromEnabledProviders(enabledProviderKeys);
}

export function buildDockerCapabilityFamilyAvailability(family = {}, enabledProviderKeys = []) {
  const modelKeys = Array.isArray(family.modelKeys) ? family.modelKeys : [];
  const providerKeys = getDockerProviderPriorityForModels(modelKeys);
  const modelProviders = Object.fromEntries(
    modelKeys
      .map((modelKey) => [modelKey, resolveDockerModelProvider(modelKey, enabledProviderKeys)])
      .filter(([, provider]) => Boolean(provider)),
  );
  const enabledProviderKeysForFamily = orderDockerProviderKeys(Object.values(modelProviders));

  return {
    ...family,
    providerKeys: providerKeys.length ? providerKeys : orderDockerProviderKeys(family.providerKeys || []),
    enabledProviderKeys: enabledProviderKeysForFamily,
    modelProviders,
    availableModelKeys: Object.keys(modelProviders),
    isAvailable: enabledProviderKeysForFamily.length > 0,
  };
}

export function buildExpressPipelineAvailability(available = {}) {
  const availableModelSet = new Set(available.models || []);
  const availableActionSet = new Set(available.actions || []);
  const requirements = EXPRESS_PIPELINE_REQUIREMENTS.map((requirement) => {
    const matchingModelKeys = (requirement.modelKeys || []).filter((modelKey) => availableModelSet.has(modelKey));
    const matchingActions = (requirement.actions || []).filter((action) => availableActionSet.has(action));
    return {
      ...requirement,
      matchingModelKeys,
      matchingActions,
      isAvailable: matchingModelKeys.length > 0 || matchingActions.length > 0,
    };
  });

  return {
    requirements,
    availableRequirements: requirements.filter((requirement) => requirement.isAvailable),
    missingRequirements: requirements.filter((requirement) => !requirement.isAvailable),
    isReady: requirements.every((requirement) => requirement.isAvailable),
  };
}
