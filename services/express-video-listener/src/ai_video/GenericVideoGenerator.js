

import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer } from './utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from './utils/AWS.js';

function isSamsarExternalProviderPayload(payload = {}) {
  return payload?.samsarExternalProvider === true ||
    payload?.externalProvider === 'samsar' ||
    payload?.model === 'SAMSAR_EXTERNAL_VIDEO';
}

async function prepareFrameImageForProvider(frameImage, remoteFileName, payload = {}) {
  if (!frameImage) {
    return frameImage;
  }
  if (isSamsarExternalProviderPayload(payload)) {
    return frameImage;
  }

  const uploadedFrameImage = await uploadFrameLayerImageToCDN(frameImage, remoteFileName);
  await primeCDNCache(uploadedFrameImage);
  return uploadedFrameImage;
}

export async function requestRenderExpressCustomVideo(payload) {

  const { videoSessionId, layerId, prompt, combineLayers, useStartFrame,
     useEndFrame, aspectRatio, model , clipLayerToAiVideo, userId , duration} = payload;

  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);

  const currentLayer = videoSession.layers[currentLayerIndex];


  const activeItemList = currentLayer.imageSession.activeItemList;
  const currentLayerId = currentLayer._id.toString();


  let currentLayerFrameImage;

  if (useStartFrame) {

    const currentLayerId = currentLayer._id.toString();

    const isBaseFrameImage = getBaseFrameImageForLayer(activeItemList, aspectRatio, videoSessionId);
    if (isBaseFrameImage) {
      currentLayerFrameImage = isBaseFrameImage;
    } else {
      currentLayerFrameImage = await getFrameImageForLayer(videoSessionId, currentLayerId, aspectRatio, activeItemList);
    }


    const frameBoundaryIamgeName = currentLayerFrameImage.split('/').pop();
    currentLayerFrameImage = await prepareFrameImageForProvider(
      currentLayerFrameImage,
      frameBoundaryIamgeName,
      payload,
    );
  }
  let hasNextLayer = currentLayerIndex + 1 < videoSession.layers.length;
  let nextLayerFrameImage = null;





  let aiVideoRenderPayload = {
    prompt: prompt,
    model: model
  }
  if (currentLayerFrameImage) {
    aiVideoRenderPayload.startImage = currentLayerFrameImage;
  }
  if (nextLayerFrameImage) {
    aiVideoRenderPayload.endImage = nextLayerFrameImage;
  }
  aiVideoRenderPayload.sessionId = videoSessionId;
  aiVideoRenderPayload.layerId = layerId;

  aiVideoRenderPayload.useEndFrame = false;
  aiVideoRenderPayload.useStartFrame = useStartFrame;
  aiVideoRenderPayload.combineLayers = combineLayers;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;
  aiVideoRenderPayload.retryOnFail = true;
  if (model === 'CUSTOM_IMAGE_TO_VIDEO' || isSamsarExternalProviderPayload(payload)) {
    aiVideoRenderPayload.duration = duration;
    aiVideoRenderPayload.generateAudio = payload.generateAudio === true || payload.generate_audio === true;
    aiVideoRenderPayload.isAudioVideoGeneration = payload.isAudioVideoGeneration === true;
    aiVideoRenderPayload.isAudioVideoLayer = payload.isAudioVideoLayer === true;
    if (payload.customFallbackModel) {
      aiVideoRenderPayload.customFallbackModel = payload.customFallbackModel;
    }
    if (isSamsarExternalProviderPayload(payload)) {
      aiVideoRenderPayload.externalProvider = 'samsar';
      aiVideoRenderPayload.samsarExternalProvider = true;
      aiVideoRenderPayload.samsarExternalProviderStage = payload.samsarExternalProviderStage || 'ai_video_generation';
      aiVideoRenderPayload.samsarExternalProviderConfig = payload.samsarExternalProviderConfig || null;
      aiVideoRenderPayload.samsarExternalVideoModel = payload.samsarExternalVideoModel || payload.originalVideoModel || model;
      aiVideoRenderPayload.samsarExternalVideoRoute = payload.samsarExternalVideoRoute || 'step/image_to_video';
    }
  }
  


   const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  const renderSaveRes = await aiRenderPayload.save();




  // Render video
}
