


import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer } from '../../utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from '../AWS.js';



export async function requestRenderSyncLipSyncVideo(payload) {

  const { videoSessionId, currentLayerId, prompt, combineLayers, useStartFrame,
    useEndFrame, aspectRatio, model , clipLayerToAiVideo, userId , duration,
  audioLink, videoLink, audioPrompt} = payload;



  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === currentLayerId);

  const currentLayer = videoSession.layers[currentLayerIndex];

  const activeItemList = currentLayer.imageSession.activeItemList;


  let currentLayerFrameImage;




  let requestDuration = 4;
  if (duration) {
    requestDuration = duration;
  }


  let aiVideoRenderPayload = {
    prompt: prompt,
    model: model,
    duration: requestDuration,
    generationType: 'lip_sync',
    isAudioVideoGeneration: true,
    retryOnFail: payload.retryOnFail ?? false,
  }



  if (currentLayerFrameImage) {
    aiVideoRenderPayload.startImage = currentLayerFrameImage;
  }

  aiVideoRenderPayload.sessionId = videoSessionId;
  aiVideoRenderPayload.layerId = currentLayerId;

 // aiVideoRenderPayload.useEndFrame = false;
 // aiVideoRenderPayload.useStartFrame = useStartFrame;
 // aiVideoRenderPayload.combineLayers = combineLayers;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;


  aiVideoRenderPayload.videoLink = videoLink;
  aiVideoRenderPayload.audioLink = audioLink;
  aiVideoRenderPayload.audioPrompt = audioPrompt;


  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  const renderSaveRes = await aiRenderPayload.save();


}
