import { fal } from "@fal-ai/client";

const FAL_API_KEY = process.env.FAL_API_KEY;
const COSMOS3_IMAGE_TO_VIDEO_LINK = "nvidia/cosmos-3-super/image-to-video";
const DEFAULT_COSMOS3_FRAMES_PER_SECOND = 24;
const MIN_COSMOS3_FRAMES_PER_SECOND = 4;
const MAX_COSMOS3_FRAMES_PER_SECOND = 60;
const MIN_COSMOS3_NUM_FRAMES = 5;
const MAX_COSMOS3_NUM_FRAMES = 189;
const DEFAULT_COSMOS3_DURATION_SECONDS = 5;

fal.config({
  credentials: FAL_API_KEY,
});

function getCosmosImageSize(aspectRatio) {
  if (aspectRatio === "9:16") {
    return "portrait_16_9";
  }
  if (aspectRatio === "1:1") {
    return "square";
  }
  if (aspectRatio === "4:3") {
    return "landscape_4_3";
  }
  if (aspectRatio === "3:4") {
    return "portrait_4_3";
  }
  return "landscape_16_9";
}

function normalizeCosmosFramesPerSecond(framesPerSecond) {
  const parsedFramesPerSecond = Number(framesPerSecond);
  const fps = Number.isFinite(parsedFramesPerSecond) && parsedFramesPerSecond > 0
    ? parsedFramesPerSecond
    : DEFAULT_COSMOS3_FRAMES_PER_SECOND;
  return Math.min(
    MAX_COSMOS3_FRAMES_PER_SECOND,
    Math.max(MIN_COSMOS3_FRAMES_PER_SECOND, Math.round(fps)),
  );
}

function getCosmosNumFrames(duration, framesPerSecond) {
  const durationSeconds = Number(duration);
  const normalizedDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : DEFAULT_COSMOS3_DURATION_SECONDS;
  return Math.min(
    MAX_COSMOS3_NUM_FRAMES,
    Math.max(MIN_COSMOS3_NUM_FRAMES, Math.round(normalizedDuration * framesPerSecond)),
  );
}

function summarizeFalError(error) {
  return {
    name: error?.name,
    message: error?.message,
    status: error?.status,
    body: error?.body,
  };
}

export async function generateCosmos3ImgToVidLayer(payload) {
  const { startImage, prompt, aspectRatio, duration = 5, framesPerSecond } = payload;

  if (!startImage) {
    throw new Error("Cosmos 3 image-to-video requires a start image.");
  }

  const renditionFramesPerSecond = normalizeCosmosFramesPerSecond(framesPerSecond);

  const inputPayload = {
    prompt: typeof prompt === "string" && prompt.trim() ? prompt.trim() : "Camera slowly pushes in with subtle cinematic motion.",
    image_url: startImage,
    image_size: getCosmosImageSize(aspectRatio),
    num_frames: getCosmosNumFrames(duration, renditionFramesPerSecond),
    frames_per_second: renditionFramesPerSecond,
    enable_agentic_generation: false,
    enable_prompt_expansion: true,
  };

  try {
    const { request_id } = await fal.queue.submit(COSMOS3_IMAGE_TO_VIDEO_LINK, {
      input: inputPayload,
    });

    return request_id;
  } catch (error) {
    console.error("Error submitting Cosmos 3 image-to-video request:", {
      error: summarizeFalError(error),
      inputPayload: {
        ...inputPayload,
        image_url: inputPayload.image_url ? "[redacted-url]" : inputPayload.image_url,
      },
    });
    throw error;
  }
}

export async function listenToPendingCosmos3ImgToVidRequests(payload) {
  try {
    const { generationId } = payload;

    const responseStatusData = await fal.queue.status(COSMOS3_IMAGE_TO_VIDEO_LINK, {
      requestId: generationId,
      logs: true,
    });

    const responseStatus = responseStatusData.status;
    if (responseStatus === "COMPLETED") {
      const result = await fal.queue.result(COSMOS3_IMAGE_TO_VIDEO_LINK, {
        requestId: generationId,
      });

      return {
        responseStatus: "COMPLETED",
        remoteUrl: result.data.video.url,
      };
    }

    if (responseStatus === "FAILED") {
      const providerFailureMessage = responseStatusData?.error?.message ||
        responseStatusData?.error ||
        responseStatusData?.logs?.findLast?.((entry) => entry?.message)?.message ||
        "Cosmos 3 provider request failed.";
      return {
        responseStatus: "FAILED",
        providerFailureMessage,
        providerStatus: {
          status: responseStatus,
          error: responseStatusData?.error || null,
          logs: Array.isArray(responseStatusData?.logs)
            ? responseStatusData.logs.slice(-5)
            : [],
        },
      };
    }

    return {
      responseStatus: "PENDING",
    };
  } catch (error) {
    console.error("Error in listenToPendingCosmos3ImgToVidRequests:", summarizeFalError(error));
    throw error;
  }
}
