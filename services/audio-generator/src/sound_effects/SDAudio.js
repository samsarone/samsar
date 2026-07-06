import { fal } from "@fal-ai/client";

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const FA_VIDEO_LINK = "fal-ai/stable-audio";


export async function generateSdAudioLayer(payload) {

  let { prompt , generationId, secondsTotal, defaultSelected } = payload;

  if (!secondsTotal) {
    secondsTotal = 5;
  }
  try {

  const { request_id } = await fal.queue.submit("fal-ai/stable-audio", {
    input: {
      prompt: prompt,
      seconds_total: secondsTotal,
    }
  });
  return request_id;

} catch (error) {
  return null;
}
}


export async function listenToPendingSDAudioRequest(payload) {

  const { generationId } = payload;


  const FA_AUDIO_LINK = "fal-ai/stable-audio";

  const responseStatusData = await fal.queue.status(FA_AUDIO_LINK, {
    requestId: generationId,
    logs: true,
  });


  const responseStatus = responseStatusData.status;


  if (responseStatus === 'COMPLETED') {

    const result = await fal.queue.result(FA_AUDIO_LINK, {
      requestId: generationId
    });

    const audioUrl = result.data.audio_file.url;

    return {
      responseStatus: 'COMPLETED',
      remoteUrl: audioUrl
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
