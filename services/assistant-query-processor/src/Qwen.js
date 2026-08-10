import OpenAI from 'openai';

import {
  QWEN_38_INFERENCE_MODEL,
  getProviderModelForInferenceModel,
} from './InferenceModels.js';
import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import { resolveProviderMediaPayload } from './ProviderMediaPayload.js';

const DEFAULT_DASHSCOPE_BASE_URL =
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const DEFAULT_QWEN_TIMEOUT_MS = 10 * 60 * 1000;

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
    env?.ALIBABA_API_KEY ||
    env?.DASHSCOPE_API_KEY ||
    env?.ALIBABA_CLOUD_API_KEY ||
    env?.QWEN_API_KEY,
  );
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

function getQwenClient() {
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

function getMediaReference(part = {}) {
  const fields = [
    'image_url', 'imageUrl', 'image_uri', 'imageUri', 'input_image', 'inputImage', 'image',
    'video_url', 'videoUrl', 'video_uri', 'videoUri', 'input_video', 'inputVideo', 'video',
    'image_urls', 'imageUrls', 'image_uris', 'imageUris', 'images',
    'video_urls', 'videoUrls', 'video_uris', 'videoUris', 'videos',
    'url', 'uri', 'source', 'src', 'href', 'urls', 'uris', 'sources',
  ];
  for (const field of fields) {
    if (hasActualMediaReference(part[field])) return part[field];
  }
  return null;
}

function hasActualMediaReference(value, seen = new Set()) {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some((item) => hasActualMediaReference(item, seen));
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return [
    'url', 'uri', 'image_url', 'imageUrl', 'video_url', 'videoUrl',
    'image_urls', 'imageUrls', 'video_urls', 'videoUrls',
    'source', 'src', 'href', 'urls', 'uris', 'sources',
    'data', 'base64', 'file_id', 'fileId',
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key) &&
    hasActualMediaReference(value[key], seen));
}

function isVisionPart(part) {
  const type = normalizeString(part?.type).toLowerCase();
  return ['image', 'image_url', 'input_image', 'video', 'video_url', 'input_video'].includes(type) &&
    hasActualMediaReference(getMediaReference(part));
}

export function hasQwenVisionInput(messages = []) {
  return Array.isArray(messages) && messages.some(
    (message) => Array.isArray(message?.content) && message.content.some(isVisionPart),
  );
}

function normalizeMediaUrl(value) {
  if (typeof value === 'string') return { url: value };
  if (!value || typeof value !== 'object') return { url: '' };
  const data = normalizeString(value.data || value.base64);
  if (data) {
    const mimeType = normalizeString(value.media_type || value.mime_type) || 'image/png';
    return { url: `data:${mimeType};base64,${data}` };
  }
  return { url: value.url ?? value.uri ?? value.image_url ?? value.video_url ?? '' };
}

function getMediaKind(part) {
  const type = normalizeString(part?.type).toLowerCase().replace(/[\s-]+/g, '_');
  if (/(?:^|_)image(?:_|$)/.test(type)) return 'image';
  if (/(?:^|_)video(?:_|$)/.test(type)) return 'video';
  return '';
}

function flattenMediaReferenceValue(value, depth = 0) {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value) && depth < 4) {
    return value.flatMap((entry) => flattenMediaReferenceValue(entry, depth + 1));
  }
  if (!value || typeof value !== 'object' || depth >= 4) return [];
  if (
    hasActualMediaReference(value.data) ||
    hasActualMediaReference(value.base64) ||
    hasActualMediaReference(value.url) ||
    hasActualMediaReference(value.uri) ||
    hasActualMediaReference(value.image_url) ||
    hasActualMediaReference(value.video_url)
  ) {
    return [value];
  }
  return ['source', 'src', 'href', 'urls', 'uris', 'sources']
    .flatMap((field) => flattenMediaReferenceValue(value[field], depth + 1));
}

function getAllMediaReferences(part, mediaKind) {
  const kindFields = mediaKind === 'image'
    ? [
        'image_url', 'imageUrl', 'image_uri', 'imageUri', 'input_image', 'inputImage', 'image',
        'image_urls', 'imageUrls', 'image_uris', 'imageUris', 'images',
      ]
    : [
        'video_url', 'videoUrl', 'video_uri', 'videoUri', 'input_video', 'inputVideo', 'video',
        'video_urls', 'videoUrls', 'video_uris', 'videoUris', 'videos',
      ];
  return [...kindFields, 'url', 'uri', 'source', 'src', 'href', 'urls', 'uris', 'sources']
    .flatMap((field) => flattenMediaReferenceValue(part[field]));
}

function normalizeContentParts(part) {
  if (!part || typeof part !== 'object') return [part];
  if (part.type === 'input_text' || part.type === 'output_text') {
    return [{ type: 'text', text: part.text || '' }];
  }
  const mediaKind = getMediaKind(part);
  if (mediaKind === 'image' || mediaKind === 'video') {
    const references = getAllMediaReferences(part, mediaKind);
    const providerType = mediaKind === 'image' ? 'image_url' : 'video_url';
    return references.map((reference) => ({
      type: providerType,
      [providerType]: normalizeMediaUrl(reference),
    }));
  }
  return [part];
}

export function normalizeMessagesForQwen(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    ...message,
    role: message?.role === 'developer' ? 'system' : message?.role,
    content: Array.isArray(message?.content)
      ? message.content.flatMap(normalizeContentParts)
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
  if (systemIndex >= 0) {
    const systemMessage = nextMessages[systemIndex];
    nextMessages[systemIndex] = {
      ...systemMessage,
      content: typeof systemMessage.content === 'string'
        ? `${systemMessage.content}\n\n${instruction}`
        : [
            ...(Array.isArray(systemMessage.content) ? systemMessage.content : []),
            { type: 'text', text: instruction },
          ],
    };
  } else {
    nextMessages.unshift({ role: 'system', content: instruction });
  }
  return { messages: nextMessages, responseFormat: { type: 'json_object' } };
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function buildQwenChatRequest(chatRequest = {}, env = process.env) {
  const {
    authorization,
    bypassSamsarExternalInference,
    samsarExternalInference,
    provider_options,
    providerOptions,
    inference_model,
    inferenceModel,
    input,
    effort,
    reasoning,
    reasoning_effort,
    reasoningEffort,
    timeout,
    timeoutMs,
    maxRetries,
    externalMaxRetries,
    max_completion_tokens,
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
    normalizeMessagesForQwen(sourceMessages),
    responseFormat,
  );
  const maxTokens = toPositiveInteger(
    request.max_tokens ?? max_completion_tokens ?? max_output_tokens,
  );
  const parsedTimeout = toPositiveInteger(timeout ?? timeoutMs) || DEFAULT_QWEN_TIMEOUT_MS;
  const parsedMaxRetries = Number(maxRetries);
  return {
    payload: {
      ...request,
      model: getProviderModelForInferenceModel(QWEN_38_INFERENCE_MODEL, { env }),
      messages: structured.messages,
      enable_thinking: true,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(structured.responseFormat ? { response_format: structured.responseFormat } : {}),
    },
    requestOptions: {
      timeout: parsedTimeout,
      ...(Number.isInteger(parsedMaxRetries) && parsedMaxRetries >= 0
        ? { maxRetries: parsedMaxRetries }
        : {}),
    },
  };
}

export async function createQwenChatCompletion(chatRequest = {}, dependencyOverrides = {}) {
  const client = dependencyOverrides.client || getQwenClient();
  const initialRequest = buildQwenChatRequest(chatRequest);
  const requestTimeout = initialRequest.requestOptions.timeout;
  const requestedModel = initialRequest.payload.model;

  return runExternalInferenceWithRetry(
    async ({ signal }) => {
      const providerRequest = await resolveProviderMediaPayload(chatRequest, {
        resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
        serviceName: 'samsar_assistant_query_processor_qwen',
      });
      const { payload, requestOptions } = buildQwenChatRequest(providerRequest);
      return client.chat.completions.create(payload, {
        ...requestOptions,
        // This retry loop owns each attempt so media URLs can be refreshed.
        maxRetries: 0,
        signal,
      });
    },
    {
      provider: 'alibaba-qwen',
      model: requestedModel,
      timeoutMs: requestTimeout,
      maxRetries: chatRequest.externalMaxRetries ?? chatRequest.maxRetries,
      ...(dependencyOverrides.retryOptions || {}),
    },
  );
}
