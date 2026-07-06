


import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer, getRenderableItemListForLayer } from '../../utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from '../AWS.js';



export async function requestRenderVeoVideo(payload) {

  const { videoSessionId, currentLayerId, prompt, combineLayers, useStartFrame,
    useEndFrame, aspectRatio, model , duration, clipLayerToAiVideo , userId} = payload;
  const generateAudio = payload.generateAudio === true || payload.generate_audio === true;

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
    const frameBoundaryIamgeName = currentLayerFrameImage.split('/').pop();
    currentLayerFrameImage = await uploadFrameLayerImageToCDN(currentLayerFrameImage, frameBoundaryIamgeName);

    await primeCDNCache(currentLayerFrameImage);
  }


  let aiVideoRenderPayload = {
    model: model
  }


  aiVideoRenderPayload.sessionId = videoSessionId;
  aiVideoRenderPayload.layerId = currentLayerId;

  aiVideoRenderPayload.useEndFrame = false;
  aiVideoRenderPayload.useStartFrame = false;

  aiVideoRenderPayload.combineLayers = combineLayers;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;
  aiVideoRenderPayload.prompt = prompt; 
  aiVideoRenderPayload.duration = duration;
  aiVideoRenderPayload.generateAudio = generateAudio;

  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  const renderSaveRes = await aiRenderPayload.save();

}


