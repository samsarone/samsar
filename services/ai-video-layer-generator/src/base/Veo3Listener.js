import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function generateVeo3VideoLayer(payload) {

  const { startImage, generationId, prompt, aspectRatio, duration = 8, generateAudio = false } = payload;
  const shouldGenerateAudio = Boolean(generateAudio || payload.generate_audio);


  const durationSecs = `${duration}s`;

  const inputPayload = {

    prompt: prompt,
    aspect_ratio: aspectRatio,
    duration: durationSecs,
    generate_audio: shouldGenerateAudio,
  };

  const FA_VIDEO_LINK = getFalAILink(payload.model);

  const { request_id } = await fal.queue.submit(FA_VIDEO_LINK, {
    input: inputPayload,
  });


  return request_id;
}


export async function listenToPendingVeo3Requests(payload) {



  const { generationId } = payload;


  const FA_VIDEO_LINK = getFalAILink(payload.model);

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


function getFalAILink(model) {
  if (model === 'VEO3.1') {
    return "fal-ai/veo3.1";
  } else if (model === 'VEO3.1FAST') {
    return "fal-ai/veo3.1/fast";
  } else {
    throw new Error(`Unsupported model: ${model}`);
  }
}
