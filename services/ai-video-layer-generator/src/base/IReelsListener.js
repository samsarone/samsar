import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const FA_VIDEO_LINK = "fal-ai/skyreels-i2v";


export async function generateSkyReelsVideoLayer(payload) {

  const { startImage , generationId, prompt} = payload;
  

  const { request_id } = await fal.queue.submit(FA_VIDEO_LINK, {
    input: {
      image_url: startImage,
      prompt: prompt,
    },
  });


  return request_id;
}


export async function listenToPendingSkyReelsVideoRequests(payload) {


  
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