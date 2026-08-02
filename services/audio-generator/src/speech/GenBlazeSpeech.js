import AudioGeneration from '../schema/AudioGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import { getDBConnectionString } from '../DBString.js';
import {
  getGenBlazeSpeechLogicalModel,
} from '../consts/DockerProviderPriority.js';
import {
  finalizeExternalSpeechGeneration,
  retryOrFailAudioGeneration,
} from '../external/SamsarExternalAudioAdapter.js';

const DEFAULT_GENBLAZE_BASE_URL = 'http://genblaze:8080/v1';
const DEFAULT_GENBLAZE_MEDIA_TIMEOUT_MS = 120_000;
const DEFAULT_GENBLAZE_SPEECH_POLL_INTERVAL_MS = 2_000;
const DEFAULT_GENBLAZE_SPEECH_POLL_TIMEOUT_MS = 8 * 60 * 1_000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function normalizeBaseUrl(value) {
  return (normalizeString(value) || DEFAULT_GENBLAZE_BASE_URL).replace(/\/+$/, '');
}

function normalizeProvider(value) {
  const provider = normalizeString(value).toUpperCase();
  if (['ELEVENLABS', 'ELEVENLABS_FAL', 'ELEVENLABSFAL', 'ELEVEN'].includes(provider)) {
    return 'ELEVENLABS';
  }
  if (provider === 'OPENAI') {
    return 'OPENAI';
  }
  return provider;
}

function buildOpenAIInstructions(payload = {}) {
  const generationMeta = payload.generationMeta;
  if (generationMeta && typeof generationMeta === 'object' && Object.keys(generationMeta).length > 0) {
    const parts = Object.entries(generationMeta)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => key === 'Affect'
        ? `Personality/affect: ${value}`
        : `${key}: ${value}`);
    const instructions = normalizeString(parts.join('\n\n'));
    if (instructions) {
      return instructions;
    }
  }
  return normalizeString(payload.instructions);
}

function getLogicalModel(payload = {}) {
  const ttsProvider = normalizeProvider(
    payload.ttsProvider || payload.provider || payload.model,
  );
  const logicalModel = getGenBlazeSpeechLogicalModel(ttsProvider);
  if (!logicalModel) {
    const error = new Error(
      `Speech provider ${ttsProvider || '<missing>'} is not supported by the GenBlaze speech adapter.`,
    );
    error.code = 'GENBLAZE_MODEL_UNSUPPORTED';
    throw error;
  }
  return logicalModel;
}

export function buildGenBlazeSpeechRequest(payload = {}) {
  const model = getLogicalModel(payload);
  const voice = normalizeString(
    payload.speakerVoiceId || payload.voiceId || payload.speaker,
  ) || (model === 'OPENAI_TTS' ? 'alloy' : '');
  if (!voice) {
    throw new Error(`${model} via GMICloud requires a voice.`);
  }

  const params = {
    voice,
    output_format: model === 'ELEVENLABS' ? 'mp3_44100_128' : 'mp3',
  };
  const instructions = buildOpenAIInstructions(payload);
  if (model === 'OPENAI_TTS' && instructions && Number(payload.numRetries || 0) === 0) {
    params.instructions = instructions;
  }

  return {
    model,
    modality: 'audio',
    prompt: normalizeString(payload.prompt ?? payload.text),
    input_urls: [],
    params,
  };
}

async function readJson(response) {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('GenBlaze returned an invalid JSON response.');
  }
}

function getErrorMessage(body, fallback) {
  return normalizeString(body?.error?.message) ||
    normalizeString(body?.message) ||
    normalizeString(body?.error) ||
    fallback;
}

export async function requestGenBlazeSpeech(pathname, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('This runtime cannot call GenBlaze because fetch is unavailable.');
  }
  if (!isTruthyEnv(env.SAMSAR_GENBLAZE_ENABLED)) {
    throw new Error('SAMSAR_GENBLAZE_ENABLED is required for GMICloud speech generation.');
  }

  const timeoutMs = Math.max(
    1_000,
    Number(env.SAMSAR_GENBLAZE_MEDIA_TIMEOUT_MS) || DEFAULT_GENBLAZE_MEDIA_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${normalizeBaseUrl(env.SAMSAR_GENBLAZE_BASE_URL)}${pathname}`,
      {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      },
    );
    const responseBody = await readJson(response);
    if (!response.ok) {
      const error = new Error(getErrorMessage(
        responseBody,
        `GenBlaze speech request failed with status ${response.status}.`,
      ));
      error.status = response.status;
      error.code = responseBody?.error?.code;
      throw error;
    }
    return responseBody;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('GenBlaze speech request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeResponseStatus(response = {}) {
  const status = normalizeString(response.status || response.state).toLowerCase();
  if (['succeeded', 'completed', 'success', 'done'].includes(status)) return 'COMPLETED';
  if (
    ['failed', 'error', 'cancelled', 'canceled'].includes(status) ||
    status.includes('fail') ||
    status.includes('error')
  ) {
    return 'FAILED';
  }
  return 'PENDING';
}

function getResultAudioUrl(response = {}) {
  const candidates = [
    response?.assets?.[0]?.url,
    response?.audio?.url,
    response?.audio_url,
    response?.result_url,
    response?.url,
  ];
  return candidates.map(normalizeString).find(Boolean) || '';
}

export async function processGenBlazeSpeechRequest(payload = {}, dependencies = {}) {
  const connect = dependencies.connect || getDBConnectionString;
  const audioGenerationModel = dependencies.audioGenerationModel || AudioGeneration;
  const videoSessionModel = dependencies.videoSessionModel || VideoSession;
  const request = dependencies.request || requestGenBlazeSpeech;
  const finalizeSpeech = dependencies.finalizeSpeech || finalizeExternalSpeechGeneration;
  const retryOrFail = dependencies.retryOrFail || retryOrFailAudioGeneration;
  const logger = dependencies.logger || console;
  const status = normalizeString(payload.status || 'INIT').toUpperCase();

  try {
    await connect();

    if (status === 'INIT') {
      const requestBody = buildGenBlazeSpeechRequest(payload);
      const response = await request('/media/requests', {
        method: 'POST',
        body: requestBody,
      });
      const requestId = normalizeString(response?.request_id);
      if (!requestId) {
        throw new Error('GenBlaze speech submit returned no request id.');
      }

      await audioGenerationModel.findByIdAndUpdate(payload._id, {
        apiRequestId: requestId,
        generationId: requestId,
        genblazeRequestId: requestId,
        genblazeModel: requestBody.model,
        audioAdapterProvider: 'gmicloud',
        externalProvider: 'gmicloud',
        externalAudioRoute: null,
        status: 'PENDING',
        rowLocked: false,
      });

      if (payload.sessionId && payload.audioLayerId) {
        await videoSessionModel.findOneAndUpdate(
          { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
          { $set: { 'audioLayers.$.generationStatus': 'PENDING' } },
        );
      }
      return;
    }

    if (status === 'PENDING') {
      const requestId = normalizeString(
        payload.genblazeRequestId || payload.apiRequestId || payload.generationId,
      );
      if (!requestId) {
        throw new Error('GenBlaze speech polling called without a request id.');
      }

      const response = await request(`/media/requests/${encodeURIComponent(requestId)}`);
      const responseStatus = normalizeResponseStatus(response);
      if (responseStatus === 'COMPLETED') {
        const audioUrl = getResultAudioUrl(response);
        if (!audioUrl) {
          throw new Error('GenBlaze speech result returned no audio URL.');
        }
        await finalizeSpeech(payload, audioUrl);
        return;
      }
      if (responseStatus === 'FAILED') {
        await retryOrFail(
          payload,
          getErrorMessage(response, 'GMICloud speech generation failed.'),
        );
        return;
      }

      await audioGenerationModel.findByIdAndUpdate(payload._id, { rowLocked: false });
    }
  } catch (error) {
    logger.error('[GenBlazeSpeech] request failed:', error);
    await retryOrFail(
      payload,
      error?.message || 'GMICloud speech generation failed.',
    );
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function generateGenBlazeSpeechAudioUrl(payload = {}, dependencies = {}) {
  const request = dependencies.request || requestGenBlazeSpeech;
  const sleep = dependencies.wait || wait;
  const now = dependencies.now || Date.now;
  const env = dependencies.env || process.env;
  const pollIntervalMs = dependencies.pollIntervalMs ??
    (Number(env.SAMSAR_GENBLAZE_AUDIO_POLL_INTERVAL_MS) || DEFAULT_GENBLAZE_SPEECH_POLL_INTERVAL_MS);
  const timeoutMs = dependencies.timeoutMs ??
    (Number(env.SAMSAR_GENBLAZE_AUDIO_POLL_TIMEOUT_MS) || DEFAULT_GENBLAZE_SPEECH_POLL_TIMEOUT_MS);

  const submitResponse = await request('/media/requests', {
    method: 'POST',
    body: buildGenBlazeSpeechRequest(payload),
  });
  const requestId = normalizeString(submitResponse?.request_id);
  if (!requestId) {
    throw new Error('GenBlaze speech submit returned no request id.');
  }

  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    const response = await request(`/media/requests/${encodeURIComponent(requestId)}`);
    const responseStatus = normalizeResponseStatus(response);
    if (responseStatus === 'COMPLETED') {
      const audioUrl = getResultAudioUrl(response);
      if (!audioUrl) {
        throw new Error('GenBlaze speech result returned no audio URL.');
      }
      return audioUrl;
    }
    if (responseStatus === 'FAILED') {
      throw new Error(getErrorMessage(response, 'GMICloud speech generation failed.'));
    }
    await sleep(Math.max(0, pollIntervalMs));
  }

  throw new Error('GMICloud speech generation timed out.');
}
