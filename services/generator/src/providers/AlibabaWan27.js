import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import { buildAlibabaWan27Request } from './Wan27Payload.js';

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

export function getAlibabaWan27ApiKey(env = process.env) {
  for (const key of ALIBABA_API_KEY_NAMES) {
    const value = normalizeString(env?.[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

export function getAlibabaWan27GenerationUrl(env = process.env) {
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

export function extractAlibabaWan27ImageUrl(responseBody = {}) {
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

export function isAlibabaWan27InfrastructureError(error) {
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

function markAsNonPromptProviderFailure(error) {
  error.nonPromptProviderFailure = true;
  error.preserveExpressImageLayer = true;
  return error;
}

async function readJsonResponse(response) {
  const responseText = typeof response?.text === 'function'
    ? await response.text()
    : '';
  if (!responseText) {
    return {};
  }
  try {
    return JSON.parse(responseText);
  } catch {
    throw createProviderError('Alibaba Wan2.7 Pro returned an invalid JSON response.', {
      status: response?.status,
    });
  }
}

export async function requestAlibabaWan27Image(payload = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = getAlibabaWan27ApiKey(env);
  if (!apiKey) {
    throw createProviderError(
      'Alibaba Wan2.7 Pro requires ALIBABA_API_KEY, DASHSCOPE_API_KEY, ALIBABA_CLOUD_API_KEY, or QWEN_API_KEY.',
      { status: 401 },
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw createProviderError('This runtime cannot call Alibaba Wan2.7 Pro because fetch is unavailable.');
  }

  const timeoutMs = Math.max(
    1000,
    Number(env?.ALIBABA_IMAGE_GENERATION_TIMEOUT_MS) || DEFAULT_ALIBABA_IMAGE_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(getAlibabaWan27GenerationUrl(env), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(buildAlibabaWan27Request(payload)),
      signal: controller.signal,
    });
    const responseBody = await readJsonResponse(response);

    if (!response?.ok || responseBody?.code) {
      throw createProviderError(
        normalizeString(responseBody?.message) ||
          `Alibaba Wan2.7 Pro failed with status ${response?.status || 'unknown'}.`,
        {
          status: response?.status,
          providerCode: responseBody?.code,
          providerRequestId: responseBody?.request_id,
        },
      );
    }

    const imageUrl = extractAlibabaWan27ImageUrl(responseBody);
    if (!imageUrl) {
      throw createProviderError('Alibaba Wan2.7 Pro returned no image URL.', {
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
      throw createProviderError('Alibaba Wan2.7 Pro request timed out.', { status: 408 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleAlibabaWan27Request(payload = {}) {
  const { _id } = payload;
  const providerStatus = normalizeString(payload.apiGenerationStatus || 'INIT').toUpperCase();
  if (providerStatus === 'FAILED') {
    return { image: null };
  }
  if (providerStatus !== 'INIT') {
    return null;
  }

  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const result = await requestAlibabaWan27Image(payload);
    const imageName = await saveRemoteFile(result.imageUrl);

    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: result.requestId || `alibaba-wan27:${Date.now()}`,
        apiGenerationStatus: 'COMPLETED',
        generationStatus: 'COMPLETED',
        externalProvider: 'alibabaCloud',
        rowLocked: false,
      },
    );

    return {
      image: imageName,
      provider: 'alibabaCloud',
      providerRequestId: result.requestId,
    };
  } catch (error) {
    const message = error?.message || 'Alibaba Wan2.7 Pro generation failed.';
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        generationError: message,
        rowLocked: false,
      },
    );

    if (isAlibabaWan27InfrastructureError(error)) {
      throw markAsNonPromptProviderFailure(error);
    }
    return { image: null, error: message };
  }
}
