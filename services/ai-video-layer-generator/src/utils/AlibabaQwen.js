import OpenAI from 'openai';

import {
  QWEN_37_MAX_MODEL,
  QWEN_37_PLUS_MODEL,
} from './GoogleGemini.js';

const DEFAULT_DASHSCOPE_BASE_URL =
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

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
  return normalizeString(
    env?.DASHSCOPE_API_KEY ||
    env?.ALIBABA_CLOUD_API_KEY ||
    env?.ALIBABA_API_KEY ||
    env?.QWEN_API_KEY,
  );
}

export function hasAlibabaQwenNativeCredential(env = process.env) {
  return Boolean(getAlibabaQwenApiKey(env));
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

function getAlibabaQwenClient() {
  const apiKey = getAlibabaQwenApiKey();
  if (!apiKey) {
    throw new Error(
      'DASHSCOPE_API_KEY (or ALIBABA_CLOUD_API_KEY/ALIBABA_API_KEY/QWEN_API_KEY) is required for native Qwen inference.',
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

function getMediaReference(part = {}) {
  return part.image_url ??
    part.imageUrl ??
    part.image ??
    part.video_url ??
    part.videoUrl ??
    part.video ??
    part.url ??
    part.source;
}

function isVisionPart(part) {
  const type = normalizeString(part?.type).toLowerCase();
  if (!['image', 'image_url', 'input_image', 'video', 'video_url', 'input_video'].includes(type)) {
    return false;
  }
  const reference = getMediaReference(part);
  if (typeof reference === 'string') {
    return Boolean(reference.trim());
  }
  return Boolean(
    reference &&
    typeof reference === 'object' &&
    normalizeString(
      reference.url ||
      reference.uri ||
      reference.data ||
      reference.base64 ||
      reference.file_id,
    ),
  );
}

export function hasQwenVisionInput(messages = []) {
  return Array.isArray(messages) && messages.some(
    (message) => Array.isArray(message?.content) && message.content.some(isVisionPart),
  );
}

function normalizeDataSource(value, defaultMimeType) {
  if (!value || typeof value !== 'object') return value;
  const data = normalizeString(value.data || value.base64);
  if (!data) return value;
  const mimeType = normalizeString(value.media_type || value.mime_type) || defaultMimeType;
  return `data:${mimeType};base64,${data}`;
}

function normalizeMediaUrl(value, defaultMimeType) {
  if (typeof value === 'string' || Array.isArray(value)) return { url: value };
  if (!value || typeof value !== 'object') return { url: '' };
  const normalizedSource = normalizeDataSource(value, defaultMimeType);
  if (typeof normalizedSource === 'string') return { url: normalizedSource };
  return {
    ...value,
    url: value.url ?? value.uri ?? value.image_url ?? value.video_url ?? '',
  };
}

function normalizeContentPart(part) {
  if (!part || typeof part !== 'object') return part;
  if (part.type === 'input_text' || part.type === 'output_text') {
    return { type: 'text', text: part.text || '' };
  }
  if (part.type === 'input_image' || part.type === 'image') {
    return {
      type: 'image_url',
      image_url: normalizeMediaUrl(getMediaReference(part), 'image/png'),
    };
  }
  if (part.type === 'image_url') {
    return {
      ...part,
      image_url: normalizeMediaUrl(part.image_url, 'image/png'),
    };
  }
  if (part.type === 'input_video' || part.type === 'video') {
    return {
      type: 'video_url',
      video_url: normalizeMediaUrl(getMediaReference(part), 'video/mp4'),
    };
  }
  if (part.type === 'video_url') {
    return {
      ...part,
      video_url: normalizeMediaUrl(part.video_url, 'video/mp4'),
    };
  }
  return part;
}

function normalizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    ...message,
    role: message?.role === 'developer' ? 'system' : message?.role,
    content: Array.isArray(message?.content)
      ? message.content.map(normalizeContentPart)
      : message?.content,
  }));
}

function normalizeStructuredOutput(messages, responseFormat) {
  if (!['json_schema', 'json_object'].includes(responseFormat?.type)) {
    return { messages, responseFormat };
  }
  const schema = responseFormat?.json_schema?.schema;
  const instruction = schema
    ? `Return valid JSON only. The JSON must follow this JSON Schema exactly: ${JSON.stringify(schema)}`
    : 'Return valid JSON only.';
  const nextMessages = [...messages];
  const systemIndex = nextMessages.findIndex((message) => message?.role === 'system');
  if (systemIndex >= 0 && typeof nextMessages[systemIndex].content === 'string') {
    nextMessages[systemIndex] = {
      ...nextMessages[systemIndex],
      content: `${nextMessages[systemIndex].content}\n\n${instruction}`,
    };
  } else {
    nextMessages.unshift({ role: 'system', content: instruction });
  }
  return { messages: nextMessages, responseFormat: { type: 'json_object' } };
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
    response_format: responseFormat,
    ...request
  } = chatRequest || {};
  const source = rawMessages || input || [];
  const sourceMessages = typeof source === 'string'
    ? [{ role: 'user', content: source }]
    : source;
  const structured = normalizeStructuredOutput(
    normalizeMessages(sourceMessages),
    responseFormat,
  );
  const requestOptions = {};
  const parsedTimeout = Number(timeout ?? timeoutMs);
  if (Number.isFinite(parsedTimeout) && parsedTimeout > 0) requestOptions.timeout = parsedTimeout;
  if (Number.isInteger(Number(maxRetries)) && Number(maxRetries) >= 0) {
    requestOptions.maxRetries = Number(maxRetries);
  }
  return {
    payload: {
      ...request,
      model: hasQwenVisionInput(sourceMessages) ? QWEN_37_PLUS_MODEL : QWEN_37_MAX_MODEL,
      messages: structured.messages,
      enable_thinking: false,
      ...(max_output_tokens !== undefined && request.max_tokens === undefined
        ? { max_tokens: max_output_tokens }
        : {}),
      ...(structured.responseFormat ? { response_format: structured.responseFormat } : {}),
    },
    requestOptions,
  };
}

export async function createAlibabaQwenChatCompletion(chatRequest = {}) {
  const { payload, requestOptions } = buildAlibabaQwenChatRequest(chatRequest);
  return await getAlibabaQwenClient().chat.completions.create(payload, requestOptions);
}
