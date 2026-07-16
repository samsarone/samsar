import { uploadImageDataUrlToCDN } from "../AWS.js";
import { getImageMetaData } from "../ai_utils/VisionUtils.js";

import { getDBConnectionString } from "../DBString.js";
import {
  extractMovieNarrativeFromThemeUserPromptAndStartImage,
  extractThemeFromUserPromptAndImageTheme
} from "../agent/MovieCreatorAgent.js";
import User from "../../schema/User.js";
import { requestQuickMovieGeneration } from "./TranscriptMovieGenerator.js";
import { validateTextToVideoNarrative } from "./utils/TranscriptUtils.js";
import { getModerationForNarrative } from "../moderation/CreateModeration.js";
import {
  NARRATIVE_MODERATION_FAILURE_MESSAGE,
  markNarrativeModerationFailure,
} from '../moderation/ModerationFailureState.js';
import VideoSession from "../../schema/VideoSession.js";
import { isGeminiInferenceModel, normalizeInferenceModel } from "../../consts/InferenceModels.js";


export async function processImgToVidGPT(userId, payload) {

  await getDBConnectionString();
  let { prompt, sessionID,
    aspectRatio,videoGenerationModel = 'RUNWAYML',
    imageModel = 'FLUX1.1PRO', musicProvider = 'CASSETTEAI',
    duration = 10, modelSubType,
    startImage,
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

  const dateStr = new Date().toISOString().replace(/:/g, '-');
  const newImageName = `${sessionID}_start_image_${dateStr}.png`;
  const startImageTempUrl = await uploadImageDataUrlToCDN(startImage, newImageName);

  const userData = await User.findById(userId);
  const userInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  const imgMeta = await getImageMetaData(startImageTempUrl, userInferenceModel);

  const imgTheme = imgMeta.theme;
  const imgDescription = imgMeta.description;



    const moderationPassed = await getModerationForNarrative(prompt);

    const imgModerationPassed = await getModerationForNarrative(imgDescription);
  
    if (!moderationPassed || !imgModerationPassed) {
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
  
  
    const themeJson = await extractThemeFromUserPromptAndImageTheme(
      imgTheme,
      prompt,
      userInferenceModel,
      {
        externalRequestContext: {
          sessionId: sessionID,
          userId: userId?.toString?.() || userId,
          requestKey: 'image_to_video:theme',
        },
      },
    );
 

    // --- We'll retry extracting and validating the narrative up to 3 times. ---
    const maxAttempts = 5;
    let attempts = 0;
    let narrativeJson = null;
    let isValidNarrative = { valid: false, errors: [] };
  
    while (attempts < maxAttempts) {
      attempts++;
  
      // 1) Extract the narrative
      narrativeJson = await extractMovieNarrativeFromThemeUserPromptAndStartImage(
        imgDescription,
        themeJson, prompt, duration,
        videoGenerationModel, userInferenceModel, {
          externalRequestContext: {
            sessionId: sessionID,
            userId: userId?.toString?.() || userId,
            requestKey: `image_to_video:narrative-${attempts}`,
          },
        });
  

      
      
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
        await getTimeout(1000); // Wait for 1 second before retrying


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
      musicProvider: musicProvider,
      requestMusicGeneration: true,
      videoGenerationModel: videoGenerationModel,
      inputPrompt: prompt,
      requestType,
      creditSource,
    };
    if (modelSubType) {
      quickMoviePayload.videoGenerationModelSubType = modelSubType;
    }

    const sessionId = await requestQuickMovieGeneration(userId, quickMoviePayload);
  
    return sessionId;

}
