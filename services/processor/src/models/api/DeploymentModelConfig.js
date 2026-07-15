import fs from 'fs';
import path from 'path';

function getDefaultAvailableModelsPath() {
  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
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
  const currentEnv = typeof process.env.CURRENT_ENV === 'string'
    ? process.env.CURRENT_ENV.trim().toLowerCase()
    : '';
  return currentEnv === 'docker' || currentEnv === 'staging';
}

function normalizeDeploymentProvider(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';

  if (['alibaba', 'alibabacloud', 'dashscope', 'qwen'].includes(normalized)) {
    return 'alibabaCloud';
  }

  return normalized;
}

function findModelProvider(modelProviders = {}, modelKey = '') {
  const normalizedModelKey = String(modelKey).trim().toUpperCase();
  const entry = Object.entries(modelProviders).find(
    ([key]) => String(key).trim().toUpperCase() === normalizedModelKey,
  );
  return entry?.[1] || '';
}

function isSavedQwenSelectionAuthorized({ providers, models, modelProviders }) {
  if (!isDockerDeploymentRuntime()) {
    return false;
  }

  const hasQwenModel = models.some((model) => model.toUpperCase() === 'QWEN3.7');
  const hasAlibabaProvider = providers.some(
    (provider) => normalizeDeploymentProvider(provider) === 'alibabaCloud',
  );
  const selectedProvider = normalizeDeploymentProvider(
    findModelProvider(modelProviders, 'QWEN3.7'),
  );

  return hasQwenModel && hasAlibabaProvider && selectedProvider === 'alibabaCloud';
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

export function mergeRuntimeInferenceDeploymentAvailability(value = {}) {
  const configuredProviders = normalizeStringList(value?.providers);
  const configuredModels = normalizeStringList(value?.models);
  const modelProviders = normalizeStringMap(value?.modelProviders);
  const modelProviderPriority = normalizeStringListMap(value?.modelProviderPriority);
  const qwenAuthorized = isSavedQwenSelectionAuthorized({
    providers: configuredProviders,
    models: configuredModels,
    modelProviders,
  });
  const merged = {
    providers: configuredProviders,
    models: configuredModels.filter(
      (model) => model.toUpperCase() !== 'QWEN3.7' || qwenAuthorized,
    ),
    actions: normalizeStringList(value?.actions),
    modelProviders,
    modelProviderPriority,
    audio: value?.audio || null,
  };

  if (hasEnvCredential('ALIBABA_API_KEY', 'DASHSCOPE_API_KEY', 'ALIBABA_CLOUD_API_KEY', 'QWEN_API_KEY')) {
    appendUnique(merged.providers, ['alibabaCloud']);
    appendUnique(merged.models, ['HAPPYHORSEI2V', 'WAN2.7PRO']);
    appendUnique(merged.actions, ['image', 'video']);
  }

  if (hasEnvCredential('FAL_API_KEY')) {
    appendUnique(merged.providers, ['fal']);
    appendUnique(merged.models, ['WAN2.7PRO', 'HAPPYHORSEI2V']);
    appendUnique(merged.actions, ['image', 'video']);
  }

  if (hasEnvCredential('SAMSAR_API_KEY')) {
    appendUnique(merged.providers, ['samsar']);
    appendUnique(merged.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'HAPPYHORSEI2V', 'WAN2.7PRO']);
    appendUnique(merged.actions, ['chat', 'assistant', 'image', 'video']);
  }

  return merged;
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
    const audio = normalizeDeploymentAudioAvailability(parsed?.audio);

    return {
      providers,
      models,
      actions,
      modelProviders,
      modelProviderPriority,
      audio,
      filePath,
    };
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
  const available = new Set(runtimeAvailability.models.map((model) => model.toUpperCase()));
  return filterWan27WithoutConfiguredProvider(
    models.filter((model) => available.has(String(model?.value || model?.key || '').toUpperCase())),
  );
}
