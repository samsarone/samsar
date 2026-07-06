


import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer, getRenderableItemListForLayer } from '../../utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from '../AWS.js';



export async function requestRenderKlingVideo(payload) {

  const { videoSessionId, currentLayerId, prompt, combineLayers, useStartFrame,
    useEndFrame, aspectRatio, model , clipLayerToAiVideo, userId , duration = 5 } = payload;
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



  const modelName = getModelNameFromModelType(model, currentLayerFrameImage);


  let aiVideoRenderPayload = {
    prompt: prompt,
    model: modelName
  }
  if (currentLayerFrameImage) {
    aiVideoRenderPayload.startImage = currentLayerFrameImage;
  }

  aiVideoRenderPayload.sessionId = videoSessionId;
  aiVideoRenderPayload.layerId = currentLayerId;

  aiVideoRenderPayload.useEndFrame = false;
  aiVideoRenderPayload.useStartFrame = useStartFrame;
  aiVideoRenderPayload.combineLayers = combineLayers;
  aiVideoRenderPayload.aspectRatio = aspectRatio;
  aiVideoRenderPayload.clipLayerToAiVideo = clipLayerToAiVideo;
  aiVideoRenderPayload.userId = userId;
  aiVideoRenderPayload.duration = duration;
  aiVideoRenderPayload.generateAudio = generateAudio;



  if (videoSession.isExpressGeneration) {
    aiVideoRenderPayload.isSecondaryExpressGeneration = true;
  }


  
  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  const renderSaveRes = await aiRenderPayload.save();


}




function getModelNameFromModelType(modelType, startFrame) {

  if (modelType === 'KLINGTXTTOVID3PRO') {
    return 'KLINGTXTTOVID3PRO';
  }

  if (startFrame && startFrame.length > 0) {
    if (modelType === 'KLINGIMGTOVIDSTANDARD') {
      return 'KLINGIMGTOVIDSTANDARD';
    } else if (modelType === 'KLINGIMGTOVIDPRO') {
      return 'KLINGIMGTOVIDPRO';
    } else if (modelType === 'KLINGIMGTOVID3PRO' || modelType === 'KLINGIMGTOVIDTURBO') {
      return 'KLINGIMGTOVID3PRO';
    } else if (modelType === 'KLINGIMGTOVIDPROMASTER') {
      return 'KLINGIMGTOVIDPROMASTER';
    } else if (modelType === 'KLINGIMGTOVID2.1STANDARD') {
      return 'KLINGIMGTOVID2.1STANDARD';
    }else if (modelType === 'KLINGIMGTOVID2.1MASTER') {
      return 'KLINGIMGTOVID2.1MASTER';
    }else if (modelType === 'KLINGIMGTOVID2.1PRO') {
      return 'KLINGIMGTOVID2.1PRO';
    }

      
  } else {
    if (modelType === 'KLINGIMGTOVIDSTANDARD') {
      return 'KLINGTXTTOVIDSTANDARD';
    } else if (modelType === 'KLINGIMGTOVIDPRO') {
      return 'KLINGTXTTOVIDPRO';
    } else if (
      modelType === 'KLINGIMGTOVID3PRO' ||
      modelType === 'KLINGTXTTOVID3PRO' ||
      modelType === 'KLINGIMGTOVIDTURBO' ||
      modelType === 'KLINGTXTTOVIDTURBO'
    ) {
      return 'KLINGTXTTOVID3PRO';
    }

  }
}
