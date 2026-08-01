import axios from 'axios';
import crypto from 'crypto';
import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import VideoSession from '../schema/VideoSession.js';
import { User } from '../schema/User.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import { isStandaloneEdition } from '../utils/Environment.js';

const CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY = 'text_to_image';
export const CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX = 'CUSTOM_TEXT_TO_IMAGE:';
const CUSTOM_ADAPTER_SECRET_PREFIX = 'enc:v1:';
const CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN = '{request_id}';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isCustomTextToImageModel(model) {
  const normalized = normalizeString(model);
  return normalized === 'CUSTOM_TEXT_TO_IMAGE' || normalized.startsWith(CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX);
}

function getCustomTextToImageAdapterId(model) {
  const normalized = normalizeString(model);
  return normalized.startsWith(CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX)
    ? normalized.slice(CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX.length)
    : '';
}

function getCustomAdapterSecretKey() {
  const secret =
    process.env.CUSTOM_ADAPTER_SECRET_KEY ||
    process.env.CUSTOM_CREDENTIALS_SECRET ||
    process.env.TOKEN_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('CUSTOM_ADAPTER_SECRET_KEY or TOKEN_SECRET is required to use custom adapter credentials.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function decryptCustomAdapterSecret(value) {
  const normalized = normalizeString(value);
  if (!normalized || !normalized.startsWith(CUSTOM_ADAPTER_SECRET_PREFIX)) {
    return normalized;
  }
  const parts = normalized.split(':');
  if (parts.length !== 5 || parts[1] !== 'v1') {
    throw new Error('Invalid encrypted custom adapter credential format.');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getCustomAdapterSecretKey(),
    Buffer.from(parts[2], 'base64'),
  );
  decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[4], 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function hasTextToImageAdapter(adapter) {
  return Boolean(
    isPlainObject(adapter) &&
    normalizeString(adapter.base_url) &&
    normalizeString(adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY])
  );
}

function hasModernTextToImageEndpoint(endpoint) {
  return Boolean(
    isPlainObject(endpoint) &&
    normalizeString(endpoint.operation) === CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY &&
    normalizeString(endpoint.generate_url) &&
    normalizeString(endpoint.status_url) &&
    normalizeString(endpoint.result_url)
  );
}

function withDecryptedCredentials(adapter) {
  if (!adapter) {
    return adapter;
  }
  return {
    ...adapter,
    ...(normalizeString(adapter.api_key)
      ? { api_key: decryptCustomAdapterSecret(adapter.api_key) }
      : {}),
    ...(normalizeString(adapter.header_value)
      ? { header_value: decryptCustomAdapterSecret(adapter.header_value) }
      : {}),
  };
}

function getAdapterFromSource(source) {
  const adapter = source?.custom_adapters;
  return hasTextToImageAdapter(adapter) ? withDecryptedCredentials(adapter) : null;
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

export function getUserCustomTextToImageEndpoint(customAdapters, adapterId = '', sessionAdapter = null) {
  const endpoints = Array.isArray(customAdapters?.custom_endpoints)
    ? customAdapters.custom_endpoints
    : [];
  const requestedId = normalizeString(adapterId) || normalizeString(sessionAdapter?.custom_endpoint_id);
  const endpoint = endpoints.find((candidate) => (
    hasModernTextToImageEndpoint(candidate) &&
    (!requestedId || normalizeString(candidate.id) === requestedId)
  ));
  return endpoint ? withDecryptedCredentials(endpoint) : null;
}

export async function resolveCustomTextToImageAdapter(payload) {
  if (getCustomTextToImageAdapterId(payload.model) && !isStandaloneEdition()) {
    throw new Error('Per-user custom text-to-image models are only available in standalone deployments.');
  }
  let sessionData = null;
  if (payload.videoSessionId) {
    sessionData = await VideoSession.findById(payload.videoSessionId)
      .select('custom_adapters userId')
      .lean();
    const sessionAdapter = getAdapterFromSource(sessionData);
    if (sessionAdapter && !getCustomTextToImageAdapterId(payload.model)) {
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
  const requestedAdapterId = getCustomTextToImageAdapterId(payload.model);
  const userAdapter = getUserCustomTextToImageEndpoint(
    userData?.custom_adapters,
    requestedAdapterId,
    sessionData?.custom_adapters,
  ) || (requestedAdapterId ? null : getAdapterFromSource(userData));
  if (!userAdapter) {
    throw new Error(`Missing custom text-to-image adapter configuration for model ${payload.model || 'CUSTOM_TEXT_TO_IMAGE'}.`);
  }

  return {
    adapter: userAdapter,
    source: 'user',
  };
}

export function buildCustomAdapterHeaders(adapter = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };
  const headerKey = normalizeString(adapter.header_key);
  const headerValue = normalizeString(adapter.header_value);
  if (headerKey && headerValue) {
    headers[headerKey] = headerValue;
    return headers;
  }
  const normalizedApiKey = normalizeString(adapter.api_key);
  if (normalizedApiKey) {
    headers.Authorization = `Key ${normalizedApiKey}`;
  }
  return headers;
}

export function interpolateCustomAdapterUrl(urlTemplate, requestId) {
  const template = normalizeString(urlTemplate);
  if (!template) {
    return '';
  }
  if (!template.includes(CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN)) {
    throw new Error(`Custom adapter URL must include ${CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN}.`);
  }
  return template.replaceAll(
    CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN,
    encodeURIComponent(normalizeString(requestId)),
  );
}

function getProviderUrl(responseData, keys) {
  for (const key of keys) {
    const candidates = [responseData?.[key], responseData?.data?.[key]];
    for (const candidate of candidates) {
      const normalized = normalizeString(candidate);
      if (!normalized) continue;
      try {
        return new URL(normalized).toString();
      } catch {
        // Ignore malformed provider URLs and fall back to configured templates.
      }
    }
  }
  return '';
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
    responseData?.request?.id ||
    responseData?.data?.request?.id ||
    null
  );
}

export function normalizeProviderStatus(statusData) {
  const rawStatus = normalizeString(
    statusData?.status ||
    statusData?.state ||
    statusData?.request_status ||
    statusData?.data?.status ||
    statusData?.data?.state ||
    statusData?.request?.status ||
    statusData?.data?.request?.status ||
    statusData?.result?.status
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

export function getImageUrl(resultData) {
  const candidates = [
    resultData?.image?.url,
    typeof resultData?.image === 'string' ? resultData.image : null,
    resultData?.data?.image?.url,
    typeof resultData?.data?.image === 'string' ? resultData.data.image : null,
    resultData?.output?.image?.url,
    resultData?.data?.output?.image?.url,
    resultData?.result?.image?.url,
    typeof resultData?.result?.image === 'string' ? resultData.result.image : null,
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

  for (const collection of [
    resultData?.output,
    resultData?.data?.output,
    resultData?.output?.images,
    resultData?.data?.output?.images,
    resultData?.result?.images,
  ]) {
    if (!Array.isArray(collection)) continue;
    const firstImageUrl = normalizeString(collection[0]?.url || collection[0]);
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
    const submitUrl = normalizeString(adapter.generate_url) || buildCustomEndpointUrl(
      adapter.base_url,
      adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY],
    );
    const response = await axios.post(
      submitUrl,
      { input: buildCustomInputPayload(payload) },
      {
        headers: buildCustomAdapterHeaders(adapter),
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
        endpoint: submitUrl,
        aspectRatio: payload?.aspectRatio,
        numImages: payload?.numImages,
      },
    });

    const providerStatusUrl = getProviderUrl(response.data, ['status_url', 'statusUrl']);
    const providerResultUrl = getProviderUrl(
      response.data,
      ['result_url', 'resultUrl', 'response_url', 'responseUrl'],
    );
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: requestId,
        apiGenerationStatus: 'PENDING',
        customAdapterId: normalizeString(adapter.id) || null,
        customAdapterStatusUrl: providerStatusUrl || null,
        customAdapterResultUrl: providerResultUrl || null,
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
    const statusUrl = normalizeString(payload.customAdapterStatusUrl) || (
      normalizeString(adapter.status_url)
        ? interpolateCustomAdapterUrl(adapter.status_url, apiRequestId)
        : buildCustomEndpointUrl(
          adapter.base_url,
          adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY],
          `requests/${encodeURIComponent(apiRequestId)}/status`,
        )
    );
    const statusResponse = await axios.get(statusUrl, {
      headers: buildCustomAdapterHeaders(adapter),
      timeout: 60000,
    });
    const responseStatus = normalizeProviderStatus(statusResponse.data);
    const statusImageUrl = getImageUrl(statusResponse.data);

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

    if (responseStatus !== 'COMPLETED' && !statusImageUrl) {
      await ImageGeneration.findOneAndUpdate(
        { _id },
        { rowLocked: false }
      );
      return null;
    }

    const resultUrl = normalizeString(payload.customAdapterResultUrl) || (
      normalizeString(adapter.result_url)
        ? interpolateCustomAdapterUrl(adapter.result_url, apiRequestId)
        : buildCustomEndpointUrl(
          adapter.base_url,
          adapter[CUSTOM_TEXT_TO_IMAGE_ADAPTER_KEY],
          `requests/${encodeURIComponent(apiRequestId)}`,
        )
    );
    const resultResponse = statusImageUrl
      ? null
      : await axios.get(resultUrl, {
        headers: buildCustomAdapterHeaders(adapter),
        timeout: 60000,
      });
    const imageRemoteUrl = statusImageUrl || getImageUrl(resultResponse?.data);
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
