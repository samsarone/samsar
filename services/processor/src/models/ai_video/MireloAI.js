


import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import { getFrameImageForLayer, getBaseFrameImageForLayer } from '../../utils/ImageRenderUtils.js';
import { uploadFrameLayerImageToCDN, primeCDNCache } from '../AWS.js';



export async function requestRenderSoundEffectSyncedMireloVideo(payload) {


  const { videoSessionId, model, prompt, currentLayerId, duration, videoUrl ,
    aspectRatio, userId,
  } = payload;


  await getDBConnectionString();


  const aiVideoRenderPayload = {
    prompt: prompt,
    model: model,
    duration: duration,

    videoLink: videoUrl,
    isAudioVideoGeneration: true,

    aspectRatio: aspectRatio,
    isAudioVideoGeneration: true,
    useStartFrame: false,
    useEndFrame: false,
    sessionId: videoSessionId,
    layerId: currentLayerId,
    userId: userId,
  }

  

  const aiRenderPayload = new AIVideoLayerGeneration(aiVideoRenderPayload);
  const renderSaveRes = await aiRenderPayload.save();

}
