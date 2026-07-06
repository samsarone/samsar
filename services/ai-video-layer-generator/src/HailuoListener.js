import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});



export async function generateHailuoVideoLayer(payload) {

  const { startImage, generationId, prompt, aspectRatio, usePromptOptimizer, duration = 6 } = payload;


  let inputPayload = {
    image_url: startImage,
    prompt: prompt,
    "prompt_optimizer": usePromptOptimizer ? usePromptOptimizer : false,
    duration: duration
  };
  if (aspectRatio === '9:16') {
    // inputPayload['ratio'] = '9:16';
  }
  if (aspectRatio === '16:9') {
    //inputPayload['ratio'] = '16:9';
  }

  const HAILUO_VIDEO_LINK = getFalVideoLink(payload.model);



  const { request_id } = await fal.queue.submit(HAILUO_VIDEO_LINK, {
    input: inputPayload,
  });


  

  return request_id;
}


export async function listenToPendingHailuoVideoRequest(payload) {

  const { generationId } = payload;

  const HAILUO_VIDEO_LINK = getFalVideoLink(payload.model);

  const responseStatusData = await fal.queue.status(HAILUO_VIDEO_LINK, {
    requestId: generationId,
    logs: true,
  });


  const responseStatus = responseStatusData.status;
  if (responseStatus === 'COMPLETED') {

    const result = await fal.queue.result(HAILUO_VIDEO_LINK, {
      requestId: generationId
    });

    const videoURL = result.data.video.url;



    return {
      remoteUrl: videoURL,
      responseStatus: 'COMPLETED'
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
  let videoLink = "fal-ai/minimax/hailuo-02/standard/image-to-video";

  if (model === 'HAILUOPRO') {
    videoLink = "fal-ai/minimax/hailuo-02/pro/image-to-video";
  }

  return videoLink;
}


