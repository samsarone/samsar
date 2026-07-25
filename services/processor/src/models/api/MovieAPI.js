import VideoSession from "../../schema/VideoSession.js";
import ExpressGenerationBuilderRequest from '../../schema/ExpressGenerationBuilderRequest.js';
import { randomUUID } from 'crypto';
import { getDBConnectionString } from "../DBString.js";
import { assertAPIKeyUsageLimitForDebit } from "../GenerationCredits.js";
import {
  createVidGPTSession,
  createVidGPTSessionFromNarrativeArtifacts,
} from "../movie_session/VidGPT.js";
import User from "../../schema/User.js";
import ExternalUser from "../../schema/ExternalUser.js";
import axios from "axios";
import sharp from "sharp";
import { 
  
  setSessionQuickGenerationPending, 
  createQuickSession, 
  createNewBlankQuickSession, 

   } from "../QuickSession.js";
import { upsertGlobalSessionMapping } from "../GlobalSession.js";


import { getDescriptionForImageToCreateTranscript } from "../ai_utils/VisionUtils.js";

import { createNewImageListToVideoSession } from '../movie_session/image_list_to_video/index.js';
import { getLanguageStringFromLanguageCode } from "../../consts/LanguageCodes.js";
import { SUPPORTED_LANGUAGES, normalizeSupportedLanguage } from "../../consts/SupportedLanguages.js";
import { getSessionById } from "../VideoSession.js";
import { DEFAULT_LATIN_SUBTITLE_FONT, getSubtitleFontsForLanguage } from "../../consts/SubtitleFonts.js";
import { getCanvasDimensionsForAspectRatio } from "../../utils/CanvasUtils.js";
import { uploadImageBufferToCDN, uploadImageDataUrlToCDN } from "../AWS.js";
import {
  IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ERROR_MESSAGE,
  normalizeImageListToVideoModel,
} from '../../consts/ImageListToVideoModels.js';
import {
  buildOutroImageMetadata,
  normalizeFooterMetadataItem,
} from '../../utils/VideoOverlayMetadata.js';
import {
  normalizeOutroCtaImageFromPayload,
  normalizeOutroCtaImageTextFieldsFromPayload,
} from '../../utils/OutroCtaImagePayload.js';
import {
  applyCustomModelOverrides,
  normalizeCustomModelAdaptersPayload,
} from '../custom/VideoCustomModelConfig.js';
import {
  buildSpeakerOptionsForTTSModel,
  getSpeakerOptionsFromPayload,
  normalizeBackingTrackModelFromPayload,
  normalizeInferenceModelFromPayload,
  resolveEffectiveInferenceModel,
  normalizeTTSModelFromPayload,
  omitCustomTextToSpeechAdapterForTTSModel,
} from './RequestModelOverrides.js';
import {
  buildInitialExpressStepGeneration,
} from '../ExpressVideoStepState.js';
import {
  assertImageListToVideoUrlsAreFetchable,
} from './ImageListToVideoUrlValidation.js';
import { resolveCustomAdaptersForTTSLanguagePolicy } from '../movie_session/TTSLanguagePolicy.js';
import {
  resolveSpeechLanguageCode,
  resolveSubtitleEnablement,
  resolveSubtitleLanguageOption,
} from '../movie_session/SubtitleLanguage.js';
import { getMaxDurationForModelForScenes } from '../movie_session/utils/ModelUtils.js';
import {
  EXPRESS_VIDEO_BILLING_STAGES,
  buildInitialReusedNarrativeExpressVideoCreditCharges,
  estimateExpressVideoCreditsForPreflight,
} from '../ExpressVideoStageBilling.js';
import { buildBranchedVideoSessionPlan } from '../movie_session/branching/BranchedVideoSessionPlan.js';
import { resolveFramesPerSecond } from '../../utils/FpsUtils.js';
import {
  getCurrentAPIKeyUsageContext,
  normalizeAPIKeyUsageContext,
} from './RequestAuthContext.js';
import {
  DOCKER_PROVIDER,
  hasSamsarCredential,
  isDockerProviderRoutingEnabled,
  resolveDockerImageProvider,
  resolveDockerVideoProvider,
} from '../../consts/DockerProviderPriority.js';
import {
  applyDockerSubtitleAvailability,
  assertDockerBackingTrackModelAvailable,
  assertDockerTTSProviderAvailable,
  filterDockerSpeakerOptions,
  resolveDockerBackingTrackModel,
  resolveDockerSpeakerOptionsForTTSProvider,
} from '../../consts/DockerAudioAvailability.js';
export {
  assertImageListToVideoUrlsAreFetchable,
  isBlockedImageListToVideoImageUrl,
} from './ImageListToVideoUrlValidation.js';

const OUTRO_LAYER_DURATION_SECONDS = 8;
const IMAGE_LIST_TO_VIDEO_DEFAULT_ASPECT_RATIO = '16:9';
const IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL = 'NANOBANANAPROEDIT';
const IMAGE_LIST_TO_VIDEO_ALLOWED_ASPECT_RATIOS = new Set(['16:9', '9:16']);
const IMAGE_LIST_TO_VIDEO_MEDIA_DOWNLOAD_TIMEOUT_MS = Number.isFinite(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS)))
  : 180000;
const IMAGE_LIST_TO_VIDEO_TEMP_IMAGE_TTL_SECONDS = Number.isFinite(Number(process.env.IMAGE_LIST_TO_VIDEO_TEMP_IMAGE_TTL_SECONDS))
  ? Math.max(60, Math.floor(Number(process.env.IMAGE_LIST_TO_VIDEO_TEMP_IMAGE_TTL_SECONDS)))
  : 3600;
const IMAGE_LIST_EXPRESS_CTA_GENERATION_ALIASES = Object.freeze([
  'express_cta_generation',
  'expressCtaGeneration',
  'auto_generate_cta_text',
  'autoGenerateCtaText',
  'generate_cta_texts',
  'generateCtaTexts',
]);
const TEXT_TO_VIDEO_BUILDER_LEASE_MS = 2 * 60 * 1000;
const TEXT_TO_VIDEO_BUILDER_RECOVERY_INTERVAL_MS = 30 * 1000;
const TEXT_TO_VIDEO_BUILDER_WORKER_ID = `${process.pid}:${randomUUID()}`;
let textToVideoBuilderRecoveryInterval = null;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAuthorization(value) {
  return normalizeString(value).toLowerCase().replace(/[_\s]+/g, '-');
}

function isDeployedAuthorization(value) {
  return ['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(normalizeAuthorization(value));
}

function hasDockerSamsarApiKey() {
  return hasSamsarCredential();
}

function hasNativeCustomAdapter(customAdapters, operationKey) {
  return Boolean(
    customAdapters?.[operationKey] &&
    !isDeployedAuthorization(customAdapters?.[`${operationKey}_authorization`])
  );
}

function buildDockerSamsarExternalProviderStages({
  routeType,
  userData = {},
  customAdapters = null,
  imageModel = null,
  videoModel = null,
} = {}) {
  if (!isDockerProviderRoutingEnabled() || !hasDockerSamsarApiKey()) {
    return null;
  }

  const stages = {};
  const imageAuthorization =
    customAdapters?.text_to_image_authorization ||
    userData?.agentImageModelAuthorization;
  const videoAuthorization =
    customAdapters?.image_to_video_authorization ||
    customAdapters?.text_to_video_authorization ||
    userData?.agentVideoModelAuthorization;

  const imageProvider = resolveDockerImageProvider(imageModel);
  const shouldUseExternalImage =
    isDeployedAuthorization(imageAuthorization) ||
    (
      imageProvider === DOCKER_PROVIDER.SAMSAR &&
      !hasNativeCustomAdapter(customAdapters, 'text_to_image')
    );
  if (shouldUseExternalImage) {
    stages.image_generation = {
      provider: 'samsar',
      authorization: 'deployed',
      source: 'samsar_api_key',
      routeType,
      operation: 'text_to_image',
      model: imageModel,
    };
  }

  const videoProvider = resolveDockerVideoProvider(videoModel);
  const shouldUseExternalAiVideo =
    isDeployedAuthorization(videoAuthorization) ||
    (
      videoProvider === DOCKER_PROVIDER.SAMSAR &&
      !hasNativeCustomAdapter(customAdapters, 'image_to_video')
    );
  if (shouldUseExternalAiVideo) {
    stages.ai_video_generation = {
      provider: 'samsar',
      authorization: 'deployed',
      source: 'samsar_api_key',
      routeType,
      operation: 'image_to_video',
      model: videoModel,
      videoRoute: routeType === 'text_to_video' ? 'text_to_video' : 'image_to_video',
    };
  }

  return Object.keys(stages).length > 0 ? stages : null;
}

function normalizeBackingTrackProvider(value) {
  return value === 'LYRIA2' ? 'LYRIA3' : value;
}

const IMAGE_OUTPUT_FORMATS = {
  jpeg: {
    format: 'jpeg',
    mimeType: 'image/jpeg',
    extension: 'jpg',
  },
  jpg: {
    format: 'jpeg',
    mimeType: 'image/jpeg',
    extension: 'jpg',
  },
  png: {
    format: 'png',
    mimeType: 'image/png',
    extension: 'png',
  },
  webp: {
    format: 'webp',
    mimeType: 'image/webp',
    extension: 'webp',
  },
  avif: {
    format: 'avif',
    mimeType: 'image/avif',
    extension: 'avif',
  },
  tiff: {
    format: 'tiff',
    mimeType: 'image/tiff',
    extension: 'tiff',
  },
  gif: {
    format: 'gif',
    mimeType: 'image/gif',
    extension: 'gif',
  },
};
const DEFAULT_IMAGE_OUTPUT_FORMAT = IMAGE_OUTPUT_FORMATS.png;

function normalizeTextToVideoDurationSeconds(value) {
  const requestedDuration = Number(value);
  return Number.isFinite(requestedDuration)
    ? Math.min(240, Math.max(10, requestedDuration))
    : 10;
}

function applyFooterSubtitlePolicy(enableSubtitles, footerAnimationOptions = {}) {
  if (footerAnimationOptions.add_footer_animation === true) {
    return false;
  }
  return enableSubtitles;
}

function buildInsufficientExpressVideoCreditsError({
  routeType,
  requiredCredits,
  availableCredits,
  estimate,
}) {
  const label = routeType === 'image_list_to_video' ? 'image_list_to_video' : 'text_to_video';
  const error = new Error(
    `Insufficient credits for ${label}. Estimated required credits: ${requiredCredits}; available credits: ${availableCredits}.`
  );
  error.status = 402;
  error.code = 'INSUFFICIENT_CREDITS';
  error.requiredCredits = requiredCredits;
  error.availableCredits = availableCredits;
  error.estimate = estimate;
  return error;
}

async function resolveExpressPreflightCreditBalance(userId, payload = {}) {
  if (payload.isExternalUserRequest === true && payload.externalRequestUserId) {
    const externalUser = await ExternalUser.findById(payload.externalRequestUserId)
      .select('generationCredits')
      .lean();
    if (!externalUser) {
      const error = new Error('External user not found for credit validation.');
      error.status = 404;
      throw error;
    }
    return Number(externalUser.generationCredits) || 0;
  }

  const user = await User.findById(userId)
    .select('generationCredits')
    .lean();
  if (!user) {
    const error = new Error('User not found for credit validation.');
    error.status = 404;
    throw error;
  }
  return Number(user.generationCredits) || 0;
}

async function assertSufficientExpressVideoCreditsForPreflight({
  userId,
  payload,
  routeType,
  durationSeconds,
  videoModel,
  imageModel,
  backingTrackModel = null,
  expressGenerationType,
  expressCtaGeneration = false,
  addNarratorAvatar = false,
  customAdapters = null,
  customAdapterOperationUsage = null,
  samsarExternalProviderStages = null,
  expressGenerationNarrativeReused = false,
  excludedStageKeys = [],
}) {
  const estimate = estimateExpressVideoCreditsForPreflight({
    durationSeconds,
    videoModel,
    imageModel,
    backingTrackModel,
    expressGenerationType,
    expressCtaGeneration,
    addNarratorAvatar,
    customAdapters,
    customAdapterOperationUsage,
    samsarExternalProviderStages,
    expressGenerationNarrativeReused,
    excludedStageKeys,
  });
  const requiredCredits = Math.ceil(Number(estimate.totalCredits) || 0);
  const availableCredits = await resolveExpressPreflightCreditBalance(userId, payload);

  if (requiredCredits > availableCredits) {
    throw buildInsufficientExpressVideoCreditsError({
      routeType,
      requiredCredits,
      availableCredits,
      estimate,
    });
  }

  const apiKeyUsage = normalizeAPIKeyUsageContext(payload?.apiKeyUsage);
  await assertAPIKeyUsageLimitForDebit(
    userId,
    requiredCredits,
    apiKeyUsage?.apiKeyId ? { apiKeyId: apiKeyUsage.apiKeyId } : {},
  );

  return {
    ...estimate,
    requiredCredits,
    availableCredits,
  };
}

function getSessionIdFromPayload(payload = {}) {
  const hasSessionIdField =
    Object.prototype.hasOwnProperty.call(payload, 'session_id')
    || Object.prototype.hasOwnProperty.call(payload, 'sessionId')
    || Object.prototype.hasOwnProperty.call(payload, 'sessionID');
  if (!hasSessionIdField) {
    return null;
  }

  const rawValue = payload.session_id ?? payload.sessionId ?? payload.sessionID;
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    const error = new Error('session_id must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  return rawValue.trim();
}

async function getOrCreateSessionId(userId, payload) {
  const requestedSessionId = getSessionIdFromPayload(payload);
  if (!requestedSessionId) {
    return createNewBlankQuickSession(userId);
  }

  const existingSession = await getSessionById(requestedSessionId);
  if (!existingSession) {
    const error = new Error('Session not found.');
    error.status = 404;
    throw error;
  }

  const sessionUserId = existingSession.userId?.toString();
  if (sessionUserId && sessionUserId !== userId.toString()) {
    const error = new Error('Session does not belong to user.');
    error.status = 403;
    throw error;
  }

  return existingSession._id.toString();
}



export async function requestCreateMovie(userId, payload, webhookUrl) {

  await getDBConnectionString();

  const sessionId = await createNewBlankQuickSession(userId);

  payload.sessionID = sessionId;

  await upsertGlobalSessionBeforeScheduling({
    sessionId,
    sessionType: 'video',
    requestId: sessionId,
    provider: payload.video_model || 'UNKNOWN',
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'movie_create',
  }, { routeType: 'text_to_video', sessionSubType: 'movie_create' });

  await scheduleTextToVideoBuilderSession(sessionId, userId, payload, webhookUrl, 'movie_create');

  return {
    request_id: sessionId,
    session_id: sessionId,
  };
}


export async function requestCreateNarrative(userId, payload, webhookUrl) {
  
  await getDBConnectionString();

  const sessionId = await createNewBlankQuickSession(userId);

  payload.sessionID = sessionId;

  await upsertGlobalSessionBeforeScheduling({
    sessionId,
    sessionType: 'video',
    requestId: sessionId,
    provider: payload.video_model || 'UNKNOWN',
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'narrative_create',
  }, { routeType: 'text_to_video', sessionSubType: 'narrative_create' });

  void createQuickSessionAndUpdateWebhook(userId, payload, webhookUrl).catch(async (error) => {
    console.error(`createQuickSessionAndUpdateWebhook failed for session ${sessionId}`, error);
    await markTextToVideoBuilderSessionFailed(sessionId, error);
    await markGlobalBuilderSessionFailed(sessionId, extractTextToVideoErrorMessage(error));
  });

  return {
    request_id: sessionId,
    session_id: sessionId,
  };
}

export function resolveTextToVideoPreflightBillingDuration({
  requestedDuration,
  estimatedOutroDuration = 0,
  preparedNarrativeArtifacts = null,
  videoGenerationModel = 'RUNWAYML',
  framesPerSecond = 24,
} = {}) {
  const normalizedRequestedDuration = Number(requestedDuration);
  const sourceDuration = Number.isFinite(normalizedRequestedDuration) &&
    normalizedRequestedDuration > 0
    ? normalizedRequestedDuration
    : 0;
  const normalizedOutroDuration = Number(estimatedOutroDuration);
  const outroDuration = Number.isFinite(normalizedOutroDuration) &&
    normalizedOutroDuration > 0
    ? normalizedOutroDuration
    : 0;
  const narrativeType = typeof preparedNarrativeArtifacts?.narrativeType === 'string'
    ? preparedNarrativeArtifacts.narrativeType.trim().toLowerCase()
    : '';

  if (narrativeType !== 'branched') {
    return sourceDuration + outroDuration;
  }

  const preflightBranchPlan = buildBranchedVideoSessionPlan(
    preparedNarrativeArtifacts.movieResourceList,
    {
      branchingMeta: preparedNarrativeArtifacts.branchingMeta,
      videoGenerationModel,
      framesPerSecond,
      requestedDuration: sourceDuration,
    },
  );
  return preflightBranchPlan.cumulativeLayerDuration + outroDuration;
}

export async function requestCreateVideo(userId, payload = {}, webhookUrl) {
  return requestCreateVideoInternal(userId, payload, webhookUrl);
}

export async function requestCreateVideoFromNarrativeArtifacts(
  userId,
  preparedPayload = {},
  webhookUrl,
) {
  const {
    sourceNarrativeRequestId,
    sourceNarrativeType = 'singular',
    narrativeType = sourceNarrativeType,
    themeJson,
    narrativeJson,
    movieResourceList,
    branchingMeta = null,
    ...videoPayload
  } = preparedPayload || {};

  return requestCreateVideoInternal(userId, videoPayload, webhookUrl, {
    preparedNarrativeArtifacts: {
      sourceNarrativeRequestId,
      narrativeType,
      themeJson,
      narrativeJson,
      movieResourceList,
      branchingMeta,
    },
  });
}

async function requestCreateVideoInternal(userId, payload = {}, webhookUrl, {
  preparedNarrativeArtifacts = null,
} = {}) {

  payload = applyDockerSubtitleAvailability(payload);

  await getDBConnectionString();

  const reusesNarrativeArtifacts = Boolean(preparedNarrativeArtifacts);

  const { language = 'auto', languageString: providedLanguageString } = payload || {};
  const isStepVideoGeneration = payload.isStepVideoGeneration === true;
  const stepVideoRoute = getFirstStringValue(payload.stepVideoRoute, payload.step_video_route)
    || (isStepVideoGeneration ? 'text_to_video' : null);
  const resolvedManualStepStages = Object.prototype.hasOwnProperty.call(payload, 'manual_step_stages')
    ? payload.manual_step_stages
    : payload.manualStepStages;
  let enableSubtitles = resolveSubtitleEnablement(payload);
  const languageInput = typeof language === 'string' ? language.trim() : '';
  let normalizedLanguage = 'auto';

  if (languageInput && languageInput.toLowerCase() !== 'auto') {
    const supportedLanguage = normalizeSupportedLanguage(languageInput);
    if (!supportedLanguage) {
      const supportedCodes = SUPPORTED_LANGUAGES.map((code) => code.toUpperCase()).join(', ');
      const error = new Error(`language must be one of: ${supportedCodes}, or 'auto'.`);
      error.status = 400;
      throw error;
    }
    normalizedLanguage = supportedLanguage;
  }

  const languageString = normalizedLanguage === 'auto'
    ? null
    : (providedLanguageString || getLanguageStringFromLanguageCode(normalizedLanguage));

  if (normalizedLanguage !== 'auto' && !languageString) {
    const error = new Error('Unsupported language code provided.');
    error.status = 400;
    throw error;
  }

  const subtitleLanguageOption = resolveSubtitleLanguageOption(payload, normalizedLanguage);
  const requestedFontKey = getFontKeyFromPayload(payload);
  const resolvedFontKey = resolveFontKeyForLanguage(
    subtitleLanguageOption.subtitleLanguage,
    requestedFontKey,
  );
  const optionalComponentWarnings = [];
  const optionalComponentContext = { routeType: 'text_to_video', userId };
  const generatedOutroOptions = safeNormalizeTextToVideoGeneratedOutroOptions(
    payload,
    optionalComponentContext,
    optionalComponentWarnings,
  );
  const outroOptions = safeNormalizeTextToVideoOutroOptions(
    payload,
    generatedOutroOptions,
    optionalComponentContext,
    optionalComponentWarnings,
  );
  const footerAnimationOptions = safeNormalizeTextToVideoFooterAnimationOptions(
    payload,
    optionalComponentContext,
    optionalComponentWarnings,
  );
  enableSubtitles = applyFooterSubtitlePolicy(enableSubtitles, footerAnimationOptions);
  const requestedBackingTrackModel = normalizeBackingTrackModelFromPayload(payload);
  const requestedTTSModel = normalizeTTSModelFromPayload(payload);
  assertDockerBackingTrackModelAvailable(requestedBackingTrackModel);
  assertDockerTTSProviderAvailable(requestedTTSModel);
  const requestedInferenceModel = normalizeInferenceModelFromPayload(payload);
  const textToVideoUserData = await User.findById(userId)
    .select('selectedInferenceModel agentVideoModelAuthorization agentImageModelAuthorization backingTrackModelAuthorization selectedInferenceModelAuthorization')
    .lean();
  const effectiveInferenceModel = requestedInferenceModel ||
    resolveEffectiveInferenceModel(payload, textToVideoUserData?.selectedInferenceModel);
  const customAdapters = resolveCustomAdaptersForTTSLanguagePolicy(
    omitCustomTextToSpeechAdapterForTTSModel(
      normalizeCustomModelAdaptersPayload(payload),
      requestedTTSModel,
    ),
    normalizedLanguage,
  );
  const customModelOverrides = applyCustomModelOverrides({
    payload,
    customAdapters,
    defaultImageModel: payload.image_model || payload.imageModel || 'GPTIMAGEONE',
    defaultVideoModel: payload.video_model || payload.videoModel || 'RUNWAYML',
  });
  const samsarExternalProviderStages = buildDockerSamsarExternalProviderStages({
    routeType: 'text_to_video',
    userData: textToVideoUserData,
    customAdapters,
    imageModel: customModelOverrides.payload.image_model || customModelOverrides.payload.imageModel || 'GPTIMAGEONE',
    videoModel: customModelOverrides.payload.video_model || customModelOverrides.payload.videoModel || 'RUNWAYML',
  });
  const requestedTextDuration = normalizeTextToVideoDurationSeconds(payload.duration);
  const estimatedOutroDuration = generatedOutroOptions.generate_outro_image === true ||
    typeof outroOptions.outro_image_url === 'string'
    ? OUTRO_LAYER_DURATION_SECONDS
    : 0;
  const selectedVideoModel =
    customModelOverrides.payload.video_model ||
    customModelOverrides.payload.videoModel ||
    'RUNWAYML';
  const estimatedTextDuration = resolveTextToVideoPreflightBillingDuration({
    requestedDuration: requestedTextDuration,
    estimatedOutroDuration,
    preparedNarrativeArtifacts,
    videoGenerationModel: selectedVideoModel,
    framesPerSecond: Number(
      customModelOverrides.payload.framesPerSecond ||
      customModelOverrides.payload.frames_per_second,
    ) || 24,
  });
  await assertSufficientExpressVideoCreditsForPreflight({
    userId,
    payload,
    routeType: 'text_to_video',
    durationSeconds: estimatedTextDuration,
    videoModel: selectedVideoModel,
    imageModel: customModelOverrides.payload.image_model || customModelOverrides.payload.imageModel || 'GPTIMAGEONE',
    backingTrackModel: requestedBackingTrackModel,
    expressGenerationType: 'TEXT_TO_VIDEO',
    expressCtaGeneration: generatedOutroOptions.express_cta_generation === true,
    customAdapters,
    customAdapterOperationUsage: customModelOverrides.operationUsage,
    samsarExternalProviderStages,
    expressGenerationNarrativeReused: reusesNarrativeArtifacts,
    excludedStageKeys: reusesNarrativeArtifacts
      ? [EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE]
      : [],
  });

  const sessionId = await getOrCreateSessionId(userId, payload);
  const apiKeyUsageContext = normalizeAPIKeyUsageContext(payload?.apiKeyUsage) ||
    getCurrentAPIKeyUsageContext();

  const normalizedPayload = {
    ...customModelOverrides.payload,
    ...generatedOutroOptions,
    ...outroOptions,
    ...footerAnimationOptions,
    sessionID: sessionId,
    language: normalizedLanguage,
    languageString,
    requestType: 'API',
    creditSource: reusesNarrativeArtifacts ? 'narrative_to_video' : 'text_to_video',
    enableSubtitles,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    subtitleTranslationRequired: enableSubtitles && subtitleLanguageOption.translationRequired,
    optionalComponentWarnings,
    isStepVideoGeneration,
    stepVideoRoute,
    ...(resolvedManualStepStages !== undefined
      ? {
        manual_step_stages: resolvedManualStepStages,
        manualStepStages: resolvedManualStepStages,
      }
      : {}),
    ...(requestedBackingTrackModel ? { musicProvider: requestedBackingTrackModel, backingTrackModel: requestedBackingTrackModel } : {}),
    ...(requestedTTSModel ? { tts_model: requestedTTSModel, ttsModel: requestedTTSModel } : {}),
    inference_model: effectiveInferenceModel,
    inferenceModel: effectiveInferenceModel,
    ...(customAdapters ? { custom_adapters: customAdapters } : {}),
    ...(customAdapters ? { customAdapterFallbacks: customModelOverrides.fallbackModels } : {}),
    ...(customAdapters ? { customAdapterOperationUsage: customModelOverrides.operationUsage } : {}),
    ...(samsarExternalProviderStages ? { samsarExternalProviderStages } : {}),
    ...(apiKeyUsageContext ? { apiKeyUsage: apiKeyUsageContext } : {}),
    ...(resolvedFontKey ? { subtitleFont: resolvedFontKey, speakerFont: resolvedFontKey } : {}),
  };

  await saveVideoSessionRequestMetadata(sessionId, {
    aspectRatio: normalizedPayload.aspect_ratio || normalizedPayload.aspectRatio || '16:9',
    language: normalizedLanguage,
    languageString,
    prompt: normalizedPayload.prompt,
    requestedDuration: normalizedPayload.duration,
    billingDurationSeconds: estimatedTextDuration,
    videoTone: normalizedPayload.tone || normalizedPayload.videoTone,
    enableSubtitles,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    subtitleTranslationRequired: enableSubtitles && subtitleLanguageOption.translationRequired,
    outroImageMetadata: buildOutroImageMetadata({
      generated: generatedOutroOptions.generate_outro_image === true,
      sourceUrl: outroOptions.outro_image_url || null,
      ctaUrl: generatedOutroOptions.cta_url || null,
      ctaTextTop: generatedOutroOptions.cta_text_top || null,
      ctaTextBottom: generatedOutroOptions.cta_text_bottom || null,
      ctaLogo: generatedOutroOptions.cta_logo || null,
      outroCtaImage: generatedOutroOptions.outro_cta_image || null,
    }),
    footerMetadata: footerAnimationOptions.footer_metadata,
    addFooterAnimation: footerAnimationOptions.add_footer_animation,
    expressGenerationType: 'TEXT_TO_VIDEO',
    isExpressGeneration: true,
    expressGenerativeVideoModel: customModelOverrides.payload.video_model || customModelOverrides.payload.videoModel || 'RUNWAYML',
    expressGenerationImageModel: customModelOverrides.payload.image_model || customModelOverrides.payload.imageModel || 'GPTIMAGEONE',
    backingTrackModel: requestedBackingTrackModel,
    ttsModel: requestedTTSModel,
    inferenceModel: effectiveInferenceModel,
    isStepVideoGeneration: isStepVideoGeneration === true,
    stepVideoRoute,
    manualStepStages: resolvedManualStepStages,
    customAdapters,
    customAdapterFallbacks: customModelOverrides.fallbackModels,
    customAdapterOperationUsage: customModelOverrides.operationUsage,
    samsarExternalProviderStages,
    apiKeyUsage: apiKeyUsageContext,
    builderRouteType: 'text_to_video',
    builderStatus: 'QUEUED',
    builderSessionSubType: reusesNarrativeArtifacts
      ? 'narrative_video_create'
      : 'video_create',
    optionalComponentWarnings,
    preparedNarrativeArtifacts,
  });

  await createUnifiedSessionAndUpdateWebhook(userId, normalizedPayload, webhookUrl, {
    preparedNarrativeArtifacts,
  });


  return {
    request_id: sessionId,
    session_id: sessionId,
  };
}


async function createUnifiedSessionAndUpdateWebhook(userId, payload, webhookUrl, {
  preparedNarrativeArtifacts = null,
} = {}) {
  await getDBConnectionString();

  const {
    tone = 'grounded',
    video_model = 'RUNWAYML',
    image_model = 'GPTIMAGEONE',
    prompt,
    duration = 10,
    aspect_ratio  = '16:9',
    language = 'auto',
    languageString,
    requestType,
    creditSource,
    subtitleFont,
    speakerFont,
    enableSubtitles,
    subtitleLanguage,
    subtitleLanguageString,
    subtitleLanguageExplicit = false,
    subtitleTranslationRequired = false,
    isExternalUserRequest = false,
    externalRequestUserId = null,
    externalRequestId = null,
    externalRequestIdentityKey = null,
    outro_image_url,
    add_outro_animation = false,
    add_outro_focus_area = false,
    outro_focust_area = null,
    generate_outro_image = false,
    cta_url,
    cta_text_top,
    cta_text_bottom,
    cta_logo,
    add_footer_animation = false,
    footer_metadata = [],
    musicProvider: requestedMusicProvider = null,
    backingTrackModel: requestedBackingTrackModel = null,
    tts_model = null,
    ttsModel = null,
    inference_model = null,
    inferenceModel = null,
    custom_adapters = null,
    customAdapterFallbacks = null,
    customAdapterOperationUsage = null,
    samsarExternalProviderStages = null,
    isStepVideoGeneration = false,
    stepVideoRoute = null,
    manual_step_stages = undefined,
    manualStepStages = undefined,
  } = payload;
  const resolvedManualStepStages = manual_step_stages !== undefined
    ? manual_step_stages
    : manualStepStages;

  const requestedDuration = Number(duration);
  const normalizedDuration = Number.isFinite(requestedDuration)
    ? Math.min(240, Math.max(10, requestedDuration))
    : 10;

  const userData = await User.findById(userId);

  const payloadBackingTrackModel =
    requestedMusicProvider ||
    requestedBackingTrackModel ||
    normalizeBackingTrackModelFromPayload(payload);
  const payloadTTSModel = normalizeTTSModelFromPayload({ tts_model, ttsModel });
  assertDockerBackingTrackModelAvailable(payloadBackingTrackModel);
  assertDockerTTSProviderAvailable(payloadTTSModel);
  const payloadInferenceModel = normalizeInferenceModelFromPayload({ inference_model, inferenceModel });
  const payloadSpeakerOptions = getSpeakerOptionsFromPayload(payload);
  const speakerOptionsSource = payloadSpeakerOptions || userData?.speakerOptions || null;
  const dockerSpeakerOptions = payloadTTSModel
    ? resolveDockerSpeakerOptionsForTTSProvider(payloadTTSModel, speakerOptionsSource)
    : null;
  const requestSpeakerOptions = filterDockerSpeakerOptions(
    dockerSpeakerOptions ||
    (
      payloadTTSModel
        ? buildSpeakerOptionsForTTSModel(payloadTTSModel, payloadSpeakerOptions, userData?.speakerOptions)
        : payloadSpeakerOptions
    )
  );
  const userMusicProvider = resolveDockerBackingTrackModel(
    normalizeBackingTrackProvider(payloadBackingTrackModel || userData.backingTrackModel || 'ELEVENLABS_MUSIC')
  );

  const MUSIC_PROVIDER = userMusicProvider;

  let finalPayload  = {
    videoTone: tone,
    videoGenerationModel: video_model,
    imageModel: image_model,
    prompt,
    duration: normalizedDuration,
    aspectRatio: aspect_ratio,
    sessionId: payload.sessionID,
    sessionID: payload.sessionID,
    musicProvider: MUSIC_PROVIDER,
    language,
    languageString,
    requestType,
    creditSource,
    enableSubtitles,
    hasSubtitles: enableSubtitles !== false,
    has_subtitles: enableSubtitles !== false,
    subtitleLanguage,
    subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageExplicit === true,
    subtitleTranslationRequired: enableSubtitles !== false && subtitleTranslationRequired === true,
    isExternalUserRequest,
    externalRequestUserId,
    externalRequestId,
    externalRequestIdentityKey,
    outroImageUrl: typeof outro_image_url === 'string' ? outro_image_url.trim() : null,
    addOutroAnimation: add_outro_animation === true,
    addOutroFocusArea: add_outro_focus_area === true,
    outroFocustArea: outro_focust_area,
    generateOutroImage: generate_outro_image === true,
    ctaUrl: cta_url,
    ctaTextTop: cta_text_top,
    ctaTextBottom: cta_text_bottom,
    ctaLogo: cta_logo,
    outroCtaImage: payload.outro_cta_image || payload.outroCtaImage || null,
    addFooterAnimation: add_footer_animation === true,
    footerMetadata: footer_metadata,
    ...(payloadTTSModel ? { ttsModel: payloadTTSModel, tts_model: payloadTTSModel } : {}),
    ...(payloadInferenceModel ? { inference_model: payloadInferenceModel, inferenceModel: payloadInferenceModel } : {}),
    ...(requestSpeakerOptions ? { speakerOptions: requestSpeakerOptions } : {}),
    isStepVideoGeneration: isStepVideoGeneration === true,
    stepVideoRoute,
    ...(resolvedManualStepStages !== undefined
      ? {
        manual_step_stages: resolvedManualStepStages,
        manualStepStages: resolvedManualStepStages,
      }
      : {}),
    ...(custom_adapters ? { custom_adapters } : {}),
    ...(customAdapterFallbacks ? { customAdapterFallbacks } : {}),
    ...(customAdapterOperationUsage ? { customAdapterOperationUsage } : {}),
    ...(samsarExternalProviderStages ? { samsarExternalProviderStages } : {}),
    ...(preparedNarrativeArtifacts ? { preparedNarrativeArtifacts } : {}),

  }
  if (subtitleFont) {
    finalPayload.subtitleFont = subtitleFont;
  }
  if (speakerFont) {
    finalPayload.speakerFont = speakerFont;
  }

  const builderSessionSubType = preparedNarrativeArtifacts
    ? 'narrative_video_create'
    : 'video_create';

  await upsertGlobalSessionBeforeScheduling({
    sessionId: payload.sessionID,
    sessionType: 'video',
    requestId: payload.sessionID,
    provider: video_model || 'UNKNOWN',
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: builderSessionSubType,
  }, { routeType: 'text_to_video', sessionSubType: builderSessionSubType });

  await scheduleTextToVideoBuilderSession(
    payload.sessionID,
    userId,
    finalPayload,
    webhookUrl,
    builderSessionSubType,
  );

  return {
    request_id: payload.sessionID,
  };

}


async function createVidGPTSessionAndUpdateWebhook(
  userId,
  payload,
  webhookUrl,
  sessionSubType = 'video_create',
) {

  const sessionId = payload.sessionID;
  if (webhookUrl) {
    await VideoSession.findByIdAndUpdate(sessionId, { externalWebhook: webhookUrl });
  }
  if (sessionSubType === 'narrative_video_create') {
    await createVidGPTSessionFromNarrativeArtifacts(userId, payload);
    return;
  }
  await createVidGPTSession(userId, payload);


}

async function createQuickSessionAndUpdateWebhook(userId, payload, webhookUrl) {

  const sessionId = payload.sessionID;

  const {
    prompt_list,
    speaker,
    provider,
    add_generative_video,
    image_model,
    video_model,
    aspect_ratio,
    model_sub_type,
  } = payload;

  let lineItems;
  if (Array.isArray(prompt_list)) {
    lineItems = prompt_list;
  } else {
   lineItems = prompt_list.split("\n");
  }

  let quickSessionPayload = {
    lineItems,
    sessionId,
    animation: 'system_preset',
    aspectRatio: aspect_ratio,
    imageModel: image_model,
    generativeVideoRequired: add_generative_video,
    videoGenerationModel: video_model,
    
  }

  if (model_sub_type) {
    quickSessionPayload.modelSubType = model_sub_type;
  }

  await createQuickSession(userId, quickSessionPayload);
  await setSessionQuickGenerationPending( userId, quickSessionPayload);
  await VideoSession.findByIdAndUpdate(sessionId, { externalWebhook: webhookUrl });

}

export async function requestCreateGroundedVideo(userId, payload, webhookUrl) {

  await getDBConnectionString();

  const sessionId = await createNewBlankQuickSession(userId);

  payload.sessionID = sessionId;

  await VideoSession.findByIdAndUpdate(sessionId, { externalWebhook: webhookUrl });

  // Here you would implement the logic to create a grounded video session
  // For now, we just return the session ID
  await upsertGlobalSessionMapping({
    sessionId,
    sessionType: 'video',
    requestId: sessionId,
    provider: payload.video_model || 'UNKNOWN',
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'grounded_video',
  });

  return {
    request_id: sessionId,
    session_id: sessionId,
  };
}


export async function requestCreateVideoFromImageListAndMetadata(userId, payload = {}, webhookUrl) {
  if (!userId) {
    throw new Error('userId is required.');
  }

  payload = applyDockerSubtitleAvailability(payload);

  logImageListToVideoPayload(payload);

  const {
    image_urls,
    metadata = {},
    prompt = '',
    language = 'auto',
    video_model,
    aspect_ratio,
  } = payload;
  const isStepVideoGeneration = payload.isStepVideoGeneration === true;
  const stepVideoRoute = getFirstStringValue(payload.stepVideoRoute, payload.step_video_route)
    || (isStepVideoGeneration ? 'image_to_video' : null);
  const manualStepStages = Object.prototype.hasOwnProperty.call(payload, 'manual_step_stages')
    ? payload.manual_step_stages
    : payload.manualStepStages;
  let enableSubtitles = resolveSubtitleEnablement(payload);
  const normalizedAspectRatio = resolveImageListToVideoAspectRatio(aspect_ratio);

  if (!Array.isArray(image_urls) || image_urls.length === 0) {
    throw new Error('image_urls must be a non-empty array.');
  }

  const { imageUrls: normalizedImageUrls, imageListPayload } = normalizeImageListInput(image_urls);

  if (normalizedImageUrls.length === 0) {
    throw new Error('image_urls must include at least one valid URL.');
  }
  assertImageListToVideoUrlsAreFetchable(normalizedImageUrls);

  const normalizedMetadata = isPlainObject(metadata) ? metadata : {};
  const rawCustomAdapters = normalizeCustomAdaptersPayload(payload);
  const requestedBackingTrackModel = normalizeBackingTrackModelFromPayload(payload);
  const requestedTTSModel = normalizeTTSModelFromPayload(payload);
  assertDockerBackingTrackModelAvailable(requestedBackingTrackModel);
  assertDockerTTSProviderAvailable(requestedTTSModel);
  const normalizedVideoModel = normalizeImageListToVideoModel(video_model, {
    allowCustomImageToVideo: Boolean(rawCustomAdapters?.image_to_video),
  });

  if (!normalizedVideoModel) {
    const error = new Error(IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ERROR_MESSAGE);
    error.status = 400;
    throw error;
  }
  const languageInput = typeof language === 'string' ? language.trim() : '';
  let normalizedLanguage = 'auto';

  if (languageInput && languageInput.toLowerCase() !== 'auto') {
    const supportedLanguage = normalizeSupportedLanguage(languageInput);
    if (!supportedLanguage) {
      const supportedCodes = SUPPORTED_LANGUAGES.map((code) => code.toUpperCase()).join(', ');
      const error = new Error(`language must be one of: ${supportedCodes}, or 'auto'.`);
      error.status = 400;
      throw error;
    }
    normalizedLanguage = supportedLanguage;
  }

  const languageString = normalizedLanguage === 'auto'
    ? null
    : getLanguageStringFromLanguageCode(normalizedLanguage);

  if (normalizedLanguage !== 'auto' && !languageString) {
    const error = new Error('Unsupported language code provided.');
    error.status = 400;
    throw error;
  }

  const subtitleLanguageOption = resolveSubtitleLanguageOption(payload, normalizedLanguage);
  const requestedFontKey = getFontKeyFromPayload(payload);
  const resolvedFontKey = resolveFontKeyForLanguage(
    subtitleLanguageOption.subtitleLanguage,
    requestedFontKey,
  );
  const expressCtaGenerationOptions = normalizeImageListExpressCtaGenerationOptions(payload);
  const generatedOutroOptions = normalizeGeneratedOutroImageOptions(payload);
  const footerAnimationOptions = normalizeImageListFooterAnimationOptions(
    payload,
    normalizedImageUrls.length,
  );
  const narratorAvatarOptions = normalizeImageListNarratorAvatarOptions(payload);
  enableSubtitles = applyFooterSubtitlePolicy(enableSubtitles, footerAnimationOptions);
  const customAdapters = resolveCustomAdaptersForTTSLanguagePolicy(
    omitCustomTextToSpeechAdapterForTTSModel(rawCustomAdapters, requestedTTSModel),
    normalizedLanguage,
  );
  const customModelOverrides = applyCustomModelOverrides({
    payload,
    customAdapters,
    defaultImageModel: payload.image_model || payload.imageModel || IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL,
    defaultVideoModel: normalizedVideoModel,
  });
  const customModelPayload = { ...customModelOverrides.payload };
  delete customModelPayload.duration;
  delete customModelPayload.totalDuration;
  const imageListUserData = await User.findById(userId)
    .select('videoFramesPerSecond speakerOptions selectedInferenceModel agentVideoModelAuthorization agentImageModelAuthorization backingTrackModelAuthorization selectedInferenceModelAuthorization')
    .lean();
  const imageListFramesPerSecond = resolveFramesPerSecond(imageListUserData?.videoFramesPerSecond);
  const effectiveInferenceModel = resolveEffectiveInferenceModel(payload, imageListUserData?.selectedInferenceModel);
  const samsarExternalProviderStages = buildDockerSamsarExternalProviderStages({
    routeType: 'image_list_to_video',
    userData: imageListUserData,
    customAdapters,
    imageModel: customModelOverrides.payload.image_model || payload.image_model || payload.imageModel || IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL,
    videoModel: customModelOverrides.payload.video_model || customModelOverrides.payload.videoModel || normalizedVideoModel,
  });
  const payloadSpeakerOptions = getSpeakerOptionsFromPayload(payload);
  const imageListSpeakerOptionsSource = payloadSpeakerOptions || imageListUserData?.speakerOptions || null;
  const dockerRequestSpeakerOptions = requestedTTSModel
    ? resolveDockerSpeakerOptionsForTTSProvider(requestedTTSModel, imageListSpeakerOptionsSource)
    : null;
  const requestSpeakerOptions = filterDockerSpeakerOptions(
    dockerRequestSpeakerOptions ||
    (
      requestedTTSModel
        ? buildSpeakerOptionsForTTSModel(requestedTTSModel, payloadSpeakerOptions, imageListUserData?.speakerOptions)
        : payloadSpeakerOptions
    )
  );
  const estimatedImageListDuration =
    getMaxDurationForModelForScenes(
      customModelOverrides.payload.video_model || customModelOverrides.payload.videoModel || normalizedVideoModel,
      normalizedImageUrls.length,
      imageListFramesPerSecond,
    ) +
    (generatedOutroOptions.generate_outro_image === true ? OUTRO_LAYER_DURATION_SECONDS : 0);
  await assertSufficientExpressVideoCreditsForPreflight({
    userId,
    payload,
    routeType: 'image_list_to_video',
    durationSeconds: estimatedImageListDuration,
    videoModel: customModelOverrides.payload.video_model || customModelOverrides.payload.videoModel || normalizedVideoModel,
    imageModel: customModelOverrides.payload.image_model || payload.image_model || payload.imageModel || IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL,
    backingTrackModel: requestedBackingTrackModel,
    expressGenerationType: 'IMAGE_LIST_TO_VIDEO',
    expressCtaGeneration: expressCtaGenerationOptions.express_cta_generation === true,
    addNarratorAvatar: narratorAvatarOptions.add_narrator_avatar === true,
    customAdapters,
    customAdapterOperationUsage: customModelOverrides.operationUsage,
    samsarExternalProviderStages,
  });

  const sessionId = await getOrCreateSessionId(userId, payload);
  let preparedImageUrls = normalizedImageUrls;
  let preparedImageListPayload = imageListPayload;
  try {
    const preparedInputs = await prepareImageListToVideoInputImages({
      imageUrls: normalizedImageUrls,
      imageListPayload,
      userId,
      sessionId,
      aspectRatio: normalizedAspectRatio,
    });
    preparedImageUrls = preparedInputs.imageUrls;
    preparedImageListPayload = preparedInputs.imageListPayload;
  } catch (error) {
    await markImageListToVideoBuilderSessionFailed(sessionId, error);
    throw error;
  }

  const requestedAddOutroAnimation = getOptionalBooleanPayloadValue(
    payload,
    ['add_outro_animation', 'addOutroAnimation'],
    'add_outro_animation',
  );
  const addOutroAnimation = generatedOutroOptions.generate_outro_image === true
    ? requestedAddOutroAnimation !== false
    : requestedAddOutroAnimation === true;
  const apiKeyUsageContext = getCurrentAPIKeyUsageContext();

  const normalizedPayload = {
    ...customModelPayload,
    ...generatedOutroOptions,
    ...footerAnimationOptions,
    ...narratorAvatarOptions,
    ...expressCtaGenerationOptions,
    add_outro_animation: addOutroAnimation,
    image_urls: preparedImageUrls,
    imageListPayload: preparedImageListPayload,
    metadata: normalizedMetadata,
    language: normalizedLanguage,
    languageString,
    aspect_ratio: normalizedAspectRatio,
    video_model: customModelOverrides.payload.video_model || normalizedVideoModel,
    image_model: customModelOverrides.payload.image_model || payload.image_model || payload.imageModel || IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL,
    requestType: 'API',
    enableSubtitles,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    subtitleTranslationRequired: enableSubtitles && subtitleLanguageOption.translationRequired,
    ...(requestedBackingTrackModel ? { musicProvider: requestedBackingTrackModel, backingTrackModel: requestedBackingTrackModel } : {}),
    ...(requestedTTSModel ? { tts_model: requestedTTSModel, ttsModel: requestedTTSModel } : {}),
    inference_model: effectiveInferenceModel,
    inferenceModel: effectiveInferenceModel,
    ...(requestSpeakerOptions ? { speakerOptions: requestSpeakerOptions } : {}),
    isStepVideoGeneration,
    stepVideoRoute,
    ...(manualStepStages !== undefined ? { manual_step_stages: manualStepStages } : {}),
    ...(customAdapters ? { custom_adapters: customAdapters } : {}),
    ...(customAdapters ? { customAdapterFallbacks: customModelOverrides.fallbackModels } : {}),
    ...(customAdapters ? { customAdapterOperationUsage: customModelOverrides.operationUsage } : {}),
    ...(samsarExternalProviderStages ? { samsarExternalProviderStages } : {}),
    ...(apiKeyUsageContext ? { apiKeyUsage: apiKeyUsageContext } : {}),
    ...(resolvedFontKey ? { subtitleFont: resolvedFontKey, speakerFont: resolvedFontKey } : {}),
  };

  await saveVideoSessionRequestMetadata(sessionId, {
    aspectRatio: normalizedAspectRatio,
    language: normalizedLanguage,
    languageString,
    prompt: normalizedPayload.prompt,
    requestedDuration: normalizedPayload.duration,
    videoTone: normalizedPayload.videoTone,
    enableSubtitles,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    subtitleTranslationRequired: enableSubtitles && subtitleLanguageOption.translationRequired,
    outroImageMetadata: buildOutroImageMetadata({
      generated: generatedOutroOptions.generate_outro_image === true,
      sourceUrl: normalizedPayload.outro_image_url || normalizedPayload.outroImageUrl || null,
      ctaUrl: generatedOutroOptions.cta_url || null,
      ctaTextTop: generatedOutroOptions.cta_text_top || null,
      ctaTextBottom: generatedOutroOptions.cta_text_bottom || null,
      ctaLogo: generatedOutroOptions.cta_logo || null,
      outroCtaImage: generatedOutroOptions.outro_cta_image || null,
    }),
    footerMetadata: footerAnimationOptions.footer_metadata,
    addFooterAnimation: footerAnimationOptions.add_footer_animation,
    limitSingleNarrator: narratorAvatarOptions.limit_single_narrator,
    addNarratorAvatar: narratorAvatarOptions.add_narrator_avatar,
    expressCtaGeneration: expressCtaGenerationOptions.express_cta_generation === true,
    expressGenerationType: 'IMAGE_LIST_TO_VIDEO',
    isExpressGeneration: true,
    expressGenerativeVideoModel: normalizedPayload.video_model,
    expressGenerationImageModel: normalizedPayload.image_model,
    backingTrackModel: requestedBackingTrackModel,
    ttsModel: requestedTTSModel,
    inferenceModel: effectiveInferenceModel,
    isStepVideoGeneration,
    stepVideoRoute,
    manualStepStages,
    customAdapters,
    customAdapterFallbacks: customModelOverrides.fallbackModels,
    customAdapterOperationUsage: customModelOverrides.operationUsage,
    samsarExternalProviderStages,
    apiKeyUsage: apiKeyUsageContext,
    builderRouteType: 'image_list_to_video',
    builderStatus: 'QUEUED',
    builderSessionSubType: 'video_create',
  });

  scheduleImageListToVideoBuilderSession(sessionId, userId, normalizedPayload, webhookUrl);

  return {
    request_id: sessionId,
    session_id: sessionId,
  };
  
}


export async function processImageListToVideoBuilderSession(sessionId, userId, payload = {}, webhookUrl) {
  const {
    image_urls,
    imageListPayload: providedImageListPayload,
    metadata = {},
    prompt = '',
    language = 'auto',
    languageString: providedLanguageString,
    video_model,
    add_outro_animation,
    generate_outro_image,
    cta_url,
    cta_text_top,
    cta_text_bottom,
    cta_logo,
    outro_cta_image,
    outroCtaImage,
    express_cta_generation,
    expressCtaGeneration,
    requestType,
    subtitleFont,
    speakerFont,
    enableSubtitles,
    aspect_ratio,
    musicProvider = null,
    backingTrackModel = null,
    tts_model = null,
    ttsModel = null,
    inference_model = null,
    inferenceModel = null,
    speakerOptions = null,
    custom_adapters = null,
    customAdapterFallbacks = null,
    customAdapterOperationUsage = null,
    samsarExternalProviderStages = null,
    isStepVideoGeneration = false,
    stepVideoRoute = null,
    manual_step_stages = undefined,
    manualStepStages = undefined,
  } = payload;
  const normalizedAspectRatio = resolveImageListToVideoAspectRatio(aspect_ratio);
  const resolvedOutroCtaImage = outro_cta_image || outroCtaImage || null;
  const normalizedVideoModel = normalizeImageListToVideoModel(video_model, {
    allowCustomImageToVideo: Boolean(custom_adapters?.image_to_video),
  });
  const resolvedManualStepStages = manual_step_stages !== undefined
    ? manual_step_stages
    : manualStepStages;

  if (!normalizedVideoModel) {
    const error = new Error(IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_ERROR_MESSAGE);
    error.status = 400;
    throw error;
  }

  if (!Array.isArray(image_urls) || image_urls.length === 0) {
    throw new Error('image_urls must be a non-empty array.');
  }

  const listSource = Array.isArray(providedImageListPayload) && providedImageListPayload.length
    ? providedImageListPayload
    : image_urls;
  const { imageUrls: normalizedImageUrls, imageListPayload } = normalizeImageListInput(listSource);

  if (normalizedImageUrls.length === 0) {
    throw new Error('image_urls must include at least one valid URL.');
  }
  assertImageListToVideoUrlsAreFetchable(normalizedImageUrls);

  const footerAnimationOptions = normalizeImageListFooterAnimationOptions(
    payload,
    normalizedImageUrls.length,
  );
  const narratorAvatarOptions = normalizeImageListNarratorAvatarOptions(payload);

  const {
    imageUrls: preparedImageUrls,
    imageListPayload: preparedImageListPayload,
  } = await prepareImageListToVideoInputImages({
    imageUrls: normalizedImageUrls,
    imageListPayload,
    userId,
    sessionId,
    aspectRatio: normalizedAspectRatio,
  });

  const shouldGenerateOutroImage = generate_outro_image === true;
  const shouldGenerateExpressCta = express_cta_generation === true || expressCtaGeneration === true;
  const addOutroAnimation = shouldGenerateOutroImage
    ? add_outro_animation !== false
    : add_outro_animation === true;

  const normalizedMetadata = isPlainObject(metadata) ? metadata : {};
  const languageInput = typeof language === 'string' ? language.trim() : '';
  let normalizedLanguage = 'auto';

  if (languageInput && languageInput.toLowerCase() !== 'auto') {
    const supportedLanguage = normalizeSupportedLanguage(languageInput);
    if (!supportedLanguage) {
      const supportedCodes = SUPPORTED_LANGUAGES.map((code) => code.toUpperCase()).join(', ');
      const error = new Error(`language must be one of: ${supportedCodes}, or 'auto'.`);
      error.status = 400;
      throw error;
    }
    normalizedLanguage = supportedLanguage;
  }

  const languageString = normalizedLanguage === 'auto'
    ? null
    : (providedLanguageString || getLanguageStringFromLanguageCode(normalizedLanguage));

  if (normalizedLanguage !== 'auto' && !languageString) {
    const error = new Error('Unsupported language code provided.');
    error.status = 400;
    throw error;
  }

  const subtitleLanguageOption = resolveSubtitleLanguageOption(
    payload,
    normalizedLanguage,
    { allowPropagatedSameAsAudio: true },
  );
  const builderUserData = await User.findById(userId).select('selectedInferenceModel').lean();
  const effectiveInferenceModel = resolveEffectiveInferenceModel(
    { inference_model, inferenceModel },
    builderUserData?.selectedInferenceModel,
  );
  const rawBuilderBackingTrackModel = musicProvider || backingTrackModel || null;
  assertDockerBackingTrackModelAvailable(rawBuilderBackingTrackModel);
  assertDockerTTSProviderAvailable(tts_model || ttsModel || null);
  const builderMusicProvider = rawBuilderBackingTrackModel
    ? resolveDockerBackingTrackModel(normalizeBackingTrackProvider(rawBuilderBackingTrackModel))
    : rawBuilderBackingTrackModel;
  const builderSpeakerOptions = filterDockerSpeakerOptions(speakerOptions);

  const imageDescriptions = await Promise.all(
    preparedImageUrls.map(async (imageUrl) => {
      try {
        return await getDescriptionForImageToCreateTranscript(imageUrl, effectiveInferenceModel);
      } catch (error) {
        console.error(`Failed to describe image "${imageUrl}"`, error);
        return null;
      }
    })
  );


  const imageDescriptionList = imageDescriptions
    .map((description, index) => {
      const generatedDescription = typeof description === 'string' ? description.trim() : '';
      const userDescription = getFirstStringValue(
        preparedImageListPayload?.[index]?.image_text,
        preparedImageListPayload?.[index]?.description,
      );
      if (generatedDescription && userDescription) {
        return `${generatedDescription}\nUser image description: ${userDescription}`;
      }
      return generatedDescription || userDescription || null;
    })
    .filter(Boolean);

  const transcriptBuilderPayload = {
    prompt: typeof prompt === 'string' ? prompt.trim() : prompt,
    imageDescriptionList,
    metadata: normalizedMetadata,
    imageList: preparedImageUrls,
    imageListPayload: preparedImageListPayload,
    language: normalizedLanguage,
    languageString,
  };

  const sessionRequestPayload = {
    sessionID: sessionId,
    transcriptBuilderPayload,
    videoGenerationModel: normalizedVideoModel,
    video_model: normalizedVideoModel,
    imageModel: payload.image_model || payload.imageModel || IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL,
    aspectRatio: normalizedAspectRatio,
    videoTone: 'grounded',
    language: normalizedLanguage,
    languageString,
    outroImageUrl: null,
    addOutroAnimation,
    addFooterAnimation: shouldGenerateExpressCta ? true : footerAnimationOptions.add_footer_animation,
    footerMetadata: footerAnimationOptions.footer_metadata,
    expressCtaGeneration: shouldGenerateExpressCta,
    limitSingleNarrator: narratorAvatarOptions.limit_single_narrator,
    limit_single_narrator: narratorAvatarOptions.limit_single_narrator,
    addNarratorAvatar: narratorAvatarOptions.add_narrator_avatar,
    add_narrator_avatar: narratorAvatarOptions.add_narrator_avatar,
    ...(shouldGenerateOutroImage
      ? {
        generatedOutroImage: true,
        outroCtaUrl: cta_url,
        outroCtaTextTop: typeof cta_text_top === 'string' ? cta_text_top.trim() : null,
        outroCtaTextBottom: typeof cta_text_bottom === 'string' ? cta_text_bottom.trim() : null,
        outroCtaLogo: typeof cta_logo === 'string' ? cta_logo.trim() : null,
        outroCtaImage: resolvedOutroCtaImage,
      }
      : {}),
    requestType,
    enableSubtitles,
    hasSubtitles: enableSubtitles !== false,
    has_subtitles: enableSubtitles !== false,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    subtitleTranslationRequired: enableSubtitles !== false && subtitleLanguageOption.translationRequired,
    musicProvider: builderMusicProvider,
    backingTrackModel: builderMusicProvider,
    ...(tts_model || ttsModel ? { tts_model: tts_model || ttsModel, ttsModel: tts_model || ttsModel } : {}),
    inference_model: effectiveInferenceModel,
    inferenceModel: effectiveInferenceModel,
    ...(builderSpeakerOptions ? { speakerOptions: builderSpeakerOptions } : {}),
    isStepVideoGeneration: isStepVideoGeneration === true,
    stepVideoRoute,
    ...(resolvedManualStepStages !== undefined ? { manualStepStages: resolvedManualStepStages } : {}),
    ...(custom_adapters ? { custom_adapters } : {}),
    ...(customAdapterFallbacks ? { customAdapterFallbacks } : {}),
    ...(customAdapterOperationUsage ? { customAdapterOperationUsage } : {}),
    ...(samsarExternalProviderStages ? { samsarExternalProviderStages } : {}),
  };
  if (subtitleFont) {
    sessionRequestPayload.subtitleFont = subtitleFont;
  }
  if (speakerFont) {
    sessionRequestPayload.speakerFont = speakerFont;
  }
  

  const { sessionId: generatedSessionId, creditsCharged, remainingCredits } =
    await createNewImageListToVideoSession(userId, sessionRequestPayload);

  return {
    ...sessionRequestPayload,
    request_id: generatedSessionId,
    session_id: generatedSessionId,
    creditsCharged,
    remainingCredits,
  };

}

function scheduleImageListToVideoBuilderSession(sessionId, userId, payload, webhookUrl) {
  // Defer heavy work so API can return session_id before background processing starts.
  const start = () => {
    void (async () => {
      await markExpressGenerationBuilderState(sessionId, {
        routeType: 'image_list_to_video',
        status: 'RUNNING',
        sessionSubType: 'video_create',
      });
      await processImageListToVideoBuilderSession(sessionId, userId, payload, webhookUrl);
      await markExpressGenerationBuilderState(sessionId, {
        routeType: 'image_list_to_video',
        status: 'COMPLETED',
        sessionSubType: 'video_create',
      });
    })().catch(async (error) => {
      console.error(`processImageListToVideoBuilderSession failed for session ${sessionId}`, error);
      await markExpressGenerationBuilderState(sessionId, {
        routeType: 'image_list_to_video',
        status: 'FAILED',
        sessionSubType: 'video_create',
        error,
      });
      await markImageListToVideoBuilderSessionFailed(sessionId, error);
      await markGlobalBuilderSessionFailed(sessionId, extractImageListToVideoErrorMessage(error));
    });
  };

  if (typeof setImmediate === 'function') {
    setImmediate(start);
    return;
  }

  setTimeout(start, 0);
}

function deferTextToVideoBuilderRun(sessionId) {
  const start = () => {
    void runPersistedTextToVideoBuilderSession(sessionId);
  };
  if (typeof setImmediate === 'function') {
    setImmediate(start);
  } else {
    setTimeout(start, 0);
  }
}

async function scheduleTextToVideoBuilderSession(
  sessionId,
  userId,
  payload,
  webhookUrl,
  sessionSubType = 'video_create',
) {
  await getDBConnectionString();
  const normalizedSessionId = sessionId?.toString?.() || String(sessionId);
  await ExpressGenerationBuilderRequest.findOneAndUpdate(
    { sessionId: normalizedSessionId },
    {
      $set: {
        userId: userId?.toString?.() || String(userId),
        routeType: 'text_to_video',
        sessionSubType,
        status: 'QUEUED',
        payload,
        webhookUrl: webhookUrl || null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        completedAt: null,
        failedAt: null,
        error: null,
      },
      $setOnInsert: { attempts: 0 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  deferTextToVideoBuilderRun(normalizedSessionId);
}

async function runPersistedTextToVideoBuilderSession(sessionId) {
  await getDBConnectionString();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + TEXT_TO_VIDEO_BUILDER_LEASE_MS);
  const job = await ExpressGenerationBuilderRequest.findOneAndUpdate(
    {
      sessionId,
      $or: [
        { status: 'QUEUED' },
        {
          status: 'RUNNING',
          $or: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        status: 'RUNNING',
        leaseOwner: TEXT_TO_VIDEO_BUILDER_WORKER_ID,
        leaseExpiresAt,
        lastHeartbeatAt: now,
        startedAt: now,
        error: null,
      },
      $inc: { attempts: 1 },
    },
    { new: true },
  ).lean();
  if (!job) return false;

  const heartbeat = setInterval(() => {
    const heartbeatAt = new Date();
    void ExpressGenerationBuilderRequest.updateOne(
      {
        _id: job._id,
        status: 'RUNNING',
        leaseOwner: TEXT_TO_VIDEO_BUILDER_WORKER_ID,
      },
      {
        $set: {
          lastHeartbeatAt: heartbeatAt,
          leaseExpiresAt: new Date(heartbeatAt.getTime() + TEXT_TO_VIDEO_BUILDER_LEASE_MS),
        },
      },
    ).catch((error) => {
      console.error('[text_to_video_builder] heartbeat failed', {
        sessionId,
        message: error?.message || String(error),
      });
    });
  }, Math.floor(TEXT_TO_VIDEO_BUILDER_LEASE_MS / 3));
  heartbeat.unref?.();

  try {
    await markExpressGenerationBuilderState(sessionId, {
      routeType: 'text_to_video',
      status: 'RUNNING',
      sessionSubType: job.sessionSubType,
    });
    await createVidGPTSessionAndUpdateWebhook(
      job.userId,
      job.payload,
      job.webhookUrl,
      job.sessionSubType,
    );
    await markExpressGenerationBuilderState(sessionId, {
      routeType: 'text_to_video',
      status: 'COMPLETED',
      sessionSubType: job.sessionSubType,
    });
    await ExpressGenerationBuilderRequest.updateOne(
      { _id: job._id, leaseOwner: TEXT_TO_VIDEO_BUILDER_WORKER_ID },
      {
        $set: {
          status: 'COMPLETED',
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          error: null,
        },
        $unset: { payload: '' },
      },
    );
    return true;
  } catch (error) {
    console.error(`createVidGPTSessionAndUpdateWebhook failed for session ${sessionId}`, error);
    await ExpressGenerationBuilderRequest.updateOne(
      { _id: job._id, leaseOwner: TEXT_TO_VIDEO_BUILDER_WORKER_ID },
      {
        $set: {
          status: 'FAILED',
          failedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          error: summarizeBuilderError(error),
        },
      },
    );
    await markExpressGenerationBuilderState(sessionId, {
      routeType: 'text_to_video',
      status: 'FAILED',
      sessionSubType: job.sessionSubType,
      error,
    });
    await markTextToVideoBuilderSessionFailed(sessionId, error);
    await markGlobalBuilderSessionFailed(sessionId, extractTextToVideoErrorMessage(error));
    return false;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function recoverPersistedTextToVideoBuilderSessions({ limit = 20 } = {}) {
  await getDBConnectionString();
  const now = new Date();
  const jobs = await ExpressGenerationBuilderRequest.find({
    $or: [
      { status: 'QUEUED' },
      {
        status: 'RUNNING',
        $or: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $lte: now } },
        ],
      },
    ],
  }).select('sessionId').sort({ createdAt: 1 }).limit(limit).lean();

  for (const job of jobs) {
    deferTextToVideoBuilderRun(job.sessionId);
  }
  return jobs.length;
}

export function startPersistedTextToVideoBuilderRecovery() {
  if (textToVideoBuilderRecoveryInterval) {
    return () => {};
  }
  const recover = () => {
    void recoverPersistedTextToVideoBuilderSessions().catch((error) => {
      console.error('[text_to_video_builder] recovery scan failed', {
        message: error?.message || String(error),
      });
    });
  };
  recover();
  textToVideoBuilderRecoveryInterval = setInterval(
    recover,
    TEXT_TO_VIDEO_BUILDER_RECOVERY_INTERVAL_MS,
  );
  textToVideoBuilderRecoveryInterval.unref?.();
  return () => {
    clearInterval(textToVideoBuilderRecoveryInterval);
    textToVideoBuilderRecoveryInterval = null;
  };
}

function extractImageListToVideoErrorMessage(error) {
  const responseMessage = typeof error?.response?.data?.message === 'string'
    ? error.response.data.message.trim()
    : '';
  if (responseMessage) {
    return responseMessage;
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return 'Image list to video generation failed.';
}

function extractTextToVideoErrorMessage(error) {
  const responseMessage = typeof error?.response?.data?.message === 'string'
    ? error.response.data.message.trim()
    : '';
  if (responseMessage) {
    return responseMessage;
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return 'Text to video prompt generation failed.';
}

async function upsertGlobalSessionBeforeScheduling(mapping, {
  routeType,
  sessionSubType,
} = {}) {
  try {
    return await upsertGlobalSessionMapping(mapping);
  } catch (error) {
    const sessionId = mapping?.sessionId;
    await markExpressGenerationBuilderState(sessionId, {
      routeType,
      status: 'FAILED',
      sessionSubType,
      error,
    });
    if (routeType === 'image_list_to_video') {
      await markImageListToVideoBuilderSessionFailed(sessionId, error);
    } else {
      await markTextToVideoBuilderSessionFailed(sessionId, error);
    }
    throw error;
  }
}

async function markGlobalBuilderSessionFailed(sessionId, errorMessage) {
  if (!sessionId) {
    return;
  }

  try {
    await upsertGlobalSessionMapping({
      sessionId,
      sessionType: 'video',
      status: 'FAILED',
      errorMessage: errorMessage || 'Video generation failed.',
    });
  } catch (error) {
    console.error(`Failed to mark GlobalSession ${sessionId} as FAILED`, error);
  }
}

function summarizeBuilderError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error?.name || null,
    message: error?.message || String(error),
    status: error?.status || error?.response?.status || null,
    code: error?.code || error?.error?.code || null,
    type: error?.type || error?.error?.type || null,
  };
}

async function markExpressGenerationBuilderState(sessionId, {
  routeType,
  status,
  sessionSubType = 'video_create',
  error = null,
} = {}) {
  if (!sessionId || !status) {
    return;
  }

  try {
    await getDBConnectionString();
    const now = new Date();
    const setPayload = {
      'expressGenerationBuilder.routeType': routeType || null,
      'expressGenerationBuilder.sessionSubType': sessionSubType,
      'expressGenerationBuilder.status': status,
      'expressGenerationBuilder.updatedAt': now,
    };

    if (status === 'QUEUED') {
      setPayload['expressGenerationBuilder.queuedAt'] = now;
    }
    if (status === 'RUNNING') {
      setPayload['expressGenerationBuilder.startedAt'] = now;
    }
    if (status === 'COMPLETED') {
      setPayload['expressGenerationBuilder.completedAt'] = now;
      setPayload['expressGenerationBuilder.error'] = null;
    }
    if (status === 'FAILED') {
      setPayload['expressGenerationBuilder.failedAt'] = now;
      setPayload['expressGenerationBuilder.error'] = summarizeBuilderError(error);
    }

    await VideoSession.findByIdAndUpdate(sessionId, { $set: setPayload });
  } catch (markError) {
    console.error(`Failed to mark express generation builder ${sessionId} as ${status}`, markError);
  }
}

async function markTextToVideoBuilderSessionFailed(sessionId, error) {
  if (!sessionId) {
    return;
  }

  try {
    await getDBConnectionString();

    const session = await VideoSession.findById(sessionId)
      .select('expressGenerationStatus expressGenerationFailed expressGenerationError expressStepGeneration')
      .lean();

    if (!session) {
      return;
    }

    const message = session.expressGenerationError || extractTextToVideoErrorMessage(error);
    const nextStatus = { ...(session.expressGenerationStatus || {}) };
    const promptStage = typeof nextStatus.prompt_generation === 'string'
      ? nextStatus.prompt_generation.trim().toUpperCase()
      : '';
    const videoStage = typeof nextStatus.video_generation === 'string'
      ? nextStatus.video_generation.trim().toUpperCase()
      : '';

    nextStatus.status = 'FAILED';
    if (!promptStage || promptStage === 'PENDING' || promptStage === 'INIT' || promptStage === 'IN_PROGRESS') {
      nextStatus.prompt_generation = 'FAILED';
    }
    if (!videoStage || videoStage === 'PENDING' || videoStage === 'INIT' || videoStage === 'IN_PROGRESS') {
      nextStatus.video_generation = 'FAILED';
    }

    const now = new Date();
    const setPayload = {
      expressGenerationStatus: nextStatus,
      expressGenerationPending: false,
      videoGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: message,
    };

    if (session.expressStepGeneration?.enabled) {
      setPayload['expressStepGeneration.status'] = 'FAILED';
      setPayload['expressStepGeneration.currentStep'] = 'prompt_generation';
      setPayload['expressStepGeneration.current_step'] = 'prompt_generation';
      setPayload['expressStepGeneration.currentStepLabel'] = 'Narrative';
      setPayload['expressStepGeneration.current_step_label'] = 'Narrative';
      setPayload['expressStepGeneration.waitingForProcessNext'] = false;
      setPayload['expressStepGeneration.waiting_for_process_next'] = false;
      setPayload['expressStepGeneration.requiresUserAction'] = false;
      setPayload['expressStepGeneration.requires_user_action'] = false;
      setPayload['expressStepGeneration.canProcessNext'] = false;
      setPayload['expressStepGeneration.can_process_next'] = false;
      setPayload['expressStepGeneration.error'] = message;
      setPayload['expressStepGeneration.updatedAt'] = now;
      setPayload['expressStepGeneration.updated_at'] = now;
    }

    await VideoSession.findByIdAndUpdate(sessionId, {
      $set: setPayload,
    });
  } catch (markError) {
    console.error(`Failed to mark text_to_video session ${sessionId} as failed`, markError);
  }
}

async function markImageListToVideoBuilderSessionFailed(sessionId, error) {
  if (!sessionId) {
    return;
  }

  try {
    await getDBConnectionString();

    const session = await VideoSession.findById(sessionId)
      .select('expressGenerationStatus expressGenerationFailed expressGenerationError expressStepGeneration')
      .lean();

    if (!session) {
      return;
    }

    const message = session.expressGenerationError || extractImageListToVideoErrorMessage(error);
    const nextStatus = { ...(session.expressGenerationStatus || {}) };
    const promptStage = typeof nextStatus.prompt_generation === 'string'
      ? nextStatus.prompt_generation.trim().toUpperCase()
      : '';
    const videoStage = typeof nextStatus.video_generation === 'string'
      ? nextStatus.video_generation.trim().toUpperCase()
      : '';

    nextStatus.status = 'FAILED';
    if (!promptStage || promptStage === 'PENDING' || promptStage === 'INIT' || promptStage === 'IN_PROGRESS') {
      nextStatus.prompt_generation = 'FAILED';
    }
    if (!videoStage || videoStage === 'PENDING' || videoStage === 'INIT' || videoStage === 'IN_PROGRESS') {
      nextStatus.video_generation = 'FAILED';
    }

    const now = new Date();
    const setPayload = {
      expressGenerationStatus: nextStatus,
      expressGenerationPending: false,
      videoGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: message,
    };

    if (session.expressStepGeneration?.enabled) {
      setPayload['expressStepGeneration.status'] = 'FAILED';
      setPayload['expressStepGeneration.currentStep'] = 'prompt_generation';
      setPayload['expressStepGeneration.current_step'] = 'prompt_generation';
      setPayload['expressStepGeneration.currentStepLabel'] = 'Narrative';
      setPayload['expressStepGeneration.current_step_label'] = 'Narrative';
      setPayload['expressStepGeneration.waitingForProcessNext'] = false;
      setPayload['expressStepGeneration.waiting_for_process_next'] = false;
      setPayload['expressStepGeneration.requiresUserAction'] = false;
      setPayload['expressStepGeneration.requires_user_action'] = false;
      setPayload['expressStepGeneration.canProcessNext'] = false;
      setPayload['expressStepGeneration.can_process_next'] = false;
      setPayload['expressStepGeneration.error'] = message;
      setPayload['expressStepGeneration.updatedAt'] = now;
      setPayload['expressStepGeneration.updated_at'] = now;
    }

    await VideoSession.findByIdAndUpdate(sessionId, {
      $set: setPayload,
    });
  } catch (markError) {
    console.error(`Failed to mark image_list_to_video session ${sessionId} as failed`, markError);
  }
}

function logImageListToVideoPayload(payload) {
  try {
  } catch (error) {
    console.error('[model][MovieAPI][image_list_to_video] request payload serialization failed', {
      message: error?.message || String(error),
    });
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCustomAdaptersPayload(payload = {}) {
  return normalizeCustomModelAdaptersPayload(payload);
}

function getFirstStringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return null;
}

function getBooleanValue(value) {
  return typeof value === 'boolean' ? value : null;
}

function getFiniteNumberValue(...values) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }
  return null;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getOptionalStringPayloadValue(payload, keys = [], fieldName) {
  let hasValue = false;
  let rawValue;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      continue;
    }
    const value = payload[key];
    if (value === undefined || value === null) {
      continue;
    }
    hasValue = true;
    rawValue = value;
    break;
  }

  if (!hasValue) {
    return null;
  }

  if (typeof rawValue !== 'string') {
    const error = new Error(`${fieldName} must be a string when provided.`);
    error.status = 400;
    throw error;
  }

  const trimmed = rawValue.trim();
  return trimmed || null;
}

function getOptionalBooleanPayloadValue(payload, keys = [], fieldName) {
  let hasValue = false;
  let rawValue;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      hasValue = true;
      rawValue = payload[key];
      break;
    }
  }

  if (!hasValue || rawValue === undefined || rawValue === null) {
    return null;
  }

  if (typeof rawValue !== 'boolean') {
    const error = new Error(`${fieldName} must be a boolean.`);
    error.status = 400;
    throw error;
  }

  return rawValue;
}

function getOptionalBooleanAliasValue(payload = {}, keys = [], fieldName) {
  let hasValue = false;
  let resolvedValue = null;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      continue;
    }

    const rawValue = payload[key];
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    if (typeof rawValue !== 'boolean') {
      const error = new Error(`${fieldName} must be a boolean.`);
      error.status = 400;
      throw error;
    }

    if (hasValue && rawValue !== resolvedValue) {
      const error = new Error(`${fieldName} was provided with conflicting alias values.`);
      error.status = 400;
      throw error;
    }

    hasValue = true;
    resolvedValue = rawValue;
  }

  return hasValue ? resolvedValue : null;
}

export function normalizeImageListNarratorAvatarOptions(payload = {}) {
  const rawLimitSingleNarrator = getOptionalBooleanAliasValue(
    payload,
    ['limit_single_narrator', 'limitSingleNarrator'],
    'limit_single_narrator',
  );
  const addNarratorAvatar = getOptionalBooleanAliasValue(
    payload,
    ['add_narrator_avatar', 'addNarratorAvatar'],
    'add_narrator_avatar',
  ) === true;
  const limitSingleNarrator = addNarratorAvatar || rawLimitSingleNarrator === true;

  return {
    limit_single_narrator: limitSingleNarrator,
    add_narrator_avatar: addNarratorAvatar,
  };
}

function normalizeOutroFocusAreaPayloadValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    const error = new Error('outro_focust_area must be an object with x, y, width, height.');
    error.status = 400;
    throw error;
  }

  const { x, y, width, height } = value;
  const hasInvalidNumber = [x, y, width, height].some(
    (fieldValue) => typeof fieldValue !== 'number' || Number.isNaN(fieldValue) || !Number.isFinite(fieldValue),
  );
  if (hasInvalidNumber) {
    const error = new Error('outro_focust_area x, y, width, height must be valid numbers.');
    error.status = 400;
    throw error;
  }

  return { x, y, width, height };
}

function getExpressCtaGenerationRawValue(payload = {}) {
  for (const alias of IMAGE_LIST_EXPRESS_CTA_GENERATION_ALIASES) {
    if (Object.prototype.hasOwnProperty.call(payload, alias)) {
      const value = payload[alias];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
  }
  return undefined;
}

export function normalizeImageListExpressCtaGenerationOptions(payload = {}) {
  const rawExpressCtaGeneration = getExpressCtaGenerationRawValue(payload);
  if (rawExpressCtaGeneration === undefined || rawExpressCtaGeneration === null) {
    return { express_cta_generation: false };
  }

  if (typeof rawExpressCtaGeneration !== 'boolean') {
    const error = new Error('express_cta_generation must be a boolean.');
    error.status = 400;
    throw error;
  }

  if (!rawExpressCtaGeneration) {
    return { express_cta_generation: false };
  }

  const ctaUrl = getOptionalStringPayloadValue(payload, ['cta_url', 'ctaUrl'], 'cta_url');
  if (!ctaUrl) {
    const error = new Error('cta_url is required when express_cta_generation is true.');
    error.status = 400;
    throw error;
  }
  if (!isHttpUrl(ctaUrl)) {
    const error = new Error('cta_url must be an http or https URL.');
    error.status = 400;
    throw error;
  }

  return {
    express_cta_generation: true,
    cta_url: ctaUrl,
  };
}

function normalizeGeneratedOutroImageOptions(payload = {}) {
  const expressCtaGenerationOptions = normalizeImageListExpressCtaGenerationOptions(payload);
  const rawGenerateOutroImage = payload.generate_outro_image ?? payload.generateOutroImage;
  const ctaUrl = expressCtaGenerationOptions.cta_url ||
    getOptionalStringPayloadValue(payload, ['cta_url', 'ctaUrl'], 'cta_url');
  const outroCtaImage = normalizeOutroCtaImageFromPayload(payload);
  const outroCtaImageTextFields = normalizeOutroCtaImageTextFieldsFromPayload(payload);

  if (
    rawGenerateOutroImage !== undefined &&
    rawGenerateOutroImage !== null &&
    typeof rawGenerateOutroImage !== 'boolean'
  ) {
    const error = new Error('generate_outro_image must be a boolean.');
    error.status = 400;
    throw error;
  }

  const shouldGenerateOutroImage = expressCtaGenerationOptions.express_cta_generation === true ||
    rawGenerateOutroImage === true ||
    (rawGenerateOutroImage === undefined && (Boolean(ctaUrl) || Boolean(outroCtaImage)));
  if (!shouldGenerateOutroImage) {
    return { generate_outro_image: false };
  }

  if (!ctaUrl && !outroCtaImage) {
    const error = new Error('cta_url or outro_cta_image is required when generate_outro_image is true.');
    error.status = 400;
    throw error;
  }
  if (ctaUrl && !isHttpUrl(ctaUrl)) {
    const error = new Error('cta_url must be an http or https URL.');
    error.status = 400;
    throw error;
  }

  const ctaTextTop = getOptionalStringPayloadValue(
    payload,
    ['cta_text_top', 'ctaTextTop'],
    'cta_text_top',
  ) || outroCtaImageTextFields.ctaTextTop;
  const ctaTextBottom = getOptionalStringPayloadValue(
    payload,
    ['cta_text_bottom', 'ctaTextBottom'],
    'cta_text_bottom',
  ) || outroCtaImageTextFields.ctaTextBottom;
  const ctaLogo = getOptionalStringPayloadValue(payload, ['cta_logo', 'ctaLogo'], 'cta_logo');

  return {
    generate_outro_image: true,
    ...(ctaUrl ? { cta_url: ctaUrl } : {}),
    ...(outroCtaImage ? { outro_cta_image: outroCtaImage } : {}),
    ...(expressCtaGenerationOptions.express_cta_generation ? { express_cta_generation: true } : {}),
    ...(ctaTextTop ? { cta_text_top: ctaTextTop } : {}),
    ...(ctaTextBottom ? { cta_text_bottom: ctaTextBottom } : {}),
    ...(ctaLogo ? { cta_logo: ctaLogo } : {}),
  };
}

function summarizeOptionalComponentError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error?.name || null,
    message: error?.message || String(error),
    status: error?.status || error?.response?.status || null,
    code: error?.code || error?.error?.code || null,
    type: error?.type || error?.error?.type || null,
  };
}

function recordOptionalComponentFallback(warnings, {
  routeType,
  userId,
  component,
  reason,
  error = null,
} = {}) {
  const warning = {
    routeType: routeType || null,
    userId: userId?.toString?.() || userId || null,
    component: component || 'unknown',
    reason: reason || 'optional_component_disabled',
    error: summarizeOptionalComponentError(error),
    createdAt: new Date(),
  };

  if (Array.isArray(warnings)) {
    warnings.push(warning);
  }

}

function safeNormalizeTextToVideoGeneratedOutroOptions(payload, context = {}, warnings = []) {
  try {
    return normalizeGeneratedOutroImageOptions(payload);
  } catch (error) {
    recordOptionalComponentFallback(warnings, {
      ...context,
      component: 'generated_outro_image',
      reason: 'normalization_failed',
      error,
    });
    return { generate_outro_image: false };
  }
}

function normalizeTextToVideoOutroOptions(payload = {}, generatedOutroOptions = {}) {
  const generateOutroImage = generatedOutroOptions.generate_outro_image === true;
  const outroImageUrl = generateOutroImage
    ? null
    : getOptionalStringPayloadValue(payload, ['outro_image_url', 'outroImageUrl'], 'outro_image_url');
  const requestedAddOutroAnimation = getOptionalBooleanPayloadValue(
    payload,
    ['add_outro_animation', 'addOutroAnimation'],
    'add_outro_animation',
  );
  const requestedAddOutroFocusArea = getOptionalBooleanPayloadValue(
    payload,
    ['add_outro_focus_area', 'addOutroFocusArea'],
    'add_outro_focus_area',
  );
  const requestedFocusArea =
    payload.outro_focust_area ??
    payload.outro_focus_area ??
    payload.outroFocustArea ??
    payload.outroFocusArea ??
    null;

  const addOutroAnimation = generateOutroImage ? true : requestedAddOutroAnimation === true;
  const addOutroFocusArea = generateOutroImage ? true : requestedAddOutroFocusArea === true;
  const outroFocustArea = generateOutroImage
    ? null
    : normalizeOutroFocusAreaPayloadValue(requestedFocusArea);

  if (addOutroFocusArea && !addOutroAnimation) {
    const error = new Error('add_outro_focus_area requires add_outro_animation to be true.');
    error.status = 400;
    throw error;
  }

  if (addOutroFocusArea && !generateOutroImage && !outroFocustArea) {
    const error = new Error('outro_focust_area is required when add_outro_focus_area is true.');
    error.status = 400;
    throw error;
  }

  return {
    outro_image_url: outroImageUrl || undefined,
    add_outro_animation: addOutroAnimation,
    add_outro_focus_area: addOutroFocusArea,
    outro_focust_area: outroFocustArea,
  };
}

function safeNormalizeTextToVideoOutroOptions(payload, generatedOutroOptions, context = {}, warnings = []) {
  try {
    return normalizeTextToVideoOutroOptions(payload, generatedOutroOptions);
  } catch (error) {
    recordOptionalComponentFallback(warnings, {
      ...context,
      component: 'outro_image',
      reason: 'normalization_failed',
      error,
    });
    return {
      outro_image_url: undefined,
      add_outro_animation: false,
      add_outro_focus_area: false,
      outro_focust_area: null,
    };
  }
}

export function normalizeImageListFooterAnimationOptions(payload = {}, sceneCount = 0) {
  const expressCtaGenerationOptions = normalizeImageListExpressCtaGenerationOptions(payload);
  const rawFooterMetadata = payload.footer_metadata ?? payload.footerMetadata;

  if (expressCtaGenerationOptions.express_cta_generation) {
    return { add_footer_animation: true, footer_metadata: [] };
  }

  const effectiveRawAddFooterAnimation = payload.add_footer_animation ?? payload.addFooterAnimation;
  if (effectiveRawAddFooterAnimation === undefined || effectiveRawAddFooterAnimation === null) {
    return { add_footer_animation: false, footer_metadata: [] };
  }

  if (typeof effectiveRawAddFooterAnimation !== 'boolean') {
    const error = new Error('add_footer_animation must be a boolean.');
    error.status = 400;
    throw error;
  }

  if (!effectiveRawAddFooterAnimation) {
    return { add_footer_animation: false, footer_metadata: [] };
  }

  if (!Array.isArray(rawFooterMetadata)) {
    const error = new Error('footer_metadata must be an array when add_footer_animation is true.');
    error.status = 400;
    throw error;
  }

  const requiredSceneCount = Math.max(0, Math.floor(Number(sceneCount) || 0));
  if (rawFooterMetadata.length < requiredSceneCount) {
    const error = new Error('footer_metadata must include one item for each image scene when add_footer_animation is true.');
    error.status = 400;
    throw error;
  }

  const normalizedFooterMetadata = rawFooterMetadata.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      const error = new Error(`footer_metadata[${index}] must be an object with url and title.`);
      error.status = 400;
      throw error;
    }

    const normalizedFooterMetadataItem = normalizeFooterMetadataItem(entry);

    if (!normalizedFooterMetadataItem) {
      const error = new Error(`footer_metadata[${index}] must include at least one of url, title, cta_text, or cta_logo.`);
      error.status = 400;
      throw error;
    }

    const url = normalizedFooterMetadataItem.url;
    if (url && !isHttpUrl(url)) {
      const error = new Error(`footer_metadata[${index}].url must be an http or https URL.`);
      error.status = 400;
      throw error;
    }

    const rawLogo = entry.logoUrl ?? entry.cta_logo ?? entry.ctaLogo ?? entry.logo_url ?? entry.footer_logo_url;
    if (rawLogo !== undefined && rawLogo !== null && typeof rawLogo !== 'string') {
      const error = new Error(`footer_metadata[${index}].cta_logo must be a string when provided.`);
      error.status = 400;
      throw error;
    }

    return normalizedFooterMetadataItem;
  });

  return {
    add_footer_animation: true,
    footer_metadata: normalizedFooterMetadata,
  };
}

function safeNormalizeTextToVideoFooterAnimationOptions(payload, context = {}, warnings = []) {
  try {
    return normalizeImageListFooterAnimationOptions(payload, 0);
  } catch (error) {
    recordOptionalComponentFallback(warnings, {
      ...context,
      component: 'footer_animation',
      reason: 'normalization_failed',
      error,
    });
    return { add_footer_animation: false, footer_metadata: [] };
  }
}

function resolveSessionLanguageForStorage(language) {
  if (typeof language !== 'string') {
    return 'EN';
  }

  const normalizedLanguage = language.trim();
  if (!normalizedLanguage || normalizedLanguage.toLowerCase() === 'auto') {
    return 'EN';
  }

  return normalizedLanguage;
}

async function saveVideoSessionRequestMetadata(sessionId, {
  aspectRatio,
  language,
  languageString,
  prompt,
  requestedDuration,
  billingDurationSeconds,
  videoTone,
  enableSubtitles,
  subtitleLanguage,
  subtitleLanguageString,
  subtitleLanguageExplicit,
  subtitleTranslationRequired,
  outroImageMetadata,
  footerMetadata,
  addFooterAnimation,
  limitSingleNarrator,
  addNarratorAvatar,
  expressGenerationType,
  isExpressGeneration,
  expressGenerativeVideoModel,
  expressGenerationImageModel,
  backingTrackModel,
  ttsModel,
  inferenceModel,
  isStepVideoGeneration,
  stepVideoRoute,
  manualStepStages,
  customAdapters,
  customAdapterFallbacks,
  customAdapterOperationUsage,
  samsarExternalProviderStages,
  apiKeyUsage,
  expressCtaGeneration,
  builderRouteType,
  builderStatus,
  builderSessionSubType,
  optionalComponentWarnings,
  preparedNarrativeArtifacts,
} = {}) {
  if (!sessionId) {
    return;
  }

  const hasSubtitles = enableSubtitles !== false;
  const normalizedLanguage = typeof language === 'string' && language.trim()
    ? language.trim()
    : 'auto';
  const sessionLanguage = resolveSessionLanguageForStorage(normalizedLanguage);
  const normalizedAspectRatio = typeof aspectRatio === 'string' && aspectRatio.trim()
    ? aspectRatio.trim()
    : '16:9';

  const setPayload = {
    aspectRatio: normalizedAspectRatio,
    enableSubtitles: hasSubtitles,
    hasSubtitles,
    has_subtitles: hasSubtitles,
    subtitleLanguage: typeof subtitleLanguage === 'string' && subtitleLanguage.trim()
      ? subtitleLanguage.trim()
      : resolveSpeechLanguageCode(sessionLanguage),
    subtitleLanguageString: typeof subtitleLanguageString === 'string' && subtitleLanguageString.trim()
      ? subtitleLanguageString.trim()
      : null,
    subtitleLanguageExplicit: subtitleLanguageExplicit === true,
    subtitleTranslationRequired: hasSubtitles && subtitleTranslationRequired === true,
    language: normalizedLanguage,
    sessionLanguage,
    languageString: typeof languageString === 'string' && languageString.trim()
      ? languageString.trim()
      : null,
    limitSingleNarrator: limitSingleNarrator === true,
    limit_single_narrator: limitSingleNarrator === true,
    addNarratorAvatar: addNarratorAvatar === true,
    add_narrator_avatar: addNarratorAvatar === true,
    expressCtaGeneration: expressCtaGeneration === true,
  };
  const normalizedAPIKeyUsage = normalizeAPIKeyUsageContext(apiKeyUsage);

  if (preparedNarrativeArtifacts && typeof preparedNarrativeArtifacts === 'object') {
    const {
      sourceNarrativeRequestId,
      narrativeType,
      themeJson,
      narrativeJson,
      movieResourceList,
      branchingMeta,
    } = preparedNarrativeArtifacts;
    setPayload.sourceNarrativeRequestId = sourceNarrativeRequestId;
    setPayload.sourceNarrativeType = narrativeType || 'singular';
    setPayload.narrativeType = narrativeType || 'singular';
    setPayload.themeJson = themeJson;
    setPayload.narrativeJson = narrativeJson;
    setPayload.movieResourceList = movieResourceList;
    setPayload.branchingMeta = branchingMeta || null;
    setPayload.parentJsonTheme = JSON.stringify(themeJson);
    setPayload['expressGenerationStatus.prompt_generation'] = 'COMPLETED';
    setPayload['expressGenerationStatus.image_generation'] = 'PENDING';
    setPayload['expressGenerationStatus.audio_generation'] = 'PENDING';
    setPayload.expressGenerationNarrativeReused = true;
    const normalizedBillingDuration = Number(billingDurationSeconds);
    const initialBillingDuration = Number.isFinite(normalizedBillingDuration) &&
      normalizedBillingDuration > 0
      ? normalizedBillingDuration
      : requestedDuration;
    setPayload.expressGenerationBillingDurationSeconds = initialBillingDuration;
    if (narrativeType === 'branched') {
      setPayload.expressGenerationBillingStageDurations = Object.fromEntries(
        [
          EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION,
          EXPRESS_VIDEO_BILLING_STAGES.SPEECH_GENERATION,
          EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION,
          EXPRESS_VIDEO_BILLING_STAGES.SOUND_EFFECT_GENERATION,
          EXPRESS_VIDEO_BILLING_STAGES.LIP_SYNC_GENERATION,
          EXPRESS_VIDEO_BILLING_STAGES.NARRATOR_AVATAR_GENERATION,
          EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
          EXPRESS_VIDEO_BILLING_STAGES.PIPELINE,
        ].map((stageKey) => [stageKey, initialBillingDuration]),
      );
    }
    setPayload.expressGenerationCreditCharges =
      buildInitialReusedNarrativeExpressVideoCreditCharges(
        initialBillingDuration,
        sourceNarrativeRequestId,
      );
  }

  if (normalizedAPIKeyUsage) {
    setPayload.apiKeyId = normalizedAPIKeyUsage.apiKeyId;
    setPayload.apiKeyUsage = normalizedAPIKeyUsage;
    setPayload.apiKeyUsageLimit = normalizedAPIKeyUsage.apiKeyUsageLimit;
    setPayload.apiKeyUsageLimitPeriod = normalizedAPIKeyUsage.apiKeyUsageLimitPeriod;
  }

  if (typeof prompt === 'string' && prompt.trim()) {
    const normalizedPrompt = prompt.trim();
    setPayload.inputPrompt = normalizedPrompt;
    setPayload.expressInputPrompt = normalizedPrompt;
  }

  const normalizedRequestedDuration = Number(requestedDuration);
  if (Number.isFinite(normalizedRequestedDuration) && normalizedRequestedDuration > 0) {
    setPayload.totalDuration = normalizedRequestedDuration;
    setPayload.expressGenerationRequestedDurationSeconds = normalizedRequestedDuration;
  }

  if (typeof videoTone === 'string' && videoTone.trim()) {
    setPayload.videoTone = videoTone.trim();
  }

  if (typeof expressGenerationType === 'string' && expressGenerationType.trim()) {
    setPayload.expressGenerationType = expressGenerationType.trim();
    setPayload.expressGenerationPending = true;
    setPayload.expressGenerationPaused = false;
    setPayload.videoGenerationPending = true;
  }

  if (typeof isExpressGeneration === 'boolean') {
    setPayload.isExpressGeneration = isExpressGeneration;
  }

  if (typeof expressGenerativeVideoModel === 'string' && expressGenerativeVideoModel.trim()) {
    setPayload.expressGenerativeVideoModel = expressGenerativeVideoModel.trim();
  }

  if (typeof expressGenerationImageModel === 'string' && expressGenerationImageModel.trim()) {
    setPayload.expressGenerationImageModel = expressGenerationImageModel.trim();
  }

  if (typeof backingTrackModel === 'string' && backingTrackModel.trim()) {
    setPayload.backingTrackModel = backingTrackModel.trim();
  }

  if (typeof ttsModel === 'string' && ttsModel.trim()) {
    setPayload.ttsModel = ttsModel.trim();
  }

  if (typeof inferenceModel === 'string' && inferenceModel.trim()) {
    const normalizedInferenceModel = normalizeInferenceModelFromPayload({
      inference_model: inferenceModel,
    });
    if (normalizedInferenceModel) {
      setPayload.inferenceModel = normalizedInferenceModel;
      setPayload.expressGenerationInferenceModel = normalizedInferenceModel;
    }
  }

  if (isStepVideoGeneration === true) {
    const routeType = typeof stepVideoRoute === 'string' && stepVideoRoute.trim()
      ? stepVideoRoute.trim()
      : 'image_to_video';
    setPayload.isStepVideoGeneration = true;
    setPayload.expressStepGeneration = buildInitialExpressStepGeneration({
      routeType,
      manualStepStages,
    });
  }

  if (outroImageMetadata && typeof outroImageMetadata === 'object') {
    setPayload.outroImageMetadata = outroImageMetadata;
  }

  if (Array.isArray(footerMetadata)) {
    setPayload.footerMetadata = footerMetadata;
    setPayload.addFooterAnimation = addFooterAnimation === true && footerMetadata.length > 0;
  }

  if (customAdapters && typeof customAdapters === 'object' && !Array.isArray(customAdapters)) {
    setPayload.custom_adapters = customAdapters;
  }
  if (customAdapterFallbacks && typeof customAdapterFallbacks === 'object' && !Array.isArray(customAdapterFallbacks)) {
    setPayload.customAdapterFallbacks = customAdapterFallbacks;
  }
  if (customAdapterOperationUsage && typeof customAdapterOperationUsage === 'object' && !Array.isArray(customAdapterOperationUsage)) {
    setPayload.customAdapterOperationUsage = customAdapterOperationUsage;
  }
  if (samsarExternalProviderStages && typeof samsarExternalProviderStages === 'object' && !Array.isArray(samsarExternalProviderStages)) {
    setPayload.samsarExternalProviderStages = samsarExternalProviderStages;
  }

  if (typeof builderStatus === 'string' && builderStatus.trim()) {
    const now = new Date();
    const normalizedBuilderStatus = builderStatus.trim().toUpperCase();
    setPayload.expressGenerationBuilder = {
      routeType: typeof builderRouteType === 'string' && builderRouteType.trim()
        ? builderRouteType.trim()
        : null,
      sessionSubType: typeof builderSessionSubType === 'string' && builderSessionSubType.trim()
        ? builderSessionSubType.trim()
        : 'video_create',
      status: normalizedBuilderStatus,
      queuedAt: now,
      updatedAt: now,
    };
  }

  if (Array.isArray(optionalComponentWarnings) && optionalComponentWarnings.length > 0) {
    setPayload.expressGenerationOptionalComponentWarnings = optionalComponentWarnings;
  }

  await VideoSession.findByIdAndUpdate(sessionId, {
    $set: setPayload,
  });
}

function getFontKeyFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const fontPayload = isPlainObject(payload.font) ? payload.font : null;
  const rawValue = typeof payload.font_key === 'string'
    ? payload.font_key
    : typeof payload.fontKey === 'string'
      ? payload.fontKey
      : typeof payload.subtitle_font === 'string'
        ? payload.subtitle_font
        : typeof payload.subtitleFont === 'string'
          ? payload.subtitleFont
          : typeof fontPayload?.key === 'string'
            ? fontPayload.key
            : typeof fontPayload?.font_key === 'string'
              ? fontPayload.font_key
              : null;

  if (typeof rawValue !== 'string') {
    return null;
  }

  const trimmed = rawValue.trim();
  return trimmed ? trimmed : null;
}

function resolveFontKeyForLanguage(languageCode, fontKey) {
  if (!fontKey) {
    return null;
  }

  const fonts = getSubtitleFontsForLanguage(languageCode);
  const fallbackFont = Array.isArray(fonts) && fonts.length > 0
    ? fonts[0]
    : DEFAULT_LATIN_SUBTITLE_FONT;
  const matchedFont = Array.isArray(fonts)
    ? fonts.find((font) => font.toLowerCase() === fontKey.toLowerCase())
    : null;

  return matchedFont || fallbackFont;
}

function resolveImageListToVideoAspectRatio(rawAspectRatio) {
  if (rawAspectRatio === undefined || rawAspectRatio === null) {
    return IMAGE_LIST_TO_VIDEO_DEFAULT_ASPECT_RATIO;
  }
  if (typeof rawAspectRatio !== 'string') {
    return IMAGE_LIST_TO_VIDEO_DEFAULT_ASPECT_RATIO;
  }

  const trimmed = rawAspectRatio.trim();
  if (!IMAGE_LIST_TO_VIDEO_ALLOWED_ASPECT_RATIOS.has(trimmed)) {
    return IMAGE_LIST_TO_VIDEO_DEFAULT_ASPECT_RATIO;
  }

  return trimmed;
}

function resolveImageOutputFormatDescriptor(rawFormat) {
  if (typeof rawFormat !== 'string') {
    return DEFAULT_IMAGE_OUTPUT_FORMAT;
  }
  const normalizedFormat = rawFormat.trim().toLowerCase();
  return IMAGE_OUTPUT_FORMATS[normalizedFormat] || DEFAULT_IMAGE_OUTPUT_FORMAT;
}

function isExifOrientationRotatedBy90(rawOrientation) {
  const orientation = Number(rawOrientation);
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
}

function buildImageListToVideoProcessedFileName({ userId, sessionId, index, extension }) {
  const safeUserId = String(userId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '') || 'anon';
  const safeSessionId = String(sessionId || 'session').replace(/[^a-zA-Z0-9_-]/g, '') || 'session';
  const safeExtension = typeof extension === 'string' && extension ? extension : 'png';
  return `${safeUserId}_${safeSessionId}_image_list_to_video_${Date.now()}_${index + 1}.${safeExtension}`;
}

async function prepareImageListToVideoInputImages({
  imageUrls = [],
  imageListPayload = [],
  userId,
  sessionId,
  aspectRatio,
}) {
  const replacementMap = new Map();
  const processedImageUrls = [];
  const preparedMetadataByOriginalUrl = new Map();

  for (let index = 0; index < imageUrls.length; index += 1) {
    const imageUrl = typeof imageUrls[index] === 'string' ? imageUrls[index].trim() : '';
    if (!imageUrl) {
      processedImageUrls.push(imageUrls[index]);
      continue;
    }

    if (replacementMap.has(imageUrl)) {
      processedImageUrls.push(replacementMap.get(imageUrl));
      continue;
    }

    const imageMeta = Array.isArray(imageListPayload) ? imageListPayload[index] : null;
    if (imageMeta?.prepared_for_image_list_to_video === true) {
      replacementMap.set(imageUrl, imageUrl);
      preparedMetadataByOriginalUrl.set(imageUrl, imageMeta);
      processedImageUrls.push(imageUrl);
      continue;
    }

    const preparedImage = await prepareSingleImageForImageListToVideo({
      imageUrl,
      userId,
      sessionId,
      index,
      aspectRatio,
    });

    replacementMap.set(imageUrl, preparedImage.url);
    preparedMetadataByOriginalUrl.set(imageUrl, preparedImage);
    processedImageUrls.push(preparedImage.url);
  }

  const processedImageListPayload = Array.isArray(imageListPayload)
    ? imageListPayload.map((item, index) => {
      if (!item || typeof item !== 'object') {
        return item;
      }
      const replaceUrl = (value) => {
        if (typeof value !== 'string') {
          return value;
        }
        const trimmed = value.trim();
        return replacementMap.get(trimmed) || value;
      };
      const originalEffectiveUrl = typeof item.effective_url === 'string'
        ? item.effective_url.trim()
        : typeof imageUrls[index] === 'string'
          ? imageUrls[index].trim()
          : '';
      const preparedImage = preparedMetadataByOriginalUrl.get(originalEffectiveUrl);

      return {
        ...item,
        image_url: replaceUrl(item.image_url),
        enhanced_url: replaceUrl(item.enhanced_url),
        effective_url: replaceUrl(item.effective_url),
        ...(preparedImage
          ? {
            prepared_for_image_list_to_video: true,
            source_image_url: preparedImage.sourceUrl || item.source_image_url || originalEffectiveUrl,
            image_width: preparedImage.sourceWidth ?? item.image_width,
            image_height: preparedImage.sourceHeight ?? item.image_height,
            prepared_width: preparedImage.preparedWidth ?? item.prepared_width,
            prepared_height: preparedImage.preparedHeight ?? item.prepared_height,
            required_width: preparedImage.requiredWidth ?? item.required_width,
            required_height: preparedImage.requiredHeight ?? item.required_height,
            // Image enhancement is opt-in. Resolution analysis must never
            // silently turn a supplied image into an AI image-edit request.
            requires_enhancement: item.requires_enhancement,
            temp_image_expires_at: preparedImage.expiresAt ?? item.temp_image_expires_at,
          }
          : {}),
      };
    })
    : imageListPayload;

  return {
    imageUrls: processedImageUrls,
    imageListPayload: processedImageListPayload,
  };
}

async function prepareSingleImageForImageListToVideo({
  imageUrl,
  userId,
  sessionId,
  index,
  aspectRatio,
}) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: IMAGE_LIST_TO_VIDEO_MEDIA_DOWNLOAD_TIMEOUT_MS,
    });
    const sourceBuffer = Buffer.from(response.data);
    if (!sourceBuffer.length) {
      throw new Error('Downloaded image is empty.');
    }
    const sourceImage = sharp(sourceBuffer, { failOn: 'none' });
    const metadata = await sourceImage.metadata();
    const sourceWidth = Number(metadata.width);
    const sourceHeight = Number(metadata.height);
    const isRotatedByExif = isExifOrientationRotatedBy90(metadata.orientation);
    const orientedSourceWidth = isRotatedByExif ? sourceHeight : sourceWidth;
    const orientedSourceHeight = isRotatedByExif ? sourceWidth : sourceHeight;

    if (!Number.isFinite(orientedSourceWidth) || !Number.isFinite(orientedSourceHeight)) {
      throw new Error('Unable to determine image dimensions.');
    }

    const { width: requiredWidth, height: requiredHeight } = getCanvasDimensionsForAspectRatio(aspectRatio);
    const requiresEnhancement = orientedSourceWidth < requiredWidth || orientedSourceHeight < requiredHeight;
    const isOversized = orientedSourceWidth > requiredWidth || orientedSourceHeight > requiredHeight;
    let outputBuffer = sourceBuffer;
    let preparedWidth = orientedSourceWidth;
    let preparedHeight = orientedSourceHeight;
    let outputFormat = resolveImageOutputFormatDescriptor(metadata.format);
    let transformedImage = false;
    const responseContentType = typeof response.headers?.['content-type'] === 'string'
      ? response.headers['content-type'].split(';')[0].trim().toLowerCase()
      : '';

    // No resize/downscale: only crop when the source can cover exact target dimensions.
    if (isOversized && orientedSourceWidth >= requiredWidth && orientedSourceHeight >= requiredHeight) {
      const left = Math.floor((orientedSourceWidth - requiredWidth) / 2);
      const top = Math.floor((orientedSourceHeight - requiredHeight) / 2);

      let pipeline = sharp(sourceBuffer, { failOn: 'none' })
        .rotate()
        .extract({
          left,
          top,
          width: requiredWidth,
          height: requiredHeight,
        });

      if (outputFormat.format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: 92 });
      } else if (outputFormat.format === 'png') {
        pipeline = pipeline.png();
      } else if (outputFormat.format === 'webp') {
        pipeline = pipeline.webp({ quality: 92 });
      } else if (outputFormat.format === 'avif') {
        pipeline = pipeline.avif({ quality: 50 });
      } else if (outputFormat.format === 'tiff') {
        pipeline = pipeline.tiff();
      } else if (outputFormat.format === 'gif') {
        pipeline = pipeline.gif();
      } else {
        outputFormat = DEFAULT_IMAGE_OUTPUT_FORMAT;
        pipeline = pipeline.png();
      }

      outputBuffer = await pipeline.toBuffer();
      preparedWidth = requiredWidth;
      preparedHeight = requiredHeight;
      transformedImage = true;
    }

    const imageName = buildImageListToVideoProcessedFileName({
      userId,
      sessionId,
      index,
      extension: outputFormat.extension,
    });
    const contentType = !transformedImage && responseContentType.startsWith('image/')
      ? responseContentType
      : outputFormat.mimeType;
    const uploadedUrl = await uploadImageBufferToCDN(outputBuffer, imageName, contentType, {
      expiresInSeconds: IMAGE_LIST_TO_VIDEO_TEMP_IMAGE_TTL_SECONDS,
    });
    const expiresAt = new Date(Date.now() + IMAGE_LIST_TO_VIDEO_TEMP_IMAGE_TTL_SECONDS * 1000).toISOString();

    return {
      url: uploadedUrl,
      sourceUrl: imageUrl,
      sourceWidth: orientedSourceWidth,
      sourceHeight: orientedSourceHeight,
      preparedWidth,
      preparedHeight,
      requiredWidth,
      requiredHeight,
      requiresEnhancement,
      expiresAt,
    };
  } catch (error) {
    console.error('[model][MovieAPI][image_list_to_video] failed to prepare input image', {
      imageUrl,
      message: error?.message || String(error),
    });
    const prepareError = new Error(`Unable to download or analyze image_urls item ${index + 1}.`);
    prepareError.cause = error;
    prepareError.status = 400;
    throw prepareError;
  }
}

function resolveUseEnhancedFlag(item) {
  const explicit =
    getBooleanValue(item.use_enhanced) ??
    getBooleanValue(item.useEnhanced) ??
    getBooleanValue(item.is_enhanced) ??
    getBooleanValue(item.isEnhanced) ??
    getBooleanValue(item.from_enhanced_list) ??
    getBooleanValue(item.fromEnhancedList);
  if (explicit !== null) {
    return explicit;
  }
  if (typeof item.source === 'string') {
    const normalized = item.source.trim().toLowerCase();
    if (normalized.includes('enhanced')) {
      return true;
    }
  }
  return null;
}

function resolveSkipEnhancementFlag(item, useEnhancedFlag) {
  const explicit =
    getBooleanValue(item.skip_enhancement) ??
    getBooleanValue(item.skipEnhancement);
  if (explicit !== null) {
    return explicit;
  }
  return useEnhancedFlag === true;
}

export function normalizeImageListInput(imageUrls = []) {
  const normalizedItems = [];

  for (const item of imageUrls) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) {
        continue;
      }
      normalizedItems.push({
        image_url: trimmed,
        enhanced_url: null,
        effective_url: trimmed,
        skip_enhancement: false,
      });
      continue;
    }

    if (!item || typeof item !== 'object') {
      continue;
    }

    const imageUrl = getFirstStringValue(
      item.image_url,
      item.imageUrl,
      item.url,
      item.src,
      item.effective_url,
      item.effectiveUrl
    );
    const enhancedUrl = getFirstStringValue(item.enhanced_url, item.enhancedUrl);
    const useEnhancedFlag = resolveUseEnhancedFlag(item);
    const skipEnhancementFlag = resolveSkipEnhancementFlag(item, useEnhancedFlag);
    const effectiveUrl = enhancedUrl && useEnhancedFlag !== false ? enhancedUrl : imageUrl;
    const title = getFirstStringValue(
      item.title,
      item.image_title,
      item.imageTitle,
      item.activity_title,
      item.activityTitle,
      item.name,
      item.label,
    );
    const imageText = getFirstStringValue(
      item.image_text,
      item.imageText,
      item.description,
      item.image_description,
      item.imageDescription,
    );

    if (!effectiveUrl) {
      continue;
    }

    const normalizedItem = {
      image_url: imageUrl || effectiveUrl,
      enhanced_url: enhancedUrl,
      effective_url: effectiveUrl,
      skip_enhancement: skipEnhancementFlag || (enhancedUrl && useEnhancedFlag !== false),
      prepared_for_image_list_to_video: item.prepared_for_image_list_to_video === true,
      source_image_url: getFirstStringValue(item.source_image_url, item.sourceImageUrl, item.original_url, item.originalUrl),
      image_width: getFiniteNumberValue(item.image_width, item.imageWidth),
      image_height: getFiniteNumberValue(item.image_height, item.imageHeight),
      prepared_width: getFiniteNumberValue(item.prepared_width, item.preparedWidth),
      prepared_height: getFiniteNumberValue(item.prepared_height, item.preparedHeight),
      required_width: getFiniteNumberValue(item.required_width, item.requiredWidth),
      required_height: getFiniteNumberValue(item.required_height, item.requiredHeight),
      requires_enhancement: getBooleanValue(item.requires_enhancement) ?? getBooleanValue(item.requiresEnhancement),
      temp_image_expires_at: getFirstStringValue(item.temp_image_expires_at, item.tempImageExpiresAt),
      ...(title || imageText ? { title: title || imageText } : {}),
      ...(imageText ? { image_text: imageText } : {}),
    };

    normalizedItems.push(normalizedItem);
  }

  return {
    imageUrls: normalizedItems.map((item) => item.effective_url),
    imageListPayload: normalizedItems,
  };
}
