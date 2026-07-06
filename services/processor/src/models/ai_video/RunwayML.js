


import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer, getAiVideoFrameImageForLayer, getRenderableItemListForLayer } from '../../utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from '../AWS.js';



export async function requestRenderRunwayVideo(payload) {

  let { videoSessionId, currentLayerId, prompt, combineLayers, useStartFrame,
    useEndFrame = false, aspectRatio, model, clipLayerToAiVideo, userId, duration } = payload;


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



    if (!currentLayerFrameImage) {
      useStartFrame = false;
      useEndFrame = false;

    } else {

      const frameBoundaryIamgeName = currentLayerFrameImage.split('/').pop();
      currentLayerFrameImage = await uploadFrameLayerImageToCDN(currentLayerFrameImage, frameBoundaryIamgeName);

      await primeCDNCache(currentLayerFrameImage);
    }
  }

  let hasNextLayer = currentLayerIndex + 1 < videoSession.layers.length;
  let nextLayerFrameImage = null;



  if (hasNextLayer && useEndFrame) {
    const nextLayer = videoSession.layers[currentLayerIndex + 1];
    const nextLayerItemList = getRenderableItemListForLayer(nextLayer);


    if (combineLayers) {
      nextLayerFrameImage = await getFrameImageForLayer(videoSessionId, nextLayer._id, aspectRatio, nextLayerItemList);
    } else {
      nextLayerFrameImage = getBaseFrameImageForLayer(nextLayerItemList, aspectRatio, videoSessionId);
    }


    if (!nextLayerFrameImage) {
      nextLayerFrameImage = getAiVideoFrameImageForLayer(nextLayer, videoSessionId);
    }


    if (nextLayerFrameImage) {

      const nextLayerFrameImageName = nextLayerFrameImage.split('/').pop();
      nextLayerFrameImage = await uploadFrameLayerImageToCDN(nextLayerFrameImage, nextLayerFrameImageName);


      await primeCDNCache(nextLayerFrameImage);
    }

  }


  let requestDuration = 5;
  if (duration) {
    requestDuration = duration;
  }



  let aiVideoRenderPayload = {
    prompt: prompt,
    model: model,
    duration: requestDuration,
  }
  if (currentLayerFrameImage) {
    aiVideoRenderPayload.startImage = currentLayerFrameImage;
  }
  if (nextLayerFrameImage) {
    aiVideoRenderPayload.endImage = nextLayerFrameImage;
  }


  aiVideoRenderPayload.sessionId = videoSessionId;
  aiVideoRenderPayload.layerId = currentLayerId;

  aiVideoRenderPayload.useEndFrame = useEndFrame;
  aiVideoRenderPayload.useStartFrame = useStartFrame;
  aiVideoRenderPayload.combineLayers = combineLayers;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;

  if (videoSession.isExpressGeneration) {
    aiVideoRenderPayload.isSecondaryExpressGeneration = true;
  }


  
  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  const renderSaveRes = await aiRenderPayload.save();


}


