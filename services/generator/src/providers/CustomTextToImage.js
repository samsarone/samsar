import axios from 'axios';
import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import { User } from '../schema/User.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';

const CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY = 'text_to_image';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasTextToImageAdapter(adapter) {
  return Boolean(
    isPlainObject(adapter) &&
    normalizeString(adapter.base_url) &&
    normalizeString(adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY])
  );
}

function getAdapterFromSource(source) {
  const adapter = source?.custom_adapters;
  return hasTextToImageAdapter(adapter) ? adapter : null;
}

function buildCustomEndpointUrl(baseUrl, endpointPath, suffix = '') {
  const normalizedBaseUrl = normalizeString(baseUrl).replace(/\/+$/, '');
  const normalizedEndpointPath = normalizeString(endpointPath).replace(/^\/+|\/+$/g, '');
  const normalizedSuffix = normalizeString(suffix).replace(/^\/+/, '');

  if (!normalizedBaseUrl) {
    throw new Error('custom_adapters.base_url is required for custom text-to-image generation.');
  }
  if (!normalizedEndpointPath) {
    throw new Error('custom_adapters.text_to_image is required for custom text-to-image generation.');
  }

  const relativePath = [normalizedEndpointPath, normalizedSuffix].filter(Boolean).join('/');
  return new URL(relativePath, `${normalizedBaseUrl}/`).toString();
}

async function resolveCustomTextToImageAdapter(payload) {
  let sessionData = null;
  if (payload.videoSessionId) {
    sessionData = await VideoSession.findById(payload.videoSessionId)
      .select('custom_adapters userId')
      .lean();
    const sessionAdapter = getAdapterFromSource(sessionData);
    if (sessionAdapter) {
      return {
        adapter: sessionAdapter,
        source: 'video_session',
      };
    }
  }

  const userId = payload.userId || sessionData?.userId;
  if (!userId) {
    throw new Error('Unable to resolve user for custom text-to-image adapter configuration.');
  }

  const userData = await User.findById(userId)
    .select('custom_adapters')
    .lean();
  const userAdapter = getAdapterFromSource(userData);
  if (!userAdapter) {
    throw new Error('Missing custom_adapters.text_to_image configuration for custom text-to-image generation.');
  }

  return {
    adapter: userAdapter,
    source: 'user',
  };
}

function buildHeaders(apiKey) {
  const headers = {
    'Content-Type': 'application/json',
  };
  const normalizedApiKey = normalizeString(apiKey);
  if (normalizedApiKey) {
    headers.Authorization = `Key ${normalizedApiKey}`;
  }
  return headers;
}

function getCustomAdapterProvider(adapter = {}) {
  return normalizeString(
    adapter.custom_endpoint_provider ||
    adapter.provider ||
    adapter.name ||
    ''
  ) || 'custom';
}

function removeUndefinedValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

async function markCustomImageStageSuccess(videoSessionId) {
  if (!videoSessionId) {
    return;
  }
  await VideoSession.findByIdAndUpdate(videoSessionId, {
    $set: {
      'expressGenerationCustomStageResults.image_generation.status': 'CUSTOM_SUCCEEDED',
      'expressGenerationCustomStageResults.image_generation.completedAt': new Date(),
    },
  });
}

async function markCustomImageStageFallback(payload, errorMessage) {
  if (payload?.videoSessionId) {
    await VideoSession.findByIdAndUpdate(payload.videoSessionId, {
      $set: {
        'expressGenerationCustomStageResults.image_generation.fallbackUsed': true,
        'expressGenerationCustomStageResults.image_generation.fallbackAt': new Date(),
        'expressGenerationCustomStageResults.image_generation.error': errorMessage || null,
      },
    });
  }
}

async function fallbackCustomTextToImageRequest(payload, errorMessage) {
  const fallbackModel = normalizeString(payload?.customFallbackModel);
  if (!fallbackModel) {
    return false;
  }
  await markCustomImageStageFallback(payload, errorMessage);
  await ImageGeneration.findByIdAndUpdate(payload._id, {
    model: fallbackModel,
    generationStatus: 'INIT',
    apiGenerationStatus: 'INIT',
    apiRequestId: null,
    generationId: null,
    customAdapterFallbackUsed: true,
    customAdapterError: errorMessage || null,
    rowLocked: false,
  });
  return true;
}

function getImageSizeFromAspectRatio(aspectRatio) {
  switch (aspectRatio) {
    case '16:9':
      return {
        width: 1792,
        height: 1024,
      };
    case '9:16':
      return {
        width: 1024,
        height: 1792,
      };
    case '1:1':
    default:
      return {
        width: 1024,
        height: 1024,
      };
  }
}

function buildCustomInputPayload(payload) {
  const {
    prompt,
    aspectRatio,
    numImages,
    guidanceScale,
    numInferenceSteps,
    userId,
  } = payload;

  return removeUndefinedValues({
    prompt,
    image_size: getImageSizeFromAspectRatio(aspectRatio),
    aspect_ratio: aspectRatio,
    num_images: numImages,
    guidance_scale: guidanceScale,
    num_inference_steps: numInferenceSteps,
    end_user_id: userId,
  });
}

function getRequestId(responseData) {
  return (
    responseData?.request_id ||
    responseData?.requestId ||
    responseData?.id ||
    responseData?.data?.request_id ||
    responseData?.data?.requestId ||
    null
  );
}

function normalizeProviderStatus(statusData) {
  const rawStatus = normalizeString(
    statusData?.status ||
    statusData?.state ||
    statusData?.request_status ||
    statusData?.data?.status ||
    statusData?.data?.state
  ).toUpperCase();

  if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'DONE'].includes(rawStatus)) {
    return 'COMPLETED';
  }
  if (
    rawStatus === 'FAILED' ||
    rawStatus === 'ERROR' ||
    rawStatus === 'CANCELLED' ||
    rawStatus === 'CANCELED' ||
    rawStatus.includes('FAIL') ||
    rawStatus.includes('ERROR')
  ) {
    return 'FAILED';
  }
  return 'PENDING';
}

function getImageUrl(resultData) {
  const candidates = [
    resultData?.image?.url,
    typeof resultData?.image === 'string' ? resultData.image : null,
    resultData?.data?.image?.url,
    typeof resultData?.data?.image === 'string' ? resultData.data.image : null,
    resultData?.output?.image?.url,
    resultData?.data?.output?.image?.url,
    resultData?.url,
    resultData?.data?.url,
    resultData?.image_url,
    resultData?.data?.image_url,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  if (Array.isArray(resultData?.images)) {
    const firstImageUrl = normalizeString(resultData.images[0]?.url || resultData.images[0]);
    if (firstImageUrl) {
      return firstImageUrl;
    }
  }

  if (Array.isArray(resultData?.data?.images)) {
    const firstImageUrl = normalizeString(resultData.data.images[0]?.url || resultData.data.images[0]);
    if (firstImageUrl) {
      return firstImageUrl;
    }
  }

  return null;
}

export async function handleCustomTextToImageRequest(payload) {
  const { apiGenerationStatus } = payload;

  if (apiGenerationStatus === 'INIT') {
    await submitCustomTextToImageRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    return pollCustomTextToImageRequest(payload);
  } else if (apiGenerationStatus === 'FAILED') {
    return {
      image: null,
    };
  }
}

async function submitCustomTextToImageRequest(payload) {
  const { _id } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const { adapter, source } = await resolveCustomTextToImageAdapter(payload);
    const submitUrl = buildCustomEndpointUrl(
      adapter.base_url,
      adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY]
    );
    const response = await axios.post(
      submitUrl,
      { input: buildCustomInputPayload(payload) },
      {
        headers: buildHeaders(adapter.api_key),
        timeout: 60000,
      }
    );

    const requestId = getRequestId(response.data);
    if (!requestId) {
      throw new Error(`Custom text-to-image submit returned no request id from ${source} adapter.`);
    }

    await recordProviderUsageLog({
      payload,
      requestType: 'text_to_image',
      callType: 'text_to_image',
      provider: getCustomAdapterProvider(adapter),
      model: payload?.model || 'CUSTOM_TEXT_TO_IMAGE',
      providerRequestId: requestId,
      source: 'custom_text_to_image',
      service: 'samsar_generator',
      status: 'requested',
      metadata: {
        adapterSource: source,
        endpoint: adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY],
        aspectRatio: payload?.aspectRatio,
        numImages: payload?.numImages,
      },
    });

    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: requestId,
        apiGenerationStatus: 'PENDING',
        rowLocked: false,
      }
    );
  } catch (error) {
    console.error('Error submitting custom text-to-image request: ', error);
    if (await fallbackCustomTextToImageRequest(payload, error?.message || 'Custom text-to-image submit failed.')) {
      return null;
    }
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        rowLocked: false,
      }
    );

    return {
      image: null,
    };
  }
}

async function pollCustomTextToImageRequest(payload) {
  const { _id, apiRequestId } = payload;
  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate(
    { _id },
    { rowLocked: true }
  );

  try {
    const { adapter } = await resolveCustomTextToImageAdapter(payload);
    const encodedRequestId = encodeURIComponent(apiRequestId);
    const statusUrl = buildCustomEndpointUrl(
      adapter.base_url,
      adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY],
      `requests/${encodedRequestId}/status`
    );
    const statusResponse = await axios.get(statusUrl, {
      headers: buildHeaders(adapter.api_key),
      timeout: 60000,
    });
    const responseStatus = normalizeProviderStatus(statusResponse.data);

    if (responseStatus === 'FAILED') {
      if (await fallbackCustomTextToImageRequest(payload, 'Custom text-to-image generation failed.')) {
        return null;
      }
      await ImageGeneration.findOneAndUpdate(
        { _id },
        {
          generationStatus: 'FAILED',
          apiGenerationStatus: 'FAILED',
          rowLocked: false,
        }
      );
      return { image: null };
    }

    if (responseStatus !== 'COMPLETED') {
      await ImageGeneration.findOneAndUpdate(
        { _id },
        { rowLocked: false }
      );
      return null;
    }

    const resultUrl = buildCustomEndpointUrl(
      adapter.base_url,
      adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY],
      `requests/${encodedRequestId}`
    );
    const resultResponse = await axios.get(resultUrl, {
      headers: buildHeaders(adapter.api_key),
      timeout: 60000,
    });
    const imageRemoteUrl = getImageUrl(resultResponse.data);
    if (!imageRemoteUrl) {
      throw new Error('Custom text-to-image result did not include an image url.');
    }

    const imageName = await saveRemoteFile(imageRemoteUrl);
    await markCustomImageStageSuccess(payload.videoSessionId);
    return { image: imageName };
  } catch (error) {
    console.error('Error polling custom text-to-image request: ', error);
    if (await fallbackCustomTextToImageRequest(payload, error?.message || 'Image retrieval failed')) {
      return null;
    }
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        rowLocked: false,
      }
    );

    return { image: null, error: 'Image retrieval failed' };
  }
}
