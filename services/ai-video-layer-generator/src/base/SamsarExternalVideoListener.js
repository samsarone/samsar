import fs from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import axios from 'axios';
import SamsarClient from 'samsar-js';

import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { getDBConnectionString } from '../DBString.js';
import { getCurrentEnvironment } from '../utils/Environment.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import {
  DOCKER_VIDEO_PROVIDER,
  resolveDockerVideoProvider,
} from '../consts/DockerProviderPriority.js';
import { normalizeProviderMediaUrl } from '../AWS.js';

const EXTERNAL_REQUEST_PREFIX = 'samsar-external-video:';
const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_EXTERNAL_VIDEO_ROUTE = 'image_to_video';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  return getCurrentEnvironment() === 'docker';
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
  const normalizedStartImage = await normalizeProviderMediaUrl(getStartImageReference(payload));
  if (/^https?:\/\//i.test(normalizedStartImage)) {
    return normalizedStartImage;
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
  if (normalized === 'text_to_video' || normalized === 'image_to_video') return normalized;
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

export function resolveExternalVideoRoute(payload = {}) {
  const configuredRoute = normalizeExternalVideoRoute(payload.samsarExternalVideoRoute);
  if (configuredRoute) {
    return configuredRoute;
  }

  const stage = normalizeString(payload.samsarExternalProviderStage).toLowerCase();
  const generationType = normalizeString(payload.generationType || payload.layerAiVideoType).toLowerCase();
  if (stage === 'lip_sync_generation' || generationType === 'lip_sync') {
    return 'lip_sync';
  }
  if (stage === 'sound_effect_generation' || generationType === 'sound_effect') {
    return 'sound_effect';
  }
  if (!getStartImageReference(payload)) {
    return 'text_to_video';
  }
  return DEFAULT_EXTERNAL_VIDEO_ROUTE;
}

function getExternalVideoModel(payload = {}) {
  return (
    normalizeString(payload.samsarExternalVideoModel) ||
    normalizeString(payload.originalVideoModel) ||
    normalizeString(payload.model)
  );
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
  return {
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
      local_session_id: payload?.sessionId || null,
      local_layer_id: payload?.layerId || null,
      original_video_model: normalizeString(payload.originalVideoModel) || null,
    },
  };
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

function buildExternalVideoToVideoInput(payload = {}, route) {
  const videoUrl = getPayloadMediaUrl(payload, ['video_url', 'videoUrl', 'videoLink', 'video']);
  const audioUrl = getPayloadMediaUrl(payload, ['audio_url', 'audioUrl', 'audioLink', 'audio']);
  const model = getExternalVideoModel(payload);
  return {
    video_url: videoUrl,
    ...(route === 'lip_sync' ? { audio_url: audioUrl, lip_sync_model: model } : { sound_effect_model: model }),
    prompt: normalizeString(payload.prompt || payload.audioPrompt || payload.audio_prompt),
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
        input: buildExternalVideoToVideoInput(payload, route),
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
    route: 'image_to_video',
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
  const response = await client.requestV2ExternalVideo(
    route,
    routeRequest.body,
    {
      idempotencyKey: payload?._id?.toString?.() || undefined,
    },
  );

  const requestId = getRequestId(response?.data || response);
  if (!requestId) {
    throw new Error('Samsar external video submit returned no request id.');
  }

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
      duration: payload?.duration,
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
        ...(routeRequest.uploadedStartImageUrl
          ? { samsarExternalUploadedStartImage: routeRequest.uploadedStartImageUrl }
          : {}),
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
    return { responseStatus: 'FAILED' };
  }

  if (remoteUrl && !isSourceVideoUrl) {
    return {
      responseStatus: 'COMPLETED',
      remoteUrl,
    };
  }

  return { responseStatus: 'PENDING' };
}
