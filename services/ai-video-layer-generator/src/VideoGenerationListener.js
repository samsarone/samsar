import {
  getDBConnectionString,
  isTransientMongoError,
  resetDbConnection,
  withDbRetry,
} from './DBString.js';


import AIVideoLayerGeneration from './schema/AIVideoLayerGeneration.js';
import VideoSession from './schema/VideoSession.js';
import User from './schema/User.js';
import {
  processVideoAsFrames, downloadVideoFromRemote, getVideoDuration,
  downloadVideoFromRemoteBlob,
  processVideoAsFramesAndAudio,
  clipVideoToDuration,
  createThumbnailVideoPreview,
} from './VideoProcessor.js';
import { getAlternateVideoPrompt } from './utils/AIUtils.js';
import {
  createTextToVideoPromptFromStartingLayerPrompt,
  getTransitionListForLayerSceneDescriptions,
} from './utils/OpenAI.js';
import { normalizeInferenceModel } from './utils/GoogleGemini.js';
import axios from 'axios';
import path from 'path';
import fs from 'fs-extra';
import { modifyAnimationsForNextLayer, filterZoomAndSlideAnimations } from './utils/AnimationUtils.js';

import { getCanvasDimensionsForAspectRatio } from './utils/CanvasUtils.js';
import GeneratedAIVideo from './schema/GeneratedAIVideo.js';
import { getPresetAnimationListForDistribution } from './utils/AnimationUtils.js';
import {
  getCurrentEnvironment,
  isStandaloneEdition,
  usesLocalAssetStorage,
} from './utils/Environment.js';

// import { generateLumaAiVideoLayer, pollLumaAiVideoLayer } from './LumaListener.js';
import { generateSdVideoLayer, listenToPendingSDVideoRequest } from './SDListener.js';
import { generateKlingVideoLayer, listenToPendingKlingVideoRequest } from './KlingListener.js';

import { generateHaiperVideoLayer, listenToPendingHaiperVideoRequest } from './HaiperListener.js';
import { generateRunwayNativeVideoLayer, listenToPendingRunwayNativeVideoRequest } from './RunwayNativeListener.js';

import { generateHailuoNativeVideoLayer, listenToPendingHailuoNativeVideoRequest } from './HailuoNativeListener.js';

import { generateHailuoVideoLayer, listenToPendingHailuoVideoRequest } from './HailuoListener.js';

import { generateWanVideoLayer, listenToPendingWanVideoRequests } from './base/WanI2VListener.js';

import { generateSyncLipSyncLayer, listenToPendingSyncLipSyncRequests } from './character/SyncLipSyncListener.js';
import { generateLatentSyncLayer, listenToPendingLatentSyncRequests } from './character/LatentSyncListener.js';

import { generateKlingLipSyncLayer, listenToPendingKlingLipSyncRequests } from './character/KlingLipSyncListener.js';

import { listenToPendingPikaImgToVidRequests, generatePikaImgToVidLayer } from './base/PikaListener.js';

import { generateMagiImgToVidLayer, listenToPendingMagiImgToVidLayer } from './base/MagiListener.js';

import { generateHummingBirdLipSyncLayer, listenToPendingHummingBirdLipSyncRequests } from './character/HummingBirdLipSyncListener.js';


import { generateViduI2VVideoLayer, listenToPendingViduI2VVideoRequests } from './base/ViduI2VListener.js';

import {
  generateSeeDanceImgToVideoLayer,
  listenToPendingSeeDanceImgToVidRequests,
} from './base/SeeDanceListener.js';

import { generateSoundEffectMireloVideo, listenToPendingSoundEffectMireloVideoRequest } from './sound_effect/MireloAIVideoListener.js';

import {
  generateSkyReelsVideoLayer,
  listenToPendingSkyReelsVideoRequests,
} from './base/IReelsListener.js';

import {
  generateVeoImgToVideoLayer,
  listenToPendingVeoImgToVidRequests,

} from './base/VeoI2VListener.js';


import { generateCreatifyLipSyncLayer, listenToPendingCreatifyLipSyncRequests } from './character/CreatifyLipSyncListener.js';
import {
  generateVeoVideoLayer,
  listenToPendingVeoRequests,
} from './base/VeoListener.js';

import { generateVeo3VideoLayer, listenToPendingVeo3Requests } from './base/Veo3Listener.js';
import {
  generateGoogleVeo3VideoLayer,
  listenToPendingGoogleVeo3Requests,
  shouldUseGoogleNativeVeo3,
} from './base/GoogleVeo3NativeListener.js';


import { generateSoundEffectSyncedMMVideo, listenToPendingSoundEffectSyncedMMVideoRequest } from './sound_effect/SoundEffectSyncedMMVideoListener.js';
import { uploadVideoToBucket, uploadFrameLayerImageToCDN, normalizeProviderMediaUrl } from './AWS.js';
import { normalizeSelectedVideoGenerationMediaPayload } from './utils/VideoGenerationMediaPayload.js';

import { generatePixVerseVideoLayer, listenToPendingPixVerseRequests } from './base/PixVerseI2VListener.js';


import { padLayerWithLastFrame, padLipSyncLayerWithLastFrame } from './utils/LayerUtils.js';

import { generateVeo3ImgToVidLayer, listenToPendingVeo3ImgToVidRequests } from './base/Veo3I2VListener.js';
import { generateCosmos3ImgToVidLayer, listenToPendingCosmos3ImgToVidRequests } from './base/Cosmos3I2VListener.js';
import {
  generateVeo3FirstLastFrameVideoLayer,
  listenToPendingVeo3FirstLastFrameVideoRequests,
} from './base/Veo3FirstLastFrameListener.js';
import {
  generateCustomImageToVideoLayer,
  listenToPendingCustomImageToVideoRequests,
} from './base/CustomFalCompatibleListener.js';
import {
  generateSamsarExternalVideoLayer,
  isSamsarExternalVideoRequest,
  listenToPendingSamsarExternalVideoRequest,
  shouldUseSamsarExternalVideoProvider,
} from './base/SamsarExternalVideoListener.js';
import {
  generateGenBlazeVideoLayer,
  isGenBlazeVideoRequest,
  listenToPendingGenBlazeVideoRequest,
  shouldUseGenBlazeVideoProvider,
} from './base/GenBlazeVideoListener.js';
import {
  DOCKER_VIDEO_PROVIDER,
  resolveDockerVideoProvider,
  resolveNextDockerVideoProvider,
} from './consts/DockerProviderPriority.js';
import {
  generateHappyHorseImgToVideoLayer,
  listenToPendingHappyHorseImgToVidRequests,
} from './base/HappyHorseI2VListener.js';
import {
  generateAlibabaHappyHorseImgToVideoLayer,
  isAlibabaHappyHorseGenerationId,
  listenToPendingAlibabaHappyHorseImgToVidRequests,
} from './base/AlibabaHappyHorseI2VListener.js';
import { normalizeFramesPerSecond, resolveFramesPerSecond } from './utils/FpsUtils.js';
import {
  isStaleSoundEffectGenerationForLayer as isStaleSoundEffectGenerationForLayerWithModels,
} from './utils/SoundEffectGenerationState.js';
import { recordProviderUsageLog } from './utils/ProviderUsageAudit.js';
import {
  buildDeterministicRetryVideoPrompt,
  getLayerActiveImageSources,
  getRetryStartImageDescription,
  prepareRankedFallbackImage,
  selectRankedFallbackImage,
} from './utils/AIVideoRetryCandidates.js';
import { shouldCarryGeneratedLastFrameToNextLayer } from './utils/NextLayerFrameCarry.js';
import {
  createExpressLipSyncPrompt,
  resolveExpressLipSyncPromptContext,
} from './utils/ExpressLipSyncPrompt.js';

const LIPSYNC_MODELS = ['SYNCLIPSYNC', 'LATENTSYNC', 'KLINGLIPSYNC', 'HUMMINGBIRDLIPSYNC', 'CREATIFYLIPSYNC'];
const MAX_LIPSYNC_WAIT_MS = 5 * 60 * 1000; // fail when base never becomes ready
const MAX_LIPSYNC_PROVIDER_PENDING_MS = 10 * 60 * 1000; // fail stale provider polls and continue express flow



const SOUND_EFFECT_MODELS = [
  'MMAUDIOV2',
  'MIRELOAI',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'SEEDANCEI2V',
  'SEEDANCE2.0I2V',
];

const MAX_BASE_GENERATION_ATTEMPTS = 3;
const MAX_CONCURRENT_AI_VIDEO_REQUESTS = 5;
const TRANSIENT_PROVIDER_ERROR_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function getMaxConcurrentGmiCloudVideoRequests(env = process.env) {
  return Math.max(
    1,
    Number(env.AI_VIDEO_MAX_CONCURRENT_GMICLOUD_REQUESTS) || 1,
  );
}

export function isStaleSoundEffectGenerationForLayer({
  model,
  isAudioVideoGeneration = false,
  currentLayer = {},
} = {}) {
  return isStaleSoundEffectGenerationForLayerWithModels({
    model,
    isAudioVideoGeneration,
    currentLayer,
    soundEffectModels: SOUND_EFFECT_MODELS,
  });
}
const TRANSIENT_PROVIDER_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'SAMSAR_MEDIA_TUNNEL_UNREACHABLE',
]);
const MIN_PROVIDER_TRANSIENT_BACKOFF_MS = 10 * 1000;
const MAX_PROVIDER_TRANSIENT_BACKOFF_MS = 60 * 1000;
const MAX_PROVIDER_TRANSIENT_ERRORS = Math.max(
  1,
  Number(process.env.AI_VIDEO_MAX_PROVIDER_TRANSIENT_ERRORS) || 6
);
const MAX_EXPLICIT_I2V_SUBMISSION_REJECTIONS = Math.max(
  1,
  Number(process.env.AI_VIDEO_MAX_EXPLICIT_I2V_SUBMISSION_REJECTIONS) || 3
);
const MAX_BASE_PROVIDER_PENDING_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.AI_VIDEO_MAX_BASE_PROVIDER_PENDING_MS) || 30 * 60 * 1000
);
const RUNWAY_PENDING_POLL_INTERVAL_MS = 15 * 1000;
const ALIBABA_HAPPY_HORSE_PENDING_POLL_INTERVAL_MS = 15 * 1000;
const SAMSAR_EXTERNAL_PENDING_POLL_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.SAMSAR_EXTERNAL_VIDEO_PENDING_POLL_INTERVAL_MS) || 3 * 1000
);
const GENBLAZE_PENDING_POLL_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.SAMSAR_GENBLAZE_VIDEO_PENDING_POLL_INTERVAL_MS) || 3 * 1000
);
const BASE_GENERATION_FAILURE_RETRY_BACKOFF_MS = Math.max(
  1000,
  Number(process.env.AI_VIDEO_EXPLICIT_FAILURE_RETRY_BACKOFF_MS) || 10 * 1000
);
const PROVIDER_POLL_JITTER_MS = 5 * 1000;
const MIN_DB_TRANSIENT_BACKOFF_MS = Math.max(
  1000,
  Number(process.env.AI_VIDEO_MIN_DB_TRANSIENT_BACKOFF_MS) || 5000
);
const MAX_DB_TRANSIENT_BACKOFF_MS = Math.max(
  MIN_DB_TRANSIENT_BACKOFF_MS,
  Number(process.env.AI_VIDEO_MAX_DB_TRANSIENT_BACKOFF_MS) || 60 * 1000
);
function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const TEXT_TO_VIDEO_MODELS = new Set([
  'VEO',
  'VEO3.1',
  'VEO3.1FAST',
]);

function resolveAIVideoRequestType(model, payload = {}) {
  const normalizedModel = normalizeString(model);
  const generationType = normalizeString(payload.generationType || payload.layerAiVideoType).toLowerCase();

  if (LIPSYNC_MODELS.includes(normalizedModel) || generationType === 'lip_sync') {
    return 'lip_sync';
  }
  if (
    generationType === 'sound_effect' ||
    normalizedModel === 'MMAUDIOV2' ||
    normalizedModel === 'MIRELOAI'
  ) {
    return 'text_to_sound_effect';
  }
  if (TEXT_TO_VIDEO_MODELS.has(normalizedModel) || (!payload.startImage && !payload.imageUrl && !payload.imageURL)) {
    return 'text_to_video';
  }
  return 'image_to_video';
}

function resolveAIVideoProvider(model, payload = {}) {
  const normalizedModel = normalizeString(model);
  if (shouldUseSamsarExternalVideoProvider(payload)) {
    return 'samsar';
  }
  if (shouldUseAlibabaNativeHappyHorse(payload)) {
    return DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD;
  }
  const dockerProvider = resolveDockerVideoProviderForPayload(normalizedModel, payload);
  if (dockerProvider) {
    return dockerProvider;
  }
  if (normalizedModel === 'CUSTOM_IMAGE_TO_VIDEO') {
    return '';
  }
  if (normalizedModel === 'RUNWAYML') {
    return 'runway';
  }
  if (
    ['VEO3.1', 'VEO3.1FAST', 'VEO3.1I2V', 'VEO3.1I2VFAST'].includes(normalizedModel) &&
    shouldUseGoogleNativeVeo3(normalizedModel, payload)
  ) {
    return 'googleCloud';
  }
  return 'fal';
}

function resolveDockerVideoProviderForPayload(model, payload = {}) {
  const selectedProvider = normalizeString(payload?.dockerVideoProvider);
  if (
    isStandaloneEdition() &&
    Object.values(DOCKER_VIDEO_PROVIDER).includes(selectedProvider)
  ) {
    return selectedProvider;
  }
  return resolveDockerVideoProvider(model, {
    generationType: payload.generationType || payload.layerAiVideoType,
    preferredProvider: payload.dockerVideoProviderOverride,
  });
}

function getDockerAdapterRoutingModel(payload = {}) {
  const model = normalizeString(payload?.model);
  if (model === 'SAMSAR_EXTERNAL_VIDEO') {
    return normalizeString(payload?.originalVideoModel) || model;
  }
  return model;
}

function restoreStandaloneAdapterRoutableModel(payload = {}) {
  if (
    !isStandaloneEdition() ||
    normalizeString(payload?.model) !== 'SAMSAR_EXTERNAL_VIDEO' ||
    normalizeString(payload?.status || 'INIT').toUpperCase() !== 'INIT' ||
    normalizeString(payload?.generationId)
  ) {
    return payload;
  }

  const originalVideoModel = normalizeString(payload?.originalVideoModel);
  if (!originalVideoModel) {
    return payload;
  }
  const selectedProvider = resolveDockerVideoProviderForPayload(originalVideoModel, payload);
  if (!selectedProvider || selectedProvider === DOCKER_VIDEO_PROVIDER.SAMSAR) {
    return payload;
  }

  const source = typeof payload?.toObject === 'function' ? payload.toObject() : payload;
  return {
    ...(source || {}),
    model: originalVideoModel,
    samsarExternalProvider: false,
    externalProvider: '',
  };
}

function getDockerAdapterAttemptedProviders(payload = {}) {
  return [...new Set(
    [
      ...(Array.isArray(payload?.dockerAdapterAttemptedProviders)
        ? payload.dockerAdapterAttemptedProviders
        : []),
    ]
      .map((provider) => normalizeString(provider))
      .filter((provider) => Object.values(DOCKER_VIDEO_PROVIDER).includes(provider)),
  )];
}

export function isGmiCloudVideoRequest(request = {}) {
  const model = getDockerAdapterRoutingModel(request);
  if (!['image_to_video', 'text_to_video'].includes(resolveAIVideoRequestType(model, request))) {
    return false;
  }

  const persistedProvider = normalizeString(
    request.dockerVideoProviderOverride || request.dockerVideoProvider || request.externalProvider,
  );
  if (
    persistedProvider === DOCKER_VIDEO_PROVIDER.GMICLOUD ||
    normalizeString(request.generationId).startsWith('genblaze-video:')
  ) {
    return true;
  }

  // INIT rows from the express listener may still carry the hosted adapter
  // wrapper model. Resolve the original model directly through Docker routing
  // so the provider cap applies before the first GMICloud submission.
  return resolveDockerVideoProviderForPayload(model, request) === DOCKER_VIDEO_PROVIDER.GMICLOUD;
}

function getAiVideoQueueSessionKey(request = {}) {
  return normalizeString(
    request.sessionId || request.videoSessionId || request.expressVideoSessionId,
  );
}

function isAiVideoDispatchReady(request = {}, nowMs = Date.now()) {
  const nextAttemptAt = request.nextAttemptAfter || request.nextAttemptAt;
  if (!nextAttemptAt) return true;
  const nextAttemptMs = new Date(nextAttemptAt).getTime();
  return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= nowMs;
}

export function selectAiVideoDispatchRequests({
  activeRequests = [],
  initRequests = [],
  maxConcurrentRequests = MAX_CONCURRENT_AI_VIDEO_REQUESTS,
  maxGmiCloudVideoRequests = getMaxConcurrentGmiCloudVideoRequests(),
  nowMs = Date.now(),
} = {}) {
  const remainingCapacity = Math.max(0, maxConcurrentRequests - activeRequests.length);
  if (remainingCapacity === 0) {
    return [];
  }

  let remainingGmiCloudCapacity = Math.max(
    0,
    maxGmiCloudVideoRequests - activeRequests.filter(
      isGmiCloudVideoRequest,
    ).length,
  );
  const selectedRequests = [];
  const firstGmiCloudRequestBySession = new Map();

  for (const request of initRequests) {
    if (!isGmiCloudVideoRequest(request)) continue;
    const sessionKey = getAiVideoQueueSessionKey(request);
    if (sessionKey && !firstGmiCloudRequestBySession.has(sessionKey)) {
      firstGmiCloudRequestBySession.set(sessionKey, request);
    }
  }

  for (const request of initRequests) {
    if (selectedRequests.length >= remainingCapacity) {
      break;
    }
    if (isGmiCloudVideoRequest(request)) {
      const sessionKey = getAiVideoQueueSessionKey(request);
      if (
        sessionKey &&
        firstGmiCloudRequestBySession.get(sessionKey) !== request
      ) {
        continue;
      }
      if (remainingGmiCloudCapacity === 0) {
        continue;
      }
      if (!isAiVideoDispatchReady(request, nowMs)) {
        continue;
      }
      remainingGmiCloudCapacity -= 1;
    } else if (!isAiVideoDispatchReady(request, nowMs)) {
      continue;
    }
    selectedRequests.push(request);
  }

  return selectedRequests;
}

export function buildDockerVideoAdapterRetryPlan(
  request = {},
  { definitiveFailure = request?.providerFailureDefinitive === true } = {},
) {
  const requestType = resolveAIVideoRequestType(
    getDockerAdapterRoutingModel(request),
    request,
  );
  if (
    !isStandaloneEdition() ||
    definitiveFailure !== true ||
    request?.submissionOutcomeUnknown === true ||
    !['image_to_video', 'text_to_video'].includes(requestType)
  ) {
    return null;
  }

  const model = getDockerAdapterRoutingModel(request);
  const currentProvider = normalizeString(request?.dockerVideoProvider) ||
    resolveAIVideoProvider(model, request);
  if (!Object.values(DOCKER_VIDEO_PROVIDER).includes(currentProvider)) {
    return null;
  }

  const attemptedProviders = getDockerAdapterAttemptedProviders(request);
  if (!attemptedProviders.includes(currentProvider)) {
    attemptedProviders.push(currentProvider);
  }
  const nextProvider = resolveNextDockerVideoProvider(model, currentProvider, {
    generationType: request.generationType || request.layerAiVideoType,
    attemptedProviders,
  });
  if (!nextProvider || nextProvider === currentProvider) {
    return null;
  }

  return {
    model,
    currentProvider,
    nextProvider,
    attemptedProviders,
  };
}

async function requeueNextDockerVideoAdapterAfterDefinitiveFailure(
  payload = {},
  generationDocument = {},
) {
  const payloadValue = typeof payload?.toObject === 'function' ? payload.toObject() : payload;
  const request = {
    ...(generationDocument || {}),
    ...(payloadValue || {}),
    providerFailureDefinitive:
      generationDocument?.providerFailureDefinitive === true ||
      payloadValue?.providerFailureDefinitive === true,
    submissionOutcomeUnknown:
      generationDocument?.submissionOutcomeUnknown === true ||
      payloadValue?.submissionOutcomeUnknown === true,
  };
  const plan = buildDockerVideoAdapterRetryPlan(request);
  if (!plan || !request?._id) {
    return false;
  }

  const failoverCount = Math.max(0, Number(request.dockerAdapterFailoverCount) || 0);
  const attemptedAt = new Date();
  await AIVideoLayerGeneration.findByIdAndUpdate(request._id, {
    $set: {
      model: plan.model,
      status: 'INIT',
      aiVideoGenerationStatus: 'INIT',
      generationId: null,
      rowLocked: false,
      transientProviderErrorCount: 0,
      dockerVideoProviderOverride: plan.nextProvider,
      dockerAdapterAttemptedProviders: plan.attemptedProviders,
      dockerAdapterFailoverAttempted: true,
      dockerAdapterFailoverAttemptedAt: attemptedAt,
      dockerAdapterFailoverFromProvider: plan.currentProvider,
      dockerAdapterFailoverTriggerStatus:
        Number(request.lastTransientProviderErrorStatus) ||
        Number(request.dockerAdapterFailoverTriggerStatus) ||
        null,
      dockerAdapterFailoverSucceeded: false,
      providerFailureDefinitive: false,
      submissionOutcomeUnknown: false,
      nextAttemptAfter: new Date(
        Date.now() + getExplicitFailureRetryBackoffMs(failoverCount),
      ),
      expireAt: new Date(),
    },
    $inc: {
      dockerAdapterFailoverCount: 1,
    },
    $push: {
      dockerAdapterFailoverHistory: {
        fromProvider: plan.currentProvider,
        toProvider: plan.nextProvider,
        attemptedAt,
        failureMessage: getProviderFailureMessage(request),
      },
    },
    $unset: {
      dockerVideoProvider: '',
      requestSubmitAt: '',
      lastProviderPendingPollAt: '',
      lastTransientProviderErrorAt: '',
      lastTransientProviderErrorStatus: '',
      lastTransientProviderErrorMessage: '',
      transientProviderErrorPhase: '',
      samsarExternalProvider: '',
      externalProvider: '',
      googleVeoNativeFallbackUsed: '',
      dockerAdapterFailoverSucceededAt: '',
      dockerAdapterPrimaryPromoted: '',
    },
  });

  console.warn('[ai_video_adapter_failover] retrying definitive provider failure', {
    requestId: request._id?.toString?.() || request._id,
    model: plan.model,
    fromProvider: plan.currentProvider,
    toProvider: plan.nextProvider,
    attemptedProviders: plan.attemptedProviders,
  });
  return true;
}

export function shouldUseAlibabaNativeHappyHorse(payload = {}) {
  if (normalizeString(payload?.model).toUpperCase() !== 'HAPPYHORSEI2V') {
    return false;
  }

  if (isAlibabaHappyHorseGenerationId(payload?.generationId)) {
    return true;
  }

  // Existing unprefixed Happy Horse ids belong to the unchanged FAL adapter.
  if (normalizeString(payload?.generationId)) {
    return false;
  }

  // The hosted service always uses the FAL adapter for new Happy Horse jobs.
  // Standalone deployments may opt into native Alibaba with their validated BYOK
  // configuration. Provider-specific ids above stay sticky so in-flight jobs
  // continue polling the adapter that created them.
  if (!isStandaloneEdition()) {
    return false;
  }

  const dockerProvider = resolveDockerVideoProviderForPayload(payload.model, payload);
  return dockerProvider === DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD;
}

function shouldUseGoogleVeo3ForPayload(model, payload = {}) {
  const dockerProvider = resolveDockerVideoProviderForPayload(model, payload);
  if (dockerProvider) {
    return dockerProvider === DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD;
  }
  return shouldUseGoogleNativeVeo3(model, payload);
}

async function recordAIVideoProviderUsage(payload = {}, generationId) {
  if (shouldUseSamsarExternalVideoProvider(payload) || payload.model === 'CUSTOM_IMAGE_TO_VIDEO') {
    return;
  }
  const requestType = resolveAIVideoRequestType(payload.model, payload);
  await recordProviderUsageLog({
    payload,
    requestType,
    callType: requestType,
    provider: resolveAIVideoProvider(payload.model, { ...payload, generationId }),
    model: payload.model,
    providerRequestId: generationId,
    source: 'ai_video_layer_generator',
    service: 'samsar_ai_video_layer_generator',
    status: 'requested',
    metadata: {
      aspectRatio: payload.aspectRatio,
      duration: payload.duration,
      generationType: payload.generationType,
      isAudioVideoGeneration: payload.isAudioVideoGeneration,
      layerAiVideoType: payload.layerAiVideoType,
      originalVideoModel: payload.originalVideoModel,
    },
  });
}

export function resolveConnectedAudioLayerDuration({
  generationType,
  generatedAudioDuration,
  layerDuration,
} = {}) {
  const fallbackLayerDuration = Number.isFinite(Number(layerDuration)) && Number(layerDuration) > 0
    ? Number(layerDuration)
    : 0;
  const resolvedGeneratedDuration = Number.isFinite(Number(generatedAudioDuration)) && Number(generatedAudioDuration) > 0
    ? Number(generatedAudioDuration)
    : fallbackLayerDuration;

  if ((generationType === 'sound_effect' || generationType === 'speech' || generationType === 'lip_sync') && fallbackLayerDuration > 0) {
    return Math.min(resolvedGeneratedDuration, fallbackLayerDuration);
  }

  return resolvedGeneratedDuration;
}

function getFrameSafeDurationSecondsFromFrameCount(frameCount, framesPerSecond) {
  const safeFrameCount = Number(frameCount);
  const safeFramesPerSecond = Number(framesPerSecond);
  if (!Number.isFinite(safeFrameCount) || safeFrameCount <= 0 || !Number.isFinite(safeFramesPerSecond) || safeFramesPerSecond <= 0) {
    return null;
  }
  return Math.ceil((safeFrameCount / safeFramesPerSecond) * 1e6) / 1e6;
}

export function resolveCompletedLayerDuration({
  currentLayerDuration,
  generatedLayerDuration,
  generatedFrameCount,
  generatedFrameDuration,
  framesPerSecond,
  model,
  isAudioVideoGeneration,
} = {}) {
  const currentDuration = Number(currentLayerDuration);
  const generatedDuration = Number(generatedLayerDuration);
  const generatedDurationFromFrames = getFrameSafeDurationSecondsFromFrameCount(
    generatedFrameCount,
    framesPerSecond
  );
  const frameSafeGeneratedDuration = Number.isFinite(Number(generatedFrameDuration)) && Number(generatedFrameDuration) > 0
    ? Number(generatedFrameDuration)
    : generatedDurationFromFrames;

  if (
    isAudioVideoGeneration &&
    LIPSYNC_MODELS.includes(model) &&
    Number.isFinite(currentDuration) &&
    currentDuration > 0
  ) {
    const shrinkCandidate = Number.isFinite(frameSafeGeneratedDuration) && frameSafeGeneratedDuration > 0
      ? frameSafeGeneratedDuration
      : generatedDuration;
    const safeFramesPerSecond = Number(framesPerSecond);
    const shrinkThreshold = Number.isFinite(safeFramesPerSecond) && safeFramesPerSecond > 0
      ? 0.5 / safeFramesPerSecond
      : 0.02;

    if (
      Number.isFinite(shrinkCandidate) &&
      shrinkCandidate > 0 &&
      shrinkCandidate < currentDuration - shrinkThreshold
    ) {
      return shrinkCandidate;
    }

    return currentDuration;
  }

  return Number.isFinite(generatedDuration) && generatedDuration > 0
    ? generatedDuration
    : currentLayerDuration;
}

export function buildBaseAiVideoCompletionUpdate({
  localVideoLink,
  remoteAIVideoLink,
  startFrameGenerationPath,
  lastFrameGenerationPath,
  thumbnailVideoPath,
} = {}) {
  return {
    aiVideoGenerationPending: false,
    hasAiVideoLayer: true,
    aiVideoLayer: localVideoLink,
    aiVideoRemoteLink: remoteAIVideoLink,
    aiVideoThumbnailPath: startFrameGenerationPath,
    aiVideoEndThumbnailPath: lastFrameGenerationPath,
    aiVideoThumbnailVideo: thumbnailVideoPath,
    aiVideoGenerationStatus: 'COMPLETED',
  };
}

function roundAudioSeconds(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(numericValue * 1000) / 1000;
}

function getDocumentId(value = {}) {
  return value?._id?.toString?.() || value?._id || null;
}

function recalculateLayerOffsetsAndConnectedAudio(layers = [], audioLayers = []) {
  let durationOffset = 0;
  const layerIndexById = new Map();

  for (let i = 0; i < layers.length; i++) {
    const layerId = getDocumentId(layers[i]);
    if (layerId) {
      layerIndexById.set(layerId.toString(), i);
    }
  }

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const layerId = getDocumentId(layer);
    const previousLayerStart = Number(layer?.durationOffset) || 0;
    const previousLayerDuration = Math.max(0, Number(layer?.duration) || 0);
    const nextLayerStart = durationOffset;

    layer.durationOffset = nextLayerStart;

    for (let j = 0; j < audioLayers.length; j++) {
      const audioLayer = audioLayers[j];
      const connectedLayerId = audioLayer?.connectedLayerId?.toString?.() || audioLayer?.connectedLayerId || null;
      let connectedLayerIndex = connectedLayerId ? layerIndexById.get(connectedLayerId.toString()) : null;
      if (connectedLayerIndex == null && Number.isInteger(Number(audioLayer?.connectedLayerIndex))) {
        connectedLayerIndex = Number(audioLayer.connectedLayerIndex);
      }
      if (connectedLayerIndex !== i) {
        continue;
      }

      if (layerId) {
        audioLayer.connectedLayerId = layerId.toString();
      }
      audioLayer.connectedLayerIndex = i;

      const audioStart = Number(audioLayer?.startTime);
      const storedOffset = Number(audioLayer?.connectedLayerStartTimeOffset);
      let relativeStart = 0;
      if (
        Number.isFinite(audioStart) &&
        audioStart >= previousLayerStart - 0.001 &&
        audioStart <= previousLayerStart + previousLayerDuration + 0.001
      ) {
        relativeStart = audioStart - previousLayerStart;
      } else if (Number.isFinite(storedOffset) && storedOffset >= 0) {
        relativeStart = storedOffset <= previousLayerDuration + 0.001 ? storedOffset : 0;
      }

      relativeStart = Math.min(Math.max(0, relativeStart), previousLayerDuration);
      const audioDuration = Math.max(0, Number(audioLayer?.duration) || 0);
      const nextDuration = Math.min(audioDuration, Math.max(0, previousLayerDuration - relativeStart));

      audioLayer.connectedLayerStartTimeOffset = roundAudioSeconds(relativeStart);
      audioLayer.startTime = roundAudioSeconds(nextLayerStart + relativeStart);
      audioLayer.duration = roundAudioSeconds(nextDuration);
      audioLayer.endTime = roundAudioSeconds(audioLayer.startTime + audioLayer.duration);
    }

    durationOffset += previousLayerDuration;
  }

  return durationOffset;
}

export function selectFilterPassForBaseGenerationRetry(
  filterPasses = [],
  retryCount = 0,
  options = {},
) {
  return selectRankedFallbackImage(filterPasses, retryCount, options);
}

export function shouldRetryBaseGeneration({
  generation = {},
  payload = {},
  videoSession = {},
  model,
} = {}) {
  if (generation.retryOnFail === true || payload.retryOnFail === true) {
    return true;
  }

  const normalizedModel = firstNonEmptyString(model, generation.model, payload.model).toUpperCase();
  return Boolean(
    (videoSession.isExpressGeneration || videoSession.isMovieGen) &&
    ['COSMOS3SUPERI2V', 'HAPPYHORSEI2V'].includes(normalizedModel)
  );
}

export function buildBaseGenerationFailureMessage({
  tries = 0,
  providerFailureMessage = '',
  retryPreparationFailureMessage = '',
} = {}) {
  const attemptCount = Math.max(1, Number(tries || 0) + 1);
  return [
    `AI video generation failed after ${attemptCount} attempt${attemptCount === 1 ? '' : 's'}.`,
    firstNonEmptyString(providerFailureMessage)
      ? `Provider error: ${firstNonEmptyString(providerFailureMessage)}`
      : '',
    firstNonEmptyString(retryPreparationFailureMessage),
  ].filter(Boolean).join(' ');
}

export function hasRemainingBaseGenerationAttempts(completedRetryCount = 0) {
  const completedAttemptCount = Math.max(1, Number(completedRetryCount || 0) + 1);
  return completedAttemptCount < MAX_BASE_GENERATION_ATTEMPTS;
}

export function getExplicitFailureRetryBackoffMs(completedRetryCount = 0) {
  return Math.min(
    60 * 1000,
    BASE_GENERATION_FAILURE_RETRY_BACKOFF_MS *
      (2 ** Math.min(Math.max(0, Number(completedRetryCount) || 0), 3)),
  );
}

function getFilterPassGenerationAssetPath(filterPassSrc) {
  const rawSrc = typeof filterPassSrc === 'string' ? filterPassSrc.trim() : '';
  if (!rawSrc) {
    return null;
  }

  const normalizedSrc = rawSrc.replace(/^\/+/, '');
  const isAssetsV2Path = normalizedSrc.startsWith('assets_v2/');
  const withoutAssetsPrefix = normalizedSrc
    .replace(/^assets_v2\//, '')
    .replace(/^assets\//, '');
  const generationsMarker = 'generations/';
  const markerIndex = withoutAssetsPrefix.indexOf(generationsMarker);
  const relativeGenerationSrc = markerIndex >= 0
    ? withoutAssetsPrefix.slice(markerIndex + generationsMarker.length)
    : withoutAssetsPrefix;

  const configuredAssetsRoot = isAssetsV2Path
    ? process.env.SAMSAR_ASSETS_V2_ROOT
    : process.env.SAMSAR_ASSETS_ROOT;
  if (configuredAssetsRoot) {
    return path.join(configuredAssetsRoot, 'generations', relativeGenerationSrc);
  }

  const preferredPath = path.join(
    process.cwd(),
    '../samsar_processor',
    isAssetsV2Path ? 'assets_v2' : 'assets',
    'generations',
    relativeGenerationSrc
  );
  if (fs.existsSync(preferredPath) || !isAssetsV2Path) {
    return preferredPath;
  }

  return path.join(
    process.cwd(),
    '../samsar_processor',
    'assets',
    'generations',
    relativeGenerationSrc
  );
}

function getLayerDescriptionForRetryPrompt(currentLayer, selectedFilterPass) {
  return getRetryStartImageDescription(selectedFilterPass, currentLayer);
}

export function getRetryPromptSeedAction({
  promptSeedContext = {},
  currentLayer = {},
  fallbackPrompt = '',
} = {}) {
  return promptSeedContext.promptStrategy === 'infinitezoom'
    ? firstNonEmptyString(
      promptSeedContext.resolvedPrompt,
      fallbackPrompt,
      promptSeedContext.sceneAction,
      currentLayer?.prompt,
    )
    : firstNonEmptyString(
      promptSeedContext.sceneAction,
      currentLayer?.prompt,
      fallbackPrompt,
    );
}

async function regenerateBaseGenerationPromptForRetry({
  videoSession,
  request,
  fallbackRequest,
  currentLayer,
  currentLayerIndex,
  selectedFilterPass,
  fallbackPrompt,
}) {
  const promptSeedContext = request?.promptSeedContext && typeof request.promptSeedContext === 'object'
    ? request.promptSeedContext
    : fallbackRequest?.promptSeedContext && typeof fallbackRequest.promptSeedContext === 'object'
      ? fallbackRequest.promptSeedContext
      : {};
  const startingPrompt = getRetryPromptSeedAction({
    promptSeedContext,
    currentLayer,
    fallbackPrompt,
  });
  const startingImageDescription = getLayerDescriptionForRetryPrompt(currentLayer, selectedFilterPass);

  if (!startingPrompt && !startingImageDescription) {
    return null;
  }

  const layers = Array.isArray(videoSession?.layers) ? videoSession.layers : [];
  const savedSceneDescriptions = Array.isArray(promptSeedContext.sceneDescriptions)
    ? promptSeedContext.sceneDescriptions
    : [];
  const hasSelectedImageContext = selectedFilterPass && typeof selectedFilterPass === 'object';
  const promptList = layers.map((layer, index) => {
    if (index === currentLayerIndex && hasSelectedImageContext) {
      return startingImageDescription;
    }
    return savedSceneDescriptions[index] || getLayerDescriptionForRetryPrompt(layer, null);
  });
  const {
    model: userInferenceModel,
    authorization: selectedInferenceModelAuthorization,
  } = await getInferenceSettingsForSession(videoSession, request, fallbackRequest);
  const baseInferenceAuditContext = {
    userId: videoSession?.userId,
    sessionId: videoSession?._id?.toString?.() || videoSession?._id,
    layerId: currentLayer?._id?.toString?.() || currentLayer?._id,
    localRequestId: `${videoSession?._id?.toString?.() || videoSession?._id || 'session'}:${currentLayer?._id?.toString?.() || currentLayer?._id || 'layer'}:base_retry_prompt`,
    jobType: 'Express video',
    isExpressGeneration: videoSession?.isExpressGeneration || videoSession?.isMovieGen,
    requestType: 'narrative_inference',
    source: 'ai_video_retry_inference',
    selectedInferenceModelAuthorization,
  };

  let cameraTransitionLayer = null;
  try {
    const cameraTransitionListString = await getTransitionListForLayerSceneDescriptions(promptList, userInferenceModel, {
      ...baseInferenceAuditContext,
      sourceTask: 'camera_transition_prompt',
    });
    const cameraTransitionList = typeof cameraTransitionListString === 'string'
      ? cameraTransitionListString.split('\n').map((item) => item.trim()).filter(Boolean)
      : [];
    cameraTransitionLayer = cameraTransitionList[currentLayerIndex] || null;
  } catch (err) {
    console.error('Failed to regenerate camera transition for AI video retry; continuing without it', {
      sessionId: videoSession?._id?.toString?.(),
      layerId: currentLayer?._id?.toString?.(),
      error: err?.message || err,
    });
  }

  const indexData = promptSeedContext.indexData && typeof promptSeedContext.indexData === 'object'
    ? {
      isStartScene: promptSeedContext.indexData.isStartScene === true,
      isEndScene: promptSeedContext.indexData.isEndScene === true,
    }
    : {
      isStartScene: currentLayerIndex === 0,
      isEndScene: currentLayerIndex === layers.length - 1,
    };
  const sceneType = typeof currentLayer?.layerAiVideoType === 'string'
    ? currentLayer.layerAiVideoType
    : '';
  const isSpeakerTransition = typeof promptSeedContext.isSpeakerTransition === 'boolean'
    ? promptSeedContext.isSpeakerTransition
    : sceneType === 'character';
  const videoTone = firstNonEmptyString(promptSeedContext.videoTone, videoSession?.videoTone) || 'grounded';
  const useShortFormPrompt = promptSeedContext.useShortFormPrompt === true;

  const regeneratedPrompt = await createTextToVideoPromptFromStartingLayerPrompt(
    startingPrompt,
    startingImageDescription,
    userInferenceModel,
    useShortFormPrompt,
    isSpeakerTransition,
    indexData,
    videoTone,
    cameraTransitionLayer,
    {
      ...baseInferenceAuditContext,
      sourceTask: 'text_to_video_prompt',
    }
  );

  return regeneratedPrompt || buildDeterministicRetryVideoPrompt({
    sceneAction: startingPrompt,
    startImageDescription: startingImageDescription,
    cameraTransition: cameraTransitionLayer || promptSeedContext.cameraTransition,
  });
}

function firstNonEmptyString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function getRequestInferenceModel(request = {}) {
  return firstNonEmptyString(
    request.userInferenceModel,
    request.selectedInferenceModel,
    request.inferenceModel,
    request.inference_model,
    request.expressGenerationInferenceModel,
  );
}

function normalizeInferenceAuthorization(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
  if (normalized === 'native') {
    return 'native';
  }
  if (['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(normalized)) {
    return 'deployed';
  }
  return '';
}

function getRequestInferenceAuthorization(request = {}) {
  return firstNonEmptyString(
    request.selectedInferenceModelAuthorization,
    request.inferenceModelAuthorization,
    request.inference_model_authorization,
    request.expressGenerationInferenceModelAuthorization,
  );
}

export async function getInferenceSettingsForSession(
  videoSession = {},
  request = {},
  fallbackRequest = {},
) {
  const requestedModel = getRequestInferenceModel(request) ||
    getRequestInferenceModel(fallbackRequest);
  const sessionModel = firstNonEmptyString(
    videoSession?.expressGenerationInferenceModel,
    videoSession?.inferenceModel,
    videoSession?.inference_model,
  );
  const requestedAuthorization = normalizeInferenceAuthorization(
    getRequestInferenceAuthorization(request) ||
    getRequestInferenceAuthorization(fallbackRequest),
  );
  const sessionAuthorization = normalizeInferenceAuthorization(firstNonEmptyString(
    videoSession?.expressGenerationInferenceModelAuthorization,
    videoSession?.inferenceModelAuthorization,
    videoSession?.inference_model_authorization,
    videoSession?.selectedInferenceModelAuthorization,
  ));

  let userData = null;
  if ((!requestedModel && !sessionModel) || (!requestedAuthorization && !sessionAuthorization)) {
    const userId = videoSession?.userId;
    if (userId) {
      try {
        userData = await User.findById(userId)
          .select('selectedInferenceModel selectedInferenceModelAuthorization')
          .lean();
      } catch {
        userData = null;
      }
    }
  }

  return {
    model: normalizeInferenceModel(
      requestedModel || sessionModel || userData?.selectedInferenceModel,
    ),
    authorization: requestedAuthorization ||
      sessionAuthorization ||
      normalizeInferenceAuthorization(userData?.selectedInferenceModelAuthorization),
  };
}

export async function getInferenceModelForSession(videoSession, request = {}, fallbackRequest = {}) {
  const settings = await getInferenceSettingsForSession(videoSession, request, fallbackRequest);
  return settings.model;
}

async function prepareExpressLipSyncPrompt(payload = {}) {
  if (payload?.lipSyncPromptGenerated === true && normalizeString(payload?.prompt)) {
    return payload;
  }

  const sessionData = await VideoSession.findById(payload.sessionId);
  if (!sessionData) {
    throw new Error(`VideoSession with ID ${payload.sessionId} not found while building lip sync prompt.`);
  }

  const context = resolveExpressLipSyncPromptContext(sessionData, payload);
  if (!context) {
    throw new Error(
      `Layer ${payload.layerId || 'unknown'} was not found while building the Express lip sync prompt.`,
    );
  }

  const inferenceSettings = await getInferenceSettingsForSession(sessionData, payload);
  const promptResult = await createExpressLipSyncPrompt({
    startingFrameDescription: context.startingFrameDescription,
    sceneDescription: context.sceneDescription,
    speechItem: {
      characterName: context.speakerName,
      characterDescription: context.speakerDescription,
      text: context.speechText,
    },
    userInferenceModel: inferenceSettings.model,
    auditContext: {
      userId: payload.userId || sessionData.userId,
      sessionId: payload.sessionId,
      layerId: payload.layerId,
      audioLayerId: context.audioLayerId,
      localRequestId: `${payload.sessionId}:${payload.layerId}:lip_sync_prompt`,
      source: 'express_lip_sync_inference',
      selectedInferenceModelAuthorization: inferenceSettings.authorization,
    },
  });

  const generatedAt = new Date();
  payload.prompt = promptResult.prompt;
  payload.lipSyncPromptGenerated = true;
  payload.lipSyncPromptSource = promptResult.source;
  payload.lipSyncPromptGeneratedAt = generatedAt;

  await AIVideoLayerGeneration.findByIdAndUpdate(payload._id, {
    $set: {
      prompt: promptResult.prompt,
      lipSyncPromptGenerated: true,
      lipSyncPromptSource: promptResult.source,
      lipSyncPromptGeneratedAt: generatedAt,
      lipSyncPromptSpeaker: context.speakerName || null,
      lipSyncPromptAudioLayerId: context.audioLayerId || null,
    },
  });

  console.log('[lip_sync][prompt_generation] prepared speaker-targeted Express lip sync prompt', {
    sessionId: payload.sessionId,
    layerId: payload.layerId,
    audioLayerId: context.audioLayerId || null,
    speaker: context.speakerName || null,
    source: promptResult.source,
    lineCount: promptResult.prompt.split('\n').filter(Boolean).length,
  });

  return payload;
}

export function buildBaseGenerationTerminalFailureUpdate(currentLayer = {}, failureMessage) {
  const layerUpdate = {
    "layers.$.aiVideoGenerationPending": false,
    "layers.$.aiVideoGenerationStatus": "FAILED",
    "layers.$.hasAiVideoLayer": false,
    "layers.$.processVideoGenerationFailed": true,
    "layers.$.aiVideoGenerationError": failureMessage,
    "expressGenerationStatus.delete_reflow": "INIT",
    "expressGenerationStatus.timeline_reflowed": "INIT",
    "lastAiVideoLayerGenerationError": failureMessage,
  };

  if (currentLayer?.layerAiVideoType === 'character') {
    layerUpdate["layers.$.lipSyncGenerationPending"] = false;
  }

  return layerUpdate;
}

function getProviderErrorStatus(error) {
  const status = error?.response?.status ?? error?.status;
  const numericStatus = Number(status);
  return Number.isFinite(numericStatus) ? numericStatus : null;
}

export function isTransientProviderError(error) {
  const status = getProviderErrorStatus(error);
  if (status && TRANSIENT_PROVIDER_ERROR_STATUSES.has(status)) {
    return true;
  }
  const code = typeof error?.code === 'string'
    ? error.code
    : typeof error?.cause?.code === 'string'
      ? error.cause.code
      : '';
  return TRANSIENT_PROVIDER_ERROR_CODES.has(code);
}

export function isSafeProviderSubmissionRetry(error) {
  return (
    getProviderErrorStatus(error) === 429 ||
    error?.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE'
  );
}

function getRetryAfterMs(error) {
  const retryAfter = error?.response?.headers?.['retry-after']
    ?? error?.response?.headers?.['Retry-After']
    ?? error?.headers?.['retry-after']
    ?? error?.headers?.['Retry-After'];
  if (!retryAfter) {
    return null;
  }
  const numericSeconds = Number(retryAfter);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1000;
  }
  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) {
    return Math.max(retryAt - Date.now(), 0);
  }
  return null;
}

export function buildTransientProviderErrorUpdate(request = {}, error, phase = 'poll') {
  const isManagedMediaTunnelError = error?.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE';
  const transientErrorCount = Math.max(0, Number(request.transientProviderErrorCount) || 0);
  const mediaTunnelRefreshErrorCount = Math.max(0, Number(request.mediaTunnelRefreshErrorCount) || 0);
  const retryErrorCount = isManagedMediaTunnelError
    ? mediaTunnelRefreshErrorCount
    : transientErrorCount;
  const nextTransientErrorCount = transientErrorCount + (isManagedMediaTunnelError ? 0 : 1);
  const retryAfterMs = getRetryAfterMs(error);
  const exponentialBackoffMs = Math.min(
    MAX_PROVIDER_TRANSIENT_BACKOFF_MS,
    MIN_PROVIDER_TRANSIENT_BACKOFF_MS * (2 ** Math.min(retryErrorCount, 3))
  );
  const baseBackoffMs = Math.max(
    MIN_PROVIDER_TRANSIENT_BACKOFF_MS,
    Math.min(MAX_PROVIDER_TRANSIENT_BACKOFF_MS, retryAfterMs ?? exponentialBackoffMs)
  );
  // A managed Docker tunnel outage happens before provider submission. It must
  // never consume the provider retry budget or terminal-fail lip sync, sound
  // effect, or base-video generation while the controller rotates the URL.
  const shouldFailRequest = !isManagedMediaTunnelError &&
    shouldFailRequestAfterTransientProviderError(request, nextTransientErrorCount, phase);
  const backoffMs = shouldFailRequest
    ? 0
    : baseBackoffMs + (retryAfterMs == null ? Math.floor(Math.random() * PROVIDER_POLL_JITTER_MS) : 0);
  const nextAttemptAfter = new Date(Date.now() + backoffMs);
  const status = shouldFailRequest
    ? 'FAILED'
    : request?.status === 'PENDING' ? 'PENDING' : 'INIT';

  return {
    set: {
      status,
      rowLocked: false,
      nextAttemptAfter: shouldFailRequest ? null : nextAttemptAfter,
      lastTransientProviderErrorAt: new Date(),
      lastTransientProviderErrorStatus: getProviderErrorStatus(error),
      lastTransientProviderErrorMessage: error?.message || String(error || ''),
      transientProviderErrorPhase: phase,
      transientProviderErrorExhausted: shouldFailRequest,
      ...(shouldFailRequest && phase === 'submit' ? { retryOnFail: false } : {}),
      providerFailureDefinitive:
        shouldFailRequest &&
        phase === 'submit' &&
        isSafeProviderSubmissionRetry(error),
      submissionOutcomeUnknown:
        shouldFailRequest &&
        phase === 'submit' &&
        !isSafeProviderSubmissionRetry(error) &&
        isTransientProviderError(error),
      expireAt: new Date(),
    },
    inc: isManagedMediaTunnelError
      ? { mediaTunnelRefreshErrorCount: 1 }
      : { transientProviderErrorCount: 1 },
    backoffMs,
  };
}

function shouldFailRequestAfterTransientProviderError(
  request = {},
  nextTransientErrorCount = 0,
  phase = 'poll',
) {
  const requestType = resolveAIVideoRequestType(request.model, request);
  const maxErrors = phase === 'submit' &&
    (
      requestType === 'image_to_video' ||
      (requestType === 'text_to_video' && isStandaloneEdition())
    )
    ? MAX_EXPLICIT_I2V_SUBMISSION_REJECTIONS
    : MAX_PROVIDER_TRANSIENT_ERRORS;
  if (nextTransientErrorCount >= maxErrors) {
    return true;
  }

  if (request?.status !== 'PENDING' || LIPSYNC_MODELS.includes(request?.model)) {
    return false;
  }

  const submittedAt = request.requestSubmitAt || request.createdAt;
  if (!submittedAt) {
    return false;
  }

  const submittedAtMs = new Date(submittedAt).getTime();
  return Number.isFinite(submittedAtMs) && Date.now() - submittedAtMs > MAX_BASE_PROVIDER_PENDING_MS;
}

async function deferTransientProviderError(request, error, phase) {
  const update = buildTransientProviderErrorUpdate(request, error, phase);
  await AIVideoLayerGeneration.findByIdAndUpdate(request._id, {
    $set: update.set,
    $inc: update.inc,
  });
}

export function getPendingPollIntervalMs(model, payload = {}) {
  if (isSamsarExternalVideoRequest(payload)) {
    return SAMSAR_EXTERNAL_PENDING_POLL_INTERVAL_MS;
  }
  if (isGenBlazeVideoRequest(payload)) {
    return GENBLAZE_PENDING_POLL_INTERVAL_MS;
  }
  if (model === 'RUNWAYML') {
    return RUNWAY_PENDING_POLL_INTERVAL_MS;
  }
  if (model === 'HAPPYHORSEI2V' && isAlibabaHappyHorseGenerationId(payload?.generationId)) {
    return ALIBABA_HAPPY_HORSE_PENDING_POLL_INTERVAL_MS;
  }
  return null;
}

async function scheduleNextPendingProviderPoll(payload) {
  if (!payload?._id) {
    return;
  }

  const pollIntervalMs = getPendingPollIntervalMs(payload?.model, payload);
  const update = {
    expireAt: new Date(),
    lastProviderPendingPollAt: new Date(),
  };

  if (pollIntervalMs) {
    update.nextAttemptAfter = new Date(Date.now() + pollIntervalMs + Math.floor(Math.random() * PROVIDER_POLL_JITTER_MS));
  }

  await AIVideoLayerGeneration.findByIdAndUpdate(payload._id, { $set: update });
}

async function markCustomAiVideoStageSuccess(sessionId) {
  if (!sessionId) {
    return;
  }
  await VideoSession.findByIdAndUpdate(sessionId, {
    $set: {
      'expressGenerationCustomStageResults.ai_video_generation.status': 'CUSTOM_SUCCEEDED',
      'expressGenerationCustomStageResults.ai_video_generation.completedAt': new Date(),
    },
  });
}

async function fallbackCustomAiVideoGeneration(payload, errorMessage) {
  const fallbackModel = typeof payload?.customFallbackModel === 'string'
    ? payload.customFallbackModel.trim()
    : '';
  if (payload?.model !== 'CUSTOM_IMAGE_TO_VIDEO' || !fallbackModel || payload?.customAdapterFallbackUsed === true) {
    return false;
  }
  await AIVideoLayerGeneration.findByIdAndUpdate(payload._id, {
    model: fallbackModel,
    status: 'INIT',
    aiVideoGenerationStatus: 'INIT',
    generationId: null,
    numRetries: 0,
    customAdapterFallbackUsed: true,
    customAdapterError: errorMessage || null,
    rowLocked: false,
    expireAt: new Date(),
  });
  await VideoSession.findByIdAndUpdate(payload.sessionId, {
    $set: {
      'expressGenerationCustomStageResults.ai_video_generation.fallbackUsed': true,
      'expressGenerationCustomStageResults.ai_video_generation.fallbackAt': new Date(),
      'expressGenerationCustomStageResults.ai_video_generation.error': errorMessage || null,
    },
  });
  return true;
}

function isGoogleNativeVeo3Model(model) {
  return (
    model === 'VEO3.1' ||
    model === 'VEO3.1FAST' ||
    model === 'VEO3.1I2V' ||
    model === 'VEO3.1I2VFAST'
  );
}

async function fallbackGoogleNativeVeo3Generation(payload, errorMessage) {
  if (
    !isGoogleNativeVeo3Model(payload?.model) ||
    payload?.googleVeoNativeFallbackUsed === true ||
    !shouldUseGoogleVeo3ForPayload(payload.model, payload)
  ) {
    return false;
  }

  await AIVideoLayerGeneration.findByIdAndUpdate(payload._id, {
    $set: {
      status: 'INIT',
      aiVideoGenerationStatus: 'INIT',
      generationId: null,
      googleVeoNativeFallbackUsed: true,
      googleVeoNativeFallbackAt: new Date(),
      googleVeoNativeError: errorMessage || null,
      rowLocked: false,
      expireAt: new Date(),
    },
    $unset: {
      nextAttemptAfter: '',
      lastTransientProviderErrorAt: '',
      lastTransientProviderErrorStatus: '',
      lastTransientProviderErrorMessage: '',
      transientProviderErrorPhase: '',
    },
  });


  return true;
}

function getErrorLogPayload(error) {
  if (!error || typeof error !== 'object') {
    return error;
  }

  return {
    name: error.name,
    message: error.message,
    status: error.status,
    body: error.body,
    code: error.code,
    googleStatus: error.googleStatus,
    stack: error.stack,
  };
}

function getProviderFailureMessage(payload = {}, fallback = 'AI video provider request failed.') {
  return (
    payload?.providerFailureMessage ||
    payload?.lastProviderFailureMessage ||
    payload?.lastTransientProviderErrorMessage ||
    payload?.generationError ||
    payload?.errorMessage ||
    fallback
  );
}

function getTransientDbLoopBackoffMs(failureCount) {
  const retryIndex = Math.max(0, failureCount - 1);
  const exponentialBackoffMs = Math.min(
    MAX_DB_TRANSIENT_BACKOFF_MS,
    MIN_DB_TRANSIENT_BACKOFF_MS * (2 ** Math.min(retryIndex, 4))
  );
  return exponentialBackoffMs + Math.floor(Math.random() * 1000);
}

function toProcessorAssetPath(assetPath) {
  if (typeof assetPath !== 'string') {
    return null;
  }

  const trimmedPath = assetPath.trim();
  if (!trimmedPath) {
    return null;
  }

  const assetsV2RootMarker = '/assets_v2/';
  if (trimmedPath.includes(assetsV2RootMarker)) {
    const [, relativePath = ''] = trimmedPath.split(assetsV2RootMarker);
    return relativePath ? `/assets_v2/${relativePath.replace(/^\/+/, '')}` : null;
  }

  const assetRootMarker = '/assets/';
  if (trimmedPath.includes(assetRootMarker)) {
    const [, relativePath = ''] = trimmedPath.split(assetRootMarker);
    return relativePath ? `/${relativePath.replace(/^\/+/, '')}` : null;
  }

  return trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
}

function toProcessorAssetRelativePath(assetPath) {
  if (typeof assetPath !== 'string') {
    return assetPath;
  }

  const normalizedPath = assetPath.replace(/\\/g, '/');
  if (normalizedPath.includes('/assets_v2/')) {
    return `assets_v2/${normalizedPath.split('/assets_v2/')[1]}`;
  }
  if (normalizedPath.includes('/assets/')) {
    return normalizedPath.split('/assets/')[1];
  }
  return normalizedPath.replace(/^\/+/, '');
}

function requiresBaseAiVideoLayer(layer = {}) {
  const baseType = typeof layer?.layerBaseAiImageType === 'string'
    ? layer.layerBaseAiImageType.trim().toLowerCase()
    : '';
  return baseType === 'character' || baseType === 'scene';
}

function shouldSkipAiVideoGenerationForLayer(layer = {}) {
  const layerType = typeof layer?.layerAiVideoType === 'string'
    ? layer.layerAiVideoType.trim().toLowerCase()
    : '';
  const baseType = typeof layer?.layerBaseAiImageType === 'string'
    ? layer.layerBaseAiImageType.trim().toLowerCase()
    : '';
  const aiVideoStatus = typeof layer?.aiVideoGenerationStatus === 'string'
    ? layer.aiVideoGenerationStatus.trim().toUpperCase()
    : '';

  return Boolean(
    layer?.skipAiVideoGeneration === true ||
    layer?.skipAiVideoGeneration === 'true' ||
    layerType === 'none' ||
    baseType === 'none' ||
    (
      aiVideoStatus === 'COMPLETED' &&
      !layer?.aiVideoGenerationPending &&
      !layer?.aiVideoLayer &&
      !layer?.aiVideoRemoteLink
    )
  );
}

function isBaseLayerAwaitingRender(layer = {}, requireAiVideoOutput = false) {
  if (!requireAiVideoOutput) {
    return false;
  }
  if (!requiresBaseAiVideoLayer(layer)) {
    return false;
  }
  if (layer?.aiVideoGenerationStatus === 'FAILED') {
    return false;
  }
  return Boolean(layer?.aiVideoGenerationPending) || !layer?.aiVideoLayer;
}

async function copyFile(src, dest) {
  try {
    await fs.copy(src, dest);
  } catch (err) {
    console.error(`Error copying file from ${src} to ${dest}:`, err);
    throw err;
  }
}

async function getSessionFramesPerSecond(sessionData) {
  if (!sessionData) {
    return resolveFramesPerSecond();
  }
  const sessionFps = normalizeFramesPerSecond(sessionData.framesPerSecond);
  if (sessionFps) {
    return sessionFps;
  }
  const userData = await User.findById(sessionData.userId)
    .select('videoFramesPerSecond')
    .lean();
  return resolveFramesPerSecond(sessionData, userData);
}



export async function processPendingAiVideoGenerationRequests() {
  let transientDbFailureCount = 0;
  while (true) {
    try {
      await getTimeout(1000);
      await generatePendingAiVideoLayerRequests();
      transientDbFailureCount = 0;
    } catch (e) {
      if (isTransientMongoError(e)) {
        transientDbFailureCount += 1;
        const backoffMs = getTransientDbLoopBackoffMs(transientDbFailureCount);
        console.error('Transient MongoDB error during AI video processing loop; backing off before retry.', {
          ...getErrorLogPayload(e),
          backoffMs,
          transientDbFailureCount,
        });
        await resetDbConnection();
        await getTimeout(backoffMs);
        continue;
      }
      console.error('An unexpected error occurred during video processing:', e);
    }
  }
  // return;
}

async function generatePendingAiVideoLayerRequests() {
  await getDBConnectionString();

  // ------------------------------------------------------------------------
  // STEP 1: Poll existing "PENDING" requests (rowLocked = false) for completion
  //         or detect any failed requests. Polling does not increase concurrency.
  // ------------------------------------------------------------------------
  const inProgressRequests = await withDbRetry(
    () => AIVideoLayerGeneration
      .find({ status: { $in: ['PENDING', 'FAILED'] }, rowLocked: false })
      .sort({ createdAt: 1 })
      .exec(),
    { operationName: 'load pending AI video generation requests' }
  );

  for (const request of inProgressRequests) {
    try {
      if (request.nextAttemptAfter && new Date(request.nextAttemptAfter).getTime() > Date.now()) {
        continue;
      }
      if (request.status === 'PENDING') {
        // Poll to check if done or failed
        await pollForAIVideoCompletion(request);
      } else if (request.status === 'FAILED') {
        // Finalize the failure
        await processVideoGenerationFailed(request);
      }
    } catch (e) {
      if (isTransientMongoError(e)) {
        throw e;
      }
      console.error('Error while polling request:', getErrorLogPayload(e));
      if (request.status === 'PENDING' && isTransientProviderError(e)) {
        await deferTransientProviderError(request, e, 'poll');
        continue;
      }
      if (
        !isStandaloneEdition() &&
        await fallbackGoogleNativeVeo3Generation(
          request,
          e?.message || 'Google native Veo poll failed.',
        )
      ) {
        continue;
      }
      await AIVideoLayerGeneration.findByIdAndUpdate(request._id, {
        status: 'FAILED',
        rowLocked: false,
        providerFailureDefinitive: false,
      });
    }
  }


  const activeRequests = await withDbRetry(
    () => AIVideoLayerGeneration.find({
      $or: [
        { rowLocked: true },         // those that are currently being started
        { status: 'PENDING' }        // those that have an ongoing external job
      ]
    }).exec(),
    { operationName: 'load active AI video generation requests' }
  );

  // If 5 or more jobs are active, do not pick up new "INIT" requests yet
  if (activeRequests.length >= MAX_CONCURRENT_AI_VIDEO_REQUESTS) {
    return;  // Just exit, we'll try again on the next loop iteration
  }

  // ------------------------------------------------------------------------
  // STEP 3: Otherwise, pick up new "INIT" requests within both the global
  //         worker limit and any provider-specific limit.
  // ------------------------------------------------------------------------
  const capacity = MAX_CONCURRENT_AI_VIDEO_REQUESTS - activeRequests.length;
  if (capacity <= 0) return;

  // Pull the oldest "INIT" requests first or newest first, your choice:
  const initRequests = await withDbRetry(
    () => AIVideoLayerGeneration
      .find({
        status: 'INIT',
        rowLocked: false,
      })
      .sort({ createdAt: 1 })    // newest first, matching your existing code
      .exec(),
    { operationName: 'load init AI video generation requests' }
  );

  const dispatchRequests = selectAiVideoDispatchRequests({
    activeRequests,
    initRequests,
  });

  // Start each new request up to the concurrency limit
  for (const request of dispatchRequests) {
    try {

      await generateAIVideoLayer(request);
    } catch (e) {
      if (isTransientMongoError(e)) {
        throw e;
      }
      console.error('Error while starting a new INIT request:', getErrorLogPayload(e));
      const requestType = resolveAIVideoRequestType(request.model, request);
      const protectsAmbiguousSubmission =
        requestType === 'image_to_video' ||
        (requestType === 'text_to_video' && isStandaloneEdition());
      if (protectsAmbiguousSubmission && isSafeProviderSubmissionRetry(e)) {
        await deferTransientProviderError(request, e, 'submit');
        continue;
      }
      if (protectsAmbiguousSubmission) {
        // A timeout, connection reset, or 5xx can occur after the provider
        // accepted the request. Never resubmit or switch adapters when the
        // submission outcome is unknown.
        const submissionOutcomeUnknown = isTransientProviderError(e);
        await AIVideoLayerGeneration.findByIdAndUpdate(request._id, {
          status: 'FAILED',
          rowLocked: false,
          retryOnFail: false,
          submissionOutcomeUnknown,
          providerFailureDefinitive: !submissionOutcomeUnknown,
          lastProviderFailureMessage: e?.message || String(e),
          lastProviderFailureDetail: getErrorLogPayload(e),
        });
        continue;
      }
      if (isTransientProviderError(e)) {
        await deferTransientProviderError(request, e, 'submit');
        continue;
      }
      if (await fallbackGoogleNativeVeo3Generation(request, e?.message || 'Google native Veo submit failed.')) {
        continue;
      }
      if (await fallbackCustomAiVideoGeneration(request, e?.message || 'Custom image-to-video submit failed.')) {
        continue;
      }
      await AIVideoLayerGeneration.findByIdAndUpdate(request._id, {
        status: 'FAILED',
        rowLocked: false,
        lastProviderFailureMessage: e?.message || String(e),
        lastProviderFailureDetail: getErrorLogPayload(e),
      });
    }
  }
}

async function getHailuoAdapter(queryType, payload) {
  if (isStandaloneEdition()) {
    if (queryType === 'generate') {
      const generationId = await generateHailuoVideoLayer(payload);
      return generationId;
    } else {
      const responseData = await listenToPendingHailuoVideoRequest(payload);
      return responseData;
    }
  } else {
    if (queryType === 'generate') {
      const generationId = await generateHailuoNativeVideoLayer(payload);
      return generationId;
    } else {
      const responseData = await listenToPendingHailuoNativeVideoRequest(payload);
      return responseData;
    }
  }
}


async function generateAIVideoLayer(payload) {
  const queuedModel = normalizeString(payload?.model);
  payload = restoreStandaloneAdapterRoutableModel(payload);
  const { _id, numRetries } = payload;
  let model = normalizeString(payload?.model);

  await getDBConnectionString();

  const initialUpdate = {
    $set: {
      rowLocked: true,
      ...(model !== queuedModel ? { model } : {}),
    },
  };
  if (model !== queuedModel) {
    initialUpdate.$unset = {
      samsarExternalProvider: '',
      externalProvider: '',
    };
  }
  await AIVideoLayerGeneration.findByIdAndUpdate(_id, initialUpdate);

  if (!payload.framesPerSecond) {
    const sessionData = await VideoSession.findById(payload.sessionId);
    payload.framesPerSecond = await getSessionFramesPerSecond(sessionData);
  }

  if (LIPSYNC_MODELS.includes(model)) {
    const {
      ready: readyForLipSync,
      missingRequiredBaseLayer
    } = await isSessionReadyForLipSync(payload.sessionId, payload.layerId);

    if (!readyForLipSync) {
      const creationDate = payload.requestSubmitAt || payload.createdAt;
      const waitTooLong = Boolean(creationDate) && (Date.now() - new Date(creationDate).getTime()) > MAX_LIPSYNC_WAIT_MS;
      if (missingRequiredBaseLayer || waitTooLong) {
        payload.retryOnFail = false;
        await processLipSyncGenerationFailed(payload);
      } else {
        await AIVideoLayerGeneration.findByIdAndUpdate(_id, { rowLocked: false });
      }
      return;
    }
  }


  if (numRetries > 1) {
    console.error('RETRYING...' + numRetries);
  }

  // TODO: Re-enable Express lip-sync prompt generation when the selected
  // lip-sync model supports prompt input.
  // if (payload.isExpressGeneration === true && LIPSYNC_MODELS.includes(model)) {
  //   payload = await prepareExpressLipSyncPrompt(payload);
  // }

  const dockerAdapterRequestType = resolveAIVideoRequestType(
    getDockerAdapterRoutingModel(payload),
    payload,
  );
  if (
    isStandaloneEdition() &&
    ['image_to_video', 'text_to_video'].includes(dockerAdapterRequestType)
  ) {
    const selectedProvider = resolveAIVideoProvider(
      getDockerAdapterRoutingModel(payload),
      payload,
    );
    if (Object.values(DOCKER_VIDEO_PROVIDER).includes(selectedProvider)) {
      if (
        model === 'SAMSAR_EXTERNAL_VIDEO' &&
        selectedProvider !== DOCKER_VIDEO_PROVIDER.SAMSAR &&
        normalizeString(payload.originalVideoModel)
      ) {
        model = normalizeString(payload.originalVideoModel);
        payload.model = model;
        payload.samsarExternalProvider = false;
        payload.externalProvider = '';
      }
      payload.dockerVideoProvider = selectedProvider;
      const providerSelectionUpdate = {
        $set: {
          model,
          dockerVideoProvider: selectedProvider,
          providerFailureDefinitive: false,
          submissionOutcomeUnknown: false,
        },
      };
      if (selectedProvider !== DOCKER_VIDEO_PROVIDER.SAMSAR) {
        providerSelectionUpdate.$unset = {
          samsarExternalProvider: '',
          externalProvider: '',
        };
      }
      await AIVideoLayerGeneration.findByIdAndUpdate(_id, providerSelectionUpdate);
    }
  }

  // Resolve only media that the selected public adapter will actually receive.
  // Samsar external adapters normalize their own exact request body, while
  // native Google Veo reads mounted images into inline bytes and needs no
  // public tunnel URL.
  const usesSamsarExternalProvider = shouldUseSamsarExternalVideoProvider(payload);
  const usesGenBlazeProvider = shouldUseGenBlazeVideoProvider(payload);
  const usesGoogleInlineMedia = (
    ['VEO3.1', 'VEO3.1FAST', 'VEO3.1I2V', 'VEO3.1I2VFAST'].includes(model) &&
    shouldUseGoogleVeo3ForPayload(model, payload)
  );
  if (!usesSamsarExternalProvider && !usesGoogleInlineMedia) {
    payload = await normalizeSelectedVideoGenerationMediaPayload(
      payload,
      normalizeProviderMediaUrl,
    );
  }

  let generationId;


  if (usesSamsarExternalProvider) {
    generationId = await generateSamsarExternalVideoLayer(payload);
  } else if (usesGenBlazeProvider) {
    generationId = await generateGenBlazeVideoLayer(payload);
  } else if (model === 'LUMA' || model === 'LUMAFLASH2') {
    // generationId = await generateLumaAiVideoLayer(payload);
  } else if (model === 'SDVIDEO') {
    generationId = await generateSdVideoLayer(payload);
  } else if (model === 'RUNWAYML') {
    generationId = await generateRunwayNativeVideoLayer(payload);
  } else if (model === 'KLINGLIPSYNC') {
    generationId = await generateKlingLipSyncLayer(payload);
  } else if (model.startsWith("KLING")) {
    generationId = await generateKlingVideoLayer(payload);
  } else if (model === 'HAILUOPRO') {
    generationId = await getHailuoAdapter("generate", payload);
  } else if (model === 'HAIPER2.0') {
    generationId = await generateHaiperVideoLayer(payload);
  } else if (model === 'SKYREELSI2V') {
    generationId = await generateSkyReelsVideoLayer(payload);
  } else if (model === 'SYNCLIPSYNC') {
    generationId = await generateSyncLipSyncLayer(payload);
  } else if (model === 'LATENTSYNC') {
    generationId = await generateLatentSyncLayer(payload);
  } else if (model === 'MMAUDIOV2') {
    generationId = await generateSoundEffectSyncedMMVideo(payload);
  } else if (model === 'VEO') {
    generationId = await generateVeoVideoLayer(payload);
  } else if (model === 'VEO3.1' || model === 'VEO3.1FAST') {
    generationId = shouldUseGoogleVeo3ForPayload(model, payload)
      ? await generateGoogleVeo3VideoLayer(payload)
      : await generateVeo3VideoLayer(payload);
  } else if (model === 'PIXVERSEI2V' || model === 'PIXVERSEI2VFAST') {
    generationId = await generatePixVerseVideoLayer(payload);
  } else if (model === 'WANI2V' || model === 'WANI2V5B') {
    generationId = await generateWanVideoLayer(payload);
  } else if (model === 'VEOI2V') {
    generationId = await generateVeoImgToVideoLayer(payload);
  } else if (model === 'PIKA2.2I2V') {
    generationId = await generatePikaImgToVidLayer(payload);
  } else if (model === 'MAGIDISTILLED') {
    generationId = await generateMagiImgToVidLayer(payload);
  } else if (model === 'HUMMINGBIRDLIPSYNC') {
    generationId = await generateHummingBirdLipSyncLayer(payload);
  } else if (model === 'VIDUI2V') {
    generationId = await generateViduI2VVideoLayer(payload);
  } else if (model === 'SEEDANCEI2V' || model === 'SEEDANCE2.0I2V') {
    generationId = await generateSeeDanceImgToVideoLayer(payload);
  } else if (model === 'HAPPYHORSEI2V') {
    generationId = shouldUseAlibabaNativeHappyHorse(payload)
      ? await generateAlibabaHappyHorseImgToVideoLayer(payload)
      : await generateHappyHorseImgToVideoLayer(payload);
  } else if (model === 'MIRELOAI') {
    generationId = await generateSoundEffectMireloVideo(payload);
  } else if (model === 'CREATIFYLIPSYNC') {
    generationId = await generateCreatifyLipSyncLayer(payload);
  } else if (model === 'VEO3.1I2V' || model === 'VEO3.1I2VFAST') {
    generationId = shouldUseGoogleVeo3ForPayload(model, payload)
      ? await generateGoogleVeo3VideoLayer(payload)
      : await generateVeo3ImgToVidLayer(payload);
  } else if (model === 'COSMOS3SUPERI2V') {
    generationId = await generateCosmos3ImgToVidLayer(payload);
  } else if (model === 'VEO3.1FLIV') {
    generationId = await generateVeo3FirstLastFrameVideoLayer(payload);
  } else if (model === 'CUSTOM_IMAGE_TO_VIDEO') {
    generationId = await generateCustomImageToVideoLayer(payload);
  }

  if (typeof generationId !== 'string' || !generationId.trim()) {
    throw new Error(`AI video provider did not return a valid generation id for model ${model}.`);
  }

  await recordAIVideoProviderUsage(payload, generationId);

  const requestSubmitAt = Date.now();




  const generationUpdate = {
    status: 'PENDING',
    aiVideoGenerationStatus: 'PENDING',
    generationId,
    rowLocked: false,
    requestSubmitAt: requestSubmitAt,
    transientProviderErrorCount: 0,
    expireAt: new Date(),
  };
  const submittedProvider = normalizeString(payload.dockerVideoProvider) ||
    resolveAIVideoProvider(getDockerAdapterRoutingModel(payload), {
      ...payload,
      generationId,
    });
  if (Object.values(DOCKER_VIDEO_PROVIDER).includes(submittedProvider)) {
    generationUpdate.dockerVideoProvider = submittedProvider;
  }
  if (submittedProvider === DOCKER_VIDEO_PROVIDER.GMICLOUD) {
    generationUpdate.externalProvider = DOCKER_VIDEO_PROVIDER.GMICLOUD;
  }
  if (payload.dockerAdapterFailoverAttempted === true && payload.dockerVideoProviderOverride) {
    const successfulProvider = submittedProvider;
    if (successfulProvider === payload.dockerVideoProviderOverride) {
      generationUpdate.dockerAdapterFailoverSucceeded = true;
      generationUpdate.dockerAdapterFailoverSucceededAt = new Date();
    }
  }
  const pendingPollIntervalMs = getPendingPollIntervalMs(model, { ...payload, generationId });
  if (pendingPollIntervalMs) {
    generationUpdate.nextAttemptAfter = new Date(Date.now() + pendingPollIntervalMs);
  }

  await AIVideoLayerGeneration.findByIdAndUpdate(_id, {
    $set: generationUpdate,
    $unset: {
      lastTransientProviderErrorAt: '',
      lastTransientProviderErrorStatus: '',
      lastTransientProviderErrorMessage: '',
      transientProviderErrorPhase: '',
      providerFailureDefinitive: '',
      submissionOutcomeUnknown: '',
      dockerAdapterPrimaryPromoted: '',
    },
  });
}

async function pollForAIVideoCompletion(reqPayload) {
  let payload = reqPayload.toObject();
  const { model } = payload;

  if (LIPSYNC_MODELS.includes(model)) {
    const requestSubmitAt = payload.requestSubmitAt || payload.createdAt;
    const requestAgeMs = requestSubmitAt ? Date.now() - new Date(requestSubmitAt).getTime() : 0;
    if (requestAgeMs > MAX_LIPSYNC_PROVIDER_PENDING_MS) {
      payload.retryOnFail = false;
      await processVideoGenerationFailed(payload);
      return;
    }
  }

  let responseData;
  if (shouldUseSamsarExternalVideoProvider(payload)) {
    responseData = await listenToPendingSamsarExternalVideoRequest(payload);
  } else if (shouldUseGenBlazeVideoProvider(payload)) {
    responseData = await listenToPendingGenBlazeVideoRequest(payload);
  } else if (model === 'LUMA' || model === 'LUMAFLASH2') {
    // responseData = await pollLumaAiVideoLayer(payload);
  } else if (model === 'SDVIDEO') {
    responseData = await listenToPendingSDVideoRequest(payload);
  } else if (model === 'RUNWAYML') {
    responseData = await listenToPendingRunwayNativeVideoRequest(payload);
  } else if (model === 'KLINGLIPSYNC') {
    responseData = await listenToPendingKlingLipSyncRequests(payload);
  } else if (model.startsWith("KLING")) {
    responseData = await listenToPendingKlingVideoRequest(payload);
  } else if (model === 'HAILUOPRO') {
    responseData = await getHailuoAdapter("polling", payload);
  } else if (model === 'HAIPER2.0') {
    responseData = await listenToPendingHaiperVideoRequest(payload);
  } else if (model === 'SKYREELSI2V') {
    responseData = await listenToPendingSkyReelsVideoRequests(payload);
  } else if (model === 'VEO') {
    responseData = await listenToPendingVeoRequests(payload);
  } else if (model === 'VEO3.1' || model === 'VEO3.1FAST') {
    responseData = shouldUseGoogleVeo3ForPayload(model, payload)
      ? await listenToPendingGoogleVeo3Requests(payload)
      : await listenToPendingVeo3Requests(payload);
  } else if (model === 'SYNCLIPSYNC') {
    responseData = await listenToPendingSyncLipSyncRequests(payload);
  } else if (model === 'LATENTSYNC') {
    responseData = await listenToPendingLatentSyncRequests(payload);
  } else if (model === 'MMAUDIOV2') {
    responseData = await listenToPendingSoundEffectSyncedMMVideoRequest(payload);
  } else if (model === 'PIXVERSEI2V' || model === 'PIXVERSEI2VFAST') {
    responseData = await listenToPendingPixVerseRequests(payload);
  } else if (model === 'WANI2V' || model === 'WANI2V5B') {
    responseData = await listenToPendingWanVideoRequests(payload);
  } else if (model === 'VEOI2V') {
    responseData = await listenToPendingVeoImgToVidRequests(payload);
  } else if (model === 'PIKA2.2I2V') {
    responseData = await listenToPendingPikaImgToVidRequests(payload);
  } else if (model === 'MAGIDISTILLED') {
    responseData = await listenToPendingMagiImgToVidLayer(payload);
  } else if (model === 'HUMMINGBIRDLIPSYNC') {
    responseData = await listenToPendingHummingBirdLipSyncRequests(payload);
  } else if (model === 'VIDUI2V') {
    responseData = await listenToPendingViduI2VVideoRequests(payload);
  } else if (model === 'SEEDANCEI2V' || model === 'SEEDANCE2.0I2V') {
    responseData = await listenToPendingSeeDanceImgToVidRequests(payload);
  } else if (model === 'HAPPYHORSEI2V') {
    responseData = shouldUseAlibabaNativeHappyHorse(payload)
      ? await listenToPendingAlibabaHappyHorseImgToVidRequests(payload)
      : await listenToPendingHappyHorseImgToVidRequests(payload);
  } else if (model === 'MIRELOAI') {
    responseData = await listenToPendingSoundEffectMireloVideoRequest(payload);
  } else if (model === 'CREATIFYLIPSYNC') {
    responseData = await listenToPendingCreatifyLipSyncRequests(payload);
  } else if (model === 'VEO3.1I2V' || model === 'VEO3.1I2VFAST') {
    responseData = shouldUseGoogleVeo3ForPayload(model, payload)
      ? await listenToPendingGoogleVeo3Requests(payload)
      : await listenToPendingVeo3ImgToVidRequests(payload);
  } else if (model === 'COSMOS3SUPERI2V') {
    responseData = await listenToPendingCosmos3ImgToVidRequests(payload);
  } else if (model === 'VEO3.1FLIV') {
    responseData = await listenToPendingVeo3FirstLastFrameVideoRequests(payload);
  } else if (model === 'CUSTOM_IMAGE_TO_VIDEO') {
    responseData = await listenToPendingCustomImageToVideoRequests(payload);
  }


  if (!responseData) return; // No status change or not ready

  const { remoteUrl, responseStatus, responseBlob } = responseData;

  if (responseStatus === 'COMPLETED') {
    if (model === 'CUSTOM_IMAGE_TO_VIDEO' || isSamsarExternalVideoRequest(payload)) {
      await markCustomAiVideoStageSuccess(payload.sessionId);
    }

    let localVideoLink;

    if (remoteUrl) {
      localVideoLink = await downloadVideoFromRemote(remoteUrl, payload.sessionId, payload.layerId);
    }
    else if (responseBlob) {
      localVideoLink = await downloadVideoFromRemoteBlob(responseBlob, payload.sessionId, payload.layerId);
    }

    await processVideoGenerationCompletion(payload, localVideoLink);


  } else if (responseStatus === 'FAILED') {
    if (
      !isStandaloneEdition() &&
      await fallbackGoogleNativeVeo3Generation(
        payload,
        'Google native Veo generation failed.',
      )
    ) {
      return;
    }
    if (responseData?.providerFailureMessage) {
      payload.lastProviderFailureMessage = responseData.providerFailureMessage;
    }
    if (responseData?.providerStatus) {
      payload.lastProviderFailureDetail = responseData.providerStatus;
    }
    payload.providerFailureDefinitive = true;
    payload.submissionOutcomeUnknown = false;
    await processVideoGenerationFailed(payload);
  } else if (responseStatus === 'PENDING') {
    await scheduleNextPendingProviderPoll(payload);
  }
}





async function createGenerateVideoRecord(payload, localVideoPath) {

  const {
    sessionId,
    layerId,
    prompt,
    model,
    userId,
    audioPrompt,
    duration,
    description,
    generatedVideoSourceType,
    thumbnailPath,
    endThumbnailPath,
    thumbnailVideoPath,
    thumbnailVideoRemoteUrl,
    remoteAIVideoLink,
  } = payload;



  await getDBConnectionString();

  const generatedRecord = new GeneratedAIVideo({
    sessionId,
    layerId,
    url: localVideoPath,
    remoteUrl: remoteAIVideoLink || null,
    description: typeof description === 'string' && description.trim() ? description.trim() : null,
    prompt,
    model,
    userId,
    audioPrompt,
    duration,
    generationType: generatedVideoSourceType || 'ai_video',
    thumbnailPath: thumbnailPath || null,
    endThumbnailPath: endThumbnailPath || null,
    thumbnailVideoPath: thumbnailVideoPath || null,
    thumbnailVideoRemoteUrl: thumbnailVideoRemoteUrl || null,
  });


  const saveRes = await generatedRecord.save();

  return saveRes;

}



async function processVideoGenerationCompletion(payload, localVideoLink) {

  let { generationId, sessionId, _id, combineLayers,
    aspectRatio, clipLayerToAiVideo, model, isAudioVideoGeneration, prompt,
  } = payload;


  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);



  let firstFrame;
  let lastFrame;
  let duration;
  let frameCount;
  let frameDuration;



  await getDBConnectionString();
  const sessionData = await VideoSession.findById(payload.sessionId);
  const currentLayerIndex = sessionData.layers.findIndex(layer => layer._id.toString() === payload.layerId);

  if (currentLayerIndex === -1) {
    return null;
  }

  const currentLayer = sessionData.layers[currentLayerIndex];
  const currentLayerDuration = currentLayer.duration;
  const framesPerSecond = await getSessionFramesPerSecond(sessionData);
  const isLipSyncModel = LIPSYNC_MODELS.includes(model);
  const shouldPreserveLipSyncTimeline = isAudioVideoGeneration && isLipSyncModel;
  const generatedVideoSourceType = SOUND_EFFECT_MODELS.includes(model) && currentLayer.layerAiVideoType === 'sound_effect'
    ? 'sound_effect'
    : isLipSyncModel
      ? 'lip_sync'
      : 'ai_video';


  if (isAudioVideoGeneration && !shouldPreserveLipSyncTimeline) {


    if (clipLayerToAiVideo) {
      let clipTargetSeconds = Number.isFinite(currentLayerDuration) && currentLayerDuration > 0
        ? currentLayerDuration
        : null;

      const baseVideoPath = currentLayer?.aiVideoLayer;
      if (typeof baseVideoPath === 'string' && baseVideoPath.length > 0 && !baseVideoPath.startsWith('http')) {
        try {
          const pwd = process.cwd();
          const isAssetsV2Path = baseVideoPath.includes('/assets_v2/')
            || baseVideoPath.replace(/^\/+/, '').startsWith('assets_v2/');
          const baseVideoRelativeToAssets = baseVideoPath.includes('/assets_v2/')
            ? baseVideoPath.split('/assets_v2/')[1]
            : baseVideoPath.includes('/assets/')
              ? baseVideoPath.split('/assets/')[1]
              : baseVideoPath.replace(/^\//, '').replace(/^assets_v2\//, '').replace(/^assets\//, '');
          const assetsRoots = [
            usesLocalAssetStorage()
              ? '/assets_v2'
              : path.join(pwd, '../', 'samsar_processor', 'assets_v2'),
            ...(isAssetsV2Path ? [] : [
              usesLocalAssetStorage()
                ? '/assets'
                : path.join(pwd, '../', 'samsar_processor', 'assets'),
            ]),
          ];
          const baseVideoAbsolutePath = assetsRoots
            .map((assetsRoot) => path.join(assetsRoot, baseVideoRelativeToAssets))
            .find((candidatePath) => fs.existsSync(candidatePath));

          if (baseVideoAbsolutePath && fs.existsSync(baseVideoAbsolutePath)) {
            const baseDuration = await getVideoDuration(baseVideoAbsolutePath);
            if (Number.isFinite(baseDuration) && baseDuration > 0) {
              clipTargetSeconds = baseDuration;
            }
          }
        } catch (err) {
          console.error('Failed to resolve base AI video duration for clipping; falling back to layer duration', {
            sessionId,
            layerId: payload.layerId,
            error: err?.message || err,
          });
        }
      }

      if (Number.isFinite(clipTargetSeconds) && clipTargetSeconds > 0) {
        try {
          await clipVideoToDuration(localVideoLink, clipTargetSeconds);
        } catch (err) {
          console.error('Failed to clip audio-video layer to base duration; continuing with original output', {
            sessionId,
            layerId: payload.layerId,
            clipTargetSeconds,
            error: err?.message || err,
          });
        }
      }
    }


    // 3. Now proceed exactly as before
    let videoFrameResponse = await processVideoAsFramesAndAudio(
      localVideoLink,
      payload.sessionId,
      payload.layerId,
      canvasDimensions,
      framesPerSecond
    );

    duration = videoFrameResponse.duration;
    frameCount = videoFrameResponse.frameCount;
    frameDuration = videoFrameResponse.frameDuration;


    const audioLink = videoFrameResponse.audioPath;
    payload.audioVideoAudioLink = audioLink;

    firstFrame = videoFrameResponse.firstFrame;
    lastFrame = videoFrameResponse.lastFrame;




  } else {

    const videoFrameResponse = await processVideoAsFrames(
      localVideoLink,
      payload.sessionId,
      payload.layerId,
      canvasDimensions,
      framesPerSecond
    );
    firstFrame = videoFrameResponse.firstFrame;
    lastFrame = videoFrameResponse.lastFrame;
    duration = videoFrameResponse.duration;
    frameCount = videoFrameResponse.frameCount;
    frameDuration = videoFrameResponse.frameDuration;

  }
  const localVideoPath = toProcessorAssetPath(localVideoLink);




  const startFrameGenerationPath = await copyFrameToGenerations(firstFrame, sessionId);


  const lastFrameGenerationPath = await copyFrameToGenerations(lastFrame, sessionId);

  let thumbnailVideoPath = null;
  try {
    const localThumbnailVideoLink = await createThumbnailVideoPreview(localVideoLink, {
      fallbackFramePath: firstFrame,
      sourceFramesPerSecond: framesPerSecond,
    });
    thumbnailVideoPath = toProcessorAssetPath(localThumbnailVideoLink);
  } catch (error) {
    console.error('Failed to build thumbnail preview video. Continuing without preview asset.', {
      sessionId,
      layerId: payload.layerId,
      error: error?.message || error,
    });
  }


  const newLayerDuration = duration;
  let durationDiff = newLayerDuration - currentLayerDuration;



  currentLayer.aiLayerStartFrame = startFrameGenerationPath;
  currentLayer.aiLayerEndFrame = lastFrameGenerationPath;

  payload.duration = duration;
  payload.generatedFrameCount = frameCount;
  payload.generatedFrameDuration = frameDuration;
  payload.generatedVideoSourceType = generatedVideoSourceType;
  payload.thumbnailPath = startFrameGenerationPath;
  payload.endThumbnailPath = lastFrameGenerationPath;
  payload.thumbnailVideoPath = thumbnailVideoPath;

  payload.startFrameGenerationPath = startFrameGenerationPath;
  payload.lastFrameGenerationPath = lastFrameGenerationPath;

  payload.imageConfig = null;
  payload.durationDiff = durationDiff;

  const framDurationDiff = Math.floor(durationDiff * framesPerSecond);

  payload.frameDurationDiff = framDurationDiff;

  if (sessionData.isExpressGeneration && !sessionData.expressGenerativeSpeechRequired) {

    payload.durationDiff = 0;
    durationDiff = 0;
    payload.duration = duration;
    payload.frameDurationDiff = 0;
    payload.imageConfig = null;
    if (!isLipSyncModel) {
      payload.clipLayerToAiVideo = true;
    }
  }




  const aiVideoRemoteURL = await uploadVideoToBucket(localVideoPath, payload);




  payload.remoteAIVideoLink = aiVideoRemoteURL;
  await markVideoLayerGenerationAsComplete(localVideoPath, payload);



  const nextLayer = sessionData.layers[currentLayerIndex + 1] || null;
  if (shouldCarryGeneratedLastFrameToNextLayer(payload, nextLayer)) {
    await replaceActiveItemNextLayer(payload, lastFrameGenerationPath, combineLayers);
  }


  if (durationDiff > 0) {

  //  await updateNextLayersAudioAndAnimationDurations(payload, durationDiff);
  }



  if (sessionData.isExpressGeneration && !sessionData.expressGenerativeVideoRequired) {
  //  await requestRegeneratePresetAnimations(sessionData._id.toString());
  }


  if (payload.isSecondaryExpressGeneration && sessionData.isExpressGeneration) {
    try {
      await VideoSession.updateOne(
        { _id: sessionData._id },
        {
          $set: {
            transcriptGenerationPending: true,
            'expressGenerationStatus.transcript_generation': 'INIT',
          },
        }
      );
    } catch (err) {
      console.error('Failed to mark transcript regeneration as pending; continuing', {
        sessionId: sessionData?._id?.toString?.() || sessionId,
        error: err?.response?.data || err?.message || err,
        stack: err?.stack,
      });
    }
  }


  await AIVideoLayerGeneration.findByIdAndDelete(_id);


  if (sessionData.isExpressGeneration && sessionData.expressGenerativeVideoRequired) {
    await checkForExpressVideoGenerativeVideoCompletion(sessionId, model);
  }




  await createGenerateVideoRecord(payload, localVideoPath);





}


async function checkForExpressVideoGenerativeVideoCompletion(sessionId, model) {

  await getDBConnectionString();

  let sessionData = await VideoSession.findById(sessionId);

  if (!sessionData) {
    throw new Error('Session not found');
  }

  const { layers } = sessionData;
  let sessionAiVideoGenerationCompleted = true;
  let sessionAiVideoGenerationFailed = false;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (shouldSkipAiVideoGenerationForLayer(layer)) {
      continue;
    }

    const aiVideoStatus = layer?.aiVideoGenerationStatus;
    const hasRenderableOutput = Boolean(layer?.aiVideoLayer || layer?.aiVideoRemoteLink);
    const isTerminalStatus = aiVideoStatus === 'COMPLETED' || aiVideoStatus === 'FAILED';

    if (aiVideoStatus === 'FAILED') {
      sessionAiVideoGenerationFailed = true;
      sessionAiVideoGenerationCompleted = false;
      break;
    }

    if (layer.aiVideoGenerationPending || !isTerminalStatus) {
      sessionAiVideoGenerationCompleted = false;
      break;
    }

    if (aiVideoStatus === 'COMPLETED' && !hasRenderableOutput) {
      sessionAiVideoGenerationCompleted = false;
      break;
    }
  }

  if (sessionAiVideoGenerationCompleted && !sessionAiVideoGenerationFailed) {

    const currentGenerationStatus = sessionData.expressGenerationStatus;
    currentGenerationStatus.ai_video_generation = 'COMPLETED';


    let updatePayload = {
      expressGenerationStatus: currentGenerationStatus,
      aiVideoGenerationPending: false,
      expressGenerationFailed: false,
      expressGenerationError: null,
    };

    if (model === 'SYNCLIPSYNC' || model === 'LATENTSYNC') {
      updatePayload.lipSyncGenerationPending = false;
    }

    await VideoSession.updateOne({ _id: sessionId }, updatePayload, { new: true });

  }

}

async function getTimeout(ms = 1000) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



export async function requestRegeneratePresetAnimations(sessionId) {
  await getDBConnectionString();

  let sessionDataValue = await VideoSession.findOne({ _id: sessionId });

  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  let sessionLayers = sessionDataValue.layers;

  for (let i = 0; i < sessionLayers.length; i++) {
    let layer = sessionLayers[i];

    // Skip if AI video layer is already present
    if (layer.aiVideoLayer) {
      continue;
    }


    let currentImageLayerIndex = layer.imageSession.activeItemList.findIndex(item => item.type === 'image' && item.is_base_image);


    if (currentImageLayerIndex === -1) {
      continue;
    }

    let currentImageLayer = layer.imageSession.activeItemList[currentImageLayerIndex];
    let currentActiveItemList = layer.imageSession.activeItemList;

    // If there are animations, skip
    if (currentImageLayer && currentImageLayer.animations && currentImageLayer.animations.length > 0) {
      continue;
    }

    // If no animations, create preset animation list
    if (currentImageLayer) {
      const newAnimationsList = [];
      // Ensure the animations are updated in the document
      currentImageLayer.animations = newAnimationsList;

      for (let j = 0; j < currentActiveItemList.length; j++) {
        if (j === currentImageLayerIndex) {
          currentActiveItemList[j] = currentImageLayer;
        }
      }

      layer.frameGenerationPending = true;

    }
  }

  // Save the updated session after modifying the animations
  const sessionDataUpdated = await sessionDataValue.save();




  return sessionDataUpdated;


}




async function markVideoLayerGenerationAsComplete(localVideoLink, payload) {



  // await realignLayerToSpeechForExpressGeneration(localVideoLink, lastFrameGenerationPath, payload);

  const { _id, sessionId, layerId, combineLayers, imageConfig, durationDiff,
    aspectRatio, clipLayerToAiVideo, remoteAIVideoLink,
    startFrameGenerationPath, lastFrameGenerationPath, thumbnailVideoPath,
    model, isAudioVideoGeneration, duration: generatedLayerDuration } = payload;
  const generatedFrameCount = payload.generatedFrameCount;
  const generatedFrameDuration = payload.generatedFrameDuration;



  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  const canvasWidth = canvasDimensions.width;
  const canvasHeight = canvasDimensions.height;
  const canvasArea = canvasWidth * canvasHeight;
  const maxAllowedArea = 0.7 * canvasArea; // 70% of canvas area

  await getDBConnectionString();
  let videoSession = await VideoSession.findById(sessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);
  const framesPerSecond = await getSessionFramesPerSecond(videoSession);

  const isLipSyncModel = LIPSYNC_MODELS.includes(model);
  const shouldPreserveLipSyncTimeline = isAudioVideoGeneration && isLipSyncModel;

  let audioSpeechLayers = videoSession.audioLayers.find((layer) => layer.generationType === 'speech');
  let currentLayer = videoSession.layers[currentLayerIndex];

  if (isStaleSoundEffectGenerationForLayer({ model, isAudioVideoGeneration, currentLayer })) {
    await AIVideoLayerGeneration.findByIdAndDelete(_id);
    return videoSession;
  }



  if (startFrameGenerationPath) {
    currentLayer.aiLayerStartFrame = startFrameGenerationPath;
  }

  if (lastFrameGenerationPath) {
    currentLayer.aiLayerEndFrame = lastFrameGenerationPath;
  }

  currentLayer.thumbnailPath = startFrameGenerationPath || currentLayer.thumbnailPath || null;
  currentLayer.endThumbnailPath = lastFrameGenerationPath || currentLayer.endThumbnailPath || null;
  currentLayer.thumbnailVideoPath = thumbnailVideoPath || currentLayer.thumbnailVideoPath || null;



  const duration = currentLayer.duration;
  // Save the previous active item list
  let previousActiveItemList = currentLayer.imageSession.activeItemList;

  // Never pad layers with a still/last frame. Instead, keep only overlays/config items
  // and rely on duration clipping + frame regeneration in downstream steps.
  if (combineLayers) {
    currentLayer.imageSession.activeItemList = [];
  } else {
    const currentActiveItemList = Array.isArray(currentLayer.imageSession.activeItemList)
      ? currentLayer.imageSession.activeItemList
      : [];
    currentLayer.imageSession.activeItemList = currentActiveItemList.filter(
      (item) => item?.type === 'text' || item?.is_config_image
    );
  }

  currentLayer.imageSession.previousActiveItemList = previousActiveItemList;
  currentLayer.processVideoGenerationFailed = false;
  if (SOUND_EFFECT_MODELS.includes(model) && currentLayer.layerAiVideoType === 'sound_effect') {
    currentLayer.soundEffectGenerationPending = false;
    currentLayer.hasSoundEffect = true;
    currentLayer.aiVideoGenerationPending = false;
    currentLayer.aiVideoGenerationStatus = 'COMPLETED';
    currentLayer.soundEffectVideoGenerationStatus = 'COMPLETED';
    // Mirror native sound-effect outputs into the generic AI-video fields so
    // downstream express listeners treat the layer as fully rendered.
    currentLayer.hasAiVideoLayer = true;
    currentLayer.aiVideoLayer = localVideoLink;
    currentLayer.aiVideoRemoteLink = remoteAIVideoLink;
    currentLayer.soundEffectRemoteLink = remoteAIVideoLink;
    currentLayer.soundEffectVideoLayer = localVideoLink;
    currentLayer.soundEffectThumbnailPath = startFrameGenerationPath;
    currentLayer.soundEffectEndThumbnailPath = lastFrameGenerationPath;
    currentLayer.soundEffectThumbnailVideo = thumbnailVideoPath;
  } else if (LIPSYNC_MODELS.includes(model)) {
    currentLayer.lipSyncGenerationPending = false;
    currentLayer.hasLipSyncVideoLayer = true;
    currentLayer.lipSyncVideoLayer = localVideoLink;
    currentLayer.lipSyncRemoteLink = remoteAIVideoLink;
    currentLayer.lipSyncVideoGenerationStatus = 'COMPLETED';
    currentLayer.lipSyncThumbnailPath = startFrameGenerationPath;
    currentLayer.lipSyncEndThumbnailPath = lastFrameGenerationPath;
    currentLayer.lipSyncThumbnailVideo = thumbnailVideoPath;
  } else {
    Object.assign(currentLayer, buildBaseAiVideoCompletionUpdate({
      localVideoLink,
      remoteAIVideoLink,
      startFrameGenerationPath,
      lastFrameGenerationPath,
      thumbnailVideoPath,
    }));
  }

  currentLayer.frameGenerationPending = true;



  if (shouldPreserveLipSyncTimeline) {
    const oldDuration = currentLayer.duration;
    currentLayer.duration = resolveCompletedLayerDuration({
      currentLayerDuration: currentLayer.duration,
      generatedLayerDuration,
      generatedFrameCount,
      generatedFrameDuration,
      framesPerSecond,
      model,
      isAudioVideoGeneration,
    });
    const resolvedDurationDiff = currentLayer.duration - oldDuration;
    if (Math.abs(resolvedDurationDiff) > 0.000001) {
      payload.durationDiff = resolvedDurationDiff;
      payload.frameDurationDiff = Math.floor(resolvedDurationDiff * framesPerSecond);
      videoSession.totalDuration = recalculateLayerOffsetsAndConnectedAudio(
        videoSession.layers,
        videoSession.audioLayers
      );
    } else {
      payload.durationDiff = 0;
      payload.frameDurationDiff = 0;
    }
  } else if (durationDiff !== 0 || clipLayerToAiVideo) {



    const oldDuration = currentLayer.duration;
    const newDuration = payload.duration;
    const durationDiffToUpdate = newDuration - oldDuration;

    currentLayer.duration = newDuration;




    let nextLayerDurationOffset = currentLayer.durationOffset + currentLayer.duration;



    for (let i = currentLayerIndex + 1; i < videoSession.layers.length; i++) {

      let nextLayer = videoSession.layers[i];
      const nextLayerDuration = nextLayer.duration;

      nextLayer.durationOffset = nextLayerDurationOffset;

      nextLayerDurationOffset += nextLayerDuration;
    }
  }



  const lastPathGenPayload = {
    src: lastFrameGenerationPath,
    width: canvasWidth,
    height: canvasHeight,
  }

  videoSession.generations.push(lastPathGenPayload);


  let isSpeechEffectModel = false;

  if (LIPSYNC_MODELS.includes(model)) {
    currentLayer.lipSyncGenerationPending = false;
    currentLayer.hasLipSyncVideoLayer = true;
  }

  if (SOUND_EFFECT_MODELS.includes(model) && currentLayer.layerAiVideoType === 'sound_effect') {
    isSpeechEffectModel = true;

    currentLayer.soundEffectGenerationPending = false;
    currentLayer.hasSoundEffectVideoLayer = true;
  }

  if (!isLipSyncModel && !isSpeechEffectModel && currentLayer.layerBaseAiImageType === 'character') {
    currentLayer.layerAiVideoType = 'character';
  }



  videoSession.layers[currentLayerIndex] = currentLayer;


  const result = await VideoSession.updateOne(
    { _id: sessionId, },
    {
      $set: {
        layers: videoSession.layers,
        audioLayers: videoSession.audioLayers,
        generations: videoSession.generations,
        totalDuration: videoSession.totalDuration,
      },
    }
  );

  if (result.nModified === 0) {
    throw new Error('Concurrency conflict or no changes were made.');
  }



  if (isAudioVideoGeneration && !shouldPreserveLipSyncTimeline) {

    await realignAudioVideoLayerToVideoLayer(payload);
  }
  if (videoSession.isVidGPTGen || videoSession.isExpressGeneration) {



    await realignAudioLayersToLayers(payload);
  } 

}


async function realignAudioLayersToLayers(payload) {

  const {
    sessionId,
  } = payload;

  await getDBConnectionString();



  const sessionData = await VideoSession.findById(sessionId);

  let sessionAudioLayers = sessionData.audioLayers;

  const sessionLayers = sessionData.layers;

  for (let i = 0; i < sessionAudioLayers.length; i++) {
    let currentAudioLayer = sessionAudioLayers[i];
    const audioLayerDuration = typeof currentAudioLayer.duration === 'number' ? currentAudioLayer.duration : 0;
    if (currentAudioLayer.connectedLayerId) {
      const connectedLayer = sessionLayers.find(layer => layer._id.toString() === currentAudioLayer.connectedLayerId);

      if (connectedLayer) {
        const layerStartTime = typeof connectedLayer.durationOffset === 'number'
          ? connectedLayer.durationOffset
          : 0;
        const layerDuration = typeof connectedLayer.duration === 'number'
          ? connectedLayer.duration
          : 0;
        const clampedAudioLayerDuration = resolveConnectedAudioLayerDuration({
          generationType: currentAudioLayer.generationType,
          generatedAudioDuration: audioLayerDuration,
          layerDuration,
        });

        if (currentAudioLayer.generationType === 'speech') {
          const durationDiff = layerDuration - clampedAudioLayerDuration;
          const audioStartOffset = durationDiff > 0 ? (durationDiff / 2) : 0;
          sessionAudioLayers[i].startTime = layerStartTime + audioStartOffset;
          sessionAudioLayers[i].duration = clampedAudioLayerDuration;
          sessionAudioLayers[i].endTime = sessionAudioLayers[i].startTime + clampedAudioLayerDuration;
          sessionAudioLayers[i].connectedLayerStartTimeOffset = audioStartOffset;
        } else {
          sessionAudioLayers[i].startTime = layerStartTime;
          sessionAudioLayers[i].endTime = layerStartTime + layerDuration;
          sessionAudioLayers[i].duration = layerDuration;
        }
      }
    }
  }

  await VideoSession.updateOne({
    _id: sessionId
  }, {
    $set: {
      audioLayers: sessionAudioLayers
    }
  });


}



export async function realignAudioVideoLayerToVideoLayer(payload) {

  await getDBConnectionString();


  const {
    audioVideoAudioLink,
    model,
    layerId,
    sessionId,
    prompt,
    duration,              // This is the audio’s duration
    aspectRatio = '1:1',   // If you need dimension data
  } = payload;

  const audioPath = audioVideoAudioLink;


  let videoSession = await VideoSession.findById(sessionId);
  if (!videoSession) return;

  const currentLayerIndex = videoSession.layers.findIndex(
    layer => layer._id.toString() === layerId
  );
  if (currentLayerIndex < 0) return;

  let currentLayer = videoSession.layers[currentLayerIndex];
  // 5) Replace any existing audio layer for this connectedLayer
  let connectedAudioLayer = videoSession.audioLayers.find(
    al => al.connectedLayerId === currentLayer._id.toString()
  );
  if (connectedAudioLayer) {
	    let generationType = ((SOUND_EFFECT_MODELS.includes(model) && currentLayer.layerAiVideoType === 'sound_effect'))
	      ? 'sound_effect'
	      : 'speech';

    const layerStartTime = typeof currentLayer.durationOffset === 'number' ? currentLayer.durationOffset : 0;
    const layerDuration = typeof currentLayer.duration === 'number' ? currentLayer.duration : 0;
    const generatedAudioDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : layerDuration;
    const audioLayerDuration = resolveConnectedAudioLayerDuration({
      generationType,
      generatedAudioDuration,
      layerDuration,
    });
    if (generationType === 'sound_effect' && generatedAudioDuration > audioLayerDuration) {
    }
    const durationDiff = layerDuration - audioLayerDuration;
    const audioStartOffset = (generationType === 'speech' && durationDiff > 0) ? (durationDiff / 2) : 0;
    const newAudioLayerStartTime = layerStartTime + audioStartOffset;
    const newAudioLayerEndTime = newAudioLayerStartTime + audioLayerDuration;

	    const defaultVolume = generationType === 'sound_effect' ? 30 : 100;
    const existingVolume = Number(connectedAudioLayer.volume);
	    const volume = Number.isFinite(existingVolume) ? existingVolume : defaultVolume;
	    let fadeOnEdges = generationType === 'sound_effect';

    const audioRelativePath = toProcessorAssetRelativePath(audioPath);




    connectedAudioLayer.startTime = newAudioLayerStartTime;
    connectedAudioLayer.endTime = newAudioLayerEndTime;
    connectedAudioLayer.duration = audioLayerDuration;
    connectedAudioLayer.connectedLayerStartTimeOffset = audioStartOffset;
    connectedAudioLayer.generationStatus = 'COMPLETED';
    connectedAudioLayer.fadeOnEdges = fadeOnEdges;
    connectedAudioLayer.volume = volume;
    connectedAudioLayer.localAudioLinks = [audioRelativePath];
    connectedAudioLayer.selectedLocalAudioLink = audioRelativePath;
    connectedAudioLayer.isEnabled = true;
    connectedAudioLayer.isLayerLocked = true;
    connectedAudioLayer.defaultSelected = true;



    const connectedAudioLayerId = connectedAudioLayer._id.toString();


    await VideoSession.updateOne(
      {
        _id: sessionId,
        "audioLayers._id": connectedAudioLayerId
      },
      {
        $set: {
          "audioLayers.$": connectedAudioLayer
        }
      },
    );

  } else {

    let generationType = SOUND_EFFECT_MODELS.includes(model) && currentLayer.layerAiVideoType === 'sound_effect'
      ? 'sound_effect'
      : 'speech';




    let volume = generationType === 'sound_effect' ? 30 : 100;
    let fadeOnEdges = generationType === 'sound_effect';

    const audioRelativePath = toProcessorAssetRelativePath(audioPath);

    const layerStartTime = typeof currentLayer.durationOffset === 'number' ? currentLayer.durationOffset : 0;
    const layerDuration = typeof currentLayer.duration === 'number' ? currentLayer.duration : 0;
    const generatedAudioDuration = Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : layerDuration;
    const audioLayerDuration = resolveConnectedAudioLayerDuration({
      generationType,
      generatedAudioDuration,
      layerDuration,
    });
    if (generationType === 'sound_effect' && generatedAudioDuration > audioLayerDuration) {
    }
    const durationDiff = layerDuration - audioLayerDuration;
    const audioStartOffset = (generationType === 'speech' && durationDiff > 0) ? (durationDiff / 2) : 0;
    const newAudioLayerStartTime = layerStartTime + audioStartOffset;

    const newAudioLayer = {
      connectedLayerId: layerId,
      startTime: newAudioLayerStartTime,
      endTime: newAudioLayerStartTime + audioLayerDuration,
      duration: audioLayerDuration,
      connectedLayerStartTimeOffset: audioStartOffset,
      generationType: generationType,
      generationStatus: 'COMPLETED',
      fadeOnEdges: fadeOnEdges,
      volume: volume,
      localAudioLinks: [audioRelativePath],
      selectedLocalAudioLink: audioRelativePath,
      isEnabled: true,
      isLayerLocked: true,
      defaultSelected: true,
      prompt: prompt
    };

    videoSession.audioLayers.push(newAudioLayer);

    await videoSession.save();


  }
}



async function copyFrameToGenerations(lastFramePath, sessionId) {
  const pwd = process.cwd();

  const randStr = Math.random().toString(36).substring(7);
  const newImageName = `generation_${Date.now()}_${randStr}.png`

  const newImageRelativePath = path.posix.join('assets_v2', 'generations', sessionId.toString(), newImageName);

  let newImagePath = path.join(pwd, '../', 'samsar_processor', 'assets_v2', 'generations', sessionId.toString(), newImageName);

  if (usesLocalAssetStorage()) {
    newImagePath = path.join(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2', 'generations', sessionId.toString(), newImageName);
  }

  fs.mkdirSync(path.dirname(newImagePath), { recursive: true });

  // copy the last frame to the generations folder as newImageName
  await copyFile(lastFramePath, newImagePath);

  return newImageRelativePath;
}

async function replaceActiveItemNextLayer(payload, newImageRelativePath, combineLayers) {
  const { sessionId, layerId, aspectRatio } = payload;

  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  await getDBConnectionString();
  let videoSession = await VideoSession.findById(sessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);


  let nextLayer = videoSession.layers[currentLayerIndex + 1];

  if (nextLayer && shouldCarryGeneratedLastFrameToNextLayer(payload, nextLayer)) {
    const newId = `item_0`;

    const newImageName = newImageRelativePath.split('/').pop();

    nextLayer.activeSelectedImage = newImageRelativePath;
    nextLayer.activeGeneratedImage = newImageName;

    if (combineLayers) {
      nextLayer.imageSession.activeItemList = [{
        type: 'image',
        src: newImageRelativePath,
        x: 0,
        y: 0,
        width: canvasDimensions.width,
        height: canvasDimensions.height,
        id: newId
      }];

    } else {
      // replace the first item of type image from nextLayer.imageSession.activeItemList only the first one
      let newActiveItemList = [];
      let imageFiltered = false;

      for (let i = 0; i < nextLayer.imageSession.activeItemList.length; i++) {
        const item = nextLayer.imageSession.activeItemList[i];
        if (item.type === 'image' && !imageFiltered) {
          const itemAnimations = item.animations;
          let newItemAnimations = [];
          if (itemAnimations && itemAnimations.length > 0) {
            newItemAnimations = modifyAnimationsForNextLayer(itemAnimations);
          }
          imageFiltered = true;
          newActiveItemList.push({
            type: 'image',
            src: newImageRelativePath,
            x: 0,
            y: 0,
            width: canvasDimensions.width,
            height: canvasDimensions.height,
            id: newId,
            animations: newItemAnimations
          });
          continue;
        }
        newActiveItemList.push(item);
      }
      nextLayer.imageSession.activeItemList = newActiveItemList;
    }
    nextLayer.frameGenerationPending = true;
    videoSession.layers[currentLayerIndex + 1] = nextLayer;
    videoSession.frameGenerationPending = true;

    await videoSession.save();


  }
}


async function updateNextLayersAudioAndAnimationDurations(payload, durationDiff) {
  const { sessionId, layerId } = payload;



  await getDBConnectionString();
  let videoSession = await VideoSession.findById(sessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);

  const isVidGPTGen = videoSession.isVidGPTGen || videoSession.isExpressGeneration;

  if (!isVidGPTGen) {
    return;
  }

  let speechAudioLayers = videoSession.audioLayers.filter(layer => layer.generationType === 'speech');



  for (let i = currentLayerIndex + 1; i < videoSession.layers.length; i++) {
    let nextLayer = videoSession.layers[i];
    if (!nextLayer) {
      continue;
    }
    // see this this may be it
    //nextLayer.durationOffset += durationDiff;

    let nextLayerTextItems = nextLayer.imageSession.activeItemList.filter(item => item.type === 'text');

    const durationDiffInFrames = Math.floor(durationDiff * framesPerSecond);

    for (let j = 0; j < nextLayerTextItems.length; j++) {
      const textItem = nextLayerTextItems[j];

      textItem.config.frameOffset += durationDiffInFrames;

    }

    nextLayer.frameGenerationPending = true;
  }





  for (let i = currentLayerIndex; i < videoSession.layers.length; i++) {

    let speechAudioLayer;

    const currentLayer = videoSession.layers[i];
    const currentLayerId = currentLayer._id.toString();

    if (isVidGPTGen) {
      speechAudioLayer = speechAudioLayers.find(layer => layer.connectedLayerId === currentLayerId);
    } else {
      speechAudioLayer = speechAudioLayers[i];
    }

    if (speechAudioLayer) {



      const layerStartTime = typeof currentLayer.durationOffset === 'number'
        ? currentLayer.durationOffset
        : 0;
      const layerDuration = typeof currentLayer.duration === 'number'
        ? currentLayer.duration
        : 0;
      const speechDuration = typeof speechAudioLayer.duration === 'number'
        ? speechAudioLayer.duration
        : 0;
      const durationDiff = layerDuration - speechDuration;
      const audioStartOffset = durationDiff > 0 ? (durationDiff / 2) : 0;

      speechAudioLayer.startTime = layerStartTime + audioStartOffset;
      speechAudioLayer.endTime = speechAudioLayer.startTime + speechAudioLayer.duration;
      speechAudioLayer.connectedLayerStartTimeOffset = audioStartOffset;


    }
  }


  videoSession.markModified('audioLayers');
  videoSession.markModified('layers');
  const sessionSaveResponse = await videoSession.save();


}

/**
 * Decides which failure handler to invoke (lip sync vs. base).
 */
async function processVideoGenerationFailed(payload) {
  await getDBConnectionString();

  const { sessionId, layerId } = payload;

  const videoSession = await VideoSession.findById(sessionId);

  if (!videoSession) {
    console.error('Session not found; cannot handle generation fail properly.');
    await AIVideoLayerGeneration.findByIdAndUpdate(payload._id, { status: 'FAILED' });
    return;
  }

  const currentLayerIndex = videoSession.layers.findIndex((layer) => layer._id.toString() === layerId);
  if (currentLayerIndex < 0) {
    console.error('Layer not found; cannot handle generation fail properly.');

    await AIVideoLayerGeneration.findOneAndDelete({ _id: payload._id });
    return;

  }
  let currentLayer = videoSession.layers[currentLayerIndex];


  const { model } = payload;
  if (isStaleSoundEffectGenerationForLayer({
    model,
    isAudioVideoGeneration: payload?.isAudioVideoGeneration,
    currentLayer,
  })) {
    await AIVideoLayerGeneration.findByIdAndDelete(payload._id);
    return;
  }

  const isLipOrSoundEffectSyncModel = LIPSYNC_MODELS.includes(model) || (
    SOUND_EFFECT_MODELS.includes(model) && currentLayer.layerAiVideoType === 'sound_effect'
  );

  if (isLipOrSoundEffectSyncModel) {
    await processLipSyncGenerationFailed(payload);
  } else {
    await processBaseGenerationFailed(payload);
  }
}

export function getRetryLipSyncModel(model) {
  if (model === 'HUMMINGBIRDLIPSYNC') {
    return 'SYNCLIPSYNC';
  }
  if (model === 'SYNCLIPSYNC') {
    return 'HUMMINGBIRDLIPSYNC';
  }
  return model;
}

async function processLipSyncGenerationFailed(payload) {
  await getDBConnectionString();




  const { sessionId, layerId, _id, numRetries, retryOnFail, model, prompt, requestSubmitAt, createdAt } = payload;
  const generationId = _id.toString();
  const lastRequestTime = requestSubmitAt || createdAt;
  const providerTimedOut = Boolean(lastRequestTime) &&
    (Date.now() - new Date(lastRequestTime).getTime()) > MAX_LIPSYNC_PROVIDER_PENDING_MS;



  // 1) Fetch session/layer only once
  const videoSession = await VideoSession.findById(sessionId);
  if (!videoSession) {
    console.error('Session not found; cannot handle lip sync fail properly.');
    await AIVideoLayerGeneration.findByIdAndUpdate(_id, { status: 'FAILED' });
    return;
  }
  const currentLayerIndex = videoSession.layers.findIndex((layer) => layer._id.toString() === layerId);
  if (currentLayerIndex < 0) {
    console.error('Layer not found; cannot handle lip sync fail properly.');
    await AIVideoLayerGeneration.findByIdAndUpdate(_id, { status: 'FAILED' });
    return;
  }
  let currentLayer = videoSession.layers[currentLayerIndex];
  const failureMessage = getProviderFailureMessage(payload, `${model || 'Lip sync'} generation failed.`);

  // 2) If we can retry
  const shouldRetryLipSyncFailure = retryOnFail && !isSamsarExternalVideoRequest(payload);
  if (shouldRetryLipSyncFailure && numRetries < 3 && !providerTimedOut) {
    await getTimeout(1000);

    const newModel = getRetryLipSyncModel(model);
    const newPrompt = prompt;

    await AIVideoLayerGeneration.findByIdAndUpdate(generationId, {
      status: 'INIT',
      prompt: newPrompt,
      numRetries: numRetries + 1,
      model: newModel,
      rowLocked: false,
      generationId: null,
      expireAt: new Date(),
    });
    return;
  }

  if (providerTimedOut) {
  }

  if (SOUND_EFFECT_MODELS.includes(model) && currentLayer.layerAiVideoType === 'sound_effect') {
    currentLayer.hasSoundEffectVideoLayer = false;
    currentLayer.soundEffectGenerationPending = false;
    currentLayer.soundEffectVideoGenerationStatus = 'FAILED';
    currentLayer.soundEffectVideoGenerationError = failureMessage;
    currentLayer.layerAiVideoType = 'ai_video';
    currentLayer.hasAiVideoLayer = true;
  } else if (LIPSYNC_MODELS.includes(model)) {

    currentLayer.hasLipSyncVideoLayer = false;
    currentLayer.lipSyncGenerationPending = false;
    currentLayer.lipSyncVideoGenerationStatus = 'FAILED';
    currentLayer.lipSyncVideoGenerationError = failureMessage;
  }

  console.error('[lip_sync][generation_failed] marking lip/sound-effect video generation failed', {
    sessionId,
    layerId,
    generationId,
    model,
    retryOnFail,
    numRetries,
    providerTimedOut,
    failureMessage,
    providerFailureDetail: payload?.lastProviderFailureDetail || null,
  });



  


  videoSession.layers[currentLayerIndex] = currentLayer;
  await videoSession.save();

  // Remove the generation doc
  await AIVideoLayerGeneration.findByIdAndDelete(_id);
}



async function processBaseGenerationFailed(payload) {
  await getDBConnectionString();

  const { sessionId, layerId, _id, model, prompt } = payload;

  // Always read the freshest generation doc (avoid branching on stale payload.numRetries)
  const genDoc = await AIVideoLayerGeneration.findById(_id).lean();
  if (!genDoc) {
    // Nothing to do; generation doc already gone
    return;
  }

  if (await requeueNextDockerVideoAdapterAfterDefinitiveFailure(payload, genDoc)) {
    return;
  }

  const tries = Number.isFinite(Number(genDoc.numRetries)) ? Number(genDoc.numRetries) : Number(payload.numRetries || 0);

  // Fetch session + layer once
  const videoSession = await VideoSession.findById(sessionId);
  if (!videoSession) {
    console.error('Session not found; cannot handle base generation fail properly.');
    await AIVideoLayerGeneration.findByIdAndUpdate(_id, { status: 'FAILED' });
    return;
  }

  const currentLayerIndex = videoSession.layers.findIndex((ly) => ly._id.toString() === String(layerId));
  if (currentLayerIndex < 0) {
    console.error('Layer not found; cannot handle base generation fail properly.');
    // Best-effort cleanup of the generation doc
    await AIVideoLayerGeneration.findByIdAndDelete(_id);
    return;
  }

  const currentLayer = videoSession.layers[currentLayerIndex];
  const willRetry = shouldRetryBaseGeneration({
    generation: genDoc,
    payload,
    videoSession,
    model,
  });

  if (
    !isStandaloneEdition() &&
    await fallbackGoogleNativeVeo3Generation(payload, 'Google native Veo generation failed.')
  ) {
    return;
  }

  if (await fallbackCustomAiVideoGeneration(payload, 'Custom image-to-video generation failed.')) {
    return;
  }

  let retryPreparationFailureMessage = '';

  // ---------------------------
  // RETRY PATH after attempts 1 and 2, if allowed. The initial request plus
  // two retries gives every layer at most three provider attempts in total.
  // ---------------------------
  if (willRetry && hasRemainingBaseGenerationAttempts(tries)) {
    let newModel = model;
    let newPrompt = prompt;
    let retryPreparationSucceeded = true;
    const retryUpdate = {
      status: 'INIT',
      numRetries: tries + 1,
      rowLocked: false,
      generationId: null,
      nextAttemptAfter: new Date(Date.now() + getExplicitFailureRetryBackoffMs(tries)),
      expireAt: new Date(),
    };

    // On the last permitted retry, adjust model/prompt before attempt 3.
    if (tries === MAX_BASE_GENERATION_ATTEMPTS - 2) {
      if (newModel === 'VEO3.1I2V') newModel = 'VEO3.1I2VFAST';
    }

    const hasQueuedFallbackCandidates = Array.isArray(genDoc.fallbackStartImages) &&
      genDoc.fallbackStartImages.length > 0;
    const fallbackCandidates = hasQueuedFallbackCandidates
      ? genDoc.fallbackStartImages
      : currentLayer?.filterPasses;
    const previouslyAttemptedFallbackSources = Array.isArray(genDoc.attemptedFallbackStartImageSources)
      ? genDoc.attemptedFallbackStartImageSources
      : [];
    const excludeSources = [
      ...(Array.isArray(genDoc.initialStartImageSources) ? genDoc.initialStartImageSources : []),
      ...getLayerActiveImageSources(currentLayer),
      ...previouslyAttemptedFallbackSources,
    ];
    const fallbackPreparation = await prepareRankedFallbackImage({
      candidates: fallbackCandidates,
      excludeSources,
      prepareImage: async (chosen) => {
        const absolutePath = getFilterPassGenerationAssetPath(chosen.src);
        if (!absolutePath) {
          throw new Error('Selected filter pass did not include a usable src');
        }
        return uploadFrameLayerImageToCDN(absolutePath, chosen.src);
      },
    });
    const attemptedFallbackStartImageSources = [
      ...previouslyAttemptedFallbackSources,
      ...fallbackPreparation.attemptedSources,
    ].filter((src, index, all) => src && all.indexOf(src) === index);
    retryUpdate.attemptedFallbackStartImageSources = attemptedFallbackStartImageSources;

    const selectedFilterPass = fallbackPreparation.selection;
    let retryPromptCandidate = selectedFilterPass?.pass || null;
    if (selectedFilterPass?.pass) {
      const chosen = selectedFilterPass.pass;
      retryUpdate.startImage = fallbackPreparation.startImage;
      retryUpdate.aiVideoRetryFilterPassRank = chosen.rank;
      retryUpdate.aiVideoRetryFilterPassScore = chosen.score;
      retryUpdate.aiVideoRetryFilterPassSrc = chosen.src;
      retryUpdate.startImageDescription = chosen.description || '';
    } else {
      // A definitively failed provider attempt may retry the same prepared
      // start image. Each retry has a distinct attempt id and deterministic
      // backoff, so it is not a duplicate submission of an unknown outcome.
      retryPromptCandidate = {
        description: getRetryStartImageDescription(null, currentLayer) ||
          firstNonEmptyString(
            genDoc.startImageDescription,
            genDoc.promptSeedContext?.startImageDescription,
          ),
      };
      retryUpdate.aiVideoPromptOnlySameImageRetry = true;
      for (const preparationError of fallbackPreparation.preparationErrors) {
        console.warn(
          'AI-video fallback image preparation failed; retrying the original start image:',
          preparationError,
        );
      }
    }

    if (payload.lastProviderFailureMessage) {
      retryUpdate.lastProviderFailureMessage = payload.lastProviderFailureMessage;
    }
    if (payload.lastProviderFailureDetail) {
      retryUpdate.lastProviderFailureDetail = payload.lastProviderFailureDetail;
    }

    if (retryPreparationSucceeded) {
      const regeneratedPrompt = await regenerateBaseGenerationPromptForRetry({
        videoSession,
        request: genDoc,
        fallbackRequest: payload,
        currentLayer,
        currentLayerIndex,
        selectedFilterPass: retryPromptCandidate,
        fallbackPrompt: prompt,
      });
      if (regeneratedPrompt) {
        newPrompt = regeneratedPrompt;
        retryUpdate.aiVideoRetryPromptRegenerated = true;
      }
    }

    if (retryPreparationSucceeded && tries === MAX_BASE_GENERATION_ATTEMPTS - 2 && newPrompt === prompt) {
      const retryInferenceSettings = await getInferenceSettingsForSession(
        videoSession,
        genDoc,
        payload,
      );
      const alternatePrompt = await getAlternateVideoPrompt(
        prompt,
        retryInferenceSettings.model,
        retryInferenceSettings.authorization,
      );
      if (alternatePrompt) {
        newPrompt = alternatePrompt;
      }
    }

    if (retryPreparationSucceeded) {
      const layerRetryMetadata = {
        "layers.$.videoGenerationPrompt": newPrompt,
        "layers.$.aiVideoRetryFilterPassRank": selectedFilterPass?.pass?.rank ?? null,
        "layers.$.aiVideoRetryFilterPassScore": selectedFilterPass?.pass?.score ?? null,
        "layers.$.aiVideoRetryFilterPassSrc": selectedFilterPass?.pass?.src ?? null,
        "layers.$.aiVideoRetryStartImageDescription": retryPromptCandidate?.description || '',
      };
      await VideoSession.updateOne(
        { _id: sessionId, "layers._id": layerId },
        { $set: layerRetryMetadata },
      );

      // Re-queue the image and its regenerated prompt atomically.
      await AIVideoLayerGeneration.findByIdAndUpdate(_id, {
        $set: {
          ...retryUpdate,
          prompt: newPrompt,
          model: newModel,
        },
        $unset: {
          lastTransientProviderErrorAt: '',
          lastTransientProviderErrorStatus: '',
          lastTransientProviderErrorMessage: '',
          transientProviderErrorPhase: '',
        },
      });

      return;
    }
  }

  // ---------------------------
  // HARD-FAIL PATH (tries exceeded) OR retry not allowed
  // ---------------------------
  try {
    const providerFailureMessage = firstNonEmptyString(
      payload.lastProviderFailureMessage,
      genDoc.lastProviderFailureMessage,
    );
    const failureMessage = buildBaseGenerationFailureMessage({
      tries,
      providerFailureMessage,
      retryPreparationFailureMessage,
    });

    const layerUpdate = buildBaseGenerationTerminalFailureUpdate(currentLayer, failureMessage);

    await VideoSession.updateOne(
      { _id: sessionId, "layers._id": layerId },
      { $set: layerUpdate }
    );

    // Optional: reflect final status on the generation doc before deletion
    await AIVideoLayerGeneration.findByIdAndUpdate(_id, {
      status: 'FAILED'
    });
  } finally {
    // Ensure the generation doc is removed even if the layer update throws
    await AIVideoLayerGeneration.findByIdAndDelete(_id).catch(() => { });
  }

}

async function isSessionReadyForLipSync(sessionId, layerId) {
  if (!sessionId) {
    return { ready: false, missingRequiredBaseLayer: false };
  }

  const sessionData = await VideoSession.findById(sessionId).select('layers expressGenerativeVideoRequired');
  if (!sessionData) {
    return { ready: false, missingRequiredBaseLayer: false };
  }

  const requireAiVideoOutput = sessionData.expressGenerativeVideoRequired;
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];

  const ready = !layers.some((layer) =>
    isBaseLayerAwaitingRender(layer, requireAiVideoOutput)
  );

  let missingRequiredBaseLayer = false;
  if (layerId && requireAiVideoOutput) {
    const layerIdStr = String(layerId);
    const targetLayer = layers.find((layer) => layer?._id && String(layer._id) === layerIdStr);
    if (targetLayer && requiresBaseAiVideoLayer(targetLayer)) {
      const baseJobPending = Boolean(targetLayer.aiVideoGenerationPending);
      if (!baseJobPending && !targetLayer.aiVideoLayer) {
        missingRequiredBaseLayer = true;
      }
    }
  }

  return {
    ready,
    missingRequiredBaseLayer
  };
}
