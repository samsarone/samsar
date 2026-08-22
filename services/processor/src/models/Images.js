import { getDBConnectionString } from './DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import User from '../schema/User.js';
import { v4 as uuidv4 } from 'uuid';
import { uploadTempEditImageToFileSystem } from '../storage/Files.js';
import ImageBatchGeneration from '../schema/ImageBatchGeneration.js';
import { IMAGE_EDIT_MODEL_PRICES, IMAGE_MODEL_PRICES } from '../consts/ModelPrices.js';
import sharp from 'sharp';
import { shouldBypassGenerationCredits } from '../utils/EnvironmentUtils.js';
import {
  QWEN_IMAGE_3_PRO_MODEL_KEY,
  isAlibabaQwenImage3ProAvailable,
} from '../consts/DockerProviderPriority.js';

import { maybeTriggerAutoRecharge } from './AutoRecharge.js';


import { uploadFrameLayerImageToCDN, primeCDNCache } from './AWS.js';
import path from 'path';
import fs from 'fs';
const pwd = process.cwd();
const dockerAssetsRoot = process.env.SAMSAR_ASSETS_ROOT || '/assets';
const dockerAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
const localAssetsRoot = path.join(pwd, 'assets');
const localAssetsV2Root = path.join(pwd, 'assets_v2');

function resolveNanoBananaModelAlias(modelKey) {
  if (modelKey === 'GPTIMAGE1') {
    return 'GPTIMAGE2';
  }
  if (modelKey === 'GPTIMAGE1EDIT') {
    return 'GPTIMAGE2EDIT';
  }
  return modelKey;
}

export function assertImageGenerationModelAvailable(modelKey, env = process.env) {
  const normalizedModelKey = typeof modelKey === 'string'
    ? modelKey.trim().toUpperCase()
    : modelKey;
  if (
    normalizedModelKey === QWEN_IMAGE_3_PRO_MODEL_KEY &&
    !isAlibabaQwenImage3ProAvailable(env)
  ) {
    const error = new Error(
      'Qwen Image 3.0 Pro requires native Alibaba Cloud pay-as-you-go routing.',
    );
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }
  return normalizedModelKey === QWEN_IMAGE_3_PRO_MODEL_KEY
    ? QWEN_IMAGE_3_PRO_MODEL_KEY
    : modelKey;
}

const isDataUrl = (value) => typeof value === 'string' && value.trim().startsWith('data:');
const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const stripQueryAndHash = (value) => value.split('?')[0].split('#')[0];
const safeDecodeURIComponent = (value) => {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
};

const toCanonicalLocalAssetPath = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || isHttpUrl(trimmed) || isDataUrl(trimmed)) {
    return null;
  }
  const withoutQuery = stripQueryAndHash(trimmed).replace(/\\/g, '/');
  const withoutLeadingSlash = withoutQuery.replace(/^\/+/, '');
  if (!withoutLeadingSlash) {
    return null;
  }
  const withoutAssetsPrefix = withoutLeadingSlash.startsWith('assets/')
    ? withoutLeadingSlash.slice('assets/'.length)
    : withoutLeadingSlash;
  const normalized = path.posix.normalize(withoutAssetsPrefix);
  if (!normalized || normalized.startsWith('..')) {
    return null;
  }
  return normalized;
};

const resolveLocalAssetAbsolutePath = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || isHttpUrl(trimmed) || isDataUrl(trimmed)) {
    return null;
  }

  const decoded = safeDecodeURIComponent(stripQueryAndHash(trimmed));
  if (path.isAbsolute(decoded)) {
    try {
      if (fs.existsSync(decoded) && fs.statSync(decoded).isFile()) {
        return decoded;
      }
    } catch (_) {
      return null;
    }
  }

  const canonicalAssetPath = toCanonicalLocalAssetPath(decoded);
  if (!canonicalAssetPath) {
    return null;
  }

  const isAssetsV2Path = canonicalAssetPath.startsWith('assets_v2/');
  const normalizedAssetPath = isAssetsV2Path
    ? canonicalAssetPath.slice('assets_v2/'.length)
    : canonicalAssetPath;
  const candidates = isAssetsV2Path
    ? [
      path.join(dockerAssetsV2Root, normalizedAssetPath),
      path.join(localAssetsV2Root, normalizedAssetPath),
    ]
    : [
      path.join(dockerAssetsV2Root, normalizedAssetPath),
      path.join(localAssetsV2Root, normalizedAssetPath),
      path.join(dockerAssetsRoot, normalizedAssetPath),
      path.join(localAssetsRoot, normalizedAssetPath),
    ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch (_) {
      // keep trying fallback roots
    }
  }

  return null;
};

function resolveTempEditImagePath(imageName, payload = {}) {
  const sessionRef = payload.sessionId || payload.videoSessionId || payload._id || 'edit';
  const candidates = [
    path.join(localAssetsV2Root, 'temp', sessionRef.toString(), imageName),
    path.join(dockerAssetsV2Root, 'temp', sessionRef.toString(), imageName),
    path.join(localAssetsRoot, 'temp', imageName),
    path.join(dockerAssetsRoot, 'temp', imageName),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {
      // keep trying fallback roots
    }
  }

  return candidates[0];
}

const hasExplicitImageInputList = (payload = {}) => {
  const hasNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
  const hasArrayValues = (value) => Array.isArray(value) && value.some(hasNonEmptyString);
  return (
    hasArrayValues(payload.image_urls) ||
    hasArrayValues(payload.input_image_urls) ||
    hasArrayValues(payload.imageUrls) ||
    hasArrayValues(payload.inputImageUrls)
  );
};

const collectEditInputImages = (payload = {}) => {
  const urls = [];
  const seen = new Set();

  const pushIfValid = (value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const dedupeKey = toCanonicalLocalAssetPath(trimmed) || trimmed;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    urls.push(trimmed);
  };

  if (payload.image) {
    pushIfValid(payload.image);
  }

  if (Array.isArray(payload.image_urls)) {
    payload.image_urls.forEach((item) => pushIfValid(item));
  }

  if (Array.isArray(payload.input_image_urls)) {
    payload.input_image_urls.forEach((item) => pushIfValid(item));
  }

  if (Array.isArray(payload.imageUrls)) {
    payload.imageUrls.forEach((item) => pushIfValid(item));
  }

  if (Array.isArray(payload.inputImageUrls)) {
    payload.inputImageUrls.forEach((item) => pushIfValid(item));
  }

  return urls;
};


function getInferenceModelPayloadAliases(payload = {}) {
  const userInferenceModel =
    payload.userInferenceModel ||
    payload.selectedInferenceModel ||
    payload.inferenceModel ||
    payload.expressGenerationInferenceModel;

  if (!userInferenceModel) {
    return {};
  }

  return {
    inferenceModel: userInferenceModel,
    selectedInferenceModel: userInferenceModel,
    userInferenceModel,
    expressGenerationInferenceModel: userInferenceModel,
  };
}

export async function addImageGeneratorRequest(userId, payload, updateCredits = true) {


  const { model, aspectRatio, contentFilterRating = 3, retryOnFailure } = payload;
  const resolvedModel = assertImageGenerationModelAvailable(
    resolveNanoBananaModelAlias(model),
  );


  // Find the pricing information for the selected model
  const modelPricing = IMAGE_MODEL_PRICES.find(m => m.key === resolvedModel);

  // Find the price for the selected aspect ratio
  const priceObj = modelPricing
    ? modelPricing.prices.find(p => p.aspectRatio === aspectRatio) ||
      modelPricing.prices.find(p => p.aspectRatio === '1:1')
    : null;

  // Get the price or default to 0 if not found
  const creditCost = priceObj ? priceObj.price : 0;

  if (updateCredits && creditCost > 0 && !shouldBypassGenerationCredits()) {
    // Deduct the correct amount of credits
    const updateResult = await User.updateOne(
      { _id: userId, generationCredits: { $gte: creditCost } },
      { $inc: { generationCredits: -creditCost } }
    );

    // If no documents were updated, it means the user either doesn't exist or doesn't have enough credits
    if (updateResult.modifiedCount === 0) {

      throw new Error('Insufficient credits');
      // Handle as necessary, possibly throw an error or return a specific response
      return; // Or throw new Error('Insufficient credits');
    }

    await maybeTriggerAutoRecharge(userId);
  }

  try {
    await getDBConnectionString();
    const generationPayload = new ImageGeneration({
      ...payload,
      ...getInferenceModelPayloadAliases(payload),
      model: resolvedModel,
      generationStatus: "PENDING",
      rowLocked: false,
      operationType: "GENERATE",
      contentFilterRating: contentFilterRating,

      retryOnFailure: retryOnFailure, // set this to true
    });



    await generationPayload.save();
    return generationPayload;
  } catch (error) {
    console.error("Error saving generation payload:", error);
    // Handle error as necessary
  }
}

export async function addImageUpscaleRequest(userId, payload, updateCredits = true) {


  const { model, aspectRatio, contentFilterRating = 3, retryOnFailure, image } = payload;
  const resolvedModel = resolveNanoBananaModelAlias(model);


  // Find the pricing information for the selected model
  const modelPricing = IMAGE_MODEL_PRICES.find(m => m.key === resolvedModel);

  // Find the price for the selected aspect ratio
  const priceObj = modelPricing
    ? modelPricing.prices.find(p => p.aspectRatio === aspectRatio) ||
      modelPricing.prices.find(p => p.aspectRatio === '1:1')
    : null;

  // Get the price or default to 0 if not found
  const creditCost = priceObj ? priceObj.price : 0;

  if (updateCredits && creditCost > 0 && !shouldBypassGenerationCredits()) {
    // Deduct the correct amount of credits
    const updateResult = await User.updateOne(
      { _id: userId, generationCredits: { $gte: creditCost } },
      { $inc: { generationCredits: -creditCost } }
    );

    // If no documents were updated, it means the user either doesn't exist or doesn't have enough credits
    if (updateResult.modifiedCount === 0) {

      throw new Error('Insufficient credits');
      // Handle as necessary, possibly throw an error or return a specific response
      return; // Or throw new Error('Insufficient credits');
    }

    await maybeTriggerAutoRecharge(userId);
  }

  try {
    await getDBConnectionString();
    const generationPayload = new ImageGeneration({
      ...payload,
      ...getInferenceModelPayloadAliases(payload),
      model: resolvedModel,
      generationStatus: "PENDING",
      rowLocked: false,
      operationType: "UPSCALE",
      contentFilterRating: contentFilterRating,

      retryOnFailure: retryOnFailure, // set this to true
    });




    await generationPayload.save();
    return generationPayload;
  } catch (error) {
    console.error("Error saving generation payload:", error);
    // Handle error as necessary
  }
}


export async function addImageEditRequest(userId, payload) {
  const modelSelected = resolveNanoBananaModelAlias(payload.model);
  const aspectRatio = payload.aspectRatio;

  const modelPricing = IMAGE_EDIT_MODEL_PRICES.find(m => m.key === modelSelected);
  const priceObj = modelPricing
    ? modelPricing.prices.find(p => p.aspectRatio === aspectRatio) ||
      modelPricing.prices.find(p => p.aspectRatio === '1:1')
    : null;



  const creditCost = priceObj ? priceObj.price : 5;

  let remoteImage;
  let remoteMaskImage;

  // Upload images to the filesystem
  const localImageLinks = await uploadTempEditImageToFileSystem(payload);
  const { image, images = [], imageDataList = [], maskImage } = localImageLinks;
  const dataUrlToImageNameMap = new Map();
  imageDataList.forEach((dataUrl, index) => {
    if (typeof dataUrl !== 'string') {
      return;
    }
    const imageName = images[index];
    if (typeof imageName !== 'string' || !imageName) {
      return;
    }
    dataUrlToImageNameMap.set(dataUrl.trim(), imageName);
  });

  const inputPayload = hasExplicitImageInputList(payload)
    ? { ...payload, image: undefined }
    : payload;
  const inputImages = collectEditInputImages(inputPayload);
  const remoteImageUrls = [];
  const remoteImageUrlSet = new Set();
  const usedLocalImageNames = new Set();

  const pushRemoteImageUrl = (value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || remoteImageUrlSet.has(trimmed)) {
      return;
    }
    remoteImageUrlSet.add(trimmed);
    if (!remoteImage) {
      remoteImage = trimmed;
    }
    remoteImageUrls.push(trimmed);
  };

  const takeNextUnusedLocalImageName = () => {
    while (dataIndex < images.length) {
      const candidate = images[dataIndex];
      dataIndex += 1;
      if (typeof candidate !== 'string' || !candidate || usedLocalImageNames.has(candidate)) {
        continue;
      }
      usedLocalImageNames.add(candidate);
      return candidate;
    }
    return null;
  };

  let dataIndex = 0;
  for (let i = 0; i < inputImages.length; i += 1) {
    const inputImage = inputImages[i];
    if (isDataUrl(inputImage)) {
      const mappedImageName = dataUrlToImageNameMap.get(inputImage.trim());
      let localImageName = null;
      if (
        typeof mappedImageName === 'string' &&
        mappedImageName &&
        !usedLocalImageNames.has(mappedImageName)
      ) {
        localImageName = mappedImageName;
        usedLocalImageNames.add(mappedImageName);
      } else {
        localImageName = takeNextUnusedLocalImageName();
      }
      if (!localImageName) {
        continue;
      }
      const localImagePath = resolveTempEditImagePath(localImageName, payload);
      const uploadedUrl = await uploadFrameLayerImageToCDN(localImagePath, localImageName);
      await primeCDNCache(uploadedUrl);
      pushRemoteImageUrl(uploadedUrl);
      continue;
    }

    const localAssetPath = resolveLocalAssetAbsolutePath(inputImage);
    if (localAssetPath) {
      const extName = path.extname(localAssetPath);
      const safeExtension = extName && /^[a-zA-Z0-9.]+$/.test(extName) ? extName : '.png';
      const sessionRef = payload.sessionId || payload.videoSessionId || payload._id || 'edit';
      const remoteFileName = `${sessionRef}_edit_input_${Date.now()}_${uuidv4()}${safeExtension}`;
      try {
        const uploadedUrl = await uploadFrameLayerImageToCDN(localAssetPath, remoteFileName);
        await primeCDNCache(uploadedUrl);
        pushRemoteImageUrl(uploadedUrl);
        continue;
      } catch (error) {
        console.error(`Error uploading local image input (${inputImage}):`, error);
      }
    }

    pushRemoteImageUrl(inputImage);
  }

  if (!remoteImage && image) {
    const fallbackLocalPath = resolveTempEditImagePath(image, payload);
    const fallbackUrl = await uploadFrameLayerImageToCDN(fallbackLocalPath, image);
    await primeCDNCache(fallbackUrl);
    remoteImage = fallbackUrl;
    if (!remoteImageUrlSet.has(fallbackUrl)) {
      remoteImageUrlSet.add(fallbackUrl);
      remoteImageUrls.unshift(fallbackUrl);
    }
  }

  if (maskImage) {
    const localMaskImagePath = resolveTempEditImagePath(maskImage, payload);

    // Get and log dimensions of the mask image
    try {
      const maskImageDimensions = await sharp(localMaskImagePath).metadata();

    } catch (err) {
      console.error(`Error getting dimensions for mask image (${maskImage}):`, err);
    }

    // Upload mask image to CDN
    remoteMaskImage = await uploadFrameLayerImageToCDN(localMaskImagePath, maskImage);

    await primeCDNCache(remoteMaskImage);
  }

  if (!shouldBypassGenerationCredits()) {
    // Update user credits
    const updateResult = await User.updateOne(
      { _id: userId, generationCredits: { $gt: 0 } },
      { $inc: { generationCredits: -creditCost } }
    );

    // If no documents were updated, it means the user either doesn't exist or doesn't have enough credits
    if (updateResult.modifiedCount === 0) {
      throw new Error('Insufficient credits');
    }

    await maybeTriggerAutoRecharge(userId);
  }

  // Prepare the payload for the database
  await getDBConnectionString();
  let queuePayload = {
    editStatus: "PENDING",
    sessionId: payload.sessionId,
    layerId: payload.layerId,
    image: remoteImage,
    rowLocked: false,
    operationType: "EDIT",
    prompt: payload.prompt,
    model: modelSelected,
    guidanceScale: payload.guidanceScale,
    numInferenceSteps: payload.numInferenceSteps,
    strength: payload.strength,
    aspectRatio: payload.aspectRatio,
  };
  if (remoteImageUrls.length) {
    const orderedEditImageUrls =
      remoteImageUrls.length > 1 ? [...remoteImageUrls].reverse() : remoteImageUrls;
    queuePayload.image_urls = orderedEditImageUrls;
  }
  if (remoteMaskImage) {
    queuePayload['maskImage'] = remoteMaskImage;
  }


  const generationPayload = new ImageGeneration(queuePayload);
  const saveRes = await generationPayload.save({});


  return saveRes;
}


export async function createInfiniteZoomImageRequests(sessionId, userId, animationType, aspectRatio, payload) {


  const batchImagePayload = payload.map((item) => {
    return {
      prompt: item.prompt,
      status: "INIT",
      image: '',
      layerId: item.layerId,
    };
  });

  const bachGen = new ImageBatchGeneration({
    layers: batchImagePayload,
    sessionId: sessionId,
    userId: userId,
    animationType: animationType,
    aspectRatio: aspectRatio,
  });

  await bachGen.save();

  return bachGen;


}
