import { getDBConnectionString } from "../DBString.js";
import {
  extractThemeFromUserPrompt,
  extractGroundedThemeFromUserPrompt,

  extractMovieNarrativeFromThemeAndUserPrompt,
  extractGroundedMovieNarrativeFromThemeAndUserPrompt,


} from "../agent/MovieCreatorAgent.js";
import User from "../../schema/User.js";
import {
  requestQuickMovieGeneration,
  requestQuickMovieGenerationFromNarrativeArtifacts,
} from "./TranscriptMovieGenerator.js";
import { validateTextToVideoNarrative } from "./utils/TranscriptUtils.js";
import { getModerationForNarrative } from "../moderation/CreateModeration.js";
import {
  NARRATIVE_MODERATION_FAILURE_MESSAGE,
  markNarrativeModerationFailure,
} from '../moderation/ModerationFailureState.js';
import VideoSession from "../../schema/VideoSession.js";
import { processImgToVidGPT } from './Img2VidGPT.js';
import { getLanguageStringFromLanguageCode } from "../../consts/LanguageCodes.js";
import { creditGenerationCredits } from "../GenerationCredits.js";
import { applyExternalRequestRefundBySessionId } from "../external/User.js";


import {
  createNewBlankQuickSession,
} from "../QuickSession.js";
import {
  CUSTOM_MODEL_KEYS,
  buildCustomAdapterFallbacks,
  buildCustomAdapterOperationUsage,
  hasCustomOperation,
} from "../custom/VideoCustomModelConfig.js";
import { isGeminiInferenceModel, normalizeInferenceModel } from "../../consts/InferenceModels.js";
import { normalizeInferenceModelFromPayload } from "../api/RequestModelOverrides.js";
import { resolveSubtitleLanguageOption } from './SubtitleLanguage.js';
import { generateValidatedTextToVideoNarrative } from './text_to_video/NarrativeGenerator.js';
import { validateBranchingNarrativeTree } from './branching/BranchingNarrativeTree.js';

function resolveAgentImageModel(modelKey) {
  if (modelKey === 'GPTIMAGE1') {
    return 'GPTIMAGE2';
  }
  return modelKey || 'GPTIMAGE2';
}

function normalizeBackingTrackProvider(value) {
  return value === 'LYRIA2' ? 'LYRIA3' : value;
}

function buildExternalAssistantOptions(sessionId, userId, requestKey) {
  return {
    externalRequestContext: {
      sessionId: sessionId?.toString?.() || sessionId,
      userId: userId?.toString?.() || userId,
      requestKey,
    },
  };
}

function buildInvalidPreparedNarrativeError(message) {
  const error = new Error(message);
  error.code = 'INVALID_PREPARED_NARRATIVE';
  error.status = 422;
  return error;
}

function clonePreparedNarrativeArtifact(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Starts the media stages for an already-completed NarrativeRequest. This is a
 * separate durable-builder entry point so ordinary text-to-video payloads can
 * never opt themselves out of moderation or prompt generation.
 */
export async function createVidGPTSessionFromNarrativeArtifacts(userId, payload = {}) {
  await getDBConnectionString();

  const {
    sessionID,
    prompt,
    aspectRatio: requestedAspectRatio = null,
    duration = 10,
    videoGenerationModel: requestedVideoGenerationModel = 'RUNWAYML',
    imageModel = 'GPTIMAGE2',
    musicProvider,
    videoTone = 'grounded',
    language = 'auto',
    languageString,
    requestType,
    creditSource,
    subtitleFont,
    speakerFont,
    enableSubtitles = true,
    subtitle_language = undefined,
    subtitleLanguage = undefined,
    subtitle_language_explicit = undefined,
    subtitleLanguageExplicit = undefined,
    outroImageUrl,
    addOutroAnimation = false,
    addOutroFocusArea = false,
    outroFocustArea = null,
    generateOutroImage = false,
    ctaUrl,
    ctaTextTop,
    ctaTextBottom,
    ctaLogo,
    outroCtaImage = null,
    addFooterAnimation = false,
    footerMetadata = [],
    speakerOptions = null,
    inference_model = null,
    inferenceModel = null,
    optionalComponentWarnings = [],
    custom_adapters = null,
    customAdapterFallbacks = null,
    customAdapterOperationUsage = null,
    preparedNarrativeArtifacts = null,
  } = payload;

  if (!sessionID) {
    throw new Error('Session ID not provided');
  }
  if (!preparedNarrativeArtifacts || typeof preparedNarrativeArtifacts !== 'object') {
    throw buildInvalidPreparedNarrativeError('Prepared NarrativeRequest artifacts are required.');
  }

  const {
    sourceNarrativeRequestId,
    narrativeType,
    themeJson,
    narrativeJson,
    movieResourceList,
    branchingMeta = null,
  } = preparedNarrativeArtifacts;
  if (!sourceNarrativeRequestId) {
    throw buildInvalidPreparedNarrativeError('sourceNarrativeRequestId is required.');
  }
  if (narrativeType !== 'singular' && narrativeType !== 'branched') {
    throw buildInvalidPreparedNarrativeError(
      'Prepared NarrativeRequest narrativeType must be singular or branched.',
    );
  }
  const aspectRatio = typeof requestedAspectRatio === 'string' && requestedAspectRatio.trim()
    ? requestedAspectRatio.trim()
    : narrativeType === 'branched'
      ? '16:9'
      : '1:1';
  if (!themeJson || typeof themeJson !== 'object' || Array.isArray(themeJson)) {
    throw buildInvalidPreparedNarrativeError('Prepared themeJson is invalid.');
  }
  if (!narrativeJson || typeof narrativeJson !== 'object' || Array.isArray(narrativeJson)) {
    throw buildInvalidPreparedNarrativeError('Prepared narrativeJson is invalid.');
  }
  if (!movieResourceList || typeof movieResourceList !== 'object' || Array.isArray(movieResourceList)) {
    throw buildInvalidPreparedNarrativeError('Prepared movieResourceList is invalid.');
  }
  if (narrativeType === 'singular' && (
    !Array.isArray(movieResourceList.scenes) || !Array.isArray(movieResourceList.sounds)
  )) {
    throw buildInvalidPreparedNarrativeError('Prepared singular movieResourceList is invalid.');
  }
  if (narrativeType === 'branched') {
    const validation = validateBranchingNarrativeTree(movieResourceList, {
      videoGenerationModel: requestedVideoGenerationModel,
      requestedDuration: duration,
    });
    if (!validation.valid) {
      throw buildInvalidPreparedNarrativeError(
        `Prepared branched movieResourceList is invalid: ${validation.errors.join(', ')}`,
      );
    }
  }

  const currentSession = await VideoSession.findById(sessionID);
  if (!currentSession) {
    const error = new Error('VideoSession not found.');
    error.status = 404;
    throw error;
  }
  if (currentSession.expressGenerationCancelled) {
    console.info('[narrative_to_video] cancelled_session_ignored', { sessionId: sessionID });
    return sessionID;
  }

  const userData = await User.findById(userId);
  if (!userData) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const requestInferenceModel = normalizeInferenceModelFromPayload({
    inference_model,
    inferenceModel,
  });
  const userInferenceModel = requestInferenceModel ||
    normalizeInferenceModel(userData?.selectedInferenceModel);
  const videoGenerationModel = requestedVideoGenerationModel ||
    userData?.agentVideoModel ||
    'RUNWAYML';
  const normalizedLanguage = typeof language === 'string' && language.trim()
    ? language.trim()
    : 'auto';
  const effectiveLanguageString = languageString ||
    getLanguageStringFromLanguageCode(normalizedLanguage);
  const subtitleLanguageOption = resolveSubtitleLanguageOption(
    {
      subtitle_language,
      subtitleLanguage,
      subtitle_language_explicit,
      subtitleLanguageExplicit,
    },
    normalizedLanguage,
    { allowPropagatedSameAsAudio: true },
  );

  const fallbackBackingTrackModel = normalizeBackingTrackProvider(
    musicProvider || userData?.backingTrackModel || 'ELEVENLABS_MUSIC'
  );
  const userBackingTrackModel = hasCustomOperation(custom_adapters, 'text_to_music')
    ? CUSTOM_MODEL_KEYS.TEXT_TO_MUSIC
    : fallbackBackingTrackModel;
  const resolvedCustomAdapterFallbacks = {
    ...buildCustomAdapterFallbacks({
      imageModel,
      videoModel: videoGenerationModel,
      ttsProvider: 'ELEVENLABS',
      musicProvider: fallbackBackingTrackModel,
    }),
    ...(customAdapterFallbacks || {}),
  };
  const resolvedCustomAdapterOperationUsage = {
    ...buildCustomAdapterOperationUsage(custom_adapters || {}),
    ...(customAdapterOperationUsage || {}),
  };
  const nextStatus = {
    ...(currentSession.expressGenerationStatus || {}),
    prompt_generation: 'COMPLETED',
    image_generation: 'PENDING',
    audio_generation: 'PENDING',
  };

  await VideoSession.findByIdAndUpdate(sessionID, {
    $set: {
      expressGenerationStatus: nextStatus,
      expressGenerationPending: true,
      expressGenerationFailed: false,
      videoGenerationPending: true,
      expressGenerationError: null,
      inferenceModel: userInferenceModel,
      expressGenerationInferenceModel: userInferenceModel,
      narrativeType,
      sourceNarrativeType: narrativeType,
    },
  });

  return requestQuickMovieGenerationFromNarrativeArtifacts(userId, {
    aspectRatio,
    sessionId: sessionID,
    duration,
    movieResourceList: clonePreparedNarrativeArtifact(movieResourceList),
    narrativeJson: clonePreparedNarrativeArtifact(narrativeJson),
    themeJson: clonePreparedNarrativeArtifact(themeJson),
    sourceNarrativeRequestId,
    sourceNarrativeType: narrativeType,
    branchingMeta: clonePreparedNarrativeArtifact(branchingMeta),
    imageModel,
    musicProvider: userBackingTrackModel,
    requestMusicGeneration: true,
    videoGenerationModel,
    inputPrompt: prompt,
    videoTone,
    language: normalizedLanguage,
    languageString: effectiveLanguageString,
    requestType,
    creditSource,
    enableSubtitles,
    hasSubtitles: enableSubtitles !== false,
    has_subtitles: enableSubtitles !== false,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    subtitleTranslationRequired: enableSubtitles !== false && subtitleLanguageOption.translationRequired,
    outroImageUrl,
    addOutroAnimation,
    addOutroFocusArea,
    outroFocustArea,
    generateOutroImage,
    ctaUrl,
    ctaTextTop,
    ctaTextBottom,
    ctaLogo,
    outroCtaImage,
    addFooterAnimation,
    footerMetadata,
    speakerOptions,
    inferenceModel: userInferenceModel,
    inference_model: userInferenceModel,
    optionalComponentWarnings,
    custom_adapters,
    customAdapterFallbacks: resolvedCustomAdapterFallbacks,
    customAdapterOperationUsage: resolvedCustomAdapterOperationUsage,
    ...(subtitleFont ? { subtitleFont } : {}),
    ...(speakerFont ? { speakerFont } : {}),
  });
}

export async function createVidGPTSession(userId, payload) {
  await getDBConnectionString();
  let { prompt, sessionID,
    aspectRatio,

    videoGenerationModel = 'RUNWAYML',
    imageModel = 'FLUX1.1PRO', musicProvider,
    imageStyle,
    duration = 10, modelSubType,
    startImage,

    videoTone = 'cinematic',
    language = 'auto',
    languageString,
    requestType,
    creditSource,
    subtitleFont,
    speakerFont,
    enableSubtitles = true,
    subtitle_language = undefined,
    subtitleLanguage = undefined,
    subtitle_language_explicit = undefined,
    subtitleLanguageExplicit = undefined,
    outroImageUrl,
    addOutroAnimation = false,
    addOutroFocusArea = false,
    outroFocustArea = null,
    generateOutroImage = false,
    ctaUrl,
    ctaTextTop,
    ctaTextBottom,
    ctaLogo,
    outroCtaImage = null,
    outro_cta_image: outroCtaImageAlias = null,
    addFooterAnimation = false,
    footerMetadata = [],
    speakerOptions = null,
    inference_model = null,
    inferenceModel = null,
    isStepVideoGeneration = false,
    stepVideoRoute = null,
    optionalComponentWarnings = [],
    custom_adapters = null,
    customAdapterFallbacks = null,
    customAdapterOperationUsage = null,

  } = payload;

  const requestedDuration = Number(duration);
  duration = Number.isFinite(requestedDuration)
    ? Math.min(240, Math.max(10, requestedDuration))
    : 10;

  const normalizedLanguage = typeof language === 'string' ? language.trim() : language;
  const effectiveLanguageString = languageString || getLanguageStringFromLanguageCode(normalizedLanguage);
  const subtitleLanguageOption = resolveSubtitleLanguageOption(
    {
      subtitle_language,
      subtitleLanguage,
      subtitle_language_explicit,
      subtitleLanguageExplicit,
    },
    normalizedLanguage,
    { allowPropagatedSameAsAudio: true },
  );
  const resolvedOutroCtaImage = outroCtaImage || outroCtaImageAlias || null;

  if (!sessionID) {
    throw new Error("Session ID not provided");
  }


  const currentSession = await VideoSession.findById(sessionID);


  if (startImage) {
    await processImgToVidGPT(userId, payload);
    return;
  }

  const userData = await User.findById(userId);
  const requestInferenceModel = normalizeInferenceModelFromPayload({ inference_model, inferenceModel });
  const userInferenceModel = requestInferenceModel || normalizeInferenceModel(userData?.selectedInferenceModel);
  await VideoSession.findByIdAndUpdate(sessionID, {
    inferenceModel: userInferenceModel,
    expressGenerationInferenceModel: userInferenceModel,
  });

  const moderationPassed = await getModerationForNarrative(prompt, {
    sessionId: sessionID,
    inferenceModel: userInferenceModel,
    routeType: stepVideoRoute || 'text_to_video',
  });

  const sessionAfterModeration = await VideoSession.findById(sessionID)
    .select('expressGenerationCancelled')
    .lean();
  if (!sessionAfterModeration || sessionAfterModeration.expressGenerationCancelled) {
    console.info('[moderation] cancelled_session_ignored', { sessionId: sessionID });
    return;
  }

  if (!moderationPassed) {
    await markNarrativeModerationFailure(sessionID);
    throw new Error(NARRATIVE_MODERATION_FAILURE_MESSAGE);
  }



  let expressGenerationStatus = currentSession.expressGenerationStatus;
  expressGenerationStatus.prompt_generation = "PENDING";


  await VideoSession.findByIdAndUpdate(sessionID, {
    expressGenerationStatus: expressGenerationStatus,
    expressGenerationPending: true,
    expressGenerationFailed: false,
    videoGenerationPending: true,
    expressGenerationError: null
  });

  const agentVideoModel = userData?.agentVideoModel || 'RUNWAYML';

  if (agentVideoModel && !videoGenerationModel) {
    videoGenerationModel = agentVideoModel;
  }

  const fallbackBackingTrackModel = normalizeBackingTrackProvider(
    musicProvider || userData?.backingTrackModel || 'ELEVENLABS_MUSIC'
  );
  let userBackingTrackModel = hasCustomOperation(custom_adapters, 'text_to_music')
    ? CUSTOM_MODEL_KEYS.TEXT_TO_MUSIC
    : fallbackBackingTrackModel;
  const resolvedCustomAdapterFallbacks = {
    ...buildCustomAdapterFallbacks({
      imageModel,
      videoModel: videoGenerationModel,
      ttsProvider: 'ELEVENLABS',
      musicProvider: fallbackBackingTrackModel,
    }),
    ...(customAdapterFallbacks || {}),
  };
  const resolvedCustomAdapterOperationUsage = {
    ...buildCustomAdapterOperationUsage(custom_adapters || {}),
    ...(customAdapterOperationUsage || {}),
  };


  let narrativeGeneration;
  try {
    narrativeGeneration = await generateValidatedTextToVideoNarrative({
      prompt,
      duration,
      videoGenerationModel,
      inferenceModel: userInferenceModel,
      videoTone,
      languageString: effectiveLanguageString,
      externalRequestContext: {
        sessionId: sessionID?.toString?.() || sessionID,
        userId: userId?.toString?.() || userId,
      },
      requestKeyPrefix: 'text_to_video',
    });
  } catch (error) {
    if (error?.code !== 'NARRATIVE_VALIDATION_FAILED') {
      throw error;
    }

    console.error('[model][VidGPT][text_to_video] narrative_extraction_failed', {
      sessionId: sessionID,
      attempts: error.attempts,
      errors: error.validationErrors,
    });

    const sessionData = await VideoSession.findById(sessionID);
    const failedGenerationStatus = sessionData.expressGenerationStatus;
    failedGenerationStatus.prompt_generation = "FAILED";

    await VideoSession.findByIdAndUpdate(sessionID, {
      expressGenerationStatus: failedGenerationStatus,
      expressGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: 'Prompt generation failed'
    });

    await processSessionCompletionFailure(sessionID);
    throw error;
  }

  const {
    themeJson,
    narrativeJson,
    movieResourceList,
  } = narrativeGeneration;
  const stableNarrativeJson = clonePreparedNarrativeArtifact(narrativeJson);
  const stableMovieResourceList = clonePreparedNarrativeArtifact(
    movieResourceList || narrativeJson,
  );



  let quickMoviePayload = {
    aspectRatio: aspectRatio,
    sessionId: sessionID,
    movieResourceList: stableMovieResourceList,
    narrativeJson: stableNarrativeJson,
    imageModel: imageModel,
    musicProvider: userBackingTrackModel,
    requestMusicGeneration: true,
    videoGenerationModel: videoGenerationModel,
    inputPrompt: prompt,
    themeJson: themeJson,
    videoTone: videoTone,
    language: normalizedLanguage,
    languageString: effectiveLanguageString,
    requestType,
    creditSource,
    enableSubtitles,
    hasSubtitles: enableSubtitles !== false,
    has_subtitles: enableSubtitles !== false,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    subtitleTranslationRequired: enableSubtitles !== false && subtitleLanguageOption.translationRequired,
    outroImageUrl,
    addOutroAnimation,
    addOutroFocusArea,
    outroFocustArea,
    generateOutroImage,
    ctaUrl,
    ctaTextTop,
    ctaTextBottom,
    ctaLogo,
    outroCtaImage: resolvedOutroCtaImage,
    addFooterAnimation,
    footerMetadata,
    speakerOptions,
    inferenceModel: userInferenceModel,
    inference_model: userInferenceModel,
    optionalComponentWarnings,
    custom_adapters,
    customAdapterFallbacks: resolvedCustomAdapterFallbacks,
    customAdapterOperationUsage: resolvedCustomAdapterOperationUsage,
    isStepVideoGeneration,
    stepVideoRoute,

  };
  if (subtitleFont) {
    quickMoviePayload.subtitleFont = subtitleFont;
  }
  if (speakerFont) {
    quickMoviePayload.speakerFont = speakerFont;
  }
  if (imageStyle) {
    quickMoviePayload.imageStyle = imageStyle;
  }
  if (modelSubType) {
    quickMoviePayload.videoGenerationModelSubType = modelSubType;
  }

  const sessionId = await requestQuickMovieGeneration(userId, quickMoviePayload);

  return sessionId;
}


export async function createVidGPTSessionWithBody(userId, payload) {
  await getDBConnectionString();
  let { prompt,
    aspectRatio,
  } = payload;


  const newSessionId = await createNewBlankQuickSession(userId);

  const userData = await User.findById(userId);
  const agentVideoModel = userData.agentVideoModel || 'RUNWAYML';
  const imageModel = resolveAgentImageModel(userData.agentImageModel);
  const defaultDuration = Number.isFinite(Number(userData.defaultAgentDuration))
    ? Math.min(240, Math.max(10, Number(userData.defaultAgentDuration)))
    : 10; // in seconds

  payload.sessionID = newSessionId;

  payload.videoGenerationModel = agentVideoModel;
  payload.imageModel = imageModel;
  payload.duration = defaultDuration;


  void createVidGPTSession(userId, payload).catch((error) => {
    console.error(`VidGPT generation failed for session ${newSessionId}`, error);
  });

  return newSessionId; // Return the session ID of the newly created session

}


export async function createInfoVidSession(userId, payload) {
  await getDBConnectionString();
  let { prompt, sessionID,
    aspectRatio,


    imageStyle,
    duration = 10, modelSubType,
    startImage,

    videoTone = 'cinematic',
    requestType,
    creditSource,

  } = payload;

  const requestedDuration = Number(duration);
  duration = Number.isFinite(requestedDuration)
    ? Math.min(240, Math.max(10, requestedDuration))
    : 10;

  if (!sessionID) {
    throw new Error("Session ID not provided");
  }

  if (startImage) {
    await processImgToVidGPT(userId, payload);
    return;
  }


  const moderationPassed = await getModerationForNarrative(prompt, {
    sessionId: sessionID,
  });

  const sessionAfterModeration = await VideoSession.findById(sessionID)
    .select('expressGenerationCancelled')
    .lean();
  if (!sessionAfterModeration || sessionAfterModeration.expressGenerationCancelled) {
    console.info('[moderation] cancelled_session_ignored', { sessionId: sessionID });
    return;
  }

  if (!moderationPassed) {
    await markNarrativeModerationFailure(sessionID);
    throw new Error(NARRATIVE_MODERATION_FAILURE_MESSAGE);
  }



  const currentSession = await VideoSession.findById(sessionID);
  let expressGenerationStatus = currentSession.expressGenerationStatus;
  expressGenerationStatus.prompt_generation = "PENDING";


  await VideoSession.findByIdAndUpdate(sessionID, {
    expressGenerationStatus: expressGenerationStatus,
    expressGenerationPending: true,
    expressGenerationFailed: false,
    videoGenerationPending: true,
    expressGenerationError: null
  });

  const userData = await User.findById(userId);
  const videoGenerationModel = userData.agentVideoModel || 'RUNWAYML';

  const imageModel = resolveAgentImageModel(userData.agentImageModel);

  const userInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  let userBackingTrackModel = normalizeBackingTrackProvider(userData.backingTrackModel || 'ELEVENLABS_MUSIC');




  let themeJson;
  if (videoTone === 'grounded') {
    themeJson = await extractGroundedThemeFromUserPrompt(
      prompt,
      userInferenceModel,
      buildExternalAssistantOptions(sessionID, userId, 'info_video:theme'),
    );
  } else {
    // 1) Extract the theme from the user prompt
    themeJson = await extractThemeFromUserPrompt(
      prompt,
      userInferenceModel,
      buildExternalAssistantOptions(sessionID, userId, 'info_video:theme'),
    );
  }


  // --- We'll retry extracting and validating the narrative up to 3 times. ---
  const maxAttempts = 5;
  let attempts = 0;
  let narrativeJson = null;
  let isValidNarrative = { valid: false, errors: [] };

  while (attempts < maxAttempts) {
    attempts++;

    if (videoTone === 'grounded') {
      narrativeJson = await extractGroundedMovieNarrativeFromThemeAndUserPrompt(themeJson, prompt, duration,
        videoGenerationModel, userInferenceModel, undefined,
        buildExternalAssistantOptions(sessionID, userId, `info_video:narrative-${attempts}`));
    } else {
      // 1) Extract the narrative
      narrativeJson = await extractMovieNarrativeFromThemeAndUserPrompt(themeJson, prompt, duration,
        videoGenerationModel, userInferenceModel, undefined,
        buildExternalAssistantOptions(sessionID, userId, `info_video:narrative-${attempts}`));
    }
    // 2) Validate it
    isValidNarrative = validateTextToVideoNarrative(narrativeJson, videoGenerationModel, undefined, {
      repairAdjacentSceneIndex: isGeminiInferenceModel(userInferenceModel),
      requestedDuration: duration,
    });


    if (isValidNarrative.valid) {
      // If valid, break out of the loop immediately
      narrativeJson = isValidNarrative.narrativeJson;
      break;
    } else if (attempts < maxAttempts) {
      // If it's invalid but we haven't hit max attempts, we can retry


    } else {

      const sessionData = await VideoSession.findById(sessionID);

      let expressGenerationStatus = sessionData.expressGenerationStatus;
      expressGenerationStatus.prompt_generation = "FAILED";

      await VideoSession.findByIdAndUpdate(sessionID, {
        expressGenerationStatus: expressGenerationStatus,
        expressGenerationPending: false,
        expressGenerationFailed: true,
        expressGenerationError: 'Prompt generation failed'
      });

      await processSessionCompletionFailure(sessionID);


      // If it's invalid and we've exhausted all attempts, throw an error
      throw new Error(`Invalid narrative after ${attempts} attempts: ${isValidNarrative.errors.join(", ")}`);
    }
  }


  let quickMoviePayload = {
    aspectRatio: aspectRatio,
    sessionId: sessionID,
    movieResourceList: clonePreparedNarrativeArtifact(narrativeJson),
    narrativeJson: clonePreparedNarrativeArtifact(narrativeJson),
    imageModel: imageModel,
    musicProvider: userBackingTrackModel,
    requestMusicGeneration: true,
    videoGenerationModel: videoGenerationModel,
    inputPrompt: prompt,
    themeJson: themeJson,
    videoTone: videoTone,
    requestType,
    creditSource,

  };
  if (imageStyle) {
    quickMoviePayload.imageStyle = imageStyle;
  }
  if (modelSubType) {
    quickMoviePayload.videoGenerationModelSubType = modelSubType;
  }



  const sessionId = await requestQuickMovieGeneration(userId, quickMoviePayload);

  return sessionId;
}




async function processSessionCompletionFailure(sessionId) {


  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });

  // return user credits
  if (sessionData.provisionalCredits) {
    // return the user session provisional credits back to the user
    const userId = sessionData.userId;
    const creditsToRefund = Number(sessionData.provisionalCredits) || 0;
    if (creditsToRefund > 0) {
      await creditGenerationCredits(userId, creditsToRefund, {
        source: 'video_generation_refund',
        metadata: {
          sessionId,
          reason: 'prompt_generation_failed',
        },
      });
      await applyExternalRequestRefundBySessionId({
        internalUserId: userId?.toString?.() || userId,
        sessionId,
        creditsRefunded: creditsToRefund,
        reason: 'prompt_generation_failed',
      });
    }

    // update provisional credits to 0
    await VideoSession.findByIdAndUpdate(sessionId, { provisionalCredits: 0 });
  }
  if (sessionData.externalWebhook) {
    // send POST request to externalWebhook

    const externalWebhookUrl = sessionData.externalWebhook;
    const webhookPayload = {
      video: {
        url: null,
      },
      error: {
        message: 'Video generation failed',
      }
    };

    const webhookRes = await axios.post(externalWebhookUrl, webhookPayload);


  }

}
