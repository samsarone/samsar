import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const FA_VIDEO_LINK = "fal-ai/stable-video";


export async function generateSdVideoLayer(payload) {

  const { startImage , generationId} = payload;





  const { request_id } = await fal.queue.submit(FA_VIDEO_LINK, {
    input: {
      image_url: startImage,
    },
  });



  return request_id;
}


export async function listenToPendingSDVideoRequest(payload) {


  
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