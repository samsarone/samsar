import { getDBConnectionString } from '../DBString.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';
import { processSessionCompletionFailure } from '../ExpressSessionStateUpdater.js';
import { getCanonicalAiVideoReference } from './utils/ProviderMediaUrl.js';
import {
  hasReusableBaseAiVideo,
  hasSoundEffectOutput,
  isSoundEffectLayer,
} from './SoundEffectStage.js';

const ACTIVE_GENERATION_STATUSES = ['INIT', 'PENDING'];

function normalizeId(value) {
  return value?.toString?.().trim?.() || null;
}

export function buildSoundEffectGenerationPayload({
  userId,
  sessionId,
  currentLayer,
  audioPrompt,
  aspectRatio,
  model,
  videoUrl,
}) {
  return {
    model,
    prompt: audioPrompt,
    duration: currentLayer.duration,
    videoLink: videoUrl,
    generationType: 'sound_effect',
    samsarExternalProviderStage: 'sound_effect_generation',
    samsarExternalVideoRoute: 'sound_effect',
    isAudioVideoGeneration: true,
    useStartFrame: false,
    useEndFrame: false,
    sessionId,
    layerId: currentLayer._id,
    userId,
    aspectRatio,
    isExpressGeneration: true,
    isVideoGPTGeneration: true,
    retryOnFail: false,
  };
}

async function markSoundEffectLayerFailed(sessionId, layerId, error) {
  const message = error?.message || String(error || 'Sound-effect generation failed.');
  await VideoSession.updateOne(
    { _id: sessionId, 'layers._id': layerId },
    {
      $set: {
        'layers.$.soundEffectGenerationPending': false,
        'layers.$.hasSoundEffectVideoLayer': false,
        'layers.$.soundEffectVideoGenerationStatus': 'FAILED',
        'layers.$.soundEffectVideoGenerationError': message,
        lastSoundEffectGenerationError: message,
      },
    },
  );
}

async function markSoundEffectStageFailed(sessionId, error) {
  const message = error?.message || String(error || 'Sound-effect generation failed.');
  const now = new Date();
  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        'expressGenerationStatus.sound_effect_generation': 'FAILED',
        'expressGenerationStatus.status': 'FAILED',
        soundEffectGenerationPending: false,
        expressGenerationPending: false,
        expressGenerationFailed: true,
        expressGenerationError: message,
        lastSoundEffectGenerationError: message,
        'expressStepGeneration.status': 'FAILED',
        'expressStepGeneration.currentStep': 'sound_effect_generation',
        'expressStepGeneration.current_step': 'sound_effect_generation',
        'expressStepGeneration.currentStepLabel': 'Sound effect',
        'expressStepGeneration.current_step_label': 'Sound effect',
        'expressStepGeneration.error': message,
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
}

export async function generateSoundEffectsForSession(sessionId) {
  await getDBConnectionString();

  try {
    const sessionData = await VideoSession.findOne({ _id: sessionId });
    if (!sessionData) {
      throw new Error(`VideoSession with ID ${sessionId} not found`);
    }

    const userId = sessionData.userId;
    const aspectRatio = sessionData.aspectRatio;
    const sessionSoundEffectLayers = (Array.isArray(sessionData.layers) ? sessionData.layers : [])
      .filter((layer) => (
        isSoundEffectLayer(layer)
        && !layer.isAudioVideoLayer
        && hasReusableBaseAiVideo(layer)
        && !hasSoundEffectOutput(layer)
      ));

    for (const currentLayer of sessionSoundEffectLayers) {
      try {
        await generateSoundEffectsForLayer({
          userId,
          sessionId,
          currentLayer,
          audioPrompt: currentLayer.layerAISoundEffectPrompt,
          aspectRatio,
        });
      } catch (error) {
        await markSoundEffectLayerFailed(sessionId, currentLayer._id, error);
        throw error;
      }
    }
  } catch (error) {
    console.error('[sound_effect][request_enqueue] failed to create generation request', {
      sessionId,
      error: error?.message || error,
      stack: error?.stack,
    });
    await markSoundEffectStageFailed(sessionId, error);
    await processSessionCompletionFailure(sessionId);
  }
}

export async function generateSoundEffectsForLayer({
  userId,
  sessionId,
  currentLayer,
  audioPrompt,
  aspectRatio,
}) {
  if (!hasReusableBaseAiVideo(currentLayer)) {
    throw new Error(
      `Sound-effect layer ${normalizeId(currentLayer?._id) || 'unknown'} has no reusable base AI video.`,
    );
  }

  const videoUrl = getCanonicalAiVideoReference({ layer: currentLayer, userId });
  if (!videoUrl) {
    throw new Error(
      `Sound-effect layer ${normalizeId(currentLayer?._id) || 'unknown'} has no canonical provider video reference.`,
    );
  }

  const userData = await User.findById(userId);
  const model = userData?.agentSoundEffectModel || 'MIRELOAI';
  const generationPayload = buildSoundEffectGenerationPayload({
    userId,
    sessionId,
    currentLayer,
    audioPrompt,
    aspectRatio,
    model,
    videoUrl,
  });

  const existingRequest = await AIVideoLayerGeneration.findOne({
    sessionId: normalizeId(sessionId),
    layerId: normalizeId(currentLayer._id),
    status: { $in: ACTIVE_GENERATION_STATUSES },
  }).sort({ createdAt: -1 });

  await VideoSession.updateOne(
    { _id: sessionId, 'layers._id': currentLayer._id },
    {
      $set: {
        'layers.$.soundEffectGenerationPending': true,
        'layers.$.soundEffectVideoGenerationStatus': 'PENDING',
        'layers.$.soundEffectVideoGenerationError': null,
      },
    },
  );

  if (existingRequest) {
    console.log('[sound_effect][request_enqueue] reusing active generation request', {
      sessionId: normalizeId(sessionId),
      layerId: normalizeId(currentLayer._id),
      generationRequestId: normalizeId(existingRequest._id),
      status: existingRequest.status || null,
    });
    return existingRequest;
  }

  console.log('[sound_effect][request_enqueue] creating generation request', {
    sessionId: normalizeId(sessionId),
    layerId: normalizeId(currentLayer._id),
    model,
    generationType: generationPayload.generationType,
    route: generationPayload.samsarExternalVideoRoute,
    stage: generationPayload.samsarExternalProviderStage,
    videoLink: videoUrl,
  });

  return AIVideoLayerGeneration.create(generationPayload);
}

export const __testOnly__ = {
  ACTIVE_GENERATION_STATUSES,
};
