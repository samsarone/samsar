import { fal } from "@fal-ai/client";
import { getDBConnectionString } from "../../DBString.js";
import ImageGeneration from "../../schema/ImageGeneration.js";
import GlobalSession from "../../schema/GlobalSession.js";
import axios from 'axios';
import { markVideoSessionLayerAsFailed } from '../../VideoSession.js';
import { uploadImageToCDN } from '../../utils/AWS.js';
import { getCurrentEnvironment } from '../../utils/Environment.js';
import { getAccessibleMediaUrlsForProvider } from '../../utils/MediaReferenceUtils.js';
import { IMAGE_EDIT_MODEL_TYPES } from "../../constants.js";



import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function handleNanoBananaEditRequest(payload) {
  const { apiEditStatus, apiRequestId, model } = payload;

  if (apiEditStatus === 'INIT') {
    await submitNanoBananaEditRequest(payload);
  } else if (apiEditStatus === 'PENDING') {

    return await pollNanoBananaEditRequest(payload);
  } else if (apiEditStatus === 'FAILED') {


    if (payload?.requestType === 'API') {
      if (payload?._id) {
        await updateGlobalSessionStatus(payload._id, { status: 'FAILED', errorMessage: 'NanoBanana edit request failed' });
      }
    } else {
      await markVideoSessionLayerAsFailed(payload);
    }


  }

}

export async function submitNanoBananaEditRequest(payload) {
  const { _id, model, prompt } = payload;
  const aspectRatio = resolveAspectRatio(payload) || '16:9';
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });


  const falLink = getFalLinkForModel(model);



  const editModelValue = IMAGE_EDIT_MODEL_TYPES.find((em) => em.key === model);




  const imageUrls = await getImageUrlsForRequest(payload);

  let reqPayload = {
    prompt: prompt,
    aspect_ratio: aspectRatio,
    image_urls: imageUrls,
    num_images: 1,
    output_format: 'png',
    enable_web_search: false,
  };





  let response;
  try {
    response = await fal.queue.submit(falLink, {
      input: reqPayload,
    });
  } catch (error) {
    const message = getFalErrorMessage(error) || 'NanoBanana edit submission failed';
    await handlePollingError(_id, message);
    throw new Error(message);
  }


  const requestId = response.request_id;



  await ImageGeneration.findOneAndUpdate({
    _id: _id
  }, {
    apiRequestId: requestId,
    apiEditStatus: "PENDING",
    editStatus: "PENDING",
    rowLocked: false
  });

  await mapSessionToRequestId(_id, requestId, model);
}


export async function submitNanoBananaRemoveLogoRequest(payload) {
  const { _id, model } = payload;
  const aspectRatio = resolveAspectRatio(payload) || '16:9';



  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  const falLink = getFalLinkForModel(model);
  const imageUrls = await getImageUrlsForRequest(payload);

  const prompt = 'Remove all visible text from the image. Preserve the original scene, objects, colors, lighting, and composition. Fill edited areas naturally using surrounding visual details. Do not add new text or other elements.';
  const reqPayload = {
    prompt: prompt || '',
    aspect_ratio: aspectRatio,
    image_urls: imageUrls,
    num_images: 1,
    output_format: 'png',
    enable_web_search: false,
  };



  
  const response = await fal.queue.submit(falLink, { input: reqPayload });
  const requestId = response.request_id;

  await ImageGeneration.findOneAndUpdate(
    { _id },
    { apiRequestId: requestId, apiEditStatus: "PENDING", editStatus: "PENDING", rowLocked: false }
  );

  await mapSessionToRequestId(_id, requestId, model);
}


export async function pollNanoBananaRemoveLogoRequest(payload) {
  return await pollNanoBananaCommon(payload);
}

export async function pollNanoBananaEditRequest(payload) {
  return await pollNanoBananaCommon(payload);
}

export async function pollNanoBananaGetImageSetFromImageListRequest(payload) {
  const { _id, apiRequestId, model } = payload;

  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate(
    { _id },
    { rowLocked: true }
  );

  const falLink = getFalLinkForModel(model);

  if (!falLink) {
    const message = 'Invalid NanoBanana model';
    await handlePollingError(_id, message);
    return { error: message };
  }

  if (!apiRequestId) {
    const message = 'Missing NanoBanana request id';
    await handlePollingError(_id, message);
    return { error: message };
  }

  let responseStatusData;
  try {
    responseStatusData = await fal.queue.status(falLink, {
      requestId: apiRequestId,
      logs: true,
    });
  } catch (error) {
    const message = getFalErrorMessage(error) || 'Error polling NanoBanana request';
    await handlePollingError(_id, message, {
      model,
      apiRequestId,
      stage: 'poll_status',
    });
    return null;
  }

  const normalizedStatus = normalizeNanoBananaStatus(responseStatusData?.status);
  const failureMessage = getFalErrorMessage(responseStatusData);

  if (normalizedStatus === 'FAILED') {
    const message = failureMessage || 'NanoBanana request failed';
    await handlePollingError(_id, message, {
      model,
      apiRequestId,
      stage: 'provider_failed',
      providerStatus: responseStatusData?.status,
    });
    return { error: message };
  }

  if (normalizedStatus !== 'COMPLETED') {
    await ImageGeneration.findOneAndUpdate(
      { _id },
      { rowLocked: false }
    );
    return null;
  }

  let result;

  try {
    result = await fetchFalResultWithRetry(falLink, apiRequestId);
  } catch {
    await handlePollingError(_id, 'Error fetching NanoBanana result');
    return null;
  }

  await ImageGeneration.findOneAndUpdate(
    { _id },
    { rowLocked: true }
  );

  const imageRemoteUrls = Array.isArray(result?.images) ? result.images.map((img) => img?.url).filter(Boolean) : [];

  if (!imageRemoteUrls.length) {
    await handlePollingError(_id, 'NanoBanana returned an empty image response');
    return null;
  }

  const imageNames = [];
  const uploadedResultUrls = [];

  for (const imageRemoteUrl of imageRemoteUrls) {
    try {
      const imageName = await saveRemoteFile(imageRemoteUrl);
      imageNames.push(imageName);

      const remoteUrl = `/generations/${imageName}`;
      const resultUrl = await uploadGenerationToCDN(imageName, remoteUrl);
      uploadedResultUrls.push(resultUrl);
    } catch {
    }
  }

  if (!uploadedResultUrls.length) {
    await handlePollingError(_id, 'NanoBanana returned images but processing failed');
    return null;
  }

  const firstResultUrl = uploadedResultUrls[0] || null;

  await updateGlobalSessionStatus(_id, { status: 'COMPLETED', resultUrl: firstResultUrl, resultUrls: uploadedResultUrls });
  await ImageGeneration.findOneAndUpdate(
    { _id },
    { editStatus: 'COMPLETED', apiEditStatus: 'COMPLETED', rowLocked: false }
  );

  return { images: imageNames, resultUrls: uploadedResultUrls };
}

export async function submitNanoBananaEnhanceRequest(payload) {
  const { _id, model, resolution } = payload;
  const aspectRatio = resolveAspectRatio(payload) || '16:9';
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  const falLink = getFalLinkForModel(model);
  if (!falLink) {
    await handlePollingError(_id, 'Invalid NanoBanana model');
    return;
  }

  const imageUrls = await getImageUrlsForRequest(payload);
  if (!imageUrls.length) {
    await handlePollingError(_id, 'No image URL provided for enhancement');
    return;
  }

  const normalizedResolution = normalizeResolution(resolution);
  const prompt = `Upscale and enhance quality and resolution of this image. Maintain original details exactly while improving clarity and sharpness. Output image should be high quality, maintain facial features and be photorealistic.`;

  const reqPayload = {
    prompt,
    aspect_ratio: aspectRatio,
    image_urls: imageUrls,
    num_images: 1,
    resolution: normalizedResolution,
    output_format: 'png',
    enable_web_search: false,
  };

  let response;
  try {
    response = await fal.queue.submit(falLink, { input: reqPayload });
  } catch (error) {
    const message = getFalErrorMessage(error) || 'NanoBanana enhance submission failed';
    await handlePollingError(_id, message);
    throw new Error(message);
  }
  const requestId = response.request_id;

  await ImageGeneration.findOneAndUpdate(
    { _id },
    { apiRequestId: requestId, apiEditStatus: "PENDING", editStatus: "PENDING", rowLocked: false }
  );

  await mapSessionToRequestId(_id, requestId, model);
}

export async function pollNanoBananaEnhanceRequest(payload) {
  return await pollNanoBananaCommon(payload);
}


export async function submitNanoBananaGetImageSetFromImageListRequest(payload) {
  const { _id, model, prompt } = payload;
  const aspectRatio = resolveAspectRatio(payload) || '16:9';
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  const falLink = getFalLinkForModel(model);
  if (!falLink) {
    await handlePollingError(_id, 'Invalid NanoBanana model');
    return;
  }

  const imageUrls = await getImageUrlsForRequest(payload);
  const numImagesRaw = payload?.num_images ?? payload?.numImages;
  const numImagesToGenerate = Number(numImagesRaw);

  if (!Number.isFinite(numImagesToGenerate) || numImagesToGenerate <= 0) {
    const message = 'num_images must be a positive number for image set generation';
    await handlePollingError(_id, message);
    throw new Error(message);
  }

  const normalizedPrompt = `${prompt}\nPhotorealistic, natural lighting and textures, DSLR/RAW look; avoid illustration, anime, CGI, 3D render, cartoon, or digital painting styles.`;
  const reqPayload = {
    prompt: normalizedPrompt,
    aspect_ratio: aspectRatio,
    image_urls: imageUrls,
    num_images: numImagesToGenerate,
    output_format: 'png',
    enable_web_search: false,
  };

  let response;
  try {
    response = await fal.queue.submit(falLink, { input: reqPayload });
  } catch (error) {
    const message = getFalErrorMessage(error) || 'NanoBanana image_set submission failed';
    await handlePollingError(_id, message);
    throw new Error(message);
  }

  const requestId = response.request_id;

  await ImageGeneration.findOneAndUpdate(
    { _id },
    { apiRequestId: requestId, apiEditStatus: "PENDING", editStatus: "PENDING", rowLocked: false }
  );

  await mapSessionToRequestId(_id, requestId, model);
}





async function pollNanoBananaCommon(payload) {
  const { _id, apiRequestId, model } = payload;

  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate(
    { _id },
    { rowLocked: true }
  );

  const falLink = getFalLinkForModel(model);

  if (!falLink) {
    const message = 'Invalid NanoBanana model';
    await handlePollingError(_id, message);
    return { error: message };
  }

  let responseStatusData;
  try {
    responseStatusData = await fal.queue.status(falLink, {
      requestId: apiRequestId,
      logs: true,
    });
  } catch {
    await handlePollingError(_id, 'Error polling NanoBanana request');
    return null;
  }

  const normalizedStatus = normalizeNanoBananaStatus(responseStatusData?.status);
  const failureMessage = getFalErrorMessage(responseStatusData);

  if (normalizedStatus === 'FAILED') {
    const message = failureMessage || 'NanoBanana request failed';
    await handlePollingError(_id, message);
    return { error: message };
  }

  if (normalizedStatus !== 'COMPLETED') {
    await ImageGeneration.findOneAndUpdate(
      { _id },
      { rowLocked: false }
    );
    return null;
  }

  let result;

  try {
    result = await fetchFalResultWithRetry(falLink, apiRequestId);
  } catch (e) {
    const message = getFalErrorMessage(e) || 'Error fetching NanoBanana result';
    await handlePollingError(_id, message, {
      model,
      apiRequestId,
      stage: 'fetch_result',
    });
    return null;
  }

  await ImageGeneration.findOneAndUpdate(
    { _id },
    { rowLocked: true }
  );

  const imageRemoteUrl = result?.images?.[0]?.url;

  if (!imageRemoteUrl) {
    await handlePollingError(_id, 'NanoBanana returned an empty image response');
    return null;
  }

  const imageName = await saveRemoteFile(imageRemoteUrl);

  const remoteUrl = `/generations/${imageName}`;
  const resultUrl = await uploadGenerationToCDN(imageName, remoteUrl);

  await updateGlobalSessionStatus(_id, { status: 'COMPLETED', resultUrl, resultUrls: [resultUrl] });
  await ImageGeneration.findOneAndUpdate(
    { _id },
    { editStatus: 'COMPLETED', apiEditStatus: 'COMPLETED', rowLocked: false }
  );

  return { image: imageName, resultUrl, resultUrls: [resultUrl] };
}

function normalizeNanoBananaStatus(responseStatus) {
  if (responseStatus === 'IN_PROGRESS') {
    return 'PENDING';
  }
  return responseStatus || 'PENDING';
}

function getFalErrorMessage(errorPayload) {
  if (!errorPayload) {
    return null;
  }

  if (typeof errorPayload === 'string') {
    return errorPayload;
  }

  if (errorPayload?.error) {
    if (typeof errorPayload.error === 'string') {
      return errorPayload.error;
    }
    if (errorPayload.error?.message) {
      return errorPayload.error.message;
    }
  }

  const responseData = errorPayload?.response?.data;
  if (responseData) {
    const responseMessage = getFalErrorMessage(responseData);
    if (responseMessage) {
      return responseMessage;
    }
  }

  if (errorPayload?.body) {
    const bodyMessage = getFalErrorMessage(errorPayload.body);
    if (bodyMessage) {
      return bodyMessage;
    }
  }

  if (errorPayload?.detail) {
    if (typeof errorPayload.detail === 'string') {
      return errorPayload.detail;
    }
    const detailMessage = getFalErrorMessage(errorPayload.detail);
    if (detailMessage) {
      return detailMessage;
    }
  }

  if (Array.isArray(errorPayload?.logs)) {
    const logMessage = errorPayload.logs
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        return entry?.message || entry?.msg || entry?.error || null;
      })
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .pop();
    if (logMessage) {
      return logMessage;
    }
  }

  if (errorPayload?.message) {
    return errorPayload.message;
  }

  return null;
}

async function handlePollingError(sessionId, errorMessage, context = {}) {
  if (!sessionId) {
    return;
  }
  console.error('[NanoBananaEdit] request failed', {
    sessionId: sessionId.toString(),
    errorMessage,
    ...context,
  });
  try {
    await updateGlobalSessionStatus(sessionId, { status: 'FAILED', errorMessage });
  } catch {
  }

  try {
    await ImageGeneration.findOneAndUpdate(
      { _id: sessionId },
      {
        editStatus: 'FAILED',
        apiEditStatus: 'FAILED',
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        rowLocked: false,
        errorMessage,
      }
    );
  } catch {
  }
}


function getFalLinkForModel(model) {

  if (
    model === 'NANOBANANA2EDIT' ||
    model === 'NANOBANANAPROEDIT' ||
    model === 'NANOBANANAEDIT'
  ) {
    return "fal-ai/nano-banana-2/edit";
  }
}

function normalizeResolution(resolution) {
  if (typeof resolution !== 'string') {
    return '1K';
  }
  const normalized = resolution.trim().toUpperCase();
  const allowed = ['0.5K', '1K', '2K', '4K'];

  if (allowed.includes(normalized)) {
    return normalized;
  }

  return '1K';
}

function normalizeAspectRatio(aspectRatio) {
  if (typeof aspectRatio !== 'string') {
    return null;
  }

  const trimmed = aspectRatio.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const left = parseFloat(match[1]);
  const right = parseFloat(match[2]);

  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return null;
  }

  return `${match[1]}:${match[2]}`;
}

function resolveAspectRatio(payload, defaultValue = '16:9') {
  const raw =
    (payload && (payload.aspectRatio ?? payload.aspect_ratio)) ||
    null;

  const normalized = normalizeAspectRatio(raw);
  if (normalized) {
    return normalized;
  }

  return defaultValue;
}

async function getImageUrlsForRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const urls = [];
  const seen = new Set();

  const pushIfValid = (value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    urls.push(trimmed);
  };

  if (Array.isArray(payload.image_urls) && payload.image_urls.length > 0) {
    payload.image_urls.forEach((item) => pushIfValid(item));
  }

  if (Array.isArray(payload.imageUrls) && payload.imageUrls.length > 0) {
    payload.imageUrls.forEach((item) => pushIfValid(item));
  }

  if (Array.isArray(payload.input_image_urls) && payload.input_image_urls.length > 0) {
    payload.input_image_urls.forEach((item) => pushIfValid(item));
  }

  if (Array.isArray(payload.inputImageUrls) && payload.inputImageUrls.length > 0) {
    payload.inputImageUrls.forEach((item) => pushIfValid(item));
  }

  const scalarKeys = ['image', 'image_url', 'imageUrl', 'imageRef', 'inputImage'];
  for (const key of scalarKeys) {
    if (payload[key]) {
      pushIfValid(payload[key]);
    }
  }

  return await getAccessibleMediaUrlsForProvider(urls);
}

async function mapSessionToRequestId(sessionId, requestId, model) {
  try {
    await GlobalSession.findOneAndUpdate(
      { sessionId: sessionId.toString() },
      { $set: {
        sessionId: sessionId.toString(),
        sessionType: 'image',
        requestId,
        provider: model || 'NANOBANANA2',
        status: 'PENDING',
      }},
      { upsert: true }
    );
  } catch (err) {
  }
}

export async function updateGlobalSessionStatus(sessionId, data) {
  if (!sessionId) {
    return;
  }
  try {
    await GlobalSession.findOneAndUpdate(
      { sessionId: sessionId.toString() },
      { $set: data },
      { upsert: true }
    );
  } catch (err) {
  }
}



async function saveRemoteFile(remoteImageUrl) {
  try {
    // Use axios to download the image as a stream
    const response = await axios({
      method: 'get',
      url: remoteImageUrl,
      responseType: 'arraybuffer'  // This ensures we get the data as a buffer
    });

    const buffer = Buffer.from(response.data);  // Convert the response data to a buffer

    const randStr = Math.random().toString(36).substring(7);
    const imageName = `generation_${Date.now()}_${randStr}.png`;

    const pwd = process.cwd();
    let savePath = path.join(pwd, '..', 'samsar_processor', 'assets', 'generations', imageName);

    if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
      savePath = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations', imageName);
    }

    // Ensure the directory exists
    await mkdir(path.dirname(savePath), { recursive: true });

    // Write the file to the filesystem
    await writeFile(savePath, buffer);

    return imageName;

  } catch (error) {
    throw error;
  }
}

function getLocalGenerationPath(imageName) {
  const currentEnv = getCurrentEnvironment();
  if (currentEnv === 'docker') {
    return path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations', imageName);
  }
  const pwd = process.cwd();
  return path.join(pwd, '..', 'samsar_processor', 'assets', 'generations', imageName);
}

async function uploadGenerationToCDN(imageName, remoteUrl) {
  const absolutePath = getLocalGenerationPath(imageName);
  let resultUrl = remoteUrl;

  try {
    const cdnUrl = await uploadImageToCDN(absolutePath, remoteUrl);
    if (cdnUrl) {
      resultUrl = cdnUrl;
    }
  } catch (err) {
  }

  return resultUrl;
}

async function fetchFalResultWithRetry(falLink, apiRequestId, maxAttempts = 3, baseDelayMs = 500) {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await fal.queue.result(falLink, { requestId: apiRequestId });
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
