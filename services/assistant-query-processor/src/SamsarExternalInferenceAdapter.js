import SamsarClient from 'samsar-js';
import OpenAI from 'openai';

import {
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  isGeminiInferenceModel,
  isKimiK3InferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';
import { hasAlibabaQwenNativeCredential, hasQwenVisionInput } from './Qwen.js';
import { hasKimiK3NativeCredential } from './KimiK3.js';
import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import { resolveProviderMediaPayload } from './ProviderMediaPayload.js';
import { isStandaloneEdition } from './DeploymentEnvironment.js';
import {
  applyModelAdapterPreferenceOrder,
  normalizeModelAdapterModelKey,
  readModelAdapterPreferences,
} from './ModelAdapterPreferences.js';

const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS = 20 * 60 * 1000;
const OPENROUTER_QWEN_MAX_TOKEN_CEILING = 24000;
const DEFAULT_OPENROUTER_QWEN_MAX_TOKENS = 16384;
const DEFAULT_OPENROUTER_GEMINI_MAX_TOKENS = 65536;
const DEFAULT_OPENROUTER_GPT_MAX_COMPLETION_TOKENS = 65536;
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const GOOGLE_NATIVE_CREDENTIAL_KEYS = Object.freeze([
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);
const GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS = Object.freeze([
  'K_SERVICE',
  'GAE_SERVICE',
  'FUNCTION_TARGET',
  'GCE_METADATA_HOST',
]);
export const DOCKER_INFERENCE_PROVIDER = Object.freeze({
  ALIBABA_CLOUD: 'alibabaCloud',
  GOOGLE_CLOUD: 'googleCloud',
  KIMI: 'kimi',
  OPENAI: 'openai',
  OPENROUTER: 'openrouter',
  SAMSAR: 'samsar',
});
export const DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  'QWEN3.7': Object.freeze([
    DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  ]),
  'gemini-3.1-pro': Object.freeze([
    DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  ]),
  'kimi-k3': Object.freeze([
    DOCKER_INFERENCE_PROVIDER.KIMI,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  ]),
  'gpt-5.6-sol': Object.freeze([
    DOCKER_INFERENCE_PROVIDER.OPENAI,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  ]),
});

let cachedClient = null;
let cachedClientKey = '';
let cachedBaseUrl = '';
let cachedOpenRouterClient = null;
let cachedOpenRouterClientKey = '';
let cachedOpenRouterBaseUrl = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isOpenRouterStructuredOutputRequest(request = {}) {
  const responseFormatType = normalizeString(request?.response_format?.type).toLowerCase();
  return responseFormatType === 'json_schema' || responseFormatType === 'json_object';
}

function addOpenRouterResponseHealingPlugin(plugins) {
  const normalizedPlugins = Array.isArray(plugins) ? [...plugins] : [];
  if (!normalizedPlugins.some((plugin) => normalizeString(plugin?.id).toLowerCase() === 'response-healing')) {
    normalizedPlugins.push({ id: 'response-healing' });
  }
  return normalizedPlugins;
}

function getOpenRouterCompletionLimit(requestedModel, request = {}) {
  const configuredLimit = isQwenInferenceModel(requestedModel)
    ? Math.min(
      normalizePositiveInteger(process.env.OPENROUTER_QWEN_MAX_TOKENS, OPENROUTER_QWEN_MAX_TOKEN_CEILING),
      OPENROUTER_QWEN_MAX_TOKEN_CEILING,
    )
    : isGeminiInferenceModel(requestedModel)
      ? normalizePositiveInteger(process.env.OPENROUTER_GEMINI_MAX_TOKENS, DEFAULT_OPENROUTER_GEMINI_MAX_TOKENS)
      : normalizePositiveInteger(
        process.env.OPENROUTER_GPT_MAX_COMPLETION_TOKENS,
        DEFAULT_OPENROUTER_GPT_MAX_COMPLETION_TOKENS,
      );
  const requestedLimit = normalizePositiveInteger(
    request.max_completion_tokens ?? request.max_tokens,
    isQwenInferenceModel(requestedModel)
      ? DEFAULT_OPENROUTER_QWEN_MAX_TOKENS
      : configuredLimit,
  );
  return Math.min(requestedLimit, configuredLimit);
}

function getOpenRouterReasoningEffort(requestedModel, effort, request = {}) {
  if ((isQwenInferenceModel(requestedModel) || isGeminiInferenceModel(requestedModel)) &&
      isOpenRouterStructuredOutputRequest(request)) return 'high';
  const configuredEffort = normalizeString(
    isQwenInferenceModel(requestedModel)
      ? process.env.OPENROUTER_QWEN_REASONING_EFFORT
      : isGeminiInferenceModel(requestedModel)
        ? process.env.OPENROUTER_GEMINI_REASONING_EFFORT
        : process.env.OPENROUTER_GPT_REASONING_EFFORT,
  ).toLowerCase();
  if (['low', 'medium', 'high'].includes(configuredEffort)) return configuredEffort;
  if (!isQwenInferenceModel(requestedModel) && !isGeminiInferenceModel(requestedModel) &&
      ['xhigh', 'max'].includes(configuredEffort)) return configuredEffort;
  const normalizedEffort = normalizeString(effort).toLowerCase();
  if ((isQwenInferenceModel(requestedModel) || isGeminiInferenceModel(requestedModel)) &&
      ['xhigh', 'max'].includes(normalizedEffort)) return 'high';
  return ['low', 'medium', 'high', 'xhigh', 'max'].includes(normalizedEffort)
    ? normalizedEffort
    : 'high';
}

function buildOpenRouterRequestPayload(request, requestedModel, openRouterModel, effort) {
  const payload = { ...request, model: openRouterModel };
  const effectiveEffort = getOpenRouterReasoningEffort(requestedModel, effort, request);
  const completionLimit = getOpenRouterCompletionLimit(requestedModel, request);
  if (isQwenInferenceModel(requestedModel) || isGeminiInferenceModel(requestedModel)) {
    delete payload.max_completion_tokens;
    payload.max_tokens = completionLimit;
  } else {
    delete payload.max_tokens;
    payload.max_completion_tokens = completionLimit;
  }
  if (isOpenRouterStructuredOutputRequest(request)) {
    const provider = payload.provider && typeof payload.provider === 'object' && !Array.isArray(payload.provider)
      ? payload.provider
      : {};
    payload.provider = { ...provider, require_parameters: true };
    payload.plugins = addOpenRouterResponseHealingPlugin(payload.plugins);
  }
  if (effectiveEffort) payload.reasoning = { effort: effectiveEffort };
  return payload;
}

function normalizeBaseUrl(value) {
  const normalized = normalizeString(value || DEFAULT_SAMSAR_API_BASE_URL).replace(/\/+$/, '');
  return normalized || DEFAULT_SAMSAR_API_BASE_URL;
}

function normalizeAuthorization(value) {
  return normalizeString(value).toLowerCase().replace(/[_\s]+/g, '-');
}

function isDeployedAuthorization(value) {
  return ['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(normalizeAuthorization(value));
}

function isOpenRouterAuthorization(value) {
  return normalizeAuthorization(value) === 'openrouter';
}

function isTruthyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isFalseyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off';
}

function hasEnvCredential(...keys) {
  return keys.some((key) => Boolean(normalizeString(process.env[key])));
}

function hasOpenAINativeCredential() {
  return hasEnvCredential('OPENAI_API_KEY');
}

export function hasOpenRouterCredential(env = process.env) {
  return Boolean(normalizeString(env?.OPENROUTER_API_KEY));
}

function hasGoogleNativeCredential() {
  if (hasEnvCredential(...GOOGLE_NATIVE_CREDENTIAL_KEYS)) {
    return true;
  }

  const hasProject = hasEnvCredential(
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_PROJECT_ID',
    'GCP_PROJECT',
    'GCLOUD_PROJECT',
    'PROJECT_ID',
  );

  return hasProject && hasEnvCredential(...GOOGLE_ATTACHED_SERVICE_ACCOUNT_KEYS);
}

function shouldEnableExternalInference() {
  if (isFalseyEnv(process.env.SAMSAR_EXTERNAL_INFERENCE_ENABLED)) {
    return false;
  }
  if (isTruthyEnv(process.env.SAMSAR_EXTERNAL_INFERENCE_ENABLED)) {
    return true;
  }
  if (isTruthyEnv(process.env.SAMSAR_FORCE_EXTERNAL_INFERENCE)) {
    return true;
  }
  return isStandaloneEdition();
}

function getExternalClient() {
  const apiKey = normalizeString(process.env.SAMSAR_API_KEY);
  if (!apiKey) {
    return null;
  }

  const baseUrl = normalizeBaseUrl(process.env.SAMSAR_JS_API_URL || process.env.SAMSAR_API_URL);
  if (!cachedClient || cachedClientKey !== apiKey || cachedBaseUrl !== baseUrl) {
    cachedClient = new SamsarClient({
      apiKey,
      baseUrl,
      timeoutMs: Number(process.env.SAMSAR_EXTERNAL_INFERENCE_TIMEOUT_MS) || DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS,
    });
    cachedClientKey = apiKey;
    cachedBaseUrl = baseUrl;
  }

  return cachedClient;
}

function getOpenRouterClient() {
  const apiKey = normalizeString(process.env.OPENROUTER_API_KEY);
  if (!apiKey) return null;
  const baseURL = normalizeBaseUrl(
    process.env.OPENROUTER_BASE_URL || process.env.OPENROUTER_API_BASE_URL || DEFAULT_OPENROUTER_BASE_URL,
  );
  if (!cachedOpenRouterClient || cachedOpenRouterClientKey !== apiKey || cachedOpenRouterBaseUrl !== baseURL) {
    const defaultHeaders = {};
    const appUrl = normalizeString(process.env.OPENROUTER_APP_URL || process.env.SAMSAR_APP_URL);
    const appName = normalizeString(process.env.OPENROUTER_APP_NAME) || 'Samsar';
    if (appUrl) defaultHeaders['HTTP-Referer'] = appUrl;
    if (appName) defaultHeaders['X-Title'] = appName;
    cachedOpenRouterClient = new OpenAI({ apiKey, baseURL, defaultHeaders });
    cachedOpenRouterClientKey = apiKey;
    cachedOpenRouterBaseUrl = baseURL;
  }
  return cachedOpenRouterClient;
}

function hasConfiguredInferenceProvider(provider) {
  if (provider === DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD) {
    return hasAlibabaQwenNativeCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD) {
    return hasGoogleNativeCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.KIMI) {
    return hasKimiK3NativeCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENAI) {
    return hasOpenAINativeCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) {
    return hasOpenRouterCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.SAMSAR) {
    return Boolean(getExternalClient());
  }
  return false;
}

function getInferenceProviderPriority(model) {
  let defaultPriority;
  let preferenceModelKey;
  if (isQwenInferenceModel(model)) {
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['QWEN3.7'];
    preferenceModelKey = 'QWEN3.7';
  } else if (isGeminiInferenceModel(model)) {
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['gemini-3.1-pro'];
    preferenceModelKey = 'gemini-3.1-pro';
  } else if (isKimiK3InferenceModel(model)) {
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['kimi-k3'];
    preferenceModelKey = 'kimi-k3';
  } else {
    preferenceModelKey = normalizeInferenceModel(model);
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL[preferenceModelKey] ||
      DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['gpt-5.6-sol'];
  }

  const savedPriority = readModelAdapterPreferences().modelProviderPriority[
    normalizeModelAdapterModelKey(preferenceModelKey)
  ];
  return applyModelAdapterPreferenceOrder(defaultPriority, savedPriority);
}

function isStandaloneInferenceEdition() {
  return isStandaloneEdition();
}

function isQwenOpenRouterOnly(model) {
  return isQwenInferenceModel(model) && (
    isTruthyEnv(process.env.SAMSAR_QWEN_OPENROUTER_ONLY) ||
    !isStandaloneInferenceEdition()
  );
}

function getRuntimeInferenceProviderPriority(model) {
  return isQwenOpenRouterOnly(model)
    ? [DOCKER_INFERENCE_PROVIDER.OPENROUTER]
    : getInferenceProviderPriority(model);
}

export function resolveConfiguredInferenceProvider(model) {
  for (const provider of getRuntimeInferenceProviderPriority(model)) {
    if (hasConfiguredInferenceProvider(provider)) {
      return provider;
    }
  }
  return '';
}

export function getConfiguredInferenceProviders(model) {
  return getRuntimeInferenceProviderPriority(model)
    .filter(hasConfiguredInferenceProvider);
}

function getRequestedInferenceModel(chatRequest = {}) {
  return normalizeRequestedInferenceModel(
    chatRequest.model ||
    chatRequest.provider_options?.model ||
    chatRequest.providerOptions?.model ||
    chatRequest.inference_model ||
    chatRequest.inferenceModel,
  );
}

export function getOpenRouterModelForInferenceRequest(chatRequest = {}, env = process.env) {
  const model = getRequestedInferenceModel(chatRequest);
  if (isQwenInferenceModel(model)) {
    return hasQwenVisionInput(chatRequest.messages)
      ? normalizeString(env?.OPENROUTER_QWEN_37_PLUS_MODEL) || 'qwen/qwen3.7-plus'
      : normalizeString(env?.OPENROUTER_QWEN_37_MAX_MODEL) || 'qwen/qwen3.7-max';
  }
  if (isGeminiInferenceModel(model)) {
    return normalizeString(env?.OPENROUTER_GEMINI_31_PRO_MODEL) || 'google/gemini-3.1-pro-preview';
  }
  return normalizeString(env?.OPENROUTER_GPT_56_SOL_MODEL) || 'openai/gpt-5.6-sol';
}

export function shouldUseOpenRouterInference(chatRequest = {}) {
  if (!chatRequest || typeof chatRequest !== 'object') return false;
  const model = getRequestedInferenceModel(chatRequest);
  if (isKimiK3InferenceModel(model)) return false;
  if (isQwenOpenRouterOnly(model)) return true;
  if (isOpenRouterAuthorization(chatRequest.authorization)) return true;
  if (isDeployedAuthorization(chatRequest.authorization)) return false;
  return resolveConfiguredInferenceProvider(model) ===
    DOCKER_INFERENCE_PROVIDER.OPENROUTER;
}

export async function createOpenRouterChatCompletion(chatRequest = {}, dependencyOverrides = {}) {
  if (isKimiK3InferenceModel(getRequestedInferenceModel(chatRequest))) {
    throw new Error(
      'Kimi K3 inference supports only the native Kimi API or Samsar API fallback.',
    );
  }
  const client = dependencyOverrides.client || getOpenRouterClient();
  if (!client) throw new Error('OPENROUTER_API_KEY is required for OpenRouter inference.');
  const {
    authorization, bypassSamsarExternalInference, samsarExternalInference,
    timeout, timeoutMs, maxRetries, externalMaxRetries, reasoning_effort, reasoning, ...request
  } = chatRequest || {};
  const effort = reasoning?.effort || reasoning_effort || (
    getRequestedInferenceModel(chatRequest) === GPT_56_SOL_INFERENCE_MODEL
      ? GPT_56_SOL_REASONING_EFFORT
      : undefined
  );
  const requestedModel = getRequestedInferenceModel(chatRequest);
  const qwenRequest = isQwenInferenceModel(requestedModel);
  const configuredTimeout = Number(
    qwenRequest
      ? process.env.OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS
      : process.env.OPENROUTER_INFERENCE_TIMEOUT_MS,
  );
  const defaultTimeout = qwenRequest
    ? DEFAULT_OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS
    : DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS;
  const configuredMinimumTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.floor(configuredTimeout)
    : defaultTimeout;
  const minimumTimeout = qwenRequest
    ? Math.max(configuredMinimumTimeout, DEFAULT_OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS)
    : configuredMinimumTimeout;
  const requestedTimeout = Number(timeout ?? timeoutMs);
  const requestTimeout = Math.max(
    Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? Math.floor(requestedTimeout) : minimumTimeout,
    minimumTimeout,
  );
  const openRouterModel = getOpenRouterModelForInferenceRequest(chatRequest);
  const payload = buildOpenRouterRequestPayload(request, requestedModel, openRouterModel, effort);
  return runExternalInferenceWithRetry(
    async ({ signal }) => {
      const providerPayload = await resolveProviderMediaPayload(payload, {
        resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
        serviceName: 'samsar_assistant_query_processor_openrouter',
      });
      return client.chat.completions.create(providerPayload, {
        timeout: requestTimeout,
        // The adapter owns retries so every attempt gets fresh media URLs.
        maxRetries: 0,
        signal,
      });
    },
    {
      provider: 'openrouter',
      model: openRouterModel,
      timeoutMs: requestTimeout,
      maxRetries: externalMaxRetries ?? maxRetries ?? (
        qwenRequest ? process.env.OPENROUTER_QWEN_MAX_RETRIES : undefined
      ),
      ...(dependencyOverrides.retryOptions || {}),
    },
  );
}

function normalizeRequestedInferenceModel(value) {
  const requestedModel = normalizeString(value).toLowerCase();
  if (!requestedModel) {
    return normalizeInferenceModel();
  }

  if (isGeminiInferenceModel(requestedModel)) {
    const normalizedGeminiModel = normalizeInferenceModel(requestedModel);
    return isGeminiInferenceModel(normalizedGeminiModel)
      ? normalizedGeminiModel
      : requestedModel;
  }

  const normalizedModel = normalizeInferenceModel(requestedModel);
  const defaultModel = normalizeInferenceModel();
  return normalizedModel !== defaultModel ||
    requestedModel === defaultModel ||
    requestedModel.startsWith(`${defaultModel}-`)
    ? normalizedModel
    : requestedModel;
}

function isOpenAICompatibleChatCompletion(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray(value.choices)
  );
}

export function unwrapSamsarExternalChatCompletionResponse(response) {
  if (isOpenAICompatibleChatCompletion(response)) {
    return response;
  }

  if (isOpenAICompatibleChatCompletion(response?.data)) {
    return response.data;
  }

  if (isOpenAICompatibleChatCompletion(response?.response)) {
    return response.response;
  }

  return response?.data ?? response;
}

export function shouldUseSamsarExternalInference(chatRequest = {}) {
  if (!chatRequest || typeof chatRequest !== 'object') {
    return false;
  }
  const inferenceModel = getRequestedInferenceModel(chatRequest);
  const kimiRequest = isKimiK3InferenceModel(inferenceModel);
  if (isQwenOpenRouterOnly(inferenceModel)) return true;
  if (chatRequest.bypassSamsarExternalInference || chatRequest.samsarExternalInference === false) {
    return false;
  }
  if (isOpenRouterAuthorization(chatRequest.authorization)) {
    return kimiRequest ? Boolean(getExternalClient()) : true;
  }
  if (chatRequest.samsarExternalInference === true || isDeployedAuthorization(chatRequest.authorization)) {
    return (kimiRequest || shouldEnableExternalInference()) && Boolean(getExternalClient());
  }
  const provider = resolveConfiguredInferenceProvider(inferenceModel);
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) return true;
  return (kimiRequest || shouldEnableExternalInference()) &&
    provider === DOCKER_INFERENCE_PROVIDER.SAMSAR;
}

export async function createSamsarExternalChatCompletion(chatRequest = {}, dependencyOverrides = {}) {
  if (shouldUseOpenRouterInference(chatRequest)) {
    return createOpenRouterChatCompletion(chatRequest, dependencyOverrides);
  }
  const client = dependencyOverrides.client || getExternalClient();
  if (!client) {
    throw new Error('SAMSAR_API_KEY is required for Samsar external inference.');
  }

  const {
    authorization,
    bypassSamsarExternalInference,
    samsarExternalInference,
    timeout,
    timeoutMs,
    maxRetries,
    externalMaxRetries,
    ...payload
  } = chatRequest || {};

  const model = getRequestedInferenceModel(payload);
  const requestTimeout = Number(
    timeout ?? timeoutMs ?? process.env.SAMSAR_EXTERNAL_INFERENCE_TIMEOUT_MS
  ) || DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS;
  const requestPayload = {
    ...payload,
    model,
    ...(model === GPT_56_SOL_INFERENCE_MODEL || isKimiK3InferenceModel(model)
      ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
      : {}),
    timeout: requestTimeout,
  };
  const response = await runExternalInferenceWithRetry(
    async ({ signal }) => client.createV2ExternalChatCompletion(
      await resolveProviderMediaPayload(requestPayload, {
        resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
        serviceName: 'samsar_assistant_query_processor_external_inference',
      }),
      { signal },
    ),
    {
      provider: 'samsar',
      model,
      timeoutMs: requestTimeout,
      maxRetries: externalMaxRetries ?? maxRetries,
      ...(dependencyOverrides.retryOptions || {}),
    },
  );

  return unwrapSamsarExternalChatCompletionResponse(response);
}
