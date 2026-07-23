import axios from "axios";
import { fal } from "@fal-ai/client";

import AudioGeneration from "../schema/AudioGeneration.js";
import { finalizeAudioBufferGeneration, finalizeRemoteAudioGeneration, markAudioGenerationAsFailed } from "./audioUtils.js";
import {
  buildElevenLabsMusicInput,
  ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT,
} from "./ElevenLabsMusicPayload.js";
import { isStandaloneEdition } from '../util/environmentUtils.js';

export {
  buildElevenLabsMusicInput,
  buildElevenLabsMusicPrompt,
  resolveElevenLabsMusicLengthMs,
} from "./ElevenLabsMusicPayload.js";

const FAL_API_KEY = process.env.FAL_API_KEY;
const FA_AUDIO_LINK = "fal-ai/elevenlabs/music";
const ELEVENLABS_MUSIC_STREAM_URL = "https://api.elevenlabs.io/v1/music/stream";
const ELEVENLABS_MUSIC_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

fal.config({
  credentials: FAL_API_KEY
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getElevenLabsApiKey() {
  return normalizeString(process.env.ELEVENLABS_API_TOKEN) || normalizeString(process.env.ELEVENLABS_API_KEY);
}

export function hasNativeElevenLabsMusicCredential() {
  return Boolean(getElevenLabsApiKey());
}

function getProviderPreference(payload) {
  return normalizeString(
    payload?.generationMeta?.elevenLabsProvider ||
    payload?.generationMeta?.elevenlabsProvider ||
    payload?.generationMeta?.elevenLabsMusicProvider ||
    process.env.ELEVENLABS_MUSIC_PROVIDER
  ).toLowerCase();
}

function getExplicitResolvedProvider(payload = {}) {
  const provider = normalizeString(
    payload?.resolvedMusicProvider ||
    payload?.generationMeta?.resolvedMusicProvider ||
    payload?.generationMeta?.dockerMusicProvider
  ).toLowerCase();

  if (['native', 'elevenlabs', 'direct'].includes(provider)) {
    return 'elevenlabs';
  }
  if (['fal', 'fal-ai', 'fal_ai'].includes(provider)) {
    return 'fal';
  }
  return '';
}

export function shouldUseNativeElevenLabsMusic(payload = {}) {
  if (!hasNativeElevenLabsMusicCredential()) {
    return false;
  }

  const explicitProvider = getExplicitResolvedProvider(payload);
  if (explicitProvider === 'elevenlabs') {
    return true;
  }
  if (explicitProvider === 'fal') {
    return false;
  }

  const preference = getProviderPreference(payload);
  if (['native', 'elevenlabs', 'direct'].includes(preference)) {
    return true;
  }
  if (['fal', 'fal-ai', 'fal_ai'].includes(preference)) {
    return false;
  }

  return isStandaloneEdition() && !normalizeString(FAL_API_KEY);
}

function buildNativeElevenLabsMusicRequest(payload) {
  const { output_format: outputFormat, ...requestBody } = buildElevenLabsMusicInput(payload);
  const requestUrl = new URL(ELEVENLABS_MUSIC_STREAM_URL);
  requestUrl.searchParams.set('output_format', outputFormat || ELEVENLABS_MUSIC_DEFAULT_OUTPUT_FORMAT);

  return {
    requestUrl: requestUrl.toString(),
    requestBody,
  };
}

async function retryOrDeleteFailedUpdate(payload, errorMessage) {
  const currentRetries = Number.isFinite(Number(payload?.numRetries))
    ? Number(payload.numRetries)
    : 0;

  if (currentRetries < 3) {
    const nextRetryCount = currentRetries + 1;

    await AudioGeneration.findByIdAndUpdate(payload._id, {
      numRetries: nextRetryCount,
      musicGenerationStatus: 'INIT',
      status: 'INIT',
      generationId: null,
      error: errorMessage || null,
      rowLocked: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const refreshedPayload = await AudioGeneration.findById(payload._id);
    if (refreshedPayload) {
      await dispatchAndProcessElevenLabsMusicRequest(refreshedPayload);
    }

    return;
  }

  await markAudioGenerationAsFailed(payload._id, errorMessage || 'ElevenLabs Music generation failed.');
  await AudioGeneration.findByIdAndDelete(payload._id);
}

export async function requestGenerateElevenLabsMusic(payload) {
  try {
    const { request_id } = await fal.queue.submit(FA_AUDIO_LINK, {
      input: buildElevenLabsMusicInput(payload),
    });

    return request_id;
  } catch (error) {
    console.error('Failed to submit ElevenLabs Music request:', error);
    return null;
  }
}

export async function requestGenerateNativeElevenLabsMusic(payload) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_TOKEN or ELEVENLABS_API_KEY is required for native ElevenLabs music generation.');
  }

  const { requestUrl, requestBody } = buildNativeElevenLabsMusicRequest(payload);
  const response = await axios.post(
    requestUrl,
    requestBody,
    {
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      responseType: 'arraybuffer',
      timeout: Number(process.env.ELEVENLABS_MUSIC_TIMEOUT_MS) || ELEVENLABS_MUSIC_DEFAULT_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  return Buffer.from(response.data);
}

export async function listenToPendingElevenLabsMusicRequest(payload) {
  const { generationId } = payload;

  try {
    const responseStatusData = await fal.queue.status(FA_AUDIO_LINK, {
      requestId: generationId,
      logs: true,
    });

    const responseStatus = responseStatusData.status;

    if (responseStatus === 'COMPLETED') {
      const result = await fal.queue.result(FA_AUDIO_LINK, {
        requestId: generationId,
      });

      const audioUrl = result?.data?.audio?.url || result?.data?.audio_file?.url;
      if (!audioUrl) {
        return {
          responseStatus: 'FAILED',
          error: 'ElevenLabs Music result did not include an audio URL.',
        };
      }

      return {
        responseStatus: 'COMPLETED',
        remoteUrl: audioUrl,
      };
    }

    if (responseStatus === 'FAILED') {
      return {
        responseStatus: 'FAILED',
        error: 'ElevenLabs Music request failed.',
      };
    }

    return {
      responseStatus: 'PENDING',
    };
  } catch (error) {
    console.error(`Failed to fetch ElevenLabs Music status for ${generationId}:`, error);
    return {
      responseStatus: 'FAILED',
      error: error?.message || 'Failed to fetch ElevenLabs Music request status.',
    };
  }
}

export async function dispatchAndProcessElevenLabsMusicRequest(payload) {
  const { status } = payload;

  if (status === 'INIT') {
    if (shouldUseNativeElevenLabsMusic(payload)) {
      try {
        const audioBuffer = await requestGenerateNativeElevenLabsMusic(payload);
        await finalizeAudioBufferGeneration({
          sessionId: payload.sessionId,
          audioLayerId: payload.audioLayerId,
          audioGenerationId: payload._id,
          audioBuffer,
        });
      } catch (error) {
        console.error('Failed to process native ElevenLabs Music request:', error);
        await retryOrDeleteFailedUpdate(payload, error?.message || 'Failed to process native ElevenLabs Music request.');
      }
      return;
    }

    const requestId = await requestGenerateElevenLabsMusic(payload);

    if (requestId) {
      await AudioGeneration.findOneAndUpdate(
        { _id: payload._id },
        {
          status: 'PENDING',
          generationId: requestId,
          rowLocked: false,
        }
      );
      return;
    }

    await retryOrDeleteFailedUpdate(payload, 'Failed to submit ElevenLabs Music request.');
    return;
  }

  if (status === 'PENDING') {
    const responseData = await listenToPendingElevenLabsMusicRequest(payload);

    if (responseData?.remoteUrl) {
      await finalizeRemoteAudioGeneration({
        sessionId: payload.sessionId,
        audioLayerId: payload.audioLayerId,
        audioGenerationId: payload._id,
        remoteAudioUrl: responseData.remoteUrl,
      });
      return;
    }

    if (responseData?.responseStatus === 'FAILED') {
      await retryOrDeleteFailedUpdate(payload, responseData.error);
    }

    return;
  }

  if (status === 'FAILED') {
    await retryOrDeleteFailedUpdate(payload, payload?.error);
  }
}
