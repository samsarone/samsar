import { GoogleAuth } from 'google-auth-library';

export const GPT_56_SOL_INFERENCE_MODEL = 'gpt-5.6-sol';
export const GPT_56_SOL_REASONING_EFFORT = 'xhigh';
const DEFAULT_INFERENCE_MODEL = GPT_56_SOL_INFERENCE_MODEL;
const GEMINI_31_PRO_INFERENCE_MODEL = 'gemini-3.1-pro';
export const QWEN_37_INFERENCE_MODEL = 'QWEN3.7';
export const QWEN_38_MAX_PREVIEW_MODEL = 'qwen3.8-max-preview';
export const QWEN_37_MAX_MODEL = 'qwen3.7-max';
export const QWEN_37_PLUS_MODEL = 'qwen3.7-plus';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_GEMINI_LOCATION = 'global';
const DEFAULT_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];
const PROJECT_ENV_KEYS = [
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PROJECT_ID',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'PROJECT_ID',
];
const GEMINI_31_PRO_PROVIDER_ALIASES = new Set([
  GEMINI_31_PRO_INFERENCE_MODEL,
  DEFAULT_GEMINI_MODEL,
  'gemini-3-pro',
  'gemini-3-pro-preview',
]);
const QWEN_37_ALIAS_TOKENS = new Set([
  'QWEN37',
  'QWEN37MAX',
  'QWEN37PLUS',
  'ALIBABAQWEN37',
  'ALIBABACLOUDQWEN37',
  'DASHSCOPEQWEN37',
  'QWEN38',
  'QWEN38MAX',
  'QWEN38MAXPREVIEW',
  'ALIBABAQWEN38',
  'ALIBABAQWEN38MAXPREVIEW',
  'ALIBABACLOUDQWEN38',
  'ALIBABACLOUDQWEN38MAXPREVIEW',
  'DASHSCOPEQWEN38',
  'DASHSCOPEQWEN38MAXPREVIEW',
]);
const DEFAULT_GEMINI_3_THINKING_LEVEL = 'MEDIUM';
const GEMINI_3_THINKING_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);

const authCache = new Map();

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeAliasToken(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function isQwenInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === QWEN_37_INFERENCE_MODEL.toLowerCase() ||
    normalized === QWEN_38_MAX_PREVIEW_MODEL ||
    normalized === QWEN_37_MAX_MODEL ||
    normalized === QWEN_37_PLUS_MODEL ||
    QWEN_37_ALIAS_TOKENS.has(normalizeAliasToken(value));
}

function getConfiguredProjectId() {
  for (const key of PROJECT_ENV_KEYS) {
    const projectId = normalizeString(process.env[key]);
    if (projectId) return projectId;
  }
  return '';
}

function getConfiguredCredentials() {
  const rawJson = normalizeString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  if (rawJson) {
    return JSON.parse(rawJson);
  }

  const rawB64 = normalizeString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64);
  if (rawB64) {
    return JSON.parse(Buffer.from(rawB64, 'base64').toString('utf8'));
  }

  return null;
}

function getAuth() {
  const credentials = getConfiguredCredentials();
  const projectId = getConfiguredProjectId() || normalizeString(credentials?.project_id);
  const cacheKey = JSON.stringify({
    projectId,
    credentialId: credentials?.client_email || credentials?.private_key_id || '',
  });

  if (!authCache.has(cacheKey)) {
    authCache.set(cacheKey, new GoogleAuth({
      ...(projectId ? { projectId } : {}),
      ...(credentials ? { credentials } : {}),
      scopes: DEFAULT_SCOPES,
    }));
  }

  return authCache.get(cacheKey);
}

async function getAccessToken() {
  const client = await getAuth().getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : normalizeString(tokenResponse?.token);
  if (!token) {
    throw new Error('Google ADC did not return an access token.');
  }
  return token;
}

export function normalizeInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return DEFAULT_INFERENCE_MODEL;
  if (normalized === DEFAULT_INFERENCE_MODEL || normalized.startsWith(`${DEFAULT_INFERENCE_MODEL}-`)) {
    return DEFAULT_INFERENCE_MODEL;
  }
  if (
    GEMINI_31_PRO_PROVIDER_ALIASES.has(normalized)
  ) {
    return GEMINI_31_PRO_INFERENCE_MODEL;
  }
  if (isQwenInferenceModel(value)) {
    return QWEN_37_INFERENCE_MODEL;
  }
  return DEFAULT_INFERENCE_MODEL;
}

export function isGeminiInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('gemini-') || normalizeInferenceModel(normalized) === GEMINI_31_PRO_INFERENCE_MODEL;
}

function normalizeGeminiProviderModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  return GEMINI_31_PRO_PROVIDER_ALIASES.has(normalized) ? DEFAULT_GEMINI_MODEL : normalized;
}

export function resolveGeminiModel() {
  return (
    normalizeGeminiProviderModel(process.env.GOOGLE_GEMINI_31_PRO_MODEL) ||
    normalizeGeminiProviderModel(process.env.GOOGLE_GEMINI_PRO_MODEL) ||
    DEFAULT_GEMINI_MODEL
  );
}

function resolveGeminiLocation() {
  return (
    normalizeString(process.env.GOOGLE_GEMINI_LOCATION) ||
    normalizeString(process.env.GOOGLE_VERTEX_AI_LOCATION) ||
    DEFAULT_GEMINI_LOCATION
  );
}

function buildVertexGenerateContentUrl({ projectId, location, model }) {
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function normalizeTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);

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

function buildGeminiContents(messages = []) {
  const systemParts = [];
  const contents = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') continue;
    const text = normalizeTextContent(message.content);
    if (!text) continue;

    if (message.role === 'system' || message.role === 'developer') {
      systemParts.push(text);
    } else {
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
  if (!Array.isArray(parts)) return '';
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

export async function createGoogleGeminiChatCompletion(messageList) {
  const credentials = getConfiguredCredentials();
  const projectId = getConfiguredProjectId() || normalizeString(credentials?.project_id);
  if (!projectId) {
    throw new Error('Google Gemini inference requires GOOGLE_CLOUD_PROJECT, GOOGLE_PROJECT_ID, or service account credentials containing project_id.');
  }

  const location = resolveGeminiLocation();
  const model = resolveGeminiModel();
  const { systemInstruction, contents } = buildGeminiContents(messageList);
  if (!contents.length) {
    throw new Error('Google Gemini inference requires at least one user message.');
  }

  const token = await getAccessToken();
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
    role: 'assistant',
    content: extractGeminiOutputText(payload),
    usage: payload?.usageMetadata || null,
  };
}
