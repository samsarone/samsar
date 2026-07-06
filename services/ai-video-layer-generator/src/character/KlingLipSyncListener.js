import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


import { getDBConnectionString } from "../DBString.js";


export async function generateKlingLipSyncLayer(payload) {

  const { videoLink, audioLink } = payload;

  const inputPayload = {
    video_url: videoLink,
    audio_url: audioLink,
  };



  if (!videoLink || !audioLink) {
    throw new Error("Missing video or audio link");
  }



  const FAL_VIDEO_LINK = getLatentSyncForModel();



  const apiRequestPayload = {
    input: inputPayload,
  }



  try {

    const { request_id } = await fal.queue.submit(FAL_VIDEO_LINK, apiRequestPayload);



    return request_id;
  } catch (error) {
    console.error("Error generating lipsync");
    


    return {
      responseStatus: 'FAILED'
    }
  }

}

export async function listenToPendingKlingLipSyncRequests(payload) {
  await getDBConnectionString();



  const { generationId, model } = payload;

  try {

    const FAL_VIDEO_LINK = getLatentSyncForModel();


    const responseStatusData = await fal.queue.status(FAL_VIDEO_LINK, {
      requestId: generationId,
    });

    const responseStatus = responseStatusData.status;

    if (responseStatus === 'COMPLETED') {

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
      console.error("LIP SYNC FAILED");
      

      return {
        responseStatus: 'FAILED'
      };
    } else {
      return {
        responseStatus: 'PENDING'
      }
    }

  } catch (error) {
    console.error(error);

    return {
      responseStatus: 'FAILED'
    }
  }
}

function getLatentSyncForModel() {
  return "fal-ai/kling-video/lipsync/audio-to-video";
}