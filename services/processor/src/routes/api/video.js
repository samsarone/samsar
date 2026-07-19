import express from 'express';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import externalUsersRouter from './external_users.js';
import {
  findExternalRequestForInternalUser,
  resolveRequestActorFromAuthHeaders,
} from '../../models/external/User.js';
import { getDBConnectionString } from '../../models/DBString.js';
import GlobalSession from '../../schema/GlobalSession.js';
import VideoSession from '../../schema/VideoSession.js';
import {
  stripDeprecatedVideoModelSubtypeOptions,
  validateExpressImageModelKey,
  validateMovieInput,
} from '../../models/api/PromptUtils.js';
import {
  normalizeImageListFooterAnimationOptions,
  normalizeImageListExpressCtaGenerationOptions,
  normalizeImageListNarratorAvatarOptions,
  normalizeImageListInput,
  assertImageListToVideoUrlsAreFetchable,
  requestCreateVideo,
  requestCreateVideoFromImageListAndMetadata,
} from '../../models/api/MovieAPI.js';
import {
  addOutroImageAndQueueRender,
  updateFooterImageAndQueueRender,
  updateOutroImageAndQueueRender,
} from '../../models/api/VideoSessionOutroAPI.js';
import {
  addSubtitlesAndQueueGeneration,
  removeSubtitlesAndQueueGeneration,
  translateVideoSessionAndQueueGeneration,
} from '../../models/api/VideoSessionTranslateAPI.js';
import {
  cancelVideoSessionRender,
  pauseVideoSessionRender,
  resumeVideoSessionRender,
} from '../../models/api/VideoSessionCancelAPI.js';
import {
  cloneVideoSessionAndQueueRender,
  cloneVideoSessionAndRegenerateNarratorAvatar,
} from '../../models/api/VideoSessionCloneAPI.js';
import {
  quoteVideoSessionLayerReroll,
  rerollVideoSessionLayersAndQueueGeneration,
} from '../../models/api/VideoSessionRerollAPI.js';
import { joinVideoSessionsAndQueueGeneration } from '../../models/api/VideoSessionJoinAPI.js';
import { buildVideoStatusResponse } from '../../models/api/StatusAPI.js';
import { uploadImageDataList } from '../../models/api/ImageUploadAPI.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import {
  normalizeOutroCtaImageFromPayload,
  normalizeOutroCtaImageTextFieldsFromPayload,
} from '../../utils/OutroCtaImagePayload.js';
import { IMAGE_EDIT_MODEL_PRICES, IMAGE_MODEL_PRICES, VIDEO_MODEL_PRICES } from '../../consts/ModelPrices.js';
import {
  IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS,
  IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS,
  TEXT_TO_VIDEO_IMAGE_MODEL_KEYS,
  TEXT_TO_VIDEO_VIDEO_MODEL_KEYS,
} from '../../consts/ExpressVideoModelOptions.js';
import { getExpressVideoPricingDistributionPerSecond } from '../../consts/pricing/ExpressVideoPricingDistribution.js';
import {
  IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ERROR_MESSAGE,
  normalizeImageListToVideoModel,
} from '../../consts/ImageListToVideoModels.js';
import { getBillingPortalUrl } from '../../models/BillingPortal.js';
import {
  filterModelsForDeploymentAvailability,
  mergeRuntimeInferenceDeploymentAvailability,
  readDeploymentAvailableModels,
} from '../../models/api/DeploymentModelConfig.js';

const router = express.Router();
const BILLING_PORTAL_URL = getBillingPortalUrl();
const PURCHASE_CREDITS_ENDPOINT = '/v1/credits/recharge';
const INSUFFICIENT_CREDITS_MESSAGE =
  `Insufficient credits or no credits remaining. Please call ${PURCHASE_CREDITS_ENDPOINT} ` +
  `or visit ${BILLING_PORTAL_URL} to purchase credits with a one-time top-up. ` +
  `If auto-recharge is enabled, update the threshold via /v1/auto_recharge/threshold or the billing page.`;

function getRequestPayload(req) {
  return req.body?.input ?? req.body ?? {};
}

function hasExternalUserRouteSignal(req) {
  return Boolean(
    req.externalUser ||
    req.body?.external_user ||
    req.body?.externalUser ||
    req.body?.input?.external_user ||
    req.body?.input?.externalUser,
  );
}

function isExternalRequestIdentifier(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return /^extreq_[a-f0-9]{32}$/i.test(trimmed) || /^[a-f0-9]{32}$/i.test(trimmed);
}

function getSourceSessionIdFromRequestPayload(requestPayload = {}) {
  return (
    normalizeOptionalRequestString(requestPayload.source_request_id) ||
    normalizeOptionalRequestString(requestPayload.sourceRequestId) ||
    normalizeOptionalRequestString(requestPayload.request_id) ||
    normalizeOptionalRequestString(requestPayload.requestId) ||
    normalizeOptionalRequestString(requestPayload.external_request_id) ||
    normalizeOptionalRequestString(requestPayload.externalRequestId) ||
    normalizeOptionalRequestString(requestPayload.external_session_id) ||
    normalizeOptionalRequestString(requestPayload.externalSessionId) ||
    normalizeOptionalRequestString(requestPayload.video_session_id) ||
    normalizeOptionalRequestString(requestPayload.videoSessionId) ||
    normalizeOptionalRequestString(requestPayload.video_sessionID) ||
    normalizeOptionalRequestString(requestPayload.videoSessionID) ||
    normalizeOptionalRequestString(requestPayload.session_id) ||
    normalizeOptionalRequestString(requestPayload.sessionId)
  );
}

function getSourceSessionIdsFromRequestPayload(requestPayload = {}) {
  const rawSourceIds =
    requestPayload.source_request_ids ||
    requestPayload.sourceRequestIds ||
    requestPayload.request_ids ||
    requestPayload.requestIds ||
    requestPayload.external_request_ids ||
    requestPayload.externalRequestIds ||
    requestPayload.external_session_ids ||
    requestPayload.externalSessionIds ||
    requestPayload.session_ids ||
    requestPayload.sessionIds ||
    requestPayload.video_session_ids ||
    requestPayload.videoSessionIds;

  return Array.isArray(rawSourceIds)
    ? rawSourceIds.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
}

async function isExternalOwnedVideoSession(userId, sessionId) {
  const normalizedSessionId = normalizeOptionalRequestString(sessionId);
  if (!normalizedSessionId) {
    return false;
  }

  await getDBConnectionString();
  const externalRequest = await findExternalRequestForInternalUser({
    internalUserId: userId?.toString?.() || userId,
    requestId: normalizedSessionId,
    externalUserId: null,
  });
  if (externalRequest) {
    return true;
  }

  const globalSession = await GlobalSession.findOne({
    sessionType: 'video',
    userId: userId?.toString?.() || userId,
    $or: [
      { sessionId: normalizedSessionId },
      { requestId: normalizedSessionId },
      { apiSessionId: normalizedSessionId },
    ],
  })
    .select('sessionId')
    .lean();
  const upstreamSessionId = globalSession?.sessionId || normalizedSessionId;

  if (upstreamSessionId !== normalizedSessionId) {
    const upstreamExternalRequest = await findExternalRequestForInternalUser({
      internalUserId: userId?.toString?.() || userId,
      requestId: upstreamSessionId,
      externalUserId: null,
    });
    if (upstreamExternalRequest) {
      return true;
    }
  }

  if (!upstreamSessionId || !mongoose.Types.ObjectId.isValid(upstreamSessionId)) {
    return false;
  }

  const session = await VideoSession.findOne({
    _id: upstreamSessionId,
    userId: userId?.toString?.() || userId,
  })
    .select('_id externalRequestId externalRequestUserId isExternalUserRequest')
    .lean();

  return Boolean(
    session?.externalRequestId ||
    session?.externalRequestUserId ||
    session?.isExternalUserRequest,
  );
}

async function shouldDelegateToExternalRoute(req, sessionIds = []) {
  if (hasExternalUserRouteSignal(req)) {
    return true;
  }

  const normalizedIds = Array.isArray(sessionIds)
    ? sessionIds.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
  if (!normalizedIds.length) {
    return false;
  }
  if (normalizedIds.some((sessionId) => isExternalRequestIdentifier(sessionId))) {
    return true;
  }

  for (const sessionId of normalizedIds) {
    if (await isExternalOwnedVideoSession(req.userId, sessionId)) {
      return true;
    }
  }

  return false;
}

function delegateToExternalUsersRoute(req, res, next, routePath) {
  req.url = routePath;
  req.originalUrl = `/v1/external_users${routePath}`;
  return externalUsersRouter.handle(req, res, next);
}

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'video-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

function resolveTraceId(req) {
  const header = req?.headers?.['x-request-id'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  return randomUUID();
}

function normalizeRemoteVideoUrl(remoteURL) {
  if (typeof remoteURL !== 'string') {
    return null;
  }

  const trimmed = remoteURL.trim();
  if (!trimmed) {
    return null;
  }

  const remoteBase = 'https://samsar-resources.s3.us-west-2.amazonaws.com';
  const cdnBase = 'https://static.samsar.one';
  return trimmed.replace(remoteBase, cdnBase);
}

function resolveAbsoluteVideoUrl(req, videoLink) {
  if (typeof videoLink !== 'string') {
    return null;
  }

  const trimmed = videoLink.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  const base = process.env.API_SERVER?.trim();
  if (base) {
    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const normalizedPath = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    return `${normalizedBase}/${normalizedPath}`;
  }

  const host = req.get('host');
  if (!host) {
    return trimmed;
  }

  const normalizedPath = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  return `${req.protocol}://${host}/${normalizedPath}`;
}

function resolveSessionIdFromRequest(req) {
  const candidate =
    req?.query?.session_id ??
    req?.query?.sessionId ??
    req?.query?.id ??
    req?.body?.session_id ??
    req?.body?.sessionId ??
    req?.body?.id;

  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed ? trimmed : null;
}

function normalizeSessionLanguageCode(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === 'auto') {
    return null;
  }

  return normalized;
}

function resolveSessionLanguageCode(session = {}) {
  const candidate =
    normalizeSessionLanguageCode(session?.sessionLanguage) ||
    normalizeSessionLanguageCode(session?.language) ||
    normalizeSessionLanguageCode(session?.language_code) ||
    normalizeSessionLanguageCode(session?.langauge);

  return candidate || 'en';
}

function resolveSessionHasSubtitles(session = {}) {
  if (typeof session?.hasSubtitles === 'boolean') {
    return session.hasSubtitles;
  }
  if (typeof session?.has_subtitles === 'boolean') {
    return session.has_subtitles;
  }
  if (typeof session?.enableSubtitles === 'boolean') {
    return session.enableSubtitles;
  }
  return true;
}

function getEnableSubtitlesOption(payload) {
  if (!payload || typeof payload !== 'object') {
    return { value: false, provided: false };
  }

  const provided = Object.prototype.hasOwnProperty.call(payload, 'enable_subtitles')
    || Object.prototype.hasOwnProperty.call(payload, 'enableSubtitles')
    || Object.prototype.hasOwnProperty.call(payload, 'add_subtitles')
    || Object.prototype.hasOwnProperty.call(payload, 'addSubtitles');
  if (!provided) {
    return { value: false, provided: false };
  }

  const value =
    payload.enable_subtitles ??
    payload.enableSubtitles ??
    payload.add_subtitles ??
    payload.addSubtitles;
  if (typeof value !== 'boolean') {
    return { error: 'enable_subtitles/add_subtitles must be a boolean.' };
  }

  return { value, provided: true };
}

function getBooleanRequestOption(payload, keys, defaultValue, fieldName) {
  if (!payload || typeof payload !== 'object') {
    return { value: defaultValue, provided: false };
  }

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      continue;
    }
    const value = payload[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'boolean') {
      return { error: `${fieldName} must be a boolean.` };
    }
    return { value, provided: true };
  }

  return { value: defaultValue, provided: false };
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeOptionalRequestString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveBasePrice(prices = []) {
  if (!Array.isArray(prices)) {
    return null;
  }

  let basePrice = null;
  for (const item of prices) {
    const price = Number(item?.price);
    if (!Number.isFinite(price)) {
      continue;
    }
    if (basePrice === null || price < basePrice) {
      basePrice = price;
    }
  }

  return basePrice;
}

function getExpressModels(modelPrices = [], allowedKeys = []) {
  const modelMap = new Map();

  for (const model of modelPrices) {
    const key = typeof model?.key === 'string' ? model.key.trim() : '';
    if (!key || model?.isExpressModel !== true || modelMap.has(key)) {
      continue;
    }
    const label = typeof model?.name === 'string' && model.name.trim()
      ? model.name.trim()
      : typeof model?.label === 'string' && model.label.trim()
        ? model.label.trim()
        : key;
    const pricingDistribution = getExpressVideoPricingDistributionPerSecond(key);
    const basePrice = pricingDistribution?.total ?? resolveBasePrice(model?.prices);
    modelMap.set(key, {
      label,
      value: key,
      basePrice,
      ...(pricingDistribution ? { pricingDistribution } : {}),
    });
  }

  if (Array.isArray(allowedKeys) && allowedKeys.length > 0) {
    return allowedKeys
      .map((key) => {
        const model = modelMap.get(key);
        if (model) {
          return model;
        }
        const pricingDistribution = getExpressVideoPricingDistributionPerSecond(key);
        const basePrice = pricingDistribution?.total ?? null;
        return basePrice === null
          ? null
          : {
            label: key,
            value: key,
            basePrice,
            pricingDistribution,
          };
      })
      .filter(Boolean);
  }

  return Array.from(modelMap.values());
}

function getPricedModels(modelPrices = [], allowedKeys = []) {
  const modelMap = new Map();

  for (const model of modelPrices) {
    const key = typeof model?.key === 'string' ? model.key.trim() : '';
    if (!key || modelMap.has(key)) {
      continue;
    }
    const label = typeof model?.name === 'string' && model.name.trim()
      ? model.name.trim()
      : typeof model?.label === 'string' && model.label.trim()
        ? model.label.trim()
        : key;
    modelMap.set(key, {
      label,
      value: key,
      basePrice: resolveBasePrice(model?.prices),
    });
  }

  if (Array.isArray(allowedKeys) && allowedKeys.length > 0) {
    return allowedKeys
      .map((key) => modelMap.get(key))
      .filter(Boolean);
  }

  return Array.from(modelMap.values());
}

async function validateAPIKeyAndUserId(req, res, next) {
  try {
    const authContext = await resolveRequestActorFromAuthHeaders(req.headers);
    req.userId = authContext.internalUserId;
    req.authType = authContext.authType;
    req.customerSubAccount = authContext.customerSubAccount || null;
    req.externalUser = authContext.externalUser || null;
    next();
  } catch (error) {
    if (
      error?.code === 'API_KEY_EXPIRED' ||
      error?.code === 'CUSTOMER_SUB_ACCOUNT_API_KEY_EXPIRED' ||
      error?.code === 'APP_KEY_EXPIRED'
    ) {
      return res.status(401).json({
        message: error.message,
      });
    }
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating API_KEY or auth token.',
    });
  }
}

router.post('/create', validateAPIKeyAndUserId, async function (req, res) {
  try {
    const { input, webhookUrl } = req.body;

    const isValidMoviePrompt = validateMovieInput(input);

    if (!isValidMoviePrompt.status) {
      return res.status(400).json({
        message: isValidMoviePrompt.message,
      });
    }

    const userId = req.userId;

    const reqPayload = {
      ...input,
    };

    const resData = await requestCreateVideo(userId, reqPayload, webhookUrl);

    res.status(200).json(resData);
  } catch (error) {
    const statusCode = error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: 'Internal server error while creating video.',
    });
  }
});

router.get('/supported_models', function (req, res) {
  try {
    const deploymentAvailableModels = readDeploymentAvailableModels();
    const deploymentAvailability = mergeRuntimeInferenceDeploymentAvailability({
      providers: Array.isArray(deploymentAvailableModels?.providers) ? deploymentAvailableModels.providers : [],
      models: Array.isArray(deploymentAvailableModels?.models) ? deploymentAvailableModels.models : [],
      actions: Array.isArray(deploymentAvailableModels?.actions) ? deploymentAvailableModels.actions : [],
      modelProviders: deploymentAvailableModels?.modelProviders || {},
      modelProviderPriority: deploymentAvailableModels?.modelProviderPriority || {},
      audio: deploymentAvailableModels?.audio || null,
    });
    const textToVideoModels = {
      image_models: filterModelsForDeploymentAvailability(
        getExpressModels(IMAGE_MODEL_PRICES, TEXT_TO_VIDEO_IMAGE_MODEL_KEYS),
        deploymentAvailableModels,
      ),
      video_models: filterModelsForDeploymentAvailability(
        getExpressModels(VIDEO_MODEL_PRICES, TEXT_TO_VIDEO_VIDEO_MODEL_KEYS),
        deploymentAvailableModels,
      ),
    };
    const imageListToVideoModels = {
      image_models: filterModelsForDeploymentAvailability(
        getExpressModels(IMAGE_MODEL_PRICES, IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS),
        deploymentAvailableModels,
      ),
      video_models: filterModelsForDeploymentAvailability(
        getExpressModels(VIDEO_MODEL_PRICES, IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS),
        deploymentAvailableModels,
      ),
    };
    const imageEditModels = filterModelsForDeploymentAvailability(
      getPricedModels(IMAGE_EDIT_MODEL_PRICES),
      deploymentAvailableModels,
    );

    return res.status(200).json({
      IMAGE_MODELS: textToVideoModels.image_models,
      IMAGE_EDIT_MODELS: imageEditModels,
      VIDEO_MODELS: textToVideoModels.video_models,
      text_to_video: textToVideoModels,
      image_list_to_video: imageListToVideoModels,
      image_edit_models: imageEditModels,
      deployment: deploymentAvailability,
      available: deploymentAvailability,
      available_providers: deploymentAvailability.providers,
      audio: deploymentAvailability.audio,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error while fetching supported models.',
    });
  }
});

router.post('/text_to_video', validateAPIKeyAndUserId, async function (req, res, next) {
  try {
    const { input, webhookUrl, session_id } = req.body || {};
    const requestPayload = { ...(input || req.body || {}) };
    const routeConfig =
      req.body?.configuration ??
      req.body?.config ??
      req.body?.model_config ??
      req.body?.modelConfig ??
      req.body?.custom_model_config ??
      req.body?.customModelConfig ??
      req.body?.custom_models ??
      req.body?.customModels;
    if (routeConfig !== undefined && requestPayload.configuration === undefined) {
      requestPayload.configuration = routeConfig;
    }
    if (session_id && !requestPayload.session_id) {
      requestPayload.session_id = session_id;
    }
    stripDeprecatedVideoModelSubtypeOptions(requestPayload);
    if (hasExternalUserRouteSignal(req)) {
      return delegateToExternalUsersRoute(req, res, next, '/text_to_video');
    }
    const enableSubtitlesOption = getEnableSubtitlesOption(requestPayload);
    if (enableSubtitlesOption.error) {
      return res.status(400).json({
        message: enableSubtitlesOption.error,
      });
    }
    requestPayload.enable_subtitles = enableSubtitlesOption.value;

    const isValidMoviePrompt = validateMovieInput(requestPayload);

    if (!isValidMoviePrompt.status) {
      return res.status(400).json({
        message: isValidMoviePrompt.message,
      });
    }

    const userId = req.userId;

    const resData = await requestCreateVideo(userId, requestPayload, webhookUrl);

    res.status(200).json(resData);
  } catch (error) {
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while creating video.';
    res.status(statusCode).json({ message });
  }
});

router.post('/upload_image_data', validateAPIKeyAndUserId, async function (req, res, next) {
  try {
    const { input } = req.body || {};
    const requestPayload = input || req.body || {};
    if (hasExternalUserRouteSignal(req)) {
      return delegateToExternalUsersRoute(req, res, next, '/upload_image_data');
    }
    const { image_data } = requestPayload;

    if (
      !Array.isArray(image_data) ||
      image_data.length === 0 ||
      image_data.some((data) => typeof data !== 'string' || data.trim() === '')
    ) {
      return res.status(400).json({
        message: 'image_data must be a non-empty array of data URL strings.',
      });
    }

    const uploadedUrls = await uploadImageDataList(req.userId, image_data);

    res.status(200).json({ image_urls: uploadedUrls });
  } catch (error) {
    const statusCode = error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while uploading image data.',
    });
  }
});

router.post('/image_list_to_video', validateAPIKeyAndUserId, async function (req, res, next) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl, session_id } = req.body || {};
    const requestPayload = { ...(input || req.body || {}) };
    if (session_id && !requestPayload.session_id) {
      requestPayload.session_id = session_id;
    }
    stripDeprecatedVideoModelSubtypeOptions(requestPayload);
    if (hasExternalUserRouteSignal(req)) {
      return delegateToExternalUsersRoute(req, res, next, '/image_list_to_video');
    }
    const enableSubtitlesOption = getEnableSubtitlesOption(requestPayload);
    if (enableSubtitlesOption.error) {
      return res.status(400).json({
        message: enableSubtitlesOption.error,
      });
    }
    const {
      image_urls,
      metadata,
      prompt,
      language,
      subtitle_language,
      subtitleLanguage,
      video_model,
      image_model,
      imageModel,
      aspect_ratio,
      aspectRatio,
      add_outro_animation,
      addOutroAnimation: addOutroAnimationAlias,
      generate_outro_image,
      cta_url,
      ctaUrl: ctaUrlAlias,
      cta_text_top,
      cta_text_bottom,
      cta_logo,
      add_footer_animation,
      addFooterAnimation,
      footer_metadata,
      footerMetadata,
      express_cta_generation,
      expressCtaGeneration,
      auto_generate_cta_text,
      autoGenerateCtaText,
      generate_cta_texts,
      generateCtaTexts,
      limit_single_narrator,
      limitSingleNarrator,
      add_narrator_avatar,
      addNarratorAvatar,
      backingtrack_model,
      backing_track_model,
      backingTrackModel,
      music_provider,
      musicProvider,
      tts_model,
      ttsModel,
      tts_provider,
      ttsProvider,
      inference_model,
      inferenceModel,
      custom_adapters,
      customAdapters,
      configuration,
      config,
      model_config,
      modelConfig,
      custom_model_config,
      customModelConfig,
      custom_models,
      customModels,
    } = requestPayload;
    const rawAddOutroAnimation = add_outro_animation ?? addOutroAnimationAlias;
    const rawAddFooterAnimation = add_footer_animation ?? addFooterAnimation;
    const rawFooterMetadata = footer_metadata ?? footerMetadata;
    let expressCtaGenerationOptions;
    try {
      expressCtaGenerationOptions = normalizeImageListExpressCtaGenerationOptions({
        cta_url,
        ctaUrl: ctaUrlAlias,
        express_cta_generation,
        expressCtaGeneration,
        auto_generate_cta_text,
        autoGenerateCtaText,
        generate_cta_texts,
        generateCtaTexts,
      });
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid express CTA generation options.',
      });
    }
    const narratorAvatarOptions = normalizeImageListNarratorAvatarOptions({
      limit_single_narrator,
      limitSingleNarrator,
      add_narrator_avatar,
      addNarratorAvatar,
    });

    if (generate_outro_image !== undefined && typeof generate_outro_image !== 'boolean') {
      return res.status(400).json({
        message: 'generate_outro_image must be a boolean.',
      });
    }

    if (rawAddOutroAnimation !== undefined && typeof rawAddOutroAnimation !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_animation must be a boolean.',
      });
    }

    if (rawAddFooterAnimation !== undefined && typeof rawAddFooterAnimation !== 'boolean') {
      return res.status(400).json({
        message: 'add_footer_animation must be a boolean.',
      });
    }

    const rawCtaUrl = cta_url ?? ctaUrlAlias;
    const ctaUrl = typeof rawCtaUrl === 'string' ? rawCtaUrl.trim() : '';
    let outroCtaImage = null;
    let outroCtaImageTextFields = { ctaTextTop: null, ctaTextBottom: null };
    try {
      outroCtaImage = normalizeOutroCtaImageFromPayload(requestPayload);
      outroCtaImageTextFields = normalizeOutroCtaImageTextFieldsFromPayload(requestPayload);
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid outro_cta_image.',
      });
    }
    const generateOutroImage =
      expressCtaGenerationOptions.express_cta_generation === true ||
      generate_outro_image === true ||
      (generate_outro_image === undefined && (Boolean(ctaUrl) || Boolean(outroCtaImage)));
    const normalizedCtaTextTop = normalizeOptionalRequestString(cta_text_top);
    const normalizedCtaTextBottom = normalizeOptionalRequestString(cta_text_bottom);
    const ctaTextTop = normalizedCtaTextTop || outroCtaImageTextFields.ctaTextTop;
    const ctaTextBottom = normalizedCtaTextBottom || outroCtaImageTextFields.ctaTextBottom;
    const ctaLogo = normalizeOptionalRequestString(cta_logo);

    if (generateOutroImage) {
      if (!ctaUrl && !outroCtaImage) {
        return res.status(400).json({
          message: 'cta_url or outro_cta_image is required when generate_outro_image is true.',
        });
      }
      if (ctaUrl && !isHttpUrl(ctaUrl)) {
        return res.status(400).json({
          message: 'cta_url must be an http or https URL.',
        });
      }
    }

    if (normalizedCtaTextTop === undefined) {
      return res.status(400).json({
        message: 'cta_text_top must be a string when provided.',
      });
    }
    if (normalizedCtaTextBottom === undefined) {
      return res.status(400).json({
        message: 'cta_text_bottom must be a string when provided.',
      });
    }
    if (ctaLogo === undefined) {
      return res.status(400).json({
        message: 'cta_logo must be a string when provided.',
      });
    }

    const addOutroAnimation = generateOutroImage
      ? (typeof rawAddOutroAnimation === 'boolean' ? rawAddOutroAnimation : true)
      : typeof rawAddOutroAnimation === 'boolean'
        ? rawAddOutroAnimation
        : false;
    const rawAspectRatio = aspect_ratio ?? aspectRatio;
    const normalizedVideoModel = normalizeImageListToVideoModel(video_model);

    if (!normalizedVideoModel) {
      return res.status(400).json({
        message: IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ERROR_MESSAGE,
      });
    }

    const imageModelValidation = validateExpressImageModelKey(image_model ?? imageModel, { required: false });
    if (!imageModelValidation.status) {
      return res.status(400).json({
        message: imageModelValidation.message,
      });
    }
    const normalizedImageModel = imageModelValidation.imageModel;

    let normalizedAspectRatio = '16:9';
    if (typeof rawAspectRatio === 'string') {
      const trimmedAspectRatio = rawAspectRatio.trim();
      if (trimmedAspectRatio === '16:9' || trimmedAspectRatio === '9:16') {
        normalizedAspectRatio = trimmedAspectRatio;
      }
    }


    if (!Array.isArray(image_urls) || image_urls.length === 0) {
      return res.status(400).json({
        message: 'image_urls must be a non-empty array.',
      });
    }

    const isInvalidEntry = image_urls.some((item) => {
      if (typeof item === 'string') {
        return item.trim() === '';
      }
      if (!item || typeof item !== 'object') {
        return true;
      }
      const candidates = [
        item.image_url,
        item.imageUrl,
        item.url,
        item.src,
        item.enhanced_url,
        item.enhancedUrl,
      ];
      return !candidates.some((value) => typeof value === 'string' && value.trim().length > 0);
    });

    if (isInvalidEntry) {
      return res.status(400).json({
        message: 'image_urls entries must be strings or objects containing a non-empty image_url (or enhanced_url).',
      });
    }

    try {
      assertImageListToVideoUrlsAreFetchable(normalizeImageListInput(image_urls).imageUrls);
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid image_urls.',
      });
    }

    let footerAnimationOptions;
    try {
      footerAnimationOptions = normalizeImageListFooterAnimationOptions(
        {
          add_footer_animation: rawAddFooterAnimation,
          footer_metadata: rawFooterMetadata,
          express_cta_generation: expressCtaGenerationOptions.express_cta_generation,
          cta_url: ctaUrl,
        },
        image_urls.length,
      );
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid footer animation options.',
      });
    }

    const payload = {
      image_urls,
      metadata,
      prompt: typeof prompt === 'string' ? prompt.trim() : prompt,
      language: typeof language === 'string' ? language.trim() : language,
      ...((subtitle_language ?? subtitleLanguage) !== undefined
        ? { subtitle_language: subtitle_language ?? subtitleLanguage }
        : {}),
      video_model: normalizedVideoModel,
      ...(normalizedImageModel ? { image_model: normalizedImageModel } : {}),
      aspect_ratio: normalizedAspectRatio,
      add_outro_animation: addOutroAnimation,
      generate_outro_image: generateOutroImage,
      express_cta_generation: expressCtaGenerationOptions.express_cta_generation === true,
      add_footer_animation: footerAnimationOptions.add_footer_animation,
      footer_metadata: footerAnimationOptions.footer_metadata,
      limit_single_narrator: narratorAvatarOptions.limit_single_narrator,
      add_narrator_avatar: narratorAvatarOptions.add_narrator_avatar,
      ...((backingtrack_model ?? backing_track_model ?? backingTrackModel ?? music_provider ?? musicProvider) !== undefined
        ? { backingtrack_model: backingtrack_model ?? backing_track_model ?? backingTrackModel ?? music_provider ?? musicProvider }
        : {}),
      ...((tts_model ?? ttsModel ?? tts_provider ?? ttsProvider) !== undefined
        ? { tts_model: tts_model ?? ttsModel ?? tts_provider ?? ttsProvider }
        : {}),
      ...((inference_model ?? inferenceModel) !== undefined
        ? {
          inference_model: inference_model ?? inferenceModel,
          inferenceModel: inference_model ?? inferenceModel,
        }
        : {}),
      ...((custom_adapters ?? customAdapters) ? { custom_adapters: custom_adapters ?? customAdapters } : {}),
      ...((configuration ?? config ?? model_config ?? modelConfig ?? custom_model_config ?? customModelConfig ?? custom_models ?? customModels)
        ? {
          configuration:
            configuration ??
            config ??
            model_config ??
            modelConfig ??
            custom_model_config ??
            customModelConfig ??
            custom_models ??
            customModels,
        }
        : {}),
      ...(generateOutroImage
        ? {
          ...(ctaUrl ? { cta_url: ctaUrl } : {}),
          ...(outroCtaImage ? { outro_cta_image: outroCtaImage } : {}),
          ...(ctaTextTop ? { cta_text_top: ctaTextTop } : {}),
          ...(ctaTextBottom ? { cta_text_bottom: ctaTextBottom } : {}),
          ...(ctaLogo ? { cta_logo: ctaLogo } : {}),
        }
        : {}),
      enable_subtitles: enableSubtitlesOption.value,
    };

    const response = await requestCreateVideoFromImageListAndMetadata(req.userId, payload, webhookUrl);


    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][video][image_list_to_video] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const upstreamMessage =
      (typeof error?.response?.data?.message === 'string' && error.response.data.message.trim()) ||
      (typeof error?.response?.data?.error === 'string' && error.response.data.error.trim()) ||
      (typeof error?.message === 'string' && error.message.trim()) ||
      '';
    const message =
      upstreamMessage
        ? upstreamMessage
        : 'Internal server error while creating video from image list.';
    res.status(statusCode).json({ message });
  }
});

router.post('/update_outro_image', validateAPIKeyAndUserId, async function (req, res, next) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID;

    const rawOutroUrl =
      requestPayload.outro_image_url ??
      requestPayload.outroImageUrl ??
      requestPayload.new_outro_image_url ??
      requestPayload.newOutroImageUrl;

    const rawGenerateOutroImage =
      requestPayload.generate_outro_image ??
      requestPayload.generateOutroImage;

    const rawAddOutroAnimation =
      requestPayload.add_outro_animation ??
      requestPayload.addOutroAnimation;

    const rawAddOutroFocusArea =
      requestPayload.add_outro_focus_area ??
      requestPayload.addOutroFocusArea;

    const rawOutroFocusArea =
      requestPayload.outro_focust_area ??
      requestPayload.outro_focus_area ??
      requestPayload.outroFocustArea ??
      requestPayload.outroFocusArea;

    const rawCtaUrl =
      requestPayload.cta_url ??
      requestPayload.ctaUrl;
    const rawCtaTextTop =
      requestPayload.cta_text_top ??
      requestPayload.ctaTextTop;
    const rawCtaTextBottom =
      requestPayload.cta_text_bottom ??
      requestPayload.ctaTextBottom;
    const rawCtaLogo =
      requestPayload.cta_logo ??
      requestPayload.ctaLogo;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const outroImageUrl = typeof rawOutroUrl === 'string' ? rawOutroUrl.trim() : '';
    const addOutroAnimation = typeof rawAddOutroAnimation === 'boolean' ? rawAddOutroAnimation : undefined;
    const addOutroFocusArea = typeof rawAddOutroFocusArea === 'boolean' ? rawAddOutroFocusArea : undefined;
    const outroFocustArea = rawOutroFocusArea ?? null;
    const ctaUrl = typeof rawCtaUrl === 'string' ? rawCtaUrl.trim() : '';
    let outroCtaImage = null;
    let outroCtaImageTextFields = { ctaTextTop: null, ctaTextBottom: null };
    try {
      outroCtaImage = normalizeOutroCtaImageFromPayload(requestPayload);
      outroCtaImageTextFields = normalizeOutroCtaImageTextFieldsFromPayload(requestPayload);
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid outro_cta_image.',
      });
    }
    const generateOutroImage = rawGenerateOutroImage === true ||
      (rawGenerateOutroImage === undefined && !outroImageUrl && (Boolean(ctaUrl) || Boolean(outroCtaImage)));
    const normalizedCtaTextTop = normalizeOptionalRequestString(rawCtaTextTop);
    const normalizedCtaTextBottom = normalizeOptionalRequestString(rawCtaTextBottom);
    const ctaTextTop = normalizedCtaTextTop || outroCtaImageTextFields.ctaTextTop;
    const ctaTextBottom = normalizedCtaTextBottom || outroCtaImageTextFields.ctaTextBottom;
    const ctaLogo = normalizeOptionalRequestString(rawCtaLogo);
    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;

    if (await shouldDelegateToExternalRoute(req, [sessionId])) {
      return delegateToExternalUsersRoute(req, res, next, '/update_outro_image');
    }

    if (rawGenerateOutroImage !== undefined && typeof rawGenerateOutroImage !== 'boolean') {
      return res.status(400).json({
        message: 'generate_outro_image must be a boolean.',
      });
    }

    if (rawAddOutroAnimation !== undefined && typeof rawAddOutroAnimation !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_animation must be a boolean.',
      });
    }

    if (rawAddOutroFocusArea !== undefined && typeof rawAddOutroFocusArea !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_focus_area must be a boolean.',
      });
    }

    if (normalizedCtaTextTop === undefined) {
      return res.status(400).json({
        message: 'cta_text_top must be a string when provided.',
      });
    }
    if (normalizedCtaTextBottom === undefined) {
      return res.status(400).json({
        message: 'cta_text_bottom must be a string when provided.',
      });
    }
    if (ctaLogo === undefined) {
      return res.status(400).json({
        message: 'cta_logo must be a string when provided.',
      });
    }


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    if ((generateOutroImage || outroCtaImage) && outroImageUrl) {
      return res.status(400).json({
        message: 'Use either generate_outro_image with cta_url/outro_cta_image or outro_image_url, not both.',
      });
    }

    if (!generateOutroImage && !outroImageUrl) {
      return res.status(400).json({
        message: 'outro_image_url (or outroImageUrl/new_outro_image_url) is required unless generate_outro_image is true.',
      });
    }

    if (generateOutroImage) {
      if (!ctaUrl && !outroCtaImage) {
        return res.status(400).json({
          message: 'cta_url or outro_cta_image is required when generate_outro_image is true.',
        });
      }
      if (ctaUrl && !isHttpUrl(ctaUrl)) {
        return res.status(400).json({
          message: 'cta_url must be an http or https URL.',
        });
      }
    }

    if (!generateOutroImage && addOutroFocusArea === true) {
      if (addOutroAnimation !== true) {
        return res.status(400).json({
          message: 'add_outro_focus_area requires add_outro_animation to be true.',
        });
      }

      if (!outroFocustArea) {
        return res.status(400).json({
          message: 'outro_focust_area is required when add_outro_focus_area is true.',
        });
      }

      if (typeof outroFocustArea !== 'object' || Array.isArray(outroFocustArea)) {
        return res.status(400).json({
          message: 'outro_focust_area must be an object with x, y, width, height.',
        });
      }

      const { x, y, width, height } = outroFocustArea;
      const hasInvalidNumber = [x, y, width, height].some(
        (value) => typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value),
      );

      if (hasInvalidNumber) {
        return res.status(400).json({
          message: 'outro_focust_area x, y, width, height must be valid numbers.',
        });
      }
    }

    const response = await updateOutroImageAndQueueRender(req.userId, {
      videoSessionId: sessionId,
      ...(outroImageUrl ? { outroImageUrl } : {}),
      generateOutroImage,
      ...(generateOutroImage ? {
        ...(ctaUrl ? { ctaUrl } : {}),
        ...(outroCtaImage ? { outroCtaImage } : {}),
        ...(ctaTextTop ? { ctaTextTop } : {}),
        ...(ctaTextBottom ? { ctaTextBottom } : {}),
        ...(ctaLogo ? { ctaLogo } : {}),
      } : {}),
      ...(addOutroAnimation !== undefined ? { addOutroAnimation } : {}),
      ...(addOutroFocusArea !== undefined ? { addOutroFocusArea } : {}),
      ...(outroFocustArea !== null && outroFocustArea !== undefined ? { outroFocustArea } : {}),
      webhookUrl: resolvedWebhookUrl,
    });

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][video][update_outro_image] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      error?.publicMessage ||
      (statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while updating outro image.');
    res.status(statusCode).json({ message });
  }
});

router.post('/update_footer_image', validateAPIKeyAndUserId, async function (req, res, next) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID;

    const rawRemoveFooter =
      requestPayload.remove_footer ??
      requestPayload.removeFooter;
    const rawCtaText =
      requestPayload.cta_text ??
      requestPayload.ctaText;
    const rawCtaLogo =
      requestPayload.cta_logo ??
      requestPayload.ctaLogo;
    const rawCtaUrl =
      requestPayload.cta_url ??
      requestPayload.ctaUrl;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const removeFooter = rawRemoveFooter === true;
    const ctaText = normalizeOptionalRequestString(rawCtaText);
    const ctaLogo = normalizeOptionalRequestString(rawCtaLogo);
    const ctaUrl = normalizeOptionalRequestString(rawCtaUrl);
    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;

    if (await shouldDelegateToExternalRoute(req, [sessionId])) {
      return delegateToExternalUsersRoute(req, res, next, '/update_footer_image');
    }

    if (rawRemoveFooter !== undefined && typeof rawRemoveFooter !== 'boolean') {
      return res.status(400).json({
        message: 'remove_footer must be a boolean.',
      });
    }
    if (ctaText === undefined) {
      return res.status(400).json({
        message: 'cta_text must be a string when provided.',
      });
    }
    if (ctaLogo === undefined) {
      return res.status(400).json({
        message: 'cta_logo must be a string when provided.',
      });
    }
    if (ctaUrl === undefined) {
      return res.status(400).json({
        message: 'cta_url must be a string when provided.',
      });
    }


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    if (ctaUrl && !isHttpUrl(ctaUrl)) {
      return res.status(400).json({
        message: 'cta_url must be an http or https URL.',
      });
    }

    if (!removeFooter && !ctaText && !ctaLogo && !ctaUrl) {
      return res.status(400).json({
        message: 'At least one of cta_text, cta_logo, or cta_url is required unless remove_footer is true.',
      });
    }

    const response = await updateFooterImageAndQueueRender(req.userId, {
      videoSessionId: sessionId,
      removeFooter,
      ...(ctaText ? { ctaText } : {}),
      ...(ctaLogo ? { ctaLogo } : {}),
      ...(ctaUrl ? { ctaUrl } : {}),
      webhookUrl: resolvedWebhookUrl,
    });

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][video][update_footer_image] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      error?.publicMessage ||
      (statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while updating footer image.');
    res.status(statusCode).json({ message });
  }
});

router.post('/add_outro_image', validateAPIKeyAndUserId, async function (req, res, next) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID;

    const rawOutroUrl =
      requestPayload.outro_image_url ??
      requestPayload.outroImageUrl ??
      requestPayload.new_outro_image_url ??
      requestPayload.newOutroImageUrl;

    const rawAddOutroAnimation =
      requestPayload.add_outro_animation ??
      requestPayload.addOutroAnimation;

    const rawAddOutroFocusArea =
      requestPayload.add_outro_focus_area ??
      requestPayload.addOutroFocusArea;

    const rawOutroFocusArea =
      requestPayload.outro_focust_area ??
      requestPayload.outro_focus_area ??
      requestPayload.outroFocustArea ??
      requestPayload.outroFocusArea;

    const rawGenerateOutroImage =
      requestPayload.generate_outro_image ??
      requestPayload.generateOutroImage;

    const rawCtaUrl =
      requestPayload.cta_url ??
      requestPayload.ctaUrl;
    const rawCtaTextTop =
      requestPayload.cta_text_top ??
      requestPayload.ctaTextTop;
    const rawCtaTextBottom =
      requestPayload.cta_text_bottom ??
      requestPayload.ctaTextBottom;
    const rawCtaLogo =
      requestPayload.cta_logo ??
      requestPayload.ctaLogo;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const outroImageUrl = typeof rawOutroUrl === 'string' ? rawOutroUrl.trim() : '';
    const addOutroAnimation = typeof rawAddOutroAnimation === 'boolean' ? rawAddOutroAnimation : false;
    const addOutroFocusArea = typeof rawAddOutroFocusArea === 'boolean' ? rawAddOutroFocusArea : false;
    const outroFocustArea = rawOutroFocusArea ?? null;
    const ctaUrl = typeof rawCtaUrl === 'string' ? rawCtaUrl.trim() : '';
    let outroCtaImage = null;
    let outroCtaImageTextFields = { ctaTextTop: null, ctaTextBottom: null };
    try {
      outroCtaImage = normalizeOutroCtaImageFromPayload(requestPayload);
      outroCtaImageTextFields = normalizeOutroCtaImageTextFieldsFromPayload(requestPayload);
    } catch (validationError) {
      return res.status(validationError?.status || 400).json({
        message: validationError?.message || 'Invalid outro_cta_image.',
      });
    }
    const generateOutroImage = rawGenerateOutroImage === true ||
      (rawGenerateOutroImage === undefined && !outroImageUrl && (Boolean(ctaUrl) || Boolean(outroCtaImage)));
    const normalizedCtaTextTop = normalizeOptionalRequestString(rawCtaTextTop);
    const normalizedCtaTextBottom = normalizeOptionalRequestString(rawCtaTextBottom);
    const ctaTextTop = normalizedCtaTextTop || outroCtaImageTextFields.ctaTextTop;
    const ctaTextBottom = normalizedCtaTextBottom || outroCtaImageTextFields.ctaTextBottom;
    const ctaLogo = normalizeOptionalRequestString(rawCtaLogo);

    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;

    if (await shouldDelegateToExternalRoute(req, [sessionId])) {
      return delegateToExternalUsersRoute(req, res, next, '/add_outro_image');
    }

    if (rawAddOutroAnimation !== undefined && typeof rawAddOutroAnimation !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_animation must be a boolean.',
      });
    }

    if (rawAddOutroFocusArea !== undefined && typeof rawAddOutroFocusArea !== 'boolean') {
      return res.status(400).json({
        message: 'add_outro_focus_area must be a boolean.',
      });
    }

    if (rawGenerateOutroImage !== undefined && typeof rawGenerateOutroImage !== 'boolean') {
      return res.status(400).json({
        message: 'generate_outro_image must be a boolean.',
      });
    }

    if (normalizedCtaTextTop === undefined) {
      return res.status(400).json({
        message: 'cta_text_top must be a string when provided.',
      });
    }
    if (normalizedCtaTextBottom === undefined) {
      return res.status(400).json({
        message: 'cta_text_bottom must be a string when provided.',
      });
    }
    if (ctaLogo === undefined) {
      return res.status(400).json({
        message: 'cta_logo must be a string when provided.',
      });
    }


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    if ((generateOutroImage || outroCtaImage) && outroImageUrl) {
      return res.status(400).json({
        message: 'Use either generate_outro_image with cta_url/outro_cta_image or outro_image_url, not both.',
      });
    }

    if (!generateOutroImage && !outroImageUrl) {
      return res.status(400).json({
        message: 'outro_image_url (or outroImageUrl/new_outro_image_url) is required unless generate_outro_image is true.',
      });
    }

    if (generateOutroImage) {
      if (!ctaUrl && !outroCtaImage) {
        return res.status(400).json({
          message: 'cta_url or outro_cta_image is required when generate_outro_image is true.',
        });
      }
      if (ctaUrl && !isHttpUrl(ctaUrl)) {
        return res.status(400).json({
          message: 'cta_url must be an http or https URL.',
        });
      }
    }

    if (!generateOutroImage && addOutroFocusArea) {
      if (!addOutroAnimation) {
        return res.status(400).json({
          message: 'add_outro_focus_area requires add_outro_animation to be true.',
        });
      }

      if (!outroFocustArea) {
        return res.status(400).json({
          message: 'outro_focust_area is required when add_outro_focus_area is true.',
        });
      }

      if (typeof outroFocustArea !== 'object' || Array.isArray(outroFocustArea)) {
        return res.status(400).json({
          message: 'outro_focust_area must be an object with x, y, width, height.',
        });
      }

      const { x, y, width, height } = outroFocustArea;
      const hasInvalidNumber = [x, y, width, height].some(
        (value) => typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value),
      );

      if (hasInvalidNumber) {
        return res.status(400).json({
          message: 'outro_focust_area x, y, width, height must be valid numbers.',
        });
      }

      const canvasDimensions = getCanvasDimensionsForAspectRatio('16:9');
      const exceedsBounds =
        x < 0 || x > canvasDimensions.width ||
        y < 0 || y > canvasDimensions.height ||
        width < 0 || width > canvasDimensions.width ||
        height < 0 || height > canvasDimensions.height;

      if (exceedsBounds) {
        return res.status(400).json({
          message: 'outro_focust_area values must be within the canvas dimensions.',
        });
      }
    }

    const response = await addOutroImageAndQueueRender(req.userId, {
      videoSessionId: sessionId,
      ...(outroImageUrl ? { outroImageUrl } : {}),
      generateOutroImage,
      ...(generateOutroImage ? {
        ...(ctaUrl ? { ctaUrl } : {}),
        ...(outroCtaImage ? { outroCtaImage } : {}),
        ...(ctaTextTop ? { ctaTextTop } : {}),
        ...(ctaTextBottom ? { ctaTextBottom } : {}),
        ...(ctaLogo ? { ctaLogo } : {}),
      } : {}),
      webhookUrl: resolvedWebhookUrl,
      ...(!generateOutroImage ? {
        addOutroAnimation,
        addOutroFocusArea,
        outroFocustArea,
      } : {}),
    });

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][video][add_outro_image] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      error?.publicMessage ||
      (statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while adding outro image.');
    res.status(statusCode).json({ message });
  }
});

router.post('/translate_video', validateAPIKeyAndUserId, async function (req, res, next) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID;

    const rawLanguage =
      requestPayload.language ??
      requestPayload.language_code ??
      requestPayload.languageCode ??
      requestPayload.langauge ??
      requestPayload.langauge_code ??
      requestPayload.langaugeCode;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const languageCode = typeof rawLanguage === 'string' ? rawLanguage.trim() : '';
    const enableSubtitlesOption = getBooleanRequestOption(
      requestPayload,
      ['enable_subtitles', 'enableSubtitles', 'add_subtitles', 'addSubtitles'],
      false,
      'enable_subtitles',
    );
    const translateOutroOption = getBooleanRequestOption(
      requestPayload,
      ['translate_outro', 'translateOutro'],
      true,
      'translate_outro',
    );
    const translateFooterOption = getBooleanRequestOption(
      requestPayload,
      ['translate_footer', 'translateFooter'],
      true,
      'translate_footer',
    );
    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;

    if (await shouldDelegateToExternalRoute(req, [sessionId])) {
      return delegateToExternalUsersRoute(req, res, next, '/translate_video');
    }


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    if (!languageCode) {
      return res.status(400).json({
        message: 'language (or language_code) is required.',
      });
    }

    if (enableSubtitlesOption.error) {
      return res.status(400).json({ message: enableSubtitlesOption.error });
    }
    if (translateOutroOption.error) {
      return res.status(400).json({ message: translateOutroOption.error });
    }
    if (translateFooterOption.error) {
      return res.status(400).json({ message: translateFooterOption.error });
    }

    const response = await translateVideoSessionAndQueueGeneration(req.userId, {
      videoSessionId: sessionId,
      language: languageCode,
      enable_subtitles: enableSubtitlesOption.value,
      translate_outro: translateOutroOption.value,
      translate_footer: translateFooterOption.value,
      webhookUrl: resolvedWebhookUrl,
    });

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][video][translate_video] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message = error?.code === 'SUBTITLE_PROVIDER_NOT_CONFIGURED'
      ? error.message
      : statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while translating video.';
    res.status(statusCode).json({ code: error?.code, message });
  }
});

router.post('/retranslate_video', validateAPIKeyAndUserId, async function (req, res, next) {
  req.url = '/translate_video';
  req.originalUrl = '/v1/video/translate_video';
  return router.handle(req, res, next);
});

router.post('/remove_subtitles', validateAPIKeyAndUserId, async function (req, res) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    const response = await removeSubtitlesAndQueueGeneration(req.userId, {
      videoSessionId: sessionId,
      webhookUrl: resolvedWebhookUrl,
    });


    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][video][remove_subtitles] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while removing subtitles.';
    res.status(statusCode).json({ message });
  }
});

router.post('/add_subtitles', validateAPIKeyAndUserId, async function (req, res) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const subtitleLanguage =
      requestPayload.subtitle_language ??
      requestPayload.subtitleLanguage ??
      req.body?.subtitle_language ??
      req.body?.subtitleLanguage;
    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    const response = await addSubtitlesAndQueueGeneration(req.userId, {
      videoSessionId: sessionId,
      webhookUrl: resolvedWebhookUrl,
      ...(subtitleLanguage !== undefined ? { subtitle_language: subtitleLanguage } : {}),
    });


    res.status(200).json(response);
  } catch (error) {
    console.error('[api][video][add_subtitles] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message = error?.code === 'SUBTITLE_PROVIDER_NOT_CONFIGURED'
      ? error.message
      : statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while adding subtitles.';
    res.status(statusCode).json({ code: error?.code, message });
  }
});

router.post('/reroll-layers', validateAPIKeyAndUserId, async function (req, res) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID ??
      requestPayload.request_id ??
      requestPayload.requestId;

    const rawLayerIndexes =
      requestPayload.layer_indexes ??
      requestPayload.layerIndexes ??
      requestPayload.layer_indices ??
      requestPayload.layerIndices ??
      requestPayload.layers;

    const quoteOnly =
      requestPayload.quote_only === true ||
      requestPayload.quoteOnly === true ||
      requestPayload.dry_run === true ||
      requestPayload.dryRun === true;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    const response = quoteOnly
      ? await quoteVideoSessionLayerReroll(req.userId, {
        videoSessionId: sessionId,
        layerIndexes: rawLayerIndexes,
      })
      : await rerollVideoSessionLayersAndQueueGeneration(req.userId, {
        videoSessionId: sessionId,
        layerIndexes: rawLayerIndexes,
        webhookUrl: resolvedWebhookUrl,
      });

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    } else if (quoteOnly) {
      res.set('x-credits-charged', '0');
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][video][reroll-layers] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while rerolling video layers.';
    res.status(statusCode).json({ message });
  }
});

router.post('/cancel_render', validateAPIKeyAndUserId, async function (req, res) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    const response = await cancelVideoSessionRender(req.userId, {
      videoSessionId: sessionId,
    });

    res.status(200).json(response);
  } catch (error) {
    console.error('[api][video][cancel_render] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while cancelling video render.';
    res.status(statusCode).json({ message });
  }
});

async function handlePauseOrResumeRenderRequest(req, res, action) {
  let traceId = null;
  const isResume = action === 'resume';
  const routeName = isResume ? 'resume_render' : 'pause_render';
  try {
    traceId = resolveTraceId(req);
    const { input } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID ??
      requestPayload.request_id ??
      requestPayload.requestId;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or video_session_id/session_id) is required.',
      });
    }

    const response = isResume
      ? await resumeVideoSessionRender(req.userId, { videoSessionId: sessionId })
      : await pauseVideoSessionRender(req.userId, { videoSessionId: sessionId });

    return res.status(200).json(response);
  } catch (error) {
    console.error(`[api][video][${routeName}] failed`, {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : `Internal server error while ${isResume ? 'resuming' : 'pausing'} video render.`;
    return res.status(statusCode).json({ message });
  }
}

router.post('/pause_render', validateAPIKeyAndUserId, async function (req, res) {
  return handlePauseOrResumeRenderRequest(req, res, 'pause');
});

router.post('/resume_render', validateAPIKeyAndUserId, async function (req, res) {
  return handlePauseOrResumeRenderRequest(req, res, 'resume');
});

router.post('/join_videos', validateAPIKeyAndUserId, async function (req, res, next) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionIds =
      requestPayload.session_ids ??
      requestPayload.sessionIds ??
      requestPayload.video_session_ids ??
      requestPayload.videoSessionIds;
    const rawBlendScenes = requestPayload.blend_scenes ?? requestPayload.blendScenes;

    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;
    if (rawBlendScenes !== undefined && typeof rawBlendScenes !== 'boolean') {
      return res.status(400).json({
        message: 'blend_scenes must be a boolean.',
      });
    }
    const blendScenes = rawBlendScenes === true;


    if (!Array.isArray(rawSessionIds) || rawSessionIds.length < 2) {
      return res.status(400).json({
        message: 'session_ids must be an array of at least 2 session ids.',
      });
    }

    const sessionIds = rawSessionIds
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter(Boolean);

    if (await shouldDelegateToExternalRoute(req, sessionIds)) {
      return delegateToExternalUsersRoute(req, res, next, '/join_videos');
    }

    if (sessionIds.length < 2) {
      return res.status(400).json({
        message: 'session_ids must contain at least 2 non-empty strings.',
      });
    }

    const hasInvalidId = sessionIds.some((id) => !mongoose.Types.ObjectId.isValid(id));
    if (hasInvalidId) {
      return res.status(400).json({
        message: 'session_ids must contain only valid session ids.',
      });
    }

    const response = await joinVideoSessionsAndQueueGeneration(req.userId, {
      session_ids: sessionIds,
      webhookUrl: resolvedWebhookUrl,
      blend_scenes: blendScenes,
    });

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][video][join_videos] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while joining video sessions.';
    res.status(statusCode).json({ message });
  }
});

router.post('/clone', validateAPIKeyAndUserId, async function (req, res) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID ??
      requestPayload.request_id ??
      requestPayload.requestId ??
      requestPayload.source_session_id ??
      requestPayload.sourceSessionId ??
      requestPayload.source_request_id ??
      requestPayload.sourceRequestId;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or session_id) is required.',
      });
    }

    const response = await cloneVideoSessionAndQueueRender(req.userId, {
      ...requestPayload,
      videoSessionId: sessionId,
      webhookUrl: resolvedWebhookUrl,
    });

    const statusResponse = await buildVideoStatusResponse({
      sessionId: response.session_id,
      requestId: response.request_id,
      provider: null,
      req,
      defaultResultUrl: response.result_url,
      defaultResultUrls: response.result_urls,
    });


    res.set('x-credits-charged', '0');
    res.status(200).json({
      ...response,
      ...(statusResponse || {}),
      creditsCharged: 0,
      remainingCredits: null,
    });
  } catch (error) {
    console.error('[api][video][clone] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while cloning video session.';
    res.status(statusCode).json({ message });
  }
});

router.post('/regenerate_avatar', validateAPIKeyAndUserId, async function (req, res) {
  let traceId = null;
  try {
    traceId = resolveTraceId(req);
    const { input, webhookUrl } = req.body || {};
    const requestPayload = input || req.body || {};

    const rawSessionId =
      requestPayload.video_session_id ??
      requestPayload.videoSessionId ??
      requestPayload.session_id ??
      requestPayload.sessionId ??
      requestPayload.video_sessionID ??
      requestPayload.videoSessionID ??
      requestPayload.request_id ??
      requestPayload.requestId ??
      requestPayload.source_session_id ??
      requestPayload.sourceSessionId ??
      requestPayload.source_request_id ??
      requestPayload.sourceRequestId;

    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const resolvedWebhookUrl = typeof webhookUrl === 'string' && webhookUrl.trim()
      ? webhookUrl.trim()
      : typeof requestPayload.webhookUrl === 'string' && requestPayload.webhookUrl.trim()
        ? requestPayload.webhookUrl.trim()
        : null;


    if (!sessionId) {
      return res.status(400).json({
        message: 'videoSessionId (or session_id) is required.',
      });
    }

    const response = await cloneVideoSessionAndRegenerateNarratorAvatar(req.userId, {
      ...requestPayload,
      videoSessionId: sessionId,
      webhookUrl: resolvedWebhookUrl,
    });

    const statusResponse = await buildVideoStatusResponse({
      sessionId: response.session_id,
      requestId: response.request_id,
      provider: null,
      req,
    });


    res.set('x-credits-charged', '0');
    res.status(200).json({
      ...response,
      ...(statusResponse || {}),
      creditsCharged: 0,
      remainingCredits: null,
    });
  } catch (error) {
    console.error('[api][video][regenerate_avatar] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    const message =
      statusCode >= 400 && statusCode < 500 && error?.message
        ? error.message
        : 'Internal server error while regenerating narrator avatar.';
    res.status(statusCode).json({ message });
  }
});

router.get('/list_completed_video_sessions', validateAPIKeyAndUserId, async function (req, res) {
  const traceId = resolveTraceId(req);
  try {
    await getDBConnectionString();

    const normalizedUserId = req.userId?.toString?.() || req.userId;
    const sessionId = resolveSessionIdFromRequest(req);
    const parsedLimit = Number(req.query?.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), 5000)
      : null;

    if (sessionId && !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: 'session_id must be a valid id.' });
    }

    const query = {
      userId: normalizedUserId,
      ...(sessionId ? { _id: sessionId } : {}),
      $or: [
        { remoteURL: { $exists: true, $nin: [null, ''] } },
        { videoLink: { $exists: true, $nin: [null, ''] } },
      ],
      expressGenerationPending: { $ne: true },
      videoGenerationPending: { $ne: true },
      expressGenerationFailed: { $ne: true },
      expressGenerationCancelled: { $ne: true },
    };

    const sessionQuery = VideoSession.find(query)
      .select('remoteURL videoLink sessionLanguage language language_code langauge enableSubtitles hasSubtitles has_subtitles createdAt updatedAt')
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 });

    if (limit) {
      sessionQuery.limit(limit);
    }

    const sessions = await sessionQuery.lean();
    const completedSessions = sessions
      .map((session) => {
        const resultUrl =
          normalizeRemoteVideoUrl(session?.remoteURL) ||
          resolveAbsoluteVideoUrl(req, session?.videoLink);
        if (!resultUrl) {
          return null;
        }

        const sessionId = session?._id?.toString?.();
        if (!sessionId) {
          return null;
        }

        return {
          session_id: sessionId,
          langauge: resolveSessionLanguageCode(session),
          result_language: resolveSessionLanguageCode(session),
          has_subtitles: resolveSessionHasSubtitles(session),
          result_url: resultUrl,
        };
      })
      .filter(Boolean);


    return res.status(200).json(completedSessions);
  } catch (error) {
    console.error('[api][video][list_completed_video_sessions] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: 'Internal server error while listing completed video sessions.',
    });
  }
});

async function handleFetchLatestVersion(req, res) {
  const traceId = resolveTraceId(req);
  try {
    const sessionId = resolveSessionIdFromRequest(req);
    if (!sessionId) {
      return res.status(400).json({ message: 'session_id is required.' });
    }

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: 'session_id must be a valid id.' });
    }

    await getDBConnectionString();

    const session = await VideoSession.findById(sessionId)
      .select([
        'userId',
        'videoLink',
        'remoteURL',
        'videoGenerationPending',
        'expressGenerationPending',
        'expressGenerationCancelled',
        'expressGenerationFailed',
        'expressGenerationError',
        'expressGenerationStatus',
        'enableSubtitles',
        'hasSubtitles',
        'has_subtitles',
        'sessionLanguage',
        'language',
        'language_code',
        'langauge',
      ])
      .lean();

    if (!session) {
      return res.status(404).json({ message: 'Session not found.' });
    }

    const sessionUserId = session.userId?.toString();
    if (sessionUserId && sessionUserId !== req.userId?.toString()) {
      return res.status(403).json({ message: 'Session does not belong to user.' });
    }

    const resultUrl = normalizeRemoteVideoUrl(session.remoteURL) || resolveAbsoluteVideoUrl(req, session.videoLink);


    if (resultUrl) {
      return res.status(200).json({
        session_id: sessionId,
        result_url: resultUrl,
        has_subtitles: resolveSessionHasSubtitles(session),
        result_language: resolveSessionLanguageCode(session),
      });
    }

    const stageVideoStatusRaw =
      typeof session?.expressGenerationStatus?.video_generation === 'string'
        ? session.expressGenerationStatus.video_generation.trim().toUpperCase()
        : '';
    const stageTopLevelStatusRaw =
      typeof session?.expressGenerationStatus?.status === 'string'
        ? session.expressGenerationStatus.status.trim().toUpperCase()
        : '';
    const isCancelled =
      session.expressGenerationCancelled ||
      stageTopLevelStatusRaw.includes('CANCEL') ||
      stageVideoStatusRaw.includes('CANCEL');

    if (isCancelled) {
      return res.status(200).json({
        session_id: sessionId,
        status: 'CANCELLED',
        message: 'Render was cancelled.',
      });
    }

    if (session.expressGenerationFailed) {
      return res.status(200).json({
        session_id: sessionId,
        status: 'FAILED',
        message: session.expressGenerationError || 'Video generation failed.',
      });
    }

    return res.status(202).json({
      session_id: sessionId,
      status: 'PENDING',
      message: 'Render not ready yet.',
    });
  } catch (error) {
    console.error('[api][video][fetch_latest_version] failed', {
      traceId,
      userId: req.userId,
      error,
    });
    const statusCode = error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: 'Internal server error while fetching latest render.',
    });
  }
}

router.get('/fetch_latest_version', validateAPIKeyAndUserId, handleFetchLatestVersion);
router.post('/fetch_latest_version', validateAPIKeyAndUserId, handleFetchLatestVersion);

export default router;
