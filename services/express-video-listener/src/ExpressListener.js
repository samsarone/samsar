import {
  getDBConnectionString,
  isMongoConnectivityError,
  resetDbConnection,
} from "./DBString.js";
import VideoSession from "./schema/VideoSession.js";
import FrameGeneration from "./schema/FrameGeneration.js";
import VideoGeneration from "./schema/VideoGeneration.js";
import AIVideoLayerGeneration from "./schema/AIVideoLayerGeneration.js";
import ImageGeneration from "./schema/ImageGeneration.js";
import ImageBatchGeneration from "./schema/ImageBatchGeneration.js";
import AudioGeneration from "./schema/AudioGeneration.js";
import PendingUserMusicGeneration from "./schema/PendingUserMusicGeneration.js";
import { generateTranscriptsForSessionAudioLayers } from './Transcript.js';
import { applyDefaultAnimationPresets } from './AnimationPresets.js';
import { createGenerativeVideoAnimationsForFrames } from './ai_video/AIVideoGenerator.js';
import { generateLipSyncForSession } from './ai_video/LipSyncGenerator.js';
import {
  assessLipSyncStage,
  getLipSyncFailureMessage,
} from './ai_video/LipSyncStage.js';
import {
  assessSoundEffectStage,
  getSoundEffectFailureMessage,
} from './ai_video/SoundEffectStage.js';



import { generateSoundEffectsForSession } from './ai_video/SoundEffects.js';
import { ensureNarratorAvatarVideoForSession } from './ai_video/NarratorAvatar.js';

import { processSessionCompletionFailure, processSessionCompletionSuccess } from "./ExpressSessionStateUpdater.js";
import { ensureGeneratedOutroTilesForSession } from './utils/GeneratedOutroTiles.js';
import {
  EXPRESS_VIDEO_BILLING_STAGES,
  chargeExpressVideoStageCredits,
} from './ExpressVideoStageBilling.js';
import {
  EXPRESS_STEP_VIDEO_STAGES,
  pauseExpressStepAfterCompletedStage,
} from './ExpressVideoStepState.js';

import User from "./schema/User.js";
import { installStructuredLogger } from './utils/StructuredLogger.js';
import {
  allBranchFramesCompleted,
  allBranchVideosCompleted,
  getBranchFrameFailure,
  getBranchRenderFailure,
  getBranchRenderPaths,
  getBranchTimeline,
  isBranchedVideoSession,
} from './utils/BranchRenderPaths.js';
import {
  buildBranchDurationSessionMetadata,
  buildBranchingTimeline,
  normalizeBranchRenderPathTimings,
} from './utils/BranchRenderTiming.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_express_video_listener',
  component: 'express_listener',
});

function normalizeStepStage(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getStepStageForBillingStage(stageKey) {
  const normalizedStage = normalizeStepStage(stageKey);
  if (normalizedStage === EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE) {
    return 'prompt_generation';
  }
  if (normalizedStage === EXPRESS_VIDEO_BILLING_STAGES.PIPELINE) {
    return 'video_generation';
  }
  return normalizedStage;
}

function isStepStageBeforeCurrent(stepStageKey, currentStep) {
  const stepStageIndex = EXPRESS_STEP_VIDEO_STAGES.indexOf(stepStageKey);
  const currentStepIndex = EXPRESS_STEP_VIDEO_STAGES.indexOf(currentStep);
  return stepStageIndex >= 0 && currentStepIndex >= 0 && stepStageIndex < currentStepIndex;
}

async function completeExpressStageForBillingAndStep(
  sessionId,
  stageKey,
  { skipBilling = false } = {},
) {
  const normalizedStageKey = normalizeStepStage(stageKey);
  const stepStageKey = getStepStageForBillingStage(normalizedStageKey);
  const stepSession = await VideoSession.findById(sessionId)
    .select('isStepVideoGeneration expressStepGeneration')
    .lean();
  const isStepSession = Boolean(
    stepSession?.isStepVideoGeneration ||
    stepSession?.expressStepGeneration?.enabled,
  );

  if (isStepSession) {
    const currentStep = normalizeStepStage(
      stepSession?.expressStepGeneration?.currentStep ||
      stepSession?.expressStepGeneration?.current_step,
    );
    const stepStatus = normalizeStepStage(stepSession?.expressStepGeneration?.status).toUpperCase();
    if (stepStatus === 'COMPLETED') {
      const isWaitingForProcessNext = Boolean(
        stepSession?.expressStepGeneration?.waitingForProcessNext ||
        stepSession?.expressStepGeneration?.waiting_for_process_next ||
        stepSession?.expressStepGeneration?.requiresUserAction ||
        stepSession?.expressStepGeneration?.requires_user_action,
      );
      return { ok: true, paused: isWaitingForProcessNext, alreadyPaused: isWaitingForProcessNext };
    }
    if (currentStep && currentStep !== stepStageKey) {
      return {
        ok: true,
        deferred: true,
        paused: !isStepStageBeforeCurrent(stepStageKey, currentStep),
      };
    }
  }

  const chargeResult = skipBilling
    ? { ok: true, skipped: true }
    : await chargeExpressVideoStageCredits({ sessionId, stageKey: normalizedStageKey });
  if (chargeResult?.ok) {
    if (isStepSession) {
      const stepResult = await pauseExpressStepAfterCompletedStage(sessionId, stepStageKey);
      return { ok: true, paused: Boolean(stepResult?.paused) };
    }
    return { ok: true, paused: false };
  }

  console.error('[express_video_billing] stage charge failed', {
    sessionId,
    stageKey: normalizedStageKey,
    errorCode: chargeResult?.errorCode || null,
    error: chargeResult?.error,
  });
  await processSessionCompletionFailure(sessionId);
  return { ok: false, paused: false };
}

const TERMINAL_GENERATION_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const ACTIVE_EXPRESS_BUILDER_STATUSES = new Set(['QUEUED', 'RUNNING']);
const AI_VIDEO_ALLOWED_BASE_TYPES = new Set(['character', 'narration', 'base', 'sound_effect']);
const AI_VIDEO_ALLOWED_LAYER_TYPES = new Set(['character', 'narration', 'base', 'scene', 'sound_effect']);
const AUDIO_TIME_EPSILON = 0.001;
const LISTENER_DB_RETRY_BASE_MS = Math.max(
  1000,
  Number(process.env.EXPRESS_LISTENER_DB_RETRY_BASE_MS) || 5000
);
const LISTENER_DB_RETRY_MAX_MS = Math.max(
  LISTENER_DB_RETRY_BASE_MS,
  Number(process.env.EXPRESS_LISTENER_DB_RETRY_MAX_MS) || 30000
);
const AI_VIDEO_ORPHAN_PENDING_GRACE_MS = Math.max(
  60 * 1000,
  Number(process.env.AI_VIDEO_ORPHAN_PENDING_GRACE_MS) || 10 * 60 * 1000
);

function normalizeStatusValue(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue || null;
}

function hasRenderedVideoOutput(sessionData = {}) {
  if (isBranchedVideoSession(sessionData)) {
    return allBranchVideosCompleted(sessionData);
  }

  return Boolean(
    normalizeOptionalString(sessionData?.remoteURL)
    || normalizeOptionalString(sessionData?.videoLink)
    || normalizeOptionalString(sessionData?.videoVideoLink)
  );
}

function resolveFinalVideoGenerationFailureMessage(sessionData = {}) {
  if (isBranchedVideoSession(sessionData)) {
    const branchFailure = getBranchRenderFailure(sessionData);
    if (branchFailure) {
      return branchFailure.message;
    }
  }

  const generationError = normalizeOptionalString(sessionData?.generationError);
  if (generationError) {
    return generationError;
  }

  const expressGenerationError = normalizeOptionalString(sessionData?.expressGenerationError);
  if (expressGenerationError) {
    return expressGenerationError;
  }

  if (sessionData?.expressGenerationFailed) {
    return 'Express video generation failed.';
  }

  if (!hasRenderedVideoOutput(sessionData)) {
    return 'Video generation finished without a rendered video URL.';
  }

  return null;
}

function getExpressBuilderStatus(sessionData = {}) {
  return normalizeStatusValue(sessionData?.expressGenerationBuilder?.status);
}

function isExpressBuilderStillPreparing(sessionData = {}) {
  const builderStatus = getExpressBuilderStatus(sessionData);
  return ACTIVE_EXPRESS_BUILDER_STATUSES.has(builderStatus);
}

function normalizeBaseAiImageType(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  // Backward compatibility: legacy sessions use "scene" for base visual layers.
  if (normalized === 'scene') {
    return 'base';
  }
  return normalized;
}

function getNormalizedLayerAiVideoType(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function isAiVideoCandidateLayer(layer = {}) {
  const layerType = getNormalizedLayerAiVideoType(layer?.layerAiVideoType);
  const baseType = normalizeBaseAiImageType(layer?.layerBaseAiImageType);

  if (layer?.skipAiVideoGeneration === true || layer?.skipAiVideoGeneration === 'true') {
    return false;
  }
  if (layerType === 'none' || baseType === 'none') {
    return false;
  }

  if (baseType) {
    return AI_VIDEO_ALLOWED_BASE_TYPES.has(baseType);
  }

  return AI_VIDEO_ALLOWED_LAYER_TYPES.has(layerType);
}

function layerRequiresBaseAiVideo(layer = {}) {
  return isAiVideoCandidateLayer(layer);
}

function shouldSkipAiVideoGenerationForLayer(layer = {}) {
  const aiVideoStatus = typeof layer?.aiVideoGenerationStatus === 'string'
    ? layer.aiVideoGenerationStatus.trim().toUpperCase()
    : '';

  return Boolean(
    !isAiVideoCandidateLayer(layer) ||
    (
      aiVideoStatus === 'COMPLETED' &&
      !layer?.aiVideoGenerationPending &&
      !layer?.aiVideoLayer
    )
  );
}

function shouldGenerateNarratorAvatarForSession(sessionData = {}) {
  return sessionData.addNarratorAvatar === true || sessionData.add_narrator_avatar === true;
}

function isBaseLayerRenderPending(layer = {}, requireAiVideoOutput = false) {
  if (!requireAiVideoOutput) {
    return false;
  }
  if (!layerRequiresBaseAiVideo(layer)) {
    return false;
  }
  if (layer?.aiVideoGenerationStatus === 'FAILED') {
    return false;
  }
  const returnVal =  Boolean(layer?.aiVideoGenerationPending) || !hasGeneratedAiVideoOutput(layer);

  return returnVal;
}

function getLayerEndTime(layer = {}) {
  const startTime = Number.isFinite(Number(layer?.durationOffset))
    ? Number(layer.durationOffset)
    : 0;
  const duration = Number.isFinite(Number(layer?.duration))
    ? Number(layer.duration)
    : 0;
  return Math.max(startTime, startTime + duration);
}

function normalizeAudioLayerType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

function isFreestandingMusicAudioLayer(audioLayer = {}) {
  const audioType = normalizeAudioLayerType(audioLayer?.generationType || audioLayer?.type || audioLayer?.audioType);
  return audioType === 'music' && !audioLayer?.connectedLayerId;
}

function getAudioLayerStartTime(audioLayer = {}) {
  return Number.isFinite(Number(audioLayer?.startTime))
    ? Math.max(0, Number(audioLayer.startTime))
    : 0;
}

function getAudioLayerEndTime(audioLayer = {}) {
  const startTime = getAudioLayerStartTime(audioLayer);
  const endTime = Number(audioLayer?.endTime);
  if (Number.isFinite(endTime) && endTime > startTime) {
    return endTime;
  }

  const duration = Number(audioLayer?.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return startTime + duration;
  }

  return startTime;
}

function getAudioLayerId(audioLayer = {}) {
  return audioLayer?._id?.toString?.() || audioLayer?._id || null;
}

function getFullLengthMusicAudioLayerIds(audioLayers = [], originalTimelineEnd = 0) {
  if (!Array.isArray(audioLayers) || originalTimelineEnd <= 0) {
    return new Set();
  }

  return new Set(
    audioLayers
      .filter((audioLayer) =>
        isFreestandingMusicAudioLayer(audioLayer) &&
        getAudioLayerStartTime(audioLayer) <= AUDIO_TIME_EPSILON &&
        getAudioLayerEndTime(audioLayer) >= originalTimelineEnd - AUDIO_TIME_EPSILON
      )
      .map(getAudioLayerId)
      .filter(Boolean)
  );
}

function clampAudioLayersToReflowedTimeline(audioLayers = [], newTimelineEnd = 0, fullLengthMusicAudioLayerIds = new Set()) {
  const safeTimelineEnd = Math.max(0, Number(newTimelineEnd) || 0);

  for (const audioLayer of audioLayers) {
    const startTime = getAudioLayerStartTime(audioLayer);
    const currentEndTime = getAudioLayerEndTime(audioLayer);
    const layerId = getAudioLayerId(audioLayer);
    const isFullLengthMusic = layerId && fullLengthMusicAudioLayerIds.has(layerId);

    if (isFullLengthMusic) {
      const sourceDuration = Number(audioLayer?.duration);
      const sourceEndTime = Number.isFinite(sourceDuration) && sourceDuration > 0
        ? startTime + sourceDuration
        : safeTimelineEnd;
      audioLayer.endTime = Math.max(startTime, Math.min(safeTimelineEnd, sourceEndTime));
      continue;
    }

    if (currentEndTime > safeTimelineEnd) {
      audioLayer.endTime = Math.max(startTime, safeTimelineEnd);
    }
  }

  return audioLayers;
}

function getLayerAiVideoStartedAtMs(layer = {}) {
  const startedAt = layer?.aiVideoGenerationStartedAt;
  if (!startedAt) {
    return null;
  }
  const startedAtMs = new Date(startedAt).getTime();
  return Number.isFinite(startedAtMs) ? startedAtMs : null;
}

function hasGeneratedAiVideoOutput(layer = {}) {
  return layer?.hasAiVideoLayer !== false && Boolean(layer?.aiVideoLayer || layer?.aiVideoRemoteLink);
}

function applyTranscriptGenerationResultToStatus(currentGenerationStatus = {}, succeeded = false) {
  const transcriptStatus = succeeded ? 'COMPLETED' : 'FAILED';
  currentGenerationStatus.transcript_generation = transcriptStatus;
  return transcriptStatus;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getActiveItemImageReference(item = {}) {
  return [
    item?.src,
    item?.image,
    item?.image_url,
    item?.imageUrl,
    item?.url,
    item?.remoteURL,
    item?.remoteUrl,
    item?.remote_url,
  ].find(hasNonEmptyString) || '';
}

function hasLayerStillVisuals(layer = {}) {
  const imageSession = layer?.imageSession || {};
  const activeItemList = Array.isArray(imageSession.activeItemList)
    ? imageSession.activeItemList
    : [];

  return Boolean(
    activeItemList.some((item) => (
      item?.isHidden !== true &&
      (
        item?.type !== 'image' ||
        hasNonEmptyString(getActiveItemImageReference(item))
      )
    )) ||
    hasNonEmptyString(imageSession.activeGeneratedImage) ||
    hasNonEmptyString(imageSession.activeEditedImage) ||
    hasNonEmptyString(imageSession.activeSelectedImage) ||
    hasNonEmptyString(imageSession.activeImageRemoteLink) ||
    hasNonEmptyString(imageSession.videoRenderStartFrameImage) ||
    hasNonEmptyString(layer?.baseLayerStartFrame) ||
    hasNonEmptyString(layer?.thumbnailPath)
  );
}

function isStaleAiVideoPendingLayer(layer = {}, nowMs = Date.now()) {
  if (!isAiVideoCandidateLayer(layer)) {
    return false;
  }

  const status = typeof layer?.aiVideoGenerationStatus === 'string'
    ? layer.aiVideoGenerationStatus.trim().toUpperCase()
    : '';
  if (status === 'COMPLETED' || status === 'FAILED') {
    return false;
  }
  if (!layer?.aiVideoGenerationPending) {
    return false;
  }
  if (hasGeneratedAiVideoOutput(layer)) {
    return false;
  }

  const startedAtMs = getLayerAiVideoStartedAtMs(layer);
  return startedAtMs !== null && nowMs - startedAtMs > AI_VIDEO_ORPHAN_PENDING_GRACE_MS;
}

async function recoverOrphanedAiVideoGenerationLayers(sessionData) {
  if (!sessionData?.expressGenerativeVideoRequired) {
    return false;
  }

  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const nowMs = Date.now();
  const stalePendingLayerIds = layers
    .filter((layer) => isStaleAiVideoPendingLayer(layer, nowMs))
    .map((layer) => layer?._id?.toString?.())
    .filter(Boolean);

  if (!stalePendingLayerIds.length) {
    return false;
  }

  const activeGenerationDocs = await AIVideoLayerGeneration.find({
    sessionId: sessionData._id.toString(),
    layerId: { $in: stalePendingLayerIds },
    status: { $in: ['INIT', 'PENDING', 'FAILED'] },
  }).select('layerId').lean();
  const activeLayerIds = new Set(activeGenerationDocs.map((doc) => doc.layerId?.toString()).filter(Boolean));
  const orphanedLayerIds = new Set(stalePendingLayerIds.filter((layerId) => !activeLayerIds.has(layerId)));

  if (!orphanedLayerIds.size) {
    return false;
  }

  const failureMessage = 'AI video generation request disappeared while pending; removing layer during delete/reflow.';
  const nextLayers = layers.map((layer) => {
    if (!orphanedLayerIds.has(layer?._id?.toString?.())) {
      return layer;
    }

    layer.aiVideoGenerationPending = false;
    layer.aiVideoGenerationStatus = 'FAILED';
    layer.hasAiVideoLayer = false;
    layer.processVideoGenerationFailed = true;
    layer.aiVideoGenerationError = failureMessage;
    if (layer.layerAiVideoType === 'character') {
      layer.lipSyncGenerationPending = false;
    }
    return layer;
  });

  const nextGenerationStatus = {
    ...(sessionData.expressGenerationStatus || {}),
    delete_reflow: 'INIT',
    timeline_reflowed: 'INIT',
  };

  await VideoSession.updateOne(
    { _id: sessionData._id },
    {
      $set: {
        layers: nextLayers,
        expressGenerationStatus: nextGenerationStatus,
        lastAiVideoLayerGenerationError: failureMessage,
      },
    },
  );

  console.warn('Recovered orphaned AI video generation layers for delete/reflow', {
    sessionId: sessionData._id.toString(),
    layerIds: Array.from(orphanedLayerIds),
  });

  return true;
}

async function recoverUnqueuedAiVideoGenerationStage(sessionData) {
  if (!sessionData?.expressGenerativeVideoRequired) {
    return false;
  }

  const sessionId = sessionData?._id?.toString?.();
  if (!sessionId) {
    return false;
  }

  const aiVideoStageStatus = typeof sessionData?.expressGenerationStatus?.ai_video_generation === 'string'
    ? sessionData.expressGenerationStatus.ai_video_generation.trim().toUpperCase()
    : '';
  if (aiVideoStageStatus !== 'PENDING') {
    return false;
  }

  const candidateLayerIds = (Array.isArray(sessionData.layers) ? sessionData.layers : [])
    .filter((layer) => {
      if (shouldSkipAiVideoGenerationForLayer(layer)) {
        return false;
      }
      const status = typeof layer?.aiVideoGenerationStatus === 'string'
        ? layer.aiVideoGenerationStatus.trim().toUpperCase()
        : '';
      if (status === 'COMPLETED' || status === 'FAILED') {
        return false;
      }
      if (layer?.aiVideoGenerationPending || hasGeneratedAiVideoOutput(layer)) {
        return false;
      }
      return true;
    })
    .map((layer) => layer?._id?.toString?.())
    .filter(Boolean);

  if (!candidateLayerIds.length) {
    return false;
  }

  const activeGenerationDocs = await AIVideoLayerGeneration.find({
    sessionId,
    layerId: { $in: candidateLayerIds },
    status: { $in: ['INIT', 'PENDING'] },
  }).select('_id').lean();

  if (activeGenerationDocs.length) {
    return false;
  }

  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        expressGenerationStatus: {
          ...(sessionData.expressGenerationStatus || {}),
          ai_video_generation: 'INIT',
        },
        aiVideoGenerationPending: false,
        lastAiVideoLayerGenerationError: null,
      },
    },
  );

  console.warn('Recovered unqueued AI video generation stage', {
    sessionId,
    layerIds: candidateLayerIds,
  });

  return true;
}

function getFailedRequiredAiVideoLayer(layers = []) {
  if (!Array.isArray(layers)) {
    return null;
  }

  return layers.find((layer) => {
    if (!isAiVideoCandidateLayer(layer)) {
      return false;
    }
    const status = typeof layer?.aiVideoGenerationStatus === 'string'
      ? layer.aiVideoGenerationStatus.trim().toUpperCase()
      : '';
    return status === 'FAILED' && !hasGeneratedAiVideoOutput(layer);
  }) || null;
}

async function markAiVideoGenerationStageFailed(sessionId, currentGenerationStatus = {}, failedLayer = {}) {
  const failureMessage = failedLayer?.aiVideoGenerationError || 'AI video generation failed.';
  const now = new Date();
  const failedStatus = {
    ...(currentGenerationStatus || {}),
    ai_video_generation: 'FAILED',
    status: 'FAILED',
  };

  console.error('[ai_video][stage_failed] required AI video layer failed without output', {
    sessionId,
    layerId: failedLayer?._id?.toString?.() || failedLayer?._id || null,
    error: failureMessage,
  });

  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        expressGenerationStatus: failedStatus,
        aiVideoGenerationPending: false,
        expressGenerationPending: false,
        expressGenerationFailed: true,
        expressGenerationError: failureMessage,
        lastAiVideoLayerGenerationError: failureMessage,
        'expressStepGeneration.status': 'FAILED',
        'expressStepGeneration.currentStep': 'ai_video_generation',
        'expressStepGeneration.current_step': 'ai_video_generation',
        'expressStepGeneration.currentStepLabel': 'AI video',
        'expressStepGeneration.current_step_label': 'AI video',
        'expressStepGeneration.error': failureMessage,
        'expressStepGeneration.waiting': false,
        'expressStepGeneration.waitingForProcessNext': false,
        'expressStepGeneration.waiting_for_process_next': false,
        'expressStepGeneration.requiresUserAction': false,
        'expressStepGeneration.requires_user_action': false,
        'expressStepGeneration.canProcessNext': false,
        'expressStepGeneration.can_process_next': false,
        'expressStepGeneration.updatedAt': now,
        'expressStepGeneration.updated_at': now,
      },
    },
  );

  await processSessionCompletionFailure(sessionId);
}

async function markLipSyncGenerationStageFailed(
  sessionId,
  currentGenerationStatus = {},
  failedAssessment = {},
) {
  const failureMessage = getLipSyncFailureMessage(failedAssessment);
  const now = new Date();
  const failedStatus = {
    ...(currentGenerationStatus || {}),
    lip_sync_generation: 'FAILED',
    status: 'FAILED',
  };

  console.error('[lip_sync][stage_failed] required character layer has no completed lip sync output', {
    sessionId,
    layerId: failedAssessment?.layerId || null,
    audioLayerId: failedAssessment?.audioLayerId || null,
    layerStatus: failedAssessment?.status || null,
    error: failureMessage,
  });

  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        expressGenerationStatus: failedStatus,
        lipSyncGenerationPending: false,
        expressGenerationPending: false,
        expressGenerationFailed: true,
        expressGenerationError: failureMessage,
        lastLipSyncGenerationError: failureMessage,
        'expressStepGeneration.status': 'FAILED',
        'expressStepGeneration.currentStep': 'lip_sync_generation',
        'expressStepGeneration.current_step': 'lip_sync_generation',
        'expressStepGeneration.currentStepLabel': 'Lip sync',
        'expressStepGeneration.current_step_label': 'Lip sync',
        'expressStepGeneration.error': failureMessage,
        'expressStepGeneration.waiting': false,
        'expressStepGeneration.waitingForProcessNext': false,
        'expressStepGeneration.waiting_for_process_next': false,
        'expressStepGeneration.requiresUserAction': false,
        'expressStepGeneration.requires_user_action': false,
        'expressStepGeneration.canProcessNext': false,
        'expressStepGeneration.can_process_next': false,
        'expressStepGeneration.updatedAt': now,
        'expressStepGeneration.updated_at': now,
      },
    },
  );

  await processSessionCompletionFailure(sessionId);
}

async function skipSoundEffectGenerationStage(
  sessionId,
  currentGenerationStatus = {},
  fallbackAssessment = {},
) {
  const failureMessage = getSoundEffectFailureMessage(fallbackAssessment);
  const completedStatus = {
    ...(currentGenerationStatus || {}),
    sound_effect_generation: 'COMPLETED',
  };

  console.warn('[sound_effect][stage_skipped] using base AI video after optional sound-effect failure', {
    sessionId,
    layerId: fallbackAssessment?.layerId || null,
    layerStatus: fallbackAssessment?.status || null,
    error: failureMessage,
  });

  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        expressGenerationStatus: completedStatus,
        soundEffectGenerationPending: false,
        soundEffectGenerationSkipped: true,
        soundEffectGenerationSkippedAt: new Date(),
        soundEffectGenerationSkipReason: failureMessage,
        lastSoundEffectGenerationError: failureMessage,
      },
    },
  );
}

function buildCancelledExpressGenerationStatus(rawStatus) {
  const currentStatus = rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus)
    ? { ...rawStatus }
    : {};

  const topLevelStatus = typeof currentStatus.status === 'string'
    ? currentStatus.status.trim().toUpperCase()
    : '';
  if (!TERMINAL_GENERATION_STATUSES.has(topLevelStatus)) {
    currentStatus.status = 'CANCELLED';
  }

  const videoGenerationStatus = typeof currentStatus.video_generation === 'string'
    ? currentStatus.video_generation.trim().toUpperCase()
    : '';
  if (!TERMINAL_GENERATION_STATUSES.has(videoGenerationStatus)) {
    currentStatus.video_generation = 'CANCELLED';
  }

  const frameGenerationStatus = typeof currentStatus.frame_generation === 'string'
    ? currentStatus.frame_generation.trim().toUpperCase()
    : '';
  if (!TERMINAL_GENERATION_STATUSES.has(frameGenerationStatus)) {
    currentStatus.frame_generation = 'CANCELLED';
  }

  return currentStatus;
}

async function evictQueuedGenerationTasks(sessionId) {
  const cleanupResults = await Promise.allSettled([
    FrameGeneration.deleteMany({ sessionId }),
    VideoGeneration.deleteMany({ videoSessionId: sessionId }),
    AIVideoLayerGeneration.deleteMany({ sessionId }),
    ImageGeneration.deleteMany({
      $or: [
        { sessionId },
        { videoSessionId: sessionId },
      ],
    }),
    ImageBatchGeneration.deleteMany({ sessionId }),
    AudioGeneration.deleteMany({ sessionId }),
    PendingUserMusicGeneration.deleteMany({ sessionId }),
  ]);

  cleanupResults.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('Failed to evict queued generation task', {
        sessionId,
        error: result.reason?.response?.data || result.reason?.message || result.reason,
        stack: result.reason?.stack,
      });
    }
  });
}

async function forceEjectSession(latestSession) {
  const sessionId = latestSession._id.toString();

  await evictQueuedGenerationTasks(sessionId);

  await VideoSession.updateOne({ _id: sessionId }, {
    $set: {
      frameGenerationPending: false,
      videoGenerationPending: false,
      audioGenerationPending: false,
      transcriptGenerationPending: false,
      aiVideoGenerationPending: false,
      lipSyncGenerationPending: false,
      soundEffectGenerationPending: false,
    },
  }, { new: true });
}

async function markSessionAsCancelledAndEvictTasks(latestSession) {
  const sessionId = latestSession._id.toString();
  const cancelledExpressGenerationStatus = buildCancelledExpressGenerationStatus(
    latestSession.expressGenerationStatus,
  );

  await evictQueuedGenerationTasks(sessionId);

  await VideoSession.updateOne({ _id: sessionId }, {
    $set: {
      expressGenerationPending: false,
      frameGenerationPending: false,
      videoGenerationPending: false,
      audioGenerationPending: false,
      transcriptGenerationPending: false,
      aiVideoGenerationPending: false,
      lipSyncGenerationPending: false,
      soundEffectGenerationPending: false,
      expressGenerationStatus: cancelledExpressGenerationStatus,
    },
  }, { new: true });
}

export async function listenToPendingGenerations() {
  let dbRetryDelayMs = LISTENER_DB_RETRY_BASE_MS;

  while (true) {
    try {
      await getDBConnectionString();

      // isExpressGeneration true and expressGenerationPending true
      const pendingSessions = await VideoSession.find({
        isExpressGeneration: true,
        expressGenerationPending: true,
        expressGenerationPaused: { $ne: true },
        expressGenerationCancelled: { $ne: true },
        'expressGenerationBuilder.status': { $nin: ['QUEUED', 'RUNNING'] },
      });

      dbRetryDelayMs = LISTENER_DB_RETRY_BASE_MS;
      await getTimeout(500);

      for (const session of pendingSessions) {
        try {
          await checkVideoRenderStatus(session);
        } catch (err) {
          const sessionId = session?._id?.toString?.() || session?._id;
          const mongoConnectivityError = isMongoConnectivityError(err);
          console.error('Express listener crashed while processing session; continuing', err, {
            sessionId,
            mongoConnectivityError,
          });
          if (mongoConnectivityError) {
            await resetDbConnection();
            await getTimeout(dbRetryDelayMs);
            dbRetryDelayMs = Math.min(dbRetryDelayMs * 2, LISTENER_DB_RETRY_MAX_MS);
            break;
          }
        }
      }
    } catch (err) {
      const mongoConnectivityError = isMongoConnectivityError(err);
      console.error('Express listener loop error; continuing', err, {
        mongoConnectivityError,
        retryDelayMs: dbRetryDelayMs,
      });
      if (mongoConnectivityError) {
        await resetDbConnection();
      }
      await getTimeout(dbRetryDelayMs);
      dbRetryDelayMs = Math.min(dbRetryDelayMs * 2, LISTENER_DB_RETRY_MAX_MS);
    }
  }
}

async function checkVideoRenderStatus(session) {

  await getDBConnectionString();

  // Always work with the latest session to avoid stale data and null refs
  const latestSession = await VideoSession.findById(session._id);
  if (!latestSession) {
    return;
  }

  if (latestSession.expressGenerationCancelled) {
    await markSessionAsCancelledAndEvictTasks(latestSession);
    return;
  }

  if (latestSession.expressGenerationPaused) {
    return;
  }

  if (!latestSession.expressGenerationPending) {
    await forceEjectSession(latestSession);
    return;
  }

  if (isExpressBuilderStillPreparing(latestSession)) {
    return;
  }

  const sessionId = latestSession._id.toString();
  const quickSessionCreatedAt = latestSession.createdAt;
  const expressGenerationStatus = latestSession.expressGenerationStatus || {};



  const currentDateTime = new Date();
  const timeDifference = currentDateTime - quickSessionCreatedAt;
  const timeDifferenceInMinutes = Math.floor(timeDifference / (1000 * 120));
  if (timeDifferenceInMinutes > 60 * 24) {
    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: {
        ...expressGenerationStatus,
        video_generation: 'FAILED'
      },
      expressGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: 'Video generation timed out'
    }, { new: true });
    await processSessionCompletionFailure(sessionId);
    return;
  }




  const sessionLayers = Array.isArray(latestSession.layers) ? latestSession.layers : [];
  let isImageGenerationPending = false;

  let isAiVideoGenerationPending = false;

  let imageGenerationFailed = false;

  for (const layer of sessionLayers) {

    if (!layer) {
      imageGenerationFailed = true;
      continue;
    }

    const layerImageSession = layer.imageSession;

    if (!layerImageSession) {
      imageGenerationFailed = true;
      continue;
    }
    const layerImageSessionGenerationStatus = layerImageSession.generationStatus;
    const layerImageSessionEditStatus = layerImageSession.editStatus;



    if (layerImageSessionGenerationStatus === 'FAILED') {

      imageGenerationFailed = true;
    }

    if (

      layerImageSessionGenerationStatus !== 'COMPLETED' ||
      (
        layerImageSessionEditStatus !== 'INIT' &&
        layerImageSessionEditStatus !== 'COMPLETED'
      )
    ) {
      isImageGenerationPending = true;

    }
  }



  if (!isImageGenerationPending && expressGenerationStatus.image_generation !== 'COMPLETED') {
    expressGenerationStatus.image_generation = 'COMPLETED';
  }



  if (imageGenerationFailed) {
    // set image generation failed break out of loop
    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: {
        ...expressGenerationStatus,
        image_generation: 'FAILED'
      },
      expressGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: 'Image generation failed'
    }, { new: true });

    await processSessionCompletionFailure(sessionId);

    return;
  }

  // update video session
  await VideoSession.updateOne({ _id: sessionId }, {
    expressGenerationStatus: expressGenerationStatus,
  }, { new: true });

  if (!isImageGenerationPending) {
    const imageStageResult = await completeExpressStageForBillingAndStep(
      sessionId,
      EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION,
    );
    if (!imageStageResult.ok || imageStageResult.paused) {
      return;
    }

    const generatedOutroTilesResult = await ensureGeneratedOutroTilesForSession(latestSession);
    if (generatedOutroTilesResult?.updated) {
      return;
    }
  }


  const audioLayers = latestSession.audioLayers || [];
  let isAudioGenerationPending = false;
  let isMusicGenerationPending = false;
  let isSpeechGenerationPending = false;


  let isAudioGenerationFailed = false;
  let isMusicGenerationFailed = false;
  let isSpeechGenerationFailed = false;


  for (const layer of audioLayers) {

    if (layer.generationStatus === 'PENDING') {
      isAudioGenerationPending = true;
    }

    if (layer.generationStatus === 'FAILED') {
      isAudioGenerationFailed = true;
    }
  }



  for (const layer of audioLayers) {
    if (layer.generationType === 'music') {

      if (layer.generationStatus === 'PENDING') {

        isMusicGenerationPending = true;
      }
      if (layer.generationStatus === 'FAILED') {
        isMusicGenerationFailed = true;
        isAudioGenerationFailed = true;
      }
    }
  }

  for (const layer of audioLayers) {
    if (layer.generationType === 'speech') {
      if (layer.generationStatus === 'PENDING') {
        isSpeechGenerationPending = true;
      }
      if (layer.generationStatus === 'FAILED') {
        isSpeechGenerationFailed = true;
        isAudioGenerationFailed = true;
      }
    }
  }




  if (!isMusicGenerationPending && !isMusicGenerationFailed && expressGenerationStatus.music_generation !== 'COMPLETED') {
    expressGenerationStatus.music_generation = 'COMPLETED';

    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: expressGenerationStatus,
    }, { new: true });

  }

  if (!isSpeechGenerationPending && !isSpeechGenerationFailed && expressGenerationStatus.speech_generation !== 'COMPLETED') {
    expressGenerationStatus.speech_generation = 'COMPLETED';

    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: expressGenerationStatus,
    }, { new: true });
  }

  if (!isSpeechGenerationPending && !isSpeechGenerationFailed) {
    const speechStageResult = await completeExpressStageForBillingAndStep(
      sessionId,
      EXPRESS_VIDEO_BILLING_STAGES.SPEECH_GENERATION,
    );
    if (!speechStageResult.ok || speechStageResult.paused) {
      return;
    }
  }

  if (!isMusicGenerationPending && !isMusicGenerationFailed) {
    const musicStageResult = await completeExpressStageForBillingAndStep(
      sessionId,
      EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION,
    );
    if (!musicStageResult.ok || musicStageResult.paused) {
      return;
    }
  }



  if (!isAudioGenerationPending && !isAudioGenerationFailed && expressGenerationStatus.audio_generation !== 'COMPLETED') {
    expressGenerationStatus.audio_generation = 'COMPLETED';

    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: expressGenerationStatus,
    }, { new: true });

  }


  if (isAudioGenerationFailed) {
    const failedAudioGenerationStatus = {
      ...expressGenerationStatus,
      audio_generation: 'FAILED'
    };

    if (isMusicGenerationFailed) {
      failedAudioGenerationStatus.music_generation = 'FAILED';
    }
    if (isSpeechGenerationFailed) {
      failedAudioGenerationStatus.speech_generation = 'FAILED';
    }

    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: failedAudioGenerationStatus,
      expressGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: 'Audio generation failed'
    }, { new: true });

    await processSessionCompletionFailure(sessionId);
    return;
  }


  if (!isImageGenerationPending && !isSpeechGenerationPending && !isMusicGenerationPending) {
    const latestSessionData = await VideoSession.findById(sessionId);
    const currentGenerationStatus = latestSessionData.expressGenerationStatus;
    const currentSessionLayers = Array.isArray(latestSessionData.layers) ? latestSessionData.layers : [];


    if (latestSessionData.expressGenerativeVideoRequired) {
      const recoveredOrphanedAiVideoLayers = await recoverOrphanedAiVideoGenerationLayers(latestSessionData);
      if (recoveredOrphanedAiVideoLayers) {
        return;
      }

      const recoveredUnqueuedAiVideoStage = await recoverUnqueuedAiVideoGenerationStage(latestSessionData);
      if (recoveredUnqueuedAiVideoStage) {
        return;
      }

      const failedRequiredAiVideoLayer = getFailedRequiredAiVideoLayer(currentSessionLayers);
      if (failedRequiredAiVideoLayer) {
        await markAiVideoGenerationStageFailed(sessionId, currentGenerationStatus, failedRequiredAiVideoLayer);
        return;
      }

      for (let i = 0; i < currentSessionLayers.length; i++) {
        const currentLayer = currentSessionLayers[i];

        if (shouldSkipAiVideoGenerationForLayer(currentLayer)) {
          continue;
        }

        if (currentLayer.aiVideoGenerationStatus !== "COMPLETED" && currentLayer.aiVideoGenerationStatus !== "FAILED") {
          isAiVideoGenerationPending = true;
          break;
        }
      }

      if (currentGenerationStatus.ai_video_generation !== "COMPLETED" && !isAiVideoGenerationPending) {

        currentGenerationStatus.ai_video_generation = 'COMPLETED';
        await VideoSession.updateOne({ _id: sessionId }, {
          expressGenerationStatus: currentGenerationStatus,
          aiVideoGenerationPending: false
        }, { new: true });
      }

      // ready to generate ai video layers
      if (latestSessionData.expressGenerationStatus.ai_video_generation === "INIT" && isAiVideoGenerationPending) {

        if (currentGenerationStatus.ai_video_generation === 'INIT') {

          currentGenerationStatus.ai_video_generation = 'PENDING';

          await VideoSession.updateOne({ _id: sessionId }, {
            expressGenerationStatus: currentGenerationStatus,
            aiVideoGenerationPending: true
          }, { new: true });

          await createGenerativeVideoAnimationsForFrames(sessionId);
        }
      }

    }
  }


  if (isAiVideoGenerationPending || isImageGenerationPending || isSpeechGenerationPending) {
    return;
  }


  const latestSessionData = await VideoSession.findById(sessionId);

  let currentGenerationStatus = latestSessionData.expressGenerationStatus || {};
  const latestSessionLayers = latestSessionData.layers || [];

  if (currentGenerationStatus.ai_video_generation === 'COMPLETED') {
    const aiVideoStageResult = await completeExpressStageForBillingAndStep(
      sessionId,
      EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
    );
    if (!aiVideoStageResult.ok || aiVideoStageResult.paused) {
      return;
    }
  }



  const latestSessionId = latestSessionData._id.toString();

  const deleteReflowStatus = currentGenerationStatus.delete_reflow || 'INIT';
  if (deleteReflowStatus === 'PENDING') {
    return;
  }

  const sessionData = await VideoSession.findById(sessionId);

  const audioLayersAfterRealign = sessionData.audioLayers || [];

  if (deleteReflowStatus !== 'COMPLETED') {
    currentGenerationStatus.delete_reflow = 'PENDING';
    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: currentGenerationStatus,
    }, { new: true });

    try {
      await deleteEmptyLayersAndReflowTimeLine(sessionId);
      currentGenerationStatus.delete_reflow = 'COMPLETED';
      currentGenerationStatus.timeline_reflowed = 'COMPLETED';
      await VideoSession.updateOne({ _id: sessionId }, {
        expressGenerationStatus: currentGenerationStatus,
      }, { new: true });
    } catch {
      currentGenerationStatus.delete_reflow = 'FAILED';
      await VideoSession.updateOne({ _id: sessionId }, {
        expressGenerationStatus: currentGenerationStatus,
      }, { new: true });
      return;
    }
  }

  

  if (latestSessionData.isMovieGen || latestSessionData.isExpressGeneration) {

    const baseLayerStillRendering = latestSessionLayers.some((layer) =>
      isBaseLayerRenderPending(layer, latestSessionData.expressGenerativeVideoRequired)
    );

    if (baseLayerStillRendering) {
      return;
    }

    const lipSyncSessionData = await VideoSession.findById(sessionId)
      .select('layers audioLayers expressGenerationStatus')
      .lean();
    if (!lipSyncSessionData) {
      return;
    }
    currentGenerationStatus = lipSyncSessionData.expressGenerationStatus || currentGenerationStatus;
    const lipSyncAssessment = assessLipSyncStage(
      lipSyncSessionData.layers,
      lipSyncSessionData.audioLayers,
    );
    let lipSyncStageStatus = normalizeStatusValue(
      currentGenerationStatus.lip_sync_generation,
    );

    const failedLipSyncAssessment = lipSyncAssessment.failed[0];
    if (failedLipSyncAssessment) {
      await markLipSyncGenerationStageFailed(
        sessionId,
        currentGenerationStatus,
        failedLipSyncAssessment,
      );
      return;
    }

    if (!lipSyncStageStatus) {
      lipSyncStageStatus = ['NOT_REQUIRED', 'COMPLETED'].includes(lipSyncAssessment.state)
        ? 'COMPLETED'
        : 'INIT';
      currentGenerationStatus.lip_sync_generation = lipSyncStageStatus;
      await VideoSession.updateOne({ _id: sessionId }, {
        $set: {
          'expressGenerationStatus.lip_sync_generation': lipSyncStageStatus,
        },
      }, { new: true });
    }

    if (lipSyncStageStatus === 'INIT') {
      if (['NOT_REQUIRED', 'COMPLETED'].includes(lipSyncAssessment.state)) {
        lipSyncStageStatus = 'COMPLETED';
        currentGenerationStatus.lip_sync_generation = lipSyncStageStatus;
        await VideoSession.updateOne({ _id: sessionId }, {
          $set: {
            'expressGenerationStatus.lip_sync_generation': lipSyncStageStatus,
            lipSyncGenerationPending: false,
          },
        }, { new: true });
      } else {
        currentGenerationStatus.lip_sync_generation = 'PENDING';
        await VideoSession.updateOne({ _id: sessionId }, {
          expressGenerationStatus: currentGenerationStatus,
          lipSyncGenerationPending: true,
        }, { new: true });

        await generateLipSyncForSession(latestSessionId);
        return;
      }
    } else if (lipSyncStageStatus === 'PENDING') {
      if (lipSyncAssessment.state === 'COMPLETED') {
        lipSyncStageStatus = 'COMPLETED';
        currentGenerationStatus.lip_sync_generation = lipSyncStageStatus;
        await VideoSession.updateOne({ _id: sessionId }, {
          $set: {
            'expressGenerationStatus.lip_sync_generation': lipSyncStageStatus,
            lipSyncGenerationPending: false,
          },
        }, { new: true });
      } else if (lipSyncAssessment.state === 'NOT_REQUIRED') {
        lipSyncStageStatus = 'COMPLETED';
        currentGenerationStatus.lip_sync_generation = lipSyncStageStatus;
        await VideoSession.updateOne({ _id: sessionId }, {
          $set: {
            'expressGenerationStatus.lip_sync_generation': lipSyncStageStatus,
            lipSyncGenerationPending: false,
          },
        }, { new: true });
      } else if (lipSyncAssessment.state === 'INCOMPLETE') {
        await markLipSyncGenerationStageFailed(
          sessionId,
          currentGenerationStatus,
          lipSyncAssessment.incomplete[0],
        );
        return;
      } else {
        return;
      }
    } else if (
      lipSyncStageStatus === 'COMPLETED'
      && !['NOT_REQUIRED', 'COMPLETED'].includes(lipSyncAssessment.state)
    ) {
      await markLipSyncGenerationStageFailed(
        sessionId,
        currentGenerationStatus,
        lipSyncAssessment.incomplete[0] || lipSyncAssessment.pending[0],
      );
      return;
    }

    if (lipSyncStageStatus === 'COMPLETED') {
      const lipSyncStageResult = await completeExpressStageForBillingAndStep(
        sessionId,
        EXPRESS_VIDEO_BILLING_STAGES.LIP_SYNC_GENERATION,
      );
      if (!lipSyncStageResult.ok || lipSyncStageResult.paused) {
        return;
      }
    }

    const soundEffectSessionData = await VideoSession.findById(sessionId)
      .select('layers expressGenerationStatus soundEffectGenerationSkipped')
      .lean();
    if (!soundEffectSessionData) {
      return;
    }
    currentGenerationStatus = soundEffectSessionData.expressGenerationStatus || currentGenerationStatus;
    const soundEffectAssessment = assessSoundEffectStage(soundEffectSessionData.layers);
    let soundEffectGenerationStatus = normalizeStatusValue(
      currentGenerationStatus.sound_effect_generation,
    ) || 'INIT';
    let soundEffectStageSkipped = Boolean(soundEffectSessionData.soundEffectGenerationSkipped);

    if (soundEffectGenerationStatus === 'INIT') {
      if (['NOT_REQUIRED', 'COMPLETED'].includes(soundEffectAssessment.state)) {
        soundEffectGenerationStatus = 'COMPLETED';
        currentGenerationStatus.sound_effect_generation = soundEffectGenerationStatus;
        await VideoSession.updateOne({ _id: sessionId }, {
          $set: {
            'expressGenerationStatus.sound_effect_generation': soundEffectGenerationStatus,
            soundEffectGenerationPending: false,
          },
        }, { new: true });
      } else {
        currentGenerationStatus.sound_effect_generation = 'PENDING';
        await VideoSession.updateOne({ _id: sessionId }, {
          $set: {
            expressGenerationStatus: currentGenerationStatus,
            soundEffectGenerationPending: true,
            soundEffectGenerationSkipped: false,
          },
          $unset: {
            soundEffectGenerationSkippedAt: '',
            soundEffectGenerationSkipReason: '',
          },
        }, { new: true });

        await generateSoundEffectsForSession(latestSessionId);
        return;
      }
    } else if (soundEffectGenerationStatus === 'PENDING') {
      if (['NOT_REQUIRED', 'COMPLETED'].includes(soundEffectAssessment.state)) {
        soundEffectGenerationStatus = 'COMPLETED';
        currentGenerationStatus.sound_effect_generation = soundEffectGenerationStatus;
        await VideoSession.updateOne({ _id: sessionId }, {
          $set: {
            'expressGenerationStatus.sound_effect_generation': soundEffectGenerationStatus,
            soundEffectGenerationPending: false,
          },
        }, { new: true });
      } else if (soundEffectAssessment.state === 'FALLBACK') {
        await skipSoundEffectGenerationStage(
          sessionId,
          currentGenerationStatus,
          soundEffectAssessment.skipped[0]
            || soundEffectAssessment.incomplete[0]
            || soundEffectAssessment.failed[0],
        );
        soundEffectGenerationStatus = 'COMPLETED';
        currentGenerationStatus.sound_effect_generation = soundEffectGenerationStatus;
        soundEffectStageSkipped = true;
      } else {
        return;
      }
    } else if (soundEffectGenerationStatus === 'FAILED') {
      await skipSoundEffectGenerationStage(
        sessionId,
        currentGenerationStatus,
        soundEffectAssessment.skipped[0]
          || soundEffectAssessment.failed[0]
          || soundEffectAssessment.incomplete[0],
      );
      soundEffectGenerationStatus = 'COMPLETED';
      currentGenerationStatus.sound_effect_generation = soundEffectGenerationStatus;
      soundEffectStageSkipped = true;
    } else if (
      soundEffectGenerationStatus === 'COMPLETED'
      && !['NOT_REQUIRED', 'COMPLETED'].includes(soundEffectAssessment.state)
    ) {
      if (soundEffectAssessment.state === 'PENDING') {
        return;
      }
      if (!soundEffectStageSkipped) {
        await skipSoundEffectGenerationStage(
          sessionId,
          currentGenerationStatus,
          soundEffectAssessment.skipped[0]
            || soundEffectAssessment.incomplete[0]
            || soundEffectAssessment.failed[0],
        );
        soundEffectStageSkipped = true;
      }
    }

    if (soundEffectGenerationStatus === 'COMPLETED') {
      const soundEffectStageResult = await completeExpressStageForBillingAndStep(
        sessionId,
        EXPRESS_VIDEO_BILLING_STAGES.SOUND_EFFECT_GENERATION,
        { skipBilling: soundEffectStageSkipped },
      );
      if (!soundEffectStageResult.ok || soundEffectStageResult.paused) {
        return;
      }
    }

    const requiresNarratorAvatarGeneration = shouldGenerateNarratorAvatarForSession(latestSessionData);
    const narratorAvatarGenerationStatus = currentGenerationStatus.narrator_avatar_generation ||
      (requiresNarratorAvatarGeneration ? 'INIT' : 'COMPLETED');

    if (requiresNarratorAvatarGeneration) {
      if (narratorAvatarGenerationStatus === 'FAILED') {
        currentGenerationStatus.narrator_avatar_generation = 'FAILED';
        currentGenerationStatus.status = 'FAILED';
        await VideoSession.updateOne({ _id: sessionId }, {
          expressGenerationStatus: currentGenerationStatus,
          expressGenerationPending: false,
          expressGenerationFailed: true,
          expressGenerationError: latestSessionData.narratorAvatarError || 'Narrator avatar generation failed',
        }, { new: true });
        await processSessionCompletionFailure(sessionId);
        return;
      }

      if (narratorAvatarGenerationStatus === 'INIT' || narratorAvatarGenerationStatus === 'PENDING') {
        currentGenerationStatus.narrator_avatar_generation = 'PENDING';
        await VideoSession.updateOne({ _id: sessionId }, {
          expressGenerationStatus: currentGenerationStatus,
        }, { new: true });

        const avatarResult = await ensureNarratorAvatarVideoForSession(sessionId);
        if (avatarResult.status === 'FAILED') {
          currentGenerationStatus.narrator_avatar_generation = 'FAILED';
          currentGenerationStatus.status = 'FAILED';
          await VideoSession.updateOne({ _id: sessionId }, {
            expressGenerationStatus: currentGenerationStatus,
            expressGenerationPending: false,
            expressGenerationFailed: true,
            expressGenerationError: avatarResult.error || 'Narrator avatar generation failed',
          }, { new: true });
          await processSessionCompletionFailure(sessionId);
          return;
        }
        if (avatarResult.status === 'COMPLETED' || avatarResult.status === 'SKIPPED') {
          currentGenerationStatus.narrator_avatar_generation = 'COMPLETED';
          await VideoSession.updateOne({ _id: sessionId }, {
            expressGenerationStatus: currentGenerationStatus,
            ...(avatarResult.status === 'SKIPPED' ? { narratorAvatarGenerationSkipped: true } : {}),
          }, { new: true });
        } else {
          return;
        }
      }

      if (currentGenerationStatus.narrator_avatar_generation === 'COMPLETED') {
        const refreshedAvatarSession = await VideoSession.findById(sessionId)
          .select('narratorAvatarGenerationSkipped')
          .lean();
        if (refreshedAvatarSession?.narratorAvatarGenerationSkipped !== true) {
          const narratorAvatarStageResult = await completeExpressStageForBillingAndStep(
            sessionId,
            EXPRESS_VIDEO_BILLING_STAGES.NARRATOR_AVATAR_GENERATION,
          );
          if (!narratorAvatarStageResult.ok || narratorAvatarStageResult.paused) {
            return;
          }
        }
      }
    } else if (currentGenerationStatus.narrator_avatar_generation !== 'COMPLETED') {
      currentGenerationStatus.narrator_avatar_generation = 'COMPLETED';
      await VideoSession.updateOne({ _id: sessionId }, {
        expressGenerationStatus: currentGenerationStatus,
      }, { new: true });
    }
  }

  const requiresNarratorAvatarGeneration = shouldGenerateNarratorAvatarForSession(latestSessionData);
  const narratorAvatarCompleted = !requiresNarratorAvatarGeneration ||
    currentGenerationStatus.narrator_avatar_generation === 'COMPLETED';
  const isSoundEffectLipSyncAndGenerativeVideCompleted = 
    currentGenerationStatus.sound_effect_generation === 'COMPLETED' &&
    currentGenerationStatus.lip_sync_generation === 'COMPLETED' &&
    (currentGenerationStatus.ai_video_generation === 'COMPLETED') &&
    narratorAvatarCompleted;

  if (!isSoundEffectLipSyncAndGenerativeVideCompleted) {
    return;
  }



  const transcriptGenerationStatus = currentGenerationStatus?.transcript_generation || 'INIT';
  const subtitlesEnabled = latestSessionData.enableSubtitles !== false;
  if (!subtitlesEnabled) {
    if (latestSessionData.transcriptGenerationPending || transcriptGenerationStatus !== 'COMPLETED') {
      currentGenerationStatus.transcript_generation = 'COMPLETED';
      await VideoSession.updateOne({ _id: sessionId }, {
        $set: {
          'expressGenerationStatus.transcript_generation': 'COMPLETED',
          transcriptGenerationPending: false,
        }
      }, { new: true });
    }
  } else if (latestSessionData.transcriptGenerationPending && transcriptGenerationStatus === 'INIT') {


    await getTimeout(100);

    await VideoSession.updateOne({ _id: sessionId }, {
      $set: {
        'expressGenerationStatus.transcript_generation': 'PENDING',
      }
    }, { new: true });


    let transcriptGenerationSucceeded = false;
    try {
      const transcriptSession = await VideoSession.findById(sessionId);
      if (!transcriptSession) {
        throw new Error(`Session not found for transcript generation: ${sessionId}`);
      }

      const sessionAudioLayers = Array.isArray(transcriptSession.audioLayers) ? transcriptSession.audioLayers : [];
      const speechLayerCount = sessionAudioLayers.filter((layer) => {
        const rawType = layer?.generationType;
        return typeof rawType === 'string' && rawType.trim().toLowerCase() === 'speech';
      }).length;

      if (speechLayerCount === 0) {
        transcriptGenerationSucceeded = true;
      } else {
        await generateTranscriptsForSessionAudioLayers(sessionId);
        transcriptGenerationSucceeded = true;
      }
    } catch (err) {
      console.error('Transcript generation threw; continuing without blocking video generation', {
        sessionId,
        error: err?.response?.data || err?.message || err,
        stack: err?.stack,
      });
    }
    

    const finalTranscriptStatus = applyTranscriptGenerationResultToStatus(
      currentGenerationStatus,
      transcriptGenerationSucceeded,
    );

    await VideoSession.updateOne({ _id: sessionId }, {
      $set: {
        'expressGenerationStatus.transcript_generation': finalTranscriptStatus,
        transcriptGenerationPending: false,
      }
    }, { new: true });

    if (latestSessionData.useDefaultAnimationPresets && !latestSessionData.expressGenerativeVideoRequired) {
      try {
        await applyDefaultAnimationPresets(sessionId);
      } catch (err) {
        console.error('Failed to apply default animation presets; continuing', {
          sessionId,
          error: err?.response?.data || err?.message || err,
          stack: err?.stack,
        });
      }
    }

  }

  if (currentGenerationStatus.frame_generation === 'INIT') {


    currentGenerationStatus.frame_generation = 'PENDING';
    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: currentGenerationStatus,
      frameGenerationPending: true
    }, { new: true });

    await generateFramesForSession(sessionId);
    return;
  } else {
    currentGenerationStatus.frame_generation = 'COMPLETED';
  }

  const frameGenerationLayers = await FrameGeneration.find({ sessionId: sessionId });

  if (frameGenerationLayers.length > 0 || isMusicGenerationPending || isImageGenerationPending || isSpeechGenerationPending) {
    return;
  }

  if (isBranchedVideoSession(latestSessionData)) {
    const branchFrameSession = await VideoSession.findById(sessionId).lean();
    const branchFrameFailure = getBranchFrameFailure(branchFrameSession);
    if (branchFrameFailure || !allBranchFramesCompleted(branchFrameSession)) {
      const failureMessage = branchFrameFailure?.message
        || 'Branch frame generation finished without complete frame manifests.';
      currentGenerationStatus.frame_generation = 'FAILED';
      currentGenerationStatus.video_generation = 'FAILED';
      currentGenerationStatus.status = 'FAILED';
      await VideoSession.updateOne({ _id: sessionId }, {
        $set: {
          expressGenerationStatus: currentGenerationStatus,
          frameGenerationPending: false,
          videoGenerationPending: false,
          expressGenerationPending: false,
          expressGenerationFailed: true,
          expressGenerationError: failureMessage,
          generationError: failureMessage,
        },
      });
      await processSessionCompletionFailure(sessionId);
      return;
    }
  }



  if (currentGenerationStatus.video_generation === 'INIT') {
    await getTimeout(100);

    const userId = latestSession.userId;
    const userData = await User.findOne({ _id: userId });
    const isPremiumUser = userData.isPremiumUser || userData.isPartnerUser;

    currentGenerationStatus.video_generation = 'PENDING';
    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: currentGenerationStatus,
      videoGenerationPending: true
    }, { new: true });

    await generateVideoForSession(sessionId, isPremiumUser);
    return;
  }



  if (!latestSessionData.videoGenerationPending) {
    const finalVideoFailureMessage = resolveFinalVideoGenerationFailureMessage(latestSessionData);
    if (finalVideoFailureMessage) {
      currentGenerationStatus.video_generation = 'FAILED';
      currentGenerationStatus.status = 'FAILED';
      await VideoSession.updateOne({ _id: sessionId }, {
        $set: {
          expressGenerationStatus: currentGenerationStatus,
          expressGenerationPending: false,
          expressGenerationPaused: false,
          expressGenerationFailed: true,
          expressGenerationError: finalVideoFailureMessage,
          generationError: finalVideoFailureMessage,
          videoGenerationPending: false,
        },
      }, { new: true });

      await processSessionCompletionFailure(sessionId);
      return;
    }

    currentGenerationStatus.video_generation = 'COMPLETED';
    await VideoSession.updateOne({ _id: sessionId }, {
      expressGenerationStatus: currentGenerationStatus,
    }, { new: true });

    const pipelineStageResult = await completeExpressStageForBillingAndStep(
      sessionId,
      EXPRESS_VIDEO_BILLING_STAGES.PIPELINE,
    );
    if (!pipelineStageResult.ok) {
      return;
    }

    const completionDelivery = await processSessionCompletionSuccess(sessionId);
    if (completionDelivery?.ok !== true) {
      return;
    }
    await VideoSession.updateOne({ _id: sessionId }, {
      $set: {
        expressGenerationPending: false,
        expressGenerationPaused: false,
        'expressGenerationStatus.video_generation': 'COMPLETED',
        'expressGenerationStatus.status': 'COMPLETED',
      },
    }, { new: true });
  }

}



async function generateFramesForSession(sessionId) {


  const session = await VideoSession.findOne({ _id: sessionId }).populate('layers.imageSession');

  if (isBranchedVideoSession(session)) {
    const renderPlanVersion = Number(session.renderPlanVersion) || 1;
    session.branchRenderPaths = normalizeBranchRenderPathTimings({
      branchRenderPaths: session.branchRenderPaths,
      layers: session.layers,
      audioLayers: session.audioLayers,
    });
    session.branchingTimeline = buildBranchingTimeline({
      branchRenderPaths: session.branchRenderPaths,
      branchingMeta: session.branchingMeta,
      defaultBranchPathId: session.defaultBranchPathId,
    });
    const durationMetadata = buildBranchDurationSessionMetadata({
      branchRenderPaths: session.branchRenderPaths,
      layers: session.layers,
      expressGenerationBillingDurationSeconds:
        session.expressGenerationBillingDurationSeconds,
      expressGenerationBillingStageDurations: session.expressGenerationBillingStageDurations,
      expressGenerationCreditCharges: session.expressGenerationCreditCharges,
    });
    session.totalDuration = durationMetadata.totalDuration;
    session.expressGenerationBillingDurationSeconds =
      durationMetadata.expressGenerationBillingDurationSeconds;
    session.expressGenerationBillingStageDurations =
      durationMetadata.expressGenerationBillingStageDurations;
    const branchPaths = getBranchRenderPaths(session);
    if (branchPaths.length === 0) {
      throw new Error(`Branched session ${sessionId} does not contain any render paths.`);
    }

    for (const path of branchPaths) {
      const timeline = getBranchTimeline(path);
      if (timeline.length === 0) {
        throw new Error(`Branch path ${path.pathId} does not contain a render timeline.`);
      }

      path.frameGenerationStatus = 'PENDING';
      path.frameGenerationPending = true;
      path.frameGenerationError = null;
      for (let pathSequenceIndex = 0; pathSequenceIndex < timeline.length; pathSequenceIndex += 1) {
        const timelineEntry = timeline[pathSequenceIndex];
        timelineEntry.pathSequenceIndex = Number.isInteger(timelineEntry.pathSequenceIndex)
          ? timelineEntry.pathSequenceIndex
          : pathSequenceIndex;
        timelineEntry.frameGenerationStatus = 'PENDING';
        timelineEntry.frameGenerationPending = true;
        timelineEntry.frameGenerationError = null;
        timelineEntry.frames = [];
      }
    }
    session.markModified('branchRenderPaths');
    session.markModified('branchingTimeline');
    session.markModified('expressGenerationBillingStageDurations');
    await session.save();

    for (const path of branchPaths) {
      const timeline = getBranchTimeline(path);
      for (let pathSequenceIndex = 0; pathSequenceIndex < timeline.length; pathSequenceIndex += 1) {
        const timelineEntry = timeline[pathSequenceIndex];
        const layerId = timelineEntry.layerId.toString();
        await FrameGeneration.updateOne(
          {
            sessionId: sessionId.toString(),
            layerId,
            renderPathId: path.pathId,
            renderPlanVersion,
            pathSequenceIndex,
          },
          {
            $setOnInsert: {
              sessionId: sessionId.toString(),
              layerId,
              renderPathId: path.pathId,
              renderPlanVersion,
              pathSequenceIndex,
              isVideoGenerationRequest: true,
              isExpressFrameGenerationRequest: true,
              rowLocked: false,
            },
          },
          { upsert: true },
        );
      }
    }
    return;
  }

  for (const layer of session.layers) {


    const layerId = layer._id.toString();

    const frameGenerationPayload = new FrameGeneration({
      sessionId: sessionId,
      layerId: layerId,
      isVideoGenerationRequest: true,
    });
    await frameGenerationPayload.save();

  }
}




async function deleteEmptyLayersAndReflowTimeLine(sessionId) {
  const session = await VideoSession.findById(sessionId);

  if (!session) {
    return;
  }

  // A branched session's `layers` array is a shared media-asset catalog, not a
  // single timeline. Reflowing that catalog would corrupt every saved leaf
  // path. Failed required branch assets are handled by the path render jobs.
  if (isBranchedVideoSession(session)) {
    return;
  }

  const originalLayers = session.layers || [];
  if (!originalLayers.length) {
    return;
  }

  // 1) Identify removed layers and the time segments they occupied
  const removedLayerIds = new Set();
  const removedSegments = [];

  for (const layer of originalLayers) {
    const offset = typeof layer.durationOffset === 'number' ? layer.durationOffset : 0;
    const duration = typeof layer.duration === 'number' ? layer.duration : 0;

    const hasActiveVisuals = hasLayerStillVisuals(layer);

    const hasAiVideoVisuals = Boolean(
      layer?.aiVideoLayer ||
      layer?.lipSyncVideoLayer ||
      layer?.soundEffectVideoLayer ||
      layer?.userVideoLayer ||
      layer?.aiVideoRemoteLink ||
      layer?.lipSyncRemoteLink ||
      layer?.soundEffectRemoteLink ||
      layer?.userVideoRemoteLink ||
      layer?.hasAiVideoLayer ||
      layer?.hasLipSyncVideoLayer ||
      layer?.hasSoundEffectVideoLayer ||
      layer?.hasUserVideoLayer ||
      layer?.aiVideoGenerationStatus === 'COMPLETED' ||
      layer?.lipSyncVideoGenerationStatus === 'COMPLETED' ||
      layer?.soundEffectVideoGenerationStatus === 'COMPLETED' ||
      layer?.userVideoGenerationStatus === 'COMPLETED'
    );

    const aiVideoFailed = layer.aiVideoGenerationStatus === 'FAILED';

    // Only remove layers that truly have nothing usable. If AI video failed but a
    // still image exists, keep the scene so final render can fall back to frames.
    if (!hasActiveVisuals && (!hasAiVideoVisuals || aiVideoFailed)) {
      if (layer._id) {
        removedLayerIds.add(layer._id.toString());
      }
      removedSegments.push({ start: offset, duration });
    }
  }

  // Nothing to delete → no reflow needed
  if (!removedLayerIds.size) {
    return;
  }

  // iteratively call removeLayerInSession for each removed layer
  for (const layerId of removedLayerIds) {
    try {
      await removeLayerInSession(session.userId, {
        sessionId: sessionId,
        layerId: layerId,
      });
    } catch {
    }
  }
}





export async function removeLayerInSession(userId, payload) {
  const { sessionId, layerId } = payload;

  await getDBConnectionString();

  // 1) Load the session
  const videoSession = await VideoSession.findOne({ _id: sessionId });
  if (!videoSession) {
    throw new Error("Session not found");
  }

  // 2) Find the layer index
  const layerIndex = videoSession.layers.findIndex(
    (layer) => layer._id.toString() === layerId
  );
  if (layerIndex === -1) {
    throw new Error("Layer not found");
  }

  let audioLayers = videoSession.audioLayers || [];
  const originalTimelineEnd = (videoSession.layers || []).reduce(
    (maxEnd, layer) => Math.max(maxEnd, getLayerEndTime(layer)),
    0
  );
  const fullLengthMusicAudioLayerIds = getFullLengthMusicAudioLayerIds(audioLayers, originalTimelineEnd);

  // 3) Remove the layer
  const removedLayer = videoSession.layers.splice(layerIndex, 1)[0];

  // 4) If there's a connected audio layer, remove it as well
  //    (connectedLayerId === layerId means it was "tied" to this layer)
  const connectedAudioIndex = videoSession.audioLayers.findIndex(
    (audioLayer) => audioLayer.connectedLayerId === layerId
  );


  if (connectedAudioIndex !== -1) {
    videoSession.audioLayers.splice(connectedAudioIndex, 1);
  }



  let newStartDuration = removedLayer.durationOffset;



  for (let i = layerIndex; i < videoSession.layers.length; i++) {
    const currentLayer = videoSession.layers[i];
    videoSession.layers[i].durationOffset = newStartDuration;
    newStartDuration += currentLayer.duration;
    videoSession.layers[i].frameGenerationPending = true;
    let connectedAudioLayer = videoSession.audioLayers.find(
      (audioLayer) => audioLayer.connectedLayerId === currentLayer._id.toString()
    );
    if (connectedAudioLayer) {
      const layerStartTime = typeof currentLayer.durationOffset === 'number'
        ? currentLayer.durationOffset
        : 0;
      const layerDuration = typeof currentLayer.duration === 'number'
        ? currentLayer.duration
        : 0;

      if (connectedAudioLayer.generationType === 'speech') {
        const audioDuration = typeof connectedAudioLayer.duration === 'number'
          ? connectedAudioLayer.duration
          : 0;
        const durationDiff = layerDuration - audioDuration;
        const audioStartOffset = durationDiff > 0 ? (durationDiff / 2) : 0;
        connectedAudioLayer.startTime = layerStartTime + audioStartOffset;
        connectedAudioLayer.endTime = connectedAudioLayer.startTime + audioDuration;
        connectedAudioLayer.connectedLayerStartTimeOffset = audioStartOffset;
      } else {
        connectedAudioLayer.startTime = layerStartTime;
        connectedAudioLayer.endTime = layerStartTime + layerDuration;
        connectedAudioLayer.duration = layerDuration;
      }
    }
  }


  videoSession.totalDuration = newStartDuration;




  // 7) Mark the session to regenerate frames
  videoSession.frameGenerationPending = true;

  // 8) Save the updated video session
  const updatedVideoSession = await videoSession.save();



  audioLayers = updatedVideoSession.audioLayers || [];
  audioLayers = clampAudioLayersToReflowedTimeline(
    audioLayers,
    videoSession.totalDuration,
    fullLengthMusicAudioLayerIds
  );

  await VideoSession.updateOne({
    _id: sessionId,
  }, {
    $set: {
      audioLayers: audioLayers,
    }
  });

  return {
    videoSession: updatedVideoSession,
  };
}








async function generateVideoForSession(sessionId, isPremium) {

  const session = await VideoSession.findById(sessionId);
  if (isBranchedVideoSession(session)) {
    const renderPlanVersion = Number(session.renderPlanVersion) || 1;
    const branchPaths = getBranchRenderPaths(session);
    if (branchPaths.length === 0) {
      throw new Error(`Branched session ${sessionId} does not contain any render paths.`);
    }

    for (const path of branchPaths) {
      path.videoGenerationStatus = 'PENDING';
      path.videoGenerationPending = true;
      path.videoGenerationError = null;
    }
    session.markModified('branchRenderPaths');
    await session.save();

    await VideoGeneration.deleteMany({
      videoSessionId: sessionId.toString(),
      rowLocked: false,
      renderPathId: { $ne: null },
    });

    for (const path of branchPaths) {
      await VideoGeneration.updateOne(
        {
          videoSessionId: sessionId.toString(),
          renderPathId: path.pathId,
          renderPlanVersion,
        },
        {
          $setOnInsert: {
            videoSessionId: sessionId.toString(),
            renderPathId: path.pathId,
            renderPlanVersion,
            isPremium,
            rowLocked: false,
          },
        },
        { upsert: true },
      );
    }
    return;
  }


  // Delete all video generation requests rowLocked with sessionId
  await VideoGeneration.deleteMany({ videoSessionId: sessionId, rowLocked: false });

  const videoGenerationPayload = {
    videoSessionId: sessionId,
    isPremium,
  }

  const videoGeneration = new VideoGeneration(videoGenerationPayload);
  await videoGeneration.save();
}

async function getTimeout(ms = 1000) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const __testOnly__ = {
  hasLayerStillVisuals,
  hasGeneratedAiVideoOutput,
  applyTranscriptGenerationResultToStatus,
};
