import { fal } from '@fal-ai/client';

import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import {
  buildFalGPTImageTwoInput,
  getGPTImageTwoOutput,
  GPT_IMAGE_TWO_FAL_ENDPOINT,
  normalizeGPTImageTwoResult,
} from './GPTImageTwoPayload.js';
import { isSubmissionOutcomeUnknown } from '../utils/ProviderSubmissionSafety.js';

fal.config({
  credentials: process.env.FAL_API_KEY,
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function getFalErrorMessage(response = {}, fallback) {
  const logMessage = Array.isArray(response?.logs)
    ? [...response.logs].reverse().find((entry) => normalizeString(entry?.message))?.message
    : '';

  return normalizeString(response?.error?.message) ||
    normalizeString(response?.error) ||
    normalizeString(logMessage) ||
    fallback;
}

async function unlockRequest(imageGenerationModel, _id, update = {}) {
  await imageGenerationModel.findOneAndUpdate(
    { _id },
    {
      ...update,
      rowLocked: false,
    },
  );
}

export async function submitFalGPTImageTwoRequest(payload = {}, dependencies = {}) {
  const connect = dependencies.connect || getDBConnectionString;
  const imageGenerationModel = dependencies.imageGenerationModel || ImageGeneration;
  const queueSubmit = dependencies.queueSubmit || ((...args) => fal.queue.submit(...args));
  const logger = dependencies.logger || console;
  const { _id } = payload;

  await connect();
  await imageGenerationModel.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const response = await queueSubmit(GPT_IMAGE_TWO_FAL_ENDPOINT, {
      input: buildFalGPTImageTwoInput(payload),
    });
    const requestId = normalizeString(response?.request_id || response?.requestId);
    if (!requestId) {
      throw new Error('Fal GPT Image 2 submit returned no request id.');
    }

    await unlockRequest(imageGenerationModel, _id, {
      apiRequestId: requestId,
      apiGenerationStatus: 'PENDING',
      apiSubmittedAt: new Date(),
      externalProvider: 'fal',
    });
    return null;
  } catch (error) {
    const message = `Fal GPT Image 2 submission failed: ${error?.message || 'Unknown provider error'}`;
    logger.error('[GPTImageTwoFal] submit failed:', error);
    return {
      image: null,
      error: message,
      ...(isSubmissionOutcomeUnknown(error) ? { submissionOutcomeUnknown: true } : {}),
    };
  }
}

export async function pollFalGPTImageTwoRequest(payload = {}, dependencies = {}) {
  const connect = dependencies.connect || getDBConnectionString;
  const imageGenerationModel = dependencies.imageGenerationModel || ImageGeneration;
  const queueStatus = dependencies.queueStatus || ((...args) => fal.queue.status(...args));
  const queueResult = dependencies.queueResult || ((...args) => fal.queue.result(...args));
  const saveFile = dependencies.saveFile || saveRemoteFile;
  const logger = dependencies.logger || console;
  const { _id, apiRequestId } = payload;

  await connect();
  await imageGenerationModel.findOneAndUpdate({ _id }, { rowLocked: true });

  try {
    const statusResponse = await queueStatus(GPT_IMAGE_TWO_FAL_ENDPOINT, {
      requestId: apiRequestId,
      logs: true,
    });
    const status = normalizeString(statusResponse?.status).toUpperCase();

    if (status === 'FAILED' || status === 'CANCELLED' || status === 'CANCELED') {
      const message = getFalErrorMessage(
        statusResponse,
        `Fal GPT Image 2 request ${status.toLowerCase()}.`,
      );
      return { image: null, error: message, definitiveAdapterFailure: true };
    }

    if (status !== 'COMPLETED') {
      await unlockRequest(imageGenerationModel, _id);
      return null;
    }

    const result = await queueResult(GPT_IMAGE_TWO_FAL_ENDPOINT, {
      requestId: apiRequestId,
    });
    const images = Array.isArray(result?.data?.images)
      ? result.data.images
      : Array.isArray(result?.images)
        ? result.images
        : [];
    const generatedImage = images[0];
    const imageUrl = normalizeString(generatedImage?.url);
    if (!imageUrl) {
      throw new Error('Fal GPT Image 2 result returned no image URL.');
    }

    const imageName = await saveFile(imageUrl);
    const output = getGPTImageTwoOutput(payload.aspectRatio);
    await imageGenerationModel.findOneAndUpdate(
      { _id },
      { externalProvider: 'fal' },
    );

    return normalizeGPTImageTwoResult({
      image: imageName,
      width: normalizePositiveInteger(generatedImage?.width, output.width),
      height: normalizePositiveInteger(generatedImage?.height, output.height),
    });
  } catch (error) {
    logger.error('[GPTImageTwoFal] poll failed:', error);
    // Poll/result transport failures (including 429) do not invalidate the
    // submitted generation. Resume this same request on the next pass.
    await unlockRequest(imageGenerationModel, _id);
    return null;
  }
}

export async function handleFalGPTImageTwoRequest(payload = {}, dependencies = {}) {
  const status = normalizeString(payload.apiGenerationStatus || 'INIT').toUpperCase();

  if (status === 'INIT') {
    return submitFalGPTImageTwoRequest(payload, dependencies);
  }
  if (status === 'PENDING') {
    return pollFalGPTImageTwoRequest(payload, dependencies);
  }
  if (status === 'FAILED') {
    return { image: null };
  }
  return null;
}
