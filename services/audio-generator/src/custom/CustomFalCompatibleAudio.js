import axios from 'axios';
import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';

export const CUSTOM_AUDIO_ADAPTER_TYPES = {
  TEXT_TO_SPEECH: 'text_to_speech',
  TEXT_TO_MUSIC: 'text_to_music',
  TEXT_TO_SOUND_EFFECT: 'text_to_sound_effect',
};

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
    adapter.name ||
    ''
  ) || 'custom';
}

function removeEmptyValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function hasAdapterEndpoint(adapter, adapterType) {
  return Boolean(
    isPlainObject(adapter) &&
    normalizeString(adapter.base_url) &&
    normalizeString(adapter[adapterType])
  );
}

function getAdapterFromSource(source, adapterType) {
  const adapter = source?.custom_adapters;
  return hasAdapterEndpoint(adapter, adapterType) ? adapter : null;
}

export function buildCustomEndpointUrl(baseUrl, endpointPath, suffix = '') {
  const normalizedBaseUrl = normalizeString(baseUrl).replace(/\/+$/, '');
  const normalizedEndpointPath = normalizeString(endpointPath).replace(/^\/+|\/+$/g, '');
  const normalizedSuffix = normalizeString(suffix).replace(/^\/+/, '');

  if (!normalizedBaseUrl) {
    throw new Error('custom_adapters.base_url is required for custom audio generation.');
  }
  if (!normalizedEndpointPath) {
    throw new Error('A custom audio model endpoint path is required for custom audio generation.');
  }

  const relativePath = [normalizedEndpointPath, normalizedSuffix].filter(Boolean).join('/');
  return new URL(relativePath, `${normalizedBaseUrl}/`).toString();
}

export async function resolveCustomAudioAdapterConfig(payload, adapterType) {
  const sessionData = await VideoSession.findById(payload.sessionId)
    .select('custom_adapters userId')
    .lean();
  const sessionAdapter = getAdapterFromSource(sessionData, adapterType);

  if (sessionAdapter) {
    return {
      adapter: sessionAdapter,
      source: 'video_session',
    };
  }

  const userId = payload.userId || sessionData?.userId;
  if (!userId) {
    throw new Error('Unable to resolve user for custom audio adapter configuration.');
  }

  const userData = await User.findById(userId)
    .select('custom_adapters')
    .lean();
  const userAdapter = getAdapterFromSource(userData, adapterType);

  if (!userAdapter) {
    throw new Error(`Missing custom_adapters.${adapterType} configuration for custom audio generation.`);
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

function firstUrlFromArray(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  for (const item of items) {
    const candidate = normalizeString(item?.url || item?.audio_url || item);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function getAudioUrl(resultData) {
  const candidates = [
    resultData?.audio?.url,
    typeof resultData?.audio === 'string' ? resultData.audio : null,
    resultData?.audio_file?.url,
    typeof resultData?.audio_file === 'string' ? resultData.audio_file : null,
    resultData?.data?.audio?.url,
    typeof resultData?.data?.audio === 'string' ? resultData.data.audio : null,
    resultData?.data?.audio_file?.url,
    typeof resultData?.data?.audio_file === 'string' ? resultData.data.audio_file : null,
    resultData?.output?.audio?.url,
    resultData?.data?.output?.audio?.url,
    resultData?.output?.audio_file?.url,
    resultData?.data?.output?.audio_file?.url,
    resultData?.url,
    resultData?.data?.url,
    resultData?.audio_url,
    resultData?.data?.audio_url,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return (
    firstUrlFromArray(resultData?.audios) ||
    firstUrlFromArray(resultData?.data?.audios) ||
    firstUrlFromArray(resultData?.files) ||
    firstUrlFromArray(resultData?.data?.files) ||
    null
  );
}

function normalizeDurationSeconds(payload) {
  const duration = Number(payload?.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return duration;
  }

  const secondsTotal = Number(payload?.secondsTotal);
  if (Number.isFinite(secondsTotal) && secondsTotal > 0) {
    return secondsTotal;
  }

  return undefined;
}

function buildSpeechInputPayload(payload) {
  return removeEmptyValues({
    text: payload.prompt,
    input: payload.prompt,
    prompt: payload.prompt,
    voice: payload.speaker,
    speaker: payload.speaker,
    voice_name: payload.speakerCharacterName,
    speaker_character_name: payload.speakerCharacterName,
    instructions: payload.instructions,
    generation_meta: payload.generationMeta,
    end_user_id: payload.userId,
  });
}

function buildMusicInputPayload(payload) {
  return removeEmptyValues({
    prompt: payload.prompt,
    duration: normalizeDurationSeconds(payload),
    make_instrumental: Boolean(payload.isInstrumental),
    is_instrumental: Boolean(payload.isInstrumental),
    force_instrumental: Boolean(payload.isInstrumental || payload?.generationMeta?.forceInstrumental),
    lyrics: normalizeString(payload?.generationMeta?.lyrics) || undefined,
    generation_meta: payload.generationMeta,
    end_user_id: payload.userId,
  });
}

function buildSoundEffectInputPayload(payload) {
  return removeEmptyValues({
    prompt: payload.prompt,
    seconds_total: normalizeDurationSeconds(payload),
    duration: normalizeDurationSeconds(payload),
    generation_meta: payload.generationMeta,
    end_user_id: payload.userId,
  });
}

function buildCustomInputPayload(payload, adapterType) {
  if (adapterType === CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_SPEECH) {
    return buildSpeechInputPayload(payload);
  }
  if (adapterType === CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_MUSIC) {
    return buildMusicInputPayload(payload);
  }
  if (adapterType === CUSTOM_AUDIO_ADAPTER_TYPES.TEXT_TO_SOUND_EFFECT) {
    return buildSoundEffectInputPayload(payload);
  }

  throw new Error(`Unsupported custom audio adapter type: ${adapterType}`);
}

function getGenerationRequestId(payload) {
  return normalizeString(payload?.apiRequestId) || normalizeString(payload?.generationId);
}

export async function submitCustomAudioRequest(payload, adapterType) {
  const { adapter, source } = await resolveCustomAudioAdapterConfig(payload, adapterType);
  const endpointPath = adapter[adapterType];
  const submitUrl = buildCustomEndpointUrl(adapter.base_url, endpointPath);

  const response = await axios.post(
    submitUrl,
    { input: buildCustomInputPayload(payload, adapterType) },
    {
      headers: buildHeaders(adapter.api_key),
      timeout: 60000,
    }
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
    model: payload?.model || payload?.ttsProvider || adapterType,
    providerRequestId: requestId,
    source: 'custom_audio_adapter',
    service: 'samsar_audio_generator',
    status: 'requested',
    metadata: {
      adapterSource: source,
      endpoint: endpointPath,
      speaker: payload?.speaker,
      duration: payload?.duration || payload?.secondsTotal,
    },
  });

  return requestId;
}

export async function listenToPendingCustomAudioRequest(payload, adapterType) {
  const requestId = getGenerationRequestId(payload);
  if (!requestId) {
    throw new Error(`Custom ${adapterType} polling called without a request id.`);
  }

  const { adapter } = await resolveCustomAudioAdapterConfig(payload, adapterType);
  const encodedRequestId = encodeURIComponent(requestId);
  const statusUrl = buildCustomEndpointUrl(
    adapter.base_url,
    adapter[adapterType],
    `requests/${encodedRequestId}/status`
  );

  const statusResponse = await axios.get(statusUrl, {
    headers: buildHeaders(adapter.api_key),
    timeout: 60000,
  });

  const responseStatus = normalizeProviderStatus(statusResponse.data);
  if (responseStatus !== 'COMPLETED') {
    return { responseStatus };
  }

  const resultUrl = buildCustomEndpointUrl(
    adapter.base_url,
    adapter[adapterType],
    `requests/${encodedRequestId}`
  );
  const resultResponse = await axios.get(resultUrl, {
    headers: buildHeaders(adapter.api_key),
    timeout: 60000,
  });

  const audioUrl = getAudioUrl(resultResponse.data);
  if (!audioUrl) {
    return {
      responseStatus: 'FAILED',
      error: `Custom ${adapterType} result did not include an audio URL.`,
    };
  }

  return {
    responseStatus: 'COMPLETED',
    remoteUrl: audioUrl,
    result: resultResponse.data,
  };
}
