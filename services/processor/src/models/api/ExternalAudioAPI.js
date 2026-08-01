import mongoose from 'mongoose';

import AudioGeneration from '../../schema/AudioGeneration.js';
import GlobalSession from '../../schema/GlobalSession.js';
import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';

const AUDIO_ROUTE_TEXT_TO_SPEECH = 'text_to_speech';
const AUDIO_ROUTE_TEXT_TO_MUSIC = 'text_to_music';
const AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT = 'text_to_sound_effect';

const AUDIO_ROUTE_TO_GENERATION_TYPE = Object.freeze({
  [AUDIO_ROUTE_TEXT_TO_SPEECH]: 'speech',
  [AUDIO_ROUTE_TEXT_TO_MUSIC]: 'music',
  [AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT]: 'sound',
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasObjectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function getFirstStringValue(source = {}, keys = []) {
  for (const key of keys) {
    const value = normalizeString(source?.[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function getFirstNumberValue(source = {}, keys = []) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

function normalizeTtsProvider(value) {
  const normalized = normalizeString(value).toUpperCase();
  if (normalized === 'GOOGLE_TTS') return 'GOOGLE';
  if (normalized === 'ELEVEN' || normalized === 'ELEVENLABS_FAL' || normalized === 'ELEVENLABSFAL') return 'ELEVENLABS';
  if (normalized === 'PLAYHT') return 'PLAYAI';
  if (normalized === 'OPENAI_TTS') return 'OPENAI';
  return normalized || 'OPENAI';
}

function normalizeMusicModel(value) {
  const normalized = normalizeString(value).toUpperCase();
  if (['ELEVEN', 'ELEVENLABS', 'ELEVENLABSMUSIC'].includes(normalized)) return 'ELEVENLABS_MUSIC';
  if (['LYRIA', 'GOOGLE_LYRIA', 'LYRIA3_PRO'].includes(normalized)) return 'LYRIA3';
  return normalized || 'ELEVENLABS_MUSIC';
}

function normalizeSoundEffectModel(value) {
  const normalized = normalizeString(value).toUpperCase();
  if (['STABLE_AUDIO', 'STABLEAUDIO'].includes(normalized)) return 'SDAUDIO';
  return normalized || 'SDAUDIO';
}

function buildError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getRouteMetadata(route, payload) {
  const metadata = normalizeObject(payload.metadata);
  const generationMeta = normalizeObject(payload.generationMeta || payload.generation_meta);
  return {
    ...metadata,
    ...(Object.keys(generationMeta).length ? { generationMeta } : {}),
    externalAudioApiRequest: true,
    externalAudioRoute: route,
  };
}

function normalizeSpeechAudioPayload(payload = {}, route = AUDIO_ROUTE_TEXT_TO_SPEECH) {
  const text = getFirstStringValue(payload, ['text', 'input', 'prompt', 'transcript', 'script']);
  if (!text) {
    throw buildError('text, input, prompt, or transcript is required.');
  }

  const ttsProvider = normalizeTtsProvider(getFirstStringValue(payload, [
    'tts_provider',
    'ttsProvider',
    'provider',
    'model',
  ]));
  const speaker = getFirstStringValue(payload, [
    'speaker',
    'voice',
    'voice_id',
    'voiceId',
    'speaker_voice_id',
    'speakerVoiceId',
  ]) || (ttsProvider === 'OPENAI' ? 'alloy' : '');

  return {
    generationType: 'speech',
    prompt: text,
    model: ttsProvider,
    ttsProvider,
    provider: ttsProvider,
    speaker,
    speakerVoiceId: getFirstStringValue(payload, ['speakerVoiceId', 'speaker_voice_id', 'voice_id', 'voiceId']),
    speakerLabel: getFirstStringValue(payload, ['speakerLabel', 'speaker_label', 'voice_name', 'voiceName']),
    speakerCharacterName: getFirstStringValue(payload, ['speakerCharacterName', 'speaker_character_name', 'character']),
    speakerDetails: normalizeObject(payload.speakerDetails || payload.speaker_details),
    instructions: getFirstStringValue(payload, ['instructions', 'style_instructions']),
    languageCode: getFirstStringValue(payload, ['languageCode', 'language_code', 'language']),
    languageCodes: Array.isArray(payload.languageCodes || payload.language_codes)
      ? payload.languageCodes || payload.language_codes
      : undefined,
    generationMeta: getRouteMetadata(route, payload),
  };
}

function normalizeMusicAudioPayload(payload = {}, route = AUDIO_ROUTE_TEXT_TO_MUSIC) {
  const prompt = getFirstStringValue(payload, ['prompt', 'text', 'input', 'description']) ||
    'Create an original cinematic background music track.';
  const model = normalizeMusicModel(getFirstStringValue(payload, [
    'model',
    'music_model',
    'musicModel',
    'music_provider',
    'musicProvider',
    'provider',
  ]));
  const duration = getFirstNumberValue(payload, [
    'duration',
    'duration_seconds',
    'durationSeconds',
    'seconds_total',
    'secondsTotal',
  ]);
  const generationMeta = getRouteMetadata(route, payload);
  const lyrics = getFirstStringValue(payload, ['lyrics']);
  if (lyrics) {
    generationMeta.lyrics = lyrics;
  }

  return {
    generationType: 'music',
    prompt,
    model,
    duration,
    secondsTotal: duration,
    isInstrumental: payload.isInstrumental ?? payload.is_instrumental ?? payload.make_instrumental ?? true,
    isBackingTrack: Boolean(payload.isBackingTrack || payload.is_backing_track),
    musicGenerationStatus: 'INIT',
    generationMeta,
  };
}

function normalizeSoundEffectAudioPayload(payload = {}, route = AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT) {
  const prompt = getFirstStringValue(payload, ['prompt', 'text', 'input', 'description']);
  if (!prompt) {
    throw buildError('prompt, text, or input is required.');
  }
  const model = normalizeSoundEffectModel(getFirstStringValue(payload, [
    'model',
    'sound_effect_model',
    'soundEffectModel',
    'provider',
  ]));
  const secondsTotal = getFirstNumberValue(payload, [
    'secondsTotal',
    'seconds_total',
    'duration',
    'duration_seconds',
    'durationSeconds',
  ]);

  return {
    generationType: 'sound',
    prompt,
    model,
    duration: secondsTotal,
    secondsTotal,
    generationMeta: getRouteMetadata(route, payload),
  };
}

function normalizeExternalAudioPayload({ route, payload }) {
  const inputPayload = hasObjectValue(payload?.input) ? payload.input : normalizeObject(payload);
  if (route === AUDIO_ROUTE_TEXT_TO_SPEECH) {
    return normalizeSpeechAudioPayload(inputPayload, route);
  }
  if (route === AUDIO_ROUTE_TEXT_TO_MUSIC) {
    return normalizeMusicAudioPayload(inputPayload, route);
  }
  if (route === AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT) {
    return normalizeSoundEffectAudioPayload(inputPayload, route);
  }
  throw buildError(`Unsupported external audio route: ${route}`, 404);
}

function getAudioCreditCost(generationType) {
  return generationType === 'music' ? 2 : 1;
}

function resolveAudioQueueStatus(audioDoc, fallbackStatus = 'PENDING') {
  const normalizedType = normalizeString(audioDoc?.generationType).toLowerCase();
  if (normalizedType === 'music') {
    return normalizeString(audioDoc?.musicGenerationStatus || audioDoc?.status) || fallbackStatus;
  }
  return normalizeString(audioDoc?.status) || fallbackStatus;
}

function buildAudioStatusPayload({ globalSession, audioDoc }) {
  const resultUrls = Array.isArray(globalSession?.resultUrls)
    ? globalSession.resultUrls.filter(Boolean)
    : [];
  const resultUrl = globalSession?.resultUrl || resultUrls[0] || null;
  const status = audioDoc
    ? resolveAudioQueueStatus(audioDoc, globalSession?.status || 'PENDING')
    : globalSession?.status || 'PENDING';

  const response = {
    session_id: globalSession?.sessionId,
    request_id: globalSession?.requestId || globalSession?.sessionId,
    status,
    type: 'audio',
    generation_type: globalSession?.metadata?.generationType || audioDoc?.generationType || null,
    route: globalSession?.metadata?.externalAudioRoute || null,
    provider: globalSession?.provider || null,
    model: globalSession?.metadata?.model || audioDoc?.model || null,
  };

  if (resultUrl) {
    response.result_url = resultUrl;
    response.audio_url = resultUrl;
    response.audio = { url: resultUrl };
    response.data = { audio_url: resultUrl };
  }
  if (resultUrls.length) {
    response.result_urls = resultUrls;
  }
  if (globalSession?.errorMessage) {
    response.error = globalSession.errorMessage;
    response.message = globalSession.errorMessage;
  }
  if (audioDoc?.apiRequestId || audioDoc?.generationId) {
    response.provider_request_id = audioDoc.apiRequestId || audioDoc.generationId;
  }

  return response;
}

async function findAudioGlobalSession(requestId, userId) {
  const normalizedRequestId = normalizeString(requestId);
  if (!normalizedRequestId) {
    return null;
  }
  const query = {
    sessionType: 'audio',
    $or: [
      { sessionId: normalizedRequestId },
      { requestId: normalizedRequestId },
      { apiSessionId: normalizedRequestId },
      { 'metadata.audioGenerationId': normalizedRequestId },
    ],
  };
  const globalSession = await GlobalSession.findOne(query);
  if (globalSession?.userId && userId && globalSession.userId.toString() !== userId.toString()) {
    throw buildError('Request not found.', 404);
  }
  return globalSession;
}

async function findAudioGenerationForSession(globalSession, requestId) {
  const candidateId = normalizeString(globalSession?.metadata?.audioGenerationId) ||
    normalizeString(globalSession?.requestId) ||
    normalizeString(requestId);
  if (!candidateId || !mongoose.Types.ObjectId.isValid(candidateId)) {
    return null;
  }
  return AudioGeneration.findById(candidateId);
}

export async function createExternalAudioRequest({
  userId,
  route,
  payload = {},
  meterCredits = true,
}) {
  if (!userId) {
    throw buildError('userId is required.', 401);
  }

  const normalizedRoute = normalizeString(route);
  const normalizedPayload = normalizeExternalAudioPayload({
    route: normalizedRoute,
    payload,
  });
  const generationType = AUDIO_ROUTE_TO_GENERATION_TYPE[normalizedRoute];
  const creditsCharged = meterCredits ? getAudioCreditCost(generationType) : 0;
  const creditResult = meterCredits
    ? await deductGenerationCredits(userId, creditsCharged, {
        source: 'external_audio_api',
        metadata: {
          requestType: 'API',
          route: normalizedRoute,
          generationType,
          model: normalizedPayload.model || normalizedPayload.ttsProvider,
        },
      })
    : { remainingCredits: null };

  await getDBConnectionString();

  const audioGeneration = new AudioGeneration({
    ...normalizedPayload,
    userId,
    rowLocked: false,
    status: 'INIT',
    externalAudioApiRequest: true,
    requestType: 'API',
  });
  const requestId = audioGeneration._id.toString();
  audioGeneration.sessionId = requestId;
  audioGeneration.audioLayerId = requestId;
  audioGeneration.apiSessionId = requestId;
  audioGeneration.externalAudioApiRequest = true;
  audioGeneration.generationMeta = {
    ...(normalizedPayload.generationMeta || {}),
    audioGenerationId: requestId,
    globalSessionId: requestId,
  };
  await audioGeneration.save();

  await upsertGlobalSessionMapping({
    sessionId: requestId,
    sessionType: 'audio',
    requestId,
    provider: normalizedPayload.ttsProvider || normalizedPayload.model || generationType,
    userId,
    status: 'PENDING',
    metadata: {
      externalAudioApiRequest: true,
      externalAudioRoute: normalizedRoute,
      generationType,
      audioGenerationId: requestId,
      model: normalizedPayload.model || normalizedPayload.ttsProvider || null,
      prompt: normalizedPayload.prompt || null,
    },
    requestType: 'API',
    sessionSubType: `external_audio_${normalizedRoute}`,
    apiSessionId: requestId,
  });

  return {
    status: 'queued',
    request_id: requestId,
    session_id: requestId,
    global_status_id: requestId,
    route: normalizedRoute,
    generation_type: generationType,
    provider: normalizedPayload.ttsProvider || normalizedPayload.model || null,
    model: normalizedPayload.model || normalizedPayload.ttsProvider || null,
    userId,
    creditsCharged,
    remainingCredits: creditResult?.remainingCredits ?? null,
  };
}

export async function getExternalAudioStatus({ requestId, userId }) {
  if (!normalizeString(requestId)) {
    throw buildError('request_id (or session_id) query param is required.', 400);
  }

  await getDBConnectionString();
  const globalSession = await findAudioGlobalSession(requestId, userId);
  if (!globalSession) {
    throw buildError('Request not found.', 404);
  }
  const audioDoc = await findAudioGenerationForSession(globalSession, requestId);
  if (audioDoc?.userId && userId && audioDoc.userId.toString() !== userId.toString()) {
    throw buildError('Request not found.', 404);
  }
  return buildAudioStatusPayload({ globalSession, audioDoc });
}

export {
  AUDIO_ROUTE_TEXT_TO_SPEECH,
  AUDIO_ROUTE_TEXT_TO_MUSIC,
  AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT,
};
