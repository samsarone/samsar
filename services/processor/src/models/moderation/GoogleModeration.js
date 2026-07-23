import fetch from 'node-fetch';

import {
  DEFAULT_GEMINI_31_PRO_VERTEX_MODEL,
  normalizeGeminiProviderModel,
} from '../../consts/InferenceModels.js';
import {
  DEPLOYMENT_EDITION,
  normalizeDeploymentEdition,
} from '../../utils/EnvironmentUtils.js';
import {
  getGoogleAccessToken,
  getGoogleAuth,
  getGoogleCloudConfig,
} from '../../inference/GoogleADC.js';

const DEFAULT_GEMINI_MODERATION_MODEL = DEFAULT_GEMINI_31_PRO_VERTEX_MODEL;
const DEFAULT_GEMINI_MODERATION_LOCATION = 'global';
const DEFAULT_GEMINI_MODERATION_TIMEOUT_MS = 30000;
const DEFAULT_GEMINI_MODERATION_MAX_OUTPUT_TOKENS = 2048;
const HARM_CATEGORIES = Object.freeze([
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
]);
let pendingGoogleAccessTokenRequest = null;
let pendingGoogleAccessTokenRequestKey = '';

const GEMINI_MODERATION_RESPONSE_SCHEMA = Object.freeze({
  type: 'OBJECT',
  properties: {
    flagged: { type: 'BOOLEAN' },
    reason: { type: 'STRING' },
    categories: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          flagged: { type: 'BOOLEAN' },
          score: { type: 'NUMBER' },
        },
        required: ['name', 'flagged', 'score'],
      },
    },
  },
  required: ['flagged', 'reason', 'categories'],
});

const GEMINI_MODERATION_SYSTEM_PROMPT = [
  'You are a text-to-video content safety classifier for Vidgenie.',
  'Classify only the submitted generation prompt. Do not rewrite it and do not provide policy advice.',
  'Block prompts that request disallowed sexual content, sexual exploitation or child-safety harm, non-consensual intimate imagery, graphic violence, self-harm, extremist or terrorist support, hate or harassment toward protected classes, instructions for wrongdoing, illegal goods or services, privacy abuse, or evasion of safety systems.',
  'Allow ordinary cinematic, product, educational, fantasy, fictional, medical, historical, or newsworthy prompts when they do not instruct unsafe generation.',
  'Do not block non-graphic fictional battles, stylized action violence, grimdark fantasy, gothic sci-fi, or creature combat unless the prompt asks for graphic gore, explicit injury detail, real-world extremist praise, or instructions to harm real people.',
  'Return only JSON with flagged, reason, and categories. Categories must use short snake_case names, flagged must reflect whether that category caused the block, and score must be between 0 and 1.',
].join('\n');

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, parsed));
}

function normalizeCategoryName(name) {
  return normalizeString(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unsafe';
}

function normalizeGeminiModerationModel(value) {
  const model = normalizeGeminiProviderModel(value);
  return model.startsWith('gemini-') ? model : '';
}

function getGoogleModerationModel(options = {}) {
  return (
    normalizeGeminiModerationModel(options.model) ||
    normalizeGeminiModerationModel(options.moderationModel) ||
    normalizeGeminiModerationModel(process.env.GOOGLE_GEMINI_MODERATION_MODEL) ||
    normalizeGeminiModerationModel(process.env.GOOGLE_MODERATION_VERTEX_MODEL) ||
    normalizeGeminiModerationModel(process.env.GOOGLE_MODERATION_MODEL) ||
    normalizeGeminiModerationModel(process.env.GOOGLE_GEMINI_31_PRO_MODEL) ||
    normalizeGeminiModerationModel(process.env.GOOGLE_GEMINI_PRO_MODEL) ||
    DEFAULT_GEMINI_MODERATION_MODEL
  );
}

function getGoogleModerationLocation(options = {}) {
  return (
    normalizeString(options.location) ||
    normalizeString(process.env.GOOGLE_MODERATION_LOCATION) ||
    normalizeString(process.env.GOOGLE_GEMINI_LOCATION) ||
    normalizeString(process.env.GOOGLE_VERTEX_AI_LOCATION) ||
    DEFAULT_GEMINI_MODERATION_LOCATION
  );
}

function getGoogleModerationTimeoutMs(options = {}) {
  const parsed = Number(
    options.timeoutMs ||
    process.env.GOOGLE_MODERATION_TIMEOUT_MS ||
    process.env.MODERATION_TIMEOUT_MS
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_GEMINI_MODERATION_TIMEOUT_MS;
}

function getGoogleModerationMaxOutputTokens(options = {}) {
  const parsed = Number(
    options.maxOutputTokens ||
    process.env.GOOGLE_MODERATION_MAX_OUTPUT_TOKENS
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_GEMINI_MODERATION_MAX_OUTPUT_TOKENS;
}

function isProductionRuntime(env = process.env) {
  const configuredEdition = normalizeDeploymentEdition(
    env?.SAMSAR_DEPLOYMENT_EDITION || env?.SAMSAR_EDITION || env?.CURRENT_ENV,
  );
  if (configuredEdition) {
    return configuredEdition === DEPLOYMENT_EDITION.PRODUCTION;
  }
  return normalizeString(env?.NODE_ENV).toLowerCase() === 'production';
}

export function getGoogleModerationCredentialOptions(options = {}) {
  const env = options.env && typeof options.env === 'object'
    ? options.env
    : process.env;

  if (!isProductionRuntime(env)) {
    return options;
  }

  const {
    credentials,
    projectId,
    googleProjectId,
    google_project_id,
    googleCredentialsJson,
    google_credentials_json,
    googleCredentialsJsonB64,
    google_credentials_json_b64,
    credentialsJson,
    credentials_json,
    credentialsJsonB64,
    credentials_json_b64,
    env: _env,
    ...deployedOptions
  } = options;

  return deployedOptions;
}

function buildVertexGenerateContentUrl({ projectId, location, model }) {
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;

  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

async function resolveGoogleProjectId(config) {
  const configuredProjectId = normalizeString(config.projectId);
  if (configuredProjectId) {
    return configuredProjectId;
  }

  try {
    const auth = getGoogleAuth({ scopes: config.scopes });
    return normalizeString(await auth.getProjectId());
  } catch {
    return '';
  }
}

async function getGoogleModerationAccessToken(config) {
  const requestKey = JSON.stringify({
    projectId: config.projectId || '',
    scopes: Array.isArray(config.scopes) ? config.scopes : [],
  });
  if (
    !pendingGoogleAccessTokenRequest ||
    pendingGoogleAccessTokenRequestKey !== requestKey
  ) {
    const request = Promise.resolve().then(() => getGoogleAccessToken(config));
    const trackedRequest = request.finally(() => {
      if (pendingGoogleAccessTokenRequest === trackedRequest) {
        pendingGoogleAccessTokenRequest = null;
        pendingGoogleAccessTokenRequestKey = '';
      }
    });
    pendingGoogleAccessTokenRequest = trackedRequest;
    pendingGoogleAccessTokenRequestKey = requestKey;
  }
  return pendingGoogleAccessTokenRequest;
}

async function parseModerationError(response) {
  const responseText = await response.text().catch(() => '');
  let responsePayload = null;
  let message = responseText;

  try {
    responsePayload = responseText ? JSON.parse(responseText) : null;
    message = responsePayload?.error?.message || responsePayload?.message || responseText;
  } catch {
    // Keep the raw response text.
  }

  const error = new Error(message || `Google Gemini moderation failed with status ${response.status}.`);
  error.status = response.status;
  error.statusText = response.statusText;
  error.error = responsePayload?.error || null;
  return error;
}

function buildSafetySettings() {
  return HARM_CATEGORIES.map((category) => ({
    category,
    threshold: 'BLOCK_NONE',
  }));
}

function buildModerationRequestBody(requestData, options = {}) {
  return {
    systemInstruction: {
      parts: [{ text: GEMINI_MODERATION_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Classify this text-to-video prompt:\n\n${requestData}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: getGoogleModerationMaxOutputTokens(options),
      responseMimeType: 'application/json',
      responseSchema: GEMINI_MODERATION_RESPONSE_SCHEMA,
    },
    safetySettings: buildSafetySettings(),
  };
}

function stripJsonFence(text) {
  const trimmed = normalizeString(text);
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonOutput(text) {
  const stripped = stripJsonFence(text);
  if (!stripped) {
    throw new Error('Google Gemini moderation response did not include classifier JSON.');
  }

  try {
    return JSON.parse(stripped);
  } catch {
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Google Gemini moderation response was not valid JSON.');
  }
}

function extractGeminiOutputText(responsePayload) {
  const parts = responsePayload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('');
}

export function extractGeminiModerationPayload(responsePayload) {
  return parseJsonOutput(extractGeminiOutputText(responsePayload));
}

function normalizeCategoryEntries(categoriesPayload) {
  if (Array.isArray(categoriesPayload)) {
    return categoriesPayload.flatMap((category) => {
      if (typeof category === 'string') {
        return [{
          name: category,
          flagged: true,
          score: 1,
        }];
      }

      if (!category || typeof category !== 'object') {
        return [];
      }

      const name = normalizeString(category.name || category.category || category.label);
      if (!name) {
        return [];
      }

      return [{
        name,
        flagged: category.flagged === true || category.blocked === true,
        score: normalizeNumber(
          category.score ??
          category.confidence ??
          category.probability,
          category.flagged === true || category.blocked === true ? 1 : 0
        ),
      }];
    });
  }

  if (categoriesPayload && typeof categoriesPayload === 'object') {
    return Object.entries(categoriesPayload).flatMap(([name, value]) => {
      if (typeof value === 'boolean') {
        return [{
          name,
          flagged: value,
          score: value ? 1 : 0,
        }];
      }

      if (!value || typeof value !== 'object') {
        return [];
      }

      return [{
        name,
        flagged: value.flagged === true || value.blocked === true,
        score: normalizeNumber(
          value.score ??
          value.confidence ??
          value.probability,
          value.flagged === true || value.blocked === true ? 1 : 0
        ),
      }];
    });
  }

  return [];
}

function inferFlaggedValue(payload, categoryEntries) {
  if (typeof payload?.flagged === 'boolean') {
    return payload.flagged;
  }

  const decision = normalizeString(payload?.decision || payload?.status).toLowerCase();
  if (['unsafe', 'blocked', 'block', 'reject', 'rejected'].includes(decision)) {
    return true;
  }
  if (['safe', 'allowed', 'allow', 'pass', 'passed'].includes(decision)) {
    return false;
  }

  return categoryEntries.some((category) => category.flagged === true);
}

export function normalizeGeminiModerationPayload(payload, { model = null } = {}) {
  const categoryEntries = normalizeCategoryEntries(payload?.categories);
  const flagged = inferFlaggedValue(payload, categoryEntries);
  const categories = {};
  const categoryScores = {};

  for (const category of categoryEntries) {
    const key = normalizeCategoryName(category.name);
    categories[key] = category.flagged === true;
    categoryScores[key] = normalizeNumber(category.score, category.flagged === true ? 1 : 0);
  }

  if (flagged && Object.keys(categories).length === 0) {
    categories.unsafe = true;
    categoryScores.unsafe = 1;
  }

  return {
    model: model || getGoogleModerationModel(),
    results: [
      {
        flagged,
        categories,
        category_scores: categoryScores,
      },
    ],
    google: {
      moderation_reason: normalizeString(payload?.reason || payload?.rationale) || null,
    },
  };
}

function normalizeBlockedPromptResponse(responsePayload, { model }) {
  const blockReason = normalizeString(responsePayload?.promptFeedback?.blockReason) || 'blocked_reason_unspecified';
  const normalized = normalizeGeminiModerationPayload({
    flagged: true,
    reason: `Prompt blocked by Gemini safety filter: ${blockReason}`,
    categories: [
      {
        name: blockReason,
        flagged: true,
        score: 1,
      },
    ],
  }, { model });

  normalized.google.promptFeedback = responsePayload?.promptFeedback || null;
  return normalized;
}

export function normalizeGoogleModerationResponse(responsePayload, { model = null } = {}) {
  const resolvedModel = model || getGoogleModerationModel();
  if (responsePayload?.promptFeedback?.blockReason) {
    return normalizeBlockedPromptResponse(responsePayload, { model: resolvedModel });
  }

  const normalized = normalizeGeminiModerationPayload(
    extractGeminiModerationPayload(responsePayload),
    { model: resolvedModel },
  );
  const candidate = responsePayload?.candidates?.[0] || {};

  normalized.google = {
    ...normalized.google,
    promptFeedback: responsePayload?.promptFeedback || null,
    finishReason: candidate?.finishReason || null,
    safetyRatings: candidate?.safetyRatings || null,
    responseId: responsePayload?.responseId || null,
    modelVersion: responsePayload?.modelVersion || null,
  };

  return normalized;
}

export function buildGoogleModerationInferenceReceipt(
  responsePayload,
  { model, attempt = 1 } = {},
) {
  return {
    stage: 'moderation',
    attempt,
    model: responsePayload?.modelVersion || model || null,
    provider: 'google',
    usageMetadata: responsePayload?.usageMetadata || null,
  };
}

export async function createGoogleModerationForNarrative(requestData, options = {}) {
  const credentialOptions = getGoogleModerationCredentialOptions(options);
  const location = getGoogleModerationLocation(credentialOptions);
  const model = getGoogleModerationModel(credentialOptions);
  const config = getGoogleCloudConfig({ ...credentialOptions, location });
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
  } else {
    options.signal?.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new Error('Google Gemini moderation timed out.')),
    getGoogleModerationTimeoutMs(credentialOptions),
  );

  try {
    controller.signal.throwIfAborted();
    const projectId = await resolveGoogleProjectId(config);
    controller.signal.throwIfAborted();

    if (!projectId) {
      throw new Error('Google Gemini moderation requires GOOGLE_CLOUD_PROJECT, GOOGLE_PROJECT_ID, or an ADC default project.');
    }

    const token = await getGoogleModerationAccessToken({
      ...config,
      projectId,
    });
    controller.signal.throwIfAborted();

    const response = await fetch(buildVertexGenerateContentUrl({ projectId, location, model }), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildModerationRequestBody(requestData, credentialOptions)),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await parseModerationError(response);
    }

    const responsePayload = await response.json();
    if (typeof options.onInferenceResponse === 'function') {
      try {
        await options.onInferenceResponse(buildGoogleModerationInferenceReceipt(
          responsePayload,
          { model, attempt: options.moderationAttempt ?? 1 },
        ));
      } catch (error) {
        try {
          error.code ||= 'INFERENCE_USAGE_OBSERVER_FAILED';
          error.inferenceUsageObserverFailed = true;
          error.retryable = false;
        } catch {
          // Preserve non-extensible observer errors.
        }
        throw error;
      }
    }

    return normalizeGoogleModerationResponse(responsePayload, { model });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}
