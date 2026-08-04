export const DEFAULT_INFERENCE_MODEL_VALUE = "gpt-5.6-sol";
export const QWEN_INFERENCE_MODEL_VALUE = "QWEN3.8";
export const KIMI_K3_INFERENCE_MODEL_VALUE = "kimi-k3";
export const HOSTED_QWEN_INFERENCE_MODEL_VALUE = QWEN_INFERENCE_MODEL_VALUE;
export const OPENROUTER_QWEN_INFERENCE_MODEL_LABEL =
  "Qwen 3.8 Max";
export const HOSTED_QWEN_INFERENCE_MODEL_LABEL =
  OPENROUTER_QWEN_INFERENCE_MODEL_LABEL;

const DEPLOYMENT_PROVIDER_LABELS = Object.freeze({
  samsar: "Samsar API Key",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  gmicloud: "GMICloud via GenBlaze",
  googleCloud: "Google Cloud",
  alibabaCloud: "Alibaba Cloud",
  kimi: "Kimi",
  fal: "FAL",
  runway: "RunwayML",
});

const DEPLOYMENT_INFERENCE_MODELS_BY_PROVIDER = Object.freeze({
  openai: ["gpt-5.6-sol"],
  googleCloud: ["gemini-3.1-pro"],
  kimi: [KIMI_K3_INFERENCE_MODEL_VALUE],
  openrouter: ["gpt-5.6-sol", "gemini-3.1-pro", QWEN_INFERENCE_MODEL_VALUE],
  gmicloud: [QWEN_INFERENCE_MODEL_VALUE],
  // Alibaba/Qwen requires explicit, validated model provenance below. A
  // provider name by itself is not enough to make Qwen selectable.
  alibabaCloud: [],
  samsar: [
    "gpt-5.6-sol",
    "gemini-3.1-pro",
    QWEN_INFERENCE_MODEL_VALUE,
    KIMI_K3_INFERENCE_MODEL_VALUE,
  ],
});

export function normalizeDeploymentProviderKey(value) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  const compact = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "google" || compact === "googlecloud" || compact === "gcp") {
    return "googleCloud";
  }
  if (
    compact === "alibaba" ||
    compact === "alibabacloud" ||
    compact === "aliyun" ||
    compact === "dashscope" ||
    compact === "qwen"
  ) {
    return "alibabaCloud";
  }
  if (compact === "runway" || compact === "runwayml") {
    return "runway";
  }
  if (compact === "openai") {
    return "openai";
  }
  if (compact === "openrouter" || compact === "openrouterai") {
    return "openrouter";
  }
  if (compact === "gmi" || compact === "gmicloud" || compact === "genblaze") {
    return "gmicloud";
  }
  if (
    compact === "kimi" ||
    compact === "kimiapi" ||
    compact === "moonshot" ||
    compact === "moonshotai"
  ) {
    return "kimi";
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
  if (DEPLOYMENT_PROVIDER_LABELS[key]) {
    return DEPLOYMENT_PROVIDER_LABELS[key];
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

export function hasSubtitleGenerationProvider(payload = {}) {
  const providers = new Set(
    extractDeploymentProviders(payload).map(normalizeDeploymentProviderKey),
  );
  return providers.has('openai') || providers.has('samsar');
}

export function normalizeDeploymentInferenceModelValue(value) {
  if (typeof value !== "string") return "";

  const normalized = value.trim().toLowerCase();
  if (
    normalized === KIMI_K3_INFERENCE_MODEL_VALUE ||
    normalized === "kimi k3" ||
    normalized === "kimik3" ||
    normalized === "moonshot k3" ||
    normalized === "moonshot kimi k3" ||
    normalized === "moonshotai kimi k3"
  ) {
    return KIMI_K3_INFERENCE_MODEL_VALUE;
  }
  if (
    normalized === "qwen3.8" ||
    normalized === "qwen3.8-max" ||
    normalized === "qwen/qwen3.8-max" ||
    normalized === "qwen-3.8" ||
    normalized === "qwen-3.8-max" ||
    normalized === "qwen 3.8" ||
    normalized === "qwen 3.8 max" ||
    normalized === "qwen38" ||
    normalized === "qwen38max" ||
    normalized === "alibaba qwen 3.8" ||
    normalized === "alibaba qwen 3.8 max" ||
    normalized === "alibaba cloud qwen 3.8" ||
    normalized === "alibaba cloud qwen 3.8 max"
  ) {
    return QWEN_INFERENCE_MODEL_VALUE;
  }
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
    normalized === DEFAULT_INFERENCE_MODEL_VALUE ||
    normalized.startsWith(`${DEFAULT_INFERENCE_MODEL_VALUE}-`) ||
    normalized === "gpt-5.6" ||
    normalized === "gpt 5.6 sol" ||
    normalized === "gpt56" ||
    normalized === "gpt56sol"
  ) {
    return DEFAULT_INFERENCE_MODEL_VALUE;
  }
  return "";
}

function extractExplicitDeploymentInferenceModelValues(payload = {}) {
  const candidates = [
    payload?.deployment?.models,
    payload?.available?.models,
    payload?.availableModels,
    payload?.available_models,
    payload?.models,
  ];
  const modelList = candidates.find((candidate) => Array.isArray(candidate)) || [];
  const seen = new Set();

  return modelList
    .map(normalizeDeploymentInferenceModelValue)
    .filter((modelValue) => {
      if (!modelValue || seen.has(modelValue)) return false;
      seen.add(modelValue);
      return true;
    });
}

function extractModelProviderMap(payload = {}) {
  const candidates = [
    payload?.deployment?.modelProviders,
    payload?.deployment?.model_providers,
    payload?.available?.modelProviders,
    payload?.available?.model_providers,
    payload?.modelProviders,
    payload?.model_providers,
  ];
  const modelProviders = candidates.find(
    (candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );

  return modelProviders || {};
}

function extractProviderMetadataMap(payload = {}, field) {
  const candidates = [
    payload?.deployment?.[field],
    payload?.available?.[field],
    payload?.[field],
  ];

  return candidates.find(
    (candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate),
  ) || {};
}

export function extractDeploymentProviderEndpointTypes(payload = {}) {
  return extractProviderMetadataMap(payload, "providerEndpointTypes");
}

export function extractDeploymentInferenceModelProviders(payload = {}) {
  const result = {};

  Object.entries(extractModelProviderMap(payload)).forEach(([modelValue, providerValue]) => {
    const normalizedModel = normalizeDeploymentInferenceModelValue(modelValue);
    const normalizedProvider = normalizeDeploymentProviderKey(providerValue);
    if (normalizedModel && normalizedProvider) {
      result[normalizedModel] = normalizedProvider;
    }
  });

  return result;
}

export function hasValidatedAlibabaQwenInference(payload = {}) {
  const explicitlyAvailableModels = extractExplicitDeploymentInferenceModelValues(payload);
  if (!explicitlyAvailableModels.includes(QWEN_INFERENCE_MODEL_VALUE)) {
    return false;
  }

  const availableProviders = new Set(
    extractDeploymentProviders(payload).map(normalizeDeploymentProviderKey),
  );
  const qwenProviders = new Set(["alibabaCloud", "samsar", "gmicloud", "openrouter"]);
  const selectedProvider = extractDeploymentInferenceModelProviders(payload)[QWEN_INFERENCE_MODEL_VALUE];
  if (!qwenProviders.has(selectedProvider) || !availableProviders.has(selectedProvider)) {
    return false;
  }
  return true;
}

export function extractDeploymentInferenceModelValues(payload = {}) {
  const allowQwen = hasValidatedAlibabaQwenInference(payload);
  const explicitModels = extractExplicitDeploymentInferenceModelValues(payload).filter(
    (modelValue) => modelValue !== QWEN_INFERENCE_MODEL_VALUE || allowQwen,
  );
  const providerModels = extractDeploymentProviders(payload).flatMap((provider) => {
    const providerKey = normalizeDeploymentProviderKey(provider);
    return DEPLOYMENT_INFERENCE_MODELS_BY_PROVIDER[providerKey] || [];
  });
  const seen = new Set();

  return [...explicitModels, ...providerModels].filter((modelValue) => {
    if (!modelValue || seen.has(modelValue)) return false;
    seen.add(modelValue);
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

export function labelOptionsForDeploymentInferenceProviders(options = []) {
  const qwenLabel = OPENROUTER_QWEN_INFERENCE_MODEL_LABEL;

  return options.map((option) => (
    normalizeDeploymentInferenceModelValue(option?.value) === QWEN_INFERENCE_MODEL_VALUE
      ? { ...option, label: qwenLabel, value: QWEN_INFERENCE_MODEL_VALUE }
      : option
  ));
}

export function filterHostedInferenceModelOptions(options = []) {
  return options.map((option) => (
    normalizeDeploymentInferenceModelValue(option?.value) === QWEN_INFERENCE_MODEL_VALUE
      ? {
          ...option,
          label: HOSTED_QWEN_INFERENCE_MODEL_LABEL,
          value: HOSTED_QWEN_INFERENCE_MODEL_VALUE,
        }
      : option
  ));
}

export function resolveAllowedInferenceModelOption(
  value,
  options = [],
  fallbackValue = DEFAULT_INFERENCE_MODEL_VALUE,
) {
  const modelOptions = Array.isArray(options) ? options : [];
  if (modelOptions.length === 0) return null;

  const normalizedValue = normalizeDeploymentInferenceModelValue(value);
  const normalizedFallback = normalizeDeploymentInferenceModelValue(fallbackValue);
  return (
    modelOptions.find(
      (option) => normalizeDeploymentInferenceModelValue(option?.value) === normalizedValue,
    ) ||
    modelOptions.find(
      (option) => normalizeDeploymentInferenceModelValue(option?.value) === normalizedFallback,
    ) ||
    modelOptions[0]
  );
}
