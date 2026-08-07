import fs from 'node:fs';
import SamsarClient from 'samsar-js';
import OpenAI from 'openai';

import {
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  KIMI_K3_INFERENCE_MODEL,
  QWEN_38_INFERENCE_MODEL,
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';
import { hasAlibabaQwenNativeCredential, hasQwenVisionInput } from './AlibabaQwen.js';
import { hasKimiK3NativeCredential } from './KimiK3.js';
import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import { normalizeProviderMediaUrl } from '../AWS.js';
import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';
import { isStandaloneEdition } from './Environment.js';

const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS = 20 * 60 * 1000;
// OpenRouter counts hidden reasoning inside the completion budget. These full
// advertised output windows are the safe defaults and hard caps. A caller may
// still choose a smaller, operation-specific budget for bounded output.
const OPENROUTER_QWEN_MAX_COMPLETION_TOKENS = 131072;
const OPENROUTER_GEMINI_MAX_COMPLETION_TOKENS = 65536;
const OPENROUTER_GPT_MAX_COMPLETION_TOKENS = 128000;
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_GENBLAZE_BASE_URL = 'http://genblaze:8080/v1';
const GENBLAZE_INFERENCE_MODELS = new Set([
  'QWEN3.8',
  'gpt-5.6-sol',
  'gemini-3.1-pro',
]);
const GENBLAZE_HIGH_REASONING_MODELS = new Set([
  'gpt-5.6-sol',
  'gemini-3.1-pro',
]);
const DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH =
  '/persistent/config/model-adapter-preferences.json';
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
  GMICLOUD: 'gmicloud',
});
export const DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  [QWEN_38_INFERENCE_MODEL]: Object.freeze([
    DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD,
    DOCKER_INFERENCE_PROVIDER.GMICLOUD,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
  ]),
  'gemini-3.1-pro': Object.freeze([
    DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD,
    DOCKER_INFERENCE_PROVIDER.GMICLOUD,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
  ]),
  [KIMI_K3_INFERENCE_MODEL]: Object.freeze([
    DOCKER_INFERENCE_PROVIDER.KIMI,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
  ]),
  'gpt-5.6-sol': Object.freeze([
    DOCKER_INFERENCE_PROVIDER.OPENAI,
    DOCKER_INFERENCE_PROVIDER.GMICLOUD,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
  ]),
});

let cachedClient = null;
let cachedClientKey = '';
let cachedBaseUrl = '';
let cachedOpenRouterClient = null;
let cachedOpenRouterClientKey = '';
let cachedOpenRouterBaseUrl = '';
let cachedGenblazeClient = null;
let cachedGenblazeBaseUrl = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInferenceProvider(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['alibaba', 'alibabacloud', 'aliyun', 'dashscope', 'qwen'].includes(normalized)) {
    return DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD;
  }
  if (['google', 'googlecloud', 'gcp', 'vertex', 'vertexai'].includes(normalized)) {
    return DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD;
  }
  if (['kimi', 'moonshot', 'moonshotai'].includes(normalized)) {
    return DOCKER_INFERENCE_PROVIDER.KIMI;
  }
  if (normalized === 'openai') {
    return DOCKER_INFERENCE_PROVIDER.OPENAI;
  }
  if (['openrouter', 'openrouterai'].includes(normalized)) {
    return DOCKER_INFERENCE_PROVIDER.OPENROUTER;
  }
  if (['gmi', 'gmicloud', 'genblaze'].includes(normalized)) {
    return DOCKER_INFERENCE_PROVIDER.GMICLOUD;
  }
  if (normalized === 'samsar') {
    return DOCKER_INFERENCE_PROVIDER.SAMSAR;
  }
  return '';
}

function uniqueInferenceProviders(values = []) {
  const source = Array.isArray(values) ? values : [values];
  return [...new Set(source.map(normalizeInferenceProvider).filter(Boolean))];
}

function normalizeInferencePreferenceModelKey(model) {
  const normalizedModel = normalizeString(model).toLowerCase();
  if (isQwenInferenceModel(model)) {
    return QWEN_38_INFERENCE_MODEL;
  }
  if (isGeminiInferenceModel(model)) {
    return 'gemini-3.1-pro';
  }
  if (isKimiInferenceModel(model)) {
    return 'KIMIK3';
  }
  if (!normalizedModel || normalizedModel.startsWith('gpt-')) {
    return GPT_56_SOL_INFERENCE_MODEL;
  }
  return normalizedModel;
}

function getSavedInferenceProviderPriority(model, env = process.env) {
  if (!isStandaloneEdition(env)) {
    return [];
  }
  const filePath = normalizeString(env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH) ||
    DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH;
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const priorityMap = parsed?.modelProviderPriority || parsed?.model_provider_priority;
    if (!priorityMap || typeof priorityMap !== 'object' || Array.isArray(priorityMap)) {
      return [];
    }
    const normalizedModel = normalizeInferencePreferenceModelKey(model);
    const matchingKey = Object.keys(priorityMap).find(
      (key) => normalizeInferencePreferenceModelKey(key) === normalizedModel,
    );
    return matchingKey
      ? uniqueInferenceProviders(priorityMap[matchingKey])
      : [];
  } catch (error) {
    console.error('[inference_adapter_priority] failed to read model adapter preferences', {
      filePath,
      message: error?.message || String(error),
    });
    return [];
  }
}

function applyInferenceProviderPreferenceOrder(defaultPriority = [], savedPriority = []) {
  const normalizedDefault = uniqueInferenceProviders(defaultPriority);
  const allowedProviders = new Set(normalizedDefault);
  const preferredProviders = uniqueInferenceProviders(savedPriority)
    .filter((provider) => allowedProviders.has(provider));
  return [
    ...preferredProviders,
    ...normalizedDefault.filter((provider) => !preferredProviders.includes(provider)),
  ];
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
  const providerLimit = isQwenInferenceModel(requestedModel)
    ? OPENROUTER_QWEN_MAX_COMPLETION_TOKENS
    : isGeminiInferenceModel(requestedModel)
      ? OPENROUTER_GEMINI_MAX_COMPLETION_TOKENS
      : OPENROUTER_GPT_MAX_COMPLETION_TOKENS;
  const requestedLimit = normalizePositiveInteger(
    request.max_completion_tokens ?? request.max_output_tokens ?? request.max_tokens,
    providerLimit,
  );
  return Math.min(requestedLimit, providerLimit);
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
  delete payload.max_output_tokens;
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

function normalizeBaseUrl(value, defaultBaseUrl = DEFAULT_SAMSAR_API_BASE_URL) {
  const normalized = normalizeString(value || defaultBaseUrl).replace(/\/+$/, '');
  return normalized || defaultBaseUrl;
}

export function normalizeOpenRouterBaseUrl(value) {
  return normalizeBaseUrl(value, DEFAULT_OPENROUTER_BASE_URL);
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

function isGenblazeAuthorization(value) {
  return ['gmi', 'gmicloud', 'genblaze'].includes(normalizeAuthorization(value));
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
  if (!apiKey) {
    return null;
  }

  const baseURL = normalizeOpenRouterBaseUrl(
    process.env.OPENROUTER_BASE_URL ||
    process.env.OPENROUTER_API_BASE_URL ||
    DEFAULT_OPENROUTER_BASE_URL,
  );
  if (
    !cachedOpenRouterClient ||
    cachedOpenRouterClientKey !== apiKey ||
    cachedOpenRouterBaseUrl !== baseURL
  ) {
    const defaultHeaders = {};
    const appUrl = normalizeString(process.env.OPENROUTER_APP_URL || process.env.SAMSAR_APP_URL);
    const appName = normalizeString(process.env.OPENROUTER_APP_NAME) || 'Samsar';
    if (appUrl) {
      defaultHeaders['HTTP-Referer'] = appUrl;
    }
    if (appName) {
      defaultHeaders['X-Title'] = appName;
    }
    cachedOpenRouterClient = new OpenAI({ apiKey, baseURL, defaultHeaders });
    cachedOpenRouterClientKey = apiKey;
    cachedOpenRouterBaseUrl = baseURL;
  }

  return cachedOpenRouterClient;
}

function getGenblazeClient() {
  if (!isStandaloneEdition() || !isTruthyEnv(process.env.SAMSAR_GENBLAZE_ENABLED)) return null;
  const baseURL = normalizeBaseUrl(
    process.env.SAMSAR_GENBLAZE_BASE_URL || DEFAULT_GENBLAZE_BASE_URL,
    DEFAULT_GENBLAZE_BASE_URL,
  );
  if (!cachedGenblazeClient || cachedGenblazeBaseUrl !== baseURL) {
    cachedGenblazeClient = new OpenAI({ apiKey: 'samsar-internal', baseURL });
    cachedGenblazeBaseUrl = baseURL;
  }
  return cachedGenblazeClient;
}

function getGenblazeInferenceModality(chatRequest = {}) {
  return hasQwenVisionInput(chatRequest.messages) || hasQwenVisionInput(chatRequest.input)
    ? 'vision'
    : 'text';
}

function getCanonicalGenblazeInferenceModel(model) {
  if (isQwenInferenceModel(model)) return QWEN_38_INFERENCE_MODEL;
  if (isGeminiInferenceModel(model) && normalizeInferenceModel(model) === 'gemini-3.1-pro') {
    return 'gemini-3.1-pro';
  }
  const normalized = normalizeString(model).toLowerCase();
  return normalized === 'gpt-5.6-sol' || normalized.startsWith('gpt-5.6-sol-')
    ? 'gpt-5.6-sol'
    : '';
}

function hasGenblazeModelMapping(model, chatRequest = {}, env = process.env) {
  const canonicalModel = getCanonicalGenblazeInferenceModel(model);
  if (!GENBLAZE_INFERENCE_MODELS.has(canonicalModel)) return false;
  const catalogPath = normalizeString(env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH);
  if (!catalogPath) return false;
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const route = catalog?.models?.[canonicalModel]?.[getGenblazeInferenceModality(chatRequest)];
    return Boolean(normalizeString(route?.modelId));
  } catch {
    return false;
  }
}

function hasConfiguredInferenceProvider(provider, model, chatRequest = {}) {
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
  if (provider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) {
    return Boolean(getGenblazeClient()) && hasGenblazeModelMapping(model, chatRequest);
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.SAMSAR) {
    return Boolean(getExternalClient());
  }
  return false;
}

function getInferenceProviderPriority(model, chatRequest = {}) {
  let defaultPriority;
  if (isQwenInferenceModel(model)) {
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL[QWEN_38_INFERENCE_MODEL];
  } else if (isGeminiInferenceModel(model)) {
    defaultPriority = Boolean(getGenblazeClient()) && hasGenblazeModelMapping(model, chatRequest)
      ? DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['gemini-3.1-pro']
      : [
        DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD,
        DOCKER_INFERENCE_PROVIDER.OPENROUTER,
        DOCKER_INFERENCE_PROVIDER.SAMSAR,
      ];
  } else if (isKimiInferenceModel(model)) {
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL[KIMI_K3_INFERENCE_MODEL];
  } else {
    const genblazePriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL[normalizeInferenceModel(model)] ||
      DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['gpt-5.6-sol'];
    defaultPriority = Boolean(getGenblazeClient()) && hasGenblazeModelMapping(model, chatRequest)
      ? genblazePriority
      : [
        DOCKER_INFERENCE_PROVIDER.OPENAI,
        DOCKER_INFERENCE_PROVIDER.OPENROUTER,
        DOCKER_INFERENCE_PROVIDER.SAMSAR,
      ];
  }

  return applyInferenceProviderPreferenceOrder(
    defaultPriority,
    getSavedInferenceProviderPriority(model),
  );
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

function getRuntimeInferenceProviderPriority(model, chatRequest = {}) {
  if (isQwenOpenRouterOnly(model)) {
    return [DOCKER_INFERENCE_PROVIDER.OPENROUTER];
  }
  return getInferenceProviderPriority(model, chatRequest);
}

export function resolveConfiguredInferenceProvider(model, chatRequest = {}) {
  for (const provider of getRuntimeInferenceProviderPriority(model, chatRequest)) {
    if (hasConfiguredInferenceProvider(provider, model, chatRequest)) {
      return provider;
    }
  }
  return '';
}

export function getConfiguredInferenceProviders(model, chatRequest = {}) {
  return getRuntimeInferenceProviderPriority(model, chatRequest)
    .filter((provider) => hasConfiguredInferenceProvider(provider, model, chatRequest));
}

export function shouldUseStandaloneInferenceAdapterFallback(chatRequest = {}) {
  if (!isStandaloneEdition() || !chatRequest || typeof chatRequest !== 'object') {
    return false;
  }
  if (
    isOpenRouterAuthorization(chatRequest.authorization) ||
    isGenblazeAuthorization(chatRequest.authorization) ||
    isDeployedAuthorization(chatRequest.authorization)
  ) {
    return false;
  }
  if (
    chatRequest.bypassSamsarExternalInference ||
    typeof chatRequest.samsarExternalInference === 'boolean'
  ) {
    return false;
  }
  return true;
}

export function buildInferenceProviderPinnedRequest(chatRequest = {}, provider) {
  const {
    authorization: _authorization,
    bypassSamsarExternalInference: _bypassSamsarExternalInference,
    samsarExternalInference: _samsarExternalInference,
    ...request
  } = chatRequest || {};
  const providerRequest = {
    ...request,
    // The ordered adapter loop owns automatic retry so a transient failure
    // advances to the next saved preference instead of repeatedly using one.
    externalMaxRetries: 0,
    maxRetries: 0,
  };

  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) {
    return {
      ...providerRequest,
      authorization: 'openrouter',
      bypassSamsarExternalInference: false,
    };
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) {
    return {
      ...providerRequest,
      authorization: 'gmicloud',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
    };
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.SAMSAR) {
    return {
      ...providerRequest,
      authorization: 'deployed',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
    };
  }
  return {
    ...providerRequest,
    authorization: 'native',
    bypassSamsarExternalInference: true,
    samsarExternalInference: false,
  };
}

function getInferenceAdapterErrorStatus(error) {
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const status = Number(
      current.status ??
      current.statusCode ??
      current.response?.status ??
      current.error?.status,
    );
    if (Number.isInteger(status) && status > 0) {
      return status;
    }
    current = current.cause;
  }
  return null;
}

function getInferenceAdapterErrorCode(error) {
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const code = normalizeString(current.code).toUpperCase();
    if (code) {
      return code;
    }
    current = current.cause;
  }
  return '';
}

export function isRetryableInferenceAdapterError(error) {
  const status = getInferenceAdapterErrorStatus(error);
  const message = normalizeString(error?.message || error?.cause?.message).toLowerCase();
  if (
    status === 402 ||
    message.includes('insufficient credit') ||
    message.includes('insufficient quota') ||
    message.includes('payment required') ||
    message.includes('out of credits')
  ) {
    return false;
  }
  if (
    status === 401 ||
    status === 403 ||
    status === 425 ||
    status === 429
  ) {
    return true;
  }
  if ([
    'GENBLAZE_MODEL_UNSUPPORTED',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT',
  ].includes(getInferenceAdapterErrorCode(error))) {
    return true;
  }
  return false;
}

export async function runInferenceAdapterFallback(
  providers = [],
  dispatchProvider,
) {
  if (typeof dispatchProvider !== 'function') {
    throw new TypeError('Inference adapter dispatch must be a function.');
  }

  let lastError = null;
  const attemptedProviders = [];
  for (const provider of providers) {
    attemptedProviders.push(provider);
    try {
      return await dispatchProvider(provider);
    } catch (error) {
      lastError = error;
      if (!isRetryableInferenceAdapterError(error)) {
        throw error;
      }
    }
  }
  if (lastError) {
    lastError.attemptedInferenceAdapters = attemptedProviders;
    throw lastError;
  }
  return dispatchProvider('');
}

export async function runInferenceWithConfiguredAdapters(
  chatRequest = {},
  dispatchProvider,
) {
  if (typeof dispatchProvider !== 'function') {
    throw new TypeError('Inference adapter dispatch must be a function.');
  }
  if (!shouldUseStandaloneInferenceAdapterFallback(chatRequest)) {
    return dispatchProvider('', chatRequest);
  }

  const providers = getConfiguredInferenceProviders(
    getRequestedInferenceModel(chatRequest),
    chatRequest,
  ).filter(
    (provider) => provider !== DOCKER_INFERENCE_PROVIDER.SAMSAR ||
      shouldEnableExternalInference(),
  );
  if (!providers.length) {
    return dispatchProvider('', chatRequest);
  }
  return runInferenceAdapterFallback(
    providers,
    (provider) => dispatchProvider(
      provider,
      buildInferenceProviderPinnedRequest(chatRequest, provider),
    ),
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
    return normalizeString(env?.OPENROUTER_QWEN_38_MAX_MODEL) || 'qwen/qwen3.8-max';
  }
  if (isGeminiInferenceModel(model)) {
    return normalizeString(env?.OPENROUTER_GEMINI_31_PRO_MODEL) || 'google/gemini-3.1-pro-preview';
  }
  return normalizeString(env?.OPENROUTER_GPT_56_SOL_MODEL) || 'openai/gpt-5.6-sol';
}

export function shouldUseOpenRouterInference(chatRequest = {}) {
  if (!chatRequest || typeof chatRequest !== 'object') {
    return false;
  }
  const model = getRequestedInferenceModel(chatRequest);
  if (isKimiInferenceModel(model)) {
    return false;
  }
  if (isQwenOpenRouterOnly(model)) {
    return true;
  }
  if (isOpenRouterAuthorization(chatRequest.authorization)) {
    return true;
  }
  if (isDeployedAuthorization(chatRequest.authorization)) {
    return false;
  }
  return resolveConfiguredInferenceProvider(model, chatRequest) ===
    DOCKER_INFERENCE_PROVIDER.OPENROUTER;
}

export function shouldUseGenblazeInference(chatRequest = {}) {
  if (!chatRequest || typeof chatRequest !== 'object') return false;
  if (isGenblazeAuthorization(chatRequest.authorization)) return true;
  if (isDeployedAuthorization(chatRequest.authorization) || isOpenRouterAuthorization(chatRequest.authorization)) {
    return false;
  }
  return resolveConfiguredInferenceProvider(getRequestedInferenceModel(chatRequest), chatRequest) ===
    DOCKER_INFERENCE_PROVIDER.GMICLOUD;
}

export async function createGenblazeChatCompletion(chatRequest = {}) {
  const model = getCanonicalGenblazeInferenceModel(getRequestedInferenceModel(chatRequest));
  if (!hasGenblazeModelMapping(model, chatRequest)) {
    const error = new Error(
      'GMICloud via GenBlaze does not expose an exact compatible model for this inference request.',
    );
    error.code = 'GENBLAZE_MODEL_UNSUPPORTED';
    throw error;
  }
  const client = getGenblazeClient();
  if (!client) throw new Error('SAMSAR_GENBLAZE_ENABLED is required for GMICloud inference.');
  const {
    authorization, bypassSamsarExternalInference, samsarExternalInference,
    timeout, timeoutMs, maxRetries, externalMaxRetries,
    reasoning, reasoning_effort, ...request
  } = chatRequest || {};
  const requestedReasoningEffort = normalizeString(
    reasoning_effort || reasoning?.effort,
  ).toLowerCase();
  const requestTimeout = Number(timeout ?? timeoutMs ?? process.env.SAMSAR_GENBLAZE_INFERENCE_TIMEOUT_MS) ||
    DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS;
  return runExternalInferenceWithRetry(
    async ({ signal }) => client.chat.completions.create(
      await normalizeProviderMediaPayload({
        ...request,
        model,
        ...(GENBLAZE_HIGH_REASONING_MODELS.has(model)
          ? { reasoning_effort: 'high' }
          : requestedReasoningEffort
            ? { reasoning_effort: requestedReasoningEffort }
            : {}),
      }, normalizeProviderMediaUrl),
      { timeout: requestTimeout, maxRetries: 0, signal },
    ),
    {
      provider: 'gmicloud',
      model,
      timeoutMs: requestTimeout,
      maxRetries: externalMaxRetries ?? maxRetries,
    },
  );
}

export async function createOpenRouterChatCompletion(chatRequest = {}) {
  const client = getOpenRouterClient();
  if (!client) {
    throw new Error('OPENROUTER_API_KEY is required for OpenRouter inference.');
  }

  const {
    authorization,
    bypassSamsarExternalInference,
    samsarExternalInference,
    timeout,
    timeoutMs,
    maxRetries,
    externalMaxRetries,
    reasoning_effort,
    reasoning,
    ...request
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
  const rawPayload = buildOpenRouterRequestPayload(request, requestedModel, openRouterModel, effort);
  return runExternalInferenceWithRetry(
    async ({ signal }) => {
      const payload = await normalizeProviderMediaPayload(rawPayload, normalizeProviderMediaUrl);
      return client.chat.completions.create(payload, {
        timeout: requestTimeout,
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
    },
  );
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
  if (isQwenOpenRouterOnly(inferenceModel)) return true;
  if (chatRequest.bypassSamsarExternalInference || chatRequest.samsarExternalInference === false) {
    return false;
  }
  if (isOpenRouterAuthorization(chatRequest.authorization)) {
    return true;
  }
  if (isGenblazeAuthorization(chatRequest.authorization)) return true;
  if (chatRequest.samsarExternalInference === true || isDeployedAuthorization(chatRequest.authorization)) {
    return shouldEnableExternalInference() && Boolean(getExternalClient());
  }
  const provider = resolveConfiguredInferenceProvider(inferenceModel, chatRequest);
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) {
    return true;
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) return true;
  return shouldEnableExternalInference() && provider === DOCKER_INFERENCE_PROVIDER.SAMSAR;
}

export async function createSamsarExternalChatCompletion(chatRequest = {}) {
  if (shouldUseGenblazeInference(chatRequest)) {
    return createGenblazeChatCompletion(chatRequest);
  }
  if (shouldUseOpenRouterInference(chatRequest)) {
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
    externalMaxRetries,
    ...payload
  } = chatRequest || {};

  const model = getRequestedInferenceModel(payload);
  const requestTimeout = Number(
    timeout ?? timeoutMs ?? process.env.SAMSAR_EXTERNAL_INFERENCE_TIMEOUT_MS
  ) || DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS;
  const rawRequestPayload = {
    ...payload,
    model,
    ...(model === GPT_56_SOL_INFERENCE_MODEL || isKimiInferenceModel(model)
      ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
      : {}),
    timeout: requestTimeout,
  };
  const response = await runExternalInferenceWithRetry(
    async ({ signal }) => {
      const requestPayload = await normalizeProviderMediaPayload(rawRequestPayload, normalizeProviderMediaUrl);
      return client.createV2ExternalChatCompletion(requestPayload, { signal });
    },
    {
      provider: 'samsar',
      model,
      timeoutMs: requestTimeout,
      maxRetries: externalMaxRetries ?? maxRetries,
    },
  );

  return unwrapSamsarExternalChatCompletionResponse(response);
}
