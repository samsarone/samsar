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

function hasEnvCredential(...keys) {
  return keys.some((key) => typeof process.env[key] === 'string' && process.env[key].trim());
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
  const merged = {
    providers: normalizeStringList(value?.providers),
    models: normalizeStringList(value?.models),
    actions: normalizeStringList(value?.actions),
    audio: value?.audio || null,
  };

  if (hasEnvCredential('ALIBABA_API_KEY', 'DASHSCOPE_API_KEY', 'ALIBABA_CLOUD_API_KEY', 'QWEN_API_KEY')) {
    appendUnique(merged.providers, ['alibabaCloud']);
    appendUnique(merged.models, ['QWEN3.7']);
    appendUnique(merged.actions, ['chat', 'assistant']);
  }

  if (hasEnvCredential('SAMSAR_API_KEY')) {
    appendUnique(merged.providers, ['samsar']);
    appendUnique(merged.models, ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7']);
    appendUnique(merged.actions, ['chat', 'assistant']);
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
    const audio = normalizeDeploymentAudioAvailability(parsed?.audio);

    return { providers, models, actions, audio, filePath };
  } catch (error) {
    console.error('[deployment_model_config] failed to read available models file', {
      filePath,
      message: error?.message || error,
    });
    return null;
  }
}

export function filterModelsForDeploymentAvailability(models = [], availableModelConfig = readDeploymentAvailableModels()) {
  if (!availableModelConfig || !Array.isArray(availableModelConfig.models) || availableModelConfig.models.length === 0) {
    return models;
  }

  const available = new Set(availableModelConfig.models.map((model) => model.toUpperCase()));
  return models.filter((model) => available.has(String(model?.value || model?.key || '').toUpperCase()));
}
