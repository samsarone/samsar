

import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer } from './utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from './utils/AWS.js';
import { buildRetryableImageToVideoQueuePayload } from './utils/AIVideoQueuePayload.js';

export async function requestRenderVeo3I2VVideo(payload) {

  const {
    videoSessionId,
    layerId,
    useStartFrame,
    aspectRatio,
    duration = 8,
  } = payload;
  const generateAudio = payload.generateAudio === true || payload.generate_audio === true;


  await getDBConnectionString();

  const videoSession = await VideoSession.findById(videoSessionId);
  const currentLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() === layerId);

  const currentLayer = videoSession.layers[currentLayerIndex];

  const layerSceneType = currentLayer.layerAiVideoType || 'video';
  const isAudioVideoGeneration = payload.isAudioVideoLayer || layerSceneType === 'sound_effect';


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





  const aiVideoRenderPayload = buildRetryableImageToVideoQueuePayload(payload, {
    useEndFrame: false,
    duration,
    generateAudio,
    isAudioVideoGeneration,
    isAudioVideoLayer: payload.isAudioVideoLayer,
    audioPrompt: currentLayer.layerAISoundEffectPrompt,
    ...(currentLayerFrameImage ? { startImage: currentLayerFrameImage } : {}),
    ...(nextLayerFrameImage ? { endImage: nextLayerFrameImage } : {}),
  });
  

  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  const renderSaveRes = await aiRenderPayload.save();




  // Render video
}
