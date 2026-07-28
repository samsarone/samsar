import VideoSession from "../../schema/VideoSession.js";
import { getCanvasDimensionsForAspectRatio } from "../../utils/CanvasUtils.js";
import {
  getResourceListForScreenplay, updatePromptWithTheme,
  updateCharacterPromptWithTheme
} from "../agent/MovieCreatorAgent.js";


import { getDBConnectionString } from "../DBString.js";
import { addImageGeneratorRequest, addImageUpscaleRequest, } from '../Images.js';
import {
  createGenerateMusicRequest,
  updateCreditsAndCreateGenerateSpeechRequest,
  resolveBackingTrackTargetDurationSeconds,
  buildBackingTrackGenerationMeta,

} from '../audio/Audio.js';
import { updateAdVideoCharacterPromptWithTheme, updateAdVideoPromptWithTheme } from './ad_creator/AdAgentPrompts.js';

import { getMusicForTextTheme } from '../OpenAI.js';
import { assignCharactersAndInstructionsToScenes } from './MovieGeneratorUtils.js';
import User from "../../schema/User.js";
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { isContainerRuntime } from '../../utils/EnvironmentUtils.js';
import sharp from 'sharp';
import { generateOutroCompositionAssetsFromImageList } from "../api/OutroImageGenerationAPI.js";
import { getLanguageStringFromLanguageCode } from "../../consts/LanguageCodes.js";
import {
  createGeneratedOutroTileItems,
  createOutroCtaTextItems,
  createOutroFadeOverlayItem,
} from './image_list_to_video/OutroLayerItems.js';
import {
  buildOutroImageMetadata,
  normalizeFooterMetadataList,
} from "../../utils/VideoOverlayMetadata.js";
import {
  EXPRESS_VIDEO_BILLING_STAGES,
  buildInitialExpressVideoCreditCharges,
  buildInitialReusedNarrativeExpressVideoCreditCharges,
  chargeExpressVideoStageCredits,
} from "../ExpressVideoStageBilling.js";
import {
  getCurrentAPIKeyUsageContext,
  normalizeAPIKeyUsageContext,
} from "../api/RequestAuthContext.js";
import {
  buildInitialExpressStepGeneration,
  markExpressStepStageCompleted,
} from "../ExpressVideoStepState.js";
import {
  CUSTOM_MODEL_KEYS,
  hasCustomOperation,
} from "../custom/VideoCustomModelConfig.js";
import {
  isOpenAITTSForcedLanguage,
  resolveTTSProviderForLanguage,
} from "./TTSLanguagePolicy.js";
import { normalizeInferenceModel } from "../../consts/InferenceModels.js";
import { normalizeTTSSpeakerGender } from "../../consts/TTSSpeakers.js";
import {
  filterDockerSpeakerOptions,
  isDockerTTSProviderAvailable,
  resolveDockerBackingTrackModel,
  resolveDockerTTSProvider,
} from "../../consts/DockerAudioAvailability.js";
import { translateSpeech } from '../agent/AudioCreatorAgent.js';
import {
  buildSpeechSubtitleLayerFields,
  buildSpeechSubtitleTextMap,
  resolveSubtitleLanguageOption,
} from './SubtitleLanguage.js';
import {
  buildBranchedVideoSessionPlan,
  materializeBranchedVideoSessionPaths,
} from './branching/BranchedVideoSessionPlan.js';
import { hasConnectedSpeechAudioLayer } from '../video/LipSyncLayerState.js';

const MEDIA_DOWNLOAD_TIMEOUT_MS = Number.isFinite(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS)))
  : 180000;
const GOOGLE_TTS_INPUT_VOLUME = 100;
const EXPRESS_BACKING_TRACK_VOLUME = 35;
const EXPRESS_LYRIA_BACKING_TRACK_VOLUME = 45;
const OUTRO_LAYER_DURATION_SECONDS = 8;
const OUTRO_IMAGE_EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/tiff': '.tiff',
  'image/gif': '.gif',
};

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

function isGoogleTTSProvider(provider = '') {
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toUpperCase() : '';
  return normalizedProvider === 'GOOGLE' || normalizedProvider === 'GOOGLE_TTS';
}

function buildGoogleTTSInputVolumePayload(provider = '') {
  if (!isGoogleTTSProvider(provider)) {
    return {};
  }

  return {
    googleTTSInputVolume: GOOGLE_TTS_INPUT_VOLUME,
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
  sessionId,
  component,
  reason,
  error = null,
  metadata = null,
} = {}) {
  const warning = {
    sessionId: sessionId?.toString?.() || sessionId || null,
    component: component || 'unknown',
    reason: reason || 'optional_component_disabled',
    error: summarizeOptionalComponentError(error),
    ...(metadata && typeof metadata === 'object' ? { metadata } : {}),
    createdAt: new Date(),
  };

  if (Array.isArray(warnings)) {
    warnings.push(warning);
  }

}

function normalizeSceneIndex(sceneIndex) {
  if (sceneIndex === null || sceneIndex === undefined) {
    return null;
  }

  const parsedSceneIndex = Number.parseInt(sceneIndex, 10);
  if (!Number.isInteger(parsedSceneIndex) || parsedSceneIndex < 0) {
    return null;
  }

  return parsedSceneIndex;
}

function normalizeLayerSceneType(rawSceneType) {
  const normalizedType = typeof rawSceneType === 'string'
    ? rawSceneType.trim().toLowerCase()
    : '';

  if (
    normalizedType === 'character' ||
    normalizedType === 'narration' ||
    normalizedType === 'sound_effect' ||
    normalizedType === 'base'
  ) {
    return normalizedType;
  }

  if (normalizedType === 'none' || normalizedType === 'scene') {
    return 'base';
  }

  return 'base';
}

function matchesSceneType(sound, sceneType) {
  if (!sound) return false;

  const normalizedSceneType = normalizeLayerSceneType(sceneType);

  if (normalizedSceneType === 'character') {
    return sound.type === 'speech' && sound.subType === 'character';
  }

  if (normalizedSceneType === 'narration') {
    return sound.type === 'speech' && sound.subType === 'narration';
  }

  if (normalizedSceneType === 'sound_effect') {
    return sound.type === 'sound_effect';
  }

  return false;
}

function normalizeAndDeduplicateSpeechSounds(sounds, scenes) {
  const normalizedSounds = sounds.map((sound) => {
    if (!sound || !Object.prototype.hasOwnProperty.call(sound, 'sceneIndex')) {
      return sound;
    }

    const parsedSceneIndex = normalizeSceneIndex(sound.sceneIndex);
    if (parsedSceneIndex === null) {
      return sound;
    }

    return { ...sound, sceneIndex: parsedSceneIndex };
  });

  const chosenSpeechByScene = new Map();
  normalizedSounds.forEach((sound) => {
    if (!sound || sound.type !== 'speech') return;
    const sceneIndex = normalizeSceneIndex(sound.sceneIndex);
    if (sceneIndex === null) return;

    const existing = chosenSpeechByScene.get(sceneIndex);
    if (!existing) {
      chosenSpeechByScene.set(sceneIndex, sound);
      return;
    }

    const sceneType = scenes[sceneIndex]?.type;
    const existingMatches = matchesSceneType(existing, sceneType);
    const currentMatches = matchesSceneType(sound, sceneType);

    if (currentMatches && !existingMatches) {
      chosenSpeechByScene.set(sceneIndex, sound);
    }
  });

  return normalizedSounds.filter((sound) => {
    if (!sound || sound.type !== 'speech') return true;
    const sceneIndex = normalizeSceneIndex(sound.sceneIndex);
    if (sceneIndex === null) return true;
    return chosenSpeechByScene.get(sceneIndex) === sound;
  });
}

function resolveSpeechSubType(sound = {}, scenes = []) {
  const subTypeRaw = typeof sound?.subType === 'string' ? sound.subType.trim().toLowerCase() : '';
  if (subTypeRaw === 'narration' || subTypeRaw === 'character') {
    return subTypeRaw;
  }

  const sceneIndex = normalizeSceneIndex(sound?.sceneIndex);
  if (sceneIndex === null) {
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

  const femaleMatches = text.match(
    /\b(woman|women|female|feminine|girl|girls|she|her|hers|mother|mom|sister|wife|queen|princess)\b/g
  ) || [];
  const maleMatches = text.match(
    /\b(man|men|male|masculine|boy|boys|he|him|his|father|dad|brother|husband|king|prince)\b/g
  ) || [];

  if (femaleMatches.length > maleMatches.length) {
    return 'F';
  }

  if (maleMatches.length > femaleMatches.length) {
    return 'M';
  }

  return null;
}

function inferGenderFromThemeActors(themeJson, sound = {}, scene = {}) {
  const actors = Array.isArray(themeJson?.actors) ? themeJson.actors : [];
  if (!actors.length) {
    return null;
  }

  const identity = typeof sound.Identity === 'string' ? sound.Identity.trim() : '';
  const actorName = typeof sound.actor === 'string' ? sound.actor.trim() : '';
  const speakerName = typeof sound.speakerCharacterName === 'string'
    ? sound.speakerCharacterName.trim()
    : '';
  const sceneSpeaker = typeof scene?.speaker === 'string' ? scene.speaker.trim() : '';
  const needles = [identity, actorName, speakerName, sceneSpeaker]
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

function getSceneForSpeechSound(sound = {}, scenes = []) {
  const sceneIndex = normalizeSceneIndex(sound?.sceneIndex);
  return sceneIndex === null ? null : scenes[sceneIndex] || null;
}

function getSpeechActorKey(sound = {}, scene = {}) {
  const actor = typeof sound.actor === 'string' ? sound.actor.trim() : '';
  const speakerCharacterName = typeof sound.speakerCharacterName === 'string'
    ? sound.speakerCharacterName.trim()
    : '';
  const sceneSpeaker = typeof scene?.speaker === 'string' ? scene.speaker.trim() : '';
  const key = actor || speakerCharacterName || sceneSpeaker;
  return key ? key.toLowerCase() : '';
}

export function ensureNarrativeSpeechGenders(movieResourceList, themeJson) {
  if (!movieResourceList || typeof movieResourceList !== 'object') {
    return movieResourceList;
  }

  const scenes = Array.isArray(movieResourceList.scenes) ? movieResourceList.scenes : [];
  const sounds = Array.isArray(movieResourceList.sounds) ? movieResourceList.sounds : [];
  if (!sounds.length) {
    return movieResourceList;
  }

  function inferGenderForSpeechSound(sound, scene, options = {}) {
    const { allowExistingGender = true } = options;
    const normalizedSoundGender = normalizeSpeechGender(sound?.gender);
    const themeGender = inferGenderFromThemeActors(themeJson, sound, scene);
    const sceneGender = inferGenderFromText(scene?.visual);
    const instructionGender =
      inferGenderFromText(sound?.Affect) ||
      inferGenderFromText(sound?.instructions);
    const textGender =
      inferGenderFromText(sound?.Identity) ||
      inferGenderFromText(sound?.actor) ||
      inferGenderFromText(sound?.audio);

    const subType = resolveSpeechSubType(sound, scenes);
    if (subType === 'character') {
      return sceneGender || instructionGender || themeGender || textGender || (allowExistingGender ? normalizedSoundGender : null);
    }

    if (subType === 'narration') {
      return normalizedSoundGender || textGender;
    }

    return themeGender || normalizedSoundGender || textGender;
  }

  const characterGenderVotesByActor = new Map();
  sounds.forEach((sound) => {
    if (!sound || sound.type !== 'speech' || resolveSpeechSubType(sound, scenes) !== 'character') {
      return;
    }

    const scene = getSceneForSpeechSound(sound, scenes);
    const actorKey = getSpeechActorKey(sound, scene);
    if (!actorKey) {
      return;
    }

    const inferredGender = inferGenderForSpeechSound(sound, scene, { allowExistingGender: false });
    if (!inferredGender) {
      return;
    }

    const currentVotes = characterGenderVotesByActor.get(actorKey) || { M: 0, F: 0 };
    currentVotes[inferredGender] += 1;
    characterGenderVotesByActor.set(actorKey, currentVotes);
  });

  const characterGenderByActor = new Map();
  characterGenderVotesByActor.forEach((votes, actorKey) => {
    if (votes.M > votes.F) {
      characterGenderByActor.set(actorKey, 'M');
    } else if (votes.F > votes.M) {
      characterGenderByActor.set(actorKey, 'F');
    }
  });

  const narrationGenderCandidate = sounds
    .filter((sound) => sound?.type === 'speech' && resolveSpeechSubType(sound, scenes) === 'narration')
    .map((sound) => inferGenderForSpeechSound(sound, getSceneForSpeechSound(sound, scenes)))
    .find(Boolean);

  const narratorGender = narrationGenderCandidate || 'F';

  return {
    ...movieResourceList,
    sounds: sounds.map((sound) => {
      if (!sound || sound.type !== 'speech') {
        return sound;
      }

      const subType = resolveSpeechSubType(sound, scenes);
      const scene = getSceneForSpeechSound(sound, scenes);
      const actorKey = getSpeechActorKey(sound, scene);
      const enforcedGender = subType === 'narration'
        ? narratorGender
        : (characterGenderByActor.get(actorKey) || inferGenderForSpeechSound(sound, scene) || 'F');

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

export function alignSpeechSpeakerNamesToScenes(movieResourceList = {}) {
  if (!movieResourceList || typeof movieResourceList !== 'object') {
    return movieResourceList;
  }

  const scenes = Array.isArray(movieResourceList.scenes) ? movieResourceList.scenes : [];
  const sounds = Array.isArray(movieResourceList.sounds) ? movieResourceList.sounds : [];
  if (!sounds.length) {
    return movieResourceList;
  }

  return {
    ...movieResourceList,
    sounds: sounds.map((sound) => {
      if (!sound || sound.type !== 'speech') {
        return sound;
      }

      const sceneIndex = normalizeSceneIndex(sound.sceneIndex);
      if (sceneIndex === null) {
        return sound;
      }

      const sceneSpeakerName = typeof scenes?.[sceneIndex]?.speaker === 'string'
        ? scenes[sceneIndex].speaker.trim()
        : '';

      if (!sceneSpeakerName || sound.speakerCharacterName === sceneSpeakerName) {
        return sound;
      }

      return {
        ...sound,
        speakerCharacterName: sceneSpeakerName,
      };
    }),
  };
}

export async function buildVideoSessionMovieResourceList({
  inputPrompt,
  narrativeJson,
  themeJson,
  videoTone = 'cinematic',
  language = 'auto',
  speakerOptions = null,
  inferenceModel,
  onInferenceResponse,
} = {}) {
  const movieResourceListWithGenders = ensureNarrativeSpeechGenders(
    narrativeJson,
    themeJson,
  );
  const resolvedSpeakerOptions = filterDockerSpeakerOptions(speakerOptions);
  const movieResourceListWithCharacters = await assignCharactersAndInstructionsToScenes(
    inputPrompt,
    movieResourceListWithGenders,
    videoTone,
    {
      language,
      speakerOptions: resolvedSpeakerOptions,
      inferenceModel,
      onInferenceResponse,
    },
  );

  return alignSpeechSpeakerNamesToScenes(movieResourceListWithCharacters);
}

function buildVisualPromptInferenceOptions({
  externalRequestContext,
  onInferenceResponse,
  requestKey,
  sceneIndex,
}) {
  const normalizedContext = externalRequestContext && typeof externalRequestContext === 'object'
    ? externalRequestContext
    : null;

  return {
    ...(normalizedContext
      ? {
        externalRequestContext: {
          ...normalizedContext,
          requestKey,
        },
      }
      : {}),
    ...(typeof onInferenceResponse === 'function'
      ? {
        onInferenceResponse: (receipt) => onInferenceResponse({
          ...receipt,
          requestKey,
          sceneIndex,
        }),
      }
      : {}),
  };
}

export async function buildMovieResourceListVisualPrompts({
  movieResourceList,
  themeJson,
  aspectRatio = '1:1',
  inferenceModel,
  videoTone = 'cinematic',
  isAdVideo = false,
  startImageDescriptions = [],
  externalRequestContext = null,
  requestKeyPrefix = 'text_to_video:visual',
  onInferenceResponse,
  dependencies = {},
} = {}) {
  const scenes = Array.isArray(movieResourceList?.scenes)
    ? movieResourceList.scenes
    : [];
  const themeJsonString = typeof themeJson === 'string'
    ? themeJson
    : JSON.stringify(themeJson ?? {});
  const updateGenericPrompt = dependencies.updatePromptWithTheme || updatePromptWithTheme;
  const updateCharacterPrompt = dependencies.updateCharacterPromptWithTheme ||
    updateCharacterPromptWithTheme;
  const updateAdGenericPrompt = dependencies.updateAdVideoPromptWithTheme ||
    updateAdVideoPromptWithTheme;
  const updateAdCharacterPrompt = dependencies.updateAdVideoCharacterPromptWithTheme ||
    updateAdVideoCharacterPromptWithTheme;
  const promptList = [];

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
    const scene = scenes[sceneIndex] || {};
    const sceneType = normalizeLayerSceneType(scene.type);
    const requestKey = `${requestKeyPrefix}:scene-${sceneIndex}`;
    const inferenceOptions = buildVisualPromptInferenceOptions({
      externalRequestContext,
      onInferenceResponse,
      requestKey,
      sceneIndex,
    });
    let prompt;

    if (isAdVideo && startImageDescriptions.length > 0) {
      prompt = sceneType === 'character'
        ? await updateAdCharacterPrompt(
          scene.visual,
          startImageDescriptions,
          scene.speaker,
          themeJsonString,
          aspectRatio,
          inferenceModel,
          false,
          videoTone,
        )
        : await updateAdGenericPrompt(
          scene.visual,
          startImageDescriptions,
          themeJsonString,
          aspectRatio,
          inferenceModel,
          false,
          videoTone,
        );
    } else {
      prompt = sceneType === 'character'
        ? await updateCharacterPrompt(
          scene.visual,
          scene.speaker,
          themeJsonString,
          aspectRatio,
          inferenceModel,
          false,
          videoTone,
          inferenceOptions,
        )
        : await updateGenericPrompt(
          scene.visual,
          themeJsonString,
          aspectRatio,
          inferenceModel,
          false,
          videoTone,
          inferenceOptions,
        );
    }

    const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    if (!normalizedPrompt) {
      const error = new Error(`Visual prompt generation returned an empty result for scene ${sceneIndex}.`);
      error.code = 'VISUAL_PROMPT_GENERATION_FAILED';
      error.status = 502;
      error.statusCode = 502;
      throw error;
    }

    promptList.push({
      prompt: normalizedPrompt,
      duration: scene.duration,
      sceneType,
    });
  }

  return {
    promptList,
    movieResourceList: {
      ...(movieResourceList || {}),
      scenes: scenes.map((scene, sceneIndex) => ({
        ...(scene || {}),
        visual: promptList[sceneIndex].prompt,
      })),
    },
  };
}

export async function extractElementsFromTranscriptAndRequestQuickMovieGeneration(userId, payload) {

  const { aspectRatio, sessionId,
    screenplay
  } = payload;

  let musicProvider = 'CASSETTEAI';
  const videoModel = 'LUMA';

  await getDBConnectionString();

  const userData = await User.findOne({ _id: userId });

  const userInferenceModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  const movieResourceList = await getResourceListForScreenplay(screenplay, userInferenceModel, videoModel);

  const imageModel = 'FLUX1.1PRO';

  const movieGenerationRequestPayload = {
    aspectRatio,
    sessionId,
    movieResourceList,
    imageModel,
    musicProvider,
  };

  await requestQuickMovieGeneration(userId, movieGenerationRequestPayload);


}



function clonePreparedNarrativeArtifact(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function buildVideoSessionNarrativeArtifactFields({
  movieResourceList,
  narrativeJson,
} = {}) {
  return {
    ...(movieResourceList && typeof movieResourceList === 'object'
      ? { movieResourceList: clonePreparedNarrativeArtifact(movieResourceList) }
      : {}),
    ...(narrativeJson && typeof narrativeJson === 'object'
      ? { narrativeJson: clonePreparedNarrativeArtifact(narrativeJson) }
      : {}),
  };
}

export function buildPreparedNarrativeVisualPromptList(movieResourceList = {}) {
  const scenes = Array.isArray(movieResourceList?.scenes)
    ? movieResourceList.scenes
    : [];

  if (scenes.length === 0) {
    const error = new Error('Prepared movieResourceList must include at least one scene.');
    error.code = 'INVALID_PREPARED_NARRATIVE';
    error.status = 422;
    throw error;
  }

  return scenes.map((scene, sceneIndex) => {
    const prompt = typeof scene?.visual === 'string' ? scene.visual.trim() : '';
    const duration = Number(scene?.duration);
    if (!prompt) {
      const error = new Error(`Prepared scene ${sceneIndex} must include a non-empty visual.`);
      error.code = 'INVALID_PREPARED_NARRATIVE';
      error.status = 422;
      throw error;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      const error = new Error(`Prepared scene ${sceneIndex} must include a positive duration.`);
      error.code = 'INVALID_PREPARED_NARRATIVE';
      error.status = 422;
      throw error;
    }
    return {
      prompt,
      duration,
      sceneType: normalizeLayerSceneType(scene?.type),
      ...(scene?.branchAssetKey ? { branchAssetKey: scene.branchAssetKey } : {}),
      ...(Number.isInteger(scene?.branchSourceSceneIndex)
        ? { branchSourceSceneIndex: scene.branchSourceSceneIndex }
        : {}),
    };
  });
}

export async function requestQuickMovieGeneration(userId, payload) {
  return requestQuickMovieGenerationInternal(userId, payload, {
    usePreparedNarrativeArtifacts: false,
  });
}

export async function requestQuickMovieGenerationFromNarrativeArtifacts(userId, payload) {
  return requestQuickMovieGenerationInternal(userId, payload, {
    usePreparedNarrativeArtifacts: true,
  });
}

async function requestQuickMovieGenerationInternal(userId, payload, {
  usePreparedNarrativeArtifacts = false,
} = {}) {

  await getDBConnectionString();

  const { aspectRatio,
    sessionId,
    inputPrompt,
    movieResourceList,

    imageModel = 'FLUX1.1PRO',
    requestMusicGeneration,
    videoGenerationModel = videoModel,
    videoGenerationModelSubType,
    themeJson,
    imageStyle,

    isAdVideo = false,
    startImageDescriptions = [],
    videoTone,
    language = 'auto',
    subtitleFont: requestedSubtitleFont,
    speakerFont: requestedSpeakerFont,
    enableSubtitles = true,
    subtitle_language = undefined,
    subtitleLanguage = undefined,
    subtitle_language_explicit = undefined,
    subtitleLanguageExplicit = undefined,
    isExternalUserRequest = false,
    externalRequestUserId = null,
    externalRequestId = null,
    externalRequestIdentityKey = null,
    outroImageUrl,
    addOutroAnimation = false,
    addOutroFocusArea = false,
    outroFocustArea = null,
    generateOutroImage = false,
    ctaUrl,
    ctaTextTop,
    ctaTextBottom,
    ctaLogo,
    outroCtaImage,
    addFooterAnimation = false,
    footerMetadata = [],
    speakerOptions: requestSpeakerOptions = null,
    custom_adapters = null,
    customAdapterFallbacks = null,
    customAdapterOperationUsage = null,
    inference_model = null,
    inferenceModel = null,
    isStepVideoGeneration = false,
    stepVideoRoute = null,
    manualStepStages = undefined,
    manual_step_stages = undefined,
    optionalComponentWarnings: upstreamOptionalComponentWarnings = [],
    sourceNarrativeRequestId = null,
    sourceNarrativeType = null,
    narrativeJson: sourceNarrativeJson = null,
    branchingMeta: sourceBranchingMeta = null,
  } = payload;
  const resolvedManualStepStages = manualStepStages !== undefined
    ? manualStepStages
    : manual_step_stages;
  const resolvedRequestType = typeof payload.requestType === 'string' && payload.requestType.trim()
    ? payload.requestType.trim()
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
  const normalizedLanguage = typeof language === 'string' && language.trim()
    ? language.trim()
    : 'auto';
  const sessionLanguage = normalizedLanguage.toLowerCase() === 'auto' ? 'EN' : normalizedLanguage;
  const languageString = payload.languageString || getLanguageStringFromLanguageCode(sessionLanguage);
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
  const forceOpenAITTS = isOpenAITTSForcedLanguage(normalizedLanguage) &&
    isDockerTTSProviderAvailable('OPENAI');



  const userData = await User.findOne({ _id: userId });
  const userInferenceModel = normalizeInferenceModel(
    inference_model || inferenceModel || userData?.selectedInferenceModel
  );
  const sourcePreparedMovieResourceList = usePreparedNarrativeArtifacts
    ? clonePreparedNarrativeArtifact(movieResourceList)
    : null;
  const branchedVideoSessionPlan = usePreparedNarrativeArtifacts &&
    sourceNarrativeType === 'branched'
    ? buildBranchedVideoSessionPlan(sourcePreparedMovieResourceList, {
      branchingMeta: sourceBranchingMeta,
      videoGenerationModel,
      framesPerSecond: Number(payload.framesPerSecond || payload.frames_per_second) || 24,
      requestedDuration: Number(payload.duration) || null,
    })
    : null;
  const movieResourceListWithCharacters = usePreparedNarrativeArtifacts
    ? clonePreparedNarrativeArtifact(
      branchedVideoSessionPlan?.canonicalMovieResourceList || sourcePreparedMovieResourceList,
    )
    : await buildVideoSessionMovieResourceList({
      inputPrompt,
      narrativeJson: movieResourceList,
      themeJson,
      videoTone,
      language,
      speakerOptions: requestSpeakerOptions || userData?.speakerOptions || null,
      inferenceModel: userInferenceModel,
    });
  const { scenes = [], sounds: rawSounds = [] } = movieResourceListWithCharacters;



  const musicProvider = resolveDockerBackingTrackModel(
    normalizeBackingTrackProvider(payload.musicProvider || userData.backingTrackModel || 'ELEVENLABS_MUSIC')
  );

  const selectedNotifyOnCompletion = userData.selectedNotifyOnCompletion;



  const promptList = [];

  const themeJsonString = JSON.stringify(themeJson);

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
  let effectiveOutroImageUrl = typeof outroImageUrl === 'string' ? outroImageUrl.trim() : '';
  let effectiveAddOutroAnimation = addOutroAnimation === true;
  let effectiveAddOutroFocusArea = addOutroFocusArea === true;
  let effectiveOutroFocustArea = outroFocustArea ?? null;
  let generatedOutroComposition = null;
  const optionalComponentWarnings = Array.isArray(upstreamOptionalComponentWarnings)
    ? [...upstreamOptionalComponentWarnings]
    : [];

  if (generateOutroImage === true) {
    try {
      generatedOutroComposition = await generateOutroCompositionAssetsFromImageList({
        imageListPayload: [],
        imageUrls: [],
        aspectRatio,
        ctaUrl,
        outroCtaImage,
        assetsRoot,
        sessionId,
        ctaLogo,
      });

      effectiveOutroImageUrl = '';
      effectiveAddOutroAnimation = true;
      effectiveAddOutroFocusArea = false;
      effectiveOutroFocustArea = null;

    } catch (error) {
      recordOptionalComponentFallback(optionalComponentWarnings, {
        sessionId,
        component: 'generated_outro_image',
        reason: 'generation_failed',
        error,
        metadata: {
          aspectRatio,
          hasCtaUrl: Boolean(ctaUrl),
          hasCtaLogo: Boolean(ctaLogo),
          hasOutroCtaImage: Boolean(outroCtaImage),
        },
      });
      generatedOutroComposition = null;
      effectiveOutroImageUrl = '';
      effectiveAddOutroAnimation = false;
      effectiveAddOutroFocusArea = false;
      effectiveOutroFocustArea = null;
    }
  }

  let outroAssetRelativePath = generatedOutroComposition?.background?.src || null;
  if (!generatedOutroComposition && effectiveOutroImageUrl) {
    try {
      const outroFolderPath = path.join(assetsRoot, 'video', 'outro', sessionId);

      await fs.promises.mkdir(outroFolderPath, { recursive: true });

      let outroExtension = '.png';
      let sourceBuffer = null;

      if (!sourceBuffer) {
        const dataUrlImage = decodeImageDataUrl(effectiveOutroImageUrl);
        if (dataUrlImage) {
          sourceBuffer = dataUrlImage.buffer;
          outroExtension = resolveImageExtensionFromMimeType(dataUrlImage.mimeType);
        } else {
          try {
            const parsedUrl = new URL(effectiveOutroImageUrl);
            const extFromUrl = path.extname(parsedUrl.pathname);
            if (extFromUrl) {
              outroExtension = extFromUrl;
            }
          } catch (err) {
            // Fall back to the default extension when URL parsing fails.
          }

          const response = await axios.get(effectiveOutroImageUrl, {
            responseType: 'arraybuffer',
            timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
          });
          sourceBuffer = Buffer.from(response.data);
        }
      }

      const outroFileName = `outro${outroExtension || '.png'}`;
      let outroFilePath = path.join(outroFolderPath, outroFileName);

      await fs.promises.writeFile(outroFilePath, sourceBuffer);

      const outroMetadata = await sharp(outroFilePath).metadata();
      const outroWidth = outroMetadata.width;
      const outroHeight = outroMetadata.height;

      if (!outroWidth || !outroHeight) {
        throw new Error('Unable to determine dimensions for the outro image.');
      }

      const requiredWidth = canvasDimensions.width;
      const requiredHeight = canvasDimensions.height;

      if (outroWidth !== requiredWidth || outroHeight !== requiredHeight) {
        if (outroWidth < requiredWidth || outroHeight < requiredHeight) {
          recordOptionalComponentFallback(optionalComponentWarnings, {
            sessionId,
            component: 'outro_image',
            reason: 'supplied_image_upscaled_to_canvas',
            metadata: {
              sourceWidth: outroWidth,
              sourceHeight: outroHeight,
              requiredWidth,
              requiredHeight,
              aspectRatio,
            },
          });
        }

        const normalizedOutroFilePath = path.join(outroFolderPath, 'outro.png');
        await sharp(outroFilePath)
          .resize(requiredWidth, requiredHeight, {
            fit: 'cover',
            position: 'center',
          })
          .png()
          .toFile(normalizedOutroFilePath);
        outroFilePath = normalizedOutroFilePath;
      }

      outroAssetRelativePath = toPublicAssetPath(outroFilePath);
    } catch (error) {
      recordOptionalComponentFallback(optionalComponentWarnings, {
        sessionId,
        component: 'outro_image',
        reason: 'persist_failed',
        error,
        metadata: {
          generatedOutroImage: generateOutroImage === true,
          hasDataUrl: effectiveOutroImageUrl.startsWith('data:'),
          addOutroAnimation: effectiveAddOutroAnimation,
          addOutroFocusArea: effectiveAddOutroFocusArea,
        },
      });
      outroAssetRelativePath = null;
      effectiveOutroImageUrl = '';
      effectiveAddOutroAnimation = false;
      effectiveAddOutroFocusArea = false;
      effectiveOutroFocustArea = null;
    }
  }

  let outroFocusAssetRelativePath = null;
  let outroFocusArea = null;
  if (effectiveAddOutroAnimation && effectiveAddOutroFocusArea && outroAssetRelativePath && effectiveOutroFocustArea) {
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
          console.error('Failed to extract text-to-video outro focus area for session', sessionId, error);
        }
      }
    }
  }

  const normalizedFooterMetadata = normalizeFooterMetadataList(footerMetadata);
  if (addFooterAnimation === true) {
    const rawFooterCount = Array.isArray(footerMetadata) ? footerMetadata.length : 0;
    if (rawFooterCount === 0 || normalizedFooterMetadata.length === 0) {
      recordOptionalComponentFallback(optionalComponentWarnings, {
        sessionId,
        component: 'footer_animation',
        reason: 'missing_valid_footer_metadata',
        metadata: {
          rawFooterCount,
          normalizedFooterCount: normalizedFooterMetadata.length,
        },
      });
    } else if (normalizedFooterMetadata.length < rawFooterCount) {
      recordOptionalComponentFallback(optionalComponentWarnings, {
        sessionId,
        component: 'footer_animation',
        reason: 'some_footer_metadata_entries_ignored',
        metadata: {
          rawFooterCount,
          normalizedFooterCount: normalizedFooterMetadata.length,
        },
      });
    } else if (normalizedFooterMetadata.length > 1 && normalizedFooterMetadata.length < scenes.length) {
      recordOptionalComponentFallback(optionalComponentWarnings, {
        sessionId,
        component: 'footer_animation',
        reason: 'footer_metadata_shorter_than_scene_count',
        metadata: {
          sceneCount: scenes.length,
          normalizedFooterCount: normalizedFooterMetadata.length,
        },
      });
    }
  }
  const shouldAddFooterAnimation = addFooterAnimation === true && normalizedFooterMetadata.length > 0;
  const outroImageMetadata = buildOutroImageMetadata({
    generated: Boolean(generatedOutroComposition),
    sourceUrl: effectiveOutroImageUrl || null,
    assetPath: outroAssetRelativePath,
    ctaUrl,
    ctaTextTop,
    ctaTextBottom,
    ctaLogo,
    outroCtaImage,
  });
  const getFooterMetadataForScene = (sceneIndex) => {
    if (!shouldAddFooterAnimation) {
      return null;
    }
    if (normalizedFooterMetadata.length === 1) {
      return normalizedFooterMetadata[0];
    }
    return normalizedFooterMetadata[sceneIndex] || normalizedFooterMetadata[normalizedFooterMetadata.length - 1] || null;
  };

  const sounds = normalizeAndDeduplicateSpeechSounds(rawSounds, scenes);


  const soundAudioLayers = sounds.filter((sound) => sound.type !== 'sound_effect');

  const soundEffectAudioLayers = sounds.filter((sound) => sound.type === 'sound_effect');

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

  const audioLayers = soundAudioLayers.map(function (sound, index) {
    const sceneIndex = normalizeSceneIndex(sound.sceneIndex);
    const isOpenAISpeaker = typeof sound.provider === 'string' && sound.provider.trim().toUpperCase() === 'OPENAI';
    const generationMeta = isOpenAISpeaker
      ? {
          Identity: sound.Identity,
          Affect: sound.Affect,
          Tone: sound.Tone,
          Emotion: sound.Emotion,
          Pronunciation: sound.Pronunciation,
          Pause: sound.Pause,
        }
      : null;


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
      duration: sound.duration,
      startTime: sound.startTime,
      endTime: sound.endTime,
      defaultSelected: true,
      volume: 100,
      speaker: sound.speaker,
      provider: sound.provider,
      speakerVoiceId: sound.speakerVoiceId,
      speakerLabel: sound.speakerLabel,
      speakerDetails: sound.speakerDetails,
      languageCode: sound.languageCode,
      languageCodes: sound.languageCodes,
      speakerCharacterName: sound.speakerCharacterName,
      ...(hasFontOverride ? { subtitleFont } : {}),
      isEnabled: true,
      addSubtitles: shouldEnableSubtitles,
      instructions: isOpenAISpeaker ? sound.instructions : undefined,
      ...(sound.branchAssetKey ? { branchAssetKey: sound.branchAssetKey } : {}),
      ...(sound.branchAudioAssetKey
        ? { branchAudioAssetKey: sound.branchAudioAssetKey }
        : {}),
      ...(Number.isInteger(sound.branchSourceSceneIndex)
        ? { branchSourceSceneIndex: sound.branchSourceSceneIndex }
        : {}),

    }

    if (generationMeta) {
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
    const numLayers = scenes.length;

    const audioDuration = numLayers * 10;

    const musicTheme = await getMusicForTextTheme(themeJsonString, userInferenceModel, musicProvider);

    const musicVolume = resolveExpressBackingTrackVolume(musicProvider);

    const musicGenerationPayload = {
      videoSessionId: sessionId,
      prompt: musicTheme,
      isInstrumental: true,
      model: musicProvider,
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

  if (usePreparedNarrativeArtifacts) {
    // The NarrativeRequest already completed the character and visual-prompt
    // enrichment steps. Its visuals are the image-generation prompts.
    promptList.push(...buildPreparedNarrativeVisualPromptList(movieResourceListWithCharacters));
  } else {
    const visualPromptResult = await buildMovieResourceListVisualPrompts({
      movieResourceList: movieResourceListWithCharacters,
      themeJson,
      aspectRatio,
      inferenceModel: userInferenceModel,
      videoTone,
      isAdVideo,
      startImageDescriptions,
    });
    promptList.push(...visualPromptResult.promptList);
  }

  let durationOffset = 0;

  const newSessionLayers = promptList.map((promptItem, pIdx) => {

    const prompt = promptItem.prompt;
    const duration = promptItem.duration;

    const sceneType = promptItem.sceneType;


    const initActiveItemList = [{
      'id': 'item_0',
      'type': 'image',
      'x': 0,
      'y': 0,
      'width': canvasDimensions.width,
      'height': canvasDimensions.height,
      'src': '',
      'is_base_image': true,
      'animations': [],
    }];




    let currentGenerationStatus = 'PENDING';

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
      originalImageGenerationPrompt: prompt,
      originalImageGenerationPromptSource: 'initial_generation',
      originalImagePrompt: prompt,
      sourcePrompt: prompt,
      originalPrompt: prompt,
      activeItemList: initActiveItemList,

    };

    const effectiveSceneType = normalizeLayerSceneType(sceneType);

    const isLipSyncRequired = effectiveSceneType === 'character';
    const isSoundEffectRequired = effectiveSceneType === 'sound_effect';

    const layerAiVideoType = isLipSyncRequired
      ? 'character'
      : isSoundEffectRequired
        ? 'sound_effect'
        : effectiveSceneType === 'narration'
          ? 'narration'
          : 'scene';
    const layerBaseAiImageType = isLipSyncRequired
      ? 'character'
      : isSoundEffectRequired
        ? 'sound_effect'
        : 'scene';



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
      layerAiVideoType: layerAiVideoType,
      hasAiVideoLayer: true,
      lipSyncGenerationPending: isLipSyncRequired
        && hasConnectedSpeechAudioLayer(audioLayers, {}, pIdx),
      soundEffectGenerationPending: isSoundEffectRequired,
      layerBaseAiImageType: layerBaseAiImageType,
      ...(promptItem.branchAssetKey ? { branchAssetKey: promptItem.branchAssetKey } : {}),
      ...(Number.isInteger(promptItem.branchSourceSceneIndex)
        ? { branchSourceSceneIndex: promptItem.branchSourceSceneIndex }
        : {}),
      ...(getFooterMetadataForScene(pIdx)
        ? {
          addFooterAnimation: true,
          footerMetadata: getFooterMetadataForScene(pIdx),
        }
        : {}),

    };


    if (isSoundEffectRequired) {



      const soundEffectLayer = soundEffectAudioLayers.find((sound) => sound.sceneIndex === pIdx);



      if (soundEffectLayer) {


        layerPayload.layerAISoundEffectPrompt = soundEffectLayer.audio;
      }
    }

    durationOffset += duration;


    return layerPayload;
  });

  if (outroAssetRelativePath) {
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

      if (effectiveAddOutroAnimation) {
        outroActiveItemList.push(createOutroFadeOverlayItem({
          id: `item_${outroActiveItemList.length}`,
          canvasDimensions,
        }));
      }

      outroActiveItemList.push(...createOutroCtaTextItems({
        canvasDimensions,
        ctaTextTop,
        ctaTextBottom,
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
        image: effectiveOutroImageUrl,
        x: 0,
        y: 0,
        width: canvasDimensions.width,
        height: canvasDimensions.height,
        src: outroAssetRelativePath,
        is_base_image: true,
        animations: [],
      }];

      if (effectiveAddOutroAnimation) {
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
      generationStatus: generatedOutroComposition ? 'COMPLETED' : 'PENDING',
      editStatus: 'INIT',
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
          outroImagePath: generatedOutroComposition.background.src,
          isGeneratedOutroLayer: true,
          generatedOutroImage: true,
          generatedOutroTilesPending: true,
          generatedOutroTilesSource: 'active_item_top_images',
        }
        : {}),
    });

    durationOffset += OUTRO_LAYER_DURATION_SECONDS;
  }

  const totalTimelineDuration = branchedVideoSessionPlan
    ? Math.max(...branchedVideoSessionPlan.branchRenderPaths.map((path) => path.duration), 0) +
      (outroAssetRelativePath ? OUTRO_LAYER_DURATION_SECONDS : 0)
    : durationOffset;
  const branchedBillableLayerDuration = branchedVideoSessionPlan
    ? newSessionLayers.reduce((total, layer) => {
      const layerDuration = Number(layer?.duration);
      return total + (Number.isFinite(layerDuration) && layerDuration > 0 ? layerDuration : 0);
    }, 0)
    : null;
  const branchedBillingStageDurations = branchedVideoSessionPlan
    ? {
      [EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION]: branchedBillableLayerDuration,
      [EXPRESS_VIDEO_BILLING_STAGES.SPEECH_GENERATION]: branchedBillableLayerDuration,
      [EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION]: branchedBillableLayerDuration,
      [EXPRESS_VIDEO_BILLING_STAGES.SOUND_EFFECT_GENERATION]: branchedBillableLayerDuration,
      [EXPRESS_VIDEO_BILLING_STAGES.LIP_SYNC_GENERATION]: branchedBillableLayerDuration,
      [EXPRESS_VIDEO_BILLING_STAGES.NARRATOR_AVATAR_GENERATION]: branchedBillableLayerDuration,
      [EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION]: branchedBillableLayerDuration,
      [EXPRESS_VIDEO_BILLING_STAGES.PIPELINE]: branchedBillableLayerDuration,
    }
    : null;
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


  let expressGenerationStatus = {
    'prompt_generation': 'COMPLETED',
    'image_generation': 'PENDING',
    'audio_generation': 'PENDING',
    'frame_generation': 'INIT',
    'video_generation': 'INIT',
    'ai_video_generation': 'INIT',
    'speech_generation': 'INIT',
    'music_generation': 'INIT',
    'lip_sync_generation': 'INIT',
    'sound_effect_generation': 'INIT',
    'transcript_generation': shouldEnableSubtitles ? 'INIT' : 'COMPLETED',
  }


  const movieGenSpeakerList = getUniqueSpeakersByActor(soundAudioLayers)

  const initialCreditCharges = usePreparedNarrativeArtifacts
    ? buildInitialReusedNarrativeExpressVideoCreditCharges(
      branchedBillableLayerDuration || totalTimelineDuration,
      sourceNarrativeRequestId,
    )
    : buildInitialExpressVideoCreditCharges(totalTimelineDuration);


  await VideoSession.updateOne({ _id: sessionId }, {
    $set: {
      layers: newSessionLayers,
      audioLayers: audioLayers,
      generationStatus: 'PENDING',
      outpaintStatus: 'INIT',
      expressGenerationPending: true,
      videoGenerationPending: true,
      isExpressGeneration: true,
      setAutoDurationPerScene: false,
      'expressGenerationStatus': expressGenerationStatus,
      expressGenerationCreated: new Date(),
      aspectRatio: aspectRatio,
      isMovieGen: true,
      expressGenerativeVideoRequired: true,
      expressGenerativeVideoModel: videoGenerationModel,
      expressGenerativeVideoModelSubType: videoGenerationModelSubType,
      expressGenerativeVideoUseEndFrame: true,
      expressGenerationImageModel: imageModel,
      notifyOnCompletion: selectedNotifyOnCompletion,
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
      requestType: resolvedRequestType,
      creditSource: payload.creditSource || 'text_to_video',
      builderRouteType: 'text_to_video',
      expressGenerationType: 'TEXT_TO_VIDEO',
      isVidGPTGen: true,
      parentJsonTheme: themeJsonString,
      movieGenSpeakers: movieGenSpeakerList,
      ...buildVideoSessionNarrativeArtifactFields({
        movieResourceList: branchedVideoSessionPlan
          ? sourcePreparedMovieResourceList
          : movieResourceListWithCharacters,
        narrativeJson: sourceNarrativeJson,
      }),
      ...(usePreparedNarrativeArtifacts
        ? {
          sourceNarrativeRequestId,
          sourceNarrativeType: sourceNarrativeType || 'singular',
          narrativeType: sourceNarrativeType || 'singular',
          themeJson: clonePreparedNarrativeArtifact(themeJson),
          branchingMeta: clonePreparedNarrativeArtifact(
            branchedVideoSessionPlan?.branchingMeta || sourceBranchingMeta,
          ),
          ...(branchedVideoSessionPlan
            ? {
              renderPlanVersion: branchedVideoSessionPlan.renderPlanVersion,
              defaultBranchPathId: branchedVideoSessionPlan.defaultBranchPathId,
              branchingTimeline: clonePreparedNarrativeArtifact(
                branchedVideoSessionPlan.branchingTimeline,
              ),
              branchRenderPaths: clonePreparedNarrativeArtifact(
                branchedVideoSessionPlan.branchRenderPaths,
              ),
            }
            : {}),
        }
        : {}),
      hasOutroImage: !!outroAssetRelativePath,
      outroImageURL: outroAssetRelativePath,
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
      ...(optionalComponentWarnings.length > 0
        ? { expressGenerationOptionalComponentWarnings: optionalComponentWarnings }
        : {}),

      provisionalCredits: 0,
      expressGenerationBillingDurationSeconds:
        branchedBillableLayerDuration || totalTimelineDuration,
      ...(branchedBillingStageDurations
        ? { expressGenerationBillingStageDurations: branchedBillingStageDurations }
        : {}),
      expressGenerationCreditCharges: initialCreditCharges,
      ...(isStepVideoGeneration
        ? {
          isStepVideoGeneration: true,
          expressStepGeneration: buildInitialExpressStepGeneration({
            routeType: stepVideoRoute || 'text_to_video',
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
      language: normalizedLanguage,
      languageString: languageString || null,
      sessionLanguage,
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

  if (!usePreparedNarrativeArtifacts) {
    const inferenceChargeResult = await chargeExpressVideoStageCredits({
      sessionId,
      stageKey: EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE,
      requestType: resolvedRequestType,
    });
    if (!inferenceChargeResult?.ok) {
      throw new Error(inferenceChargeResult?.error || 'Unable to charge narrative inference credits.');
    }
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


  const materializedBranchRenderPaths = branchedVideoSessionPlan
    ? materializeBranchedVideoSessionPaths(branchedVideoSessionPlan, {
      layers: updatedLayers,
      audioLayers: updatedAudioLayers,
    })
    : null;

  await VideoSession.updateOne({ _id: sessionId }, {
    $set: {
      audioLayers: updatedAudioLayers,
      ...(materializedBranchRenderPaths
        ? {
          branchRenderPaths: materializedBranchRenderPaths,
          renderPlanVersion: branchedVideoSessionPlan.renderPlanVersion,
          defaultBranchPathId: branchedVideoSessionPlan.defaultBranchPathId,
          branchingTimeline: clonePreparedNarrativeArtifact(
            branchedVideoSessionPlan.branchingTimeline,
          ),
        }
        : {}),
    },
  });



  const imageGenerationRequests = latestSessionData.layers.map(async (layer) => {
    if (layer?.isGeneratedOutroLayer === true) {
      return;
    }

    const promptSeed = layer.originalImageGenerationPrompt || layer.originalImagePrompt || layer.sourcePrompt || layer.originalPrompt || layer.prompt;
    const promptText = `${promptSeed} `;
    const layerActiveItem = layer.imageSession?.activeItemList?.find((item) => item?.is_base_image);
    const layerActiveItemImage = typeof layerActiveItem?.image === 'string' ? layerActiveItem.image : '';
    const baseImageURL = layerActiveItem
      ? (layerActiveItemImage && !layerActiveItemImage.startsWith('server_generated_outro')
        ? layerActiveItemImage
        : layerActiveItem.src || layerActiveItemImage || '')
      : '';

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
      ...(customAdapterFallbacks?.text_to_image ? { customFallbackModel: customAdapterFallbacks.text_to_image } : {}),

    };

    if (layer.skipAiVideoGeneration === true && layer.hasAiVideoLayer === false) {
      generationPayload.image = baseImageURL;
      generationPayload.skipEnhancement = true;
      await addImageUpscaleRequest(userId, generationPayload, false);
      return;
    }


    if (imageStyle) {
      generationPayload['imageStyle'] = imageStyle;
    }

    await addImageGeneratorRequest(userId, generationPayload, false);
  });


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
        resolveTTSProviderForLanguage(normalizedLanguage, layer.provider || 'ELEVENLABS'),
        layer.provider || 'ELEVENLABS',
      );
      const ttsProvider = resolveDockerTTSProvider(
        resolveTTSProviderForLanguage(
          normalizedLanguage,
          hasCustomOperation(custom_adapters, 'text_to_speech')
            ? CUSTOM_MODEL_KEYS.TEXT_TO_SPEECH
            : fallbackTtsProvider,
        ),
        fallbackTtsProvider,
      );

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
        languageCode: layer.languageCode || normalizedLanguage,
        languageCodes: layer.languageCodes,
        speakerVoiceId: layer.speakerVoiceId,
        speakerLabel: layer.speakerLabel,
        speakerDetails: layer.speakerDetails,
        defaultSelected: true,
        volume: 100,
        ...buildGoogleTTSInputVolumePayload(ttsProvider),
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
      routeType: stepVideoRoute || 'text_to_video',
    });
  }

  return sessionId;

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
      volume: 100,
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
