import fs from 'fs';
import path from 'path';
import axios from 'axios';
import mp3Duration from 'mp3-duration';

import AudioGeneration from '../schema/AudioGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import { CUSTOM_AUDIO_ADAPTER_TYPES, listenToPendingCustomAudioRequest, submitCustomAudioRequest } from '../custom/CustomFalCompatibleAudio.js';
import { markAudioGenerationAsFailed } from '../music/audioUtils.js';
import { resolveSpeechLayerTimingUpdate } from './SpeechLayerTiming.js';
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from '../utils/AssetPaths.js';
import { uploadAudioAssetToCDN } from '../AWS.js';
import { finalizeStandaloneExternalAudioGeneration } from '../external/StandaloneExternalAudio.js';

async function markCustomSpeechStageSuccess(sessionId) {
  if (!sessionId) {
    return;
  }
  await VideoSession.findByIdAndUpdate(sessionId, {
    $set: {
      'expressGenerationCustomStageResults.speech_generation.status': 'CUSTOM_SUCCEEDED',
      'expressGenerationCustomStageResults.speech_generation.completedAt': new Date(),
    },
  });
}

async function fallbackCustomSpeechRequest(payload, errorMessage) {
  const fallbackProvider = typeof payload?.customFallbackTtsProvider === 'string'
    ? payload.customFallbackTtsProvider.trim()
    : '';
  if (!fallbackProvider) {
    return false;
  }

  await AudioGeneration.findByIdAndUpdate(payload._id, {
    ttsProvider: fallbackProvider,
    status: 'INIT',
    generationId: null,
    apiRequestId: null,
    numRetries: 0,
    customAdapterFallbackUsed: true,
    customAdapterError: errorMessage || null,
    rowLocked: false,
  });
  await VideoSession.findOneAndUpdate(
    { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
    {
      $set: {
        'audioLayers.$.generationStatus': 'INIT',
        'audioLayers.$.generationError': null,
        'expressGenerationCustomStageResults.speech_generation.fallbackUsed': true,
        'expressGenerationCustomStageResults.speech_generation.fallbackAt': new Date(),
        'expressGenerationCustomStageResults.speech_generation.error': errorMessage || null,
      },
    }
  );
  return true;
}

async function retryOrDeleteFailedUpdate(payload, errorMessage) {
  const currentRetries = Number.isFinite(Number(payload?.numRetries))
    ? Number(payload.numRetries)
    : 0;

  if (currentRetries < 3) {
    await AudioGeneration.findByIdAndUpdate(payload._id, {
      numRetries: currentRetries + 1,
      status: 'INIT',
      generationId: null,
      apiRequestId: null,
      error: errorMessage || null,
      rowLocked: false,
    });
    await VideoSession.findOneAndUpdate(
      { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
      {
        $set: {
          'audioLayers.$.generationStatus': 'INIT',
          'audioLayers.$.generationError': null,
        },
      }
    );
    return;
  }

  if (await fallbackCustomSpeechRequest(payload, errorMessage || 'Custom text-to-speech generation failed.')) {
    return;
  }

  await markAudioGenerationAsFailed(payload._id, errorMessage || 'Custom text-to-speech generation failed.');
  await AudioGeneration.findByIdAndDelete(payload._id);
}

function getAudioSaveFilePath(audioFileBase) {
  return getProcessorAssetsV2Path(audioFileBase);
}

async function getGeneratedSpeechDuration(audioSaveFilePath, resultData) {
  try {
    const duration = await mp3Duration(audioSaveFilePath);
    if (Number.isFinite(duration) && duration > 0) {
      return Math.ceil(duration);
    }
  } catch (error) {
    console.error('Error getting custom TTS MP3 duration:', error);
  }

  const fallbackDuration = Number(
    resultData?.audio?.duration ||
    resultData?.data?.audio?.duration ||
    resultData?.duration ||
    resultData?.data?.duration
  );
  return Number.isFinite(fallbackDuration) && fallbackDuration > 0
    ? Math.ceil(fallbackDuration)
    : 1;
}

async function finalizeCustomSpeechGeneration(payload, responseData) {
  const { sessionId, audioLayerId, _id } = payload;
  const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'speech.mp3');
  const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
  const audioSaveFilePath = getAudioSaveFilePath(audioFileBase);
  const audioFileFolder = path.dirname(audioSaveFilePath);

  if (!fs.existsSync(audioFileFolder)) {
    fs.mkdirSync(audioFileFolder, { recursive: true });
  }

  const audioResponse = await axios.get(responseData.remoteUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });
  await fs.promises.writeFile(audioSaveFilePath, Buffer.from(audioResponse.data));
  await markCustomSpeechStageSuccess(sessionId);

  const duration = await getGeneratedSpeechDuration(audioSaveFilePath, responseData.result);
  const remoteFilePath = await uploadAudioAssetToCDN(audioSaveFilePath, audioAssetPath);
  const remoteAudioData = [
    {
      audio_url: remoteFilePath,
      title: 'Speech',
    },
  ];

  if (await finalizeStandaloneExternalAudioGeneration({
    payload,
    resultUrl: remoteFilePath,
    resultUrls: [remoteFilePath],
    duration,
    localAudioPath: audioAssetPath,
    remoteAudioData,
    title: 'Speech',
  })) {
    return;
  }

  let videoSession = await VideoSession.findById(sessionId);
  if (!videoSession) {
    await AudioGeneration.deleteOne({ _id });
    return;
  }

  const isExpressGeneration = videoSession.isExpressGeneration;
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
          'audioLayers.$.generationError': null,
          ...(audioLayer.defaultSelected && {
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
  const speechGenerationPending = latestSessionData.audioLayers.some(
    (layer) => layer.generationType === 'speech' && layer.generationStatus !== 'COMPLETED'
  );

  if (!speechGenerationPending && isExpressGeneration) {
    videoSession = await VideoSession.findOne({ _id: sessionId });

    if (videoSession.setAutoDurationPerScene) {
      const effectiveAudioLayers = videoSession.audioLayers.filter(
        (layer) => layer.generationType === 'speech'
      );
      let durationOffset = 0;
      const layerUpdates = {};
      const audioLayerUpdates = {};

      for (let i = 0; i < effectiveAudioLayers.length; i += 1) {
        const audioDuration = effectiveAudioLayers[i].duration;
        let layerDuration = audioDuration + 1;

        if (i === effectiveAudioLayers.length - 1) {
          layerDuration = audioDuration + 2;
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
  }

  if (!audioGenerationPending) {
    await VideoSession.findOneAndUpdate(
      { _id: sessionId },
      { $set: { audioGenerationPending } },
      { new: true }
    );
  }

  await AudioGeneration.deleteOne({ _id });
}

export async function processCustomTextToSpeechRequest(payload) {
  try {
    if (payload.status === 'INIT') {
      const requestId = await submitCustomAudioRequest(
        payload,
        CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_SPEECH
      );

      await AudioGeneration.findByIdAndUpdate(payload._id, {
        apiRequestId: requestId,
        generationId: requestId,
        status: 'PENDING',
        rowLocked: false,
      });
      await VideoSession.findOneAndUpdate(
        { _id: payload.sessionId, 'audioLayers._id': payload.audioLayerId },
        { $set: { 'audioLayers.$.generationStatus': 'PENDING' } }
      );
      return;
    }

    if (payload.status === 'PENDING') {
      const responseData = await listenToPendingCustomAudioRequest(
        payload,
        CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_SPEECH
      );

      if (responseData?.remoteUrl) {
        await finalizeCustomSpeechGeneration(payload, responseData);
        return;
      }

      if (responseData?.responseStatus === 'FAILED') {
        await retryOrDeleteFailedUpdate(payload, responseData.error);
        return;
      }

      await AudioGeneration.findByIdAndUpdate(payload._id, { rowLocked: false });
    }
  } catch (error) {
    console.error('Error in processCustomTextToSpeechRequest:', error);
    await retryOrDeleteFailedUpdate(payload, error?.message || 'Custom text-to-speech request failed.');
  }
}
