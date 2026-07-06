
import LumaAI from 'lumaai';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer, getAiVideoFrameImageForLayer, getRenderableItemListForLayer } from '../../utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from '../AWS.js';

export async function requestRenderLumaVideo(payload) {

  let { videoSessionId, currentLayerId, prompt, combineLayers, useStartFrame,
    useEndFrame, aspectRatio, model, clipLayerToAiVideo, userId } = payload;

  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === currentLayerId);

  const currentLayer = videoSession.layers[currentLayerIndex];


  const activeItemList = getRenderableItemListForLayer(currentLayer);


  let currentLayerFrameImage;

  if (useStartFrame) {
    if (combineLayers) {
      currentLayerFrameImage = await getFrameImageForLayer(videoSessionId, currentLayerId, aspectRatio, activeItemList);
    } else {
      currentLayerFrameImage = getBaseFrameImageForLayer(activeItemList, aspectRatio, videoSessionId);
    }


    if (currentLayerFrameImage) {
      const frameBoundaryIamgeName = currentLayerFrameImage.split('/').pop();


      currentLayerFrameImage = await uploadFrameLayerImageToCDN(currentLayerFrameImage, frameBoundaryIamgeName);

      await primeCDNCache(currentLayerFrameImage);
    } else {
      useStartFrame = false;
    }
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
  aiVideoRenderPayload.layerId = currentLayerId;

  aiVideoRenderPayload.useEndFrame = false;
  aiVideoRenderPayload.useStartFrame = useStartFrame;
  aiVideoRenderPayload.combineLayers = combineLayers;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;


  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  const renderSaveRes = await aiRenderPayload.save();




  // Render video
}

