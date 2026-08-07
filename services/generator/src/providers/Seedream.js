import { fal } from "@fal-ai/client";
import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import axios from 'axios';


import { saveRemoteFile } from "../utils/FileUtils.js";
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { isSubmissionOutcomeUnknown } from '../utils/ProviderSubmissionSafety.js';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function handleSeedreamRequest(payload, dependencies = {}) {
  const { apiGenerationStatus, apiRequestId, model } = payload;
  const submitRequest = dependencies.submitRequest || submitSeedreamRequest;
  const pollRequest = dependencies.pollRequest || pollSeedreamRequest;

  if (apiGenerationStatus === 'INIT') {
    return submitRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {

    return {
      image: null,
    };



  }

}

export async function submitSeedreamRequest(payload, dependencies = {}) {


  const { _id, model, prompt, aspectRatio } = payload;
  const connect = dependencies.connect || getDBConnectionString;
  const imageGenerationModel = dependencies.imageGenerationModel || ImageGeneration;
  const queueSubmit = dependencies.queueSubmit || ((...args) => fal.queue.submit(...args));
  const logger = dependencies.logger || console;

  await connect();
  await imageGenerationModel.findByIdAndUpdate(_id, { rowLocked: true });


  const falLink = getFalLinkForModel(model);

  const imageSize = getImageSizeFromAspectRatio(aspectRatio);


  let reqPayload = {
    prompt: prompt,
    "image_size": imageSize,
    output_format: "png",
  };


  try {

    let response = await queueSubmit(falLink, {
      input: reqPayload,
    });


    const requestId = response.request_id;


    await imageGenerationModel.findOneAndUpdate({
      _id: _id
    }, {
      apiRequestId: requestId,
      apiGenerationStatus: "PENDING",
      apiSubmittedAt: new Date(),
      rowLocked: false
    });

  } catch (error) {
    logger.error("Error submitting request to FAL: ", error);

    // Keep retry and terminal state transitions in Image.js. The caller forwards
    // this structured failure to handleNoImageRetryOrFailure, which also unlocks
    // the request after it has safely scheduled or exhausted the retry.
    return {
      image: null,
      error: `Seedream submission failed: ${error?.message || "Unknown provider error"}`,
      ...(isSubmissionOutcomeUnknown(error) ? { submissionOutcomeUnknown: true } : {}),
    };

  }

}

export async function pollSeedreamRequest(payload, dependencies = {}) {
  const { _id, apiRequestId, model } = payload;
  const connect = dependencies.connect || getDBConnectionString;
  const imageGenerationModel = dependencies.imageGenerationModel || ImageGeneration;
  const queueStatus = dependencies.queueStatus || ((...args) => fal.queue.status(...args));
  const queueResult = dependencies.queueResult || ((...args) => fal.queue.result(...args));
  const saveFile = dependencies.saveFile || saveRemoteFile;
  const logger = dependencies.logger || console;

  await connect();
  await imageGenerationModel.findOneAndUpdate(
    { _id: _id },
    { rowLocked: true }
  );

  const falLink = getFalLinkForModel(model);

  
  let responseStatusData;
  try {
    responseStatusData = await queueStatus(falLink, {
      requestId: apiRequestId,
      logs: true,
    });
  } catch (error) {
    await imageGenerationModel.findOneAndUpdate({ _id }, { rowLocked: false });
    return null;
  }

  const responseStatus = responseStatusData.status;

  if (responseStatus === "COMPLETED") {

    try {
      const result = await queueResult(falLink, {
        requestId: apiRequestId,
      });

      await imageGenerationModel.findOneAndUpdate(
        { _id: _id },
        { rowLocked: true }
      );




      const fileImages = result.images || result.data?.images;
      const imageRemoteUrl = fileImages?.[0]?.url;
      if (!imageRemoteUrl) {
        throw new Error("Seedream result did not include an image URL.");
      }

      const imageName = await saveFile(imageRemoteUrl);

      return { image: imageName };
    } catch (error) {
      logger.error("Error retrieving Seedream image from FAL: ", error);
      await imageGenerationModel.findOneAndUpdate({ _id }, { rowLocked: false });
      return null;

    }

  } else if (responseStatus === "FAILED") {
    const providerMessage = responseStatusData?.error?.message ||
      responseStatusData?.error ||
      responseStatusData?.logs?.findLast?.((entry) => entry?.message)?.message ||
      'Seedream provider request failed.';
    return {
      image: null,
      error: String(providerMessage),
      definitiveAdapterFailure: true,
    };
  } else {
    await imageGenerationModel.findOneAndUpdate(
      { _id: _id },
      { rowLocked: false }
    );

    return null;
  }
}




function getFalLinkForModel(model) {
  return 'bytedance/seedream/v5/pro/text-to-image';

}



function getImageSizeFromAspectRatio(aspectRatio) {

  switch (aspectRatio) {
    case '1:1':
      return {
        width: 1024,
        height: 1024
      };
    case '16:9':
      return {
        width: 1792,
        height: 1024
      };
    case '9:16':
      return {
        width: 1024,
        height: 1792
      }
    default:
      return {
        width: 1024,
        height: 1024
      } // default to 1:1 if unknown aspect ratio
  }

}
