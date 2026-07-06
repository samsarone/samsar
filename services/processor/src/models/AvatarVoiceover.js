import '../config/loadEnv.js';
import axios from 'axios';
import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import mongoose from 'mongoose';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { pipeline } from 'stream/promises';

import { getDBConnectionString } from './DBString.js';
import AvatarVoiceoverTask from '../schema/AvatarVoiceoverTask.js';
import AudioGeneration from '../schema/AudioGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';
import GeneratedAIVideo from '../schema/generations/GeneratedAIVideo.js';
import { addImageGeneratorRequest } from './Images.js';
import { getModerationForNarrative } from './moderation/CreateModeration.js';
import {
  getGlobalVideoProcessingStatusForSession,
  uploadGlobalVideoForSession,
} from './VideoSession.js';
import {
  extractAudioFromVideoIfPresent,
  getVideoMetadata,
} from './video/VideoProcessor.js';
import { toAssetRelativePath } from './audio/AudioUtils.js';
import {
  ALL_TTS_SPEAKERS,
  findTTSSpeaker,
  TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH,
  TTS_PROVIDER_ELEVENLABS,
  TTS_PROVIDER_GOOGLE,
  TTS_PROVIDER_OPENAI,
} from '../consts/TTSSpeakers.js';
import { applyAudioLayerManualVolumeDefaults } from '../utils/AudioVolumeAutomation.js';
import { extendSessionTimelineToCustomSpeechEnd } from './video/SessionTimelineExtension.js';
import {
  creditGenerationCredits,
  deductGenerationCredits,
} from './GenerationCredits.js';

const API_SERVER = process.env.API_SERVER;
const RUNWAY_API_BASE_URL = (process.env.RUNWAYML_BASE_URL || 'https://api.dev.runwayml.com').replace(/\/+$/, '');
const RUNWAY_API_VERSION = process.env.RUNWAYML_API_VERSION || '2024-11-06';
const AVATAR_IMAGE_SYSTEM_PROMPT = 'Use high-quality, front-facing photos with good lighting. Ensure the face is clearly visible and centered in frame. Avoid images with multiple people or obstructions. Use a clean black or near-black background, and avoid white or transparent backgrounds.';
const DEFAULT_AVATAR_PERSONALITY = 'You are a concise, professional video narrator. Speak clearly and naturally, following the provided script exactly.';
const RUNWAY_POLL_INTERVAL_MS = 5000;
const RUNWAY_AVATAR_POLL_TIMEOUT_MS = 8 * 60 * 1000;
const RUNWAY_AVATAR_VIDEO_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const AVATAR_VIDEO_MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;
const AVATAR_VIDEO_BILLING_UNIT_SECONDS = 6;
const AVATAR_VIDEO_UPFRONT_CREDITS = 2;
const AVATAR_VIDEO_BASE_CREDITS_PER_UNIT = 2;
const AVATAR_VIDEO_PRICING_MULTIPLIER = 2;
const AVATAR_SPEECH_GENERATION_TYPE = 'avatar_voiceover_speech';
const TTS_PROVIDER_PLAYAI = 'PLAYAI';
const AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH = 'session_speech';
const AVATAR_VIDEO_AUDIO_SOURCE_HINT_SPEECH = 'hint_speech';

export const RUNWAY_AVATAR_VOICE_PRESETS = [
  { presetId: 'victoria', name: 'Victoria' },
  { presetId: 'vincent', name: 'Vincent' },
  { presetId: 'clara', name: 'Clara' },
  { presetId: 'drew', name: 'Drew' },
  { presetId: 'skye', name: 'Skye' },
  { presetId: 'max', name: 'Max' },
  { presetId: 'morgan', name: 'Morgan' },
  { presetId: 'felix', name: 'Felix' },
  { presetId: 'mia', name: 'Mia' },
  { presetId: 'marcus', name: 'Marcus' },
  { presetId: 'summer', name: 'Summer' },
  { presetId: 'ruby', name: 'Ruby' },
  { presetId: 'aurora', name: 'Aurora' },
  { presetId: 'jasper', name: 'Jasper' },
  { presetId: 'leo', name: 'Leo' },
  { presetId: 'adrian', name: 'Adrian' },
  { presetId: 'nina', name: 'Nina' },
  { presetId: 'emma', name: 'Emma' },
  { presetId: 'blake', name: 'Blake' },
  { presetId: 'david', name: 'David' },
  { presetId: 'maya', name: 'Maya' },
  { presetId: 'nathan', name: 'Nathan' },
  { presetId: 'sam', name: 'Sam' },
  { presetId: 'georgia', name: 'Georgia' },
  { presetId: 'petra', name: 'Petra' },
  { presetId: 'adam', name: 'Adam' },
  { presetId: 'zach', name: 'Zach' },
  { presetId: 'violet', name: 'Violet' },
  { presetId: 'roman', name: 'Roman' },
  { presetId: 'luna', name: 'Luna' },
];

const ACTIVE_AVATAR_POLLS = new Set();
const ACTIVE_AVATAR_VIDEO_POLLS = new Set();

export const AVATAR_VOICEOVER_TTS_PROVIDERS = [
  { value: TTS_PROVIDER_OPENAI, label: 'OpenAI' },
  { value: TTS_PROVIDER_ELEVENLABS, label: 'ElevenLabs' },
  { value: TTS_PROVIDER_PLAYAI, label: 'Play.ht' },
  { value: TTS_PROVIDER_GOOGLE, label: 'Google TTS' },
  { value: TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH, label: 'Custom TTS' },
];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function getRunwayApiKey() {
  return normalizeString(process.env.RUNWAYML_API_SECRET)
    || normalizeString(process.env.RUNWAY_API_KEY)
    || normalizeString(process.env.RUNWAYML_API_KEY);
}

function getRunwayHeaders() {
  const apiKey = getRunwayApiKey();
  if (!apiKey) {
    throw new Error(
      'Runway API key is not configured for avatar voiceover generation. Set RUNWAYML_API_SECRET, RUNWAY_API_KEY, or RUNWAYML_API_KEY on this process.'
    );
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Runway-Version': RUNWAY_API_VERSION,
  };
}

async function runwayPost(pathname, body) {
  const response = await axios.post(`${RUNWAY_API_BASE_URL}${pathname}`, body, {
    headers: getRunwayHeaders(),
    timeout: 60000,
  });
  return response.data;
}

async function runwayGet(pathname) {
  const response = await axios.get(`${RUNWAY_API_BASE_URL}${pathname}`, {
    headers: getRunwayHeaders(),
    timeout: 60000,
  });
  return response.data;
}

function getAssetsBasePath() {
  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    return '/assets';
  }
  return path.join(process.cwd(), 'assets');
}

function normalizeAssetPath(assetPath = '') {
  return normalizeString(assetPath)
    .replace(/^https?:\/\/[^/]+\/?/i, '')
    .replace(/^\/?assets\//, '')
    .replace(/^\/+/, '');
}

function resolveAssetAbsolutePath(assetPath = '') {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!normalizedAssetPath) {
    return '';
  }
  if (path.isAbsolute(assetPath) && fs.existsSync(assetPath)) {
    return assetPath;
  }
  return path.join(getAssetsBasePath(), normalizedAssetPath);
}

function buildRemoteAssetUrl(assetPath = '') {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!normalizedAssetPath) {
    return '';
  }

  const apiServer = normalizeString(API_SERVER).replace(/\/+$/, '');
  return apiServer ? `${apiServer}/${normalizedAssetPath}` : `/${normalizedAssetPath}`;
}

function getMimeTypeForAsset(assetPath = '') {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  return 'image/png';
}

async function readImageAsDataUri(assetPath = '') {
  const absolutePath = resolveAssetAbsolutePath(assetPath);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error('Generated avatar image was not found on the processor.');
  }

  const imageBuffer = await fs.promises.readFile(absolutePath);
  if (imageBuffer.length > 10 * 1024 * 1024) {
    throw new Error('Avatar reference image is larger than Runway allows.');
  }

  return `data:${getMimeTypeForAsset(absolutePath)};base64,${imageBuffer.toString('base64')}`;
}

function normalizeVoicePresetId(value = '') {
  const normalized = normalizeString(value).toLowerCase();
  return RUNWAY_AVATAR_VOICE_PRESETS.some((voice) => voice.presetId === normalized)
    ? normalized
    : RUNWAY_AVATAR_VOICE_PRESETS[0].presetId;
}

function getVoicePresetName(presetId = '') {
  return RUNWAY_AVATAR_VOICE_PRESETS.find((voice) => voice.presetId === presetId)?.name || presetId;
}

function normalizeSpeechProvider(provider = '', speaker = '') {
  const normalizedProvider = normalizeString(provider).toUpperCase();
  if (normalizedProvider === TTS_PROVIDER_OPENAI) {
    return TTS_PROVIDER_OPENAI;
  }
  if (
    normalizedProvider === TTS_PROVIDER_ELEVENLABS ||
    normalizedProvider === 'ELEVENLABS_FAL' ||
    normalizedProvider === 'ELEVENLABSFAL' ||
    normalizedProvider === 'ELEVEN'
  ) {
    return TTS_PROVIDER_ELEVENLABS;
  }
  if (normalizedProvider === TTS_PROVIDER_PLAYAI || normalizedProvider === 'PLAYHT') {
    return TTS_PROVIDER_PLAYAI;
  }
  if (normalizedProvider === TTS_PROVIDER_GOOGLE || normalizedProvider === 'GOOGLE_TTS') {
    return TTS_PROVIDER_GOOGLE;
  }
  if (
    normalizedProvider === TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH ||
    normalizedProvider === 'CUSTOMTTS'
  ) {
    return TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH;
  }
  if (findTTSSpeaker(TTS_PROVIDER_ELEVENLABS, speaker)) {
    return TTS_PROVIDER_ELEVENLABS;
  }
  if (findTTSSpeaker(TTS_PROVIDER_OPENAI, speaker)) {
    return TTS_PROVIDER_OPENAI;
  }
  if (normalizeString(speaker).startsWith('s3://')) {
    return TTS_PROVIDER_PLAYAI;
  }
  return TTS_PROVIDER_OPENAI;
}

function getTTSSpeakerName(provider = '', speaker = '') {
  const normalizedProvider = normalizeSpeechProvider(provider, speaker);
  if (normalizedProvider === TTS_PROVIDER_PLAYAI) {
    return normalizeString(speaker);
  }

  const knownSpeaker = ALL_TTS_SPEAKERS.find((speakerOption) => (
    speakerOption.provider === normalizedProvider && speakerOption.value === speaker
  ));
  return knownSpeaker?.label || knownSpeaker?.name || normalizeString(speaker);
}

export function buildAvatarImagePrompt(userPrompt = '') {
  const normalizedPrompt = normalizeString(userPrompt);
  return [
    AVATAR_IMAGE_SYSTEM_PROMPT,
    'Create a single-person avatar reference image suitable for Runway avatar creation.',
    'The image must be landscape 16:9 with a solid black background.',
    'The subject should be framed from the shoulders up, centered in the image, looking at the camera, with a neutral or slight friendly expression.',
    'Keep the composition centered inside the landscape frame. Do not use a white background or transparent background.',
    normalizedPrompt ? `User description: ${normalizedPrompt}` : 'User description: professional presenter avatar.',
  ].join('\n');
}

function serializeAvatarVoiceoverTask(task) {
  if (!task) {
    return null;
  }
  const plainTask = typeof task.toObject === 'function' ? task.toObject() : task;
  const status = normalizeString(plainTask.status).toUpperCase();
  const imageStatus = normalizeString(plainTask.imageStatus).toUpperCase();
  const runwayAvatarStatus = normalizeString(plainTask.runwayAvatarStatus).toUpperCase();
  const avatarSpeechStatus = normalizeString(plainTask.avatarSpeechStatus).toUpperCase();
  const avatarVideoStatus = normalizeString(plainTask.avatarVideoStatus).toUpperCase();
  const taskHasActiveFailure = status === 'FAILED'
    || imageStatus === 'FAILED'
    || runwayAvatarStatus === 'FAILED'
    || avatarSpeechStatus === 'FAILED'
    || avatarVideoStatus === 'FAILED'
    || avatarVideoStatus === 'CANCELLED';
  const responseTask = { ...plainTask };
  if (!taskHasActiveFailure) {
    responseTask.errorMessage = '';
    responseTask.imageError = '';
    responseTask.avatarError = '';
    responseTask.avatarSpeechError = '';
    responseTask.avatarVideoError = '';
  }
  const avatarImageSource = normalizeString(plainTask.avatarImage)
    || normalizeString(plainTask.avatarImageUrl);
  const avatarImageDisplayUrl = normalizeString(plainTask.avatarImageUrl);
  const avatarImageUrl =
    /^(data:|https?:\/\/)/i.test(avatarImageDisplayUrl)
      ? avatarImageDisplayUrl
      : buildRemoteAssetUrl(avatarImageSource || avatarImageDisplayUrl);
  const avatarVideoPreviewUrl = normalizeString(plainTask.avatarVideoUrl)
    || buildRemoteAssetUrl(plainTask.avatarVideoAssetPath);
  const avatarSpeechAudioPreviewUrl = normalizeString(plainTask.avatarSpeechAudioUrl)
    || buildRemoteAssetUrl(plainTask.avatarSpeechAudioAssetPath);
  const avatarVideoSpeechAudioPreviewUrl = normalizeString(plainTask.avatarVideoSpeechAudioUrl)
    || buildRemoteAssetUrl(plainTask.avatarVideoSpeechAudioAssetPath);

  return {
    ...responseTask,
    avatarImage: avatarImageSource,
    avatarImageUrl,
    avatarSpeechAudioPreviewUrl,
    avatarVideoSpeechAudioPreviewUrl,
    avatarVideoPreviewUrl,
    voices: RUNWAY_AVATAR_VOICE_PRESETS,
    ttsProviders: AVATAR_VOICEOVER_TTS_PROVIDERS,
  };
}

async function getOwnedTask(userId, taskId) {
  const normalizedTaskId = normalizeString(taskId);
  if (!normalizedTaskId) {
    throw new Error('taskId is required.');
  }

  const task = await AvatarVoiceoverTask.findOne({ _id: normalizedTaskId, userId });
  if (!task) {
    throw new Error('Avatar voiceover task not found.');
  }
  return task;
}

function normalizeHintSeconds(value, fallback = 0) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.max(0, Math.round(numberValue * 100) / 100);
}

function formatHintTimestamp(seconds = 0) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function normalizeSessionHints(sessionData = {}) {
  const hints = Array.isArray(sessionData.timelineHints)
    ? sessionData.timelineHints
    : Array.isArray(sessionData.hints)
      ? sessionData.hints
      : [];

  return hints
    .map((hint, index) => {
      const text = normalizeString(hint?.text || hint?.content);
      if (!text) {
        return null;
      }
      const startTime = normalizeHintSeconds(hint?.startTime ?? hint?.start, 0);
      const duration = normalizeHintSeconds(hint?.duration, 1);
      const endTimeCandidate = normalizeHintSeconds(hint?.endTime ?? hint?.end, startTime + duration);
      const endTime = endTimeCandidate > startTime ? endTimeCandidate : startTime + Math.max(duration, 1);
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

function buildNormalizedHintsText(hints = []) {
  return hints.map((hint) => {
    const speaker = hint.speaker ? `${hint.speaker}: ` : '';
    return `[${formatHintTimestamp(hint.startTime)} - ${formatHintTimestamp(hint.endTime)}] ${speaker}${hint.text}`;
  }).join('\n');
}

function buildSpokenScriptFromHints(hints = []) {
  return hints
    .map((hint) => hint.text)
    .filter(Boolean)
    .join('\n\n');
}

async function prepareAvatarHintsForTask(task, userId) {
  const sessionData = await VideoSession.findOne({ _id: task.sessionId, userId });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const hints = normalizeSessionHints(sessionData);
  if (!hints.length) {
    throw new Error('No timeline hints are available for avatar voiceover.');
  }

  const normalizedHintsText = buildNormalizedHintsText(hints);
  const spokenScript = buildSpokenScriptFromHints(hints);
  const normalizedHintsAssetPath = await saveNormalizedHintsTextFile(task, normalizedHintsText);

  return {
    hints,
    normalizedHintsText,
    spokenScript,
    normalizedHintsAssetPath,
  };
}

function getHintsDurationSeconds(hints = []) {
  if (!Array.isArray(hints) || hints.length === 0) {
    return 1;
  }

  const latestEndTime = hints.reduce((latestTime, hint) => {
    const endTime = Number(hint?.endTime);
    return Number.isFinite(endTime) ? Math.max(latestTime, endTime) : latestTime;
  }, 0);
  return Math.max(1, Math.round(latestEndTime * 100) / 100);
}

function calculateAvatarVideoCreditCost(durationSeconds = 1) {
  const safeDuration = Math.max(1, Number(durationSeconds) || 1);
  const durationUnits = Math.max(1, Math.ceil(safeDuration / AVATAR_VIDEO_BILLING_UNIT_SECONDS));
  const baseCredits = AVATAR_VIDEO_UPFRONT_CREDITS
    + (durationUnits * AVATAR_VIDEO_BASE_CREDITS_PER_UNIT);

  return {
    baseCredits,
    creditsToCharge: Math.ceil(baseCredits * AVATAR_VIDEO_PRICING_MULTIPLIER),
    pricingDurationSeconds: safeDuration,
    pricingMultiplier: AVATAR_VIDEO_PRICING_MULTIPLIER,
    pricingBillingUnitSeconds: AVATAR_VIDEO_BILLING_UNIT_SECONDS,
    pricingUpfrontCredits: AVATAR_VIDEO_UPFRONT_CREDITS,
    pricingBaseCreditsPerUnit: AVATAR_VIDEO_BASE_CREDITS_PER_UNIT,
  };
}

function normalizeAvatarVideoAudioSource(value = '') {
  const normalized = normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (
    normalized === AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH ||
    normalized === 'generated_speech' ||
    normalized === 'existing_speech' ||
    normalized === 'session_audio'
  ) {
    return AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH;
  }
  return AVATAR_VIDEO_AUDIO_SOURCE_HINT_SPEECH;
}

function normalizeAudioLayerType(value = '') {
  return normalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
}

const GENERATED_SPEECH_AUDIO_LAYER_TYPES = new Set([
  'speech',
  'custom_speech',
  'recorded_speech',
  'lip_sync',
]);

function isGeneratedSpeechLayer(audioLayer = {}) {
  const audioType = normalizeAudioLayerType(
    audioLayer?.generationType
    || audioLayer?.type
    || audioLayer?.audioType
    || audioLayer?.sourceType
    || audioLayer?.source
    || audioLayer?.generationMeta?.sourceType
  );
  const libraryType = normalizeAudioLayerType(audioLayer?.libraryType);
  return GENERATED_SPEECH_AUDIO_LAYER_TYPES.has(audioType) || libraryType === 'speech';
}

function collectSessionSpeechAudioLayers(sessionData = {}) {
  const audioLayerGroups = [
    sessionData?.audioLayers,
    sessionData?.audio_layers,
    sessionData?.global_audio_layers,
    sessionData?.globalAudioLayers,
  ];
  const seenLayerIds = new Set();
  const audioLayers = [];

  audioLayerGroups.forEach((group) => {
    if (!Array.isArray(group)) {
      return;
    }

    group.forEach((audioLayer) => {
      const layerId = audioLayer?._id?.toString?.() || audioLayer?.id?.toString?.() || '';
      if (layerId) {
        if (seenLayerIds.has(layerId)) {
          return;
        }
        seenLayerIds.add(layerId);
      }
      audioLayers.push(audioLayer);
    });
  });

  return audioLayers;
}

function getAudioLayerRemoteUrl(audioLayer = {}) {
  const remoteCandidates = [
    audioLayer.selectedRemoteAudioLink,
    ...(Array.isArray(audioLayer.remoteAudioLinks) ? audioLayer.remoteAudioLinks : []),
    audioLayer.audioLink,
    audioLayer.url,
    ...(Array.isArray(audioLayer.remoteAudioData)
      ? audioLayer.remoteAudioData.map((audioData) => audioData?.audio_url || audioData?.audioUrl)
      : []),
  ].map(normalizeString).filter(Boolean);

  return remoteCandidates.find((candidate) => /^https?:\/\//i.test(candidate)) || '';
}

function getAudioLayerSourceForFfmpeg(audioLayer = {}) {
  const localCandidates = [
    audioLayer.selectedLocalAudioLink,
    ...(Array.isArray(audioLayer.localAudioLinks) ? audioLayer.localAudioLinks : []),
    audioLayer.audioLink,
    audioLayer.url,
  ].map(normalizeString).filter(Boolean);

  for (const candidate of localCandidates) {
    if (/^https?:\/\//i.test(candidate)) {
      continue;
    }
    const audioPath = resolveAssetAbsolutePath(candidate);
    if (audioPath && fs.existsSync(audioPath)) {
      return {
        source: audioPath,
        assetPath: candidate,
        remoteUrl: buildRemoteAssetUrl(candidate),
        isLocal: true,
      };
    }
  }

  const remoteUrl = getAudioLayerRemoteUrl(audioLayer);
  return remoteUrl
    ? { source: remoteUrl, assetPath: '', remoteUrl, isLocal: false }
    : { source: '', assetPath: '', remoteUrl: '', isLocal: false };
}

function getGeneratedSpeechSegments(sessionData = {}) {
  const audioLayers = collectSessionSpeechAudioLayers(sessionData);
  return audioLayers
    .filter(isGeneratedSpeechLayer)
    .map((audioLayer) => {
      const audioSource = getAudioLayerSourceForFfmpeg(audioLayer);
      if (!audioSource.source) {
        return null;
      }

      const startTime = Math.max(0, Number(audioLayer.startTime) || 0);
      const endTime = Number(audioLayer.endTime);
      const durationCandidate = Number(audioLayer.duration);
      const duration = Number.isFinite(durationCandidate) && durationCandidate > 0
        ? durationCandidate
        : Number.isFinite(endTime) && endTime > startTime
          ? endTime - startTime
          : 0;

      return {
        audioLayer,
        ...audioSource,
        startTime,
        duration,
        sourceTrimStartTime: Math.max(0, Number(audioLayer.sourceTrimStartTime) || 0),
      };
    })
    .filter((segment) => segment && segment.duration > 0)
    .sort((left, right) => left.startTime - right.startTime);
}

function runFfmpeg(args) {
  const binaryPath = ffmpegPath || 'ffmpeg';
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 120000) {
        stderr = stderr.slice(-120000);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-4000)}`));
      }
    });
  });
}

async function buildSessionSpeechAudioReference(task, userId) {
  const sessionData = await VideoSession.findOne({ _id: task.sessionId, userId });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const segments = getGeneratedSpeechSegments(sessionData);
  if (!segments.length) {
    throw new Error('Generated speech audio is not ready for this session.');
  }

  const durationSeconds = Math.max(
    1,
    ...segments.map((segment) => segment.startTime + segment.duration)
  );

  const outputFolder = path.join(
    getAssetsBasePath(),
    'avatar_voiceover',
    'session_speech',
    task.sessionId.toString(),
    task._id.toString()
  );
  await fsExtra.ensureDir(outputFolder);
  const outputPath = path.join(outputFolder, 'session_speech.mp3');

  const args = [
    '-y',
    '-f',
    'lavfi',
    '-t',
    `${durationSeconds}`,
    '-i',
    'anullsrc=r=44100:cl=stereo',
  ];
  segments.forEach((segment) => {
    args.push('-i', segment.source);
  });

  const filterParts = segments.map((segment, index) => {
    const inputIndex = index + 1;
    const delayMs = Math.max(0, Math.round(segment.startTime * 1000));
    const duration = Math.max(0.01, Number(segment.duration) || 0.01);
    const trimStart = Math.max(0, Number(segment.sourceTrimStartTime) || 0);
    return `[${inputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=start=${trimStart}:duration=${duration},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[s${index}]`;
  });
  const mixInputs = ['[0:a]', ...segments.map((_, index) => `[s${index}]`)].join('');
  filterParts.push(`${mixInputs}amix=inputs=${segments.length + 1}:duration=first:dropout_transition=0[mix]`);

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[mix]',
    '-t',
    `${durationSeconds}`,
    '-ac',
    '2',
    '-ar',
    '44100',
    '-b:a',
    '192k',
    outputPath,
  );

  await runFfmpeg(args);
  const stats = await fs.promises.stat(outputPath);
  if (!stats?.isFile() || stats.size === 0) {
    throw new Error('Generated session speech audio was empty.');
  }

  const assetPath = `/${toAssetRelativePath(outputPath)}`;
  return {
    audioUrl: buildRemoteAssetUrl(assetPath),
    audioPath: outputPath,
    assetPath,
    durationSeconds,
  };
}

async function saveNormalizedHintsTextFile(task, normalizedHintsText = '') {
  const outputFolder = path.join(
    getAssetsBasePath(),
    'avatar_voiceover',
    'hints',
    task.sessionId.toString(),
    task._id.toString()
  );
  await fsExtra.ensureDir(outputFolder);

  const outputPath = path.join(outputFolder, 'normalized_hints.txt');
  await fs.promises.writeFile(outputPath, normalizedHintsText, 'utf8');
  return `/${toAssetRelativePath(outputPath)}`;
}

function isTerminalRunwayTaskStatus(status = '') {
  return ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(normalizeString(status).toUpperCase());
}

async function scheduleAvatarCreationPoll(taskId) {
  const normalizedTaskId = taskId?.toString?.() || normalizeString(taskId);
  if (!normalizedTaskId || ACTIVE_AVATAR_POLLS.has(normalizedTaskId)) {
    return;
  }

  ACTIVE_AVATAR_POLLS.add(normalizedTaskId);
  void pollAvatarCreationUntilComplete(normalizedTaskId)
    .catch((error) => {
      console.error('[avatar_voiceover] avatar creation poll failed', {
        taskId: normalizedTaskId,
        error: error?.message || error,
      });
    })
    .finally(() => ACTIVE_AVATAR_POLLS.delete(normalizedTaskId));
}

async function pollAvatarCreationUntilComplete(taskId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUNWAY_AVATAR_POLL_TIMEOUT_MS) {
    const task = await AvatarVoiceoverTask.findById(taskId);
    if (!task || !task.runwayAvatarId) {
      return;
    }

    const status = normalizeString(task.runwayAvatarStatus).toUpperCase();
    if (status === 'READY' || status === 'FAILED') {
      return;
    }

    const avatar = await runwayGet(`/v1/avatars/${task.runwayAvatarId}`);
    const nextStatus = normalizeString(avatar?.status).toUpperCase();
    const update = {
      runwayAvatarStatus: nextStatus,
      runwayAvatarResponse: avatar,
    };
    if (nextStatus === 'READY') {
      update.status = 'AVATAR_READY';
      update.stage = 'AVATAR_READY';
      update.avatarError = '';
      update.errorMessage = '';
    } else if (nextStatus === 'FAILED') {
      update.status = 'FAILED';
      update.stage = 'AVATAR_CREATION';
      update.avatarError = 'Runway could not create the avatar from this image.';
      update.errorMessage = update.avatarError;
    } else {
      update.status = 'AVATAR_PROCESSING';
      update.stage = 'AVATAR_CREATION';
      update.avatarError = '';
      update.errorMessage = '';
    }

    await AvatarVoiceoverTask.updateOne({ _id: taskId }, { $set: update });

    if (nextStatus === 'READY' || nextStatus === 'FAILED') {
      return;
    }
    await wait(RUNWAY_POLL_INTERVAL_MS);
  }

  await AvatarVoiceoverTask.updateOne(
    { _id: taskId },
    {
      $set: {
        status: 'FAILED',
        avatarError: 'Avatar creation timed out.',
        errorMessage: 'Avatar creation timed out.',
      },
    }
  );
}

async function scheduleAvatarVideoPoll(taskId) {
  const normalizedTaskId = taskId?.toString?.() || normalizeString(taskId);
  if (!normalizedTaskId || ACTIVE_AVATAR_VIDEO_POLLS.has(normalizedTaskId)) {
    return;
  }

  ACTIVE_AVATAR_VIDEO_POLLS.add(normalizedTaskId);
  void pollAvatarVideoUntilComplete(normalizedTaskId)
    .catch((error) => {
      console.error('[avatar_voiceover] avatar video poll failed', {
        taskId: normalizedTaskId,
        error: error?.message || error,
      });
    })
    .finally(() => ACTIVE_AVATAR_VIDEO_POLLS.delete(normalizedTaskId));
}

async function pollAvatarVideoUntilComplete(taskId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUNWAY_AVATAR_VIDEO_POLL_TIMEOUT_MS) {
    const task = await AvatarVoiceoverTask.findById(taskId);
    if (!task || !task.avatarVideoTaskId) {
      return;
    }

    const status = normalizeString(task.avatarVideoStatus).toUpperCase();
    if (isTerminalRunwayTaskStatus(status)) {
      return;
    }

    const videoTask = await runwayGet(`/v1/tasks/${task.avatarVideoTaskId}`);
    const nextStatus = normalizeString(videoTask?.status).toUpperCase();
    const outputUrl = Array.isArray(videoTask?.output) ? normalizeString(videoTask.output[0]) : '';
    const update = {
      avatarVideoStatus: nextStatus,
      avatarVideoResponse: videoTask,
    };
    if (nextStatus === 'SUCCEEDED' && outputUrl) {
      update.status = 'VIDEO_COMPLETED';
      update.stage = 'AVATAR_VIDEO_READY';
      update.avatarVideoUrl = outputUrl;
      update.avatarVideoError = '';
    } else if (nextStatus === 'FAILED' || nextStatus === 'CANCELLED') {
      update.status = 'FAILED';
      update.stage = 'AVATAR_VIDEO';
      update.avatarVideoError = videoTask?.failure || 'Runway avatar video generation failed.';
      update.errorMessage = update.avatarVideoError;
    } else {
      update.status = 'VIDEO_PROCESSING';
      update.stage = 'AVATAR_VIDEO';
    }

    await AvatarVoiceoverTask.updateOne({ _id: taskId }, { $set: update });

    if (isTerminalRunwayTaskStatus(nextStatus)) {
      return;
    }
    await wait(RUNWAY_POLL_INTERVAL_MS);
  }

  await AvatarVoiceoverTask.updateOne(
    { _id: taskId },
    {
      $set: {
        status: 'FAILED',
        avatarVideoStatus: 'FAILED',
        avatarVideoError: 'Avatar video generation timed out.',
        errorMessage: 'Avatar video generation timed out.',
      },
    }
  );
}

async function downloadAvatarVideoAsset(task) {
  const existingAssetPath = normalizeString(task.avatarVideoAssetPath);
  if (existingAssetPath && fs.existsSync(resolveAssetAbsolutePath(existingAssetPath))) {
    return resolveAssetAbsolutePath(existingAssetPath);
  }

  const videoUrl = normalizeString(task.avatarVideoUrl);
  if (!videoUrl) {
    throw new Error('Avatar video is not ready.');
  }

  const outputFolder = path.join(
    getAssetsBasePath(),
    'avatar_voiceover',
    'videos',
    task.sessionId.toString(),
    task._id.toString()
  );
  await fsExtra.ensureDir(outputFolder);

  const outputPath = path.join(outputFolder, `avatar_voiceover_${Date.now()}.mp4`);
  const response = await axios.get(videoUrl, {
    responseType: 'stream',
    timeout: 120000,
    maxContentLength: AVATAR_VIDEO_MAX_FILE_SIZE_BYTES,
    maxBodyLength: AVATAR_VIDEO_MAX_FILE_SIZE_BYTES,
  });

  await pipeline(response.data, fs.createWriteStream(outputPath));
  const stats = await fs.promises.stat(outputPath);
  if (!stats?.isFile() || stats.size === 0) {
    throw new Error('Downloaded avatar video was empty.');
  }
  if (stats.size > AVATAR_VIDEO_MAX_FILE_SIZE_BYTES) {
    await fsExtra.remove(outputPath).catch(() => {});
    throw new Error('Avatar video must be 512 MB or smaller.');
  }

  const assetPath = `/${toAssetRelativePath(outputPath)}`;
  task.avatarVideoAssetPath = assetPath;
  await task.save();
  return outputPath;
}

function getExistingAvatarSpeechAudioPath(task) {
  const speechAudioAssetPath = normalizeString(task?.avatarVideoSpeechAudioAssetPath)
    || normalizeString(task?.avatarSpeechAudioAssetPath);
  if (!speechAudioAssetPath) {
    return '';
  }

  const audioPath = resolveAssetAbsolutePath(speechAudioAssetPath);
  return audioPath && fs.existsSync(audioPath) ? audioPath : '';
}

function getGlobalVideoIdValue(globalVideo = {}) {
  return globalVideo?._id?.toString?.()
    || globalVideo?.id?.toString?.()
    || globalVideo?.globalVideoId?.toString?.()
    || normalizeString(globalVideo?._id || globalVideo?.id || globalVideo?.globalVideoId);
}

function getGlobalAudioLayerIdValue(audioLayer = {}) {
  return audioLayer?._id?.toString?.()
    || audioLayer?.id?.toString?.()
    || normalizeString(audioLayer?._id || audioLayer?.id);
}

function getSessionGlobalVideos(sessionData = {}) {
  if (Array.isArray(sessionData?.global_videos)) {
    return sessionData.global_videos;
  }
  if (Array.isArray(sessionData?.globalVideos)) {
    return sessionData.globalVideos;
  }
  return [];
}

function getSessionGlobalAudioLayers(sessionData = {}) {
  if (Array.isArray(sessionData?.global_audio_layers)) {
    return sessionData.global_audio_layers;
  }
  if (Array.isArray(sessionData?.globalAudioLayers)) {
    return sessionData.globalAudioLayers;
  }
  return [];
}

async function getAvatarSpeechAudioReference(task) {
  const speechAudioAssetPath = normalizeString(task?.avatarSpeechAudioAssetPath);
  const speechAudioUrl = normalizeString(task?.avatarSpeechAudioUrl);
  const audioPath = speechAudioAssetPath ? resolveAssetAbsolutePath(speechAudioAssetPath) : '';
  const hasLocalAudio = Boolean(audioPath && fs.existsSync(audioPath));
  const audioUrl = hasLocalAudio
    ? buildRemoteAssetUrl(speechAudioAssetPath)
    : speechAudioUrl;

  if (!/^https:\/\//i.test(audioUrl) && !/^data:audio\//i.test(audioUrl)) {
    return {
      audioUrl: '',
      audioPath: '',
      assetPath: speechAudioAssetPath,
      durationSeconds: 0,
    };
  }

  const metadata = hasLocalAudio
    ? await getVideoMetadata(audioPath).catch(() => null)
    : null;
  const durationSeconds = Number(metadata?.format?.duration);

  return {
    audioUrl,
    audioPath: hasLocalAudio ? audioPath : '',
    assetPath: speechAudioAssetPath,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0,
  };
}

async function addAvatarVideoGlobalAudioLayer({
  userId,
  sessionId,
  globalVideoId,
  videoPath,
  sourceAudioPath,
  startTime,
  duration,
  title,
}) {
  let audioPath = normalizeString(sourceAudioPath);
  let leadingSilenceTrimSeconds = 0;
  let trailingSilenceTrimSeconds = 0;

  if (!audioPath || !fs.existsSync(audioPath)) {
    const extractedAudio = await extractAudioFromVideoIfPresent(videoPath, {
      sessionId,
      layerId: globalVideoId,
      prefix: 'avatar_voiceover',
      namespace: 'global_videos',
      trimUploadedAudioEdgeSilence: false,
    });
    audioPath = extractedAudio?.audioPath || '';
    leadingSilenceTrimSeconds = extractedAudio?.leadingSilenceTrimSeconds || 0;
    trailingSilenceTrimSeconds = extractedAudio?.trailingSilenceTrimSeconds || 0;
  }

  if (!audioPath) {
    return null;
  }

  const sessionData = await VideoSession.findOne({ _id: sessionId, userId });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const audioRelativePath = toAssetRelativePath(audioPath);
  const globalAudioLayerId = new mongoose.Types.ObjectId();
  const safeStartTime = Number.isFinite(Number(startTime)) ? Math.max(0, Number(startTime)) : 0;
  const audioMetadata = await getVideoMetadata(audioPath).catch(() => null);
  const audioDuration = Number(audioMetadata?.format?.duration);
  const safeDuration = Number.isFinite(audioDuration) && audioDuration > 0
    ? audioDuration
    : Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : 1;
  const globalAudioLayer = applyAudioLayerManualVolumeDefaults({
    _id: globalAudioLayerId,
    prompt: title || 'Avatar voiceover',
    title: title || 'Avatar voiceover',
    generationType: 'recorded_speech',
    libraryType: 'speech',
    source: 'avatar_voiceover',
    sourceType: 'recorded_speech',
    globalVideoId: globalVideoId?.toString?.() || normalizeString(globalVideoId),
    globalAudioLayer: true,
    audioBindingMode: 'global',
    bindToLayer: false,
    isEnabled: true,
    defaultSelected: true,
    volume: 100,
    startTime: safeStartTime,
    endTime: safeStartTime + safeDuration,
    duration: safeDuration,
    originalDuration: safeDuration,
    generationStatus: 'COMPLETED',
    streamDownloadPending: false,
    fadeOnEdges: false,
    addSubtitles: false,
    localAudioLinks: [audioRelativePath],
    selectedLocalAudioLink: audioRelativePath,
    speakerCharacterName: title || 'Avatar voiceover',
    sourceTrimStartTime: leadingSilenceTrimSeconds,
    generationMeta: {
      source: 'avatar_voiceover',
      sourceType: 'recorded_speech',
      globalVideoId: globalVideoId?.toString?.() || normalizeString(globalVideoId),
      globalAudioLayer: true,
      recordedDuration: safeDuration,
      userVideoLeadingSilenceTrimSeconds: leadingSilenceTrimSeconds,
      userVideoTrailingSilenceTrimSeconds: trailingSilenceTrimSeconds,
    },
  });

  sessionData.global_audio_layers = [
    ...(Array.isArray(sessionData.global_audio_layers) ? sessionData.global_audio_layers : []),
    globalAudioLayer,
  ];
  extendSessionTimelineToCustomSpeechEnd(sessionData, [globalAudioLayer]);
  const savedSession = await sessionData.save();
  const savedGlobalAudioLayer = (savedSession.global_audio_layers || []).find(
    (audioLayer) => audioLayer?._id?.toString?.() === globalAudioLayerId.toString()
  ) || globalAudioLayer;

  return {
    sessionDetails: savedSession,
    globalAudioLayer: savedGlobalAudioLayer,
  };
}

export async function requestGenerateAvatarImage(userId, payload = {}) {
  await getDBConnectionString();

  const sessionId = normalizeString(payload.sessionId);
  const prompt = normalizeString(payload.prompt);
  if (!sessionId) {
    throw new Error('sessionId is required.');
  }
  if (!prompt) {
    throw new Error('Describe the avatar before generating an image.');
  }

  const sessionData = await VideoSession.findOne({ _id: sessionId, userId }).select('_id');
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const moderationPassed = await getModerationForNarrative(prompt);
  if (!moderationPassed) {
    throw new Error('Prompt failed moderation');
  }

  const userData = await User.findOne({ _id: userId }, { contentFilterRating: 1 });
  const avatarImagePrompt = buildAvatarImagePrompt(prompt);
  const task = await AvatarVoiceoverTask.create({
    userId: userId.toString(),
    sessionId,
    status: 'IMAGE_PENDING',
    stage: 'IMAGE_GENERATION',
    prompt,
    avatarImagePrompt,
    imageStatus: 'PENDING',
  });

  let imageRequest = null;
  try {
    imageRequest = await addImageGeneratorRequest(userId, {
      userId: userId.toString(),
      sessionId,
      videoSessionId: sessionId,
      layerId: null,
      prompt: avatarImagePrompt,
      model: 'GPTIMAGE2',
      aspectRatio: '16:9',
      background_color: 'black',
      backgroundColor: 'black',
      transparent_background: false,
      transparentBackground: false,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      requestType: 'AVATAR_VOICEOVER',
      avatarVoiceoverTaskId: task._id.toString(),
      contentFilterRating: userData?.contentFilterRating ?? 3,
      retryOnFailure: true,
    });
  } catch (error) {
    const message = error?.message || 'Unable to queue avatar image generation.';
    task.status = 'FAILED';
    task.stage = 'IMAGE_GENERATION';
    task.imageStatus = 'FAILED';
    task.imageError = message;
    task.errorMessage = message;
    await task.save();
    throw new Error(message);
  }

  if (!imageRequest?._id) {
    const message = 'Unable to queue avatar image generation.';
    task.status = 'FAILED';
    task.stage = 'IMAGE_GENERATION';
    task.imageStatus = 'FAILED';
    task.imageError = message;
    task.errorMessage = message;
    await task.save();
    throw new Error(message);
  }

  task.imageRequestId = imageRequest?._id?.toString?.() || '';
  await task.save();

  return {
    task: serializeAvatarVoiceoverTask(task),
    voices: RUNWAY_AVATAR_VOICE_PRESETS,
  };
}

export async function listAvatarVoiceoverTasks(userId, query = {}) {
  await getDBConnectionString();
  const sessionId = normalizeString(query.sessionId);
  if (!sessionId) {
    throw new Error('sessionId is required.');
  }

  const tasks = await AvatarVoiceoverTask.find({ userId: userId.toString(), sessionId })
    .sort({ createdAt: -1 })
    .limit(20);

  return {
    tasks: tasks.map(serializeAvatarVoiceoverTask),
    voices: RUNWAY_AVATAR_VOICE_PRESETS,
  };
}

export async function listUserRunwayAvatars(userId) {
  await getDBConnectionString();

  const tasks = await AvatarVoiceoverTask.find({
    userId: userId.toString(),
    runwayAvatarId: { $ne: '' },
    runwayAvatarStatus: 'READY',
    status: { $ne: 'REJECTED' },
  })
    .sort({ updatedAt: -1 })
    .limit(50);

  const seenAvatarIds = new Set();
  const avatars = [];
  tasks.forEach((task) => {
    const avatarId = normalizeString(task.runwayAvatarId);
    if (!avatarId || seenAvatarIds.has(avatarId)) {
      return;
    }
    seenAvatarIds.add(avatarId);
    avatars.push(serializeAvatarVoiceoverTask(task));
  });

  return {
    avatars,
    voices: RUNWAY_AVATAR_VOICE_PRESETS,
  };
}

export async function selectUserRunwayAvatarForSession(userId, payload = {}) {
  await getDBConnectionString();

  const sessionId = normalizeString(payload.sessionId);
  const sourceTaskId = normalizeString(payload.taskId);
  const runwayAvatarId = normalizeString(payload.runwayAvatarId || payload.avatarId);
  if (!sessionId) {
    throw new Error('sessionId is required.');
  }
  if (!sourceTaskId && !runwayAvatarId) {
    throw new Error('Choose an avatar first.');
  }

  const sessionData = await VideoSession.findOne({ _id: sessionId, userId }).select('_id');
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const sourceTask = await AvatarVoiceoverTask.findOne({
    userId: userId.toString(),
    ...(sourceTaskId ? { _id: sourceTaskId } : { runwayAvatarId }),
    runwayAvatarId: { $ne: '' },
    runwayAvatarStatus: 'READY',
  });
  if (!sourceTask) {
    throw new Error('Reusable avatar not found.');
  }

  if (sourceTask.sessionId?.toString?.() === sessionId) {
    return {
      task: serializeAvatarVoiceoverTask(sourceTask),
      voices: RUNWAY_AVATAR_VOICE_PRESETS,
    };
  }

  const existingTask = await AvatarVoiceoverTask.findOne({
    userId: userId.toString(),
    sessionId,
    runwayAvatarId: sourceTask.runwayAvatarId,
  }).sort({ updatedAt: -1 });
  if (existingTask) {
    return {
      task: serializeAvatarVoiceoverTask(existingTask),
      voices: RUNWAY_AVATAR_VOICE_PRESETS,
    };
  }

  const task = await AvatarVoiceoverTask.create({
    userId: userId.toString(),
    sessionId,
    status: 'AVATAR_READY',
    stage: 'AVATAR_READY',
    prompt: sourceTask.prompt,
    avatarImagePrompt: sourceTask.avatarImagePrompt,
    imageStatus: sourceTask.avatarImage ? 'COMPLETED' : '',
    avatarImage: sourceTask.avatarImage,
    avatarImageUrl: sourceTask.avatarImageUrl,
    avatarImageWidth: sourceTask.avatarImageWidth,
    avatarImageHeight: sourceTask.avatarImageHeight,
    avatarName: sourceTask.avatarName,
    personality: sourceTask.personality,
    voicePresetId: sourceTask.voicePresetId,
    voicePresetName: sourceTask.voicePresetName,
    runwayAvatarId: sourceTask.runwayAvatarId,
    runwayAvatarStatus: 'READY',
    runwayAvatarResponse: sourceTask.runwayAvatarResponse,
  });

  return {
    task: serializeAvatarVoiceoverTask(task),
    voices: RUNWAY_AVATAR_VOICE_PRESETS,
  };
}

export async function getAvatarVoiceoverStatus(userId, query = {}) {
  await getDBConnectionString();
  const task = await getOwnedTask(userId, query.taskId);
  const avatarStatus = normalizeString(task.runwayAvatarStatus).toUpperCase();
  const avatarVideoStatus = normalizeString(task.avatarVideoStatus).toUpperCase();

  if (task.runwayAvatarId && avatarStatus === 'PROCESSING') {
    await scheduleAvatarCreationPoll(task._id);
  }
  if (task.avatarVideoTaskId && !isTerminalRunwayTaskStatus(avatarVideoStatus)) {
    await scheduleAvatarVideoPoll(task._id);
  }

  return {
    task: serializeAvatarVoiceoverTask(await AvatarVoiceoverTask.findById(task._id)),
    voices: RUNWAY_AVATAR_VOICE_PRESETS,
  };
}

export async function requestCreateRunwayAvatar(userId, payload = {}) {
  await getDBConnectionString();
  const task = await getOwnedTask(userId, payload.taskId);
  if (!task.avatarImage) {
    throw new Error('Generate or select an avatar image first.');
  }

  const voicePresetId = normalizeVoicePresetId(payload.voicePresetId || task.voicePresetId);
  const avatarName = normalizeString(payload.name || task.avatarName || 'Samsar Avatar').slice(0, 50);
  const personality = normalizeString(payload.personality || task.personality || DEFAULT_AVATAR_PERSONALITY).slice(0, 2000);
  const referenceImage = await readImageAsDataUri(task.avatarImage);

  task.status = 'AVATAR_PROCESSING';
  task.stage = 'AVATAR_CREATION';
  task.avatarName = avatarName;
  task.personality = personality;
  task.voicePresetId = voicePresetId;
  task.voicePresetName = getVoicePresetName(voicePresetId);
  task.avatarError = '';
  task.errorMessage = '';
  await task.save();

  try {
    const avatar = await runwayPost('/v1/avatars', {
      name: avatarName || 'Samsar Avatar',
      referenceImage,
      personality,
      voice: {
        type: 'runway-live-preset',
        presetId: voicePresetId,
      },
      imageProcessing: 'optimize',
    });

    const runwayAvatarStatus = normalizeString(avatar?.status).toUpperCase() || 'PROCESSING';
    task.runwayAvatarId = avatar?.id || task.runwayAvatarId;
    task.runwayAvatarStatus = runwayAvatarStatus;
    task.runwayAvatarResponse = avatar;
    task.status = runwayAvatarStatus === 'READY' ? 'AVATAR_READY' : 'AVATAR_PROCESSING';
    task.stage = runwayAvatarStatus === 'READY' ? 'AVATAR_READY' : 'AVATAR_CREATION';
    task.avatarError = '';
    task.errorMessage = '';
    await task.save();

    if (runwayAvatarStatus !== 'READY') {
      await scheduleAvatarCreationPoll(task._id);
    }

    return {
      task: serializeAvatarVoiceoverTask(task),
      voices: RUNWAY_AVATAR_VOICE_PRESETS,
    };
  } catch (error) {
    const message = error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Unable to create avatar.';
    task.status = 'FAILED';
    task.avatarError = message;
    task.errorMessage = message;
    await task.save();
    throw new Error(message);
  }
}

export async function requestGenerateAvatarSpeechFromHints(userId, payload = {}) {
  await getDBConnectionString();
  const task = await getOwnedTask(userId, payload.taskId);
  if (task.avatarSpeechGenerationId) {
    const existingGeneration = await AudioGeneration.findById(task.avatarSpeechGenerationId);
    const existingSpeechStatus = normalizeString(task.avatarSpeechStatus).toUpperCase();
    if (existingGeneration && ['INIT', 'PENDING', 'PROCESSING'].includes(existingSpeechStatus)) {
      throw new Error('Avatar speech generation is already in progress.');
    }
  }

  const {
    hints,
    normalizedHintsText,
    spokenScript,
    normalizedHintsAssetPath,
  } = await prepareAvatarHintsForTask(task, userId);
  const speechProvider = normalizeSpeechProvider(payload.provider || payload.ttsProvider, payload.speaker);
  const speechSpeaker = normalizeString(payload.speaker) || normalizeString(payload.speakerVoiceId);
  const speechLanguageCode = normalizeString(payload.languageCode || payload.language_code || payload.language);
  const speechLanguageCodes = Array.isArray(payload.languageCodes)
    ? payload.languageCodes.map(normalizeString).filter(Boolean)
    : [];
  if (!speechSpeaker) {
    throw new Error('Choose a speaker before generating speech from hints.');
  }

  const speechSpeakerVoiceId = normalizeString(payload.speakerVoiceId) || speechSpeaker;
  const speechSpeakerName = normalizeString(payload.speakerName)
    || normalizeString(payload.speakerLabel)
    || getTTSSpeakerName(speechProvider, speechSpeaker)
    || speechSpeaker;
  const speechSpeakerDetails = payload.speakerDetails && typeof payload.speakerDetails === 'object'
    ? payload.speakerDetails
    : null;

  const audioGeneration = await AudioGeneration.create({
    userId: userId.toString(),
    sessionId: task.sessionId.toString(),
    generationType: AVATAR_SPEECH_GENERATION_TYPE,
    prompt: spokenScript,
    avatarVoiceoverTaskId: task._id.toString(),
    hints,
    normalizedHintsText,
    ttsProvider: speechProvider,
    provider: speechProvider,
    speaker: speechSpeaker,
    languageCode: speechLanguageCode,
    languageCodes: speechLanguageCodes,
    speakerVoiceId: speechSpeakerVoiceId,
    speakerLabel: speechSpeakerName,
    speakerDetails: speechSpeakerDetails,
    speakerCharacterName: speechSpeakerName,
    status: 'INIT',
    rowLocked: false,
    generationMeta: {
      source: 'avatar_voiceover',
      hintCount: hints.length,
    },
  });

  task.status = 'SPEECH_PROCESSING';
  task.stage = 'AVATAR_SPEECH';
  task.hints = hints;
  task.normalizedHintsText = normalizedHintsText;
  task.normalizedHintsAssetPath = normalizedHintsAssetPath;
  task.spokenScript = spokenScript;
  task.avatarSpeechGenerationId = audioGeneration._id.toString();
  task.avatarSpeechStatus = 'INIT';
  task.avatarSpeechAudioAssetPath = '';
  task.avatarSpeechAudioUrl = '';
  task.avatarSpeechDuration = getHintsDurationSeconds(hints);
  task.avatarSpeechError = '';
  task.speechProvider = speechProvider;
  task.speechSpeaker = speechSpeaker;
  task.speechSpeakerName = speechSpeakerName;
  task.speechLanguageCode = speechLanguageCode;
  task.speechLanguageCodes = speechLanguageCodes;
  task.speechSpeakerVoiceId = speechSpeakerVoiceId;
  task.speechSpeakerLabel = speechSpeakerName;
  task.speechSpeakerDetails = speechSpeakerDetails;
  task.speechSegments = [];
  task.speechTimelineSegments = [];
  task.errorMessage = '';
  await task.save();

  return {
    task: serializeAvatarVoiceoverTask(task),
    voices: RUNWAY_AVATAR_VOICE_PRESETS,
    ttsProviders: AVATAR_VOICEOVER_TTS_PROVIDERS,
  };
}

export async function requestGenerateAvatarVideoFromHints(userId, payload = {}) {
  await getDBConnectionString();
  const task = await getOwnedTask(userId, payload.taskId);
  if (!task.runwayAvatarId || normalizeString(task.runwayAvatarStatus).toUpperCase() !== 'READY') {
    throw new Error('Wait for avatar creation to complete before generating video.');
  }
  if (task.avatarVideoTaskId && !isTerminalRunwayTaskStatus(task.avatarVideoStatus)) {
    throw new Error('Avatar video generation is already in progress.');
  }

  const audioSource = normalizeAvatarVideoAudioSource(
    payload.audioSource || payload.speechSource || payload.audio_source
  );
  const useSessionSpeechAudio = audioSource === AVATAR_VIDEO_AUDIO_SOURCE_SESSION_SPEECH;
  const avatarSpeechAudioReference = useSessionSpeechAudio
    ? await buildSessionSpeechAudioReference(task, userId)
    : await getAvatarSpeechAudioReference(task);

  if (!useSessionSpeechAudio && normalizeString(task.avatarSpeechStatus).toUpperCase() !== 'COMPLETED') {
    throw new Error('Generate speech from hints before generating avatar video.');
  }

  const avatarSpeechAudio = avatarSpeechAudioReference.audioUrl;
  if (!/^https:\/\//i.test(avatarSpeechAudio) && !/^data:audio\//i.test(avatarSpeechAudio)) {
    throw new Error(useSessionSpeechAudio
      ? 'Generated session speech audio must be available through an HTTPS URL before generating video.'
      : 'Avatar speech audio must be available through an HTTPS URL before generating video.');
  }

  const sessionForHints = await VideoSession.findOne({ _id: task.sessionId, userId });
  const hints = Array.isArray(task.hints) && task.hints.length
    ? task.hints
    : normalizeSessionHints(sessionForHints);
  if (!hints.length && !useSessionSpeechAudio) {
    throw new Error('No timeline hints are available for avatar voiceover.');
  }

  const normalizedHintsText = hints.length
    ? task.normalizedHintsText || buildNormalizedHintsText(hints)
    : '';
  const spokenScript = hints.length
    ? task.spokenScript || buildSpokenScriptFromHints(hints)
    : task.spokenScript || '';
  const normalizedHintsAssetPath = hints.length
    ? task.normalizedHintsAssetPath || await saveNormalizedHintsTextFile(task, normalizedHintsText)
    : '';
  const pricingDurationSeconds = Number(avatarSpeechAudioReference.durationSeconds) > 0
    ? Number(avatarSpeechAudioReference.durationSeconds)
    : !useSessionSpeechAudio && Number(task.avatarSpeechDuration) > 0
    ? Number(task.avatarSpeechDuration)
    : hints.length
      ? getHintsDurationSeconds(hints)
      : 1;
  const {
    baseCredits,
    creditsToCharge,
    pricingMultiplier,
    pricingBillingUnitSeconds,
    pricingUpfrontCredits,
    pricingBaseCreditsPerUnit,
  } = calculateAvatarVideoCreditCost(pricingDurationSeconds);
  const shouldChargeCredits = process.env.CURRENT_ENV !== 'docker';
  const creditResult = shouldChargeCredits
    ? await deductGenerationCredits(userId, creditsToCharge, {
      source: 'avatar_voiceover_video',
      metadata: {
        taskId: task._id.toString(),
        sessionId: task.sessionId.toString(),
        durationSeconds: pricingDurationSeconds,
        baseCredits,
        multiplier: pricingMultiplier,
        billingUnitSeconds: pricingBillingUnitSeconds,
        upfrontCredits: pricingUpfrontCredits,
        baseCreditsPerUnit: pricingBaseCreditsPerUnit,
        convertedCredits: creditsToCharge,
      },
    })
    : { remainingCredits: null };

  task.status = 'VIDEO_PROCESSING';
  task.stage = 'AVATAR_VIDEO';
  task.hints = hints;
  task.normalizedHintsText = normalizedHintsText;
  task.normalizedHintsAssetPath = normalizedHintsAssetPath;
  task.spokenScript = spokenScript;
  task.avatarVideoAudioSource = audioSource;
  task.avatarVideoSpeechAudioSource = audioSource;
  task.creditsCharged = creditsToCharge;
  task.creditsRemaining = creditResult?.remainingCredits ?? null;
  task.pricingBaseCredits = baseCredits;
  task.pricingDurationSeconds = pricingDurationSeconds;
  task.pricingMultiplier = pricingMultiplier;
  task.pricingBillingUnitSeconds = pricingBillingUnitSeconds;
  task.pricingUpfrontCredits = pricingUpfrontCredits;
  task.pricingBaseCreditsPerUnit = pricingBaseCreditsPerUnit;
  task.avatarVideoTaskId = '';
  task.avatarVideoStatus = 'PENDING';
  task.avatarVideoUrl = '';
  task.avatarVideoAssetPath = '';
  task.avatarVideoResponse = null;
  task.avatarVideoSpeechAudioUrl = avatarSpeechAudio;
  task.avatarVideoSpeechAudioAssetPath = avatarSpeechAudioReference.assetPath;
  task.avatarVideoSpeechAudioDuration = avatarSpeechAudioReference.durationSeconds || pricingDurationSeconds;
  task.globalVideoId = '';
  task.globalAudioLayerId = '';
  task.savedLibraryItemId = '';
  task.avatarVideoError = '';
  task.errorMessage = '';
  await task.save();

  try {
    const avatarVideo = await runwayPost('/v1/avatar_videos', {
      model: 'gwm1_avatars',
      avatar: {
        type: 'custom',
        avatarId: task.runwayAvatarId,
      },
      speech: {
        type: 'audio',
        audio: avatarSpeechAudio,
      },
    });

    task.avatarVideoTaskId = avatarVideo?.id || '';
    task.avatarVideoResponse = avatarVideo;
    await task.save();
    await scheduleAvatarVideoPoll(task._id);

    return {
      task: serializeAvatarVoiceoverTask(task),
      voices: RUNWAY_AVATAR_VOICE_PRESETS,
      creditsCharged: shouldChargeCredits ? creditsToCharge : 0,
      remainingCredits: creditResult?.remainingCredits ?? null,
    };
  } catch (error) {
    const message = error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Unable to generate avatar video.';
    if (shouldChargeCredits && creditsToCharge > 0) {
      await creditGenerationCredits(userId, creditsToCharge, {
        source: 'avatar_voiceover_video_refund',
        metadata: {
          taskId: task._id.toString(),
          sessionId: task.sessionId.toString(),
          reason: 'upstream_request_failed',
        },
      }).catch((refundError) => {
        console.error('[avatar_voiceover] failed to refund avatar video credits', {
          taskId: task._id.toString(),
          error: refundError?.message || refundError,
        });
      });
    }
    task.status = 'FAILED';
    task.avatarVideoStatus = 'FAILED';
    task.avatarVideoError = message;
    task.errorMessage = message;
    task.creditsCharged = 0;
    await task.save();
    throw new Error(message);
  }
}

export async function saveAvatarVoiceoverVideoToLibrary(userId, payload = {}) {
  await getDBConnectionString();
  const task = await getOwnedTask(userId, payload.taskId);
  if (task.status !== 'VIDEO_COMPLETED' && !task.avatarVideoUrl && !task.avatarVideoAssetPath) {
    throw new Error('Avatar video is not ready.');
  }

  const videoPath = await downloadAvatarVideoAsset(task);
  const metadata = await getVideoMetadata(videoPath).catch(() => null);
  const duration = Number(metadata?.format?.duration);
  const assetPath = `/${toAssetRelativePath(videoPath)}`;

  let libraryItem = null;
  if (task.savedLibraryItemId) {
    libraryItem = await GeneratedAIVideo.findOne({ _id: task.savedLibraryItemId, userId });
  }
  if (!libraryItem) {
    libraryItem = await GeneratedAIVideo.create({
      url: assetPath,
      description: 'Avatar voiceover',
      prompt: task.prompt || task.spokenScript || 'Avatar voiceover',
      sessionId: task.sessionId,
      userId: userId.toString(),
      model: 'RUNWAY_AVATAR',
      audioPrompt: task.spokenScript,
      duration: Number.isFinite(duration) && duration > 0 ? duration : task.duration,
      generationType: 'avatar_voiceover',
      thumbnailPath: task.avatarImage,
    });
    task.savedLibraryItemId = libraryItem._id.toString();
    if (task.status !== 'ACCEPTED') {
      task.status = 'SAVED';
    }
    await task.save();
  }

  return {
    task: serializeAvatarVoiceoverTask(task),
    item: libraryItem,
  };
}

export async function acceptAvatarVoiceoverVideoForSession(userId, payload = {}) {
  await getDBConnectionString();
  const task = await getOwnedTask(userId, payload.taskId);
  if (task.status !== 'VIDEO_COMPLETED' && !task.avatarVideoUrl && !task.avatarVideoAssetPath) {
    throw new Error('Avatar video is not ready.');
  }

  const requestedDuration = Number(payload.duration);
  const startTime = Number.isFinite(Number(payload.startTime)) && Number(payload.startTime) >= 0
    ? Number(payload.startTime)
    : Number.isFinite(Number(task.startTime)) && Number(task.startTime) >= 0
      ? Number(task.startTime)
      : 0;
  const requestedFramesPerSecond = Number(payload.framesPerSecond);
  const framesPerSecond = [16, 24, 30].includes(requestedFramesPerSecond)
    ? requestedFramesPerSecond
    : [16, 24, 30].includes(Number(task.framesPerSecond))
      ? Number(task.framesPerSecond)
      : 24;
  const shapeOverlay = normalizeString(payload.shapeOverlay) || normalizeString(task.shapeOverlay) || 'circle';
  let latestSession = await VideoSession.findOne({ _id: task.sessionId, userId });
  if (!latestSession) {
    throw new Error('VideoSession not found');
  }

  let videoPath = '';
  let probedDuration = 0;
  const ensureVideoPath = async () => {
    if (videoPath) {
      return videoPath;
    }
    videoPath = await downloadAvatarVideoAsset(task);
    const metadata = await getVideoMetadata(videoPath).catch(() => null);
    probedDuration = Number(metadata?.format?.duration);
    return videoPath;
  };

  let globalVideoId = normalizeString(task.globalVideoId);
  let globalVideo = globalVideoId
    ? getSessionGlobalVideos(latestSession).find((video) => getGlobalVideoIdValue(video) === globalVideoId)
    : null;

  if (!globalVideo) {
    await ensureVideoPath();
    const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
      ? requestedDuration
      : Number.isFinite(probedDuration) && probedDuration > 0
        ? probedDuration
        : Number.isFinite(Number(task.duration)) && Number(task.duration) > 0
          ? Number(task.duration)
          : 1;
    const fileBuffer = await fs.promises.readFile(videoPath);
    const uploadResponse = await uploadGlobalVideoForSession(userId, {
      sessionId: task.sessionId,
      fileName: 'avatar-voiceover.mp4',
      contentType: 'video/mp4',
      startTime,
      duration,
      framesPerSecond,
      shapeOverlay,
      title: 'Avatar voiceover',
      source: 'avatar_voiceover',
      fileBuffer,
    });

    globalVideo = uploadResponse?.globalVideo || null;
    globalVideoId = getGlobalVideoIdValue(globalVideo);
    latestSession = uploadResponse?.sessionDetails || await VideoSession.findOne({ _id: task.sessionId, userId });
  } else {
    const processingStatus = await getGlobalVideoProcessingStatusForSession(userId, {
      sessionId: task.sessionId,
      globalVideoId,
    }).catch(() => null);
    globalVideo = processingStatus?.globalVideo || globalVideo;
  }

  const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : Number.isFinite(Number(globalVideo?.duration)) && Number(globalVideo.duration) > 0
      ? Number(globalVideo.duration)
      : Number.isFinite(probedDuration) && probedDuration > 0
        ? probedDuration
        : Number.isFinite(Number(task.duration)) && Number(task.duration) > 0
          ? Number(task.duration)
          : 1;
  let audioLayerResponse = null;
  let existingAudioLayer = null;
  if (globalVideoId) {
    latestSession = latestSession || await VideoSession.findOne({ _id: task.sessionId, userId });
    existingAudioLayer = getSessionGlobalAudioLayers(latestSession).find((audioLayer) => (
      getGlobalAudioLayerIdValue(audioLayer) === normalizeString(task.globalAudioLayerId)
      || normalizeString(audioLayer?.globalVideoId) === globalVideoId
      || normalizeString(audioLayer?.generationMeta?.globalVideoId) === globalVideoId
    ));
    if (!existingAudioLayer) {
      const sourceAudioPath = getExistingAvatarSpeechAudioPath(task);
      const audioVideoPath = sourceAudioPath ? '' : await ensureVideoPath();
      audioLayerResponse = await addAvatarVideoGlobalAudioLayer({
        userId,
        sessionId: task.sessionId,
        globalVideoId,
        videoPath: audioVideoPath || videoPath,
        sourceAudioPath,
        startTime,
        duration,
        title: 'Avatar voiceover',
      });
      existingAudioLayer = audioLayerResponse?.globalAudioLayer || null;
      latestSession = audioLayerResponse?.sessionDetails || latestSession;
    }
  }

  task.status = 'ACCEPTED';
  task.stage = 'ACCEPTED';
  task.startTime = startTime;
  task.duration = duration;
  task.framesPerSecond = framesPerSecond;
  task.shapeOverlay = shapeOverlay;
  task.globalVideoId = globalVideoId;
  task.globalAudioLayerId = getGlobalAudioLayerIdValue(existingAudioLayer || audioLayerResponse?.globalAudioLayer) || '';
  await task.save();

  latestSession = await VideoSession.findOne({ _id: task.sessionId, userId });

  return {
    task: serializeAvatarVoiceoverTask(task),
    sessionDetails: latestSession || audioLayerResponse?.sessionDetails,
    globalVideo,
    globalAudioLayer: existingAudioLayer || audioLayerResponse?.globalAudioLayer || null,
  };
}

export async function rejectAvatarVoiceoverTask(userId, payload = {}) {
  await getDBConnectionString();
  const task = await getOwnedTask(userId, payload.taskId);
  task.status = 'REJECTED';
  task.stage = 'REJECTED';
  await task.save();

  return {
    task: serializeAvatarVoiceoverTask(task),
  };
}
