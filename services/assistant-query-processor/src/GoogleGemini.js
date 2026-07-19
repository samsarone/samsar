import { getGoogleAccessToken, getGoogleCloudConfig } from './GoogleADC.js';
import {
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  DEFAULT_INFERENCE_MODEL,
  getProviderModelForInferenceModel,
} from './InferenceModels.js';
import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import { readMountedProviderMediaBufferIfAvailable } from './ProviderMediaUrl.js';

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
  const providerModel = normalizeString(getProviderModelForInferenceModel(model));
  return providerModel && providerModel !== DEFAULT_INFERENCE_MODEL
    ? providerModel
    : DEFAULT_GEMINI_31_PRO_VERTEX_MODEL;
}

function buildVertexGenerateContentUrl({ projectId, location, model }) {
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;

  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function parseDataUrl(dataUrl) {
  const match = typeof dataUrl === 'string'
    ? dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
    : null;
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
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const signal = options.signal;
  const inlineData = imageUrl && typeof imageUrl === 'object'
    ? normalizeString(imageUrl.data || imageUrl.base64)
    : '';
  const inlineMimeType = imageUrl && typeof imageUrl === 'object'
    ? normalizeString(imageUrl.media_type || imageUrl.mime_type || imageUrl.mimeType)
    : '';
  const normalizedUrl = inlineData
    ? `data:${inlineMimeType || DEFAULT_IMAGE_MIME_TYPE};base64,${inlineData}`
    : normalizeString(
      typeof imageUrl === 'string'
        ? imageUrl
        : imageUrl?.url || imageUrl?.uri || imageUrl?.image_url || imageUrl?.imageUrl,
    );
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

  const readLocalMediaBuffer = options.readLocalMediaBuffer || readMountedProviderMediaBufferIfAvailable;
  const localBuffer = await readLocalMediaBuffer(normalizedUrl, { mediaKind: 'image' });
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

  const response = await fetchImpl(normalizedUrl, { signal });
  if (!response.ok) {
    const error = new Error(`Unable to fetch image for Gemini vision request: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const mimeType = response.headers.get('content-type')?.split(';')?.[0] || DEFAULT_IMAGE_MIME_TYPE;
  const buffer = Buffer.from(await response.arrayBuffer());
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

function flattenImageReferences(value, depth = 0) {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value) && depth < 4) {
    return value.flatMap((entry) => flattenImageReferences(entry, depth + 1));
  }
  if (!value || typeof value !== 'object' || depth >= 4) return [];
  if (
    normalizeString(value.data || value.base64) ||
    normalizeString(value.url || value.uri || value.image_url || value.imageUrl)
  ) {
    return [value];
  }
  return [
    'image_url', 'imageUrl', 'image_uri', 'imageUri',
    'source', 'urls', 'uris', 'sources',
  ]
    .flatMap((field) => flattenImageReferences(value[field], depth + 1));
}

function getImageReferences(item) {
  return [
    'image_url', 'imageUrl', 'image_uri', 'imageUri', 'input_image', 'inputImage', 'image',
    'image_urls', 'imageUrls', 'image_uris', 'imageUris', 'images',
    'url', 'uri', 'source', 'urls', 'uris', 'sources',
  ].flatMap((field) => flattenImageReferences(item?.[field]));
}

function isTypedImagePart(item) {
  const type = normalizeString(item?.type).toLowerCase().replace(/[\s-]+/g, '_');
  return /(?:^|_)image(?:_|$)/.test(type);
}

function stringifySystemContent(content) {
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
      if ((part?.type === 'text' || part?.type === 'input_text') && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
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

    if (isTypedImagePart(item)) {
      for (const imageReference of getImageReferences(item)) {
        const imagePart = await buildInlineImagePart(imageReference, options);
        if (imagePart) parts.push(imagePart);
      }
    }
  }

  return parts;
}

async function buildGeminiContents(messages = [], options = {}) {
  const systemParts = [];
  const contents = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    if (message.role === 'system' || message.role === 'developer') {
      const systemText = stringifySystemContent(message.content);
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

  return {
    systemInstruction: systemParts.length
      ? { parts: systemParts.map((text) => ({ text })) }
      : undefined,
    contents,
  };
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

function normalizeGeminiThinkingLevel(value) {
  const normalized = normalizeString(value).toUpperCase().replace(/-/g, '_');
  if (GEMINI_3_THINKING_LEVELS.has(normalized)) return normalized;
  if (normalized === 'MINIMAL' || normalized === 'NONE') return 'LOW';
  return '';
}

function resolveGeminiThinkingLevel(options = {}) {
  return (
    normalizeGeminiThinkingLevel(options.thinking_level) ||
    normalizeGeminiThinkingLevel(options.thinkingLevel) ||
    normalizeGeminiThinkingLevel(options.reasoning_effort) ||
    normalizeGeminiThinkingLevel(options.reasoningEffort) ||
    normalizeGeminiThinkingLevel(options.reasoning?.effort) ||
    normalizeGeminiThinkingLevel(process.env.GOOGLE_GEMINI_THINKING_LEVEL) ||
    DEFAULT_GEMINI_3_THINKING_LEVEL
  );
}

function getMaxOutputTokens(options = {}) {
  return (
    options.max_output_tokens ??
    options.maxOutputTokens ??
    options.max_tokens ??
    options.max_completion_tokens
  );
}

function buildGenerationConfig(options = {}, model = '') {
  const generationConfig = {};
  const isGemini3Model = normalizeString(model).startsWith('gemini-3');

  if (options.temperature !== undefined) {
    const temperature = Number(options.temperature);
    if (Number.isFinite(temperature)) {
      generationConfig.temperature = temperature;
    }
  }

  const topPValue = options.top_p ?? options.topP;
  if (topPValue !== undefined) {
    const topP = Number(topPValue);
    if (Number.isFinite(topP)) {
      generationConfig.topP = topP;
    }
  }

  const maxTokens = Number(getMaxOutputTokens(options));
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    const normalizedMaxTokens = Math.floor(maxTokens);
    generationConfig.maxOutputTokens = isGemini3Model
      ? Math.max(normalizedMaxTokens, MIN_GEMINI_3_MAX_OUTPUT_TOKENS)
      : normalizedMaxTokens;
  }

  if (isGemini3Model) {
    generationConfig.thinkingConfig = {
      thinkingLevel: resolveGeminiThinkingLevel(options),
    };
  }

  return Object.keys(generationConfig).length ? generationConfig : undefined;
}

function normalizeGeminiUsage(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object') {
    return null;
  }

  const promptTokens = Number(usageMetadata.promptTokenCount) || 0;
  const completionTokens = Number(usageMetadata.candidatesTokenCount) || 0;
  const totalTokens = Number(usageMetadata.totalTokenCount) || promptTokens + completionTokens;
  const cachedTokens = Number(usageMetadata.cachedContentTokenCount) || 0;
  const reasoningTokens = Number(usageMetadata.thoughtsTokenCount) || 0;

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

function normalizeGeminiToResponses(response, outputText, model) {
  return {
    id: response?.responseId || null,
    model,
    usage: normalizeGeminiUsage(response?.usageMetadata),
    google_response: {
      modelVersion: response?.modelVersion || null,
      createTime: response?.createTime || null,
      promptFeedback: response?.promptFeedback || null,
    },
    output_text: outputText,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: outputText,
          },
        ],
      },
    ],
  };
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

export async function sendAssistantGeminiCompletionRequest(
  messageList,
  inferenceModel,
  options = {},
  dependencyOverrides = {},
) {
  const model = resolveGeminiModel(options.model || options.providerModel || options.vertexModel || inferenceModel);
  const location = resolveGeminiLocation(options);
  const getCloudConfig = dependencyOverrides.getGoogleCloudConfig || getGoogleCloudConfig;
  const getAccessToken = dependencyOverrides.getGoogleAccessToken || getGoogleAccessToken;
  const fetchImpl = dependencyOverrides.fetchImpl || globalThis.fetch;
  const config = getCloudConfig({ ...options, location });
  const projectId = normalizeString(config.projectId);

  if (!projectId) {
    throw new Error('Google Gemini inference requires GOOGLE_CLOUD_PROJECT or GOOGLE_PROJECT_ID.');
  }

  const generationConfig = buildGenerationConfig(options, model);
  const timeoutMs = getGeminiTimeoutMs(options);
  const responsePayload = await runExternalInferenceWithRetry(
    async ({ signal }) => {
      const { systemInstruction, contents } = await buildGeminiContents(messageList, {
        fetchImpl,
        signal,
        readLocalMediaBuffer: dependencyOverrides.readLocalMediaBuffer,
      });
      if (!contents.length) {
        const error = new Error('Google Gemini inference requires at least one user message.');
        error.retryable = false;
        throw error;
      }
      const requestBody = {
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
        ...(generationConfig ? { generationConfig } : {}),
      };
      const token = await getAccessToken(config);
      const response = await fetchImpl(buildVertexGenerateContentUrl({ projectId, location, model }), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });
      const responseText = await response.text();
      const payload = responseText ? JSON.parse(responseText) : {};
      if (!response.ok) {
        const error = new Error(
          payload?.error?.message || `Google Gemini inference failed with status ${response.status}`,
        );
        error.status = response.status;
        error.error = summarizeGeminiError(payload);
        throw error;
      }
      return payload;
    },
    {
      provider: 'google-gemini',
      model,
      timeoutMs,
      maxRetries: options.externalMaxRetries ?? options.maxRetries,
      ...(dependencyOverrides.retryOptions || {}),
    },
  );

  const outputText = extractGeminiOutputText(responsePayload);
  return {
    model,
    response: normalizeGeminiToResponses(responsePayload, outputText, model),
    outputText,
    outputContent: [
      {
        type: 'output_text',
        text: outputText,
      },
    ],
  };
}
