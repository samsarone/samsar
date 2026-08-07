import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


const SEEDANCE_15_IMAGE_TO_VIDEO_LINK = "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";
const SEEDANCE_20_IMAGE_TO_VIDEO_LINK = "bytedance/seedance-2.0/image-to-video";
const SEEDANCE_25_IMAGE_TO_VIDEO_LINK = "bytedance/seedance-2.5/image-to-video";
const SEEDANCE_25_DURATION_UNITS = Object.freeze([5, 10, 15, 20, 25, 30]);

const SEEDANCE_ALLOWED_ASPECT_RATIOS = new Set([
  "auto",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
]);

function normalizeSeedanceDuration(duration, model) {
  if (duration === "auto") {
    return model === "SEEDANCE2.5I2V" ? SEEDANCE_25_DURATION_UNITS[0] : "auto";
  }

  const parsedDuration = Number(duration);
  if (!Number.isFinite(parsedDuration)) {
    return undefined;
  }

  if (model === "SEEDANCE2.5I2V") {
    return SEEDANCE_25_DURATION_UNITS.reduce((closest, unit) => (
      Math.abs(unit - parsedDuration) < Math.abs(closest - parsedDuration) ? unit : closest
    ), SEEDANCE_25_DURATION_UNITS[0]);
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

export function getSeedanceImageToVideoLink(model) {
  if (model === "SEEDANCEI2V") {
    return SEEDANCE_15_IMAGE_TO_VIDEO_LINK;
  }
  if (model === "SEEDANCE2.0I2V") {
    return SEEDANCE_20_IMAGE_TO_VIDEO_LINK;
  }
  if (model === "SEEDANCE2.5I2V") {
    return SEEDANCE_25_IMAGE_TO_VIDEO_LINK;
  }
  const error = new Error(`${model || '<missing>'} is not supported by the FAL Seedance adapter.`);
  error.code = 'FAL_MODEL_UNSUPPORTED';
  throw error;
}

export function buildSeedanceInputPayload(payload) {
  const {
    startImage,
    endImage,
    prompt,
    aspectRatio,
    duration = 5,
    generateAudio = false,
    generate_audio = false,
    isAudioVideoGeneration = false,
    userId,
  } = payload;

  const normalizedGenerationType = typeof payload.generationType === 'string'
    ? payload.generationType.trim().toLowerCase()
    : '';
  const normalizedLayerAiVideoType = typeof payload.layerAiVideoType === 'string'
    ? payload.layerAiVideoType.trim().toLowerCase()
    : '';
  const isSoundEffectLayer = normalizedGenerationType === 'sound_effect' ||
    normalizedLayerAiVideoType === 'sound_effect';
  const shouldGenerateAudio = Boolean(
    generateAudio === true ||
    generate_audio === true ||
    isAudioVideoGeneration === true ||
    isSoundEffectLayer,
  );
  const normalizedDuration = normalizeSeedanceDuration(duration, payload.model);
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
  if (payload.model === "SEEDANCE2.0I2V" || payload.model === "SEEDANCE2.5I2V") {
    inputPayload.resolution = "720p";
  }

  return inputPayload;
}

export async function generateSeeDanceImgToVideoLayer(payload) {
  const inputPayload = buildSeedanceInputPayload(payload);

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
