import SamsarClient from 'samsar-js';
import OpenAI from 'openai';

import {
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';
import { hasAlibabaQwenNativeCredential } from './Qwen.js';

const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS = 10 * 60 * 1000;
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
  return normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'docker';
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
  if (isQwenInferenceModel(model)) {
    return DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['QWEN3.7'];
  }
  if (isGeminiInferenceModel(model)) {
    return DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['gemini-3.1-pro'];
  }
  return DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL[normalizeInferenceModel(model)] ||
    DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['gpt-5.6-sol'];
}

function isDockerInferenceRuntime() {
  const environment = normalizeString(process.env.CURRENT_ENV).toLowerCase();
  return environment === 'docker' || environment === 'staging';
}

function getRuntimeInferenceProviderPriority(model) {
  return !isDockerInferenceRuntime() && isQwenInferenceModel(model)
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

function getRequestedInferenceModel(chatRequest = {}) {
  return normalizeRequestedInferenceModel(
    chatRequest.model ||
    chatRequest.provider_options?.model ||
    chatRequest.providerOptions?.model ||
    chatRequest.inference_model ||
    chatRequest.inferenceModel,
  );
}

function hasVisionInput(chatRequest = {}) {
  return (Array.isArray(chatRequest.messages) ? chatRequest.messages : []).some((message) => (
    Array.isArray(message?.content) && message.content.some((part) => [
      'image', 'image_url', 'input_image', 'video', 'video_url', 'input_video',
    ].includes(normalizeString(part?.type).toLowerCase()))
  ));
}

export function getOpenRouterModelForInferenceRequest(chatRequest = {}, env = process.env) {
  const model = getRequestedInferenceModel(chatRequest);
  if (isQwenInferenceModel(model)) {
    const vision = hasVisionInput(chatRequest);
    return normalizeString(vision ? env?.OPENROUTER_QWEN_37_PLUS_MODEL : env?.OPENROUTER_QWEN_37_MAX_MODEL) ||
      (vision ? 'qwen/qwen3.7-plus' : 'qwen/qwen3.7-max');
  }
  if (isGeminiInferenceModel(model)) {
    return normalizeString(env?.OPENROUTER_GEMINI_31_PRO_MODEL) || 'google/gemini-3.1-pro';
  }
  return normalizeString(env?.OPENROUTER_GPT_56_SOL_MODEL) || 'openai/gpt-5.6-sol';
}

export function shouldUseOpenRouterInference(chatRequest = {}) {
  if (!chatRequest || typeof chatRequest !== 'object') return false;
  if (isOpenRouterAuthorization(chatRequest.authorization)) return true;
  if (isDeployedAuthorization(chatRequest.authorization)) return false;
  return resolveConfiguredInferenceProvider(getRequestedInferenceModel(chatRequest)) ===
    DOCKER_INFERENCE_PROVIDER.OPENROUTER;
}

export async function createOpenRouterChatCompletion(chatRequest = {}) {
  const client = getOpenRouterClient();
  if (!client) throw new Error('OPENROUTER_API_KEY is required for OpenRouter inference.');
  const {
    authorization, bypassSamsarExternalInference, samsarExternalInference,
    timeout, timeoutMs, maxRetries, reasoning_effort, reasoning, ...request
  } = chatRequest || {};
  const effort = reasoning?.effort || reasoning_effort || (
    getRequestedInferenceModel(chatRequest) === GPT_56_SOL_INFERENCE_MODEL
      ? GPT_56_SOL_REASONING_EFFORT
      : undefined
  );
  const options = {
    timeout: Number(timeout ?? timeoutMs ?? process.env.OPENROUTER_INFERENCE_TIMEOUT_MS) ||
      DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS,
  };
  const retries = Number(maxRetries);
  if (Number.isInteger(retries) && retries >= 0) options.maxRetries = retries;
  return client.chat.completions.create({
    ...request,
    model: getOpenRouterModelForInferenceRequest(chatRequest),
    ...(effort ? { reasoning: { effort } } : {}),
  }, options);
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
  if (!isDockerInferenceRuntime() && isQwenInferenceModel(inferenceModel)) return true;
  if (chatRequest.bypassSamsarExternalInference || chatRequest.samsarExternalInference === false) {
    return false;
  }
  if (isOpenRouterAuthorization(chatRequest.authorization)) return true;
  if (chatRequest.samsarExternalInference === true || isDeployedAuthorization(chatRequest.authorization)) {
    return shouldEnableExternalInference() && Boolean(getExternalClient());
  }
  const provider = resolveConfiguredInferenceProvider(inferenceModel);
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) return true;
  return shouldEnableExternalInference() && provider === DOCKER_INFERENCE_PROVIDER.SAMSAR;
}

export async function createSamsarExternalChatCompletion(chatRequest = {}) {
  if (shouldUseOpenRouterInference(chatRequest) || (
    !isDockerInferenceRuntime() && isQwenInferenceModel(getRequestedInferenceModel(chatRequest))
  )) {
    return createOpenRouterChatCompletion(chatRequest);
  }
  const client = getExternalClient();
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
    ...payload
  } = chatRequest || {};

  const model = getRequestedInferenceModel(payload);
  const response = await client.createV2ExternalChatCompletion({
    ...payload,
    model,
    ...(model === GPT_56_SOL_INFERENCE_MODEL
      ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
      : {}),
    timeout: Number(timeout ?? timeoutMs ?? process.env.SAMSAR_EXTERNAL_INFERENCE_TIMEOUT_MS) ||
      DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS,
  });

  return unwrapSamsarExternalChatCompletionResponse(response);
}
