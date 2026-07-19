import VideoGeneration from "./schema/VideoGeneration.js";
import VideoSession from "./schema/VideoSession.js";
import FrameGeneration from "./schema/FrameGeneration.js";
import User from "./schema/User.js";

import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import { getDatabase, getDBConnectionString } from "./DBString.js";
import { deleteFramesForGeneration } from './utils/FrameUtils.js';
import { updateSendCompletionNotificationToUser } from './utils/NotificationUtils.js';
import {
  uploadBranchPublicationThumbnailToCDN,
  uploadPublicationThumbnailToCDN,
  uploadVideoToCDN,
} from './utils/AWS.js';
import { installStructuredLogger } from './utils/StructuredLogger.js';
import { uploadBranchThumbnailBestEffort } from './utils/BranchThumbnail.js';
import {
  buildDockerFinalVideoQueueRepairBranchPathPatch,
  buildDockerFinalVideoQueueRepairSessionPatch,
  isDockerLocalFinalVideoQueueRepairEnabled,
  shouldRepairMissingFinalVideoRequest,
} from './utils/DockerFinalVideoQueueRepair.js';
import {
  areAllBranchPathVideosComplete,
  buildBranchThumbnailAssetPath,
  findBranchRenderPath,
  getDefaultBranchRenderPath,
  getRepairableBranchRenderPaths,
  isBranchedVideoSession,
  normalizeBranchRenderId,
  resolveBranchThumbnailTimelineIndex,
  resolveBranchRenderContext,
} from './utils/BranchRenderPlan.js';
import {
  buildLayerEdgeDuckingAutomationPoints,
  buildAudioVolumeExpression,
  buildResolvedAudioVolumeAutomationPoints,
  hasManualAudioVolumeAutomation,
} from './utils/AudioVolumeAutomation.js';
import { buildFinalAudioMixFilter } from './utils/FinalRenderAudio.js';
import {
  buildSpeechAwareDuckingEnvelopeWindows,
  buildStudioAudioDuckingPlan,
  buildStudioForegroundDuckKeyProfiles,
} from './utils/AudioDuckingAnalysis.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_video_generator',
  component: 'generation_processor',
});

// Maintain a set of local ffmpeg commands so we can kill them if we receive a signal
const ffmpegProcesses = new Set();

const DEFAULT_FRAMES_PER_SECOND = 24;
const VALID_FRAMES_PER_SECOND = new Set([16, 24, 30]);
const MUSIC_DUCK_ATTACK_DURATION_SECONDS = 0.8;
const MUSIC_DUCK_RELEASE_DURATION_SECONDS = 1.2;
const MUSIC_DUCKED_VOLUME_RATIO = 0.225;
const EXPRESS_SPEECH_AWARE_MUSIC_DUCKED_VOLUME_RATIO = 0.32;
const EXPRESS_SPEECH_AWARE_DUCK_ATTACK_DURATION_SECONDS = 0.45;
const EXPRESS_SPEECH_AWARE_DUCK_RELEASE_DURATION_SECONDS = 1.2;
const STUDIO_ANALYZED_MUSIC_DUCKED_VOLUME_RATIO = 0.03;
const STUDIO_TIMELINE_MUSIC_DUCKED_VOLUME_RATIO = 0.22;
const MUSIC_DUCK_MERGE_GAP_SECONDS = 1.2;
const MUSIC_SIDECHAIN_THRESHOLD = 0.014;
const MUSIC_SIDECHAIN_RATIO = 3.5;
const MUSIC_SIDECHAIN_ATTACK_MS = 110;
const MUSIC_SIDECHAIN_RELEASE_MS = 1200;
const MUSIC_SIDECHAIN_KNEE = 7;
const MUSIC_SIDECHAIN_LINK = 'maximum';
const MUSIC_SIDECHAIN_LEVEL_SC = 1;
const MUSIC_SIDECHAIN_MIX = 0.5;
const MUSIC_SIDECHAIN_DETECTION = 'rms';
const FOREGROUND_DUCK_BUS_GAIN = 3.2;
const FOREGROUND_DUCK_BUS_COMPRESS_THRESHOLD = 0.055;
const FOREGROUND_DUCK_BUS_COMPRESS_RATIO = 9;
const FOREGROUND_DUCK_BUS_COMPRESS_ATTACK_MS = 8;
const FOREGROUND_DUCK_BUS_COMPRESS_RELEASE_MS = 240;
const FOREGROUND_DUCK_BUS_COMPRESS_MAKEUP = 1.9;
const FOREGROUND_DUCK_BUS_COMPRESS_DETECTION = 'rms';
const FOREGROUND_DUCK_BUS_LIMIT = 0.95;
const FOREGROUND_DUCK_BUS_LIMIT_ATTACK_MS = 3;
const FOREGROUND_DUCK_BUS_LIMIT_RELEASE_MS = 120;
const SCENE_DISSOLVE_DURATION_SECONDS = 0.25;
const EXPRESS_AUDIO_EDGE_FADE_DURATION_RATIO = 0.05;
const MAX_FRAME_EVALUATED_VOLUME_POINTS = 64;
const MAX_MUSIC_DUCKING_VOLUME_POINTS = 256;
const MAX_FRAME_EVALUATED_VOLUME_EXPRESSION_LENGTH = 6000;
const STALE_VIDEO_GENERATION_LOCK_MS = 30 * 60 * 1000;
const DOCKER_FINAL_VIDEO_QUEUE_REPAIR_INTERVAL_MS = 15 * 1000;
const DOCKER_FINAL_VIDEO_QUEUE_REPAIR_LIMIT = 25;
let lastDockerFinalVideoQueueRepairAt = 0;

function resolveProcessorAssetsRoot(pwd, version = 'v2') {
  if (version === 'v2' && process.env.SAMSAR_ASSETS_V2_ROOT) {
    return process.env.SAMSAR_ASSETS_V2_ROOT;
  }
  if (version !== 'v2' && process.env.SAMSAR_ASSETS_ROOT) {
    return process.env.SAMSAR_ASSETS_ROOT;
  }
  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    return version === 'v2' ? '/assets_v2' : '/assets';
  }

  const folderName = version === 'v2' ? 'assets_v2' : 'assets';
  return path.join(pwd, '..', 'samsar_processor', folderName);
}

function stripAssetPrefix(assetPath) {
  return assetPath
    .replace(/^\/+/, '')
    .replace(/^assets_v2\/?/, '')
    .replace(/^assets\/?/, '');
}

function getProcessorAssetCandidates(assetPath, pwd) {
  if (typeof assetPath !== 'string' || !assetPath.trim()) {
    return [];
  }

  const trimmedPath = assetPath.trim();
  const normalizedPath = trimmedPath.replace(/\\/g, '/');
  const normalizedWithoutLeadingSlash = normalizedPath.replace(/^\/+/, '');
  const hasV2Prefix = normalizedWithoutLeadingSlash.startsWith('assets_v2/');
  const hasAssetPrefix = hasV2Prefix || normalizedWithoutLeadingSlash.startsWith('assets/');
  const relativePath = stripAssetPrefix(normalizedPath);
  const candidates = [];

  if (path.isAbsolute(trimmedPath) && !hasAssetPrefix) {
    candidates.push(trimmedPath);
  }

  if (hasV2Prefix) {
    candidates.push(path.join(resolveProcessorAssetsRoot(pwd, 'v2'), relativePath));
  } else {
    candidates.push(path.join(resolveProcessorAssetsRoot(pwd, 'v2'), relativePath));
    candidates.push(path.join(resolveProcessorAssetsRoot(pwd, 'legacy'), relativePath));
  }

  return [...new Set(candidates)];
}

function resolveExistingProcessorAssetPath(assetPath, pwd) {
  for (const candidatePath of getProcessorAssetCandidates(assetPath, pwd)) {
    try {
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    } catch {
      // ignore invalid path candidates and continue
    }
  }

  return null;
}

function resolveProcessorAssetWritePath(pwd, ...segments) {
  return path.join(resolveProcessorAssetsRoot(pwd, 'v2'), ...segments);
}

function ensureBranchThumbnailArtifact({
  branchRenderContext,
  copiedLayerFrameRanges,
  pwd,
  sessionId,
}) {
  if (!branchRenderContext) return null;

  const configuredThumbnailPath = typeof branchRenderContext.renderPath?.thumbnailPath === 'string'
    ? branchRenderContext.renderPath.thumbnailPath.trim()
    : '';
  const existingThumbnailPath = configuredThumbnailPath
    ? resolveExistingProcessorAssetPath(configuredThumbnailPath, pwd)
    : null;
  if (existingThumbnailPath) {
    return {
      thumbnailPath: configuredThumbnailPath,
      absoluteThumbnailPath: existingThumbnailPath,
      thumbnailSource: branchRenderContext.renderPath?.thumbnailSource || null,
    };
  }

  const timelineIndex = resolveBranchThumbnailTimelineIndex(branchRenderContext.renderPath);
  const timeline = Array.isArray(branchRenderContext.renderPath?.timeline)
    ? branchRenderContext.renderPath.timeline
    : [];
  const timelineEntry = timelineIndex === null ? null : timeline[timelineIndex];
  const sourceRange = (Array.isArray(copiedLayerFrameRanges) ? copiedLayerFrameRanges : [])
    .find((range) => (
      Number(range?.layer?.timelineIndex) === Number(timelineIndex) ||
      (
        timelineEntry?.layerId &&
        normalizeBranchRenderId(range?.layerId) === normalizeBranchRenderId(timelineEntry.layerId)
      )
    ));
  const sourceFramePath = sourceRange?.sourceFolderPath
    ? path.join(sourceRange.sourceFolderPath, '0.png')
    : null;
  if (!sourceFramePath || !fs.existsSync(sourceFramePath)) {
    throw new Error(
      `Cannot create branch thumbnail for ${branchRenderContext.renderPathId}: ` +
      'the first divergence-layer frame is missing.',
    );
  }

  const thumbnailPath = buildBranchThumbnailAssetPath(
    sessionId,
    branchRenderContext.renderPathId,
  );
  const relativeThumbnailPath = stripAssetPrefix(thumbnailPath);
  const thumbnailTargets = [
    {
      version: 'v2',
      reference: `assets_v2/${relativeThumbnailPath}`,
      absolutePath: path.join(resolveProcessorAssetsRoot(pwd, 'v2'), relativeThumbnailPath),
    },
    {
      version: 'legacy',
      reference: thumbnailPath,
      absolutePath: path.join(resolveProcessorAssetsRoot(pwd, 'legacy'), relativeThumbnailPath),
    },
  ];
  const persistedTargets = [];
  const persistenceErrors = [];
  for (const target of thumbnailTargets) {
    try {
      fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
      fs.copyFileSync(sourceFramePath, target.absolutePath);
      persistedTargets.push(target);
    } catch (error) {
      persistenceErrors.push(`${target.absolutePath}: ${error?.message || error}`);
    }
  }
  if (!persistedTargets.length) {
    throw new Error(
      `Failed to persist branch thumbnail for ${branchRenderContext.renderPathId}: ` +
      persistenceErrors.join('; '),
    );
  }
  if (persistenceErrors.length) {
    console.warn(
      `Branch thumbnail ${branchRenderContext.renderPathId} was not mirrored to every asset root: ` +
      persistenceErrors.join('; '),
    );
  }

  const legacyTarget = persistedTargets.find((target) => target.version === 'legacy');
  const v2Target = persistedTargets.find((target) => target.version === 'v2');
  const persistedThumbnailPath = legacyTarget?.reference || v2Target.reference;
  const absoluteThumbnailPath = v2Target?.absolutePath || legacyTarget.absolutePath;

  const selectionTrail = Array.isArray(branchRenderContext.renderPath?.selectionTrail)
    ? branchRenderContext.renderPath.selectionTrail
    : [];
  const immediateSelection = selectionTrail.at(-1) || {};
  const sceneIndexValue = timelineEntry?.sceneIndex ?? timelineEntry?.scene_index;
  const divergenceSceneIndexValue =
    immediateSelection?.divergenceSceneIndex ??
    immediateSelection?.divergence_scene_index ??
    branchRenderContext.renderPath?.divergenceSceneIndex;
  return {
    thumbnailPath: persistedThumbnailPath,
    absoluteThumbnailPath,
    thumbnailSource: {
      timelineIndex,
      layerId: normalizeBranchRenderId(timelineEntry?.layerId) || null,
      pathSequenceIndex: Number.isInteger(Number(timelineEntry?.sequenceIndex))
        ? Number(timelineEntry.sequenceIndex)
        : timelineIndex,
      sceneIndex: sceneIndexValue !== null && sceneIndexValue !== undefined &&
        Number.isInteger(Number(sceneIndexValue))
        ? Number(sceneIndexValue)
        : null,
      framePath: persistedThumbnailPath,
      divergenceSceneIndex: divergenceSceneIndexValue !== null &&
        divergenceSceneIndexValue !== undefined &&
        Number.isInteger(Number(divergenceSceneIndexValue))
        ? Number(divergenceSceneIndexValue)
        : null,
      selectionTrailIndex: selectionTrail.length ? selectionTrail.length - 1 : null,
      reason: 'final_render_fallback',
    },
  };
}

function normalizeAudioLayerType(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'music' ||
    normalized === 'background_music' ||
    normalized === 'background music' ||
    normalized === 'bgm' ||
    normalized === 'backing_track' ||
    normalized === 'backing track'
  ) {
    return 'music';
  }

  if (normalized === 'sound') {
    return 'sound_effect';
  }

  if (normalized === 'sfx') {
    return 'sound_effect';
  }

  if (
    normalized === 'sound_effect' ||
    normalized === 'sound effect' ||
    normalized === 'sound-effect'
  ) {
    return 'sound_effect';
  }

  if (normalized === 'lip sync') {
    return 'lip_sync';
  }

  if (
    normalized === 'recorded_speech' ||
    normalized === 'recorded speech'
  ) {
    return 'speech';
  }

  if (
    normalized === 'voice' ||
    normalized === 'voiceover' ||
    normalized === 'voice_over' ||
    normalized === 'voice over' ||
    normalized === 'narration' ||
    normalized === 'character' ||
    normalized === 'dialog' ||
    normalized === 'dialogue' ||
    normalized === 'tts' ||
    normalized === 'text_to_speech' ||
    normalized === 'text to speech'
  ) {
    return 'speech';
  }

  return normalized;
}

function normalizeTimelineAudioType(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isCustomSpeechTimelineLayer(audioLayer = {}) {
  const candidateTypes = [
    audioLayer?.generationType,
    audioLayer?.sourceType,
    audioLayer?.generationMeta?.sourceType,
    audioLayer?.generationMeta?.uploadType,
  ];

  return candidateTypes.some((candidateType) => {
    const normalizedType = normalizeTimelineAudioType(candidateType);
    return normalizedType === 'custom_speech' || normalizedType === 'recorded_speech';
  });
}

function isSelectedAudioLayer(audioLayer = {}) {
  return (
    (audioLayer?.isEnabled === true || audioLayer?.defaultSelected === true)
    && audioLayer?.generationStatus !== 'PENDING'
  );
}

function resolveAudioLayerTimelineEndTime(audioLayer = {}) {
  const startTime = Number.isFinite(Number(audioLayer?.startTime))
    ? Math.max(0, Number(audioLayer.startTime))
    : 0;
  const explicitEndTime = Number(audioLayer?.endTime);
  if (Number.isFinite(explicitEndTime) && explicitEndTime > startTime) {
    return explicitEndTime;
  }

  const duration = Number(audioLayer?.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return startTime + duration;
  }

  return null;
}

function resolveRenderTimelineDuration(sessionLayers = [], audioLayers = []) {
  const sceneTimelineEndTime = Array.isArray(sessionLayers) && sessionLayers.length > 0
    ? sessionLayers.reduce((maxEndTime, layer) => {
        const layerStartTime = Number(layer?.durationOffset) || 0;
        const layerDuration = Number(layer?.duration) || 0;
        return Math.max(maxEndTime, layerStartTime + layerDuration);
      }, 0)
    : 0;
  const customSpeechEndTime = Array.isArray(audioLayers)
    ? audioLayers.reduce((maxEndTime, audioLayer) => {
        if (!isSelectedAudioLayer(audioLayer) || !isCustomSpeechTimelineLayer(audioLayer)) {
          return maxEndTime;
        }

        const audioEndTime = resolveAudioLayerTimelineEndTime(audioLayer);
        return audioEndTime === null ? maxEndTime : Math.max(maxEndTime, audioEndTime);
      }, 0)
    : 0;

  if (sceneTimelineEndTime > 0 || customSpeechEndTime > 0) {
    return Math.max(sceneTimelineEndTime, customSpeechEndTime);
  }

  return Array.isArray(audioLayers)
    ? audioLayers.reduce((maxEndTime, audioLayer) => {
        const audioEndTime = resolveAudioLayerTimelineEndTime(audioLayer);
        return audioEndTime === null ? maxEndTime : Math.max(maxEndTime, audioEndTime);
      }, 0)
    : 0;
}

function resolveRenderableAudioLayerType(audioLayer = {}, connectedLayer = null) {
  const candidateTypes = [
    audioLayer?.generationType,
    audioLayer?.libraryType,
    audioLayer?.type,
    audioLayer?.audioType,
    audioLayer?.sourceType,
    audioLayer?.generationMeta?.sourceType,
    connectedLayer?.layerAiVideoType,
  ];

  for (const candidateType of candidateTypes) {
    const normalizedType = normalizeAudioLayerType(candidateType);
    if (normalizedType) {
      return normalizedType;
    }
  }

  if (
    audioLayer?.speaker ||
    audioLayer?.speakerCharacterName ||
    audioLayer?.addSubtitles ||
    audioLayer?.isHumanoid
  ) {
    return 'speech';
  }

  return '';
}

function isMusicLikeAudioType(value) {
  return normalizeAudioLayerType(value) === 'music';
}

function isSoundEffectAudioType(value) {
  return normalizeAudioLayerType(value) === 'sound_effect';
}

function hasConnectedLayerBinding(audioLayer = {}) {
  return Boolean(audioLayer?.connectedLayerId);
}

function isLikelySpeechProvider(providerValue) {
  if (typeof providerValue !== 'string') {
    return false;
  }

  const normalizedProvider = providerValue.trim().toUpperCase();
  return (
    normalizedProvider === 'OPENAI' ||
    normalizedProvider === 'ELEVENLABS' ||
    normalizedProvider === 'PLAYAI' ||
    normalizedProvider === 'AZURE'
  );
}

function resolveDuckingTrackType(audioLayer = {}) {
  return resolveRenderableAudioLayerType(
    audioLayer,
    audioLayer?.connectedLayerType ? { layerAiVideoType: audioLayer.connectedLayerType } : null,
  );
}

function isFreeStandingMusicTrack(audioLayer = {}) {
  return isMusicLikeAudioType(resolveDuckingTrackType(audioLayer)) && !hasConnectedLayerBinding(audioLayer);
}

function isMusicDuckingTargetTrack(audioLayer = {}) {
  return isMusicLikeAudioType(resolveDuckingTrackType(audioLayer));
}

function isForegroundDuckingTrack(audioLayer = {}, { requireConnectedLayer = false } = {}) {
  const hasLayerBinding = hasConnectedLayerBinding(audioLayer);
  if (requireConnectedLayer && !hasLayerBinding) {
    return false;
  }

  const resolvedAudioType = resolveDuckingTrackType(audioLayer);
  if (isMusicLikeAudioType(resolvedAudioType)) {
    return false;
  }

  return (
    isSpeechLikeAudioType(resolvedAudioType) ||
    Boolean(audioLayer?.speaker) ||
    Boolean(audioLayer?.speakerCharacterName) ||
    Boolean(audioLayer?.isHumanoid) ||
    Boolean(audioLayer?.addSubtitles) ||
    (
      isLikelySpeechProvider(audioLayer?.provider)
    )
  );
}

function isConnectedForegroundTrack(audioLayer = {}) {
  return isForegroundDuckingTrack(audioLayer, { requireConnectedLayer: true });
}

function shouldUseStudioPeakSidechainDucking({
  applyAudioDucking,
  isExpressGeneration,
  audioList = [],
}) {
  if (isExpressGeneration) {
    return false;
  }

  const shouldApplyAudioDucking = Boolean(applyAudioDucking) || Boolean(isExpressGeneration);
  if (!shouldApplyAudioDucking) {
    return false;
  }

  const hasMusicTrack = audioList.some((audioTrack) => isMusicDuckingTargetTrack(audioTrack));
  const hasForegroundTrack = audioList.some((audioTrack) => isForegroundDuckingTrack(audioTrack));
  return hasMusicTrack && hasForegroundTrack;
}

function shouldAnalyzeExpressSpeechAwareDucking({
  isExpressGeneration,
  audioList = [],
}) {
  if (!isExpressGeneration) {
    return false;
  }

  const hasMusicTrack = audioList.some((audioTrack) => isMusicDuckingTargetTrack(audioTrack));
  const hasForegroundTrack = audioList.some((audioTrack) => isForegroundDuckingTrack(audioTrack));
  return hasMusicTrack && hasForegroundTrack;
}

function shouldDuckMusicAgainstAudioType(value) {
  const normalized = normalizeAudioLayerType(value);
  return Boolean(normalized) && normalized !== 'music';
}

function isSpeechLikeAudioType(value) {
  const normalized = normalizeAudioLayerType(value);
  return (
    normalized === 'speech' ||
    normalized === 'lip_sync' ||
    normalized === 'user_video'
  );
}

function resolveRenderableLayerBaseVolume(volumeValue) {
  const rawVolume = Number(volumeValue);
  if (!Number.isFinite(rawVolume) || rawVolume < 0) {
    return 1;
  }

  return parseFloat((rawVolume / 100).toFixed(4));
}

function hasUserUploadedVideoLayer(layer = {}) {
  return Boolean(layer?.hasUserVideoLayer || layer?.userVideoLayer || normalizeAudioLayerType(layer?.layerAiVideoType) === 'user_video');
}

function shouldWaitForTranscriptGeneration(videoSession = {}) {
  if (!videoSession?.transcriptGenerationPending) {
    return false;
  }

  if (videoSession.enableSubtitles === false) {
    return false;
  }

  const speechAudioLayerCount = [
    ...(Array.isArray(videoSession.audioLayers) ? videoSession.audioLayers : []),
    ...(Array.isArray(videoSession.branchedAudioLayers) ? videoSession.branchedAudioLayers : []),
  ].filter(
    (layer) => normalizeAudioLayerType(layer?.generationType) === 'speech'
  ).length;

  return speechAudioLayerCount > 0;
}

async function cleanupStaleFrameGenerationsForSession(videoSession = null, renderPathId = null) {
  const sessionId = videoSession?._id?.toString?.();
  if (!sessionId) {
    return {
      blockingFrameGenerationCount: 0,
      deletedFrameGenerationCount: 0,
    };
  }

  const frameGenerationQuery = { sessionId };
  if (isBranchedVideoSession(videoSession) && normalizeBranchRenderId(renderPathId)) {
    frameGenerationQuery.renderPathId = normalizeBranchRenderId(renderPathId);
  }
  const pendingFrameGenerations = await FrameGeneration.find(frameGenerationQuery)
    .select('_id layerId renderPathId pathSequenceIndex')
    .lean();

  if (!pendingFrameGenerations.length) {
    return {
      blockingFrameGenerationCount: 0,
      deletedFrameGenerationCount: 0,
    };
  }

  const pendingLayerIdSet = new Set(
    (Array.isArray(videoSession?.layers) ? videoSession.layers : [])
      .filter((layer) => layer?.frameGenerationPending)
      .map((layer) => layer?._id?.toString?.())
      .filter(Boolean)
  );

  const branchTimelineStates = new Map();
  if (isBranchedVideoSession(videoSession)) {
    const branchRenderPaths = Array.isArray(videoSession?.branchRenderPaths)
      ? videoSession.branchRenderPaths
      : [];
    for (const branchRenderPath of branchRenderPaths) {
      const branchPathId = normalizeBranchRenderId(branchRenderPath?.pathId);
      const branchTimeline = Array.isArray(branchRenderPath?.timeline)
        ? branchRenderPath.timeline
        : [];
      for (let timelineIndex = 0; timelineIndex < branchTimeline.length; timelineIndex += 1) {
        const timelineEntry = branchTimeline[timelineIndex];
        const branchLayerId = normalizeBranchRenderId(timelineEntry?.layerId ?? timelineEntry?._id);
        if (branchPathId && branchLayerId) {
          const sequenceIndex = Number.isInteger(Number(timelineEntry?.sequenceIndex))
            ? Number(timelineEntry.sequenceIndex)
            : timelineIndex;
          branchTimelineStates.set(`${branchPathId}:${sequenceIndex}:${branchLayerId}`, {
            pending: timelineEntry?.frameGenerationPending === true,
            status: String(timelineEntry?.frameGenerationStatus || '').trim().toUpperCase(),
          });
        }
      }
    }
  }

  const staleFrameGenerationIds = [];
  let blockingFrameGenerationCount = 0;

  for (const frameGeneration of pendingFrameGenerations) {
    const layerId = frameGeneration?.layerId?.toString?.();
    const frameRenderPathId = normalizeBranchRenderId(frameGeneration?.renderPathId);
    const pathSequenceIndex = Number.isInteger(Number(frameGeneration?.pathSequenceIndex))
      ? Number(frameGeneration.pathSequenceIndex)
      : null;
    const branchTimelineState = pathSequenceIndex === null
      ? null
      : branchTimelineStates.get(`${frameRenderPathId}:${pathSequenceIndex}:${layerId}`);
    if (
      frameRenderPathId
      && layerId
      && branchTimelineState
    ) {
      const isTerminalFrameState = ['COMPLETED', 'FAILED', 'CANCELLED']
        .includes(branchTimelineState.status);
      if (branchTimelineState.pending || !isTerminalFrameState) {
        blockingFrameGenerationCount += 1;
      } else if (frameGeneration?._id) {
        staleFrameGenerationIds.push(frameGeneration._id);
      }
      continue;
    }
    if (layerId && pendingLayerIdSet.has(layerId)) {
      blockingFrameGenerationCount += 1;
      continue;
    }

    if (frameGeneration?._id) {
      staleFrameGenerationIds.push(frameGeneration._id);
    }
  }

  if (staleFrameGenerationIds.length > 0) {
    await FrameGeneration.deleteMany({
      _id: { $in: staleFrameGenerationIds },
    });
  }

  return {
    blockingFrameGenerationCount,
    deletedFrameGenerationCount: staleFrameGenerationIds.length,
  };
}

function getLayerObjectId(layer = {}) {
  return layer?._id?.toString?.() || layer?._id || null;
}

function shouldHaveRenderableLayerFrames(layer = {}) {
  const duration = Number(layer?.duration);
  return Number.isFinite(duration) && duration > 0;
}

async function requeueMissingLayerFrameGeneration(
  videoSessionId,
  missingLayers = [],
  branchRenderContext = null,
  renderPlanVersion = null,
) {
  const uniqueMissingLayers = [];
  const seenLayerIds = new Set();
  for (const missingLayer of missingLayers) {
    const layerId = missingLayer?.layerId;
    if (!layerId || seenLayerIds.has(layerId)) {
      continue;
    }
    seenLayerIds.add(layerId);
    uniqueMissingLayers.push(missingLayer);
  }

  if (!uniqueMissingLayers.length) {
    return;
  }

  const setPayload = {
    frameGenerationPending: true,
    videoGenerationPending: true,
    generationError: null,
    'expressGenerationStatus.frame_generation': 'PENDING',
    'expressGenerationStatus.video_generation': 'PENDING',
  };
  if (branchRenderContext) {
    const branchPathPrefix = `branchRenderPaths.${branchRenderContext.pathIndex}`;
    setPayload[`${branchPathPrefix}.frameGenerationPending`] = true;
    setPayload[`${branchPathPrefix}.frameGenerationStatus`] = 'PENDING';
    setPayload[`${branchPathPrefix}.frameGenerationError`] = null;
    setPayload[`${branchPathPrefix}.videoGenerationPending`] = true;
    setPayload[`${branchPathPrefix}.videoGenerationStatus`] = 'PENDING';
    setPayload[`${branchPathPrefix}.videoGenerationError`] = null;
    for (const { layerIndex, timelineIndex = layerIndex } of uniqueMissingLayers) {
      if (!Number.isInteger(timelineIndex) || timelineIndex < 0) {
        continue;
      }
      setPayload[`${branchPathPrefix}.timeline.${timelineIndex}.frameGenerationPending`] = true;
      setPayload[`${branchPathPrefix}.timeline.${timelineIndex}.frames`] = [];
    }
  } else {
    for (const { layerIndex } of uniqueMissingLayers) {
      if (!Number.isInteger(layerIndex) || layerIndex < 0) {
        continue;
      }
      setPayload[`layers.${layerIndex}.frameGenerationPending`] = true;
      setPayload[`layers.${layerIndex}.aiVideoFrameGenerationPending`] = false;
      setPayload[`layers.${layerIndex}.initFramesGenerated`] = false;
      setPayload[`layers.${layerIndex}.frames`] = [];
    }
  }

  await VideoSession.updateOne({ _id: videoSessionId }, { $set: setPayload });
  await Promise.all(uniqueMissingLayers.map(({ layerId, layerIndex, pathSequenceIndex = layerIndex }) =>
    FrameGeneration.updateOne(
      {
        sessionId: videoSessionId,
        layerId,
        ...(branchRenderContext
          ? { renderPathId: branchRenderContext.renderPathId }
          : { renderPathId: { $in: [null, ''] } }),
      },
      {
        $setOnInsert: {
          sessionId: videoSessionId,
          layerId,
          rowLocked: false,
          isVideoGenerationRequest: true,
          isExpressFrameGenerationRequest: true,
          ...(branchRenderContext ? {
            renderPathId: branchRenderContext.renderPathId,
            renderPlanVersion,
            pathSequenceIndex,
          } : {}),
        },
      },
      { upsert: true },
    )
  ));
}

function shouldApplyVideoBoundaryDissolve(previousLayer = {}, nextLayer = {}) {
  return hasUserUploadedVideoLayer(previousLayer) || hasUserUploadedVideoLayer(nextLayer);
}

function getSceneDissolveFrameCount(framesPerSecond, availableFrameCount) {
  const targetFrameCount = Math.max(1, Math.round((Number(framesPerSecond) || DEFAULT_FRAMES_PER_SECOND) * SCENE_DISSOLVE_DURATION_SECONDS));
  return Math.max(0, Math.min(targetFrameCount, availableFrameCount));
}

async function applySceneBoundaryDissolveFrames({
  frameOutputPath,
  previousRange,
  nextRange,
  framesPerSecond,
}) {
  if (!previousRange || !nextRange) {
    return;
  }

  const previousFrameCount = Math.max(0, (previousRange.endIndex - previousRange.startIndex) + 1);
  const nextFrameCount = Math.max(0, (nextRange.endIndex - nextRange.startIndex) + 1);
  const dissolveFrameCount = getSceneDissolveFrameCount(
    framesPerSecond,
    Math.min(previousFrameCount, nextFrameCount)
  );

  if (dissolveFrameCount <= 0) {
    return;
  }

  for (let index = 0; index < dissolveFrameCount; index += 1) {
    const previousFrameIndex = previousRange.endIndex - dissolveFrameCount + 1 + index;
    const nextFrameIndex = nextRange.startIndex + index;

    if (previousFrameIndex < previousRange.startIndex || nextFrameIndex > nextRange.endIndex) {
      continue;
    }

    const previousFramePath = path.join(frameOutputPath, `${previousFrameIndex}.png`);
    const nextFramePath = path.join(frameOutputPath, `${nextFrameIndex}.png`);

    if (!fs.existsSync(previousFramePath) || !fs.existsSync(nextFramePath)) {
      continue;
    }

    const nextFrameOpacity = (index + 1) / (dissolveFrameCount + 1);
    const nextFrameBuffer = await sharp(nextFramePath).ensureAlpha().toBuffer();
    const blendedFrameBuffer = await sharp(previousFramePath)
      .ensureAlpha()
      .composite([{
        input: nextFrameBuffer,
        blend: 'over',
        opacity: nextFrameOpacity,
      }])
      .png()
      .toBuffer();

    await fs.promises.writeFile(nextFramePath, blendedFrameBuffer);
  }
}

function normalizeFramesPerSecond(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.round(parsed);
  if (!VALID_FRAMES_PER_SECOND.has(rounded)) {
    return null;
  }
  return rounded;
}

function resolveFramesPerSecond(videoSession, userData) {
  return (
    normalizeFramesPerSecond(videoSession?.framesPerSecond) ??
    normalizeFramesPerSecond(userData?.videoFramesPerSecond) ??
    DEFAULT_FRAMES_PER_SECOND
  );
}

function formatFFmpegNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }
  return `${Number(numericValue.toFixed(4))}`;
}

function buildFrameEvaluatedVolumeFilter(volumeExpression) {
  return `volume='${volumeExpression}':eval=frame`;
}

function buildSafeFrameEvaluatedVolumeExpressionFilter({
  volumeExpression,
  fallbackGain = 1,
  context = {},
  maxExpressionLength = MAX_FRAME_EVALUATED_VOLUME_EXPRESSION_LENGTH,
}) {
  const resolvedExpression = typeof volumeExpression === 'string' && volumeExpression.trim()
    ? volumeExpression.trim()
    : `${formatFFmpegNumber(fallbackGain)}`;
  const resolvedMaxExpressionLength = Number.isFinite(Number(maxExpressionLength))
    ? Math.max(0, Number(maxExpressionLength))
    : MAX_FRAME_EVALUATED_VOLUME_EXPRESSION_LENGTH;

  if (resolvedMaxExpressionLength > 0 && resolvedExpression.length > resolvedMaxExpressionLength) {
    return `volume=${formatFFmpegNumber(fallbackGain)}`;
  }

  return buildFrameEvaluatedVolumeFilter(resolvedExpression);
}

function buildSafeFrameEvaluatedVolumeFilter({
  points,
  fallbackGain = 1,
  context = {},
  maxPoints = MAX_FRAME_EVALUATED_VOLUME_POINTS,
  maxExpressionLength = MAX_FRAME_EVALUATED_VOLUME_EXPRESSION_LENGTH,
}) {
  if (!Array.isArray(points) || points.length <= 1) {
    return `volume=${formatFFmpegNumber(fallbackGain)}`;
  }

  const resolvedMaxPoints = Number.isFinite(Number(maxPoints))
    ? Math.max(0, Number(maxPoints))
    : MAX_FRAME_EVALUATED_VOLUME_POINTS;
  if (resolvedMaxPoints > 0 && points.length > resolvedMaxPoints) {
    return `volume=${formatFFmpegNumber(fallbackGain)}`;
  }

  const expression = buildAudioVolumeExpression(points, formatFFmpegNumber);
  const resolvedMaxExpressionLength = Number.isFinite(Number(maxExpressionLength))
    ? Math.max(0, Number(maxExpressionLength))
    : MAX_FRAME_EVALUATED_VOLUME_EXPRESSION_LENGTH;
  if (resolvedMaxExpressionLength > 0 && expression.length > resolvedMaxExpressionLength) {
    return `volume=${formatFFmpegNumber(fallbackGain)}`;
  }

  return buildFrameEvaluatedVolumeFilter(expression);
}

function resolveAudioLayerSourceValue(audioLayer = {}) {
  if (typeof audioLayer.selectedLocalAudioLink === 'string' && audioLayer.selectedLocalAudioLink.trim()) {
    return audioLayer.selectedLocalAudioLink.trim();
  }

  if (Array.isArray(audioLayer.localAudioLinks) && audioLayer.localAudioLinks.length > 0) {
    const localAudioLink = audioLayer.localAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (localAudioLink) {
      return localAudioLink.trim();
    }
  }

  if (typeof audioLayer.url === 'string' && audioLayer.url.trim()) {
    return audioLayer.url.trim();
  }

  if (typeof audioLayer.selectedRemoteAudioLink === 'string' && audioLayer.selectedRemoteAudioLink.trim()) {
    return audioLayer.selectedRemoteAudioLink.trim();
  }

  if (Array.isArray(audioLayer.remoteAudioLinks) && audioLayer.remoteAudioLinks.length > 0) {
    const remoteAudioLink = audioLayer.remoteAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (remoteAudioLink) {
      return remoteAudioLink.trim();
    }
  }

  if (Array.isArray(audioLayer.remoteAudioData) && audioLayer.remoteAudioData.length > 0) {
    const remoteAudioData = audioLayer.remoteAudioData.find((audioData) => (
      typeof audioData?.audio_url === 'string' && audioData.audio_url.trim()
    ));
    if (remoteAudioData?.audio_url) {
      return remoteAudioData.audio_url.trim();
    }
  }

  return null;
}

function resolveLocalAudioPath(audioSource, pwd) {
  if (typeof audioSource !== 'string' || !audioSource.trim()) {
    return null;
  }

  const trimmedSource = audioSource.trim();
  if (/^https?:\/\//i.test(trimmedSource)) {
    return trimmedSource;
  }

  return resolveExistingProcessorAssetPath(trimmedSource, pwd);
}

function resolveRenderableAudioPath(audioLayer, pwd) {
  const sourceValue = resolveAudioLayerSourceValue(audioLayer);
  if (!sourceValue) {
    return null;
  }

  return resolveLocalAudioPath(sourceValue, pwd);
}

function resolveAudioLayerTiming(audioLayer = {}, connectedLayer = null) {
  const layerStartTime = Number.isFinite(Number(audioLayer?.startTime))
    ? Math.max(0, Number(audioLayer.startTime))
    : null;
  const layerDuration = Number.isFinite(Number(audioLayer?.duration)) && Number(audioLayer.duration) > 0
    ? Number(audioLayer.duration)
    : null;
  const layerEndTime = Number.isFinite(Number(audioLayer?.endTime)) && Number(audioLayer.endTime) > (layerStartTime ?? 0)
    ? Math.max(layerStartTime ?? 0, Number(audioLayer.endTime))
    : null;
  const originalDuration = Number.isFinite(Number(audioLayer?.originalDuration)) && Number(audioLayer.originalDuration) > 0
    ? Number(audioLayer.originalDuration)
    : null;

  const connectedLayerStartTime = Number.isFinite(Number(connectedLayer?.durationOffset))
    ? Math.max(0, Number(connectedLayer.durationOffset))
    : null;
  const connectedLayerDuration = Number.isFinite(Number(connectedLayer?.duration))
    ? Math.max(0, Number(connectedLayer.duration))
    : null;

  let resolvedStartTime = layerStartTime ?? connectedLayerStartTime ?? 0;
  let resolvedEndTime = layerEndTime
    ?? (layerDuration !== null
      ? resolvedStartTime + layerDuration
      : originalDuration !== null
        ? resolvedStartTime + originalDuration
        : connectedLayerStartTime !== null && connectedLayerDuration !== null
          ? connectedLayerStartTime + connectedLayerDuration
          : connectedLayerDuration !== null
            ? resolvedStartTime + connectedLayerDuration
            : resolvedStartTime);
  let resolvedDuration = Math.max(
    0,
    layerDuration ?? (resolvedEndTime - resolvedStartTime)
  );

  if (connectedLayerStartTime !== null && connectedLayerDuration !== null) {
    const connectedLayerEndTime = connectedLayerStartTime + connectedLayerDuration;
    const startsInsideConnectedLayer = (
      resolvedStartTime >= connectedLayerStartTime - 0.001
      && resolvedStartTime < connectedLayerEndTime + 0.001
    );

    if (startsInsideConnectedLayer) {
      resolvedEndTime = Math.min(resolvedEndTime, connectedLayerEndTime);
      resolvedDuration = Math.max(0, Math.min(
        resolvedDuration,
        resolvedEndTime - resolvedStartTime
      ));
    }
  }

  return {
    startTime: resolvedStartTime,
    endTime: Math.max(resolvedStartTime, resolvedEndTime),
    duration: resolvedDuration,
  };
}

function buildMusicDuckingWindows({
  musicStartTime,
  musicEndTime,
  duckingLayers,
  attackDurationSeconds = MUSIC_DUCK_ATTACK_DURATION_SECONDS,
  releaseDurationSeconds = MUSIC_DUCK_RELEASE_DURATION_SECONDS,
  mergeGapSeconds = MUSIC_DUCK_MERGE_GAP_SECONDS,
}) {
  if (!Array.isArray(duckingLayers) || duckingLayers.length === 0) {
    return [];
  }

  const overlapWindows = duckingLayers
    .map((layer) => {
      const layerStartTime = Number.isFinite(Number(layer?.startTime))
        ? Math.max(0, Number(layer.startTime))
        : 0;
      const layerEndTime = Number.isFinite(Number(layer?.endTime))
        ? Math.max(layerStartTime, Number(layer.endTime))
        : layerStartTime;
      const overlapStart = Math.max(musicStartTime, layerStartTime);
      const overlapEnd = Math.min(musicEndTime, layerEndTime);
      if (overlapEnd <= overlapStart) {
        return null;
      }

      return {
        start: overlapStart,
        end: overlapEnd,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    });

  if (overlapWindows.length === 0) {
    return [];
  }

  const mergedWindows = [overlapWindows[0]];
  for (let index = 1; index < overlapWindows.length; index += 1) {
    const currentWindow = overlapWindows[index];
    const previousWindow = mergedWindows[mergedWindows.length - 1];

    if (currentWindow.start <= previousWindow.end + mergeGapSeconds) {
      previousWindow.end = Math.max(previousWindow.end, currentWindow.end);
      continue;
    }

    mergedWindows.push(currentWindow);
  }

  return mergedWindows.map((window) => {
    return {
      start: window.start,
      end: window.end,
      fadeDuration: attackDurationSeconds,
      attackDuration: attackDurationSeconds,
      releaseDuration: releaseDurationSeconds,
    };
  });
}

function normalizeMusicDuckingWindowsForExpression(duckingWindows = []) {
  const sortedWindows = (Array.isArray(duckingWindows) ? duckingWindows : [])
    .filter((window) => Number.isFinite(Number(window?.start)) && Number.isFinite(Number(window?.end)))
    .map((window) => {
      const start = Math.max(0, Number(window.start));
      const end = Math.max(start, Number(window.end));
      const fallbackFadeDuration = Number.isFinite(Number(window?.fadeDuration))
        ? Math.max(0, Number(window.fadeDuration))
        : MUSIC_DUCK_ATTACK_DURATION_SECONDS;
      const hasAttackDuration = window?.attackDuration != null
        && Number.isFinite(Number(window.attackDuration));
      const hasReleaseDuration = window?.releaseDuration != null
        && Number.isFinite(Number(window.releaseDuration));

      return {
        start,
        end,
        fadeDuration: fallbackFadeDuration,
        attackDuration: hasAttackDuration
          ? Math.max(0, Number(window.attackDuration))
          : fallbackFadeDuration,
        releaseDuration: hasReleaseDuration
          ? Math.max(0, Number(window.releaseDuration))
          : Math.max(fallbackFadeDuration, MUSIC_DUCK_RELEASE_DURATION_SECONDS),
      };
    })
    .filter((window) => window.end > window.start)
    .sort((leftWindow, rightWindow) => {
      if (leftWindow.start !== rightWindow.start) {
        return leftWindow.start - rightWindow.start;
      }
      return leftWindow.end - rightWindow.end;
    });

  if (sortedWindows.length === 0) {
    return [];
  }

  const normalizedWindows = [sortedWindows[0]];
  for (let index = 1; index < sortedWindows.length; index += 1) {
    const currentWindow = sortedWindows[index];
    const previousWindow = normalizedWindows[normalizedWindows.length - 1];
    const previousEffectiveEnd = previousWindow.end + previousWindow.releaseDuration;
    const currentEffectiveStart = currentWindow.start - currentWindow.attackDuration;

    if (currentEffectiveStart <= previousEffectiveEnd) {
      previousWindow.end = Math.max(previousWindow.end, currentWindow.end);
      previousWindow.fadeDuration = Math.max(previousWindow.fadeDuration, currentWindow.fadeDuration);
      previousWindow.attackDuration = Math.max(previousWindow.attackDuration, currentWindow.attackDuration);
      previousWindow.releaseDuration = Math.max(previousWindow.releaseDuration, currentWindow.releaseDuration);
      continue;
    }

    normalizedWindows.push(currentWindow);
  }

  return normalizedWindows;
}

function buildAudioLocalDuckingWindows({
  duckingWindows = [],
  audioStartTime = 0,
  audioDuration = 0,
}) {
  const resolvedAudioStartTime = Number.isFinite(Number(audioStartTime))
    ? Math.max(0, Number(audioStartTime))
    : 0;
  const resolvedAudioDuration = Number.isFinite(Number(audioDuration))
    ? Math.max(0, Number(audioDuration))
    : 0;

  if (!Array.isArray(duckingWindows) || duckingWindows.length === 0 || resolvedAudioDuration <= 0) {
    return [];
  }

  return normalizeMusicDuckingWindowsForExpression(
    duckingWindows
      .map((window) => {
        const timelineWindowStart = Number.isFinite(Number(window?.start))
          ? Number(window.start)
          : null;
        const timelineWindowEnd = Number.isFinite(Number(window?.end))
          ? Number(window.end)
          : null;

        if (timelineWindowStart == null || timelineWindowEnd == null) {
          return null;
        }

        const localStart = Math.max(0, Math.min(
          resolvedAudioDuration,
          timelineWindowStart - resolvedAudioStartTime,
        ));
        const localEnd = Math.max(localStart, Math.min(
          resolvedAudioDuration,
          timelineWindowEnd - resolvedAudioStartTime,
        ));

        if (localEnd <= localStart) {
          return null;
        }

        return {
          start: localStart,
          end: localEnd,
          fadeDuration: Number.isFinite(Number(window?.fadeDuration))
            ? Math.max(0, Number(window.fadeDuration))
            : 0,
          attackDuration: window?.attackDuration != null && Number.isFinite(Number(window.attackDuration))
            ? Math.max(0, Number(window.attackDuration))
            : undefined,
          releaseDuration: window?.releaseDuration != null && Number.isFinite(Number(window.releaseDuration))
            ? Math.max(0, Number(window.releaseDuration))
            : undefined,
        };
      })
      .filter(Boolean),
  );
}

function smoothStep(value) {
  const clampedValue = Math.min(Math.max(Number(value) || 0, 0), 1);
  return clampedValue * clampedValue * (3 - (2 * clampedValue));
}

function pushSmoothGainRamp({
  automationPoints,
  startTime,
  endTime,
  startGain,
  endGain,
}) {
  const resolvedStartTime = Number.isFinite(Number(startTime))
    ? Math.max(0, Number(startTime))
    : 0;
  const resolvedEndTime = Number.isFinite(Number(endTime))
    ? Math.max(resolvedStartTime, Number(endTime))
    : resolvedStartTime;
  const resolvedStartGain = Math.max(0, Number(startGain) || 0);
  const resolvedEndGain = Math.max(0, Number(endGain) || 0);

  if (resolvedEndTime <= resolvedStartTime + 0.0001) {
    automationPoints.push({ time: resolvedStartTime, gain: resolvedEndGain });
    return;
  }

  const rampStops = [0, 0.2, 0.4, 0.6, 0.8, 1];
  rampStops.forEach((progress) => {
    const easedProgress = smoothStep(progress);
    automationPoints.push({
      time: resolvedStartTime + ((resolvedEndTime - resolvedStartTime) * progress),
      gain: resolvedStartGain + ((resolvedEndGain - resolvedStartGain) * easedProgress),
    });
  });
}

function buildSmoothStepGainExpression({
  startTime,
  duration,
  startGain,
  endGain,
}) {
  const resolvedDuration = Number.isFinite(Number(duration))
    ? Math.max(0, Number(duration))
    : 0;

  if (resolvedDuration <= 0.0001) {
    return formatFFmpegNumber(endGain);
  }

  const startTimeValue = formatFFmpegNumber(startTime);
  const durationValue = formatFFmpegNumber(resolvedDuration);
  const startGainValue = formatFFmpegNumber(startGain);
  const gainDeltaValue = formatFFmpegNumber((Number(endGain) || 0) - (Number(startGain) || 0));
  const progressExpression = `((t-${startTimeValue})/${durationValue})`;
  const easedProgressExpression = `((${progressExpression})*(${progressExpression})*(3-(2*(${progressExpression}))))`;

  return `${startGainValue}+(${gainDeltaValue}*${easedProgressExpression})`;
}

function buildMusicDuckingSmoothEnvelopeExpression({
  duckingWindows,
  duckedVolumeRatio = MUSIC_DUCKED_VOLUME_RATIO,
}) {
  const normalizedDuckingWindows = normalizeMusicDuckingWindowsForExpression(duckingWindows);
  if (!Array.isArray(normalizedDuckingWindows) || normalizedDuckingWindows.length === 0) {
    return '1';
  }

  const duckedRatio = Math.max(0, Number(duckedVolumeRatio) || 0);
  const duckedRatioValue = formatFFmpegNumber(duckedRatio);
  let expression = '1';

  for (let index = normalizedDuckingWindows.length - 1; index >= 0; index -= 1) {
    const duckingWindow = normalizedDuckingWindows[index];
    const fallbackFadeDuration = Number.isFinite(Number(duckingWindow?.fadeDuration))
      ? Math.max(0, Number(duckingWindow.fadeDuration))
      : MUSIC_DUCK_ATTACK_DURATION_SECONDS;
    const attackDuration = duckingWindow?.attackDuration != null && Number.isFinite(Number(duckingWindow.attackDuration))
      ? Math.max(0, Number(duckingWindow.attackDuration))
      : fallbackFadeDuration;
    const releaseDuration = duckingWindow?.releaseDuration != null && Number.isFinite(Number(duckingWindow.releaseDuration))
      ? Math.max(0, Number(duckingWindow.releaseDuration))
      : Math.max(fallbackFadeDuration, MUSIC_DUCK_RELEASE_DURATION_SECONDS);
    const duckStart = Number.isFinite(Number(duckingWindow?.start))
      ? Math.max(0, Number(duckingWindow.start))
      : 0;
    const duckEnd = Number.isFinite(Number(duckingWindow?.end))
      ? Math.max(duckStart, Number(duckingWindow.end))
      : duckStart;

    if (duckEnd <= duckStart) {
      continue;
    }

    const attackStart = Math.max(0, duckStart - attackDuration);
    const resolvedAttackDuration = duckStart - attackStart;
    const releaseEnd = duckEnd + releaseDuration;
    const attackExpression = resolvedAttackDuration > 0.0001
      ? buildSmoothStepGainExpression({
        startTime: attackStart,
        duration: resolvedAttackDuration,
        startGain: 1,
        endGain: duckedRatio,
      })
      : duckedRatioValue;
    const releaseExpression = releaseDuration > 0.0001
      ? buildSmoothStepGainExpression({
        startTime: duckEnd,
        duration: releaseDuration,
        startGain: duckedRatio,
        endGain: 1,
      })
      : expression;

    expression = (
      `if(lt(t,${formatFFmpegNumber(attackStart)}),1,` +
      `if(lt(t,${formatFFmpegNumber(duckStart)}),${attackExpression},` +
      `if(lt(t,${formatFFmpegNumber(duckEnd)}),${duckedRatioValue},` +
      `if(lt(t,${formatFFmpegNumber(releaseEnd)}),${releaseExpression},${expression}))))`
    );
  }

  return expression;
}

function buildMusicDuckingVolumeExpression({
  duckingWindows,
  duckedVolumeRatio = MUSIC_DUCKED_VOLUME_RATIO,
}) {
  const dedupedPoints = buildMusicDuckingVolumePoints({
    duckingWindows,
    duckedVolumeRatio,
  });
  if (dedupedPoints.length <= 1) {
    return '1';
  }

  return buildAudioVolumeExpression(dedupedPoints, formatFFmpegNumber);
}

function buildMusicDuckingVolumePoints({
  duckingWindows,
  duckedVolumeRatio = MUSIC_DUCKED_VOLUME_RATIO,
}) {
  const normalizedDuckingWindows = normalizeMusicDuckingWindowsForExpression(duckingWindows);
  if (!Array.isArray(normalizedDuckingWindows) || normalizedDuckingWindows.length === 0) {
    return [{ time: 0, gain: 1 }];
  }

  const duckedRatio = Math.max(0, Number(duckedVolumeRatio) || 0);
  const automationPoints = [{
    time: 0,
    gain: 1,
  }];

  for (let index = 0; index < normalizedDuckingWindows.length; index += 1) {
    const duckingWindow = normalizedDuckingWindows[index];
    const fallbackFadeDuration = Number.isFinite(Number(duckingWindow?.fadeDuration))
      ? Math.max(0, Number(duckingWindow.fadeDuration))
      : MUSIC_DUCK_ATTACK_DURATION_SECONDS;
    const attackDuration = duckingWindow?.attackDuration != null && Number.isFinite(Number(duckingWindow.attackDuration))
      ? Math.max(0, Number(duckingWindow.attackDuration))
      : fallbackFadeDuration;
    const releaseDuration = duckingWindow?.releaseDuration != null && Number.isFinite(Number(duckingWindow.releaseDuration))
      ? Math.max(0, Number(duckingWindow.releaseDuration))
      : Math.max(fallbackFadeDuration, MUSIC_DUCK_RELEASE_DURATION_SECONDS);
    const duckStart = Number.isFinite(Number(duckingWindow?.start))
      ? Math.max(0, Number(duckingWindow.start))
      : 0;
    const duckEnd = Number.isFinite(Number(duckingWindow?.end))
      ? Math.max(duckStart, Number(duckingWindow.end))
      : duckStart;

    if (duckEnd <= duckStart) {
      continue;
    }

    if (attackDuration > 0) {
      pushSmoothGainRamp({
        automationPoints,
        startTime: Math.max(0, duckStart - attackDuration),
        endTime: duckStart,
        startGain: 1,
        endGain: duckedRatio,
      });
    } else {
      automationPoints.push(
        { time: duckStart, gain: 1 },
        { time: duckStart, gain: duckedRatio },
      );
    }

    automationPoints.push({ time: duckEnd, gain: duckedRatio });

    if (releaseDuration > 0) {
      pushSmoothGainRamp({
        automationPoints,
        startTime: duckEnd,
        endTime: duckEnd + releaseDuration,
        startGain: duckedRatio,
        endGain: 1,
      });
    } else {
      automationPoints.push(
        { time: duckEnd, gain: duckedRatio },
        { time: duckEnd, gain: 1 },
      );
    }
  }

  const dedupedPoints = [];
  for (const point of automationPoints) {
    const normalizedTime = Number.isFinite(Number(point?.time))
      ? Math.max(0, Number(point.time))
      : 0;
    const normalizedGain = Number.isFinite(Number(point?.gain))
      ? Math.max(0, Number(point.gain))
      : 1;
    const previousPoint = dedupedPoints[dedupedPoints.length - 1];
    if (
      previousPoint
      && Math.abs(previousPoint.time - normalizedTime) < 0.0001
      && Math.abs(previousPoint.gain - normalizedGain) < 0.0001
    ) {
      continue;
    }

    dedupedPoints.push({
      time: normalizedTime,
      gain: normalizedGain,
    });
  }

  return dedupedPoints;
}

function shouldAnalyzeStudioMusicDucking({
  applyAudioDucking,
  isExpressGeneration,
  audioList = [],
}) {
  return false;
}

let isShuttingDown = false;
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

async function shutdown(reason = 'unknown', error = null) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (error) {
    console.error('Shutdown triggered by error:', error);
  }

  try {
    if (ffmpegProcesses.size > 0) {
    }
    for (const command of ffmpegProcesses) {
      try {
        if (typeof command.kill === 'function') {
          command.kill('SIGTERM');
        } else if (command.ffmpegProc) {
          command.ffmpegProc.kill('SIGTERM');
        }
      } catch (killErr) {
        console.error('Failed to stop ffmpeg process during shutdown:', killErr);
      }
    }
  } catch (shutdownErr) {
    console.error('Error during shutdown:', shutdownErr);
  } finally {
    const exitCode = error ? 1 : 0;
    process.exit(exitCode);
  }
}

// Main loop
export async function getPendingVideoRequestsAndProcess() {
  while (!isShuttingDown) {
    try {
      await getTimeout(1000);
      await generatePendingVideoRequests();
    } catch (e) {
      console.error('An unexpected error occurred during video processing:', e);
      // continue loop
    }
  }
}

async function getTimeout(timeout = 1000) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

async function resolvePremiumFlagForSession(videoSession = {}) {
  if (!videoSession?.userId) {
    return false;
  }

  try {
    const user = await User.findById(videoSession.userId)
      .select('isPremiumUser isPartnerUser')
      .lean();
    return Boolean(user?.isPremiumUser || user?.isPartnerUser);
  } catch (error) {
    console.error('Failed to resolve premium flag for repaired video request', {
      sessionId: videoSession?._id?.toString?.(),
      error: error?.message || error,
    });
    return false;
  }
}

async function repairMissingDockerFinalVideoRequests() {
  if (!isDockerLocalFinalVideoQueueRepairEnabled()) {
    return;
  }

  const now = Date.now();
  if (now - lastDockerFinalVideoQueueRepairAt < DOCKER_FINAL_VIDEO_QUEUE_REPAIR_INTERVAL_MS) {
    return;
  }
  lastDockerFinalVideoQueueRepairAt = now;

  const candidateSessions = await VideoSession.find({
    videoGenerationPending: true,
    frameGenerationPending: { $ne: true },
    expressGenerationFailed: { $ne: true },
    expressGenerationCancelled: { $ne: true },
    $or: [
      { narrativeType: 'branched' },
      { sourceNarrativeType: 'branched' },
      {
        $and: [
          {
            $or: [
              { remoteURL: { $exists: false } },
              { remoteURL: null },
              { remoteURL: '' },
            ],
          },
          {
            $or: [
              { videoLink: { $exists: false } },
              { videoLink: null },
              { videoLink: '' },
            ],
          },
        ],
      },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(DOCKER_FINAL_VIDEO_QUEUE_REPAIR_LIMIT)
    .lean();

  for (const videoSession of candidateSessions) {
    if (!shouldRepairMissingFinalVideoRequest(videoSession)) {
      continue;
    }

    const videoSessionId = videoSession?._id?.toString?.();
    if (!videoSessionId) {
      continue;
    }

    if (isBranchedVideoSession(videoSession)) {
      const isPremium = await resolvePremiumFlagForSession(videoSession);
      const renderPlanVersion = Number(videoSession?.renderPlanVersion) || 1;
      const repairablePaths = getRepairableBranchRenderPaths(videoSession);
      for (const repairPath of repairablePaths) {
        const renderPathId = normalizeBranchRenderId(repairPath?.pathId);
        if (!renderPathId) {
          continue;
        }

        const existingVideoRequest = await VideoGeneration.findOne({
          videoSessionId,
          renderPathId,
        }).select('_id').lean();
        if (existingVideoRequest) {
          continue;
        }

        const pendingFrameRequest = await FrameGeneration.findOne({
          sessionId: videoSessionId,
          renderPathId,
        }).select('_id').lean();
        if (pendingFrameRequest) {
          continue;
        }

        const repairResult = await VideoGeneration.updateOne(
          { videoSessionId, renderPathId },
          {
            $setOnInsert: {
              videoSessionId,
              renderPathId,
              renderPlanVersion,
              isPremium,
              rowLocked: false,
              expireAt: new Date(),
            },
          },
          { upsert: true },
        );
        if (repairResult.upsertedCount > 0) {
          const pathMatch = findBranchRenderPath(videoSession, renderPathId);
          if (pathMatch) {
            const branchPathPatch = buildDockerFinalVideoQueueRepairBranchPathPatch();
            const setPayload = buildDockerFinalVideoQueueRepairSessionPatch();
            for (const [key, value] of Object.entries(branchPathPatch)) {
              setPayload[`branchRenderPaths.${pathMatch.pathIndex}.${key}`] = value;
            }
            await VideoSession.updateOne(
              { _id: videoSession._id },
              { $set: setPayload },
            );
          }
          console.warn('[video_generator] Requeued missing branched Docker-local final video request', {
            sessionId: videoSessionId,
            renderPathId,
          });
        }
      }
      continue;
    }

    const existingVideoRequest = await VideoGeneration.findOne({ videoSessionId })
      .select('_id')
      .lean();
    if (existingVideoRequest) {
      continue;
    }

    const pendingFrameRequest = await FrameGeneration.findOne({ sessionId: videoSessionId })
      .select('_id')
      .lean();
    if (pendingFrameRequest) {
      continue;
    }

    const isPremium = await resolvePremiumFlagForSession(videoSession);
    const repairResult = await VideoGeneration.updateOne(
      { videoSessionId },
      {
        $setOnInsert: {
          videoSessionId,
          isPremium,
          rowLocked: false,
          expireAt: new Date(),
        },
      },
      { upsert: true }
    );

    if (repairResult.upsertedCount > 0) {
      await VideoSession.updateOne(
        { _id: videoSession._id },
        { $set: buildDockerFinalVideoQueueRepairSessionPatch() }
      );
      console.warn('[video_generator] Requeued missing Docker-local final video request', {
        sessionId: videoSessionId,
      });
    }
  }
}

export async function generatePendingVideoRequests() {
  if (isShuttingDown) return;

  try {
    await getDBConnectionString();

    await repairMissingDockerFinalVideoRequests();

    const staleLockCutoff = new Date(Date.now() - STALE_VIDEO_GENERATION_LOCK_MS);
    const staleLockResult = await VideoGeneration.updateMany(
      { rowLocked: true, updatedAt: { $lt: staleLockCutoff } },
      { rowLocked: false }
    );
    if (staleLockResult.modifiedCount > 0) {
    }

    const pendingVideoRequests = await VideoGeneration.find({ rowLocked: false }).sort({ createdAt: -1 });

    for (const videoRequest of pendingVideoRequests) {
      if (isShuttingDown) break;

      await VideoGeneration.findByIdAndUpdate(videoRequest._id, { rowLocked: true });

      const videoSessionId = videoRequest.videoSessionId;
      const isPremium = videoRequest.isPremium;
      const videoSession = await VideoSession.findById(videoSessionId);

      if (!videoSession) {
        await VideoGeneration.findByIdAndDelete(videoRequest._id);
        continue;
      }

      const branchedSession = isBranchedVideoSession(videoSession);
      const requestedRenderPathId = normalizeBranchRenderId(videoRequest?.renderPathId);
      if (branchedSession && !requestedRenderPathId) {
        const renderPlanVersion = Number(videoSession?.renderPlanVersion) || 1;
        const repairablePaths = getRepairableBranchRenderPaths(videoSession);
        for (const renderPath of repairablePaths) {
          const renderPathId = normalizeBranchRenderId(renderPath?.pathId);
          if (!renderPathId) {
            continue;
          }
          await VideoGeneration.updateOne(
            { videoSessionId, renderPathId },
            {
              $setOnInsert: {
                videoSessionId,
                renderPathId,
                renderPlanVersion,
                isPremium,
                rowLocked: false,
                expireAt: new Date(),
              },
            },
            { upsert: true },
          );
        }
        await VideoGeneration.findByIdAndDelete(videoRequest._id);
        console.warn('[video_generator] Replaced unsafe session-level branched render request with path requests', {
          sessionId: videoSessionId,
          renderPathCount: repairablePaths.length,
        });
        continue;
      }

      if (shouldWaitForTranscriptGeneration(videoSession)) {
        await VideoGeneration.findByIdAndUpdate(videoRequest._id, { rowLocked: false });
        continue;
      }
      if (videoSession.transcriptGenerationPending) {
        await VideoSession.updateOne({ _id: videoSessionId }, { transcriptGenerationPending: false });
        videoSession.transcriptGenerationPending = false;
      }

      const {
        blockingFrameGenerationCount,
        deletedFrameGenerationCount,
      } = await cleanupStaleFrameGenerationsForSession(
        videoSession,
        branchedSession ? requestedRenderPathId : null,
      );
      if (deletedFrameGenerationCount > 0) {
      }
      if (blockingFrameGenerationCount > 0) {
        await VideoGeneration.findByIdAndUpdate(videoRequest._id, { rowLocked: false });
        continue;
      }
      if (!branchedSession && videoSession.frameGenerationPending) {
        await VideoSession.updateOne({ _id: videoSessionId }, { frameGenerationPending: false });
      }

      let userData = null;
      const sessionFps = normalizeFramesPerSecond(videoSession?.framesPerSecond);
      let framesPerSecond = sessionFps;
      if (!framesPerSecond) {
        userData = await User.findById(videoSession.userId)
          .select('videoFramesPerSecond displayName username email')
          .lean();
        framesPerSecond = resolveFramesPerSecond(videoSession, userData);
      }

      let numRetries = videoRequest.numRetries || 0;

      // skip audio pending check (legacy behaviour kept)

      try {
        // Prepare output frames folder
        const pwd = process.cwd();
        let branchRenderContext = null;
        if (branchedSession) {
          const sessionRenderPlanVersion = Number(videoSession?.renderPlanVersion) || 1;
          const requestRenderPlanVersion = Number(videoRequest?.renderPlanVersion);
          if (sessionRenderPlanVersion !== 1) {
            throw new Error(
              `Unsupported render plan version ${sessionRenderPlanVersion} for path ${requestedRenderPathId}.`,
            );
          }
          if (
            Number.isFinite(requestRenderPlanVersion)
            && requestRenderPlanVersion > 0
            && requestRenderPlanVersion !== sessionRenderPlanVersion
          ) {
            throw new Error(
              `Render plan version mismatch for path ${requestedRenderPathId}: request ${requestRenderPlanVersion}, session ${sessionRenderPlanVersion}.`,
            );
          }
          branchRenderContext = resolveBranchRenderContext(videoSession, requestedRenderPathId);
        }
        const sessionLayers = branchRenderContext?.layers ?? (videoSession.layers || []);
        const sessionAudioLayers = branchRenderContext?.audioLayers ?? (videoSession.audioLayers || []);
        const branchFramePathSegments = branchRenderContext
          ? ['paths', branchRenderContext.safeRenderPathId]
          : [];
        const frameOutputPath = resolveProcessorAssetWritePath(
          pwd,
          'video',
          'frames',
          videoSessionId,
          ...branchFramePathSegments,
          'output_files'
        );

        if (fs.existsSync(frameOutputPath)) {
          fs.rmSync(frameOutputPath, { recursive: true, force: true });
        }
        fs.mkdirSync(frameOutputPath, { recursive: true });

        // Resolve outro image path early so it can be used for frame generation
        let outroImagePath = null;
        if (videoSession.hasOutroImage && videoSession.outroImageURL) {
          try {
            const outroPath = videoSession.outroImageURL;
            const candidatePaths = getProcessorAssetCandidates(outroPath, pwd);


            for (const candidate of candidatePaths) {
              if (fs.existsSync(candidate)) {
                outroImagePath = candidate;
                break;
              }
            }

            if (!outroImagePath) {
            }
          } catch (err) {
            console.error(`Failed to resolve outro image for session ${videoSessionId}, continuing without outro`, err);
            outroImagePath = null;
          }
        }

        /**
         * Copy frames from each layer folder into the final output folder
         */
        const copiedLayerFrameRanges = [];
        const missingLayerFrameSources = [];
        let branchThumbnailArtifact = null;
        for (let counter = 0; counter < sessionLayers.length; counter++) {
          const currentLayer = sessionLayers[counter];
          const currentLayerId = getLayerObjectId(currentLayer);
          if (!currentLayerId) {
            continue;
          }
          let currentLayerFrames;
          let currentFolderPath;
          let currentFolderCandidates = [];
          try {
            currentFolderCandidates = getProcessorAssetCandidates(
              path.join(
                'video',
                'frames',
                videoSessionId,
                ...branchFramePathSegments,
                currentLayerId,
              ),
              pwd
            );
            for (const candidateFolderPath of currentFolderCandidates) {
              try {
                const candidateLayerFrames = fs.readdirSync(candidateFolderPath);
                if (candidateLayerFrames && candidateLayerFrames.length > 0) {
                  currentFolderPath = candidateFolderPath;
                  currentLayerFrames = candidateLayerFrames;
                  break;
                }
              } catch {
                // Try the next storage root.
              }
            }
          } catch (e) {
            continue;
          }

          if (!currentLayerFrames || currentLayerFrames.length === 0) {
            if (shouldHaveRenderableLayerFrames(currentLayer)) {
              missingLayerFrameSources.push({
                layerIndex: counter,
                timelineIndex: currentLayer?.timelineIndex ?? counter,
                pathSequenceIndex: currentLayer?.sequenceIndex ?? counter,
                layerId: currentLayerId,
                candidateFolders: currentFolderCandidates,
                reason: 'missing_frame_folder',
              });
            }
            continue;
          }

          const layerOutputStartIndex = fs.readdirSync(frameOutputPath).length;

          let { frameWidth, frameHeight } = await getImageSizeWithFallback(currentFolderPath);

          for (let i = 0; i < currentLayerFrames.length; i++) {
            const sourcePath = path.join(currentFolderPath, `${i}.png`);
            const currentDirLen = fs.readdirSync(frameOutputPath).length;
            const destinationPath = path.join(frameOutputPath, `${currentDirLen}.png`);

            if (fs.existsSync(sourcePath)) {
              fs.copyFileSync(sourcePath, destinationPath);
            } else {
              missingLayerFrameSources.push({
                layerIndex: counter,
                timelineIndex: currentLayer?.timelineIndex ?? counter,
                pathSequenceIndex: currentLayer?.sequenceIndex ?? counter,
                layerId: currentLayerId,
                candidateFolders: [currentFolderPath],
                reason: 'missing_numbered_frame',
                missingFrame: sourcePath,
              });
              break;
            }
          }

          const layerOutputEndIndex = fs.readdirSync(frameOutputPath).length - 1;
          if (layerOutputEndIndex >= layerOutputStartIndex) {
            copiedLayerFrameRanges.push({
              layerIndex: counter,
              layerId: currentLayerId,
              layer: currentLayer,
              sourceFolderPath: currentFolderPath,
              startIndex: layerOutputStartIndex,
              endIndex: layerOutputEndIndex,
            });
          }
        }

        if (missingLayerFrameSources.length > 0) {
          await requeueMissingLayerFrameGeneration(
            videoSessionId,
            missingLayerFrameSources,
            branchRenderContext,
            Number(videoSession?.renderPlanVersion) || null,
          );
          const missingSummary = missingLayerFrameSources
            .map((layer) => `${layer.layerIndex + 1}:${layer.layerId}:${layer.reason}`)
            .join(', ');
          throw new Error(`Missing renderable frame folders for session ${videoSessionId}; requeued frame generation for layers ${missingSummary}.`);
        }

        // Now we know how many frames we have in the output folder
        let numFilesInOutputPath = fs.readdirSync(frameOutputPath).length;
        // If we have no frames but an outro image, seed with outro frames so we can still render
        if (numFilesInOutputPath === 0 && outroImagePath) {
          try {
            const { width: baseFrameWidth = 1280, height: baseFrameHeight = 720 } = await getImageSize(outroImagePath);
            const resizedOutroBuffer = await sharp(outroImagePath)
              .resize({ width: baseFrameWidth, height: baseFrameHeight, fit: 'cover' })
              .png()
              .toBuffer();
            await fs.promises.writeFile(path.join(frameOutputPath, `0.png`), resizedOutroBuffer);
            numFilesInOutputPath = 1;
          } catch (err) {
            console.error(`Failed to seed frames with outro for session ${videoSessionId}:`, err);
          }
        }

        if (numFilesInOutputPath === 0) {
          throw new Error(`No renderable frames found for session ${videoSessionId}.`);
        }

        const frameRate = framesPerSecond;
        const renderTimelineAudioLayers = [
          ...(Array.isArray(sessionAudioLayers) ? sessionAudioLayers : []),
          ...(Array.isArray(videoSession.global_audio_layers) ? videoSession.global_audio_layers : []),
        ];
        const resolvedTimelineDuration = resolveRenderTimelineDuration(
          sessionLayers,
          renderTimelineAudioLayers,
        );
        const totalDuration = branchRenderContext?.duration > 0
          ? branchRenderContext.duration
          : resolvedTimelineDuration;

        const totalDurationInFrames = Math.floor(totalDuration * frameRate);

        if (numFilesInOutputPath > totalDurationInFrames) {
          for (let i = totalDurationInFrames; i < numFilesInOutputPath; i++) {
            fs.unlinkSync(path.join(frameOutputPath, `${i}.png`));
          }
        }

        const finalFrameCount = fs.readdirSync(frameOutputPath).length;
        const finalFrameDuration = finalFrameCount / frameRate;

        for (let rangeIndex = 1; rangeIndex < copiedLayerFrameRanges.length; rangeIndex += 1) {
          const previousRange = copiedLayerFrameRanges[rangeIndex - 1];
          const nextRange = copiedLayerFrameRanges[rangeIndex];

          if (!shouldApplyVideoBoundaryDissolve(previousRange?.layer, nextRange?.layer)) {
            continue;
          }

          const effectivePreviousRange = {
            ...previousRange,
            endIndex: Math.min(previousRange.endIndex, finalFrameCount - 1),
          };
          const effectiveNextRange = {
            ...nextRange,
            endIndex: Math.min(nextRange.endIndex, finalFrameCount - 1),
          };

          if (
            effectivePreviousRange.endIndex < effectivePreviousRange.startIndex ||
            effectiveNextRange.endIndex < effectiveNextRange.startIndex
          ) {
            continue;
          }

          await applySceneBoundaryDissolveFrames({
            frameOutputPath,
            previousRange: effectivePreviousRange,
            nextRange: effectiveNextRange,
            framesPerSecond: frameRate,
          });
        }

        if (branchRenderContext) {
          branchThumbnailArtifact = ensureBranchThumbnailArtifact({
            branchRenderContext,
            copiedLayerFrameRanges,
            pwd,
            sessionId: videoSessionId,
          });
        }

        // Prepare audio
        const audioLayers = [
          ...(Array.isArray(sessionAudioLayers) ? sessionAudioLayers : []),
          ...(Array.isArray(videoSession.global_audio_layers) ? videoSession.global_audio_layers : []),
        ];
        const sessionLayerMap = new Map(
          (sessionLayers || []).map((layer) => [
            layer?._id?.toString?.() ?? layer?._id,
            layer,
          ])
        );

        const selectedAudioPayload = audioLayers
          .filter((layer) => (
            (layer.isEnabled || layer.defaultSelected) &&
            layer.generationStatus !== 'PENDING'
          ))
          .map((layer) => {
            const audioPath = resolveRenderableAudioPath(layer, pwd);
            if (!audioPath) {
              return null;
            }

            const connectedLayerId = layer?.connectedLayerId?.toString?.() ?? layer?.connectedLayerId ?? null;
            const connectedLayer = connectedLayerId
              ? sessionLayerMap.get(connectedLayerId)
              : null;
            const normalizedAudioType = resolveRenderableAudioLayerType(layer, connectedLayer);
            const layerVolume = resolveRenderableLayerBaseVolume(layer.volume, normalizedAudioType);
            const {
              startTime: resolvedStartTime,
              endTime: resolvedEndTime,
              duration: resolvedDuration,
            } = resolveAudioLayerTiming(layer, connectedLayer);
            let resolvedSourceTrimStartTime = Number.isFinite(Number(layer.sourceTrimStartTime))
              ? Math.max(0, Number(layer.sourceTrimStartTime))
              : 0;

            if (
              connectedLayer &&
              layer.generationType === 'user_video' &&
              Number.isFinite(Number(connectedLayer.clipStartFrames))
            ) {
              const connectedLayerStartTime = Math.max(0, Number(connectedLayer.durationOffset) || 0);
              const connectedLayerDuration = Math.max(0, Number(connectedLayer.duration) || 0);
              const spansConnectedLayerWindow = (
                Math.abs(resolvedStartTime - connectedLayerStartTime) < 0.001
                && Math.abs(resolvedDuration - connectedLayerDuration) < 0.001
              );

              if (spansConnectedLayerWindow) {
                const leadingTrimSeconds = Number(layer?.generationMeta?.userVideoLeadingSilenceTrimSeconds);
                const fallbackLeadingTrimSeconds = Number.isFinite(leadingTrimSeconds) && leadingTrimSeconds > 0
                  ? leadingTrimSeconds
                  : 0;
                resolvedSourceTrimStartTime = Math.max(
                  resolvedSourceTrimStartTime,
                  fallbackLeadingTrimSeconds + (Math.max(0, Number(connectedLayer.clipStartFrames)) / frameRate),
                );
              }
            }

            const manualVolumeAdjustmentEnabled = hasManualAudioVolumeAutomation(layer, resolvedDuration);
            const manualVolumeAutomationPoints = manualVolumeAdjustmentEnabled
              ? buildResolvedAudioVolumeAutomationPoints(layer, {
                duration: resolvedDuration,
                mapVolume: (volumeValue) => resolveRenderableLayerBaseVolume(volumeValue, normalizedAudioType),
              })
              : [];

            return {
              audioLayerId: layer?._id?.toString?.() ?? null,
              path: audioPath,
              startTime: resolvedStartTime,
              endTime: resolvedEndTime,
              duration: resolvedDuration,
              sourceTrimStartTime: resolvedSourceTrimStartTime,
              volume: layerVolume,
              type: normalizedAudioType,
              generationType: layer?.generationType ?? null,
              libraryType: layer?.libraryType ?? null,
              fadeOnEdges: layer.fadeOnEdges ?? false,
              manualVolumeAdjustmentEnabled,
              manualVolumeAutomationPoints,
              connectedLayerId,
              connectedLayerType: connectedLayer?.layerAiVideoType ?? null,
              speaker: layer?.speaker ?? null,
              provider: layer?.provider ?? null,
              speakerCharacterName: layer?.speakerCharacterName ?? null,
              addSubtitles: Boolean(layer?.addSubtitles),
              isHumanoid: Boolean(layer?.isHumanoid),
            };
          })
          .filter(Boolean);

        // Output path
        const randomString = Math.random().toString(36).substring(2, 6);
        const videoFileName = branchRenderContext
          ? `video-${videoSessionId}-${branchRenderContext.safeRenderPathId}_${randomString}.mp4`
          : `video-${videoSessionId}_${randomString}.mp4`;
        const branchOutputPathSegments = branchRenderContext
          ? ['paths', branchRenderContext.safeRenderPathId]
          : [];
        const outputBase = path.join(
          'assets_v2',
          'video',
          'output',
          videoSessionId,
          ...branchOutputPathSegments,
          videoFileName,
        );
        const outputPath = resolveProcessorAssetWritePath(
          pwd,
          'video',
          'output',
          videoSessionId,
          ...branchOutputPathSegments,
          videoFileName
        );

        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const payload = {
          duration: totalDuration,
          framePath: frameOutputPath,
          audioList: selectedAudioPayload,
          outputPath,
          isPremium,
          isExpressGeneration: videoSession.isExpressGeneration,
          applyAudioDucking: videoSession.applyAudioDucking !== false,
          framesPerSecond,
          outroImagePath: null, // outro already applied via frames
        };


        await renderAndSaveVideo(payload);

        // Upload to CDN
        const vidRemoteLink = await uploadVideoToCDN(outputPath, outputBase);
        let branchThumbnailUrl = null;
        let branchThumbnailUploadError = null;
        if (branchRenderContext) {
          const existingThumbnailUrl = typeof branchRenderContext.renderPath?.thumbnailUrl === 'string'
            ? branchRenderContext.renderPath.thumbnailUrl.trim()
            : '';
          const thumbnailUpload = await uploadBranchThumbnailBestEffort({
            artifact: branchThumbnailArtifact,
            existingThumbnailUrl,
            sessionId: videoSessionId,
            renderPathId: branchRenderContext.renderPathId,
            uploadThumbnail: uploadBranchPublicationThumbnailToCDN,
          });
          branchThumbnailUrl = thumbnailUpload.thumbnailUrl;
          branchThumbnailUploadError = thumbnailUpload.error;
          if (branchThumbnailUploadError) {
            console.error(
              `Branch video completed but its render-time thumbnail upload failed for ` +
              `${branchRenderContext.renderPathId}: ${branchThumbnailUploadError}`,
            );
          }
        }
        let aggregateVideoLink = outputBase;
        let aggregateRemoteURL = vidRemoteLink;
        let aggregateSession = videoSession;
        let aggregateUpdateFilter = { _id: videoSessionId };

        if (branchRenderContext) {
          const branchPathPrefix = `branchRenderPaths.${branchRenderContext.pathIndex}`;
          const branchCompletionResult = await VideoSession.updateOne(
            {
              _id: videoSessionId,
              [`${branchPathPrefix}.pathId`]: branchRenderContext.renderPathId,
            },
            {
              $set: {
                [`${branchPathPrefix}.videoGenerationPending`]: false,
                [`${branchPathPrefix}.videoGenerationStatus`]: 'COMPLETED',
                [`${branchPathPrefix}.videoGenerationError`]: null,
                [`${branchPathPrefix}.videoGenerationCompletedAt`]: new Date(),
                [`${branchPathPrefix}.videoLink`]: outputBase,
                [`${branchPathPrefix}.remoteURL`]: vidRemoteLink,
                ...(branchThumbnailArtifact?.thumbnailPath
                  ? { [`${branchPathPrefix}.thumbnailPath`]: branchThumbnailArtifact.thumbnailPath }
                  : {}),
                ...(branchThumbnailArtifact?.thumbnailSource
                  ? { [`${branchPathPrefix}.thumbnailSource`]: branchThumbnailArtifact.thumbnailSource }
                  : {}),
                ...(branchThumbnailUrl
                  ? { [`${branchPathPrefix}.thumbnailUrl`]: branchThumbnailUrl }
                  : {}),
                [`${branchPathPrefix}.thumbnailUploadError`]: branchThumbnailUploadError,
              },
            },
          );
          if (branchCompletionResult.matchedCount !== 1) {
            throw new Error(
              `Branch render path ${branchRenderContext.renderPathId} stopped accepting its video and thumbnail result.`,
            );
          }
          await VideoGeneration.deleteOne({ _id: videoRequest._id });

          aggregateSession = await VideoSession.findById(videoSessionId).lean();
          if (!aggregateSession || !areAllBranchPathVideosComplete(aggregateSession)) {
            continue;
          }

          const defaultRenderPath = getDefaultBranchRenderPath(aggregateSession);
          aggregateVideoLink = defaultRenderPath?.videoLink || outputBase;
          aggregateRemoteURL = defaultRenderPath?.remoteURL || vidRemoteLink;
          aggregateUpdateFilter = {
            _id: videoSessionId,
            branchRenderCompletionFinalized: { $ne: true },
            branchRenderPaths: {
              $not: {
                $elemMatch: {
                  videoGenerationStatus: { $ne: 'COMPLETED' },
                },
              },
            },
          };
        }

        let publicThumbnailUrl = null;
        const splashImagePath = resolveProcessorAssetWritePath(
          pwd,
          'video',
          'splash',
          videoSessionId,
          'splash.png',
        );
        try {
          if (fs.existsSync(splashImagePath)) {
            publicThumbnailUrl = await uploadPublicationThumbnailToCDN(
              splashImagePath,
              videoSessionId,
            );
          } else {
            console.warn(`Rendered splash image not found for session ${videoSessionId}: ${splashImagePath}`);
          }
        } catch (thumbnailError) {
          console.error(`Failed to publish rendered thumbnail for session ${videoSessionId}:`, thumbnailError);
        }

        // Update session
        const sessionUpdate = {
          videoLink: aggregateVideoLink,
          remoteURL: aggregateRemoteURL,
          videoGenerationPending: false,
          generationError: null,
          expressGenerationFailed: false,
          expressGenerationCancelled: false,
          expressGenerationError: null,
          'expressGenerationStatus.frame_generation': 'COMPLETED',
          'expressGenerationStatus.video_generation': 'COMPLETED',
          'expressGenerationStatus.status': 'COMPLETED',
        };
        if (branchRenderContext) {
          sessionUpdate.branchRenderCompletionFinalized = true;
          sessionUpdate.branchRenderCompletedAt = new Date();
        }
        if (publicThumbnailUrl) {
          sessionUpdate.splashImage = publicThumbnailUrl;
          if (aggregateSession.ispublishedVideo) {
            sessionUpdate.publishedSplashImage = publicThumbnailUrl;
          }
        }
        const aggregateUpdateResult = await VideoSession.updateOne(
          aggregateUpdateFilter,
          { $set: sessionUpdate },
        );
        const aggregateCompletionTransitioned = !branchRenderContext
          || aggregateUpdateResult.modifiedCount > 0;
        if (!aggregateCompletionTransitioned) {
          continue;
        }
        if (publicThumbnailUrl && aggregateSession.ispublishedVideo) {
          try {
            const database = await getDatabase();
            await database.collection('publications').updateOne(
              { sessionId: videoSessionId },
              { $set: { splashImage: publicThumbnailUrl } },
            );
          } catch (publicationThumbnailError) {
            console.error(`Failed to refresh published thumbnail reference for session ${videoSessionId}:`, publicationThumbnailError);
          }
        }
        // Branched requests are deleted when their path result is saved so sibling
        // jobs remain independent. Singular requests retain the original lifecycle.
        if (!branchRenderContext) {
          await VideoGeneration.deleteOne({ _id: videoRequest._id });
        }

        // Notify user
        if (aggregateSession.notifyOnCompletion && !aggregateSession.notificationSent) {
          const userId = aggregateSession.userId;
          const userRecord = userData ?? await User.findById(userId).lean();
          const userName = userRecord?.displayName || userRecord?.username || userRecord?.email;
          const userEmail = aggregateSession.notificationEmail || userRecord?.email;
          const notificationPayload = {
            sessionId: videoSessionId,
            recipientEmail: userEmail,
            downloadLink: aggregateVideoLink,
            userName,
          };
          try {
            await updateSendCompletionNotificationToUser(notificationPayload);
            await VideoSession.updateOne({ _id: videoSessionId }, {
              notificationSent: true,
            });
          } catch (notificationError) {
            console.error(`Failed to send completion notification for session ${videoSessionId}:`, notificationError);
          }
        }

        // Cleanup frames if express
        if (aggregateSession.isExpressGeneration) {
          await deleteFramesForGeneration(videoSessionId);
        }

      } catch (error) {
        console.error('Error during video frame processing:', error);
        numRetries++;
        const errorMessage = error?.message || 'Video render failed.';
        if (numRetries > 1) {
          console.error(`Exceeded maximum retries for video request ${videoRequest._id}. Deleting generation request. Error: ${errorMessage}`);
          await VideoGeneration.deleteOne({ _id: videoRequest._id });
          const failureUpdate = {
            videoGenerationPending: false,
            generationError: errorMessage,
            expressGenerationFailed: true,
            expressGenerationError: errorMessage,
            'expressGenerationStatus.video_generation': 'FAILED',
            'expressGenerationStatus.status': 'FAILED',
          };
          if (branchedSession) {
            const branchPathMatch = findBranchRenderPath(videoSession, requestedRenderPathId);
            if (branchPathMatch) {
              const branchPathPrefix = `branchRenderPaths.${branchPathMatch.pathIndex}`;
              failureUpdate[`${branchPathPrefix}.videoGenerationPending`] = false;
              failureUpdate[`${branchPathPrefix}.videoGenerationStatus`] = 'FAILED';
              failureUpdate[`${branchPathPrefix}.videoGenerationError`] = errorMessage;
              failureUpdate[`${branchPathPrefix}.videoGenerationCompletedAt`] = null;
            }
          }
          await VideoSession.updateOne(
            { _id: videoSessionId },
            { $set: failureUpdate },
          );
        } else {
          await VideoGeneration.findByIdAndUpdate(videoRequest._id, { numRetries, rowLocked: false });
        }
      }
    }

  } catch (err) {
    console.error('An error occurred in generatePendingVideoRequests:', err);
  }
}

/**
 * Attach ffmpeg process to local set for graceful shutdown.
 */
function attachFFmpegProcess(command) {
  const proc = command.ffmpegProc;
  if (proc) {
    ffmpegProcesses.add(command);
    proc.on('close', () => {
      ffmpegProcesses.delete(command);
    });
  }
}

/**
 * Renders frames & audio into a single video
 * and ensures final output is clipped to payload.duration.
 */
function resolveLocalOutroImagePath(outroImagePath) {
  if (!outroImagePath || typeof outroImagePath !== 'string') {
    return null;
  }
  try {
    return fs.existsSync(outroImagePath) ? outroImagePath : null;
  } catch {
    return null;
  }
}

function renderAndSaveVideoOnce(payload) {
  const {
    duration,
    framePath,
    audioList,
    outputPath,
    isPremium,
    isExpressGeneration,
    applyAudioDucking,
    analyzedStudioDuckingPlan = null,
    outroImagePath,
    framesPerSecond,
  } = payload;
  const shouldApplyAudioDucking = Boolean(applyAudioDucking) || isExpressGeneration;
  const shouldUseSidechainMusicDucking = shouldUseStudioPeakSidechainDucking({
    applyAudioDucking,
    isExpressGeneration,
    audioList,
  });

  const frameRate = normalizeFramesPerSecond(framesPerSecond) ?? DEFAULT_FRAMES_PER_SECOND;
  const framePattern = `${framePath}/%d.png`;
  const analyzedStudioDuckingWindows = Array.isArray(analyzedStudioDuckingPlan?.windows)
    ? analyzedStudioDuckingPlan.windows
    : [];
  const expressSpeechAwareDuckingWindows = Boolean(isExpressGeneration) && analyzedStudioDuckingWindows.length > 0
    ? buildSpeechAwareDuckingEnvelopeWindows(
      analyzedStudioDuckingWindows,
      {
        attackDurationSeconds: EXPRESS_SPEECH_AWARE_DUCK_ATTACK_DURATION_SECONDS,
        releaseDurationSeconds: EXPRESS_SPEECH_AWARE_DUCK_RELEASE_DURATION_SECONDS,
      },
    )
    : [];

  return new Promise((resolve, reject) => {
    const command = ffmpeg()
      .input(framePattern)
      .inputFPS(frameRate);

    if (outroImagePath) {
      command.input(outroImagePath);
    }

    attachFFmpegProcess(command);

    const filterParts = [];
    const outputStreams = [];

    // Audio
    let hasAudioOutput = false;
    if (audioList && audioList.length > 0) {
      const audioInputs = [];
      const audioFilters = [];
      const musicAudioInputs = [];
      const foregroundAudioInputs = [];
      const foregroundDuckKeyInputs = [];
      const passthroughAudioInputs = [];
      const audioInputStartIndex = outroImagePath ? 2 : 1;
      if (shouldApplyAudioDucking) {
        const renderTrackSummary = audioList.map((audio) => ({
          audioLayerId: audio.audioLayerId ?? null,
          resolvedDuckingType: resolveDuckingTrackType(audio),
          type: audio.type || null,
          generationType: audio.generationType ?? null,
          libraryType: audio.libraryType ?? null,
          provider: audio.provider ?? null,
          speaker: audio.speaker ?? null,
          speakerCharacterName: audio.speakerCharacterName ?? null,
          connectedLayerId: audio.connectedLayerId ?? null,
          connectedLayerType: audio.connectedLayerType ?? null,
          startTime: audio.startTime,
          endTime: audio.endTime,
          baseVolume: audio.volume,
          isMusicDuckingTarget: isMusicDuckingTargetTrack(audio),
          isFreeStandingMusicTrack: isFreeStandingMusicTrack(audio),
          isForegroundDuckingTrack: isForegroundDuckingTrack(audio),
          isConnectedForegroundTrack: isConnectedForegroundTrack(audio),
          duckKeyGain: audio.duckKeyGain ?? 1,
          duckKeyPointCount: Array.isArray(audio.duckKeyAutomationPoints) ? audio.duckKeyAutomationPoints.length : 0,
          manualVolumeAdjustmentEnabled: Boolean(audio.manualVolumeAdjustmentEnabled),
        }));
        const musicTrackCount = renderTrackSummary.filter((audio) => audio.isMusicDuckingTarget).length;
        const foregroundTrackCount = renderTrackSummary.filter((audio) => audio.isForegroundDuckingTrack).length;


        if (musicTrackCount === 0) {
        }
        if (foregroundTrackCount === 0) {
        }
        if (analyzedStudioDuckingWindows.length > 0) {
        }
      }
      const foregroundDuckingLayers = shouldApplyAudioDucking
        ? audioList.filter((audio) => isForegroundDuckingTrack(audio))
        : [];


      audioList.forEach((audio, index) => {
        const audioStartTime = Number.isFinite(Number(audio.startTime))
          ? Math.max(0, Number(audio.startTime))
          : 0;
        const audioEndTime = Number.isFinite(Number(audio.endTime))
          ? Math.max(audioStartTime, Number(audio.endTime))
          : duration;
        const timelineWindowDuration = Math.max(0, audioEndTime - audioStartTime);
        const fallbackAudioDuration = Number.isFinite(Number(audio.duration))
          ? Math.max(0, Number(audio.duration))
          : 0;
        // Match studio preview timing: the layer window is authoritative when it exists.
        const audioDuration = timelineWindowDuration > 0
          ? timelineWindowDuration
          : fallbackAudioDuration;
        const audioSourceTrimStart = Number.isFinite(audio.sourceTrimStartTime)
          ? Math.max(audio.sourceTrimStartTime, 0)
          : 0;
        const audioSourceTrimEnd = audioSourceTrimStart + audioDuration;
        if (audioDuration <= 0) return;

        command.input(audio.path);
        audioInputs.push(`[a${index}]`);
        if (isMusicDuckingTargetTrack(audio)) {
          musicAudioInputs.push(`[a${index}]`);
        } else if (shouldUseSidechainMusicDucking ? isForegroundDuckingTrack(audio) : isConnectedForegroundTrack(audio)) {
          foregroundAudioInputs.push(`[a${index}]`);
          foregroundDuckKeyInputs.push(shouldUseSidechainMusicDucking ? `[duckkey${index}]` : `[a${index}]`);
        } else {
          passthroughAudioInputs.push(`[a${index}]`);
        }

        const audioInputIndex = audioInputStartIndex + index;
        let audioFilter = `[${audioInputIndex}:a]`; // index 0 is frames, maybe outro; adjust offset for audio inputs
        audioFilter += `atrim=start=${audioSourceTrimStart}:end=${audioSourceTrimEnd},asetpts=PTS-STARTPTS,`;
        if (
          audio.manualVolumeAdjustmentEnabled
          && Array.isArray(audio.manualVolumeAutomationPoints)
          && audio.manualVolumeAutomationPoints.length > 1
        ) {
          audioFilter += buildSafeFrameEvaluatedVolumeFilter({
            points: audio.manualVolumeAutomationPoints,
            fallbackGain: audio.volume,
            context: {
              outputPath,
              audioLayerId: audio.audioLayerId ?? null,
              automationType: 'manual_volume',
            },
          });
        } else {
          audioFilter += `volume=${formatFFmpegNumber(audio.volume)}`;
        }

        if (
          shouldApplyAudioDucking
          && isMusicDuckingTargetTrack(audio)
        ) {
          const audioLayerId = audio.audioLayerId?.toString?.() ?? audio.audioLayerId ?? null;
          const hasExpressSpeechAwareDuckingWindows = Boolean(isExpressGeneration)
            && expressSpeechAwareDuckingWindows.length > 0;
          const timelineDuckingWindows = hasExpressSpeechAwareDuckingWindows
            ? expressSpeechAwareDuckingWindows
            : buildMusicDuckingWindows({
              musicStartTime: audioStartTime,
              musicEndTime: audioEndTime,
              duckingLayers: foregroundDuckingLayers,
            });
          const localDuckingWindows = buildAudioLocalDuckingWindows({
            duckingWindows: timelineDuckingWindows,
            audioStartTime,
            audioDuration,
          });
          if (localDuckingWindows.length > 0) {
            const duckedVolumeRatio = hasExpressSpeechAwareDuckingWindows
              ? EXPRESS_SPEECH_AWARE_MUSIC_DUCKED_VOLUME_RATIO
              : isExpressGeneration
                ? EXPRESS_SPEECH_AWARE_MUSIC_DUCKED_VOLUME_RATIO
                : applyAudioDucking
                  ? STUDIO_TIMELINE_MUSIC_DUCKED_VOLUME_RATIO
                  : MUSIC_DUCKED_VOLUME_RATIO;
            const duckingWindowSource = hasExpressSpeechAwareDuckingWindows
              ? 'speech_activity_analysis'
              : 'speech_track_timeline';
            const duckingVolumeExpression = hasExpressSpeechAwareDuckingWindows
              ? buildMusicDuckingSmoothEnvelopeExpression({
                duckingWindows: localDuckingWindows,
                duckedVolumeRatio,
              })
              : null;
            const duckingVolumePoints = hasExpressSpeechAwareDuckingWindows
              ? []
              : buildMusicDuckingVolumePoints({
                duckingWindows: localDuckingWindows,
                duckedVolumeRatio,
              });
            audioFilter += hasExpressSpeechAwareDuckingWindows
              ? `,${buildSafeFrameEvaluatedVolumeExpressionFilter({
                volumeExpression: duckingVolumeExpression,
                fallbackGain: 1,
                context: {
                  outputPath,
                  audioLayerId,
                  automationType: 'express_speech_aware_music_ducking',
                  duckingWindowCount: localDuckingWindows.length,
                  duckingWindowSource,
                },
              })}`
              : `,${buildSafeFrameEvaluatedVolumeFilter({
                points: duckingVolumePoints,
                fallbackGain: 1,
                maxPoints: MAX_MUSIC_DUCKING_VOLUME_POINTS,
                context: {
                  outputPath,
                  audioLayerId,
                  automationType: 'music_ducking',
                  duckingWindowCount: localDuckingWindows.length,
                  duckingWindowSource,
                },
              })}`;
          } else {
          }
        }

        const shouldApplyExpressSoundEffectEdgeDucking = Boolean(isExpressGeneration)
          && isSoundEffectAudioType(resolveDuckingTrackType(audio));
        if (shouldApplyExpressSoundEffectEdgeDucking) {
          const audioLayerId = audio.audioLayerId?.toString?.() ?? audio.audioLayerId ?? null;
          const edgeDuckingPoints = buildLayerEdgeDuckingAutomationPoints({
            duration: audioDuration,
            fadeRatio: EXPRESS_AUDIO_EDGE_FADE_DURATION_RATIO,
          });

          if (edgeDuckingPoints.length > 1) {
            audioFilter += `,${buildSafeFrameEvaluatedVolumeFilter({
              points: edgeDuckingPoints,
              fallbackGain: 1,
              context: {
                outputPath,
                audioLayerId,
                automationType: 'express_sound_effect_edge_ducking',
              },
            })}`;
          }
        }

        audioFilter += `,adelay=${audioStartTime * 1000}|${audioStartTime * 1000}`;

        const shouldFadeAudioEdges = Boolean(audio.fadeOnEdges)
          && !isSpeechLikeAudioType(audio.type)
          && !shouldApplyExpressSoundEffectEdgeDucking;
        if ((isExpressGeneration && isMusicLikeAudioType(audio.type)) || shouldFadeAudioEdges) {
          const fadeInDuration = Math.floor(duration * 0.05);
          const fadeOutStart = Math.max(duration - fadeInDuration, 0);
          audioFilter += `,afade=t=in:st=0:d=${fadeInDuration},afade=t=out:st=${fadeOutStart}:d=${fadeInDuration}`;
        }

        if (shouldUseSidechainMusicDucking && isForegroundDuckingTrack(audio)) {
          const duckKeyGain = Number.isFinite(Number(audio.duckKeyGain))
            ? Math.max(1, Number(audio.duckKeyGain))
            : 1;
          const hasDuckKeyAutomation = Array.isArray(audio.duckKeyAutomationPoints)
            && audio.duckKeyAutomationPoints.length > 1;
          audioFilter += `[a${index}base]`;
          audioFilter += `; [a${index}base]asplit=2[a${index}][duckkeyraw${index}]`;
          if (hasDuckKeyAutomation) {
            audioFilter += `; [duckkeyraw${index}]${buildSafeFrameEvaluatedVolumeFilter({
              points: audio.duckKeyAutomationPoints,
              fallbackGain: duckKeyGain,
              context: {
                outputPath,
                audioLayerId: audio.audioLayerId ?? null,
                automationType: 'duck_key',
              },
            })}[duckkey${index}]`;
          } else if (duckKeyGain > 1.0001) {
            audioFilter += `; [duckkeyraw${index}]volume=${formatFFmpegNumber(duckKeyGain)}[duckkey${index}]`;
          } else {
            audioFilter += `; [duckkeyraw${index}]anull[duckkey${index}]`;
          }
        } else {
          audioFilter += `[a${index}]`;
        }
        audioFilters.push(audioFilter);
      });

      if (audioFilters.length > 0) {
        hasAudioOutput = true;
        filterParts.push(audioFilters.join('; '));
        const finalAudioInputs = [];

        if (
          shouldUseSidechainMusicDucking
          && musicAudioInputs.length > 0
          && foregroundAudioInputs.length > 0
          && foregroundDuckKeyInputs.length > 0
        ) {
          if (musicAudioInputs.length === 1) {
            filterParts.push(`${musicAudioInputs[0]}anull[musicmix]`);
          } else {
            filterParts.push(`${musicAudioInputs.join('')}amix=inputs=${musicAudioInputs.length}:duration=longest:normalize=0[musicmix]`);
          }

          if (foregroundDuckKeyInputs.length === 1) {
            filterParts.push(`${foregroundDuckKeyInputs[0]}anull[foregroundducksrc]`);
          } else {
            filterParts.push(`${foregroundDuckKeyInputs.join('')}amix=inputs=${foregroundDuckKeyInputs.length}:duration=longest:normalize=0[foregroundducksrc]`);
          }
          filterParts.push(
            `[foregroundducksrc]highpass=f=120,lowpass=f=6000,volume=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_GAIN)},` +
            `acompressor=threshold=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_COMPRESS_THRESHOLD)}:` +
            `ratio=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_COMPRESS_RATIO)}:` +
            `attack=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_COMPRESS_ATTACK_MS)}:` +
            `release=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_COMPRESS_RELEASE_MS)}:` +
            `makeup=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_COMPRESS_MAKEUP)}:` +
            `detection=${FOREGROUND_DUCK_BUS_COMPRESS_DETECTION}:link=maximum,` +
            `alimiter=limit=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_LIMIT)}:` +
            `attack=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_LIMIT_ATTACK_MS)}:` +
            `release=${formatFFmpegNumber(FOREGROUND_DUCK_BUS_LIMIT_RELEASE_MS)},` +
            // Keep the sidechain key alive as silence for the full render. Without this,
            // sidechaincompress can stop the music output when the last speech key ends.
            `apad,atrim=duration=${formatFFmpegNumber(duration)},asetpts=N/SR/TB[foregroundduck]`
          );
          filterParts.push(
            `[musicmix][foregroundduck]sidechaincompress=` +
            `threshold=${formatFFmpegNumber(MUSIC_SIDECHAIN_THRESHOLD)}:` +
            `ratio=${formatFFmpegNumber(MUSIC_SIDECHAIN_RATIO)}:` +
            `attack=${formatFFmpegNumber(MUSIC_SIDECHAIN_ATTACK_MS)}:` +
            `release=${formatFFmpegNumber(MUSIC_SIDECHAIN_RELEASE_MS)}:` +
            `knee=${formatFFmpegNumber(MUSIC_SIDECHAIN_KNEE)}:` +
            `link=${MUSIC_SIDECHAIN_LINK}:level_sc=${formatFFmpegNumber(MUSIC_SIDECHAIN_LEVEL_SC)}:` +
            `detection=${MUSIC_SIDECHAIN_DETECTION}:mix=${formatFFmpegNumber(MUSIC_SIDECHAIN_MIX)}:` +
            `makeup=1[duckedmusic]`
          );


          finalAudioInputs.push('[duckedmusic]');
          finalAudioInputs.push(...foregroundAudioInputs);
          finalAudioInputs.push(...passthroughAudioInputs);
        } else {
          finalAudioInputs.push(...audioInputs);
        }

        filterParts.push(buildFinalAudioMixFilter({
          inputLabels: finalAudioInputs,
          duration,
          outputLabel: 'aout',
          formatNumber: formatFFmpegNumber,
        }));
        outputStreams.push('aout');
      }
    }

    const videoStreamLabel = 'vout';
    if (outroImagePath) {
      const outroFadeDuration = 1;
      const outroDuration = 2;
      const baseDuration = duration;
      const xfadeOffset = Math.max(baseDuration - outroFadeDuration, 0);
      filterParts.push(
        `[0:v]format=yuv420p,tpad=stop_mode=clone:stop_duration=${formatFFmpegNumber(baseDuration)},` +
        `trim=duration=${formatFFmpegNumber(baseDuration)},setpts=PTS-STARTPTS[basev]`
      );
      filterParts.push(`[1:v]loop=loop=-1:size=1:start=0,format=rgba,trim=duration=${outroDuration},setpts=PTS-STARTPTS[outroloop]`);
      filterParts.push(`[outroloop][basev]scale2ref=w=main_w:h=main_h[outroscaled][basevscaled]`);
      filterParts.push(`[basevscaled][outroscaled]xfade=transition=fade:duration=${outroFadeDuration}:offset=${xfadeOffset}[${videoStreamLabel}]`);
    } else {
      filterParts.push(
        `[0:v]tpad=stop_mode=clone:stop_duration=${formatFFmpegNumber(duration)},` +
        `trim=duration=${formatFFmpegNumber(duration)},setpts=PTS-STARTPTS[${videoStreamLabel}]`
      );
    }

    const filterComplex = filterParts.filter(Boolean).join('; ');
    outputStreams.unshift(videoStreamLabel);

    if (shouldApplyAudioDucking) {
    }

    command
      .complexFilter(filterComplex, outputStreams)
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-threads 8',
        `-t ${duration}`
      ]);

    if (hasAudioOutput) {
      command.outputOptions([
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
      ]);
    } else {
      command.noAudio();
    }

    command
      .on('error', (err) => {
        console.error('FFmpeg processing error:', err);
        reject(err);
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

export async function renderAndSaveVideo(payload) {
  const safeOutroImagePath = resolveLocalOutroImagePath(payload.outroImagePath);
  if (payload.outroImagePath && !safeOutroImagePath) {
  }

  let analyzedStudioDuckingPlan = null;
  let audioList = Array.isArray(payload.audioList) ? payload.audioList : [];
  if (shouldAnalyzeExpressSpeechAwareDucking(payload)) {

    try {
      const expressForegroundProfile = await buildStudioForegroundDuckKeyProfiles(audioList);
      const expressForegroundWindows = buildSpeechAwareDuckingEnvelopeWindows(
        expressForegroundProfile?.windows || [],
        {
          attackDurationSeconds: EXPRESS_SPEECH_AWARE_DUCK_ATTACK_DURATION_SECONDS,
          releaseDurationSeconds: EXPRESS_SPEECH_AWARE_DUCK_RELEASE_DURATION_SECONDS,
        },
      );

      if (expressForegroundWindows.length > 0) {
        const duckTargetTrackIds = audioList
          .filter((audioTrack) => isMusicDuckingTargetTrack(audioTrack))
          .map((audioTrack) => audioTrack?.audioLayerId?.toString?.() ?? audioTrack?.audioLayerId ?? null)
          .filter(Boolean);

        analyzedStudioDuckingPlan = {
          analysisMode: 'express_speech_aware_envelope',
          windows: expressForegroundWindows,
          duckTargetTrackIds,
          duckedVolumeRatio: EXPRESS_SPEECH_AWARE_MUSIC_DUCKED_VOLUME_RATIO,
        };
      }

    } catch (error) {
      console.error('Express speech-aware ducking analysis failed; falling back to duration-based ducking windows', {
        outputPath: payload.outputPath,
        error: error?.message || error,
      });
      analyzedStudioDuckingPlan = null;
    }
  } else if (shouldUseStudioPeakSidechainDucking(payload)) {

    try {
      const studioForegroundDuckKeyProfile = await buildStudioForegroundDuckKeyProfiles(audioList);
      const studioForegroundWindows = Array.isArray(studioForegroundDuckKeyProfile?.windows)
        ? studioForegroundDuckKeyProfile.windows
        : [];
      const profileTrackMap = new Map(
        (studioForegroundDuckKeyProfile?.tracks || [])
          .filter((track) => track?.audioLayerId)
          .map((track) => [track.audioLayerId, track]),
      );

      if (profileTrackMap.size > 0) {
        audioList = audioList.map((audioTrack) => {
          const profile = profileTrackMap.get(audioTrack?.audioLayerId);
          if (!profile) {
            return audioTrack;
          }

          return {
            ...audioTrack,
            duckKeyGain: profile.duckKeyGain,
            duckKeyAutomationPoints: profile.duckKeyAutomationPoints,
            duckKeyCeilingDb: profile.ceilingDb,
            duckKeyPeakDb: profile.peakDb,
            duckKeyThresholdDb: profile.thresholdDb,
            duckKeyWindowCount: profile.windowCount,
            duckKeyActiveSampleCount: profile.activeSampleCount,
            duckKeyAnalysisMode: profile.analysisMode,
          };
        });
      }

      if (studioForegroundWindows.length > 0) {
        const duckTargetTrackIds = audioList
          .filter((audioTrack) => isMusicDuckingTargetTrack(audioTrack))
          .map((audioTrack) => audioTrack?.audioLayerId?.toString?.() ?? audioTrack?.audioLayerId ?? null)
          .filter(Boolean);

        analyzedStudioDuckingPlan = {
          analysisMode: 'sidechain_speech_window_floor',
          windows: studioForegroundWindows,
          duckTargetTrackIds,
          duckedVolumeRatio: STUDIO_TIMELINE_MUSIC_DUCKED_VOLUME_RATIO,
        };
      }

    } catch (error) {
      console.error('Studio sidechain foreground analysis failed; continuing with default duck key gains', {
        outputPath: payload.outputPath,
        error: error?.message || error,
      });
    }
  } else if (shouldAnalyzeStudioMusicDucking(payload)) {
    try {
      analyzedStudioDuckingPlan = await buildStudioAudioDuckingPlan(
        audioList,
        STUDIO_ANALYZED_MUSIC_DUCKED_VOLUME_RATIO,
      );
      const analyzedStudioDuckingWindows = Array.isArray(analyzedStudioDuckingPlan?.windows)
        ? analyzedStudioDuckingPlan.windows
        : [];
      const duckTargetTrackIds = Array.isArray(analyzedStudioDuckingPlan?.duckTargetTrackIds)
        ? analyzedStudioDuckingPlan.duckTargetTrackIds
        : [];
    } catch (error) {
      console.error('Studio audio ducking analysis failed; falling back to duration-based ducking windows', {
        outputPath: payload.outputPath,
        error: error?.message || error,
      });
      analyzedStudioDuckingPlan = null;
    }
  } else if (payload.applyAudioDucking) {
  }

  try {
    return await renderAndSaveVideoOnce({
      ...payload,
      audioList,
      analyzedStudioDuckingPlan,
      outroImagePath: safeOutroImagePath,
    });
  } catch (err) {
    if (safeOutroImagePath) {
      console.error('FFmpeg failed with outro; retrying without outro', {
        outroImagePath: safeOutroImagePath,
        outputPath: payload.outputPath,
        error: err?.message || err,
      });
      try {
        if (payload.outputPath && fs.existsSync(payload.outputPath)) {
          await fs.promises.unlink(payload.outputPath);
        }
      } catch {
        // best effort cleanup
      }
      return await renderAndSaveVideoOnce({
        ...payload,
        audioList,
        analyzedStudioDuckingPlan,
        outroImagePath: null,
      });
    }
    throw err;
  }
}

/**
 * Create a blank frame using sharp if a frame is missing.
 */
async function createBlankImage(destinationPath, width, height) {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  }).png().toBuffer();
  await fs.promises.writeFile(destinationPath, buffer);
}

async function getImageSize(filePath) {
  const meta = await sharp(filePath).metadata();
  return { width: meta.width || 1280, height: meta.height || 720 };
}

async function getImageSizeWithFallback(folderPath) {
  let frameWidth = 1280;
  let frameHeight = 720;
  try {
    const firstFramePath = path.join(folderPath, `0.png`);
    if (fs.existsSync(firstFramePath)) {
      const meta = await sharp(firstFramePath).metadata();
      frameWidth = meta.width || frameWidth;
      frameHeight = meta.height || frameHeight;
    }
  } catch (e) {
    // keep defaults
  }
  return { frameWidth, frameHeight };
}
