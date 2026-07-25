import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

import VideoSession from '../../schema/VideoSession.js';
import { getDBConnectionString } from '../DBString.js';
import { requestGenerateCustomAIVideo } from '../ai_video/index.js';
import {
  requestCreateVideo,
} from './MovieAPI.js';
import {
  buildVideoStatusDetailedResponse,
  buildVideoStatusResponse,
  normalizeResponseAssetUrl,
} from './StatusAPI.js';
import { normalizeImageToVideoStartImagePayload } from './VideoInputPayloadAliases.js';

const EXTERNAL_VIDEO_STAGE_LABELS = {
  ai_video_generation: 'Image to video',
  lip_sync_generation: 'Lip sync',
  sound_effect_generation: 'Sound effect',
};

const COMPLETED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE']);
const FAILED_STATUS_MARKERS = ['FAIL', 'ERROR', 'TIMEOUT'];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function summarizePublicMediaUrl(value) {
  const normalized = normalizeString(value).split('?')[0];
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    return {
      protocol: parsed.protocol.replace(/:$/, ''),
      host: parsed.host,
      pathname: parsed.pathname,
    };
  } catch {
    return { value: normalized };
  }
}

function normalizeStatusString(value) {
  return normalizeString(value).toUpperCase();
}

function isCompletedStatus(value) {
  return COMPLETED_STATUSES.has(normalizeStatusString(value));
}

function isFailedStatus(value) {
  const normalized = normalizeStatusString(value);
  return FAILED_STATUS_MARKERS.some((marker) => normalized.includes(marker));
}

function normalizeExternalVideoPayload(payload = {}) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {};
}

function normalizeExternalImageToVideoPayload(payload = {}) {
  return normalizeImageToVideoStartImagePayload(normalizeExternalVideoPayload(payload));
}

function getFirstStringValue(source = {}, keys = []) {
  for (const key of keys) {
    const value = normalizeString(source?.[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeDurationSeconds(value, fallback = 5) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, Math.round(parsed));
  }
  return fallback;
}

function getExternalStageModel(payload = {}, keys = [], fallbackModel) {
  return getFirstStringValue(payload, keys) || fallbackModel;
}

function buildExternalVideoError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function buildDeterministicExternalVideoObjectId(userId, idempotencyKey, namespace) {
  const digest = createHash('sha256')
    .update(`${userId?.toString?.() || userId}:${idempotencyKey}:${namespace}`)
    .digest('hex')
    .slice(0, 24);
  return new mongoose.Types.ObjectId(digest);
}

export function buildDirectExternalImageToVideoIdentity(userId, idempotencyKey) {
  const normalizedIdempotencyKey = normalizeString(idempotencyKey);
  if (!normalizedIdempotencyKey) {
    throw buildExternalVideoError(
      'Idempotency-Key or client_request_id is required for direct image-to-video.',
    );
  }
  return {
    idempotencyKey: normalizedIdempotencyKey,
    sessionId: buildDeterministicExternalVideoObjectId(
      userId,
      normalizedIdempotencyKey,
      'direct-i2v-session',
    ),
    layerId: buildDeterministicExternalVideoObjectId(
      userId,
      normalizedIdempotencyKey,
      'direct-i2v-layer',
    ),
    generationRequestId: buildDeterministicExternalVideoObjectId(
      userId,
      normalizedIdempotencyKey,
      'direct-i2v-generation',
    ),
  };
}

function isPrivateOrLocalHostname(hostname) {
  const normalized = normalizeString(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) {
    return true;
  }
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.endsWith('.local') ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^fc[0-9a-f]{2}:/i.test(normalized) ||
    /^fd[0-9a-f]{2}:/i.test(normalized)
  );
}

function isPrivateOrLocalIpAddress(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/^\[|\]$/g, '');
  if (!net.isIP(normalized)) {
    return false;
  }
  return (
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^fc[0-9a-f]{2}:/i.test(normalized) ||
    /^fd[0-9a-f]{2}:/i.test(normalized) ||
    /^fe80:/i.test(normalized)
  );
}

async function assertPublicHostnameResolution(url, mediaLabel) {
  const { hostname } = new URL(url);
  if (net.isIP(hostname)) {
    if (isPrivateOrLocalIpAddress(hostname)) {
      throw buildExternalVideoError(`${mediaLabel} must resolve to a public network address.`);
    }
    return;
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: false });
    if (!addresses.length || addresses.some((address) => isPrivateOrLocalIpAddress(address.address))) {
      throw buildExternalVideoError(`${mediaLabel} must resolve to a public network address.`);
    }
  } catch (error) {
    if (error?.status) {
      throw error;
    }
    throw buildExternalVideoError(`${mediaLabel} hostname could not be resolved publicly: ${error?.message || String(error)}`);
  }
}

function normalizePublicMediaUrl(value, mediaLabel) {
  const urlValue = normalizeString(value);
  if (!urlValue) {
    return '';
  }
  if (/^data:/i.test(urlValue)) {
    throw buildExternalVideoError(`${mediaLabel} must be a public http(s) URL. Raw media data is not accepted for external video endpoints.`);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    throw buildExternalVideoError(`${mediaLabel} must be a valid public http(s) URL.`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw buildExternalVideoError(`${mediaLabel} must use http or https.`);
  }
  if (isPrivateOrLocalHostname(parsedUrl.hostname)) {
    throw buildExternalVideoError(`${mediaLabel} must be publicly reachable; local or private network URLs are not accepted.`);
  }
  return parsedUrl.toString();
}

async function probePublicMediaUrl(url, mediaLabel, redirectsRemaining = 5) {
  const timeoutMs = Number(process.env.EXTERNAL_VIDEO_MEDIA_ACCESS_CHECK_TIMEOUT_MS) || 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Range: 'bytes=0-0' };

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {}
    }

    if (response.status >= 300 && response.status < 400) {
      if (redirectsRemaining <= 0) {
        throw buildExternalVideoError(`${mediaLabel} access check exceeded the maximum redirect count.`);
      }
      const location = response.headers.get('location');
      if (!location) {
        throw buildExternalVideoError(`${mediaLabel} access check returned a redirect without a location header.`);
      }
      const redirectUrl = normalizePublicMediaUrl(new URL(location, url).toString(), mediaLabel);
      await assertPublicHostnameResolution(redirectUrl, mediaLabel);
      return probePublicMediaUrl(redirectUrl, mediaLabel, redirectsRemaining - 1);
    }

    if (response.ok || response.status === 206) {
      return true;
    }
    throw buildExternalVideoError(`${mediaLabel} is not publicly accessible. Access check returned HTTP ${response.status}.`);
  } catch (error) {
    if (error?.status) {
      throw error;
    }
    throw buildExternalVideoError(`${mediaLabel} is not publicly accessible. Access check failed: ${error?.message || String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveExternalPublicMediaUrl(payload = {}, {
  disallowedDataKeys = [],
  urlKeys = [],
  mediaLabel,
} = {}) {
  const dataValue = getFirstStringValue(payload, disallowedDataKeys);
  if (dataValue) {
    throw buildExternalVideoError(`${mediaLabel} must be provided as a public URL. Raw media fields are not accepted for external video endpoints.`);
  }

  const urlValue = normalizePublicMediaUrl(getFirstStringValue(payload, urlKeys), mediaLabel);
  if (urlValue) {
    await assertPublicHostnameResolution(urlValue, mediaLabel);
    await probePublicMediaUrl(urlValue, mediaLabel);
  }
  return urlValue;
}

function normalizeExternalImageUrlItem(item, index) {
  if (typeof item === 'string') {
    return {
      original: item,
      url: normalizeString(item),
      update: (url) => url,
    };
  }

  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const imageUrl =
      normalizeString(item.image_url) ||
      normalizeString(item.imageUrl) ||
      normalizeString(item.url) ||
      normalizeString(item.src) ||
      normalizeString(item.image) ||
      normalizeString(item.start_image_url) ||
      normalizeString(item.startImageUrl) ||
      normalizeString(item.start_image) ||
      normalizeString(item.startImage);
    return {
      original: item,
      url: imageUrl,
      update: (url) => ({
        ...item,
        image_url: url,
        url,
      }),
    };
  }

  throw buildExternalVideoError(`image_urls[${index}] must be a public image URL or object containing one.`);
}

async function validateExternalImageToVideoPublicUrls(payload = {}) {
  const normalizedPayload = normalizeExternalImageToVideoPayload(payload);

  const rawDataKeys = [
    'image_data',
    'imageData',
    'start_image_data',
    'startImageData',
  ];
  if (rawDataKeys.some((key) => Object.prototype.hasOwnProperty.call(normalizedPayload, key))) {
    throw buildExternalVideoError('image_url must be provided as a public URL. Raw image data is not accepted for external image-to-video endpoints.');
  }

  if (!Array.isArray(normalizedPayload.image_urls) || normalizedPayload.image_urls.length === 0) {
    throw buildExternalVideoError('image_url or image_urls is required and must be publicly reachable.');
  }

  const validatedImageUrls = [];
  for (let index = 0; index < normalizedPayload.image_urls.length; index += 1) {
    const imageItem = normalizeExternalImageUrlItem(normalizedPayload.image_urls[index], index);
    const imageUrl = normalizePublicMediaUrl(imageItem.url, `image_urls[${index}]`);
    if (!imageUrl) {
      throw buildExternalVideoError(`image_urls[${index}] is required and must be a public image URL.`);
    }
    await assertPublicHostnameResolution(imageUrl, `image_urls[${index}]`);
    await probePublicMediaUrl(imageUrl, `image_urls[${index}]`);
    validatedImageUrls.push(imageItem.update(imageUrl));
  }

  return {
    ...normalizedPayload,
    image_urls: validatedImageUrls,
  };
}

async function loadOwnedExternalVideoSession(userId, sessionId) {
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    return null;
  }

  await getDBConnectionString();
  return VideoSession.findOne({
    _id: sessionId,
    userId: userId?.toString?.() || userId,
  }).lean();
}

function getExternalVideoStageKey(sessionData = {}) {
  const routeType = normalizeString(
    sessionData.externalVideoRoute ||
    sessionData.external_video_route ||
    sessionData.externalVideoStage ||
    sessionData.external_video_stage,
  );
  if (routeType === 'lip_sync' || routeType === 'lip_sync_generation') {
    return 'lip_sync_generation';
  }
  if (routeType === 'sound_effect' || routeType === 'sound_effect_generation') {
    return 'sound_effect_generation';
  }
  if (
    routeType === 'direct_image_to_video' ||
    routeType === 'direct_image_to_video_generation'
  ) {
    return 'ai_video_generation';
  }
  return null;
}

function getExternalVideoRouteType(stageKey) {
  if (stageKey === 'ai_video_generation') {
    return 'image_to_video';
  }
  if (stageKey === 'lip_sync_generation') {
    return 'lip_sync';
  }
  if (stageKey === 'sound_effect_generation') {
    return 'sound_effect';
  }
  return null;
}

function getExternalStageLayer(sessionData = {}) {
  return Array.isArray(sessionData.layers) ? sessionData.layers[0] : null;
}

function getExternalStageResultUrl(sessionData = {}, stageKey) {
  const layer = getExternalStageLayer(sessionData);
  if (!layer) {
    return null;
  }
  if (stageKey === 'lip_sync_generation') {
    return layer.lipSyncRemoteLink || layer.lipSyncVideoLayer || null;
  }
  if (stageKey === 'sound_effect_generation') {
    return layer.soundEffectRemoteLink || layer.soundEffectVideoLayer || null;
  }
  if (stageKey === 'ai_video_generation') {
    return layer.aiVideoRemoteLink || layer.aiVideoLayer || null;
  }
  return null;
}

function getExternalStageStatus(sessionData = {}, stageKey) {
  const layer = getExternalStageLayer(sessionData);
  if (!layer) {
    return 'PENDING';
  }

  const statusValue = stageKey === 'ai_video_generation'
    ? layer.aiVideoGenerationStatus
    : stageKey === 'lip_sync_generation'
      ? layer.lipSyncVideoGenerationStatus
      : layer.soundEffectVideoGenerationStatus;
  if (isFailedStatus(statusValue)) {
    return 'FAILED';
  }
  if (isCompletedStatus(statusValue) && getExternalStageResultUrl(sessionData, stageKey)) {
    return 'COMPLETED';
  }
  if (getExternalStageResultUrl(sessionData, stageKey)) {
    return 'COMPLETED';
  }
  if (
    layer.aiVideoGenerationPending ||
    layer.lipSyncGenerationPending ||
    layer.soundEffectGenerationPending
  ) {
    return 'PENDING';
  }
  return normalizeStatusString(statusValue) || 'PENDING';
}

function getStageError(sessionData = {}) {
  const layer = getExternalStageLayer(sessionData);
  return (
    normalizeString(layer?.aiVideoGenerationError) ||
    normalizeString(layer?.lipSyncVideoGenerationError) ||
    normalizeString(layer?.soundEffectVideoGenerationError) ||
    normalizeString(sessionData.expressGenerationError) ||
    null
  );
}

function decorateExternalStageStatus(statusPayload = {}, sessionData = {}, req = null) {
  const stageKey = getExternalVideoStageKey(sessionData);
  if (!stageKey) {
    return statusPayload;
  }

  const routeType = getExternalVideoRouteType(stageKey);
  const resultUrl = normalizeResponseAssetUrl(getExternalStageResultUrl(sessionData, stageKey), req);
  const stageStatus = getExternalStageStatus(sessionData, stageKey);
  const errorMessage = getStageError(sessionData);
  const decorated = {
    ...statusPayload,
    status: stageStatus,
    route_type: routeType,
    routeType,
    external_video_route: routeType,
    externalVideoRoute: routeType,
    external_video_stage: stageKey,
    externalVideoStage: stageKey,
    provider: statusPayload.provider || sessionData.expressGenerativeVideoModel || null,
  };

  if (resultUrl && stageStatus === 'COMPLETED') {
    decorated.result_url = resultUrl;
    decorated.result_urls = [resultUrl];
  }
  if (errorMessage && stageStatus === 'FAILED') {
    decorated.message = errorMessage;
    decorated.error = errorMessage;
  }
  if (stageStatus === 'FAILED') {
    console.error('[external_video][status_failed] external video stage failed', {
      sessionId: sessionData?._id?.toString?.() || sessionData?._id || null,
      stageKey,
      routeType,
      provider: decorated.provider || null,
      errorMessage,
      layerStatus: getExternalStageLayer(sessionData)?.aiVideoGenerationStatus ||
        getExternalStageLayer(sessionData)?.lipSyncVideoGenerationStatus ||
        getExternalStageLayer(sessionData)?.soundEffectVideoGenerationStatus ||
        null,
    });
  }
  return decorated;
}

export async function buildExternalVideoStatus({ userId, sessionId, req }) {
  const sessionData = await loadOwnedExternalVideoSession(userId, sessionId);
  if (!sessionData) {
    return null;
  }

  const stageKey = getExternalVideoStageKey(sessionData);
  const defaultResultUrl = stageKey ? getExternalStageResultUrl(sessionData, stageKey) : null;
  const baseStatus = await buildVideoStatusResponse({
    sessionId,
    requestId: sessionId,
    provider: sessionData.expressGenerativeVideoModel || null,
    req,
    defaultResultUrl,
  });
  if (!baseStatus) {
    return null;
  }

  return decorateExternalStageStatus(baseStatus, sessionData, req);
}

export async function buildExternalVideoDetailedStatus({ userId, sessionId, req }) {
  const sessionData = await loadOwnedExternalVideoSession(userId, sessionId);
  if (!sessionData) {
    return null;
  }

  const stageKey = getExternalVideoStageKey(sessionData);
  const defaultResultUrl = stageKey ? getExternalStageResultUrl(sessionData, stageKey) : null;
  const detailedStatus = await buildVideoStatusDetailedResponse({
    sessionId,
    requestId: sessionId,
    provider: sessionData.expressGenerativeVideoModel || null,
    req,
    defaultResultUrl,
  });
  if (!detailedStatus) {
    return null;
  }

  const decorated = decorateExternalStageStatus(detailedStatus, sessionData, req);
  if (stageKey && decorated.session) {
    decorated.session = {
      ...decorated.session,
      routeType: 'external_video',
      externalVideoRoute: getExternalVideoRouteType(stageKey),
      externalVideoStage: stageKey,
    };
  }
  return decorated;
}

export async function requestExternalTextToVideo({ userId, payload = {}, webhookUrl = null, req = null }) {
  const response = await requestCreateVideo(userId, normalizeExternalVideoPayload(payload), webhookUrl);
  const sessionId = response?.session_id || response?.request_id;
  const statusPayload = sessionId
    ? await buildExternalVideoStatus({ userId, sessionId, req })
    : null;
  return {
    ...response,
    ...(statusPayload?.status ? { status: statusPayload.status } : {}),
  };
}

function getValidatedDirectStartImage(normalizedPayload = {}) {
  if (!Array.isArray(normalizedPayload.image_urls) || normalizedPayload.image_urls.length !== 1) {
    throw buildExternalVideoError(
      'Direct image-to-video requires exactly one public start image URL.',
    );
  }
  return normalizeExternalImageUrlItem(normalizedPayload.image_urls[0], 0).url;
}

export function buildDirectExternalImageToVideoSession({
  userId,
  identity,
  payload,
  startImage,
}) {
  const model = getFirstStringValue(payload, ['video_model', 'videoModel', 'model']);
  if (!model) {
    throw buildExternalVideoError('video_model is required for direct image-to-video.');
  }

  const prompt = getFirstStringValue(payload, ['prompt']);
  const aspectRatio = getFirstStringValue(payload, ['aspect_ratio', 'aspectRatio']) || '16:9';
  const duration = normalizeDurationSeconds(payload.duration, 5);
  const framesPerSecond = Number(payload.frames_per_second || payload.framesPerSecond) || 24;
  const now = new Date();

  return {
    _id: identity.sessionId,
    userId,
    sessionName: 'Direct image-to-video request',
    requestType: 'API',
    isExternalVideoGeneration: true,
    externalVideoRoute: 'direct_image_to_video',
    externalVideoStage: 'ai_video_generation',
    externalRequestIdempotencyKey: identity.idempotencyKey,
    directExternalImageToVideo: true,
    expressGenerationType: 'DIRECT_IMAGE_TO_VIDEO',
    expressGenerativeVideoModel: model,
    expressGenerativeVideoRequired: true,
    expressGenerationPending: false,
    videoGenerationPending: false,
    aspectRatio,
    framesPerSecond,
    expressGenerationStatus: {
      status: 'PENDING',
      prompt_generation: 'COMPLETED',
      image_generation: 'COMPLETED',
      speech_generation: 'COMPLETED',
      music_generation: 'COMPLETED',
      audio_generation: 'COMPLETED',
      frame_generation: 'COMPLETED',
      ai_video_generation: 'PENDING',
      lip_sync_generation: 'COMPLETED',
      sound_effect_generation: 'COMPLETED',
      delete_reflow: 'COMPLETED',
      timeline_reflowed: 'COMPLETED',
      video_generation: 'COMPLETED',
    },
    layers: [{
      _id: identity.layerId,
      imageSession: {
        userId,
        generations: [],
        activeSelectedImage: startImage,
        activeImageRemoteLink: startImage,
        activeItemList: [{
          type: 'image',
          id: `direct-start-image:${identity.idempotencyKey}`,
          src: startImage,
        }],
        generationStatus: 'COMPLETED',
        editStatus: 'COMPLETED',
        activeImageDescription: prompt,
        prompt,
      },
      prompt,
      videoGenerationPrompt: prompt,
      duration,
      durationOffset: 0,
      layerAiVideoType: 'ai_video',
      layerBaseAiImageType: 'image',
      aiVideoGenerationPending: true,
      aiVideoGenerationStatus: 'PENDING',
      hasAiVideoLayer: false,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }],
    audioLayers: [],
  };
}

export async function requestExternalDirectImageToVideo({
  userId,
  payload = {},
  idempotencyKey,
  req = null,
}) {
  const normalizedPayload = await validateExternalImageToVideoPublicUrls(payload);
  const startImage = getValidatedDirectStartImage(normalizedPayload);
  const identity = buildDirectExternalImageToVideoIdentity(
    userId,
    idempotencyKey ||
      normalizedPayload.client_request_id ||
      normalizedPayload.clientRequestId,
  );
  const sessionInsert = buildDirectExternalImageToVideoSession({
    userId,
    identity,
    payload: normalizedPayload,
    startImage,
  });

  await getDBConnectionString();
  const sessionDoc = await VideoSession.findOneAndUpdate(
    { _id: identity.sessionId, userId },
    { $setOnInsert: sessionInsert },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const layer = sessionDoc?.layers?.find(
    (candidate) => candidate?._id?.toString?.() === identity.layerId.toString(),
  );
  const layerStatus = normalizeStatusString(layer?.aiVideoGenerationStatus);

  // Repeated HTTP submissions for the same attempt reuse both the session and
  // deterministic queue document. Completed and failed attempts are immutable.
  if (!isCompletedStatus(layerStatus) && !isFailedStatus(layerStatus)) {
    const persistedStartImage =
      normalizeString(layer?.imageSession?.activeSelectedImage) ||
      normalizeString(layer?.imageSession?.activeImageRemoteLink) ||
      startImage;
    await requestGenerateCustomAIVideo(userId, {
      sessionId: identity.sessionId.toString(),
      videoSessionId: identity.sessionId.toString(),
      currentLayerId: identity.layerId.toString(),
      layerId: identity.layerId.toString(),
      generationRequestId: identity.generationRequestId.toString(),
      externalRequestIdempotencyKey: identity.idempotencyKey,
      creditIdempotencyKey: `direct-external-i2v:${userId}:${identity.idempotencyKey}`,
      directExternalImageToVideo: true,
      model: sessionDoc.expressGenerativeVideoModel,
      prompt: layer?.prompt || '',
      duration: layer?.duration,
      aspectRatio: sessionDoc.aspectRatio,
      framesPerSecond: sessionDoc.framesPerSecond,
      startImage: persistedStartImage,
      useStartFrame: true,
      useEndFrame: false,
      combineLayers: false,
      clipLayerToAiVideo: false,
      retryOnFail: false,
      generationType: 'generate',
      samsarExternalProviderStage: 'ai_video_generation',
      samsarExternalVideoRoute: 'direct_image_to_video',
    });
  }

  const statusPayload = await buildExternalVideoStatus({
    userId,
    sessionId: identity.sessionId.toString(),
    req,
  });

  return {
    request_id: identity.sessionId.toString(),
    session_id: identity.sessionId.toString(),
    status: statusPayload?.status || 'PENDING',
    route_type: 'image_to_video',
    external_video_route: 'image_to_video',
    external_video_stage: 'ai_video_generation',
  };
}

export async function requestExternalImageToVideo(options = {}) {
  return requestExternalDirectImageToVideo(options);
}

async function requestExternalVideoMediaStage({
  userId,
  payload = {},
  stageKey,
  routeType,
  defaultModel,
  modelKeys,
  requiresAudio = false,
  req = null,
}) {
  await getDBConnectionString();
  const normalizedPayload = normalizeExternalVideoPayload(payload);
  const model = getExternalStageModel(normalizedPayload, modelKeys, defaultModel);
  const duration = normalizeDurationSeconds(
    normalizedPayload.duration || normalizedPayload.audioDuration || normalizedPayload.audio_duration,
    5,
  );
  const aspectRatio = getFirstStringValue(normalizedPayload, ['aspect_ratio', 'aspectRatio']) || '16:9';
  const prompt = getFirstStringValue(normalizedPayload, ['prompt', 'audioPrompt', 'audio_prompt']);
  const videoUrl = await resolveExternalPublicMediaUrl(normalizedPayload, {
    disallowedDataKeys: ['video_data', 'videoData'],
    urlKeys: ['video_url', 'videoUrl', 'videoLink', 'video'],
    mediaLabel: 'video_url',
  });
  const audioUrl = requiresAudio
    ? await resolveExternalPublicMediaUrl(normalizedPayload, {
      disallowedDataKeys: ['audio_data', 'audioData'],
      urlKeys: ['audio_url', 'audioUrl', 'audioLink', 'audio'],
      mediaLabel: 'audio_url',
    })
    : '';

  if (!videoUrl) {
    throw buildExternalVideoError('video_url is required and must be a publicly reachable URL.');
  }
  if (requiresAudio && !audioUrl) {
    throw buildExternalVideoError('audio_url is required and must be a publicly reachable URL.');
  }

  console.log('[external_video][media_stage_request] creating external video media stage', {
    stageKey,
    routeType,
    model,
    duration,
    aspectRatio,
    promptLength: prompt.length,
    requiresAudio,
    videoUrl: summarizePublicMediaUrl(videoUrl),
    audioUrl: summarizePublicMediaUrl(audioUrl),
  });

  const layerId = new mongoose.Types.ObjectId();
  const audioLayerId = new mongoose.Types.ObjectId();
  const now = new Date();
  const isSoundEffect = stageKey === 'sound_effect_generation';

  const sessionDoc = new VideoSession({
    userId,
    sessionName: `${EXTERNAL_VIDEO_STAGE_LABELS[stageKey] || routeType} request`,
    requestType: 'API',
    isExternalVideoGeneration: true,
    externalVideoRoute: routeType,
    externalVideoStage: stageKey,
    expressGenerationType: stageKey === 'lip_sync_generation' ? 'LIP_SYNC' : 'SOUND_EFFECT',
    aspectRatio,
    expressGenerativeVideoModel: model,
    layers: [{
      _id: layerId,
      imageSession: {
        userId,
        generations: [],
        activeItemList: [],
        generationStatus: 'COMPLETED',
        editStatus: 'COMPLETED',
        activeImageDescription: prompt,
      },
      prompt,
      videoGenerationPrompt: prompt,
      duration,
      durationOffset: 0,
      layerAiVideoType: isSoundEffect ? 'sound_effect' : 'character',
      layerBaseAiImageType: isSoundEffect ? 'sound_effect' : 'character',
      layerAISoundEffectPrompt: isSoundEffect ? prompt : '',
      aiVideoLayer: videoUrl,
      aiVideoRemoteLink: videoUrl,
      hasAiVideoLayer: true,
      aiVideoGenerationPending: false,
      aiVideoGenerationStatus: 'COMPLETED',
      lipSyncGenerationPending: stageKey === 'lip_sync_generation',
      soundEffectGenerationPending: isSoundEffect,
      hasLipSyncVideoLayer: false,
      hasSoundEffectVideoLayer: false,
      lipSyncVideoGenerationStatus: stageKey === 'lip_sync_generation' ? 'PENDING' : 'COMPLETED',
      soundEffectVideoGenerationStatus: isSoundEffect ? 'PENDING' : 'COMPLETED',
      status: 'pending',
    }],
    audioLayers: requiresAudio ? [{
      _id: audioLayerId,
      generationType: 'speech',
      prompt,
      startTime: 0,
      endTime: duration,
      duration,
      selectedRemoteAudioLink: audioUrl,
      remoteAudioLinks: [audioUrl],
      selectedLocalAudioLink: '',
      localAudioLinks: [],
      connectedLayerId: layerId.toString(),
      generationStatus: 'COMPLETED',
      isHuman: true,
      createdAt: now,
      updatedAt: now,
    }] : [],
  });

  await sessionDoc.save();
  console.log('[external_video][media_stage_request] external video session created', {
    sessionId: sessionDoc._id.toString(),
    layerId: layerId.toString(),
    audioLayerId: requiresAudio ? audioLayerId.toString() : null,
    stageKey,
    routeType,
    model,
    duration,
  });

  await requestGenerateCustomAIVideo(userId, {
    sessionId: sessionDoc._id.toString(),
    videoSessionId: sessionDoc._id.toString(),
    currentLayerId: layerId.toString(),
    layerId: layerId.toString(),
    model,
    prompt,
    audioPrompt: prompt,
    duration,
    aspectRatio,
    videoUrl,
    videoLink: videoUrl,
    ...(requiresAudio ? { audioLink: audioUrl } : {}),
    isAudioVideoGeneration: true,
    clipLayerToAiVideo: false,
    retryOnFail: false,
    generationType: stageKey === 'lip_sync_generation' ? 'lip_sync' : 'sound_effect',
    samsarExternalProviderStage: stageKey,
    samsarExternalVideoRoute: routeType,
  });
  console.log('[external_video][media_stage_request] queued external video provider generation', {
    sessionId: sessionDoc._id.toString(),
    layerId: layerId.toString(),
    stageKey,
    routeType,
    model,
    retryOnFail: false,
  });

  const statusPayload = await buildExternalVideoStatus({
    userId,
    sessionId: sessionDoc._id.toString(),
    req,
  });

  return {
    request_id: sessionDoc._id.toString(),
    session_id: sessionDoc._id.toString(),
    status: statusPayload?.status || 'PENDING',
    route_type: routeType,
    external_video_route: routeType,
    external_video_stage: stageKey,
  };
}

export async function requestExternalLipSyncVideo({ userId, payload = {}, req = null }) {
  return requestExternalVideoMediaStage({
    userId,
    payload,
    stageKey: 'lip_sync_generation',
    routeType: 'lip_sync',
    defaultModel: 'SYNCLIPSYNC',
    modelKeys: ['lip_sync_model', 'lipSyncModel', 'video_model', 'videoModel', 'model'],
    requiresAudio: true,
    req,
  });
}

export async function requestExternalSoundEffectVideo({ userId, payload = {}, req = null }) {
  return requestExternalVideoMediaStage({
    userId,
    payload,
    stageKey: 'sound_effect_generation',
    routeType: 'sound_effect',
    defaultModel: 'MIRELOAI',
    modelKeys: ['sound_effect_model', 'soundEffectModel', 'video_model', 'videoModel', 'model'],
    requiresAudio: false,
    req,
  });
}
