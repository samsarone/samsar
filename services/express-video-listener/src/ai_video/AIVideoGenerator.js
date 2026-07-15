
import { getDBConnectionString } from "../DBString.js";
import VideoSession from "../schema/VideoSession.js";
import User from "../schema/User.js";
import { requestRenderLumaVideo } from "./Luma.js";
import { requestRenderRunwayVideo } from "./RunwayML.js";
import { useShortFormPrompt } from "./utils/Model.js";

import { requestRenderKlingVideo } from "./KlingImgToVidPro.js";
import { requestRenderSkyreelsVideo } from "./SkyReelsVideoGenerator.js";
import { requestRenderPixVerseVideo } from "./PixVerseGenerator.js";
import { requestRenderPikaI2VVideo } from './PikaI2VGenerator.js';
import { requestRenderViduI2VVideo } from './ViduI2VGenerator.js';
import { requestRenderExpressCustomVideo } from './GenericVideoGenerator.js';
import { requestRenderSeeDanceVideo } from './SeeDanceGenerator.js';
import { requestRenderExpressHailuoVideo } from './HailuoListener.js';
import { requestRenderVeo3I2VVideo } from './Veo3I2VGenerator.js';
import { requestRenderSora2I2VVideo } from './Sora2Generator.js';
import { requestRenderHappyHorseI2VVideo } from './HappyHorseI2VGenerator.js';
import { requestRenderCosmos3I2VVideo } from './Cosmos3I2VGenerator.js';



import {
  getVideoModelDurationUnitsForFramesPerSecond,
} from '../consts/ModelPrices.js';
;
const AUDIO_VIDEO_SOUND_EFFECT_MODELS = ['SORA2', 'SORA2PRO', 'VEO3.1I2V', 'VEO3.1I2VFAST', 'SEEDANCEI2V'];
import {
  createTextToVideoPromptFromLayerPrompt,
  createTextToVideoPromptFromStartingLayerPrompt,
  getTransitionListForLayerSceneDescriptions,

} from "./assistant/OpenAi.js";
import {
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceModel,
} from '../ai_utils/RequestInferenceModel.js';

import { updateLayerAiVideoGenerationPrompt } from './utils/SessionUtils.js';
import {
  buildAiVideoPromptSeedContext,
  buildRankedFallbackStartImages,
  getLayerActiveImageSources,
  getLayerImageDescription,
} from './utils/AIVideoPromptContext.js';

// Import other requestRender functions as needed
const AI_VIDEO_ALLOWED_BASE_TYPES = new Set(['character', 'narration', 'base', 'sound_effect']);
const AI_VIDEO_ALLOWED_LAYER_TYPES = new Set(['character', 'narration', 'base', 'scene', 'sound_effect']);

function pickDuration(units, target) {
  // units should be sorted ascending, e.g. [4, 6, 8, 12]
  if (!Array.isArray(units) || units.length === 0) return target;
  for (const u of units) {
    if (u >= target) return u;     // first (smallest) unit that fits
  }
  return units[units.length - 1];  // otherwise the largest allowed
}

function getSamsarExternalAiVideoStageConfig(sessionData = {}) {
  const stageConfig = sessionData?.samsarExternalProviderStages?.ai_video_generation;
  return stageConfig && typeof stageConfig === 'object' ? stageConfig : null;
}

function applySamsarExternalAiVideoPayload(payload, sessionData = {}) {
  const stageConfig = getSamsarExternalAiVideoStageConfig(sessionData);
  if (!stageConfig) {
    return payload;
  }

  return {
    ...payload,
    originalVideoModel: payload.model,
    model: 'SAMSAR_EXTERNAL_VIDEO',
    externalProvider: 'samsar',
    samsarExternalProvider: true,
    samsarExternalProviderStage: 'ai_video_generation',
    samsarExternalProviderConfig: stageConfig,
    samsarExternalVideoModel: stageConfig.model || payload.model,
    samsarExternalVideoRoute: stageConfig.videoRoute || 'step/image_to_video',
  };
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

function getNormalizedAiVideoGenerationStatus(layer = {}) {
  const rawStatus = typeof layer?.aiVideoGenerationStatus === 'string'
    ? layer.aiVideoGenerationStatus.trim().toUpperCase()
    : '';
  return rawStatus || 'INIT';
}

async function markSessionLayerAiVideoGenerationFailed({
  videoSessionId,
  layerId,
  error,
  stage = 'request_enqueue',
}) {
  const message = error?.message || String(error || 'AI video generation request failed');
  console.error('[ai_video][request_enqueue] failed to create AI video generation request', {
    videoSessionId,
    layerId,
    stage,
    error: message,
    stack: error?.stack,
  });

  await VideoSession.updateOne(
    { _id: videoSessionId, 'layers._id': layerId },
    {
      $set: {
        'layers.$.aiVideoGenerationPending': false,
        'layers.$.hasAiVideoLayer': false,
        'layers.$.aiVideoGenerationStatus': 'FAILED',
        'layers.$.aiVideoGenerationError': message,
        'layers.$.processVideoGenerationFailed': true,
        lastAiVideoLayerGenerationError: message,
      },
    },
  );
}

export async function createGenerativeVideoAnimationsForFrames(sessionId) {
  await getDBConnectionString();


  let sessionData = await VideoSession.findById(sessionId);

  if (!sessionData) {
    throw new Error('Session not found');
  }

  const videoGenerationPrompt = 'Camera zooms in';

  const {
    expressGenerativeVideoModel,
    userId,
    aspectRatio,
    layers,
    expressGenerativeVideoUseEndFrame,
    videoTone,
  } = sessionData;

  const videoGenerationModel = expressGenerativeVideoModel; // can be LUMA, RUNWAYML, etc.

  const userData = await User.findById(userId);

  const userInferenceModel = resolveRequestInferenceModel({
    session: sessionData,
    user: userData,
  });
  const selectedInferenceModelAuthorization = resolveRequestInferenceAuthorization({
    session: sessionData,
    user: userData,
  });



  const speechAudioLayers = sessionData.audioLayers.filter(layer => layer.generationType === 'speech');
  // Iterate over each layer

  const isMovieGen = sessionData.isMovieGen;

  const promptList = [];



  for (let i = 0; i < layers.length; i++) {
    promptList.push(getLayerImageDescription(layers[i]));
  }




  const baseInferenceAuditContext = {
    userId,
    sessionId,
    jobType: 'Express video',
    isExpressGeneration: sessionData.isExpressGeneration || sessionData.isMovieGen,
    requestType: 'narrative_inference',
    source: 'express_video_inference',
    selectedInferenceModelAuthorization,
  };

  const cameraTransitionListString = await getTransitionListForLayerSceneDescriptions(
    promptList,
    userInferenceModel,
    {
      ...baseInferenceAuditContext,
      localRequestId: `${sessionId}:camera_transitions`,
      sourceTask: 'camera_transition_prompt',
    }
  );
  const cameraTransitionList = typeof cameraTransitionListString === 'string'
    ? cameraTransitionListString.split('\n').map(item => item.trim()).filter(item => item !== '')
    : [];

  for (let i = 0; i < layers.length; i++) {
    const currentLayer = layers[i];
    const currentLayerId = currentLayer._id.toString();
    if (shouldSkipAiVideoGenerationForLayer(currentLayer)) {
      continue;
    }

    const aiVideoGenerationStatus = getNormalizedAiVideoGenerationStatus(currentLayer);
    const hasGeneratedAiVideoOutput = currentLayer?.hasAiVideoLayer !== false &&
      Boolean(currentLayer?.aiVideoLayer || currentLayer?.aiVideoRemoteLink);
    if (
      aiVideoGenerationStatus !== 'INIT' ||
      currentLayer?.aiVideoGenerationPending === true ||
      hasGeneratedAiVideoOutput
    ) {
      continue;
    }
    let useEndFrame = (i < layers.length - 1); // true if not the last layer

    // set useEndFrame to false if user has specified to not use end frame
    if (!expressGenerativeVideoUseEndFrame) {
      useEndFrame = false;
    }


    const startingPrompt = currentLayer.prompt;

    const startingImageDescription = getLayerImageDescription(currentLayer);

    let endingImageDescription;

    const sceneType = currentLayer.layerAiVideoType;


    if (i < layers.length - 1) {
      endingImageDescription = getLayerImageDescription(layers[i + 1]);
      useEndFrame = false;
    }

    let textToVideoPrompt;

    const useShortForm = useShortFormPrompt(videoGenerationModel);

    if (sessionData.isMovieGen) {
      useEndFrame = false;
    }

    let isSpeakerTransition = false;
    if (sceneType === 'character') {
      isSpeakerTransition = true;
    }
    const cameraTranstionFromLayer = cameraTransitionList[i];
    const isInfinitezoom = sessionData.isExpressGeneration &&
      sessionData.expressGenerationType === 'Infinitezoom';
    if (isInfinitezoom) {
      if (i === layers.length - 1) {
        useEndFrame = false;
      } else {
        useEndFrame = true;
      }
      const expressGenerationAnimation = sessionData.expressGenerationAnimation;
      if (expressGenerationAnimation === 'zoom_in') {
        textToVideoPrompt = 'Camera swirls clockwise and zooms in';
      } else if (expressGenerationAnimation === 'zoom_out') {
        textToVideoPrompt = 'Camera swirls anticlockwise and zooms out';
      }
    } else {


      let indexData = {
        isStartScene: false,
        isEndScene: false,
      }
      if (i === 0) {
        indexData.isStartScene = true;
      }
      if (i === layers.length - 1) {
        indexData.isEndScene = true;
      }

      const layerInferenceAuditContext = {
        ...baseInferenceAuditContext,
        layerId: currentLayerId,
        localRequestId: `${sessionId}:${currentLayerId}:text_to_video_prompt`,
        sourceTask: 'text_to_video_prompt',
      };

      if (useEndFrame) {
        textToVideoPrompt = await createTextToVideoPromptFromLayerPrompt(startingPrompt, startingImageDescription,
          endingImageDescription, userInferenceModel, useShortForm, indexData, videoTone, layerInferenceAuditContext);
      } else {


        const promptInferenceModel = userInferenceModel;
        const promptReasoningEffort = 'high';
        textToVideoPrompt = await createTextToVideoPromptFromStartingLayerPrompt(startingPrompt, startingImageDescription,
          promptInferenceModel, useShortForm, isSpeakerTransition, indexData, videoTone, cameraTranstionFromLayer, promptReasoningEffort, layerInferenceAuditContext);
      }


      if (!textToVideoPrompt) {
        textToVideoPrompt = videoGenerationPrompt;
      }

      if (videoGenerationModel === 'SEEDANCEI2V' && videoTone === 'grounded') {
        textToVideoPrompt += `Maintain text and visual accuracy. Do not distort any text or add non-english text.`;
      }
    }

    const promptSeedContext = buildAiVideoPromptSeedContext({
      layer: currentLayer,
      sceneAction: startingPrompt,
      resolvedPrompt: textToVideoPrompt,
      promptStrategy: isInfinitezoom ? 'infinitezoom' : 'image_to_video_meta_prompt',
      layerIndex: i,
      layerCount: layers.length,
      sceneDescriptions: promptList,
      cameraTransition: cameraTranstionFromLayer,
      videoTone,
      userInferenceModel,
      selectedInferenceModelAuthorization,
      useShortFormPrompt: useShortForm,
    });

    await updateLayerAiVideoGenerationPrompt(sessionId, currentLayerId, textToVideoPrompt);

    const currentSpeechAudioLayer = speechAudioLayers.find(audioLayer => audioLayer.connectedLayerId === currentLayerId && audioLayer.generationType === 'speech');


    let speechLayerDuration = 0;
    if (currentSpeechAudioLayer && currentSpeechAudioLayer.duration) {
      speechLayerDuration = currentSpeechAudioLayer.duration
    }


    const videoModelUnits = getVideoModelDurationUnitsForFramesPerSecond(
      videoGenerationModel,
      sessionData.framesPerSecond,
    );
    const normalizedVideoModelUnits = videoModelUnits.length > 0
      ? [...new Set(videoModelUnits)].sort((a, b) => a - b)
      : [5];

    let aiVideoLayerDuration = normalizedVideoModelUnits[0]; // Default to the first unit
    if (speechLayerDuration && speechLayerDuration > 0) {
      const target = Math.max(speechLayerDuration, currentLayer?.duration ?? 0);
      aiVideoLayerDuration = pickDuration(normalizedVideoModelUnits, target);
    } else {
      // No (long) speech: choose the smallest allowed unit >= layer.duration
      const target = currentLayer?.duration ?? normalizedVideoModelUnits[0];
      aiVideoLayerDuration = pickDuration(normalizedVideoModelUnits, target);
    }

    const isAudioVideoLayer = sceneType === 'sound_effect' &&
      AUDIO_VIDEO_SOUND_EFFECT_MODELS.includes(videoGenerationModel);

    let payload = {
      userId: userId,
      videoSessionId: sessionId,
      layerId: currentLayerId,
      prompt: textToVideoPrompt,
      model: videoGenerationModel,
      combineLayers: false, // Adjust based on your requirements
      useStartFrame: true,
      useEndFrame: useEndFrame,
      aspectRatio: aspectRatio,
      clipLayerToAiVideo: isMovieGen ? true : false,
      duration: aiVideoLayerDuration,
      expressGenerativeVideoModelSubType: sessionData.expressGenerativeVideoModelSubType,
      videoTone: sessionData.videoTone,
      startImageDescription: startingImageDescription,
      initialStartImageSources: getLayerActiveImageSources(currentLayer),
      fallbackStartImages: buildRankedFallbackStartImages(currentLayer),
      promptSeedContext,
      userInferenceModel,
      selectedInferenceModelAuthorization,
      isAudioVideoLayer,
      isAudioVideoGeneration: isAudioVideoLayer,
      ...(sessionData.customAdapterFallbacks?.image_to_video
        ? { customFallbackModel: sessionData.customAdapterFallbacks.image_to_video }
        : {}),
    };
    payload = applySamsarExternalAiVideoPayload(payload, sessionData);

    // Update the session layer to set aiVideoGenerationPending and hasAiVideoLayer flags
   const sessionResData = await setSessionLayerAiVideoGenerationPending(payload);

   if (!sessionResData) {
    continue;
   }
   
    // Depending on the model, call the appropriate requestRender function
    try {
      if (payload.samsarExternalProvider === true) {
        await requestRenderExpressCustomVideo(payload);
      } else if (videoGenerationModel === 'LUMA' || videoGenerationModel === 'LUMAFLASH2') {
        await requestRenderLumaVideo(payload);
      } else if (videoGenerationModel === 'RUNWAYML') {
        await requestRenderRunwayVideo(payload);
      } else if (videoGenerationModel === 'KLINGIMGTOVID3PRO' || videoGenerationModel === 'KLINGIMGTOVIDTURBO') {
        await requestRenderKlingVideo(payload);
      } else if (videoGenerationModel === 'SKYREELSI2V') {
        await requestRenderSkyreelsVideo(payload);
      } else if (videoGenerationModel === 'PIXVERSEI2V' || videoGenerationModel === 'PIXVERSEI2VFAST') {
        await requestRenderPixVerseVideo(payload);
      } else if (videoGenerationModel === 'PIKA2.2I2V') {
        await requestRenderPikaI2VVideo(payload);
      } else if (
        videoGenerationModel === 'HAIPER2.0' ||
        videoGenerationModel === 'MAGIDISTILLED' ||
        videoGenerationModel === 'CUSTOM_IMAGE_TO_VIDEO'
      ) {
        await requestRenderExpressCustomVideo(payload);
      } else if (videoGenerationModel.startsWith('KLING')) {
        await requestRenderKlingVideo(payload);
      } else if (videoGenerationModel === 'SEEDANCEI2V') {
        await requestRenderSeeDanceVideo(payload);
      } else if (videoGenerationModel === 'HAPPYHORSEI2V') {
        await requestRenderHappyHorseI2VVideo(payload);
      } else if (videoGenerationModel === 'VIDUI2V') {
        if (sessionData.videoTone === 'grounded') {
          payload.animationType = 'small';
        } else {
          payload.animationType = 'auto';
        }
        await requestRenderViduI2VVideo(payload);
      } else if (videoGenerationModel === 'HAILUO' || videoGenerationModel === 'HAILUOPRO') {
        await requestRenderExpressHailuoVideo(payload);
      } else if (videoGenerationModel === 'VEO3.1I2V' || videoGenerationModel === 'VEO3.1I2VFAST') {
        await requestRenderVeo3I2VVideo(payload);
      } else if (videoGenerationModel === 'COSMOS3SUPERI2V') {
        await requestRenderCosmos3I2VVideo(payload);
      } else if (videoGenerationModel === 'SORA2' || videoGenerationModel === 'SORA2PRO') {
        await requestRenderSora2I2VVideo(payload);
      } else {
        throw new Error(`Unsupported video generation model: ${videoGenerationModel}`);
      }
    } catch (error) {
      await markSessionLayerAiVideoGenerationFailed({
        videoSessionId: sessionId,
        layerId: currentLayerId,
        error,
      });
    }

  }

}




export async function setSessionLayerAiVideoGenerationPending(payload) {
  await getDBConnectionString();

  try {
    const { videoSessionId, layerId, duration } = payload;
    const targetLayerId = typeof layerId === 'string' ? layerId : layerId?.toString();

    const sessionForValidation = await VideoSession.findById(videoSessionId);
    if (!sessionForValidation) {
      return;
    }
    const layerForValidation = Array.isArray(sessionForValidation.layers)
      ? sessionForValidation.layers.find((layer) => layer?._id?.toString() === targetLayerId)
      : null;
    if (!layerForValidation || shouldSkipAiVideoGenerationForLayer(layerForValidation)) {
      return;
    }

    const layerUpdate = {
      "layers.$.aiVideoGenerationPending": true,
      "layers.$.hasAiVideoLayer": true,
      "layers.$.aiVideoGenerationStatus": "PENDING",
      "layers.$.aiVideoGenerationStartedAt": new Date(),
      "layers.$.aiVideoGenerationError": null,
      "layers.$.processVideoGenerationFailed": false,
    };

    if (payload.isAudioVideoLayer) {
      layerUpdate["layers.$.isAudioVideoLayer"] = true;
    }

    const sessionDataValue = await VideoSession.findOneAndUpdate(
      { _id: videoSessionId, "layers._id": layerId },
      {
        $set: layerUpdate
      },
      { new: true }
    );

    if (!sessionDataValue) {
      return;
    }

    const layers = sessionDataValue.layers || [];
    const audioLayers = sessionDataValue.audioLayers ? [...sessionDataValue.audioLayers] : [];

    const currentLayerIndex = layers.findIndex(layer => layer._id.toString() === targetLayerId);
    if (currentLayerIndex === -1) {
      return sessionDataValue;
    }

    const currentLayer = layers[currentLayerIndex];
    const targetDuration = typeof duration === 'number' ? duration : currentLayer.duration;
    currentLayer.duration = targetDuration;

    layers[currentLayerIndex] = currentLayer;

    const currentLayerStart = typeof currentLayer.durationOffset === 'number'
      ? currentLayer.durationOffset
      : 0;

    let nextLayerStartTime = currentLayerStart + targetDuration;
    for (let i = currentLayerIndex + 1; i < layers.length; i++) {
      const nextLayer = layers[i];
      nextLayer.durationOffset = nextLayerStartTime;

      const nextLayerDuration = typeof nextLayer.duration === 'number' ? nextLayer.duration : 0;

      layers[i] = nextLayer;
      nextLayerStartTime += nextLayerDuration;
    }

    sessionDataValue.layers = layers;
    const updatedLayers = sessionDataValue.layers || [];

    for (let i = 0; i < audioLayers.length; i++) {
      const audioLayer = audioLayers[i];
      const connectedLayerId = audioLayer.connectedLayerId;
      if (!connectedLayerId) {
        continue;
      }

      const connectedLayer = updatedLayers.find(layer => layer._id.toString() === connectedLayerId);
      if (!connectedLayer) {
        continue;
      }



      const connectedLayerStartTime = typeof connectedLayer.durationOffset === 'number'
        ? connectedLayer.durationOffset
        : 0;
      const connectedLayerDuration = typeof connectedLayer.duration === 'number'
        ? connectedLayer.duration
        : 0;
      const audioDuration = typeof audioLayer.duration === 'number' ? audioLayer.duration : 0;
      const durationDiff = connectedLayerDuration - audioDuration;
      const audioStartOffset = (audioLayer.generationType === 'speech' && durationDiff > 0)
        ? (durationDiff / 2)
        : 0;
      const audioStartTime = connectedLayerStartTime + audioStartOffset;

      audioLayer.startTime = audioStartTime;
      audioLayer.endTime = audioStartTime + audioDuration;
      audioLayer.connectedLayerStartTimeOffset = audioStartOffset;
      audioLayers[i] = audioLayer;



    }


    await VideoSession.updateOne(
      { _id: videoSessionId },
      {
        $set: {
          layers: updatedLayers,
          audioLayers,
        },
      },
    );

    sessionDataValue.layers = updatedLayers;
    sessionDataValue.audioLayers = audioLayers;

    return sessionDataValue;

  } catch {
    return;
  }

}
