


import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer } from './utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from './utils/AWS.js';



export async function requestRenderKlingVideo(payload) {

  const { videoSessionId, layerId, prompt, combineLayers, useStartFrame,
    aspectRatio, model, clipLayerToAiVideo, userId, duration } = payload;
  const generateAudio = payload.generateAudio === true || payload.generate_audio === true;


  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);



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



  aiVideoRenderPayload.sessionId = videoSessionId;
  aiVideoRenderPayload.layerId = layerId;

  aiVideoRenderPayload.useEndFrame = false;
  aiVideoRenderPayload.useStartFrame = useStartFrame;
  aiVideoRenderPayload.combineLayers = false;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;
  aiVideoRenderPayload.duration = duration;
  aiVideoRenderPayload.generateAudio = generateAudio;
  aiVideoRenderPayload.retryOnFail = true;


  const aiRenderPayloadResponse = new AIVideoLayerGeneration(aiVideoRenderPayload);

  await aiRenderPayloadResponse.save();



}

