import OpenAI from 'openai';

import {
  KIMI_K3_INFERENCE_MODEL,
} from './InferenceModels.js';

export const KIMI_K3_BASE_URL = 'https://api.moonshot.ai/v1';
export const KIMI_K3_REASONING_EFFORT = 'high';

const DEFAULT_KIMI_K3_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_KIMI_K3_REQUEST_BODY_BYTES = 100 * 1024 * 1024;
const IMAGE_MIME_TYPES = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

let cachedClient = null;
let cachedClientKey = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function normalizeImageMimeType(contentType, imageUrl) {
  const normalizedContentType = normalizeString(contentType).split(';')[0].toLowerCase();
  if (normalizedContentType === 'image/jpg') return 'image/jpeg';
  if (Object.values(IMAGE_MIME_TYPES).includes(normalizedContentType)) {
    return normalizedContentType;
  }
  try {
    const pathname = new URL(imageUrl).pathname.toLowerCase();
    const extension = Object.keys(IMAGE_MIME_TYPES).find((candidate) => pathname.endsWith(candidate));
    if (extension) return IMAGE_MIME_TYPES[extension];
  } catch {}
  return 'image/png';
}

async function downloadImageAsDataUrl(imageUrl, fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is required to convert Kimi K3 image URLs.');
  }
  const response = await fetchImpl(imageUrl, { redirect: 'follow' });
  if (!response?.ok) {
    const status = Number(response?.status);
    throw new Error(
      `Unable to download Kimi K3 vision input${Number.isInteger(status) ? ` (HTTP ${status})` : ''}.`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length >= MAX_KIMI_K3_REQUEST_BODY_BYTES) {
    throw new Error('Kimi K3 vision input must be smaller than the 100 MB request limit.');
  }
  const mimeType = normalizeImageMimeType(response.headers?.get?.('content-type'), imageUrl);
  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
  if (Buffer.byteLength(dataUrl, 'utf8') >= MAX_KIMI_K3_REQUEST_BODY_BYTES) {
    throw new Error('Kimi K3 vision input must keep the encoded request below 100 MB.');
  }
  return dataUrl;
}

async function normalizeImageUrl(imageUrl, fetchImpl, downloadCache) {
  const normalizedUrl = normalizeString(imageUrl);
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    return imageUrl;
  }
  if (!downloadCache.has(normalizedUrl)) {
    downloadCache.set(normalizedUrl, downloadImageAsDataUrl(normalizedUrl, fetchImpl));
  }
  return downloadCache.get(normalizedUrl);
}

function normalizeInlineImageReference(value, defaultMimeType = 'image/png') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const data = normalizeString(value.data || value.base64);
  if (!data) return value;
  const mimeType = normalizeString(value.media_type || value.mime_type) || defaultMimeType;
  return `data:${mimeType};base64,${data}`;
}

async function normalizeImagePart(part, fetchImpl, downloadCache) {
  const source = normalizeInlineImageReference(
    part.image_url ?? part.imageUrl ?? part.image ?? part.url ?? part.uri ?? part.source,
  );
  if (typeof source === 'string') {
    const normalizedUrl = await normalizeImageUrl(source, fetchImpl, downloadCache);
    const { detail: _detail, imageUrl: _imageUrl, image: _image, url: _url, uri: _uri, source: _source, ...rest } = part;
    return {
      ...rest,
      type: 'image_url',
      image_url: { url: normalizedUrl },
    };
  }

  const descriptor = source && typeof source === 'object' && !Array.isArray(source)
    ? source
    : {};
  const rawUrl = descriptor.url ?? descriptor.uri ?? descriptor.source ?? descriptor.src ?? descriptor.href ?? '';
  const normalizedUrl = await normalizeImageUrl(rawUrl, fetchImpl, downloadCache);
  const {
    detail: _descriptorDetail,
    uri: _descriptorUri,
    source: _descriptorSource,
    src: _descriptorSrc,
    href: _descriptorHref,
    ...descriptorRest
  } = descriptor;
  const {
    detail: _detail,
    imageUrl: _imageUrl,
    image: _image,
    url: _url,
    uri: _uri,
    source: _source,
    ...partRest
  } = part;
  return {
    ...partRest,
    type: 'image_url',
    image_url: {
      ...descriptorRest,
      url: normalizedUrl,
    },
  };
}

async function normalizeContentPart(part, fetchImpl, downloadCache) {
  if (typeof part === 'string') {
    return { type: 'text', text: part };
  }
  if (!part || typeof part !== 'object' || Array.isArray(part)) {
    return part;
  }
  const type = normalizeString(part.type).toLowerCase();
  if (type === 'input_text' || type === 'output_text') {
    return { ...part, type: 'text', text: part.text || '' };
  }
  if (type === 'image_url' || type === 'input_image' || type === 'image') {
    return normalizeImagePart(part, fetchImpl, downloadCache);
  }
  return { ...part };
}

async function normalizeMessage(message, fetchImpl, downloadCache) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return message;
  }
  const content = Array.isArray(message.content)
    ? await Promise.all(
      message.content.map((part) => normalizeContentPart(part, fetchImpl, downloadCache)),
    )
    : message.content;
  return {
    ...message,
    role: message.role === 'developer' ? 'system' : message.role,
    ...(Object.hasOwn(message, 'content') ? { content } : {}),
  };
}

function normalizeResponsesInput(input) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (!Array.isArray(input)) {
    return [];
  }
  if (input.every((item) => item && typeof item === 'object' && typeof item.role === 'string')) {
    return input;
  }
  return [{ role: 'user', content: input }];
}

function normalizeResponseFormat(responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object' || Array.isArray(responseFormat)) {
    return responseFormat;
  }
  if (normalizeString(responseFormat.type).toLowerCase() !== 'json_schema') {
    return { ...responseFormat };
  }
  const jsonSchema = responseFormat.json_schema &&
    typeof responseFormat.json_schema === 'object' &&
    !Array.isArray(responseFormat.json_schema)
    ? responseFormat.json_schema
    : {};
  return {
    ...responseFormat,
    json_schema: {
      ...jsonSchema,
      strict: true,
    },
  };
}

export async function buildKimiK3ChatCompletionPayload(
  chatRequest = {},
  { fetchImpl = globalThis.fetch } = {},
) {
  const {
    authorization,
    bypassSamsarExternalInference,
    externalMaxRetries,
    inference_model,
    inferenceModel,
    input,
    max_completion_tokens,
    max_tokens,
    maxRetries,
    max_output_tokens,
    messages: rawMessages,
    model,
    n,
    presence_penalty,
    provider_options,
    providerOptions,
    reasoning,
    reasoningEffort,
    reasoning_effort,
    response_format: rawResponseFormat,
    samsarExternalInference,
    temperature,
    thinking,
    timeout,
    timeoutMs,
    top_p,
    frequency_penalty,
    ...request
  } = chatRequest || {};
  const downloadCache = new Map();
  const sourceMessages = Array.isArray(rawMessages)
    ? rawMessages
    : normalizeResponsesInput(input);
  const messages = await Promise.all(
    sourceMessages.map((message) => normalizeMessage(message, fetchImpl, downloadCache)),
  );
  const responseFormat = normalizeResponseFormat(rawResponseFormat);
  const maxCompletionTokens = normalizePositiveInteger(
    max_completion_tokens ?? max_output_tokens ?? max_tokens,
    null,
  );

  const payload = {
    ...request,
    model: KIMI_K3_INFERENCE_MODEL,
    reasoning_effort: KIMI_K3_REASONING_EFFORT,
    messages,
    ...(maxCompletionTokens
      ? { max_completion_tokens: maxCompletionTokens }
      : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
  if (
    Buffer.byteLength(JSON.stringify(payload), 'utf8') >=
      MAX_KIMI_K3_REQUEST_BODY_BYTES
  ) {
    throw new Error('Kimi K3 request body must be smaller than 100 MB.');
  }
  return payload;
}

export async function createKimiK3ChatCompletion(chatRequest = {}) {
  const timeout = normalizePositiveInteger(
    chatRequest.timeout ?? chatRequest.timeoutMs ?? process.env.KIMI_K3_INFERENCE_TIMEOUT_MS,
    DEFAULT_KIMI_K3_TIMEOUT_MS,
  );
  const payload = await buildKimiK3ChatCompletionPayload(chatRequest);
  return getKimiK3Client().chat.completions.create(payload, {
    timeout,
    maxRetries: 0,
  });
}
