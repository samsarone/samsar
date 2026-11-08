import { isProviderNetworkError, getProviderResultInfrastructureCode } from '../utils/ProviderNetworkRecovery.js';
import { fal } from "@fal-ai/client";
import { prepareFalSoundEffectSubmission } from '../billing/FalSoundEffectSubmission.js';
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const FA_MM_VIDEO_LINK = "mirelo-ai/sfx1.6/video-to-video";


export async function generateSoundEffectMireloVideo(payload, dependencies = {}) {

  const { videoLink, prompt, duration } = payload;
  const requestedSeconds = duration || 10;
  const submittedSamples = 1; // Only the first result is delivered.
  await prepareFalSoundEffectSubmission(payload, requestedSeconds, submittedSamples, dependencies);

  const { request_id } = await (dependencies.queue || fal.queue).submit(FA_MM_VIDEO_LINK, {
    input: {
      video_url: videoLink,
      text_prompt: prompt,
      duration: requestedSeconds,
      num_samples: submittedSamples,
    },
  });

  return request_id;
}


export async function listenToPendingSoundEffectMireloVideoRequest(payload, dependencies = {}) {



  const { generationId } = payload;
  const queue = dependencies.queue || fal.queue;



  const responseStatusData = await queue.status(FA_MM_VIDEO_LINK, {
    requestId: generationId,
    logs: true,
  });



  const responseStatus = responseStatusData.status;
  if (responseStatus === 'COMPLETED') {


    let retries = 0;
    let delay = 1000; // Start with 1 second

    while (retries < 3) {
      try {
        const result = await queue.result(FA_MM_VIDEO_LINK, {
          requestId: generationId,
        });


        const videoURL = result.data?.video[0].url;
        const sampleCount = Array.isArray(result.data?.video) ? result.data.video.length : 0;

        if (videoURL && sampleCount > 0) {
          return {
            responseStatus: 'COMPLETED',
            remoteUrl: videoURL,
            videoBillingReceipt: { sampleCount },
          };
        } else {
          throw new Error("Video URL not found in response");
        }
      } catch (err) {
        const body = err?.body || err?.response?.data || err?.data;
        const code = getProviderResultInfrastructureCode({ providerStatus: { status: err?.status || err?.response?.status, ...body } });
        if (Array.isArray(body?.detail) && code) return { responseStatus: 'FAILED', providerFailureCode: code, providerFailureMessage: body.detail.map(x => x.msg).join('; ') };
        if (isProviderNetworkError(err)) throw err;
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
