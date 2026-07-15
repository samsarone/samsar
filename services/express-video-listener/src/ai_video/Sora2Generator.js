

import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer } from './utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from './utils/AWS.js';
import { buildRetryableImageToVideoQueuePayload } from './utils/AIVideoQueuePayload.js';

export async function requestRenderSora2I2VVideo(payload) {

  const { videoSessionId, layerId, prompt, combineLayers, useStartFrame,
     useEndFrame, aspectRatio, model , clipLayerToAiVideo, userId,
    duration = 8 } = payload;

  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);

  const currentLayer = videoSession.layers[currentLayerIndex];


  const layerSceneType = currentLayer.layerAiVideoType || 'video';

  let isAudioVideoGeneration = false;

  if (layerSceneType === 'sound_effect') {
    isAudioVideoGeneration = true;
  }

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



    currentLayerFrameImage = await uploadFrameLayerImageToCDN(currentLayerFrameImage, frameBoundaryIamgeName);


    
    await primeCDNCache(currentLayerFrameImage);
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
  aiVideoRenderPayload.duration = duration;
  aiVideoRenderPayload.isAudioVideoGeneration = isAudioVideoGeneration;


   const aiRenderPayload = new AIVideoLayerGeneration(
    buildRetryableImageToVideoQueuePayload(payload, aiVideoRenderPayload),
  );
  const renderSaveRes = await aiRenderPayload.save();




  // Render video
}
