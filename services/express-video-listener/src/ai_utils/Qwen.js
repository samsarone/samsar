import OpenAI from 'openai';

import {
  QWEN_37_MAX_MODEL,
  QWEN_37_PLUS_MODEL,
} from './GoogleGemini.js';
import { normalizeProviderMediaUrl } from '../ai_video/utils/AWS.js';
import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';

const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const DEFAULT_QWEN_TIMEOUT_MS = 10 * 60 * 1000;
const MULTIMODAL_CONTENT_TYPES = new Set([
  'image',
  'image_url',
  'input_image',
  'input_video',
  'video',
  'video_url',
]);
const MEDIA_REFERENCE_KEYS = [
  'url',
  'uri',
  'image_url',
  'imageUrl',
  'video_url',
  'videoUrl',
  'data',
  'base64',
  'file_id',
  'fileId',
  'source',
  'src',
  'href',
  'urls',
  'uris',
  'sources',
  'image_urls',
  'imageUrls',
  'video_urls',
  'videoUrls',
];

let cachedClient = null;
let cachedClientKey = '';
let cachedBaseUrl = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getBaseUrlFromApiHost(value) {
  const host = normalizeString(value).replace(/\/+$/, '');
  if (!host) return '';

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(host) ? host : `https://${host}`;
  if (/\/compatible-mode\/v1$/i.test(withProtocol)) return withProtocol;
  if (/\/compatible-mode$/i.test(withProtocol)) return `${withProtocol}/v1`;
  return `${withProtocol}/compatible-mode/v1`;
}

export function getAlibabaCloudApiKey(env = process.env) {
  return normalizeString(
    env.DASHSCOPE_API_KEY ||
    env.ALIBABA_CLOUD_API_KEY ||
    env.ALIBABA_API_KEY ||
    env.QWEN_API_KEY,
  );
}

export function getAlibabaCloudBaseUrl(env = process.env) {
  const configured = normalizeString(
    env.DASHSCOPE_BASE_URL ||
    env.ALIBABA_CLOUD_BASE_URL ||
    env.QWEN_BASE_URL,
  );
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return getBaseUrlFromApiHost(env.ALIBABA_API_HOST) || DEFAULT_DASHSCOPE_BASE_URL;
}

function getMediaReference(contentPart = {}) {
  return contentPart.image_url ??
    contentPart.imageUrl ??
    contentPart.image ??
    contentPart.image_urls ??
    contentPart.imageUrls ??
    contentPart.video_url ??
    contentPart.videoUrl ??
    contentPart.video ??
    contentPart.url ??
    contentPart.uri ??
    contentPart.source ??
    contentPart.src ??
    contentPart.href ??
    contentPart.urls ??
    contentPart.uris ??
    contentPart.sources;
}

function hasActualMediaReference(value, seen = new Set()) {
  if (typeof value === 'string') {
    return Boolean(value.trim());
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasActualMediaReference(item, seen));
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  seen.add(value);

  return MEDIA_REFERENCE_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(value, key) &&
    hasActualMediaReference(value[key], seen)
  );
}

function containsMultimodalContent(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (
    typeof value.type === 'string' &&
    MULTIMODAL_CONTENT_TYPES.has(value.type.toLowerCase()) &&
    hasActualMediaReference(getMediaReference(value))
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsMultimodalContent(item, seen));
  }
  return Object.values(value).some((item) => containsMultimodalContent(item, seen));
}

export function hasQwenMultimodalInput(request = {}) {
  return containsMultimodalContent(request?.messages) ||
    containsMultimodalContent(request?.input);
}

export function resolveQwenProviderModel(request = {}, env = process.env) {
  return hasQwenMultimodalInput(request)
    ? QWEN_37_PLUS_MODEL
    : normalizeString(env.ALIBABA_QWEN_TEXT_MODEL) || QWEN_37_MAX_MODEL;
}

function normalizeDataSource(value, defaultMimeType) {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const data = normalizeString(value.data || value.base64);
  if (!data) {
    return value;
  }
  const mimeType = normalizeString(value.media_type || value.mime_type) || defaultMimeType;
  return `data:${mimeType};base64,${data}`;
}

function normalizeMediaUrl(value, defaultMimeType) {
  if (typeof value === 'string') {
    return { url: value };
  }
  if (!value || typeof value !== 'object') {
    return { url: '' };
  }

  const normalizedSource = normalizeDataSource(value, defaultMimeType);
  if (typeof normalizedSource === 'string') {
    return { url: normalizedSource };
  }

  const url = value.url ?? value.uri ?? value.source ?? value.src ?? value.href ??
    value.urls ?? value.uris ?? value.sources ??
    value.image_url ?? value.image_urls ?? value.video_url ?? value.video_urls ?? '';
  return { ...value, url };
}

function normalizeMediaUrls(value, defaultMimeType) {
  if (Array.isArray(value)) {
    const normalized = value.flatMap((entry) => normalizeMediaUrls(entry, defaultMimeType));
    return normalized.length > 0 ? normalized : [{ url: '' }];
  }

  const descriptor = normalizeMediaUrl(value, defaultMimeType);
  const nestedUrl = descriptor.url;
  if (Array.isArray(nestedUrl) || (nestedUrl && typeof nestedUrl === 'object')) {
    const {
      url: _url,
      uri: _uri,
      source: _source,
      src: _src,
      href: _href,
      urls: _urls,
      uris: _uris,
      sources: _sources,
      image_url: _imageUrl,
      image_urls: _imageUrls,
      video_url: _videoUrl,
      video_urls: _videoUrls,
      ...metadata
    } = descriptor;
    return normalizeMediaUrls(nestedUrl, defaultMimeType).map((entry) => ({
      ...metadata,
      ...entry,
    }));
  }
  return [descriptor];
}

function normalizeContentForQwen(content) {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [item];
    }
    if (item.type === 'input_text' || item.type === 'output_text') {
      return [{ type: 'text', text: item.text || '' }];
    }
    if (item.type === 'input_image' || item.type === 'image') {
      return normalizeMediaUrls(getMediaReference(item), 'image/png').map((imageUrl) => ({
        type: 'image_url',
        image_url: {
          ...imageUrl,
          ...(item.detail ? { detail: item.detail } : {}),
        },
      }));
    }
    if (item.type === 'image_url') {
      return normalizeMediaUrls(getMediaReference(item), 'image/png').map((imageUrl) => ({
        ...item,
        image_url: imageUrl,
      }));
    }
    if (item.type === 'input_video' || item.type === 'video') {
      return normalizeMediaUrls(getMediaReference(item), 'video/mp4').map((videoUrl) => ({
        type: 'video_url',
        video_url: videoUrl,
      }));
    }
    if (item.type === 'video_url') {
      return normalizeMediaUrls(getMediaReference(item), 'video/mp4').map((videoUrl) => ({
        ...item,
        video_url: videoUrl,
      }));
    }
    return [item];
  });
}

function normalizeMessageForQwen(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }
  return {
    ...message,
    role: message.role === 'developer' ? 'system' : message.role,
    content: normalizeContentForQwen(message.content),
  };
}

function normalizeResponsesInputForQwen(input) {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map(normalizeMessageForQwen).filter(Boolean);
}

function normalizeStructuredJsonRequest(messages, responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object') {
    return { messages, responseFormat };
  }
  if (responseFormat.type !== 'json_schema' && responseFormat.type !== 'json_object') {
    return { messages, responseFormat };
  }

  const schema = responseFormat?.json_schema?.schema;
  const instruction = schema
    ? `Return valid JSON only. The JSON must follow this JSON Schema exactly: ${JSON.stringify(schema)}`
    : 'Return valid JSON only.';
  const normalizedMessages = [...messages];
  const systemMessageIndex = normalizedMessages.findIndex((message) => message?.role === 'system');

  if (systemMessageIndex >= 0) {
    const systemMessage = normalizedMessages[systemMessageIndex];
    const content = typeof systemMessage.content === 'string'
      ? `${systemMessage.content}\n\n${instruction}`
      : [
        ...(Array.isArray(systemMessage.content) ? systemMessage.content : []),
        { type: 'text', text: instruction },
      ];
    normalizedMessages[systemMessageIndex] = { ...systemMessage, content };
  } else {
    normalizedMessages.unshift({ role: 'system', content: instruction });
  }

  return {
    messages: normalizedMessages,
    responseFormat: { type: 'json_object' },
  };
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function buildQwenChatCompletionPayload(chatRequest = {}, env = process.env) {
  const {
    authorization,
    bypassSamsarExternalInference,
    inference_model,
    inferenceModel,
    input,
    maxRetries,
    max_completion_tokens,
    max_output_tokens,
    provider_options,
    providerOptions,
    reasoning,
    reasoning_effort,
    response_format: responseFormat,
    samsarExternalInference,
    timeout,
    timeoutMs,
    ...request
  } = chatRequest || {};

  const messages = Array.isArray(request.messages)
    ? request.messages.map(normalizeMessageForQwen).filter(Boolean)
    : normalizeResponsesInputForQwen(input);
  const maxTokens = toPositiveInteger(
    request.max_tokens ?? max_completion_tokens ?? max_output_tokens,
  );
  const structuredRequest = normalizeStructuredJsonRequest(messages, responseFormat);

  return {
    ...request,
    model: resolveQwenProviderModel(chatRequest, env),
    messages: structuredRequest.messages,
    enable_thinking: true,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(structuredRequest.responseFormat
      ? { response_format: structuredRequest.responseFormat }
      : {}),
  };
}

function getQwenClient() {
  const apiKey = getAlibabaCloudApiKey();
  if (!apiKey) {
    throw new Error(
      'Alibaba Cloud Qwen inference requires DASHSCOPE_API_KEY, ALIBABA_CLOUD_API_KEY, ALIBABA_API_KEY, or QWEN_API_KEY.',
    );
  }
  const baseURL = getAlibabaCloudBaseUrl();
  if (!cachedClient || cachedClientKey !== apiKey || cachedBaseUrl !== baseURL) {
    cachedClient = new OpenAI({ apiKey, baseURL });
    cachedClientKey = apiKey;
    cachedBaseUrl = baseURL;
  }
  return cachedClient;
}

export async function createQwenChatCompletion(chatRequest = {}) {
  const payload = await normalizeProviderMediaPayload(
    buildQwenChatCompletionPayload(chatRequest),
    normalizeProviderMediaUrl,
  );
  const timeout = toPositiveInteger(
    chatRequest.timeout ?? chatRequest.timeoutMs ?? process.env.QWEN_INFERENCE_TIMEOUT_MS,
  ) || DEFAULT_QWEN_TIMEOUT_MS;
  const requestOptions = buildQwenRequestOptions({ timeout });

  return getQwenClient().chat.completions.create(payload, requestOptions);
}

export function buildQwenRequestOptions({ timeout } = {}) {
  return {
    timeout: toPositiveInteger(timeout) || DEFAULT_QWEN_TIMEOUT_MS,
    // Provider media is normalized immediately above. Hidden SDK retries
    // would reuse a tunnel URL that may have expired between attempts.
    maxRetries: 0,
  };
}
