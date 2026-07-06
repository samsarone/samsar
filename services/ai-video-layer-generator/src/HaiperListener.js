import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const FA_VIDEO_LINK = "fal-ai/haiper-video-v2/image-to-video";


export async function generateHaiperVideoLayer(payload) {

  let { startImage, generationId, prompt, aspectRatio ,   duration } = payload;

  let inputPayload = {
    image_url: startImage,
    prompt: prompt,
    "prompt_enhancer": true,
  };

  if (!duration) {
    duration = 4;
  }
  duration = duration.toString();
  inputPayload['duration'] = duration;



  const { request_id } = await fal.queue.submit(FA_VIDEO_LINK, {
    input: inputPayload
  });


  return request_id;
}


export async function listenToPendingHaiperVideoRequest(payload) {

  const { generationId } = payload;



  const responseStatusData = await fal.queue.status(FA_VIDEO_LINK, {
    requestId: generationId,
    logs: true,
  });



  const responseStatus = responseStatusData.status;



  if (responseStatus === 'COMPLETED') {

    try {
      const result = await fal.queue.result(FA_VIDEO_LINK, {
        requestId: generationId
      });

      const videoURL = result.data.video.url;
      return {
        responseStatus: 'COMPLETED',
        remoteUrl: videoURL
      };

    } catch (error) {
      console.error(error);
      return {
        responseStatus: 'FAILED'
      };
    }
  } else if (responseStatus === 'FAILED') {

    return {
      responseStatus: 'FAILED'
    };
  } else {
    return {
      responseStatus: 'PENDING'
    };
  }

}