const DEFAULT_ALIBABA_IMAGE_GENERATION_URL =
  'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const ALIBABA_IMAGE_GENERATION_PATH =
  '/api/v1/services/aigc/multimodal-generation/generation';
const DEFAULT_ALIBABA_IMAGE_TIMEOUT_MS = 180000;
const ALIBABA_API_KEY_NAMES = Object.freeze([
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureHttpsUrl(value) {
  const configured = normalizeString(value);
  if (!configured) {
    return null;
  }
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(configured)
    ? configured
    : `https://${configured}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== 'https:') {
    throw new Error('Alibaba Cloud image generation endpoint must use HTTPS.');
  }
  return parsed;
}

function normalizeAlibabaImageGenerationUrl(value) {
  const parsed = ensureHttpsUrl(value);
  if (!parsed) {
    return '';
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  if (normalizedPath.endsWith(ALIBABA_IMAGE_GENERATION_PATH)) {
    return `${parsed.origin}${normalizedPath}`;
  }

  const compatibleModeIndex = normalizedPath.toLowerCase().indexOf('/compatible-mode');
  const apiV1Index = normalizedPath.toLowerCase().indexOf('/api/v1');
  const versionV1Index = normalizedPath.toLowerCase().endsWith('/v1')
    ? normalizedPath.length - 3
    : -1;
  let prefix = normalizedPath;
  if (compatibleModeIndex >= 0) {
    prefix = normalizedPath.slice(0, compatibleModeIndex);
  } else if (apiV1Index >= 0) {
    prefix = normalizedPath.slice(0, apiV1Index);
  } else if (versionV1Index >= 0) {
    prefix = normalizedPath.slice(0, versionV1Index);
  }
  prefix = prefix.replace(/\/+$/, '');

  return `${parsed.origin}${prefix}${ALIBABA_IMAGE_GENERATION_PATH}`;
}

export function getAlibabaImageApiKey(env = process.env) {
  for (const key of ALIBABA_API_KEY_NAMES) {
    const value = normalizeString(env?.[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

export function getAlibabaImageGenerationUrl(env = process.env) {
  const configuredEndpoint = normalizeString(
    env?.ALIBABA_IMAGE_GENERATION_URL ||
    env?.DASHSCOPE_IMAGE_GENERATION_URL ||
    env?.ALIBABA_WAN_IMAGE_GENERATION_URL,
  );
  if (configuredEndpoint) {
    return normalizeAlibabaImageGenerationUrl(configuredEndpoint);
  }

  const configuredBase = normalizeString(
    env?.ALIBABA_IMAGE_BASE_URL ||
    env?.DASHSCOPE_IMAGE_BASE_URL ||
    env?.ALIBABA_API_HOST ||
    env?.DASHSCOPE_BASE_URL ||
    env?.ALIBABA_CLOUD_BASE_URL,
  );
  return configuredBase
    ? normalizeAlibabaImageGenerationUrl(configuredBase)
    : DEFAULT_ALIBABA_IMAGE_GENERATION_URL;
}

export function extractAlibabaImageUrl(responseBody = {}) {
  const choices = Array.isArray(responseBody?.output?.choices)
    ? responseBody.output.choices
    : [];

  for (const choice of choices) {
    const content = Array.isArray(choice?.message?.content)
      ? choice.message.content
      : [];
    for (const part of content) {
      const imageUrl = normalizeString(part?.image || part?.image_url || part?.url);
      if (imageUrl) {
        return imageUrl;
      }
    }
  }
  return '';
}

function createProviderError(message, metadata = {}) {
  const error = new Error(message);
  Object.assign(error, metadata);
  return error;
}

function markProviderSubmissionPhase(error, {
  attempted = false,
  responseReceived = false,
} = {}) {
  if (!error || typeof error !== 'object') {
    return error;
  }
  if (error.providerSubmissionAttempted === undefined) {
    error.providerSubmissionAttempted = attempted;
  }
  if (error.providerResponseReceived === undefined) {
    error.providerResponseReceived = responseReceived;
  }
  return error;
}

function getRetryAfterMs(response) {
  const retryAfter = normalizeString(response?.headers?.get?.('retry-after'));
  if (!retryAfter) {
    return null;
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const retryAt = Date.parse(retryAfter);
  if (!Number.isFinite(retryAt)) {
    return null;
  }
  return Math.max(0, retryAt - Date.now());
}

export function isAlibabaImageInfrastructureError(error) {
  const status = Number(error?.status || error?.statusCode);
  if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) {
    return true;
  }
  const message = normalizeString(error?.message).toLowerCase();
  return [
    'api key',
    'authentication',
    'unauthorized',
    'forbidden',
    'quota',
    'rate limit',
    'timed out',
    'timeout',
    'unable to reach',
    'fetch failed',
  ].some((pattern) => message.includes(pattern));
}

async function readJsonResponse(response, providerName) {
  const responseText = typeof response?.text === 'function'
    ? await response.text()
    : '';
  if (!responseText) {
    return {};
  }
  try {
    return JSON.parse(responseText);
  } catch {
    throw createProviderError(`${providerName} returned an invalid JSON response.`, {
      status: response?.status,
    });
  }
}

export async function requestAlibabaImageGeneration(requestBody, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const providerName = normalizeString(options.providerName) || 'Alibaba Cloud image generation';
  const apiKey = getAlibabaImageApiKey(env);
  if (!apiKey) {
    throw createProviderError(
      `${providerName} requires ALIBABA_API_KEY, DASHSCOPE_API_KEY, ALIBABA_CLOUD_API_KEY, or QWEN_API_KEY.`,
      {
        status: 401,
        providerSubmissionAttempted: false,
        providerResponseReceived: false,
      },
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw createProviderError(`This runtime cannot call ${providerName} because fetch is unavailable.`, {
      providerSubmissionAttempted: false,
      providerResponseReceived: false,
    });
  }

  let requestUrl;
  try {
    requestUrl = getAlibabaImageGenerationUrl(env);
  } catch (error) {
    throw markProviderSubmissionPhase(error, {
      attempted: false,
      responseReceived: false,
    });
  }

  const timeoutMs = Math.max(
    1000,
    Number(options.timeoutMs ?? env?.ALIBABA_IMAGE_GENERATION_TIMEOUT_MS) ||
      DEFAULT_ALIBABA_IMAGE_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let submissionAttempted = false;
  let responseReceived = false;

  try {
    submissionAttempted = true;
    const response = await fetchImpl(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
      ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
    });
    responseReceived = true;
    const responseBody = await readJsonResponse(response, providerName);

    if (!response?.ok || responseBody?.code) {
      const retryAfterMs = getRetryAfterMs(response);
      throw createProviderError(
        normalizeString(responseBody?.message) ||
          `${providerName} failed with status ${response?.status || 'unknown'}.`,
        {
          status: response?.status,
          providerCode: responseBody?.code,
          providerRequestId: responseBody?.request_id,
          ...(retryAfterMs !== null ? { retryAfterMs } : {}),
        },
      );
    }

    const imageUrl = extractAlibabaImageUrl(responseBody);
    if (!imageUrl) {
      throw createProviderError(`${providerName} returned no image URL.`, {
        providerRequestId: responseBody?.request_id,
      });
    }

    return {
      imageUrl,
      requestId: normalizeString(responseBody?.request_id),
      usage: responseBody?.usage || null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createProviderError(`${providerName} request timed out.`, {
        status: 408,
        providerSubmissionAttempted: true,
        providerResponseReceived: false,
      });
    }
    throw markProviderSubmissionPhase(error, {
      attempted: submissionAttempted,
      responseReceived,
    });
  } finally {
    clearTimeout(timeout);
  }
}
