import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import { buildAlibabaWan27Request } from './Wan27Payload.js';
import {
  extractAlibabaImageUrl,
  getAlibabaImageApiKey,
  getAlibabaImageGenerationUrl,
  isAlibabaImageInfrastructureError,
  requestAlibabaImageGeneration,
} from './AlibabaCloudImage.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const getAlibabaWan27ApiKey = getAlibabaImageApiKey;
export const getAlibabaWan27GenerationUrl = getAlibabaImageGenerationUrl;
export const extractAlibabaWan27ImageUrl = extractAlibabaImageUrl;
export const isAlibabaWan27InfrastructureError = isAlibabaImageInfrastructureError;

function markAsNonPromptProviderFailure(error) {
  error.nonPromptProviderFailure = true;
  error.preserveExpressImageLayer = true;
  return error;
}

export async function requestAlibabaWan27Image(payload = {}, options = {}) {
  return requestAlibabaImageGeneration(buildAlibabaWan27Request(payload), {
    ...options,
    providerName: 'Alibaba Wan2.7 Pro',
  });
}

export async function handleAlibabaWan27Request(payload = {}) {
  const { _id } = payload;
  const providerStatus = normalizeString(payload.apiGenerationStatus || 'INIT').toUpperCase();
  if (providerStatus === 'FAILED') {
    return { image: null };
  }
  if (providerStatus !== 'INIT') {
    return null;
  }

  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const result = await requestAlibabaWan27Image(payload);
    const imageName = await saveRemoteFile(result.imageUrl);

    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: result.requestId || `alibaba-wan27:${Date.now()}`,
        apiGenerationStatus: 'COMPLETED',
        generationStatus: 'COMPLETED',
        externalProvider: 'alibabaCloud',
        rowLocked: false,
      },
    );

    return {
      image: imageName,
      provider: 'alibabaCloud',
      providerRequestId: result.requestId,
    };
  } catch (error) {
    const message = error?.message || 'Alibaba Wan2.7 Pro generation failed.';
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        generationError: message,
        rowLocked: false,
      },
    );

    if (isAlibabaWan27InfrastructureError(error)) {
      throw markAsNonPromptProviderFailure(error);
    }
    return { image: null, error: message };
  }
}
