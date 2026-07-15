import { fal } from '@fal-ai/client';

import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import {
  buildFalWan27Input,
  FAL_WAN_27_PRO_ENDPOINT,
} from './Wan27Payload.js';

fal.config({
  credentials: process.env.FAL_API_KEY,
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function failFalWan27Request(_id, message) {
  await ImageGeneration.findOneAndUpdate(
    { _id },
    {
      generationStatus: 'FAILED',
      apiGenerationStatus: 'FAILED',
      generationError: message || 'Fal Wan2.7 Pro generation failed.',
      rowLocked: false,
    },
  );
}

export async function submitFalWan27Request(payload = {}) {
  const { _id } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const response = await fal.queue.submit(FAL_WAN_27_PRO_ENDPOINT, {
      input: buildFalWan27Input(payload),
    });
    const requestId = normalizeString(response?.request_id || response?.requestId);
    if (!requestId) {
      throw new Error('Fal Wan2.7 Pro submit returned no request id.');
    }

    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: requestId,
        apiGenerationStatus: 'PENDING',
        apiSubmittedAt: new Date(),
        externalProvider: 'fal',
        rowLocked: false,
      },
    );
    return null;
  } catch (error) {
    const message = error?.message || 'Unable to submit Fal Wan2.7 Pro request.';
    console.error('[FalWan27] submit failed:', message);
    await failFalWan27Request(_id, message);
    return { image: null, error: message };
  }
}

export async function pollFalWan27Request(payload = {}) {
  const { _id, apiRequestId } = payload;
  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: true });

  try {
    const statusData = await fal.queue.status(FAL_WAN_27_PRO_ENDPOINT, {
      requestId: apiRequestId,
      logs: true,
    });
    const status = normalizeString(statusData?.status).toUpperCase();

    if (status === 'FAILED' || status === 'CANCELLED' || status === 'CANCELED') {
      throw new Error(`Fal Wan2.7 Pro request ${status.toLowerCase()}.`);
    }
    if (status !== 'COMPLETED') {
      await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
      return null;
    }

    const result = await fal.queue.result(FAL_WAN_27_PRO_ENDPOINT, {
      requestId: apiRequestId,
    });
    const images = Array.isArray(result?.data?.images)
      ? result.data.images
      : Array.isArray(result?.images)
        ? result.images
        : [];
    const imageUrl = normalizeString(images[0]?.url);
    if (!imageUrl) {
      throw new Error('Fal Wan2.7 Pro result returned no image URL.');
    }

    const imageName = await saveRemoteFile(imageUrl);
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        externalProvider: 'fal',
        rowLocked: false,
      },
    );
    return {
      image: imageName,
      provider: 'fal',
      providerRequestId: apiRequestId,
    };
  } catch (error) {
    const message = error?.message || 'Unable to poll Fal Wan2.7 Pro request.';
    console.error('[FalWan27] poll failed:', message);
    await failFalWan27Request(_id, message);
    return { image: null, error: message };
  }
}

export async function handleFalWan27Request(payload = {}) {
  const status = normalizeString(payload.apiGenerationStatus || 'INIT').toUpperCase();
  if (status === 'INIT') {
    return submitFalWan27Request(payload);
  }
  if (status === 'PENDING') {
    return pollFalWan27Request(payload);
  }
  if (status === 'FAILED') {
    return { image: null };
  }
  return null;
}
