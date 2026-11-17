import { fal } from "@fal-ai/client";
import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import axios from 'axios';


import { saveRemoteFile } from "../utils/FileUtils.js";
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { isSubmissionOutcomeUnknown } from '../utils/ProviderSubmissionSafety.js';
import { getSeedreamFalEndpoint } from '../consts/SeedreamModel.js';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});

function providerMessage(value, depth = 0) {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return [...new Set(value.map(entry => providerMessage(entry, depth + 1)).filter(Boolean))].join('; ');
  }
  if (typeof value !== 'object') return '';
  for (const field of ['detail', 'msg', 'message', 'error', 'body']) {
    const message = providerMessage(value[field], depth + 1);
    if (message) return message;
  }
  return '';
}

function providerErrorDetails(error) {
  const visited = new Set();
  let current = error, status = null, message = '';
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = Number(current.status ?? current.statusCode ?? current.response?.status);
    if (status === null && Number.isInteger(candidate) && candidate > 0) status = candidate;
    // Fal's ValidationError.message is usually just "Unprocessable Entity".
    // Preserve the actual failure detail, including Pydantic-style msg arrays.
    message ||= providerMessage(current.body) || providerMessage(current.response?.data);
    current = current.cause;
  }
  return { status, message: message || providerMessage(error) || 'Unknown provider error' };
}

function acceptedPollError(error, phase) {
  const failure = error instanceof Error ? error : new Error(providerErrorDetails(error).message, { cause: error });
  // A failed read/download does not establish that the accepted generation
  // failed. Shared recovery must keep its provider ID and bound polling retries.
  return Object.assign(failure, {
    nonPromptProviderFailure: true,
    preserveExpressImageLayer: true,
    providerPollFailure: true,
    providerPollPhase: phase,
  });
}


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


  const falLink = getSeedreamFalEndpoint(payload);

  const imageSize = getImageSizeFromAspectRatio(aspectRatio);


  let reqPayload = {
    prompt: prompt,
    "image_size": imageSize,
    output_format: "png",
    num_images: 1,
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
      seedreamFalEndpoint: falLink,
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

  const falLink = getSeedreamFalEndpoint(payload);

  
  let responseStatusData;
  try {
    responseStatusData = await queueStatus(falLink, {
      requestId: apiRequestId,
      logs: true,
    });
  } catch (error) {
    logger.error('Error checking Seedream request status from FAL: ', error);
    throw acceptedPollError(error, 'status');
  }

  const responseStatus = responseStatusData.status;

  if (responseStatus === "COMPLETED") {
    let result;
    try {
      result = await queueResult(falLink, {
        requestId: apiRequestId,
      });
    } catch (error) {
      logger.error("Error retrieving Seedream image from FAL: ", error);
      const details = providerErrorDetails(error);
      // Fal's completed result endpoint reports a rejected generation as 400/422.
      // Authentication, missing results, throttling and server/transport failures
      // do not prove the generation failed and must not create another image.
      if ([400, 422].includes(details.status)) {
        return {
          image: null,
          error: `Seedream result failed (${details.status}): ${details.message}`,
          status: details.status,
          definitiveAdapterFailure: true,
        };
      }
      throw acceptedPollError(error, 'result');
    }

    const fileImages = result.images || result.data?.images;
    const imageRemoteUrl = fileImages?.[0]?.url;
    if (!imageRemoteUrl) {
      throw acceptedPollError(new Error('Seedream result did not include an image URL.'), 'result');
    }
    try {
      const imageName = await saveFile(imageRemoteUrl);
      return { image: imageName };
    } catch (error) {
      logger.error('Error saving Seedream image from FAL: ', error);
      throw acceptedPollError(error, 'download');
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
