import OpenAI from 'openai';
import { getAccessibleMediaUrlForProvider } from '../utils/MediaReferenceUtils.js';
import { normalizeProviderMediaPayload } from '../utils/ProviderMediaPayload.js';

import {
  DEFAULT_QWEN_37_MAX_MODEL,
  DEFAULT_QWEN_37_PLUS_MODEL,
} from './InferenceModels.js';

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

let cachedClient = null;
let cachedClientKey = '';
let cachedBaseUrl = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getAlibabaCloudApiKey(env = process.env) {
  return normalizeString(
    env.ALIBABA_CLOUD_API_KEY ||
    env.ALIBABA_API_KEY ||
    env.DASHSCOPE_API_KEY ||
    env.QWEN_API_KEY,
  );
}

export function getAlibabaCloudBaseUrl(env = process.env) {
  const configuredBaseUrl = normalizeString(
    env.ALIBABA_CLOUD_BASE_URL ||
    env.DASHSCOPE_BASE_URL ||
    env.QWEN_BASE_URL,
  ).replace(/\/+$/, '');
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const configuredHost = normalizeString(env.ALIBABA_API_HOST).replace(/\/+$/, '');
  if (!configuredHost) {
    return DEFAULT_DASHSCOPE_BASE_URL;
  }

  const hostWithScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(configuredHost)
    ? configuredHost
    : `https://${configuredHost}`;
  if (/\/compatible-mode\/v1$/i.test(hostWithScheme)) {
    return hostWithScheme;
  }
  if (/\/compatible-mode$/i.test(hostWithScheme)) {
    return `${hostWithScheme}/v1`;
  }
  return `${hostWithScheme}/compatible-mode/v1`;
}

export function hasQwenMultimodalInput(request = {}) {
  return containsMultimodalContent(request?.messages) || containsMultimodalContent(request?.input);
}

function containsMultimodalContent(value, seen = new Set()) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (typeof value.type === 'string' && MULTIMODAL_CONTENT_TYPES.has(value.type.toLowerCase())) {
    const mediaReference =
      value.image_url ?? value.imageUrl ?? value.image ?? value.image_urls ?? value.imageUrls ??
      value.video_url ?? value.videoUrl ?? value.video ?? value.video_urls ?? value.videoUrls ??
      value.url ?? value.uri ?? value.source ?? value.src ?? value.href ??
      value.urls ?? value.uris ?? value.sources;
    if (typeof mediaReference === 'string' && mediaReference.trim()) {
      return true;
    }
    if (hasNonEmptyMediaReference(mediaReference)) {
      return true;
    }
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsMultimodalContent(item, seen));
  }

  return Object.values(value).some((item) => containsMultimodalContent(item, seen));
}

function hasNonEmptyMediaReference(value, seen = new Set()) {
  if (typeof value === 'string') {
    return Boolean(value.trim());
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasNonEmptyMediaReference(item, seen));
  }
  return [
    value.url,
    value.image_url,
    value.video_url,
    value.data,
    value.base64,
    value.uri,
    value.file_id,
    value.fileId,
    value.source,
    value.src,
    value.href,
    value.urls,
    value.uris,
    value.sources,
    value.image_urls,
    value.imageUrls,
    value.video_urls,
    value.videoUrls,
  ].some((item) => hasNonEmptyMediaReference(item, seen));
}

export function resolveQwenProviderModel(request = {}, env = process.env) {
  if (hasQwenMultimodalInput(request)) {
    return normalizeString(env.QWEN_37_PLUS_MODEL || env.ALIBABA_QWEN_37_PLUS_MODEL) ||
      DEFAULT_QWEN_37_PLUS_MODEL;
  }
  return normalizeString(env.QWEN_37_MAX_MODEL || env.ALIBABA_QWEN_37_MAX_MODEL) ||
    DEFAULT_QWEN_37_MAX_MODEL;
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
    response_format: rawResponseFormat,
    samsarExternalInference,
    timeout,
    timeoutMs,
    ...request
  } = chatRequest || {};

  const messages = Array.isArray(request.messages)
    ? request.messages.map(normalizeMessageForQwen).filter(Boolean)
    : normalizeResponsesInputForQwen(input);
  const structuredRequest = appendStructuredJsonInstruction(messages, rawResponseFormat);
  const maxTokens = toPositiveInteger(
    request.max_tokens ?? max_completion_tokens ?? max_output_tokens,
  );

  return {
    ...request,
    model: resolveQwenProviderModel(chatRequest, env),
    messages: structuredRequest.messages,
    enable_thinking: false,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(structuredRequest.responseFormat
      ? { response_format: structuredRequest.responseFormat }
      : {}),
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
      const imageUrls = normalizeMediaUrls(
        item.image_url ?? item.imageUrl ?? item.image ?? item.image_urls ?? item.imageUrls ??
          item.url ?? item.uri ?? item.source ?? item.src ?? item.href ??
          item.urls ?? item.uris ?? item.sources,
        'image/png',
      );
      return imageUrls.map((imageUrl) => ({
        type: 'image_url',
        image_url: {
          url: imageUrl,
          ...(item.detail ? { detail: item.detail } : {}),
        },
      }));
    }
    if (item.type === 'image_url') {
      const imageReference = item.image_url ?? item.imageUrl ?? item.image_urls ?? item.imageUrls ??
        item.url ?? item.uri ?? item.source ?? item.src ?? item.href ??
        item.urls ?? item.uris ?? item.sources;
      const imageUrls = normalizeMediaUrls(imageReference, 'image/png');
      return imageUrls.map((imageUrl) => ({
        ...item,
        image_url: {
          ...getMediaDescriptorMetadata(item.image_url),
          url: imageUrl,
        },
      }));
    }
    if (item.type === 'input_video' || item.type === 'video') {
      const videoUrls = normalizeMediaUrls(
        item.video_url ?? item.videoUrl ?? item.video ?? item.video_urls ?? item.videoUrls ??
          item.url ?? item.uri ?? item.source ?? item.src ?? item.href ??
          item.urls ?? item.uris ?? item.sources,
        'video/mp4',
      );
      return videoUrls.map((videoUrl) => ({
        type: 'video_url',
        video_url: {
          url: videoUrl,
        },
      }));
    }
    if (item.type === 'video_url') {
      const videoReference = item.video_url ?? item.videoUrl ?? item.video_urls ?? item.videoUrls ??
        item.url ?? item.uri ?? item.source ?? item.src ?? item.href ??
        item.urls ?? item.uris ?? item.sources;
      const videoUrls = normalizeMediaUrls(videoReference, 'video/mp4');
      return videoUrls.map((videoUrl) => ({
        ...item,
        video_url: {
          ...getMediaDescriptorMetadata(item.video_url),
          url: videoUrl,
        },
      }));
    }
    return [item];
  });
}

function normalizeMediaUrls(value, defaultMimeType) {
  if (Array.isArray(value)) {
    const normalized = value.flatMap((entry) => normalizeMediaUrls(entry, defaultMimeType));
    return normalized.length > 0 ? normalized : [''];
  }

  if (value && typeof value === 'object' && !value.data && !value.base64) {
    const nested = value.url ?? value.uri ?? value.source ?? value.src ?? value.href ??
      value.urls ?? value.uris ?? value.sources ??
      value.image_url ?? value.image_urls ?? value.video_url ?? value.video_urls;
    if (Array.isArray(nested) || (nested && typeof nested === 'object')) {
      return normalizeMediaUrls(nested, defaultMimeType);
    }
  }

  return [normalizeMediaUrl(value, defaultMimeType)];
}

function getMediaDescriptorMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
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
    data: _data,
    base64: _base64,
    media_type: _mediaType,
    mime_type: _mimeType,
    ...metadata
  } = value;
  return metadata;
}

function normalizeMediaUrl(value, defaultMimeType) {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const data = normalizeString(value.data || value.base64);
  if (data) {
    const mimeType = normalizeString(value.media_type || value.mime_type) || defaultMimeType;
    return `data:${mimeType};base64,${data}`;
  }
  const url = value.url ?? value.uri ?? value.source ?? value.src ?? value.href ??
    value.urls ?? value.uris ?? value.sources ??
    value.image_url ?? value.image_urls ?? value.video_url ?? value.video_urls ?? '';
  return typeof url === 'string' || Array.isArray(url) ? url : '';
}

function appendStructuredJsonInstruction(messages, responseFormat) {
  if (
    !responseFormat ||
    typeof responseFormat !== 'object' ||
    !['json_schema', 'json_object'].includes(responseFormat.type)
  ) {
    return { messages, responseFormat };
  }

  const schema = responseFormat?.json_schema?.schema;
  const instruction = schema
    ? `Return valid JSON only. The JSON must follow this JSON Schema exactly: ${JSON.stringify(schema)}`
    : 'Return valid JSON only.';
  const nextMessages = [...messages];
  const systemIndex = nextMessages.findIndex((message) => message?.role === 'system');

  if (systemIndex >= 0) {
    const systemMessage = nextMessages[systemIndex];
    const content = typeof systemMessage.content === 'string'
      ? `${systemMessage.content}\n\n${instruction}`
      : [
          ...(Array.isArray(systemMessage.content) ? systemMessage.content : []),
          { type: 'text', text: instruction },
        ];
    nextMessages[systemIndex] = { ...systemMessage, content };
  } else {
    nextMessages.unshift({ role: 'system', content: instruction });
  }

  return {
    messages: nextMessages,
    responseFormat: { type: 'json_object' },
  };
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function getQwenClient() {
  const apiKey = getAlibabaCloudApiKey();
  if (!apiKey) {
    throw new Error(
      'Alibaba Cloud Qwen inference requires ALIBABA_CLOUD_API_KEY, ALIBABA_API_KEY, DASHSCOPE_API_KEY, or QWEN_API_KEY.',
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
    (value, { mediaKind }) => getAccessibleMediaUrlForProvider(value, { mediaKind }),
  );
  const timeout = toPositiveInteger(
    chatRequest.timeout ?? chatRequest.timeoutMs ?? process.env.QWEN_INFERENCE_TIMEOUT_MS,
  ) || DEFAULT_QWEN_TIMEOUT_MS;
  const requestOptions = {
    timeout,
    // Provider media URLs are normalized immediately before this dispatch. Do
    // not let the SDK retry the same payload after a short-lived Docker tunnel
    // has expired; callers that retry must rebuild the payload so the URL is
    // resolved again for every provider attempt.
    maxRetries: 0,
  };

  return getQwenClient().chat.completions.create(payload, requestOptions);
}
