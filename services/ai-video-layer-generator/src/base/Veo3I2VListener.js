import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});





export async function generateVeo3ImgToVidLayer(payload) {

  const { startImage, generationId,
    prompt, aspectRatio, duration = 8, generateAudio = false, isAudioVideoGeneration = false } = payload;



  const shouldGenerateAudio = Boolean(generateAudio || isAudioVideoGeneration);
    
  const durationSecs = `${duration}s`;

  const FA_VIDEO_LINK = getFalAILink(payload.model);


  const inputPayload = {

    prompt: prompt,
    aspect_ratio: aspectRatio,
    duration: durationSecs,
    image_url: startImage,
    generate_audio: shouldGenerateAudio,
    resolution: "720p"
  };



  const { request_id } = await fal.queue.submit(FA_VIDEO_LINK, {
    input: inputPayload,
  });


  return request_id;
}


export async function listenToPendingVeo3ImgToVidRequests(payload) {

  try {

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

  } catch (error) {
    console.error("Error in listenToPendingVeo3ImgToVidRequests:");
    console.error(error);
    return {
      responseStatus: 'FAILED'
    }
  }
}


function getFalAILink(model) {
  if (model === 'VEO3.1I2V') {
    return "fal-ai/veo3.1/image-to-video";
  } else if (model === 'VEO3.1I2VFAST') {
    return "fal-ai/veo3.1/fast/image-to-video";
  } else {
    throw new Error(`Unsupported model: ${model}`);
  }
}
