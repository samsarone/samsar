import { GoogleAuth } from 'google-auth-library';
import fs from 'node:fs';
import path from 'node:path';

import { getDockerPublicMediaKey } from '../AWS.js';

const DEFAULT_VEO_LOCATION = 'us-central1';
const DEFAULT_VEO_31_MODEL = 'veo-3.1-generate-001';
const DEFAULT_VEO_31_FAST_MODEL = 'veo-3.1-fast-generate-001';
const DEFAULT_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];
const GOOGLE_NATIVE_VEO_MODELS = new Set([
  'VEO3.1',
  'VEO3.1FAST',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
]);
const MAX_GOOGLE_VEO_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
const PROJECT_ENV_KEYS = [
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PROJECT_ID',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'PROJECT_ID',
];

const authCache = new Map();

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
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
    throw new Error('Google ADC did not return an access token for Veo.');
  }
  return token;
}

function resolveProjectId() {
  const credentials = getConfiguredCredentials();
  const projectId = getConfiguredProjectId() || normalizeString(credentials?.project_id);
  if (!projectId) {
    throw new Error('Google Veo requires GOOGLE_CLOUD_PROJECT, GOOGLE_PROJECT_ID, or service account credentials containing project_id.');
  }
  return projectId;
}

function resolveVeoLocation() {
  const configured = (
    normalizeString(process.env.GOOGLE_VEO_LOCATION) ||
    normalizeString(process.env.GOOGLE_VERTEX_AI_LOCATION) ||
    normalizeString(process.env.GOOGLE_CLOUD_LOCATION)
  );
  if (!configured || configured === 'global') return DEFAULT_VEO_LOCATION;
  return configured;
}

function resolveVeoModel(model) {
  if (model === 'VEO3.1FAST' || model === 'VEO3.1I2VFAST') {
    return (
      (model === 'VEO3.1I2VFAST' ? normalizeString(process.env.GOOGLE_VEO_31_I2V_FAST_MODEL) : '') ||
      normalizeString(process.env.GOOGLE_VEO_31_FAST_MODEL) ||
      normalizeString(process.env.GOOGLE_VEO_FAST_MODEL) ||
      DEFAULT_VEO_31_FAST_MODEL
    );
  }

  if (model === 'VEO3.1' || model === 'VEO3.1I2V') {
    return (
      (model === 'VEO3.1I2V' ? normalizeString(process.env.GOOGLE_VEO_31_I2V_MODEL) : '') ||
      normalizeString(process.env.GOOGLE_VEO_31_MODEL) ||
      normalizeString(process.env.GOOGLE_VEO_MODEL) ||
      DEFAULT_VEO_31_MODEL
    );
  }

  throw new Error(`Unsupported Google Veo model: ${model}`);
}

function createGoogleVeoError(message, {
  status = null,
  headers = {},
  body = null,
  code = '',
  googleStatus = '',
  operationError = null,
} = {}) {
  const error = new Error(message || 'Google Veo request failed');
  error.name = 'GoogleVeoError';
  if (status) error.status = status;
  if (code) error.code = code;
  if (googleStatus) error.googleStatus = googleStatus;
  error.headers = headers || {};
  error.body = body;
  if (operationError) error.operationError = operationError;
  error.response = {
    ...(status ? { status } : {}),
    headers: error.headers,
    data: body,
  };
  return error;
}

function getHeadersObject(headers) {
  if (!headers || typeof headers.entries !== 'function') {
    return {};
  }
  return Object.fromEntries(headers.entries());
}

function getTransientStatusForGoogleRpcError(error = {}) {
  const code = Number(error.code);
  const status = normalizeString(error.status);

  if (code === 8 || status === 'RESOURCE_EXHAUSTED') return 429;
  if (code === 4 || status === 'DEADLINE_EXCEEDED') return 504;
  if (code === 13 || status === 'INTERNAL') return 500;
  if (code === 14 || status === 'UNAVAILABLE') return 503;
  if (code === 2 || status === 'UNKNOWN') return 500;

  return null;
}

function buildPublisherModelEndpoint({ projectId, location, model }) {
  return `projects/${projectId}/locations/${location}/publishers/google/models/${model}`;
}

function buildPublisherModelUrl({ projectId, location, model, method }) {
  const endpoint = buildPublisherModelEndpoint({ projectId, location, model });
  return `https://${location}-aiplatform.googleapis.com/v1/${endpoint}:${method}`;
}

function normalizeAspectRatio(aspectRatio) {
  const normalized = normalizeString(aspectRatio).toLowerCase();
  if (normalized === '9:16' || normalized === '9/16' || normalized === 'portrait' || normalized === 'vertical') {
    return '9:16';
  }
  if (normalized === '16:9' || normalized === '16/9' || normalized === 'landscape' || normalized === 'horizontal') {
    return '16:9';
  }
  return '16:9';
}

function normalizeDurationSeconds(value) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  if (numeric <= 4) return 4;
  if (numeric <= 6) return 6;
  return 8;
}

function normalizeSampleCount(value) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(Math.max(numeric, 1), 4);
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === true || value === false) return value;
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return defaultValue;
}

function shouldGenerateAudio(payload = {}) {
  return (
    normalizeBoolean(payload.generateAudio, false) ||
    normalizeBoolean(payload.generate_audio, false) ||
    normalizeBoolean(payload.isAudioVideoGeneration, false) ||
    normalizeBoolean(process.env.GOOGLE_VEO_GENERATE_AUDIO, false)
  );
}

function normalizeResolution(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return '';
  if (normalized === '720') return '720p';
  if (normalized === '1080') return '1080p';
  if (normalized === '720p' || normalized === '1080p') return normalized;
  return '';
}

function normalizeImageMimeType(value, source = '') {
  const normalized = normalizeString(value).split(';')[0].toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/jpeg' || normalized === 'image/png' || normalized === 'image/webp') {
    return normalized;
  }

  const sourceWithoutQuery = normalizeString(source).split('?')[0].toLowerCase();
  if (sourceWithoutQuery.endsWith('.jpg') || sourceWithoutQuery.endsWith('.jpeg')) return 'image/jpeg';
  if (sourceWithoutQuery.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function detectImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}

function parseDataImageUrl(value) {
  const normalized = normalizeString(value);
  const match = normalized.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/i);
  if (!match) return null;
  return {
    bytesBase64Encoded: stripDataUrlPrefix(normalized),
    mimeType: normalizeImageMimeType(match[1]),
  };
}

async function fetchRemoteImageForGoogleVeo(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Failed to fetch Google Veo input image from ${url}`);
  }

  const contentType = response.headers.get('content-type');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_GOOGLE_VEO_INPUT_IMAGE_BYTES) {
    throw new Error('Google Veo input image exceeds the 20 MB limit.');
  }

  return {
    bytesBase64Encoded: buffer.toString('base64'),
    mimeType: detectImageMimeType(buffer) || normalizeImageMimeType(contentType, url),
  };
}

function resolveMountedImagePath(reference) {
  const normalized = normalizeString(reference);
  if (!normalized) return '';

  let directPath = normalized;
  if (/^file:/i.test(normalized)) {
    try {
      directPath = new URL(normalized).pathname;
    } catch {
      return '';
    }
  }
  if (!/^https?:/i.test(directPath) && path.isAbsolute(directPath) && fs.existsSync(directPath)) {
    return directPath;
  }

  const mediaKey = getDockerPublicMediaKey(normalized);
  if (!mediaKey) return '';
  const normalizedKey = mediaKey.replace(/^\/+/, '');
  const [prefix, ...relativeSegments] = normalizedKey.split('/');
  const root = prefix === 'assets_v2'
    ? path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2')
    : prefix === 'assets'
      ? path.resolve(process.env.SAMSAR_ASSETS_ROOT || '/assets')
      : '';
  if (!root || !relativeSegments.length) return '';
  const candidate = path.resolve(root, ...relativeSegments);
  if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate)) return '';
  return candidate;
}

async function readMountedImageForGoogleVeo(reference) {
  const localPath = resolveMountedImagePath(reference);
  if (!localPath) return null;
  const buffer = await fs.promises.readFile(localPath);
  if (buffer.length > MAX_GOOGLE_VEO_INPUT_IMAGE_BYTES) {
    throw new Error('Google Veo input image exceeds the 20 MB limit.');
  }
  return {
    bytesBase64Encoded: buffer.toString('base64'),
    mimeType: detectImageMimeType(buffer) || normalizeImageMimeType('', localPath),
  };
}

async function buildVeoImagePayload(value) {
  const imageRef = normalizeString(value);
  if (!imageRef) return null;

  if (imageRef.startsWith('gs://')) {
    return {
      gcsUri: imageRef,
      mimeType: normalizeImageMimeType('', imageRef),
    };
  }

  const dataUrlPayload = parseDataImageUrl(imageRef);
  if (dataUrlPayload) return dataUrlPayload;

  // Vertex receives inline bytes, not a media URL. A Docker-owned image can
  // therefore be read straight from the mounted volume without creating a
  // public tunnel that the provider never consumes.
  const mountedImagePayload = await readMountedImageForGoogleVeo(imageRef);
  if (mountedImagePayload) return mountedImagePayload;

  if (/^https?:\/\//i.test(imageRef)) {
    return await fetchRemoteImageForGoogleVeo(imageRef);
  }

  throw new Error(`Unsupported Google Veo input image reference: ${imageRef}`);
}

export const __testOnly__ = {
  buildVeoImagePayload,
  resolveMountedImagePath,
};

function resolveOptionalStorageUri(payload) {
  return (
    normalizeString(payload.outputStorageUri) ||
    normalizeString(payload.storageUri) ||
    normalizeString(process.env.GOOGLE_VEO_OUTPUT_STORAGE_URI) ||
    normalizeString(process.env.GOOGLE_VERTEX_VEO_OUTPUT_STORAGE_URI)
  );
}

async function buildVeoRequest(payload) {
  const prompt = normalizeString(payload.prompt);
  if (!prompt) {
    throw new Error('Google Veo requires a non-empty prompt.');
  }

  const parameters = {
    sampleCount: normalizeSampleCount(payload.sampleCount || process.env.GOOGLE_VEO_SAMPLE_COUNT),
    durationSeconds: normalizeDurationSeconds(payload.duration),
    aspectRatio: normalizeAspectRatio(payload.aspectRatio),
    generateAudio: shouldGenerateAudio(payload),
  };

  const storageUri = resolveOptionalStorageUri(payload);
  if (storageUri) parameters.storageUri = storageUri;

  const resolution = normalizeResolution(payload.resolution || process.env.GOOGLE_VEO_RESOLUTION);
  if (resolution) parameters.resolution = resolution;

  const seed = Number.parseInt(String(payload.seed || process.env.GOOGLE_VEO_SEED || ''), 10);
  if (Number.isFinite(seed)) parameters.seed = seed;

  const negativePrompt = normalizeString(payload.negativePrompt || process.env.GOOGLE_VEO_NEGATIVE_PROMPT);
  if (negativePrompt) parameters.negativePrompt = negativePrompt;

  const personGeneration = normalizeString(payload.personGeneration || process.env.GOOGLE_VEO_PERSON_GENERATION);
  if (personGeneration) parameters.personGeneration = personGeneration;

  const compressionQuality = normalizeString(payload.compressionQuality || process.env.GOOGLE_VEO_COMPRESSION_QUALITY);
  if (compressionQuality) parameters.compressionQuality = compressionQuality;

  const promptRewriting = payload.enablePromptRewriting ?? process.env.GOOGLE_VEO_ENABLE_PROMPT_REWRITING;
  if (promptRewriting !== undefined) {
    parameters.enablePromptRewriting = normalizeBoolean(promptRewriting, true);
  }

  const instance = { prompt };
  const startImage = await buildVeoImagePayload(payload.startImage || payload.image || payload.imageUrl);
  if (startImage) {
    instance.image = startImage;
  }

  const endImage = await buildVeoImagePayload(payload.endImage || payload.lastFrame);
  if (endImage) {
    instance.lastFrame = endImage;
  }

  return {
    instances: [instance],
    parameters,
  };
}

async function readJsonResponse(response, context) {
  const responseText = await response.text();
  let payload = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { raw: responseText };
    }
  }

  if (!response.ok) {
    const message = payload?.error?.message || payload?.raw || `${context} failed with status ${response.status}`;
    throw createGoogleVeoError(message, {
      status: response.status,
      headers: getHeadersObject(response.headers),
      body: payload,
      code: payload?.error?.status || '',
      googleStatus: payload?.error?.status || '',
    });
  }

  return payload;
}

export function shouldUseGoogleNativeVeo3(model, payload = {}) {
  if (!GOOGLE_NATIVE_VEO_MODELS.has(model)) return false;
  if (payload?.googleVeoNativeFallbackUsed === true) return false;
  const explicitFallbackToFal = normalizeBoolean(process.env.GOOGLE_VEO_USE_FAL, false);
  const nativeEnabled = normalizeBoolean(process.env.GOOGLE_VEO_NATIVE_ENABLED, true);
  return nativeEnabled && !explicitFallbackToFal;
}

export async function generateGoogleVeo3VideoLayer(payload) {
  const projectId = resolveProjectId();
  const location = resolveVeoLocation();
  const model = resolveVeoModel(payload.model);
  const token = await getAccessToken();

  const response = await fetch(buildPublisherModelUrl({
    projectId,
    location,
    model,
    method: 'predictLongRunning',
  }), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(await buildVeoRequest(payload)),
  });

  const operation = await readJsonResponse(response, 'Google Veo submit');
  const operationName = normalizeString(operation?.name);
  if (!operationName) {
    throw new Error('Google Veo submit did not return an operation name.');
  }
  return operationName;
}

export async function listenToPendingGoogleVeo3Requests(payload) {
  const operationName = normalizeString(payload.generationId);
  if (!operationName) {
    throw new Error('Google Veo polling requires generationId.');
  }

  const projectId = resolveProjectId();
  const location = resolveVeoLocation();
  const model = resolveVeoModel(payload.model);
  const token = await getAccessToken();

  const response = await fetch(buildPublisherModelUrl({
    projectId,
    location,
    model,
    method: 'fetchPredictOperation',
  }), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operationName }),
  });

  const operation = await readJsonResponse(response, 'Google Veo poll');

  if (!operation.done) {
    return { responseStatus: 'PENDING' };
  }

  if (operation.error) {
    console.error('Google Veo generation failed', operation.error);
    const transientStatus = getTransientStatusForGoogleRpcError(operation.error);
    if (transientStatus) {
      throw createGoogleVeoError(operation.error.message || 'Google Veo operation failed transiently', {
        status: transientStatus,
        body: operation,
        code: operation.error.status || '',
        googleStatus: operation.error.status || '',
        operationError: operation.error,
      });
    }
    return { responseStatus: 'FAILED' };
  }

  const output = extractVeoOutput(operation);
  if (!output) {
    console.error('Google Veo generation completed without a video output', operation);
    return { responseStatus: 'FAILED' };
  }

  if (output.base64) {
    return {
      responseStatus: 'COMPLETED',
      responseBlob: Buffer.from(stripDataUrlPrefix(output.base64), 'base64'),
    };
  }

  if (output.uri) {
    if (output.uri.startsWith('gs://')) {
      return {
        responseStatus: 'COMPLETED',
        responseBlob: await downloadGcsObjectAsBuffer(output.uri, token),
      };
    }

    return {
      responseStatus: 'COMPLETED',
      remoteUrl: output.uri,
    };
  }

  console.error('Google Veo generation returned an unsupported video output', output);
  return { responseStatus: 'FAILED' };
}

function stripDataUrlPrefix(value) {
  const normalized = normalizeString(value);
  const marker = ';base64,';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex >= 0) return normalized.slice(markerIndex + marker.length);
  return normalized;
}

function extractVeoOutput(operation) {
  return findVideoOutput(operation?.response);
}

function findVideoOutput(value, depth = 0) {
  if (!value || depth > 10) return null;

  if (typeof value === 'string') {
    const normalized = normalizeString(value);
    if (normalized.startsWith('gs://') || normalized.startsWith('http://') || normalized.startsWith('https://')) {
      return { uri: normalized };
    }
    if (normalized.startsWith('data:video/')) {
      return { base64: normalized };
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const output = findVideoOutput(item, depth + 1);
      if (output) return output;
    }
    return null;
  }

  if (typeof value !== 'object') return null;

  const uri = (
    normalizeString(value.uri) ||
    normalizeString(value.url) ||
    normalizeString(value.gcsUri) ||
    normalizeString(value.signedUri)
  );
  if (uri) return { uri };

  const base64 = (
    normalizeString(value.bytesBase64Encoded) ||
    normalizeString(value.bytesBase64) ||
    normalizeString(value.base64)
  );
  if (base64) return { base64, mimeType: normalizeString(value.mimeType) };

  const priorityKeys = [
    'video',
    'videos',
    'generatedVideos',
    'generatedSamples',
    'samples',
    'gcsUris',
    'predictions',
    'generateVideoResponse',
    'response',
  ];

  for (const key of priorityKeys) {
    const output = findVideoOutput(value[key], depth + 1);
    if (output) return output;
  }

  return null;
}

async function downloadGcsObjectAsBuffer(gcsUri, token) {
  const { bucket, object } = parseGcsUri(gcsUri);
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(responseText || `Failed to download Google Veo output from ${gcsUri}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function parseGcsUri(gcsUri) {
  const normalized = normalizeString(gcsUri);
  if (!normalized.startsWith('gs://')) {
    throw new Error(`Invalid Google Cloud Storage URI: ${gcsUri}`);
  }

  const withoutScheme = normalized.slice('gs://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex < 1 || slashIndex === withoutScheme.length - 1) {
    throw new Error(`Google Cloud Storage URI must include bucket and object: ${gcsUri}`);
  }

  return {
    bucket: withoutScheme.slice(0, slashIndex),
    object: withoutScheme.slice(slashIndex + 1),
  };
}
