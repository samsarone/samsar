import fs from 'node:fs';

import SamsarClient from 'samsar-js';
import OpenAI from 'openai';

import {
  INFERENCE_MODELS,
  KIMI_K3_INFERENCE_MODEL,
  QWEN_37_INFERENCE_MODEL,
  getReasoningEffortForInferenceModel,
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isOpenAIInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
  normalizeOpenAIInferenceModel,
} from '../../consts/InferenceModels.js';
import { isStandaloneEdition } from '../../utils/EnvironmentUtils.js';
import {
  hasAlibabaQwenNativeCredential,
  hasQwenVisionInput,
} from '../../inference/AlibabaQwen.js';
import { hasKimiK3NativeCredential } from '../../inference/KimiK3.js';
import { externalAssistantClientRequestStore } from './ExternalAssistantClientRequestStore.js';
import { resolveProviderMediaPayload } from './ProviderMediaPayload.js';
import {
  applyModelAdapterPreferenceOrder,
  normalizeModelAdapterModelKey,
  readModelAdapterPreferences,
} from '../api/ModelAdapterPreferences.js';

const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OPENROUTER_QWEN_INFERENCE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_EXTERNAL_INFERENCE_MAX_RETRIES = 3;
const DEFAULT_EXTERNAL_INFERENCE_RETRY_BASE_DELAY_MS = 5000;
const DEFAULT_EXTERNAL_INFERENCE_RETRY_MAX_DELAY_MS = 60000;
const DEFAULT_EXTERNAL_INFERENCE_POLL_INTERVAL_MS = 2000;
// OpenRouter checks whether the account can afford the requested maximum before
// generation. Keep Qwen Max and Plus reservations close to observed production
// usage instead of reserving their much larger provider output windows.
const OPENROUTER_QWEN_MAX_TOKEN_CEILING = 2048;
const DEFAULT_OPENROUTER_QWEN_MAX_TOKENS = 2048;
const DEFAULT_OPENROUTER_GEMINI_MAX_TOKENS = 65536;
const DEFAULT_OPENROUTER_GPT_MAX_COMPLETION_TOKENS = 65536;
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_GENBLAZE_BASE_URL = 'http://genblaze:8080/v1';
const GENBLAZE_INFERENCE_MODELS = new Set([
  'QWEN3.7',
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
export const DOCKER_INFERENCE_PROVIDER = Object.freeze({
  ALIBABA_CLOUD: 'alibabaCloud',
  GOOGLE_CLOUD: 'googleCloud',
  OPENAI: 'openai',
  OPENROUTER: 'openrouter',
  KIMI: 'kimi',
  SAMSAR: 'samsar',
  GMICLOUD: 'gmicloud',
});
export const DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL = Object.freeze({
  [QWEN_37_INFERENCE_MODEL]: Object.freeze([
    DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.GMICLOUD,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
  ]),
  'gemini-3.1-pro': Object.freeze([
    DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.GMICLOUD,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
  ]),
  [INFERENCE_MODELS.Inference]: Object.freeze([
    DOCKER_INFERENCE_PROVIDER.OPENAI,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
    DOCKER_INFERENCE_PROVIDER.GMICLOUD,
    DOCKER_INFERENCE_PROVIDER.OPENROUTER,
  ]),
  [KIMI_K3_INFERENCE_MODEL]: Object.freeze([
    DOCKER_INFERENCE_PROVIDER.KIMI,
    DOCKER_INFERENCE_PROVIDER.SAMSAR,
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

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getExternalInferenceErrorStatus(error) {
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const status = Number(
      current.status ??
      current.statusCode ??
      current.code ??
      current.response?.status ??
      current.error?.status ??
      current.error?.code,
    );
    if (Number.isInteger(status) && status > 0) {
      return status;
    }
    current = current.cause;
  }
  return null;
}

function getExternalInferenceErrorCode(error) {
  return normalizeString(error?.code || error?.cause?.code).toUpperCase();
}

function isRetryableExternalInferenceError(error) {
  const status = getExternalInferenceErrorStatus(error);
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
  if (status !== null) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  const code = getExternalInferenceErrorCode(error);
  if ([
    'ECONNABORTED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENETUNREACH',
  ].includes(code)) {
    return true;
  }

  if (
    message.includes('invalid json response body') ||
    message.includes('unexpected end of json input') ||
    message.includes('unterminated json')
  ) {
    return true;
  }

  return ['APICONNECTIONERROR', 'APICONNECTIONTIMEOUTERROR'].includes(
    normalizeString(error?.name || error?.cause?.name).toUpperCase(),
  );
}

function getExternalInferenceRetryAfterMs(error) {
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const headers = current.headers ?? current.response?.headers;
    const getHeader = (name) => normalizeString(
      typeof headers?.get === 'function'
        ? headers.get(name)
        : headers?.[name] ?? headers?.[name.toLowerCase()],
    );
    const retryAfterMs = Number(getHeader('retry-after-ms'));
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.ceil(retryAfterMs);
    const retryAfter = getHeader('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
    }
    current = current.cause;
  }
  return null;
}

function getExternalInferenceRetryDelayMs(retryNumber, error) {
  const baseDelayMs = normalizePositiveInteger(
    process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_BASE_DELAY_MS,
    DEFAULT_EXTERNAL_INFERENCE_RETRY_BASE_DELAY_MS,
  );
  const maxDelayMs = Math.max(
    baseDelayMs,
    normalizePositiveInteger(
      process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_MAX_DELAY_MS,
      DEFAULT_EXTERNAL_INFERENCE_RETRY_MAX_DELAY_MS,
    ),
  );
  const retryIndex = Math.max(0, normalizeNonNegativeInteger(retryNumber, 1) - 1);
  const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** retryIndex));
  return Math.max(exponentialDelayMs, getExternalInferenceRetryAfterMs(error) ?? 0);
}

function getOpenRouterCompletionLimit(requestedModel, request = {}) {
  let configuredLimit;
  if (isQwenInferenceModel(requestedModel)) {
    configuredLimit = Math.min(
      normalizePositiveInteger(
        process.env.OPENROUTER_QWEN_MAX_TOKENS,
        OPENROUTER_QWEN_MAX_TOKEN_CEILING,
      ),
      OPENROUTER_QWEN_MAX_TOKEN_CEILING,
    );
  } else if (isGeminiInferenceModel(requestedModel)) {
    configuredLimit = normalizePositiveInteger(
      process.env.OPENROUTER_GEMINI_MAX_TOKENS,
      DEFAULT_OPENROUTER_GEMINI_MAX_TOKENS,
    );
  } else {
    configuredLimit = normalizePositiveInteger(
      process.env.OPENROUTER_GPT_MAX_COMPLETION_TOKENS,
      DEFAULT_OPENROUTER_GPT_MAX_COMPLETION_TOKENS,
    );
  }
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
  const hasResponseHealing = normalizedPlugins.some((plugin) => (
    normalizeString(plugin?.id).toLowerCase() === 'response-healing'
  ));
  if (!hasResponseHealing) {
    normalizedPlugins.push({ id: 'response-healing' });
  }
  return normalizedPlugins;
}

function getOpenRouterReasoningEffort(requestedModel, effort, request = {}) {
  if (!isOpenAIInferenceModel(requestedModel) && isOpenRouterStructuredOutputRequest(request)) {
    return 'high';
  }
  const configuredEffort = normalizeString(
    isQwenInferenceModel(requestedModel)
      ? process.env.OPENROUTER_QWEN_REASONING_EFFORT
      : isGeminiInferenceModel(requestedModel)
        ? process.env.OPENROUTER_GEMINI_REASONING_EFFORT
        : process.env.OPENROUTER_GPT_REASONING_EFFORT,
  ).toLowerCase();
  if (['low', 'medium', 'high'].includes(configuredEffort)) {
    return configuredEffort;
  }
  if (isOpenAIInferenceModel(requestedModel) && ['xhigh', 'max'].includes(configuredEffort)) {
    return configuredEffort;
  }

  const normalizedEffort = normalizeString(effort).toLowerCase();
  if (!isOpenAIInferenceModel(requestedModel) && ['xhigh', 'max'].includes(normalizedEffort)) {
    return 'high';
  }
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(normalizedEffort)) {
    return normalizedEffort;
  }

  // OpenRouter providers otherwise choose their own (often medium) reasoning
  // default. Keep Samsar's quality-first policy explicit on every model call.
  return 'high';
}

function buildOpenRouterRequestPayload(request, requestedModel, openRouterModel, effort) {
  const payload = {
    ...request,
    model: openRouterModel,
  };
  const effectiveEffort = getOpenRouterReasoningEffort(requestedModel, effort, request);
  if (effectiveEffort) {
    payload.reasoning = { effort: effectiveEffort };
  }

  const completionLimit = getOpenRouterCompletionLimit(requestedModel, request);
  if (isOpenAIInferenceModel(requestedModel)) {
    delete payload.max_tokens;
    payload.max_completion_tokens = completionLimit;
  } else {
    delete payload.max_completion_tokens;
    payload.max_tokens = completionLimit;
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

function createExternalInferenceTimeoutError(timeoutMs) {
  const error = new Error(`External inference timed out after ${timeoutMs}ms.`);
  error.name = 'ExternalInferenceTimeoutError';
  error.code = 'ETIMEDOUT';
  error.status = 504;
  return error;
}

function waitForExternalInferencePoll(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('External inference polling was aborted.'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(signal.reason || new Error('External inference polling was aborted.'));
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function createAndPollSamsarExternalChatCompletion(client, payload, {
  signal,
  timeoutMs,
  pollIntervalMs,
  requestContext,
  requestStore = externalAssistantClientRequestStore,
  resolvePayload,
} = {}) {
  const localRequest = requestContext
    ? await requestStore.prepare(requestContext, { model: payload.model })
    : null;
  if (localRequest?.status === 'COMPLETED' && localRequest.response) {
    if (localRequest.response && typeof localRequest.response === 'object') {
      Object.defineProperty(
        localRequest.response,
        Symbol.for('samsar.externalInferenceReused'),
        { value: true, enumerable: false, configurable: true },
      );
    }
    return {
      data: {
        request_id: localRequest.providerRequestId,
        status: 'COMPLETED',
        response: localRequest.response,
      },
    };
  }

  const effectiveIntervalMs = normalizePositiveInteger(
    pollIntervalMs,
    DEFAULT_EXTERNAL_INFERENCE_POLL_INTERVAL_MS,
  );
  const startedAt = Date.now();
  let requestId = normalizeString(localRequest?.providerRequestId);
  if (!requestId) {
    const correlationPayload = localRequest
      ? {
        client_request_id: localRequest.clientRequestId,
        client_session_id: localRequest.sessionId,
        client_request_key: localRequest.requestKey,
      }
      : {};
    while (!requestId && Date.now() - startedAt < timeoutMs) {
      let queued;
      try {
        const providerPayload = typeof resolvePayload === 'function'
          ? await resolvePayload(payload)
          : payload;
        queued = typeof client.createV2ExternalChatCompletionAsync === 'function'
          ? await client.createV2ExternalChatCompletionAsync(
            { ...providerPayload, ...correlationPayload },
            { signal },
          )
          : await client.postV2(
            'external/chat/completions',
            {
              ...providerPayload,
              ...correlationPayload,
              async: true,
              response_mode: 'polling',
            },
            { signal },
          );
      } catch (error) {
        if (!localRequest || !isRetryableExternalInferenceError(error)) {
          throw error;
        }
        // The hosted endpoint uses client_request_id as an idempotency key,
        // so retrying after a reset recovers the accepted request instead of
        // starting and billing a duplicate completion.
        await waitForExternalInferencePoll(effectiveIntervalMs, signal);
        continue;
      }
      requestId = normalizeString(
        queued?.data?.request_id || queued?.data?.requestId,
      );
      if (localRequest && requestId) {
        await requestStore.markSubmitted(localRequest.clientRequestId, requestId);
      }
      if (normalizeString(queued?.data?.status).toUpperCase() === 'COMPLETED') {
        const queuedResponse = queued?.data?.response;
        if (localRequest) {
          await requestStore.markCompleted(localRequest.clientRequestId, queuedResponse);
        }
        return queued;
      }
    }
  }
  if (!requestId) {
    throw new Error('External assistant polling response did not include request_id.');
  }

  if (localRequest) {
    await requestStore.markPolling(localRequest.clientRequestId);
  }

  while (Date.now() - startedAt < timeoutMs) {
    let statusResult;
    try {
      statusResult = typeof client.getV2ExternalChatCompletionStatus === 'function'
        ? await client.getV2ExternalChatCompletionStatus(requestId, { signal })
        : await client.getV2('external/chat/status', {
          signal,
          query: { request_id: requestId },
        });
    } catch (error) {
      const status = getExternalInferenceErrorStatus(error);
      if (status !== null && status < 500 && status !== 408 && status !== 429) {
        throw error;
      }
      await waitForExternalInferencePoll(effectiveIntervalMs, signal);
      continue;
    }
    const status = normalizeString(statusResult?.data?.status).toUpperCase();
    if (status === 'COMPLETED') {
      if (localRequest) {
        await requestStore.markCompleted(
          localRequest.clientRequestId,
          statusResult?.data?.response,
        );
      }
      return statusResult;
    }
    if (status === 'FAILED') {
      const error = new Error(
        statusResult?.data?.error?.message || 'External assistant request failed.',
      );
      error.status = Number(statusResult?.data?.error?.status) || 500;
      error.code = normalizeString(statusResult?.data?.error?.code) || null;
      if (localRequest) {
        await requestStore.markFailed(localRequest.clientRequestId, error);
      }
      throw error;
    }
    await waitForExternalInferencePoll(effectiveIntervalMs, signal);
  }

  throw createExternalInferenceTimeoutError(timeoutMs);
}

async function runExternalInferenceAttempt(operation, timeoutMs, attempt, maxAttempts) {
  const effectiveTimeoutMs = normalizePositiveInteger(
    timeoutMs,
    DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS,
  );
  const controller = new AbortController();
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = createExternalInferenceTimeoutError(effectiveTimeoutMs);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, effectiveTimeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({
        signal: controller.signal,
        attempt,
        maxAttempts,
      })),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runExternalInferenceWithRetry(operation, {
  provider = 'external',
  model = null,
  timeoutMs = DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS,
  maxRetries,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  logger = console,
} = {}) {
  if (typeof operation !== 'function') {
    throw new TypeError('External inference operation must be a function.');
  }

  const retryLimit = normalizeNonNegativeInteger(
    maxRetries,
    normalizeNonNegativeInteger(
      process.env.SAMSAR_EXTERNAL_INFERENCE_MAX_RETRIES,
      DEFAULT_EXTERNAL_INFERENCE_MAX_RETRIES,
    ),
  );
  const maxAttempts = retryLimit + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runExternalInferenceAttempt(operation, timeoutMs, attempt, maxAttempts);
    } catch (error) {
      const retryable = isRetryableExternalInferenceError(error);
      const willRetry = retryable && attempt < maxAttempts;
      const context = {
        provider,
        model,
        attempt,
        maxAttempts,
        status: getExternalInferenceErrorStatus(error),
        code: getExternalInferenceErrorCode(error) || null,
        message: error?.message || String(error),
        willRetry,
      };
      logger.error?.('[external_inference] request failed', context);

      if (!willRetry) {
        throw error;
      }

      const delayMs = getExternalInferenceRetryDelayMs(attempt, error);
      logger.warn?.('[external_inference] retry scheduled', {
        ...context,
        retryNumber: attempt,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw new Error('External inference failed without a response.');
}

function normalizeBaseUrl(value) {
  const normalized = normalizeString(value || DEFAULT_SAMSAR_API_BASE_URL).replace(/\/+$/, '');
  return normalized || DEFAULT_SAMSAR_API_BASE_URL;
}

function normalizeAuthorization(value) {
  return normalizeString(value).toLowerCase().replace(/[_\s]+/g, '-');
}

function isDeployedAuthorization(value) {
  return ['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(
    normalizeAuthorization(value),
  );
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

  const baseURL = normalizeBaseUrl(
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
  return hasQwenVisionInput(chatRequest.messages) || hasQwenVisionInput(chatRequest.input)
    ? 'vision'
    : 'text';
}

function getCanonicalGenblazeInferenceModel(model) {
  if (isQwenInferenceModel(model)) return 'QWEN3.7';
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
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENAI) {
    return hasOpenAINativeCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) {
    return hasOpenRouterCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) {
    return Boolean(getGenblazeClient()) && hasGenblazeModelMapping(model, chatRequest);
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.KIMI) {
    return hasKimiK3NativeCredential();
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.SAMSAR) {
    return Boolean(getExternalClient());
  }
  return false;
}

function getInferenceProviderPriority(model, chatRequest = {}) {
  let defaultPriority;
  if (isQwenInferenceModel(model)) {
    defaultPriority = DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL[QWEN_37_INFERENCE_MODEL];
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
      DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL[INFERENCE_MODELS.Inference];
    defaultPriority = Boolean(getGenblazeClient()) && hasGenblazeModelMapping(model, chatRequest)
      ? genblazePriority
      : [
        DOCKER_INFERENCE_PROVIDER.OPENAI,
        DOCKER_INFERENCE_PROVIDER.OPENROUTER,
        DOCKER_INFERENCE_PROVIDER.SAMSAR,
      ];
  }

  const savedPriority = readModelAdapterPreferences().modelProviderPriority[
    normalizeModelAdapterModelKey(model)
  ];
  return applyModelAdapterPreferenceOrder(defaultPriority, savedPriority);
}

function isDockerInferenceRuntime() {
  return isStandaloneEdition();
}

function isQwenOpenRouterOnly(model) {
  return isQwenInferenceModel(model) && (
    isTruthyEnv(process.env.SAMSAR_QWEN_OPENROUTER_ONLY) ||
    !isDockerInferenceRuntime()
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
  if (isKimiInferenceModel(model)) return false;
  if (isQwenOpenRouterOnly(model)) return true;
  if (isOpenRouterAuthorization(chatRequest.authorization)) return true;
  if (isDeployedAuthorization(chatRequest.authorization)) return false;
  return resolveConfiguredInferenceProvider(model, chatRequest) === DOCKER_INFERENCE_PROVIDER.OPENROUTER;
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

export async function createGenblazeChatCompletion(chatRequest = {}, dependencyOverrides = {}) {
  const model = getCanonicalGenblazeInferenceModel(getRequestedInferenceModel(chatRequest));
  if (!hasGenblazeModelMapping(model, chatRequest)) {
    const error = new Error(
      'GMICloud via GenBlaze does not expose an exact compatible model for this inference request.',
    );
    error.code = 'GENBLAZE_MODEL_UNSUPPORTED';
    throw error;
  }
  const client = dependencyOverrides.genblazeClient || getGenblazeClient();
  if (!client) throw new Error('SAMSAR_GENBLAZE_ENABLED is required for GMICloud inference.');
  const {
    authorization, bypassSamsarExternalInference, samsarExternalInference,
    timeout, timeoutMs, maxRetries, externalMaxRetries,
    externalPolling, externalPollIntervalMs, externalPollTimeoutMs, ...request
  } = chatRequest || {};
  const requestTimeout = normalizePositiveInteger(
    timeout ?? timeoutMs ?? process.env.SAMSAR_GENBLAZE_INFERENCE_TIMEOUT_MS,
    DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS,
  );
  return runExternalInferenceWithRetry(
    async ({ signal }) => client.chat.completions.create(
      await resolveProviderMediaPayload({
        ...request,
        model,
        ...(GENBLAZE_HIGH_REASONING_MODELS.has(model)
          ? {
            reasoning_effort: request.reasoning_effort === 'high'
              ? request.reasoning_effort
              : 'high',
          }
          : {}),
      }, {
        resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
        serviceName: 'samsar_processor_genblaze_inference',
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

export async function createOpenRouterChatCompletion(chatRequest = {}, dependencyOverrides = {}) {
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
    externalPolling,
    externalPollIntervalMs,
    externalPollTimeoutMs,
    reasoning_effort,
    reasoning,
    ...request
  } = chatRequest || {};
  const requestedModel = getRequestedInferenceModel(chatRequest);
  const effort = reasoning?.effort || reasoning_effort || (
    isOpenAIInferenceModel(requestedModel)
      ? getReasoningEffortForInferenceModel(requestedModel)
      : undefined
  );
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
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.floor(requestedTimeout)
      : minimumTimeout,
    minimumTimeout,
  );
  const openRouterModel = getOpenRouterModelForInferenceRequest(chatRequest);
  const payload = buildOpenRouterRequestPayload(
    request,
    requestedModel,
    openRouterModel,
    effort,
  );

  return runExternalInferenceWithRetry(
    async ({ signal }) => {
      const providerPayload = await resolveProviderMediaPayload(payload, {
        resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
        serviceName: 'samsar_processor_openrouter',
      });
      return client.chat.completions.create(providerPayload, {
        timeout: requestTimeout,
        // The adapter owns retry timing so the SDK cannot multiply attempts.
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

function getRequestedInferenceModel(chatRequest = {}) {
  return normalizeOpenAIInferenceModel(
    chatRequest.model ||
    chatRequest.provider_options?.model ||
    chatRequest.providerOptions?.model ||
    chatRequest.inference_model ||
    chatRequest.inferenceModel,
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
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) return true;
  if (provider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) return true;
  return shouldEnableExternalInference() && provider === DOCKER_INFERENCE_PROVIDER.SAMSAR;
}

export async function createSamsarExternalChatCompletion(chatRequest = {}, dependencyOverrides = {}) {
  if (shouldUseGenblazeInference(chatRequest)) {
    return createGenblazeChatCompletion(chatRequest, dependencyOverrides);
  }
  if (shouldUseOpenRouterInference(chatRequest)) {
    return createOpenRouterChatCompletion(chatRequest, dependencyOverrides);
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
    externalPolling,
    externalPollIntervalMs,
    externalPollTimeoutMs,
    externalRequestContext,
    externalRequestStore,
    ...payload
  } = chatRequest || {};

  const model = getRequestedInferenceModel(payload);
  const requestTimeout = normalizePositiveInteger(
    timeout ?? timeoutMs ?? process.env.SAMSAR_EXTERNAL_INFERENCE_TIMEOUT_MS,
    DEFAULT_EXTERNAL_INFERENCE_TIMEOUT_MS,
  );
  const requestPayload = {
    ...payload,
    model,
    ...(isOpenAIInferenceModel(model) || isKimiInferenceModel(model)
      ? { reasoning_effort: getReasoningEffortForInferenceModel(model) }
      : {}),
  };
  const usePolling = externalPolling === true;
  const pollingTimeoutMs = normalizePositiveInteger(
    externalPollTimeoutMs,
    requestTimeout,
  );
  const resolveAttemptPayload = (sourcePayload) => resolveProviderMediaPayload(sourcePayload, {
    resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
    serviceName: 'samsar_processor_external_inference',
  });
  const response = await runExternalInferenceWithRetry(
    async ({ signal }) => usePolling
      ? createAndPollSamsarExternalChatCompletion(client, requestPayload, {
        signal,
        timeoutMs: pollingTimeoutMs,
        pollIntervalMs: externalPollIntervalMs,
        requestContext: externalRequestContext,
        requestStore: externalRequestStore || externalAssistantClientRequestStore,
        resolvePayload: resolveAttemptPayload,
      })
      : client.createV2ExternalChatCompletion(
        await resolveAttemptPayload(requestPayload),
        { signal },
      ),
    {
      provider: 'samsar',
      model,
      timeoutMs: usePolling ? pollingTimeoutMs : requestTimeout,
      maxRetries: externalMaxRetries ?? maxRetries,
    },
  );

  return unwrapSamsarExternalChatCompletionResponse(
    usePolling ? response?.data?.response : response,
  );
}
