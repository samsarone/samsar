import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';

import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import { uploadSpeechAudioToCDN } from '../audio/AWS.js';
import { normalizeProviderMediaUrl } from './utils/AWS.js';
import { resolveLocalAssetPath } from '../utils/LocalAssetPath.js';
import { isDockerRuntime } from '../utils/EnvironmentUtils.js';
import {
  buildFfmpegThreadOptions,
  resolveExpressVideoFfmpegThreads,
} from '../utils/FfmpegResources.js';

const RUNWAY_API_BASE_URL = (process.env.RUNWAYML_BASE_URL || 'https://api.dev.runwayml.com').replace(/\/+$/, '');
const RUNWAY_API_VERSION = process.env.RUNWAYML_API_VERSION || '2024-11-06';
const RUNWAY_MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const AVATAR_VIDEO_MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;

function normalizeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

export async function resolveNarratorProviderMediaReference(
  reference,
  mediaType = 'media',
  normalizeMediaUrl = normalizeProviderMediaUrl,
) {
  const normalizedReference = await normalizeMediaUrl(reference, {
    mediaKind: ['image', 'video', 'audio'].includes(mediaType) ? mediaType : undefined,
  });
  const isRemoteUrl = /^https?:\/\//i.test(normalizedReference);
  const isSupportedImageDataUrl = mediaType === 'image' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalizedReference);

  if (isRemoteUrl || isSupportedImageDataUrl) {
    return normalizedReference;
  }

  throw new Error(
    `Narrator avatar ${mediaType} must resolve to a provider-readable URL${mediaType === 'image' ? ' or image data URL' : ''}.`,
  );
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
      'Runway API key is not configured for narrator avatar generation in samsar_express_video_listener. Set RUNWAYML_API_SECRET, RUNWAY_API_KEY, or RUNWAYML_API_KEY on this process.'
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

function isDockerLikeEnv() {
  return isDockerRuntime();
}

function getAssetsBasePath() {
  if (isDockerLikeEnv()) {
    return '/assets';
  }
  return path.join(process.cwd(), '../', 'samsar_processor', 'assets');
}

function normalizeAssetPath(assetPath = '') {
  let value = normalizeString(assetPath);
  if (!value) {
    return '';
  }

  value = value.split('?')[0].split('#')[0];
  value = value.replace(/^\/?assets\//, '');
  value = value.replace(/^\/?samsar_processor\/assets\//, '');
  value = value.replace(/^\/+/, '');
  return value;
}

function resolveAssetAbsolutePath(assetPath = '') {
  const value = normalizeString(assetPath);
  if (!value) {
    return '';
  }
  if (path.isAbsolute(value) && fs.existsSync(value)) {
    return value;
  }
  const normalizedAssetPath = normalizeAssetPath(value);
  return normalizedAssetPath ? path.join(getAssetsBasePath(), normalizedAssetPath) : '';
}

function getMediaPathReference(reference = '') {
  const normalizedReference = normalizeString(reference);
  if (!normalizedReference) {
    return '';
  }
  if (/^https?:\/\//i.test(normalizedReference) || normalizedReference.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(normalizedReference).pathname).replace(/^\/+/, '');
    } catch {
      return '';
    }
  }
  return normalizedReference;
}

/**
 * Resolve media consumed by this process (ffmpeg/download) without publishing
 * it through the provider tunnel. Public URL normalization belongs only at
 * the outbound Runway request boundary.
 */
export function resolveNarratorInternalMediaReference(reference) {
  const normalizedReference = normalizeString(reference);
  if (!normalizedReference) {
    return '';
  }

  const pathReference = getMediaPathReference(normalizedReference);
  const localCandidates = [normalizedReference, pathReference]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);

  for (const candidate of localCandidates) {
    const localPath = resolveLocalAssetPath(candidate);
    if (localPath && fs.existsSync(localPath)) {
      return localPath;
    }
  }

  if (/^https?:\/\//i.test(normalizedReference)) {
    return normalizedReference;
  }

  const legacyAssetPath = resolveAssetAbsolutePath(pathReference);
  if (legacyAssetPath && fs.existsSync(legacyAssetPath)) {
    return legacyAssetPath;
  }

  return normalizedReference;
}

function toAssetRelativePath(absolutePath = '') {
  const relativePath = path.relative(getAssetsBasePath(), absolutePath).split(path.sep).join('/');
  return relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
}

function getMimeTypeForAsset(assetPath = '') {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

async function getAvatarReferenceImage(sessionData = {}) {
  const imageSource = normalizeString(sessionData.narratorAvatarImageUrl)
    || normalizeString(sessionData.narratorAvatarImage);

  if (!imageSource) {
    return '';
  }
  if (/^data:image\//i.test(imageSource) || /^https?:\/\//i.test(imageSource)) {
    return imageSource;
  }

  const absolutePath = resolveAssetAbsolutePath(imageSource);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    // assets_v2 and file: references may not be rooted under this module's legacy
    // /assets lookup. Preserve the reference so the canonical provider resolver can
    // map it to the mounted asset and refresh its public URL at the request boundary.
    return imageSource;
  }

  const imageBuffer = await fs.promises.readFile(absolutePath);
  if (imageBuffer.length > RUNWAY_MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('Narrator avatar reference image is larger than Runway allows.');
  }
  return `data:${getMimeTypeForAsset(absolutePath)};base64,${imageBuffer.toString('base64')}`;
}

function isGeneratedOutroItem(item = {}) {
  const image = normalizeString(item?.image);
  const src = normalizeString(item?.src);
  return (
    image === 'server_generated_outro_image' ||
    image === 'server_generated_outro_background' ||
    image === 'server_generated_outro_qr' ||
    image === 'server_generated_outro_tile' ||
    item?.isOutroFadeOverlay === true ||
    item?.isOutroCtaText === true ||
    item?.isGeneratedOutroTile === true ||
    src.includes('video/outro/')
  );
}

function isOutroLayer(layer = {}) {
  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const hasOutroItems = activeItemList.some(isGeneratedOutroItem);
  const layerType = normalizeString(layer?.layerAiVideoType).toLowerCase();
  const baseType = normalizeString(layer?.layerBaseAiImageType).toLowerCase();
  return Boolean(
    layer?.isGeneratedOutroLayer === true ||
    layer?.generatedOutroImage === true ||
    layer?.outroImagePath ||
    layer?.outroFocusImagePath ||
    hasOutroItems ||
    (
      (layer?.skipAiVideoGeneration === true || layer?.skipAiVideoGeneration === 'true') &&
      layerType === 'none' &&
      baseType === 'none'
    )
  );
}

function getSceneLayersForNarratorAvatar(sessionData = {}) {
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const sceneLayers = layers.filter((layer) => !isOutroLayer(layer));
  return sceneLayers.length ? sceneLayers : layers;
}

function resolveNarratorAvatarDurationSeconds(sessionData = {}) {
  const sceneLayers = getSceneLayersForNarratorAvatar(sessionData);
  const layerEnd = sceneLayers.reduce((maxEnd, layer) => {
    const start = Number(layer?.durationOffset);
    const duration = Number(layer?.duration);
    return Number.isFinite(start) && Number.isFinite(duration)
      ? Math.max(maxEnd, start + duration)
      : maxEnd;
  }, 0);
  if (layerEnd > 0) {
    return layerEnd;
  }

  const audioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];
  return audioLayers.reduce((maxEnd, layer) => {
    const end = Number(layer?.endTime);
    return Number.isFinite(end) ? Math.max(maxEnd, end) : maxEnd;
  }, 0);
}

function isNarratorSpeechLayer(layer = {}) {
  const generationType = normalizeString(layer.generationType).toLowerCase();
  if (generationType !== 'speech') {
    return false;
  }

  const subType = normalizeString(layer.subType).toLowerCase();
  const type = normalizeString(layer.type).toLowerCase();
  if (subType === 'narration' || subType === 'narrator' || type === 'narrator') {
    return true;
  }

  const labels = [
    layer.speaker,
    layer.actor,
    layer.Identity,
    layer.speakerCharacterName,
  ].map((value) => normalizeString(value).toLowerCase());
  return labels.some((value) => value.includes('narrator'));
}

function getAudioLayerSource(layer = {}) {
  const localCandidates = [
    layer.selectedLocalAudioLink,
    ...(Array.isArray(layer.localAudioLinks) ? layer.localAudioLinks : []),
  ].map(normalizeString).filter(Boolean);

  for (const candidate of localCandidates) {
    const absolutePath = resolveAssetAbsolutePath(candidate);
    if (absolutePath && fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  const remoteCandidates = [
    layer.selectedRemoteAudioLink,
    ...(Array.isArray(layer.remoteAudioLinks) ? layer.remoteAudioLinks : []),
    ...(Array.isArray(layer.remoteAudioData)
      ? layer.remoteAudioData.map((audioData) => audioData?.audio_url || audioData?.audioUrl)
      : []),
  ].map(normalizeString).filter(Boolean);

  return remoteCandidates.find((candidate) => /^https?:\/\//i.test(candidate)) || '';
}

function getNarratorSpeechSegments(sessionData = {}) {
  const audioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const outroLayerIds = new Set(
    layers
      .filter(isOutroLayer)
      .map((layer) => layer?._id?.toString?.() || layer?._id)
      .filter(Boolean)
  );
  const avatarDurationSeconds = resolveNarratorAvatarDurationSeconds(sessionData);

  return audioLayers
    .filter(isNarratorSpeechLayer)
    .map((layer) => {
      const connectedLayerId = layer?.connectedLayerId?.toString?.() || layer?.connectedLayerId;
      if (connectedLayerId && outroLayerIds.has(connectedLayerId)) {
        return null;
      }
      const startTime = Math.max(0, Number(layer.startTime) || 0);
      const durationCandidate = Number(layer.duration);
      const endCandidate = Number(layer.endTime);
      let duration = Number.isFinite(durationCandidate) && durationCandidate > 0
        ? durationCandidate
        : Number.isFinite(endCandidate) && endCandidate > startTime
          ? endCandidate - startTime
          : 0;
      if (Number.isFinite(avatarDurationSeconds) && avatarDurationSeconds > 0) {
        if (startTime >= avatarDurationSeconds) {
          duration = 0;
        } else {
          duration = Math.min(duration, avatarDurationSeconds - startTime);
        }
      }
      return {
        layer,
        source: getAudioLayerSource(layer),
        startTime,
        duration,
      };
    })
    .filter(Boolean)
    .filter((segment) => segment.duration > 0)
    .sort((left, right) => left.startTime - right.startTime);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
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

export function buildNarratorAudioFfmpegArgs({
  durationSeconds,
  resolvedSegments,
  outputPath,
  ffmpegThreads = resolveExpressVideoFfmpegThreads(),
}) {
  const {
    inputOptions,
    filterOptions,
    outputOptions,
  } = buildFfmpegThreadOptions({
    threads: ffmpegThreads,
    inputThreads: 1,
    complexFilter: true,
  });
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-t',
    `${durationSeconds}`,
    ...inputOptions,
    '-i',
    'anullsrc=r=44100:cl=stereo',
  ];

  resolvedSegments.forEach((segment) => {
    args.push(...inputOptions, '-i', segment.source);
  });

  const filterParts = resolvedSegments.map((segment, index) => {
    const inputIndex = index + 1;
    const delayMs = Math.max(0, Math.round(segment.startTime * 1000));
    const duration = Math.max(0.01, segment.duration);
    return `[${inputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${duration},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[n${index}]`;
  });
  const mixInputs = ['[0:a]', ...resolvedSegments.map((_, index) => `[n${index}]`)].join('');
  filterParts.push(`${mixInputs}amix=inputs=${resolvedSegments.length + 1}:duration=first:dropout_transition=0[mix]`);

  args.push(
    ...filterOptions,
    '-filter_complex', filterParts.join(';'),
    '-map', '[mix]',
    '-t', `${durationSeconds}`,
    '-ac', '2',
    '-ar', '44100',
    '-b:a', '192k',
    ...outputOptions,
    outputPath,
  );

  return args;
}

async function buildContinuousNarratorAudio(sessionData = {}) {
  const durationSeconds = resolveNarratorAvatarDurationSeconds(sessionData);
  const existingAudioPath = resolveAssetAbsolutePath(sessionData.narratorAvatarAudioAssetPath);
  const existingAudioUrl = normalizeString(sessionData.narratorAvatarAudioUrl);
  const existingDurationSeconds = Number(sessionData.narratorAvatarAudioDuration);
  const existingDurationMatches = Number.isFinite(existingDurationSeconds) &&
    Math.abs(existingDurationSeconds - durationSeconds) < 0.25;
  if (
    existingAudioPath &&
    fs.existsSync(existingAudioPath) &&
    /^https?:\/\//i.test(existingAudioUrl) &&
    existingDurationMatches
  ) {
    return {
      audioPath: existingAudioPath,
      audioUrl: existingAudioUrl,
      durationSeconds,
    };
  }

  const sessionId = sessionData?._id?.toString?.() || sessionData?._id;
  const segments = getNarratorSpeechSegments(sessionData);
  if (!segments.length || !(durationSeconds > 0)) {
    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          narratorAvatarGenerationSkipped: true,
          narratorAvatarAudioStatus: 'SKIPPED',
          narratorAvatarVideoStatus: 'SKIPPED',
          narratorAvatarStatus: 'SKIPPED',
        },
      }
    );
    return { skipped: true };
  }

  const missingSource = segments.find((segment) => !segment.source);
  if (missingSource) {
    await VideoSession.updateOne(
      { _id: sessionId },
      { $set: { narratorAvatarAudioStatus: 'PENDING' } }
    );
    return { pending: true };
  }

  const resolvedSegments = segments.map((segment) => ({
    ...segment,
    source: resolveNarratorInternalMediaReference(segment.source),
  }));

  const outputDir = path.join(getAssetsBasePath(), 'video', 'narrator_avatar', 'audio', sessionId.toString());
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'narrator_avatar.mp3');

  const args = buildNarratorAudioFfmpegArgs({
    durationSeconds,
    resolvedSegments,
    outputPath,
  });

  await runFfmpeg(args);
  const stats = await fs.promises.stat(outputPath);
  if (!stats?.isFile() || stats.size === 0) {
    throw new Error('Narrator avatar speech audio was empty.');
  }

  const remoteFileName = `${sessionId}_narrator_avatar_${Date.now()}.mp3`;
  const audioUrl = await uploadSpeechAudioToCDN(outputPath, remoteFileName);
  const assetPath = toAssetRelativePath(outputPath);
  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        narratorAvatarAudioStatus: 'COMPLETED',
        narratorAvatarAudioAssetPath: assetPath,
        narratorAvatarAudioUrl: audioUrl,
        narratorAvatarAudioDuration: durationSeconds,
        narratorAvatarSceneDurationSeconds: durationSeconds,
        narratorAvatarSpeechSegments: segments.map((segment) => ({
          audioLayerId: segment.layer?._id?.toString?.() || segment.layer?._id || null,
          startTime: segment.startTime,
          duration: segment.duration,
        })),
      },
    }
  );

  return { audioPath: outputPath, audioUrl, durationSeconds };
}

function getNarratorAvatarVoicePreset(sessionData = {}) {
  const narratorLayer = getNarratorSpeechSegments(sessionData)[0]?.layer;
  const gender = normalizeString(narratorLayer?.gender).toUpperCase();
  return gender === 'M' ? 'adrian' : 'clara';
}

function buildAvatarPersonality(sessionData = {}) {
  const prompt = normalizeString(sessionData.narratorAvatarImagePrompt);
  const base = [
    'You are an influencer-style video narrator.',
    'Speak clearly, naturally, and confidently for an image-list video voice-over.',
    'Stay aligned with the provided narration audio and do not improvise.',
  ].join(' ');
  return prompt ? `${base}\n\nPersona context:\n${prompt}`.slice(0, 2000) : base;
}

async function ensureRunwayNarratorAvatar(sessionData = {}) {
  const sessionId = sessionData?._id?.toString?.() || sessionData?._id;
  const existingAvatarId = normalizeString(sessionData.narratorAvatarId);
  const existingStatus = normalizeString(sessionData.narratorAvatarStatus).toUpperCase();

  if (existingAvatarId && existingStatus === 'READY') {
    return { avatarId: existingAvatarId };
  }

  if (existingAvatarId) {
    const avatar = await runwayGet(`/v1/avatars/${existingAvatarId}`);
    const nextStatus = normalizeString(avatar?.status).toUpperCase();
    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          narratorAvatarStatus: nextStatus || 'PROCESSING',
          narratorAvatarRunwayResponse: avatar,
          ...(nextStatus === 'READY' ? { narratorAvatarError: '' } : {}),
        },
      }
    );

    if (nextStatus === 'READY') {
      return { avatarId: existingAvatarId };
    }
    if (nextStatus === 'FAILED') {
      throw new Error('Runway could not create the narrator avatar from this image.');
    }
    return { pending: true };
  }

  const imageStatus = normalizeString(sessionData.narratorAvatarImageStatus).toUpperCase();
  if (imageStatus !== 'COMPLETED') {
    return { pending: true };
  }

  const referenceImageSource = await getAvatarReferenceImage(sessionData);
  if (!referenceImageSource) {
    return { pending: true };
  }

  const avatarRequest = {
    name: 'Samsar narrator avatar',
    referenceImage: referenceImageSource,
    personality: buildAvatarPersonality(sessionData),
    voice: {
      type: 'runway-live-preset',
      presetId: getNarratorAvatarVoicePreset(sessionData),
    },
    imageProcessing: 'optimize',
  };
  avatarRequest.referenceImage = await resolveNarratorProviderMediaReference(
    avatarRequest.referenceImage,
    'image',
  );
  const avatar = await runwayPost('/v1/avatars', avatarRequest);

  const runwayAvatarStatus = normalizeString(avatar?.status).toUpperCase() || 'PROCESSING';
  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        narratorAvatarId: avatar?.id || '',
        narratorAvatarStatus: runwayAvatarStatus,
        narratorAvatarRunwayResponse: avatar,
        narratorAvatarError: '',
      },
    }
  );

  if (runwayAvatarStatus === 'READY') {
    return { avatarId: avatar?.id || '' };
  }
  return { pending: true };
}

function isTerminalRunwayTaskStatus(status = '') {
  return ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(normalizeString(status).toUpperCase());
}

async function downloadAvatarVideoAsset(sessionData = {}, videoUrl = '') {
  const sessionId = sessionData?._id?.toString?.() || sessionData?._id;
  const existingAssetPath = resolveAssetAbsolutePath(sessionData.narratorAvatarVideoAssetPath);
  if (existingAssetPath && fs.existsSync(existingAssetPath)) {
    return {
      absolutePath: existingAssetPath,
      assetPath: normalizeString(sessionData.narratorAvatarVideoAssetPath),
    };
  }

  const outputDir = path.join(getAssetsBasePath(), 'video', 'narrator_avatar', 'video', sessionId.toString());
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'narrator_avatar.mp4');

  const internalVideoReference = resolveNarratorInternalMediaReference(videoUrl);
  if (path.isAbsolute(internalVideoReference) && fs.existsSync(internalVideoReference)) {
    if (path.resolve(internalVideoReference) !== path.resolve(outputPath)) {
      await fs.promises.copyFile(internalVideoReference, outputPath);
    }
  } else {
    const response = await axios.get(internalVideoReference, {
      responseType: 'stream',
      timeout: 120000,
      maxContentLength: AVATAR_VIDEO_MAX_FILE_SIZE_BYTES,
      maxBodyLength: AVATAR_VIDEO_MAX_FILE_SIZE_BYTES,
    });
    await pipeline(response.data, fs.createWriteStream(outputPath));
  }

  const stats = await fs.promises.stat(outputPath);
  if (!stats?.isFile() || stats.size === 0) {
    throw new Error('Downloaded narrator avatar video was empty.');
  }
  if (stats.size > AVATAR_VIDEO_MAX_FILE_SIZE_BYTES) {
    fs.rmSync(outputPath, { force: true });
    throw new Error('Narrator avatar video must be 512 MB or smaller.');
  }

  return {
    absolutePath: outputPath,
    assetPath: toAssetRelativePath(outputPath),
  };
}

async function ensureRunwayNarratorAvatarVideo(sessionData = {}, avatarId, audioReference = {}) {
  const sessionId = sessionData?._id?.toString?.() || sessionData?._id;
  const existingAssetPath = resolveAssetAbsolutePath(sessionData.narratorAvatarVideoAssetPath);
  if (existingAssetPath && fs.existsSync(existingAssetPath)) {
    return { completed: true };
  }

  const existingTaskId = normalizeString(sessionData.narratorAvatarVideoTaskId);
  if (!existingTaskId) {
    const avatarVideoRequest = {
      model: 'gwm1_avatars',
      avatar: {
        type: 'custom',
        avatarId,
      },
      speech: {
        type: 'audio',
        audio: audioReference.audioUrl || audioReference.audioPath,
      },
    };
    avatarVideoRequest.speech.audio = await resolveNarratorProviderMediaReference(
      avatarVideoRequest.speech.audio,
      'audio',
    );
    const avatarVideo = await runwayPost('/v1/avatar_videos', avatarVideoRequest);

    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          narratorAvatarVideoTaskId: avatarVideo?.id || '',
          narratorAvatarVideoStatus: 'PENDING',
          narratorAvatarVideoRunwayResponse: avatarVideo,
          narratorAvatarVideoError: '',
        },
      }
    );
    return { pending: true };
  }

  const videoTask = await runwayGet(`/v1/tasks/${existingTaskId}`);
  const nextStatus = normalizeString(videoTask?.status).toUpperCase();
  const outputUrl = (Array.isArray(videoTask?.output) ? normalizeString(videoTask.output[0]) : '')
    || normalizeString(sessionData.narratorAvatarVideoUrl);

  const baseUpdate = {
    narratorAvatarVideoStatus: nextStatus || 'PENDING',
    narratorAvatarVideoRunwayResponse: videoTask,
  };

  if (nextStatus === 'SUCCEEDED' && outputUrl) {
    const downloadedVideo = await downloadAvatarVideoAsset(sessionData, outputUrl);
    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          ...baseUpdate,
          narratorAvatarVideoStatus: 'COMPLETED',
          narratorAvatarVideoUrl: outputUrl,
          narratorAvatarVideoAssetPath: downloadedVideo.assetPath,
          narratorAvatarVideoError: '',
        },
      }
    );
    return { completed: true };
  }

  await VideoSession.updateOne({ _id: sessionId }, { $set: baseUpdate });
  if (isTerminalRunwayTaskStatus(nextStatus)) {
    throw new Error(videoTask?.failure || 'Runway narrator avatar video generation failed.');
  }
  return { pending: true };
}

export async function ensureNarratorAvatarVideoForSession(sessionId) {
  await getDBConnectionString();

  const sessionData = await VideoSession.findById(sessionId).lean();
  if (!sessionData) {
    return { status: 'FAILED', error: 'VideoSession not found.' };
  }

  const shouldAddAvatar = sessionData.addNarratorAvatar === true || sessionData.add_narrator_avatar === true;
  if (!shouldAddAvatar) {
    return { status: 'SKIPPED' };
  }

  try {
    const avatarResult = await ensureRunwayNarratorAvatar(sessionData);
    if (avatarResult.pending) {
      return { status: 'PENDING' };
    }

    const audioResult = await buildContinuousNarratorAudio(await VideoSession.findById(sessionId).lean());
    if (audioResult.skipped) {
      return { status: 'SKIPPED' };
    }
    if (audioResult.pending) {
      return { status: 'PENDING' };
    }

    const refreshedSession = await VideoSession.findById(sessionId).lean();
    const videoResult = await ensureRunwayNarratorAvatarVideo(
      refreshedSession,
      avatarResult.avatarId,
      audioResult,
    );
    if (videoResult.completed) {
      return { status: 'COMPLETED' };
    }
    return { status: 'PENDING' };
  } catch (error) {
    const message = error?.response?.data?.error
      || error?.response?.data?.message
      || error?.message
      || 'Narrator avatar generation failed.';
    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          narratorAvatarStatus: 'FAILED',
          narratorAvatarVideoStatus: 'FAILED',
          narratorAvatarError: message,
          narratorAvatarVideoError: message,
        },
      }
    );
    return { status: 'FAILED', error: message };
  }
}
