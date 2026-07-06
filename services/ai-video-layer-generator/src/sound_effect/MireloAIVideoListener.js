import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const FA_MM_VIDEO_LINK = "mirelo-ai/sfx1.6/video-to-video";


export async function generateSoundEffectMireloVideo(payload) {

  const { videoLink, prompt, duration } = payload;

  const { request_id } = await fal.queue.submit(FA_MM_VIDEO_LINK, {
    input: {
      video_url: videoLink,
      text_prompt: prompt,
      duration: duration || 10,
    },
  });

  return request_id;
}


export async function listenToPendingSoundEffectMireloVideoRequest(payload) {



  const { generationId } = payload;



  const responseStatusData = await fal.queue.status(FA_MM_VIDEO_LINK, {
    requestId: generationId,
    logs: true,
  });



  const responseStatus = responseStatusData.status;
  if (responseStatus === 'COMPLETED') {


    let retries = 0;
    let delay = 1000; // Start with 1 second

    while (retries < 3) {
      try {
        const result = await fal.queue.result(FA_MM_VIDEO_LINK, {
          requestId: generationId,
        });


        const videoURL = result.data?.video[0].url;

        if (videoURL) {
          return {
            responseStatus: 'COMPLETED',
            remoteUrl: videoURL,
          };
        } else {
          throw new Error("Video URL not found in response");
        }
      } catch (err) {
        retries++;
        if (retries >= 3) {
          return {
            responseStatus: 'FAILED',
            error: 'Failed to fetch video result after 3 retries',
          };
        }
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2; // Exponential backoff
      }
    }


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
