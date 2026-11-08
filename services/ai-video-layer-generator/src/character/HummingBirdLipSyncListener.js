import { isProviderNetworkError, isProviderHttpFailure, completedProviderResultFailure } from '../utils/ProviderNetworkRecovery.js';
import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


import { getDBConnectionString } from "../DBString.js";


export async function generateHummingBirdLipSyncLayer(payload) {

  const { videoLink, audioLink } = payload;



  const inputPayload = {
    video_url: videoLink,
    audio_url: audioLink,
  };

  if (!videoLink || !audioLink) {
    throw new Error("Missing video or audio link");
  }

  const FAL_VIDEO_LINK = getHummingBirdLipSyncForModel();



  const apiRequestPayload = {
    input: inputPayload,
  }


  
  try {

    const { request_id } = await fal.queue.submit(FAL_VIDEO_LINK, apiRequestPayload);


    return request_id;
  } catch (error) {
    if (isProviderNetworkError(error)) throw error;
    console.error('[lip_sync][hummingbird][submit_failed] HummingBird lip sync submit failed', {
      sessionId: payload?.sessionId || null,
      layerId: payload?.layerId || null,
      model: payload?.model || null,
      error: {
        message: error?.message || String(error),
        status: error?.status || error?.statusCode || error?.response?.status || null,
        code: error?.code || null,
        body: error?.body || error?.response?.data || error?.data || null,
      },
    });
    throw error;
  }

}

export async function listenToPendingHummingBirdLipSyncRequests(payload) {

    await getDBConnectionString();
  
    const { generationId, model } = payload;
  
    let providerCompleted = false;
  try {
  
      const FAL_VIDEO_LINK = getHummingBirdLipSyncForModel();
  
  
      const responseStatusData = await fal.queue.status(FAL_VIDEO_LINK, {
        requestId: generationId,
      });
  
  
      const responseStatus = responseStatusData.status;
  
  
      if (responseStatus === 'COMPLETED') {
      providerCompleted = true;
  
  
  
        const result = await fal.queue.result(FAL_VIDEO_LINK, {
          requestId: generationId
        });
  
  
  
        const videoURL = result.data.video.url;
        if (!videoURL) {

          return {
            responseStatus: 'FAILED'
          };
        }
        return {
          responseStatus: 'COMPLETED',
          remoteUrl: videoURL
        };
      } else if (responseStatus === 'FAILED') {

        return {
          responseStatus: 'FAILED'
        };
      } else {
        return {
          responseStatus: 'PENDING'
        }
      }
  
    } catch (error) {
    const executionFailure = providerCompleted ? completedProviderResultFailure(error) : null;
    if (executionFailure) return executionFailure;
    if (isProviderNetworkError(error) || isProviderHttpFailure(error)) throw error;
      console.error(error);
  
      return {
        responseStatus: 'FAILED'
      }
    }

  
}


function getHummingBirdLipSyncForModel() {
  return "fal-ai/tavus/hummingbird-lipsync/v0";
}

