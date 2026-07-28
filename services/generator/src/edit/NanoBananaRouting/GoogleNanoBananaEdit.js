import path from 'path';

import { getDBConnectionString } from '../../DBString.js';
import ImageGeneration from '../../schema/ImageGeneration.js';
import GlobalSession from '../../schema/GlobalSession.js';
import { markVideoSessionLayerAsFailed } from '../../VideoSession.js';
import { uploadImageToCDN } from '../../utils/AWS.js';
import { getDeploymentEdition } from '../../utils/Environment.js';
import {
  generateGoogleNanoBananaImages,
  getGoogleNanoBananaLocalGenerationPath,
  normalizeGoogleNanoBananaRequestPayload,
  saveGoogleNanoBananaImageBuffer,
} from '../../providers/GoogleNanoBananaNative.js';

const GOOGLE_NATIVE_EDIT_REQUEST_PREFIX = 'google-native-nanobanana-edit:';
const GOOGLE_NANOBANANA_EDIT_MODELS = new Set([
  'NANOBANANA2EDIT',
  'NANOBANANAPROEDIT',
  'NANOBANANAEDIT',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function envFlagEnabled(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function envFlagDisabled(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'no';
}

function isGoogleNativeNanoBananaEditRequestId(requestId) {
  return normalizeString(requestId).startsWith(GOOGLE_NATIVE_EDIT_REQUEST_PREFIX);
}

export function shouldUseGoogleNativeNanoBananaEdit(payloadOrModel) {
  const payload = typeof payloadOrModel === 'object' && payloadOrModel !== null ? payloadOrModel : null;
  const model = payload ? payload.model : payloadOrModel;

  if (!GOOGLE_NANOBANANA_EDIT_MODELS.has(model)) {
    return false;
  }

  if (
    envFlagEnabled(process.env.GOOGLE_NANOBANANA_USE_FAL) ||
    envFlagEnabled(process.env.GOOGLE_NANOBANANA_EDIT_USE_FAL) ||
    envFlagDisabled(process.env.GOOGLE_NANOBANANA_NATIVE_ENABLED) ||
    envFlagDisabled(process.env.GOOGLE_NANOBANANA_EDIT_NATIVE_ENABLED)
  ) {
    return false;
  }

  if (!payload) {
    return true;
  }

  const providerStatus = payload.apiEditStatus || 'INIT';
  if (
    model === 'NANOBANANAPROEDIT' &&
    getDeploymentEdition() === 'production' &&
    normalizeString(process.env.FAL_API_KEY) &&
    providerStatus === 'INIT'
  ) {
    return false;
  }
  if (providerStatus === 'INIT') {
    return true;
  }

  return isGoogleNativeNanoBananaEditRequestId(payload.apiRequestId);
}

function normalizeCaseType(caseType) {
  if (typeof caseType === 'string' && caseType.trim().length > 0) {
    return caseType.trim().toLowerCase();
  }
  return 'image_edit';
}

function resolveCaseType(caseType) {
  const normalized = normalizeCaseType(caseType);
  if (
    normalized === 'image_enhance' ||
    normalized === 'enhance_image' ||
    normalized === 'upscale' ||
    normalized === 'upscale_image'
  ) {
    return 'enhance_image';
  }
  return normalized;
}

async function getImageUrlsForRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

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

  const listKeys = ['image_urls', 'imageUrls', 'input_image_urls', 'inputImageUrls'];
  for (const key of listKeys) {
    if (Array.isArray(payload[key])) {
      payload[key].forEach(pushIfValid);
    }
  }

  const scalarKeys = ['image', 'image_url', 'imageUrl', 'imageRef', 'inputImage'];
  for (const key of scalarKeys) {
    if (payload[key]) {
      pushIfValid(payload[key]);
    }
  }

  // Google receives these images as inlineData. Keep canonical references so
  // the native adapter can read mounted Docker media directly.
  return urls;
}

function getRequestedImageCount(payload, caseType) {
  if (caseType !== 'image_list_to_image_set') {
    return 1;
  }

  const raw = payload?.num_images ?? payload?.numImages;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }

  return Math.max(1, Math.min(Math.floor(parsed), 4));
}

function buildPromptForCaseType(payload, caseType) {
  const prompt = normalizeString(payload?.prompt);

  if (caseType === 'logo_remove') {
    return 'Remove all visible text from the image. Preserve the original scene, objects, colors, lighting, and composition. Fill edited areas naturally using surrounding visual details. Do not add new text or other elements.';
  }

  if (caseType === 'enhance_image') {
    const resolution = normalizeString(payload?.resolution);
    const resolutionClause = resolution ? ` Target output detail level: ${resolution}.` : '';
    return (
      prompt ||
      `Upscale and enhance quality and resolution of this image. Maintain original details exactly while improving clarity and sharpness. Output image should be high quality, maintain facial features and be photorealistic.${resolutionClause}`
    );
  }

  if (caseType === 'image_list_to_image_set') {
    return `${prompt || 'Create a cohesive image set from the reference images.'}
Photorealistic, natural lighting and textures, DSLR/RAW look; avoid illustration, anime, CGI, 3D render, cartoon, or digital painting styles.`;
  }

  return prompt || 'Edit the provided image according to the request while preserving the important subject identity and composition.';
}

async function updateGlobalSessionStatus(sessionId, data) {
  if (!sessionId) {
    return;
  }

  try {
    await GlobalSession.findOneAndUpdate(
      { sessionId: sessionId.toString() },
      { $set: data },
      { upsert: true }
    );
  } catch {
  }
}

async function mapSessionToGoogleNativeRequestId(sessionId, requestId, model) {
  if (!sessionId) {
    return;
  }

  try {
    await GlobalSession.findOneAndUpdate(
      { sessionId: sessionId.toString() },
      {
        $set: {
          sessionId: sessionId.toString(),
          sessionType: 'image',
          requestId,
          provider: model || 'NANOBANANA2EDIT',
          status: 'PENDING',
        },
      },
      { upsert: true }
    );
  } catch {
  }
}

async function uploadGenerationToCDN(imageName, remoteUrl) {
  const absolutePath = getGoogleNanoBananaLocalGenerationPath(imageName);
  let resultUrl = remoteUrl;

  try {
    const cdnUrl = await uploadImageToCDN(absolutePath, remoteUrl);
    if (cdnUrl) {
      resultUrl = cdnUrl;
    }
  } catch {
  }

  return resultUrl;
}

async function markGoogleNanoBananaEditAsFailed(payload, message) {
  const failureMessage = message || 'Google Nano Banana edit failed';
  if (payload?.deferAdapterFailureFinalization === true) {
    return {
      error: failureMessage,
      definitiveAdapterFailure: true,
    };
  }

  try {
    await ImageGeneration.findOneAndUpdate(
      { _id: payload?._id },
      {
        editStatus: 'FAILED',
        apiEditStatus: 'FAILED',
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        rowLocked: false,
        errorMessage: failureMessage,
      }
    );
  } catch {
  }

  if (payload?._id) {
    await updateGlobalSessionStatus(payload._id, { status: 'FAILED', errorMessage: failureMessage });
  }

  if (payload?.requestType !== 'API') {
    try {
      await markVideoSessionLayerAsFailed(payload);
    } catch {
    }
  }

  return { error: failureMessage };
}

async function generateAndFinalizeGoogleNanoBananaEdit(payload, caseType) {
  const { _id, model } = payload;
  const requestId = `${GOOGLE_NATIVE_EDIT_REQUEST_PREFIX}${Date.now()}`;
  const prompt = buildPromptForCaseType(payload, caseType);
  const imageReferences = await getImageUrlsForRequest(payload);

  if (!imageReferences.length && caseType !== 'image_list_to_image_set') {
    return await markGoogleNanoBananaEditAsFailed(payload, 'No image URL provided for Google Nano Banana edit');
  }

  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, {
    rowLocked: true,
    apiRequestId: requestId,
    apiEditStatus: 'PENDING',
    editStatus: 'PENDING',
  });
  await mapSessionToGoogleNativeRequestId(_id, requestId, model);

  const normalizedRequestPayload = normalizeGoogleNanoBananaRequestPayload(payload);
  const imageBuffers = await generateGoogleNanoBananaImages({
    model,
    prompt,
    aspectRatio: normalizedRequestPayload.aspectRatio,
    imageReferences,
    numImages: getRequestedImageCount(payload, caseType),
    resolution: normalizedRequestPayload.resolution,
  });

  const imageNames = [];
  const uploadedResultUrls = [];

  for (const imageBuffer of imageBuffers) {
    const imageName = await saveGoogleNanoBananaImageBuffer(imageBuffer);
    imageNames.push(imageName);

    const remoteUrl = `/generations/${path.basename(imageName)}`;
    const resultUrl = await uploadGenerationToCDN(imageName, remoteUrl);
    uploadedResultUrls.push(resultUrl);
  }

  if (!imageNames.length) {
    return await markGoogleNanoBananaEditAsFailed(payload, 'Google Nano Banana returned an empty image response');
  }

  const firstResultUrl = uploadedResultUrls[0] || `/generations/${imageNames[0]}`;
  await updateGlobalSessionStatus(_id, {
    status: 'COMPLETED',
    resultUrl: firstResultUrl,
    resultUrls: uploadedResultUrls,
  });
  await ImageGeneration.findOneAndUpdate(
    { _id },
    {
      editStatus: 'COMPLETED',
      apiEditStatus: 'COMPLETED',
      generationStatus: 'COMPLETED',
      apiGenerationStatus: 'COMPLETED',
      resultUrl: firstResultUrl,
      rowLocked: false,
    }
  );

  return {
    image: imageNames[0],
    images: imageNames,
    resultUrl: firstResultUrl,
    resultUrls: uploadedResultUrls,
  };
}

export async function handleGoogleNanoBananaEditDispatch(payload) {
  const { apiEditStatus = 'INIT', case_type } = payload || {};
  const caseType = resolveCaseType(case_type);

  try {
    if (apiEditStatus === 'INIT') {
      return await generateAndFinalizeGoogleNanoBananaEdit(payload, caseType);
    }

    if (apiEditStatus === 'FAILED') {
      return await markGoogleNanoBananaEditAsFailed(payload, `Google Nano Banana request failed for case_type ${caseType}`);
    }

    return null;
  } catch (error) {
    console.error('[GoogleNanoBananaEdit] edit failed:', error);
    return await markGoogleNanoBananaEditAsFailed(
      payload,
      error?.message || `Google Nano Banana dispatcher error for case_type ${caseType}`
    );
  }
}
