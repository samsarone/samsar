
import { getDBConnectionString } from "../../DBString.js";



import User from "../../../schema/User.js";
import axios from 'axios';
import { creditGenerationCredits } from "../../GenerationCredits.js";
import { applyExternalRequestRefundBySessionId } from "../../external/User.js";
import { getLanguageStringFromLanguageCode } from "../../../consts/LanguageCodes.js";

import { validateImageToVideoNarrative } from "../utils/TranscriptUtils.js";
import { getModerationForNarrative } from "../../moderation/CreateModeration.js";
import {
  NARRATIVE_MODERATION_FAILURE_MESSAGE,
  markNarrativeModerationFailure,
} from '../../moderation/ModerationFailureState.js';
import VideoSession from "../../../schema/VideoSession.js";

import { extractThemeFromInputPayload } from './system/ThemeBuilder.js';
import { extractNarrativeFromInputPayload } from './system/NarrativeBuilder.js';
import { buildExpressCtaTextPayload } from './system/CtaTextBuilder.js';

import { getMaxDurationForModelForScenes } from '../utils/ModelUtils.js';


import { requestImageListToVideGeneration } from './SessionRequestBuilder.js';
import {
  CUSTOM_MODEL_KEYS,
  buildCustomAdapterFallbacks,
  buildCustomAdapterOperationUsage,
  hasCustomOperation,
} from "../../custom/VideoCustomModelConfig.js";
import { resolveFramesPerSecond } from "../../../utils/FpsUtils.js";
import {
  buildSpeakerOptionsForTTSModel,
  getSpeakerOptionsFromPayload,
  resolveEffectiveInferenceModel,
  normalizeTTSModelFromPayload,
} from "../../api/RequestModelOverrides.js";
import { resolveSubtitleLanguageOption } from '../SubtitleLanguage.js';

function normalizeBackingTrackProvider(value) {
  return value === 'LYRIA2' ? 'LYRIA3' : value;
}

const IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL = 'NANOBANANAPROEDIT';



export async function createNewImageListToVideoSession(userId, payload) {


  await getDBConnectionString();
  let {
    sessionID,
    aspectRatio,
    videoGenerationModel = 'RUNWAYML',
    imageModel = IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL,
    musicProvider = null,
    imageStyle,
    modelSubType,
    transcriptBuilderPayload,
    language = 'auto',
    languageString,
    videoTone = 'grounded',
    outroImageUrl,
    addOutroAnimation,
    addOutroFocusArea,
    outroFocustArea,
    generatedOutroImage,
    outroImageBuffer,
    outroImageMimeType,
    outroCtaUrl,
    outroCtaTextTop,
    outroCtaTextBottom,
    outroCtaLogo,
    outroCtaImage,
    addFooterAnimation,
    footerMetadata,
    expressCtaGeneration = false,
    requestType,
    subtitleFont,
    speakerFont,
    enableSubtitles = true,
    subtitle_language = undefined,
    subtitleLanguage = undefined,
    subtitle_language_explicit = undefined,
    subtitleLanguageExplicit = undefined,
    limitSingleNarrator = false,
    limit_single_narrator = false,
    addNarratorAvatar = false,
    add_narrator_avatar = false,
    tts_model = null,
    ttsModel = null,
    inference_model = null,
    inferenceModel = null,
    isStepVideoGeneration = false,
    stepVideoRoute = null,
    manualStepStages = undefined,
    manual_step_stages = undefined,
    custom_adapters = null,
    customAdapterFallbacks = null,
    customAdapterOperationUsage = null,
  } = payload;

  const shouldAddNarratorAvatar = addNarratorAvatar === true || add_narrator_avatar === true;
  const shouldLimitSingleNarrator =
    shouldAddNarratorAvatar || limitSingleNarrator === true || limit_single_narrator === true;



  const resolvedLanguageString = languageString || getLanguageStringFromLanguageCode(language);
  const subtitleLanguageOption = resolveSubtitleLanguageOption(
    {
      subtitle_language,
      subtitleLanguage,
      subtitle_language_explicit,
      subtitleLanguageExplicit,
    },
    language,
    { allowPropagatedSameAsAudio: true },
  );

  let { prompt, metadata, imageDescriptionList } = transcriptBuilderPayload;


  const numScenes = imageDescriptionList.length;

  const userData = await User.findById(userId);
  const framesPerSecond = resolveFramesPerSecond(userData?.videoFramesPerSecond);
  const duration = getMaxDurationForModelForScenes(videoGenerationModel, numScenes, framesPerSecond);
  const requestedTTSModel = normalizeTTSModelFromPayload({ tts_model, ttsModel });
  const payloadSpeakerOptions = getSpeakerOptionsFromPayload(payload);
  const resolvedSpeakerOptions = requestedTTSModel
    ? buildSpeakerOptionsForTTSModel(requestedTTSModel, payloadSpeakerOptions, userData?.speakerOptions)
    : payloadSpeakerOptions;
  const resolvedManualStepStages = manualStepStages !== undefined
    ? manualStepStages
    : manual_step_stages;
  const userInferenceModel = resolveEffectiveInferenceModel(
    { inference_model, inferenceModel },
    userData?.selectedInferenceModel,
  );


  if (!sessionID) {
    throw new Error("Session ID not provided");
  }


  const currentSession = await VideoSession.findById(sessionID);


  const moderationPassed = await getModerationForNarrative(prompt, {
    inferenceModel: userInferenceModel,
    routeType: stepVideoRoute || 'image_list_to_video',
  });

  if (!moderationPassed) {
    await markNarrativeModerationFailure(sessionID);
    throw new Error(NARRATIVE_MODERATION_FAILURE_MESSAGE);
  }



  let expressGenerationStatus = currentSession.expressGenerationStatus;
  expressGenerationStatus.prompt_generation = "PENDING";


  await VideoSession.findByIdAndUpdate(sessionID, {
    expressGenerationStatus: expressGenerationStatus,
    expressGenerationType: 'IMAGE_LIST_TO_VIDEO',
    expressGenerativeVideoModel: videoGenerationModel,
    expressGenerationImageModel: imageModel,
    isExpressGeneration: true,
    ...(isStepVideoGeneration ? { isStepVideoGeneration: true } : {}),
    expressGenerationPending: true,
    expressGenerationPaused: false,
    expressGenerationFailed: false,
    videoGenerationPending: true,
    expressGenerationError: null
  });

  await VideoSession.findByIdAndUpdate(sessionID, {
    inferenceModel: userInferenceModel,
    expressGenerationInferenceModel: userInferenceModel,
  });

  const fallbackBackingTrackModel = normalizeBackingTrackProvider(
    musicProvider || userData.backingTrackModel || 'ELEVENLABS_MUSIC'
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



  const themeJson = await extractThemeFromInputPayload(transcriptBuilderPayload, userInferenceModel);




  // --- We'll retry extracting and validating the narrative up to 3 times. ---
  const maxAttempts = 5;
  let attempts = 0;
  let narrativeJson = null;
  let isValidNarrative = { valid: false, errors: [] };


  while (attempts < maxAttempts) {
    attempts++;


    


    narrativeJson = await extractNarrativeFromInputPayload(
      themeJson,
      transcriptBuilderPayload,
      duration,
      videoGenerationModel,
      userInferenceModel,
      numScenes,
      resolvedLanguageString,
      shouldLimitSingleNarrator,
      framesPerSecond,
    );

    
    // 2) Validate it
    isValidNarrative = validateImageToVideoNarrative(narrativeJson, numScenes, videoGenerationModel, framesPerSecond);


    if (isValidNarrative.valid) {
      narrativeJson = isValidNarrative.narrativeJson;
      if (shouldLimitSingleNarrator) {
        narrativeJson = enforceSingleNarratorIdentity(narrativeJson);
      }


      // If valid, break out of the loop immediately
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



  const shouldGenerateExpressCta = expressCtaGeneration === true;
  let resolvedGeneratedOutroImage = shouldGenerateExpressCta ? true : generatedOutroImage;
  let resolvedAddFooterAnimation = shouldGenerateExpressCta ? true : addFooterAnimation;
  let resolvedFooterMetadata = Array.isArray(footerMetadata) ? footerMetadata : [];
  let resolvedOutroCtaTextTop = outroCtaTextTop;
  let resolvedOutroCtaTextBottom = outroCtaTextBottom;

  if (shouldGenerateExpressCta) {
    const expressCtaPayload = await buildExpressCtaTextPayload({
      ctaUrl: outroCtaUrl,
      prompt,
      metadata,
      imageDescriptionList,
      imageListPayload: transcriptBuilderPayload.imageListPayload,
      scenes: narrativeJson?.scenes || [],
      inferenceModel: userInferenceModel,
    });

    resolvedFooterMetadata = expressCtaPayload.footer_metadata;
    resolvedOutroCtaTextTop = expressCtaPayload.cta_text_top;
    resolvedOutroCtaTextBottom = expressCtaPayload.cta_text_bottom;

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
    transcriptBuilderPayload: transcriptBuilderPayload,
    language,
    languageString: resolvedLanguageString,
    outroImageUrl,
    addOutroAnimation,
    addOutroFocusArea,
    outroFocustArea,
    generatedOutroImage: resolvedGeneratedOutroImage,
    outroImageBuffer,
    outroImageMimeType,
    outroCtaUrl,
    outroCtaTextTop: resolvedOutroCtaTextTop,
    outroCtaTextBottom: resolvedOutroCtaTextBottom,
    outroCtaLogo,
    outroCtaImage,
    addFooterAnimation: resolvedAddFooterAnimation,
    footerMetadata: resolvedFooterMetadata,
    expressCtaGeneration: shouldGenerateExpressCta,
    requestType,
    enableSubtitles,
    hasSubtitles: enableSubtitles !== false,
    has_subtitles: enableSubtitles !== false,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    subtitleTranslationRequired: enableSubtitles !== false && subtitleLanguageOption.translationRequired,
    limitSingleNarrator: shouldLimitSingleNarrator,
    limit_single_narrator: shouldLimitSingleNarrator,
    addNarratorAvatar: shouldAddNarratorAvatar,
    add_narrator_avatar: shouldAddNarratorAvatar,
    ...(requestedTTSModel ? { ttsModel: requestedTTSModel, tts_model: requestedTTSModel } : {}),
    inferenceModel: userInferenceModel,
    inference_model: userInferenceModel,
    ...(resolvedSpeakerOptions ? { speakerOptions: resolvedSpeakerOptions } : {}),
    custom_adapters,
    customAdapterFallbacks: resolvedCustomAdapterFallbacks,
    customAdapterOperationUsage: resolvedCustomAdapterOperationUsage,
    isStepVideoGeneration,
    stepVideoRoute,
    ...(resolvedManualStepStages !== undefined ? { manualStepStages: resolvedManualStepStages } : {}),


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



  const generationResult = await requestImageListToVideGeneration(userId, quickMoviePayload);

  return generationResult;
}

function isNarrationSound(sound = {}) {
  return sound?.type === 'speech' &&
    typeof sound?.subType === 'string' &&
    sound.subType.trim().toLowerCase() === 'narration';
}

function enforceSingleNarratorIdentity(narrativeJson = {}) {
  const sounds = Array.isArray(narrativeJson.sounds) ? narrativeJson.sounds : [];
  const scenes = Array.isArray(narrativeJson.scenes) ? narrativeJson.scenes : [];
  const firstNarratorSound = sounds.find(isNarrationSound);

  if (!firstNarratorSound) {
    return narrativeJson;
  }

  const narratorActor = typeof firstNarratorSound.actor === 'string' && firstNarratorSound.actor.trim()
    ? firstNarratorSound.actor.trim()
    : 'Narrator';
  const narratorGender = firstNarratorSound.gender === 'M' || firstNarratorSound.gender === 'F'
    ? firstNarratorSound.gender
    : 'F';
  const narratorIdentity = typeof firstNarratorSound.Identity === 'string' && firstNarratorSound.Identity.trim()
    ? firstNarratorSound.Identity.trim()
    : narratorActor;

  return {
    ...narrativeJson,
    scenes: scenes.map((scene) => (
      typeof scene?.type === 'string' && scene.type.trim().toLowerCase() === 'narration'
        ? { ...scene, speaker: narratorActor }
        : scene
    )),
    sounds: sounds.map((sound) => (
      isNarrationSound(sound)
        ? {
          ...sound,
          actor: narratorActor,
          gender: narratorGender,
          Identity: narratorIdentity,
        }
        : sound
    )),
  };
}

async function processSessionCompletionFailure(sessionId) {
  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });
  if (!sessionData) {
    return;
  }

  if (sessionData.provisionalCredits) {
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

    await VideoSession.findByIdAndUpdate(sessionId, { provisionalCredits: 0 });
  }

  if (sessionData.externalWebhook) {
    const externalWebhookUrl = sessionData.externalWebhook;
    const webhookPayload = {
      video: {
        url: null,
      },
      error: {
        message: 'Video generation failed',
      }
    };

    await axios.post(externalWebhookUrl, webhookPayload);
  }
}
