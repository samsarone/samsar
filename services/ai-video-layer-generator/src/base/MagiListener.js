import { fal } from "@fal-ai/client";
import { getFramesPerSecondFromValue } from '../utils/FpsUtils.js';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const FA_VIDEO_LINK = "fal-ai/magi-distilled/image-to-video";


export async function generateMagiImgToVidLayer(payload) {

  const { startImage , generationId,
     prompt, aspectRatio, duration = 8} = payload;
  const framesPerSecond = getFramesPerSecondFromValue(payload.framesPerSecond);

  const durationSecs = `${duration}s`;


  const inputPayload = {

    prompt: prompt,
    aspect_ratio: aspectRatio,
    duration: durationSecs,
    image_url: startImage,

    frames_per_second: framesPerSecond,
  };

  const { request_id } = await fal.queue.submit(FA_VIDEO_LINK, {
    input: inputPayload,
  });

  return request_id;
}


export async function listenToPendingMagiImgToVidLayer(payload) {

  const { generationId } = payload;



  const responseStatusData = await fal.queue.status(FA_VIDEO_LINK, {
    requestId: generationId,
    logs: true,
  });

  const responseStatus = responseStatusData.status;
  if (responseStatus === 'COMPLETED') {

    const result = await fal.queue.result(FA_VIDEO_LINK, {
      requestId: generationId
    });

    const videoURL = result.data.video.url;

    return {
      responseStatus: 'COMPLETED',
      remoteUrl: videoURL
    };
  } else if (responseStatus === 'FAILED') {
    return {
      responseStatus: 'FAILED'
    }
  } else {
    return {
      responseStatus: 'PENDING'
    } 
  }
 
}   
