import AudioGeneration from '../schema/AudioGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import { CUSTOM_AUDIO_ADAPTER_TYPES, listenToPendingCustomAudioRequest, submitCustomAudioRequest } from '../custom/CustomFalCompatibleAudio.js';
import { finalizeRemoteAudioGeneration, markAudioGenerationAsFailed } from './audioUtils.js';

async function markCustomMusicStageSuccess(sessionId) {
  if (!sessionId) {
    return;
  }
  await VideoSession.findByIdAndUpdate(sessionId, {
    $set: {
      'expressGenerationCustomStageResults.music_generation.status': 'CUSTOM_SUCCEEDED',
      'expressGenerationCustomStageResults.music_generation.completedAt': new Date(),
    },
  });
}

async function fallbackCustomMusicRequest(payload, errorMessage) {
  const fallbackModel = typeof payload?.customFallbackModel === 'string'
    ? payload.customFallbackModel.trim()
    : '';
  if (!fallbackModel) {
    return false;
  }

  await AudioGeneration.findByIdAndUpdate(payload._id, {
    model: fallbackModel,
    numRetries: 0,
    musicGenerationStatus: 'INIT',
    status: 'INIT',
    generationId: null,
    apiRequestId: null,
    customAdapterFallbackUsed: true,
    customAdapterError: errorMessage || null,
    rowLocked: false,
  });
  await VideoSession.findByIdAndUpdate(payload.sessionId, {
    $set: {
      'expressGenerationCustomStageResults.music_generation.fallbackUsed': true,
      'expressGenerationCustomStageResults.music_generation.fallbackAt': new Date(),
      'expressGenerationCustomStageResults.music_generation.error': errorMessage || null,
    },
  });
  return true;
}

async function retryOrDeleteFailedUpdate(payload, errorMessage) {
  const currentRetries = Number.isFinite(Number(payload?.numRetries))
    ? Number(payload.numRetries)
    : 0;

  if (currentRetries < 3) {
    await AudioGeneration.findByIdAndUpdate(payload._id, {
      numRetries: currentRetries + 1,
      musicGenerationStatus: 'INIT',
      status: 'INIT',
      generationId: null,
      apiRequestId: null,
      error: errorMessage || null,
      rowLocked: false,
    });
    return;
  }

  if (await fallbackCustomMusicRequest(payload, errorMessage || 'Custom music generation failed.')) {
    return;
  }

  await markAudioGenerationAsFailed(payload._id, errorMessage || 'Custom music generation failed.');
  await AudioGeneration.findByIdAndDelete(payload._id);
}

export async function dispatchAndProcessCustomMusicRequest(payload) {
  const { status } = payload;

  if (status === 'INIT') {
    try {
      const requestId = await submitCustomAudioRequest(
        payload,
        CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_MUSIC
      );

      await AudioGeneration.findOneAndUpdate(
        { _id: payload._id },
        {
          status: 'PENDING',
          musicGenerationStatus: 'PENDING',
          generationId: requestId,
          apiRequestId: requestId,
          rowLocked: false,
        }
      );
    } catch (error) {
      console.error('Failed to submit custom music request:', error);
      await retryOrDeleteFailedUpdate(payload, error?.message || 'Failed to submit custom music request.');
    }
    return;
  }

  if (status === 'PENDING') {
    let responseData;
    try {
      responseData = await listenToPendingCustomAudioRequest(
        payload,
        CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_MUSIC
      );
    } catch (error) {
      console.error(`Failed to poll custom music request ${payload.generationId}:`, error);
      responseData = {
        responseStatus: 'FAILED',
        error: error?.message || 'Failed to poll custom music request.',
      };
    }

    if (responseData?.remoteUrl) {
      await markCustomMusicStageSuccess(payload.sessionId);
      await finalizeRemoteAudioGeneration({
        sessionId: payload.sessionId,
        audioLayerId: payload.audioLayerId,
        audioGenerationId: payload._id,
        remoteAudioUrl: responseData.remoteUrl,
      });
      return;
    }

    if (responseData?.responseStatus === 'FAILED') {
      await retryOrDeleteFailedUpdate(payload, responseData.error);
      return;
    }

    await AudioGeneration.findByIdAndUpdate(payload._id, { rowLocked: false });
  }
}
