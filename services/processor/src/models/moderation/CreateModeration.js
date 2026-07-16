import { accessSync, constants as fsConstants } from "node:fs";

import OpenAI from "openai";

import {
  isGeminiInferenceModel,
  isQwenInferenceModel,
} from "../../consts/InferenceModels.js";
import { createDeployedSamsarClient } from "../api/DeployedSamsarClient.js";
import { createGoogleModerationForNarrative } from "./GoogleModeration.js";

export const MODERATION_PROVIDERS = Object.freeze({
  OPENAI: "openai",
  GOOGLE: "google",
  SAMSAR: "samsar",
  DISABLED: "disabled",
});

const DEFAULT_OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const DEFAULT_MODERATION_TIMEOUT_MS = 15_000;
const MAX_MODERATION_TIMEOUT_MS = 20_000;
const DEFAULT_MODERATION_MAX_RETRIES = 3;
const DEFAULT_MODERATION_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_MODERATION_RETRY_MAX_DELAY_MS = 10_000;
const MAX_MODERATION_RETRY_DELAY_MS = 10_000;
const DEFAULT_EXTERNAL_MODERATION_TIMEOUT_BUFFER_MS = 5_000;
const DEFAULT_SAMSAR_EXTERNAL_MODERATION_REQUEST_TIMEOUT_MS = 130_000;
const MAX_SAMSAR_EXTERNAL_MODERATION_REQUEST_TIMEOUT_MS = 130_000;
const DEFAULT_MODERATION_REJECT_SCORE_THRESHOLD = 0.65;
const OPENAI_MODERATION_REJECT_SCORE_THRESHOLD = parseModerationScoreThreshold(
  process.env.OPENAI_MODERATION_REJECT_SCORE_THRESHOLD ||
  process.env.MODERATION_REJECT_SCORE_THRESHOLD,
  DEFAULT_MODERATION_REJECT_SCORE_THRESHOLD,
);
const GOOGLE_MODERATION_REJECT_SCORE_THRESHOLD = parseModerationScoreThreshold(
  process.env.GOOGLE_MODERATION_REJECT_SCORE_THRESHOLD ||
  process.env.MODERATION_REJECT_SCORE_THRESHOLD,
  DEFAULT_MODERATION_REJECT_SCORE_THRESHOLD,
);

const missingProviderWarningLogged = new Set();

function parseModerationScoreThreshold(value, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, parsed));
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeProviderName(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) {
    return "";
  }

  if (normalized === "openai") {
    return MODERATION_PROVIDERS.OPENAI;
  }

  if (
    normalized === "google" ||
    normalized === "googlecloud" ||
    normalized === "gcp" ||
    normalized === "vertex" ||
    normalized === "vertexai" ||
    normalized === "gemini"
  ) {
    return MODERATION_PROVIDERS.GOOGLE;
  }

  if (
    normalized === "samsar" ||
    normalized === "samsarapikey" ||
    normalized === "samsarjs" ||
    normalized === "deployed"
  ) {
    return MODERATION_PROVIDERS.SAMSAR;
  }

  if (["disabled", "disable", "none", "off", "skip"].includes(normalized)) {
    return MODERATION_PROVIDERS.DISABLED;
  }

  return "";
}

function getModerationRejectScoreThreshold(provider) {
  const normalizedProvider = normalizeProviderName(provider);
  if (normalizedProvider === MODERATION_PROVIDERS.GOOGLE) {
    return GOOGLE_MODERATION_REJECT_SCORE_THRESHOLD;
  }
  return OPENAI_MODERATION_REJECT_SCORE_THRESHOLD;
}

function normalizeDeploymentProviderName(value) {
  const normalized = normalizeProviderName(value);
  if (normalized) {
    return normalized;
  }

  const compact = normalizeString(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "fal") {
    return "fal";
  }
  if (compact === "runway" || compact === "runwayml") {
    return "runway";
  }

  return "";
}

function parseProviderList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  const normalized = normalizeString(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[,\s]+/)
    .map(normalizeString)
    .filter(Boolean);
}

function getExplicitModerationProvider(env = process.env) {
  return normalizeProviderName(
    env.SAMSAR_MODERATION_PROVIDER ||
    env.MODERATION_PROVIDER ||
    env.CONTENT_MODERATION_PROVIDER,
  );
}

function getConfiguredDeploymentProviders({ env = process.env, availableModelConfig = null } = {}) {
  const envProviders = parseProviderList(
    env.SAMSAR_DEPLOYMENT_PROVIDERS ||
    env.DEPLOYMENT_PROVIDERS ||
    env.SAMSAR_MODEL_PROVIDERS,
  );
  const providers = envProviders.length > 0
    ? envProviders
    : parseProviderList(availableModelConfig?.providers);

  return [
    ...new Set(
      providers
        .map(normalizeDeploymentProviderName)
        .filter(Boolean),
    ),
  ];
}

function isDockerRuntime(env = process.env) {
  return normalizeString(env.CURRENT_ENV).toLowerCase() === "docker";
}

function tryParseGoogleCredentials(env = process.env) {
  const rawJson = normalizeString(env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  const rawBase64 = normalizeString(env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64);
  if (!rawJson && !rawBase64) {
    return null;
  }

  try {
    return JSON.parse(
      rawJson || Buffer.from(rawBase64, "base64").toString("utf8"),
    );
  } catch {
    return null;
  }
}

function hasUsableGoogleCredentialShape(credentials) {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    return false;
  }

  const type = normalizeString(credentials.type).toLowerCase();
  if (type === "authorized_user") {
    return Boolean(
      normalizeString(credentials.client_id) &&
      normalizeString(credentials.client_secret) &&
      normalizeString(credentials.refresh_token),
    );
  }
  if (type === "external_account") {
    return Boolean(
      normalizeString(credentials.audience) &&
      normalizeString(credentials.subject_token_type) &&
      normalizeString(credentials.token_url) &&
      credentials.credential_source &&
      typeof credentials.credential_source === "object",
    );
  }
  return Boolean(
    normalizeString(credentials.client_email) &&
    normalizeString(credentials.private_key),
  );
}

function hasReadableCredentialFile(value) {
  const filePath = normalizeString(value);
  if (!filePath) {
    return false;
  }
  try {
    accessSync(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function hasOpenAIModerationCredential(env = process.env) {
  return Boolean(normalizeString(env.OPENAI_API_KEY));
}

export function hasGoogleModerationCredential(env = process.env) {
  const credentials = tryParseGoogleCredentials(env);
  const hasCredentialSource = Boolean(
    hasUsableGoogleCredentialShape(credentials) ||
    hasReadableCredentialFile(env.GOOGLE_APPLICATION_CREDENTIALS) ||
    normalizeString(env.K_SERVICE) ||
    normalizeString(env.GAE_SERVICE) ||
    normalizeString(env.FUNCTION_TARGET) ||
    normalizeString(env.GCE_METADATA_HOST),
  );
  const hasProject = Boolean(
    normalizeString(env.GOOGLE_CLOUD_PROJECT) ||
    normalizeString(env.GOOGLE_PROJECT_ID) ||
    normalizeString(env.GCP_PROJECT) ||
    normalizeString(env.GCLOUD_PROJECT) ||
    normalizeString(env.PROJECT_ID) ||
    normalizeString(credentials?.project_id),
  );
  return hasCredentialSource && hasProject;
}

export function hasSamsarModerationCredential(env = process.env) {
  return Boolean(
    normalizeString(env.SAMSAR_DEPLOYED_API_KEY) ||
    normalizeString(env.SAMSAR_EXTERNAL_API_KEY) ||
    normalizeString(env.SAMSAR_API_KEY),
  );
}

function getAvailableDockerModerationProviders(env = process.env) {
  return new Set([
    ...(hasOpenAIModerationCredential(env) ? [MODERATION_PROVIDERS.OPENAI] : []),
    ...(hasGoogleModerationCredential(env) ? [MODERATION_PROVIDERS.GOOGLE] : []),
    ...(hasSamsarModerationCredential(env) ? [MODERATION_PROVIDERS.SAMSAR] : []),
  ]);
}

export function isGoogleOnlyDeploymentProviderConfig({ env = process.env, availableModelConfig = null } = {}) {
  const providers = getConfiguredDeploymentProviders({ env, availableModelConfig });
  return providers.length === 1 && providers[0] === MODERATION_PROVIDERS.GOOGLE;
}

function isTextToVideoModerationRoute(routeType) {
  const normalized = normalizeString(routeType).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "text_to_video" || normalized === "t2v" || normalized === "vidgpt";
}

export function shouldUseGoogleModerationForInferenceContext({
  inferenceModel = null,
  routeType = null,
} = {}) {
  return isTextToVideoModerationRoute(routeType) && isGeminiInferenceModel(inferenceModel);
}

export function resolveModerationProvider({
  env = process.env,
  availableModelConfig = undefined,
  inferenceModel = null,
  routeType = null,
} = {}) {
  const explicitProvider = getExplicitModerationProvider(env);
  const useGoogleForInferenceContext = shouldUseGoogleModerationForInferenceContext({
    inferenceModel,
    routeType,
  });
  const useQwenInference = isQwenInferenceModel(inferenceModel);

  if (explicitProvider === MODERATION_PROVIDERS.DISABLED) {
    return MODERATION_PROVIDERS.DISABLED;
  }

  if (isDockerRuntime(env)) {
    const availableProviders = getAvailableDockerModerationProviders(env);

    // OpenRouter and Alibaba credentials provide Qwen inference, not a compatible
    // moderation endpoint. A hosted Docker Qwen render therefore uses a separately
    // configured OpenAI or Samsar-js moderation credential, or skips moderation.
    if (useQwenInference) {
      if (availableProviders.has(MODERATION_PROVIDERS.OPENAI)) {
        return MODERATION_PROVIDERS.OPENAI;
      }
      if (availableProviders.has(MODERATION_PROVIDERS.SAMSAR)) {
        return MODERATION_PROVIDERS.SAMSAR;
      }
      return MODERATION_PROVIDERS.DISABLED;
    }

    if (explicitProvider && availableProviders.has(explicitProvider)) {
      return explicitProvider;
    }
    if (useGoogleForInferenceContext && availableProviders.has(MODERATION_PROVIDERS.GOOGLE)) {
      return MODERATION_PROVIDERS.GOOGLE;
    }
    return [
      MODERATION_PROVIDERS.OPENAI,
      MODERATION_PROVIDERS.GOOGLE,
      MODERATION_PROVIDERS.SAMSAR,
    ].find((provider) => availableProviders.has(provider)) || MODERATION_PROVIDERS.DISABLED;
  }

  // The Samsar production deployment always owns an OpenAI moderation credential.
  // Qwen/OpenRouter is only the inference route and must not alter moderation.
  if (useQwenInference) {
    return MODERATION_PROVIDERS.OPENAI;
  }

  if (explicitProvider === MODERATION_PROVIDERS.GOOGLE) {
    return useGoogleForInferenceContext
      ? MODERATION_PROVIDERS.GOOGLE
      : MODERATION_PROVIDERS.OPENAI;
  }

  if (explicitProvider) {
    return explicitProvider;
  }

  if (useGoogleForInferenceContext) {
    return MODERATION_PROVIDERS.GOOGLE;
  }

  return MODERATION_PROVIDERS.OPENAI;
}

function warnMissingProviderOnce(provider, message) {
  if (missingProviderWarningLogged.has(provider)) {
    return;
  }
  missingProviderWarningLogged.add(provider);
  console.warn(message);
}

function createModerationError(message, {
  code = "MODERATION_ERROR",
  status = 500,
  retryable = undefined,
  cause = undefined,
} = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  error.statusCode = status;
  if (typeof retryable === "boolean") {
    error.retryable = retryable;
  }
  return error;
}

function getErrorStatus(error) {
  const status = Number(
    error?.status ||
    error?.statusCode ||
    error?.response?.status,
  );
  return Number.isFinite(status) ? status : null;
}

function isRetryableModerationError(error) {
  if (typeof error?.retryable === "boolean") {
    return error.retryable;
  }

  const status = getErrorStatus(error);
  if (status !== null) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  const code = normalizeString(error?.code || error?.cause?.code).toUpperCase();
  const errorName = normalizeString(error?.name);
  return [
    "ABORT_ERR",
    "ECONNABORTED",
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "MODERATION_TIMEOUT",
  ].includes(code) || [
    "APIConnectionError",
    "APIConnectionTimeoutError",
    "FetchError",
    "TimeoutError",
  ].includes(errorName);
}

function readHeader(headers, name) {
  if (!headers) {
    return "";
  }
  if (typeof headers.get === "function") {
    return normalizeString(headers.get(name));
  }
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return normalizeString(match?.[1]);
}

function getRetryAfterMs(error) {
  const rawValue =
    readHeader(error?.headers, "retry-after") ||
    readHeader(error?.response?.headers, "retry-after");
  if (!rawValue) {
    return 0;
  }

  const seconds = Number(rawValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }

  const retryDate = Date.parse(rawValue);
  return Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : 0;
}

export function getModerationRetryConfig(options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  return {
    timeoutMs: Math.min(
      MAX_MODERATION_TIMEOUT_MS,
      parsePositiveInteger(
        firstDefined(options.timeoutMs, env.MODERATION_TIMEOUT_MS),
        DEFAULT_MODERATION_TIMEOUT_MS,
      ),
    ),
    maxRetries: Math.min(
      DEFAULT_MODERATION_MAX_RETRIES,
      parseNonNegativeInteger(
        firstDefined(options.maxRetries, env.MODERATION_MAX_RETRIES),
        DEFAULT_MODERATION_MAX_RETRIES,
      ),
    ),
    retryBaseDelayMs: Math.min(
      MAX_MODERATION_RETRY_DELAY_MS,
      parsePositiveInteger(
        firstDefined(options.retryBaseDelayMs, env.MODERATION_RETRY_BASE_DELAY_MS),
        DEFAULT_MODERATION_RETRY_BASE_DELAY_MS,
      ),
    ),
    retryMaxDelayMs: Math.min(
      MAX_MODERATION_RETRY_DELAY_MS,
      parsePositiveInteger(
        firstDefined(options.retryMaxDelayMs, env.MODERATION_RETRY_MAX_DELAY_MS),
        DEFAULT_MODERATION_RETRY_MAX_DELAY_MS,
      ),
    ),
  };
}

function getProviderRetryConfig(provider, options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  const prefix = provider === MODERATION_PROVIDERS.GOOGLE
    ? "GOOGLE"
    : provider === MODERATION_PROVIDERS.SAMSAR
      ? "SAMSAR"
      : "OPENAI";
  return getModerationRetryConfig({
    ...options,
    timeoutMs: firstDefined(options.timeoutMs, env[`${prefix}_MODERATION_TIMEOUT_MS`]),
    maxRetries: firstDefined(options.maxRetries, env[`${prefix}_MODERATION_MAX_RETRIES`]),
    retryBaseDelayMs: firstDefined(
      options.retryBaseDelayMs,
      env[`${prefix}_MODERATION_RETRY_BASE_DELAY_MS`],
    ),
    retryMaxDelayMs: firstDefined(
      options.retryMaxDelayMs,
      env[`${prefix}_MODERATION_RETRY_MAX_DELAY_MS`],
    ),
  });
}

export function getModerationTotalTimeoutMs(options = {}) {
  const provider = normalizeProviderName(options.provider);
  const config = provider
    ? getProviderRetryConfig(provider, options)
    : getModerationRetryConfig(options);
  return (
    config.timeoutMs * (config.maxRetries + 1) +
    config.retryMaxDelayMs * config.maxRetries +
    parsePositiveInteger(
      options.timeoutBufferMs,
      DEFAULT_EXTERNAL_MODERATION_TIMEOUT_BUFFER_MS,
    )
  );
}

function sleepWithSignal(delayMs, signal, sleepFn) {
  if (sleepFn) {
    return sleepFn(delayMs);
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createModerationError("Moderation request was aborted.", {
        code: "ABORT_ERR",
        status: 499,
        retryable: false,
      }));
      return;
    }

    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(createModerationError("Moderation request was aborted.", {
        code: "ABORT_ERR",
        status: 499,
        retryable: false,
      }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runModerationWithRetry(operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("runModerationWithRetry requires an operation function.");
  }

  const config = getModerationRetryConfig(options);
  const totalAttempts = config.maxRetries + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutHandle = null;
    const onOuterAbort = () => controller.abort(options.signal?.reason);
    const cleanupAttempt = () => {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
      options.signal?.removeEventListener("abort", onOuterAbort);
    };

    if (options.signal?.aborted) {
      throw createModerationError("Moderation request was aborted.", {
        code: "ABORT_ERR",
        status: 499,
        retryable: false,
      });
    }
    options.signal?.addEventListener("abort", onOuterAbort, { once: true });

    const timeoutError = createModerationError(
      `Moderation provider timed out after ${config.timeoutMs}ms.`,
      {
        code: "MODERATION_TIMEOUT",
        status: 504,
        retryable: true,
      },
    );
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(timeoutError);
        controller.abort(timeoutError);
      }, config.timeoutMs);
    });

    try {
      return await Promise.race([
        Promise.resolve().then(() => operation({
          attempt,
          signal: controller.signal,
          timeoutMs: config.timeoutMs,
        })),
        timeoutPromise,
      ]);
    } catch (error) {
      cleanupAttempt();
      lastError = timedOut ? timeoutError : error;
      try {
        lastError.moderationAttempts = attempt;
      } catch {
        // Preserve non-extensible provider errors as-is.
      }

      if (
        options.signal?.aborted ||
        attempt >= totalAttempts ||
        !isRetryableModerationError(lastError)
      ) {
        throw lastError;
      }

      const exponentialDelayMs = config.retryBaseDelayMs * (2 ** (attempt - 1));
      const delayMs = Math.min(
        config.retryMaxDelayMs,
        Math.max(exponentialDelayMs, getRetryAfterMs(lastError)),
      );
      if (typeof options.onRetry === "function") {
        options.onRetry({
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          error: lastError,
        });
      } else if (options.logRetries !== false) {
        console.warn("Retrying moderation provider request.", {
          provider: options.provider || null,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          status: getErrorStatus(lastError),
          code: lastError?.code || null,
        });
      }
      await sleepWithSignal(delayMs, options.signal, options.sleep);
    } finally {
      cleanupAttempt();
    }
  }

  throw lastError;
}

async function runSingleModerationRequest(operation, {
  timeoutMs,
  signal: outerSignal,
} = {}) {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(outerSignal?.reason);
  let timeoutHandle = null;
  let timedOut = false;

  if (outerSignal?.aborted) {
    throw createModerationError("Moderation request was aborted.", {
      code: "ABORT_ERR",
      status: 499,
      retryable: false,
    });
  }
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });

  const timeoutError = createModerationError(
    `Moderation provider timed out after ${timeoutMs}ms.`,
    {
      code: "MODERATION_TIMEOUT",
      status: 504,
      retryable: false,
    },
  );
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({ signal: controller.signal })),
      timeoutPromise,
    ]);
  } catch (error) {
    const resolvedError = timedOut ? timeoutError : error;
    try {
      resolvedError.moderationAttempts = 1;
    } catch {
      // Preserve non-extensible provider errors as-is.
    }
    throw resolvedError;
  } finally {
    clearTimeout(timeoutHandle);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

function requireModerationResponse(moderation) {
  if (
    !Array.isArray(moderation?.results) ||
    moderation.results.length === 0 ||
    moderation.results.some((result) => (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      typeof result.flagged !== "boolean" ||
      !result.categories ||
      typeof result.categories !== "object" ||
      Array.isArray(result.categories) ||
      !result.category_scores ||
      typeof result.category_scores !== "object" ||
      Array.isArray(result.category_scores)
    ))
  ) {
    throw createModerationError("Moderation provider returned no results.", {
      code: "MODERATION_INVALID_RESPONSE",
      status: 502,
      retryable: true,
    });
  }
  return moderation;
}

function createOpenAIClient(apiKey) {
  return new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: DEFAULT_MODERATION_TIMEOUT_MS,
  });
}

export async function createNativeOpenAIModeration(requestData, options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  const apiKey = normalizeString(options.apiKey) || normalizeString(env.OPENAI_API_KEY);
  // Do not retain a shared SDK transport across unrelated renders. A poisoned or
  // stale transport must be isolated to one bounded moderation operation.
  const openAIClient = options.openaiClient || (apiKey ? createOpenAIClient(apiKey) : null);
  if (!openAIClient) {
    throw createModerationError("Native OpenAI moderation is not configured.", {
      code: "MODERATION_PROVIDER_UNAVAILABLE",
      status: 503,
      retryable: false,
    });
  }

  const retryConfig = getProviderRetryConfig(MODERATION_PROVIDERS.OPENAI, options);
  const model = normalizeString(options.model) ||
    normalizeString(env.OPENAI_MODERATION_MODEL) ||
    DEFAULT_OPENAI_MODERATION_MODEL;

  return runModerationWithRetry(
    async ({ signal, timeoutMs }) => requireModerationResponse(
      await openAIClient.moderations.create(
        { input: requestData, model },
        { signal, timeout: timeoutMs, maxRetries: 0 },
      ),
    ),
    {
      ...retryConfig,
      signal: options.signal,
      sleep: options.sleep,
      onRetry: options.onRetry,
      logRetries: options.logRetries,
      provider: MODERATION_PROVIDERS.OPENAI,
    },
  );
}

async function createGoogleModerationWithRetry(requestData, options = {}) {
  const retryConfig = getProviderRetryConfig(MODERATION_PROVIDERS.GOOGLE, options);
  return runModerationWithRetry(
    async ({ signal, timeoutMs }) => {
      try {
        return requireModerationResponse(
          await createGoogleModerationForNarrative(requestData, {
            ...options,
            signal,
            timeoutMs,
          }),
        );
      } catch (error) {
        const message = normalizeString(error?.message);
        if (
          getErrorStatus(error) === null &&
          !message.includes("requires GOOGLE_CLOUD_PROJECT")
        ) {
          error.retryable = true;
        }
        throw error;
      }
    },
    {
      ...retryConfig,
      signal: options.signal,
      sleep: options.sleep,
      onRetry: options.onRetry,
      logRetries: options.logRetries,
      provider: MODERATION_PROVIDERS.GOOGLE,
    },
  );
}

async function createSamsarModeration(requestData, options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  const apiKey = normalizeString(options.samsarApiKey) ||
    normalizeString(env.SAMSAR_DEPLOYED_API_KEY) ||
    normalizeString(env.SAMSAR_EXTERNAL_API_KEY) ||
    normalizeString(env.SAMSAR_API_KEY);
  if (!apiKey && !options.samsarClient) {
    throw createModerationError("Samsar external moderation is not configured.", {
      code: "MODERATION_PROVIDER_UNAVAILABLE",
      status: 503,
      retryable: false,
    });
  }

  // The hosted endpoint owns the three native OpenAI retries. The Docker caller
  // makes one bounded request so retries cannot multiply into sixteen calls.
  const requestTimeoutMs = Math.min(
    MAX_SAMSAR_EXTERNAL_MODERATION_REQUEST_TIMEOUT_MS,
    parsePositiveInteger(
      firstDefined(
        options.samsarRequestTimeoutMs,
        env.SAMSAR_EXTERNAL_MODERATION_REQUEST_TIMEOUT_MS,
      ),
      DEFAULT_SAMSAR_EXTERNAL_MODERATION_REQUEST_TIMEOUT_MS,
    ),
  );
  const client = options.samsarClient || await createDeployedSamsarClient({
    apiKey,
    baseUrl:
      normalizeString(env.SAMSAR_JS_API_URL) ||
      normalizeString(env.SAMSAR_API_URL) ||
      undefined,
    timeoutMs: requestTimeoutMs,
  });

  return runSingleModerationRequest(
    async ({ signal }) => {
      const result = typeof client.createExternalModeration === "function"
        ? await client.createExternalModeration({ input: requestData }, { signal })
        : await client.postV2("external/moderation", { input: requestData }, { signal });
      return requireModerationResponse(result?.data || result);
    },
    {
      timeoutMs: requestTimeoutMs,
      signal: options.signal,
    },
  );
}

async function createModerationWithProvider(provider, requestData, options = {}) {
  if (provider === MODERATION_PROVIDERS.GOOGLE) {
    return createGoogleModerationWithRetry(requestData, options);
  }
  if (provider === MODERATION_PROVIDERS.SAMSAR) {
    return createSamsarModeration(requestData, options);
  }
  if (provider === MODERATION_PROVIDERS.DISABLED) {
    return null;
  }
  return createNativeOpenAIModeration(requestData, options);
}

export function getModerationDecision(moderationResult, options = {}) {
  if (!moderationResult) {
    return { safe: false, reason: "missing_result" };
  }
  const rejectScoreThreshold = getModerationRejectScoreThreshold(options.provider);

  const categories = moderationResult.categories || {};
  const flaggedCategories = Object
    .entries(categories)
    .filter(([, flagged]) => flagged === true)
    .map(([category]) => category);

  if (moderationResult.flagged === true || flaggedCategories.length > 0) {
    return {
      safe: false,
      reason: "flagged",
      categories: flaggedCategories,
    };
  }

  const categoryScores = moderationResult.category_scores || {};
  const highScoreCategories = Object
    .entries(categoryScores)
    .filter(([, score]) => {
      const normalizedScore = Number(score);
      return Number.isFinite(normalizedScore) && normalizedScore >= rejectScoreThreshold;
    })
    .map(([category]) => category);

  if (highScoreCategories.length > 0) {
    return {
      safe: false,
      reason: "category_score",
      categories: highScoreCategories,
      threshold: rejectScoreThreshold,
    };
  }

  return { safe: true, reason: "passed" };
}

export function getModerationResponseDecision(moderation, options = {}) {
  if (!Array.isArray(moderation?.results) || moderation.results.length === 0) {
    return { safe: false, reason: "missing_result" };
  }

  for (const result of moderation.results) {
    const decision = getModerationDecision(result, options);
    if (!decision.safe) {
      return decision;
    }
  }
  return { safe: true, reason: "passed" };
}

export async function createModerationForImage() {
  // Reserved for image-specific moderation.
}

export async function createModerationForVideo() {
  // Reserved for video-specific moderation.
}

export async function getModerationForNarrative(requestData, options = {}) {
  const provider = resolveModerationProvider(options);
  const sessionId = normalizeString(options.sessionId);

  if (provider === MODERATION_PROVIDERS.DISABLED) {
    warnMissingProviderOnce(
      MODERATION_PROVIDERS.DISABLED,
      "No configured moderation endpoint is available; skipping moderation.",
    );
    return true;
  }

  const startedAt = Date.now();
  const totalTimeoutMs = parsePositiveInteger(
    firstDefined(
      options.totalTimeoutMs,
      options.env?.MODERATION_TOTAL_TIMEOUT_MS,
      process.env.MODERATION_TOTAL_TIMEOUT_MS,
    ),
    getModerationTotalTimeoutMs({ ...options, provider }),
  );

  if (sessionId) {
    console.info("[moderation] request_start", {
      sessionId,
      provider,
      inferenceModel: normalizeString(options.inferenceModel) || null,
      timeoutMs: totalTimeoutMs,
    });
  }

  try {
    const moderation = await runSingleModerationRequest(
      ({ signal }) => typeof options.moderationCall === "function"
        ? options.moderationCall(provider, requestData, { ...options, signal })
        : createModerationWithProvider(provider, requestData, { ...options, signal }),
      {
        timeoutMs: totalTimeoutMs,
        signal: options.signal,
      },
    );
    const decision = getModerationResponseDecision(moderation, { provider });
    if (sessionId) {
      console.info("[moderation] request_complete", {
        sessionId,
        provider,
        safe: decision.safe,
        reason: decision.reason,
        durationMs: Date.now() - startedAt,
      });
    }
    return decision.safe;
  } catch (error) {
    console.error("ERROR IN MODERATION", {
      sessionId: sessionId || null,
      provider,
      message: error?.message || error,
      status: getErrorStatus(error),
      code: error?.code || null,
      attempts: error?.moderationAttempts || null,
      durationMs: Date.now() - startedAt,
    });
    return false;
  }
}
