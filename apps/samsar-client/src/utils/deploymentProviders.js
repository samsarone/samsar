import axios from "axios";

const PROVIDER_LABELS = {
  samsar: "Samsar API Key",
  openai: "OpenAI",
  googleCloud: "Google Cloud",
  fal: "FAL",
  runway: "RunwayML",
};

const DEPLOYMENT_INFERENCE_MODEL_VALUES = Object.freeze([
  "gpt-5.5",
  "gemini-3.1-pro",
]);

const DEPLOYMENT_INFERENCE_MODELS_BY_PROVIDER = Object.freeze({
  openai: ["gpt-5.5"],
  googleCloud: ["gemini-3.1-pro"],
  samsar: DEPLOYMENT_INFERENCE_MODEL_VALUES,
});

export function normalizeDeploymentProviderKey(value) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  const compact = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "google" || compact === "googlecloud" || compact === "gcp") {
    return "googleCloud";
  }
  if (compact === "runway" || compact === "runwayml") {
    return "runway";
  }
  if (compact === "openai") {
    return "openai";
  }
  if (compact === "fal") {
    return "fal";
  }
  if (compact === "samsar" || compact === "samsarapikey" || compact === "samsarapi") {
    return "samsar";
  }

  return trimmed;
}

export function formatDeploymentProviderLabel(value) {
  const key = normalizeDeploymentProviderKey(value);
  if (PROVIDER_LABELS[key]) {
    return PROVIDER_LABELS[key];
  }

  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Unknown provider";
}

export function extractDeploymentProviders(payload = {}) {
  const candidates = [
    payload?.deployment?.providers,
    payload?.available?.providers,
    payload?.availableProviders,
    payload?.available_providers,
    payload?.providers,
  ];
  const providers = candidates.find((candidate) => Array.isArray(candidate)) || [];
  const seen = new Set();

  return providers
    .filter((provider) => typeof provider === "string" && provider.trim())
    .filter((provider) => {
      const key = normalizeDeploymentProviderKey(provider);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeDeploymentInferenceModelValue(value) {
  if (typeof value !== "string") return "";

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "gemini-3.1-pro" ||
    normalized === "gemini-3.1-pro-preview" ||
    normalized === "gemini-3-pro" ||
    normalized === "gemini-3-pro-preview" ||
    normalized === "gemini 3.1 pro" ||
    normalized === "gemini 3.1 pro preview" ||
    normalized === "gemini 3 pro" ||
    normalized === "gemini 3 pro preview" ||
    normalized === "gemini31pro" ||
    normalized === "gemini31propreview" ||
    normalized === "gemini3pro" ||
    normalized === "gemini3propreview"
  ) {
    return "gemini-3.1-pro";
  }
  if (
    normalized === "gpt-5.5" ||
    normalized.startsWith("gpt-5.5-") ||
    normalized === "gpt 5.5" ||
    normalized === "gpt55"
  ) {
    return "gpt-5.5";
  }
  return "";
}

export function extractDeploymentInferenceModelValues(payload = {}) {
  const candidates = [
    payload?.deployment?.models,
    payload?.available?.models,
    payload?.availableModels,
    payload?.available_models,
    payload?.models,
  ];
  const modelList = candidates.find((candidate) => Array.isArray(candidate));
  const seen = new Set();
  const modelValues = (modelList || [])
    .map(normalizeDeploymentInferenceModelValue)
    .filter((modelValue) => {
      if (!modelValue || seen.has(modelValue)) return false;
      seen.add(modelValue);
      return true;
    });

  if (modelValues.length > 0) {
    return modelValues;
  }

  const providerModels = extractDeploymentProviders(payload).flatMap((provider) => {
    const providerKey = normalizeDeploymentProviderKey(provider);
    return DEPLOYMENT_INFERENCE_MODELS_BY_PROVIDER[providerKey] || [];
  });
  const providerSeen = new Set();

  return providerModels.filter((modelValue) => {
    if (providerSeen.has(modelValue)) return false;
    providerSeen.add(modelValue);
    return true;
  });
}

export function filterOptionsForDeploymentInferenceModels(options = [], modelValues = []) {
  const allowedModels = new Set(modelValues.map(normalizeDeploymentInferenceModelValue).filter(Boolean));
  if (allowedModels.size === 0) {
    return [];
  }

  return options.filter((option) => allowedModels.has(normalizeDeploymentInferenceModelValue(option?.value)));
}

export function normalizeDeploymentModelValue(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function extractDeploymentModelValue(item) {
  if (typeof item === "string") {
    return normalizeDeploymentModelValue(item);
  }
  if (!item || typeof item !== "object") {
    return "";
  }
  return normalizeDeploymentModelValue(item.value || item.key || item.model || item.modelKey);
}

export function extractDeploymentModelValuesFromCandidates(candidates = []) {
  const seen = new Set();
  const values = [];

  candidates
    .filter((candidate) => Array.isArray(candidate))
    .flat()
    .forEach((item) => {
      const modelValue = extractDeploymentModelValue(item);
      if (!modelValue || seen.has(modelValue)) return;
      seen.add(modelValue);
      values.push(modelValue);
    });

  return values;
}

export function extractDeploymentModelAvailability(payload = {}) {
  const deploymentModelCandidates = [
    payload?.deployment?.models,
    payload?.available?.models,
    payload?.availableModels,
    payload?.available_models,
    payload?.models,
  ];
  const deploymentModelValues = extractDeploymentModelValuesFromCandidates(deploymentModelCandidates);
  const withDeploymentFallback = (...candidates) => {
    const values = extractDeploymentModelValuesFromCandidates(candidates);
    return values.length > 0 ? values : deploymentModelValues;
  };

  const textToVideoImageModelValues = withDeploymentFallback(
    payload?.text_to_video?.image_models,
    payload?.textToVideo?.imageModels,
    payload?.IMAGE_MODELS,
    payload?.image_models,
    payload?.imageModels
  );
  const textToVideoVideoModelValues = withDeploymentFallback(
    payload?.text_to_video?.video_models,
    payload?.textToVideo?.videoModels,
    payload?.VIDEO_MODELS,
    payload?.video_models,
    payload?.videoModels
  );
  const imageListToVideoImageModelValues = withDeploymentFallback(
    payload?.image_list_to_video?.image_models,
    payload?.imageListToVideo?.imageModels,
    payload?.IMAGE_MODELS,
    payload?.image_models,
    payload?.imageModels
  );
  const imageListToVideoVideoModelValues = withDeploymentFallback(
    payload?.image_list_to_video?.video_models,
    payload?.imageListToVideo?.videoModels,
    payload?.VIDEO_MODELS,
    payload?.video_models,
    payload?.videoModels
  );
  const imageEditModelValues = withDeploymentFallback(
    payload?.image_edit_models,
    payload?.imageEditModels,
    payload?.IMAGE_EDIT_MODELS
  );

  return {
    textToVideoImageModelValues,
    textToVideoVideoModelValues,
    imageListToVideoImageModelValues,
    imageListToVideoVideoModelValues,
    imageModelValues: extractDeploymentModelValuesFromCandidates([
      textToVideoImageModelValues,
      imageListToVideoImageModelValues,
    ]),
    imageEditModelValues,
    videoModelValues: extractDeploymentModelValuesFromCandidates([
      textToVideoVideoModelValues,
      imageListToVideoVideoModelValues,
    ]),
  };
}

export function filterOptionsForDeploymentModelValues(options = [], modelValues = [], getOptionValue = null) {
  const allowedModels = new Set(modelValues.map(normalizeDeploymentModelValue).filter(Boolean));
  if (allowedModels.size === 0) {
    return [];
  }

  return options.filter((option) => {
    const rawValue = getOptionValue
      ? getOptionValue(option)
      : option?.value ?? option?.key ?? option;
    return allowedModels.has(normalizeDeploymentModelValue(rawValue));
  });
}

export async function fetchDeploymentProviderConfig(processorServer, requestConfig) {
  const response = await axios.get(`${processorServer}/v1/video/supported_models`, requestConfig);
  return response.data || {};
}
