import { fal } from "@fal-ai/client";

const FAL_API_KEY = process.env.FAL_API_KEY;
const HAPPY_HORSE_IMAGE_TO_VIDEO_LINK = "alibaba/happy-horse/v1.1/image-to-video";
const HAPPY_HORSE_DURATION_OPTIONS = [5, 10, 15];

fal.config({
  credentials: FAL_API_KEY
});

function normalizeHappyHorseDuration(duration) {
  const parsedDuration = Number(duration);
  if (!Number.isFinite(parsedDuration)) {
    return HAPPY_HORSE_DURATION_OPTIONS[0];
  }

  return HAPPY_HORSE_DURATION_OPTIONS.find((unit) => unit >= parsedDuration) ||
    HAPPY_HORSE_DURATION_OPTIONS[HAPPY_HORSE_DURATION_OPTIONS.length - 1];
}

function getFalRequestId(submitResponse) {
  return submitResponse?.request_id || submitResponse?.requestId || null;
}

function removeEmptyValues(inputPayload) {
  return Object.fromEntries(
    Object.entries(inputPayload).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

export async function generateHappyHorseImgToVideoLayer(payload) {
  const {
    startImage,
    prompt,
    duration = 5,
  } = payload;

  const inputPayload = removeEmptyValues({
    image_url: startImage,
    prompt,
    resolution: "720p",
    duration: normalizeHappyHorseDuration(duration),
    enable_safety_checker: true,
  });

  const submitResponse = await fal.queue.submit(HAPPY_HORSE_IMAGE_TO_VIDEO_LINK, {
    input: inputPayload,
  });

  const requestId = getFalRequestId(submitResponse);
  if (!requestId) {
    throw new Error(`Happy Horse submit returned no request id: ${JSON.stringify(submitResponse)}`);
  }

  return requestId;
}

export async function listenToPendingHappyHorseImgToVidRequests(payload) {
  const { generationId } = payload;
  if (!generationId) {
    throw new Error("Happy Horse polling called without a generationId.");
  }

  const responseStatusData = await fal.queue.status(HAPPY_HORSE_IMAGE_TO_VIDEO_LINK, {
    requestId: generationId,
    logs: true,
  });

  const responseStatus = responseStatusData.status;
  if (responseStatus === 'COMPLETED') {
    const result = await fal.queue.result(HAPPY_HORSE_IMAGE_TO_VIDEO_LINK, {
      requestId: generationId
    });

    return {
      responseStatus: 'COMPLETED',
      remoteUrl: result.data.video.url
    };
  }

  if (responseStatus === 'FAILED') {
    return {
      responseStatus: 'FAILED'
    };
  }

  return {
    responseStatus: 'PENDING'
  };
}
