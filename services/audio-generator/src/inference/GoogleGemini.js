import fetch from 'node-fetch';

import { getGoogleAccessToken, getGoogleCloudConfig } from './GoogleADC.js';
import {
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  getProviderModelForInferenceModel,
} from './InferenceModels.js';
import { readMountedProviderMediaBufferIfAvailable } from '../utils/ProviderMediaUrl.js';

const DEFAULT_GEMINI_LOCATION = 'global';
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

function normalizeTextContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return content == null ? '' : String(content);
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if ((item?.type === 'text' || item?.type === 'input_text') && typeof item.text === 'string') {
        return item.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function inferImageItem(item) {
  if (!item || typeof item !== 'object') return false;
  const type = normalizeString(item.type).toLowerCase().replace(/-/g, '_');
  return type.includes('image') || [
    item.image_url,
    item.imageUrl,
    item.image,
    item.images,
    item.image_urls,
    item.imageUrls,
  ].some((value) => value !== undefined);
}

function flattenImageReferences(value, defaultMimeType = 'image/png') {
  if (typeof value === 'string') return value.trim() ? [{ url: value.trim() }] : [];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenImageReferences(item, defaultMimeType));
  }
  const data = normalizeString(value.data || value.base64);
  if (data) {
    return [{
      data,
      mimeType: normalizeString(value.media_type || value.mime_type || value.mimeType) || defaultMimeType,
    }];
  }
  return flattenImageReferences(
    value.url ?? value.uri ?? value.urls ?? value.uris ?? value.source ?? value.sources ??
      value.image_url ?? value.imageUrl ?? value.image,
    defaultMimeType,
  );
}

function getImageReferences(item) {
  return flattenImageReferences(
    item.image_url ?? item.imageUrl ?? item.image ?? item.images ??
      item.image_urls ?? item.imageUrls ?? item.url ?? item.uri ??
      item.urls ?? item.uris ?? item.source ?? item.sources,
  );
}

function parseImageDataUrl(value) {
  const match = /^data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?,([\s\S]+)$/i.exec(value);
  if (!match) return null;
  const header = value.slice(0, value.indexOf(','));
  const data = /;base64(?:;|$)/i.test(header)
    ? match[2].replace(/\s+/g, '')
    : Buffer.from(decodeURIComponent(match[2]), 'utf8').toString('base64');
  return { mimeType: match[1].toLowerCase(), data };
}

function getImageMimeType(reference) {
  const normalized = normalizeString(reference).split('?')[0].split('#')[0].toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.avif')) return 'image/avif';
  return 'image/png';
}

async function fetchGeminiImagePart(reference, options = {}) {
  if (reference.data) {
    return { inlineData: { mimeType: reference.mimeType, data: reference.data } };
  }
  const dataUrl = parseImageDataUrl(reference.url);
  if (dataUrl) return { inlineData: dataUrl };

  const readLocalMediaBuffer = options.readLocalMediaBuffer || readMountedProviderMediaBufferIfAvailable;
  const localBytes = await readLocalMediaBuffer(reference.url, { mediaKind: 'image' });
  if (localBytes) {
    return {
      inlineData: {
        mimeType: getImageMimeType(reference.url),
        data: localBytes.toString('base64'),
      },
    };
  }

  const response = await (options.fetchImpl || fetch)(reference.url, {
    method: 'GET',
    headers: { 'Cache-Control': 'no-cache' },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Google Gemini image fetch failed with status ${response.status}.`);
  }
  const mimeType = normalizeString(response.headers?.get?.('content-type')).toLowerCase().split(';')[0];
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Google Gemini image fetch returned unsupported content type ${mimeType || 'unknown'}.`);
  }
  const bytes = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : await response.buffer();
  return { inlineData: { mimeType, data: bytes.toString('base64') } };
}

async function buildGeminiMessageParts(content, options = {}) {
  const parts = [];
  const items = Array.isArray(content) ? content : [content];
  for (const item of items) {
    if (typeof item === 'string') {
      if (item) parts.push({ text: item });
      continue;
    }
    if ((item?.type === 'text' || item?.type === 'input_text' || item?.type === 'output_text') &&
        typeof item.text === 'string') {
      if (item.text) parts.push({ text: item.text });
      continue;
    }
    if (!inferImageItem(item)) continue;
    for (const reference of getImageReferences(item)) {
      parts.push(await fetchGeminiImagePart(reference, options));
    }
  }
  return parts;
}

export async function buildGeminiContents(messages = [], options = {}) {
  const systemParts = [];
  const contents = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    if (message.role === 'system' || message.role === 'developer') {
      const systemText = normalizeTextContent(message.content);
      if (systemText) {
        systemParts.push(systemText);
      }
      continue;
    }

    const parts = await buildGeminiMessageParts(message.content, options);
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

export async function createGoogleGeminiChatCompletion(messages, inferenceModel, options = {}) {
  const model = resolveGeminiModel(inferenceModel);
  const location = resolveGeminiLocation();
  const config = getGoogleCloudConfig();
  const projectId = normalizeString(config.projectId);

  if (!projectId) {
    throw new Error('Google Gemini inference requires GOOGLE_CLOUD_PROJECT or GOOGLE_PROJECT_ID.');
  }

  const { systemInstruction, contents } = await buildGeminiContents(messages, options);
  if (!contents.length) {
    throw new Error('Google Gemini inference requires at least one user message.');
  }

  const token = await getGoogleAccessToken(config);
  const generationConfig = buildGenerationConfig(model);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(buildVertexGenerateContentUrl({ projectId, location, model }), {
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

  const payload = await response.json();
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
