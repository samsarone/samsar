import { fal } from "@fal-ai/client";

import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import axios from "axios";
import sharp from "sharp";
import { saveRemoteFile } from "../utils/FileUtils.js"; // still available if you want raw-save somewhere else
import {
  isTerminalProviderFailureStatus,
  markImageProviderRequestFailed,
} from '../utils/ImageProviderStatus.js';

import { writeFile, mkdir } from "fs/promises";
import path from "path";

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY,
});

export async function handleNanoBananaFalRequest(payload) {
  const { apiGenerationStatus } = payload;

  if (apiGenerationStatus === "INIT") {
    await submitNanoBananaFalRequest(payload);
    return null;
  } else if (apiGenerationStatus === "PENDING") {
    const imageData = await pollNanoBananaFalRequest(payload);
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
        rowLocked: false,
      }
    );
  } catch (error) {
    console.error("Error submitting request to FAL: ", error);
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false,
      }
    );
    return { image: null };
  }
}

export async function pollNanoBananaFalRequest(payload) {
  const { _id, apiRequestId, model, aspectRatio, targetWidth, targetHeight } = payload;
  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: true });

  const falLink = getFalLinkForModel(model);

  let responseStatusData;
  try {
    responseStatusData = await fal.queue.status(falLink, {
      requestId: apiRequestId,
      logs: true,
    });
  } catch (error) {
    console.error("Error getting result from FAL: ", error);
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false,
      }
    );
    return { image: null };
  }



  const responseStatus = responseStatusData.status;

  if (isTerminalProviderFailureStatus(responseStatus)) {
    return markImageProviderRequestFailed(
      ImageGeneration,
      _id,
      `FAL ${model || 'image'} request failed with status ${responseStatus}.`
    );
  }

  if (responseStatus === "COMPLETED") {
      try {

    const result = await fal.queue.result(falLink, { requestId: apiRequestId });

      const fileImages = result.data.images;

      const imageRemoteUrl = fileImages[0].url;


      const imageName = await saveRemoteFile(imageRemoteUrl);


      await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });

      return { image: imageName };
    } catch (error) {

      await ImageGeneration.findOneAndUpdate(
        { _id },
        {
          generationStatus: "FAILED",
          apiGenerationStatus: "FAILED",
          rowLocked: false,
        }
      );
      return { image: null };
    }
  } else {
    await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
    return null;
  }
}

function getFalLinkForModel(_model) {
  return "fal-ai/nano-banana-2";
}
