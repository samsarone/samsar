import { getDBConnectionString } from "../../DBString.js";

import User from "../../../schema/User.js";
import { requestQuickMovieGeneration } from "../TranscriptMovieGenerator.js";
import { validateTextToVideoNarrative } from "../utils/TranscriptUtils.js";
import { getModerationForNarrative } from "../../moderation/CreateModeration.js";
import {
  NARRATIVE_MODERATION_FAILURE_MESSAGE,
  markNarrativeModerationFailure,
} from '../../moderation/ModerationFailureState.js';
import VideoSession from "../../../schema/VideoSession.js";
import { processImgToVidGPT } from '../Img2VidGPT.js';
import { uploadImageDataUrlToCDN } from "../../AWS.js";
import { extractThemeForImageListAndPrompt , createNarrativeForImageListAndPrompt } from './AdAgentPrompts.js';
import { creditGenerationCredits } from "../../GenerationCredits.js";
import { normalizeInferenceModel } from "../../../consts/InferenceModels.js";


import { processThemesFromStartImages, processStartImagesDescriptions } from './AdUtils.js';

function normalizeBackingTrackProvider(value) {
  return value === 'LYRIA2' ? 'LYRIA3' : value;
}


export async function createAdMakerSession(userId, payload) {
  await getDBConnectionString();
  let { prompt, sessionID,
    aspectRatio,
    modelSubType,
  } = payload;

  if (!sessionID) {
    throw new Error("Session ID not provided");
  }

  const startImages = payload.startImages || [];

  const userData = await User.findById(userId);

  const imageModel = userData.agentImageModel || 'GPTIMAGE2';
  const videoGenerationModel = userData.agentVideoModel || 'RUNWAYML';

  const musicProvider = normalizeBackingTrackProvider(userData.backingTrackModel || 'ELEVENLABS_MUSIC');

  const duration = userData.defaultAgentDuration || 30; // default to 30 seconds if not provided
  const userInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  const startImagesWithRemoteUrls = await Promise.all(
    startImages.map(async (startImage, imgIndex) => {
      const newImageName = `${sessionID}_start_image_${imgIndex}.png`;
      return await uploadImageDataUrlToCDN(startImage, newImageName);
    })
  );


  const sessionTheme = await processThemesFromStartImages(startImagesWithRemoteUrls, userInferenceModel);

  const startImageDescriptions = await processStartImagesDescriptions(startImagesWithRemoteUrls, userInferenceModel);


  const moderationPassed = await getModerationForNarrative(prompt);

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

  const themeJson = await extractThemeForImageListAndPrompt(sessionTheme, prompt, userInferenceModel);



  // --- We'll retry extracting and validating the narrative up to 3 times. ---
  const maxAttempts = 5;
  let attempts = 0;
  let narrativeJson = null;
  let isValidNarrative = { valid: false, errors: [] };

  while (attempts < maxAttempts) {
    attempts++;

    // 1) Extract the narrative
    narrativeJson = await createNarrativeForImageListAndPrompt(
      sessionTheme, startImageDescriptions, prompt, duration,
      videoGenerationModel, userInferenceModel);

    // 2) Validate it
    isValidNarrative = validateTextToVideoNarrative(narrativeJson, videoGenerationModel);


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
    musicProvider: musicProvider,
    requestMusicGeneration: true,
    videoGenerationModel: videoGenerationModel,
    inputPrompt: prompt,
    themeJson: themeJson,
    isAdVideo: true,
    startImageDescriptions: startImageDescriptions,

  };
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
