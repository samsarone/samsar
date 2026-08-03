import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const SEEDANCE_15_IMAGE_TO_VIDEO_LINK = "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";

const SEEDANCE_ALLOWED_ASPECT_RATIOS = new Set([
  "auto",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
]);

function normalizeSeedanceDuration(duration) {
  if (duration === "auto") {
    return "auto";
  }

  const parsedDuration = Number(duration);
  if (!Number.isFinite(parsedDuration)) {
    return undefined;
  }

  const roundedDuration = Math.round(parsedDuration);
  return Math.min(15, Math.max(4, roundedDuration));
}

function normalizeSeedanceAspectRatio(aspectRatio) {
  if (!aspectRatio || !SEEDANCE_ALLOWED_ASPECT_RATIOS.has(aspectRatio)) {
    return undefined;
  }
  return aspectRatio;
}

function getFalRequestId(submitResponse) {
  return submitResponse?.request_id || submitResponse?.requestId || null;
}

function getSeedanceImageToVideoLink(model) {
  if (model === "SEEDANCEI2V") {
    return SEEDANCE_15_IMAGE_TO_VIDEO_LINK;
  }
  const error = new Error(`${model || '<missing>'} is not supported by the FAL Seedance adapter.`);
  error.code = 'FAL_MODEL_UNSUPPORTED';
  throw error;
}

export async function generateSeeDanceImgToVideoLayer(payload) {
  const {
    startImage,
    endImage,
    prompt,
    aspectRatio,
    duration = 5,
    generateAudio = false,
    isAudioVideoGeneration = false,
    userId,
  } = payload;

  const shouldGenerateAudio = Boolean(generateAudio || isAudioVideoGeneration);
  const normalizedDuration = normalizeSeedanceDuration(duration);
  const normalizedAspectRatio = normalizeSeedanceAspectRatio(aspectRatio);

  const inputPayload = {
    prompt: prompt,
    image_url: startImage,
    generate_audio: shouldGenerateAudio,
    end_user_id: userId,
  };

  if (endImage) {
    inputPayload.end_image_url = endImage;
  }
  if (normalizedDuration !== undefined) {
    inputPayload.duration = normalizedDuration;
  }
  if (normalizedAspectRatio) {
    inputPayload.aspect_ratio = normalizedAspectRatio;
  }

  const submitResponse = await fal.queue.submit(getSeedanceImageToVideoLink(payload.model), {
    input: inputPayload,
  });

  const requestId = getFalRequestId(submitResponse);
  if (!requestId) {
    throw new Error(`Seedance submit returned no request id: ${JSON.stringify(submitResponse)}`);
  }

  return requestId;
}

async function listenToPendingSeeDanceRequests(payload, modelLink) {
  const { generationId } = payload;
  if (!generationId) {
    throw new Error("Seedance polling called without a generationId.");
  }

  const responseStatusData = await fal.queue.status(modelLink, {
    requestId: generationId,
    logs: true,
  });

  const responseStatus = responseStatusData.status;
  if (responseStatus === 'COMPLETED') {

    const result = await fal.queue.result(modelLink, {
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


export async function listenToPendingSeeDanceImgToVidRequests(payload) {
  return listenToPendingSeeDanceRequests(payload, getSeedanceImageToVideoLink(payload.model));
}
