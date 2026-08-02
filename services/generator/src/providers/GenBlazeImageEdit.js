import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { isStandaloneEdition } from '../utils/Environment.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import {
  getAccessibleMediaUrlForProvider,
  getAccessibleMediaUrlsForProvider,
} from '../utils/MediaReferenceUtils.js';
import { getGPTImageTwoOutput } from './GPTImageTwoPayload.js';
import { requestGenBlaze } from './GenBlazeImage.js';

const GENBLAZE_EDIT_REQUEST_PREFIX = 'genblaze-image-edit:';

export const GENBLAZE_IMAGE_EDIT_MODELS = new Set([
  'GPTIMAGE2EDIT',
  'NANOBANANA2EDIT',
  'NANOBANANAPROEDIT',
  'BRIA_ERASER',
  'BRIA_GENFILL',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModel(value) {
  return normalizeString(value).toUpperCase();
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

function normalizeProvider(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getRequestId(value) {
  const requestId = normalizeString(value);
  return requestId.startsWith(GENBLAZE_EDIT_REQUEST_PREFIX)
    ? requestId.slice(GENBLAZE_EDIT_REQUEST_PREFIX.length)
    : '';
}

function normalizeCaseType(value) {
  return normalizeString(value).toLowerCase() || 'image_edit';
}

function buildNanoEditPrompt(payload = {}) {
  const prompt = normalizeString(payload.prompt);
  const caseType = normalizeCaseType(payload.case_type);
  if (caseType === 'logo_remove') {
    return prompt || 'Remove all visible text and logos while preserving the original scene, lighting, colors, and composition.';
  }
  if (['image_enhance', 'enhance_image', 'upscale', 'upscale_image'].includes(caseType)) {
    return prompt || 'Upscale and enhance this image while preserving its subject identity, composition, colors, and natural details.';
  }
  return prompt || 'Edit the provided image according to the request while preserving the important subject identity and composition.';
}

function collectImageReferences(payload = {}) {
  const references = [];
  const seen = new Set();
  const push = (value) => {
    const reference = normalizeString(
      typeof value === 'string'
        ? value
        : value?.url || value?.image_url || value?.imageUrl,
    );
    if (!reference || seen.has(reference)) return;
    seen.add(reference);
    references.push(reference);
  };

  for (const key of ['image_urls', 'imageUrls', 'input_image_urls', 'inputImageUrls']) {
    if (Array.isArray(payload[key])) payload[key].forEach(push);
  }
  for (const key of ['image', 'image_url', 'imageUrl', 'imageRef', 'inputImage']) {
    push(payload[key]);
  }
  return references;
}

function getMaskReference(payload = {}) {
  return normalizeString(
    payload.maskImage || payload.mask_image || payload.maskUrl || payload.mask_url || payload.mask,
  );
}

function optionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isGenBlazeImageEditRequestId(value) {
  return Boolean(getRequestId(value));
}

export async function buildGenBlazeImageEditRequest(payload = {}, dependencies = {}) {
  const model = normalizeModel(payload.model);
  if (!GENBLAZE_IMAGE_EDIT_MODELS.has(model)) {
    const error = new Error(`Model ${model || '<missing>'} is not supported by the GenBlaze image edit adapter.`);
    error.code = 'GENBLAZE_MODEL_UNSUPPORTED';
    throw error;
  }
  if (normalizeCaseType(payload.case_type) === 'image_list_to_image_set') {
    const error = new Error('GMICloud image editing does not preserve Samsar multi-output image-set requests.');
    error.code = 'GENBLAZE_EDIT_OUTPUT_COUNT_UNSUPPORTED';
    throw error;
  }

  const resolveMediaUrls = dependencies.resolveMediaUrls || ((values) =>
    getAccessibleMediaUrlsForProvider(values, { mediaKind: 'image' }));
  const resolveMediaUrl = dependencies.resolveMediaUrl || ((value) =>
    getAccessibleMediaUrlForProvider(value, { mediaKind: 'image' }));
  const references = collectImageReferences(payload);
  if (!references.length) {
    throw new Error('GMICloud image editing requires a source image.');
  }

  const maxReferences = model.startsWith('NANOBANANA') ? 14 : 1;
  const inputUrls = await resolveMediaUrls(references.slice(0, maxReferences));
  if (!Array.isArray(inputUrls) || !inputUrls.length) {
    throw new Error('GMICloud image editing could not publish the source image.');
  }

  const maskReference = getMaskReference(payload);
  if (maskReference && (model === 'GPTIMAGE2EDIT' || model.startsWith('BRIA_'))) {
    inputUrls.push(await resolveMediaUrl(maskReference));
  } else if (model === 'BRIA_ERASER' || model === 'BRIA_GENFILL') {
    throw new Error(`${model} requires a mask image.`);
  }

  const aspectRatio = normalizeString(payload.aspectRatio || payload.aspect_ratio) || '1:1';
  let prompt = normalizeString(payload.prompt);
  let params = {};

  if (model === 'GPTIMAGE2EDIT') {
    const output = getGPTImageTwoOutput(aspectRatio);
    params = {
      size: output.openAIImageSize,
      quality: normalizeString(payload.quality) || 'high',
      number_of_images: 1,
    };
  } else if (model.startsWith('NANOBANANA')) {
    prompt = buildNanoEditPrompt(payload);
    params = {
      aspect_ratio: aspectRatio,
      resolution: normalizeString(payload.resolution || payload.image_size || payload.imageSize) || '1K',
      output_format: normalizeString(payload.output_format || payload.outputFormat) || 'png',
    };
  } else if (model === 'BRIA_GENFILL') {
    params = {
      ...(normalizeString(payload.negative_prompt || payload.negativePrompt)
        ? { negative_prompt: normalizeString(payload.negative_prompt || payload.negativePrompt) }
        : {}),
      ...(optionalNumber(payload.guidance_scale ?? payload.guidanceScale) !== undefined
        ? { guidance_scale: optionalNumber(payload.guidance_scale ?? payload.guidanceScale) }
        : {}),
      ...(optionalNumber(payload.num_inference_steps ?? payload.numInferenceSteps) !== undefined
        ? { num_inference_steps: optionalNumber(payload.num_inference_steps ?? payload.numInferenceSteps) }
        : {}),
    };
  }

  return {
    model,
    modality: 'image',
    ...(prompt ? { prompt } : {}),
    input_urls: inputUrls,
    params,
  };
}

async function unlock(imageGenerationModel, _id, update = {}) {
  await imageGenerationModel.findOneAndUpdate(
    { _id },
    { ...update, rowLocked: false },
  );
}

export async function submitGenBlazeImageEditRequest(payload = {}, dependencies = {}) {
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
      body: await buildGenBlazeImageEditRequest(payload, dependencies),
    });
    const requestId = normalizeString(response?.request_id);
    if (!requestId) throw new Error('GenBlaze image edit submit returned no request id.');
    await unlock(imageGenerationModel, _id, {
      apiRequestId: `${GENBLAZE_EDIT_REQUEST_PREFIX}${requestId}`,
      apiEditStatus: 'PENDING',
      editStatus: 'PENDING',
      externalProvider: 'gmicloud',
      apiSubmittedAt: new Date(),
    });
    return null;
  } catch (error) {
    logger.error('[GenBlazeImageEdit] submit failed:', error);
    await unlock(imageGenerationModel, _id);
    return {
      image: null,
      error: `GMICloud image edit submission failed: ${error?.message || 'Unknown provider error'}`,
      definitiveAdapterFailure: true,
    };
  }
}

export async function pollGenBlazeImageEditRequest(payload = {}, dependencies = {}) {
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
    await unlock(imageGenerationModel, _id);
    return {
      image: null,
      error: 'GMICloud image edit request is missing its GenBlaze request id.',
      definitiveAdapterFailure: true,
    };
  }

  try {
    const response = await request(`/media/requests/${encodeURIComponent(requestId)}`);
    const status = normalizeString(response?.status).toLowerCase();
    if (['pending', 'queued', 'running', 'processing'].includes(status)) {
      await unlock(imageGenerationModel, _id);
      return null;
    }
    if (status !== 'succeeded') {
      const message = normalizeString(response?.error?.message || response?.error || response?.message) ||
        `GMICloud image edit request ${status || 'failed'}.`;
      await unlock(imageGenerationModel, _id);
      return { image: null, error: message, definitiveAdapterFailure: true };
    }

    const resultUrl = normalizeString(response?.assets?.[0]?.url);
    if (!resultUrl) throw new Error('GMICloud image edit result returned no image URL.');
    const image = await saveFile(resultUrl);
    await unlock(imageGenerationModel, _id, { externalProvider: 'gmicloud' });
    return { image, resultUrl, resultUrls: [resultUrl] };
  } catch (error) {
    logger.error('[GenBlazeImageEdit] poll failed:', error);
    await unlock(imageGenerationModel, _id);
    return {
      image: null,
      error: `GMICloud image edit result failed: ${error?.message || 'Unknown provider error'}`,
      definitiveAdapterFailure: true,
    };
  }
}

export function shouldUseGenBlazeImageEditProvider(payload = {}) {
  if (!isStandaloneEdition() || !isTruthyEnv(process.env.SAMSAR_GENBLAZE_ENABLED)) return false;
  if (!GENBLAZE_IMAGE_EDIT_MODELS.has(normalizeModel(payload.model))) return false;
  if (normalizeCaseType(payload.case_type) === 'image_list_to_image_set') return false;
  if (isGenBlazeImageEditRequestId(payload.apiRequestId)) return true;
  const selectedProvider = normalizeProvider(
    payload.adapterProviderOverride || payload.adapterProvider || payload.externalProvider,
  );
  return ['gmi', 'gmicloud', 'genblaze'].includes(selectedProvider);
}

export async function handleGenBlazeImageEditRequest(payload = {}, dependencies = {}) {
  const status = normalizeString(payload.apiEditStatus || 'INIT').toUpperCase();
  if (status === 'INIT') return submitGenBlazeImageEditRequest(payload, dependencies);
  if (status === 'PENDING') return pollGenBlazeImageEditRequest(payload, dependencies);
  if (status === 'FAILED') return { image: null };
  return null;
}
