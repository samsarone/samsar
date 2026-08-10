import OpenAI from 'openai';

import { normalizeProviderMediaUrl } from '../ai_video/utils/AWS.js';
import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';
import { KIMI_K3_INFERENCE_MODEL } from './GoogleGemini.js';

export const KIMI_K3_BASE_URL = 'https://api.moonshot.ai/v1';
export const KIMI_K3_REASONING_EFFORT = 'high';
export const KIMI_K3_MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024;

const DEFAULT_KIMI_K3_TIMEOUT_MS = 10 * 60 * 1000;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

let cachedClient = null;
let cachedClientKey = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function assertKimiK3RequestBodySize(
  payload,
  maxRequestBodyBytes = KIMI_K3_MAX_REQUEST_BODY_BYTES,
) {
  const serializedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (serializedBytes >= maxRequestBodyBytes) {
    throw new Error('Kimi K3 request body must be smaller than 100 MB.');
  }
  return serializedBytes;
}

export function getKimiK3ApiKey(env = process.env) {
  return normalizeString(env?.KIMI_K3_API_KEY);
}

export function hasKimiK3ApiKey(env = process.env) {
  return Boolean(getKimiK3ApiKey(env));
}

function getKimiK3Client() {
  const apiKey = getKimiK3ApiKey();
  if (!apiKey) {
    throw new Error('KIMI_K3_API_KEY is required for native Kimi K3 inference.');
  }
  if (!cachedClient || cachedClientKey !== apiKey) {
    cachedClient = new OpenAI({
      apiKey,
      baseURL: KIMI_K3_BASE_URL,
    });
    cachedClientKey = apiKey;
  }
  return cachedClient;
}

function parseDataUrl(value) {
  const match = normalizeString(value).match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mimeType: normalizeString(match[1]).toLowerCase(),
    dataUrl: normalizeString(value),
  };
}

function inferImageMimeType(contentType, imageUrl) {
  const normalizedContentType = normalizeString(contentType).split(';')[0].toLowerCase();
  if (normalizedContentType === 'image/jpg') return 'image/jpeg';
  if (SUPPORTED_IMAGE_MIME_TYPES.has(normalizedContentType)) {
    return normalizedContentType;
  }
  try {
    const pathname = new URL(imageUrl).pathname.toLowerCase();
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
  } catch {}
  return 'image/png';
}

async function inlineImageUrl(imageUrl, fetchImpl, cache) {
  const normalizedUrl = normalizeString(imageUrl);
  const dataUrl = parseDataUrl(normalizedUrl);
  if (dataUrl) {
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(dataUrl.mimeType)) {
      throw new Error(`Kimi K3 does not support ${dataUrl.mimeType || 'this image type'}.`);
    }
    return dataUrl.dataUrl;
  }
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    throw new Error('Kimi K3 vision input must resolve to an HTTP(S) URL or image data URL.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is required to prepare Kimi K3 vision input.');
  }
  if (!cache.has(normalizedUrl)) {
    cache.set(normalizedUrl, (async () => {
      const response = await fetchImpl(normalizedUrl, { redirect: 'follow' });
      if (!response?.ok) {
        throw new Error(`Unable to download Kimi K3 vision input (HTTP ${response?.status || 'unknown'}).`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const mimeType = inferImageMimeType(
        response.headers?.get?.('content-type'),
        normalizedUrl,
      );
      return `data:${mimeType};base64,${bytes.toString('base64')}`;
    })());
  }
  return cache.get(normalizedUrl);
}

function normalizeInlineImageReference(value, defaultMimeType = 'image/png') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const data = normalizeString(value.data || value.base64);
  if (!data) return value;
  const mimeType = normalizeString(
    value.media_type || value.mime_type || value.mimeType,
  ) || defaultMimeType;
  return `data:${mimeType};base64,${data}`;
}

async function normalizeImagePart(part, fetchImpl, cache) {
  const source = normalizeInlineImageReference(
    part.image_url ?? part.imageUrl ?? part.image ?? part.url ?? part.uri ?? part.source,
  );
  const descriptor = source && typeof source === 'object' && !Array.isArray(source)
    ? source
    : {};
  const rawUrl = typeof source === 'string'
    ? source
    : descriptor.url ?? descriptor.uri ?? descriptor.source ?? descriptor.src ?? '';
  const imageUrl = await inlineImageUrl(rawUrl, fetchImpl, cache);
  return {
    type: 'image_url',
    image_url: { url: imageUrl },
  };
}

async function normalizeContentPart(part, fetchImpl, cache) {
  if (!part || typeof part !== 'object' || Array.isArray(part)) {
    return part;
  }
  const type = normalizeString(part.type).toLowerCase().replace(/[\s-]+/g, '_');
  if (type === 'input_text' || type === 'output_text') {
    return { type: 'text', text: part.text || '' };
  }
  if (type === 'image_url' || type === 'input_image' || type === 'image') {
    return normalizeImagePart(part, fetchImpl, cache);
  }
  return { ...part };
}

async function normalizeMessages(messages, fetchImpl) {
  const cache = new Map();
  const sourceMessages = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : Array.isArray(messages) ? messages : [];
  return Promise.all(sourceMessages.map(async (message) => {
    if (!message || typeof message !== 'object') return message;
    const content = Array.isArray(message.content)
      ? await Promise.all(
        message.content.map((part) => normalizeContentPart(part, fetchImpl, cache)),
      )
      : message.content;
    return {
      ...message,
      role: message.role === 'developer' ? 'system' : message.role,
      content,
    };
  }));
}

function normalizeResponseFormat(responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object' || Array.isArray(responseFormat)) {
    return undefined;
  }
  if (normalizeString(responseFormat.type).toLowerCase() !== 'json_schema') {
    return { ...responseFormat };
  }
  return {
    ...responseFormat,
    json_schema: {
      ...(responseFormat.json_schema || {}),
      strict: true,
    },
  };
}

function normalizeResponsesInput(input) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (!Array.isArray(input)) return [];
  if (input.every((item) => item && typeof item === 'object' && item.role)) {
    return input;
  }
  return [{ role: 'user', content: input }];
}

export async function buildKimiK3ChatCompletionPayload(
  chatRequest = {},
  {
    fetchImpl = globalThis.fetch,
    resolveMediaUrl = normalizeProviderMediaUrl,
  } = {},
) {
  const {
    authorization,
    bypassSamsarExternalInference,
    effort,
    externalMaxRetries,
    frequency_penalty,
    inference_model,
    inferenceModel,
    input,
    max_completion_tokens,
    max_output_tokens,
    max_tokens,
    maxRetries,
    messages: rawMessages,
    model,
    n,
    presence_penalty,
    provider_options,
    providerOptions,
    reasoning,
    reasoning_effort,
    reasoningEffort,
    response_format: rawResponseFormat,
    samsarExternalInference,
    temperature,
    timeout,
    timeoutMs,
    top_p,
    ...request
  } = chatRequest || {};
  const sourceMessages = Array.isArray(rawMessages)
    ? rawMessages
    : normalizeResponsesInput(input);
  const resolvedPayload = await normalizeProviderMediaPayload(
    { messages: sourceMessages },
    resolveMediaUrl,
  );
  const messages = await normalizeMessages(resolvedPayload.messages, fetchImpl);
  const responseFormat = normalizeResponseFormat(rawResponseFormat);
  const completionLimit = normalizePositiveInteger(
    max_completion_tokens ?? max_output_tokens ?? max_tokens,
    null,
  );

  const payload = {
    ...request,
    model: KIMI_K3_INFERENCE_MODEL,
    messages,
    reasoning_effort: KIMI_K3_REASONING_EFFORT,
    ...(completionLimit ? { max_completion_tokens: completionLimit } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
  assertKimiK3RequestBodySize(payload);
  return payload;
}

export async function createKimiK3ChatCompletion(
  chatRequest = {},
  dependencyOverrides = {},
) {
  const client = dependencyOverrides.client || getKimiK3Client();
  const timeout = normalizePositiveInteger(
    chatRequest.timeout ?? chatRequest.timeoutMs ?? process.env.KIMI_K3_INFERENCE_TIMEOUT_MS,
    DEFAULT_KIMI_K3_TIMEOUT_MS,
  );
  const payload = await buildKimiK3ChatCompletionPayload(
    chatRequest,
    dependencyOverrides,
  );
  return client.chat.completions.create(payload, {
    timeout,
    maxRetries: 0,
  });
}
