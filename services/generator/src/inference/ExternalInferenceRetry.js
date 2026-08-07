const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 5000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

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

function getStatus(error) {
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
    if (Number.isInteger(status) && status > 0) return status;
    current = current.cause;
  }
  return null;
}

function getCode(error) {
  return normalizeString(error?.code || error?.cause?.code).toUpperCase();
}

function isRetryable(error) {
  const status = getStatus(error);
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
    return status === 425 || status === 429;
  }
  if ([
    'EAI_AGAIN',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT',
  ].includes(getCode(error))) {
    return true;
  }
  return false;
}

function getRetryAfterMs(error) {
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

function getDelayMs(retryNumber, error) {
  const baseDelayMs = normalizePositiveInteger(
    process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_BASE_DELAY_MS,
  );
  const maxDelayMs = Math.max(
    baseDelayMs,
    normalizePositiveInteger(
      process.env.SAMSAR_EXTERNAL_INFERENCE_RETRY_MAX_DELAY_MS,
      DEFAULT_RETRY_MAX_DELAY_MS,
    ),
  );
  const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, retryNumber - 1)));
  return Math.max(exponentialDelayMs, getRetryAfterMs(error) ?? 0);
}

function createTimeoutError(timeoutMs) {
  const error = new Error(`External inference timed out after ${timeoutMs}ms.`);
  error.name = 'ExternalInferenceTimeoutError';
  error.code = 'ETIMEDOUT';
  error.status = 504;
  return error;
}

async function runAttempt(operation, timeoutMs, attempt, maxAttempts) {
  const effectiveTimeoutMs = normalizePositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = createTimeoutError(effectiveTimeoutMs);
      controller.abort(error);
      reject(error);
    }, effectiveTimeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation({ signal: controller.signal, attempt, maxAttempts })),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runExternalInferenceWithRetry(operation, {
  provider = 'external',
  model = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  logger = console,
} = {}) {
  const retryLimit = normalizeNonNegativeInteger(
    maxRetries,
    normalizeNonNegativeInteger(
      process.env.SAMSAR_EXTERNAL_INFERENCE_MAX_RETRIES,
      DEFAULT_MAX_RETRIES,
    ),
  );
  const maxAttempts = retryLimit + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runAttempt(operation, timeoutMs, attempt, maxAttempts);
    } catch (error) {
      const willRetry = isRetryable(error) && attempt < maxAttempts;
      const context = {
        provider,
        model,
        attempt,
        maxAttempts,
        status: getStatus(error),
        code: getCode(error) || null,
        message: error?.message || String(error),
        willRetry,
      };
      logger.error?.('[external_inference] request failed', context);
      if (!willRetry) throw error;

      const delayMs = getDelayMs(attempt, error);
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
