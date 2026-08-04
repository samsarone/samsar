import fs from 'node:fs';

import SamsarClient from 'samsar-js';
import OpenAI from 'openai';

import {
  GPT_56_SOL_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';
import {
  KIMI_K3_REASONING_EFFORT,
  hasKimiK3ApiKey,
} from './KimiK3.js';
import { getAlibabaCloudApiKey, hasQwenMultimodalInput } from './Qwen.js';
import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import { normalizeProviderMediaPayload } from '../utils/ProviderMediaPayload.js';
import { isStandaloneEdition } from '../util/environmentUtils.js';

const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS = 20 * 60 * 1000;
const OPENROUTER_QWEN_MAX_TOKEN_CEILING = 24000;
const DEFAULT_OPENROUTER_QWEN_MAX_TOKENS = 16384;
const DEFAULT_OPENROUTER_GEMINI_MAX_TOKENS = 65536;
const DEFAULT_OPENROUTER_GPT_MAX_COMPLETION_TOKENS = 65536;
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
const DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH =
  '/persistent/config/model-adapter-preferences.json';
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
  'QWEN3.8': Object.freeze([
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
  'kimi-k3': Object.freeze([
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

function uniqueInferenceProviders(value) {
  const providers = Array.isArray(value) ? value : [];
  return [...new Set(providers.map(normalizeInferenceProvider).filter(Boolean))];
}

function normalizeSavedInferencePreferenceModelKey(model) {
  const token = normalizeString(model).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (['QWEN38', 'QWEN38MAX'].includes(token)) return 'QWEN3.8';
  if (['GEMINI31PRO', 'GEMINI3PRO'].includes(token)) return 'gemini-3.1-pro';
  if (['KIMIK3', 'KIMI3', 'MOONSHOTK3'].includes(token)) return 'KIMIK3';
  if (['GPT56SOL', 'GPT5SOL'].includes(token)) return 'gpt-5.6-sol';
  return '';
}

function getInferencePreferenceModelKey(model) {
  if (isQwenInferenceModel(model)) return 'QWEN3.8';
  if (isGeminiInferenceModel(model)) return 'gemini-3.1-pro';
  if (isKimiInferenceModel(model)) return 'KIMIK3';
  return 'gpt-5.6-sol';
}

function readSavedInferenceProviderPriority(model) {
  if (!isStandaloneEdition()) {
    return [];
  }

  const filePath =
    normalizeString(process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH) ||
    DEFAULT_MODEL_ADAPTER_PREFERENCES_PATH;
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const priorityMap =
      parsed?.modelProviderPriority || parsed?.model_provider_priority;
    if (!priorityMap || typeof priorityMap !== 'object' || Array.isArray(priorityMap)) {
      return [];
    }
    const preferenceModelKey = getInferencePreferenceModelKey(model);
    const matchingEntry = Object.entries(priorityMap).find(
      ([modelKey]) => normalizeSavedInferencePreferenceModelKey(modelKey) === preferenceModelKey,
    );
    return uniqueInferenceProviders(matchingEntry?.[1]);
  } catch {
    return [];
  }
}

function applySavedInferenceProviderPriority(defaultPriority, model) {
  if (!isStandaloneEdition()) {
    return defaultPriority;
  }

  const normalizedDefault = uniqueInferenceProviders(defaultPriority);
  const compatibleProviders = new Set(normalizedDefault);
  const savedPriority = readSavedInferenceProviderPriority(model)
    .filter((provider) => compatibleProviders.has(provider));
  if (savedPriority.length === 0) {
    return defaultPriority;
  }
  return [
    ...savedPriority,
    ...normalizedDefault.filter((provider) => !savedPriority.includes(provider)),
  ];
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  if (effectiveEffort) payload.reasoning = { effort: effectiveEffort };
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

function hasAlibabaCloudNativeCredential() {
  return Boolean(getAlibabaCloudApiKey());
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

function getGenblazeClient() {
  if (!isStandaloneEdition() || !isTruthyEnv(process.env.SAMSAR_GENBLAZE_ENABLED)) return null;
  const baseURL = normalizeBaseUrl(
    process.env.SAMSAR_GENBLAZE_BASE_URL || DEFAULT_GENBLAZE_BASE_URL,
  );
  if (!cachedGenblazeClient || cachedGenblazeBaseUrl !== baseURL) {
    cachedGenblazeClient = new OpenAI({ apiKey: 'samsar-internal', baseURL });
    cachedGenblazeBaseUrl = baseURL;
  }
  return cachedGenblazeClient;
}

function getGenblazeInferenceModality(chatRequest = {}) {
  return hasQwenMultimodalInput(chatRequest) ? 'vision' : 'text';
}

function getCanonicalGenblazeInferenceModel(model) {
  if (isQwenInferenceModel(model)) return 'QWEN3.8';
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
    return hasAlibabaCloudNativeCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD) {
    return hasGoogleNativeCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.KIMI) {
    return hasKimiK3ApiKey();
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
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['QWEN3.8'];
  } else if (isGeminiInferenceModel(model)) {
    defaultPriority = Boolean(getGenblazeClient()) && hasGenblazeModelMapping(model, chatRequest)
      ? DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['gemini-3.1-pro']
      : [
        DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD,
        DOCKER_INFERENCE_PROVIDER.OPENROUTER,
        DOCKER_INFERENCE_PROVIDER.SAMSAR,
      ];
  } else if (isKimiInferenceModel(model)) {
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['kimi-k3'];
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

  return applySavedInferenceProviderPriority(defaultPriority, model);
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
  return isQwenOpenRouterOnly(model)
    ? [DOCKER_INFERENCE_PROVIDER.OPENROUTER]
    : getInferenceProviderPriority(model, chatRequest);
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
  if (!chatRequest || typeof chatRequest !== 'object') return false;
  const model = getRequestedInferenceModel(chatRequest);
  if (isKimiInferenceModel(model)) return false;
  if (isQwenOpenRouterOnly(model)) return true;
  if (isOpenRouterAuthorization(chatRequest.authorization)) return true;
  if (isDeployedAuthorization(chatRequest.authorization)) return false;
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
      }),
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
  return runExternalInferenceWithRetry(
    async ({ signal }) => {
      const normalizedRequest = await normalizeProviderMediaPayload(request);
      const payload = buildOpenRouterRequestPayload(
        normalizedRequest,
        requestedModel,
        openRouterModel,
        effort,
      );
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
  if (isOpenRouterAuthorization(chatRequest.authorization)) return true;
  if (isGenblazeAuthorization(chatRequest.authorization)) return true;
  if (chatRequest.samsarExternalInference === true || isDeployedAuthorization(chatRequest.authorization)) {
    return shouldEnableExternalInference() && Boolean(getExternalClient());
  }
  const provider = resolveConfiguredInferenceProvider(inferenceModel, chatRequest);
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) return true;
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
    ...(model === GPT_56_SOL_INFERENCE_MODEL
      ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
      : isKimiInferenceModel(model)
        ? { reasoning_effort: KIMI_K3_REASONING_EFFORT }
        : {}),
    timeout: requestTimeout,
  };
  const response = await runExternalInferenceWithRetry(
    async ({ signal }) => {
      const requestPayload = await normalizeProviderMediaPayload(rawRequestPayload);
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
