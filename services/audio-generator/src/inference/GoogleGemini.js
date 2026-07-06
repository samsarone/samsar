import fetch from 'node-fetch';

import { getGoogleAccessToken, getGoogleCloudConfig } from './GoogleADC.js';
import {
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  getProviderModelForInferenceModel,
} from './InferenceModels.js';

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

function buildGeminiContents(messages = []) {
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

    const text = normalizeTextContent(message.content);
    if (text) {
      contents.push({
        role: message.role === 'assistant' || message.role === 'model' ? 'model' : 'user',
        parts: [{ text }],
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

  const { systemInstruction, contents } = buildGeminiContents(messages);
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
