import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import { getGPTImageTwoOutput, normalizeGPTImageTwoResult } from './GPTImageTwoPayload.js';

const GENBLAZE_REQUEST_PREFIX = 'genblaze-image:';
const DEFAULT_GENBLAZE_BASE_URL = 'http://genblaze:8080/v1';
const DEFAULT_GENBLAZE_MEDIA_TIMEOUT_MS = 120_000;

export const GENBLAZE_IMAGE_MODELS = new Set([
  'GPTIMAGE2',
  'SEEDREAM',
  'NANOBANANA2',
  'NANOBANANAPRO',
]);
const GMI_NANO_PRO_ASPECT_RATIOS = new Set([
  '1:1',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function normalizeBaseUrl(value) {
  return (normalizeString(value) || DEFAULT_GENBLAZE_BASE_URL).replace(/\/+$/, '');
}

function normalizeModel(value) {
  return normalizeString(value).toUpperCase();
}

function getRequestId(value) {
  const requestId = normalizeString(value);
  return requestId.startsWith(GENBLAZE_REQUEST_PREFIX)
    ? requestId.slice(GENBLAZE_REQUEST_PREFIX.length)
    : '';
}

export function isGenBlazeImageRequestId(value) {
  return Boolean(getRequestId(value));
}

function normalizeGmiAspectRatio(value) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[xX]/g, ':');
  const aliases = {
    square: '1:1',
    square_hd: '1:1',
    landscape_16_9: '16:9',
    portrait_16_9: '9:16',
    landscape_4_3: '4:3',
    portrait_4_3: '3:4',
  };
  return aliases[normalized] || normalized || '1:1';
}

export function isGenBlazeImageRequestApplicable(payload = {}) {
  if (isGenBlazeImageRequestId(payload.apiRequestId)) return true;
  if (normalizeModel(payload.model) !== 'NANOBANANAPRO') return true;
  const aspectRatio = normalizeGmiAspectRatio(
    payload.aspectRatio || payload.aspect_ratio,
  );
  return GMI_NANO_PRO_ASPECT_RATIOS.has(aspectRatio);
}

export function buildGenBlazeImageRequest(payload = {}) {
  const model = normalizeModel(payload.model);
  if (!GENBLAZE_IMAGE_MODELS.has(model)) {
    const error = new Error(`Model ${model || '<missing>'} is not supported by the GenBlaze image adapter.`);
    error.code = 'GENBLAZE_MODEL_UNSUPPORTED';
    throw error;
  }

  const aspectRatio = normalizeString(payload.aspectRatio || payload.aspect_ratio) || '1:1';
  const requestedResolution = normalizeString(payload.resolution || payload.imageResolution);
  const params = {
    aspect_ratio: aspectRatio,
    number_of_images: 1,
  };

  if (model === 'GPTIMAGE2') {
    const output = getGPTImageTwoOutput(aspectRatio);
    Object.assign(params, {
      aspect_ratio: output.aspectRatio,
      size: output.openAIImageSize,
      quality: 'high',
      output_format: 'png',
    });
  } else {
    params.output_format = 'png';
    if (requestedResolution) params.resolution = requestedResolution;
  }

  return {
    model,
    modality: 'image',
    prompt: normalizeString(payload.prompt),
    input_urls: [],
    params,
  };
}

async function readJson(response) {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('GenBlaze returned an invalid JSON response.');
  }
}

function getErrorMessage(body, fallback) {
  return normalizeString(body?.error?.message) ||
    normalizeString(body?.message) ||
    normalizeString(body?.error) ||
    fallback;
}

export async function requestGenBlaze(pathname, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('This runtime cannot call GenBlaze because fetch is unavailable.');
  }
  if (!isTruthyEnv(env.SAMSAR_GENBLAZE_ENABLED)) {
    throw new Error('SAMSAR_GENBLAZE_ENABLED is required for GMICloud image generation.');
  }

  const timeoutMs = Math.max(
    1_000,
    Number(env.SAMSAR_GENBLAZE_MEDIA_TIMEOUT_MS) || DEFAULT_GENBLAZE_MEDIA_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${normalizeBaseUrl(env.SAMSAR_GENBLAZE_BASE_URL)}${pathname}`,
      {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      },
    );
    const responseBody = await readJson(response);
    if (!response.ok) {
      const error = new Error(getErrorMessage(
        responseBody,
        `GenBlaze image request failed with status ${response.status}.`,
      ));
      error.status = response.status;
      error.code = responseBody?.error?.code;
      throw error;
    }
    return responseBody;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('GenBlaze image request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function unlock(imageGenerationModel, _id, update = {}) {
  await imageGenerationModel.findOneAndUpdate(
    { _id },
    { ...update, rowLocked: false },
  );
}

export async function submitGenBlazeImageRequest(payload = {}, dependencies = {}) {
  const connect = dependencies.connect || getDBConnectionString;
  const imageGenerationModel = dependencies.imageGenerationModel || ImageGeneration;
  const request = dependencies.request || requestGenBlaze;
  const logger = dependencies.logger || console;
  const { _id } = payload;

  await connect();
  await imageGenerationModel.findByIdAndUpdate(_id, { rowLocked: true });
  try {
    const response = await request('/media/requests', {
      method: 'POST',
      body: buildGenBlazeImageRequest(payload),
    });
    const requestId = normalizeString(response?.request_id);
    if (!requestId) {
      throw new Error('GenBlaze image submit returned no request id.');
    }
    await unlock(imageGenerationModel, _id, {
      apiRequestId: `${GENBLAZE_REQUEST_PREFIX}${requestId}`,
      apiGenerationStatus: 'PENDING',
      apiSubmittedAt: new Date(),
      externalProvider: 'gmicloud',
    });
    return null;
  } catch (error) {
    logger.error('[GenBlazeImage] submit failed:', error);
    return {
      image: null,
      error: `GMICloud image submission failed: ${error?.message || 'Unknown provider error'}`,
    };
  }
}

export async function pollGenBlazeImageRequest(payload = {}, dependencies = {}) {
  const connect = dependencies.connect || getDBConnectionString;
  const imageGenerationModel = dependencies.imageGenerationModel || ImageGeneration;
  const request = dependencies.request || requestGenBlaze;
  const saveFile = dependencies.saveFile || saveRemoteFile;
  const logger = dependencies.logger || console;
  const { _id } = payload;
  const requestId = getRequestId(payload.apiRequestId);

  await connect();
  await imageGenerationModel.findByIdAndUpdate(_id, { rowLocked: true });
  if (!requestId) {
    return { image: null, error: 'GMICloud image request is missing its GenBlaze request id.' };
  }

  try {
    const response = await request(`/media/requests/${encodeURIComponent(requestId)}`);
    const status = normalizeString(response?.status).toLowerCase();
    if (status === 'pending' || status === 'queued' || status === 'running') {
      await unlock(imageGenerationModel, _id);
      return null;
    }
    if (status !== 'succeeded') {
      const message = getErrorMessage(
        response,
        `GMICloud image request ${status || 'failed'}.`,
      );
      return { image: null, error: message };
    }

    const imageUrl = normalizeString(response?.assets?.[0]?.url);
    if (!imageUrl) {
      throw new Error('GMICloud image result returned no image URL.');
    }
    const image = await saveFile(imageUrl);
    // Keep the request locked while the caller scores and persists the
    // completed image. The caller owns the final delete or retry unlock.

    if (normalizeModel(payload.model) === 'GPTIMAGE2') {
      const output = getGPTImageTwoOutput(
        payload.aspectRatio || payload.aspect_ratio,
      );
      return normalizeGPTImageTwoResult({
        image,
        width: output.width,
        height: output.height,
      });
    }
    return { image, resultUrl: imageUrl, resultUrls: [imageUrl] };
  } catch (error) {
    logger.error('[GenBlazeImage] poll failed:', error);
    return {
      image: null,
      error: `GMICloud image result failed: ${error?.message || 'Unknown provider error'}`,
    };
  }
}

export function shouldUseGenBlazeImageProvider(payload = {}) {
  if (!isTruthyEnv(process.env.SAMSAR_GENBLAZE_ENABLED)) return false;
  if (!GENBLAZE_IMAGE_MODELS.has(normalizeModel(payload.model))) return false;
  if (isGenBlazeImageRequestId(payload.apiRequestId)) return true;
  const selectedProvider = normalizeString(
    payload.adapterProviderOverride || payload.adapterProvider || payload.externalProvider,
  ).toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['gmi', 'gmicloud', 'genblaze'].includes(selectedProvider);
}

export async function handleGenBlazeImageRequest(payload = {}, dependencies = {}) {
  const status = normalizeString(payload.apiGenerationStatus || 'INIT').toUpperCase();
  if (status === 'INIT') return submitGenBlazeImageRequest(payload, dependencies);
  if (status === 'PENDING') return pollGenBlazeImageRequest(payload, dependencies);
  if (status === 'FAILED') return { image: null };
  return null;
}
