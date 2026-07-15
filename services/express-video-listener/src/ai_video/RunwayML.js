


import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer, getInfiniteZoomFrameImageForImageSession } from './utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from './utils/AWS.js';
import { buildRetryableImageToVideoQueuePayload } from './utils/AIVideoQueuePayload.js';



export async function requestRenderRunwayVideo(payload) {

  const { videoSessionId, layerId, prompt, combineLayers, useStartFrame,
    useEndFrame, aspectRatio, model, clipLayerToAiVideo, userId, duration } = payload;


  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);


  const isInfiniteZoomRender = videoSession.expressGenerationType === 'Infinitezoom';


  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);

  const currentLayer = videoSession.layers[currentLayerIndex];



  const activeItemList = currentLayer.imageSession.activeItemList;


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

  if (hasNextLayer && useEndFrame) {
    const nextLayer = videoSession.layers[currentLayerIndex + 1];

    if (isInfiniteZoomRender) {
      nextLayerFrameImage = getInfiniteZoomFrameImageForImageSession(nextLayer.imageSession);
    } else {

      if (combineLayers) {
        nextLayerFrameImage = await getFrameImageForLayer(videoSessionId, nextLayer._id, aspectRatio, nextLayer.imageSession.activeItemList);
      } else {
        nextLayerFrameImage = getBaseFrameImageForLayer(nextLayer.imageSession.activeItemList, aspectRatio, videoSessionId);
      }
    }


    const nextLayerFrameImageName = nextLayerFrameImage.split('/').pop();
    nextLayerFrameImage = await uploadFrameLayerImageToCDN(nextLayerFrameImage, nextLayerFrameImageName);

    await primeCDNCache(nextLayerFrameImage);
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
  aiVideoRenderPayload.layerId = layerId;

  aiVideoRenderPayload.useEndFrame = useEndFrame;
  aiVideoRenderPayload.useStartFrame = useStartFrame;
  aiVideoRenderPayload.combineLayers = combineLayers;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;
  aiVideoRenderPayload.retryOnFail = true;

  

  const aiRenderPayload = new AIVideoLayerGeneration(
    buildRetryableImageToVideoQueuePayload(payload, aiVideoRenderPayload),
  );

  const renderSaveRes = await aiRenderPayload.save();


}

