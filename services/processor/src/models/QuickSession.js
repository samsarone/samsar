import { getDBConnectionString } from "./DBString.js";
import VideoSession from '../schema/VideoSession.js';
import VideoGeneration from "../schema/VideoGeneration.js";
import AudioGeneration from "../schema/AudioGeneration.js";
import FrameGeneration from "../schema/FrameGeneration.js";
import { buildSecureMediaDeliveryUrl } from './AWS.js';


import { requestGenerateLayeredSpeech, deleteAllFrameGenerations, requestGenerateTranscriptSpeech } from './VideoSession.js';
import { getAnimationPresetForType, getRandomAnimation, getAlternateAnimation, getBannerDisplayActiveItemsForSession } from '../utils/AnimationUtils.js';
import { addImageGeneratorRequest, createInfiniteZoomImageRequests } from './Images.js';
import { createBackgroundDefaultSelectedMusicRequest, createBackgroundMusicFromUserSelection, createBackgroundMusicFromLibrary } from './audio/Audio.js';
import {
  generateThemeKeywords, generatePromptsForText, getMusicForTextTheme,
  translateTextContent, normalizeTextContent, divideTextIntoGroups,
  updateThemeWithText, updatePromptWithTheme, getBannerTextForSession
} from './OpenAI.js';
import fs from 'fs';
import { popularLanguages } from '../utils/LangUtils.js';
import { getCreditsRequiredForQuickVideo } from '../utils/GenerationCreditUtils.js';
import User from "../schema/User.js";
import { getResourcesFromSession } from './utils/SessionUtils.js';
import { maybeTriggerAutoRecharge } from './AutoRecharge.js';

import { getModerationForNarrative } from './moderation/CreateModeration.js';
import { normalizeInferenceModel } from '../consts/InferenceModels.js';

import { getCanvasDimensionsForAspectRatio } from "../utils/CanvasUtils.js";

import { requestQuickMovieGeneration } from './movie_session/TranscriptMovieGenerator.js';

import { model } from "mongoose";



let InitExpressGenerationStatus = {
  'prompt_generation': 'PENDING',
  'image_generation': 'PENDING',
  'audio_generation': 'PENDING',
  'frame_generation': 'INIT',
  'video_generation': 'INIT',
  'ai_video_generation': 'INIT',
  'speech_generation': 'INIT',
  'music_generation': 'INIT',
  'delete_reflow': 'INIT',

}

function resolveQuickSessionMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return value;
  }
  return buildSecureMediaDeliveryUrl(value.trim()) || value.trim();
}


const CURRENT_ENV = process.env.CURRENT_ENV;
const DEFAULT_FRAMES_PER_SECOND = 24;
const VALID_FRAMES_PER_SECOND = new Set([16, 24, 30]);

function resolveFramesPerSecond(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_FRAMES_PER_SECOND;
  }
  const rounded = Math.round(parsed);
  return VALID_FRAMES_PER_SECOND.has(rounded) ? rounded : DEFAULT_FRAMES_PER_SECOND;
}

export async function createNewBlankQuickSession(userId) {
  try {
    // Create a new session with optional userId or other default fields
    const userData = await User.findById(userId).select('videoFramesPerSecond').lean();
    const framesPerSecond = resolveFramesPerSecond(userData?.videoFramesPerSecond);
    const newSessionData = await VideoSession.create({ userId, framesPerSecond }); // Ensure schema supports this field
    return newSessionData._id.toString();
  } catch (error) {
    console.error('Error creating new session:', error);
    throw error; // Re-throw to handle it at a higher level if needed
  }
}


export async function setSessionQuickGenerationPending(userId, payload) {
  await getDBConnectionString();
  const { sessionId } = payload;

  const sessionData = await VideoSession.findOne({ _id: sessionId });

  const userData = await User.findById(userId);

  const selectedInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  payload.selectedInferenceModel = selectedInferenceModel;
  
  const creditsRequiredForOperation = getCreditsRequiredForQuickVideo(payload);


  const updateResult = await User.updateOne(
    { _id: userId, generationCredits: { $gt: creditsRequiredForOperation } },
    { $inc: { generationCredits: -creditsRequiredForOperation } }
  );

  // If no documents were updated, it means the user either doesn't exist or doesn't have enough credits
  if (updateResult.modifiedCount === 0) {


    await VideoSession.updateOne({ _id: sessionId }, { expressGenerationPending: false });

    throw new Error('Insufficient credits');
  }

  await maybeTriggerAutoRecharge(userId);

  await deleteAllFrameGenerations(sessionId);

  const previousVideoLink = sessionData.videoLink;

  if (previousVideoLink) {
    const pwd = process.cwd();

    let previousVideoLocalLink = `${pwd}/assets/${previousVideoLink}`;

    if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
      previousVideoLocalLink = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', previousVideoLink);
    }

    try {
      fs.unlinkSync(previousVideoLocalLink);
    } catch (err) {
      console.error(`Error deleting file ${previousVideoLocalLink}:`, err);
    }
  }

  // delete any unlocked FrameGeneration, AudioGeneration, VideoGeneration requests
  await VideoGeneration.deleteMany({ videoSessionId: sessionId, rowLocked: false });
  await AudioGeneration.deleteMany({ sessionId: sessionId, rowLocked: false });
  await FrameGeneration.deleteMany({ sessionId: sessionId, rowLocked: false });

  if (sessionData.expressGenerativeVideoRequired) {
    InitExpressGenerationStatus['ai_video_generation'] = 'INIT';
  }
  // Update session data using updateOne
  const generationStatus = await VideoSession.updateOne({ _id: sessionId }, {
    videoLink: null,
    expressGenerationStatus: InitExpressGenerationStatus,
    frameGenerationPending: false,
    audioGenerationPending: false,
    videoGenerationPending: false,
  }, { new: true });
}


export async function splitTextIntoLineItems(lineItems) {

  let baseLineItems = lineItems;
  if (sceneCutoffType === 'auto') {
    baseLineItems = [];
    // Divide lineItems into groups of 5
    for (let i = 0; i < lineItems.length; i += 5) {
      const group = lineItems.slice(i, i + 5);
      // Normalize the content for each group
      const normalizedGroup = await divideTextIntoGroups(group);
      // Concatenate the result to speechListLineItems
      baseLineItems.push(...normalizedGroup);
    }
  }

  return baseLineItems;
}



export async function createQuickSession(userId, payload) {
  await getDBConnectionString();

  let { lineItems, sessionId, duration, animation, 
    setAutoDurationPerScene = true,
    theme, musicPrompt, speakerType,
    speechLanguage = 'eng',
     subtitlesLanguage = 'eng',
    fontFamily = 'Times New Roman',
    subtitlesTranslationRequired,
     speechTranslationRequired,
    speechNormalizationRequired,
    speechRequired,
    backgroundMusicRequired,
    textLanguage,
    videoType,
    sceneCutoffType,
    themeType,
    themeData,
    addSubtitlesRequired,
    addTranscriptionsRequired,
    addBannerToComposition,
    bannerText,
    aspectRatio,
    imageModel,
    ttsProvider,
    languageCode,
    languageCodes,
    speakerVoiceId,
    speakerLabel,
    speakerDetails,
    userSelectedMusic,
    autoSelectMusic,
    imageStyle,
    musicProvider,
    generativeVideoRequired,
    videoGenerationModel,
    useEndFrame,
    subtitleFont,
    subtitleWordAnimation,
    videoCategory,

  } = payload;



  let useShortForm = false;
  if ((imageModel === 'RECRAFTV3' && imageStyle) || (imageModel.startsWith("IMAGEN"))) {
    useShortForm = true;
  }

  // set defaults if missing
  if (!lineItems) {
    lineItems = [];
  }

  if (!duration) {
    duration = 2;
  }

  if (!setAutoDurationPerScene) {
    setAutoDurationPerScene = false;
  }

  if (!theme) {
    theme = '';
  }

  if (!musicPrompt) {
    musicPrompt = '';
  }

  if (!speechLanguage) {
    speechLanguage = 'eng';
  }

  if (!subtitlesLanguage) {
    subtitlesLanguage = 'eng';
  }

  if (!fontFamily) {
    fontFamily = 'Times New Roman';
  }

  if (!textLanguage) {
    textLanguage = 'eng';
  }

  if (!videoType) {
    videoType = 'Slideshow';
  }

  if (!sceneCutoffType) {
    sceneCutoffType = 'auto';
  }

  if (!themeType) {
    themeType = 'basic';
  }

  if (!themeData) {
    themeData = '';
  }

  if (!imageModel) {
    imageModel = 'DALLE3';
  }

  if (!speakerType) {
    speakerType = 'alloy';
  }

  if (!aspectRatio) {
    aspectRatio = '16:9';
  }

  lineItems = lineItems.map((line) => line.trim()).filter(Boolean);

  const lineItemString = lineItems.join('\n');

  const moderationPassed = await getModerationForNarrative(lineItemString);

  if (!moderationPassed) {
    throw new Error('Content moderation failed');
  }

  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  const userData = await User.findOne({ _id: userId });

  if (!userData) {
    throw new Error('User not found');
  }

  const userInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);


  let bannerTextItem;
  if (addBannerToComposition) {
    if (bannerText && bannerText.trim().length > 0) {
      bannerTextItem = bannerText;
    } else {
      bannerTextItem = await getBannerTextForSession(lineItems);
    }
  }

  if (sceneCutoffType === 'auto') {
    const baseLineItems = [];
    // Divide lineItems into groups of 5
    for (let i = 0; i < lineItems.length; i += 5) {
      const group = lineItems.slice(i, i + 5);
      // Normalize the content for each group
      const normalizedGroup = await divideTextIntoGroups(group);
      // Concatenate the result to speechListLineItems
      baseLineItems.push(...normalizedGroup);
    }
    lineItems = baseLineItems;
  }

  if (!speakerType) {
    speakerType = 'alloy';
  }


  const sessionData = await VideoSession.findOne({ _id: sessionId });

  if (sessionData.expressGenerationPending) {
    throw new Error('Generation already in progress');
  }
  
  let themeJsonString;
  let themePayload;
  if (themeType === 'basic') {

    const themeEffective = `Custom keywords: ${theme}`;
    const themeLineItems = [...lineItems, themeEffective];
    const themeDataString = themeLineItems.join(' ');
    themePayload = await generateThemeKeywords(themeDataString, aspectRatio, userInferenceModel);

    themeJsonString = JSON.stringify(themePayload);


  } else if (themeType === 'parentText') {

    const themeDataString = themeData;
    // Generate new theme keywords if theme is not provided or has 20 or fewer CSV items
    themePayload = await generateThemeKeywords(themeDataString, aspectRatio, userInferenceModel);
    themeJsonString = JSON.stringify(themePayload);

  } else if (themeType === 'derivedText') {
    const parentThemeData = sessionData.parentJsonTheme;
    const derivedThemeText = themeData;
    themePayload = await updateThemeWithText(parentThemeData, derivedThemeText, aspectRatio, userInferenceModel);
    themeJsonString = JSON.stringify(themePayload);

  } else if (themeType === 'parentJson') {

    themeJsonString = themeData;

  } else if (themeType === 'derivedJson') {

    themeJsonString = themeData;
  }


  let subtitlesListItems = [];
  let speechListItems = [];

  let speechListLineItems = lineItems;

  if (speechNormalizationRequired) {
    speechListLineItems = [];

    // Divide lineItems into groups of 5
    for (let i = 0; i < lineItems.length; i += 5) {
      const group = lineItems.slice(i, i + 5);

      // Normalize the content for each group
      const normalizedGroup = await normalizeTextContent(group);

      // Concatenate the result to speechListLineItems
      speechListLineItems.push(...normalizedGroup);
    }
  }

  if (subtitlesTranslationRequired) {
    const subtitleLanguageName = popularLanguages.find((lang) => lang.value === subtitlesLanguage).label;
    for (let i = 0; i < lineItems.length; i += 5) {
      const group = lineItems.slice(i, i + 5);
      const translatedGroup = await translateTextContent(group, subtitleLanguageName);
      subtitlesListItems.push(...translatedGroup);
    }
  } else {
    subtitlesListItems = lineItems;
  }


  if (speechTranslationRequired && speechLanguage !== subtitlesLanguage && speechLanguage !== textLanguage) {
    const speechLanguageName = popularLanguages.find((lang) => lang.value === speechLanguage).label;
    for (let i = 0; i < speechListLineItems.length; i += 5) {
      const group = subtitlesListItems.slice(i, i + 5);
      const translatedGroup = await translateTextContent(group, speechLanguageName);
      speechListItems.push(...translatedGroup);
    }
  } else if (speechLanguage === textLanguage) {
    speechListItems = lineItems;
  } else if (speechTranslationRequired && speechLanguage === subtitlesLanguage) {
    speechListItems = subtitlesListItems;
  } else {
    speechListItems = speechListLineItems;
  }

  let promptList = [];
  const chunkSize = 1;

  for (let i = 0; i < lineItems.length; i += chunkSize) {



    if (chunkSize === 1) {

      let chunk = lineItems[i];


      let promptForChunk = await updatePromptWithTheme(chunk, themeJsonString, aspectRatio, userInferenceModel, useShortForm,
        videoTone,
      );


      // remove new lines from promptForChunk
      promptForChunk = promptForChunk.replace(/(\r\n|\n|\r)/gm, " ");
      promptList.push(promptForChunk);

    } else {
      let chunk = lineItems.slice(i, i + chunkSize);

      let promptsForChunk = await generatePromptsForText(chunk, themeJsonString, aspectRatio, userInferenceModel, useShortForm);

      if (promptsForChunk.length > chunk.length) {
        promptsForChunk = promptsForChunk.slice(0, chunk.length);
      } else if (promptsForChunk.length < chunk.length) {
        while (promptsForChunk.length < chunk.length) {
          promptsForChunk.push(promptsForChunk[promptsForChunk.length - 1]);
        }
      }
      promptList.push(...promptsForChunk);

    }
  }


  // if promptList length is greater than lineItems length, then remove the extra prompts
  if (promptList.length > lineItems.length) {
    promptList = promptList.slice(0, lineItems.length);
  }



  let musicTheme;


  if (musicPrompt) {
    musicTheme = musicPrompt;
  } else {
    musicTheme = await getMusicForTextTheme(themeJsonString, userInferenceModel, musicProvider);
  }





  const n = promptList.length;
  let durationOffset = 0;
  let animationsList = [];


  if (animation && animation === 'preset_short_animation') {
    await VideoSession.updateOne({
      _id: sessionId,
    }, {
      useDefaultAnimationPresets: true,
    });
  }


  const newSessionLayers = promptList.map((prompt, pIdx) => {


    if (animation) {
      if (animation === 'preset_short_animation') {
        // do nothing we update after
      } else {
        if (animation === 'random') {
          const possibleAnimations = ['zoom_in', 'zoom_out', 'pan_left_to_right', 'pan_right_to_left'];
          const randomIndex = Math.floor(Math.random() * possibleAnimations.length);
          animation = possibleAnimations[randomIndex];
          animationsList = getAnimationPresetForType(videoType, animation, canvasDimensions);


        } else if (animation === 'alternate_zoom') {
          if (pIdx % 2 === 0) {
            animationsList = getAnimationPresetForType(videoType, 'zoom_in', canvasDimensions);
          } else {
            animationsList = getAnimationPresetForType(videoType, 'zoom_out', canvasDimensions);
          }
        } else if (animation === 'alternate_pan') {
          if (pIdx % 2 === 0) {
            animationsList = getAnimationPresetForType(videoType, 'pan_left_to_right', canvasDimensions);
          } else {
            animationsList = getAnimationPresetForType(videoType, 'pan_right_to_left', canvasDimensions);
          }

        } else if (animation === 'random') {
          const possibleAnimations = ['zoom_in', 'zoom_out', 'pan_left_to_right', 'pan_right_to_left'];
          const randomIndex = Math.floor(Math.random() * possibleAnimations.length);
          animation = possibleAnimations[randomIndex];
          animationsList = getAnimationPresetForType(videoType, animation, canvasDimensions);

        } else {
          animationsList = getAnimationPresetForType(videoType, animation, canvasDimensions);
        }
      }
    }

    const initActiveItemList = [{
      'id': 'item_0',
      'type': 'image',
      'x': 0,
      'y': 0,
      'width': canvasDimensions.width,
      'height': canvasDimensions.height,
      'src': '',
      'is_base_image': true,
      'animations': animationsList,
    }];

    if (pIdx === 0 && addBannerToComposition) {
      const bannerItems = getBannerDisplayActiveItemsForSession(bannerTextItem, canvasDimensions);
      if (bannerItems && bannerItems.length > 0) {
        initActiveItemList.push(...bannerItems);
      }

    }

    let currentGenerationStatus = 'INIT';
    if (videoType === 'Slideshow') {
      currentGenerationStatus = 'PENDING';
    } else {
      if (pIdx === 0) {
        currentGenerationStatus = 'PENDING';
      } else {
        currentGenerationStatus = 'INIT';
      }
    }

    const newSession = {
      userId,
      generations: [],
      activeSelectedImage: '',
      activeGeneratedImage: '',
      activeOutpaintedImage: '',
      generationStatus: '',
      outpaintStatus: '',
      witnesses: [],
      intermediates: [],
      lastWitnessSavedAt: null,
      generationError: null,
      outpaintError: '',
      generationStatus: currentGenerationStatus,
      outpaintStatus: 'INIT',
      prompt: prompt,
      activeItemList: initActiveItemList,
    };

    const durationPerScene = duration ? duration : 2;

    const layerPayload = {
      imageSession: newSession,
      prompt: prompt,
      status: "pending",
      duration: durationPerScene,
      durationOffset: durationOffset,
    };

    durationOffset += durationPerScene;
    return layerPayload;
  });


  let themeAddPayload = {};
  if (themeType === 'basic') {
    themeAddPayload['parentJsonTheme'] = themeJsonString;
  } else if (themeType === 'parentText') {
    themeAddPayload['parentTextTheme'] = themeData;
    themeAddPayload['parentJsonTheme'] = themeJsonString;

  } else if (themeType === 'derivedText') {
    themeAddPayload['derivedTextTheme'] = themeData;
    themeAddPayload['derivedJsonTheme'] = themeJsonString;

  } else if (themeType === 'parentJson') {
    themeAddPayload['parentJsonTheme'] = themeData;

  } else if (themeType === 'derivedJson') {
    themeAddPayload['derivedJsonTheme'] = themeData;
  }
  // Update session data using updateOne
  let updatePayload = {
    layers: newSessionLayers,
    expressGenerationPending: true,
    expressGenerationPaused: false,
    videoGenerationPending: true,
    isExpressGeneration: true,
    setAutoDurationPerScene: setAutoDurationPerScene || false,
    'expressGenerationStatus.prompt_generation': 'COMPLETED',
    expressGenerationCreated: new Date(),

  };

  if (generativeVideoRequired) {
    updatePayload['expressGenerativeVideoRequired'] = true;
    updatePayload['expressGenerativeVideoModel'] = videoGenerationModel;
    updatePayload['expressGenerativeVideoUseEndFrame'] = useEndFrame;
  }

  updatePayload = { ...updatePayload, ...themeAddPayload };

  await VideoSession.updateOne({ _id: payload.sessionId }, updatePayload, { new: true });

  const sessionSaveResponse = await VideoSession.findOne({ _id: payload.sessionId });



  if (videoType === 'Slideshow') {
    let contentFilterRating = 3;
    if (imageModel) {
      let userContentFilterRating = await User.findOne({ _id: userId }, { contentFilterRating: 1 });

      userContentFilterRating = userContentFilterRating.contentFilterRating;

      if (userContentFilterRating) {
        contentFilterRating = userContentFilterRating
      }
    }


    const imageGenerationRequests = sessionSaveResponse.layers.slice(-n).map(async (layer) => {
      const promptText = `${layer.prompt} `;

      let generationPayload = {
        videoSessionId: sessionId,
        layerId: layer._id.toString(),
        prompt: promptText,
        model: imageModel ? imageModel : 'DALLE3',
        userId: userId,
        isBaseGeneration: true,
        isBatchGeneration: true,
        aspectRatio: aspectRatio,
        contentFilterRating: contentFilterRating,
        retryOnFailure: true,
      };
      if (imageModel === 'RECRAFTV3' && imageStyle) {
        generationPayload['imageStyle'] = imageStyle;
      }



      await addImageGeneratorRequest(userId, generationPayload, false);
    });

    await Promise.all(imageGenerationRequests);



    if (speechRequired) {

      if (addTranscriptionsRequired) {

        const audioLayerPayload = {
          generationType: 'speech',
          speaker: speakerType,
          promptList: speechListItems,
          subtitlesList: subtitlesListItems,
          addSubtitles: true,
          fontSize: 40,
          fontColor: '#f5f5f5',
          fontFamily: fontFamily,
          backgroundColor: 'rgba(3, 7, 18, 0.8)',
          videoSessionId: sessionId,
          subtitlesLanguage: subtitlesLanguage,
          addSubtitlesRequired: addSubtitlesRequired,
          addTranscriptionsRequired: addTranscriptionsRequired,
          ttsProvider: ttsProvider,
          languageCode: languageCode,
          languageCodes,
          speakerVoiceId,
          speakerLabel,
          speakerDetails,
          defaultSelected: true,
          subtitleFont: subtitleFont,
          subtitleWordAnimation: subtitleWordAnimation,
        };

        const updateCredits = false;
        await requestGenerateTranscriptSpeech(userId, audioLayerPayload, updateCredits);

      } else {

        const audioLayerPayload = {
          generationType: 'speech',
          speaker: speakerType,
          promptList: speechListItems,
          subtitlesList: subtitlesListItems,
          addSubtitles: true,
          fontSize: 40,
          fontColor: '#f5f5f5',
          fontFamily: fontFamily,
          backgroundColor: 'rgba(3, 7, 18, 0.8)',
          videoSessionId: sessionId,
          subtitlesLanguage: subtitlesLanguage,
          addSubtitlesRequired: addSubtitlesRequired,
          ttsProvider: ttsProvider,
          languageCode: languageCode,
          languageCodes,
          speakerVoiceId,
          speakerLabel,
          speakerDetails,
          defaultSelected: true,
          subtitleFont: subtitleFont,
          subtitleWordAnimation: subtitleWordAnimation,
        };

        const updateCredits = false;
        await requestGenerateLayeredSpeech(userId, audioLayerPayload, updateCredits);
      }



    } else {
      // update all layers to set frameGenerationPending to true
      await VideoSession.updateOne(
        { _id: sessionId },
        { $set: { 'layers.$[].frameGenerationPending': true } },
        { new: true }
      );
    }

    const numLayers = sessionSaveResponse.layers.length;

    const audioDuration = numLayers * 10;


    const musicGenerationPayload = {
      sessionId: sessionId,
      prompt: musicTheme,
      isInstrumental: true,
      userSelectedMusic: userSelectedMusic,
      autoSelectMusic: autoSelectMusic,
      model: musicProvider,
      duration: audioDuration,
    };


    if (CURRENT_ENV !== 'development' && backgroundMusicRequired) {
      await selectOrGenerateMusicForSession(userId, musicGenerationPayload);
    }

  } else if (videoType === 'Infinitezoom') {

    const slideGenerationRequests = sessionSaveResponse.layers.slice(-n).map((layer) => {
      const promptText = `${layer.prompt}`;
      let generationPayload = {
        videoSessionId: sessionId,
        layerId: layer._id.toString(),
        prompt: promptText,
        model: imageModel ? imageModel : 'FLUX1PRO',
        userId: userId,
        isBaseGeneration: true,
        isBatchGeneration: true,
        aspectRatio: aspectRatio,
      };
      if (imageModel === 'RECRAFTV3' && imageStyle) {
        generationPayload['imageStyle'] = imageStyle;
      }

      return generationPayload;
    });

    await createInfiniteZoomImageRequests(sessionId, userId, animation, aspectRatio, slideGenerationRequests);


    if (speechRequired) {
      const audioLayerPayload = {
        generationType: 'speech',
        speaker: speakerType,
        promptList: speechListItems,
        subtitlesList: subtitlesListItems,
        addSubtitles: true,
        fontSize: 40,
        fontColor: '#f5f5f5',
        fontFamily: fontFamily,
        backgroundColor: 'rgba(3, 7, 18, 0.8)',
        videoSessionId: sessionId,
        subtitlesLanguage: subtitlesLanguage,
        addSubtitlesRequired: addSubtitlesRequired,
        ttsProvider: ttsProvider,
        languageCode: languageCode,
        languageCodes,
        speakerVoiceId,
        speakerLabel,
        speakerDetails,
        defaultSelected: true,
        subtitleFont: subtitleFont,
        subtitleWordAnimation: subtitleWordAnimation,
      };

      const updateCredits = false;
      await requestGenerateLayeredSpeech(userId, audioLayerPayload, updateCredits);
    } else {
      // update all layers to set frameGenerationPending to true
      await VideoSession.updateOne(
        { _id: sessionId },
        { $set: { 'layers.$[].frameGenerationPending': true } },
        { new: true }
      );
    }

    const musicGenerationPayload = {
      sessionId: sessionId,
      prompt: musicTheme,
      isInstrumental: true,
      userSelectedMusic: userSelectedMusic,
      autoSelectMusic: autoSelectMusic,
      model: musicProvider,
    };

    await selectOrGenerateMusicForSession(userId, musicGenerationPayload);

  }


  const isPremiumUser = userData.isPremiumUser;
  const selectedNotifyOnCompletion = userData.selectedNotifyOnCompletion;
  const isEmailVerified = userData.isEmailVerified;
  let notifyOnCompletion = false;

  let notificationEmail;

  if (selectedNotifyOnCompletion && isEmailVerified && userData.email) {
    notifyOnCompletion = true;
    notificationEmail = userData.email;
  }

  await VideoSession.updateOne({
    _id: sessionId,
  }, {
    expressGenerationPending: true,
    expressGenerationPaused: false,
    // videoGenerationPending: true,
    textList: lineItems,
    quickSessionCreatedAt: new Date(),
    expressGenerationAnimation: animation,
    expressGenerationType: videoType,
    addBannerToComposition: addBannerToComposition,
    bannerText: bannerTextItem,
    aspectRatio: aspectRatio,
    notifyOnCompletion: notifyOnCompletion,
    notificationSent: false,
    notificationEmail: notificationEmail,
    expressGenerativeSpeechRequired: speechRequired,


  }, { new: true });


}


export async function selectOrGenerateMusicForSession(userId, musicGenerationPayload) {

  const { userSelectedMusic, autoSelectMusic, } = musicGenerationPayload;
  if (userSelectedMusic) {
    await createBackgroundMusicFromUserSelection(userId, musicGenerationPayload);
  } else if (autoSelectMusic) {
    await createBackgroundMusicFromLibrary(userId, musicGenerationPayload);
  } else {


    await createBackgroundDefaultSelectedMusicRequest(userId, musicGenerationPayload);
  }
}


export async function getQuickSessionGenerationStatus(sessionId) {
  await getDBConnectionString();

  if (!sessionId) {
    return;
  }

  const sessionData = await VideoSession.findOne({ _id: sessionId })
    .select([
      'remoteURL',
      'videoLink',
      'expressGenerationStatus',
      'expressGenerationFailed',
      'expressGenerationPending',
      'expressGenerationPaused',
      'videoGenerationPending',
      'expressGenerationError',
      'expressGenerativeVideoModel',
      'expressGenerativeVideoModelSubType',
      'videoGenerationModelSubType',
      'inferenceModel',
      'expressGenerationInferenceModel',
    ].join(' '))
    .lean();

  if (!sessionData) {
    throw new Error('Session not found');
  }

  const provider =
    sessionData?.expressGenerativeVideoModel ||
    sessionData?.expressGenerativeVideoModelSubType ||
    sessionData?.videoGenerationModelSubType ||
    null;

  const expressGenerationStatus = sessionData.expressGenerationStatus;
  const expressGenerationFailed = sessionData.expressGenerationFailed;
  const expressGenerationPending = sessionData.expressGenerationPending;
  const expressGenerationPaused = sessionData.expressGenerationPaused;
  const videoGenerationPending = sessionData.videoGenerationPending;
  const videoCompleted = Boolean(sessionData.remoteURL || sessionData.videoLink);
  const sessionInferenceModel = sessionData.expressGenerationInferenceModel || sessionData.inferenceModel || null;
  const resolvedVideoLink = resolveQuickSessionMediaUrl(sessionData.videoLink);
  const resolvedRemoteUrl = resolveQuickSessionMediaUrl(sessionData.remoteURL);

  // create timestamped list of images by layer duration

//   const sessionImages = sessionData.layers.map(function(layer) {
//     return {
//       layerId: layer._id.toString(),
//       prompt: layer.prompt,
//       duration: layer.duration,
//     }
// });




  if (expressGenerationFailed) {
    return {
      status: 'FAILED',
      provider,
      inferenceModel: sessionInferenceModel,
      expressGenerationInferenceModel: sessionInferenceModel,
      expressGenerationStatus: expressGenerationStatus,
      expressGenerationError: sessionData.expressGenerationError,
    }
  }

  if (expressGenerationPaused) {
    return {
      status: 'PAUSED',
      provider,
      inferenceModel: sessionInferenceModel,
      expressGenerationInferenceModel: sessionInferenceModel,
      expressGenerationStatus: expressGenerationStatus,
      expressGenerationPaused: true,
    }
  }

  if (videoCompleted && !videoGenerationPending) {
    return {
      status: 'COMPLETED',
      provider,
      inferenceModel: sessionInferenceModel,
      expressGenerationInferenceModel: sessionInferenceModel,
      expressGenerationStatus: expressGenerationStatus,
      videoLink: resolvedVideoLink,
      remoteURL: resolvedRemoteUrl,
    }
  }

  if (expressGenerationPending || videoGenerationPending) {
    return {
      status: 'PENDING',
      provider,
      inferenceModel: sessionInferenceModel,
      expressGenerationInferenceModel: sessionInferenceModel,
      expressGenerationStatus: expressGenerationStatus
    }
  } else {
    return {
      status: 'COMPLETED',
      provider,
      inferenceModel: sessionInferenceModel,
      expressGenerationInferenceModel: sessionInferenceModel,
      expressGenerationStatus: expressGenerationStatus,
      videoLink: resolvedVideoLink,
      remoteURL: resolvedRemoteUrl,
    }
  }
}

export async function getQuickSessionDetails(sessionId) {
  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });

  if (!sessionData) {
    throw new Error('Session not found');
  }
  
  const videoLink = resolveQuickSessionMediaUrl(sessionData.videoLink);
  const remoteUrl = resolveQuickSessionMediaUrl(sessionData.remoteURL);

  const publishedTags = Array.isArray(sessionData.publishedTags)
    ? sessionData.publishedTags
    : typeof sessionData.publishedTags === 'string'
      ? sessionData.publishedTags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];

  const publishedMeta = {
    ispublishedVideo: Boolean(sessionData.ispublishedVideo),
    publishedTitle: sessionData.publishedTitle || null,
    publishedDescription: sessionData.publishedDescription || null,
    publishedTags,
    publishedAspectRatio: sessionData.publishedAspectRatio || null,
    publishedVideoURL: resolveQuickSessionMediaUrl(sessionData.publishedVideoURL) || remoteUrl || null,
    publishedAt: sessionData.publishedAt || null,
    publishedOriginalPrompt: sessionData.publishedOriginalPrompt || null,
    publishedSplashImage: resolveQuickSessionMediaUrl(sessionData.publishedSplashImage) || null,
    publishedImageModel: sessionData.publishedImageModel || null,
    publishedVideoModel: sessionData.publishedVideoModel || null,
    publishedHasSubtitles: typeof sessionData.publishedHasSubtitles === 'boolean'
      ? sessionData.publishedHasSubtitles
      : null,
    publishedSessionLanguage: sessionData.publishedSessionLanguage || null,
    publishedLanguageString: sessionData.publishedLanguageString || null,
    publishedPublicationId: sessionData.publishedPublicationId || null,
  };

  const sessionLanguage =
    typeof sessionData.sessionLanguage === 'string' && sessionData.sessionLanguage.trim().length > 0
      ? sessionData.sessionLanguage.trim()
      : typeof sessionData.language === 'string' && sessionData.language.trim().length > 0
        ? sessionData.language.trim()
        : null;
  const languageString =
    typeof sessionData.languageString === 'string' && sessionData.languageString.trim().length > 0
      ? sessionData.languageString.trim()
      : null;
  const hasSubtitles =
    typeof sessionData.hasSubtitles === 'boolean'
      ? sessionData.hasSubtitles
      : typeof sessionData.has_subtitles === 'boolean'
        ? sessionData.has_subtitles
        : typeof sessionData.enableSubtitles === 'boolean'
          ? sessionData.enableSubtitles
          : null;

  return {
    _id: sessionData._id,
    videoLink,
    remoteURL: remoteUrl,
    textList: sessionData.textList,
    parentJsonTheme: sessionData.parentJsonTheme,
    derivedJsonTheme: sessionData.derivedJsonTheme,
    parentTextTheme: sessionData.parentTextTheme,
    derivedTextTheme: sessionData.derivedTextTheme,
    sessionMessages: sessionData.sessionMessages,
    videoGenerationPending: sessionData.videoGenerationPending,
    expressGenerationPending: sessionData.expressGenerationPending,
    expressGenerationPaused: sessionData.expressGenerationPaused,
    expressGenerationStatus: sessionData.expressGenerationStatus,
    inputPrompt: sessionData.inputPrompt,
    inferenceModel: sessionData.expressGenerationInferenceModel || sessionData.inferenceModel || null,
    expressGenerationInferenceModel: sessionData.expressGenerationInferenceModel || sessionData.inferenceModel || null,
    aspectRatio: sessionData.aspectRatio || null,
    sessionLanguage,
    languageString,
    hasSubtitles,
    has_subtitles: hasSubtitles,
    ...publishedMeta,
  };
}

export async function setQuickGenerationTheme(userId, payload) {


  await getDBConnectionString();
  const { sessionId, customTheme, aspectRatio } = payload;

  const userData = await User.findById(userId);

  const userInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  const themeData = await generateThemeKeywords(customTheme, aspectRatio, userInferenceModel);

  const themeJsonString = JSON.stringify(themeData);

  let sessionData = await VideoSession.findOne({ _id: sessionId });

  sessionData.parentJsonTheme = themeJsonString;

  const dataRes = await sessionData.save();

  return {
    _id: dataRes._id,
    videoLink: dataRes.videoLink,
    textList: dataRes.textList,
    parentJsonTheme: dataRes.parentJsonTheme,
  };

}

export async function updateQuickGenerationTheme(userId, payload) {
  await getDBConnectionString();
  let { sessionId, derivedTextTheme, parentJsonTheme, aspectRatio } = payload;


  
  let sessionData = await VideoSession.findOne({ _id: sessionId });

  const userData = await User.findById(userId);

  const userInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  const themeData = await updateThemeWithText(parentJsonTheme, derivedTextTheme, aspectRatio, userInferenceModel);

  // update the parent json theme with actors from the derived theme.

  let parentJsonParsed = JSON.parse(parentJsonTheme);
  const newActors = themeData.actors;

  let existingActors = parentJsonParsed.actors;

  newActors.forEach((newActorItem) => {
    const itemExistsInOriginal = existingActors.find((actorItem) => actorItem.name.trim().toLowerCase() === newActorItem.name.trim().toLowerCase());
    if (!itemExistsInOriginal) {
      existingActors.push({
        ...newActorItem,
        frequency: 1,
      });
    } else {
      existingActors.frequency += 1;
    }
  });


  parentJsonParsed.actors = existingActors;


  parentJsonTheme = JSON.stringify(parentJsonParsed);



  const themeJsonString = JSON.stringify(themeData);
  sessionData.derivedJsonTheme = themeJsonString;
  sessionData.parentJsonTheme = parentJsonTheme;
  const dataRes = await sessionData.save();

  return {
    _id: dataRes._id,
    videoLink: dataRes.videoLink,
    textList: dataRes.textList,
    parentJsonTheme: dataRes.parentJsonTheme,
    derivedJsonTheme: dataRes.derivedJsonTheme,
  };
}

export async function updatePrimaryJsonTheme(userId, payload) {
  await getDBConnectionString();
  const { sessionId, parentJsonTheme } = payload;
  let sessionData = await VideoSession.findOne({ _id: sessionId });

  sessionData.parentJsonTheme = parentJsonTheme;
  const dataRes = await sessionData.save();

}

export async function setQuickGenerationPaused(userId, payload) {
  await getDBConnectionString();
  const { sessionId } = payload;

  const sessionData = await VideoSession.findOne({ _id: sessionId });

  if (!sessionData) {
    throw new Error('Session not found');
  }

  // Update session data using updateOne
  await VideoSession.updateOne({ _id: sessionId }, {
    expressGenerationPending: false,
    videoGenerationPending: false,
  }, { new: true });

}

export async function updateDerivedJsonTheme(userId, payload) {
  await getDBConnectionString();
  const { sessionId, derivedJsonTheme } = payload;
  let sessionData = await VideoSession.findOne
    ({ _id: sessionId });

  sessionData.derivedJsonTheme = derivedJsonTheme;
  const dataRes = await sessionData.save();


}

export const __testOnly__ = {
  resolveQuickSessionMediaUrl,
};
