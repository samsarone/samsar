import { Types } from 'mongoose';
import OpenAI from 'openai';

import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';
import { createCompatibleChatCompletion } from '../ai_utils/OpenAICompat.js';

import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';

const JOIN_VIDEOS_CREDITS_PER_SECOND = 3;
const DEFAULT_FRAMES_PER_SECOND = 24;
const VALID_FRAMES_PER_SECOND = new Set([16, 24, 30]);
const SCENE_BLEND_BOUNDARY_SECONDS = 0.5;
const OUTRO_BLEND_FADE_SECONDS = 1;
const FRAME_ROUNDING_EPSILON = 1e-9;
const JOIN_VIDEO_TITLE_MODEL = process.env.JOIN_VIDEO_TITLE_MODEL || 'gpt-5.2';
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function resolveFramesPerSecond(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_FRAMES_PER_SECOND;
  }
  const rounded = Math.round(parsed);
  return VALID_FRAMES_PER_SECOND.has(rounded) ? rounded : DEFAULT_FRAMES_PER_SECOND;
}

async function createNewBlankVideoSession(userId) {
  const userData = await User.findById(userId).select('videoFramesPerSecond').lean();
  const framesPerSecond = resolveFramesPerSecond(userData?.videoFramesPerSecond);
  const newSession = await VideoSession.create({ userId, framesPerSecond });
  return newSession._id.toString();
}

function createNewObjectId() {
  return new Types.ObjectId();
}

function getFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeJoinedTitle(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 90);
}

function resolveSourceVideoTitle(sessionData = {}) {
  return normalizeJoinedTitle(getFirstNonEmptyString(
    sessionData?.publishedTitle,
    sessionData?.sessionName,
    sessionData?.title,
    sessionData?.metadata?.title,
    sessionData?.sessionReceipt?.title,
  ));
}

function resolveSourceVideoTitles(sessionDataList = []) {
  const seen = new Set();
  const titles = [];
  for (const sessionData of sessionDataList) {
    const title = resolveSourceVideoTitle(sessionData);
    const key = title.toLowerCase();
    if (title && !seen.has(key)) {
      seen.add(key);
      titles.push(title);
    }
  }
  return titles;
}

function buildFallbackJoinedVideoTitle(sourceTitles = []) {
  const title = sourceTitles.length > 0
    ? `Joined reel: ${sourceTitles.join(' + ')}`
    : 'Joined reel';
  return normalizeJoinedTitle(title);
}

async function generateJoinedVideoTitle(sessionDataList = []) {
  const sourceTitles = resolveSourceVideoTitles(sessionDataList);
  const fallbackTitle = buildFallbackJoinedVideoTitle(sourceTitles);

  if (sourceTitles.length < 2 || !openai) {
    return { title: fallbackTitle, sourceTitles };
  }

  try {
    const response = await createCompatibleChatCompletion(openai, {
      model: JOIN_VIDEO_TITLE_MODEL,
      messages: [
        {
          role: 'system',
          content: 'Create one concise title for a joined short-form video from the source video titles. Use 4 to 9 words. Do not use quotes, emojis, hashtags, or a trailing period.',
        },
        {
          role: 'user',
          content: JSON.stringify({ sourceTitles }),
        },
      ],
      max_tokens: 48,
      reasoning: { effort: 'low' },
    });
    const generatedTitle = normalizeJoinedTitle(response?.choices?.[0]?.message?.content);
    return { title: generatedTitle || fallbackTitle, sourceTitles };
  } catch (error) {
    console.error('[join_videos] Failed to generate joined video title:', error?.message || error);
    return { title: fallbackTitle, sourceTitles };
  }
}

function normalizePositiveNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function resolveSessionDurationSeconds(sessionData = {}) {
  const totalDuration = Number(sessionData?.totalDuration);
  if (Number.isFinite(totalDuration) && totalDuration > 0) {
    return totalDuration;
  }

  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  if (!layers.length) {
    return 0;
  }

  let maxEnd = 0;
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') {
      continue;
    }
    const offset = Number(layer.durationOffset) || 0;
    const duration = Number(layer.duration) || 0;
    const end = offset + duration;
    if (Number.isFinite(end) && end > maxEnd) {
      maxEnd = end;
    }
  }

  if (Number.isFinite(maxEnd) && maxEnd > 0) {
    return maxEnd;
  }

  const summed = layers.reduce((sum, layer) => sum + (Number(layer?.duration) || 0), 0);
  return Number.isFinite(summed) && summed > 0 ? summed : 0;
}

function resolveSessionDurationFromLayersAndOffsets({
  layers = [],
  normalizedOffsets = [],
  fallbackDuration = 0,
}) {
  let maxEnd = 0;

  for (let idx = 0; idx < layers.length; idx += 1) {
    const layer = layers[idx];
    if (!layer || typeof layer !== 'object') {
      continue;
    }

    const offset = Number(normalizedOffsets[idx]) || 0;
    const duration = Number(layer.duration) || 0;
    const end = offset + duration;
    if (Number.isFinite(end) && end > maxEnd) {
      maxEnd = end;
    }
  }

  if (maxEnd > 0) {
    return maxEnd;
  }

  return Number(fallbackDuration) > 0 ? Number(fallbackDuration) : 0;
}

function normalizeLayerDurationOffsets(layers = []) {
  let fallbackOffset = 0;
  return layers.map((layer) => {
    if (!layer || typeof layer !== 'object') {
      return fallbackOffset;
    }

    const explicitOffset = Number(layer.durationOffset);
    const duration = Number(layer.duration) || 0;

    const offset = Number.isFinite(explicitOffset) ? explicitOffset : fallbackOffset;
    fallbackOffset = offset + duration;
    return offset;
  });
}

function frameCountToSeconds(frameCount, framesPerSecond) {
  const fps = resolveFramesPerSecond(framesPerSecond);
  const frames = Number(frameCount);
  if (!Number.isFinite(frames) || frames <= 0) {
    return 0;
  }
  return frames / fps;
}

function floorSecondsToFrameCount(seconds, framesPerSecond, { minimumFrames = 0 } = {}) {
  const fps = resolveFramesPerSecond(framesPerSecond);
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    return Math.max(0, minimumFrames);
  }

  const floored = Math.floor((value * fps) + FRAME_ROUNDING_EPSILON);
  return Math.max(floored, Math.max(0, minimumFrames));
}

function isAudioLayerType(audioLayer, type) {
  const rawType = audioLayer?.generationType;
  if (typeof rawType !== 'string') {
    return false;
  }
  return rawType.trim().toLowerCase() === type;
}

function resolveAudioLayerType(audioLayer) {
  const rawType = audioLayer?.generationType;
  if (typeof rawType !== 'string') {
    return '';
  }
  return rawType.trim().toLowerCase();
}

function isMusicLikeAudioLayer(audioLayer) {
  const type = resolveAudioLayerType(audioLayer);
  return (
    type === 'music' ||
    type === 'background_music' ||
    type === 'background music' ||
    type === 'bgm' ||
    type === 'backing_track' ||
    type === 'backing track'
  );
}

function isSpeechOrSoundEffectAudioLayer(audioLayer) {
  const rawType = audioLayer?.generationType;
  if (typeof rawType !== 'string') {
    return false;
  }
  const normalized = rawType.trim().toLowerCase();
  return normalized === 'speech' || normalized === 'sound_effect' || normalized === 'sound';
}

function normalizeOptionalInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeExpressGenerationStatusForJoin(existingStatus = {}) {
  const status = { ...(existingStatus || {}) };
  const allStatusKeys = new Set([
    ...Object.keys(status),
    'prompt_generation',
    'image_generation',
    'audio_generation',
    'frame_generation',
    'video_generation',
    'ai_video_generation',
    'speech_generation',
    'music_generation',
    'lip_sync_generation',
    'sound_effect_generation',
    'delete_reflow',
    'timeline_reflowed',
    'transcript_generation',
  ]);

  for (const key of allStatusKeys) {
    status[key] = 'COMPLETED';
  }

  status.transcript_generation = 'INIT';
  status.frame_generation = 'INIT';
  status.video_generation = 'INIT';

  return status;
}

function buildPathCandidates(pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return new Set();
  }

  const normalized = pathValue.trim();
  const withoutLeadingSlash = normalized.replace(/^\//, '');
  const withLeadingSlash = withoutLeadingSlash ? `/${withoutLeadingSlash}` : normalized;

  return new Set([normalized, withoutLeadingSlash, withLeadingSlash]);
}

function resolveOutroImageItemFromSession(sessionData = {}) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  if (!layers.length) {
    return null;
  }

  const outroCandidates = buildPathCandidates(sessionData?.outroImageURL);

  for (let idx = layers.length - 1; idx >= 0; idx -= 1) {
    const activeItemList = layers[idx]?.imageSession?.activeItemList;
    if (!Array.isArray(activeItemList) || !activeItemList.length) {
      continue;
    }

    const imageItems = activeItemList.filter((item) => item?.type === 'image' && typeof item?.src === 'string');
    if (!imageItems.length) {
      continue;
    }

    const matchingOutroItem = imageItems.find((item) => {
      const srcCandidates = buildPathCandidates(item.src);
      if (!srcCandidates.size || !outroCandidates.size) {
        return false;
      }
      for (const srcCandidate of srcCandidates) {
        if (outroCandidates.has(srcCandidate)) {
          return true;
        }
      }
      return false;
    });
    if (matchingOutroItem) {
      return matchingOutroItem;
    }

    if (sessionData?.hasOutroImage) {
      const fallbackOutroItem = imageItems.find((item) => item?.is_base_image) || imageItems[0];
      if (fallbackOutroItem) {
        return fallbackOutroItem;
      }
    }
  }

  return null;
}

function buildBlendCarryOverImageItem(sourceItem = {}) {
  if (!sourceItem || typeof sourceItem !== 'object') {
    return null;
  }

  const src = typeof sourceItem.src === 'string' ? sourceItem.src.trim() : '';
  if (!src) {
    return null;
  }

  const x = Number(sourceItem.x);
  const y = Number(sourceItem.y);
  const width = Number(sourceItem.width);
  const height = Number(sourceItem.height);

  const currentTransform = sourceItem?.currentTransform && typeof sourceItem.currentTransform === 'object'
    ? sourceItem.currentTransform
    : {};

  const resolvedTranslateX = Number(currentTransform.translateX);
  const resolvedTranslateY = Number(currentTransform.translateY);
  const resolvedScale = Number(currentTransform.scale);
  const resolvedRotate = Number(currentTransform.rotateAngle);

  return {
    type: 'image',
    id: `blend_outro_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    image: typeof sourceItem.image === 'string' ? sourceItem.image : '',
    src,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
    is_base_image: false,
    isBlendCarryOver: true,
    currentTransform: {
      scale: Number.isFinite(resolvedScale) ? resolvedScale : 1,
      translateX: Number.isFinite(resolvedTranslateX) ? resolvedTranslateX : (Number.isFinite(x) ? x : 0),
      translateY: Number.isFinite(resolvedTranslateY) ? resolvedTranslateY : (Number.isFinite(y) ? y : 0),
      rotateAngle: Number.isFinite(resolvedRotate) ? resolvedRotate : 0,
    },
    animations: [],
  };
}

function buildBlendFadeAnimations({
  layerDuration,
  framesPerSecond,
}) {
  const fps = resolveFramesPerSecond(framesPerSecond);
  const totalFrames = Math.max(1, Math.round((Number(layerDuration) || 0) * fps));
  const fadeFrames = Math.max(1, Math.round(OUTRO_BLEND_FADE_SECONDS * fps));

  const animations = [{
    type: 'fade',
    params: {
      startFade: 100,
      endFade: 0,
    },
    frameOffset: 0,
    frameDuration: Math.min(totalFrames, fadeFrames),
  }];

  if (totalFrames > fadeFrames) {
    animations.push({
      type: 'fade',
      params: {
        startFade: 0,
        endFade: 0,
      },
      frameOffset: fadeFrames,
      frameDuration: totalFrames - fadeFrames,
    });
  }

  return animations;
}

function injectOutroBlendItemIntoSession({
  sessionData,
  previousOutroImageItem,
  framesPerSecond,
}) {
  if (!sessionData || typeof sessionData !== 'object' || !previousOutroImageItem) {
    return;
  }

  const firstLayer = Array.isArray(sessionData.layers) ? sessionData.layers[0] : null;
  if (!firstLayer || typeof firstLayer !== 'object') {
    return;
  }

  const imageSession = firstLayer.imageSession && typeof firstLayer.imageSession === 'object'
    ? firstLayer.imageSession
    : {};
  const activeItemList = Array.isArray(imageSession.activeItemList) ? imageSession.activeItemList : [];

  const blendItem = buildBlendCarryOverImageItem(previousOutroImageItem);
  if (!blendItem) {
    return;
  }
  blendItem.animations = buildBlendFadeAnimations({
    layerDuration: firstLayer.duration,
    framesPerSecond,
  });

  imageSession.activeItemList = [...activeItemList, blendItem];
  firstLayer.imageSession = imageSession;
  sessionData.layers[0] = firstLayer;
}

function prepareSessionForJoin({
  clonedSession,
  webhookUrl,
  totalDuration,
}) {
  clonedSession.videoLink = null;
  clonedSession.remoteURL = null;

  clonedSession.videoGenerationPending = false;
  clonedSession.frameGenerationPending = false;
  clonedSession.audioGenerationPending = false;
  clonedSession.transcriptGenerationPending = true;

  clonedSession.expressGenerationPending = true;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationError = null;
  clonedSession.provisionalCredits = 0;

  clonedSession.isExpressGeneration = true;
  clonedSession.expressGenerativeVideoRequired = false;
  clonedSession.expressGenerativeSpeechRequired = false;
  clonedSession.addNarratorAvatar = false;
  clonedSession.add_narrator_avatar = false;
  clonedSession.narratorAvatarGenerationSkipped = true;

  clonedSession.totalDuration = totalDuration;

  if (webhookUrl) {
    clonedSession.externalWebhook = webhookUrl;
  }

  clonedSession.expressGenerationStatus = normalizeExpressGenerationStatusForJoin(
    clonedSession.expressGenerationStatus,
  );
}

function resolveJoinedNarratorAvatarAssetPath(sessionData = {}) {
  return getFirstNonEmptyString(
    sessionData.narratorAvatarVideoAssetPath,
    sessionData.narratorAvatarVideoPath,
  );
}

function hasCompletedNarratorAvatarVideo(sessionData = {}) {
  const shouldAddAvatar = sessionData.addNarratorAvatar === true || sessionData.add_narrator_avatar === true;
  const videoStatus = typeof sessionData.narratorAvatarVideoStatus === 'string'
    ? sessionData.narratorAvatarVideoStatus.trim().toUpperCase()
    : '';
  return shouldAddAvatar && videoStatus === 'COMPLETED' && Boolean(resolveJoinedNarratorAvatarAssetPath(sessionData));
}

function buildJoinedNarratorAvatarOverlay({
  sessionData,
  sessionOffset,
  effectiveSessionDuration,
}) {
  if (!hasCompletedNarratorAvatarVideo(sessionData)) {
    return null;
  }

  const startTime = Number(sessionOffset) || 0;
  const duration = Math.max(0, Number(effectiveSessionDuration) || 0);
  if (duration <= 0) {
    return null;
  }

  return {
    source: 'narrator_avatar',
    assetPath: resolveJoinedNarratorAvatarAssetPath(sessionData),
    startTime,
    endTime: startTime + duration,
    duration,
    framesPerSecond: resolveFramesPerSecond(sessionData.framesPerSecond),
    sourceSessionId: sessionData?._id?.toString?.() || sessionData?.id?.toString?.() || null,
  };
}

function prepareLayerForJoin(layer) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  layer.frameGenerationPending = true;
  layer.aiVideoFrameGenerationPending = false;
  layer.frames = [];

  layer.aiVideoGenerationPending = false;
  layer.lipSyncGenerationPending = false;
  layer.soundEffectGenerationPending = false;

  const imageSession = layer.imageSession;
  if (imageSession && typeof imageSession === 'object') {
    imageSession.generationStatus = 'COMPLETED';
    if (imageSession.editStatus !== 'INIT' && imageSession.editStatus !== 'COMPLETED') {
      imageSession.editStatus = 'COMPLETED';
    }

    const activeItemList = imageSession.activeItemList;
    if (Array.isArray(activeItemList)) {
      imageSession.activeItemList = activeItemList.map((item) => {
        if (!item || typeof item !== 'object') {
          return item;
        }
        return { ...item, _id: createNewObjectId() };
      });
    }
  }

  const aiStatus = layer.aiVideoGenerationStatus;
  if (aiStatus && aiStatus !== 'COMPLETED' && aiStatus !== 'FAILED') {
    layer.aiVideoGenerationStatus = 'COMPLETED';
  }

  const lipSyncStatus = layer.lipSyncVideoGenerationStatus;
  if (lipSyncStatus && lipSyncStatus !== 'COMPLETED' && lipSyncStatus !== 'FAILED') {
    layer.lipSyncVideoGenerationStatus = 'COMPLETED';
  }

  const soundEffectStatus = layer.soundEffectVideoGenerationStatus;
  if (soundEffectStatus && soundEffectStatus !== 'COMPLETED' && soundEffectStatus !== 'FAILED') {
    layer.soundEffectVideoGenerationStatus = 'COMPLETED';
  }

  const filterPasses = layer.filterPasses;
  if (Array.isArray(filterPasses)) {
    layer.filterPasses = filterPasses.map((pass) => {
      if (!pass || typeof pass !== 'object') {
        return pass;
      }
      return { ...pass, _id: createNewObjectId() };
    });
  }

  return layer;
}

function isCharacterLipSyncLayer(layer) {
  if (!layer || typeof layer !== 'object') {
    return false;
  }

  const hasLipSyncVideo = layer.hasLipSyncVideoLayer === true || layer.layerAiVideoType === 'lip_sync';
  if (!hasLipSyncVideo) {
    return false;
  }

  const normalizedBaseType = typeof layer.layerBaseAiImageType === 'string'
    ? layer.layerBaseAiImageType.trim().toLowerCase()
    : '';
  const normalizedLayerType = typeof layer.layerAiVideoType === 'string'
    ? layer.layerAiVideoType.trim().toLowerCase()
    : '';

  return (
    normalizedBaseType === 'character' ||
    normalizedLayerType === 'character' ||
    normalizedLayerType === 'lip_sync'
  );
}

function isAiBackedLayer(layer) {
  if (!layer || typeof layer !== 'object') {
    return false;
  }
  const normalizedLayerType = typeof layer.layerAiVideoType === 'string'
    ? layer.layerAiVideoType.trim().toLowerCase()
    : '';
  return Boolean(
    layer.hasAiVideoLayer === true ||
    layer.hasLipSyncVideoLayer === true ||
    layer.hasSoundEffectVideoLayer === true ||
    normalizedLayerType === 'ai_video' ||
    normalizedLayerType === 'lip_sync' ||
    normalizedLayerType === 'sound_effect' ||
    normalizedLayerType === 'character' ||
    normalizedLayerType === 'scene',
  );
}

function parseFrameIndexFromPath(framePath) {
  if (typeof framePath !== 'string' || !framePath.trim()) {
    return null;
  }
  const normalized = framePath.trim().split('?')[0].split('#')[0];
  const match = normalized.match(/\/(\d+)\.png$/i);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isLikelyLipSyncPaddingItem(item) {
  if (!item || typeof item !== 'object' || item.type !== 'image') {
    return false;
  }

  const itemId = typeof item.id === 'string' ? item.id : '';
  if (/^item_(pad|padding|last_frame)_/i.test(itemId)) {
    return true;
  }

  const frameOffset = Number(item?.config?.frameOffset);
  const frameDuration = Number(item?.config?.frameDuration);
  if (item?.is_config_image === true && Number.isFinite(frameOffset) && Number.isFinite(frameDuration)) {
    return true;
  }

  return false;
}

function resolveRenderedFrameCountFromLayer(layer, fps) {
  const startFrameIndex = parseFrameIndexFromPath(layer?.aiLayerStartFrame);
  const endFrameIndex = parseFrameIndexFromPath(layer?.aiLayerEndFrame);

  if (Number.isFinite(endFrameIndex) && Number.isFinite(startFrameIndex) && endFrameIndex >= startFrameIndex) {
    return (endFrameIndex - startFrameIndex) + 1;
  }
  if (Number.isFinite(endFrameIndex) && endFrameIndex >= 0) {
    return endFrameIndex + 1;
  }

  const frameListCount = Array.isArray(layer?.frames) ? layer.frames.length : 0;
  if (frameListCount > 0) {
    return frameListCount;
  }

  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const paddingFrameOffsets = activeItemList
    .filter((item) => isLikelyLipSyncPaddingItem(item))
    .map((item) => Number(item?.config?.frameOffset))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (paddingFrameOffsets.length > 0) {
    return Math.max(1, Math.round(Math.min(...paddingFrameOffsets)));
  }

  const duration = normalizePositiveNumber(layer?.duration);
  if (duration) {
    return Math.max(1, Math.round(duration * fps));
  }

  return 0;
}

function normalizeCharacterLipSyncDurationForJoin({
  layer,
  framesPerSecond,
}) {
  if (!isCharacterLipSyncLayer(layer)) {
    return;
  }

  const fps = resolveFramesPerSecond(framesPerSecond);

  const imageSession = layer?.imageSession;
  if (imageSession && Array.isArray(imageSession.activeItemList)) {
    imageSession.activeItemList = imageSession.activeItemList.filter(
      (item) => !isLikelyLipSyncPaddingItem(item),
    );
  }

  const duration = normalizePositiveNumber(layer.duration);
  if (!duration) {
    return;
  }

  const totalFrames = Math.max(1, Math.floor(duration * fps));
  layer.startFrame = 0;
  layer.endFrame = totalFrames;

  // Clear stale clip-end markers for joined lip-sync layers to avoid
  // tail still-frame fallback in frame rendering.
  layer.clipEnd = false;
  layer.clipEndFrames = 0;
}

function normalizeAiBackedLayerDurationForJoin({
  layer,
  framesPerSecond,
}) {
  if (!isAiBackedLayer(layer)) {
    return;
  }

  const fps = resolveFramesPerSecond(framesPerSecond);
  const renderedFrameCount = resolveRenderedFrameCountFromLayer(layer, fps);
  const currentDurationFrames = floorSecondsToFrameCount(layer.duration, fps, { minimumFrames: 1 });

  let targetFrameCount = currentDurationFrames;
  if (renderedFrameCount > 0) {
    // Never request more frames than the source AI render has.
    targetFrameCount = Math.max(1, Math.min(currentDurationFrames, renderedFrameCount));
  }

  layer.duration = frameCountToSeconds(targetFrameCount, fps);
  layer.startFrame = 0;
  layer.endFrame = targetFrameCount;

  // Joined sessions re-render from already-clipped source videos; stale clip ranges
  // can force end-of-scene stills, so clear them for AI-backed layers.
  layer.clipStart = false;
  layer.clipStartFrames = 0;
  layer.clipEnd = false;
  layer.clipEndFrames = 0;
}

function prepareAudioLayerForJoin(audioLayer) {
  if (!audioLayer || typeof audioLayer !== 'object') {
    return audioLayer;
  }

  audioLayer.generationStatus = 'COMPLETED';
  audioLayer.generationError = null;
  audioLayer.streamDownloadPending = false;

  return audioLayer;
}

function adjustSpeechOrSoundEffectAudioTiming({
  audioLayer,
  resolvedConnectedLayerOffset,
}) {
  const duration = normalizePositiveNumber(audioLayer.duration) ?? 0;
  const offsetWithinLayer = Number(audioLayer.connectedLayerStartTimeOffset) || 0;
  const startTime = resolvedConnectedLayerOffset + offsetWithinLayer;
  audioLayer.startTime = startTime;
  audioLayer.endTime = startTime + duration;
}

function adjustGenericAudioTiming({
  audioLayer,
  sessionOffset,
}) {
  const startTime = Number(audioLayer.startTime);
  if (Number.isFinite(startTime)) {
    audioLayer.startTime = startTime + sessionOffset;
  }
  const endTime = Number(audioLayer.endTime);
  if (Number.isFinite(endTime)) {
    audioLayer.endTime = endTime + sessionOffset;
  }
}

function applyMusicLayerTiming({
  audioLayer,
  sessionOffset,
  sessionDuration,
  sessionIndex,
  totalSessions,
  blendScenes,
}) {
  const isFirstSession = sessionIndex === 0;
  const isLastSession = sessionIndex === totalSessions - 1;

  if (!blendScenes) {
    audioLayer.startTime = sessionOffset;
    audioLayer.endTime = sessionOffset + sessionDuration;
    audioLayer.duration = sessionDuration;
    return;
  }

  const startTime = sessionOffset + (isFirstSession ? 0 : SCENE_BLEND_BOUNDARY_SECONDS);
  const endTimeBase = sessionOffset + sessionDuration;
  const endTime = isLastSession ? endTimeBase : endTimeBase + SCENE_BLEND_BOUNDARY_SECONDS;
  const duration = Math.max(endTime - startTime, 0);

  audioLayer.startTime = startTime;
  audioLayer.endTime = endTime;
  audioLayer.duration = duration;
}

function resolveBlendScenesFlag(payload = {}) {
  const value = payload.blend_scenes ?? payload.blendScenes;
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const error = new Error('blend_scenes must be a boolean.');
  error.status = 400;
  throw error;
}

function buildJoinedLayersAndAudioLayers(sessionDataList = [], options = {}) {
  const blendScenes = options.blendScenes === true;
  const joinedLayers = [];
  const joinedAudioLayers = [];
  const joinedNarratorAvatarOverlays = [];
  const timelineFramesPerSecond = resolveFramesPerSecond(sessionDataList?.[0]?.framesPerSecond);

  let cumulativeDurationFrames = 0;
  let previousSessionOutroImageItem = null;

  for (const [sessionIndex, sessionData] of sessionDataList.entries()) {
    const sessionDuration = resolveSessionDurationSeconds(sessionData);
    const sessionOffsetFrames = cumulativeDurationFrames;
    const sessionOffset = frameCountToSeconds(sessionOffsetFrames, timelineFramesPerSecond);
    const sessionFramesPerSecond = timelineFramesPerSecond;

    if (blendScenes && sessionIndex > 0 && previousSessionOutroImageItem) {
      injectOutroBlendItemIntoSession({
        sessionData,
        previousOutroImageItem: previousSessionOutroImageItem,
        framesPerSecond: sessionFramesPerSecond,
      });
    }

    const layerIdMap = new Map();
    const newLayerOffsetByOldLayerId = new Map();
    const newLayerIndexByOldLayerId = new Map();
    const oldLayerIdByOldLayerIndex = new Map();

    const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
    const normalizedOffsets = normalizeLayerDurationOffsets(layers);
    let sessionMaxEndFrame = 0;

    layers.forEach((layer, idx) => {
      if (!layer || typeof layer !== 'object') {
        return;
      }

      const oldLayerId = layer?._id?.toString?.() ?? layer?._id ?? null;
      const newLayerId = createNewObjectId();

      layer._id = newLayerId;

      if (oldLayerId) {
        layerIdMap.set(oldLayerId.toString(), newLayerId.toString());
        oldLayerIdByOldLayerIndex.set(idx, oldLayerId.toString());
      }

      const baseOffset = normalizedOffsets[idx] ?? 0;
      const baseOffsetFrames = floorSecondsToFrameCount(baseOffset, sessionFramesPerSecond, { minimumFrames: 0 });

      normalizeCharacterLipSyncDurationForJoin({
        layer,
        framesPerSecond: sessionFramesPerSecond,
      });
      normalizeAiBackedLayerDurationForJoin({
        layer,
        framesPerSecond: sessionFramesPerSecond,
      });

      const layerDurationFrames = floorSecondsToFrameCount(
        layer.duration,
        sessionFramesPerSecond,
        { minimumFrames: 1 },
      );

      layer.duration = frameCountToSeconds(layerDurationFrames, sessionFramesPerSecond);
      layer.durationOffset = frameCountToSeconds(
        baseOffsetFrames + sessionOffsetFrames,
        sessionFramesPerSecond,
      );
      layer.startFrame = 0;
      layer.endFrame = layerDurationFrames;

      const layerEndFrame = baseOffsetFrames + layerDurationFrames;
      if (layerEndFrame > sessionMaxEndFrame) {
        sessionMaxEndFrame = layerEndFrame;
      }

      prepareLayerForJoin(layer);

      joinedLayers.push(layer);
      const newGlobalIndex = joinedLayers.length - 1;

      if (oldLayerId) {
        newLayerOffsetByOldLayerId.set(oldLayerId.toString(), layer.durationOffset);
        newLayerIndexByOldLayerId.set(oldLayerId.toString(), newGlobalIndex);
      }
    });

    const fallbackSessionDurationFrames = floorSecondsToFrameCount(
      sessionDuration,
      sessionFramesPerSecond,
      { minimumFrames: 1 },
    );
    const effectiveSessionDurationFrames = sessionMaxEndFrame > 0
      ? sessionMaxEndFrame
      : fallbackSessionDurationFrames;
    const effectiveSessionDuration = frameCountToSeconds(
      effectiveSessionDurationFrames,
      sessionFramesPerSecond,
    );
    const narratorAvatarOverlay = buildJoinedNarratorAvatarOverlay({
      sessionData,
      sessionOffset,
      effectiveSessionDuration,
    });
    if (narratorAvatarOverlay) {
      joinedNarratorAvatarOverlays.push(narratorAvatarOverlay);
    }

    const audioLayers = Array.isArray(sessionData?.audioLayers) ? sessionData.audioLayers : [];
    audioLayers.forEach((audioLayer) => {
      if (!audioLayer || typeof audioLayer !== 'object') {
        return;
      }

      audioLayer._id = createNewObjectId();

      const isMusic = blendScenes
        ? isMusicLikeAudioLayer(audioLayer)
        : isAudioLayerType(audioLayer, 'music');
      if (isMusic) {
        applyMusicLayerTiming({
          audioLayer,
          sessionOffset,
          sessionDuration: effectiveSessionDuration,
          sessionIndex,
          totalSessions: sessionDataList.length,
          blendScenes,
        });
        prepareAudioLayerForJoin(audioLayer);
        joinedAudioLayers.push(audioLayer);
        return;
      }

      const connectedLayerIdRaw = audioLayer.connectedLayerId?.toString?.() ?? audioLayer.connectedLayerId ?? null;
      const connectedLayerIndex = normalizeOptionalInteger(audioLayer.connectedLayerIndex);

      let resolvedOldLayerId = null;
      if (connectedLayerIdRaw && layerIdMap.has(connectedLayerIdRaw.toString())) {
        resolvedOldLayerId = connectedLayerIdRaw.toString();
      } else if (typeof connectedLayerIndex === 'number') {
        resolvedOldLayerId = oldLayerIdByOldLayerIndex.get(connectedLayerIndex) ?? null;
      }

      let resolvedNewConnectedLayerId = null;
      let resolvedNewConnectedLayerOffset = null;
      let resolvedNewConnectedLayerIndex = null;

      if (resolvedOldLayerId) {
        resolvedNewConnectedLayerId = layerIdMap.get(resolvedOldLayerId) ?? null;
        resolvedNewConnectedLayerOffset = newLayerOffsetByOldLayerId.get(resolvedOldLayerId) ?? null;
        resolvedNewConnectedLayerIndex = newLayerIndexByOldLayerId.get(resolvedOldLayerId) ?? null;
      }

      if (resolvedNewConnectedLayerId) {
        audioLayer.connectedLayerId = resolvedNewConnectedLayerId;
      }
      if (resolvedNewConnectedLayerIndex !== null && resolvedNewConnectedLayerIndex !== undefined) {
        audioLayer.connectedLayerIndex = resolvedNewConnectedLayerIndex;
      }

      if (isSpeechOrSoundEffectAudioLayer(audioLayer) && resolvedNewConnectedLayerOffset !== null) {
        adjustSpeechOrSoundEffectAudioTiming({
          audioLayer,
          resolvedConnectedLayerOffset: resolvedNewConnectedLayerOffset,
        });
      } else {
        adjustGenericAudioTiming({ audioLayer, sessionOffset });
      }

      prepareAudioLayerForJoin(audioLayer);
      joinedAudioLayers.push(audioLayer);
    });

    previousSessionOutroImageItem = blendScenes
      ? resolveOutroImageItemFromSession(sessionData)
      : null;
    cumulativeDurationFrames += effectiveSessionDurationFrames;
  }

  return {
    layers: joinedLayers,
    audioLayers: joinedAudioLayers,
    joinedNarratorAvatarOverlays,
    totalDuration: frameCountToSeconds(cumulativeDurationFrames, timelineFramesPerSecond),
  };
}

export async function getJoinVideosBillingPreview(userId, payload = {}) {
  const rawSessionIds =
    payload.videoSessionIds ||
    payload.video_session_ids ||
    payload.session_ids ||
    payload.sessionIds;

  const webhookUrl = typeof payload.webhookUrl === 'string' && payload.webhookUrl.trim()
    ? payload.webhookUrl.trim()
    : null;
  const blendScenes = resolveBlendScenesFlag(payload);

  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  if (!Array.isArray(rawSessionIds) || rawSessionIds.length < 2) {
    const error = new Error('session_ids must be an array of at least 2 session ids.');
    error.status = 400;
    throw error;
  }

  const sessionIds = rawSessionIds
    .map((id) => (typeof id === 'string' ? id.trim().toLowerCase() : ''))
    .filter(Boolean);

  if (sessionIds.length < 2) {
    const error = new Error('session_ids must contain at least 2 non-empty strings.');
    error.status = 400;
    throw error;
  }

  const uniqueSessionIds = new Set(sessionIds);
  if (uniqueSessionIds.size !== sessionIds.length) {
    const error = new Error('session_ids must not contain duplicates.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();

  const sessions = await VideoSession.find({
    _id: { $in: sessionIds },
    userId: userId.toString(),
  }).lean();

  const sessionsById = new Map(sessions.map((session) => [session?._id?.toString?.() ?? session?._id, session]));

  const orderedSessions = sessionIds.map((id) => sessionsById.get(id)).filter(Boolean);
  if (orderedSessions.length !== sessionIds.length) {
    const error = new Error('One or more sessions were not found.');
    error.status = 404;
    throw error;
  }

  const sessionDataList = orderedSessions.map((session) => JSON.parse(JSON.stringify(session)));

  const aspectRatios = new Set(
    sessionDataList.map((session) => {
      const ratio = typeof session?.aspectRatio === 'string' ? session.aspectRatio.trim() : '';
      return ratio || '1:1';
    }),
  );
  if (aspectRatios.size > 1) {
    const error = new Error('All sessions must have the same aspectRatio to be joined.');
    error.status = 400;
    throw error;
  }

  const framesPerSecondValues = sessionDataList.map((session) => Number(session?.framesPerSecond)).filter(Number.isFinite);
  const framesPerSecondSet = new Set(framesPerSecondValues.map((fps) => Math.round(fps)));
  if (framesPerSecondSet.size > 1) {
    const error = new Error('All sessions must have the same framesPerSecond to be joined.');
    error.status = 400;
    throw error;
  }

  for (const [idx, session] of sessionDataList.entries()) {
    const layers = Array.isArray(session?.layers) ? session.layers : [];
    if (!layers.length) {
      const error = new Error(`Session at index ${idx} is missing layers.`);
      error.status = 400;
      throw error;
    }
    const duration = resolveSessionDurationSeconds(session);
    if (!Number.isFinite(duration) || duration <= 0) {
      const error = new Error(`Session at index ${idx} has invalid duration.`);
      error.status = 400;
      throw error;
    }
  }

  const joinedResult = buildJoinedLayersAndAudioLayers(sessionDataList, { blendScenes });
  const durationSeconds = joinedResult.totalDuration;
  const billableSeconds = Math.ceil(durationSeconds);
  if (!Number.isFinite(billableSeconds) || billableSeconds <= 0) {
    const error = new Error('Unable to determine joined video duration for billing.');
    error.status = 400;
    throw error;
  }

  const creditsToCharge = JOIN_VIDEOS_CREDITS_PER_SECOND * billableSeconds;
  return {
    sessionIds,
    sessionDataList,
    joinedResult,
    durationSeconds,
    billableSeconds,
    creditsToCharge,
    blendScenes,
    webhookUrl,
  };
}

export async function joinVideoSessionsAndQueueGeneration(userId, payload = {}) {
  const {
    sessionIds,
    sessionDataList,
    joinedResult,
    durationSeconds,
    billableSeconds,
    creditsToCharge,
    blendScenes,
    webhookUrl,
  } = await getJoinVideosBillingPreview(userId, payload);
  const skipCreditDeduction = payload.skipCreditDeduction === true;

  const creditResult = skipCreditDeduction
    ? { creditsCharged: creditsToCharge, remainingCredits: null }
    : await deductGenerationCredits(userId, creditsToCharge, {
        source: 'join_videos',
        metadata: {
          sessionIds,
          durationSeconds,
          billableSeconds,
          requestType: 'API',
          blendScenes,
        },
      });

  const newSessionId = await createNewBlankVideoSession(userId);

  const baseSession = sessionDataList[0] || {};
  const clonedSession = JSON.parse(JSON.stringify(baseSession));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  clonedSession.layers = joinedResult.layers;
  clonedSession.audioLayers = joinedResult.audioLayers;
  clonedSession.joinedNarratorAvatarOverlays = joinedResult.joinedNarratorAvatarOverlays || [];
  const joinedTitleResult = await generateJoinedVideoTitle(sessionDataList);
  if (joinedTitleResult.title) {
    clonedSession.sessionName = joinedTitleResult.title;
    clonedSession.joinedSourceVideoTitles = joinedTitleResult.sourceTitles;
  }

  prepareSessionForJoin({
    clonedSession,
    webhookUrl,
    totalDuration: durationSeconds,
  });

  await VideoSession.updateOne({ _id: newSessionId }, { $set: clonedSession });

  await upsertGlobalSessionMapping({
    sessionId: newSessionId,
    sessionType: 'video',
    requestId: newSessionId,
    provider: getFirstNonEmptyString(
      baseSession?.expressGenerativeVideoModel,
      baseSession?.video_model,
      baseSession?.provider,
      baseSession?.videoGenerationModelSubType,
    ) || 'join_videos',
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'join_videos',
    metadata: {
      sessionIds,
      durationSeconds,
      billableSeconds,
      blendScenes,
    },
  });

  return {
    request_id: newSessionId,
    session_id: newSessionId,
    creditsCharged: creditsToCharge,
    remainingCredits: creditResult?.remainingCredits ?? null,
  };
}

export const __testOnly__ = {
  buildJoinedLayersAndAudioLayers,
  buildFallbackJoinedVideoTitle,
  resolveSourceVideoTitles,
  resolveSessionDurationSeconds,
};
