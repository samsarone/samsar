import fs from 'fs';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';

import AudioGeneration from '../schema/AudioGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import { getDBConnectionString } from '../DBString.js';
import { uploadAudioAssetToCDN } from '../AWS.js';
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from '../utils/AssetPaths.js';
import { resolveSpeechLayerTimingUpdate } from '../speech/SpeechLayerTiming.js';
import { finalizeRemoteAudioGeneration, markAudioGenerationAsFailed } from '../music/audioUtils.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import { finalizeStandaloneExternalAudioGeneration } from './StandaloneExternalAudio.js';
import { buildMusicInputPayload } from './SamsarExternalAudioPayloads.js';
import { isStandaloneEdition } from '../util/environmentUtils.js';
import { AUDIO_FFPROBE_THREAD_OPTIONS } from '../utils/FfmpegResources.js';
import { createSubmissionOutcomeUnknownError } from '../utils/ProviderSubmissionSafety.js';

const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_EXTERNAL_AUDIO_TIMEOUT_MS = 15 * 60 * 1000;
const EXTERNAL_AUDIO_ROUTE_TEXT_TO_SPEECH = 'text_to_speech';
const EXTERNAL_AUDIO_ROUTE_TEXT_TO_MUSIC = 'text_to_music';
const EXTERNAL_AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT = 'text_to_sound_effect';

ffmpeg.setFfprobePath('/usr/bin/ffprobe');
const probe = promisify(ffmpeg.ffprobe);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  return normalizeString(value || DEFAULT_SAMSAR_API_BASE_URL).replace(/\/+$/, '') || DEFAULT_SAMSAR_API_BASE_URL;
}

function getSamsarRootApiUrl() {
  return normalizeBaseUrl(process.env.SAMSAR_JS_API_URL || process.env.SAMSAR_API_URL)
    .replace(/\/v1$/i, '');
}

function getSamsarApiKey() {
  return normalizeString(process.env.SAMSAR_API_KEY);
}

function isFalseyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return ['0', 'false', 'no', 'off'].includes(normalized);
}

function isTruthyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export function shouldUseSamsarExternalAudio() {
  if (isFalseyEnv(process.env.SAMSAR_EXTERNAL_AUDIO_ENABLED)) {
    return false;
  }
  if (!getSamsarApiKey()) {
    return false;
  }
  if (isTruthyEnv(process.env.SAMSAR_EXTERNAL_AUDIO_ENABLED) || isTruthyEnv(process.env.SAMSAR_FORCE_EXTERNAL_AUDIO)) {
    return true;
  }
  return isStandaloneEdition();
}

function buildExternalAudioUrl(routePath) {
  return `${getSamsarRootApiUrl()}/v2/external/audio/${routePath.replace(/^\/+/, '')}`;
}

function buildExternalAudioHeaders() {
  const apiKey = getSamsarApiKey();
  if (!apiKey) {
    throw new Error('SAMSAR_API_KEY is required for Samsar external audio generation.');
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

function removeEmptyValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => (
      value !== undefined &&
      value !== null &&
      !(typeof value === 'string' && value.trim() === '')
    ))
  );
}

function getRequestId(responseData) {
  return normalizeString(
    responseData?.request_id ||
    responseData?.requestId ||
    responseData?.id ||
    responseData?.data?.request_id ||
    responseData?.data?.requestId
  );
}

function normalizeProviderStatus(statusData) {
  const rawStatus = normalizeString(
    statusData?.status ||
    statusData?.state ||
    statusData?.request_status ||
    statusData?.data?.status ||
    statusData?.data?.state
  ).toUpperCase();

  if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'DONE'].includes(rawStatus)) {
    return 'COMPLETED';
  }
  if (
    ['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(rawStatus) ||
    rawStatus.includes('FAIL') ||
    rawStatus.includes('ERROR')
  ) {
    return 'FAILED';
  }
  return 'PENDING';
}

function firstUrlFromArray(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    const candidate = normalizeString(item?.url || item?.audio_url || item);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function getAudioUrl(resultData) {
  const candidates = [
    resultData?.audio_url,
    resultData?.result_url,
    resultData?.audio?.url,
    typeof resultData?.audio === 'string' ? resultData.audio : null,
    resultData?.audio_file?.url,
    typeof resultData?.audio_file === 'string' ? resultData.audio_file : null,
    resultData?.data?.audio_url,
    resultData?.data?.result_url,
    resultData?.data?.audio?.url,
    typeof resultData?.data?.audio === 'string' ? resultData.data.audio : null,
    resultData?.data?.audio_file?.url,
    typeof resultData?.data?.audio_file === 'string' ? resultData.data.audio_file : null,
    resultData?.output?.audio?.url,
    resultData?.data?.output?.audio?.url,
    resultData?.output?.audio_file?.url,
    resultData?.data?.output?.audio_file?.url,
    resultData?.url,
    resultData?.data?.url,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return (
    firstUrlFromArray(resultData?.result_urls) ||
    firstUrlFromArray(resultData?.data?.result_urls) ||
    firstUrlFromArray(resultData?.audios) ||
    firstUrlFromArray(resultData?.data?.audios) ||
    firstUrlFromArray(resultData?.files) ||
    firstUrlFromArray(resultData?.data?.files) ||
    null
  );
}

function normalizeDurationSeconds(payload = {}) {
  const duration = Number(payload?.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return duration;
  }

  const secondsTotal = Number(payload?.secondsTotal ?? payload?.seconds_total);
  if (Number.isFinite(secondsTotal) && secondsTotal > 0) {
    return secondsTotal;
  }

  return undefined;
}

function normalizeTtsProvider(provider) {
  const normalized = normalizeString(provider).toUpperCase();
  if (normalized === 'GOOGLE_TTS') return 'GOOGLE';
  if (normalized === 'ELEVEN' || normalized === 'ELEVENLABS_FAL') return 'ELEVENLABS';
  if (normalized === 'PLAYHT') return 'PLAYAI';
  return normalized || 'OPENAI';
}

function buildSpeechInputPayload(payload = {}) {
  const provider = normalizeTtsProvider(payload.ttsProvider || payload.provider || payload.model);
  const text = normalizeString(payload.prompt) || ' ';

  return removeEmptyValues({
    text,
    input: text,
    prompt: text,
    voice: payload.speaker,
    speaker: payload.speaker,
    voice_id: payload.speakerVoiceId,
    speaker_voice_id: payload.speakerVoiceId,
    voice_name: payload.speakerCharacterName || payload.speakerLabel,
    speaker_character_name: payload.speakerCharacterName,
    provider,
    tts_provider: provider,
    ttsProvider: provider,
    model: provider,
    language_code: payload.languageCode,
    languageCode: payload.languageCode,
    language_codes: payload.languageCodes,
    languageCodes: payload.languageCodes,
    speaker_details: payload.speakerDetails,
    speakerDetails: payload.speakerDetails,
    instructions: payload.instructions,
    generation_meta: payload.generationMeta,
    generationMeta: payload.generationMeta,
    end_user_id: payload.userId,
  });
}

function buildSoundEffectInputPayload(payload = {}) {
  const model = normalizeString(payload.model || payload.soundEffectModel) || 'SDAUDIO';
  const duration = normalizeDurationSeconds(payload) || Number(payload.secondsTotal) || undefined;

  return removeEmptyValues({
    prompt: normalizeString(payload.prompt) || 'Create a short cinematic sound effect.',
    model,
    sound_effect_model: model,
    soundEffectModel: model,
    duration,
    duration_seconds: duration,
    durationSeconds: duration,
    seconds_total: duration,
    secondsTotal: duration,
    generation_meta: payload.generationMeta,
    generationMeta: payload.generationMeta,
    metadata: payload.generationMeta,
    end_user_id: payload.userId,
  });
}

async function submitExternalAudio(routePath, inputPayload) {
  const response = await axios.post(
    buildExternalAudioUrl(routePath),
    { input: inputPayload },
    {
      headers: buildExternalAudioHeaders(),
      timeout: Number(process.env.SAMSAR_EXTERNAL_AUDIO_TIMEOUT_MS) || DEFAULT_EXTERNAL_AUDIO_TIMEOUT_MS,
    }
  );

  const requestId = getRequestId(response.data);
  if (!requestId) {
    throw new Error(`Samsar external audio ${routePath} response did not include request_id.`);
  }

  return {
    requestId,
    responseData: response.data,
  };
}

async function getExternalAudioStatus(requestId) {
  const response = await axios.get(
    buildExternalAudioUrl('status'),
    {
      headers: buildExternalAudioHeaders(),
      params: { request_id: requestId },
      timeout: Number(process.env.SAMSAR_EXTERNAL_AUDIO_TIMEOUT_MS) || DEFAULT_EXTERNAL_AUDIO_TIMEOUT_MS,
    }
  );

  return response.data;
}

export async function retryOrFailAudioGeneration(payload, errorMessage) {
  const currentRetries = Number.isFinite(Number(payload?.numRetries))
    ? Number(payload.numRetries)
    : 0;

  if (currentRetries < 3) {
    const retryUpdate = {
      numRetries: currentRetries + 1,
      status: 'INIT',
      generationId: null,
      apiRequestId: null,
      genblazeRequestId: null,
      genblazeModel: null,
      audioAdapterProvider: null,
      externalProvider: null,
      externalAudioError: errorMessage || null,
      rowLocked: false,
    };

    if (payload.generationType === 'music') {
      retryUpdate.musicGenerationStatus = 'INIT';
    }

    await AudioGeneration.findByIdAndUpdate(payload._id, retryUpdate);

    if (payload.sessionId && payload.audioLayerId) {
      await VideoSession.findOneAndUpdate(
        { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
        {
          $set: {
            'audioLayers.$.generationStatus': 'INIT',
            'audioLayers.$.generationError': null,
            'audioLayers.$.errorMessage': null,
          },
        }
      );
    }
    return;
  }

  await markAudioGenerationAsFailed(payload._id, errorMessage || 'Samsar external audio generation failed.');
  await AudioGeneration.findByIdAndDelete(payload._id);
}

async function getDurationSeconds(filePath) {
  const { format } = await probe(filePath, AUDIO_FFPROBE_THREAD_OPTIONS);
  return format.duration;
}

export async function finalizeExternalSpeechGeneration(payload, remoteAudioUrl) {
  const { sessionId, audioLayerId, _id } = payload;
  const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'speech.mp3');
  const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
  const audioSaveFilePath = getProcessorAssetsV2Path(audioFileBase);
  const audioFileFolder = path.dirname(audioSaveFilePath);

  if (!fs.existsSync(audioFileFolder)) {
    fs.mkdirSync(audioFileFolder, { recursive: true });
  }

  const audioResponse = await axios.get(remoteAudioUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });
  await fs.promises.writeFile(audioSaveFilePath, Buffer.from(audioResponse.data));

  const remoteFilePath = await uploadAudioAssetToCDN(audioSaveFilePath, audioAssetPath);
  const duration = Math.ceil(await getDurationSeconds(audioSaveFilePath));
  const remoteAudioData = [
    {
      audio_url: remoteFilePath,
      title: 'Speech',
    },
  ];

  if (await finalizeStandaloneExternalAudioGeneration({
    payload,
    resultUrl: remoteFilePath,
    resultUrls: [remoteFilePath],
    duration,
    localAudioPath: audioAssetPath,
    remoteAudioData,
    title: 'Speech',
  })) {
    return;
  }

  let videoSession = await VideoSession.findById(sessionId);
  if (!videoSession) {
    await AudioGeneration.deleteOne({ _id });
    return;
  }

  const isExpressGeneration = videoSession.isExpressGeneration;
  const audioLayer = videoSession.audioLayers.find(
    (layer) => layer._id.toString() === audioLayerId
  );

  if (audioLayer) {
    const timingUpdate = resolveSpeechLayerTimingUpdate({ videoSession, audioLayer, duration });

    await VideoSession.findOneAndUpdate(
      { _id: sessionId, 'audioLayers._id': audioLayerId },
      {
        $set: {
          'audioLayers.$.localAudioLinks': [audioAssetPath],
          'audioLayers.$.remoteAudioData': remoteAudioData,
          ...timingUpdate.set,
          'audioLayers.$.remoteAudioLinks': [remoteFilePath],
          'audioLayers.$.generationStatus': 'COMPLETED',
          'audioLayers.$.generationError': null,
          'audioLayers.$.errorMessage': null,
          ...(audioLayer.defaultSelected && {
            'audioLayers.$.selectedLocalAudioLink': audioAssetPath,
            'audioLayers.$.selectedRemoteAudioLink': remoteFilePath,
          }),
        },
        ...(Object.keys(timingUpdate.unset).length > 0 ? { $unset: timingUpdate.unset } : {}),
      },
      { new: true }
    );
  }

  const latestSessionData = await VideoSession.findOne({ _id: sessionId });
  const allAudioCompleted = latestSessionData.audioLayers.every(
    (layer) => layer.generationStatus === 'COMPLETED'
  );
  const audioGenerationPending = !allAudioCompleted;
  const speechGenerationPending = latestSessionData.audioLayers.some(
    (layer) => layer.generationType === 'speech' && layer.generationStatus !== 'COMPLETED'
  );

  if (!speechGenerationPending && isExpressGeneration) {
    videoSession = await VideoSession.findOne({ _id: sessionId });

    if (videoSession.setAutoDurationPerScene) {
      const effectiveAudioLayers = videoSession.audioLayers.filter(
        (layer) => layer.generationType === 'speech'
      );
      let durationOffset = 0;
      const layerUpdates = {};
      const audioLayerUpdates = {};

      for (let i = 0; i < effectiveAudioLayers.length; i += 1) {
        const audioDuration = effectiveAudioLayers[i].duration;
        let layerDuration = audioDuration + 1;
        if (i === effectiveAudioLayers.length - 1) {
          layerDuration = audioDuration + 2;
        }

        const durationDiff = layerDuration - audioDuration;
        const audioDurationOffset = durationDiff > 0 ? durationDiff / 2 : 0;
        const newAudioStartTime = durationOffset + audioDurationOffset;
        layerUpdates[`layers.${i}.duration`] = layerDuration;
        layerUpdates[`layers.${i}.durationOffset`] = durationOffset;
        audioLayerUpdates[`audioLayers.${i}.startTime`] = newAudioStartTime;
        audioLayerUpdates[`audioLayers.${i}.endTime`] = newAudioStartTime + audioDuration;
        audioLayerUpdates[`audioLayers.${i}.connectedLayerStartTimeOffset`] = audioDurationOffset;
        durationOffset += layerDuration;
      }

      await VideoSession.updateOne(
        { _id: sessionId },
        { $set: { ...layerUpdates, ...audioLayerUpdates } }
      );
    }
  }

  if (!audioGenerationPending) {
    await VideoSession.findOneAndUpdate(
      { _id: sessionId },
      { $set: { audioGenerationPending } },
      { new: true }
    );
  }

  await AudioGeneration.deleteOne({ _id });
}

async function finalizeExternalSoundEffectGeneration(payload, remoteAudioUrl) {
  const { sessionId, audioLayerId, _id } = payload;
  const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'sound.mp3');
  const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
  const audioSaveFilePath = getProcessorAssetsV2Path(audioFileBase);
  const audioFileFolder = path.dirname(audioSaveFilePath);

  if (!fs.existsSync(audioFileFolder)) {
    fs.mkdirSync(audioFileFolder, { recursive: true });
  }

  const audioResponse = await axios.get(remoteAudioUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });
  await fs.promises.writeFile(audioSaveFilePath, Buffer.from(audioResponse.data));
  const remoteFilePath = await uploadAudioAssetToCDN(audioSaveFilePath, audioAssetPath);

  if (await finalizeStandaloneExternalAudioGeneration({
    payload,
    resultUrl: remoteFilePath,
    resultUrls: [remoteFilePath],
    localAudioPath: audioAssetPath,
    remoteAudioData: [{ audio_url: remoteFilePath, title: 'Sound Effect' }],
    title: 'Sound Effect',
  })) {
    return;
  }

  await VideoSession.findOneAndUpdate(
    { _id: sessionId, 'audioLayers._id': audioLayerId },
    {
      $set: {
        'audioLayers.$.localAudioLinks': [audioAssetPath],
        'audioLayers.$.remoteAudioLinks': [remoteFilePath],
        'audioLayers.$.remoteAudioData': [{ audio_url: remoteFilePath, title: 'Sound Effect' }],
        'audioLayers.$.generationStatus': 'COMPLETED',
        'audioLayers.$.generationError': null,
        'audioLayers.$.errorMessage': null,
        'audioLayers.$.streamDownloadPending': false,
      },
    }
  );

  await AudioGeneration.findByIdAndDelete(_id);
}

export async function processSamsarExternalSpeechRequest(payload) {
  try {
    await getDBConnectionString();

    if (payload.status === 'INIT') {
      const inputPayload = buildSpeechInputPayload(payload);
      const { requestId } = await submitExternalAudio(EXTERNAL_AUDIO_ROUTE_TEXT_TO_SPEECH, inputPayload);

      await AudioGeneration.findByIdAndUpdate(payload._id, {
        apiRequestId: requestId,
        generationId: requestId,
        externalAudioRoute: EXTERNAL_AUDIO_ROUTE_TEXT_TO_SPEECH,
        status: 'PENDING',
        rowLocked: false,
      });

      await VideoSession.findOneAndUpdate(
        { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
        { $set: { 'audioLayers.$.generationStatus': 'PENDING' } }
      );

      await recordProviderUsageLog({
        payload,
        requestType: EXTERNAL_AUDIO_ROUTE_TEXT_TO_SPEECH,
        callType: EXTERNAL_AUDIO_ROUTE_TEXT_TO_SPEECH,
        provider: 'samsar',
        authorizationProvider: 'samsar',
        model: normalizeTtsProvider(payload.ttsProvider || payload.provider || payload.model),
        providerRequestId: requestId,
        source: 'samsar_external_audio',
        service: 'samsar_audio_generator',
        status: 'requested',
      });
      return;
    }

    if (payload.status === 'PENDING') {
      const requestId = normalizeString(payload.apiRequestId || payload.generationId);
      if (!requestId) {
        throw new Error('Samsar external speech polling called without a request id.');
      }

      const statusData = await getExternalAudioStatus(requestId);
      const responseStatus = normalizeProviderStatus(statusData);
      const remoteAudioUrl = getAudioUrl(statusData);

      if (responseStatus === 'COMPLETED' && remoteAudioUrl) {
        await finalizeExternalSpeechGeneration(payload, remoteAudioUrl);
        return;
      }

      if (responseStatus === 'FAILED') {
        await retryOrFailAudioGeneration(payload, statusData?.error || statusData?.message || 'Samsar external speech generation failed.');
        return;
      }

      await AudioGeneration.findByIdAndUpdate(payload._id, { rowLocked: false });
    }
  } catch (error) {
    console.error('Error in processSamsarExternalSpeechRequest:', error);
    if (payload.status === 'PENDING' && (payload.apiRequestId || payload.generationId)) {
      await AudioGeneration.findByIdAndUpdate(payload._id, {
        rowLocked: false,
        externalAudioError: error?.message || 'Samsar external speech polling failed.',
      });
      return;
    }
    throw createSubmissionOutcomeUnknownError(error, 'Samsar external speech submission');
  }
}

export async function dispatchAndProcessSamsarExternalMusicRequest(payload) {
  try {
    await getDBConnectionString();

    if (payload.status === 'INIT') {
      const inputPayload = buildMusicInputPayload(payload);
      const { requestId } = await submitExternalAudio(EXTERNAL_AUDIO_ROUTE_TEXT_TO_MUSIC, inputPayload);

      await AudioGeneration.findByIdAndUpdate(payload._id, {
        apiRequestId: requestId,
        generationId: requestId,
        externalAudioRoute: EXTERNAL_AUDIO_ROUTE_TEXT_TO_MUSIC,
        status: 'PENDING',
        musicGenerationStatus: 'PENDING',
        rowLocked: false,
      });

      await VideoSession.findOneAndUpdate(
        { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
        { $set: { 'audioLayers.$.generationStatus': 'PENDING' } }
      );

      await recordProviderUsageLog({
        payload,
        requestType: EXTERNAL_AUDIO_ROUTE_TEXT_TO_MUSIC,
        callType: EXTERNAL_AUDIO_ROUTE_TEXT_TO_MUSIC,
        provider: 'samsar',
        authorizationProvider: 'samsar',
        model: payload.model,
        providerRequestId: requestId,
        source: 'samsar_external_audio',
        service: 'samsar_audio_generator',
        status: 'requested',
        metadata: {
          duration: payload.duration,
          isInstrumental: payload.isInstrumental,
        },
      });
      return;
    }

    if (payload.status === 'PENDING') {
      const requestId = normalizeString(payload.apiRequestId || payload.generationId);
      if (!requestId) {
        throw new Error('Samsar external music polling called without a request id.');
      }

      const statusData = await getExternalAudioStatus(requestId);
      const responseStatus = normalizeProviderStatus(statusData);
      const remoteAudioUrl = getAudioUrl(statusData);

      if (responseStatus === 'COMPLETED' && remoteAudioUrl) {
        await finalizeRemoteAudioGeneration({
          sessionId: payload.sessionId,
          audioLayerId: payload.audioLayerId,
          audioGenerationId: payload._id,
          remoteAudioUrl,
        });
        return;
      }

      if (responseStatus === 'FAILED') {
        await retryOrFailAudioGeneration(payload, statusData?.error || statusData?.message || 'Samsar external music generation failed.');
        return;
      }

      await AudioGeneration.findByIdAndUpdate(payload._id, { rowLocked: false });
    }
  } catch (error) {
    console.error('Error in dispatchAndProcessSamsarExternalMusicRequest:', error);
    if (payload.status === 'PENDING' && (payload.apiRequestId || payload.generationId)) {
      await AudioGeneration.findByIdAndUpdate(payload._id, {
        rowLocked: false,
        externalAudioError: error?.message || 'Samsar external music polling failed.',
      });
      return;
    }
    throw createSubmissionOutcomeUnknownError(error, 'Samsar external music submission');
  }
}

export async function processSamsarExternalSoundEffectRequest(payload) {
  try {
    await getDBConnectionString();

    if (payload.status === 'INIT') {
      const inputPayload = buildSoundEffectInputPayload(payload);
      const { requestId } = await submitExternalAudio(EXTERNAL_AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT, inputPayload);

      await AudioGeneration.findByIdAndUpdate(payload._id, {
        apiRequestId: requestId,
        generationId: requestId,
        externalAudioRoute: EXTERNAL_AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT,
        status: 'PENDING',
        rowLocked: false,
      });

      await VideoSession.findOneAndUpdate(
        { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
        { $set: { 'audioLayers.$.generationStatus': 'PENDING' } }
      );

      await recordProviderUsageLog({
        payload,
        requestType: EXTERNAL_AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT,
        callType: EXTERNAL_AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT,
        provider: 'samsar',
        authorizationProvider: 'samsar',
        model: payload.model,
        providerRequestId: requestId,
        source: 'samsar_external_audio',
        service: 'samsar_audio_generator',
        status: 'requested',
        metadata: {
          duration: payload.duration || payload.secondsTotal,
        },
      });
      return;
    }

    if (payload.status === 'PENDING') {
      const requestId = normalizeString(payload.apiRequestId || payload.generationId);
      if (!requestId) {
        throw new Error('Samsar external sound effect polling called without a request id.');
      }

      const statusData = await getExternalAudioStatus(requestId);
      const responseStatus = normalizeProviderStatus(statusData);
      const remoteAudioUrl = getAudioUrl(statusData);

      if (responseStatus === 'COMPLETED' && remoteAudioUrl) {
        await finalizeExternalSoundEffectGeneration(payload, remoteAudioUrl);
        return;
      }

      if (responseStatus === 'FAILED') {
        await retryOrFailAudioGeneration(payload, statusData?.error || statusData?.message || 'Samsar external sound effect generation failed.');
        return;
      }

      await AudioGeneration.findByIdAndUpdate(payload._id, { rowLocked: false });
    }
  } catch (error) {
    console.error('Error in processSamsarExternalSoundEffectRequest:', error);
    if (payload.status === 'PENDING' && (payload.apiRequestId || payload.generationId)) {
      await AudioGeneration.findByIdAndUpdate(payload._id, {
        rowLocked: false,
        externalAudioError: error?.message || 'Samsar external sound-effect polling failed.',
      });
      return;
    }
    throw createSubmissionOutcomeUnknownError(error, 'Samsar external sound-effect submission');
  }
}
