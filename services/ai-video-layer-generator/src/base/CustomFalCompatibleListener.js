import axios from 'axios';
import crypto from 'crypto';
import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';

const CUSTOM_ADAPTER_TYPES = {
  IMAGE_TO_VIDEO: 'image_to_video',
};
const CUSTOM_ADAPTER_SECRET_PREFIX = 'enc:v1:';
const CUSTOM_ADAPTER_SECRET_MINIMUM_LENGTH = 32;
const CUSTOM_ADAPTER_SECRET_CONTROL_CHARACTERS = /[\0\r\n]/;
const INSECURE_CUSTOM_ADAPTER_SECRETS = new Set([
  'change-me',
  'change-me-in-production',
  'local-development-only-secret',
  'replace-with-at-least-32-random-characters',
  'samsar-local-password',
  'samsar-local-token-secret-change-me',
  'samsar-local-custom-adapter-secret-change-me',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getCustomAdapterProvider(adapter = {}) {
  return normalizeString(
    adapter.custom_endpoint_provider ||
    adapter.provider ||
    adapter.custom_endpoint_name ||
    adapter.name ||
    ''
  ) || 'custom';
}

function getCustomAdapterSecretKey() {
  const rawSecret = process.env.CUSTOM_ADAPTER_SECRET_KEY;
  const secret = normalizeString(rawSecret);
  if (!secret) {
    throw new Error('CUSTOM_ADAPTER_SECRET_KEY is required to use custom adapter credentials.');
  }
  if (
    secret.length < CUSTOM_ADAPTER_SECRET_MINIMUM_LENGTH ||
    CUSTOM_ADAPTER_SECRET_CONTROL_CHARACTERS.test(rawSecret) ||
    INSECURE_CUSTOM_ADAPTER_SECRETS.has(secret.toLowerCase())
  ) {
    throw new Error(
      'CUSTOM_ADAPTER_SECRET_KEY must be at least 32 characters, contain no control characters, and not use a known public default.',
    );
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function decryptCustomAdapterSecret(value) {
  const normalized = normalizeString(value);
  if (!normalized || !normalized.startsWith(CUSTOM_ADAPTER_SECRET_PREFIX)) {
    return normalized;
  }
  const parts = normalized.split(':');
  if (parts.length !== 5) {
    throw new Error('Invalid encrypted custom adapter credential format.');
  }
  const [, version, ivBase64, tagBase64, encryptedBase64] = parts;
  if (version !== 'v1') {
    throw new Error('Unsupported encrypted custom adapter credential version.');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getCustomAdapterSecretKey(),
    Buffer.from(ivBase64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function withDecryptedApiKey(adapter) {
  if (!adapter || !adapter.api_key) {
    return adapter;
  }
  return {
    ...adapter,
    api_key: decryptCustomAdapterSecret(adapter.api_key),
  };
}

function hasAdapterEndpoint(adapter, adapterType) {
  return Boolean(
    isPlainObject(adapter) &&
    normalizeString(adapter.base_url) &&
    normalizeString(adapter[adapterType]),
  );
}

function getAdapterFromSource(source, adapterType) {
  const adapter = source?.custom_adapters;
  return hasAdapterEndpoint(adapter, adapterType) ? withDecryptedApiKey(adapter) : null;
}

function getUserCustomEndpointAdapter(customAdapters, adapterType, sessionAdapter = null) {
  const customEndpoints = Array.isArray(customAdapters?.custom_endpoints)
    ? customAdapters.custom_endpoints
    : [];
  const sessionEndpointId = normalizeString(sessionAdapter?.custom_endpoint_id);
  const sessionBaseUrl = normalizeString(sessionAdapter?.base_url);
  const sessionEndpoint = normalizeString(sessionAdapter?.[adapterType]);

  const matchedEndpoint = customEndpoints.find((endpoint) => {
    if (!endpoint || typeof endpoint !== 'object') {
      return false;
    }
    if (normalizeString(endpoint.operation) !== adapterType) {
      return false;
    }
    if (sessionEndpointId && normalizeString(endpoint.id) === sessionEndpointId) {
      return true;
    }
    return (
      sessionBaseUrl &&
      sessionEndpoint &&
      normalizeString(endpoint.base_url) === sessionBaseUrl &&
      normalizeString(endpoint.endpoint) === sessionEndpoint
    );
  });

  if (!matchedEndpoint) {
    return null;
  }

  const adapter = {
    base_url: normalizeString(matchedEndpoint.base_url),
    ...(normalizeString(matchedEndpoint.api_key)
      ? { api_key: decryptCustomAdapterSecret(matchedEndpoint.api_key) }
      : {}),
    ...(normalizeString(matchedEndpoint.id) ? { custom_endpoint_id: normalizeString(matchedEndpoint.id) } : {}),
    ...(normalizeString(matchedEndpoint.name) ? { custom_endpoint_name: normalizeString(matchedEndpoint.name) } : {}),
    ...(normalizeString(matchedEndpoint.provider) ? { custom_endpoint_provider: normalizeString(matchedEndpoint.provider) } : {}),
    [adapterType]: normalizeString(matchedEndpoint.endpoint),
  };

  return hasAdapterEndpoint(adapter, adapterType) ? adapter : null;
}

function buildCustomEndpointUrl(baseUrl, endpointPath, suffix = '') {
  const normalizedBaseUrl = normalizeString(baseUrl).replace(/\/+$/, '');
  const normalizedEndpointPath = normalizeString(endpointPath).replace(/^\/+|\/+$/g, '');
  const normalizedSuffix = normalizeString(suffix).replace(/^\/+/, '');

  if (!normalizedBaseUrl) {
    throw new Error('custom_adapters.base_url is required for custom video generation.');
  }
  if (!normalizedEndpointPath) {
    throw new Error('A custom video model endpoint path is required for custom video generation.');
  }

  const relativePath = [normalizedEndpointPath, normalizedSuffix].filter(Boolean).join('/');
  return new URL(relativePath, `${normalizedBaseUrl}/`).toString();
}

function isFalQueueBaseUrl(baseUrl) {
  try {
    return new URL(normalizeString(baseUrl)).hostname === 'queue.fal.run';
  } catch {
    return false;
  }
}

function buildSubmitRequestBody(baseUrl, inputPayload) {
  return isFalQueueBaseUrl(baseUrl) ? inputPayload : { input: inputPayload };
}

function normalizeProviderUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  try {
    return new URL(normalized).toString();
  } catch {
    return '';
  }
}

function getProviderUrl(responseData, keys = []) {
  for (const key of keys) {
    const directUrl = normalizeProviderUrl(responseData?.[key]);
    if (directUrl) {
      return directUrl;
    }
    const nestedUrl = normalizeProviderUrl(responseData?.data?.[key]);
    if (nestedUrl) {
      return nestedUrl;
    }
  }
  return '';
}

async function resolveCustomAdapterConfig(payload, adapterType) {
  const sessionData = await VideoSession.findById(payload.sessionId)
    .select('custom_adapters userId')
    .lean();
  if (!sessionData) {
    throw new Error('Unable to resolve video session for custom video adapter configuration.');
  }
  const sessionAdapter = getAdapterFromSource(sessionData, adapterType);

  if (sessionAdapter?.api_key) {
    return {
      adapter: sessionAdapter,
      source: 'video_session',
    };
  }

  const userId = sessionData.userId;
  if (!userId) {
    throw new Error('Unable to resolve user for custom video adapter configuration.');
  }

  const userData = await User.findById(userId)
    .select('custom_adapters')
    .lean();
  const userAdapter =
    getUserCustomEndpointAdapter(userData?.custom_adapters, adapterType, sessionAdapter) ||
    getAdapterFromSource(userData, adapterType);

  if (userAdapter) {
    return {
      adapter: userAdapter,
      source: 'user',
    };
  }

  if (sessionAdapter) {
    return {
      adapter: sessionAdapter,
      source: 'video_session',
    };
  }

  if (!userAdapter) {
    throw new Error(`Missing custom_adapters.${adapterType} configuration for custom video generation.`);
  }
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

function normalizeDuration(duration) {
  if (duration === undefined || duration === null || duration === '') {
    return undefined;
  }
  if (typeof duration === 'string') {
    const trimmed = duration.trim();
    return trimmed || undefined;
  }
  const numericDuration = Number(duration);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return undefined;
  }
  return `${Math.round(numericDuration)}s`;
}

function normalizeHappyHorseDuration(duration) {
  const parsedDuration = Number(duration);
  if (!Number.isFinite(parsedDuration)) {
    return 5;
  }
  return Math.min(15, Math.max(3, Math.round(parsedDuration)));
}

function removeUndefinedValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function isHappyHorseImageToVideoEndpoint(endpointPath) {
  return /^alibaba\/happy-horse\/(?:v1\.1\/)?image-to-video$/.test(
    normalizeString(endpointPath).toLowerCase()
  );
}

function buildHappyHorseImageToVideoInputPayload(payload) {
  const {
    startImage,
    prompt,
    duration,
  } = payload;

  return removeUndefinedValues({
    image_url: startImage,
    prompt,
    resolution: '1080p',
    duration: normalizeHappyHorseDuration(duration),
    enable_safety_checker: true,
  });
}

function buildCustomInputPayload(payload, adapterType, endpointPath) {
  const {
    startImage,
    endImage,
    prompt,
    aspectRatio,
    duration,
    generateAudio = false,
    isAudioVideoGeneration = false,
    userId,
  } = payload;

  if (
    adapterType === CUSTOM_ADAPTER_TYPES.IMAGE_TO_VIDEO &&
    isHappyHorseImageToVideoEndpoint(endpointPath)
  ) {
    return buildHappyHorseImageToVideoInputPayload(payload);
  }

  const inputPayload = {
    prompt,
    aspect_ratio: aspectRatio,
    duration: normalizeDuration(duration),
    generate_audio: Boolean(generateAudio || payload.generate_audio === true || isAudioVideoGeneration),
    end_user_id: userId,
  };

  if (adapterType === CUSTOM_ADAPTER_TYPES.IMAGE_TO_VIDEO) {
    inputPayload.image_url = startImage;
    inputPayload.end_image_url = endImage;
    inputPayload.resolution = '720p';
  }

  return removeUndefinedValues(inputPayload);
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
    statusData?.data?.state,
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

function getVideoUrl(resultData) {
  const candidates = [
    resultData?.video?.url,
    typeof resultData?.video === 'string' ? resultData.video : null,
    resultData?.response?.video?.url,
    typeof resultData?.response?.video === 'string' ? resultData.response.video : null,
    resultData?.data?.video?.url,
    typeof resultData?.data?.video === 'string' ? resultData.data.video : null,
    resultData?.data?.response?.video?.url,
    typeof resultData?.data?.response?.video === 'string' ? resultData.data.response.video : null,
    resultData?.output?.video?.url,
    resultData?.data?.output?.video?.url,
    resultData?.url,
    resultData?.data?.url,
    resultData?.video_url,
    resultData?.data?.video_url,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  if (Array.isArray(resultData?.videos)) {
    const firstVideoUrl = normalizeString(resultData.videos[0]?.url || resultData.videos[0]);
    if (firstVideoUrl) {
      return firstVideoUrl;
    }
  }

  if (Array.isArray(resultData?.data?.videos)) {
    const firstVideoUrl = normalizeString(resultData.data.videos[0]?.url || resultData.data.videos[0]);
    if (firstVideoUrl) {
      return firstVideoUrl;
    }
  }

  if (Array.isArray(resultData?.response?.videos)) {
    const firstVideoUrl = normalizeString(resultData.response.videos[0]?.url || resultData.response.videos[0]);
    if (firstVideoUrl) {
      return firstVideoUrl;
    }
  }

  if (Array.isArray(resultData?.data?.response?.videos)) {
    const firstVideoUrl = normalizeString(
      resultData.data.response.videos[0]?.url || resultData.data.response.videos[0],
    );
    if (firstVideoUrl) {
      return firstVideoUrl;
    }
  }

  return null;
}

async function submitCustomFalCompatibleRequest(payload, adapterType) {
  const { adapter, source } = await resolveCustomAdapterConfig(payload, adapterType);
  const endpointPath = adapter[adapterType];
  const submitUrl = buildCustomEndpointUrl(adapter.base_url, endpointPath);
  const inputPayload = buildCustomInputPayload(payload, adapterType, endpointPath);

  const response = await axios.post(
    submitUrl,
    buildSubmitRequestBody(adapter.base_url, inputPayload),
    {
      headers: buildHeaders(adapter.api_key),
      timeout: 60000,
    },
  );

  const requestId = getRequestId(response.data);
  if (!requestId) {
    throw new Error(`Custom ${adapterType} submit returned no request id from ${source} adapter.`);
  }

  await recordProviderUsageLog({
    payload,
    requestType: adapterType,
    callType: adapterType,
    provider: getCustomAdapterProvider(adapter),
    model: payload?.model || 'CUSTOM_IMAGE_TO_VIDEO',
    providerRequestId: requestId,
    source: 'custom_ai_video_adapter',
    service: 'samsar_ai_video_layer_generator',
    status: 'requested',
    metadata: {
      adapterSource: source,
      endpoint: endpointPath,
      aspectRatio: payload?.aspectRatio,
      duration: payload?.duration,
    },
  });

  const providerStatusUrl = getProviderUrl(response.data, ['status_url', 'statusUrl']);
  const providerResponseUrl = getProviderUrl(response.data, ['response_url', 'responseUrl', 'result_url', 'resultUrl']);
  if (payload._id && (providerStatusUrl || providerResponseUrl)) {
    await AIVideoLayerGeneration.findByIdAndUpdate(payload._id, {
      ...(providerStatusUrl ? { customFalStatusUrl: providerStatusUrl } : {}),
      ...(providerResponseUrl ? { customFalResponseUrl: providerResponseUrl } : {}),
    });
  }

  return requestId;
}

async function listenToPendingCustomFalCompatibleRequest(payload, adapterType) {
  const { generationId } = payload;
  if (!generationId) {
    throw new Error(`Custom ${adapterType} polling called without a generationId.`);
  }

  const { adapter } = await resolveCustomAdapterConfig(payload, adapterType);
  const endpointPath = adapter[adapterType];
  const encodedGenerationId = encodeURIComponent(generationId);
  const statusUrl = normalizeProviderUrl(payload.customFalStatusUrl) ||
    buildCustomEndpointUrl(adapter.base_url, endpointPath, `requests/${encodedGenerationId}/status`);

  const statusResponse = await axios.get(statusUrl, {
    headers: buildHeaders(adapter.api_key),
    timeout: 60000,
  });

  const responseStatus = normalizeProviderStatus(statusResponse.data);
  if (responseStatus !== 'COMPLETED') {
    return { responseStatus };
  }

  const resultUrls = [
    normalizeProviderUrl(payload.customFalResponseUrl),
    buildCustomEndpointUrl(adapter.base_url, endpointPath, `requests/${encodedGenerationId}/response`),
    buildCustomEndpointUrl(adapter.base_url, endpointPath, `requests/${encodedGenerationId}`),
  ].filter(Boolean);

  let remoteUrl = null;
  let lastResultError = null;
  for (const resultUrl of [...new Set(resultUrls)]) {
    try {
      const resultResponse = await axios.get(resultUrl, {
        headers: buildHeaders(adapter.api_key),
        timeout: 60000,
      });
      remoteUrl = getVideoUrl(resultResponse.data);
      if (remoteUrl) {
        break;
      }
    } catch (error) {
      lastResultError = error;
    }
  }

  if (!remoteUrl) {
    if (lastResultError) {
      throw lastResultError;
    }
    throw new Error(`Custom ${adapterType} result did not include a video url.`);
  }

  return {
    responseStatus: 'COMPLETED',
    remoteUrl,
  };
}

export async function generateCustomImageToVideoLayer(payload) {
  return submitCustomFalCompatibleRequest(payload, CUSTOM_ADAPTER_TYPES.IMAGE_TO_VIDEO);
}

export async function listenToPendingCustomImageToVideoRequests(payload) {
  return listenToPendingCustomFalCompatibleRequest(payload, CUSTOM_ADAPTER_TYPES.IMAGE_TO_VIDEO);
}
