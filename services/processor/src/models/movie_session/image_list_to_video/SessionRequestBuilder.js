import VideoSession from "../../../schema/VideoSession.js";
import { getCanvasDimensionsForAspectRatio } from "../../../utils/CanvasUtils.js";
import {
  getResourceListForScreenplay, createThemeForResourceJson, updatePromptWithTheme,
  updateCharacterPromptWithTheme
} from "../../agent/MovieCreatorAgent.js";


import { getDBConnectionString } from "../../DBString.js";
import { addImageGeneratorRequest, addImageUpscaleRequest } from '../../Images.js';
import {
  requestApplyAutoSynchronizeBeats, createGenerateSoundRequest,
  createGenerateMusicRequest,
  createGenerateSpeechRequest,
  updateCreditsAndCreateGenerateSpeechRequest,
  resolveBackingTrackTargetDurationSeconds,
  buildBackingTrackGenerationMeta,

} from '../../audio/Audio.js';
import { updateAdVideoCharacterPromptWithTheme, updateAdVideoPromptWithTheme } from '../ad_creator/AdAgentPrompts.js';

import { getMusicForTextTheme } from '../../OpenAI.js';
import { assignCharactersAndInstructionsToScenes } from '../MovieGeneratorUtils.js';
import { translateSpeech } from '../../agent/AudioCreatorAgent.js';
import {
  buildSpeechSubtitleLayerFields,
  buildSpeechSubtitleTextMap,
  resolveSubtitleLanguageOption,
} from '../SubtitleLanguage.js';
import User from "../../../schema/User.js";
import axios from 'axios';
import { isContainerRuntime } from '../../../utils/EnvironmentUtils.js';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { stripSoundEffectsFromMovieResourceList } from './SanitizeMovieResourceList.js';
import { resolveEffectiveOutroFocusAreaForImageListToVideo } from './OutroFocusAreaResolver.js';
import {
  createGeneratedOutroTileItems,
  createOutroCtaTextItems,
  createOutroFadeOverlayItem,
} from './OutroLayerItems.js';
import { generateOutroCompositionAssetsFromImageList } from '../../api/OutroImageGenerationAPI.js';
import {
  buildOutroImageMetadata,
  normalizeFooterMetadataList,
} from '../../../utils/VideoOverlayMetadata.js';
import {
  EXPRESS_VIDEO_BILLING_STAGES,
  buildInitialExpressVideoCreditCharges,
  chargeExpressVideoStageCredits,
} from "../../ExpressVideoStageBilling.js";
import {
  getCurrentAPIKeyUsageContext,
  normalizeAPIKeyUsageContext,
} from "../../api/RequestAuthContext.js";
import {
  buildInitialExpressStepGeneration,
  markExpressStepStageCompleted,
} from "../../ExpressVideoStepState.js";
import {
  CUSTOM_MODEL_KEYS,
  hasCustomOperation,
} from "../../custom/VideoCustomModelConfig.js";
import {
  isOpenAITTSForcedLanguage,
  resolveTTSProviderForLanguage,
} from "../TTSLanguagePolicy.js";
import { normalizeInferenceModel } from "../../../consts/InferenceModels.js";
import { normalizeTTSSpeakerGender } from "../../../consts/TTSSpeakers.js";
import {
  filterDockerSpeakerOptions,
  isDockerTTSProviderAvailable,
  resolveDockerBackingTrackModel,
  resolveDockerTTSProvider,
} from "../../../consts/DockerAudioAvailability.js";
import { hasConnectedSpeechAudioLayer } from '../../video/LipSyncLayerState.js';
import { normalizeExpressVideoPricingRateClass } from '../../../consts/pricing/ExpressVideoPricingDistribution.js';

const MEDIA_DOWNLOAD_TIMEOUT_MS = Number.isFinite(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS)))
  : 180000;
const NARRATOR_SPEECH_VOLUME = 100;
const CHARACTER_SPEECH_VOLUME = 85;
const EXPRESS_BACKING_TRACK_VOLUME = 35;
const EXPRESS_LYRIA_BACKING_TRACK_VOLUME = 45;
const DEFAULT_FRAMES_PER_SECOND = 24;
const OUTRO_LAYER_DURATION_SECONDS = 8;
const IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL = 'NANOBANANAPROEDIT';
const IMAGE_LIST_TO_VIDEO_IMAGE_EDIT_REQUEST_DELAY_MS = Number.isFinite(Number(process.env.IMAGE_LIST_TO_VIDEO_IMAGE_EDIT_REQUEST_DELAY_MS))
  ? Math.max(0, Math.floor(Number(process.env.IMAGE_LIST_TO_VIDEO_IMAGE_EDIT_REQUEST_DELAY_MS)))
  : 500;
const OUTRO_IMAGE_EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/tiff': '.tiff',
  'image/gif': '.gif',
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function resolveImageListItemRequiresEnhancement(imageMeta = {}) {
  return typeof imageMeta?.requires_enhancement === 'boolean'
    ? imageMeta.requires_enhancement
    : typeof imageMeta?.requiresEnhancement === 'boolean'
      ? imageMeta.requiresEnhancement
      : false;
}

function normalizeBackingTrackProvider(value) {
  return value === 'LYRIA2' ? 'LYRIA3' : value;
}

function resolveExpressBackingTrackVolume(musicProvider) {
  return musicProvider === 'LYRIA3' || musicProvider === 'LYRIA2'
    ? EXPRESS_LYRIA_BACKING_TRACK_VOLUME
    : EXPRESS_BACKING_TRACK_VOLUME;
}

function resolveImageExtensionFromMimeType(mimeType) {
  const normalizedMimeType = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  return OUTRO_IMAGE_EXTENSION_BY_MIME[normalizedMimeType] || '.png';
}

function decodeImageDataUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function resolveSessionFramesPerSecond(userData) {
  const parsed = Number(userData?.videoFramesPerSecond);
  return [16, 24, 30].includes(parsed) ? parsed : DEFAULT_FRAMES_PER_SECOND;
}

function resolveSpeechSubType(sound = {}, scenes = []) {
  const subTypeRaw = typeof sound?.subType === 'string' ? sound.subType.trim().toLowerCase() : '';
  if (subTypeRaw === 'narration' || subTypeRaw === 'character') {
    return subTypeRaw;
  }

  const sceneIndex = typeof sound?.sceneIndex === 'number' ? sound.sceneIndex : Number(sound?.sceneIndex);
  if (!Number.isInteger(sceneIndex)) {
    return subTypeRaw || null;
  }

  const sceneTypeRaw = typeof scenes?.[sceneIndex]?.type === 'string'
    ? scenes[sceneIndex].type.trim().toLowerCase()
    : '';

  if (sceneTypeRaw === 'narration' || sceneTypeRaw === 'character') {
    return sceneTypeRaw;
  }

  return subTypeRaw || null;
}

function normalizeVisualSceneType(rawSceneType) {
  const normalizedType = typeof rawSceneType === 'string'
    ? rawSceneType.trim().toLowerCase()
    : '';

  if (normalizedType === 'character' || normalizedType === 'narration' || normalizedType === 'base') {
    return normalizedType;
  }

  // Backwards compatibility: older narratives may still emit "none" or "sound_effect".
  if (normalizedType === 'none' || normalizedType === 'sound_effect' || normalizedType === 'scene') {
    return 'base';
  }

  return 'base';
}

function resolveSpeechVolumeFromSubType(rawSubType) {
  const normalizedSubType = typeof rawSubType === 'string' ? rawSubType.trim().toLowerCase() : '';
  return normalizedSubType === 'character'
    ? CHARACTER_SPEECH_VOLUME
    : NARRATOR_SPEECH_VOLUME;
}

function isGoogleTTSProvider(provider = '') {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toUpperCase() : '';
  return normalizedProvider === 'GOOGLE' || normalizedProvider === 'GOOGLE_TTS';
}

function buildGoogleTTSInputVolumePayload(provider = '') {
  if (!isGoogleTTSProvider(provider)) {
    return {};
  }

  return {
    googleTTSInputVolume: NARRATOR_SPEECH_VOLUME,
  };
}



function normalizeSpeechGender(rawGender) {
  return normalizeTTSSpeakerGender(rawGender);
}

function inferGenderFromText(rawText) {
  if (rawText === null || rawText === undefined) {
    return null;
  }

  const text = String(rawText).toLowerCase();
  if (!text) {
    return null;
  }

  if (/\b(woman|female|girl)\b/.test(text)) {
    return 'F';
  }

  if (/\b(man|male|boy)\b/.test(text)) {
    return 'M';
  }

  return null;
}

function inferGenderFromThemeActors(themeJson, sound = {}) {
  const actors = Array.isArray(themeJson?.actors) ? themeJson.actors : [];
  if (!actors.length) {
    return null;
  }

  const identity = typeof sound.Identity === 'string' ? sound.Identity.trim() : '';
  const actorName = typeof sound.actor === 'string' ? sound.actor.trim() : '';
  const needles = [identity, actorName]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  if (!needles.length) {
    return null;
  }

  for (const actor of actors) {
    const actorLabel = typeof actor?.name === 'string' ? actor.name.trim() : '';
    if (!actorLabel) {
      continue;
    }

    const actorLabelLower = actorLabel.toLowerCase();
    const matches = needles.some((needle) =>
      needle === actorLabelLower || actorLabelLower.includes(needle) || needle.includes(actorLabelLower)
    );

    if (!matches) {
      continue;
    }

    const fromName = inferGenderFromText(actorLabel);
    if (fromName) {
      return fromName;
    }

    const keywords = Array.isArray(actor?.keywords) ? actor.keywords.join(' ') : '';
    const fromKeywords = inferGenderFromText(keywords);
    if (fromKeywords) {
      return fromKeywords;
    }
  }

  return null;
}

function ensureNarrativeSpeechGenders(movieResourceList, themeJson) {
  if (!movieResourceList || typeof movieResourceList !== 'object') {
    return movieResourceList;
  }

  const scenes = Array.isArray(movieResourceList.scenes) ? movieResourceList.scenes : [];
  const sounds = Array.isArray(movieResourceList.sounds) ? movieResourceList.sounds : [];
  if (!sounds.length) {
    return movieResourceList;
  }

  function inferGenderForSpeechSound(sound) {
    const normalizedSoundGender = normalizeSpeechGender(sound?.gender);
    const themeGender = inferGenderFromThemeActors(themeJson, sound);
    const textGender =
      inferGenderFromText(sound?.Identity) ||
      inferGenderFromText(sound?.actor) ||
      inferGenderFromText(sound?.audio);

    const subType = resolveSpeechSubType(sound, scenes);
    if (subType === 'character') {
      // Theme is source-of-truth for character gender when available.
      return themeGender || normalizedSoundGender || textGender;
    }

    if (subType === 'narration') {
      return normalizedSoundGender || textGender;
    }

    return themeGender || normalizedSoundGender || textGender;
  }

  const narrationGenderCandidate = sounds
    .filter((sound) => sound?.type === 'speech' && resolveSpeechSubType(sound, scenes) === 'narration')
    .map((sound) => inferGenderForSpeechSound(sound))
    .find(Boolean);

  // Keep backwards-compatible default ("F") but guarantee narration consistency.
  const narratorGender = narrationGenderCandidate || 'F';

  return {
    ...movieResourceList,
    sounds: sounds.map((sound) => {
      if (!sound || sound.type !== 'speech') {
        return sound;
      }

      const subType = resolveSpeechSubType(sound, scenes);
      const enforcedGender = subType === 'narration'
        ? narratorGender
        : (inferGenderForSpeechSound(sound) || 'F');

      // Always store canonical "M"/"F" for downstream TTS voice selection.
      if (sound.gender === enforcedGender) {
        return sound;
      }

      return {
        ...sound,
        gender: enforcedGender,
      };
    }),
  };
}

function truncateForPrompt(value, maxLength = 1800) {
  const text = typeof value === 'string' ? value.trim() : JSON.stringify(value || {});
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function isNarrationSound(sound = {}, scenes = []) {
  return sound?.type === 'speech' && resolveSpeechSubType(sound, scenes) === 'narration';
}

function getNarratorSound(movieResourceList = {}) {
  const sounds = Array.isArray(movieResourceList?.sounds) ? movieResourceList.sounds : [];
  const scenes = Array.isArray(movieResourceList?.scenes) ? movieResourceList.scenes : [];
  return sounds.find((sound) => isNarrationSound(sound, scenes)) || null;
}

export function getNarratorGenderForMovieResourceList(movieResourceList = {}) {
  const narratorSound = getNarratorSound(movieResourceList);
  const narratorSoundGender = normalizeSpeechGender(narratorSound?.gender);
  if (narratorSoundGender) {
    return narratorSoundGender;
  }

  const topLevelNarratorGender = normalizeSpeechGender(movieResourceList?.narrator?.gender);
  return topLevelNarratorGender || 'F';
}

function enforceSingleNarratorIdentity(movieResourceList = {}) {
  if (!movieResourceList || typeof movieResourceList !== 'object') {
    return movieResourceList;
  }

  const sounds = Array.isArray(movieResourceList.sounds) ? movieResourceList.sounds : [];
  const scenes = Array.isArray(movieResourceList.scenes) ? movieResourceList.scenes : [];
  const firstNarratorSound = sounds.find((sound) => isNarrationSound(sound, scenes));
  if (!firstNarratorSound) {
    return movieResourceList;
  }

  const topLevelNarrator = movieResourceList.narrator && typeof movieResourceList.narrator === 'object'
    ? movieResourceList.narrator
    : null;
  const narratorActor = typeof firstNarratorSound.actor === 'string' && firstNarratorSound.actor.trim()
    ? firstNarratorSound.actor.trim()
    : (typeof topLevelNarrator?.actor === 'string' && topLevelNarrator.actor.trim()
      ? topLevelNarrator.actor.trim()
      : 'Narrator');
  const narratorGender = normalizeSpeechGender(firstNarratorSound.gender)
    || normalizeSpeechGender(topLevelNarrator?.gender)
    || 'F';
  const narratorIdentity = typeof firstNarratorSound.Identity === 'string' && firstNarratorSound.Identity.trim()
    ? firstNarratorSound.Identity.trim()
    : (typeof topLevelNarrator?.Identity === 'string' && topLevelNarrator.Identity.trim()
      ? topLevelNarrator.Identity.trim()
      : narratorActor);
  const narratorSpeaker = typeof firstNarratorSound.speaker === 'string' && firstNarratorSound.speaker.trim()
    ? firstNarratorSound.speaker.trim()
    : null;
  const narratorProvider = typeof firstNarratorSound.provider === 'string' && firstNarratorSound.provider.trim()
    ? firstNarratorSound.provider.trim()
    : null;
  const narratorSpeakerCharacterName =
    typeof firstNarratorSound.speakerCharacterName === 'string' && firstNarratorSound.speakerCharacterName.trim()
      ? firstNarratorSound.speakerCharacterName.trim()
      : narratorActor;

  return {
    ...movieResourceList,
    narrator: {
      ...(movieResourceList.narrator && typeof movieResourceList.narrator === 'object'
        ? movieResourceList.narrator
        : {}),
      actor: narratorActor,
      gender: narratorGender,
      Identity: narratorIdentity,
      ...(narratorSpeaker ? { speaker: narratorSpeaker } : {}),
      ...(narratorProvider ? { provider: narratorProvider } : {}),
      speakerCharacterName: narratorSpeakerCharacterName,
    },
    scenes: scenes.map((scene) => (
      normalizeVisualSceneType(scene?.type) === 'narration'
        ? { ...scene, speaker: narratorActor }
        : scene
    )),
    sounds: sounds.map((sound) => (
      isNarrationSound(sound, scenes)
        ? {
          ...sound,
          actor: narratorActor,
          gender: narratorGender,
          Identity: narratorIdentity,
          ...(narratorSpeaker ? { speaker: narratorSpeaker } : {}),
          ...(narratorProvider ? { provider: narratorProvider } : {}),
          speakerCharacterName: narratorSpeakerCharacterName,
        }
        : sound
    )),
  };
}

export function buildNarratorAvatarImagePrompt({
  inputPrompt,
  themeJson,
  movieResourceList,
  languageString,
  metadata,
  imageDescriptionList,
}) {
  const narratorSound = getNarratorSound(movieResourceList);
  const narratorActor = typeof narratorSound?.actor === 'string' && narratorSound.actor.trim()
    ? narratorSound.actor.trim()
    : (typeof movieResourceList?.narrator?.actor === 'string' && movieResourceList.narrator.actor.trim()
      ? movieResourceList.narrator.actor.trim()
      : 'Narrator');
  const narratorGender = getNarratorGenderForMovieResourceList(movieResourceList);
  const narratorGenderLabel = narratorGender === 'M' ? 'male' : 'female';
  const narratorIdentity = typeof narratorSound?.Identity === 'string' && narratorSound.Identity.trim()
    ? narratorSound.Identity.trim()
    : (typeof movieResourceList?.narrator?.Identity === 'string' && movieResourceList.narrator.Identity.trim()
      ? movieResourceList.narrator.Identity.trim()
      : 'trusted influencer-style presenter');

  return [
    'Create a single human narrator avatar reference image for Runway avatar creation.',
    'Persona type: Influencer voice-over narrator.',
    'The image must be landscape 16:9 with a solid black background.',
    'Make sure the character is clearly visible, centered in the frame, facing the camera, with good lighting and a clear face.',
    'Use a shoulders-up or waist-up composition that keeps the character centered in the landscape frame, one person only, no text, no logos, no props blocking the face, and no extra people.',
    'Choose attire, age range, grooming, expression, and persona that fit an influencer who would narrate the provided image-list video.',
    `Narrator avatar gender: ${narratorGender} (${narratorGenderLabel}).`,
    'Keep the person human and credible for ad narration; do not include non-human subjects, masks, helmets, or heavy face obstruction.',
    'Do not use a white background or transparent background. Prefer a clean black or near-black studio backdrop.',
    `Narrator name/actor: ${narratorActor}`,
    `Narrator gender: ${narratorGender}`,
    `Narrator identity/persona: ${narratorIdentity}`,
    languageString ? `Narration language/context: ${languageString}` : '',
    inputPrompt ? `User prompt: ${truncateForPrompt(inputPrompt, 900)}` : '',
    metadata ? `Input metadata: ${truncateForPrompt(metadata, 900)}` : '',
    imageDescriptionList ? `Image list context: ${truncateForPrompt(imageDescriptionList, 1200)}` : '',
    themeJson ? `Theme JSON: ${truncateForPrompt(themeJson, 1200)}` : '',
    movieResourceList ? `Narrative JSON: ${truncateForPrompt(movieResourceList, 1600)}` : '',
  ].filter(Boolean).join('\n');
}

export async function requestImageListToVideGeneration(userId, payload) {

  await getDBConnectionString();

  const { 
    aspectRatio,
    sessionId,
    inputPrompt,
    movieResourceList,

    imageModel = IMAGE_LIST_TO_VIDEO_DEFAULT_IMAGE_EDIT_MODEL,
    requestMusicGeneration,
    videoGenerationModel = 'RUNWAYML',
    videoGenerationModelSubType,
    themeJson,
    imageStyle,



    transcriptBuilderPayload,

    videoTone,
    language,
    languageString,
    outroImageUrl,
    addOutroAnimation = false,
    addOutroFocusArea = false,
    outroFocustArea = null,
    generatedOutroImage = false,
    outroImageBuffer = null,
    outroImageMimeType = 'image/png',
    outroCtaUrl = null,
    outroCtaTextTop = null,
    outroCtaTextBottom = null,
    outroCtaLogo = null,
    outroCtaImage = null,
    addFooterAnimation = false,
    footerMetadata = [],
    expressCtaGeneration = false,
    requestType,
    subtitleFont: requestedSubtitleFont,
    speakerFont: requestedSpeakerFont,
    enableSubtitles = true,
    subtitle_language = undefined,
    subtitleLanguage = undefined,
    subtitle_language_explicit = undefined,
    subtitleLanguageExplicit = undefined,
    limitSingleNarrator = false,
    limit_single_narrator = false,
    addNarratorAvatar = false,
    add_narrator_avatar = false,
    speakerOptions: requestSpeakerOptions = null,
    isExternalUserRequest = false,
    externalRequestUserId = null,
    externalRequestId = null,
    externalRequestIdentityKey = null,
    custom_adapters = null,
    customAdapterFallbacks = null,
    customAdapterOperationUsage = null,
    inference_model = null,
    inferenceModel = null,
    isStepVideoGeneration = false,
    stepVideoRoute = null,
    expressGenerationPricingRateClass = 'studio',
    manualStepStages = undefined,
    manual_step_stages = undefined,
  } = payload;


  const { prompt, metadata, imageDescriptionList, imageList, imageListPayload } = transcriptBuilderPayload;
  const resolvedManualStepStages = manualStepStages !== undefined
    ? manualStepStages
    : manual_step_stages;




  const creditsCharged = 0;
  let remainingCredits = null;
  const resolvedRequestType = typeof requestType === 'string' && requestType.trim()
    ? requestType.trim()
    : 'APP';
  const apiKeyUsageContext =
    normalizeAPIKeyUsageContext(payload.apiKeyUsage) ||
    getCurrentAPIKeyUsageContext();

  const normalizedSubtitleFont =
    typeof requestedSubtitleFont === 'string' ? requestedSubtitleFont.trim() : '';
  const normalizedSpeakerFont =
    typeof requestedSpeakerFont === 'string' ? requestedSpeakerFont.trim() : '';
  const subtitleFont = normalizedSubtitleFont || 'Montserrat';
  const speakerFont = normalizedSpeakerFont || subtitleFont;
  const hasFontOverride = Boolean(normalizedSubtitleFont || normalizedSpeakerFont);
  const shouldEnableSubtitles = enableSubtitles !== false;
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
  const shouldAddNarratorAvatar = addNarratorAvatar === true || add_narrator_avatar === true;
  const shouldLimitSingleNarrator =
    shouldAddNarratorAvatar || limitSingleNarrator === true || limit_single_narrator === true;

  const movieResourceListWithGenders = ensureNarrativeSpeechGenders(movieResourceList, themeJson);
  const userData = await User.findOne({ _id: userId });
  const userInferenceModel = normalizeInferenceModel(inference_model || inferenceModel || userData?.selectedInferenceModel);
  const framesPerSecond = resolveSessionFramesPerSecond(userData);
  const resolvedSpeakerOptions = filterDockerSpeakerOptions(
    requestSpeakerOptions || userData?.speakerOptions || null
  );
  const movieResourceListWithCharacters = await assignCharactersAndInstructionsToScenes(
    inputPrompt,
    movieResourceListWithGenders,
    videoTone,
    {
      language,
      speakerOptions: resolvedSpeakerOptions,
      inferenceModel: userInferenceModel,
    },
  );
  let sanitizedMovieResourceList = stripSoundEffectsFromMovieResourceList(movieResourceListWithCharacters);
  if (shouldLimitSingleNarrator) {
    sanitizedMovieResourceList = enforceSingleNarratorIdentity(sanitizedMovieResourceList);
  }

  const musicProvider = resolveDockerBackingTrackModel(
    normalizeBackingTrackProvider(payload.musicProvider || userData.backingTrackModel || 'ELEVENLABS_MUSIC')
  );

  const selectedNotifyOnCompletion = userData.selectedNotifyOnCompletion;

  const promptList = [];

  const themeJsonString = JSON.stringify(themeJson);
  const sessionLanguage = (typeof language === 'string' && language.toLowerCase() !== 'auto') ? language : 'EN';
  const forceOpenAITTS = isOpenAITTSForcedLanguage(language) &&
    isDockerTTSProviderAvailable('OPENAI');


  const { scenes, sounds } = sanitizedMovieResourceList;


  const soundAudioLayers = sounds.filter((sound) => sound.type !== 'sound_effect');

  const subtitleTextBySound = await buildSpeechSubtitleTextMap(soundAudioLayers, {
    subtitlesEnabled: shouldEnableSubtitles,
    speechLanguageCode: subtitleLanguageOption.speechLanguageCode,
    subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
    subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
    subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
    inferenceModel: userInferenceModel,
    translateSpeech,
  });
  const subtitleTranslationRequired = Array.from(subtitleTextBySound.values())
    .some((metadata) => metadata.subtitleTranslationRequired === true);

  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  const assetsRoot = (process.env.SAMSAR_ASSETS_V2_ROOT || isContainerRuntime())
    ? process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2'
    : path.join(process.cwd(), 'assets_v2');
  const toPublicAssetPath = (filePath) => path.posix.join(
    'assets_v2',
    path.relative(assetsRoot, filePath).split(path.sep).join('/'),
  );
  const toLocalAssetPath = (assetPath) => path.join(
    assetsRoot,
    assetPath.replace(/^\/+/, '').replace(/^assets_v2\//, ''),
  );
  let outroAssetRelativePath = null;
  const normalizedFooterMetadata = normalizeFooterMetadataList(footerMetadata);
  const shouldAddFooterAnimation = addFooterAnimation === true && normalizedFooterMetadata.length > 0;
  const normalizedOutroImageUrl = typeof outroImageUrl === 'string' ? outroImageUrl.trim() : '';
  const normalizedOutroImageBuffer = Buffer.isBuffer(outroImageBuffer)
    ? outroImageBuffer
    : outroImageBuffer instanceof Uint8Array
      ? Buffer.from(outroImageBuffer)
      : null;
  const hasGeneratedOutroImageBuffer = Boolean(normalizedOutroImageBuffer && normalizedOutroImageBuffer.length > 0);
  if (normalizedOutroImageUrl || hasGeneratedOutroImageBuffer) {
    try {
      const outroFolderPath = path.join(assetsRoot, 'video', 'outro', sessionId);

      await fs.promises.mkdir(outroFolderPath, { recursive: true });

      let outroExtension = hasGeneratedOutroImageBuffer
        ? resolveImageExtensionFromMimeType(outroImageMimeType)
        : '.png';
      let sourceBuffer = normalizedOutroImageBuffer;

      if (!sourceBuffer) {
        const dataUrlImage = decodeImageDataUrl(normalizedOutroImageUrl);
        if (dataUrlImage) {
          sourceBuffer = dataUrlImage.buffer;
          outroExtension = resolveImageExtensionFromMimeType(dataUrlImage.mimeType);
        } else {
          try {
            const parsedUrl = new URL(normalizedOutroImageUrl);
            const extFromUrl = path.extname(parsedUrl.pathname);
            if (extFromUrl) {
              outroExtension = extFromUrl;
            }
          } catch (err) {
            // If URL parsing fails, fall back to default extension
          }

          const response = await axios.get(normalizedOutroImageUrl, {
            responseType: 'arraybuffer',
            timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
          });
          sourceBuffer = Buffer.from(response.data);
        }
      }

      const outroFileName = `outro${outroExtension || '.png'}`;
      const outroFilePath = path.join(outroFolderPath, outroFileName);

      await fs.promises.writeFile(outroFilePath, sourceBuffer);

      const outroMetadata = await sharp(outroFilePath).metadata();
      const outroWidth = outroMetadata.width;
      const outroHeight = outroMetadata.height;

      if (!outroWidth || !outroHeight) {
        throw new Error('Unable to determine dimensions for the outro image.');
      }

      const requiredWidth = canvasDimensions.width;
      const requiredHeight = canvasDimensions.height;

      if (outroWidth < requiredWidth || outroHeight < requiredHeight) {
        throw new Error(
          `Outro image must be at least ${requiredWidth}x${requiredHeight} for ${aspectRatio} generation.`,
        );
      }

      if (outroWidth !== requiredWidth || outroHeight !== requiredHeight) {
        const cropLeft = Math.floor((outroWidth - requiredWidth) / 2);
        const cropTop = Math.floor((outroHeight - requiredHeight) / 2);
        const croppedBuffer = await sharp(outroFilePath)
          .extract({
            left: cropLeft,
            top: cropTop,
            width: requiredWidth,
            height: requiredHeight,
          })
          .toBuffer();
        await fs.promises.writeFile(outroFilePath, croppedBuffer);
      }
      outroAssetRelativePath = toPublicAssetPath(outroFilePath);

  
    } catch (error) {
      console.error('Failed to persist outro image for session', sessionId, {
        generatedOutroImage,
        error,
      });
      throw error;
    }
  }


  const audioLayers = soundAudioLayers.map(function (sound, index) {



    let sceneIndex = sound.sceneIndex; // try to parse string to int, if type is string

    if (typeof sceneIndex === 'string') {
      sceneIndex = parseInt(sceneIndex);
    }



	    const generationMeta = {
      Identity: sound.Identity,
      Affect: sound.Affect,
      Tone: sound.Tone,
      Emotion: sound.Emotion,
      Pronunciation: sound.Pronunciation,
      Pause: sound.Pause,
    };
    const isOpenAISpeaker = typeof sound.provider === 'string' && sound.provider.trim().toUpperCase() === 'OPENAI';

    const soundGender = normalizeSpeechGender(sound.gender) || sound.gender || '';
    const resolvedSoundSubType = resolveSpeechSubType(sound, scenes);
    const subtitleLayerFields = buildSpeechSubtitleLayerFields(
      subtitleTextBySound.get(sound) || {
        subtitleText: sound.audio,
        subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
        speechLanguage: subtitleLanguageOption.speechLanguageCode,
        subtitleTranslationRequired: false,
      },
      shouldEnableSubtitles,
    );

    let returnPayload = {
      prompt: sound.audio,
      ...subtitleLayerFields,
      generationType: "speech",
      isHuman: sound.isHuman ? true : false,
      generationStatus: 'PENDING',
      duration: sound.duration,
      startTime: sound.startTime,
      endTime: sound.endTime,
      defaultSelected: true,
      volume: resolveSpeechVolumeFromSubType(resolvedSoundSubType),
      speaker: sound.speaker,
      provider: sound.provider,
      speakerVoiceId: sound.speakerVoiceId,
      speakerLabel: sound.speakerLabel,
      speakerDetails: sound.speakerDetails,
      languageCode: sound.languageCode,
      languageCodes: sound.languageCodes,
      speakerCharacterName: sound.speakerCharacterName,
      actor: sound.actor,
      gender: soundGender,
      subType: resolvedSoundSubType || sound.subType,
      Identity: sound.Identity,
      ...(hasFontOverride ? { subtitleFont } : {}),
      isEnabled: true,
      addSubtitles: shouldEnableSubtitles,
      instructions: isOpenAISpeaker ? sound.instructions : undefined,
    }

    if (isOpenAISpeaker) {
      returnPayload.generationMeta = generationMeta;
    }



    if (sound.speakerCharacterName) {
      returnPayload['speakerCharacterName'] = sound.speakerCharacterName;
    }

    if (typeof sceneIndex === 'number') {
      returnPayload['connectedLayerIndex'] = sceneIndex;
    }

    return returnPayload;
  });

  if (requestMusicGeneration) {
    const audioDuration = scenes.reduce((totalDuration, scene) => {
      const sceneDuration = Number(scene?.duration);
      return totalDuration + (Number.isFinite(sceneDuration) && sceneDuration > 0 ? sceneDuration : 0);
    }, 0);

    const musicTheme = await getMusicForTextTheme(themeJsonString, userInferenceModel, musicProvider);

    const musicVolume = resolveExpressBackingTrackVolume(musicProvider);

    const musicGenerationPayload = {
      videoSessionId: sessionId,
      prompt: musicTheme,
      isInstrumental: true,
      model: musicProvider,
      generationStatus: 'PENDING',
      duration: audioDuration,
      userId: userId,
      defaultSelected: true,
      volume: musicVolume,
      startTime: 0,
      endTime: audioDuration,
      isEnabled: true,
      generationType: 'music',
    };

    audioLayers.push(musicGenerationPayload);
  }



  for (let i = 0; i < scenes.length; i += 1) {

    let scene = scenes[i];


    const visual = scene.visual;

    const sceneType = scene.type;


    let promptForChunk = visual;



    promptList.push({
      'prompt': promptForChunk,
      duration: scene.duration,
      sceneType: sceneType
    });
  }




  let outroFocusAssetRelativePath = null;
  let outroFocusArea = null;
  const {
    addOutroFocusArea: effectiveAddOutroFocusArea,
    outroFocustArea: effectiveOutroFocustArea,
  } = resolveEffectiveOutroFocusAreaForImageListToVideo({
    aspectRatio,
    addOutroAnimation,
    addOutroFocusArea,
    outroFocustArea,
    generatedOutroImage,
  });

  if (addOutroAnimation && effectiveAddOutroFocusArea && outroAssetRelativePath && effectiveOutroFocustArea) {
    const { x, y, width, height } = effectiveOutroFocustArea || {};
    const hasInvalidNumber = [x, y, width, height].some(
      (value) => typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value),
    );

    if (!hasInvalidNumber) {
      const focusX = Math.round(x);
      const focusY = Math.round(y);
      const focusWidthRaw = Math.round(width);
      const focusHeightRaw = Math.round(height);

      const maxWidth = canvasDimensions.width - focusX;
      const maxHeight = canvasDimensions.height - focusY;
      const focusWidth = Math.min(focusWidthRaw, maxWidth);
      const focusHeight = Math.min(focusHeightRaw, maxHeight);

      const isValidFocusArea = (
        focusX >= 0 &&
        focusY >= 0 &&
        focusX < canvasDimensions.width &&
        focusY < canvasDimensions.height &&
        focusWidth > 0 &&
        focusHeight > 0
      );

      if (isValidFocusArea) {
        try {
          const outroImagePath = toLocalAssetPath(outroAssetRelativePath);
          const outroFolderPath = path.dirname(outroImagePath);
          const focusFileName = `outro_focus_${Date.now()}.png`;
          const focusFilePath = path.join(outroFolderPath, focusFileName);

          await sharp(outroImagePath)
            .resize(canvasDimensions.width, canvasDimensions.height)
            .extract({
              left: focusX,
              top: focusY,
              width: focusWidth,
              height: focusHeight,
            })
            .png()
            .toFile(focusFilePath);

          outroFocusAssetRelativePath = toPublicAssetPath(focusFilePath);
          outroFocusArea = {
            x: focusX,
            y: focusY,
            width: focusWidth,
            height: focusHeight,
          };
        } catch (error) {
          console.error('Failed to extract outro focus area for session', sessionId, error);
        }
      }
    }
  }

  let durationOffset = 0;

  const newSessionLayers = promptList.map((promptItem, pIdx) => {

    const prompt = promptItem.prompt;
    const duration = promptItem.duration;

    const sceneType = promptItem.sceneType;


    const editImageURL = imageList[pIdx];

    const initActiveItemList = [{
      'id': 'item_0',
      'type': 'image',
      'image': editImageURL,
      'x': 0,
      'y': 0,
      'width': canvasDimensions.width,
      'height': canvasDimensions.height,
      'src': '',
      'is_base_image': true,
      'animations': [],
    }];





    const currentGenerationStatus = 'COMPLETED';

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
      editStatus: 'COMPLETED',
      outpaintStatus: 'INIT',
      prompt: prompt,
      originalImageGenerationPrompt: prompt,
      originalImageGenerationPromptSource: 'initial_generation',
      originalImagePrompt: prompt,
      sourcePrompt: prompt,
      originalPrompt: prompt,
      activeItemList: initActiveItemList,

    };

	    const normalizedSceneType = normalizeVisualSceneType(sceneType);
	    const isLipSyncRequired = normalizedSceneType === 'character';
	    const layerAiVideoType = normalizedSceneType === 'character'
	      ? 'character'
	      : normalizedSceneType === 'narration'
	        ? 'narration'
	        : 'scene';
	    const layerBaseAiImageType = normalizedSceneType === 'character' ? 'character' : 'scene';



    let layerPayload = {
	      imageSession: newSession,
	      prompt: prompt,
	      originalImageGenerationPrompt: prompt,
	      originalImageGenerationPromptSource: 'initial_generation',
	      originalImagePrompt: prompt,
	      sourcePrompt: prompt,
	      originalPrompt: prompt,
	      status: "pending",
	      duration: duration,
	      durationOffset: durationOffset,
		      layerAiVideoType,
		      hasAiVideoLayer: true,
		      lipSyncGenerationPending: isLipSyncRequired
		        && hasConnectedSpeechAudioLayer(audioLayers, {}, pIdx),
		      soundEffectGenerationPending: false,
		      layerBaseAiImageType,
      ...(shouldAddFooterAnimation && normalizedFooterMetadata[pIdx]
        ? {
          addFooterAnimation: true,
          footerMetadata: normalizedFooterMetadata[pIdx],
        }
        : {}),

		    };

	    durationOffset += duration;


    return layerPayload;
  });

  let generatedOutroComposition = null;
  if (generatedOutroImage) {
    generatedOutroComposition = await generateOutroCompositionAssetsFromImageList({
      imageListPayload: [],
      imageUrls: [],
      aspectRatio,
      ctaUrl: outroCtaUrl,
      outroCtaImage,
      assetsRoot,
      sessionId,
      ctaLogo: outroCtaLogo,
    });

  }

  const outroBaseAssetRelativePath = generatedOutroComposition?.background?.src || outroAssetRelativePath;
  const outroImageMetadata = buildOutroImageMetadata({
    generated: generatedOutroImage === true,
    sourceUrl: normalizedOutroImageUrl || null,
    assetPath: outroBaseAssetRelativePath,
    ctaUrl: outroCtaUrl,
    ctaTextTop: outroCtaTextTop,
    ctaTextBottom: outroCtaTextBottom,
    ctaLogo: outroCtaLogo,
    outroCtaImage,
  });

  if (generatedOutroComposition || outroAssetRelativePath) {
    // Keep the outro as a dedicated terminal layer. Generated CTA outros are
    // composed as ordered render items instead of one flattened outro image.
    let outroActiveItemList;

    if (generatedOutroComposition) {
      outroActiveItemList = [{
        id: 'item_0',
        type: 'image',
        image: 'server_generated_outro_background',
        x: generatedOutroComposition.background.x,
        y: generatedOutroComposition.background.y,
        width: generatedOutroComposition.background.width,
        height: generatedOutroComposition.background.height,
        src: generatedOutroComposition.background.src,
        is_base_image: true,
        animations: [],
      }];

      outroActiveItemList.push(...createGeneratedOutroTileItems({
        generatedOutroComposition,
        startIndex: outroActiveItemList.length,
      }));

      outroActiveItemList.push(createOutroFadeOverlayItem({
        id: `item_${outroActiveItemList.length}`,
        canvasDimensions,
      }));

      outroActiveItemList.push(...createOutroCtaTextItems({
        canvasDimensions,
        ctaTextTop: outroCtaTextTop,
        ctaTextBottom: outroCtaTextBottom,
        startIndex: outroActiveItemList.length,
      }));

      outroActiveItemList.push({
        id: `item_${outroActiveItemList.length}`,
        type: 'image',
        image: generatedOutroComposition.centerType === 'cta_image'
          ? 'server_generated_outro_cta_image'
          : 'server_generated_outro_qr',
        x: generatedOutroComposition.qr.x,
        y: generatedOutroComposition.qr.y,
        width: generatedOutroComposition.qr.width,
        height: generatedOutroComposition.qr.height,
        src: generatedOutroComposition.qr.src,
        is_base_image: false,
        animations: [],
      });
    } else {
      outroActiveItemList = [{
        id: 'item_0',
        type: 'image',
        image: normalizedOutroImageUrl,
        x: 0,
        y: 0,
        width: canvasDimensions.width,
        height: canvasDimensions.height,
        src: outroAssetRelativePath,
        is_base_image: true,
        animations: [],
      }];

      if (addOutroAnimation) {
        outroActiveItemList.push(createOutroFadeOverlayItem({
          id: `item_${outroActiveItemList.length}`,
          canvasDimensions,
        }));
      }

      if (outroFocusAssetRelativePath && outroFocusArea) {
        outroActiveItemList.push({
          id: `item_${outroActiveItemList.length}`,
          type: 'image',
          x: outroFocusArea.x,
          y: outroFocusArea.y,
          width: outroFocusArea.width,
          height: outroFocusArea.height,
          src: outroFocusAssetRelativePath,
          animations: [],
        });
      }
    }

    const outroImageSession = {
      userId,
      generations: [],
      activeSelectedImage: '',
      activeGeneratedImage: '',
      activeOutpaintedImage: '',
      generationStatus: 'COMPLETED',
      editStatus: 'COMPLETED',
      outpaintStatus: 'INIT',
      witnesses: [],
      intermediates: [],
      lastWitnessSavedAt: null,
      generationError: null,
      outpaintError: '',
      prompt: '',
      activeItemList: outroActiveItemList,
    };

    newSessionLayers.push({
      imageSession: outroImageSession,
      prompt: '',
      status: "pending",
      duration: OUTRO_LAYER_DURATION_SECONDS,
      durationOffset: durationOffset,
      outroImagePath: outroBaseAssetRelativePath,
      layerAiVideoType: 'none',
      layerBaseAiImageType: 'none',
      skipAiVideoGeneration: true,
      hasAiVideoLayer: false,
      aiVideoGenerationPending: false,
      aiVideoGenerationStatus: 'COMPLETED',
      lipSyncGenerationPending: false,
      soundEffectGenerationPending: false,
      ...(generatedOutroComposition
        ? {
          isGeneratedOutroLayer: true,
          generatedOutroImage: true,
          generatedOutroTilesPending: true,
          generatedOutroTilesSource: 'active_item_top_images',
        }
        : {}),
    });

    durationOffset += OUTRO_LAYER_DURATION_SECONDS;
  }

  const totalTimelineDuration = durationOffset;
  if (requestMusicGeneration && Number.isFinite(totalTimelineDuration) && totalTimelineDuration > 0) {
    audioLayers.forEach((audioLayer) => {
      if (audioLayer?.generationType !== 'music') {
        return;
      }
      audioLayer.duration = totalTimelineDuration;
      audioLayer.startTime = 0;
      audioLayer.endTime = totalTimelineDuration;
    });
  }

  let narratorAvatarImagePrompt = '';
  let narratorAvatarImageRequestId = '';
  if (shouldAddNarratorAvatar) {
    const narratorAvatarGender = getNarratorGenderForMovieResourceList(sanitizedMovieResourceList);
    narratorAvatarImagePrompt = buildNarratorAvatarImagePrompt({
      inputPrompt,
      themeJson,
      movieResourceList: sanitizedMovieResourceList,
      languageString,
      metadata,
      imageDescriptionList,
    });

    const avatarImageRequest = await addImageGeneratorRequest(userId, {
      userId: userId.toString(),
      sessionId,
      videoSessionId: sessionId,
      layerId: null,
      prompt: narratorAvatarImagePrompt,
      model: 'GPTIMAGE2',
      inferenceModel: userInferenceModel,
      expressGenerationInferenceModel: userInferenceModel,
      aspectRatio: '16:9',
      background_color: 'black',
      backgroundColor: 'black',
      transparent_background: false,
      transparentBackground: false,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
      narratorGender: narratorAvatarGender,
      narrator_gender: narratorAvatarGender,
      requestType: 'EXPRESS_NARRATOR_AVATAR',
      contentFilterRating: userData?.contentFilterRating ?? 3,
      retryOnFailure: true,
    }, false);

    if (!avatarImageRequest?._id) {
      throw new Error('Unable to queue narrator avatar image generation.');
    }
    narratorAvatarImageRequestId = avatarImageRequest._id.toString();
  }




  let expressGenerationStatus = {
    'prompt_generation': 'COMPLETED',
    'image_generation': 'COMPLETED',
    'audio_generation': 'PENDING',
    'frame_generation': 'INIT',
    'video_generation': 'INIT',
    'ai_video_generation': 'INIT',
    'speech_generation': 'INIT',
    'music_generation': 'INIT',
    'lip_sync_generation': 'INIT',
    'sound_effect_generation': 'COMPLETED',
    'narrator_avatar_generation': shouldAddNarratorAvatar ? 'INIT' : 'COMPLETED',
    'transcript_generation': shouldEnableSubtitles ? 'INIT' : 'COMPLETED',
  }


  const movieGenSpeakerList = getUniqueSpeakersByActor(soundAudioLayers)

  await VideoSession.updateOne({ _id: sessionId }, {
    $set: {
      layers: newSessionLayers,
      audioLayers: audioLayers,
      generationStatus: 'PENDING',
      outpaintStatus: 'INIT',
      expressGenerationPending: true,
      expressGenerationPaused: false,
      videoGenerationPending: true,
      isExpressGeneration: true,
      setAutoDurationPerScene: false,
      'expressGenerationStatus': expressGenerationStatus,
      expressGenerationCreated: new Date(),
      aspectRatio: aspectRatio,
      isMovieGen: true,
      requestType: resolvedRequestType,
      creditSource: 'image_list_to_video',
      builderRouteType: 'image_list_to_video',
      expressGenerativeVideoRequired: true,
      expressGenerativeVideoModel: videoGenerationModel,
      expressGenerativeVideoModelSubType: videoGenerationModelSubType,
      expressGenerationImageModel: imageModel,

      expressGenerationType: 'IMAGE_LIST_TO_VIDEO',
      expressGenerationPricingRateClass: normalizeExpressVideoPricingRateClass(
        expressGenerationPricingRateClass,
      ),

      expressGenerativeVideoUseEndFrame: true,
      notifyOnCompletion: selectedNotifyOnCompletion,
      framesPerSecond,
      refilterImageGenerationsRequired: true,
      refilterImageGenerationCompleted: false,
      transcriptGenerationPending: shouldEnableSubtitles,
      enableSubtitles: shouldEnableSubtitles,
      hasSubtitles: shouldEnableSubtitles,
      has_subtitles: shouldEnableSubtitles,
      subtitleLanguage: subtitleLanguageOption.subtitleLanguage,
      subtitleLanguageString: subtitleLanguageOption.subtitleLanguageString,
      subtitleLanguageExplicit: subtitleLanguageOption.subtitleLanguageExplicit,
      subtitleTranslationRequired,
      isVidGPTGen: true,
      parentJsonTheme: themeJsonString,
      movieGenSpeakers: movieGenSpeakerList,
      movieResourceList: sanitizedMovieResourceList,
      hasOutroImage: !!outroBaseAssetRelativePath,
      outroImageURL: outroBaseAssetRelativePath,
      ...(outroImageMetadata ? { outroImageMetadata } : {}),
      ...(generatedOutroComposition
        ? {
          generatedOutroImage: true,
          generatedOutroTilesPending: true,
          generatedOutroTilesSource: 'active_item_top_images',
        }
        : {}),
      addFooterAnimation: shouldAddFooterAnimation,
      footerMetadata: shouldAddFooterAnimation ? normalizedFooterMetadata : [],
      expressCtaGeneration: expressCtaGeneration === true,
      limitSingleNarrator: shouldLimitSingleNarrator,
      limit_single_narrator: shouldLimitSingleNarrator,
      addNarratorAvatar: shouldAddNarratorAvatar,
      add_narrator_avatar: shouldAddNarratorAvatar,
      narratorAvatarType: shouldAddNarratorAvatar ? 'influencer' : null,
      narratorAvatarGender: shouldAddNarratorAvatar ? getNarratorGenderForMovieResourceList(sanitizedMovieResourceList) : null,
      narratorAvatarImagePrompt: shouldAddNarratorAvatar ? narratorAvatarImagePrompt : '',
      narratorAvatarImageRequestId: shouldAddNarratorAvatar ? narratorAvatarImageRequestId : '',
      narratorAvatarImageStatus: shouldAddNarratorAvatar ? 'PENDING' : 'DISABLED',
      narratorAvatarStatus: shouldAddNarratorAvatar ? 'INIT' : 'DISABLED',
      narratorAvatarVideoStatus: shouldAddNarratorAvatar ? 'INIT' : 'DISABLED',


      provisionalCredits: 0,
      totalDuration: totalTimelineDuration,
      expressGenerationBillingDurationSeconds: totalTimelineDuration,
      expressGenerationCreditCharges: buildInitialExpressVideoCreditCharges(totalTimelineDuration),
      ...(isStepVideoGeneration
        ? {
          isStepVideoGeneration: true,
          expressStepGeneration: buildInitialExpressStepGeneration({
            routeType: stepVideoRoute || 'image_to_video',
            manualStepStages: resolvedManualStepStages,
          }),
        }
        : {}),
      isExternalUserRequest: Boolean(isExternalUserRequest),
      externalRequestUserId,
      externalRequestId,
      externalRequestIdentityKey,
      ...(apiKeyUsageContext
        ? {
          apiKeyId: apiKeyUsageContext.apiKeyId,
          apiKeyUsage: apiKeyUsageContext,
          apiKeyUsageLimit: apiKeyUsageContext.apiKeyUsageLimit,
          apiKeyUsageLimitPeriod: apiKeyUsageContext.apiKeyUsageLimitPeriod,
        }
        : {}),

      videoTone: videoTone,

      inputPrompt: inputPrompt,
      inferenceModel: userInferenceModel,
      expressGenerationInferenceModel: userInferenceModel,
      backingTrackModel: musicProvider,
      language: language || 'auto',
      languageString: languageString || null,
      sessionLanguage: sessionLanguage,
      ...(custom_adapters ? { custom_adapters } : {}),
      ...(customAdapterFallbacks ? { customAdapterFallbacks } : {}),
      ...(customAdapterOperationUsage ? { customAdapterOperationUsage } : {}),
      ...(hasFontOverride
        ? {
          expressGenerationTextFont: subtitleFont,
          expressGenerationSpeakerFont: speakerFont,
        }
        : {}),

    },
  });

  const inferenceChargeResult = await chargeExpressVideoStageCredits({
    sessionId,
    stageKey: EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE,
    requestType: resolvedRequestType,
  });
  if (!inferenceChargeResult?.ok) {
    throw new Error(inferenceChargeResult?.error || 'Unable to charge narrative inference credits.');
  }


  const latestSessionData = await VideoSession.findOne({ _id: sessionId });


  const updatedAudioLayers = latestSessionData.audioLayers;




  const updatedLayers = latestSessionData.layers;

  for (let i = 0; i < updatedAudioLayers.length; i++) {
    const currentAudioLayer = updatedAudioLayers[i];

    if ((currentAudioLayer.generationType === 'speech') &&
      typeof currentAudioLayer.connectedLayerIndex === 'number') {


      const currentAudioIndex = currentAudioLayer.connectedLayerIndex;


      const updatedLayer = updatedLayers[currentAudioIndex];

      if (!updatedLayer) {
        continue;
      }
      const connectedLayerId = updatedLayer._id.toString();

      updatedAudioLayers[i].connectedLayerId = connectedLayerId;
      updatedAudioLayers[i].connectedLayerStartTimeOffset = updatedLayer.durationOffset;
      updatedAudioLayers[i].startTime = updatedLayer.durationOffset;
      updatedAudioLayers[i].endTime = updatedLayer.durationOffset + updatedAudioLayers[i].duration;

    }
  }


  await VideoSession.updateOne({ _id: sessionId }, {
    $set: {
      audioLayers: updatedAudioLayers,
      layers: updatedLayers,
    },
  });



  let queuedImageEditRequest = false;
  for (let layerIdx = 0; layerIdx < latestSessionData.layers.length; layerIdx += 1) {
    const layer = latestSessionData.layers[layerIdx];
    if (layer?.isGeneratedOutroLayer === true) {
      continue;
    }

    const promptSeed = layer.originalImageGenerationPrompt || layer.originalImagePrompt || layer.sourcePrompt || layer.originalPrompt || layer.prompt;
    const promptText = `${promptSeed} `;

    const layerActiveItem = layer.imageSession.activeItemList.find((item => item.is_base_image));
    const layerActiveItemImage = typeof layerActiveItem?.image === 'string' ? layerActiveItem.image : '';
    const baseImageURL = layerActiveItem
      ? (layerActiveItemImage && !layerActiveItemImage.startsWith('server_generated_outro')
        ? layerActiveItemImage
        : layerActiveItem.src || layerActiveItemImage || '')
      : '';

    const imageMeta = Array.isArray(imageListPayload) ? imageListPayload[layerIdx] : null;
    const skipEnhancement =
      imageMeta?.skip_enhancement === true ||
      imageMeta?.skipEnhancement === true ||
      (layer.skipAiVideoGeneration === true && layer.hasAiVideoLayer === false);
    const requiresEnhancement = resolveImageListItemRequiresEnhancement(imageMeta);

    let generationPayload = {
      videoSessionId: sessionId,
      layerId: layer._id.toString(),
      prompt: promptText,
      originalRetryPrompt: promptSeed,
      originalImageGenerationPrompt: promptSeed,
      originalImageGenerationPromptSource: layer.originalImageGenerationPromptSource || 'initial_generation',
      originalImagePrompt: promptSeed,
      sourcePrompt: promptSeed,
      originalPrompt: promptSeed,
      model: imageModel ? imageModel : 'DALLE3',
      userId: userId,
      inferenceModel: userInferenceModel,
      expressGenerationInferenceModel: userInferenceModel,
      isBaseGeneration: true,
      isBatchGeneration: true,
      aspectRatio: aspectRatio,
      contentFilterRating: 3,
      refilterImageGenerationsRequired: true,
      refilterImagePassNumber: 1,
      imageFilterScoreRequired: true,
      image: baseImageURL,
      ...(customAdapterFallbacks?.text_to_image ? { customFallbackModel: customAdapterFallbacks.text_to_image } : {}),

    };

    if (skipEnhancement) {
      generationPayload.skipEnhancement = true;
    }




    if (imageStyle) {
      generationPayload['imageStyle'] = imageStyle;
    }

    if (!skipEnhancement && requiresEnhancement) {
      if (queuedImageEditRequest && IMAGE_LIST_TO_VIDEO_IMAGE_EDIT_REQUEST_DELAY_MS > 0) {
        await wait(IMAGE_LIST_TO_VIDEO_IMAGE_EDIT_REQUEST_DELAY_MS);
      }
      await addImageUpscaleRequest(userId, generationPayload, false);
      queuedImageEditRequest = true;
    }
  }


  const speechGenerationPayload = [];
  const musicGenerationPayload = [];
  const effectGenerationPayload = [];

  let isInstrumental = true;

  updatedAudioLayers.forEach(function (layer) {
    let pushPayload = {
      videoSessionId: sessionId,
      prompt: layer.prompt,
      isInstrumental: isInstrumental,
      duration: layer.duration,
      startTime: layer.startTime,
      endTime: layer.endTime,
      userId: userId,
      audioLayerId: layer._id.toString(),
      defaultSelected: true,
      volume: resolveExpressBackingTrackVolume(musicProvider),

    };

    if (layer.generationType === 'speech') {


      const speakerType = layer.speaker;
      const fallbackTtsProvider = resolveDockerTTSProvider(
        resolveTTSProviderForLanguage(language, layer.provider || 'ELEVENLABS'),
        layer.provider || 'ELEVENLABS',
      );
      const ttsProvider = resolveDockerTTSProvider(
        resolveTTSProviderForLanguage(
          language,
          hasCustomOperation(custom_adapters, 'text_to_speech')
            ? CUSTOM_MODEL_KEYS.TEXT_TO_SPEECH
            : fallbackTtsProvider,
        ),
        fallbackTtsProvider,
      );
      const speechVolume = Number.isFinite(layer.volume)
        ? layer.volume
        : resolveSpeechVolumeFromSubType(layer.subType);

      pushPayload = {
        videoSessionId: sessionId,
        prompt: layer.prompt,
        isInstrumental: isInstrumental,
        duration: layer.duration,
        startTime: layer.startTime,
        endTime: layer.endTime,
        userId: userId,
        ...(hasFontOverride ? { subtitleFont } : {}),
        audioLayerId: layer._id.toString(),
        speaker: speakerType,
        ttsProvider: ttsProvider,
        languageCode: layer.languageCode || language,
        languageCodes: layer.languageCodes,
        speakerVoiceId: layer.speakerVoiceId,
        speakerLabel: layer.speakerLabel,
        speakerDetails: layer.speakerDetails,
        defaultSelected: true,
        volume: speechVolume,
        ...buildGoogleTTSInputVolumePayload(ttsProvider),
        subType: layer.subType,
        speakerCharacterName: layer.speakerCharacterName,
        instructions: layer.instructions,
        generationMeta: layer.generationMeta,
        ...(customAdapterFallbacks?.text_to_speech && !forceOpenAITTS
          ? { customFallbackTtsProvider: customAdapterFallbacks.text_to_speech }
          : {}),
      };

      speechGenerationPayload.push(pushPayload);
    } else if (layer.generationType === 'music') {

      pushPayload.musicProvider = musicProvider;
      pushPayload.volume = Number.isFinite(Number(layer.volume))
        ? Number(layer.volume)
        : resolveExpressBackingTrackVolume(musicProvider);
      if (customAdapterFallbacks?.text_to_music) {
        pushPayload.customFallbackModel = customAdapterFallbacks.text_to_music;
      }
      musicGenerationPayload.push(pushPayload);
    }

  })



  await requestGenerateSpeechLayersWithTiming(userId, sessionId, speechGenerationPayload);

  await requestGenerateMusicLayersWithTiming(userId, sessionId, musicGenerationPayload);

  if (isStepVideoGeneration) {
    await markExpressStepStageCompleted(sessionId, 'prompt_generation', {
      routeType: stepVideoRoute || 'image_to_video',
      pause: false,
    });
    await markExpressStepStageCompleted(sessionId, 'image_generation', {
      routeType: stepVideoRoute || 'image_to_video',
    });
  }

  return {
    sessionId,
    creditsCharged,
    remainingCredits,
  };

}



function getUniqueSpeakersByActor(list) {
  // Use an object to track the first occurrence of each actor
  const uniqueByActor = {};

  list.forEach(item => {
    if (!uniqueByActor[item.actor]) {
      uniqueByActor[item.actor] = {
        provider: item.provider,
        speaker: item.speaker,
        speakerCharacterName: item.speakerCharacterName,
        actor: item.actor,
        subType: item.subType
      };
    }
  });

  // Return the unique values as an array
  return Object.values(uniqueByActor);
}

export async function requestGenerateSpeechLayersWithTiming(userId, sessionId, payload) {


  await getDBConnectionString();


  const sessionData = await VideoSession.findOne({ _id: sessionId });


  const audioSpeechLayers = [];

  for (let i = 0; i < payload.length; i++) {

	    const currentPayload = payload[i];
    const speechVolume = Number.isFinite(currentPayload.volume)
      ? currentPayload.volume
      : resolveSpeechVolumeFromSubType(currentPayload.subType);

	    let generationPayload = {
	      sessionId: sessionId,
      prompt: currentPayload.prompt,
	      generationType: 'speech',
	      speaker: currentPayload.speaker,
	      languageCode: currentPayload.languageCode,
      languageCodes: currentPayload.languageCodes,
      speakerVoiceId: currentPayload.speakerVoiceId,
      speakerLabel: currentPayload.speakerLabel,
      speakerDetails: currentPayload.speakerDetails,
	      duration: currentPayload.duration,
      startTime: currentPayload.startTime,
      audioLayerId: currentPayload.audioLayerId,
	      rowLocked: false,
	      ttsProvider: currentPayload.ttsProvider,
	      defaultSelected: true,
	      volume: speechVolume,
	      googleTTSInputVolume: currentPayload.googleTTSInputVolume,
	      ttsInputVolume: currentPayload.ttsInputVolume,
	      volumeGainDb: currentPayload.volumeGainDb,
	      googleTTSVolumeGainDb: currentPayload.googleTTSVolumeGainDb,
      ...(currentPayload.customFallbackTtsProvider ? { customFallbackTtsProvider: currentPayload.customFallbackTtsProvider } : {}),


	    };


    if (currentPayload.instructions) {
      generationPayload['instructions'] = currentPayload.instructions;
    }

    if (currentPayload.generationMeta) {
      generationPayload['generationMeta'] = currentPayload.generationMeta;
    }

    if (currentPayload.speakerCharacterName) {
      generationPayload['speakerCharacterName'] = currentPayload.speakerCharacterName;
    }


    audioSpeechLayers.push(generationPayload);
  }

  await Promise.all(audioSpeechLayers.map((layer) => (
    updateCreditsAndCreateGenerateSpeechRequest(userId, layer, false)
  )));
}


export async function requestGenerateMusicLayersWithTiming(userId, sessionId, payload) {


  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });
  const audioMusicLayers = [];

  for (let i = 0; i < payload.length; i++) {
    const currentPayload = payload[i];
    const targetDurationSeconds = resolveBackingTrackTargetDurationSeconds({
      sessionData,
      audioLayerId: currentPayload.audioLayerId,
      requestedDuration: currentPayload.duration,
      requestedStartTime: currentPayload.startTime,
      requestedEndTime: currentPayload.endTime,
    });
    const generationPayload = {
      userId,
      sessionId: sessionId,
      prompt: currentPayload.prompt,
      isInstrumental: true,
      isBackingTrack: true,
      generationType: 'music',
      duration: targetDurationSeconds || currentPayload.duration,
      audioLayerId: currentPayload.audioLayerId.toString(),
      model: currentPayload.musicProvider,
      defaultSelected: true,
      volume: Number.isFinite(Number(currentPayload.volume))
        ? Number(currentPayload.volume)
        : resolveExpressBackingTrackVolume(currentPayload.musicProvider),
      generationMeta: buildBackingTrackGenerationMeta(
        currentPayload.generationMeta,
        targetDurationSeconds || currentPayload.duration
      ),
      ...(currentPayload.customFallbackModel ? { customFallbackModel: currentPayload.customFallbackModel } : {}),
    };
    audioMusicLayers.push(generationPayload);
  }



  await Promise.all(audioMusicLayers.map((layer) => (
    createGenerateMusicRequest(layer)
  )));





}
