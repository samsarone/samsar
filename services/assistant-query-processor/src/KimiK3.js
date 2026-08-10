import OpenAI, { toFile } from 'openai';

import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import {
  getAccessibleProviderMediaUrl,
  readMountedProviderMediaBufferIfAvailable,
} from './ProviderMediaUrl.js';

export const KIMI_K3_PROVIDER_MODEL = 'kimi-k3';
export const KIMI_K3_REASONING_EFFORT = 'high';
export const DEFAULT_KIMI_K3_BASE_URL = 'https://api.moonshot.ai/v1';

const DEFAULT_KIMI_TIMEOUT_MS = 10 * 60 * 1000;
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

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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

function normalizeContentPartType(value) {
  return normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function getMediaKind(part) {
  const type = normalizeContentPartType(part?.type);
  if (/(?:^|_)image(?:_|$)/.test(type)) return 'image';
  if (/(?:^|_)video(?:_|$)/.test(type)) return 'video';
  return '';
}

function hasMediaReference(value, seen = new Set()) {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some((entry) => hasMediaReference(entry, seen));
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return [
    'url', 'uri', 'source', 'src', 'href',
    'image_url', 'imageUrl', 'video_url', 'videoUrl',
    'data', 'base64', 'file_id', 'fileId',
  ].some((field) => (
    Object.prototype.hasOwnProperty.call(value, field) &&
    hasMediaReference(value[field], seen)
  ));
}

function flattenMediaReferenceValue(value, depth = 0) {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value) && depth < 4) {
    return value.flatMap((entry) => flattenMediaReferenceValue(entry, depth + 1));
  }
  if (!value || typeof value !== 'object' || depth >= 4) return [];
  if (
    hasMediaReference(value.data) ||
    hasMediaReference(value.base64) ||
    hasMediaReference(value.url) ||
    hasMediaReference(value.uri) ||
    hasMediaReference(value.image_url) ||
    hasMediaReference(value.imageUrl) ||
    hasMediaReference(value.video_url) ||
    hasMediaReference(value.videoUrl) ||
    hasMediaReference(value.file_id) ||
    hasMediaReference(value.fileId)
  ) {
    return [value];
  }
  return [
    'source', 'src', 'href', 'urls', 'uris', 'sources',
    'images', 'image_urls', 'imageUrls',
    'videos', 'video_urls', 'videoUrls',
  ].flatMap((field) => flattenMediaReferenceValue(value[field], depth + 1));
}

function getAllMediaReferences(part, mediaKind) {
  const fields = mediaKind === 'image'
    ? [
        'image_url', 'imageUrl', 'image_uri', 'imageUri',
        'input_image', 'inputImage', 'image',
        'image_urls', 'imageUrls', 'image_uris', 'imageUris', 'images',
      ]
    : [
        'video_url', 'videoUrl', 'video_uri', 'videoUri',
        'input_video', 'inputVideo', 'video',
        'video_urls', 'videoUrls', 'video_uris', 'videoUris', 'videos',
      ];
  return [...fields, 'url', 'uri', 'source', 'src', 'href', 'urls', 'uris', 'sources']
    .flatMap((field) => flattenMediaReferenceValue(part?.[field]));
}

function normalizeMediaDescriptor(value, defaultMimeType) {
  if (typeof value === 'string') {
    return { url: value.trim(), mimeType: defaultMimeType };
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
  const fileId = normalizeString(value.file_id || value.fileId);
  const url = data
    ? `data:${mimeType};base64,${data}`
    : fileId
      ? `ms://${fileId}`
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
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.mov')) return 'video/quicktime';
  if (normalized.endsWith('.mpeg') || normalized.endsWith('.mpg')) return 'video/mpeg';
  if (normalized.endsWith('.webm')) return 'video/webm';
  if (normalized.endsWith('.avi')) return 'video/x-msvideo';
  if (normalized.endsWith('.mp4')) return 'video/mp4';
  return fallback;
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

function assertMediaSize(buffer, mediaKind) {
  if (!buffer || buffer.length >= MAX_KIMI_REQUEST_BODY_BYTES) {
    throw new Error(
      `Kimi K3 ${mediaKind} media must be smaller than the 100 MB request limit.`,
    );
  }
}

async function readKimiMedia(reference, mediaKind, descriptor, context) {
  const inline = parseDataURL(reference);
  if (inline) {
    assertMediaSize(inline.buffer, mediaKind);
    return inline;
  }

  const localBuffer = await context.readLocalMediaBuffer(reference, { mediaKind });
  if (localBuffer) {
    const buffer = Buffer.from(localBuffer);
    assertMediaSize(buffer, mediaKind);
    return {
      buffer,
      mimeType: getMimeTypeFromReference(reference, descriptor.mimeType),
    };
  }

  const resolvedReference = await context.resolveMediaUrl(reference, {
    mediaKind,
    serviceName: 'samsar_assistant_query_processor_kimi_k3',
    fetchImpl: context.fetchImpl,
  });
  const resolvedInline = parseDataURL(resolvedReference);
  if (resolvedInline) {
    assertMediaSize(resolvedInline.buffer, mediaKind);
    return resolvedInline;
  }
  if (!/^https?:\/\//i.test(resolvedReference)) {
    throw new Error(
      'Kimi K3 vision input must resolve to base64, ms:// storage, mounted media, or an HTTP(S) source.',
    );
  }
  if (typeof context.fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to prepare Kimi K3 vision input.');
  }

  const response = await context.fetchImpl(resolvedReference);
  if (!response?.ok) {
    throw new Error(
      `Unable to fetch media for Kimi K3 vision request: ${response?.status || 'unknown status'}`,
    );
  }
  const buffer = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.buffer());
  assertMediaSize(buffer, mediaKind);
  return {
    buffer,
    mimeType: getHeader(response.headers, 'content-type').split(';')[0] ||
      getMimeTypeFromReference(resolvedReference, descriptor.mimeType),
  };
}

async function normalizeKimiMediaPart(part, mediaKind, context) {
  const references = getAllMediaReferences(part, mediaKind);
  if (!references.length) {
    throw new Error(`Kimi K3 ${mediaKind} input is missing a media reference.`);
  }

  const providerParts = [];
  for (const reference of references) {
    const descriptor = normalizeMediaDescriptor(
      reference,
      mediaKind === 'video' ? DEFAULT_VIDEO_MIME_TYPE : DEFAULT_IMAGE_MIME_TYPE,
    );
    if (!descriptor.url) {
      throw new Error(`Kimi K3 ${mediaKind} input is missing a media reference.`);
    }
    if (descriptor.url.startsWith('ms://')) {
      const providerType = mediaKind === 'video' ? 'video_url' : 'image_url';
      providerParts.push({
        type: providerType,
        [providerType]: { url: descriptor.url },
      });
      continue;
    }

    const media = await readKimiMedia(descriptor.url, mediaKind, descriptor, context);
    if (mediaKind === 'image') {
      const inlineImageUrl = `data:${media.mimeType};base64,${media.buffer.toString('base64')}`;
      context.inlineMediaBytes += Buffer.byteLength(inlineImageUrl);
      if (context.inlineMediaBytes >= MAX_KIMI_REQUEST_BODY_BYTES) {
        throw new Error('Kimi K3 vision request media must stay below 100 MB.');
      }
      providerParts.push({
        type: 'image_url',
        image_url: {
          url: inlineImageUrl,
        },
      });
      continue;
    }

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
    providerParts.push({
      type: 'video_url',
      video_url: { url: `ms://${fileId}` },
    });
  }
  return providerParts;
}

async function normalizeKimiContentPart(part, context) {
  if (typeof part === 'string') {
    return [{ type: 'text', text: part }];
  }
  if (!part || typeof part !== 'object') {
    return [];
  }

  const type = normalizeContentPartType(part.type);
  if (type === 'input_text' || type === 'output_text' || type === 'text') {
    return [{ type: 'text', text: part.text || '' }];
  }
  const mediaKind = getMediaKind(part);
  if (mediaKind) {
    return normalizeKimiMediaPart(part, mediaKind, context);
  }
  if (typeof part.text === 'string') {
    return [{ type: 'text', text: part.text }];
  }
  return [part];
}

async function normalizeKimiMessages(messages, context) {
  const sourceMessages = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : Array.isArray(messages) ? messages : [];
  const normalized = [];

  for (const message of sourceMessages) {
    if (!message || typeof message !== 'object') continue;
    const content = Array.isArray(message.content)
      ? (await Promise.all(
        message.content.map((part) => normalizeKimiContentPart(part, context)),
      )).flat()
      : message.content;
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

async function deleteUploadedFiles(client, fileIds) {
  if (typeof client?.files?.delete !== 'function') return;
  await Promise.allSettled(fileIds.map((fileId) => client.files.delete(fileId)));
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
    effort,
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
    fetchImpl: dependencyOverrides.fetch || dependencyOverrides.fetchImpl || globalThis.fetch,
    readLocalMediaBuffer:
      dependencyOverrides.readLocalMediaBuffer ||
      readMountedProviderMediaBufferIfAvailable,
    resolveMediaUrl: dependencyOverrides.resolveMediaUrl || getAccessibleProviderMediaUrl,
    uploadedFileIds: [],
    inlineMediaBytes: 0,
  };

  try {
    const normalizedMessages = await normalizeKimiMessages(messages ?? input ?? [], context);
    const completionLimit = max_completion_tokens ?? max_output_tokens ?? max_tokens;
    const responseFormat = normalizeKimiResponseFormat(response_format);
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
        ...(responseFormat ? { response_format: responseFormat } : {}),
      },
      requestOptions: {
        timeout: toPositiveInteger(timeout ?? timeoutMs, DEFAULT_KIMI_TIMEOUT_MS),
      },
    };
  } catch (error) {
    await deleteUploadedFiles(client, context.uploadedFileIds);
    throw error;
  }
}

export async function createKimiK3ChatCompletion(
  chatRequest = {},
  dependencyOverrides = {},
) {
  const client = dependencyOverrides.client || getKimiK3Client();
  const timeoutMs = toPositiveInteger(
    chatRequest.timeout ?? chatRequest.timeoutMs,
    DEFAULT_KIMI_TIMEOUT_MS,
  );
  return runExternalInferenceWithRetry(
    async ({ signal }) => {
      const { payload, requestOptions, uploadedFileIds } =
        await buildKimiK3ChatRequest(chatRequest, {
          ...dependencyOverrides,
          client,
        });
      try {
        return await client.chat.completions.create(payload, {
          ...requestOptions,
          maxRetries: 0,
          signal,
        });
      } finally {
        await deleteUploadedFiles(client, uploadedFileIds);
      }
    },
    {
      provider: 'kimi',
      model: KIMI_K3_PROVIDER_MODEL,
      timeoutMs,
      maxRetries: chatRequest.externalMaxRetries ?? chatRequest.maxRetries,
      ...(dependencyOverrides.retryOptions || {}),
    },
  );
}
