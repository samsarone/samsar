import fetch from 'node-fetch';

import { getGoogleAccessToken, getGoogleCloudConfig } from './GoogleADC.js';
import {
  getProviderModelForInferenceModel,
} from '../consts/InferenceModels.js';
import { readLocalMediaBufferIfAvailable } from '../utils/LocalMediaAsset.js';

const DEFAULT_GEMINI_LOCATION = 'global';
const DEFAULT_IMAGE_MIME_TYPE = 'image/png';
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;
const DEFAULT_GEMINI_3_THINKING_LEVEL = 'MEDIUM';
const GEMINI_3_THINKING_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const MIN_GEMINI_3_MAX_OUTPUT_TOKENS = 64;
const DEFAULT_GEMINI_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getGeminiTimeoutMs(options = {}) {
  const parsed = Number(
    options.timeout ??
    options.timeoutMs ??
    process.env.GOOGLE_GEMINI_TIMEOUT_MS
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_GEMINI_TIMEOUT_MS;
}

function resolveGeminiLocation(options = {}) {
  return (
    normalizeString(options.location) ||
    normalizeString(process.env.GOOGLE_GEMINI_LOCATION) ||
    normalizeString(process.env.GOOGLE_VERTEX_AI_LOCATION) ||
    DEFAULT_GEMINI_LOCATION
  );
}

function resolveGeminiModel(model) {
  return normalizeString(getProviderModelForInferenceModel(model));
}

function buildVertexGenerateContentUrl({ projectId, location, model }) {
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;

  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function extractJsonSchema(responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object') {
    return null;
  }

  if (responseFormat.type === 'json_schema' && responseFormat.json_schema?.schema) {
    return responseFormat.json_schema.schema;
  }

  if (responseFormat.type === 'json_object') {
    return { type: 'object' };
  }

  return null;
}

function normalizeSchemaType(type) {
  if (Array.isArray(type)) {
    const firstConcreteType = type.find((item) => {
      const normalized = normalizeString(item).toUpperCase();
      return normalized && normalized !== 'NULL';
    });
    return normalizeSchemaType(firstConcreteType);
  }

  if (typeof type !== 'string' || !type.trim()) {
    return type;
  }

  return type.trim().toUpperCase();
}

export function normalizeJsonSchemaForGemini(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      key === '$schema' ||
      key === '$id' ||
      key === 'additionalProperties' ||
      key === 'strict'
    ) {
      continue;
    }

    if (key === 'type') {
      normalized.type = normalizeSchemaType(value);
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      normalized.properties = Object.fromEntries(
        Object.entries(value).map(([propertyName, propertySchema]) => [
          propertyName,
          normalizeJsonSchemaForGemini(propertySchema),
        ])
      );
      continue;
    }

    if (key === 'items') {
      normalized.items = normalizeJsonSchemaForGemini(value);
      continue;
    }

    if (key === 'enum' && Array.isArray(value)) {
      const enumValues = value.filter((item) => item !== '');
      if (enumValues.length) {
        normalized.enum = enumValues;
      }
      continue;
    }

    if (key === 'anyOf' || key === 'oneOf') {
      const variants = Array.isArray(value)
        ? value.map(normalizeJsonSchemaForGemini).filter(Boolean)
        : [];
      const concreteVariants = variants.filter((variant) => normalizeSchemaType(variant?.type) !== 'NULL');
      if (concreteVariants.length === 1) {
        Object.assign(normalized, concreteVariants[0]);
      }
      continue;
    }

    if (key === 'allOf') {
      const variants = Array.isArray(value)
        ? value.map(normalizeJsonSchemaForGemini).filter(Boolean)
        : [];
      for (const variant of variants) {
        Object.assign(normalized, variant);
      }
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function stringifyMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return content == null ? '' : String(content);
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part?.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function appendStructuredOutputInstruction(systemParts, responseFormat) {
  const schema = extractJsonSchema(responseFormat);
  if (!schema) {
    return;
  }

  systemParts.push(
    'Return only valid JSON that conforms to the provided response schema.'
  );
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') {
    return null;
  }

  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1] || DEFAULT_IMAGE_MIME_TYPE,
    data: match[2],
  };
}

function getImageMimeType(reference) {
  const normalized = normalizeString(reference).split('?')[0].split('#')[0].toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.avif')) return 'image/avif';
  return DEFAULT_IMAGE_MIME_TYPE;
}

async function buildInlineImagePart(imageUrl, options = {}) {
  const url = typeof imageUrl === 'string' ? imageUrl : imageUrl?.url;
  const normalizedUrl = normalizeString(url);
  if (!normalizedUrl) {
    return null;
  }

  const dataImage = parseDataUrl(normalizedUrl);
  if (dataImage) {
    return {
      inlineData: {
        mimeType: dataImage.mimeType,
        data: dataImage.data,
      },
    };
  }

  const readLocalMediaBuffer = options.readLocalMediaBuffer || readLocalMediaBufferIfAvailable;
  const localBuffer = await readLocalMediaBuffer(normalizedUrl);
  if (localBuffer) {
    if (localBuffer.length > MAX_INLINE_IMAGE_BYTES) {
      throw new Error('Image is too large for inline Gemini vision input.');
    }
    return {
      inlineData: {
        mimeType: getImageMimeType(normalizedUrl),
        data: localBuffer.toString('base64'),
      },
    };
  }

  const response = await (options.fetchImpl || fetch)(normalizedUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch image for Gemini vision request: ${response.status}`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')?.[0] || DEFAULT_IMAGE_MIME_TYPE;
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
    throw new Error('Image is too large for inline Gemini vision input.');
  }

  return {
    inlineData: {
      mimeType,
      data: buffer.toString('base64'),
    },
  };
}

async function normalizeContentParts(content, options = {}) {
  if (typeof content === 'string') {
    return content ? [{ text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return content == null ? [] : [{ text: String(content) }];
  }

  const parts = [];
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push({ text: item });
      continue;
    }

    if (!item || typeof item !== 'object') {
      continue;
    }

    if ((item.type === 'text' || item.type === 'input_text') && typeof item.text === 'string') {
      parts.push({ text: item.text });
      continue;
    }

    if ((item.type === 'image_url' && item.image_url) || (item.type === 'input_image' && item.image_url)) {
      const imagePart = await buildInlineImagePart(item.image_url, options);
      if (imagePart) {
        parts.push(imagePart);
      }
    }
  }

  return parts;
}

async function buildGeminiContents(messages = [], responseFormat, options = {}) {
  const systemParts = [];
  const contents = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    if (message.role === 'system' || message.role === 'developer') {
      const systemText = stringifyMessageContent(message.content);
      if (systemText) {
        systemParts.push(systemText);
      }
      continue;
    }

    const role = message.role === 'assistant' || message.role === 'model' ? 'model' : 'user';
    const parts = await normalizeContentParts(message.content, options);
    if (parts.length) {
      contents.push({ role, parts });
    }
  }

  appendStructuredOutputInstruction(systemParts, responseFormat);

  return {
    systemInstruction: systemParts.length
      ? { parts: systemParts.map((text) => ({ text })) }
      : undefined,
    contents,
  };
}

function normalizeGeminiThinkingLevel(value) {
  const normalized = normalizeString(value).toUpperCase().replace(/-/g, '_');
  if (GEMINI_3_THINKING_LEVELS.has(normalized)) return normalized;
  if (normalized === 'MINIMAL' || normalized === 'NONE') return 'LOW';
  return '';
}

function resolveGeminiThinkingLevel(chatRequest = {}) {
  return (
    normalizeGeminiThinkingLevel(chatRequest.thinking_level) ||
    normalizeGeminiThinkingLevel(chatRequest.thinkingLevel) ||
    normalizeGeminiThinkingLevel(chatRequest.reasoning_effort) ||
    normalizeGeminiThinkingLevel(chatRequest.reasoningEffort) ||
    normalizeGeminiThinkingLevel(chatRequest.reasoning?.effort) ||
    normalizeGeminiThinkingLevel(process.env.GOOGLE_GEMINI_THINKING_LEVEL) ||
    DEFAULT_GEMINI_3_THINKING_LEVEL
  );
}

function buildGenerationConfig(chatRequest = {}, model = '') {
  const generationConfig = {};
  const jsonSchema = extractJsonSchema(chatRequest.response_format);
  const isGemini3Model = normalizeString(model).startsWith('gemini-3');

  if (chatRequest.temperature !== undefined) {
    generationConfig.temperature = Number(chatRequest.temperature);
  }

  if (chatRequest.top_p !== undefined) {
    generationConfig.topP = Number(chatRequest.top_p);
  }

  const maxTokens = Number(chatRequest.max_tokens ?? chatRequest.max_completion_tokens);
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    const normalizedMaxTokens = Math.floor(maxTokens);
    generationConfig.maxOutputTokens = isGemini3Model
      ? Math.max(normalizedMaxTokens, MIN_GEMINI_3_MAX_OUTPUT_TOKENS)
      : normalizedMaxTokens;
  }

  if (jsonSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = normalizeJsonSchemaForGemini(jsonSchema);
  }

  if (isGemini3Model) {
    generationConfig.thinkingConfig = {
      thinkingLevel: resolveGeminiThinkingLevel(chatRequest),
    };
  }

  return Object.keys(generationConfig).length ? generationConfig : undefined;
}

function extractGeminiOutputText(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('');
}

function summarizeGeminiError(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return {
    code: payload.error?.code ?? null,
    status: payload.error?.status ?? null,
    message: payload.error?.message ?? null,
  };
}

function normalizeGeminiFinishReason(finishReason) {
  const normalized = normalizeString(finishReason).toUpperCase();
  if (!normalized) {
    return null;
  }

  if (normalized === 'STOP' || normalized === 'FINISH_REASON_STOP') {
    return 'stop';
  }

  if (normalized === 'MAX_TOKENS' || normalized === 'FINISH_REASON_MAX_TOKENS') {
    return 'length';
  }

  if (
    normalized === 'SAFETY' ||
    normalized === 'RECITATION' ||
    normalized === 'BLOCKLIST' ||
    normalized === 'PROHIBITED_CONTENT' ||
    normalized === 'IMAGE_PROHIBITED_CONTENT' ||
    normalized.startsWith('FINISH_REASON_SAFETY') ||
    normalized.startsWith('FINISH_REASON_RECITATION') ||
    normalized.startsWith('FINISH_REASON_BLOCKLIST') ||
    normalized.startsWith('FINISH_REASON_PROHIBITED_CONTENT') ||
    normalized.startsWith('FINISH_REASON_IMAGE_PROHIBITED_CONTENT')
  ) {
    return 'content_filter';
  }

  return normalized.toLowerCase();
}

export function normalizeGeminiUsage(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object') {
    return null;
  }

  const promptTokens = Number(usageMetadata.promptTokenCount) || 0;
  const reasoningTokens = Number(usageMetadata.thoughtsTokenCount) || 0;
  // Vertex reports visible candidate tokens and thinking tokens separately,
  // but both are billed at the model's output-token rate.
  const completionTokens = (Number(usageMetadata.candidatesTokenCount) || 0) + reasoningTokens;
  const totalTokens = Number(usageMetadata.totalTokenCount) || promptTokens + completionTokens;
  const cachedTokens = Number(usageMetadata.cachedContentTokenCount) || 0;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    prompt_tokens_details: {
      cached_tokens: cachedTokens,
    },
    completion_tokens_details: {
      reasoning_tokens: reasoningTokens,
    },
    input_tokens: promptTokens,
    output_tokens: completionTokens,
    input_tokens_details: {
      cached_tokens: cachedTokens,
    },
    output_tokens_details: {
      reasoning_tokens: reasoningTokens,
    },
    google_usage_metadata: usageMetadata,
  };
}

export async function createGoogleGeminiChatCompletion(chatRequest = {}, dependencyOverrides = {}) {
  const model = resolveGeminiModel(chatRequest.model);
  const location = resolveGeminiLocation(chatRequest);
  const config = getGoogleCloudConfig({ ...chatRequest, location });
  const projectId = normalizeString(config.projectId);

  if (!projectId) {
    throw new Error('Google Gemini inference requires GOOGLE_CLOUD_PROJECT or GOOGLE_PROJECT_ID.');
  }

  const { systemInstruction, contents } = await buildGeminiContents(
    chatRequest.messages,
    chatRequest.response_format,
    {
      fetchImpl: typeof dependencyOverrides.fetch === 'function'
        ? dependencyOverrides.fetch
        : fetch,
      readLocalMediaBuffer: dependencyOverrides.readLocalMediaBuffer,
    },
  );

  if (!contents.length) {
    throw new Error('Google Gemini inference requires at least one user message.');
  }

  const generationConfig = buildGenerationConfig(chatRequest, model);
  const requestBody = {
    ...(systemInstruction ? { systemInstruction } : {}),
    contents,
    ...(generationConfig ? { generationConfig } : {}),
  };

  const token = typeof dependencyOverrides.getAccessToken === 'function'
    ? await dependencyOverrides.getAccessToken(config)
    : await getGoogleAccessToken(config);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getGeminiTimeoutMs(chatRequest));
  let response;
  try {
    const fetchImpl = typeof dependencyOverrides.fetch === 'function'
      ? dependencyOverrides.fetch
      : fetch;
    response = await fetchImpl(buildVertexGenerateContentUrl({ projectId, location, model }), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const responseText = await response.text();
  const responsePayload = responseText ? JSON.parse(responseText) : {};

  if (!response.ok) {
    const error = new Error(
      responsePayload?.error?.message || `Google Gemini inference failed with status ${response.status}`
    );
    error.status = response.status;
    error.error = summarizeGeminiError(responsePayload);
    throw error;
  }

  const outputText = extractGeminiOutputText(responsePayload);
  const candidate = responsePayload?.candidates?.[0] || {};

  return {
    id: responsePayload?.responseId || null,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    usage: normalizeGeminiUsage(responsePayload?.usageMetadata),
    google_response: {
      modelVersion: responsePayload?.modelVersion || null,
      createTime: responsePayload?.createTime || null,
      promptFeedback: responsePayload?.promptFeedback || null,
    },
    choices: [
      {
        index: Number.isInteger(candidate?.index) ? candidate.index : 0,
        message: {
          role: 'assistant',
          content: outputText,
        },
        finish_reason: normalizeGeminiFinishReason(candidate?.finishReason),
      },
    ],
  };
}
