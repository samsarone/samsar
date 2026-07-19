import axios from "axios";

import {
  extractDeploymentInferenceModelProviders,
  extractDeploymentInferenceModelValues,
  extractDeploymentProviders,
  filterHostedInferenceModelOptions,
  filterOptionsForDeploymentInferenceModels,
  hasSubtitleGenerationProvider,
  hasValidatedAlibabaQwenInference,
  normalizeDeploymentInferenceModelValue,
  normalizeDeploymentProviderKey,
  resolveAllowedInferenceModelOption,
} from "./deploymentInferencePolicy.mjs";

export {
  extractDeploymentInferenceModelProviders,
  extractDeploymentInferenceModelValues,
  extractDeploymentProviders,
  filterHostedInferenceModelOptions,
  filterOptionsForDeploymentInferenceModels,
  hasSubtitleGenerationProvider,
  hasValidatedAlibabaQwenInference,
  normalizeDeploymentInferenceModelValue,
  normalizeDeploymentProviderKey,
  resolveAllowedInferenceModelOption,
};

const PROVIDER_LABELS = {
  samsar: "Samsar API Key",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  googleCloud: "Google Cloud",
  alibabaCloud: "Alibaba Cloud",
  fal: "FAL",
  runway: "RunwayML",
};

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
