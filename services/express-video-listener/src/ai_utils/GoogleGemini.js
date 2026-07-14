import { GoogleAuth } from 'google-auth-library';

export const GPT_56_SOL_INFERENCE_MODEL = 'gpt-5.6-sol';
export const GPT_56_SOL_REASONING_EFFORT = 'xhigh';
export const QWEN_37_INFERENCE_MODEL = 'QWEN3.7';
export const QWEN_37_MAX_MODEL = 'qwen3.7-max';
export const QWEN_37_PLUS_MODEL = 'qwen3.7-plus';
const DEFAULT_INFERENCE_MODEL = GPT_56_SOL_INFERENCE_MODEL;
const GEMINI_31_PRO_INFERENCE_MODEL = 'gemini-3.1-pro';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_GEMINI_LOCATION = 'global';
const DEFAULT_IMAGE_MIME_TYPE = 'image/png';
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;
const PROJECT_ENV_KEYS = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_PROJECT_ID', 'GCP_PROJECT', 'GCLOUD_PROJECT', 'PROJECT_ID'];
const GEMINI_31_PRO_PROVIDER_ALIASES = new Set([
  GEMINI_31_PRO_INFERENCE_MODEL,
  DEFAULT_GEMINI_MODEL,
  'gemini-3-pro',
  'gemini-3-pro-preview',
]);
const QWEN_37_ALIASES = new Set([
  QWEN_37_INFERENCE_MODEL.toLowerCase(),
  QWEN_37_MAX_MODEL,
  QWEN_37_PLUS_MODEL,
  'qwen-3.7',
  'qwen-3.7-max',
  'qwen-3.7-plus',
]);
const QWEN_37_ALIAS_TOKENS = new Set([
  'QWEN37',
  'QWEN37MAX',
  'QWEN37PLUS',
  'ALIBABAQWEN37',
  'ALIBABACLOUDQWEN37',
]);
const GEMINI_3_THINKING_LEVEL = 'HIGH';
const MIN_GEMINI_3_MAX_OUTPUT_TOKENS = 64;
const authCache = new Map();

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeAliasToken(value) {
  return normalizeString(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function isQwen37Alias(value) {
  const normalized = normalizeString(value).toLowerCase();
  return QWEN_37_ALIASES.has(normalized) ||
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
  if (rawJson) return JSON.parse(rawJson);

  const rawB64 = normalizeString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64);
  if (rawB64) return JSON.parse(Buffer.from(rawB64, 'base64').toString('utf8'));

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
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    }));
  }

  return authCache.get(cacheKey);
}

async function getAccessToken() {
  const client = await getAuth().getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : normalizeString(tokenResponse?.token);
  if (!token) throw new Error('Google ADC did not return an access token.');
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
  if (isQwen37Alias(value)) {
    return QWEN_37_INFERENCE_MODEL;
  }
  return DEFAULT_INFERENCE_MODEL;
}

export function getDefaultInferenceModel() {
  return normalizeInferenceModel(
    process.env.USER_INFERENCE_MODEL ||
    process.env.DEFAULT_USER_INFERENCE_MODEL
  );
}

export function isGeminiInferenceModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.startsWith('gemini-') || normalizeInferenceModel(normalized) === GEMINI_31_PRO_INFERENCE_MODEL;
}

export function isQwenInferenceModel(value) {
  return isQwen37Alias(value);
}

function normalizeGeminiProviderModel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  return GEMINI_31_PRO_PROVIDER_ALIASES.has(normalized) ? DEFAULT_GEMINI_MODEL : normalized;
}

export function resolveGeminiModel(model) {
  const normalized = normalizeString(model).toLowerCase();
  const explicitProviderModel = normalized.startsWith('gemini-') &&
    !GEMINI_31_PRO_PROVIDER_ALIASES.has(normalized)
    ? normalized
    : '';

  return (
    explicitProviderModel ||
    normalizeGeminiProviderModel(process.env.GOOGLE_GEMINI_31_PRO_MODEL) ||
    normalizeGeminiProviderModel(process.env.GOOGLE_GEMINI_PRO_MODEL) ||
    DEFAULT_GEMINI_MODEL
  );
}

function resolveGeminiLocation() {
  return normalizeString(process.env.GOOGLE_GEMINI_LOCATION) ||
    normalizeString(process.env.GOOGLE_VERTEX_AI_LOCATION) ||
    DEFAULT_GEMINI_LOCATION;
}

function buildVertexGenerateContentUrl({ projectId, location, model }) {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function parseDataUrl(dataUrl) {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:([^;,]+);base64,(.+)$/) : null;
  return match ? { mimeType: match[1] || DEFAULT_IMAGE_MIME_TYPE, data: match[2] } : null;
}

async function buildInlineImagePart(imageUrl) {
  const normalizedUrl = normalizeString(typeof imageUrl === 'string' ? imageUrl : imageUrl?.url);
  if (!normalizedUrl) return null;

  const dataImage = parseDataUrl(normalizedUrl);
  if (dataImage) return { inlineData: { mimeType: dataImage.mimeType, data: dataImage.data } };

  const response = await fetch(normalizedUrl);
  if (!response.ok) throw new Error(`Unable to fetch image for Gemini vision request: ${response.status}`);

  const mimeType = response.headers.get('content-type')?.split(';')?.[0] || DEFAULT_IMAGE_MIME_TYPE;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_INLINE_IMAGE_BYTES) throw new Error('Image is too large for inline Gemini vision input.');
  return { inlineData: { mimeType, data: buffer.toString('base64') } };
}

function stringifyTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if ((item?.type === 'text' || item?.type === 'input_text') && typeof item.text === 'string') return item.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

async function normalizeContentParts(content) {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return content == null ? [] : [{ text: String(content) }];

  const parts = [];
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push({ text: item });
    } else if ((item?.type === 'text' || item?.type === 'input_text') && typeof item.text === 'string') {
      parts.push({ text: item.text });
    } else if ((item?.type === 'image_url' && item.image_url) || (item?.type === 'input_image' && item.image_url)) {
      const imagePart = await buildInlineImagePart(item.image_url);
      if (imagePart) parts.push(imagePart);
    }
  }
  return parts;
}

async function buildGeminiContents(messages = []) {
  const systemParts = [];
  const contents = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system' || message.role === 'developer') {
      const systemText = stringifyTextContent(message.content);
      if (systemText) systemParts.push(systemText);
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
    systemInstruction: systemParts.length ? { parts: systemParts.map((text) => ({ text })) } : undefined,
    contents,
  };
}

function extractGeminiOutputText(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

function buildGenerationConfig(chatRequest = {}, model = '') {
  const generationConfig = {};
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

  if (isGemini3Model) {
    generationConfig.thinkingConfig = {
      thinkingLevel: GEMINI_3_THINKING_LEVEL,
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

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    google_usage_metadata: usageMetadata,
  };
}

function normalizeGeminiFinishReason(finishReason) {
  const normalized = normalizeString(finishReason).toUpperCase();
  if (!normalized) return null;
  if (normalized === 'STOP' || normalized === 'FINISH_REASON_STOP') return 'stop';
  if (normalized === 'MAX_TOKENS' || normalized === 'FINISH_REASON_MAX_TOKENS') return 'length';
  if (normalized === 'SAFETY' || normalized === 'RECITATION' || normalized === 'BLOCKLIST') {
    return 'content_filter';
  }
  return normalized.toLowerCase();
}

export async function createGoogleGeminiChatCompletion(chatRequest = {}) {
  const legacyMessageListInput = Array.isArray(chatRequest);
  const request = legacyMessageListInput
    ? { model: GEMINI_31_PRO_INFERENCE_MODEL, messages: chatRequest }
    : { ...(chatRequest || {}) };
  const credentials = getConfiguredCredentials();
  const projectId = getConfiguredProjectId() || normalizeString(credentials?.project_id);
  if (!projectId) {
    throw new Error('Google Gemini inference requires GOOGLE_CLOUD_PROJECT, GOOGLE_PROJECT_ID, or service account credentials containing project_id.');
  }

  const location = resolveGeminiLocation();
  const model = resolveGeminiModel(request.model);
  const { systemInstruction, contents } = await buildGeminiContents(request.messages);
  if (!contents.length) throw new Error('Google Gemini inference requires at least one user message.');

  const generationConfig = buildGenerationConfig(request, model);
  const token = await getAccessToken();
  const response = await fetch(buildVertexGenerateContentUrl({ projectId, location, model }), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(systemInstruction ? { systemInstruction } : {}),
      contents,
      ...(generationConfig ? { generationConfig } : {}),
    }),
  });
  const responseText = await response.text();
  const payload = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) throw new Error(payload?.error?.message || `Google Gemini inference failed with status ${response.status}`);
  const candidate = payload?.candidates?.[0] || {};
  const message = { role: 'assistant', content: extractGeminiOutputText(payload) };
  if (legacyMessageListInput) {
    return message;
  }
  return {
    id: payload?.responseId || null,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    usage: normalizeGeminiUsage(payload?.usageMetadata),
    google_response: {
      modelVersion: payload?.modelVersion || null,
      createTime: payload?.createTime || null,
      promptFeedback: payload?.promptFeedback || null,
    },
    choices: [
      {
        index: Number.isInteger(candidate?.index) ? candidate.index : 0,
        message,
        finish_reason: normalizeGeminiFinishReason(candidate?.finishReason),
      },
    ],
  };
}
