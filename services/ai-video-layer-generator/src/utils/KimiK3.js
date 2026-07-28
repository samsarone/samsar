import OpenAI, { toFile } from 'openai';

import { normalizeProviderMediaUrl } from '../AWS.js';
import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';

export const KIMI_K3_PROVIDER_MODEL = 'kimi-k3';
export const KIMI_K3_REASONING_EFFORT = 'high';
export const DEFAULT_KIMI_K3_BASE_URL = 'https://api.moonshot.ai/v1';

const MAX_KIMI_REQUEST_BODY_BYTES = 100 * 1024 * 1024;
const DEFAULT_IMAGE_MIME_TYPE = 'image/png';
const DEFAULT_VIDEO_MIME_TYPE = 'video/mp4';

let cachedClient = null;
let cachedApiKey = '';
let cachedBaseURL = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseURL(value) {
  return (normalizeString(value) || DEFAULT_KIMI_K3_BASE_URL).replace(/\/+$/, '');
}

export function getKimiK3ApiKey(env = process.env) {
  return normalizeString(env?.KIMI_K3_API_KEY);
}

export function getKimiK3BaseURL(env = process.env) {
  return normalizeBaseURL(
    env?.KIMI_K3_BASE_URL ||
    env?.KIMI_API_BASE_URL ||
    env?.MOONSHOT_API_BASE_URL,
  );
}

export function hasKimiK3NativeCredential(env = process.env) {
  return Boolean(getKimiK3ApiKey(env));
}

function getKimiK3Client(env = process.env) {
  const apiKey = getKimiK3ApiKey(env);
  if (!apiKey) {
    throw new Error('KIMI_K3_API_KEY is required for native Kimi K3 inference.');
  }

  const baseURL = getKimiK3BaseURL(env);
  if (!cachedClient || cachedApiKey !== apiKey || cachedBaseURL !== baseURL) {
    cachedClient = new OpenAI({ apiKey, baseURL });
    cachedApiKey = apiKey;
    cachedBaseURL = baseURL;
  }
  return cachedClient;
}

function normalizeMediaDescriptor(value, defaultMimeType) {
  if (typeof value === 'string') {
    return { url: value, mimeType: defaultMimeType };
  }
  if (!value || typeof value !== 'object') {
    return { url: '', mimeType: defaultMimeType };
  }

  const data = normalizeString(value.data || value.base64);
  const mimeType = normalizeString(
    value.media_type ||
    value.mime_type ||
    value.mimeType,
  ) || defaultMimeType;
  const url = data
    ? `data:${mimeType};base64,${data}`
    : value.url ??
      value.uri ??
      value.source ??
      value.src ??
      value.href ??
      value.image_url ??
      value.imageUrl ??
      value.video_url ??
      value.videoUrl ??
      '';

  return { url: normalizeString(url), mimeType };
}

function parseDataURL(value) {
  const match = normalizeString(value).match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mimeType: normalizeString(match[1]) || 'application/octet-stream',
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function getHeader(headers, name) {
  if (typeof headers?.get === 'function') {
    return normalizeString(headers.get(name));
  }
  return normalizeString(headers?.[name] || headers?.[name.toLowerCase()]);
}

function getMimeTypeFromReference(reference, fallback) {
  const normalized = normalizeString(reference).split(/[?#]/)[0].toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.mov')) return 'video/quicktime';
  if (normalized.endsWith('.mpeg') || normalized.endsWith('.mpg')) return 'video/mpeg';
  if (normalized.endsWith('.webm')) return 'video/webm';
  if (normalized.endsWith('.avi')) return 'video/x-msvideo';
  return fallback;
}

async function readRemoteMedia(reference, {
  fetchImpl = globalThis.fetch,
  defaultMimeType,
} = {}) {
  const dataURL = parseDataURL(reference);
  if (dataURL) {
    return dataURL;
  }
  if (!/^https?:\/\//i.test(reference)) {
    throw new Error(
      'Kimi K3 vision input must resolve to base64, ms:// storage, or an HTTP(S) source.',
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to prepare Kimi K3 vision input.');
  }

  const response = await fetchImpl(reference);
  if (!response?.ok) {
    throw new Error(
      `Unable to fetch media for Kimi K3 vision request: ${response?.status || 'unknown status'}`,
    );
  }
  const buffer = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.buffer());
  if (buffer.length >= MAX_KIMI_REQUEST_BODY_BYTES) {
    throw new Error('Kimi K3 vision media must be smaller than the 100 MB request limit.');
  }
  return {
    buffer,
    mimeType: getHeader(response.headers, 'content-type').split(';')[0] ||
      getMimeTypeFromReference(reference, defaultMimeType),
  };
}

function getFileName(reference, mediaKind) {
  try {
    const pathname = new URL(reference).pathname;
    const candidate = pathname.split('/').filter(Boolean).pop();
    if (candidate) return candidate;
  } catch {
    // Fall through to a stable provider filename.
  }
  return mediaKind === 'video' ? 'samsar-video.mp4' : 'samsar-image.png';
}

function getMediaReference(part, mediaKind) {
  if (mediaKind === 'video') {
    return part.video_url ?? part.videoUrl ?? part.video ?? part.url;
  }
  return part.image_url ?? part.imageUrl ?? part.image ?? part.url;
}

function normalizeContentPartType(value) {
  return normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
}

async function normalizeKimiContentPart(part, context) {
  if (typeof part === 'string') {
    return { type: 'text', text: part };
  }
  if (!part || typeof part !== 'object') {
    return part;
  }

  const type = normalizeContentPartType(part.type);
  if (type === 'input_text' || type === 'output_text') {
    return { type: 'text', text: part.text || '' };
  }
  if (type === 'text') {
    return { ...part, type: 'text' };
  }

  if (type === 'image' || type === 'input_image' || type === 'image_url') {
    const descriptor = normalizeMediaDescriptor(
      getMediaReference(part, 'image'),
      DEFAULT_IMAGE_MIME_TYPE,
    );
    if (!descriptor.url) {
      throw new Error('Kimi K3 image input is missing an image reference.');
    }
    if (descriptor.url.startsWith('ms://')) {
      return {
        type: 'image_url',
        image_url: { url: descriptor.url },
      };
    }
    const media = await readRemoteMedia(descriptor.url, {
      fetchImpl: context.fetchImpl,
      defaultMimeType: descriptor.mimeType,
    });
    const inlineURL = `data:${media.mimeType};base64,${media.buffer.toString('base64')}`;
    context.inlineMediaBytes += Buffer.byteLength(inlineURL);
    if (context.inlineMediaBytes >= MAX_KIMI_REQUEST_BODY_BYTES) {
      throw new Error('Kimi K3 vision request media must stay below 100 MB.');
    }
    return {
      type: 'image_url',
      image_url: {
        url: inlineURL,
      },
    };
  }

  if (type === 'video' || type === 'input_video' || type === 'video_url') {
    const descriptor = normalizeMediaDescriptor(
      getMediaReference(part, 'video'),
      DEFAULT_VIDEO_MIME_TYPE,
    );
    if (!descriptor.url) {
      throw new Error('Kimi K3 video input is missing a video reference.');
    }
    if (descriptor.url.startsWith('ms://')) {
      return {
        type: 'video_url',
        video_url: { url: descriptor.url },
      };
    }
    const media = await readRemoteMedia(descriptor.url, {
      fetchImpl: context.fetchImpl,
      defaultMimeType: descriptor.mimeType,
    });
    const uploaded = await context.client.files.create({
      file: await toFile(
        media.buffer,
        getFileName(descriptor.url, 'video'),
        { type: media.mimeType },
      ),
      purpose: 'video',
    });
    const fileId = normalizeString(uploaded?.id);
    if (!fileId) {
      throw new Error('Kimi K3 video upload did not return a file id.');
    }
    context.uploadedFileIds.push(fileId);
    return {
      type: 'video_url',
      video_url: { url: `ms://${fileId}` },
    };
  }

  return part;
}

async function normalizeKimiMessages(messages, context) {
  const sourceMessages = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : Array.isArray(messages) ? messages : [];

  const normalized = [];
  for (const message of sourceMessages) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    let content = message.content;
    if (Array.isArray(message.content)) {
      content = [];
      for (const part of message.content) {
        content.push(await normalizeKimiContentPart(part, context));
      }
    }
    normalized.push({
      ...message,
      role: message.role === 'developer' ? 'system' : message.role,
      content,
    });
  }
  return normalized;
}

function normalizeKimiResponseFormat(responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object') {
    return undefined;
  }
  if (responseFormat.type !== 'json_schema') {
    return responseFormat;
  }
  if (!responseFormat.json_schema?.name || !responseFormat.json_schema?.schema) {
    return responseFormat;
  }
  return {
    ...responseFormat,
    json_schema: {
      ...responseFormat.json_schema,
      strict: true,
    },
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

export async function buildKimiK3ChatRequest(
  chatRequest = {},
  dependencyOverrides = {},
) {
  const {
    authorization,
    bypassSamsarExternalInference,
    samsarExternalInference,
    provider_options,
    providerOptions,
    inference_model,
    inferenceModel,
    reasoning,
    reasoning_effort,
    reasoningEffort,
    temperature,
    top_p,
    n,
    presence_penalty,
    frequency_penalty,
    timeout,
    timeoutMs,
    maxRetries,
    externalMaxRetries,
    max_tokens,
    max_output_tokens,
    max_completion_tokens,
    messages,
    input,
    response_format,
    ...request
  } = chatRequest || {};
  const client = dependencyOverrides.client || getKimiK3Client();
  const context = {
    client,
    fetchImpl: dependencyOverrides.fetch || globalThis.fetch,
    uploadedFileIds: [],
    inlineMediaBytes: 0,
  };
  const resolveMediaUrl =
    dependencyOverrides.resolveMediaUrl || normalizeProviderMediaUrl;
  try {
    const resolvedPayload = await normalizeProviderMediaPayload(
      { messages: messages ?? input ?? [] },
      (value, options) => {
        const normalizedValue = normalizeString(value);
        return normalizedValue.startsWith('ms://')
          ? normalizedValue
          : resolveMediaUrl(value, options);
      },
    );
    const normalizedMessages = await normalizeKimiMessages(
      resolvedPayload.messages,
      context,
    );
    const completionLimit = max_completion_tokens ?? max_output_tokens ?? max_tokens;
    const normalizedResponseFormat = normalizeKimiResponseFormat(response_format);

    return {
      client,
      uploadedFileIds: context.uploadedFileIds,
      payload: {
        ...request,
        model: KIMI_K3_PROVIDER_MODEL,
        messages: normalizedMessages,
        reasoning_effort: KIMI_K3_REASONING_EFFORT,
        ...(completionLimit !== undefined
          ? { max_completion_tokens: completionLimit }
          : {}),
        ...(normalizedResponseFormat
          ? { response_format: normalizedResponseFormat }
          : {}),
      },
      requestOptions: buildRequestOptions({ timeout, timeoutMs, maxRetries }),
    };
  } catch (error) {
    await Promise.allSettled(
      context.uploadedFileIds.map((fileId) => client.files.delete(fileId)),
    );
    throw error;
  }
}

export async function createKimiK3ChatCompletion(
  chatRequest = {},
  dependencyOverrides = {},
) {
  const { client, payload, requestOptions, uploadedFileIds } =
    await buildKimiK3ChatRequest(chatRequest, dependencyOverrides);
  try {
    return await client.chat.completions.create(payload, requestOptions);
  } finally {
    await Promise.allSettled(
      uploadedFileIds.map((fileId) => client.files.delete(fileId)),
    );
  }
}
