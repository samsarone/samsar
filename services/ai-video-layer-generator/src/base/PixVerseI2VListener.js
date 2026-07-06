import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});



function getFalVideoLinkForModel(model) {

  let linkForModel = '';

  if (model === 'PIXVERSEI2V') {
    linkForModel = "fal-ai/pixverse/v4.5/image-to-video";
  } else if (model === 'PIXVERSEI2VFAST') {
    linkForModel = "fal-ai/pixverse/v4.5/image-to-video/fast";
  }

  return linkForModel;

}






export async function generatePixVerseVideoLayer(payload) {

  const { startImage , generationId, prompt, aspectRatio, duration = 8, 
    model,
    animationType} = payload;

  const resolutionPixels = '720p';

  const videoModelLink = getFalVideoLinkForModel(model);

  const inputPayload = {
    prompt: prompt,
    image_url: startImage,
    duration: `${duration}`,
    aspect_ratio: aspectRatio,
    resolution: resolutionPixels,
    animationType: animationType,
  };

  const { request_id } = await fal.queue.submit(videoModelLink, {
    input: inputPayload,
  });

  return request_id;
}


export async function listenToPendingPixVerseRequests(payload) {


  
  const { generationId, model } = payload;

  const videoModelLink = getFalVideoLinkForModel(model);

  const responseStatusData = await fal.queue.status(videoModelLink, {
    requestId: generationId,
    logs: true,
  });


  const responseStatus = responseStatusData.status;

  if (responseStatus === 'COMPLETED') {

    const result = await fal.queue.result(videoModelLink, {
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
