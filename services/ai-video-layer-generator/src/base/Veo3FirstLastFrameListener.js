import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});

const FAL_VIDEO_LINK = "fal-ai/veo3.1/first-last-frame-to-video";

function getVeoDuration(duration) {
  const parsedDuration = Number(duration);
  if (!Number.isFinite(parsedDuration)) {
    return "8s";
  }

  const roundedDuration = Math.round(parsedDuration);
  if (roundedDuration === 4 || roundedDuration === 6 || roundedDuration === 8) {
    return `${roundedDuration}s`;
  }

  return "8s";
}

export async function generateVeo3FirstLastFrameVideoLayer(payload) {
  const {
    startImage,
    endImage,
    prompt,
    aspectRatio = "auto",
    duration = 8,
  } = payload;
  const generateAudio = payload.generateAudio === true || payload.generate_audio === true;

  if (!startImage || !endImage) {
    throw new Error("VEO3.1 first/last frame generation requires startImage and endImage.");
  }

  const inputPayload = {
    prompt,
    aspect_ratio: aspectRatio,
    duration: getVeoDuration(duration),
    first_frame_url: startImage,
    last_frame_url: endImage,
    generate_audio: generateAudio,
    resolution: "720p",
  };

  const { request_id } = await fal.queue.submit(FAL_VIDEO_LINK, {
    input: inputPayload,
  });

  return request_id;
}

export async function listenToPendingVeo3FirstLastFrameVideoRequests(payload) {
  try {
    const { generationId } = payload;

    const responseStatusData = await fal.queue.status(FAL_VIDEO_LINK, {
      requestId: generationId,
      logs: true,
    });

    const responseStatus = responseStatusData.status;
    if (responseStatus === 'COMPLETED') {
      const result = await fal.queue.result(FAL_VIDEO_LINK, {
        requestId: generationId
      });

      return {
        responseStatus: 'COMPLETED',
        remoteUrl: result.data.video.url
      };
    } else if (responseStatus === 'FAILED') {
      return {
        responseStatus: 'FAILED'
      };
    }

    return {
      responseStatus: 'PENDING'
    };
  } catch (error) {
    console.error("Error in listenToPendingVeo3FirstLastFrameVideoRequests:");
    console.error(error);
    return {
      responseStatus: 'FAILED'
    };
  }
}
