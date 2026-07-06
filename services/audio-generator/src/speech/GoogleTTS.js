import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';

import { getGoogleAccessToken } from '../inference/GoogleADC.js';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AudioGeneration from '../schema/AudioGeneration.js';
import { resolveSpeechLayerTimingUpdate } from './SpeechLayerTiming.js';
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from '../utils/AssetPaths.js';
import { uploadAudioAssetToCDN } from '../AWS.js';

ffmpeg.setFfprobePath('/usr/bin/ffprobe');

const probe = promisify(ffmpeg.ffprobe);
const GOOGLE_TTS_API_BASE_URL =
  process.env.GOOGLE_TTS_API_BASE_URL || 'https://texttospeech.googleapis.com/v1';
const DEFAULT_GOOGLE_TTS_LANGUAGE_CODE = process.env.GOOGLE_TTS_DEFAULT_LANGUAGE_CODE || 'en-US';
const DEFAULT_GOOGLE_TTS_INPUT_VOLUME = 100;
const DEFAULT_GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB = 6;
const GOOGLE_TTS_MIN_VOLUME_GAIN_DB = -96;
const GOOGLE_TTS_MAX_VOLUME_GAIN_DB = 16;

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function removeEmptyKeys(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      return true;
    })
  );
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeGoogleTTSVolumeGainDb(value) {
  const appVolume = Number(value);
  if (!Number.isFinite(appVolume)) {
    return null;
  }

  if (appVolume <= 0) {
    return GOOGLE_TTS_MIN_VOLUME_GAIN_DB;
  }

  const volumeGainDb = 20 * Math.log10(appVolume / DEFAULT_GOOGLE_TTS_INPUT_VOLUME);
  return clampNumber(
    Math.round(volumeGainDb * 1000) / 1000,
    GOOGLE_TTS_MIN_VOLUME_GAIN_DB,
    GOOGLE_TTS_MAX_VOLUME_GAIN_DB
  );
}

function normalizeExplicitGoogleTTSVolumeGainDb(value) {
  const volumeGainDb = Number(value);
  if (!Number.isFinite(volumeGainDb)) {
    return null;
  }

  return clampNumber(volumeGainDb, GOOGLE_TTS_MIN_VOLUME_GAIN_DB, GOOGLE_TTS_MAX_VOLUME_GAIN_DB);
}

export function resolveGoogleTTSInputVolume(payload = {}) {
  return payload.googleTTSInputVolume
    ?? payload.googleTtsInputVolume
    ?? payload.ttsInputVolume
    ?? payload.ttsVolume
    ?? DEFAULT_GOOGLE_TTS_INPUT_VOLUME;
}

function resolveExplicitGoogleTTSVolumeGainDb(payload = {}) {
  return payload.volumeGainDb
    ?? payload.volume_gain_db
    ?? payload.googleTTSVolumeGainDb
    ?? payload.googleTtsVolumeGainDb
    ?? payload.google_tts_volume_gain_db;
}

function hasGoogleTTSInputVolume(payload = {}) {
  return payload.googleTTSInputVolume !== undefined
    || payload.googleTtsInputVolume !== undefined
    || payload.ttsInputVolume !== undefined
    || payload.ttsVolume !== undefined;
}

export function resolveGoogleTTSVolumeGainDb(payload = {}, { isExpressGeneration = false } = {}) {
  const explicitVolumeGainDb = resolveExplicitGoogleTTSVolumeGainDb(payload);
  if (explicitVolumeGainDb !== undefined && explicitVolumeGainDb !== null) {
    return explicitVolumeGainDb;
  }

  if (!isExpressGeneration || hasGoogleTTSInputVolume(payload)) {
    return undefined;
  }

  return process.env.GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB
    ?? DEFAULT_GOOGLE_TTS_EXPRESS_VOLUME_GAIN_DB;
}

async function getDurationSeconds(filePath) {
  const { format } = await probe(filePath);
  return format.duration;
}

function getSpeakerLanguageCode(speaker = '') {
  const normalizedSpeaker = normalizeString(speaker);
  const speakerLanguageMatch = normalizedSpeaker.match(/^[a-z]{2,3}(?:-[A-Z0-9]{2,4})?/);
  return speakerLanguageMatch?.[0] || '';
}

function resolveGoogleTTSSpeaker(payload = {}, speaker = '') {
  return normalizeString(speaker)
    || normalizeString(payload.speakerVoiceId)
    || normalizeString(payload.voiceId)
    || normalizeString(payload.name);
}

export function resolveGoogleTTSLanguageCode(payload = {}) {
  const explicitLanguageCode =
    normalizeString(payload.languageCode) ||
    normalizeString(payload.language_code) ||
    normalizeString(payload.language);
  const speakerLanguageCode = getSpeakerLanguageCode(resolveGoogleTTSSpeaker(payload, payload.speaker));

  if (
    explicitLanguageCode &&
    explicitLanguageCode.toLowerCase() !== 'auto' &&
    explicitLanguageCode.includes('-')
  ) {
    return explicitLanguageCode;
  }

  if (speakerLanguageCode) {
    return speakerLanguageCode;
  }

  if (explicitLanguageCode && explicitLanguageCode.toLowerCase() !== 'auto') {
    return explicitLanguageCode;
  }

  return DEFAULT_GOOGLE_TTS_LANGUAGE_CODE;
}

export async function synthesizeGoogleSpeech({
  prompt,
  speaker,
  languageCode,
  speakingRate,
  pitch,
  volume,
  volumeGainDb,
}) {
  const token = await getGoogleAccessToken();
  const audioConfig = {
    audioEncoding: 'MP3',
  };

  const parsedSpeakingRate = Number(speakingRate);
  if (Number.isFinite(parsedSpeakingRate) && parsedSpeakingRate > 0) {
    audioConfig.speakingRate = parsedSpeakingRate;
  }

  const parsedPitch = Number(pitch);
  if (Number.isFinite(parsedPitch)) {
    audioConfig.pitch = parsedPitch;
  }

  const explicitVolumeGainDb = normalizeExplicitGoogleTTSVolumeGainDb(volumeGainDb);
  const normalizedVolumeGainDb = explicitVolumeGainDb ?? normalizeGoogleTTSVolumeGainDb(volume);
  if (Number.isFinite(normalizedVolumeGainDb)) {
    audioConfig.volumeGainDb = normalizedVolumeGainDb;
  }

  const response = await fetch(`${GOOGLE_TTS_API_BASE_URL}/text:synthesize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text: normalizeString(prompt) || ' ' },
      voice: {
        languageCode,
        name: speaker,
      },
      audioConfig,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google TTS synthesis failed (${response.status}): ${errorBody}`);
  }

  const body = await response.json();
  const audioContent = normalizeString(body.audioContent);
  if (!audioContent) {
    throw new Error('Google TTS response did not include audioContent.');
  }

  return Buffer.from(audioContent, 'base64');
}

export async function processGoogleTTSSpeechRequest(payload) {
  payload = removeEmptyKeys(payload?._doc ? payload._doc : payload);

  try {
    await getDBConnectionString();

    const {
      prompt,
      speaker,
      sessionId,
      audioLayerId,
      defaultSelected,
      _id,
    } = payload;
    const googleSpeaker = resolveGoogleTTSSpeaker(payload, speaker);
    const languageCode = resolveGoogleTTSLanguageCode(payload);

    if (!sessionId || !audioLayerId) {
      throw new Error(
        `Missing sessionId or audioLayerId. sessionId: ${sessionId}, audioLayerId: ${audioLayerId}`
      );
    }

    if (!googleSpeaker) {
      throw new Error('Missing Google TTS speaker/voice name.');
    }

    let videoSession = await VideoSession.findById(sessionId);
    if (!videoSession) {
      throw new Error(`Video session not found for Google TTS request: ${sessionId}`);
    }
    const isExpressGeneration = !!videoSession.isExpressGeneration;

    const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'speech.mp3');
    const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
    const audioSaveFilePath = getProcessorAssetsV2Path(audioFileBase);

    const audioFileFolder = path.dirname(audioSaveFilePath);
    if (!fs.existsSync(audioFileFolder)) {
      fs.mkdirSync(audioFileFolder, { recursive: true });
    }

    const audioBuffer = await synthesizeGoogleSpeech({
      prompt,
      speaker: googleSpeaker,
      languageCode,
      speakingRate: payload.speakingRate,
      pitch: payload.pitch,
      volume: resolveGoogleTTSInputVolume(payload),
      volumeGainDb: resolveGoogleTTSVolumeGainDb(payload, { isExpressGeneration }),
    });

    await fs.promises.writeFile(audioSaveFilePath, audioBuffer);

    const remoteFilePath = await uploadAudioAssetToCDN(audioSaveFilePath, audioAssetPath);
    const remoteAudioData = [
      {
        audio_url: remoteFilePath,
        title: 'Speech',
      },
    ];

    let duration = await getDurationSeconds(audioSaveFilePath);
    duration = Math.ceil(duration);

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
            'audioLayers.$.languageCode': languageCode,
            ...(defaultSelected && {
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

    const allSpeechPending = latestSessionData.audioLayers.find(
      (layer) => layer.generationType === 'speech' && layer.generationStatus !== 'COMPLETED'
    );
    let speechGenerationPending = !!allSpeechPending;

    if (!speechGenerationPending && isExpressGeneration) {
      videoSession = await VideoSession.findOne({ _id: sessionId });

      if (videoSession.setAutoDurationPerScene) {
        const effectiveAudioLayers = videoSession.audioLayers.filter(
          (layer) => layer.generationType === 'speech'
        );

        let durationOffset = 0;
        const layerUpdates = {};
        const audioLayerUpdates = {};

        for (let i = 0; i < effectiveAudioLayers.length; i++) {
          const audioDuration = effectiveAudioLayers[i].duration;
          let layerDuration = effectiveAudioLayers[i].duration + 1;

          if (i === effectiveAudioLayers.length - 1) {
            layerDuration = effectiveAudioLayers[i].duration + 2;
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
    } else {
      const firstSpeechLayer = latestSessionData.audioLayers.find(
        (layer) => layer.generationType === 'speech'
      );

      if (firstSpeechLayer) {
        await VideoSession.findOneAndUpdate(
          { _id: sessionId, 'audioLayers._id': firstSpeechLayer._id },
          {
            $set: {
              'audioLayers.$.startTime': firstSpeechLayer.startTime,
              'audioLayers.$.endTime': firstSpeechLayer.startTime + firstSpeechLayer.duration,
              'audioLayers.$.duration': firstSpeechLayer.duration,
            },
          }
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

    if (_id) {
      await AudioGeneration.deleteOne({ _id });
    }

    return 'Google TTS speech request processed';
  } catch (error) {
    console.error('Error while processing Google TTS speech:', error);

    await VideoSession.findOneAndUpdate(
      { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
      {
        $set: {
          'audioLayers.$.generationStatus': 'FAILED',
          'audioLayers.$.generationError': error?.message || 'Google TTS request failed.',
        },
      },
      { new: true }
    );

    if (payload._id) {
      await AudioGeneration.deleteOne({ _id: payload._id });
    }
  }
}
