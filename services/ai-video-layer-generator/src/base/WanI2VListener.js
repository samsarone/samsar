import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});




export async function generateWanVideoLayer(payload) {

  const { startImage , generationId, prompt, duration} = payload;

  let numFrames = 81;
  if (duration && duration === 7) {
    numFrames = 121;
  }


  const FA_VIDEO_LINK = getFalVideoLink(payload.model);

  const { request_id } = await fal.queue.submit(FA_VIDEO_LINK, {
    input: {
      image_url: startImage,
      prompt: prompt,
      num_frames: numFrames,
    },
  });



  return request_id;
}


export async function listenToPendingWanVideoRequests(payload) {


  
  const { generationId } = payload;


    const FA_VIDEO_LINK = getFalVideoLink(payload.model);
    

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

function getFalVideoLink(model) {

  let videoLink = "fal-ai/wan/v2.2-a14b/image-to-video";

  if (model === 'WANI2V5B') {
    videoLink = "fal-ai/wan/v2.2-5b/image-to-video";
  }
  return videoLink;
}


