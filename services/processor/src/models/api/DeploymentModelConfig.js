import fs from 'fs';
import path from 'path';
import {
  isContainerRuntime,
  isStandaloneEdition,
} from '../../utils/EnvironmentUtils.js';
import {
  applyModelAdapterPreferencesToPriorityMap,
  normalizeModelAdapterModelKey,
  normalizeModelAdapterProviderKey,
  readModelAdapterPreferences,
} from './ModelAdapterPreferences.js';

function getDefaultAvailableModelsPath() {
  const configuredPath = process.env.SAMSAR_AVAILABLE_MODELS_FILE ||
    process.env.SAMSAR_AVAILABLE_MODELS_PATH;
  if (configuredPath) return configuredPath;
  if (isContainerRuntime()) {
    return '/persistent/config/available-models.json';
  }
  return path.join(process.cwd(), 'runtime', 'config', 'available-models.json');
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

function normalizeStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => (
        typeof key === 'string' && key.trim() && typeof item === 'string' && item.trim()
      ))
      .map(([key, item]) => [key.trim(), item.trim()]),
  );
}

function normalizeStringListMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === 'string' && key.trim())
      .map(([key, item]) => [key.trim(), normalizeStringList(item)]),
  );
}

function hasEnvCredential(...keys) {
  return keys.some((key) => typeof process.env[key] === 'string' && process.env[key].trim());
}

function isDockerDeploymentRuntime() {
  return isStandaloneEdition();
}

function normalizeDeploymentProvider(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';

  if (['alibaba', 'alibabacloud', 'dashscope', 'qwen'].includes(normalized)) {
    return 'alibabaCloud';
  }

  if (['openrouter', 'openrouterai'].includes(normalized)) {
    return 'openrouter';
  }

  if (['kimi', 'kimik3', 'moonshot', 'moonshotai'].includes(normalized)) {
    return 'kimi';
  }

  return normalized;
}

function normalizeDeploymentModel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['QWEN3.7', 'QWEN3.7-MAX', 'QWEN3.7-PLUS', 'QWEN3.8', 'QWEN3.8-MAX-PREVIEW'].includes(normalized)) {
    return 'QWEN3.7';
  }
  if (['KIMIK3', 'KIMI-K3', 'KIMI K3'].includes(normalized)) {
    return 'KIMIK3';
  }
  return normalized;
}

function findModelProvider(modelProviders = {}, modelKey = '') {
  const normalizedModelKey = normalizeDeploymentModel(modelKey);
  const entry = Object.entries(modelProviders).find(
    ([key]) => normalizeDeploymentModel(key) === normalizedModelKey,
  );
  return entry?.[1] || '';
}

function isSavedQwenSelectionAuthorized({ providers, models, modelProviders }) {
  if (!isDockerDeploymentRuntime()) {
    return false;
  }

  const hasQwenModel = models.some((model) => normalizeDeploymentModel(model) === 'QWEN3.7');
  const qwenProviders = new Set(['alibabaCloud', 'openrouter', 'samsar']);
  const availableProviders = new Set(providers.map(normalizeDeploymentProvider));
  const selectedProvider = normalizeDeploymentProvider(
    findModelProvider(modelProviders, 'QWEN3.7'),
  );

  return hasQwenModel && availableProviders.has(selectedProvider) && qwenProviders.has(selectedProvider);
}

function filterWan27WithoutConfiguredProvider(models = []) {
  if (!isDockerDeploymentRuntime() || hasEnvCredential(
    'ALIBABA_API_KEY',
    'DASHSCOPE_API_KEY',
    'ALIBABA_CLOUD_API_KEY',
    'QWEN_API_KEY',
    'FAL_API_KEY',
    'SAMSAR_API_KEY',
  )) {
    return models;
  }
  return models.filter(
    (model) => String(model?.value || model?.key || '').toUpperCase() !== 'WAN2.7PRO',
  );
}

function appendUnique(target, values) {
  const seen = new Set(target);
  values.forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      target.push(value);
    }
  });
}

function hasGoogleInferenceCredential() {
  if (hasEnvCredential(
    'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS',
  )) {
    return true;
  }
  return hasEnvCredential(
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_PROJECT_ID',
    'GCP_PROJECT',
    'GCLOUD_PROJECT',
    'PROJECT_ID',
  ) && hasEnvCredential('K_SERVICE', 'GAE_SERVICE', 'FUNCTION_TARGET', 'GCE_METADATA_HOST');
}

function mergeRuntimeInferenceProviderSelections(availability) {
  const hasOpenRouter = hasEnvCredential('OPENROUTER_API_KEY');
  const hasSamsar = hasEnvCredential('SAMSAR_API_KEY');
  const priorities = {
    'gpt-5.6-sol': ['openai', 'openrouter', 'samsar'],
    'gemini-3.1-pro': ['googleCloud', 'openrouter', 'samsar'],
    'QWEN3.7': ['alibabaCloud', 'openrouter', 'samsar'],
    KIMIK3: ['kimi', 'samsar'],
  };
  const configured = {
    openai: hasEnvCredential('OPENAI_API_KEY'),
    googleCloud: hasGoogleInferenceCredential(),
    alibabaCloud: hasEnvCredential(
      'ALIBABA_API_KEY',
      'DASHSCOPE_API_KEY',
      'ALIBABA_CLOUD_API_KEY',
      'QWEN_API_KEY',
    ),
    openrouter: hasOpenRouter,
    kimi: hasEnvCredential('KIMI_K3_API_KEY'),
    samsar: hasSamsar,
  };

  for (const [model, providerPriority] of Object.entries(priorities)) {
    const configuredPriority = normalizeStringList(
      availability.modelProviderPriority?.[model],
    );
    const configuredDefaultPriority = normalizeStringList(
      availability.defaultModelProviderPriority?.[model],
    );
    const effectivePriority = [
      ...configuredPriority,
      ...providerPriority.filter((provider) => !configuredPriority.includes(provider)),
    ];
    const defaultPriority = [
      ...configuredDefaultPriority,
      ...providerPriority.filter((provider) => !configuredDefaultPriority.includes(provider)),
    ];
    availability.defaultModelProviderPriority[model] = defaultPriority;
    const provider = effectivePriority.find((candidate) => configured[candidate]);
    if (!provider) continue;
    availability.modelProviders[model] = provider;
    availability.modelProviderPriority[model] = effectivePriority;
  }
}

function applyStandaloneModelAdapterPreferences(availability = {}) {
  if (!isStandaloneEdition()) {
    return availability;
  }

  const preferences = readModelAdapterPreferences();
  const defaultPriorityMap = availability.defaultModelProviderPriority ||
    availability.modelProviderPriority ||
    {};
  const reorderedDefaultPriorityMap = applyModelAdapterPreferencesToPriorityMap(
    defaultPriorityMap,
    preferences.modelProviderPriority,
  );
  const effectivePriorityMap = applyModelAdapterPreferencesToPriorityMap(
    availability.modelProviderPriority || {},
    {},
  );
  const configuredProviders = new Set(
    normalizeStringList(availability.providers)
      .map(normalizeModelAdapterProviderKey)
      .filter(Boolean),
  );
  const modelProviders = {
    ...(availability.modelProviders || {}),
  };
  const preferenceModelKeys = new Set(
    Object.keys(preferences.modelProviderPriority || {})
      .map(normalizeModelAdapterModelKey),
  );

  for (const rawPreferenceModelKey of preferenceModelKeys) {
    const matchingDefaultKey = Object.keys(reorderedDefaultPriorityMap).find(
      (candidate) => normalizeModelAdapterModelKey(candidate) === rawPreferenceModelKey,
    );
    if (!matchingDefaultKey) {
      continue;
    }
    const matchingEffectiveKey = Object.keys(effectivePriorityMap).find(
      (candidate) => normalizeModelAdapterModelKey(candidate) === rawPreferenceModelKey,
    ) || matchingDefaultKey;
    effectivePriorityMap[matchingEffectiveKey] =
      reorderedDefaultPriorityMap[matchingDefaultKey];
  }

  for (const [rawModelKey, priority] of Object.entries(effectivePriorityMap)) {
    const modelKey = normalizeModelAdapterModelKey(rawModelKey);
    if (!preferenceModelKeys.has(modelKey)) {
      continue;
    }
    const provider = priority.find((candidate) => configuredProviders.has(candidate));
    if (provider) {
      const matchingModelKey = Object.keys(modelProviders).find(
        (candidate) => normalizeModelAdapterModelKey(candidate) === modelKey,
      ) || rawModelKey;
      modelProviders[matchingModelKey] = provider;
    }
  }

  return {
    ...availability,
    modelProviders,
    modelProviderPriority: effectivePriorityMap,
    defaultModelProviderPriority: normalizeStringListMap(defaultPriorityMap),
    modelAdapterPreferencesUpdatedAt: preferences.updatedAt,
  };
}

export function mergeRuntimeInferenceDeploymentAvailability(value = {}) {
  const configuredProviders = normalizeStringList(value?.providers);
  const configuredModels = [...new Set(
    normalizeStringList(value?.models).map((model) => (
      normalizeDeploymentModel(model) === 'QWEN3.7' ? 'QWEN3.7' : model
    )),
  )];
  const modelProviders = Object.fromEntries(
    Object.entries(normalizeStringMap(value?.modelProviders)).map(([model, provider]) => [
      normalizeDeploymentModel(model) === 'QWEN3.7' ? 'QWEN3.7' : model,
      provider,
    ]),
  );
  const modelProviderPriority = Object.fromEntries(
    Object.entries(normalizeStringListMap(value?.modelProviderPriority)).map(([model, providers]) => [
      normalizeDeploymentModel(model) === 'QWEN3.7' ? 'QWEN3.7' : model,
      providers,
    ]),
  );
  const defaultModelProviderPriority = Object.fromEntries(
    Object.entries(normalizeStringListMap(
      value?.defaultModelProviderPriority || value?.modelProviderPriority,
    )).map(([model, providers]) => [
      normalizeDeploymentModel(model) === 'QWEN3.7' ? 'QWEN3.7' : model,
      providers,
    ]),
  );
  const providerKeyTypes = normalizeStringMap(value?.providerKeyTypes);
  const providerEndpointTypes = normalizeStringMap(value?.providerEndpointTypes);
  const qwenAuthorized = isSavedQwenSelectionAuthorized({
    providers: configuredProviders,
    models: configuredModels,
    modelProviders,
  });
  const merged = {
    providers: configuredProviders,
    models: configuredModels.filter(
      (model) => normalizeDeploymentModel(model) !== 'QWEN3.7' || qwenAuthorized,
    ),
    actions: normalizeStringList(value?.actions),
    modelProviders,
    modelProviderPriority,
    defaultModelProviderPriority,
    providerKeyTypes,
    providerEndpointTypes,
    audio: value?.audio || null,
  };

  if (hasEnvCredential('ALIBABA_API_KEY', 'DASHSCOPE_API_KEY', 'ALIBABA_CLOUD_API_KEY', 'QWEN_API_KEY')) {
    appendUnique(merged.providers, ['alibabaCloud']);
    appendUnique(merged.models, ['QWEN3.7', 'HAPPYHORSEI2V', 'WAN2.7PRO']);
    appendUnique(merged.actions, ['chat', 'assistant', 'image', 'video']);
    const keyType = String(process.env.ALIBABA_API_KEY_TYPE || '').trim();
    const endpointType = String(process.env.ALIBABA_API_ENDPOINT_TYPE || '').trim();
    if (keyType) merged.providerKeyTypes.alibabaCloud = keyType;
    if (endpointType) merged.providerEndpointTypes.alibabaCloud = endpointType;
  }

  if (hasEnvCredential('OPENAI_API_KEY')) {
    appendUnique(merged.providers, ['openai']);
    appendUnique(merged.models, ['gpt-5.6-sol']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  if (hasGoogleInferenceCredential()) {
    appendUnique(merged.providers, ['googleCloud']);
    appendUnique(merged.models, ['gemini-3.1-pro']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  if (hasEnvCredential('KIMI_K3_API_KEY')) {
    appendUnique(merged.providers, ['kimi']);
    appendUnique(merged.models, ['KIMIK3']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  if (hasEnvCredential('FAL_API_KEY')) {
    appendUnique(merged.providers, ['fal']);
    appendUnique(merged.models, ['WAN2.7PRO', 'HAPPYHORSEI2V']);
    appendUnique(merged.actions, ['image', 'video']);
  }

  if (hasEnvCredential('SAMSAR_API_KEY')) {
    appendUnique(merged.providers, ['samsar']);
    appendUnique(merged.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7', 'KIMIK3', 'HAPPYHORSEI2V', 'WAN2.7PRO']);
    appendUnique(merged.actions, ['chat', 'assistant', 'image', 'video']);
  }

  if (hasEnvCredential('OPENROUTER_API_KEY')) {
    appendUnique(merged.providers, ['openrouter']);
    appendUnique(merged.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  mergeRuntimeInferenceProviderSelections(merged);

  return applyStandaloneModelAdapterPreferences(merged);
}

function normalizeDeploymentAudioAvailability(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      providers: [],
      ttsProviders: [],
      musicProviders: [],
      soundEffectProviders: [],
      allowAllTtsSpeakers: false,
      allowAllMusicProviders: false,
      source: null,
    };
  }

  return {
    providers: normalizeStringList(value.providers),
    ttsProviders: normalizeStringList(value.ttsProviders),
    musicProviders: normalizeStringList(value.musicProviders),
    soundEffectProviders: normalizeStringList(value.soundEffectProviders),
    allowAllTtsSpeakers: value.allowAllTtsSpeakers === true,
    allowAllMusicProviders: value.allowAllMusicProviders === true,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : null,
  };
}

export function readDeploymentAvailableModels() {
  const filePath = process.env.SAMSAR_AVAILABLE_MODELS_PATH || getDefaultAvailableModelsPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const models = normalizeStringList(parsed?.models);
    const actions = normalizeStringList(parsed?.actions);
    const providers = normalizeStringList(parsed?.providers);
    const modelProviders = normalizeStringMap(parsed?.modelProviders);
    const modelProviderPriority = normalizeStringListMap(parsed?.modelProviderPriority);
    const providerKeyTypes = normalizeStringMap(parsed?.providerKeyTypes);
    const providerEndpointTypes = normalizeStringMap(parsed?.providerEndpointTypes);
    const audio = normalizeDeploymentAudioAvailability(parsed?.audio);

    return applyStandaloneModelAdapterPreferences({
      providers,
      models,
      actions,
      modelProviders,
      modelProviderPriority,
      defaultModelProviderPriority: modelProviderPriority,
      providerKeyTypes,
      providerEndpointTypes,
      audio,
      filePath,
    });
  } catch (error) {
    console.error('[deployment_model_config] failed to read available models file', {
      filePath,
      message: error?.message || error,
    });
    return null;
  }
}

export function filterModelsForDeploymentAvailability(models = [], availableModelConfig = readDeploymentAvailableModels()) {
  if (!availableModelConfig || !Array.isArray(availableModelConfig.models)) {
    return filterWan27WithoutConfiguredProvider(models);
  }

  const runtimeAvailability = mergeRuntimeInferenceDeploymentAvailability(availableModelConfig);
  if (runtimeAvailability.models.length === 0) {
    return filterWan27WithoutConfiguredProvider(models);
  }
  const available = new Set(runtimeAvailability.models.map(normalizeDeploymentModel));
  return filterWan27WithoutConfiguredProvider(
    models.filter((model) => available.has(normalizeDeploymentModel(model?.value || model?.key))),
  );
}
