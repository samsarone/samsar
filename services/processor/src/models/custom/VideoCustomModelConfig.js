export const CUSTOM_MODEL_OPERATION_KEYS = Object.freeze([
  'text_to_video',
  'image_to_video',
  'text_to_image',
  'text_to_speech',
  'text_to_music',
  'text_to_sound_effect',
]);

export const CUSTOM_MODEL_KEYS = Object.freeze({
  TEXT_TO_IMAGE: 'CUSTOM_TEXT_TO_IMAGE',
  IMAGE_TO_VIDEO: 'CUSTOM_IMAGE_TO_VIDEO',
  TEXT_TO_SPEECH: 'CUSTOM_TEXT_TO_SPEECH',
  TEXT_TO_MUSIC: 'CUSTOM_TEXT_TO_MUSIC',
  TEXT_TO_SOUND_EFFECT: 'CUSTOM_TEXT_TO_SOUND_EFFECT',
});

export const CUSTOM_OPERATION_STAGE_KEYS = Object.freeze({
  text_to_image: 'image_generation',
  image_to_video: 'ai_video_generation',
  text_to_speech: 'speech_generation',
  text_to_music: 'music_generation',
  text_to_sound_effect: 'sound_effect_generation',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getOperationEndpoint(value) {
  if (typeof value === 'string') {
    return normalizeString(value);
  }
  if (!isPlainObject(value)) {
    return '';
  }
  return (
    normalizeString(value.endpoint) ||
    normalizeString(value.path) ||
    normalizeString(value.route) ||
    normalizeString(value.url) ||
    normalizeString(value.function)
  );
}

function normalizeCustomEndpointSource(endpoint) {
  if (!isPlainObject(endpoint)) {
    return null;
  }
  const operation = normalizeString(endpoint.operation);
  if (!CUSTOM_MODEL_OPERATION_KEYS.includes(operation)) {
    return null;
  }
  const modelEndpoint = getOperationEndpoint(endpoint);
  const baseUrl = normalizeString(endpoint.base_url ?? endpoint.baseUrl);
  if (!baseUrl || !modelEndpoint) {
    return null;
  }
  return {
    base_url: baseUrl,
    ...(normalizeString(endpoint.api_key ?? endpoint.apiKey)
      ? { api_key: normalizeString(endpoint.api_key ?? endpoint.apiKey) }
      : {}),
    ...(normalizeString(endpoint.id) ? { custom_endpoint_id: normalizeString(endpoint.id) } : {}),
    ...(normalizeString(endpoint.name) ? { custom_endpoint_name: normalizeString(endpoint.name) } : {}),
    ...(normalizeString(endpoint.provider) ? { custom_endpoint_provider: normalizeString(endpoint.provider) } : {}),
    [operation]: modelEndpoint,
  };
}

function getModelConfigSources(payload = {}) {
  const directCustomAdapters = payload.custom_adapters ?? payload.customAdapters;
  const directCustomEndpoint = payload.custom_endpoint ?? payload.customEndpoint;
  const config =
    payload.configuration ??
    payload.config ??
    payload.model_config ??
    payload.modelConfig ??
    payload.custom_model_config ??
    payload.customModelConfig ??
    payload.custom_models ??
    payload.customModels;

  const sources = [];
  if (isPlainObject(config)) {
    sources.push(config);
    if (isPlainObject(config.custom_adapters)) {
      sources.push(config.custom_adapters);
    }
    if (isPlainObject(config.customAdapters)) {
      sources.push(config.customAdapters);
    }
    if (isPlainObject(config.models)) {
      sources.push(config.models);
    }
    if (isPlainObject(config.operations)) {
      sources.push(config.operations);
    }
    const configEndpoint = normalizeCustomEndpointSource(config.custom_endpoint ?? config.customEndpoint);
    if (configEndpoint) {
      sources.push(configEndpoint);
    }
  } else if (config !== undefined && config !== null) {
    const error = new Error('configuration must be an object when provided.');
    error.status = 400;
    throw error;
  }

  if (isPlainObject(directCustomAdapters)) {
    sources.push(directCustomAdapters);
  } else if (directCustomAdapters !== undefined && directCustomAdapters !== null) {
    const error = new Error('custom_adapters must be an object when provided.');
    error.status = 400;
    throw error;
  }

  const selectedCustomEndpoint = normalizeCustomEndpointSource(directCustomEndpoint);
  if (selectedCustomEndpoint) {
    sources.push(selectedCustomEndpoint);
  } else if (directCustomEndpoint !== undefined && directCustomEndpoint !== null) {
    const error = new Error('custom_endpoint must be an object with operation, base_url, and endpoint when provided.');
    error.status = 400;
    throw error;
  }

  return sources;
}

export function normalizeCustomModelAdaptersPayload(payload = {}) {
  const sources = getModelConfigSources(payload);
  if (sources.length === 0) {
    return null;
  }

  const normalized = {};
  for (const source of sources) {
    const baseUrl = normalizeString(source.base_url ?? source.baseUrl);
    const apiKey = normalizeString(source.api_key ?? source.apiKey);
    const customEndpointId = normalizeString(source.custom_endpoint_id);
    if (baseUrl) {
      normalized.base_url = baseUrl;
    }
    if (apiKey && !customEndpointId) {
      normalized.api_key = apiKey;
    }
    for (const metadataKey of [
      'custom_endpoint_id',
      'custom_endpoint_name',
      'custom_endpoint_provider',
    ]) {
      const metadataValue = normalizeString(source[metadataKey]);
      if (metadataValue) {
        normalized[metadataKey] = metadataValue;
      }
    }

    for (const key of CUSTOM_MODEL_OPERATION_KEYS) {
      const endpoint = getOperationEndpoint(source[key]);
      if (endpoint) {
        normalized[key] = endpoint;
      }
    }
  }

  if (Object.keys(normalized).length === 0) {
    return null;
  }
  if (normalized.text_to_video && !normalized.image_to_video) {
    normalized.image_to_video = normalized.text_to_video;
  }
  if (!normalized.base_url) {
    const error = new Error('custom model configuration requires base_url.');
    error.status = 400;
    throw error;
  }

  return normalized;
}

export function hasCustomOperation(customAdapters, operationKey) {
  return Boolean(
    isPlainObject(customAdapters) &&
    normalizeString(customAdapters.base_url) &&
    normalizeString(customAdapters[operationKey])
  );
}

export function buildCustomAdapterFallbacks({
  imageModel,
  videoModel,
  ttsProvider,
  musicProvider,
  soundEffectModel,
} = {}) {
  const fallbacks = {};
  if (normalizeString(imageModel)) {
    fallbacks.text_to_image = normalizeString(imageModel);
  }
  if (normalizeString(videoModel)) {
    fallbacks.image_to_video = normalizeString(videoModel);
  }
  if (normalizeString(ttsProvider)) {
    fallbacks.text_to_speech = normalizeString(ttsProvider);
  }
  if (normalizeString(musicProvider)) {
    fallbacks.text_to_music = normalizeString(musicProvider);
  }
  if (normalizeString(soundEffectModel)) {
    fallbacks.text_to_sound_effect = normalizeString(soundEffectModel);
  }
  return fallbacks;
}

export function buildCustomAdapterOperationUsage(customAdapters = {}) {
  const usage = {};
  for (const operationKey of CUSTOM_MODEL_OPERATION_KEYS) {
    if (!hasCustomOperation(customAdapters, operationKey)) {
      continue;
    }
    const stageKey = CUSTOM_OPERATION_STAGE_KEYS[operationKey];
    if (stageKey) {
      usage[stageKey] = {
        operationKey,
        status: 'CUSTOM_PENDING',
      };
    }
  }
  return usage;
}

export function applyCustomModelOverrides({
  payload = {},
  customAdapters = null,
  defaultImageModel,
  defaultVideoModel,
} = {}) {
  const imageModel = normalizeString(payload.image_model ?? payload.imageModel ?? defaultImageModel);
  const videoModel = normalizeString(payload.video_model ?? payload.videoModel ?? defaultVideoModel);
  const nextPayload = { ...payload };
  const fallbackModels = buildCustomAdapterFallbacks({
    imageModel,
    videoModel,
  });

  if (hasCustomOperation(customAdapters, 'text_to_image')) {
    nextPayload.image_model = CUSTOM_MODEL_KEYS.TEXT_TO_IMAGE;
    nextPayload.imageModel = CUSTOM_MODEL_KEYS.TEXT_TO_IMAGE;
  }

  if (hasCustomOperation(customAdapters, 'image_to_video')) {
    nextPayload.video_model = CUSTOM_MODEL_KEYS.IMAGE_TO_VIDEO;
    nextPayload.videoModel = CUSTOM_MODEL_KEYS.IMAGE_TO_VIDEO;
  }

  return {
    payload: nextPayload,
    fallbackModels,
    operationUsage: buildCustomAdapterOperationUsage(customAdapters),
  };
}
