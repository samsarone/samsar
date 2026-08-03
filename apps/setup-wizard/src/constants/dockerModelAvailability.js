export const DOCKER_PROVIDER = Object.freeze({
  OPENAI: 'openai',
  GOOGLE_CLOUD: 'googleCloud',
  KIMI: 'kimi',
  ALIBABA_CLOUD: 'alibabaCloud',
  GMI_CLOUD: 'gmicloud',
  OPENROUTER: 'openrouter',
  FAL: 'fal',
  ELEVENLABS: 'elevenlabs',
  RUNWAY: 'runway',
  SAMSAR: 'samsar',
});

export const DOCKER_PROVIDER_DISPLAY_ORDER = Object.freeze([
  DOCKER_PROVIDER.OPENAI,
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.KIMI,
  DOCKER_PROVIDER.ALIBABA_CLOUD,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.FAL,
  DOCKER_PROVIDER.OPENROUTER,
  DOCKER_PROVIDER.ELEVENLABS,
  DOCKER_PROVIDER.RUNWAY,
]);

export const DOCKER_NANO_BANANA_MODELS = Object.freeze(['NANOBANANA2', 'NANOBANANAPRO']);
export const DOCKER_VEO_MODELS = Object.freeze([
  'VEO3.1',
  'VEO3.1FAST',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
]);
export const DOCKER_FAL_VIDEO_MODELS = Object.freeze([
  'COSMOS3SUPERI2V',
  'SEEDANCEI2V',
  'KLINGIMGTOVID3PRO',
  'KLINGIMGTOVIDTURBO',
  'KLINGIMGTOVIDPRO',
  'KLINGIMGTOVID2.1MASTER',
  'KLINGIMGTOVID2.1PRO',
  'KLINGIMGTOVID2.1STANDARD',
  'HAILUOPRO',
  'HAPPYHORSEI2V',
  'VEO3.1FLIV',
]);
export const DOCKER_LIP_SYNC_MODELS = Object.freeze([
  'SYNCLIPSYNC',
  'LATENTSYNC',
  'KLINGLIPSYNC',
  'HUMMINGBIRDLIPSYNC',
  'CREATIFYLIPSYNC',
]);
export const DOCKER_SOUND_EFFECT_MODELS = Object.freeze(['MMAUDIOV2', 'MIRELOAI']);

const GOOGLE_OR_SAMSAR = Object.freeze([DOCKER_PROVIDER.GOOGLE_CLOUD, DOCKER_PROVIDER.SAMSAR]);
const OPENAI_INFERENCE_GMI_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.OPENAI,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.OPENROUTER,
]);
const GOOGLE_INFERENCE_GMI_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.OPENROUTER,
]);
const KIMI_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.KIMI,
  DOCKER_PROVIDER.SAMSAR,
]);
const ALIBABA_GMI_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.ALIBABA_CLOUD,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.OPENROUTER,
]);
const FAL_OR_SAMSAR = Object.freeze([DOCKER_PROVIDER.FAL, DOCKER_PROVIDER.SAMSAR]);
const ELEVENLABS_FAL_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.ELEVENLABS,
  DOCKER_PROVIDER.FAL,
  DOCKER_PROVIDER.SAMSAR,
]);
const ELEVENLABS_GMI_SAMSAR_OR_FAL = Object.freeze([
  DOCKER_PROVIDER.ELEVENLABS,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.FAL,
]);
const GOOGLE_FAL_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.FAL,
  DOCKER_PROVIDER.SAMSAR,
]);
const ALIBABA_FAL_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.ALIBABA_CLOUD,
  DOCKER_PROVIDER.FAL,
  DOCKER_PROVIDER.SAMSAR,
]);
const OPENAI_GMI_SAMSAR_OR_FAL = Object.freeze([
  DOCKER_PROVIDER.OPENAI,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.FAL,
]);
const OPENAI_GMI_OR_SAMSAR = Object.freeze([
  DOCKER_PROVIDER.OPENAI,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
]);
const GMI_SAMSAR_OR_FAL = Object.freeze([
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.FAL,
]);
const GMI_CLOUD_ONLY = Object.freeze([DOCKER_PROVIDER.GMI_CLOUD]);
const GOOGLE_GMI_SAMSAR_OR_FAL = Object.freeze([
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.FAL,
]);
const ALIBABA_GMI_SAMSAR_OR_FAL = Object.freeze([
  DOCKER_PROVIDER.ALIBABA_CLOUD,
  DOCKER_PROVIDER.GMI_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
  DOCKER_PROVIDER.FAL,
]);
const MODERATION_CAPABLE_PROVIDERS = Object.freeze([
  DOCKER_PROVIDER.OPENAI,
  DOCKER_PROVIDER.GOOGLE_CLOUD,
  DOCKER_PROVIDER.SAMSAR,
]);

export const DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  'gpt-5.6-sol': OPENAI_INFERENCE_GMI_OR_SAMSAR,
  'gemini-3.1-pro': GOOGLE_INFERENCE_GMI_OR_SAMSAR,
  KIMIK3: KIMI_OR_SAMSAR,
  'QWEN3.7': ALIBABA_GMI_OR_SAMSAR,
  GPTIMAGE2: OPENAI_GMI_SAMSAR_OR_FAL,
  GPTIMAGE2EDIT: OPENAI_GMI_OR_SAMSAR,
  SEEDREAM: GMI_SAMSAR_OR_FAL,
  NANOBANANA2: GOOGLE_GMI_SAMSAR_OR_FAL,
  NANOBANANA2EDIT: GOOGLE_GMI_SAMSAR_OR_FAL,
  NANOBANANAPRO: GOOGLE_GMI_SAMSAR_OR_FAL,
  NANOBANANAPROEDIT: GOOGLE_GMI_SAMSAR_OR_FAL,
  BRIA_ERASER: GMI_SAMSAR_OR_FAL,
  BRIA_GENFILL: GMI_SAMSAR_OR_FAL,
  'WAN2.7PRO': ALIBABA_FAL_OR_SAMSAR,
  RUNWAYML: [DOCKER_PROVIDER.RUNWAY, DOCKER_PROVIDER.SAMSAR],
  'VEO3.1': GOOGLE_GMI_SAMSAR_OR_FAL,
  'VEO3.1FAST': GOOGLE_GMI_SAMSAR_OR_FAL,
  'VEO3.1I2V': GOOGLE_GMI_SAMSAR_OR_FAL,
  'VEO3.1I2VFAST': GOOGLE_GMI_SAMSAR_OR_FAL,
  'VEO3.1FLIV': GMI_SAMSAR_OR_FAL,
  COSMOS3SUPERI2V: FAL_OR_SAMSAR,
  SEEDANCEI2V: GMI_SAMSAR_OR_FAL,
  'SEEDANCE2.0I2V': GMI_CLOUD_ONLY,
  KLINGIMGTOVID3PRO: GMI_SAMSAR_OR_FAL,
  KLINGIMGTOVIDTURBO: GMI_SAMSAR_OR_FAL,
  KLINGIMGTOVIDPRO: GMI_SAMSAR_OR_FAL,
  'KLINGIMGTOVID2.1MASTER': GMI_SAMSAR_OR_FAL,
  'KLINGIMGTOVID2.1PRO': GMI_SAMSAR_OR_FAL,
  'KLINGIMGTOVID2.1STANDARD': GMI_SAMSAR_OR_FAL,
  HAILUOPRO: GMI_SAMSAR_OR_FAL,
  HAPPYHORSEI2V: ALIBABA_GMI_SAMSAR_OR_FAL,
  LYRIA3: GOOGLE_OR_SAMSAR,
  OPENAI_TTS: OPENAI_GMI_OR_SAMSAR,
  GOOGLE_TTS: GOOGLE_OR_SAMSAR,
  ELEVENLABS: ELEVENLABS_GMI_SAMSAR_OR_FAL,
  ELEVENLABS_MUSIC: ELEVENLABS_FAL_OR_SAMSAR,
  MMAUDIOV2: FAL_OR_SAMSAR,
  MIRELOAI: FAL_OR_SAMSAR,
  SYNCLIPSYNC: FAL_OR_SAMSAR,
  LATENTSYNC: FAL_OR_SAMSAR,
  KLINGLIPSYNC: FAL_OR_SAMSAR,
  HUMMINGBIRDLIPSYNC: FAL_OR_SAMSAR,
  CREATIFYLIPSYNC: FAL_OR_SAMSAR,
});

const LEGACY_MODEL_PROVIDER_PRIORITY_WITHOUT_GMI = Object.freeze({
  'gpt-5.6-sol': Object.freeze([
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.OPENROUTER,
    DOCKER_PROVIDER.SAMSAR,
  ]),
  'gemini-3.1-pro': Object.freeze([
    DOCKER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_PROVIDER.OPENROUTER,
    DOCKER_PROVIDER.SAMSAR,
  ]),
});

export const DOCKER_MODEL_ACTIONS_BY_MODEL = Object.freeze({
  'gpt-5.6-sol': ['chat', 'assistant', 'moderation', 'recommendations', 'search'],
  'gemini-3.1-pro': ['chat', 'assistant', 'moderation'],
  KIMIK3: ['chat', 'assistant'],
  'QWEN3.7': ['chat', 'assistant'],
  GPTIMAGE2: ['image'],
  GPTIMAGE2EDIT: ['image_edit'],
  SEEDREAM: ['image'],
  NANOBANANA2: ['image'],
  NANOBANANA2EDIT: ['image_edit'],
  NANOBANANAPRO: ['image'],
  NANOBANANAPROEDIT: ['image_edit'],
  BRIA_ERASER: ['image_edit'],
  BRIA_GENFILL: ['image_edit'],
  'WAN2.7PRO': ['image'],
  RUNWAYML: ['video'],
  'VEO3.1': ['video'],
  'VEO3.1FAST': ['video'],
  'VEO3.1I2V': ['video'],
  'VEO3.1I2VFAST': ['video'],
  'VEO3.1FLIV': ['video'],
  COSMOS3SUPERI2V: ['video'],
  SEEDANCEI2V: ['video'],
  'SEEDANCE2.0I2V': ['video'],
  KLINGIMGTOVID3PRO: ['video'],
  KLINGIMGTOVIDTURBO: ['video'],
  KLINGIMGTOVIDPRO: ['video'],
  'KLINGIMGTOVID2.1MASTER': ['video'],
  'KLINGIMGTOVID2.1PRO': ['video'],
  'KLINGIMGTOVID2.1STANDARD': ['video'],
  HAILUOPRO: ['video'],
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
  KIMIK3: 'Kimi K3',
  'QWEN3.7': 'Qwen 3.7 Plus',
  GPTIMAGE2: 'GPT Image 2',
  GPTIMAGE2EDIT: 'GPT Image 2 Edit',
  SEEDREAM: 'Seedream',
  NANOBANANA2: 'Nano Banana 2',
  NANOBANANA2EDIT: 'Nano Banana 2 Edit',
  NANOBANANAPRO: 'Nano Banana Pro',
  NANOBANANAPROEDIT: 'Nano Banana Pro Edit',
  BRIA_ERASER: 'BRIA Eraser',
  BRIA_GENFILL: 'BRIA GenFill',
  'WAN2.7PRO': 'Wan 2.7 Pro',
  RUNWAYML: 'RunwayML',
  'VEO3.1': 'Veo 3.1 Text to Video',
  'VEO3.1FAST': 'Veo 3.1 Fast Text to Video',
  'VEO3.1I2V': 'Veo 3.1 Image to Video',
  'VEO3.1I2VFAST': 'Veo 3.1 Fast Image to Video',
  'VEO3.1FLIV': 'Veo 3.1 First/Last Frame to Video',
  COSMOS3SUPERI2V: 'Cosmos 3 Super Image to Video',
  SEEDANCEI2V: 'Seedance Image to Video',
  'SEEDANCE2.0I2V': 'Seedance 2.0 Image to Video',
  KLINGIMGTOVID3PRO: 'Kling 3 Pro Image to Video',
  KLINGIMGTOVIDTURBO: 'Kling Turbo Image to Video',
  KLINGIMGTOVIDPRO: 'Kling 1.6 Pro Image to Video',
  'KLINGIMGTOVID2.1MASTER': 'Kling 2.1 Master Image to Video',
  'KLINGIMGTOVID2.1PRO': 'Kling 2.1 Pro Image to Video',
  'KLINGIMGTOVID2.1STANDARD': 'Kling 2.1 Standard Image to Video',
  HAILUOPRO: 'Hailuo 02 Pro',
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

const DOCKER_MODEL_DISPLAY_NAME_BY_PROVIDER = Object.freeze({
  [DOCKER_PROVIDER.ALIBABA_CLOUD]: Object.freeze({
    'QWEN3.7': 'Qwen 3.7 Plus',
  }),
  [DOCKER_PROVIDER.OPENROUTER]: Object.freeze({
    'QWEN3.7': 'Qwen 3.7 Plus',
  }),
  [DOCKER_PROVIDER.GMI_CLOUD]: Object.freeze({
    'QWEN3.7': 'Qwen 3.7 Max / Plus-equivalent Vision',
  }),
});

export const EXPRESS_PIPELINE_REQUIREMENTS = Object.freeze([
  Object.freeze({
    key: 'inference',
    label: 'Inference',
    modelKeys: Object.freeze(['gpt-5.6-sol', 'gemini-3.1-pro', 'KIMIK3', 'QWEN3.7']),
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
const NORMALIZED_KIMI_K3_MODEL_ALIASES = new Set([
  'KIMIK3',
  'KIMI3',
  'KIMIK3LATEST',
  'MOONSHOTKIMIK3',
  'MOONSHOTK3',
]);

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
  if (compact === 'kimi' || compact === 'moonshot' || compact === 'moonshotai') {
    return DOCKER_PROVIDER.KIMI;
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
  const compactModelKey = normalizedModelKey.replace(/[^A-Z0-9]/g, '');
  if (NORMALIZED_KIMI_K3_MODEL_ALIASES.has(compactModelKey)) {
    return 'KIMIK3';
  }
  return NORMALIZED_MODEL_KEY_TO_CANONICAL[normalizedModelKey] || '';
}

export function getDockerModelDisplayName(modelKey, providerKey = '') {
  const canonicalModelKey = getCanonicalDockerModelKey(modelKey);
  const normalizedProviderKey = normalizeDockerProviderKey(providerKey);
  const providerDisplayName =
    DOCKER_MODEL_DISPLAY_NAME_BY_PROVIDER[normalizedProviderKey]?.[canonicalModelKey];
  if (providerDisplayName) {
    return providerDisplayName;
  }
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
  const canonicalModelKey = getCanonicalDockerModelKey(modelKey);
  const providerPriority = !enabledProviderSet.has(DOCKER_PROVIDER.GMI_CLOUD) &&
    LEGACY_MODEL_PROVIDER_PRIORITY_WITHOUT_GMI[canonicalModelKey]
    ? LEGACY_MODEL_PROVIDER_PRIORITY_WITHOUT_GMI[canonicalModelKey]
    : getDockerModelProviderPriority(modelKey);
  return providerPriority.find((provider) => enabledProviderSet.has(provider)) || '';
}

function hasGmiCloudModelRoute(modelMappings, modelKey) {
  const routes = modelMappings?.[modelKey];
  if (!routes || typeof routes !== 'object') {
    return false;
  }
  if (modelKey === 'SEEDANCE2.0I2V') {
    return typeof routes.video?.modelId === 'string' &&
      routes.video.modelId.trim() === 'seedance-2-0-260128' &&
      routes.video.operation === 'video.generate';
  }
  const routeAvailable = (modality) => Boolean(
    routes[modality] &&
    typeof routes[modality] === 'object' &&
    typeof routes[modality].modelId === 'string' &&
    routes[modality].modelId.trim(),
  );
  if (['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7'].includes(modelKey)) {
    return routeAvailable('text') && routeAvailable('vision');
  }
  return Object.values(routes).some((route) => (
    route && typeof route === 'object' && typeof route.modelId === 'string' && route.modelId.trim()
  ));
}

export function buildDockerAvailableModelsFromEnabledProviders(enabledProviderKeys = [], options = {}) {
  const providers = orderDockerProviderKeys(enabledProviderKeys);
  const hasCredentialScopedGmiCatalog = Object.hasOwn(options, 'gmiCloudModelMappings');
  const gmiCloudModelMappings = options.gmiCloudModelMappings || {};
  const models = [];
  const actions = new Set();
  const modelProviders = {};
  const modelProviderPriority = {};

  for (const [modelKey, providerPriority] of Object.entries(DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL)) {
    const requiresCredentialScopedGmiRoute = modelKey === 'SEEDANCE2.0I2V';
    const gmiCloudRouteEnabled = providers.includes(DOCKER_PROVIDER.GMI_CLOUD) && (
      (!requiresCredentialScopedGmiRoute && !hasCredentialScopedGmiCatalog) ||
      hasGmiCloudModelRoute(gmiCloudModelMappings, modelKey)
    );
    const configuredProviderPriority = !gmiCloudRouteEnabled &&
      LEGACY_MODEL_PROVIDER_PRIORITY_WITHOUT_GMI[modelKey]
      ? LEGACY_MODEL_PROVIDER_PRIORITY_WITHOUT_GMI[modelKey]
      : providerPriority;
    const effectiveProviderPriority = configuredProviderPriority.filter((providerKey) => (
      providerKey !== DOCKER_PROVIDER.GMI_CLOUD ||
      gmiCloudRouteEnabled
    ));
    const provider = effectiveProviderPriority.find((providerKey) => providers.includes(providerKey));
    if (!provider) {
      continue;
    }
    models.push(modelKey);
    modelProviders[modelKey] = provider;
    modelProviderPriority[modelKey] = [...effectiveProviderPriority];
    const modelActions = DOCKER_MODEL_ACTIONS_BY_MODEL[modelKey] || [];
    const gmiCloudRoutes = gmiCloudModelMappings[modelKey] || {};
    const providerActions = (
      provider === DOCKER_PROVIDER.OPENROUTER ||
      (
        provider === DOCKER_PROVIDER.GMI_CLOUD &&
        !Object.hasOwn(gmiCloudRoutes, 'image') &&
        !Object.hasOwn(gmiCloudRoutes, 'video') &&
        !Object.hasOwn(gmiCloudRoutes, 'audio')
      )
    )
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
  const gmiCloudValidation = providerResults.gmicloud;
  const options = gmiCloudValidation && typeof gmiCloudValidation === 'object'
    ? { gmiCloudModelMappings: gmiCloudValidation.modelMappings || {} }
    : {};
  return buildDockerAvailableModelsFromEnabledProviders(enabledProviderKeys, options);
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
