import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const FA_VIDEO_LINK = "fal-ai/pika/v2.2/image-to-video";


export async function generatePikaImgToVidLayer(payload) {

  const { startImage , generationId, 
     prompt, aspectRatio, duration = 5} = payload;


  const inputPayload = {

    prompt: prompt,
    duration: duration,
    image_url: startImage,
  };

  const { request_id } = await fal.queue.submit(FA_VIDEO_LINK, {
    input: inputPayload,
  });

  return request_id;
}


export async function listenToPendingPikaImgToVidRequests(payload) {


  
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
