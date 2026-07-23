import dayjs from 'dayjs';
import fetch from 'node-fetch';
import { tmpdir } from 'os';
import { join as joinPath } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';

import AudioGeneration from '../schema/AudioGeneration.js';
import { uploadMusicToCDN } from '../AWS.js';
import { getGoogleAccessToken, getGoogleCloudConfig } from '../inference/GoogleADC.js';
import { finalizeRemoteAudioGeneration, markAudioGenerationAsFailed } from './audioUtils.js';
import { getSimplifiedBackingTrackPromptForRetry } from './BackingTrackPromptUtils.js';
import { isDockerRuntime } from '../util/environmentUtils.js';

const DEFAULT_LYRIA_3_MODEL = 'lyria-3-pro-preview';
const DEFAULT_LYRIA_3_LOCATION = 'global';
const DEFAULT_LYRIA_RESPONSE_FORMAT = 'mp3';
const GOOGLE_LYRIA_REQUEST_PREFIX = 'google-native-lyria:';
const LYRIA_NATIVE_MODEL_KEYS = new Set(['LYRIA3', 'LYRIA2']);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function envFlagEnabled(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function envFlagDisabled(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'no';
}

function normalizeModelKey(model) {
  return normalizeString(model).toUpperCase();
}

function isLyriaNativeModel(model) {
  return LYRIA_NATIVE_MODEL_KEYS.has(normalizeModelKey(model));
}

function isGoogleNativeLyriaRequestId(requestId) {
  return normalizeString(requestId).startsWith(GOOGLE_LYRIA_REQUEST_PREFIX);
}

export function shouldUseLyriaNative(payloadOrModel) {
  const payload = typeof payloadOrModel === 'object' && payloadOrModel !== null ? payloadOrModel : null;
  const model = payload ? payload.model : payloadOrModel;

  if (!isLyriaNativeModel(model)) {
    return false;
  }

  if (
    envFlagEnabled(process.env.GOOGLE_LYRIA_USE_FAL) ||
    envFlagDisabled(process.env.GOOGLE_LYRIA_NATIVE_ENABLED)
  ) {
    return false;
  }

  if (!payload) {
    return true;
  }

  const status = payload.status || 'INIT';
  if (status === 'INIT') {
    return true;
  }

  return isGoogleNativeLyriaRequestId(payload.generationId || payload.apiRequestId);
}

export const shouldUseGoogleNativeLyria2 = shouldUseLyriaNative;

function resolveGoogleLyriaLocation() {
  return (
    normalizeString(process.env.GOOGLE_LYRIA_3_LOCATION) ||
    normalizeString(process.env.GOOGLE_LYRIA_LOCATION) ||
    normalizeString(process.env.GOOGLE_GEMINI_LOCATION) ||
    normalizeString(process.env.GOOGLE_VERTEX_AI_LOCATION) ||
    DEFAULT_LYRIA_3_LOCATION
  );
}

function resolveGoogleLyriaModel() {
  return (
    normalizeString(process.env.GOOGLE_LYRIA_3_MODEL) ||
    normalizeString(process.env.GOOGLE_LYRIA_MODEL) ||
    DEFAULT_LYRIA_3_MODEL
  );
}

function buildVertexInteractionsUrl({ projectId, location }) {
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;

  return `https://${host}/v1beta1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/interactions`;
}

function buildVertexGenerateContentUrl({ projectId, location, model }) {
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;

  return `https://${host}/v1beta1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function getTempDir(sessionId = 'audio') {
  const isDockerEnv = isDockerRuntime();
  const safeSessionId = String(sessionId || 'audio').replace(/[^a-zA-Z0-9_-]/g, '_');
  const tempDir = isDockerEnv ? joinPath(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2', 'temp', safeSessionId) : tmpdir();

  if (isDockerEnv) {
    fs.mkdir(tempDir, { recursive: true }).catch((error) => {
      console.error('Failed to create temp dir:', error);
    });
  }

  return tempDir;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function resolveDurationSeconds(payload = {}) {
  const generationMetaDurationMs = Number(payload?.generationMeta?.musicLengthMs);
  const durationFromMeta = Number.isFinite(generationMetaDurationMs) && generationMetaDurationMs > 0
    ? generationMetaDurationMs / 1000
    : null;

  return Math.round(clampNumber(
    payload.duration ?? payload.durationSeconds ?? payload.duration_seconds ?? durationFromMeta,
    1,
    180,
    10
  ));
}

function normalizeSeed(seed) {
  const parsed = Number(seed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.floor(parsed);
}

function isInstrumentalRequest(payload = {}) {
  return Boolean(
    payload.isBackingTrack ||
    payload.generationMeta?.isBackingTrack ||
    payload.isInstrumental ||
    payload.generationMeta?.forceInstrumental
  );
}

function normalizeResponseFormat(payload = {}) {
  const rawFormat = normalizeString(
    payload.responseFormat ||
    payload.response_format ||
    payload.outputFormat ||
    payload.output_format ||
    payload.generationMeta?.responseFormat ||
    payload.generationMeta?.response_format ||
    payload.generationMeta?.outputFormat ||
    payload.generationMeta?.output_format
  ).toLowerCase();

  if (rawFormat.includes('wav')) {
    return 'wav';
  }

  return DEFAULT_LYRIA_RESPONSE_FORMAT;
}

function responseFormatToMimeType(responseFormat) {
  return responseFormat === 'wav' ? 'audio/wav' : 'audio/mp3';
}

function mimeTypeToExtension(mimeType, fallbackFormat = DEFAULT_LYRIA_RESPONSE_FORMAT) {
  const normalized = normalizeString(mimeType).toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('flac')) return 'flac';
  if (normalized.includes('ogg')) return 'ogg';
  return fallbackFormat === 'wav' ? 'wav' : 'mp3';
}

function buildLyriaPrompt(payload, { durationSeconds, instrumentalOnly }) {
  const basePrompt = normalizeString(payload?.prompt)
    || 'Create a beautiful and serene backing track for a generative video composition';

  const promptParts = [
    basePrompt,
    `Target duration: ${durationSeconds} seconds.`,
  ];

  if (instrumentalOnly) {
    promptParts.push('Instrumental backing track only. Do not include vocals, singing, spoken words, or lyrics.');
  }

  const lyrics = normalizeString(payload?.lyrics || payload?.generationMeta?.lyrics);
  if (lyrics && !instrumentalOnly) {
    promptParts.push(`Use these lyrics for the vocal performance:\n${lyrics}`);
  }

  promptParts.push('Create a complete, high-fidelity track with coherent structure and a clean ending.');

  return promptParts.join('\n\n');
}

export function buildLyriaInteractionBody(payload) {
  const durationSeconds = resolveDurationSeconds(payload);
  const instrumentalOnly = isInstrumentalRequest(payload);
  const responseFormat = normalizeResponseFormat(payload);
  const seed = normalizeSeed(payload.seed ?? payload.generationMeta?.seed);
  const generationConfig = {};

  if (seed !== null) {
    generationConfig.seed = seed;
  }

  return {
    durationSeconds,
    responseFormat,
    body: {
      model: resolveGoogleLyriaModel(),
      input: [
        {
          type: 'text',
          text: buildLyriaPrompt(payload, { durationSeconds, instrumentalOnly }),
        },
      ],
      response_format: {
        type: 'audio',
      },
      response_modalities: 'audio',
      ...(Object.keys(generationConfig).length ? { generation_config: generationConfig } : {}),
    },
  };
}

export function buildLyriaGenerateContentBody(payload) {
  const durationSeconds = resolveDurationSeconds(payload);
  const instrumentalOnly = isInstrumentalRequest(payload);
  const responseFormat = normalizeResponseFormat(payload);
  const seed = normalizeSeed(payload.seed ?? payload.generationMeta?.seed);
  const generationConfig = {
    responseModalities: ['AUDIO', 'TEXT'],
  };

  if (seed !== null) {
    generationConfig.seed = seed;
  }

  if (responseFormat === 'wav') {
    generationConfig.responseFormat = {
      audio: {
        mimeType: responseFormatToMimeType(responseFormat),
      },
    };
  }

  return {
    durationSeconds,
    responseFormat,
    model: resolveGoogleLyriaModel(),
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: buildLyriaPrompt(payload, { durationSeconds, instrumentalOnly }),
            },
          ],
        },
      ],
      generationConfig,
    },
  };
}

function collectAudioOutputs(value, outputs = [], depth = 0) {
  if (!value || depth > 12) {
    return outputs;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAudioOutputs(item, outputs, depth + 1);
    }
    return outputs;
  }

  if (typeof value !== 'object') {
    return outputs;
  }

  const type = normalizeString(value.type).toLowerCase();
  const mimeType = normalizeString(value.mime_type || value.mimeType);
  const hasAudioType = type === 'audio' || mimeType.toLowerCase().startsWith('audio/');
  const data = normalizeString(
    value.data ||
    value.audioData ||
    value.audio_data ||
    value.audioContent ||
    value.audio_content
  );
  const uri = normalizeString(value.uri || value.url || value.fileUri || value.file_uri);
  const keys = Object.keys(value);
  const hasInlineDataPayload = Boolean(data) && keys.every((key) => ['data', 'mimeType', 'mime_type'].includes(key));
  const hasPredictionAudioPayload = Boolean(value.audioContent || value.audio_content);

  if ((hasAudioType || hasInlineDataPayload || hasPredictionAudioPayload) && (data || uri)) {
    outputs.push({ data, uri, mimeType });
  }

  for (const childValue of Object.values(value)) {
    collectAudioOutputs(childValue, outputs, depth + 1);
  }

  return outputs;
}

export function extractAudioOutput(responsePayload) {
  const audioOutputs = collectAudioOutputs(responsePayload);
  return audioOutputs.find((output) => output.data || output.uri) || null;
}

async function writeRemoteAudioUriToFile(uri, outputPath) {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to download Google Lyria audio URI with status ${response.status}`);
  }

  const audioBuffer = await response.buffer();
  await fs.writeFile(outputPath, audioBuffer);
}

async function requestGoogleLyria3Audio(payload) {
  const config = getGoogleCloudConfig();
  const projectId = normalizeString(config.projectId);
  if (!projectId) {
    throw new Error('Google Lyria requires GOOGLE_CLOUD_PROJECT, GOOGLE_PROJECT_ID, or service account credentials containing project_id.');
  }

  const token = await getGoogleAccessToken(config);
  const location = resolveGoogleLyriaLocation();
  const { body, responseFormat, model } = buildLyriaGenerateContentBody(payload);

  const response = await fetch(buildVertexGenerateContentUrl({ projectId, location, model }), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let responsePayload = {};
  try {
    responsePayload = responseText ? JSON.parse(responseText) : {};
  } catch {
    responsePayload = { rawResponse: responseText };
  }
  if (!response.ok) {
    throw new Error(responsePayload?.error?.message || responsePayload.rawResponse || `Google Lyria failed with status ${response.status}`);
  }

  const audioOutput = extractAudioOutput(responsePayload);
  if (!audioOutput) {
    throw new Error('Google Lyria returned no audio output.');
  }

  return {
    ...audioOutput,
    responseFormat,
    model: responsePayload?.model || model,
  };
}

async function generateGoogleLyriaRemoteUrl(payload) {
  const tempDir = getTempDir(payload?.sessionId);
  await fs.mkdir(tempDir, { recursive: true });

  let localAudioPath = null;

  try {
    const audioOutput = await requestGoogleLyria3Audio(payload);
    const extension = mimeTypeToExtension(audioOutput.mimeType, audioOutput.responseFormat);
    localAudioPath = joinPath(tempDir, `lyria-native-${uuidv4()}.${extension}`);

    if (audioOutput.data) {
      await fs.writeFile(localAudioPath, Buffer.from(audioOutput.data, 'base64'));
    } else {
      await writeRemoteAudioUriToFile(audioOutput.uri, localAudioPath);
    }

    const dateString = dayjs().format('YYYY-MM-DD_HH-mm-ss');
    const audioRemoteFileName = `audio_${payload.sessionId}_${payload.audioLayerId}_${dateString}.${extension}`;
    return await uploadMusicToCDN(localAudioPath, audioRemoteFileName);
  } finally {
    if (localAudioPath) {
      await fs.unlink(localAudioPath).catch(() => {});
    }
  }
}

async function retryOrDeleteFailedUpdate(payload, errorMessage) {
  const currentRetries = Number.isFinite(Number(payload?.numRetries))
    ? Number(payload.numRetries)
    : 0;

  if (currentRetries < 1) {
    const nextRetryCount = currentRetries + 1;
    const generationMeta = payload?.generationMeta && typeof payload.generationMeta === 'object'
      ? { ...payload.generationMeta }
      : {};
    const originalBackingTrackPrompt =
      typeof generationMeta.originalBackingTrackPrompt === 'string' && generationMeta.originalBackingTrackPrompt.trim()
        ? generationMeta.originalBackingTrackPrompt.trim()
        : payload.prompt;
    const alternatePrompt = await getSimplifiedBackingTrackPromptForRetry(
      originalBackingTrackPrompt,
      errorMessage,
      { request: payload },
    );

    await AudioGeneration.findByIdAndUpdate(payload._id, {
      numRetries: nextRetryCount,
      musicGenerationStatus: 'INIT',
      status: 'INIT',
      prompt: alternatePrompt,
      generationId: null,
      error: errorMessage || null,
      rowLocked: false,
      generationMeta: {
        ...generationMeta,
        originalBackingTrackPrompt,
        backingTrackPromptSimplified: true,
      },
    });

    return 'RETRY_SCHEDULED';
  }

  await markAudioGenerationAsFailed(payload._id, errorMessage || 'Google Lyria backing track generation failed after retry.');
  await AudioGeneration.findByIdAndDelete(payload._id);
  return 'FAILED';
}

export async function dispatchAndProcessLyriaNativeMusicRequest(payload) {
  const { status = 'INIT' } = payload;

  if (status === 'INIT') {
    const generationId = `${GOOGLE_LYRIA_REQUEST_PREFIX}${Date.now()}`;
    await AudioGeneration.findByIdAndUpdate(payload._id, {
      status: 'PENDING',
      musicGenerationStatus: 'PENDING',
      generationId,
      rowLocked: true,
    });

    try {
      const remoteUrl = await generateGoogleLyriaRemoteUrl(payload);
      await finalizeRemoteAudioGeneration({
        sessionId: payload.sessionId,
        audioLayerId: payload.audioLayerId,
        audioGenerationId: payload._id,
        remoteAudioUrl: remoteUrl,
      });
    } catch (error) {
      console.error('[GoogleLyriaNative] generation failed:', error);
      await retryOrDeleteFailedUpdate(payload, error?.message || 'Google Lyria backing track generation failed.');
    }
    return;
  }

  if (status === 'PENDING') {
    await retryOrDeleteFailedUpdate(
      payload,
      'Google Lyria native request was interrupted before completion.'
    );
    return;
  }

  if (status === 'FAILED') {
    await retryOrDeleteFailedUpdate(payload, payload?.error || 'Google Lyria backing track generation failed.');
  }
}

export const dispatchAndProcessGoogleLyria2MusicRequest = dispatchAndProcessLyriaNativeMusicRequest;
