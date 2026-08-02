import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import ImageGeneration from '../../schema/ImageGeneration.js';
import GlobalSession from '../../schema/GlobalSession.js';
import RollupBannerEnhanceTask from '../../schema/RollupBannerEnhanceTask.js';
import User from '../../schema/User.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';
import { getDescriptionForImageToCreateImageList } from '../ai_utils/VisionUtils.js';
import {
  getEnhanceImagePricing,
  getExtendImageListPricing,
  getRemoveBrandingFromImagePricing,
  getTextToImagePricing,
} from '../../consts/pricing/ApiPricing.js';
import fetch from 'node-fetch';
import sizeOf from 'image-size';
import OpenAI from 'openai';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { uploadBufferToS3, uploadBufferToS3WithRegion } from '../AWS.js';
import mongoose from 'mongoose';
import { SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE } from '../../consts/SubtitleFonts.js';
import {
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from '../../consts/InferenceModels.js';
import { createCompatibleChatCompletion } from '../ai_utils/OpenAICompat.js';
import { isStandaloneEdition } from '../../utils/EnvironmentUtils.js';

const OPENAI_MODEL = process.env.IMAGE_SET_PROMPT_MODEL || 'gpt-4o-mini';
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const ROLLUP_MAX_IMAGES = 28;
const ROLLUP_COLUMNS = 4;
const ROLLUP_ROWS = 7;
const ROLLUP_WIDTH = 10039;
const ROLLUP_HEIGHT = 23622;
const ROLLUP_HEADER_SPEC = { width: ROLLUP_WIDTH, height: 1890 };
const ROLLUP_TOP_HEIGHT = ROLLUP_HEADER_SPEC.height;
const ROLLUP_GRID_HEIGHT = 19842;
const ROLLUP_FOOTER_HEIGHT = 1890;
const TILE_HEIGHT = 2766;
const TILE_COLUMN_WIDTHS = [2420, 2420, 2419, 2419];
// Inner image area inside each tile cell (the rest is padding).
// Targeted for the updated rollup middle-section tiling.
const TILE_IMAGE_SIZE = { width: 2020, height: 2526 };
const ROLLUP_XL_MIN_IMAGE = { width: TILE_IMAGE_SIZE.width, height: TILE_IMAGE_SIZE.height };
const TILE_CORNER_RADIUS = 140;
const GRID_OUTER_PADDING = 120;
const GRID_GUTTER = 40;
const BASE_TILE = { width: TILE_COLUMN_WIDTHS[0], height: TILE_HEIGHT };
const ROLLUP_BACKGROUND_COLOR = { r: 11, g: 11, b: 11, alpha: 1 };
const TILE_BACKGROUND_COLOR = ROLLUP_BACKGROUND_COLOR;
const OVERLAY_BACKGROUND_COLOR = 'rgba(20,20,20,0.2)';
const TILE_OVERLAY_BACKGROUND_COLOR = 'rgba(20,20,20,0.2)';
const OVERLAY_TEXT_COLOR = '#ffffff';
const OVERLAY_TEXT_STROKE_COLOR = 'rgba(255,255,255,0.6)';
const FOOTER_TEXT_WIDTH_SAFETY = 0.98;
const FOOTER_TEXT_WRAP_RETRIES = 6;
const TOP_LEFT_FONT_SCALE = 1.0;

export function shouldUsePreferenceAwareImagePromptRouting(
  inferenceModel,
  env = process.env,
) {
  const normalizedInferenceModel = normalizeInferenceModel(inferenceModel);
  return (
    isStandaloneEdition(env) ||
    isGeminiInferenceModel(normalizedInferenceModel) ||
    isKimiInferenceModel(normalizedInferenceModel) ||
    isQwenInferenceModel(normalizedInferenceModel)
  );
}
const TOP_RIGHT_FONT_SCALE = 1.5;
const TOP_RIGHT_FONT_SIZE_SCALE = 0.75;
const TOP_RIGHT_MARGIN_BOOST_MIN = 18;
const TOP_RIGHT_MARGIN_BOOST_RATIO = 0.01;
const TOP_RIGHT_MARGIN_TOP_SCALE = 1.5;
const TOP_RIGHT_MARGIN_RIGHT_SCALE = 0.75;
const ROLLUP_THUMBNAIL_MAX_WIDTH = 1920;
const ROLLUP_THUMBNAIL_MAX_HEIGHT = 1080;
const ROLLUP_THUMBNAIL_SCALE = 0.1;
const ROLLUP_THUMBNAIL_SPEC = buildRollupThumbnailSpec(ROLLUP_THUMBNAIL_SCALE);
const ROLLUP_TEXT_CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const ROLLUP_TEXT_DENSE_REGEX = /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u0900-\u097f\u0980-\u09ff\u0e00-\u0e7f]/;
const TOP_LEFT_BADGE_CJK_LANGS = new Set(['zh', 'zh-cn', 'zh-tw', 'ja', 'ko']);
const TOP_LEFT_BADGE_DENSE_LANGS = new Set(['ar', 'he', 'hi', 'bn', 'th', 'sa']);
const TOP_LEFT_BADGE_PADDING_SCALE = Object.freeze({
  default: 1.5,
  dense: 1.6,
  cjk: 1.8,
});
const TOP_LEFT_BADGE_CHAR_WIDTH_RATIO = Object.freeze({
  default: 0.5,
  dense: 0.66,
  cjk: 0.9,
});
const TOP_LEFT_BADGE_MAX_CHARS = Object.freeze({
  default: 8,
  dense: 6,
  cjk: 5,
});
const ROLLUP_TEXT_CHAR_WIDTH_RATIO = Object.freeze({
  default: 0.6,
  dense: 0.72,
  cjk: 0.92,
});
const ROLLUP_BUCKET = process.env.ROLLUP_BANNER_BUCKET ||
  process.env.AWS_ROLLUP_BUCKET ||
  process.env.MEDIA_BUCKET_NAME ||
  process.env.STATIC_CDN_BUCKET ||
  process.env.SAMSAR_EXTERNAL_MEDIA_BUCKET ||
  'samsar-resources';
const ROLLUP_FOLDER = process.env.ROLLUP_BANNER_FOLDER || 'rollup_banners';
const ROLLUP_BANNER_CREDITS = 30;
const ROLLUP_TEXT_SCALE = 1.08;
const DEFAULT_ROLLUP_IMAGE_TILING_POSITION = Object.freeze({
  font_key: 'en',
  font_family: 'Poppins, Helvetica, Arial, sans-serif',
  top_left: Object.freeze({
    margin_min: 28,
    margin_ratio: 0.02,
    diameter_min: 220,
    diameter_max: 320,
    diameter_ratio: 0.215,
    inner_padding_min: 12,
    inner_padding_ratio: 0.08,
  }),
  top_right: Object.freeze({
    margin_min: 28,
    margin_ratio: 0.02,
    max_width_floor: 260,
    min_width: 220,
    padding_left: 36,
    padding_right: 48,
    padding_top: 30,
    padding_bottom: 24,
    overlay_height_min: 140,
  }),
  bottom: Object.freeze({
    inset_min: 32,
    inset_ratio: 0.03,
    offset_min: 12,
    offset_ratio: 0.02,
    container_margin_min: 40,
    container_margin_ratio: 0.08,
    text_inset_min: 18,
    text_inset_ratio: 0.04,
    overlay_height_min: 280,
  }),
});

const DEFAULT_TEXT_TO_IMAGE_MODEL = 'NANOBANANA2';
const CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX = 'CUSTOM_TEXT_TO_IMAGE:';
const WAN_27_PRO_TEXT_TO_IMAGE_MODEL = 'WAN2.7PRO';
const WAN_27_PRO_TEXT_TO_IMAGE_RESOLUTION = '1K';
const WAN_27_PRO_TEXT_TO_IMAGE_ASPECT_RATIOS = Object.freeze(['1:1', '16:9', '9:16']);
const SUPPORTED_TEXT_TO_IMAGE_MODELS = Object.freeze([
  'GPTIMAGE2',
  'NANOBANANA2',
  'NANOBANANAPRO',
  'SEEDREAM',
  WAN_27_PRO_TEXT_TO_IMAGE_MODEL,
]);
const ROLLUP_FETCH_RETRIES = Number.isFinite(Number(process.env.ROLLUP_FETCH_RETRIES))
  ? Math.max(0, Math.floor(Number(process.env.ROLLUP_FETCH_RETRIES)))
  : 4;
const ROLLUP_FETCH_RETRY_DELAY_MS = Number.isFinite(Number(process.env.ROLLUP_FETCH_RETRY_DELAY_MS))
  ? Math.max(0, Math.floor(Number(process.env.ROLLUP_FETCH_RETRY_DELAY_MS)))
  : 800;
const ROLLUP_FETCH_TIMEOUT_MS = Number.isFinite(Number(process.env.ROLLUP_FETCH_TIMEOUT_MS))
  ? Math.max(0, Math.floor(Number(process.env.ROLLUP_FETCH_TIMEOUT_MS)))
  : 120000;
const ROLLUP_FETCH_TIMEOUT_MAX_MS = Number.isFinite(Number(process.env.ROLLUP_FETCH_TIMEOUT_MAX_MS))
  ? Math.max(0, Math.floor(Number(process.env.ROLLUP_FETCH_TIMEOUT_MAX_MS)))
  : 300000;
const ROLLUP_FETCH_CONCURRENCY = Number.isFinite(Number(process.env.ROLLUP_FETCH_CONCURRENCY))
  ? Math.max(1, Math.floor(Number(process.env.ROLLUP_FETCH_CONCURRENCY)))
  : 4;
const ROLLUP_ENHANCE_POLL_INTERVAL_MS = Number.isFinite(Number(process.env.ROLLUP_ENHANCE_POLL_INTERVAL_MS))
  ? Math.max(1000, Math.floor(Number(process.env.ROLLUP_ENHANCE_POLL_INTERVAL_MS)))
  : 5000;
const ROLLUP_ENHANCE_TIMEOUT_MS = Number.isFinite(Number(process.env.ROLLUP_ENHANCE_TIMEOUT_MS))
  ? Math.max(10000, Math.floor(Number(process.env.ROLLUP_ENHANCE_TIMEOUT_MS)))
  : 15 * 60 * 1000;
const ROLLUP_ENHANCE_RESOLUTION_STEPS = [
  { key: '1K', size: 1024 },
  { key: '2K', size: 2048 },
  { key: '4K', size: 4096 },
];

const ensureSvgOverlaySupport = () => {
  const svgSupport = sharp.format?.svg?.input?.buffer;
  if (!svgSupport) {
    const err = new Error('SVG input is not supported by sharp in this runtime; text overlays cannot be rendered.');
    console.error('[rollup_banner] missing SVG support in sharp', {
      sharpFormats: sharp.format?.svg,
      sharpVersion: sharp.versions,
    });
    throw err;
  }
};

function createBadRequestError(message) {
  const error = new Error(message);
  error.status = 400;
  error.statusCode = 400;
  return error;
}

export function normalizeTextToImageRequestOptions(payload = {}) {
  const modelValue = payload.model || payload.mode;
  const rawModel = typeof modelValue === 'string' ? modelValue.trim() : '';
  const isCustomModel = rawModel.startsWith(CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX) &&
    rawModel.length > CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX.length;
  const model = isCustomModel
    ? rawModel
    : rawModel
      ? rawModel.toUpperCase()
      : DEFAULT_TEXT_TO_IMAGE_MODEL;
  if (isCustomModel && !isStandaloneEdition()) {
    throw createBadRequestError('Custom text-to-image models are only available in standalone deployments.');
  }
  if (!isCustomModel && !SUPPORTED_TEXT_TO_IMAGE_MODELS.includes(model)) {
    throw createBadRequestError(`model must be one of: ${SUPPORTED_TEXT_TO_IMAGE_MODELS.join(', ')}.`);
  }

  const requestedAspectRatio = payload.aspect_ratio || payload.aspectRatio;
  const hasRequestedAspectRatio = requestedAspectRatio !== undefined &&
    requestedAspectRatio !== null &&
    !(typeof requestedAspectRatio === 'string' && requestedAspectRatio.trim() === '');
  const normalizedRequestedAspectRatio = normalizeAspectRatio(requestedAspectRatio);
  const aspectRatio = normalizedRequestedAspectRatio || '1:1';

  if (model !== WAN_27_PRO_TEXT_TO_IMAGE_MODEL) {
    return { model, aspectRatio, resolution: null };
  }

  if (hasRequestedAspectRatio && (
    !normalizedRequestedAspectRatio ||
    !WAN_27_PRO_TEXT_TO_IMAGE_ASPECT_RATIOS.includes(normalizedRequestedAspectRatio)
  )) {
    throw createBadRequestError(
      `Wan2.7 Pro aspect_ratio must be one of: ${WAN_27_PRO_TEXT_TO_IMAGE_ASPECT_RATIOS.join(', ')}.`,
    );
  }

  const requestedResolution = payload.resolution;
  const hasRequestedResolution = requestedResolution !== undefined &&
    requestedResolution !== null &&
    !(typeof requestedResolution === 'string' && requestedResolution.trim() === '');
  if (hasRequestedResolution && (
    typeof requestedResolution !== 'string' ||
    requestedResolution.trim().toUpperCase() !== WAN_27_PRO_TEXT_TO_IMAGE_RESOLUTION
  )) {
    throw createBadRequestError('Wan2.7 Pro resolution must be 1K.');
  }

  return {
    model,
    aspectRatio,
    resolution: WAN_27_PRO_TEXT_TO_IMAGE_RESOLUTION,
  };
}

/**
 * Update an image set for a user.
 * This is a scaffold; core logic will be implemented later.
 * @param {Object} payload
 * @param {string[]} payload.image_urls
 * @param {number|string} payload.num_images - total images to generate in the output
 * @param {Object} [payload.metadata]
 * @param {string} [payload.aspect_ratio]
 * @param {string} [payload.userId]
 */
export async function updateImageSet(payload = {}) {
  const {
    image_urls,
    metadata = {},
    userId,
    prompt: userPrompt = '',
    num_images,
    aspect_ratio,
  } = payload;


  if (!userId) {
    throw new Error('userId is required.');
  }

  if (!Array.isArray(image_urls) || image_urls.length === 0 || image_urls.some(url => typeof url !== 'string' || url.trim() === '')) {
    throw new Error('image_urls must be a non-empty array of strings.');
  }

  const normalizedMetadata = isPlainObject(metadata) ? metadata : {};
  const imageCount = image_urls.length;
  const numImagesRaw = num_images;
  const numImagesRequested = Number(numImagesRaw);
  const normalizedAspectRatio = normalizeAspectRatio(aspect_ratio) || '1:1';

  if (!Number.isFinite(numImagesRequested) || numImagesRequested <= 0) {
    throw new Error('num_images must be a positive number.');
  }

  const pricing = getExtendImageListPricing(numImagesRequested);

  const creditResult = await deductGenerationCredits(userId, pricing.credits, {
    source: 'image_update_set',
    metadata: {
      imageCount,
      targetImageCount: numImagesRequested,
      pricing,
      requestType: 'API',
    },
  });

  await getDBConnectionString();

  const userData = await User.findById(userId).select('selectedInferenceModel').lean();
  const selectedInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  const trimmedImageUrls = image_urls.map((url) => url.trim());
  const imageDescriptions = await getDescriptionsForImageList(
    trimmedImageUrls,
    selectedInferenceModel,
  );
  const generatedPrompt = await generatePromptForImageSet({
    metadata: normalizedMetadata,
    userPrompt,
    numImages: numImagesRequested,
    imageDescriptions,
    inferenceModel: selectedInferenceModel,
  });


  const generationPayload = new ImageGeneration({
    editStatus: 'INIT',
    apiEditStatus: 'INIT',
    rowLocked: false,
    operationType: 'EDIT',
    model: payload?.mode || 'NANOBANANA2EDIT',
    requestType: 'API',
    prompt: generatedPrompt,
    aspectRatio: normalizedAspectRatio,
    case_type: 'image_list_to_image_set',
    image_urls: trimmedImageUrls,
    numImages: numImagesRequested,
    metadata: normalizedMetadata,
    userId,
  });

  const doc = await generationPayload.save({});

  await upsertGlobalSessionMapping({
    sessionId: doc._id,
    sessionType: 'image',
    requestId: doc._id,
    provider: 'NANOBANANA2',
    userId,
    status: 'PENDING',
    metadata: normalizedMetadata,
    inputUrls: trimmedImageUrls,
    requestType: 'API',
    sessionSubType: 'image_list_to_image_set',
    apiSessionId: doc._id,
  });

  return {
    status: 'queued',
    request_id: doc._id.toString(),
    session_id: doc._id.toString(),
    global_status_id: doc._id.toString(),
    case_type: 'image_list_to_image_set',
    image_urls: trimmedImageUrls,
    metadata: normalizedMetadata,
    prompt: generatedPrompt,
    num_images: numImagesRequested,
    aspect_ratio: normalizedAspectRatio,
    userId,
    creditsCharged: pricing.credits,
    remainingCredits: creditResult.remainingCredits,
  };
}

export async function generateTextToImage(payload = {}) {
  const {
    prompt,
    aspect_ratio,
    aspectRatio,
    model,
    mode,
    resolution,
    num_images,
    numImages,
    metadata = {},
    userId,
  } = payload;

  if (!userId) {
    throw new Error('userId is required.');
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('prompt is required.');
  }

  const requestedImagesRaw = num_images ?? numImages ?? 1;
  const requestedImages = Number(requestedImagesRaw);
  if (!Number.isFinite(requestedImages) || requestedImages <= 0) {
    throw new Error('num_images must be a positive number when provided.');
  }

  const normalizedMetadata = isPlainObject(metadata) ? metadata : {};
  const {
    model: normalizedModel,
    aspectRatio: normalizedAspectRatio,
    resolution: normalizedResolution,
  } = normalizeTextToImageRequestOptions({
    model,
    mode,
    aspect_ratio,
    aspectRatio,
    resolution,
  });
  const normalizedRequestMetadata = normalizedResolution
    ? { ...normalizedMetadata, resolution: normalizedResolution }
    : normalizedMetadata;
  const outputImages = Math.max(1, Math.floor(requestedImages));
  const pricing = getTextToImagePricing(outputImages);

  await getDBConnectionString();
  if (normalizedModel.startsWith(CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX)) {
    const adapterId = normalizedModel.slice(CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX.length);
    const ownsAdapter = await User.exists({
      _id: userId,
      custom_adapters: {
        $ne: null,
      },
      'custom_adapters.custom_endpoints': {
        $elemMatch: {
          id: adapterId,
          operation: 'text_to_image',
          generate_url: { $type: 'string' },
        },
      },
    });
    if (!ownsAdapter) {
      throw createBadRequestError('The selected custom text-to-image model is not configured for this user.');
    }
  }

  const creditResult = await deductGenerationCredits(userId, pricing.credits, {
    source: 'image_text_to_image',
    metadata: {
      model: normalizedModel,
      aspectRatio: normalizedAspectRatio,
      ...(normalizedResolution ? { resolution: normalizedResolution } : {}),
      requestedImages: outputImages,
      pricing,
      requestType: 'API',
    },
  });

  const normalizedPrompt = prompt.trim();
  const generationPayload = new ImageGeneration({
    generationStatus: 'INIT',
    apiGenerationStatus: 'INIT',
    rowLocked: false,
    operationType: 'GENERATE',
    model: normalizedModel,
    requestType: 'API',
    prompt: normalizedPrompt,
    originalRetryPrompt: normalizedPrompt,
    originalImageGenerationPrompt: normalizedPrompt,
    originalImageGenerationPromptSource: 'api_text_to_image',
    aspectRatio: normalizedAspectRatio,
    ...(normalizedResolution ? { resolution: normalizedResolution } : {}),
    case_type: 'text_to_image',
    numImages: outputImages,
    metadata: normalizedRequestMetadata,
    userId,
  });

  const doc = await generationPayload.save({});

  await upsertGlobalSessionMapping({
    sessionId: doc._id,
    sessionType: 'image',
    requestId: doc._id,
    provider: normalizedModel,
    userId,
    status: 'PENDING',
    metadata: {
      ...normalizedRequestMetadata,
      prompt: normalizedPrompt,
      aspectRatio: normalizedAspectRatio,
      requestedImages: outputImages,
    },
    requestType: 'API',
    sessionSubType: 'text_to_image',
    apiSessionId: doc._id,
  });

  return {
    status: 'queued',
    request_id: doc._id.toString(),
    session_id: doc._id.toString(),
    global_status_id: doc._id.toString(),
    case_type: 'text_to_image',
    model: normalizedModel,
    prompt: normalizedPrompt,
    aspect_ratio: normalizedAspectRatio,
    ...(normalizedResolution ? { resolution: normalizedResolution } : {}),
    num_images: outputImages,
    userId,
    creditsCharged: pricing.credits,
    remainingCredits: creditResult.remainingCredits,
  };
}

/**
 * Remove visible text from a single image.
 * @param {Object} payload
 * @param {string} payload.image_url
 * @param {string} [payload.userId]
 */
export async function removeBrandingFromImage(payload = {}) {
  const { image_url, userId } = payload;


  if (!userId) {
    throw new Error('userId is required.');
  }

  if (!image_url || typeof image_url !== 'string' || image_url.trim() === '') {
    throw new Error('image_url is required.');
  }

  const pricing = getRemoveBrandingFromImagePricing();

  const creditResult = await deductGenerationCredits(userId, pricing.credits, {
    source: 'image_remove_branding',
    metadata: {
      imageUrl: image_url.trim(),
      pricing,
      requestType: 'API',
    },
  });

  await getDBConnectionString();

  const normalizedImageUrl = image_url.trim();
  const aspectRatio = await determineAspectRatioFromImage(normalizedImageUrl);

  const generationPayload = new ImageGeneration({
    editStatus: 'INIT',
    apiEditStatus: 'INIT',
    rowLocked: false,
    operationType: 'EDIT',
    model: 'NANOBANANA2EDIT',
    requestType: 'API',
    prompt: 'Remove all visible text from the image. Preserve the original scene, objects, colors, lighting, and composition. Fill edited areas naturally using surrounding visual details. Do not add new text or other elements.',
    aspectRatio,
    case_type: 'logo_remove',
    image: normalizedImageUrl,
    userId,
  });

  const doc = await generationPayload.save({});

  await upsertGlobalSessionMapping({
    sessionId: doc._id,
    sessionType: 'image',
    requestId: doc._id,
    provider: 'NANOBANANA2',
    userId,
    status: 'PENDING',
    inputUrl: normalizedImageUrl,
    requestType: 'API',
    sessionSubType: 'logo_remove',
    apiSessionId: doc._id,
  });

  return {
    status: 'queued',
    request_id: doc._id.toString(),
    session_id: doc._id.toString(),
    global_status_id: doc._id.toString(),
    case_type: 'logo_remove',
    image_url: normalizedImageUrl,
    userId,
    creditsCharged: pricing.credits,
    remainingCredits: creditResult.remainingCredits,
  };
}

export async function enhanceImage(payload = {}) {
  const {
    image_url,
    resolution = '1K',
    userId,
    mode = 'NANOBANANA2EDIT',
    aspect_ratio,
  } = payload;

  if (!userId) {
    throw new Error('userId is required.');
  }

  if (!image_url || typeof image_url !== 'string' || image_url.trim() === '') {
    throw new Error('image_url is required.');
  }

  const normalizedResolution = normalizeResolution(resolution);
  const normalizedAspectRatio = normalizeAspectRatio(aspect_ratio) || '16:9';
  const pricing = getEnhanceImagePricing(normalizedResolution);

  const creditResult = await deductGenerationCredits(userId, pricing.credits, {
    source: 'image_enhance',
    metadata: {
      imageUrl: image_url.trim(),
      resolution: normalizedResolution,
      aspectRatio: normalizedAspectRatio,
      pricing,
      requestType: 'API',
    },
  });

  await getDBConnectionString();

  const normalizedImageUrl = image_url.trim();
  const prompt = `Upscale and enhance this image to ${normalizedResolution}`;

  const generationPayload = new ImageGeneration({
    editStatus: 'INIT',
    apiEditStatus: 'INIT',
    rowLocked: false,
    operationType: 'EDIT',
    model: mode || 'NANOBANANA2EDIT',
    requestType: 'API',
 
    aspectRatio: normalizedAspectRatio,
    case_type: 'image_enhance',
    image: normalizedImageUrl,
    image_urls: [normalizedImageUrl],
    resolution: normalizedResolution,
    userId,
  });
  
  const doc = await generationPayload.save({});

  await upsertGlobalSessionMapping({
    sessionId: doc._id,
    sessionType: 'image',
    requestId: doc._id,
    provider: 'NANOBANANA2',
    userId,
    status: 'PENDING',
    metadata: { resolution: normalizedResolution, aspectRatio: normalizedAspectRatio },
    inputUrl: normalizedImageUrl,
    requestType: 'API',
    sessionSubType: 'image_enhance',
    apiSessionId: doc._id,
  });

  return {
    status: 'queued',
    request_id: doc._id.toString(),
    session_id: doc._id.toString(),
    global_status_id: doc._id.toString(),
    case_type: 'image_enhance',
    image_url: normalizedImageUrl,
    resolution: normalizedResolution,
    aspect_ratio: normalizedAspectRatio,
    userId,
    creditsCharged: pricing.credits,
    remainingCredits: creditResult.remainingCredits,
  };
}

export async function getImageStatus({ requestId, userId }) {
  if (!requestId || typeof requestId !== 'string') {
    const error = new Error('request_id (or session_id) query param is required.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedUserId = userId?.toString();
  await getDBConnectionString();

  const normalizedId = requestId.toString();
  let globalSession = await GlobalSession.findOne({ sessionType: 'image', sessionId: normalizedId });

  if (!globalSession) {
    globalSession = await GlobalSession.findOne({ sessionType: 'image', requestId: normalizedId });
  }

  if (globalSession?.userId && normalizedUserId && globalSession.userId.toString() !== normalizedUserId) {
    const error = new Error('Request not found.');
    error.statusCode = 404;
    throw error;
  }

  let imageDoc = null;
  const globalSessionId = globalSession?.sessionId?.toString() || null;
  const hasGlobalObjectId = Boolean(globalSessionId && mongoose.Types.ObjectId.isValid(globalSessionId));
  const hasRequestObjectId = Boolean(normalizedId && mongoose.Types.ObjectId.isValid(normalizedId));

  if (globalSessionId && hasGlobalObjectId) {
    imageDoc = await ImageGeneration.findById(globalSessionId);
  } else if (hasRequestObjectId) {
    imageDoc = await ImageGeneration.findById(normalizedId);
  }

  if (imageDoc?.userId && normalizedUserId && imageDoc.userId.toString() !== normalizedUserId) {
    const error = new Error('Request not found.');
    error.statusCode = 404;
    throw error;
  }

  if (!globalSession && !imageDoc) {
    const error = new Error('Request not found.');
    error.statusCode = 404;
    throw error;
  }

  const status = resolveImageStatus(imageDoc, globalSession?.status);

  return buildImageStatusPayload({
    globalSession,
    imageDoc,
    status,
  });
}

export async function listImageSessions({
  userId,
  limit,
  caseType,
  rollupReadyOnly = false,
  includeRollupReady = false,
}) {
  if (!userId) {
    const error = new Error('userId is required to list sessions.');
    error.statusCode = 401;
    throw error;
  }

  const normalizedUserId = userId?.toString();
  await getDBConnectionString();

  const normalizedLimit = Number(limit);
  const cappedLimit = Number.isFinite(normalizedLimit) && normalizedLimit > 0
    ? Math.min(Math.floor(normalizedLimit), 500)
    : null;

  const query = {
    sessionType: 'image',
    userId: normalizedUserId,
    $or: [
      { requestType: 'API' },
      { requestType: { $exists: false } },
      { requestType: null },
    ],
  };
  if (typeof caseType === 'string' && caseType.trim().length > 0) {
    query.sessionSubType = caseType.trim();
  }

  const sessionQuery = GlobalSession.find(query).sort({ createdAt: -1 });
  if (cappedLimit) {
    sessionQuery.limit(cappedLimit);
  }

  const sessions = await sessionQuery.lean();

  if (!sessions.length) {
    return [];
  }

  const sessionIds = sessions.map((s) => s?.sessionId?.toString()).filter(Boolean);
  const imageDocs = sessionIds.length
    ? await ImageGeneration.find({ _id: { $in: sessionIds } })
    : [];

  const imageMap = new Map(
    imageDocs.map((doc) => [doc._id.toString(), doc])
  );

  const payloads = sessions.map((session) => {
    const imageDoc = imageMap.get(session.sessionId?.toString());
    const status = resolveImageStatus(imageDoc, session.status);

    return buildImageStatusPayload({
      globalSession: session,
      imageDoc,
      status,
      includeTimestamps: true,
    });
  });

  if (!rollupReadyOnly && !includeRollupReady) {
    return payloads;
  }

  const withRollupReady = await Promise.all(
    payloads.map(async (payload) => {
      const resultUrl = payload.result_url || (Array.isArray(payload.result_urls) ? payload.result_urls[0] : null);
      const shouldCheck = payload.status === 'COMPLETED' && typeof resultUrl === 'string';
      const rollupReady = shouldCheck ? await isRollupXLReady(resultUrl) : false;
      if (includeRollupReady) {
        payload.rollup_ready = rollupReady;
      }
      if (rollupReadyOnly && !rollupReady) {
        return null;
      }
      return payload;
    })
  );

  return withRollupReady.filter(Boolean);
}

function getRollupImageUrl(item) {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    return trimmed.length ? trimmed : null;
  }
  if (!item || typeof item !== 'object') return null;

  const candidates = [
    item.enhanced_url,
    item.image_url,
    item.imageUrl,
    item.url,
    item.image,
    item.src,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length) return trimmed;
    }
  }

  return null;
}

function normalizeRollupImagesFromPayload(payload = {}) {
  const { images, image_list, image_urls } = payload || {};
  const inputImagesRaw = Array.isArray(images)
    ? images
    : Array.isArray(image_list)
      ? image_list
      : Array.isArray(image_urls)
        ? image_urls
        : null;

  if (!inputImagesRaw || !inputImagesRaw.length) {
    throw new Error('images (or image_list/image_urls) must be a non-empty array.');
  }

  const normalizedImages = [];
  let invalidCount = 0;

  inputImagesRaw.forEach((item) => {
    const url = getRollupImageUrl(item);
    if (!url) {
      invalidCount += 1;
      return;
    }
    const sourceItem = item && typeof item === 'object' ? item : { image_url: url };
    const imageDuration = normalizeDurationMinutes(sourceItem.image_duration);
    const imageCategory = normalizeOverlayValue(sourceItem.image_category);
    const overlay = resolveOverlayFields({
      ...sourceItem,
      overlay: sourceItem.overlay,
      image_duration: imageDuration,
      image_category: imageCategory,
    });
    const imageText =
      normalizeOverlayValue(overlay.footer) ||
      normalizeOverlayValue(sourceItem.image_text) ||
      normalizeOverlayValue(sourceItem.image_title) ||
      normalizeOverlayValue(sourceItem.title) ||
      normalizeOverlayValue(sourceItem.name);
    const normalizedOverlay = {
      ...overlay,
      footer: overlay.footer || imageText,
      bottom: overlay.footer || imageText,
    };
    normalizedImages.push({
      image_url: url,
      image_text: imageText,
      image_category: imageCategory,
      image_duration: imageDuration,
      activity_id: typeof sourceItem.activity_id === 'number' ? sourceItem.activity_id : null,
      overlay: normalizedOverlay,
    });
  });

  return {
    inputImagesRaw,
    normalizedImages,
    invalidCount,
  };
}

export async function createRollupBanner(payload = {}) {
  const {
    images,
    image_list,
    image_urls,
    header_image_url,
    footer_image_url,
    image_tiling_position,
    userId,
    max_tiles,
    columns,
  } = payload || {};

  let stage = 'init';
  let sessionId = null;
  let inputImagesRaw = null;
  let normalizedImages = null;
  let invalidCount = 0;
  let cols = null;
  let tileCount = null;
  let tilingPosition = DEFAULT_ROLLUP_IMAGE_TILING_POSITION;

  try {
    stage = 'validate_user';
    if (!userId) {
      throw new Error('userId is required.');
    }

    stage = 'validate_tiling_position';
    tilingPosition = resolveImageTilingPosition(image_tiling_position);

    stage = 'normalize_images';
    inputImagesRaw = Array.isArray(images)
      ? images
      : Array.isArray(image_list)
        ? image_list
        : Array.isArray(image_urls)
          ? image_urls
          : null;
    if (!inputImagesRaw || !inputImagesRaw.length) {
      throw new Error('images (or image_list/image_urls) must be a non-empty array.');
    }

    normalizedImages = [];
    invalidCount = 0;
    inputImagesRaw.forEach((item) => {
      const url = getRollupImageUrl(item);
      if (!url) {
        invalidCount += 1;
        return;
      }
      const sourceItem = item && typeof item === 'object' ? item : { image_url: url };
      const imageDuration = normalizeDurationMinutes(sourceItem.image_duration);
      const imageCategory = normalizeOverlayValue(sourceItem.image_category);
      const overlay = resolveOverlayFields({
        ...sourceItem,
        overlay: sourceItem.overlay,
        image_duration: imageDuration,
        image_category: imageCategory,
      });
      const imageText =
        normalizeOverlayValue(overlay.footer) ||
        normalizeOverlayValue(sourceItem.image_text) ||
        normalizeOverlayValue(sourceItem.image_title) ||
        normalizeOverlayValue(sourceItem.title) ||
        normalizeOverlayValue(sourceItem.name);
      const normalizedOverlay = {
        ...overlay,
        footer: overlay.footer || imageText,
        bottom: overlay.footer || imageText,
      };
      normalizedImages.push({
        image_url: url,
        image_text: imageText,
        image_category: imageCategory,
        image_duration: imageDuration,
        activity_id: typeof sourceItem.activity_id === 'number' ? sourceItem.activity_id : null,
        overlay: normalizedOverlay,
      });
    });

    if (!normalizedImages.length) {
      console.error('[rollup_banner] no valid images provided', {
        total: inputImagesRaw.length,
        invalidCount,
      });
      throw new Error('No valid images provided.');
    }

    stage = 'resolve_header_footer';
    const headerImageUrl = typeof header_image_url === 'string' && header_image_url.trim().length
      ? header_image_url.trim()
      : null;
    const footerImageUrl = typeof footer_image_url === 'string' && footer_image_url.trim().length
      ? footer_image_url.trim()
      : null;

    stage = 'init_session';
    sessionId = randomUUID();
    const requestedCols = Number(columns) > 0 ? Math.max(1, Math.min(6, Number(columns))) : ROLLUP_COLUMNS;
    cols = Math.min(TILE_COLUMN_WIDTHS.length, requestedCols);
    tileCount = Number(max_tiles) > 0 ? Math.min(ROLLUP_MAX_IMAGES, Number(max_tiles)) : ROLLUP_MAX_IMAGES;

    stage = 'deduct_credits';
    const creditResult = await deductGenerationCredits(userId, ROLLUP_BANNER_CREDITS, {
      source: 'image_rollup_banner',
      metadata: {
        tileCount,
        columns: cols,
        requestType: 'API',
      },
    });

    stage = 'db_connect';
    await getDBConnectionString();

    stage = 'session_upsert';
    await upsertGlobalSessionMapping({
      sessionId,
      sessionType: 'image',
      requestId: sessionId,
      provider: 'ROLLUP',
      userId,
      metadata: { tileCount, columns: cols },
      status: 'PROCESSING',
      inputUrls: normalizedImages.map((i) => i.image_url),
      requestType: 'API',
      sessionSubType: 'rollup_banner',
    });

    try {
      stage = 'prepare_tiles';
      const finalImages = [];
      for (let i = 0; i < tileCount; i += 1) {
        finalImages.push(normalizedImages[i % normalizedImages.length]);
      }

      stage = 'build_tiles';
      const layout = computeTileLayout(cols);
      const imageFetcher = createRollupImageFetcher({
        concurrency: ROLLUP_FETCH_CONCURRENCY,
        retries: ROLLUP_FETCH_RETRIES,
        retryDelayMs: ROLLUP_FETCH_RETRY_DELAY_MS,
        timeoutMs: ROLLUP_FETCH_TIMEOUT_MS,
        timeoutMsMax: ROLLUP_FETCH_TIMEOUT_MAX_MS,
        context: { sessionId },
      });
      await prefetchRollupImages(normalizedImages.map((img) => img.image_url), imageFetcher, { sessionId });
      const topBuffer = await buildTopSection(headerImageUrl);
      ensureSvgOverlaySupport();
      const thumbnailPromise = buildAndUploadRollupThumbnail({
        sessionId,
        images: finalImages,
        headerImageUrl,
        footerImageUrl,
        columns: cols,
        tilingPosition,
        fetcher: imageFetcher,
      });
      let fallbackTileCount = 0;
      const tiles = await Promise.all(
        finalImages.map(async (img, idx) => {
          const col = idx % layout.cols;
          try {
            return await buildTile(img, col, layout, {
              includeOverlays: false,
              fetcher: imageFetcher,
              logContext: { sessionId, tileIndex: idx, column: col },
            });
          } catch (tileErr) {
            const overlay = resolveOverlayFields(img);
            console.error('[rollup_banner] tile build failed', {
              sessionId,
              tileIndex: idx,
              column: col,
              imageUrl: img?.image_url,
              overlay,
              error: tileErr,
              stack: tileErr?.stack,
            });
            fallbackTileCount += 1;
            return buildFallbackTile(col, layout);
          }
        })
      );
      stage = 'build_grid';
      const grid = await buildGrid(tiles, finalImages, layout);
      stage = 'apply_overlays';
      const gridWithOverlays = await applyGridOverlays(grid, finalImages, layout, {
        sessionId,
        tilingPosition,
      });
      stage = 'apply_edge_rounding';
      const roundedGrid = await applyStaggeredEdgeRounding(gridWithOverlays, finalImages, layout);
      stage = 'build_footer';
      const footer = await buildFooter(footerImageUrl);
      stage = 'compose_banner';
      const bannerBuffer = await composeBanner(topBuffer, roundedGrid, footer);

      stage = 'upload_banner';
      const key = `${ROLLUP_FOLDER}/rollup-${sessionId}.png`;
      // Use region-aware upload to avoid endpoint mismatch for the rollup bucket.
      const resultUrl = await uploadBufferToS3WithRegion({
        bucketName: ROLLUP_BUCKET,
        key,
        buffer: bannerBuffer,
        contentType: 'image/png',
      });

      let thumbnailUrl = await thumbnailPromise;
      if (!thumbnailUrl) {
        try {
          stage = 'build_thumbnail';
          const thumbnailBuffer = await sharp(bannerBuffer)
            .resize({
              width: ROLLUP_THUMBNAIL_MAX_WIDTH,
              height: ROLLUP_THUMBNAIL_MAX_HEIGHT,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .png()
            .toBuffer();
          stage = 'upload_thumbnail';
          const thumbnailKey = `${ROLLUP_FOLDER}/rollup-${sessionId}-thumb.png`;
          thumbnailUrl = await uploadBufferToS3WithRegion({
            bucketName: ROLLUP_BUCKET,
            key: thumbnailKey,
            buffer: thumbnailBuffer,
            contentType: 'image/png',
          });
        } catch (thumbError) {
          console.error('[rollup_banner] thumbnail generation failed', {
            sessionId,
            error: thumbError?.message,
            stack: thumbError?.stack,
          });
        }
      }
      if (!thumbnailUrl) {
        thumbnailUrl = resultUrl;
      }

      stage = 'finalize_session';
      await upsertGlobalSessionMapping({
        sessionId,
        sessionType: 'image',
        requestId: sessionId,
        provider: 'ROLLUP',
        userId,
        status: 'COMPLETED',
        resultUrl,
        resultUrls: [resultUrl],
        thumbnailUrl,
        requestType: 'API',
        sessionSubType: 'rollup_banner',
      });

      return {
        status: 'completed',
        session_id: sessionId,
        request_id: sessionId,
        result_url: resultUrl,
        result_urls: [resultUrl],
        thumbnail_url: thumbnailUrl,
        creditsCharged: ROLLUP_BANNER_CREDITS,
        remainingCredits: creditResult.remainingCredits,
      };
    } catch (error) {
      await upsertGlobalSessionMapping({
        sessionId,
        sessionType: 'image',
        requestId: sessionId,
        provider: 'ROLLUP',
        userId,
        status: 'FAILED',
        errorMessage: error?.message || 'Rollup banner failed',
        requestType: 'API',
        sessionSubType: 'rollup_banner',
      });
      console.error('[rollup_banner] generation failed', {
        sessionId,
        userId,
        stage,
        error: error?.message,
        stack: error?.stack,
      });
      throw error;
    }
  } catch (error) {
    console.error('[rollup_banner] request failed', {
      sessionId,
      userId,
      stage,
      imageCount: Array.isArray(inputImagesRaw) ? inputImagesRaw.length : null,
      normalizedCount: Array.isArray(normalizedImages) ? normalizedImages.length : null,
      invalidCount,
      error: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
}

export async function enhanceAndGenerateRollupBanner(payload = {}) {
  const { userId } = payload || {};

  if (!userId) {
    throw new Error('userId is required.');
  }

  const tilingPosition = resolveImageTilingPosition(payload?.image_tiling_position);
  const normalizedPayload = { ...(payload || {}), image_tiling_position: tilingPosition };
  const { inputImagesRaw, normalizedImages, invalidCount } = normalizeRollupImagesFromPayload(payload);

  if (!normalizedImages.length) {
    console.error('[rollup_banner_enhance] no valid images provided', {
      total: inputImagesRaw.length,
      invalidCount,
    });
    throw new Error('No valid images provided.');
  }

  const sessionId = randomUUID();
  const sessionMetadata = { batchId: sessionId, imageCount: normalizedImages.length };

  await getDBConnectionString();
  await upsertGlobalSessionMapping({
    sessionId,
    sessionType: 'image',
    requestId: sessionId,
    provider: 'ROLLUP',
    userId,
    metadata: sessionMetadata,
    status: 'PENDING',
    inputUrls: normalizedImages.map((item) => item.image_url),
    requestType: 'API',
    sessionSubType: 'rollup_banner_enhance',
  });

  void processEnhanceAndGenerateRollupBanner({
    sessionId,
    payload: normalizedPayload,
    inputImagesRaw,
    normalizedImages,
    invalidCount,
    sessionMetadata,
  }).catch((error) => {
    console.error('[rollup_banner_enhance] async processing failed', {
      sessionId,
      userId,
      error: error?.message || error,
      stack: error?.stack,
    });
  });

  return {
    status: 'queued',
    request_id: sessionId,
    session_id: sessionId,
    case_type: 'rollup_banner_enhance',
  };
}

async function processEnhanceAndGenerateRollupBanner({
  sessionId,
  payload = {},
  inputImagesRaw: providedInputImagesRaw,
  normalizedImages: providedNormalizedImages,
  invalidCount: providedInvalidCount,
  sessionMetadata: providedSessionMetadata,
}) {
  const {
    images,
    image_list,
    image_urls,
    header_image_url,
    footer_image_url,
    image_tiling_position,
    userId,
    columns,
  } = payload || {};

  let stage = 'init';
  let inputImagesRaw = providedInputImagesRaw;
  let normalizedImages = providedNormalizedImages;
  let invalidCount = Number.isFinite(providedInvalidCount) ? providedInvalidCount : 0;
  const batchId = sessionId;
  const sessionMetadata = providedSessionMetadata || { batchId };
  const enhanceTasks = [];
  let enhanceCreditsCharged = 0;

  try {
    stage = 'validate_user';
    if (!userId) {
      throw new Error('userId is required.');
    }

    if (!normalizedImages) {
      stage = 'normalize_images';
      const normalizedResult = normalizeRollupImagesFromPayload({
        images,
        image_list,
        image_urls,
      });
      inputImagesRaw = normalizedResult.inputImagesRaw;
      normalizedImages = normalizedResult.normalizedImages;
      invalidCount = normalizedResult.invalidCount;

      if (!normalizedImages.length) {
        console.error('[rollup_banner_enhance] no valid images provided', {
          total: inputImagesRaw.length,
          invalidCount,
        });
        throw new Error('No valid images provided.');
      }
    }

    stage = 'session_upsert';
    sessionMetadata.imageCount = normalizedImages.length;
    await getDBConnectionString();
    await upsertGlobalSessionMapping({
      sessionId,
      sessionType: 'image',
      requestId: sessionId,
      provider: 'ROLLUP',
      userId,
      metadata: sessionMetadata,
      status: 'PROCESSING',
      inputUrls: normalizedImages.map((item) => item.image_url),
      requestType: 'API',
      sessionSubType: 'rollup_banner_enhance',
    });

    stage = 'inspect_images';
    const semaphore = createSemaphore(ROLLUP_FETCH_CONCURRENCY);
    const imageChecks = await Promise.all(
      normalizedImages.map(async (image, index) => {
        await semaphore.acquire();
        try {
          const dimensions = await getImageDimensionsFromUrl(image.image_url);
          const rollupReady = meetsRollupXLMinimum(dimensions);
          return {
            index,
            image,
            dimensions,
            rollupReady,
            aspectRatio: resolveAspectRatioFromDimensions(dimensions),
            resolution: rollupReady ? null : resolveEnhanceResolutionForRollup(dimensions),
          };
        } finally {
          semaphore.release();
        }
      })
    );

    const toEnhance = imageChecks.filter((check) => !check.rollupReady);
    sessionMetadata.enhanceRequiredCount = toEnhance.length;

    if (toEnhance.length) {
      stage = 'enqueue_enhancements';
      await upsertGlobalSessionMapping({
        sessionId,
        sessionType: 'image',
        requestId: sessionId,
        provider: 'ROLLUP',
        userId,
        metadata: sessionMetadata,
        status: 'PROCESSING',
        requestType: 'API',
        sessionSubType: 'rollup_banner_enhance',
      });

      for (const item of toEnhance) {
        const resolution = item.resolution || '4K';
        const aspectRatio = item.aspectRatio || '16:9';
        const enhancePayload = {
          image_url: item.image.image_url,
          resolution,
          aspect_ratio: aspectRatio,
          userId,
          mode: 'NANOBANANA2EDIT',
        };

        const enhanceResponse = await enhanceImage(enhancePayload);
        if (!enhanceResponse?.session_id) {
          throw new Error('Enhancement request did not return a session_id.');
        }
        const charged = Number(enhanceResponse?.creditsCharged);
        enhanceCreditsCharged += Number.isFinite(charged)
          ? charged
          : getEnhanceImagePricing(resolution).credits;

        const taskDoc = await RollupBannerEnhanceTask.create({
          batchId,
          userId: userId.toString(),
          status: 'PENDING',
          position: item.index,
          originalUrl: item.image.image_url,
          resolution,
          aspectRatio,
          dimensions: item.dimensions || undefined,
          enhanceSessionId: enhanceResponse?.session_id,
          enhanceRequestId: enhanceResponse?.request_id,
        });

        enhanceTasks.push({
          taskId: taskDoc?._id?.toString(),
          sessionId: enhanceResponse.session_id.toString(),
          position: item.index,
        });
      }

      stage = 'await_enhancements';
      const enhancedResults = await waitForRollupEnhancements(enhanceTasks, {
        timeoutMs: ROLLUP_ENHANCE_TIMEOUT_MS,
        pollIntervalMs: ROLLUP_ENHANCE_POLL_INTERVAL_MS,
      });

      enhancedResults.forEach((resultUrl, index) => {
        if (!normalizedImages[index]) {
          return;
        }
        normalizedImages[index] = {
          ...normalizedImages[index],
          enhanced_url: resultUrl,
        };
      });
    }

    stage = 'expand_images';
    const inputImageUrls = normalizedImages
      .map((image) => image?.enhanced_url || image?.image_url)
      .filter(Boolean);
    sessionMetadata.inputImageUrls = inputImageUrls;
    const expandedImages = duplicateRollupImagesToCount(normalizedImages, ROLLUP_MAX_IMAGES);

    stage = 'generate_rollup';
    const response = await createRollupBanner({
      images: expandedImages,
      header_image_url,
      footer_image_url,
      userId,
      columns,
      max_tiles: ROLLUP_MAX_IMAGES,
      image_tiling_position,
    });

    const totalCredits = enhanceCreditsCharged + ROLLUP_BANNER_CREDITS;
    sessionMetadata.rollupSessionId = response?.session_id || null;
    sessionMetadata.rollupRequestId = response?.request_id || null;
    await upsertGlobalSessionMapping({
      sessionId,
      sessionType: 'image',
      requestId: sessionId,
      provider: 'ROLLUP',
      userId,
      metadata: sessionMetadata,
      status: 'COMPLETED',
      resultUrl: response?.result_url || null,
      resultUrls: Array.isArray(response?.result_urls) ? response.result_urls : [],
      thumbnailUrl: response?.thumbnail_url || null,
      inputUrls: inputImageUrls,
      requestType: 'API',
      sessionSubType: 'rollup_banner_enhance',
    });

    const finalResponse = {
      ...response,
      session_id: sessionId,
      request_id: sessionId,
      case_type: 'rollup_banner_enhance',
      creditsCharged: totalCredits,
      input_image_urls: inputImageUrls,
    };
    if (response?.session_id) {
      finalResponse.rollup_session_id = response.session_id;
    }
    if (response?.request_id) {
      finalResponse.rollup_request_id = response.request_id;
    }

    return finalResponse;
  } catch (error) {
    try {
      await getDBConnectionString();
      await upsertGlobalSessionMapping({
        sessionId,
        sessionType: 'image',
        requestId: sessionId,
        provider: 'ROLLUP',
        userId,
        metadata: sessionMetadata,
        status: 'FAILED',
        errorMessage: error?.message || 'Rollup banner enhancement failed',
        requestType: 'API',
        sessionSubType: 'rollup_banner_enhance',
      });
    } catch {
    }
    console.error('[rollup_banner_enhance] request failed', {
      userId,
      stage,
      imageCount: Array.isArray(inputImagesRaw) ? inputImagesRaw.length : null,
      normalizedCount: Array.isArray(normalizedImages) ? normalizedImages.length : null,
      invalidCount,
      error: error?.message,
      stack: error?.stack,
    });
  }
}

async function determineAspectRatioFromImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return '1:1';
  }

  try {
    const buffer = await fetchImageBufferWithRetry(imageUrl, {
      retries: 1,
      timeoutMs: ROLLUP_FETCH_TIMEOUT_MS,
      timeoutMsMax: ROLLUP_FETCH_TIMEOUT_MAX_MS,
    });
    const { width, height } = sizeOf(buffer);

    if (!width || !height) {
      throw new Error('Unable to determine image dimensions.');
    }

    const difference = Math.abs(width - height);

    if (difference < 100) {
      return '1:1';
    }
    if (width > height + 100) {
      return '16:9';
    }
    if (height > width + 100) {
      return '9:16';
    }
  } catch {
  }

  return '1:1';
}

function resolveAspectRatioFromDimensions(dimensions) {
  const width = dimensions?.width;
  const height = dimensions?.height;
  if (!width || !height) {
    return null;
  }

  const difference = Math.abs(width - height);
  if (difference < 100) {
    return '1:1';
  }
  if (width > height + 100) {
    return '16:9';
  }
  if (height > width + 100) {
    return '9:16';
  }
  return '1:1';
}

function estimateEnhancedDimensions(dimensions, targetSize) {
  if (!dimensions || !Number.isFinite(targetSize)) {
    return null;
  }
  const width = dimensions.width;
  const height = dimensions.height;
  if (!width || !height) {
    return null;
  }

  if (width <= height) {
    const scale = targetSize / width;
    return {
      width: targetSize,
      height: Math.round(height * scale),
    };
  }

  const scale = targetSize / height;
  return {
    width: Math.round(width * scale),
    height: targetSize,
  };
}

function resolveEnhanceResolutionForRollup(dimensions) {
  for (const step of ROLLUP_ENHANCE_RESOLUTION_STEPS) {
    const estimate = estimateEnhancedDimensions(dimensions, step.size);
    if (meetsRollupXLMinimum(estimate)) {
      return step.key;
    }
  }
  return '4K';
}

function duplicateRollupImagesToCount(images, targetCount) {
  if (!Array.isArray(images) || images.length === 0) {
    return [];
  }
  const count = Number.isFinite(targetCount) && targetCount > 0
    ? Math.floor(targetCount)
    : images.length;
  if (images.length >= count) {
    return images.slice(0, count);
  }
  const expanded = [];
  for (let i = 0; i < count; i += 1) {
    expanded.push(images[i % images.length]);
  }
  return expanded;
}

async function waitForRollupEnhancements(tasks, opts = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return new Map();
  }

  const timeoutMs = Number.isFinite(opts?.timeoutMs) && opts.timeoutMs > 0
    ? Math.floor(opts.timeoutMs)
    : ROLLUP_ENHANCE_TIMEOUT_MS;
  const pollIntervalMs = Number.isFinite(opts?.pollIntervalMs) && opts.pollIntervalMs > 0
    ? Math.floor(opts.pollIntervalMs)
    : ROLLUP_ENHANCE_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  const pending = new Map();
  tasks.forEach((task) => {
    if (task?.sessionId) {
      pending.set(task.sessionId.toString(), task);
    }
  });

  const results = new Map();
  const failures = [];

  await getDBConnectionString();

  while (pending.size > 0 && Date.now() < deadline) {
    const sessionIds = Array.from(pending.keys());
    const sessions = await GlobalSession.find({ sessionId: { $in: sessionIds } }).lean();
    const sessionMap = new Map(
      sessions.map((session) => [session?.sessionId?.toString(), session])
    );

    const updates = [];

    for (const [sessionId, task] of pending.entries()) {
      const session = sessionMap.get(sessionId);
      const status = (session?.status || 'PENDING').toString().toUpperCase();
      if (status === 'COMPLETED') {
        const resultUrl = session?.resultUrl || (Array.isArray(session?.resultUrls) ? session.resultUrls[0] : null);
        if (resultUrl) {
          results.set(task.position, resultUrl);
          pending.delete(sessionId);
          if (task?.taskId) {
            updates.push({
              id: task.taskId,
              update: {
                status: 'COMPLETED',
                enhancedUrl: resultUrl,
              },
            });
          }
        } else {
          pending.delete(sessionId);
          const errorMessage = 'Enhancement completed without a result URL.';
          failures.push({ task, errorMessage });
          if (task?.taskId) {
            updates.push({
              id: task.taskId,
              update: {
                status: 'FAILED',
                errorMessage,
              },
            });
          }
        }
      } else if (status === 'FAILED') {
        pending.delete(sessionId);
        const errorMessage = session?.errorMessage || 'Enhancement failed.';
        failures.push({ task, errorMessage });
        if (task?.taskId) {
          updates.push({
            id: task.taskId,
            update: {
              status: 'FAILED',
              errorMessage,
            },
          });
        }
      }
    }

    if (updates.length) {
      await Promise.all(
        updates.map((item) =>
          RollupBannerEnhanceTask.findByIdAndUpdate(item.id, { $set: item.update })
        )
      );
    }

    if (pending.size > 0) {
      await delay(pollIntervalMs);
    }
  }

  if (pending.size > 0) {
    const updates = Array.from(pending.values())
      .filter((task) => task?.taskId)
      .map((task) => ({
        id: task.taskId,
        update: {
          status: 'TIMEOUT',
          errorMessage: 'Enhancement timed out.',
        },
      }));
    if (updates.length) {
      await Promise.all(
        updates.map((item) =>
          RollupBannerEnhanceTask.findByIdAndUpdate(item.id, { $set: item.update })
        )
      );
    }
    const error = new Error('Enhancement tasks timed out.');
    error.code = 'ENHANCE_TIMEOUT';
    throw error;
  }

  if (failures.length > 0) {
    const error = new Error(`Enhancement failed for ${failures.length} image(s).`);
    error.code = 'ENHANCE_FAILED';
    throw error;
  }

  return results;
}

async function getDescriptionsForImageList(imageUrls = [], inferenceModel) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return [];
  }

  const results = await Promise.all(
    imageUrls.map(async (url) => {
      try {

        const descriptionResult = await getDescriptionForImageToCreateImageList(
          url,
          inferenceModel,
        );

        return descriptionResult;
      } catch {
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

async function generatePromptForImageSet({
  metadata = {},
  userPrompt = '',
  numImages,
  imageDescriptions = [],
  inferenceModel,
}) {
  const numImagesToGenerate = Number(numImages);
  if (!Number.isFinite(numImagesToGenerate) || numImagesToGenerate <= 0) {
    throw new Error('numImages must be a positive number for prompt generation.');
  }
  const hasImageDescriptions = Array.isArray(imageDescriptions) && imageDescriptions.length > 0;

  const systemPrompt = `
 You are a creative assistant for a marketing team. 
 Write one concise prompt for an image generation model to produce exactly ${numImagesToGenerate} images.
 Use the image descriptions of the original input images for styling and thematic guidance. 
 Use the metadata and optional user prompt to keep the set cohesive.
 Keep the language direct, production-ready, and avoid bullet points.
`;

  const parts = [
    `Images requested: ${numImagesToGenerate}`,
    `Metadata: ${JSON.stringify(metadata)}`,
  ];

  if (userPrompt && typeof userPrompt === 'string' && userPrompt.trim()) {
    parts.push(`User prompt: ${userPrompt.trim()}`);
  } else {
    parts.push('No user prompt provided. Create a coherent visual direction using only the metadata and requested count.');
  }

  if (hasImageDescriptions) {
    const formattedDescriptions = imageDescriptions
      .map((desc, idx) => `Image ${idx + 1}: ${desc}`)
      .join('\n');
    parts.push(
      `Here are the input image descriptions. Ensure the generated images match the overall style, theme, and related attributes:\n${formattedDescriptions}`
    );
  } else {
    parts.push('No image descriptions available from the inputs.');
  }

  const fallbackPrompt = userPrompt?.trim()
    ? `Create ${numImagesToGenerate} cohesive images based on this prompt: ${userPrompt.trim()}. Ensure the visuals align with the provided metadata: ${JSON.stringify(metadata)}.`
    : `Create ${numImagesToGenerate} cohesive images that align with the provided metadata: ${JSON.stringify(metadata)}.`;

  const descriptionsAppendix = hasImageDescriptions
    ? ` Use these input image descriptions as style and theme references: ${imageDescriptions.join(' | ')}. Match the overall style, theme, and related attributes.`
    : '';
  const fallbackPromptWithDescriptions = hasImageDescriptions
    ? `${fallbackPrompt}${descriptionsAppendix}`
    : fallbackPrompt;

  const normalizedInferenceModel = normalizeInferenceModel(inferenceModel);
  const usesSelectedNonOpenAIProvider =
    isGeminiInferenceModel(normalizedInferenceModel) ||
    isKimiInferenceModel(normalizedInferenceModel) ||
    isQwenInferenceModel(normalizedInferenceModel);
  const usesPreferenceAwareRouting =
    shouldUsePreferenceAwareImagePromptRouting(normalizedInferenceModel);

  if (!openaiClient && !usesPreferenceAwareRouting) {
    return fallbackPromptWithDescriptions;
  }



  try {
    const completionPayload = {
      model: usesSelectedNonOpenAIProvider ? normalizedInferenceModel : OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: parts.join('\n') },
      ],
      temperature: 0.8,
    };
    const completion = usesPreferenceAwareRouting
      ? await createCompatibleChatCompletion(openaiClient, completionPayload)
      : await openaiClient.chat.completions.create(completionPayload);

    const generated = completion?.choices?.[0]?.message?.content?.trim();
    return generated || fallbackPromptWithDescriptions;
  } catch {
    return fallbackPromptWithDescriptions;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function resolveImageStatus(imageDoc, fallbackStatus = 'PENDING') {
  if (!imageDoc) {
    return fallbackStatus || 'PENDING';
  }

  if (imageDoc.operationType === 'EDIT') {
    return imageDoc.editStatus || imageDoc.apiEditStatus || fallbackStatus || 'PENDING';
  }

  return imageDoc.generationStatus || imageDoc.apiGenerationStatus || fallbackStatus || 'PENDING';
}

function buildImageStatusPayload({
  globalSession,
  imageDoc,
  status,
  includeTimestamps = false,
}) {
  const sessionId = globalSession?.sessionId?.toString() || imageDoc?._id?.toString() || null;
  const requestId = globalSession?.requestId?.toString() || sessionId;
  const resultUrls = Array.isArray(globalSession?.resultUrls)
    ? globalSession.resultUrls.filter(Boolean)
    : [];
  const resultUrl = globalSession?.resultUrl || resultUrls[0] || null;
  const provider = globalSession?.provider || imageDoc?.model || null;
  const caseType = globalSession?.sessionSubType || imageDoc?.case_type;

  const payload = {
    session_id: sessionId,
    request_id: requestId,
    status: status || 'PENDING',
    type: 'image',
    provider,
  };

  if (resultUrl) {
    payload.result_url = resultUrl;
  }
  if (globalSession?.thumbnailUrl) {
    payload.thumbnail_url = globalSession.thumbnailUrl;
  }
  if (resultUrls.length) {
    payload.result_urls = resultUrls;
  }
  if (globalSession?.errorMessage) {
    payload.message = globalSession.errorMessage;
  }
  if (caseType) {
    payload.case_type = caseType;
  }
  const normalizedStatus = (status || 'PENDING').toString().toUpperCase();
  if (globalSession?.sessionSubType === 'rollup_banner_enhance' && normalizedStatus === 'COMPLETED') {
    const inputImageUrls = Array.isArray(globalSession?.metadata?.inputImageUrls)
      ? globalSession.metadata.inputImageUrls.filter(Boolean)
      : Array.isArray(globalSession?.inputUrls)
        ? globalSession.inputUrls.filter(Boolean)
        : [];
    if (inputImageUrls.length) {
      payload.input_image_urls = inputImageUrls;
    }
  }
  if (globalSession?.requestType) {
    payload.request_type = globalSession.requestType;
  }
  if (includeTimestamps) {
    if (globalSession?.createdAt) {
      payload.created_at = new Date(globalSession.createdAt).toISOString();
    }
    if (globalSession?.updatedAt) {
      payload.updated_at = new Date(globalSession.updatedAt).toISOString();
    }
  }

  return payload;
}

function parseFetchStatus(error) {
  const message = error?.message;
  if (typeof message !== 'string') return null;
  const match = message.match(/Failed to fetch image:\s*(\d{3})/i);
  return match ? Number(match[1]) : null;
}

function isRetryableFetchStatus(status) {
  if (!Number.isFinite(status)) return true;
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSemaphore(limit) {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  let active = 0;
  const queue = [];

  const acquire = () => new Promise((resolve) => {
    if (active < normalizedLimit) {
      active += 1;
      resolve();
      return;
    }
    queue.push(resolve);
  });

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) {
      active += 1;
      next();
    }
  };

  return { acquire, release };
}

function createRollupImageFetcher(opts = {}) {
  const concurrency = Number.isFinite(opts?.concurrency)
    ? Math.max(1, Math.floor(opts.concurrency))
    : ROLLUP_FETCH_CONCURRENCY;
  const retries = Number.isFinite(opts?.retries) ? Math.max(0, Math.floor(opts.retries)) : ROLLUP_FETCH_RETRIES;
  const retryDelayMs = Number.isFinite(opts?.retryDelayMs)
    ? Math.max(0, Math.floor(opts.retryDelayMs))
    : ROLLUP_FETCH_RETRY_DELAY_MS;
  const timeoutMs = Number.isFinite(opts?.timeoutMs)
    ? Math.max(0, Math.floor(opts.timeoutMs))
    : ROLLUP_FETCH_TIMEOUT_MS;
  const timeoutMsMax = Number.isFinite(opts?.timeoutMsMax)
    ? Math.max(0, Math.floor(opts.timeoutMsMax))
    : ROLLUP_FETCH_TIMEOUT_MAX_MS;
  const baseContext = opts?.context && typeof opts.context === 'object' ? opts.context : null;
  const semaphore = createSemaphore(concurrency);
  const cache = new Map();

  return async (url, context) => {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid image URL');
    }
    const cached = cache.get(url);
    if (cached) return cached;

    const mergedContext = baseContext || context
      ? { ...(baseContext || {}), ...(context || {}) }
      : null;
    const promise = (async () => {
      await semaphore.acquire();
      try {
        return await fetchImageBufferWithRetry(url, {
          retries,
          retryDelayMs,
          timeoutMs,
          timeoutMsMax,
          context: mergedContext,
        });
      } finally {
        semaphore.release();
      }
    })();

    const tracked = promise.catch((error) => {
      cache.delete(url);
      throw error;
    });
    cache.set(url, tracked);
    return tracked;
  };
}

async function prefetchRollupImages(urls, fetcher, context = {}) {
  const uniqueUrls = Array.from(
    new Set((urls || []).filter((url) => typeof url === 'string' && url.trim().length > 0))
  );
  if (!uniqueUrls.length) {
    return { total: 0, failures: 0 };
  }

  const results = await Promise.allSettled(
    uniqueUrls.map((url, index) => fetcher(url, { ...context, stage: 'prefetch', imageIndex: index }))
  );
  const failures = results.filter((result) => result.status === 'rejected');
  return { total: uniqueUrls.length, failures: failures.length };
}

async function fetchImageBuffer(url, opts = {}) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid image URL');
  }

  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',');
    const dataPart = commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed;
    const isBase64 = /;base64/i.test(trimmed);
    return Buffer.from(isBase64 ? dataPart : decodeURIComponent(dataPart), isBase64 ? 'base64' : 'utf8');
  }

  const timeoutMs = Number.isFinite(opts?.timeoutMs)
    ? Math.max(0, Math.floor(opts.timeoutMs))
    : ROLLUP_FETCH_TIMEOUT_MS;
  const controller = opts?.signal ? null : new AbortController();
  const signal = opts?.signal || controller?.signal;
  let timeoutId = null;
  if (controller && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const response = await fetch(trimmed, { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Failed to fetch image: timeout');
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchImageBufferWithRetry(url, opts = {}) {
  const retries = Number.isFinite(opts?.retries) ? Math.max(0, Math.floor(opts.retries)) : ROLLUP_FETCH_RETRIES;
  const retryDelayMs = Number.isFinite(opts?.retryDelayMs)
    ? Math.max(0, Math.floor(opts.retryDelayMs))
    : ROLLUP_FETCH_RETRY_DELAY_MS;
  const timeoutMs = Number.isFinite(opts?.timeoutMs)
    ? Math.max(0, Math.floor(opts.timeoutMs))
    : ROLLUP_FETCH_TIMEOUT_MS;
  const timeoutMsMaxRaw = Number.isFinite(opts?.timeoutMsMax) ? Math.floor(opts.timeoutMsMax) : ROLLUP_FETCH_TIMEOUT_MAX_MS;
  const timeoutMsMax = Math.max(timeoutMs, Math.max(0, timeoutMsMaxRaw));
  const context = opts?.context && typeof opts.context === 'object' ? opts.context : null;
  let attempt = 0;

  while (true) {
    try {
      const attemptTimeoutMs = Math.min(timeoutMsMax, timeoutMs * Math.pow(2, attempt));
      return await fetchImageBuffer(url, { timeoutMs: attemptTimeoutMs });
    } catch (error) {
      const status = parseFetchStatus(error);
      const retryable = isRetryableFetchStatus(status);
      if (attempt < retries && retryable) {
        attempt += 1;
        if (retryDelayMs > 0) {
          await delay(retryDelayMs * attempt);
        }
        continue;
      }
      console.error('[rollup_banner] image fetch failed', {
        ...(context || {}),
        url,
        attempts: attempt + 1,
        retries,
        status,
        error: error?.message,
        timeoutMs: Math.min(timeoutMsMax, timeoutMs * Math.pow(2, attempt)),
      });
      throw error;
    }
  }
}

async function getImageDimensionsFromUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return null;
  }
  try {
    const buffer = await fetchImageBuffer(imageUrl);
    if (!buffer) {
      return null;
    }
    const { width, height } = sizeOf(buffer);
    if (!width || !height) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

function meetsRollupXLMinimum(dimensions) {
  if (!dimensions) {
    return false;
  }
  return (
    dimensions.width >= ROLLUP_XL_MIN_IMAGE.width &&
    dimensions.height >= ROLLUP_XL_MIN_IMAGE.height
  );
}

async function isRollupXLReady(imageUrl) {
  const dimensions = await getImageDimensionsFromUrl(imageUrl);
  return meetsRollupXLMinimum(dimensions);
}

function canvasWidth() {
  return ROLLUP_WIDTH;
}

const computeTileLayout = (columns = ROLLUP_COLUMNS) => {
  const parsedCols = Number(columns);
  const cols = Number.isFinite(parsedCols) && parsedCols > 0
    ? Math.min(TILE_COLUMN_WIDTHS.length, Math.max(1, Math.floor(parsedCols)))
    : ROLLUP_COLUMNS;
  const rows = ROLLUP_ROWS;
  const columnWidths = TILE_COLUMN_WIDTHS.slice(0, cols);
  const tileHeight = TILE_HEIGHT;

  const contentWidth = columnWidths.reduce((sum, width) => sum + width, 0) + GRID_GUTTER * (cols - 1);
  const baseOuterSpaceX = GRID_OUTER_PADDING * 2;
  const remainingWidth = Math.max(0, ROLLUP_WIDTH - contentWidth - baseOuterSpaceX);
  const extraLeft = Math.floor(remainingWidth / 2);
  const outerPadLeft = GRID_OUTER_PADDING + extraLeft;
  const outerPadRight = GRID_OUTER_PADDING + (remainingWidth - extraLeft);

  const contentHeight = tileHeight * rows + GRID_GUTTER * (rows - 1);
  const baseOuterSpaceY = GRID_OUTER_PADDING * 2;
  const remainingHeight = Math.max(0, ROLLUP_GRID_HEIGHT - contentHeight - baseOuterSpaceY);
  const extraTop = Math.floor(remainingHeight / 2);
  const outerPadTop = GRID_OUTER_PADDING + extraTop;
  const outerPadBottom = GRID_OUTER_PADDING + (remainingHeight - extraTop);

  const columnOffsets = [];
  let currentX = outerPadLeft;
  columnWidths.forEach((width, idx) => {
    columnOffsets.push(currentX);
    if (idx < cols - 1) {
      currentX += width + GRID_GUTTER;
    }
  });

  return {
    tileHeight,
    columnWidths,
    columnOffsets,
    hPad: GRID_GUTTER,
    vPad: GRID_GUTTER,
    outerPadLeft,
    outerPadRight,
    outerPadTop,
    outerPadBottom,
    cols,
    rows,
  };
};

function escapeSvgText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateAtWordBoundary(value, maxChars) {
  const text = (value || '').toString().trim();
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) {
    return slice.slice(0, lastSpace).trimEnd();
  }
  return slice.trimEnd();
}

function wrapLines(text, maxChars = 36, maxLines = 2) {
  const words = (text || '').toString().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  });
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const first = lines[0];
  const remaining = lines.slice(1).join(' ');
  if (remaining.length <= maxChars) {
    return [first, remaining];
  }
  const trimmed = truncateAtWordBoundary(remaining, Math.max(1, maxChars - 1));
  const condensedBase = trimmed.length ? trimmed : remaining.slice(0, Math.max(1, maxChars - 1));
  const condensed = `${condensedBase}…`;
  return [first, condensed];
}

function splitIntoGraphemes(text, locale) {
  const safeText = (text || '').toString();
  if (!safeText) return [];
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(safeText), (segment) => segment.segment);
  }
  return Array.from(safeText);
}

function tokenizeTextForWrap(text, locale) {
  const safeText = (text || '').toString().trim();
  if (!safeText) return [];
  if (/\s/.test(safeText)) {
    const words = safeText.split(/\s+/).filter(Boolean);
    return words.map((word, idx) => ({ value: word, joinBefore: idx ? ' ' : '' }));
  }
  const graphemes = splitIntoGraphemes(safeText, locale).filter((char) => char.trim());
  return graphemes.map((char) => ({ value: char, joinBefore: '' }));
}

function tokenizeTextForWordWrap(text, locale) {
  const safeText = (text || '').toString().trim();
  if (!safeText) return [];
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    const tokens = [];
    let pendingJoiner = '';
    for (const { segment, isWordLike } of segmenter.segment(safeText)) {
      if (!segment) continue;
      if (!isWordLike) {
        if (/\s/.test(segment)) {
          pendingJoiner += segment;
        } else if (tokens.length) {
          tokens[tokens.length - 1].value += segment;
        } else {
          pendingJoiner += segment;
        }
        continue;
      }
      const joinBefore = tokens.length ? pendingJoiner : '';
      tokens.push({ value: segment, joinBefore });
      pendingJoiner = '';
    }
    if (tokens.length) return tokens;
  }
  return tokenizeTextForWrap(safeText, locale);
}

function chunkTextByChars(value, maxChars, locale) {
  const size = Math.max(1, Math.floor(maxChars));
  const graphemes = splitIntoGraphemes(value, locale);
  if (!graphemes.length || size <= 0) return [];

  const chunks = [];
  for (let i = 0; i < graphemes.length; i += size) {
    chunks.push(graphemes.slice(i, i + size).join(''));
  }
  return chunks;
}

function splitOversizeTokens(tokens, maxChars, locale) {
  if (!tokens.length) return tokens;
  const size = Math.max(1, Math.floor(maxChars));
  const result = [];
  tokens.forEach((token) => {
    const tokenLength = Array.from(token.value).length;
    if (tokenLength <= size) {
      result.push(token);
      return;
    }
    const chunks = chunkTextByChars(token.value, size, locale);
    chunks.forEach((chunk, idx) => {
      result.push({ value: chunk, joinBefore: idx === 0 ? token.joinBefore : '' });
    });
  });
  return result;
}

function measureTokenLength(token, isFirst) {
  const joinerLength = !isFirst && token.joinBefore ? token.joinBefore.length : 0;
  return Array.from(token.value).length + joinerLength;
}

function measureLineLength(tokens) {
  if (!tokens.length) return 0;
  return tokens.reduce((total, token, idx) => total + measureTokenLength(token, idx === 0), 0);
}

function wrapTokensIntoLines(tokens, maxChars, maxLines) {
  const lines = [];
  const size = Math.max(1, Math.floor(maxChars));
  const lineLimit = Math.max(1, Math.floor(maxLines));
  let current = [];
  let currentLength = 0;
  let truncated = false;

  for (const token of tokens) {
    const tokenLength = measureTokenLength(token, currentLength === 0);
    if (!currentLength || currentLength + tokenLength <= size) {
      current.push(token);
      currentLength += tokenLength;
      continue;
    }
    lines.push(current);
    if (lines.length >= lineLimit) {
      truncated = true;
      current = [];
      break;
    }
    current = [token];
    currentLength = Array.from(token.value).length;
  }

  if (!truncated && current.length) {
    lines.push(current);
  }

  if (lines.length > lineLimit) {
    lines.length = lineLimit;
    truncated = true;
  }

  return { lines, truncated };
}

function appendEllipsisToTokens(tokens, maxChars) {
  const size = Math.max(1, Math.floor(maxChars));
  const ellipsis = '…';
  const trimmed = [...tokens];
  while (trimmed.length && measureLineLength(trimmed) + ellipsis.length > size) {
    trimmed.pop();
  }
  if (!trimmed.length) {
    return [{ value: ellipsis, joinBefore: '' }];
  }
  return [...trimmed, { value: ellipsis, joinBefore: '' }];
}

function tokensToString(tokens) {
  return tokens
    .map((token, idx) => `${idx === 0 ? '' : token.joinBefore}${token.value}`)
    .join('');
}

function estimateTextWidth(text, fontSize, charWidthRatio, locale) {
  if (!text) return 0;
  const length = splitIntoGraphemes(text, locale).length;
  return length * fontSize * charWidthRatio;
}

function lineOverflows(line, maxWidth, fontSize, charWidthRatio, locale) {
  return estimateTextWidth(line, fontSize, charWidthRatio, locale) > maxWidth;
}

function truncateLineToFit(text, maxChars) {
  if (!text) return '';
  const size = Math.max(1, Math.floor(maxChars));
  if (text.length <= size) return text;
  const trimmed = truncateAtWordBoundary(text, Math.max(1, size - 1));
  const base = trimmed || text.slice(0, Math.max(1, size - 1));
  return `${base}…`;
}

function wrapTextForLocale(text, maxChars, maxLines, locale, opts = {}) {
  const safeText = (text || '').toString().trim();
  if (!safeText) return [];
  const size = Math.max(1, Math.floor(maxChars));
  const lineLimit = Math.max(1, Math.floor(maxLines));
  const preferWordSegmentation = opts?.useWordSegmentation === true;
  const allowTokenSplit = opts?.allowTokenSplit !== false;
  const baseTokens = preferWordSegmentation
    ? tokenizeTextForWordWrap(safeText, locale)
    : tokenizeTextForWrap(safeText, locale);
  const tokens = allowTokenSplit ? splitOversizeTokens(baseTokens, size, locale) : baseTokens;
  if (!tokens.length) return [];
  const { lines, truncated } = wrapTokensIntoLines(tokens, size, lineLimit);
  if (!lines.length) return [];
  if (truncated) {
    const lastIndex = Math.min(lines.length, lineLimit) - 1;
    lines[lastIndex] = appendEllipsisToTokens(lines[lastIndex], size);
  }
  return lines.map(tokensToString);
}

function wrapFooterTextLines(text, maxChars, maxLines, fontSize, charWidthRatio, locale, maxWidth) {
  let currentMaxChars = Math.max(1, Math.floor(maxChars));
  let lines = wrapTextForLocale(text, currentMaxChars, maxLines, locale, {
    allowTokenSplit: false,
    useWordSegmentation: true,
  });
  if (!lines.length) return { lines: [], maxChars: currentMaxChars };

  let attempts = 0;
  while (
    attempts < FOOTER_TEXT_WRAP_RETRIES &&
    lines.some((line) => lineOverflows(line, maxWidth, fontSize, charWidthRatio, locale)) &&
    currentMaxChars > 1
  ) {
    currentMaxChars = Math.max(1, currentMaxChars - 1);
    lines = wrapTextForLocale(text, currentMaxChars, maxLines, locale, {
      allowTokenSplit: false,
      useWordSegmentation: true,
    });
    if (!lines.length) break;
    attempts += 1;
  }

  const clamped = lines.map((line) =>
    lineOverflows(line, maxWidth, fontSize, charWidthRatio, locale)
      ? truncateLineToFit(line, currentMaxChars)
      : line
  );

  return { lines: clamped, maxChars: currentMaxChars };
}

function scaleRollupFont(size) {
  return Math.round(size * ROLLUP_TEXT_SCALE);
}

function extractPrimaryFontFamily(fontFamily) {
  if (typeof fontFamily !== 'string') return '';
  const trimmed = fontFamily.trim();
  if (!trimmed) return '';
  const [primary] = trimmed.split(',');
  return (primary || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeFontKey(fontKey) {
  if (typeof fontKey !== 'string') return null;
  const normalized = fontKey.trim().toLowerCase();
  if (!normalized) return null;
  if (SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE[normalized]) return normalized;
  const base = normalized.split('-')[0];
  if (SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE[base]) return base;
  return null;
}

function applyNumberOverride(source, target, key, path) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  const value = source[key];
  if (!Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  target[key] = value;
}

function validateImageTilingPosition(position) {
  const topLeft = position?.top_left || {};
  const topRight = position?.top_right || {};
  const bottom = position?.bottom || {};
  const imageWidth = TILE_IMAGE_SIZE.width;
  const imageHeight = TILE_IMAGE_SIZE.height;

  const requireNonNegative = (value, path) => {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${path} must be a non-negative number.`);
    }
  };
  const requireRatio = (value, path) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${path} must be between 0 and 1.`);
    }
  };

  requireNonNegative(topLeft.margin_min, 'image_tiling_position.top_left.margin_min');
  requireRatio(topLeft.margin_ratio, 'image_tiling_position.top_left.margin_ratio');
  requireNonNegative(topLeft.diameter_min, 'image_tiling_position.top_left.diameter_min');
  requireNonNegative(topLeft.diameter_max, 'image_tiling_position.top_left.diameter_max');
  requireRatio(topLeft.diameter_ratio, 'image_tiling_position.top_left.diameter_ratio');
  requireNonNegative(topLeft.inner_padding_min, 'image_tiling_position.top_left.inner_padding_min');
  requireRatio(topLeft.inner_padding_ratio, 'image_tiling_position.top_left.inner_padding_ratio');

  requireNonNegative(topRight.margin_min, 'image_tiling_position.top_right.margin_min');
  requireRatio(topRight.margin_ratio, 'image_tiling_position.top_right.margin_ratio');
  requireNonNegative(topRight.max_width_floor, 'image_tiling_position.top_right.max_width_floor');
  requireNonNegative(topRight.min_width, 'image_tiling_position.top_right.min_width');
  requireNonNegative(topRight.padding_left, 'image_tiling_position.top_right.padding_left');
  requireNonNegative(topRight.padding_right, 'image_tiling_position.top_right.padding_right');
  requireNonNegative(topRight.padding_top, 'image_tiling_position.top_right.padding_top');
  requireNonNegative(topRight.padding_bottom, 'image_tiling_position.top_right.padding_bottom');
  requireNonNegative(topRight.overlay_height_min, 'image_tiling_position.top_right.overlay_height_min');

  requireNonNegative(bottom.inset_min, 'image_tiling_position.bottom.inset_min');
  requireRatio(bottom.inset_ratio, 'image_tiling_position.bottom.inset_ratio');
  requireNonNegative(bottom.offset_min, 'image_tiling_position.bottom.offset_min');
  requireRatio(bottom.offset_ratio, 'image_tiling_position.bottom.offset_ratio');
  requireNonNegative(bottom.container_margin_min, 'image_tiling_position.bottom.container_margin_min');
  requireRatio(bottom.container_margin_ratio, 'image_tiling_position.bottom.container_margin_ratio');
  requireNonNegative(bottom.text_inset_min, 'image_tiling_position.bottom.text_inset_min');
  requireRatio(bottom.text_inset_ratio, 'image_tiling_position.bottom.text_inset_ratio');
  requireNonNegative(bottom.overlay_height_min, 'image_tiling_position.bottom.overlay_height_min');

  if (topLeft.diameter_min > topLeft.diameter_max) {
    throw new Error('image_tiling_position.top_left.diameter_min must be <= diameter_max.');
  }
  if (topRight.max_width_floor < topRight.min_width) {
    throw new Error('image_tiling_position.top_right.max_width_floor must be >= min_width.');
  }

  const topLeftMargin = Math.max(topLeft.margin_min, Math.floor(imageWidth * topLeft.margin_ratio));
  const topRightMargin = Math.max(topRight.margin_min, Math.floor(imageWidth * topRight.margin_ratio));

  if (topRightMargin * 2 >= imageWidth) {
    throw new Error('image_tiling_position.top_right.margin_* is too large for the tile width.');
  }

  const topLeftDiameter = Math.min(
    topLeft.diameter_max,
    Math.max(topLeft.diameter_min, Math.floor(imageWidth * topLeft.diameter_ratio))
  );
  if (topLeftDiameter <= 0) {
    throw new Error('image_tiling_position.top_left.diameter_* must resolve to a positive value.');
  }
  if (topLeftMargin + topLeftDiameter > imageWidth) {
    throw new Error('image_tiling_position.top_left margins leave no space for the badge.');
  }

  const innerPadding = Math.max(topLeft.inner_padding_min, Math.floor(topLeftDiameter * topLeft.inner_padding_ratio));
  if (topLeftDiameter - innerPadding * 2 <= 0) {
    throw new Error('image_tiling_position.top_left.inner_padding_* leaves no space for text.');
  }

  const availableWidth = imageWidth - topRightMargin * 2;
  if (topRight.min_width > availableWidth) {
    throw new Error('image_tiling_position.top_right.min_width exceeds the available tile width.');
  }

  const reservedLeft = topLeftMargin * 2 + topLeftDiameter;
  const maxTopRightWidth = Math.max(topRight.max_width_floor, imageWidth - reservedLeft - topRightMargin);
  if (maxTopRightWidth <= 0) {
    throw new Error('image_tiling_position.top_right.max_width_floor leaves no space for the label.');
  }

  const maxLabelWidth = Math.max(topRight.min_width, Math.min(availableWidth, maxTopRightWidth));
  const paddingLeft = Math.round(topRight.padding_left * ROLLUP_TEXT_SCALE);
  const paddingRight = Math.round(topRight.padding_right * ROLLUP_TEXT_SCALE);
  if (paddingLeft + paddingRight >= maxLabelWidth) {
    throw new Error('image_tiling_position.top_right.padding_* leaves no space for label text.');
  }

  const topRightOverlayMinHeight = Math.round(topRight.overlay_height_min * ROLLUP_TEXT_SCALE);
  if (topRightOverlayMinHeight > imageHeight) {
    throw new Error('image_tiling_position.top_right.overlay_height_min exceeds the tile height.');
  }

  const footerInset = Math.max(bottom.inset_min, Math.floor(imageWidth * bottom.inset_ratio));
  const footerWidth = imageWidth - footerInset * 2;
  if (footerWidth <= 0) {
    throw new Error('image_tiling_position.bottom.inset_* leaves no space for the footer overlay.');
  }

  const containerMargin = Math.max(bottom.container_margin_min, Math.floor(footerWidth * bottom.container_margin_ratio));
  const containerWidth = footerWidth - containerMargin * 2;
  if (containerWidth <= 0) {
    throw new Error('image_tiling_position.bottom.container_margin_* leaves no space for the footer text.');
  }

  const textInset = Math.max(bottom.text_inset_min, Math.floor(containerWidth * bottom.text_inset_ratio));
  const textMaxWidth = containerWidth - textInset * 2;
  if (textMaxWidth <= 0) {
    throw new Error('image_tiling_position.bottom.text_inset_* leaves no space for the footer text.');
  }

  const bottomOverlayMinHeight = Math.round(bottom.overlay_height_min * ROLLUP_TEXT_SCALE);
  if (bottomOverlayMinHeight > imageHeight) {
    throw new Error('image_tiling_position.bottom.overlay_height_min exceeds the tile height.');
  }

  const footerOffset = Math.max(bottom.offset_min, Math.floor(imageHeight * bottom.offset_ratio));
  if (footerOffset + bottomOverlayMinHeight > imageHeight) {
    throw new Error('image_tiling_position.bottom.offset_* pushes the footer overlay outside the tile.');
  }
}

function resolveImageTilingPosition(raw) {
  if (raw === undefined || raw === null) {
    return DEFAULT_ROLLUP_IMAGE_TILING_POSITION;
  }
  if (!isPlainObject(raw)) {
    throw new Error('image_tiling_position must be an object.');
  }

  const resolved = {
    font_key: DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_key,
    font_family: DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_family,
    top_left: { ...DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_left },
    top_right: { ...DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_right },
    bottom: { ...DEFAULT_ROLLUP_IMAGE_TILING_POSITION.bottom },
  };

  const fontPayload = isPlainObject(raw.font) ? raw.font : null;
  const fontKeyOverride = typeof raw.font_key === 'string'
    ? raw.font_key
    : typeof fontPayload?.key === 'string'
      ? fontPayload.key
      : typeof fontPayload?.language === 'string'
        ? fontPayload.language
        : null;
  const fontFamilyOverride = typeof raw.font_family === 'string'
    ? raw.font_family
    : typeof fontPayload?.family === 'string'
      ? fontPayload.family
      : null;
  const hasFontKeyOverride = fontKeyOverride !== null;
  const hasFontFamilyOverride = fontFamilyOverride !== null;

  if (hasFontKeyOverride) {
    resolved.font_key = fontKeyOverride;
  }
  if (hasFontFamilyOverride) {
    resolved.font_family = fontFamilyOverride;
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'top_left')) {
    if (!isPlainObject(raw.top_left)) {
      throw new Error('image_tiling_position.top_left must be an object.');
    }
    applyNumberOverride(raw.top_left, resolved.top_left, 'margin_min', 'image_tiling_position.top_left.margin_min');
    applyNumberOverride(raw.top_left, resolved.top_left, 'margin_ratio', 'image_tiling_position.top_left.margin_ratio');
    applyNumberOverride(raw.top_left, resolved.top_left, 'diameter_min', 'image_tiling_position.top_left.diameter_min');
    applyNumberOverride(raw.top_left, resolved.top_left, 'diameter_max', 'image_tiling_position.top_left.diameter_max');
    applyNumberOverride(raw.top_left, resolved.top_left, 'diameter_ratio', 'image_tiling_position.top_left.diameter_ratio');
    applyNumberOverride(raw.top_left, resolved.top_left, 'inner_padding_min', 'image_tiling_position.top_left.inner_padding_min');
    applyNumberOverride(raw.top_left, resolved.top_left, 'inner_padding_ratio', 'image_tiling_position.top_left.inner_padding_ratio');
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'top_right')) {
    if (!isPlainObject(raw.top_right)) {
      throw new Error('image_tiling_position.top_right must be an object.');
    }
    applyNumberOverride(raw.top_right, resolved.top_right, 'margin_min', 'image_tiling_position.top_right.margin_min');
    applyNumberOverride(raw.top_right, resolved.top_right, 'margin_ratio', 'image_tiling_position.top_right.margin_ratio');
    applyNumberOverride(raw.top_right, resolved.top_right, 'max_width_floor', 'image_tiling_position.top_right.max_width_floor');
    applyNumberOverride(raw.top_right, resolved.top_right, 'min_width', 'image_tiling_position.top_right.min_width');
    applyNumberOverride(raw.top_right, resolved.top_right, 'padding_left', 'image_tiling_position.top_right.padding_left');
    applyNumberOverride(raw.top_right, resolved.top_right, 'padding_right', 'image_tiling_position.top_right.padding_right');
    applyNumberOverride(raw.top_right, resolved.top_right, 'padding_top', 'image_tiling_position.top_right.padding_top');
    applyNumberOverride(raw.top_right, resolved.top_right, 'padding_bottom', 'image_tiling_position.top_right.padding_bottom');
    applyNumberOverride(raw.top_right, resolved.top_right, 'overlay_height_min', 'image_tiling_position.top_right.overlay_height_min');
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'bottom')) {
    if (!isPlainObject(raw.bottom)) {
      throw new Error('image_tiling_position.bottom must be an object.');
    }
    applyNumberOverride(raw.bottom, resolved.bottom, 'inset_min', 'image_tiling_position.bottom.inset_min');
    applyNumberOverride(raw.bottom, resolved.bottom, 'inset_ratio', 'image_tiling_position.bottom.inset_ratio');
    applyNumberOverride(raw.bottom, resolved.bottom, 'offset_min', 'image_tiling_position.bottom.offset_min');
    applyNumberOverride(raw.bottom, resolved.bottom, 'offset_ratio', 'image_tiling_position.bottom.offset_ratio');
    applyNumberOverride(raw.bottom, resolved.bottom, 'container_margin_min', 'image_tiling_position.bottom.container_margin_min');
    applyNumberOverride(raw.bottom, resolved.bottom, 'container_margin_ratio', 'image_tiling_position.bottom.container_margin_ratio');
    applyNumberOverride(raw.bottom, resolved.bottom, 'text_inset_min', 'image_tiling_position.bottom.text_inset_min');
    applyNumberOverride(raw.bottom, resolved.bottom, 'text_inset_ratio', 'image_tiling_position.bottom.text_inset_ratio');
    applyNumberOverride(raw.bottom, resolved.bottom, 'overlay_height_min', 'image_tiling_position.bottom.overlay_height_min');
  }

  const normalizedFontKey = normalizeFontKey(resolved.font_key);
  if (!normalizedFontKey) {
    throw new Error('image_tiling_position.font_key must match a supported subtitle language.');
  }
  resolved.font_key = normalizedFontKey;

  if (hasFontKeyOverride && !hasFontFamilyOverride) {
    const fonts = SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE[normalizedFontKey] || [];
    resolved.font_family = fonts.join(', ');
  }

  if (typeof resolved.font_family !== 'string' || !resolved.font_family.trim()) {
    throw new Error('image_tiling_position.font_family must be a non-empty string.');
  }

  const primaryFont = extractPrimaryFontFamily(resolved.font_family);
  const allowedFonts = (SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE[normalizedFontKey] || []).map((font) =>
    font.toLowerCase()
  );
  if (!primaryFont || !allowedFonts.includes(primaryFont.toLowerCase())) {
    throw new Error('image_tiling_position.font_family must be supported for the chosen font_key.');
  }

  validateImageTilingPosition(resolved);

  return resolved;
}

function getFooterOverlayOffset(imageHeight, position) {
  const bottom = position?.bottom || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.bottom;
  return Math.max(bottom.offset_min, Math.floor(imageHeight * bottom.offset_ratio));
}

function createHeaderTextOverlay(text, width, height) {
  const safeText = typeof text === 'string' ? text.trim() : '';
  if (!safeText) return null;

  const lines = wrapLines(safeText, 42, 2);
  if (!lines.length) return null;

  const fontSize = scaleRollupFont(lines.length > 1 ? 98 : 116);
  const lineHeight = Math.floor(fontSize * 1.12);
  const overlayHeight = Math.min(
    height,
    Math.max(Math.round(220 * ROLLUP_TEXT_SCALE), lineHeight * lines.length + Math.round(120 * ROLLUP_TEXT_SCALE))
  );
  const startY = height - overlayHeight + Math.round(70 * ROLLUP_TEXT_SCALE) + fontSize * 0.1;

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${height - overlayHeight}" width="${width}" height="${overlayHeight}" fill="${OVERLAY_BACKGROUND_COLOR}" />
      ${lines
        .map(
          (line, idx) =>
            `<text x="50%" y="${startY + idx * lineHeight}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}"
              font-weight="700" fill="${OVERLAY_TEXT_COLOR}" text-anchor="middle" paint-order="stroke fill" stroke="${OVERLAY_TEXT_STROKE_COLOR}" stroke-width="2">
              ${escapeSvgText(line)}
            </text>`
        )
        .join('')}
    </svg>
  `;

  return Buffer.from(svg);
}

async function buildTopSection(headerImageUrl) {
  const width = ROLLUP_WIDTH;
  const height = ROLLUP_TOP_HEIGHT;
  if (!headerImageUrl) {
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }

  try {
    const headerBuffer = await fetchImageBufferWithRetry(headerImageUrl, {
      context: { stage: 'rollup_header' },
    });
    return sharp(headerBuffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'centre',
        background: ROLLUP_BACKGROUND_COLOR,
      })
      .png()
      .toBuffer();
  } catch (error) {
    console.error('[rollup_banner] header image resize failed', error);
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }
}

function normalizeOverlayValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeOverlayDisplayValue(value) {
  const normalized = normalizeOverlayValue(value);
  if (!normalized) return normalized;
  const withSpaces = normalized.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return withSpaces.length ? withSpaces : normalized;
}

function normalizeDurationMinutes(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const iso = trimmed.match(/^P(?:T)?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?$/i);
  if (iso) {
    const hours = iso[1] ? Number(iso[1]) : 0;
    const minutes = iso[2] ? Number(iso[2]) : 0;
    const total = hours * 60 + minutes;
    if (Number.isFinite(total) && total > 0) return total;
  }

  const clock = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    const total = hours * 60 + minutes;
    if (Number.isFinite(total) && total > 0) return total;
  }

  const hoursMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:h|hour|hours)/i);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    if (Number.isFinite(hours) && hours > 0) return hours * 60;
  }

  const minutesMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:m|min|minute|minutes)/i);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1]);
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
  }

  return null;
}

function formatHoursLabel(hours) {
  const rounded = Math.round(hours * 10) / 10;
  const value = Math.abs(rounded - Math.round(rounded)) < 1e-6 ? Math.round(rounded).toString() : rounded.toFixed(1);
  const unit = Math.abs(rounded - 1) < 1e-6 ? 'hour' : 'hours';
  return `${value} ${unit}`;
}

function durationMinutesToLabel(durationMinutes) {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
  const hours = durationMinutes / 60;
  if (hours < 3) return formatHoursLabel(hours);
  if (hours <= 6) return 'Half day';
  return 'Full day';
}

function resolveOverlayFields(item) {
  const rawOverlay = item && typeof item.overlay === 'object' && item.overlay !== null ? item.overlay : {};
  const durationMinutes =
    normalizeDurationMinutes(item?.image_duration) ??
    normalizeDurationMinutes(item?.duration_minutes) ??
    normalizeDurationMinutes(item?.duration);
  const durationText =
    normalizeOverlayDisplayValue(item?.duration_text) ||
    normalizeOverlayDisplayValue(item?.durationText) ||
    (typeof item?.image_duration === 'string' ? normalizeOverlayDisplayValue(item.image_duration) : null) ||
    (typeof item?.duration === 'string' ? normalizeOverlayDisplayValue(item.duration) : null);
  const category =
    normalizeOverlayDisplayValue(rawOverlay.image_category) ||
    normalizeOverlayDisplayValue(item?.image_category) ||
    normalizeOverlayDisplayValue(item?.category);
  const footer =
    normalizeOverlayDisplayValue(rawOverlay.bottom) ||
    normalizeOverlayDisplayValue(rawOverlay.footer) ||
    normalizeOverlayDisplayValue(rawOverlay.bottom_text) ||
    normalizeOverlayDisplayValue(rawOverlay.text) ||
    normalizeOverlayDisplayValue(rawOverlay.title) ||
    normalizeOverlayDisplayValue(item?.bottom) ||
    normalizeOverlayDisplayValue(item?.footer) ||
    normalizeOverlayDisplayValue(item?.bottom_text) ||
    normalizeOverlayDisplayValue(item?.image_text) ||
    normalizeOverlayDisplayValue(item?.image_title) ||
    normalizeOverlayDisplayValue(item?.title) ||
    normalizeOverlayDisplayValue(item?.name);
  const topLeft =
    normalizeOverlayDisplayValue(rawOverlay.top_left) ||
    normalizeOverlayDisplayValue(rawOverlay.topLeft) ||
    normalizeOverlayDisplayValue(item?.top_left) ||
    normalizeOverlayDisplayValue(item?.topLeft) ||
    durationMinutesToLabel(durationMinutes) ||
    durationText;
  const topRight =
    normalizeOverlayDisplayValue(rawOverlay.top_right) ||
    normalizeOverlayDisplayValue(rawOverlay.topRight) ||
    normalizeOverlayDisplayValue(item?.top_right) ||
    normalizeOverlayDisplayValue(item?.topRight) ||
    category;
  return { footer, top_left: topLeft, top_right: topRight };
}

function createFooterOverlay(text, width, position = DEFAULT_ROLLUP_IMAGE_TILING_POSITION) {
  const safeText = normalizeOverlayValue(text);
  if (!safeText) return { buffer: null, height: 0 };

  const bottom = position?.bottom || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.bottom;
  const fontFamily = position?.font_family || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_family;
  const fontKey = position?.font_key || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_key;
  const { charWidthRatio, locale } = resolveRollupTextMetrics(fontKey, safeText);
  const lineMargin = Math.max(bottom.container_margin_min, Math.floor(width * bottom.container_margin_ratio));
  const baseFontSize = Math.max(
    scaleRollupFont(76),
    Math.min(scaleRollupFont(110), Math.floor(width * 0.05 * ROLLUP_TEXT_SCALE))
  );
  const containerX = lineMargin;
  const containerWidth = Math.max(1, width - lineMargin * 2);
  const textInset = Math.max(bottom.text_inset_min, Math.floor(containerWidth * bottom.text_inset_ratio));
  const textMaxWidth = Math.max(1, containerWidth - textInset * 2);

  const twoLineFontSize = Math.max(scaleRollupFont(70), Math.floor(baseFontSize * 0.92));
  const twoLineHeight = Math.floor(twoLineFontSize * 1.22);
  const twoLinePaddingY = Math.max(scaleRollupFont(52), Math.floor(twoLineFontSize * 1.15));
  const overlayHeight = Math.max(
    twoLineHeight * 2 + twoLinePaddingY * 2,
    Math.round(bottom.overlay_height_min * ROLLUP_TEXT_SCALE)
  );

  const safeTextMaxWidth = Math.max(1, Math.floor(textMaxWidth * FOOTER_TEXT_WIDTH_SAFETY));
  const maxCharsSingle = Math.max(1, Math.min(40, Math.floor(safeTextMaxWidth / (baseFontSize * charWidthRatio))));
  const singleWrap = wrapFooterTextLines(
    safeText,
    maxCharsSingle,
    1,
    baseFontSize,
    charWidthRatio,
    locale,
    safeTextMaxWidth
  );
  const singleLines = singleWrap.lines;

  const maxCharsDouble = Math.max(1, Math.min(40, Math.floor(safeTextMaxWidth / (twoLineFontSize * charWidthRatio))));
  const doubleWrap = wrapFooterTextLines(
    safeText,
    maxCharsDouble,
    2,
    twoLineFontSize,
    charWidthRatio,
    locale,
    safeTextMaxWidth
  );
  const doubleLines = doubleWrap.lines;

  const singleTruncated = singleLines.some((line) => line.trim().endsWith('…'));
  const useSingleLine = singleLines.length === 1 && !singleTruncated;
  const lines = useSingleLine ? singleLines : doubleLines;
  if (!lines.length) return { buffer: null, height: 0 };
  const fontSize = useSingleLine ? baseFontSize : twoLineFontSize;
  const lineHeight = Math.floor(fontSize * 1.22);
  const linePaddingY = Math.floor(twoLinePaddingY * 0.5);
  const topLineY = linePaddingY;
  const bottomLineY = overlayHeight - linePaddingY;
  const containerY = topLineY;
  const containerHeight = Math.max(1, bottomLineY - topLineY);
  const textBlockHeight = lineHeight * (lines.length - 1) + fontSize;
  const startY = Math.floor(containerY + (containerHeight - textBlockHeight) / 2 + fontSize * 0.85);
  const cornerRadius = Math.max(14, Math.floor(containerHeight * 0.25));
  const lineStartX = containerX;
  const lineEndX = containerX + containerWidth;
  const textX = Math.floor(containerX + containerWidth / 2);

  const svg = `
    <svg width="${width}" height="${overlayHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${containerX}" y="${containerY}" width="${containerWidth}" height="${containerHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${TILE_OVERLAY_BACKGROUND_COLOR}" />
      <line x1="${lineStartX}" y1="${topLineY}" x2="${lineEndX}" y2="${topLineY}" stroke="${OVERLAY_TEXT_COLOR}" stroke-width="6" stroke-linecap="round" />
      ${lines
        .map(
          (line, idx) =>
            `<text x="${textX}" y="${startY + idx * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}"
              font-weight="800" fill="${OVERLAY_TEXT_COLOR}" text-anchor="middle" paint-order="stroke fill" stroke="${OVERLAY_TEXT_STROKE_COLOR}" stroke-width="2">
              ${escapeSvgText(line)}
            </text>`
        )
        .join('')}
      <line x1="${lineStartX}" y1="${bottomLineY}" x2="${lineEndX}" y2="${bottomLineY}" stroke="${OVERLAY_TEXT_COLOR}" stroke-width="6" stroke-linecap="round" />
    </svg>`;

  return { buffer: Buffer.from(svg), height: overlayHeight };
}

function resolveTopLeftBadgeMetrics(fontKey) {
  const normalized = normalizeFontKey(fontKey) || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_key;
  if (TOP_LEFT_BADGE_CJK_LANGS.has(normalized)) {
    return {
      paddingScale: TOP_LEFT_BADGE_PADDING_SCALE.cjk,
      maxChars: TOP_LEFT_BADGE_MAX_CHARS.cjk,
      charWidthRatio: TOP_LEFT_BADGE_CHAR_WIDTH_RATIO.cjk,
    };
  }
  if (TOP_LEFT_BADGE_DENSE_LANGS.has(normalized)) {
    return {
      paddingScale: TOP_LEFT_BADGE_PADDING_SCALE.dense,
      maxChars: TOP_LEFT_BADGE_MAX_CHARS.dense,
      charWidthRatio: TOP_LEFT_BADGE_CHAR_WIDTH_RATIO.dense,
    };
  }
  return {
    paddingScale: TOP_LEFT_BADGE_PADDING_SCALE.default,
    maxChars: TOP_LEFT_BADGE_MAX_CHARS.default,
    charWidthRatio: TOP_LEFT_BADGE_CHAR_WIDTH_RATIO.default,
  };
}

function detectRollupTextScript(text) {
  const safeText = (text || '').toString();
  if (!safeText) return null;
  if (ROLLUP_TEXT_CJK_REGEX.test(safeText)) return 'cjk';
  if (ROLLUP_TEXT_DENSE_REGEX.test(safeText)) return 'dense';
  return null;
}

function resolveRollupTextMetrics(fontKey, text) {
  const normalized = normalizeFontKey(fontKey) || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_key;
  let charWidthRatio = ROLLUP_TEXT_CHAR_WIDTH_RATIO.default;
  if (TOP_LEFT_BADGE_CJK_LANGS.has(normalized)) {
    charWidthRatio = ROLLUP_TEXT_CHAR_WIDTH_RATIO.cjk;
  } else if (TOP_LEFT_BADGE_DENSE_LANGS.has(normalized)) {
    charWidthRatio = ROLLUP_TEXT_CHAR_WIDTH_RATIO.dense;
  }

  const detected = detectRollupTextScript(text);
  if (detected === 'cjk') {
    charWidthRatio = Math.max(charWidthRatio, ROLLUP_TEXT_CHAR_WIDTH_RATIO.cjk);
  } else if (detected === 'dense') {
    charWidthRatio = Math.max(charWidthRatio, ROLLUP_TEXT_CHAR_WIDTH_RATIO.dense);
  }

  return { charWidthRatio, locale: normalized };
}

function createTopLeftBadge(text, width, position = DEFAULT_ROLLUP_IMAGE_TILING_POSITION) {
  const safeText = normalizeOverlayValue(text);
  if (!safeText) return { buffer: null, size: 0 };

  const topLeft = position?.top_left || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_left;
  const fontFamily = position?.font_family || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_family;
  const fontKey = position?.font_key || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_key;
  const badgeMetrics = resolveTopLeftBadgeMetrics(fontKey);
  const { locale } = resolveRollupTextMetrics(fontKey);
  const diameter = Math.min(
    topLeft.diameter_max,
    Math.max(topLeft.diameter_min, Math.floor(width * topLeft.diameter_ratio))
  );
  const baseInnerPadding = Math.max(topLeft.inner_padding_min, Math.floor(diameter * topLeft.inner_padding_ratio));
  const boostedPadding = Math.max(baseInnerPadding, Math.floor(baseInnerPadding * badgeMetrics.paddingScale));
  const strokeWidth = 8;
  const strokeInset = Math.ceil(strokeWidth * 0.75);
  const maxInnerPadding = Math.max(0, Math.floor((diameter - 2) / 2));
  const innerPadding = Math.min(maxInnerPadding, boostedPadding + strokeInset);
  const innerDiameter = Math.max(1, diameter - innerPadding * 2);
  const normalizedText = safeText.replace(/[\\/_.-]/g, ' ');
  const baseFontSize = Math.max(
    scaleRollupFont(64),
    Math.floor(innerDiameter * 0.36 * ROLLUP_TEXT_SCALE)
  );
  const fontSize = Math.floor(baseFontSize * TOP_LEFT_FONT_SCALE);
  const maxCharsByWidth = Math.max(
    1,
    Math.floor(innerDiameter / (fontSize * badgeMetrics.charWidthRatio))
  );
  const maxChars = Math.max(1, Math.min(badgeMetrics.maxChars, maxCharsByWidth));
  const lines = wrapTextForLocale(normalizedText, maxChars, 2, locale);
  if (!lines.length) return { buffer: null, size: 0 };

  const lineHeight = Math.floor(fontSize * 1.05);
  const totalHeight = lineHeight * lines.length;
  const startY = Math.floor(innerPadding + (innerDiameter - totalHeight) / 2 + fontSize * 0.9);

  const svg = `
    <svg width="${diameter}" height="${diameter}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2 - 6}" fill="${TILE_OVERLAY_BACKGROUND_COLOR}" stroke="${OVERLAY_TEXT_COLOR}" stroke-width="${strokeWidth}" />
      ${lines
        .map(
          (line, idx) =>
            `<text x="50%" y="${startY + idx * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}"
              font-weight="800" fill="${OVERLAY_TEXT_COLOR}" text-anchor="middle" paint-order="stroke fill" stroke="${OVERLAY_TEXT_STROKE_COLOR}" stroke-width="2">
              ${escapeSvgText(line)}
            </text>`
        )
        .join('')}
    </svg>
  `;

  return { buffer: Buffer.from(svg), size: diameter };
}

function createTopRightLabel(text, width, opts = {}, position = DEFAULT_ROLLUP_IMAGE_TILING_POSITION) {
  const safeText = normalizeOverlayValue(text);
  if (!safeText) return { buffer: null, height: 0 };

  const topRight = position?.top_right || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_right;
  const fontFamily = position?.font_family || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_family;
  const margin = Number.isFinite(opts?.margin)
    ? Math.max(0, Math.floor(opts.margin))
    : Math.max(topRight.margin_min, Math.floor(width * topRight.margin_ratio));
  const paddingLeft = Math.round(topRight.padding_left * ROLLUP_TEXT_SCALE);
  const paddingRight = Math.round(topRight.padding_right * ROLLUP_TEXT_SCALE);
  const paddingTop = Math.round(topRight.padding_top * ROLLUP_TEXT_SCALE);
  const paddingBottom = Math.round(topRight.padding_bottom * ROLLUP_TEXT_SCALE);
  const maxLabelWidthRaw = Number.isFinite(opts?.maxWidth) ? Math.floor(opts.maxWidth) : width - margin * 2;
  const maxLabelWidth = Math.max(topRight.min_width, Math.min(width - margin * 2, maxLabelWidthRaw));
  const baseFontSize = Math.max(
    scaleRollupFont(78),
    Math.min(scaleRollupFont(96), Math.floor(width * 0.041 * ROLLUP_TEXT_SCALE))
  );
  const topRightFontScale = TOP_RIGHT_FONT_SCALE * TOP_RIGHT_FONT_SIZE_SCALE;
  const scaledBaseFontSize = Math.floor(baseFontSize * topRightFontScale);
  const textMaxWidth = Math.max(0, maxLabelWidth - paddingLeft - paddingRight);
  const maxChars = Math.max(
    6,
    Math.min(40, Math.floor(textMaxWidth / (scaledBaseFontSize * 0.58)))
  );
  const lines = wrapLines(safeText, maxChars, 2);
  if (!lines.length) return { buffer: null, height: 0 };

  const scaledMinFontSize = Math.floor(scaleRollupFont(70) * topRightFontScale);
  const fontSize = lines.length === 1
    ? scaledBaseFontSize
    : Math.max(scaledMinFontSize, Math.floor(scaledBaseFontSize * 0.92));
  const lineHeight = Math.floor(fontSize * 1.08);
  const textBlockHeight = lineHeight * (lines.length - 1) + fontSize;
  const labelHeight = textBlockHeight + paddingTop + paddingBottom;
  const overlayHeight = Math.max(Math.round(topRight.overlay_height_min * ROLLUP_TEXT_SCALE), labelHeight);
  const labelY = Math.floor((overlayHeight - labelHeight) / 2);
  const maxLineWidth = Math.max(1, ...lines.map((line) => Math.ceil(line.length * fontSize * 0.58)));
  const labelWidth = Math.min(maxLabelWidth, maxLineWidth + paddingLeft + paddingRight);
  const labelX = Math.max(0, width - margin - labelWidth);
  const cornerRadius = Math.max(12, Math.floor(Math.min(labelHeight, labelWidth) * 0.08));
  const textX = Math.floor(labelX + labelWidth / 2);
  const textStartY = Math.floor(labelY + (labelHeight - textBlockHeight) / 2 + fontSize / 2);
  const topRightBackgroundColor = 'rgba(20,20,20,0.02)';

  const svg = `
    <svg width="${width}" height="${overlayHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${topRightBackgroundColor}" />
      ${lines
        .map(
          (line, idx) =>
            `<text x="${textX}" y="${textStartY + idx * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}"
              font-weight="800" fill="${OVERLAY_TEXT_COLOR}" text-anchor="middle" dominant-baseline="middle" paint-order="stroke fill" stroke="${OVERLAY_TEXT_STROKE_COLOR}" stroke-width="2">
              ${escapeSvgText(line)}
            </text>`
        )
        .join('')}
    </svg>
  `;

  return { buffer: Buffer.from(svg), height: overlayHeight };
}

function paddingForTileSize(tileWidth, tileHeight) {
  const remainingWidth = Math.max(0, tileWidth - TILE_IMAGE_SIZE.width);
  const remainingHeight = Math.max(0, tileHeight - TILE_IMAGE_SIZE.height);

  const left = Math.floor(remainingWidth / 2);
  const right = remainingWidth - left;
  const top = Math.floor(remainingHeight / 2);
  const bottom = remainingHeight - top;

  return { left, right, top, bottom };
}

function computeStaggeredRowPositions(layout, edgeLeftWidth, edgeRightWidth) {
  const cols = layout?.cols || 0;
  if (cols < 2) return null;

  const columnWidths = layout?.columnWidths || [];
  const colLefts = [];
  let innerWidthSum = 0;
  for (let col = 1; col < cols; col += 1) {
    innerWidthSum += columnWidths[col] || BASE_TILE.width;
  }

  const edgeLeft = 0;
  const edgeRight = Math.max(edgeLeftWidth, ROLLUP_WIDTH - edgeRightWidth);
  const availableWidth = Math.max(0, edgeRight - edgeLeftWidth);
  // Include the gap between the last inner tile and the right split tile.
  const gapCount = cols;
  const staggerGap = gapCount > 0 ? Math.max(0, (availableWidth - innerWidthSum) / gapCount) : 0;

  let currentX = edgeLeftWidth + staggerGap;
  for (let col = 1; col < cols; col += 1) {
    colLefts[col] = currentX;
    const colWidth = columnWidths[col] || BASE_TILE.width;
    currentX += colWidth + staggerGap;
  }

  return {
    edgeLeft,
    edgeRight,
    colLefts,
  };
}

function buildTileOverlayLayers(item, columnWidth, tileHeight, position = DEFAULT_ROLLUP_IMAGE_TILING_POSITION) {
  const overlay = resolveOverlayFields(item);
  const padding = paddingForTileSize(columnWidth, tileHeight);
  const imageWidth = Math.max(1, columnWidth - padding.left - padding.right);
  const imageHeight = Math.max(1, tileHeight - padding.top - padding.bottom);
  const topLeft = position?.top_left || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_left;
  const topRight = position?.top_right || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_right;
  const bottom = position?.bottom || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.bottom;
  const topLeftMargin = Math.max(topLeft.margin_min, Math.floor(imageWidth * topLeft.margin_ratio));
  const topRightMarginBase = Math.max(topRight.margin_min, Math.floor(imageWidth * topRight.margin_ratio));
  const topRightMarginBoost = Math.max(
    TOP_RIGHT_MARGIN_BOOST_MIN,
    Math.floor(imageWidth * TOP_RIGHT_MARGIN_BOOST_RATIO)
  );
  const topRightMargin = topRightMarginBase + topRightMarginBoost;
  const topRightMarginRight = Math.max(0, Math.round(topRightMargin * TOP_RIGHT_MARGIN_RIGHT_SCALE));
  const topRightMarginTop = Math.max(0, Math.round(topRightMargin * TOP_RIGHT_MARGIN_TOP_SCALE));
  const footerOffset = getFooterOverlayOffset(imageHeight, position);
  const layers = [];

  const footerInset = Math.max(bottom.inset_min, Math.floor(imageWidth * bottom.inset_ratio));
  const footerWidth = Math.max(1, imageWidth - footerInset * 2);
  const footerOverlay = createFooterOverlay(overlay.footer, footerWidth, position);
  if (footerOverlay.buffer) {
    layers.push({
      kind: 'footer',
      buffer: footerOverlay.buffer,
      width: footerWidth,
      height: footerOverlay.height,
      left: padding.left + footerInset,
      top: Math.max(padding.top, padding.top + imageHeight - footerOverlay.height - footerOffset),
    });
  }

  const topLeftOverlay = createTopLeftBadge(overlay.top_left, imageWidth, position);
  if (topLeftOverlay.buffer) {
    layers.push({
      kind: 'top_left',
      buffer: topLeftOverlay.buffer,
      width: topLeftOverlay.size,
      height: topLeftOverlay.size,
      left: padding.left + topLeftMargin,
      top: padding.top + topLeftMargin,
    });
  }

  const reservedLeft = topLeftOverlay.buffer ? topLeftMargin + topLeftOverlay.size + topLeftMargin : topLeftMargin;
  const maxTopRightWidth = Math.max(topRight.max_width_floor, imageWidth - reservedLeft - topRightMarginRight);
  const topRightOverlay = createTopRightLabel(overlay.top_right, imageWidth, {
    margin: topRightMarginRight,
    maxWidth: maxTopRightWidth,
  }, position);
  if (topRightOverlay.buffer) {
    layers.push({
      kind: 'top_right',
      buffer: topRightOverlay.buffer,
      width: imageWidth,
      height: topRightOverlay.height,
      left: padding.left,
      top: padding.top + topRightMarginTop,
    });
  }

  return { overlay, layers };
}

async function buildTile(item, columnIndex, layout, opts = {}) {
  const includeOverlays = opts?.includeOverlays !== false;
  const rounded = opts?.rounded !== false;
  const fetcher = typeof opts?.fetcher === 'function' ? opts.fetcher : null;
  const tilingPosition = opts?.tilingPosition || DEFAULT_ROLLUP_IMAGE_TILING_POSITION;
  const fetchRetries = Number.isFinite(opts?.fetchRetries) ? Math.max(0, Math.floor(opts.fetchRetries)) : ROLLUP_FETCH_RETRIES;
  const fetchRetryDelayMs = Number.isFinite(opts?.fetchRetryDelayMs)
    ? Math.max(0, Math.floor(opts.fetchRetryDelayMs))
    : ROLLUP_FETCH_RETRY_DELAY_MS;
  const fetchTimeoutMs = Number.isFinite(opts?.fetchTimeoutMs)
    ? Math.max(0, Math.floor(opts.fetchTimeoutMs))
    : ROLLUP_FETCH_TIMEOUT_MS;
  try {
    const resolvedLayout = layout || computeTileLayout();
    const columnWidth =
      resolvedLayout.columnWidths?.[columnIndex % resolvedLayout.cols] || BASE_TILE.width;
    const tileHeight = resolvedLayout.tileHeight || BASE_TILE.height;
    const padding = paddingForTileSize(columnWidth, tileHeight);
    const baseBuffer = fetcher
      ? await fetcher(item.image_url, { ...(opts?.logContext || {}), stage: 'tile' })
      : await fetchImageBufferWithRetry(item.image_url, {
          retries: fetchRetries,
          retryDelayMs: fetchRetryDelayMs,
          timeoutMs: fetchTimeoutMs,
          context: opts?.logContext,
        });
    const imageWidth = Math.max(1, columnWidth - padding.left - padding.right);
    const imageHeight = Math.max(1, tileHeight - padding.top - padding.bottom);
    // Keep the raw pixel orientation; some landscape assets carry EXIF rotation.
    let resizePipeline = sharp(baseBuffer).resize(imageWidth, imageHeight, {
        fit: 'cover',
        position: 'centre',
        background: TILE_BACKGROUND_COLOR,
      });
    if (!rounded) {
      resizePipeline = resizePipeline.flatten({ background: TILE_BACKGROUND_COLOR });
    }
    const resized = await resizePipeline.png().toBuffer();

    let baseImage = resized;
    if (rounded) {
      const imageCornerRadius = Math.max(12, Math.round(TILE_CORNER_RADIUS * (imageWidth / columnWidth)));
      const roundedImageMask = Buffer.from(
        `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${imageWidth}" height="${imageHeight}" rx="${imageCornerRadius}" ry="${imageCornerRadius}" fill="white"/></svg>`
      );
      baseImage = await sharp(resized)
        .composite([{ input: roundedImageMask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    }

    let pipeline = sharp(baseImage).extend({
      top: padding.top,
      bottom: padding.bottom,
      left: padding.left,
      right: padding.right,
      background: TILE_BACKGROUND_COLOR,
    });

    if (includeOverlays) {
      const { layers } = buildTileOverlayLayers(item, columnWidth, tileHeight, tilingPosition);
      if (layers.length) {
        pipeline = pipeline.composite(
          layers.map((layer) => ({
            input: layer.buffer,
            left: layer.left,
            top: layer.top,
          }))
        );
      }
    }

    return await pipeline.png().toBuffer();
  } catch (err) {
    console.error('[rollup_banner] buildTile failed', {
      imageUrl: item?.image_url,
      overlay: resolveOverlayFields(item),
      error: err,
      stack: err?.stack,
    });
    throw err;
  }
}

async function buildFallbackTile(columnIndex, layout, opts = {}) {
  const resolvedLayout = layout || computeTileLayout();
  const columnWidth =
    resolvedLayout.columnWidths?.[columnIndex % resolvedLayout.cols] || BASE_TILE.width;
  const tileHeight = resolvedLayout.tileHeight || BASE_TILE.height;

  let pipeline = sharp({
    create: {
      width: columnWidth,
      height: tileHeight,
      channels: 4,
      background: TILE_BACKGROUND_COLOR,
    },
  });

  return pipeline.png().toBuffer();
}

async function splitOverlayBuffer(buffer, width, height, splitX) {
  const splitAt = Math.max(0, Math.min(width, Math.floor(splitX)));
  if (splitAt <= 0) {
    return { leftBuffer: null, rightBuffer: buffer, leftWidth: 0, rightWidth: width };
  }
  if (splitAt >= width) {
    return { leftBuffer: buffer, rightBuffer: null, leftWidth: width, rightWidth: 0 };
  }

  const base = sharp(buffer);
  const [leftBuffer, rightBuffer] = await Promise.all([
    base
      .clone()
      .extract({ left: 0, top: 0, width: splitAt, height })
      .png()
      .toBuffer(),
    base
      .clone()
      .extract({ left: splitAt, top: 0, width: width - splitAt, height })
      .png()
      .toBuffer(),
  ]);

  return { leftBuffer, rightBuffer, leftWidth: splitAt, rightWidth: width - splitAt };
}

async function splitTileHorizontally(tileBuffer, tileWidth, tileHeight) {
  const leftWidth = Math.floor(tileWidth / 2);
  const rightWidth = tileWidth - leftWidth;

  const base = sharp(tileBuffer);
  const [leftHalf, rightHalf] = await Promise.all([
    base
      .clone()
      .extract({ left: 0, top: 0, width: leftWidth, height: tileHeight })
      .png()
      .toBuffer(),
    base
      .clone()
      .extract({ left: leftWidth, top: 0, width: rightWidth, height: tileHeight })
      .png()
      .toBuffer(),
  ]);

  return { leftHalf, rightHalf, leftWidth, rightWidth };
}

async function shiftTileHalfPadding(buffer, halfWidth, tileHeight, opts = {}) {
  if (!buffer) return buffer;
  const shiftLeft = Number.isFinite(opts?.shiftLeft) ? Math.max(0, Math.floor(opts.shiftLeft)) : 0;
  const shiftRight = Number.isFinite(opts?.shiftRight) ? Math.max(0, Math.floor(opts.shiftRight)) : 0;
  if (!shiftLeft && !shiftRight) return buffer;

  const width = Math.floor(halfWidth);
  const height = Math.floor(tileHeight);
  if (width <= 0 || height <= 0) return buffer;

  const cropLeft = Math.min(shiftLeft, width);
  const cropRight = Math.min(shiftRight, width - cropLeft);
  const croppedWidth = width - cropLeft - cropRight;
  if (croppedWidth <= 0) return buffer;

  return sharp(buffer)
    .extract({ left: cropLeft, top: 0, width: croppedWidth, height })
    .extend({
      top: 0,
      bottom: 0,
      left: cropRight,
      right: cropLeft,
      background: TILE_BACKGROUND_COLOR,
    })
    .png()
    .toBuffer();
}

function buildSideRoundedMask(width, height, opts = {}) {
  const roundLeft = opts?.roundLeft !== false;
  const roundRight = opts?.roundRight !== false;
  const rawRadius = Number.isFinite(opts?.radius) ? Math.floor(opts.radius) : TILE_CORNER_RADIUS;
  const radius = Math.max(0, Math.min(rawRadius, Math.floor(Math.min(width, height) / 2)));
  const leftSquare = !roundLeft && radius > 0
    ? `<rect x="0" y="0" width="${radius}" height="${height}" fill="white" />`
    : '';
  const rightSquare = !roundRight && radius > 0
    ? `<rect x="${width - radius}" y="0" width="${radius}" height="${height}" fill="white" />`
    : '';

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white" />
      ${leftSquare}
      ${rightSquare}
    </svg>
  `;

  return Buffer.from(svg);
}

async function applySideRoundedMask(buffer, width, height, opts = {}) {
  const mask = buildSideRoundedMask(width, height, opts);
  return sharp(buffer)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

const cornerCutoutCache = new Map();

function buildCornerCutoutMask(radius) {
  const size = Math.max(1, Math.floor(radius));
  const circlePath = `M ${size} ${size} m -${size},0 a ${size},${size} 0 1,0 ${size * 2},0 a ${size},${size} 0 1,0 -${size * 2},0`;
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 0 H${size} V${size} H0 Z ${circlePath}" fill="white" fill-rule="evenodd" />
    </svg>
  `;
  return Buffer.from(svg);
}

async function getCornerCutouts(radius) {
  const size = Math.max(1, Math.floor(radius));
  if (cornerCutoutCache.has(size)) return cornerCutoutCache.get(size);

  const base = buildCornerCutoutMask(size);
  const [tr, bl, br] = await Promise.all([
    sharp(base).flop().png().toBuffer(),
    sharp(base).flip().png().toBuffer(),
    sharp(base).flip().flop().png().toBuffer(),
  ]);
  const entry = { size, tl: base, tr, bl, br };
  cornerCutoutCache.set(size, entry);
  return entry;
}

async function applyGridOverlays(grid, items, layout, context = {}) {
  if (!grid?.buffer || !Array.isArray(items) || items.length === 0) return grid;

  const resolvedLayout = layout || computeTileLayout();
  const { columnOffsets, columnWidths, cols, vPad, outerPadTop, tileHeight, outerPadRight } = resolvedLayout;
  const rowCount = Math.ceil(items.length / cols);
  const contentRight = ROLLUP_WIDTH - (outerPadRight || 0);
  const composites = [];
  const sessionId = context?.sessionId;
  const tilingPosition = context?.tilingPosition || DEFAULT_ROLLUP_IMAGE_TILING_POSITION;

  const pushLayer = (layer, left, top) => {
    if (!layer?.buffer) return;
    composites.push({ input: layer.buffer, left: Math.floor(left), top: Math.floor(top) });
  };

  for (let row = 0; row < rowCount; row += 1) {
    const rowItems = items.slice(row * cols, row * cols + cols);
    const tileTop = outerPadTop + row * (tileHeight + vPad);
    const shouldStagger = cols > 1 && row % 2 === 1 && rowItems.length === cols;

    if (!shouldStagger) {
      rowItems.forEach((item, col) => {
        if (!item) return;
        const tileIndex = row * cols + col;
        const columnWidth = columnWidths?.[col] || BASE_TILE.width;
        const tileLeft = columnOffsets[col] || 0;
        try {
          const { layers } = buildTileOverlayLayers(item, columnWidth, tileHeight, tilingPosition);
          layers.forEach((layer) => pushLayer(layer, tileLeft + layer.left, tileTop + layer.top));
        } catch (error) {
          console.error('[rollup_banner] overlay build failed', {
            sessionId,
            tileIndex,
            imageUrl: item?.image_url,
            overlay: resolveOverlayFields(item),
            error,
            stack: error?.stack,
          });
          throw error;
        }
      });
      continue;
    }

    const firstItem = rowItems[0];
    const firstWidth = columnWidths?.[0] || BASE_TILE.width;
    const leftWidth = Math.floor(firstWidth / 2);
    const rightWidth = firstWidth - leftWidth;
    const staggeredPositions = computeStaggeredRowPositions(resolvedLayout, leftWidth, rightWidth);
    const edgeLeft = staggeredPositions?.edgeLeft ?? (columnOffsets[0] || 0);
    const edgeRight = staggeredPositions?.edgeRight ?? contentRight - rightWidth;

    if (firstItem) {
      const tileIndex = row * cols;
      try {
        const { layers, overlay } = buildTileOverlayLayers(firstItem, firstWidth, tileHeight, tilingPosition);
        const padding = paddingForTileSize(firstWidth, tileHeight);
        const leftShift = padding.left;
        const rightShift = padding.right;
        const imageHeight = Math.max(1, tileHeight - padding.top - padding.bottom);
        const footerOffset = getFooterOverlayOffset(imageHeight, tilingPosition);
        for (const layer of layers) {
          if (layer.kind === 'footer') {
            const splitX = leftWidth - layer.left;
            const leftOverlayWidth = Math.max(0, Math.min(layer.width, Math.floor(splitX)));
            const rightOverlayWidth = Math.max(0, layer.width - leftOverlayWidth);
            const baseTop = tileTop + padding.top + imageHeight - footerOffset;

            if (leftOverlayWidth > 0) {
              const leftFooter = createFooterOverlay(overlay.footer, leftOverlayWidth, tilingPosition);
              if (leftFooter.buffer) {
                pushLayer(
                  { buffer: leftFooter.buffer },
                  edgeLeft + layer.left - leftShift,
                  baseTop - leftFooter.height
                );
              }
            }

            if (rightOverlayWidth > 0) {
              const rightFooter = createFooterOverlay(overlay.footer, rightOverlayWidth, tilingPosition);
              if (rightFooter.buffer) {
                const rightOffset = Math.max(0, layer.left - leftWidth);
                pushLayer(
                  { buffer: rightFooter.buffer },
                  edgeRight + rightOffset + rightShift,
                  baseTop - rightFooter.height
                );
              }
            }
            continue;
          }
          // Keep overlay text aligned with the staggered split tile.
          const splitX = leftWidth - layer.left;
          const { leftBuffer, rightBuffer } = await splitOverlayBuffer(
            layer.buffer,
            layer.width,
            layer.height,
            splitX
          );
          if (leftBuffer) {
            pushLayer({ buffer: leftBuffer }, edgeLeft + layer.left - leftShift, tileTop + layer.top);
          }
          if (rightBuffer) {
            const rightOffset = Math.max(0, layer.left - leftWidth);
            pushLayer(
              { buffer: rightBuffer },
              edgeRight + rightOffset + rightShift,
              tileTop + layer.top
            );
          }
        }
      } catch (error) {
        console.error('[rollup_banner] overlay split failed', {
          sessionId,
          tileIndex,
          imageUrl: firstItem?.image_url,
          overlay: resolveOverlayFields(firstItem),
          error,
          stack: error?.stack,
        });
        throw error;
      }
    }

    for (let col = 1; col < cols; col += 1) {
      const item = rowItems[col];
      if (!item) continue;
      const tileIndex = row * cols + col;
      const columnWidth = columnWidths?.[col] || BASE_TILE.width;
      const tileLeft = staggeredPositions?.colLefts?.[col] ?? ((columnOffsets[col] || 0) - leftWidth);
      try {
        const { layers } = buildTileOverlayLayers(item, columnWidth, tileHeight, tilingPosition);
        layers.forEach((layer) => pushLayer(layer, tileLeft + layer.left, tileTop + layer.top));
      } catch (error) {
        console.error('[rollup_banner] overlay build failed', {
          sessionId,
          tileIndex,
          imageUrl: item?.image_url,
          overlay: resolveOverlayFields(item),
          error,
          stack: error?.stack,
        });
        throw error;
      }
    }
  }

  if (!composites.length) return grid;

  try {
    const buffer = await sharp(grid.buffer).composite(composites).png().toBuffer();
    return { ...grid, buffer };
  } catch (error) {
    console.error('[rollup_banner] overlay composite failed', {
      sessionId,
      overlayCount: composites.length,
      error,
      stack: error?.stack,
    });
    throw error;
  }
}

async function applyStaggeredEdgeRounding(grid, items, layout) {
  if (!grid?.buffer || !Array.isArray(items) || items.length === 0) return grid;

  const resolvedLayout = layout || computeTileLayout();
  const { columnOffsets, columnWidths, cols, vPad, outerPadTop, tileHeight, outerPadRight } = resolvedLayout;
  if (cols < 2) return grid;

  const rowCount = Math.ceil(items.length / cols);
  const contentRight = ROLLUP_WIDTH - (outerPadRight || 0);
  let buffer = grid.buffer;
  let cachedLeftClear = null;
  let cachedRightClear = null;
  let cachedLeftWidth = null;
  let cachedRightWidth = null;

  for (let row = 0; row < rowCount; row += 1) {
    const rowItems = items.slice(row * cols, row * cols + cols);
    const shouldStagger = row % 2 === 1 && rowItems.length === cols;
    if (!shouldStagger) continue;

    const rowTop = outerPadTop + row * (tileHeight + vPad);
    const firstWidth = columnWidths?.[0] || BASE_TILE.width;
    const leftWidth = Math.floor(firstWidth / 2);
    const rightWidth = firstWidth - leftWidth;
    const padding = paddingForTileSize(firstWidth, tileHeight);
    const imageWidth = Math.max(1, firstWidth - padding.left - padding.right);
    const imageCornerRadius = Math.max(12, Math.round(TILE_CORNER_RADIUS * (imageWidth / firstWidth)));
    const staggeredPositions = computeStaggeredRowPositions(resolvedLayout, leftWidth, rightWidth);
    const edgeLeft = staggeredPositions?.edgeLeft ?? (columnOffsets[0] || 0);
    const edgeRight = staggeredPositions?.edgeRight ?? contentRight - rightWidth;
    const leftRadius = Math.max(0, Math.min(imageCornerRadius, Math.floor(Math.min(leftWidth, tileHeight) / 2)));
    const rightRadius = Math.max(0, Math.min(imageCornerRadius, Math.floor(Math.min(rightWidth, tileHeight) / 2)));
    const [leftCutouts, rightCutouts] = await Promise.all([
      getCornerCutouts(leftRadius),
      getCornerCutouts(rightRadius),
    ]);
    const base = sharp(buffer);
    const edgeLeftInt = Math.floor(edgeLeft);
    const edgeRightInt = Math.floor(edgeRight);
    const rowTopInt = Math.floor(rowTop);
    const [leftHalfExtract, rightHalfExtract] = await Promise.all([
      base
        .clone()
        .extract({ left: edgeLeftInt, top: rowTopInt, width: leftWidth, height: tileHeight })
        .png()
        .toBuffer(),
      base
        .clone()
        .extract({ left: edgeRightInt, top: rowTopInt, width: rightWidth, height: tileHeight })
        .png()
        .toBuffer(),
    ]);
    const [leftRounded, rightRounded] = await Promise.all([
      applySideRoundedMask(leftHalfExtract, leftWidth, tileHeight, { roundLeft: true, roundRight: false, radius: leftRadius }),
      applySideRoundedMask(rightHalfExtract, rightWidth, tileHeight, { roundLeft: false, roundRight: true, radius: rightRadius }),
    ]);

    if (!cachedRightClear || cachedRightWidth !== rightWidth) {
      cachedRightWidth = rightWidth;
      cachedRightClear = await sharp({
        create: {
          width: rightWidth,
          height: tileHeight,
          channels: 4,
          background: ROLLUP_BACKGROUND_COLOR,
        },
      })
        .png()
        .toBuffer();
    }

    if (!cachedLeftClear || cachedLeftWidth !== leftWidth) {
      cachedLeftWidth = leftWidth;
      cachedLeftClear = await sharp({
        create: {
          width: leftWidth,
          height: tileHeight,
          channels: 4,
          background: ROLLUP_BACKGROUND_COLOR,
        },
      })
        .png()
        .toBuffer();
    }

    buffer = await sharp(buffer)
      .ensureAlpha()
      .composite([
        { input: cachedLeftClear, left: edgeLeftInt, top: rowTopInt },
        { input: cachedRightClear, left: edgeRightInt, top: rowTopInt },
        { input: leftRounded, left: edgeLeftInt, top: rowTopInt },
        { input: rightRounded, left: edgeRightInt, top: rowTopInt },
        { input: leftCutouts.tl, left: edgeLeftInt, top: rowTopInt, blend: 'dest-out' },
        {
          input: leftCutouts.bl,
          left: edgeLeftInt,
          top: rowTopInt + tileHeight - leftCutouts.size,
          blend: 'dest-out',
        },
        {
          input: rightCutouts.tr,
          left: edgeRightInt + rightWidth - rightCutouts.size,
          top: rowTopInt,
          blend: 'dest-out',
        },
        {
          input: rightCutouts.br,
          left: edgeRightInt + rightWidth - rightCutouts.size,
          top: rowTopInt + tileHeight - rightCutouts.size,
          blend: 'dest-out',
        },
      ])
      .png()
      .toBuffer();
  }

  return { ...grid, buffer };
}

async function buildGrid(tiles, items, layout) {
  const resolvedLayout = layout || computeTileLayout();
  const { columnOffsets, columnWidths, cols, vPad, outerPadTop, tileHeight, outerPadRight } = resolvedLayout;
  const width = ROLLUP_WIDTH;
  const height = ROLLUP_GRID_HEIGHT;

  const composites = [];
  const rowCount = Math.ceil(tiles.length / cols);
  const contentRight = width - (outerPadRight || 0);

  for (let row = 0; row < rowCount; row += 1) {
    const rowStart = row * cols;
    const rowTiles = tiles.slice(rowStart, rowStart + cols);
    const top = outerPadTop + row * (tileHeight + vPad);
    const shouldStagger = cols > 1 && row % 2 === 1 && rowTiles.length === cols;

    if (!shouldStagger) {
      rowTiles.forEach((tileBuf, col) => {
        const left = columnOffsets[col] || 0;
        composites.push({ input: tileBuf, left, top });
      });
      continue;
    }

    const firstTile = rowTiles[0];
    const firstWidth = columnWidths?.[0] || BASE_TILE.width;
    const { leftHalf, rightHalf, leftWidth, rightWidth } = await splitTileHorizontally(firstTile, firstWidth, tileHeight);
    const staggerPadding = paddingForTileSize(firstWidth, tileHeight);
    const adjustedLeftHalf = await shiftTileHalfPadding(leftHalf, leftWidth, tileHeight, {
      shiftLeft: staggerPadding.left,
    });
    const adjustedRightHalf = await shiftTileHalfPadding(rightHalf, rightWidth, tileHeight, {
      shiftRight: staggerPadding.right,
    });
    const staggeredPositions = computeStaggeredRowPositions(resolvedLayout, leftWidth, rightWidth);
    const edgeLeft = staggeredPositions?.edgeLeft ?? (columnOffsets[0] || 0);
    const edgeRight = staggeredPositions?.edgeRight ?? contentRight - rightWidth;
    composites.push({
      input: adjustedLeftHalf,
      left: Math.floor(edgeLeft),
      top: Math.floor(top),
    });

    for (let col = 1; col < cols; col += 1) {
      const baseLeft = staggeredPositions?.colLefts?.[col] ?? ((columnOffsets[col] || 0) - leftWidth);
      composites.push({ input: rowTiles[col], left: Math.floor(baseLeft), top: Math.floor(top) });
    }

    composites.push({ input: adjustedRightHalf, left: Math.floor(edgeRight), top: Math.floor(top) });
  }

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: ROLLUP_BACKGROUND_COLOR,
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { buffer, width, height };
}

function createFooterTextOverlay(text, width, height) {
  const safeText = typeof text === 'string' ? text.trim() : '';
  if (!safeText) return null;

  const lines = wrapLines(safeText, 36, 3);
  if (!lines.length) return null;

  const fontSize = scaleRollupFont(lines.length === 1 ? 96 : 82);
  const lineHeight = Math.floor(fontSize * 1.12);
  const totalHeight = lineHeight * lines.length;
  const startY = Math.max(Math.round(110 * ROLLUP_TEXT_SCALE), Math.floor(height * 0.3 - totalHeight / 2) + fontSize);

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${lines
        .map(
          (line, idx) =>
            `<text x="50%" y="${startY + idx * lineHeight}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}"
              font-weight="800" fill="${OVERLAY_TEXT_COLOR}" text-anchor="middle" paint-order="stroke fill"
              stroke="${OVERLAY_TEXT_STROKE_COLOR}" stroke-width="2">
              ${escapeSvgText(line)}
            </text>`
        )
        .join('')}
    </svg>
  `;

  return Buffer.from(svg);
}

async function buildFooter(footerImageUrl) {
  const width = ROLLUP_WIDTH;
  const height = ROLLUP_FOOTER_HEIGHT;

  if (!footerImageUrl) {
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }

  try {
    const fetched = await fetchImageBufferWithRetry(footerImageUrl, {
      context: { stage: 'rollup_footer' },
    });
    return sharp(fetched)
      .resize(width, height, { fit: 'cover', position: 'centre', background: ROLLUP_BACKGROUND_COLOR })
      .png()
      .toBuffer();
  } catch (err) {
    console.error('[rollup_banner] footer image fetch failed', err);
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }
}

async function composeBanner(top, grid, footer) {
  const height = ROLLUP_HEIGHT;
  const width = ROLLUP_WIDTH;

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: ROLLUP_BACKGROUND_COLOR,
    },
  })
    .composite([
      { input: top, left: 0, top: 0 },
      { input: grid.buffer, left: 0, top: ROLLUP_TOP_HEIGHT },
      { input: footer, left: 0, top: ROLLUP_TOP_HEIGHT + grid.height },
    ])
    .png()
    .toBuffer();
}

function scaleRollupValue(value, scale, opts = {}) {
  if (!Number.isFinite(value)) return value;
  const mode = opts.round || 'round';
  let scaled = value * scale;
  if (mode === 'floor') {
    scaled = Math.floor(scaled);
  } else if (mode === 'ceil') {
    scaled = Math.ceil(scaled);
  } else if (mode === 'none') {
    scaled = scaled;
  } else {
    scaled = Math.round(scaled);
  }
  if (Number.isFinite(opts.min)) {
    scaled = Math.max(opts.min, scaled);
  }
  if (Number.isFinite(opts.max)) {
    scaled = Math.min(opts.max, scaled);
  }
  return scaled;
}

function scaleRollupFloat(value, scale, precision = 2) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** precision;
  return Math.round(value * scale * factor) / factor;
}

function scaleRollupStrokeWidth(value, spec) {
  const scaled = scaleRollupFloat(value, spec.scale, 2);
  return Math.max(0.2, scaled);
}

function scaleRollupFontForThumbnail(size, spec) {
  const scaled = size * ROLLUP_TEXT_SCALE * spec.scale;
  return Math.max(1, Math.round(scaled));
}

function buildRollupThumbnailSpec(scale = ROLLUP_THUMBNAIL_SCALE) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : ROLLUP_THUMBNAIL_SCALE;
  const round = (value, min = 0) => scaleRollupValue(value, safeScale, { min });
  const width = round(ROLLUP_WIDTH, 1);
  const topHeight = round(ROLLUP_TOP_HEIGHT, 1);
  const footerHeight = round(ROLLUP_FOOTER_HEIGHT, 1);
  const tileHeight = round(TILE_HEIGHT, 1);
  const columnWidths = TILE_COLUMN_WIDTHS.map((widthValue) => round(widthValue, 1));
  const tileImageSize = {
    width: round(TILE_IMAGE_SIZE.width, 1),
    height: round(TILE_IMAGE_SIZE.height, 1),
  };
  const gridOuterPadding = round(GRID_OUTER_PADDING, 0);
  const gridGutter = round(GRID_GUTTER, 0);
  const gridHeight = tileHeight * ROLLUP_ROWS + gridGutter * (ROLLUP_ROWS - 1) + gridOuterPadding * 2;
  const height = topHeight + gridHeight + footerHeight;

  return {
    scale: safeScale,
    width,
    height,
    topHeight,
    gridHeight,
    footerHeight,
    tileHeight,
    columnWidths,
    tileImageSize,
    gridOuterPadding,
    gridGutter,
    cornerRadius: round(TILE_CORNER_RADIUS, 1),
    topRightMarginBoostMin: round(TOP_RIGHT_MARGIN_BOOST_MIN, 1),
    minImageCornerRadius: round(12, 1),
    footerCornerRadiusMin: round(14, 1),
    labelCornerRadiusMin: round(12, 1),
    badgeDiameterInset: Math.max(1, round(2, 1)),
    baseTile: {
      width: columnWidths[0],
      height: tileHeight,
    },
  };
}

function scaleRollupImageTilingPosition(position, scale) {
  if (!position || typeof position !== 'object') {
    return position;
  }
  const scaleValue = (value) => scaleRollupValue(value, scale, { min: 0 });
  const clone = (value) => {
    if (!value || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => clone(item));
    }
    const output = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (entry && typeof entry === 'object') {
        output[key] = clone(entry);
        return;
      }
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey.includes('ratio') || normalizedKey.includes('scale')) {
          output[key] = entry;
        } else {
          output[key] = scaleValue(entry);
        }
        return;
      }
      output[key] = entry;
    });
    return output;
  };
  return clone(position);
}

const computeThumbnailTileLayout = (columns = ROLLUP_COLUMNS, spec = ROLLUP_THUMBNAIL_SPEC) => {
  const parsedCols = Number(columns);
  const cols = Number.isFinite(parsedCols) && parsedCols > 0
    ? Math.min(spec.columnWidths.length, Math.max(1, Math.floor(parsedCols)))
    : ROLLUP_COLUMNS;
  const rows = ROLLUP_ROWS;
  const columnWidths = spec.columnWidths.slice(0, cols);
  const tileHeight = spec.tileHeight;

  const contentWidth = columnWidths.reduce((sum, width) => sum + width, 0) + spec.gridGutter * (cols - 1);
  const baseOuterSpaceX = spec.gridOuterPadding * 2;
  const remainingWidth = Math.max(0, spec.width - contentWidth - baseOuterSpaceX);
  const extraLeft = Math.floor(remainingWidth / 2);
  const outerPadLeft = spec.gridOuterPadding + extraLeft;
  const outerPadRight = spec.gridOuterPadding + (remainingWidth - extraLeft);

  const contentHeight = tileHeight * rows + spec.gridGutter * (rows - 1);
  const baseOuterSpaceY = spec.gridOuterPadding * 2;
  const remainingHeight = Math.max(0, spec.gridHeight - contentHeight - baseOuterSpaceY);
  const extraTop = Math.floor(remainingHeight / 2);
  const outerPadTop = spec.gridOuterPadding + extraTop;
  const outerPadBottom = spec.gridOuterPadding + (remainingHeight - extraTop);

  const columnOffsets = [];
  let currentX = outerPadLeft;
  columnWidths.forEach((width, idx) => {
    columnOffsets.push(currentX);
    if (idx < cols - 1) {
      currentX += width + spec.gridGutter;
    }
  });

  return {
    tileHeight,
    columnWidths,
    columnOffsets,
    hPad: spec.gridGutter,
    vPad: spec.gridGutter,
    outerPadLeft,
    outerPadRight,
    outerPadTop,
    outerPadBottom,
    cols,
    rows,
  };
};

function paddingForThumbnailTileSize(tileWidth, tileHeight, spec = ROLLUP_THUMBNAIL_SPEC) {
  const remainingWidth = Math.max(0, tileWidth - spec.tileImageSize.width);
  const remainingHeight = Math.max(0, tileHeight - spec.tileImageSize.height);

  const left = Math.floor(remainingWidth / 2);
  const right = remainingWidth - left;
  const top = Math.floor(remainingHeight / 2);
  const bottom = remainingHeight - top;

  return { left, right, top, bottom };
}

function computeThumbnailStaggeredRowPositions(layout, edgeLeftWidth, edgeRightWidth, spec = ROLLUP_THUMBNAIL_SPEC) {
  const cols = layout?.cols || 0;
  if (cols < 2) return null;

  const columnWidths = layout?.columnWidths || [];
  const colLefts = [];
  let innerWidthSum = 0;
  for (let col = 1; col < cols; col += 1) {
    innerWidthSum += columnWidths[col] || spec.baseTile.width;
  }

  const edgeLeft = 0;
  const edgeRight = Math.max(edgeLeftWidth, spec.width - edgeRightWidth);
  const availableWidth = Math.max(0, edgeRight - edgeLeftWidth);
  const gapCount = cols;
  const staggerGap = gapCount > 0 ? Math.max(0, (availableWidth - innerWidthSum) / gapCount) : 0;

  let currentX = edgeLeftWidth + staggerGap;
  for (let col = 1; col < cols; col += 1) {
    colLefts[col] = currentX;
    const colWidth = columnWidths[col] || spec.baseTile.width;
    currentX += colWidth + staggerGap;
  }

  return {
    edgeLeft,
    edgeRight,
    colLefts,
  };
}

function createThumbnailFooterOverlay(text, width, position = DEFAULT_ROLLUP_IMAGE_TILING_POSITION, spec = ROLLUP_THUMBNAIL_SPEC) {
  const safeText = normalizeOverlayValue(text);
  if (!safeText) return { buffer: null, height: 0 };

  const bottom = position?.bottom || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.bottom;
  const fontFamily = position?.font_family || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_family;
  const fontKey = position?.font_key || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_key;
  const { charWidthRatio, locale } = resolveRollupTextMetrics(fontKey, safeText);
  const lineMargin = Math.max(bottom.container_margin_min, Math.floor(width * bottom.container_margin_ratio));
  const baseFontSize = Math.max(
    scaleRollupFontForThumbnail(76, spec),
    Math.min(scaleRollupFontForThumbnail(110, spec), Math.floor(width * 0.05 * ROLLUP_TEXT_SCALE))
  );
  const containerX = lineMargin;
  const containerWidth = Math.max(1, width - lineMargin * 2);
  const textInset = Math.max(bottom.text_inset_min, Math.floor(containerWidth * bottom.text_inset_ratio));
  const textMaxWidth = Math.max(1, containerWidth - textInset * 2);

  const twoLineFontSize = Math.max(scaleRollupFontForThumbnail(70, spec), Math.floor(baseFontSize * 0.92));
  const twoLineHeight = Math.floor(twoLineFontSize * 1.22);
  const twoLinePaddingY = Math.max(scaleRollupFontForThumbnail(52, spec), Math.floor(twoLineFontSize * 1.15));
  const overlayHeight = Math.max(
    twoLineHeight * 2 + twoLinePaddingY * 2,
    Math.round(bottom.overlay_height_min * ROLLUP_TEXT_SCALE)
  );

  const safeTextMaxWidth = Math.max(1, Math.floor(textMaxWidth * FOOTER_TEXT_WIDTH_SAFETY));
  const maxCharsSingle = Math.max(1, Math.min(40, Math.floor(safeTextMaxWidth / (baseFontSize * charWidthRatio))));
  const singleWrap = wrapFooterTextLines(
    safeText,
    maxCharsSingle,
    1,
    baseFontSize,
    charWidthRatio,
    locale,
    safeTextMaxWidth
  );
  const singleLines = singleWrap.lines;

  const maxCharsDouble = Math.max(1, Math.min(40, Math.floor(safeTextMaxWidth / (twoLineFontSize * charWidthRatio))));
  const doubleWrap = wrapFooterTextLines(
    safeText,
    maxCharsDouble,
    2,
    twoLineFontSize,
    charWidthRatio,
    locale,
    safeTextMaxWidth
  );
  const doubleLines = doubleWrap.lines;

  const singleTruncated = singleLines.some((line) => line.trim().endsWith('…'));
  const useSingleLine = singleLines.length === 1 && !singleTruncated;
  const lines = useSingleLine ? singleLines : doubleLines;
  if (!lines.length) return { buffer: null, height: 0 };
  const fontSize = useSingleLine ? baseFontSize : twoLineFontSize;
  const lineHeight = Math.floor(fontSize * 1.22);
  const linePaddingY = Math.floor(twoLinePaddingY * 0.5);
  const topLineY = linePaddingY;
  const bottomLineY = overlayHeight - linePaddingY;
  const containerY = topLineY;
  const containerHeight = Math.max(1, bottomLineY - topLineY);
  const textBlockHeight = lineHeight * (lines.length - 1) + fontSize;
  const startY = Math.floor(containerY + (containerHeight - textBlockHeight) / 2 + fontSize * 0.85);
  const cornerRadius = Math.max(spec.footerCornerRadiusMin, Math.floor(containerHeight * 0.25));
  const lineStartX = containerX;
  const lineEndX = containerX + containerWidth;
  const textX = Math.floor(containerX + containerWidth / 2);
  const lineStrokeWidth = scaleRollupStrokeWidth(6, spec);
  const textStrokeWidth = scaleRollupStrokeWidth(2, spec);

  const svg = `
    <svg width="${width}" height="${overlayHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${containerX}" y="${containerY}" width="${containerWidth}" height="${containerHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${TILE_OVERLAY_BACKGROUND_COLOR}" />
      <line x1="${lineStartX}" y1="${topLineY}" x2="${lineEndX}" y2="${topLineY}" stroke="${OVERLAY_TEXT_COLOR}" stroke-width="${lineStrokeWidth}" stroke-linecap="round" />
      ${lines
        .map(
          (line, idx) =>
            `<text x="${textX}" y="${startY + idx * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}"
              font-weight="800" fill="${OVERLAY_TEXT_COLOR}" text-anchor="middle" paint-order="stroke fill" stroke="${OVERLAY_TEXT_STROKE_COLOR}" stroke-width="${textStrokeWidth}">
              ${escapeSvgText(line)}
            </text>`
        )
        .join('')}
      <line x1="${lineStartX}" y1="${bottomLineY}" x2="${lineEndX}" y2="${bottomLineY}" stroke="${OVERLAY_TEXT_COLOR}" stroke-width="${lineStrokeWidth}" stroke-linecap="round" />
    </svg>`;

  return { buffer: Buffer.from(svg), height: overlayHeight };
}

function createThumbnailTopLeftBadge(text, width, position = DEFAULT_ROLLUP_IMAGE_TILING_POSITION, spec = ROLLUP_THUMBNAIL_SPEC) {
  const safeText = normalizeOverlayValue(text);
  if (!safeText) return { buffer: null, size: 0 };

  const topLeft = position?.top_left || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_left;
  const fontFamily = position?.font_family || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_family;
  const fontKey = position?.font_key || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_key;
  const badgeMetrics = resolveTopLeftBadgeMetrics(fontKey);
  const { locale } = resolveRollupTextMetrics(fontKey);
  const diameter = Math.min(
    topLeft.diameter_max,
    Math.max(topLeft.diameter_min, Math.floor(width * topLeft.diameter_ratio))
  );
  const baseInnerPadding = Math.max(topLeft.inner_padding_min, Math.floor(diameter * topLeft.inner_padding_ratio));
  const boostedPadding = Math.max(baseInnerPadding, Math.floor(baseInnerPadding * badgeMetrics.paddingScale));
  const strokeWidth = scaleRollupStrokeWidth(8, spec);
  const strokeInset = Math.ceil(strokeWidth * 0.75);
  const maxInnerPadding = Math.max(0, Math.floor((diameter - spec.badgeDiameterInset) / 2));
  const innerPadding = Math.min(maxInnerPadding, boostedPadding + strokeInset);
  const innerDiameter = Math.max(1, diameter - innerPadding * 2);
  const normalizedText = safeText.replace(/[\\/_.-]/g, ' ');
  const baseFontSize = Math.max(
    scaleRollupFontForThumbnail(64, spec),
    Math.floor(innerDiameter * 0.36 * ROLLUP_TEXT_SCALE)
  );
  const fontSize = Math.floor(baseFontSize * TOP_LEFT_FONT_SCALE);
  const maxCharsByWidth = Math.max(
    1,
    Math.floor(innerDiameter / (fontSize * badgeMetrics.charWidthRatio))
  );
  const maxChars = Math.max(1, Math.min(badgeMetrics.maxChars, maxCharsByWidth));
  const lines = wrapTextForLocale(normalizedText, maxChars, 2, locale);
  if (!lines.length) return { buffer: null, size: 0 };

  const lineHeight = Math.floor(fontSize * 1.05);
  const totalHeight = lineHeight * lines.length;
  const startY = Math.floor(innerPadding + (innerDiameter - totalHeight) / 2 + fontSize * 0.9);
  const textStrokeWidth = scaleRollupStrokeWidth(2, spec);
  const circleInset = Math.max(0.2, scaleRollupFloat(6, spec.scale));

  const svg = `
    <svg width="${diameter}" height="${diameter}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${diameter / 2}" cy="${diameter / 2}" r="${Math.max(0, diameter / 2 - circleInset)}" fill="${TILE_OVERLAY_BACKGROUND_COLOR}" stroke="${OVERLAY_TEXT_COLOR}" stroke-width="${strokeWidth}" />
      ${lines
        .map(
          (line, idx) =>
            `<text x="50%" y="${startY + idx * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}"
              font-weight="800" fill="${OVERLAY_TEXT_COLOR}" text-anchor="middle" paint-order="stroke fill" stroke="${OVERLAY_TEXT_STROKE_COLOR}" stroke-width="${textStrokeWidth}">
              ${escapeSvgText(line)}
            </text>`
        )
        .join('')}
    </svg>
  `;

  return { buffer: Buffer.from(svg), size: diameter };
}

function createThumbnailTopRightLabel(text, width, opts = {}, position = DEFAULT_ROLLUP_IMAGE_TILING_POSITION, spec = ROLLUP_THUMBNAIL_SPEC) {
  const safeText = normalizeOverlayValue(text);
  if (!safeText) return { buffer: null, height: 0 };

  const topRight = position?.top_right || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_right;
  const fontFamily = position?.font_family || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.font_family;
  const margin = Number.isFinite(opts?.margin)
    ? Math.max(0, Math.floor(opts.margin))
    : Math.max(topRight.margin_min, Math.floor(width * topRight.margin_ratio));
  const paddingLeft = Math.round(topRight.padding_left * ROLLUP_TEXT_SCALE);
  const paddingRight = Math.round(topRight.padding_right * ROLLUP_TEXT_SCALE);
  const paddingTop = Math.round(topRight.padding_top * ROLLUP_TEXT_SCALE);
  const paddingBottom = Math.round(topRight.padding_bottom * ROLLUP_TEXT_SCALE);
  const maxLabelWidthRaw = Number.isFinite(opts?.maxWidth) ? Math.floor(opts.maxWidth) : width - margin * 2;
  const maxLabelWidth = Math.max(topRight.min_width, Math.min(width - margin * 2, maxLabelWidthRaw));
  const baseFontSize = Math.max(
    scaleRollupFontForThumbnail(78, spec),
    Math.min(scaleRollupFontForThumbnail(96, spec), Math.floor(width * 0.041 * ROLLUP_TEXT_SCALE))
  );
  const topRightFontScale = TOP_RIGHT_FONT_SCALE * TOP_RIGHT_FONT_SIZE_SCALE;
  const scaledBaseFontSize = Math.floor(baseFontSize * topRightFontScale);
  const textMaxWidth = Math.max(0, maxLabelWidth - paddingLeft - paddingRight);
  const maxChars = Math.max(
    6,
    Math.min(40, Math.floor(textMaxWidth / (scaledBaseFontSize * 0.58)))
  );
  const lines = wrapLines(safeText, maxChars, 2);
  if (!lines.length) return { buffer: null, height: 0 };

  const scaledMinFontSize = Math.floor(scaleRollupFontForThumbnail(70, spec) * topRightFontScale);
  const fontSize = lines.length === 1
    ? scaledBaseFontSize
    : Math.max(scaledMinFontSize, Math.floor(scaledBaseFontSize * 0.92));
  const lineHeight = Math.floor(fontSize * 1.08);
  const textBlockHeight = lineHeight * (lines.length - 1) + fontSize;
  const labelHeight = textBlockHeight + paddingTop + paddingBottom;
  const overlayHeight = Math.max(Math.round(topRight.overlay_height_min * ROLLUP_TEXT_SCALE), labelHeight);
  const labelY = Math.floor((overlayHeight - labelHeight) / 2);
  const maxLineWidth = Math.max(1, ...lines.map((line) => Math.ceil(line.length * fontSize * 0.58)));
  const labelWidth = Math.min(maxLabelWidth, maxLineWidth + paddingLeft + paddingRight);
  const labelX = Math.max(0, width - margin - labelWidth);
  const cornerRadius = Math.max(spec.labelCornerRadiusMin, Math.floor(Math.min(labelHeight, labelWidth) * 0.08));
  const textX = Math.floor(labelX + labelWidth / 2);
  const textStartY = Math.floor(labelY + (labelHeight - textBlockHeight) / 2 + fontSize / 2);
  const topRightBackgroundColor = 'rgba(20,20,20,0.02)';
  const textStrokeWidth = scaleRollupStrokeWidth(2, spec);

  const svg = `
    <svg width="${width}" height="${overlayHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${topRightBackgroundColor}" />
      ${lines
        .map(
          (line, idx) =>
            `<text x="${textX}" y="${textStartY + idx * lineHeight}" font-family="${fontFamily}" font-size="${fontSize}"
              font-weight="800" fill="${OVERLAY_TEXT_COLOR}" text-anchor="middle" dominant-baseline="middle" paint-order="stroke fill" stroke="${OVERLAY_TEXT_STROKE_COLOR}" stroke-width="${textStrokeWidth}">
              ${escapeSvgText(line)}
            </text>`
        )
        .join('')}
    </svg>
  `;

  return { buffer: Buffer.from(svg), height: overlayHeight };
}

function buildThumbnailTileOverlayLayers(item, columnWidth, tileHeight, position = DEFAULT_ROLLUP_IMAGE_TILING_POSITION, spec = ROLLUP_THUMBNAIL_SPEC) {
  const overlay = resolveOverlayFields(item);
  const padding = paddingForThumbnailTileSize(columnWidth, tileHeight, spec);
  const imageWidth = Math.max(1, columnWidth - padding.left - padding.right);
  const imageHeight = Math.max(1, tileHeight - padding.top - padding.bottom);
  const topLeft = position?.top_left || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_left;
  const topRight = position?.top_right || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.top_right;
  const bottom = position?.bottom || DEFAULT_ROLLUP_IMAGE_TILING_POSITION.bottom;
  const topLeftMargin = Math.max(topLeft.margin_min, Math.floor(imageWidth * topLeft.margin_ratio));
  const topRightMarginBase = Math.max(topRight.margin_min, Math.floor(imageWidth * topRight.margin_ratio));
  const topRightMarginBoost = Math.max(
    spec.topRightMarginBoostMin,
    Math.floor(imageWidth * TOP_RIGHT_MARGIN_BOOST_RATIO)
  );
  const topRightMargin = topRightMarginBase + topRightMarginBoost;
  const topRightMarginRight = Math.max(0, Math.round(topRightMargin * TOP_RIGHT_MARGIN_RIGHT_SCALE));
  const topRightMarginTop = Math.max(0, Math.round(topRightMargin * TOP_RIGHT_MARGIN_TOP_SCALE));
  const footerOffset = getFooterOverlayOffset(imageHeight, position);
  const layers = [];

  const footerInset = Math.max(bottom.inset_min, Math.floor(imageWidth * bottom.inset_ratio));
  const footerWidth = Math.max(1, imageWidth - footerInset * 2);
  const footerOverlay = createThumbnailFooterOverlay(overlay.footer, footerWidth, position, spec);
  if (footerOverlay.buffer) {
    layers.push({
      kind: 'footer',
      buffer: footerOverlay.buffer,
      width: footerWidth,
      height: footerOverlay.height,
      left: padding.left + footerInset,
      top: Math.max(padding.top, padding.top + imageHeight - footerOverlay.height - footerOffset),
    });
  }

  const topLeftOverlay = createThumbnailTopLeftBadge(overlay.top_left, imageWidth, position, spec);
  if (topLeftOverlay.buffer) {
    layers.push({
      kind: 'top_left',
      buffer: topLeftOverlay.buffer,
      width: topLeftOverlay.size,
      height: topLeftOverlay.size,
      left: padding.left + topLeftMargin,
      top: padding.top + topLeftMargin,
    });
  }

  const reservedLeft = topLeftOverlay.buffer ? topLeftMargin + topLeftOverlay.size + topLeftMargin : topLeftMargin;
  const maxTopRightWidth = Math.max(topRight.max_width_floor, imageWidth - reservedLeft - topRightMarginRight);
  const topRightOverlay = createThumbnailTopRightLabel(overlay.top_right, imageWidth, {
    margin: topRightMarginRight,
    maxWidth: maxTopRightWidth,
  }, position, spec);
  if (topRightOverlay.buffer) {
    layers.push({
      kind: 'top_right',
      buffer: topRightOverlay.buffer,
      width: imageWidth,
      height: topRightOverlay.height,
      left: padding.left,
      top: padding.top + topRightMarginTop,
    });
  }

  return { overlay, layers };
}

async function buildThumbnailTile(item, columnIndex, layout, opts = {}, spec = ROLLUP_THUMBNAIL_SPEC) {
  const includeOverlays = opts?.includeOverlays !== false;
  const rounded = opts?.rounded !== false;
  const fetcher = typeof opts?.fetcher === 'function' ? opts.fetcher : null;
  const tilingPosition = opts?.tilingPosition || DEFAULT_ROLLUP_IMAGE_TILING_POSITION;
  const fetchRetries = Number.isFinite(opts?.fetchRetries) ? Math.max(0, Math.floor(opts.fetchRetries)) : ROLLUP_FETCH_RETRIES;
  const fetchRetryDelayMs = Number.isFinite(opts?.fetchRetryDelayMs)
    ? Math.max(0, Math.floor(opts.fetchRetryDelayMs))
    : ROLLUP_FETCH_RETRY_DELAY_MS;
  const fetchTimeoutMs = Number.isFinite(opts?.fetchTimeoutMs)
    ? Math.max(0, Math.floor(opts.fetchTimeoutMs))
    : ROLLUP_FETCH_TIMEOUT_MS;
  try {
    const resolvedLayout = layout || computeThumbnailTileLayout(undefined, spec);
    const columnWidth =
      resolvedLayout.columnWidths?.[columnIndex % resolvedLayout.cols] || spec.baseTile.width;
    const tileHeight = resolvedLayout.tileHeight || spec.baseTile.height;
    const padding = paddingForThumbnailTileSize(columnWidth, tileHeight, spec);
    const baseBuffer = fetcher
      ? await fetcher(item.image_url, { ...(opts?.logContext || {}), stage: 'tile_thumb' })
      : await fetchImageBufferWithRetry(item.image_url, {
          retries: fetchRetries,
          retryDelayMs: fetchRetryDelayMs,
          timeoutMs: fetchTimeoutMs,
          context: opts?.logContext,
        });
    const imageWidth = Math.max(1, columnWidth - padding.left - padding.right);
    const imageHeight = Math.max(1, tileHeight - padding.top - padding.bottom);
    let resizePipeline = sharp(baseBuffer).resize(imageWidth, imageHeight, {
      fit: 'cover',
      position: 'centre',
      background: TILE_BACKGROUND_COLOR,
    });
    if (!rounded) {
      resizePipeline = resizePipeline.flatten({ background: TILE_BACKGROUND_COLOR });
    }
    const resized = await resizePipeline.png().toBuffer();

    let baseImage = resized;
    if (rounded) {
      const imageCornerRadius = Math.max(
        spec.minImageCornerRadius,
        Math.round(spec.cornerRadius * (imageWidth / columnWidth))
      );
      const roundedImageMask = Buffer.from(
        `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${imageWidth}" height="${imageHeight}" rx="${imageCornerRadius}" ry="${imageCornerRadius}" fill="white"/></svg>`
      );
      baseImage = await sharp(resized)
        .composite([{ input: roundedImageMask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    }

    let pipeline = sharp(baseImage).extend({
      top: padding.top,
      bottom: padding.bottom,
      left: padding.left,
      right: padding.right,
      background: TILE_BACKGROUND_COLOR,
    });

    if (includeOverlays) {
      const { layers } = buildThumbnailTileOverlayLayers(item, columnWidth, tileHeight, tilingPosition, spec);
      if (layers.length) {
        pipeline = pipeline.composite(
          layers.map((layer) => ({
            input: layer.buffer,
            left: layer.left,
            top: layer.top,
          }))
        );
      }
    }

    return await pipeline.png().toBuffer();
  } catch (err) {
    console.error('[rollup_banner_thumbnail] buildTile failed', {
      imageUrl: item?.image_url,
      overlay: resolveOverlayFields(item),
      error: err,
      stack: err?.stack,
    });
    throw err;
  }
}

async function buildThumbnailFallbackTile(columnIndex, layout, spec = ROLLUP_THUMBNAIL_SPEC) {
  const resolvedLayout = layout || computeThumbnailTileLayout(undefined, spec);
  const columnWidth =
    resolvedLayout.columnWidths?.[columnIndex % resolvedLayout.cols] || spec.baseTile.width;
  const tileHeight = resolvedLayout.tileHeight || spec.baseTile.height;

  return sharp({
    create: {
      width: columnWidth,
      height: tileHeight,
      channels: 4,
      background: TILE_BACKGROUND_COLOR,
    },
  })
    .png()
    .toBuffer();
}

async function applyThumbnailGridOverlays(grid, items, layout, context = {}, spec = ROLLUP_THUMBNAIL_SPEC) {
  if (!grid?.buffer || !Array.isArray(items) || items.length === 0) return grid;

  const resolvedLayout = layout || computeThumbnailTileLayout(undefined, spec);
  const { columnOffsets, columnWidths, cols, vPad, outerPadTop, tileHeight, outerPadRight } = resolvedLayout;
  const rowCount = Math.ceil(items.length / cols);
  const contentRight = spec.width - (outerPadRight || 0);
  const composites = [];
  const sessionId = context?.sessionId;
  const tilingPosition = context?.tilingPosition || DEFAULT_ROLLUP_IMAGE_TILING_POSITION;

  const pushLayer = (layer, left, top) => {
    if (!layer?.buffer) return;
    composites.push({ input: layer.buffer, left: Math.floor(left), top: Math.floor(top) });
  };

  for (let row = 0; row < rowCount; row += 1) {
    const rowItems = items.slice(row * cols, row * cols + cols);
    const tileTop = outerPadTop + row * (tileHeight + vPad);
    const shouldStagger = cols > 1 && row % 2 === 1 && rowItems.length === cols;

    if (!shouldStagger) {
      rowItems.forEach((item, col) => {
        if (!item) return;
        const tileIndex = row * cols + col;
        const columnWidth = columnWidths?.[col] || spec.baseTile.width;
        const tileLeft = columnOffsets[col] || 0;
        try {
          const { layers } = buildThumbnailTileOverlayLayers(item, columnWidth, tileHeight, tilingPosition, spec);
          layers.forEach((layer) => pushLayer(layer, tileLeft + layer.left, tileTop + layer.top));
        } catch (error) {
          console.error('[rollup_banner_thumbnail] overlay build failed', {
            sessionId,
            tileIndex,
            imageUrl: item?.image_url,
            overlay: resolveOverlayFields(item),
            error,
            stack: error?.stack,
          });
          throw error;
        }
      });
      continue;
    }

    const firstItem = rowItems[0];
    const firstWidth = columnWidths?.[0] || spec.baseTile.width;
    const leftWidth = Math.floor(firstWidth / 2);
    const rightWidth = firstWidth - leftWidth;
    const staggeredPositions = computeThumbnailStaggeredRowPositions(resolvedLayout, leftWidth, rightWidth, spec);
    const edgeLeft = staggeredPositions?.edgeLeft ?? (columnOffsets[0] || 0);
    const edgeRight = staggeredPositions?.edgeRight ?? contentRight - rightWidth;

    if (firstItem) {
      const tileIndex = row * cols;
      try {
        const { layers, overlay } = buildThumbnailTileOverlayLayers(firstItem, firstWidth, tileHeight, tilingPosition, spec);
        const padding = paddingForThumbnailTileSize(firstWidth, tileHeight, spec);
        const leftShift = padding.left;
        const rightShift = padding.right;
        const imageHeight = Math.max(1, tileHeight - padding.top - padding.bottom);
        const footerOffset = getFooterOverlayOffset(imageHeight, tilingPosition);
        for (const layer of layers) {
          if (layer.kind === 'footer') {
            const splitX = leftWidth - layer.left;
            const leftOverlayWidth = Math.max(0, Math.min(layer.width, Math.floor(splitX)));
            const rightOverlayWidth = Math.max(0, layer.width - leftOverlayWidth);
            const baseTop = tileTop + padding.top + imageHeight - footerOffset;

            if (leftOverlayWidth > 0) {
              const leftFooter = createThumbnailFooterOverlay(overlay.footer, leftOverlayWidth, tilingPosition, spec);
              if (leftFooter.buffer) {
                pushLayer(
                  { buffer: leftFooter.buffer },
                  edgeLeft + layer.left - leftShift,
                  baseTop - leftFooter.height
                );
              }
            }

            if (rightOverlayWidth > 0) {
              const rightFooter = createThumbnailFooterOverlay(overlay.footer, rightOverlayWidth, tilingPosition, spec);
              if (rightFooter.buffer) {
                const rightOffset = Math.max(0, layer.left - leftWidth);
                pushLayer(
                  { buffer: rightFooter.buffer },
                  edgeRight + rightOffset + rightShift,
                  baseTop - rightFooter.height
                );
              }
            }
            continue;
          }
          const splitX = leftWidth - layer.left;
          const { leftBuffer, rightBuffer } = await splitOverlayBuffer(
            layer.buffer,
            layer.width,
            layer.height,
            splitX
          );
          if (leftBuffer) {
            pushLayer({ buffer: leftBuffer }, edgeLeft + layer.left - leftShift, tileTop + layer.top);
          }
          if (rightBuffer) {
            const rightOffset = Math.max(0, layer.left - leftWidth);
            pushLayer(
              { buffer: rightBuffer },
              edgeRight + rightOffset + rightShift,
              tileTop + layer.top
            );
          }
        }
      } catch (error) {
        console.error('[rollup_banner_thumbnail] overlay split failed', {
          sessionId,
          tileIndex,
          imageUrl: firstItem?.image_url,
          overlay: resolveOverlayFields(firstItem),
          error,
          stack: error?.stack,
        });
        throw error;
      }
    }

    for (let col = 1; col < cols; col += 1) {
      const item = rowItems[col];
      if (!item) continue;
      const tileIndex = row * cols + col;
      const columnWidth = columnWidths?.[col] || spec.baseTile.width;
      const tileLeft = staggeredPositions?.colLefts?.[col] ?? ((columnOffsets[col] || 0) - leftWidth);
      try {
        const { layers } = buildThumbnailTileOverlayLayers(item, columnWidth, tileHeight, tilingPosition, spec);
        layers.forEach((layer) => pushLayer(layer, tileLeft + layer.left, tileTop + layer.top));
      } catch (error) {
        console.error('[rollup_banner_thumbnail] overlay build failed', {
          sessionId,
          tileIndex,
          imageUrl: item?.image_url,
          overlay: resolveOverlayFields(item),
          error,
          stack: error?.stack,
        });
        throw error;
      }
    }
  }

  if (!composites.length) return grid;

  try {
    const buffer = await sharp(grid.buffer).composite(composites).png().toBuffer();
    return { ...grid, buffer };
  } catch (error) {
    console.error('[rollup_banner_thumbnail] overlay composite failed', {
      sessionId,
      overlayCount: composites.length,
      error,
      stack: error?.stack,
    });
    throw error;
  }
}

async function applyThumbnailStaggeredEdgeRounding(grid, items, layout, spec = ROLLUP_THUMBNAIL_SPEC) {
  if (!grid?.buffer || !Array.isArray(items) || items.length === 0) return grid;

  const resolvedLayout = layout || computeThumbnailTileLayout(undefined, spec);
  const { columnOffsets, columnWidths, cols, vPad, outerPadTop, tileHeight, outerPadRight } = resolvedLayout;
  if (cols < 2) return grid;

  const rowCount = Math.ceil(items.length / cols);
  const contentRight = spec.width - (outerPadRight || 0);
  let buffer = grid.buffer;
  let cachedLeftClear = null;
  let cachedRightClear = null;
  let cachedLeftWidth = null;
  let cachedRightWidth = null;

  for (let row = 0; row < rowCount; row += 1) {
    const rowItems = items.slice(row * cols, row * cols + cols);
    const shouldStagger = row % 2 === 1 && rowItems.length === cols;
    if (!shouldStagger) continue;

    const rowTop = outerPadTop + row * (tileHeight + vPad);
    const firstWidth = columnWidths?.[0] || spec.baseTile.width;
    const leftWidth = Math.floor(firstWidth / 2);
    const rightWidth = firstWidth - leftWidth;
    const padding = paddingForThumbnailTileSize(firstWidth, tileHeight, spec);
    const imageWidth = Math.max(1, firstWidth - padding.left - padding.right);
    const imageCornerRadius = Math.max(
      spec.minImageCornerRadius,
      Math.round(spec.cornerRadius * (imageWidth / firstWidth))
    );
    const staggeredPositions = computeThumbnailStaggeredRowPositions(resolvedLayout, leftWidth, rightWidth, spec);
    const edgeLeft = staggeredPositions?.edgeLeft ?? (columnOffsets[0] || 0);
    const edgeRight = staggeredPositions?.edgeRight ?? contentRight - rightWidth;
    const leftRadius = Math.max(0, Math.min(imageCornerRadius, Math.floor(Math.min(leftWidth, tileHeight) / 2)));
    const rightRadius = Math.max(0, Math.min(imageCornerRadius, Math.floor(Math.min(rightWidth, tileHeight) / 2)));
    const [leftCutouts, rightCutouts] = await Promise.all([
      getCornerCutouts(leftRadius),
      getCornerCutouts(rightRadius),
    ]);
    const base = sharp(buffer);
    const edgeLeftInt = Math.floor(edgeLeft);
    const edgeRightInt = Math.floor(edgeRight);
    const rowTopInt = Math.floor(rowTop);
    const [leftHalfExtract, rightHalfExtract] = await Promise.all([
      base
        .clone()
        .extract({ left: edgeLeftInt, top: rowTopInt, width: leftWidth, height: tileHeight })
        .png()
        .toBuffer(),
      base
        .clone()
        .extract({ left: edgeRightInt, top: rowTopInt, width: rightWidth, height: tileHeight })
        .png()
        .toBuffer(),
    ]);
    const [leftRounded, rightRounded] = await Promise.all([
      applySideRoundedMask(leftHalfExtract, leftWidth, tileHeight, { roundLeft: true, roundRight: false, radius: leftRadius }),
      applySideRoundedMask(rightHalfExtract, rightWidth, tileHeight, { roundLeft: false, roundRight: true, radius: rightRadius }),
    ]);

    if (!cachedRightClear || cachedRightWidth !== rightWidth) {
      cachedRightWidth = rightWidth;
      cachedRightClear = await sharp({
        create: {
          width: rightWidth,
          height: tileHeight,
          channels: 4,
          background: ROLLUP_BACKGROUND_COLOR,
        },
      })
        .png()
        .toBuffer();
    }

    if (!cachedLeftClear || cachedLeftWidth !== leftWidth) {
      cachedLeftWidth = leftWidth;
      cachedLeftClear = await sharp({
        create: {
          width: leftWidth,
          height: tileHeight,
          channels: 4,
          background: ROLLUP_BACKGROUND_COLOR,
        },
      })
        .png()
        .toBuffer();
    }

    buffer = await sharp(buffer)
      .ensureAlpha()
      .composite([
        { input: cachedLeftClear, left: edgeLeftInt, top: rowTopInt },
        { input: cachedRightClear, left: edgeRightInt, top: rowTopInt },
        { input: leftRounded, left: edgeLeftInt, top: rowTopInt },
        { input: rightRounded, left: edgeRightInt, top: rowTopInt },
        { input: leftCutouts.tl, left: edgeLeftInt, top: rowTopInt, blend: 'dest-out' },
        {
          input: leftCutouts.bl,
          left: edgeLeftInt,
          top: rowTopInt + tileHeight - leftCutouts.size,
          blend: 'dest-out',
        },
        {
          input: rightCutouts.tr,
          left: edgeRightInt + rightWidth - rightCutouts.size,
          top: rowTopInt,
          blend: 'dest-out',
        },
        {
          input: rightCutouts.br,
          left: edgeRightInt + rightWidth - rightCutouts.size,
          top: rowTopInt + tileHeight - rightCutouts.size,
          blend: 'dest-out',
        },
      ])
      .png()
      .toBuffer();
  }

  return { ...grid, buffer };
}

async function buildThumbnailGrid(tiles, items, layout, spec = ROLLUP_THUMBNAIL_SPEC) {
  const resolvedLayout = layout || computeThumbnailTileLayout(undefined, spec);
  const { columnOffsets, columnWidths, cols, vPad, outerPadTop, tileHeight, outerPadRight } = resolvedLayout;
  const width = spec.width;
  const height = spec.gridHeight;

  const composites = [];
  const rowCount = Math.ceil(tiles.length / cols);
  const contentRight = width - (outerPadRight || 0);

  for (let row = 0; row < rowCount; row += 1) {
    const rowStart = row * cols;
    const rowTiles = tiles.slice(rowStart, rowStart + cols);
    const top = outerPadTop + row * (tileHeight + vPad);
    const shouldStagger = cols > 1 && row % 2 === 1 && rowTiles.length === cols;

    if (!shouldStagger) {
      rowTiles.forEach((tileBuf, col) => {
        const left = columnOffsets[col] || 0;
        composites.push({ input: tileBuf, left, top });
      });
      continue;
    }

    const firstTile = rowTiles[0];
    const firstWidth = columnWidths?.[0] || spec.baseTile.width;
    const { leftHalf, rightHalf, leftWidth, rightWidth } = await splitTileHorizontally(firstTile, firstWidth, tileHeight);
    const staggerPadding = paddingForThumbnailTileSize(firstWidth, tileHeight, spec);
    const adjustedLeftHalf = await shiftTileHalfPadding(leftHalf, leftWidth, tileHeight, {
      shiftLeft: staggerPadding.left,
    });
    const adjustedRightHalf = await shiftTileHalfPadding(rightHalf, rightWidth, tileHeight, {
      shiftRight: staggerPadding.right,
    });
    const staggeredPositions = computeThumbnailStaggeredRowPositions(resolvedLayout, leftWidth, rightWidth, spec);
    const edgeLeft = staggeredPositions?.edgeLeft ?? (columnOffsets[0] || 0);
    const edgeRight = staggeredPositions?.edgeRight ?? contentRight - rightWidth;
    composites.push({
      input: adjustedLeftHalf,
      left: Math.floor(edgeLeft),
      top: Math.floor(top),
    });

    for (let col = 1; col < cols; col += 1) {
      const baseLeft = staggeredPositions?.colLefts?.[col] ?? ((columnOffsets[col] || 0) - leftWidth);
      composites.push({ input: rowTiles[col], left: Math.floor(baseLeft), top: Math.floor(top) });
    }

    composites.push({ input: adjustedRightHalf, left: Math.floor(edgeRight), top: Math.floor(top) });
  }

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: ROLLUP_BACKGROUND_COLOR,
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { buffer, width, height };
}

async function buildThumbnailTopSection(headerImageUrl, spec = ROLLUP_THUMBNAIL_SPEC) {
  const width = spec.width;
  const height = spec.topHeight;
  if (!headerImageUrl) {
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }

  try {
    const headerBuffer = await fetchImageBufferWithRetry(headerImageUrl, {
      context: { stage: 'rollup_header_thumb' },
    });
    return sharp(headerBuffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'centre',
        background: ROLLUP_BACKGROUND_COLOR,
      })
      .png()
      .toBuffer();
  } catch (error) {
    console.error('[rollup_banner_thumbnail] header image resize failed', error);
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }
}

async function buildThumbnailFooter(footerImageUrl, spec = ROLLUP_THUMBNAIL_SPEC) {
  const width = spec.width;
  const height = spec.footerHeight;

  if (!footerImageUrl) {
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }

  try {
    const fetched = await fetchImageBufferWithRetry(footerImageUrl, {
      context: { stage: 'rollup_footer_thumb' },
    });
    return sharp(fetched)
      .resize(width, height, { fit: 'cover', position: 'centre', background: ROLLUP_BACKGROUND_COLOR })
      .png()
      .toBuffer();
  } catch (err) {
    console.error('[rollup_banner_thumbnail] footer image fetch failed', err);
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }
}

async function composeThumbnailBanner(top, grid, footer, spec = ROLLUP_THUMBNAIL_SPEC) {
  const height = spec.height;
  const width = spec.width;

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: ROLLUP_BACKGROUND_COLOR,
    },
  })
    .composite([
      { input: top, left: 0, top: 0 },
      { input: grid.buffer, left: 0, top: spec.topHeight },
      { input: footer, left: 0, top: spec.topHeight + grid.height },
    ])
    .png()
    .toBuffer();
}

async function buildRollupBannerThumbnailBuffer({
  images = [],
  headerImageUrl,
  footerImageUrl,
  columns,
  tilingPosition,
  fetcher,
  sessionId,
}) {
  if (!Array.isArray(images) || images.length === 0) {
    return null;
  }

  const spec = ROLLUP_THUMBNAIL_SPEC;
  const layout = computeThumbnailTileLayout(columns, spec);
  const scaledPosition = scaleRollupImageTilingPosition(
    tilingPosition || DEFAULT_ROLLUP_IMAGE_TILING_POSITION,
    spec.scale
  );

  ensureSvgOverlaySupport();

  const topBuffer = await buildThumbnailTopSection(headerImageUrl, spec);
  const tiles = await Promise.all(
    images.map(async (img, idx) => {
      const col = idx % layout.cols;
      try {
        return await buildThumbnailTile(img, col, layout, {
          includeOverlays: false,
          fetcher,
          logContext: { sessionId, tileIndex: idx, column: col },
        }, spec);
      } catch (tileErr) {
        const overlay = resolveOverlayFields(img);
        console.error('[rollup_banner_thumbnail] tile build failed', {
          sessionId,
          tileIndex: idx,
          column: col,
          imageUrl: img?.image_url,
          overlay,
          error: tileErr,
          stack: tileErr?.stack,
        });
        return buildThumbnailFallbackTile(col, layout, spec);
      }
    })
  );

  const grid = await buildThumbnailGrid(tiles, images, layout, spec);
  const gridWithOverlays = await applyThumbnailGridOverlays(grid, images, layout, {
    sessionId,
    tilingPosition: scaledPosition,
  }, spec);
  const roundedGrid = await applyThumbnailStaggeredEdgeRounding(gridWithOverlays, images, layout, spec);
  const footer = await buildThumbnailFooter(footerImageUrl, spec);

  return composeThumbnailBanner(topBuffer, roundedGrid, footer, spec);
}

async function buildAndUploadRollupThumbnail({
  sessionId,
  images,
  headerImageUrl,
  footerImageUrl,
  columns,
  tilingPosition,
  fetcher,
}) {
  if (!sessionId || !Array.isArray(images) || images.length === 0) {
    return null;
  }

  try {
    const thumbnailBuffer = await buildRollupBannerThumbnailBuffer({
      images,
      headerImageUrl,
      footerImageUrl,
      columns,
      tilingPosition,
      fetcher,
      sessionId,
    });
    if (!thumbnailBuffer) {
      return null;
    }
    const thumbnailKey = `${ROLLUP_FOLDER}/rollup-${sessionId}-thumb.png`;
    return await uploadBufferToS3WithRegion({
      bucketName: ROLLUP_BUCKET,
      key: thumbnailKey,
      buffer: thumbnailBuffer,
      contentType: 'image/png',
    });
  } catch (thumbError) {
    console.error('[rollup_banner_thumbnail] generation failed', {
      sessionId,
      error: thumbError?.message,
      stack: thumbError?.stack,
    });
    return null;
  }
}
