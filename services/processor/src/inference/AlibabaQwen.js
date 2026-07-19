import OpenAI from 'openai';

import {
  getProviderModelForInferenceModel,
  QWEN_37_INFERENCE_MODEL,
} from '../consts/InferenceModels.js';
import { resolveProviderMediaPayload } from '../models/ai_utils/ProviderMediaPayload.js';

const DEFAULT_DASHSCOPE_BASE_URL =
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const ALIBABA_API_KEY_NAMES = Object.freeze([
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
]);

let cachedClient = null;
let cachedApiKey = '';
let cachedBaseURL = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getBaseURLFromApiHost(value) {
  const host = normalizeString(value).replace(/\/+$/, '');
  if (!host) return '';

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(host) ? host : `https://${host}`;
  if (/\/compatible-mode\/v1$/i.test(withProtocol)) return withProtocol;
  if (/\/compatible-mode$/i.test(withProtocol)) return `${withProtocol}/v1`;
  return `${withProtocol}/compatible-mode/v1`;
}

export function getAlibabaQwenApiKey(env = process.env) {
  for (const key of ALIBABA_API_KEY_NAMES) {
    const value = normalizeString(env?.[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

export function getAlibabaQwenBaseURL(env = process.env) {
  const configured = normalizeString(
    env?.DASHSCOPE_BASE_URL ||
    env?.ALIBABA_CLOUD_BASE_URL ||
    env?.QWEN_BASE_URL,
  );
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return getBaseURLFromApiHost(env?.ALIBABA_API_HOST) || DEFAULT_DASHSCOPE_BASE_URL;
}

export function hasAlibabaQwenNativeCredential(env = process.env) {
  return Boolean(getAlibabaQwenApiKey(env));
}

function getAlibabaQwenClient() {
  const apiKey = getAlibabaQwenApiKey();
  if (!apiKey) {
    throw new Error(
      'ALIBABA_API_KEY (or DASHSCOPE_API_KEY/ALIBABA_CLOUD_API_KEY/QWEN_API_KEY) is required for native Qwen inference.',
    );
  }

  const baseURL = getAlibabaQwenBaseURL();
  if (!cachedClient || cachedApiKey !== apiKey || cachedBaseURL !== baseURL) {
    cachedClient = new OpenAI({ apiKey, baseURL });
    cachedApiKey = apiKey;
    cachedBaseURL = baseURL;
  }
  return cachedClient;
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
  return [
    'url',
    'uri',
    'source',
    'src',
    'href',
    'urls',
    'uris',
    'sources',
    'image_url',
    'imageUrl',
    'image_urls',
    'imageUrls',
    'video_url',
    'videoUrl',
    'video_urls',
    'videoUrls',
    'data',
    'base64',
    'file_id',
    'fileId',
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key) &&
    hasActualMediaReference(value[key], seen));
}

function getMediaReference(part = {}) {
  return part.image_url ??
    part.imageUrl ??
    part.image ??
    part.image_urls ??
    part.imageUrls ??
    part.video_url ??
    part.videoUrl ??
    part.video ??
    part.video_urls ??
    part.videoUrls ??
    part.url ??
    part.uri ??
    part.source ??
    part.src ??
    part.href ??
    part.urls ??
    part.uris ??
    part.sources;
}

function isVisionContentPart(part) {
  if (!part || typeof part !== 'object') {
    return false;
  }
  const type = normalizeString(part.type).toLowerCase();
  return [
    'image',
    'image_url',
    'input_image',
    'video',
    'video_url',
    'input_video',
  ].includes(type) && hasActualMediaReference(getMediaReference(part));
}

export function hasQwenVisionInput(messages = []) {
  const messageList = Array.isArray(messages) ? messages : [];
  return messageList.some((message) => {
    const content = message?.content;
    return Array.isArray(content) && content.some(isVisionContentPart);
  });
}

function normalizeMediaUrl(value, defaultMimeType) {
  if (typeof value === 'string') {
    return { url: value };
  }
  if (!value || typeof value !== 'object') {
    return { url: '' };
  }
  const data = normalizeString(value.data || value.base64);
  if (data) {
    const mimeType = normalizeString(value.media_type || value.mime_type) || defaultMimeType;
    return { url: `data:${mimeType};base64,${data}` };
  }
  return {
    ...value,
    url: value.url ?? value.uri ?? value.source ?? value.src ?? value.href ??
      value.urls ?? value.uris ?? value.sources ??
      value.image_url ?? value.image_urls ?? value.video_url ?? value.video_urls ?? '',
  };
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

function normalizeContentPart(part) {
  if (!part || typeof part !== 'object') {
    return [part];
  }

  if (part.type === 'input_text' || part.type === 'output_text') {
    return [{ type: 'text', text: part.text || '' }];
  }

  if (part.type === 'input_image' || part.type === 'image') {
    return normalizeMediaUrls(getMediaReference(part), 'image/png').map((imageUrl) => ({
      type: 'image_url',
      image_url: {
        ...imageUrl,
        ...(part.detail ? { detail: part.detail } : {}),
      },
    }));
  }

  if (part.type === 'image_url') {
    return normalizeMediaUrls(getMediaReference(part), 'image/png').map((imageUrl) => ({
      ...part,
      image_url: imageUrl,
    }));
  }

  if (part.type === 'input_video' || part.type === 'video') {
    return normalizeMediaUrls(getMediaReference(part), 'video/mp4').map((videoUrl) => ({
      type: 'video_url',
      video_url: videoUrl,
    }));
  }

  if (part.type === 'video_url') {
    return normalizeMediaUrls(getMediaReference(part), 'video/mp4').map((videoUrl) => ({
      ...part,
      video_url: videoUrl,
    }));
  }

  return [part];
}

export function normalizeMessagesForAlibabaQwen(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object') {
      return message;
    }
    return {
      ...message,
      role: message.role === 'developer' ? 'system' : message.role,
      content: Array.isArray(message.content)
        ? message.content.flatMap(normalizeContentPart)
        : message.content,
    };
  });
}

function appendJsonInstruction(messages, responseFormat) {
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

function buildRequestOptions({ timeout, timeoutMs, maxRetries } = {}) {
  const options = {};
  const parsedTimeout = Number(timeout ?? timeoutMs);
  if (Number.isFinite(parsedTimeout) && parsedTimeout > 0) {
    options.timeout = Math.floor(parsedTimeout);
  }
  const parsedMaxRetries = Number(maxRetries);
  if (Number.isInteger(parsedMaxRetries) && parsedMaxRetries >= 0) {
    options.maxRetries = parsedMaxRetries;
  }
  return options;
}

export function buildAlibabaQwenChatRequest(chatRequest = {}) {
  const {
    authorization,
    bypassSamsarExternalInference,
    samsarExternalInference,
    provider_options,
    providerOptions,
    inference_model,
    inferenceModel,
    input,
    reasoning,
    reasoning_effort,
    timeout,
    timeoutMs,
    maxRetries,
    max_output_tokens,
    messages: rawMessages,
    response_format: rawResponseFormat,
    ...request
  } = chatRequest || {};

  const source = rawMessages || input || [];
  const sourceMessages = typeof source === 'string'
    ? [{ role: 'user', content: source }]
    : source;
  const vision = hasQwenVisionInput(sourceMessages);
  const normalizedMessages = normalizeMessagesForAlibabaQwen(sourceMessages);
  const structured = appendJsonInstruction(normalizedMessages, rawResponseFormat);

  return {
    payload: {
      ...request,
      model: getProviderModelForInferenceModel(QWEN_37_INFERENCE_MODEL, { vision }),
      messages: structured.messages,
      enable_thinking: false,
      ...(max_output_tokens !== undefined && request.max_tokens === undefined
        ? { max_tokens: max_output_tokens }
        : {}),
      ...(structured.responseFormat
        ? { response_format: structured.responseFormat }
        : {}),
    },
    requestOptions: buildRequestOptions({ timeout, timeoutMs, maxRetries }),
  };
}

export async function createAlibabaQwenChatCompletion(chatRequest = {}, dependencyOverrides = {}) {
  const { payload, requestOptions } = buildAlibabaQwenChatRequest(chatRequest);
  const providerPayload = await resolveProviderMediaPayload(payload, {
    resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
    serviceName: 'samsar_processor_alibaba_qwen',
  });
  return await getAlibabaQwenClient().chat.completions.create(providerPayload, {
    ...requestOptions,
    maxRetries: 0,
  });
}
