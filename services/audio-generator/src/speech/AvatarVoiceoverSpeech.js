import fs from 'fs';
import path from 'path';
import axios from 'axios';
import OpenAI from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { fal } from '@fal-ai/client';

import { getDBConnectionString } from '../DBString.js';
import AudioGeneration from '../schema/AudioGeneration.js';
import AvatarVoiceoverTask from '../schema/AvatarVoiceoverTask.js';
import { CUSTOM_AUDIO_ADAPTER_TYPES, listenToPendingCustomAudioRequest, submitCustomAudioRequest } from '../custom/CustomFalCompatibleAudio.js';
import { SPEAKERS as ELEVENLABS_SPEAKERS } from './ElevenLabsSpeakers.js';
import { resolveGoogleTTSLanguageCode, synthesizeGoogleSpeech } from './GoogleTTS.js';
import { uploadAudioAssetToCDN } from '../AWS.js';

ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobeStatic?.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

fal.config({ credentials: process.env.FAL_API_KEY });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const AVATAR_SPEECH_POLL_INTERVAL_MS = 2000;
const AVATAR_SPEECH_PROVIDER_TIMEOUT_MS = 8 * 60 * 1000;
const MIN_SILENCE_SECONDS = 0.03;
const DEFAULT_ELEVENLABS_VOICE_NAME = 'Callum';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProvider(value = '', speaker = '') {
  const normalized = normalizeString(value).toUpperCase();
  if (normalized === 'ELEVENLABS' || normalized === 'ELEVENLABS_FAL' || normalized === 'ELEVEN') {
    return 'ELEVENLABS';
  }
  if (normalized === 'PLAYAI' || normalized === 'PLAYHT') {
    return 'PLAYAI';
  }
  if (normalized === 'GOOGLE' || normalized === 'GOOGLE_TTS') {
    return 'GOOGLE';
  }
  if (normalized === 'CUSTOM_TEXT_TO_SPEECH' || normalized === 'CUSTOMTTS') {
    return 'CUSTOM_TEXT_TO_SPEECH';
  }
  if (normalizeString(speaker).startsWith('s3://')) {
    return 'PLAYAI';
  }
  return 'OPENAI';
}

function getAssetsBasePath() {
  if (process.env.SAMSAR_ASSETS_V2_ROOT) {
    return process.env.SAMSAR_ASSETS_V2_ROOT;
  }

  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    return '/assets_v2';
  }
  return path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2');
}

function toAssetRelativePath(filePath) {
  const relativePath = path.relative(getAssetsBasePath(), filePath);
  if (!relativePath || relativePath.startsWith('..')) {
    return filePath.replace(/\\/g, '/');
  }
  return path.posix.join('assets_v2', relativePath.replace(/\\/g, '/').replace(/^\/+/, ''));
}

function buildRemoteAssetUrl(assetPath = '') {
  const normalizedAssetPath = normalizeString(assetPath)
    .replace(/^https?:\/\/[^/]+\/?/i, '')
    .replace(/^\/?assets_v2\//, 'assets_v2/')
    .replace(/^\/?assets\//, '')
    .replace(/^\/+/, '');
  if (!normalizedAssetPath) {
    return '';
  }

  const apiServer = normalizeString(process.env.API_SERVER).replace(/\/+$/, '');
  return apiServer ? `${apiServer}/${normalizedAssetPath}` : `/${normalizedAssetPath}`;
}

function normalizeHintSeconds(value, fallback = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.max(0, Math.round(numberValue * 100) / 100);
}

function roundSegmentSeconds(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  return Math.max(0, Math.round(numberValue * 1000) / 1000);
}

function normalizeHints(hints = []) {
  return (Array.isArray(hints) ? hints : [])
    .map((hint, index) => {
      const text = normalizeString(hint?.text || hint?.content);
      if (!text) {
        return null;
      }

      const startTime = normalizeHintSeconds(hint?.startTime ?? hint?.start, 0);
      const duration = normalizeHintSeconds(hint?.duration, 1);
      const endCandidate = normalizeHintSeconds(hint?.endTime ?? hint?.end, startTime + duration);
      const endTime = endCandidate > startTime ? endCandidate : startTime + Math.max(duration, 1);
      return {
        id: normalizeString(hint?.id || hint?._id) || `hint_${index}`,
        text,
        speaker: normalizeString(hint?.speaker),
        startTime,
        endTime,
        duration: Math.max(0.03, Math.round((endTime - startTime) * 100) / 100),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startTime - right.startTime);
}

async function probeAudioDurationSeconds(audioPath) {
  const metadata = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });

  const formatDuration = Number(metadata?.format?.duration);
  if (Number.isFinite(formatDuration) && formatDuration > 0) {
    return formatDuration;
  }

  const audioStream = Array.isArray(metadata?.streams)
    ? metadata.streams.find((stream) => stream?.codec_type === 'audio')
    : null;
  const streamDuration = Number(audioStream?.duration);
  if (Number.isFinite(streamDuration) && streamDuration > 0) {
    return streamDuration;
  }

  throw new Error(`Unable to determine audio duration for ${audioPath}`);
}

async function createSilenceSegment(outputPath, durationSeconds) {
  const safeDuration = Number(durationSeconds);
  if (!Number.isFinite(safeDuration) || safeDuration < MIN_SILENCE_SECONDS) {
    return null;
  }

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input('anullsrc=channel_layout=mono:sample_rate=44100')
      .inputFormat('lavfi')
      .outputOptions([
        '-t', safeDuration.toFixed(3),
        '-c:a', 'libmp3lame',
        '-ar', '44100',
        '-ac', '1',
        '-q:a', '4',
      ])
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });

  return outputPath;
}

async function normalizeAudioFile(inputPath, outputPath) {
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(44100)
      .audioCodec('libmp3lame')
      .outputOptions(['-q:a', '4'])
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });

  return outputPath;
}

async function downloadAudioFile(audioUrl, outputPath) {
  const response = await axios.get(audioUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
  });
  await fs.promises.writeFile(outputPath, Buffer.from(response.data));
  return outputPath;
}

async function waitForFalAudioResult(falLink, requestId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < AVATAR_SPEECH_PROVIDER_TIMEOUT_MS) {
    const status = await fal.queue.status(falLink, {
      requestId,
      logs: true,
    });

    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(falLink, { requestId });
      const audioUrl = result?.data?.audio?.url || result?.data?.audio_file?.url;
      if (!audioUrl) {
        throw new Error('Speech provider result did not include an audio URL.');
      }
      return audioUrl;
    }

    if (status.status === 'FAILED') {
      throw new Error('Speech provider returned FAILED status.');
    }

    await wait(AVATAR_SPEECH_POLL_INTERVAL_MS);
  }

  throw new Error('Speech provider timed out.');
}

async function generateOpenAISpeechFile({ text, speaker, outputPath, instructions }) {
  const requestPayload = {
    model: 'gpt-4o-mini-tts',
    voice: normalizeString(speaker) || 'alloy',
    input: text,
  };
  if (normalizeString(instructions)) {
    requestPayload.instructions = normalizeString(instructions);
  }

  const mp3 = await openai.audio.speech.create(requestPayload);
  await fs.promises.writeFile(outputPath, Buffer.from(await mp3.arrayBuffer()));
  return outputPath;
}

function resolveElevenLabsSpeaker(payload = {}, speaker = '') {
  const speakerCandidates = [
    payload.speakerVoiceId,
    speaker,
    payload.speaker,
    payload.speakerName,
    payload.speakerCharacterName,
  ].map(normalizeString).filter(Boolean);

  return ELEVENLABS_SPEAKERS.find((candidate) => (
    speakerCandidates.includes(candidate.value)
    || speakerCandidates.includes(candidate.voiceId)
    || speakerCandidates.includes(candidate.name)
    || speakerCandidates.includes(candidate.label)
  )) || ELEVENLABS_SPEAKERS.find((candidate) => candidate.name === DEFAULT_ELEVENLABS_VOICE_NAME);
}

async function generateElevenLabsSpeechFile({ text, speaker, outputPath, payload }) {
  const falLink = 'fal-ai/elevenlabs/tts/eleven-v3';
  const normalizedSpeaker = normalizeString(payload?.speakerVoiceId || speaker || payload?.speaker);
  const speakerData = ELEVENLABS_SPEAKERS.find((candidate) => (
    candidate.value === normalizedSpeaker
    || candidate.voiceId === normalizedSpeaker
    || candidate.name === normalizedSpeaker
    || candidate.label === normalizedSpeaker
  )) || resolveElevenLabsSpeaker(payload, speaker);
  if (!speakerData) {
    throw new Error(`Unknown ElevenLabs speaker: ${normalizedSpeaker || 'empty'}.`);
  }

  const response = await fal.queue.submit(falLink, {
    input: {
      text,
      voice: speakerData.name || speakerData.label,
    },
  });

  const audioUrl = await waitForFalAudioResult(falLink, response.request_id);
  return downloadAudioFile(audioUrl, outputPath);
}

async function generatePlayAISpeechFile({ text, speaker, outputPath }) {
  const falLink = 'fal-ai/playai/tts/v3';
  const response = await fal.queue.submit(falLink, {
    input: {
      input: text,
      voice: speaker,
    },
  });

  const audioUrl = await waitForFalAudioResult(falLink, response.request_id);
  return downloadAudioFile(audioUrl, outputPath);
}

async function generateGoogleSpeechFile({ text, speaker, outputPath, payload }) {
  const googleSpeaker = normalizeString(speaker)
    || normalizeString(payload?.speakerVoiceId)
    || normalizeString(payload?.voiceId)
    || normalizeString(payload?.name);
  const audioBuffer = await synthesizeGoogleSpeech({
    prompt: text,
    speaker: googleSpeaker,
    languageCode: resolveGoogleTTSLanguageCode({
      ...payload,
      speaker: googleSpeaker,
    }),
    speakingRate: payload?.speakingRate,
    pitch: payload?.pitch,
    volume: payload?.googleTTSInputVolume
      ?? payload?.googleTtsInputVolume
      ?? payload?.ttsInputVolume
      ?? payload?.ttsVolume
      ?? 100,
    volumeGainDb: payload?.volumeGainDb
      ?? payload?.volume_gain_db
      ?? payload?.googleTTSVolumeGainDb
      ?? payload?.googleTtsVolumeGainDb
      ?? payload?.google_tts_volume_gain_db,
  });
  await fs.promises.writeFile(outputPath, audioBuffer);
  return outputPath;
}

async function generateCustomSpeechFile({ text, outputPath, payload }) {
  const requestPayload = {
    ...payload,
    prompt: text,
  };
  const requestId = await submitCustomAudioRequest(
    requestPayload,
    CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_SPEECH
  );
  const startedAt = Date.now();
  while (Date.now() - startedAt < AVATAR_SPEECH_PROVIDER_TIMEOUT_MS) {
    const responseData = await listenToPendingCustomAudioRequest(
      {
        ...requestPayload,
        apiRequestId: requestId,
        generationId: requestId,
      },
      CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_SPEECH
    );

    if (responseData?.responseStatus === 'COMPLETED' && responseData.remoteUrl) {
      return downloadAudioFile(responseData.remoteUrl, outputPath);
    }
    if (responseData?.responseStatus === 'FAILED') {
      throw new Error(responseData.error || 'Custom text-to-speech generation failed.');
    }
    await wait(AVATAR_SPEECH_POLL_INTERVAL_MS);
  }

  throw new Error('Custom text-to-speech generation timed out.');
}

async function generateSpeechFileForHint({
  provider,
  hint,
  index,
  outputFolder,
  payload,
}) {
  const rawOutputPath = path.join(outputFolder, `hint_${index}_raw.mp3`);
  const normalizedOutputPath = path.join(outputFolder, `hint_${index}.mp3`);
  const speechPayload = {
    text: hint.text,
    speaker: payload.speaker,
    outputPath: rawOutputPath,
    instructions: payload.instructions,
    languageCode: payload.languageCode || payload.language,
    payload,
  };

  if (provider === 'ELEVENLABS') {
    await generateElevenLabsSpeechFile(speechPayload);
  } else if (provider === 'PLAYAI') {
    await generatePlayAISpeechFile(speechPayload);
  } else if (provider === 'GOOGLE') {
    await generateGoogleSpeechFile(speechPayload);
  } else if (provider === 'CUSTOM_TEXT_TO_SPEECH') {
    await generateCustomSpeechFile(speechPayload);
  } else {
    await generateOpenAISpeechFile(speechPayload);
  }

  await normalizeAudioFile(rawOutputPath, normalizedOutputPath);
  return normalizedOutputPath;
}

function escapeConcatFilePath(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

async function concatenateSegments(segmentPaths, outputPath, listPath) {
  if (segmentPaths.length === 1) {
    await normalizeAudioFile(segmentPaths[0], outputPath);
    return outputPath;
  }

  const listText = segmentPaths
    .map((segmentPath) => `file '${escapeConcatFilePath(segmentPath)}'`)
    .join('\n');
  await fs.promises.writeFile(listPath, `${listText}\n`, 'utf8');

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .audioCodec('libmp3lame')
      .audioChannels(1)
      .audioFrequency(44100)
      .outputOptions(['-q:a', '4'])
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });

  return outputPath;
}

async function createContinuousSpeechFromHints({
  hints,
  outputFolder,
  payload,
}) {
  await fs.promises.mkdir(outputFolder, { recursive: true });
  const tempFolder = path.join(outputFolder, 'segments');
  await fs.promises.rm(tempFolder, { recursive: true, force: true });
  await fs.promises.mkdir(tempFolder, { recursive: true });

  const provider = normalizeProvider(payload.ttsProvider || payload.provider, payload.speaker);
  const segmentPaths = [];
  const segmentMetadata = [];
  const timelineSegments = [];
  let currentTime = 0;

  const appendSilenceSegment = async ({
    duration,
    fileName,
    reason,
    afterHint = null,
    beforeHint = null,
  }) => {
    const silenceDuration = Math.max(0, Number(duration) || 0);
    if (silenceDuration < MIN_SILENCE_SECONDS) {
      return 0;
    }

    const silencePath = path.join(tempFolder, fileName);
    const segmentStartTime = currentTime;
    await createSilenceSegment(silencePath, silenceDuration);
    segmentPaths.push(silencePath);
    currentTime += silenceDuration;
    timelineSegments.push({
      type: 'blank',
      reason,
      fileName: path.basename(silencePath),
      startTime: roundSegmentSeconds(segmentStartTime),
      endTime: roundSegmentSeconds(currentTime),
      duration: roundSegmentSeconds(silenceDuration),
      afterHintId: afterHint?.id || '',
      beforeHintId: beforeHint?.id || '',
    });

    return silenceDuration;
  };

  for (let index = 0; index < hints.length; index += 1) {
    const hint = hints[index];
    const nextHint = hints[index + 1] || null;
    const startTime = Math.max(0, Number(hint.startTime) || 0);
    const endTime = Math.max(startTime + 0.03, Number(hint.endTime) || startTime + Number(hint.duration) || startTime + 1);
    const targetDuration = Math.max(0.03, endTime - startTime);

    const leadingSilenceDuration = await appendSilenceSegment({
      duration: startTime - currentTime,
      fileName: `silence_before_${index}.mp3`,
      reason: index === 0 ? 'initial_buffer' : 'align_to_hint_start',
      beforeHint: hint,
    });

    const actualStartTime = currentTime;
    const speechPath = await generateSpeechFileForHint({
      provider,
      hint,
      index,
      outputFolder: tempFolder,
      payload,
    });
    const speechDuration = await probeAudioDurationSeconds(speechPath);
    segmentPaths.push(speechPath);
    currentTime += speechDuration;
    timelineSegments.push({
      type: 'speech',
      hintId: hint.id,
      text: hint.text,
      fileName: path.basename(speechPath),
      requestedStartTime: roundSegmentSeconds(startTime),
      requestedEndTime: roundSegmentSeconds(endTime),
      startTime: roundSegmentSeconds(actualStartTime),
      endTime: roundSegmentSeconds(currentTime),
      duration: roundSegmentSeconds(speechDuration),
    });

    const nextSpeechStartTime = nextHint
      ? Math.max(0, Number(nextHint.startTime) || 0)
      : endTime;
    const blankAfterDuration = await appendSilenceSegment({
      duration: nextSpeechStartTime - currentTime,
      fileName: `silence_after_${index}.mp3`,
      reason: nextHint ? 'between_speech_items' : 'after_last_hint',
      afterHint: hint,
      beforeHint: nextHint,
    });

    segmentMetadata.push({
      id: hint.id,
      text: hint.text,
      requestedStartTime: roundSegmentSeconds(startTime),
      requestedEndTime: roundSegmentSeconds(endTime),
      requestedDuration: roundSegmentSeconds(targetDuration),
      actualStartTime: roundSegmentSeconds(actualStartTime),
      speechDuration: roundSegmentSeconds(speechDuration),
      speechEndTime: roundSegmentSeconds(actualStartTime + speechDuration),
      actualEndTime: roundSegmentSeconds(currentTime),
      leadingSilenceDuration: roundSegmentSeconds(leadingSilenceDuration),
      trailingSilenceDuration: nextHint ? 0 : roundSegmentSeconds(blankAfterDuration),
      interHintSilenceDuration: nextHint ? roundSegmentSeconds(blankAfterDuration) : 0,
      blankAfterDuration: roundSegmentSeconds(blankAfterDuration),
    });
  }

  if (segmentPaths.length === 0) {
    throw new Error('No speech segments were generated.');
  }

  const outputPath = path.join(outputFolder, `avatar_voiceover_speech_${Date.now()}.mp3`);
  const listPath = path.join(tempFolder, 'concat.txt');
  await concatenateSegments(segmentPaths, outputPath, listPath);
  const outputDuration = await probeAudioDurationSeconds(outputPath);

  return {
    outputPath,
    duration: outputDuration,
    segments: segmentMetadata,
    timelineSegments,
  };
}

export async function processAvatarVoiceoverSpeechRequest(payload) {
  await getDBConnectionString();
  const audioGenerationId = payload?._id?.toString?.() || normalizeString(payload?._id);
  const taskId = normalizeString(payload?.avatarVoiceoverTaskId);

  if (!audioGenerationId || !taskId) {
    return;
  }

  const audioGeneration = await AudioGeneration.findById(audioGenerationId);
  const task = await AvatarVoiceoverTask.findById(taskId);
  if (!audioGeneration || !task) {
    await AudioGeneration.deleteOne({ _id: audioGenerationId });
    return;
  }

  try {
    const hints = normalizeHints(payload.hints?.length ? payload.hints : task.hints);
    if (!hints.length) {
      throw new Error('No timeline hints are available for avatar voiceover.');
    }

    const processingUpdate = await AvatarVoiceoverTask.updateOne(
      { _id: taskId, avatarSpeechGenerationId: audioGenerationId },
      {
        $set: {
          status: 'SPEECH_PROCESSING',
          stage: 'AVATAR_SPEECH',
          avatarSpeechStatus: 'PROCESSING',
          avatarSpeechError: '',
          errorMessage: '',
        },
      }
    );
    if (processingUpdate.matchedCount === 0) {
      await AudioGeneration.deleteOne({ _id: audioGenerationId });
      return;
    }

    const outputFolder = path.join(
      getAssetsBasePath(),
      'avatar_voiceover',
      'speech',
      task.sessionId.toString(),
      task._id.toString()
    );
    const result = await createContinuousSpeechFromHints({
      hints,
      outputFolder,
      payload: {
        ...payload,
        ttsProvider: payload.ttsProvider || payload.provider,
        provider: payload.provider || payload.ttsProvider,
      },
    });
    const assetPath = `/${toAssetRelativePath(result.outputPath)}`;
    const audioUrl = await uploadAudioAssetToCDN(result.outputPath, assetPath);

    const completedUpdate = await AvatarVoiceoverTask.updateOne(
      { _id: taskId, avatarSpeechGenerationId: audioGenerationId },
      {
        $set: {
          status: 'SPEECH_READY',
          stage: 'AVATAR_SPEECH_READY',
          avatarSpeechStatus: 'COMPLETED',
          avatarSpeechAudioAssetPath: assetPath,
          avatarSpeechAudioUrl: audioUrl,
          avatarSpeechDuration: result.duration,
          avatarSpeechError: '',
          speechProvider: normalizeProvider(payload.ttsProvider || payload.provider, payload.speaker),
          speechSpeaker: payload.speaker,
          speechSpeakerName: payload.speakerCharacterName || payload.speakerName || '',
          speechSegments: result.segments,
          speechTimelineSegments: result.timelineSegments,
          errorMessage: '',
        },
      }
    );
    if (completedUpdate.matchedCount === 0) {
      await AudioGeneration.deleteOne({ _id: audioGenerationId });
      return;
    }

    await AudioGeneration.deleteOne({ _id: audioGenerationId });
  } catch (error) {
    const message = error?.message || 'Unable to generate avatar speech from hints.';
    await AvatarVoiceoverTask.updateOne(
      { _id: taskId, avatarSpeechGenerationId: audioGenerationId },
      {
        $set: {
          status: 'FAILED',
          stage: 'AVATAR_SPEECH',
          avatarSpeechStatus: 'FAILED',
          avatarSpeechError: message,
          errorMessage: message,
        },
      }
    );
    await AudioGeneration.deleteOne({ _id: audioGenerationId });
  }
}
