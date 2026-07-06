import { getDBConnectionString } from "../DBString.js";
import {
  extractThemeFromUserPrompt,
  extractGroundedThemeFromUserPrompt,

  extractMovieNarrativeFromThemeAndUserPrompt,
  extractGroundedMovieNarrativeFromThemeAndUserPrompt,


} from "../agent/MovieCreatorAgent.js";
import User from "../../schema/User.js";
import { requestQuickMovieGeneration } from "./TranscriptMovieGenerator.js";
import { validateTextToVideoNarrative } from "./utils/TranscriptUtils.js";
import { getModerationForNarrative } from "../moderation/CreateModeration.js";
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

function resolveAgentImageModel(modelKey) {
  if (modelKey === 'GPTIMAGE1') {
    return 'GPTIMAGE2';
  }
  return modelKey || 'GPTIMAGE2';
}

function normalizeBackingTrackProvider(value) {
  return value === 'LYRIA2' ? 'LYRIA3' : value;
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
    inferenceModel: userInferenceModel,
    routeType: stepVideoRoute || 'text_to_video',
  });

  if (!moderationPassed) {
    const errorMessage = "Narrative failed moderation";
    await VideoSession
      .findByIdAndUpdate(sessionID, {
        expressGenerationStatus: {
          prompt_generation: "FAILED",
        },
        expressGenerationPending: false,
        expressGenerationFailed: true,
        expressGenerationError: errorMessage,
      });
    throw new Error("Narrative failed moderation");
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


  let themeJson;


  if (videoTone === 'grounded') {
    themeJson = await extractGroundedThemeFromUserPrompt(prompt, userInferenceModel);
  } else {
    // 1) Extract the theme from the user prompt
    themeJson = await extractThemeFromUserPrompt(prompt, userInferenceModel);
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
        videoGenerationModel, userInferenceModel, effectiveLanguageString);
    } else {
      // 1) Extract the narrative
      narrativeJson = await extractMovieNarrativeFromThemeAndUserPrompt(themeJson, prompt, duration,
        videoGenerationModel, userInferenceModel, effectiveLanguageString);
    }


    // 2) Validate it
    isValidNarrative = validateTextToVideoNarrative(narrativeJson, videoGenerationModel, undefined, {
      repairAdjacentSceneIndex: isGeminiInferenceModel(userInferenceModel),
    });


    if (isValidNarrative.valid) {
      narrativeJson = isValidNarrative.narrativeJson;


      // If valid, break out of the loop immediately
      break;
    } else if (attempts < maxAttempts) {
      // If it's invalid but we haven't hit max attempts, we can retry

    } else {
      console.error('[model][VidGPT][text_to_video] narrative_extraction_failed', {
        sessionId: sessionID,
        attempts,
        errors: isValidNarrative.errors,
      });

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
    movieResourceList: narrativeJson,
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


  createVidGPTSession(userId, payload);

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


  const moderationPassed = await getModerationForNarrative(prompt);

  if (!moderationPassed) {
    const errorMessage = "Narrative failed moderation";
    await VideoSession
      .findByIdAndUpdate(sessionID, {
        expressGenerationStatus: {
          prompt_generation: "FAILED",
        },
        expressGenerationPending: false,
        expressGenerationFailed: true,
        expressGenerationError: errorMessage,
      });
    throw new Error("Narrative failed moderation");
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
    themeJson = await extractGroundedThemeFromUserPrompt(prompt, userInferenceModel);
  } else {
    // 1) Extract the theme from the user prompt
    themeJson = await extractThemeFromUserPrompt(prompt, userInferenceModel);
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
        videoGenerationModel, userInferenceModel);
    } else {
      // 1) Extract the narrative
      narrativeJson = await extractMovieNarrativeFromThemeAndUserPrompt(themeJson, prompt, duration,
        videoGenerationModel, userInferenceModel);
    }
    // 2) Validate it
    isValidNarrative = validateTextToVideoNarrative(narrativeJson, videoGenerationModel, undefined, {
      repairAdjacentSceneIndex: isGeminiInferenceModel(userInferenceModel),
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
    movieResourceList: narrativeJson,
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
