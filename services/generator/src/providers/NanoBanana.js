import { fal } from "@fal-ai/client";

import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import axios from "axios";
import sharp from "sharp";
import { saveRemoteFile } from "../utils/FileUtils.js"; // still available if you want raw-save somewhere else

import { writeFile, mkdir } from "fs/promises";
import path from "path";

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY,
});

export async function handleNanoBananaFalRequest(payload, dependencies = {}) {
  const { apiGenerationStatus } = payload;

  if (apiGenerationStatus === "INIT") {
    return await submitNanoBananaFalRequest(payload);
  } else if (apiGenerationStatus === "PENDING") {
    const imageData = await pollNanoBananaFalRequest(payload, dependencies);
    return imageData;
  } else if (apiGenerationStatus === "FAILED") {

    return {
      image: null,
    };
  }
}

export async function submitNanoBananaFalRequest(payload) {
  const { _id, model, prompt, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  const falLink = getFalLinkForModel(model);

  const reqPayload = {
    prompt,
    aspect_ratio: aspectRatio,
    num_images: 1,
  };

  try {
    const response = await fal.queue.submit(falLink, {
      input: reqPayload,
    });

    const requestId = response.request_id;

    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: requestId,
        apiGenerationStatus: "PENDING",
        apiSubmittedAt: new Date(),
        externalProvider: "fal",
        rowLocked: false,
      }
    );
    return null;
  } catch (error) {
    console.error("Error submitting request to FAL: ", error);
    const message = error?.message || "Unable to submit Nano Banana request to FAL.";
    return { image: null, error: message };
  }
}

export async function pollNanoBananaFalRequest(payload, dependencies = {}) {
  const { _id, apiRequestId, model, aspectRatio, targetWidth, targetHeight } = payload;
  const connect = dependencies.connect || getDBConnectionString;
  const imageGenerationModel = dependencies.imageGenerationModel || ImageGeneration;
  const queueStatus = dependencies.queueStatus || ((...args) => fal.queue.status(...args));
  const queueResult = dependencies.queueResult || ((...args) => fal.queue.result(...args));
  const saveFile = dependencies.saveFile || saveRemoteFile;
  const logger = dependencies.logger || console;
  await connect();
  await imageGenerationModel.findOneAndUpdate({ _id }, { rowLocked: true });

  const falLink = getFalLinkForModel(model);

  let responseStatusData;
  try {
    responseStatusData = await queueStatus(falLink, {
      requestId: apiRequestId,
      logs: true,
    });
  } catch (error) {
    logger.error("Error getting result from FAL: ", error);
    // A polling transport error does not prove that the submitted provider
    // request failed. Keep it pinned so the next pass resumes the same request.
    await imageGenerationModel.findOneAndUpdate(
      { _id },
      {
        rowLocked: false,
      }
    );
    return null;
  }



  const responseStatus = responseStatusData.status;


  if (responseStatus === "FAILED" || responseStatus === "CANCELLED" || responseStatus === "CANCELED") {
    const message = `FAL Nano Banana request ${responseStatus.toLowerCase()}.`;
    return { image: null, error: message };
  }

  if (responseStatus === "COMPLETED") {
      try {

    const result = await queueResult(falLink, { requestId: apiRequestId });

      const fileImages = result.data.images;

      const imageRemoteUrl = fileImages[0].url;


      const imageName = await saveFile(imageRemoteUrl);

      return { image: imageName };
    } catch (error) {
      return {
        image: null,
        error: error?.message || "FAL Nano Banana result could not be downloaded.",
      };
    }
  } else {
    await imageGenerationModel.findOneAndUpdate({ _id }, { rowLocked: false });
    return null;
  }
}

function getFalLinkForModel(_model) {
  return "fal-ai/nano-banana-2";
}
