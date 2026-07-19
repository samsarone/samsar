import SamsarClient from 'samsar-js';

import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import { getCurrentEnvironment } from '../utils/Environment.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import {
  getAccessibleMediaUrlForProvider,
  getAccessibleMediaUrlsForProvider,
} from '../utils/MediaReferenceUtils.js';
import {
  DOCKER_ADAPTER_PROVIDER,
  resolveDockerImageEditProvider,
  resolveDockerImageGenerationProvider,
} from '../consts/DockerProviderPriority.js';

const EXTERNAL_REQUEST_PREFIX = 'samsar-external-image:';
const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const EXTERNAL_TEXT_TO_IMAGE_PATH = process.env.SAMSAR_EXTERNAL_TEXT_TO_IMAGE_PATH || 'text_to_image';
const EXTERNAL_IMAGE_EDIT_PATH = process.env.SAMSAR_EXTERNAL_IMAGE_EDIT_PATH || '';
const EXTERNAL_IMAGE_MODELS = new Set([
  'DALLE3',
  'FLUX1PRO',
  'FLUX1DEV',
  'FLUX1.1PRO',
  'FLUX1.1ULTRA',
  'RECRAFTV3',
  'RECRAFT20B',
  'SDV3.5',
  'SANA',
  'SANA4.5B',
  'SANASPRINT',
  'PHOTON',
  'PHOTONFLASH',
  'IMAGEN3',
  'IMAGEN3FLASH',
  'IMAGEN4',
  'GEMMA3',
  'LUMINAV2',
  'REVE',
  'IDEOGRAMV3',
  'HIDREAMI1',
  'GPTIMAGE2',
  'GPTIMAGE1',
  'FLITE',
  'SEEDREAM',
  'NANOBANANA2',
  'NANOBANANAPRO',
  'WAN2.7PRO',
  'HUNYUAN',
]);
const EXTERNAL_IMAGE_EDIT_MODELS = new Set([
  'NANOBANANA2EDIT',
  'NANOBANANAPROEDIT',
  'NANOBANANAEDIT',
  'GPTIMAGE2EDIT',
  'GPTIMAGE1EDIT',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  const normalized = normalizeString(value || DEFAULT_SAMSAR_API_BASE_URL).replace(/\/+$/, '');
  return normalized || DEFAULT_SAMSAR_API_BASE_URL;
}

function isTruthyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isFalseyEnv(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'no';
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

function getExternalRequestId(apiRequestId) {
  const normalized = normalizeString(apiRequestId);
  if (!normalized.startsWith(EXTERNAL_REQUEST_PREFIX)) {
    return '';
  }
  return normalized.slice(EXTERNAL_REQUEST_PREFIX.length);
}

export function isSamsarExternalImageRequestId(apiRequestId) {
  return Boolean(getExternalRequestId(apiRequestId));
}

function getResultUrl(statusData) {
  const candidates = [
    statusData?.result_url,
    statusData?.resultUrl,
    statusData?.image_url,
    statusData?.imageUrl,
    statusData?.url,
    statusData?.data?.result_url,
    statusData?.data?.resultUrl,
    statusData?.data?.image_url,
    statusData?.data?.imageUrl,
    statusData?.data?.url,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
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

  return normalizeString(resultUrls[0]);
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

async function failExternalRequest(_id, message) {
  await ImageGeneration.findOneAndUpdate(
    { _id },
    {
      generationStatus: 'FAILED',
      apiGenerationStatus: 'FAILED',
      generationError: message || 'Samsar external image generation failed.',
      rowLocked: false,
    }
  );
}

async function failExternalEditRequest(_id, message) {
  await ImageGeneration.findOneAndUpdate(
    { _id },
    {
      editStatus: 'FAILED',
      apiEditStatus: 'FAILED',
      generationStatus: 'FAILED',
      apiGenerationStatus: 'FAILED',
      editError: message || 'Samsar external image edit failed.',
      rowLocked: false,
    }
  );
}

function normalizeCaseType(caseType) {
  const normalized = normalizeString(caseType).toLowerCase();
  return normalized || 'image_edit';
}

function resolveExternalImageEditRoute(payload = {}) {
  const caseType = normalizeCaseType(payload.case_type);
  if (caseType === 'logo_remove' || caseType === 'remove_branding') {
    return 'remove_branding';
  }
  if (
    caseType === 'image_enhance' ||
    caseType === 'enhance_image' ||
    caseType === 'upscale' ||
    caseType === 'upscale_image'
  ) {
    return 'enhance';
  }
  if (caseType === 'image_list_to_image_set' || caseType === 'add_image_set') {
    return 'add_image_set';
  }
  return EXTERNAL_IMAGE_EDIT_PATH;
}

async function getExternalImageUrlsForEdit(payload = {}) {
  const urls = [];
  const seen = new Set();
  const pushIfValid = (value) => {
    const normalized = normalizeString(
      typeof value === 'string'
        ? value
        : value?.url || value?.image_url || value?.imageUrl
    );
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    urls.push(normalized);
  };

  ['image_urls', 'imageUrls', 'input_image_urls', 'inputImageUrls'].forEach((key) => {
    if (Array.isArray(payload[key])) {
      payload[key].forEach(pushIfValid);
    }
  });

  ['image', 'image_url', 'imageUrl', 'imageRef', 'inputImage'].forEach((key) => {
    if (payload[key]) {
      pushIfValid(payload[key]);
    }
  });

  return getAccessibleMediaUrlsForProvider(urls, { mediaKind: 'image' });
}

const EXTERNAL_MEDIA_ALIAS_TOKENS = new Set([
  'image', 'imageurl', 'imageurls', 'imageref', 'images',
  'inputimage', 'inputimages', 'inputimageurl', 'inputimageurls',
  'sourceimage', 'sourceimageurl', 'referenceimage', 'referenceimageurl',
  'mask', 'maskimage', 'maskimageurl', 'maskurl',
  'video', 'videourl', 'videourls', 'videolink',
  'audio', 'audiourl', 'audiourls', 'audiolink',
]);

function normalizeAliasToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripExternalMediaAliases(value) {
  if (Array.isArray(value)) return value.map(stripExternalMediaAliases);
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (EXTERNAL_MEDIA_ALIAS_TOKENS.has(normalizeAliasToken(key))) continue;
    // Metadata is opaque audit context, not provider media input.
    sanitized[key] = key === 'metadata' ? child : stripExternalMediaAliases(child);
  }
  return sanitized;
}

export async function buildExternalImageEditPayload(payload = {}, route, dependencies = {}) {
  const resolveMediaUrls = dependencies.resolveMediaUrls || getExternalImageUrlsForEdit;
  const resolveMediaUrl = dependencies.resolveMediaUrl || ((value) =>
    getAccessibleMediaUrlForProvider(value, { mediaKind: 'image' }));
  const imageUrls = await resolveMediaUrls(payload);
  const aspectRatio = normalizeString(payload.aspectRatio || payload.aspect_ratio) || '16:9';
  const maskReference = normalizeString(
    payload.maskImage || payload.mask_image || payload.maskUrl || payload.mask_url || payload.mask,
  );
  const maskUrl = maskReference ? await resolveMediaUrl(maskReference) : '';

  if (route === 'remove_branding') {
    return {
      image_url: imageUrls[0],
      metadata: payload.metadata || {},
    };
  }

  if (route === 'enhance') {
    return {
      image_url: imageUrls[0],
      resolution: normalizeString(payload.resolution) || '1K',
      aspect_ratio: aspectRatio,
      metadata: payload.metadata || {},
    };
  }

  if (route === 'add_image_set') {
    const requestedImages = Number(payload.num_images ?? payload.numImages ?? imageUrls.length);
    return {
      image_urls: imageUrls,
      prompt: normalizeString(payload.prompt),
      num_images: Number.isFinite(requestedImages) && requestedImages > 0
        ? Math.floor(requestedImages)
        : Math.max(1, imageUrls.length),
      aspect_ratio: aspectRatio || '1:1',
      metadata: payload.metadata || {},
    };
  }

  return {
    input: {
      ...stripExternalMediaAliases(payload),
      image_urls: imageUrls,
      image_url: imageUrls[0],
      ...(maskUrl ? { mask_url: maskUrl } : {}),
      aspect_ratio: aspectRatio,
      model: payload.model,
      metadata: payload.metadata || {},
    },
  };
}

export function shouldUseSamsarExternalImageProvider(payload = {}) {
  if (!shouldEnableExternalProviders()) {
    return false;
  }
  if (!getExternalClient()) {
    return false;
  }
  const model = normalizeString(payload?.model);
  if (!EXTERNAL_IMAGE_MODELS.has(model)) {
    return false;
  }
  const status = normalizeString(payload?.apiGenerationStatus || 'INIT').toUpperCase();
  if (status === 'PENDING') {
    return isSamsarExternalImageRequestId(payload?.apiRequestId);
  }
  if (payload?.requestType === 'API' && normalizeString(payload?.externalProvider) === 'samsar') {
    return false;
  }
  if (status !== 'INIT') {
    return false;
  }
  return resolveDockerImageGenerationProvider(model) === DOCKER_ADAPTER_PROVIDER.SAMSAR;
}

export function shouldUseSamsarExternalImageEditProvider(payload = {}) {
  if (!shouldEnableExternalProviders()) {
    return false;
  }
  if (!getExternalClient()) {
    return false;
  }
  const model = normalizeString(payload?.model);
  if (!EXTERNAL_IMAGE_EDIT_MODELS.has(model)) {
    return false;
  }
  if (!resolveExternalImageEditRoute(payload)) {
    return false;
  }
  const status = normalizeString(payload?.apiEditStatus || 'INIT').toUpperCase();
  if (status === 'PENDING') {
    return isSamsarExternalImageRequestId(payload?.apiRequestId);
  }
  if (payload?.requestType === 'API' && normalizeString(payload?.externalProvider) === 'samsar') {
    return false;
  }
  if (status !== 'INIT') {
    return false;
  }
  return resolveDockerImageEditProvider(model) === DOCKER_ADAPTER_PROVIDER.SAMSAR;
}

export async function handleSamsarExternalTextToImageRequest(payload = {}) {
  const { apiGenerationStatus } = payload;
  const status = normalizeString(apiGenerationStatus || 'INIT').toUpperCase();

  if (status === 'INIT') {
    return submitSamsarExternalTextToImageRequest(payload);
  }
  if (status === 'PENDING') {
    return pollSamsarExternalTextToImageRequest(payload);
  }
  if (status === 'FAILED') {
    return { image: null };
  }
  return null;
}

export async function handleSamsarExternalImageEditRequest(payload = {}) {
  const status = normalizeString(payload?.apiEditStatus || 'INIT').toUpperCase();
  if (status === 'INIT') {
    return submitSamsarExternalImageEditRequest(payload);
  }
  if (status === 'PENDING') {
    return pollSamsarExternalImageEditRequest(payload);
  }
  if (status === 'FAILED') {
    return { image: null };
  }
  return null;
}

async function submitSamsarExternalTextToImageRequest(payload = {}) {
  const { _id, model, prompt, aspectRatio, numImages } = payload;
  const client = getExternalClient();
  if (!client) {
    throw new Error('SAMSAR_API_KEY is required for external Samsar image generation.');
  }

  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const response = await client.requestV2ExternalImage(
      EXTERNAL_TEXT_TO_IMAGE_PATH,
      {
        input: {
          prompt,
          model,
          aspect_ratio: aspectRatio || '1:1',
          ...(normalizeString(model).toUpperCase() === 'WAN2.7PRO' ? { resolution: '1K' } : {}),
          num_images: Number.isFinite(Number(numImages)) ? Number(numImages) : 1,
          metadata: {
            local_request_id: _id?.toString?.() || _id,
            source: 'local_docker_generator',
          },
        },
      },
      {
        idempotencyKey: _id?.toString?.() || undefined,
      }
    );

    const requestId =
      response?.data?.request_id ||
      response?.data?.requestId ||
      response?.data?.session_id ||
      response?.data?.sessionId;

    if (!requestId) {
      throw new Error('Samsar external image submit returned no request id.');
    }

    await recordProviderUsageLog({
      payload,
      requestType: 'text_to_image',
      callType: 'text_to_image',
      provider: 'samsar',
      model,
      providerRequestId: requestId,
      source: 'samsar_external_image',
      service: 'samsar_generator',
      status: 'requested',
      metadata: {
        aspectRatio,
        numImages,
        route: EXTERNAL_TEXT_TO_IMAGE_PATH,
      },
    });

    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: `${EXTERNAL_REQUEST_PREFIX}${requestId}`,
        apiGenerationStatus: 'PENDING',
        externalProvider: 'samsar',
        apiSubmittedAt: new Date(),
        rowLocked: false,
      }
    );
  } catch (error) {
    const message = error?.message || 'Error submitting request to Samsar external image API.';
    console.error('Error submitting request to Samsar external image API: ', error);
    await failExternalRequest(_id, message);
    return { image: null, error: message };
  }
}

async function submitSamsarExternalImageEditRequest(payload = {}) {
  const { _id, model } = payload;
  const client = getExternalClient();
  if (!client) {
    throw new Error('SAMSAR_API_KEY is required for external Samsar image edit.');
  }

  const route = resolveExternalImageEditRoute(payload);
  if (!route) {
    return {
      image: null,
      error: `Samsar external image edit route is not configured for case_type ${normalizeCaseType(payload.case_type)}.`,
    };
  }

  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const requestPayload = await buildExternalImageEditPayload(payload, route);
    const response = await client.requestV2ExternalImage(route, requestPayload, {
      idempotencyKey: _id?.toString?.() || undefined,
    });

    const requestId =
      response?.data?.request_id ||
      response?.data?.requestId ||
      response?.data?.session_id ||
      response?.data?.sessionId;

    if (!requestId) {
      throw new Error('Samsar external image edit submit returned no request id.');
    }

    await recordProviderUsageLog({
      payload,
      requestType: 'image_edit',
      callType: normalizeCaseType(payload.case_type),
      provider: 'samsar',
      model,
      providerRequestId: requestId,
      source: 'samsar_external_image_edit',
      service: 'samsar_generator',
      status: 'requested',
      metadata: {
        route,
        caseType: normalizeCaseType(payload.case_type),
      },
    });

    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: `${EXTERNAL_REQUEST_PREFIX}${requestId}`,
        apiEditStatus: 'PENDING',
        editStatus: 'PENDING',
        externalProvider: 'samsar',
        apiSubmittedAt: new Date(),
        rowLocked: false,
      }
    );
    return null;
  } catch (error) {
    const message = error?.message || 'Error submitting request to Samsar external image edit API.';
    console.error('Error submitting request to Samsar external image edit API: ', error);
    await failExternalEditRequest(_id, message);
    return { image: null, error: message };
  }
}

async function pollSamsarExternalTextToImageRequest(payload = {}) {
  const { _id, apiRequestId } = payload;
  const client = getExternalClient();
  if (!client) {
    throw new Error('SAMSAR_API_KEY is required for external Samsar image status polling.');
  }

  const externalRequestId = getExternalRequestId(apiRequestId);
  if (!externalRequestId) {
    await getDBConnectionString();
    await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
    return { image: null, error: 'Samsar external image request is missing its external request id.' };
  }

  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: true });

  try {
    const statusResponse = await client.getV2ExternalImageStatus(externalRequestId);
    const statusData = statusResponse?.data || {};
    const status = normalizeProviderStatus(statusData);

    if (status === 'FAILED') {
      const message = normalizeString(statusData?.message || statusData?.error) || 'Samsar external image generation failed.';
      await failExternalRequest(_id, message);
      return { image: null, error: message };
    }

    if (status !== 'COMPLETED') {
      await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
      return null;
    }

    const resultUrl = getResultUrl(statusData);
    if (!resultUrl) {
      await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
      return null;
    }

    const imageName = await saveRemoteFile(resultUrl);
    await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
    return {
      image: imageName,
      resultUrl,
      resultUrls: [resultUrl],
    };
  } catch (error) {
    const message = error?.message || 'Error polling Samsar external image API.';
    console.error('Error polling Samsar external image API: ', error);
    await failExternalRequest(_id, message);
    return { image: null, error: message };
  }
}

async function pollSamsarExternalImageEditRequest(payload = {}) {
  const { _id, apiRequestId } = payload;
  const client = getExternalClient();
  if (!client) {
    throw new Error('SAMSAR_API_KEY is required for external Samsar image edit status polling.');
  }

  const externalRequestId = getExternalRequestId(apiRequestId);
  if (!externalRequestId) {
    await getDBConnectionString();
    await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
    return { image: null, error: 'Samsar external image edit request is missing its external request id.' };
  }

  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: true });

  try {
    const statusResponse = await client.getV2ExternalImageStatus(externalRequestId);
    const statusData = statusResponse?.data || {};
    const status = normalizeProviderStatus(statusData);

    if (status === 'FAILED') {
      const message = normalizeString(statusData?.message || statusData?.error) || 'Samsar external image edit failed.';
      await failExternalEditRequest(_id, message);
      return { image: null, error: message };
    }

    if (status !== 'COMPLETED') {
      await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
      return null;
    }

    const resultUrl = getResultUrl(statusData);
    if (!resultUrl) {
      await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
      return null;
    }

    const imageName = await saveRemoteFile(resultUrl);
    await ImageGeneration.findOneAndUpdate({ _id }, { rowLocked: false });
    return {
      image: imageName,
      resultUrl,
      resultUrls: [resultUrl],
    };
  } catch (error) {
    const message = error?.message || 'Error polling Samsar external image edit API.';
    console.error('Error polling Samsar external image edit API: ', error);
    await failExternalEditRequest(_id, message);
    return { image: null, error: message };
  }
}
