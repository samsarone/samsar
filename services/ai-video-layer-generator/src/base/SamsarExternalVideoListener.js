import fs from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import axios from 'axios';
import SamsarClient from 'samsar-js';

import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getDBConnectionString } from '../DBString.js';
import { isDockerRuntime, isStandaloneEdition } from '../utils/Environment.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import {
  DOCKER_FAL_LIP_SYNC_MODELS,
  DOCKER_VIDEO_PROVIDER,
  resolveDockerVideoProvider,
} from '../consts/DockerProviderPriority.js';
import { normalizeProviderMediaUrl } from '../AWS.js';

const EXTERNAL_REQUEST_PREFIX = 'samsar-external-video:';
const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_EXTERNAL_VIDEO_ROUTE = 'direct_image_to_video';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripQuery(value) {
  return normalizeString(value).split('?')[0];
}

function summarizeMediaUrl(value) {
  const normalized = stripQuery(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    return {
      url: normalized,
      protocol: parsed.protocol.replace(/:$/, ''),
      host: parsed.host,
      pathname: parsed.pathname,
    };
  } catch {
    return {
      url: normalized,
    };
  }
}

function summarizeExternalVideoInput(input = {}) {
  return {
    videoUrl: summarizeMediaUrl(input.video_url),
    audioUrl: summarizeMediaUrl(input.audio_url),
    imageUrl: summarizeMediaUrl(input.image_url || input.start_image_url || input.startImage),
    videoModel: normalizeString(input.video_model || input.lip_sync_model || input.sound_effect_model),
    promptLength: normalizeString(input.prompt).length,
    aspectRatio: normalizeString(input.aspect_ratio),
    duration: input.duration,
    audioDuration: input.audioDuration || input.audio_duration,
    metadata: input.metadata || null,
  };
}

function summarizeExternalStatus(statusData = {}) {
  const session = statusData?.session || statusData?.data?.session || null;
  const firstLayer = Array.isArray(session?.layers) ? session.layers[0] : null;
  const firstAudioLayer = Array.isArray(session?.audioLayers) ? session.audioLayers[0] : null;
  return {
    status: statusData?.status || statusData?.data?.status || null,
    state: statusData?.state || statusData?.data?.state || null,
    routeType: statusData?.routeType || statusData?.route_type || statusData?.externalVideoRoute || statusData?.external_video_route || session?.externalVideoRoute || null,
    externalVideoStage: statusData?.externalVideoStage || statusData?.external_video_stage || session?.externalVideoStage || null,
    provider: statusData?.provider || statusData?.data?.provider || session?.provider || null,
    resultUrl: summarizeMediaUrl(getVideoUrl(statusData)),
    message: statusData?.message || statusData?.error || statusData?.data?.message || statusData?.data?.error || null,
    session: session ? {
      id: session.id || session.requestId || null,
      provider: session.provider || null,
      currentStage: session.currentStage || null,
      previewStage: session.previewStage || null,
      stages: session.stages || null,
      firstLayer: firstLayer ? {
        id: firstLayer.id || null,
        aiVideoStatus: firstLayer.aiVideo?.status || null,
        aiVideoUrl: summarizeMediaUrl(firstLayer.aiVideo?.url),
        lipSyncStatus: firstLayer.lipSyncVideo?.status || null,
        lipSyncUrl: summarizeMediaUrl(firstLayer.lipSyncVideo?.url),
        previewStage: firstLayer.preview?.stage || null,
        previewUrl: summarizeMediaUrl(firstLayer.preview?.url),
      } : null,
      firstAudioLayer: firstAudioLayer ? {
        id: firstAudioLayer.id || null,
        status: firstAudioLayer.status || null,
        url: summarizeMediaUrl(firstAudioLayer.url),
        duration: firstAudioLayer.duration,
      } : null,
    } : null,
  };
}

function getExternalStatusFailureMessage(statusData = {}) {
  const summarized = summarizeExternalStatus(statusData);
  return (
    normalizeString(summarized?.message) ||
    normalizeString(statusData?.message) ||
    normalizeString(statusData?.error) ||
    normalizeString(statusData?.data?.message) ||
    normalizeString(statusData?.data?.error) ||
    (summarized?.status ? `Samsar external video request failed with status ${summarized.status}.` : '')
  );
}

function getAssetPathFromMediaReference(reference) {
  let normalized = normalizeString(reference).replace(/\\/g, '/').split('?')[0];
  if (!normalized) {
    return '';
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      normalized = decodeURIComponent(new URL(normalized).pathname);
    } catch {}
  }

  const assetsV2Index = normalized.indexOf('/assets_v2/');
  if (assetsV2Index >= 0) {
    return `assets_v2/${normalized.slice(assetsV2Index + '/assets_v2/'.length)}`;
  }

  const assetsIndex = normalized.indexOf('/assets/');
  if (assetsIndex >= 0) {
    return `assets/${normalized.slice(assetsIndex + '/assets/'.length)}`;
  }

  normalized = normalized.replace(/^\/+/, '');
  if (normalized.startsWith('assets_v2/') || normalized.startsWith('assets/')) {
    return normalized;
  }

  return '';
}

function normalizeBaseUrl(value) {
  const normalized = normalizeString(value || DEFAULT_SAMSAR_API_BASE_URL).replace(/\/+$/, '');
  return normalized || DEFAULT_SAMSAR_API_BASE_URL;
}

function isTruthyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isFalseyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off';
}

function shouldEnableExternalProviders() {
  if (isFalseyEnv(process.env.SAMSAR_EXTERNAL_PROVIDERS_ENABLED)) {
    return false;
  }
  if (isTruthyEnv(process.env.SAMSAR_EXTERNAL_PROVIDERS_ENABLED)) {
    return true;
  }
  if (isTruthyEnv(process.env.SAMSAR_FORCE_EXTERNAL_PROVIDERS)) {
    return true;
  }
  return isStandaloneEdition();
}

function getExternalClient() {
  const apiKey = normalizeString(process.env.SAMSAR_API_KEY);
  if (!apiKey) {
    return null;
  }

  const baseUrl = normalizeBaseUrl(process.env.SAMSAR_JS_API_URL || process.env.SAMSAR_API_URL);
  return new SamsarClient({
    apiKey,
    baseUrl,
    timeoutMs: Number(process.env.SAMSAR_EXTERNAL_PROVIDER_TIMEOUT_MS) || 120000,
  });
}

function getExternalRequestId(generationId) {
  const normalized = normalizeString(generationId);
  if (!normalized.startsWith(EXTERNAL_REQUEST_PREFIX)) {
    return '';
  }
  return normalized.slice(EXTERNAL_REQUEST_PREFIX.length);
}

export function isSamsarExternalVideoRequest(payload = {}) {
  return Boolean(
    payload?.samsarExternalProvider === true ||
    normalizeString(payload?.externalProvider).toLowerCase() === 'samsar' ||
    normalizeString(payload?.model) === 'SAMSAR_EXTERNAL_VIDEO' ||
    getExternalRequestId(payload?.generationId)
  );
}

export function shouldUseSamsarExternalVideoProvider(payload = {}) {
  if (!shouldEnableExternalProviders()) {
    return false;
  }
  if (!getExternalClient()) {
    return false;
  }
  if (isSamsarExternalVideoRequest(payload)) {
    return true;
  }
  if (normalizeString(payload?.status || 'INIT').toUpperCase() !== 'INIT') {
    return false;
  }
  return resolveDockerVideoProvider(payload?.model, {
    generationType: payload?.generationType || payload?.layerAiVideoType,
    preferredProvider: payload?.dockerVideoProviderOverride,
  }) === DOCKER_VIDEO_PROVIDER.SAMSAR;
}

function getMimeTypeFromPath(filePath) {
  const extension = path.extname(filePath || '').toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }
  if (extension === '.webp') {
    return 'image/webp';
  }
  if (extension === '.gif') {
    return 'image/gif';
  }
  return 'image/png';
}

function getPathFromFileUrl(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return value.replace(/^file:\/\//i, '');
  }
}

async function readImageReferenceAsDataUrl(reference) {
  const normalized = normalizeString(reference);
  if (!normalized) {
    throw new Error('Samsar external video generation requires a start image.');
  }
  if (/^data:image\//i.test(normalized)) {
    return normalized;
  }

  const localPath = normalized.startsWith('file://') ? getPathFromFileUrl(normalized) : normalized;
  if (path.isAbsolute(localPath) && fs.existsSync(localPath)) {
    const buffer = await readFile(localPath);
    return `data:${getMimeTypeFromPath(localPath)};base64,${buffer.toString('base64')}`;
  }

  if (/^https?:\/\//i.test(normalized)) {
    const response = await axios.get(normalized, {
      responseType: 'arraybuffer',
      timeout: Number(process.env.SAMSAR_EXTERNAL_MEDIA_DOWNLOAD_TIMEOUT_MS) || 120000,
    });
    const contentType = normalizeString(response.headers?.['content-type']).split(';')[0] || 'image/png';
    return `data:${contentType};base64,${Buffer.from(response.data).toString('base64')}`;
  }

  throw new Error(`Unable to read start image for Samsar external video generation: ${normalized}`);
}

export function getStartImageReference(payload = {}) {
  return normalizeString(payload.startImage) ||
    normalizeString(payload.imageUrl) ||
    normalizeString(payload.imageURL) ||
    normalizeString(payload.image_url) ||
    normalizeString(payload.start_image_url) ||
    normalizeString(payload.startImageUrl) ||
    normalizeString(payload.start_image);
}

function getRequestId(responseData) {
  return (
    responseData?.request_id ||
    responseData?.requestId ||
    responseData?.session_id ||
    responseData?.sessionId ||
    responseData?.data?.request_id ||
    responseData?.data?.requestId ||
    responseData?.data?.session_id ||
    responseData?.data?.sessionId ||
    null
  );
}

function getUploadedImageUrl(responseData) {
  const imageUrls = Array.isArray(responseData?.image_urls)
    ? responseData.image_urls
    : Array.isArray(responseData?.imageUrls)
      ? responseData.imageUrls
      : Array.isArray(responseData?.data?.image_urls)
        ? responseData.data.image_urls
        : Array.isArray(responseData?.data?.imageUrls)
          ? responseData.data.imageUrls
          : [];
  return normalizeString(imageUrls[0]);
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

function getStageResourceUrlCandidates(statusData, stage) {
  const resourcesList = [
    statusData?.current_step_resources?.resources,
    statusData?.data?.current_step_resources?.resources,
    stage ? statusData?.completed_step_resources?.[stage]?.resources : null,
    stage ? statusData?.data?.completed_step_resources?.[stage]?.resources : null,
  ].filter(Boolean);

  const keysByStage = {
    ai_video_generation: ['ai_video_url', 'preferred_video_url'],
    lip_sync_generation: ['lip_sync_url', 'preferred_video_url'],
    sound_effect_generation: ['sound_effect_url', 'preferred_video_url'],
  };
  const keys = keysByStage[stage] || [
    'preferred_video_url',
    'sound_effect_url',
    'lip_sync_url',
    'ai_video_url',
  ];

  return resourcesList.flatMap((resources) =>
    keys.flatMap((key) => [
      resources?.[key],
      resources?.layers?.[0]?.[key],
    ])
  );
}

function getFirstVideoUrl(candidates = []) {
  return candidates
    .map(normalizeString)
    .find((url) => url && !isImageResultUrl(url)) || '';
}

function getVideoUrl(statusData, stage = '') {
  const candidates = [
    ...getStageResourceUrlCandidates(statusData, stage),
    statusData?.result_url,
    statusData?.resultUrl,
    statusData?.video_url,
    statusData?.videoUrl,
    statusData?.url,
    statusData?.data?.result_url,
    statusData?.data?.resultUrl,
    statusData?.data?.video_url,
    statusData?.data?.videoUrl,
    statusData?.data?.url,
    statusData?.current_step_resources?.resources?.ai_video_url,
    statusData?.completed_step_resources?.ai_video_generation?.resources?.layers?.[0]?.ai_video_url,
  ];

  const candidateUrl = getFirstVideoUrl(candidates);
  if (candidateUrl) {
    return candidateUrl;
  }

  const resultUrls = Array.isArray(statusData?.result_urls)
    ? statusData.result_urls
    : Array.isArray(statusData?.resultUrls)
      ? statusData.resultUrls
      : Array.isArray(statusData?.data?.result_urls)
        ? statusData.data.result_urls
        : Array.isArray(statusData?.data?.resultUrls)
          ? statusData.data.resultUrls
          : [];
  return resultUrls.map(normalizeString).find((url) => url && !isImageResultUrl(url)) || '';
}

function isSameMediaReference(left, right) {
  const leftAssetPath = getAssetPathFromMediaReference(left);
  const rightAssetPath = getAssetPathFromMediaReference(right);
  if (leftAssetPath && rightAssetPath) {
    return leftAssetPath === rightAssetPath;
  }

  const normalizeReference = (value) => normalizeString(value).split('?')[0].replace(/\/+$/, '');
  const normalizedLeft = normalizeReference(left);
  const normalizedRight = normalizeReference(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isImageResultUrl(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    return /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(parsed.pathname);
  } catch {
    return /\.(png|jpe?g|webp|gif|avif|svg)(?:$|[?#])/i.test(normalized);
  }
}

async function getStartImageUrlForExternalVideo(client, payload = {}) {
  const normalizedStartImage = await normalizeProviderMediaUrl(
    getStartImageReference(payload),
    { mediaKind: 'image' },
  );
  if (/^https?:\/\//i.test(normalizedStartImage)) {
    return normalizedStartImage;
  }

  if (isDockerRuntime()) {
    throw new Error('Samsar external Docker image-to-video requires a provider-readable start image URL.');
  }

  const startImageDataUrl = await readImageReferenceAsDataUrl(normalizedStartImage);
  const response = await client.requestV2ExternalVideo(
    'upload_image_data',
    {
      input: {
        image_data: [startImageDataUrl],
      },
    },
    {
      idempotencyKey: `${payload?._id?.toString?.() || payload?._id || Date.now()}:start-image`,
    },
  );

  const imageUrl = getUploadedImageUrl(response?.data || response);
  if (!imageUrl) {
    throw new Error('Samsar external video start image upload returned no image URL.');
  }
  return imageUrl;
}

function normalizeDuration(duration) {
  const parsed = Number(duration);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
}

function normalizeFirstDuration(values = []) {
  for (const value of values) {
    const duration = normalizeDuration(value);
    if (duration !== undefined) {
      return duration;
    }
  }
  return undefined;
}

function resolveExternalVideoDuration(payload = {}, route = '') {
  if (route === 'lip_sync') {
    return normalizeFirstDuration([
      payload.duration,
      payload.audioDuration,
      payload.audio_duration,
    ]);
  }
  return normalizeDuration(payload.duration);
}

function getExternalVideoModel(payload = {}) {
  return (
    normalizeString(payload.samsarExternalVideoModel) ||
    normalizeString(payload.originalVideoModel) ||
    normalizeString(payload.model)
  );
}

function getPayloadMediaUrl(payload = {}, keys = []) {
  for (const key of keys) {
    const value = normalizeString(payload[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

export function buildExternalStepImageToVideoInput(payload = {}, uploadedStartImageUrl) {
  const videoModel =
    normalizeString(payload.samsarExternalVideoModel) ||
    normalizeString(payload.originalVideoModel) ||
    normalizeString(payload.model);

  return {
    image_url: uploadedStartImageUrl,
    image_urls: [uploadedStartImageUrl],
    start_image_url: uploadedStartImageUrl,
    startImage: uploadedStartImageUrl,
    prompt: normalizeString(payload.prompt),
    video_model: videoModel,
    aspect_ratio: normalizeString(payload.aspectRatio) || '16:9',
    auto_render_full_video: true,
    manual_step_stages: [],
    enable_subtitles: false,
    duration: normalizeDuration(payload.duration),
    metadata: {
      source: 'local_docker_ai_video_generator',
      local_request_id: payload?._id?.toString?.() || payload?._id || null,
      local_session_id: payload?.sessionId || null,
      local_layer_id: payload?.layerId || null,
      original_video_model: normalizeString(payload.originalVideoModel) || null,
    },
  };
}

function normalizeExternalVideoRoute(route) {
  const normalized = normalizeString(route).replace(/^\/+/, '').toLowerCase();
  if (!normalized) return '';
  if (normalized === 'step/text_to_video') return 'text_to_video';
  if (normalized === 'step/image_to_video') return 'step/image_to_video';
  if (normalized === 'image_to_video') return DEFAULT_EXTERNAL_VIDEO_ROUTE;
  if (
    normalized === 'text_to_video' ||
    normalized === 'direct_image_to_video'
  ) {
    return normalized;
  }
  if (normalized === 'lip_sync' || normalized === 'lip_sync_generation') return 'lip_sync';
  if (
    normalized === 'sound_effect' ||
    normalized === 'sound_effect_generation' ||
    normalized === 'text_to_sound_effect'
  ) {
    return 'sound_effect';
  }
  return normalized;
}

function inferExternalVideoToVideoRoute(payload = {}) {
  const stage = normalizeString(payload.samsarExternalProviderStage).toLowerCase();
  const generationType = normalizeString(payload.generationType || payload.layerAiVideoType).toLowerCase();
  const model = getExternalVideoModel(payload).toUpperCase();
  const hasVideoInput = Boolean(getPayloadMediaUrl(payload, ['video_url', 'videoUrl', 'videoLink', 'video']));
  const hasAudioInput = Boolean(getPayloadMediaUrl(payload, ['audio_url', 'audioUrl', 'audioLink', 'audio']));

  if (
    stage === 'lip_sync_generation' ||
    generationType === 'lip_sync' ||
    DOCKER_FAL_LIP_SYNC_MODELS.includes(model) ||
    (hasVideoInput && hasAudioInput)
  ) {
    return 'lip_sync';
  }

  if (
    stage === 'sound_effect_generation' ||
    generationType === 'sound_effect' ||
    (hasVideoInput && !hasAudioInput)
  ) {
    return 'sound_effect';
  }

  return '';
}

export function resolveExternalVideoRoute(payload = {}) {
  const hasStartImage = Boolean(getStartImageReference(payload));
  const inferredVideoToVideoRoute = inferExternalVideoToVideoRoute(payload);
  const configuredRoute = normalizeExternalVideoRoute(payload.samsarExternalVideoRoute);
  if (configuredRoute) {
    if (
      inferredVideoToVideoRoute &&
      ['text_to_video', 'direct_image_to_video', 'step/image_to_video'].includes(configuredRoute)
    ) {
      return inferredVideoToVideoRoute;
    }
    if (hasStartImage && configuredRoute === 'text_to_video') {
      return DEFAULT_EXTERNAL_VIDEO_ROUTE;
    }
    return configuredRoute;
  }

  if (inferredVideoToVideoRoute) {
    return inferredVideoToVideoRoute;
  }
  if (!hasStartImage) {
    return 'text_to_video';
  }
  return DEFAULT_EXTERNAL_VIDEO_ROUTE;
}

function buildExternalTextToVideoInput(payload = {}) {
  return {
    prompt: normalizeString(payload.prompt),
    video_model: getExternalVideoModel(payload),
    aspect_ratio: normalizeString(payload.aspectRatio) || '16:9',
    duration: normalizeDuration(payload.duration),
    metadata: {
      source: 'local_docker_ai_video_generator',
      local_request_id: payload?._id?.toString?.() || payload?._id || null,
      local_session_id: payload?.sessionId || null,
      local_layer_id: payload?.layerId || null,
    },
  };
}

export function buildExternalImageToVideoInput(payload = {}, uploadedStartImageUrl) {
  const clientRequestId = getExternalVideoAttemptId(payload);
  return {
    client_request_id: clientRequestId,
    image_url: uploadedStartImageUrl,
    image_urls: [uploadedStartImageUrl],
    start_image_url: uploadedStartImageUrl,
    startImage: uploadedStartImageUrl,
    prompt: normalizeString(payload.prompt),
    video_model: getExternalVideoModel(payload),
    aspect_ratio: normalizeString(payload.aspectRatio) || '16:9',
    duration: normalizeDuration(payload.duration),
    metadata: {
      source: 'local_docker_ai_video_generator',
      local_request_id: payload?._id?.toString?.() || payload?._id || null,
      local_attempt_id: clientRequestId,
      local_attempt_number: Math.max(0, Number(payload?.numRetries) || 0),
      local_session_id: payload?.sessionId || null,
      local_layer_id: payload?.layerId || null,
      original_video_model: normalizeString(payload.originalVideoModel) || null,
    },
  };
}

export function getExternalVideoAttemptId(payload = {}) {
  const localRequestId = payload?._id?.toString?.() || payload?._id;
  if (!localRequestId) {
    return '';
  }
  const attemptNumber = Math.max(0, Number(payload?.numRetries) || 0);
  return `${localRequestId}:attempt:${attemptNumber}`;
}

function assertProviderReadableUrl(value, label) {
  if (!/^https?:\/\//i.test(value || '')) {
    throw new Error(`Samsar external ${label} requires a provider-readable media URL.`);
  }
}

export async function buildExternalVideoToVideoInput(payload = {}, route) {
  const videoUrl = await normalizeProviderMediaUrl(
    getPayloadMediaUrl(payload, ['video_url', 'videoUrl', 'videoLink', 'video']),
    { mediaKind: 'video' },
  );
  const audioUrl = route === 'lip_sync'
    ? await normalizeProviderMediaUrl(
      getPayloadMediaUrl(payload, ['audio_url', 'audioUrl', 'audioLink', 'audio']),
      { mediaKind: 'audio' },
    )
    : '';
  assertProviderReadableUrl(videoUrl, 'video-to-video');
  if (route === 'lip_sync') {
    assertProviderReadableUrl(audioUrl, 'lip sync');
  }
  const model = getExternalVideoModel(payload);
  const duration = resolveExternalVideoDuration(payload, route);
  return {
    video_url: videoUrl,
    ...(route === 'lip_sync'
      ? { audio_url: audioUrl, lip_sync_model: model, audio_duration: duration }
      : { sound_effect_model: model }),
    prompt: normalizeString(payload.prompt || payload.audioPrompt || payload.audio_prompt),
    aspect_ratio: normalizeString(payload.aspectRatio) || '16:9',
    duration,
    metadata: {
      source: 'local_docker_ai_video_generator',
      local_request_id: payload?._id?.toString?.() || payload?._id || null,
      local_session_id: payload?.sessionId || null,
      local_layer_id: payload?.layerId || null,
    },
  };
}

async function buildExternalVideoRouteRequest(client, payload = {}, route) {
  if (route === 'text_to_video') {
    return {
      route,
      body: {
        input: buildExternalTextToVideoInput(payload),
      },
    };
  }

  if (route === 'lip_sync' || route === 'sound_effect') {
    return {
      route,
      body: {
        input: await buildExternalVideoToVideoInput(payload, route),
      },
    };
  }

  const uploadedStartImageUrl = await getStartImageUrlForExternalVideo(client, payload);
  if (route === 'step/image_to_video') {
    return {
      route,
      uploadedStartImageUrl,
      body: {
        input: buildExternalStepImageToVideoInput(payload, uploadedStartImageUrl),
      },
    };
  }

  return {
    // A provider adapter must never enter the high-level image-list workflow,
    // even when an older queue document carries the legacy route name.
    route: 'direct_image_to_video',
    uploadedStartImageUrl,
    body: {
      input: buildExternalImageToVideoInput(payload, uploadedStartImageUrl),
    },
  };
}

export async function generateSamsarExternalVideoLayer(payload = {}) {
  const client = getExternalClient();
  if (!client) {
    throw new Error('SAMSAR_API_KEY is required for external Samsar video generation.');
  }

  await getDBConnectionString();
  const routeRequest = await buildExternalVideoRouteRequest(
    client,
    payload,
    resolveExternalVideoRoute(payload),
  );
  const route = routeRequest.route;
  console.log('[samsar_external_video][submit] sending external video request', {
    localRequestId: payload?._id?.toString?.() || payload?._id || null,
    sessionId: payload?.sessionId || null,
    layerId: payload?.layerId || null,
    route,
    model: payload?.model || null,
    generationType: payload?.generationType || payload?.layerAiVideoType || null,
    stage: payload?.samsarExternalProviderStage || null,
    retryOnFail: payload?.retryOnFail,
    payloadDuration: payload?.duration,
    payloadAudioDuration: payload?.audioDuration || payload?.audio_duration,
    input: summarizeExternalVideoInput(routeRequest.body?.input || {}),
  });

  const response = await client.requestV2ExternalVideo(
    route,
    routeRequest.body,
    {
      idempotencyKey: getExternalVideoAttemptId(payload) || undefined,
    },
  );

  const requestId = getRequestId(response?.data || response);
  if (!requestId) {
    throw new Error('Samsar external video submit returned no request id.');
  }

  console.log('[samsar_external_video][submit] external video request accepted', {
    localRequestId: payload?._id?.toString?.() || payload?._id || null,
    sessionId: payload?.sessionId || null,
    layerId: payload?.layerId || null,
    route,
    model: payload?.model || null,
    requestId,
  });

  await recordProviderUsageLog({
    payload,
    requestType: route === 'lip_sync'
      ? 'lip_sync'
      : route === 'sound_effect'
        ? 'text_to_sound_effect'
        : route,
    callType: route,
    provider: 'samsar',
    model: payload?.model,
    providerRequestId: requestId,
    source: 'samsar_external_video',
    service: 'samsar_ai_video_layer_generator',
    status: 'requested',
    metadata: {
      route,
      aspectRatio: payload?.aspectRatio,
      duration: resolveExternalVideoDuration(payload, route),
      payloadDuration: payload?.duration,
      payloadAudioDuration: payload?.audioDuration || payload?.audio_duration,
      originalVideoModel: payload?.originalVideoModel,
    },
  });

  await AIVideoLayerGeneration.findOneAndUpdate(
    { _id: payload._id },
    {
      $set: {
        externalProvider: 'samsar',
        samsarExternalProvider: true,
        samsarExternalVideoRequestId: requestId,
      },
    },
  );

  return `${EXTERNAL_REQUEST_PREFIX}${requestId}`;
}

export async function listenToPendingSamsarExternalVideoRequest(payload = {}) {
  const client = getExternalClient();
  if (!client) {
    throw new Error('SAMSAR_API_KEY is required for external Samsar video polling.');
  }

  const requestId =
    getExternalRequestId(payload.generationId) ||
    normalizeString(payload.samsarExternalVideoRequestId);
  if (!requestId) {
    throw new Error('Missing Samsar external video request id.');
  }

  const response = await client.getV2ExternalVideoStatus(requestId);
  const statusData = response?.data || response;
  const responseStatus = normalizeProviderStatus(statusData);
  const stage = normalizeString(payload.samsarExternalProviderStage);
  const remoteUrl = getVideoUrl(statusData, stage);
  const sourceVideoReference = payload.videoLink || payload.videoUrl || payload.video_url;
  const isSourceVideoUrl = remoteUrl && sourceVideoReference
    ? isSameMediaReference(remoteUrl, sourceVideoReference)
    : false;

  if (responseStatus === 'COMPLETED') {
    if (!remoteUrl || isSourceVideoUrl) {
      return { responseStatus: 'PENDING' };
    }
    return {
      responseStatus: 'COMPLETED',
      remoteUrl,
    };
  }

  if (responseStatus === 'FAILED') {
    let detailedStatusSummary = null;
    try {
      const detailedResponse = await client.getV2ExternalVideoStatusDetailed(requestId);
      detailedStatusSummary = summarizeExternalStatus(detailedResponse?.data || detailedResponse);
    } catch (error) {
      detailedStatusSummary = {
        error: error?.message || String(error),
        status: error?.status || error?.response?.status || null,
        body: error?.body || error?.response?.data || null,
      };
    }
    console.error('[samsar_external_video][poll_failed] external video request failed', {
      localRequestId: payload?._id?.toString?.() || payload?._id || null,
      sessionId: payload?.sessionId || null,
      layerId: payload?.layerId || null,
      requestId,
      model: payload?.model || null,
      generationType: payload?.generationType || payload?.layerAiVideoType || null,
      stage,
      videoLink: summarizeMediaUrl(payload.videoLink || payload.videoUrl || payload.video_url),
      audioLink: summarizeMediaUrl(payload.audioLink || payload.audioUrl || payload.audio_url),
      status: summarizeExternalStatus(statusData),
      detailedStatus: detailedStatusSummary,
    });
    return {
      responseStatus: 'FAILED',
      providerFailureMessage: getExternalStatusFailureMessage(detailedStatusSummary || statusData),
      providerStatus: detailedStatusSummary || summarizeExternalStatus(statusData),
    };
  }

  if (remoteUrl && !isSourceVideoUrl) {
    return {
      responseStatus: 'COMPLETED',
      remoteUrl,
    };
  }

  return { responseStatus: 'PENDING' };
}
