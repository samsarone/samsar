import { getGoogleAccessToken, getGoogleCloudConfig } from './GoogleADC.js';
import {
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  getProviderModelForInferenceModel,
} from './InferenceModels.js';

const DEFAULT_GEMINI_LOCATION = 'global';
const DEFAULT_IMAGE_MIME_TYPE = 'image/png';
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;
const DEFAULT_GEMINI_3_THINKING_LEVEL = 'MEDIUM';
const GEMINI_3_THINKING_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveGeminiLocation() {
  return (
    normalizeString(process.env.GOOGLE_GEMINI_LOCATION) ||
    normalizeString(process.env.GOOGLE_VERTEX_AI_LOCATION) ||
    DEFAULT_GEMINI_LOCATION
  );
}

function resolveGeminiModel(model) {
  return (
    normalizeString(getProviderModelForInferenceModel(model)) ||
    normalizeString(process.env.GOOGLE_GEMINI_31_PRO_MODEL) ||
    normalizeString(process.env.GOOGLE_GEMINI_PRO_MODEL) ||
    DEFAULT_GEMINI_31_PRO_VERTEX_MODEL
  );
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
  return { mimeType: match[1] || DEFAULT_IMAGE_MIME_TYPE, data: match[2] };
}

async function buildInlineImagePart(imageUrl) {
  const normalizedUrl = normalizeString(typeof imageUrl === 'string' ? imageUrl : imageUrl?.url);
  if (!normalizedUrl) {
    return null;
  }

  const dataImage = parseDataUrl(normalizedUrl);
  if (dataImage) {
    return { inlineData: { mimeType: dataImage.mimeType, data: dataImage.data } };
  }

  const response = await fetch(normalizedUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch image for Gemini vision request: ${response.status}`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')?.[0] || DEFAULT_IMAGE_MIME_TYPE;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
    throw new Error('Image is too large for inline Gemini vision input.');
  }

  return { inlineData: { mimeType, data: buffer.toString('base64') } };
}

function stringifyTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return content == null ? '' : String(content);
  }

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if ((item?.type === 'text' || item?.type === 'input_text') && typeof item.text === 'string') {
        return item.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

async function normalizeContentParts(content) {
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
      const imagePart = await buildInlineImagePart(item.image_url);
      if (imagePart) {
        parts.push(imagePart);
      }
    }
  }
  return parts;
}

async function buildGeminiContents(messages = []) {
  const systemParts = [];
  const contents = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    if (message.role === 'system' || message.role === 'developer') {
      const systemText = stringifyTextContent(message.content);
      if (systemText) {
        systemParts.push(systemText);
      }
      continue;
    }

    const parts = await normalizeContentParts(message.content);
    if (parts.length) {
      contents.push({
        role: message.role === 'assistant' || message.role === 'model' ? 'model' : 'user',
        parts,
      });
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
  return parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

function normalizeGeminiThinkingLevel(value) {
  const normalized = normalizeString(value).toUpperCase().replace(/-/g, '_');
  if (GEMINI_3_THINKING_LEVELS.has(normalized)) return normalized;
  if (normalized === 'MINIMAL' || normalized === 'NONE') return 'LOW';
  return '';
}

function buildGenerationConfig(model = '') {
  if (!normalizeString(model).startsWith('gemini-3')) return undefined;
  return {
    thinkingConfig: {
      thinkingLevel: normalizeGeminiThinkingLevel(process.env.GOOGLE_GEMINI_THINKING_LEVEL) || DEFAULT_GEMINI_3_THINKING_LEVEL,
    },
  };
}

export async function createGoogleGeminiChatCompletion(messages, inferenceModel) {
  const model = resolveGeminiModel(inferenceModel);
  const location = resolveGeminiLocation();
  const config = getGoogleCloudConfig();
  const projectId = normalizeString(config.projectId);

  if (!projectId) {
    throw new Error('Google Gemini inference requires GOOGLE_CLOUD_PROJECT or GOOGLE_PROJECT_ID.');
  }

  const { systemInstruction, contents } = await buildGeminiContents(messages);
  if (!contents.length) {
    throw new Error('Google Gemini inference requires at least one user message.');
  }

  const token = await getGoogleAccessToken(config);
  const generationConfig = buildGenerationConfig(model);
  const response = await fetch(buildVertexGenerateContentUrl({ projectId, location, model }), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(systemInstruction ? { systemInstruction } : {}),
      contents,
      ...(generationConfig ? { generationConfig } : {}),
    }),
  });

  const responseText = await response.text();
  const payload = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Google Gemini inference failed with status ${response.status}`);
  }

  return {
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: extractGeminiOutputText(payload),
        },
      },
    ],
    usage: payload?.usageMetadata || null,
  };
}
