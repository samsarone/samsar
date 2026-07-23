import AudioGeneration from "../../schema/AudioGeneration.js";



import VideoSession from "../../schema/VideoSession.js";

import { getDBConnectionString } from '../DBString.js';
import { createNewAudioLayer, getVideoSessionById, createCompletedAudioLayer } from '../VideoSession.js';

import GeneratedMusic from "../../schema/generations/GeneratedMusic.js";
import User from '../../schema/User.js';

import path from 'path';
import Fuse from 'fuse.js';
import {
  getAudioDurationSecondsForLink,
  getBeatsFromMusic,
  getAudioVisualizerSpectralFrequency,
} from './AudioUtils.js';
import { getLayerAudioBeatAnimations } from './AudioAnimationUtils.js';
import {
  applyConnectedAudioWindowToLayer,
  getConnectedAudioRelativeWindow,
} from '../video/ConnectedAudioTimeline.js';
import {
  buildBackingTrackGenerationMeta,
  resolveBackingTrackTargetDurationSeconds,
} from './BackingTrackDuration.js';
import {
  ELEVENLABS_MUSIC_MODEL,
  normalizeElevenLabsMusicPayload,
  syncElevenLabsBackingTrackMusicLengthMeta,
} from './ElevenLabsMusicPayload.js';

import {
  isContainerRuntime,
  shouldBypassGenerationCredits,
} from '../../utils/EnvironmentUtils.js';

import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { getSessionFramesPerSecond } from '../../utils/FpsUtils.js';

import fs from 'fs';

import { downloadRemoteLinks } from "./AudioUtils.js";
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { maybeTriggerAutoRecharge } from '../AutoRecharge.js';
import { withProcessorFfmpegResources } from '../../utils/FfmpegResources.js';
import {
  findTTSSpeaker,
  TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH,
  TTS_PROVIDER_ELEVENLABS,
  TTS_PROVIDER_GOOGLE,
  TTS_PROVIDER_OPENAI,
} from '../../consts/TTSSpeakers.js';




const AUDIO_LIBRARY_TYPE_MUSIC = 'music';
const AUDIO_LIBRARY_TYPE_SPEECH = 'speech';
const AUDIO_LIBRARY_TYPE_SOUND_EFFECT = 'sound_effect';

export {
  buildBackingTrackGenerationMeta,
  resolveBackingTrackTargetDurationSeconds,
} from './BackingTrackDuration.js';

function normalizeTTSProvider(provider, speakerValue = '') {
  const rawProvider =
    typeof provider === 'string'
      ? provider
      : typeof provider?.value === 'string'
        ? provider.value
        : '';
  const normalizedProvider = rawProvider.trim().toUpperCase();

  if (normalizedProvider === TTS_PROVIDER_OPENAI) {
    return TTS_PROVIDER_OPENAI;
  }

  if (normalizedProvider === TTS_PROVIDER_GOOGLE || normalizedProvider === 'GOOGLE_TTS') {
    return TTS_PROVIDER_GOOGLE;
  }

  if (normalizedProvider === 'PLAYAI' || normalizedProvider === 'PLAYHT') {
    return 'PLAYAI';
  }

  if (
    normalizedProvider === TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH ||
    normalizedProvider === 'CUSTOMTTS'
  ) {
    return TTS_PROVIDER_CUSTOM_TEXT_TO_SPEECH;
  }

  if (
    normalizedProvider === TTS_PROVIDER_ELEVENLABS ||
    normalizedProvider === 'ELEVENLABS_FAL' ||
    normalizedProvider === 'ELEVENLABSFAL' ||
    normalizedProvider === 'ELEVEN'
  ) {
    return TTS_PROVIDER_ELEVENLABS;
  }

  if (findTTSSpeaker(TTS_PROVIDER_ELEVENLABS, speakerValue)) {
    return TTS_PROVIDER_ELEVENLABS;
  }

  if (findTTSSpeaker(TTS_PROVIDER_OPENAI, speakerValue)) {
    return TTS_PROVIDER_OPENAI;
  }

  return TTS_PROVIDER_OPENAI;
}

function normalizeAudioLibraryType(generationType) {
  const normalizedGenerationType = typeof generationType === 'string'
    ? generationType.trim().toLowerCase()
    : '';

  if (normalizedGenerationType === 'music' || normalizedGenerationType === 'background_music') {
    return AUDIO_LIBRARY_TYPE_MUSIC;
  }

  if (
    normalizedGenerationType === 'speech' ||
    normalizedGenerationType === 'lip_sync' ||
    normalizedGenerationType === 'custom_speech' ||
    normalizedGenerationType === 'recorded_speech'
  ) {
    return AUDIO_LIBRARY_TYPE_SPEECH;
  }

  return AUDIO_LIBRARY_TYPE_SOUND_EFFECT;
}

function resolveLibraryAudioPath(item = {}) {
  if (typeof item.selectedLocalAudioLink === 'string' && item.selectedLocalAudioLink.trim()) {
    return item.selectedLocalAudioLink.trim();
  }

  if (Array.isArray(item.localAudioLinks) && item.localAudioLinks.length > 0) {
    const firstLocalAudioLink = item.localAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (firstLocalAudioLink) {
      return firstLocalAudioLink.trim();
    }
  }

  if (typeof item.url === 'string' && item.url.trim()) {
    return item.url.trim();
  }

  if (typeof item.selectedRemoteAudioLink === 'string' && item.selectedRemoteAudioLink.trim()) {
    return item.selectedRemoteAudioLink.trim();
  }

  if (Array.isArray(item.remoteAudioLinks) && item.remoteAudioLinks.length > 0) {
    const firstRemoteAudioLink = item.remoteAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (firstRemoteAudioLink) {
      return firstRemoteAudioLink.trim();
    }
  }

  if (Array.isArray(item.remoteAudioData) && item.remoteAudioData.length > 0) {
    const firstRemoteAudioData = item.remoteAudioData.find((audioData) => (
      typeof audioData?.audio_url === 'string' && audioData.audio_url.trim()
    ));

    if (firstRemoteAudioData?.audio_url) {
      return firstRemoteAudioData.audio_url.trim();
    }
  }

  return null;
}

function getFallbackProjectName(sessionId, sessionName) {
  if (typeof sessionName === 'string' && sessionName.trim()) {
    return sessionName.trim();
  }

  if (typeof sessionId === 'string' && sessionId.trim()) {
    return `Project ${sessionId.trim().slice(-6)}`;
  }

  return 'Untitled Project';
}

function buildLibraryAudioTitle(item = {}, libraryType) {
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  const speakerCharacterName = typeof item.speakerCharacterName === 'string'
    ? item.speakerCharacterName.trim()
    : '';

  if (libraryType === AUDIO_LIBRARY_TYPE_SPEECH) {
    return title || speakerCharacterName || prompt || 'Speech';
  }

  if (libraryType === AUDIO_LIBRARY_TYPE_MUSIC) {
    return title || prompt || description || 'Music';
  }

  return title || prompt || description || 'Sound Effect';
}

function buildLibraryAudioTags(item = {}, libraryType) {
  const tagSet = new Set();

  if (Array.isArray(item.tags)) {
    item.tags.forEach((tag) => {
      if (typeof tag === 'string' && tag.trim()) {
        tagSet.add(tag.trim());
      }
    });
  }

  if (libraryType === AUDIO_LIBRARY_TYPE_SPEECH && typeof item.speakerCharacterName === 'string' && item.speakerCharacterName.trim()) {
    tagSet.add(item.speakerCharacterName.trim());
  }

  if (typeof item.generationType === 'string' && item.generationType.trim()) {
    tagSet.add(item.generationType.trim());
  }

  return Array.from(tagSet);
}

function buildSessionAudioLibraryItem(audioLayer, sessionData) {
  const url = resolveLibraryAudioPath(audioLayer);
  if (!url) {
    return null;
  }

  const sessionId = sessionData?._id?.toString?.() || sessionData?._id?.toString() || '';
  const libraryType = normalizeAudioLibraryType(audioLayer?.generationType);
  const localAudioLinks = Array.isArray(audioLayer?.localAudioLinks)
    ? audioLayer.localAudioLinks.filter((link) => typeof link === 'string' && link.trim())
    : [];
  const remoteAudioLinks = Array.isArray(audioLayer?.remoteAudioLinks)
    ? audioLayer.remoteAudioLinks.filter((link) => typeof link === 'string' && link.trim())
    : [];
  const remoteAudioData = Array.isArray(audioLayer?.remoteAudioData)
    ? audioLayer.remoteAudioData
    : [];

  return {
    _id: `${sessionId}:${audioLayer?._id?.toString?.() || audioLayer?._id || url}`,
    audioLayerId: audioLayer?._id?.toString?.() || audioLayer?._id || null,
    sessionId,
    projectId: sessionId,
    projectName: getFallbackProjectName(sessionId, sessionData?.sessionName),
    source: 'session_audio_layer',
    title: buildLibraryAudioTitle(audioLayer, libraryType),
    description: typeof audioLayer?.prompt === 'string' ? audioLayer.prompt : '',
    prompt: typeof audioLayer?.prompt === 'string' ? audioLayer.prompt : '',
    url,
    localAudioLinks,
    selectedLocalAudioLink: audioLayer?.selectedLocalAudioLink || localAudioLinks[0] || null,
    remoteAudioLinks,
    selectedRemoteAudioLink: audioLayer?.selectedRemoteAudioLink || remoteAudioLinks[0] || null,
    remoteAudioData,
    duration: Number(audioLayer?.duration) || 0,
    startTime: Number(audioLayer?.startTime) || 0,
    endTime: Number(audioLayer?.endTime) || ((Number(audioLayer?.startTime) || 0) + (Number(audioLayer?.duration) || 0)),
    volume: Number(audioLayer?.volume) || 100,
    generationType: audioLayer?.generationType || libraryType,
    libraryType,
    speakerCharacterName: typeof audioLayer?.speakerCharacterName === 'string'
      ? audioLayer.speakerCharacterName
      : '',
    tags: buildLibraryAudioTags(audioLayer, libraryType),
    createdAt: audioLayer?.updatedAt || audioLayer?.createdAt || sessionData?.updatedAt || sessionData?.createdAt || null,
    fadeOnEdges: Boolean(audioLayer?.fadeOnEdges),
    generationMeta: audioLayer?.generationMeta || {},
  };
}

function buildGeneratedMusicLibraryItem(generatedMusic, projectNameBySessionId = new Map()) {
  const url = resolveLibraryAudioPath(generatedMusic);
  if (!url) {
    return null;
  }

  const duration = Number(generatedMusic?.duration) || 0;
  const rawGenerationType = typeof generatedMusic?.generationType === 'string' && generatedMusic.generationType.trim()
    ? generatedMusic.generationType.trim()
    : AUDIO_LIBRARY_TYPE_MUSIC;
  const libraryType = normalizeAudioLibraryType(generatedMusic?.libraryType || rawGenerationType);

  const sessionId = typeof generatedMusic?.sessionId === 'string' && generatedMusic.sessionId.trim()
    ? generatedMusic.sessionId.trim()
    : null;
  const projectName = projectNameBySessionId.get(sessionId)
    || (sessionId ? getFallbackProjectName(sessionId, null) : 'Legacy Library');

  return {
    _id: `generated_music:${generatedMusic?._id?.toString?.() || generatedMusic?._id || url}`,
    audioLayerId: null,
    sessionId,
    projectId: sessionId,
    projectName,
    source: 'generated_music',
    title: buildLibraryAudioTitle(generatedMusic, libraryType),
    description: typeof generatedMusic?.description === 'string' ? generatedMusic.description : '',
    prompt: typeof generatedMusic?.prompt === 'string' ? generatedMusic.prompt : '',
    url,
    localAudioLinks: [url],
    selectedLocalAudioLink: url,
    remoteAudioLinks: [],
    selectedRemoteAudioLink: null,
    remoteAudioData: [],
    duration,
    startTime: 0,
    endTime: duration,
    volume: Number(generatedMusic?.volume) || 100,
    generationType: rawGenerationType,
    libraryType,
    speakerCharacterName: typeof generatedMusic?.speakerCharacterName === 'string'
      ? generatedMusic.speakerCharacterName
      : '',
    tags: buildLibraryAudioTags({ ...generatedMusic, generationType: rawGenerationType }, libraryType),
    createdAt: generatedMusic?.updatedAt || generatedMusic?.createdAt || null,
    fadeOnEdges: libraryType !== AUDIO_LIBRARY_TYPE_SPEECH,
    generationMeta: generatedMusic?.generationMeta || {},
  };
}

async function ensureGeneratedMusicDuration(generatedMusic) {
  const existingDuration = Number(generatedMusic?.duration);
  if (Number.isFinite(existingDuration) && existingDuration > 0) {
    return generatedMusic;
  }

  const audioPath = resolveLibraryAudioPath(generatedMusic);
  if (!audioPath) {
    return generatedMusic;
  }

  const resolvedDuration = await getAudioDurationSecondsForLink(audioPath).catch(() => null);
  if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
    return generatedMusic;
  }

  generatedMusic.duration = resolvedDuration;

  if (generatedMusic?._id) {
    await GeneratedMusic.updateOne(
      { _id: generatedMusic._id },
      { $set: { duration: resolvedDuration } }
    ).catch(() => {});
  }

  return generatedMusic;
}

async function hydrateGeneratedMusicDurations(generatedMusics = []) {
  if (!Array.isArray(generatedMusics) || generatedMusics.length === 0) {
    return generatedMusics;
  }

  await Promise.all(generatedMusics.map((generatedMusic) => ensureGeneratedMusicDuration(generatedMusic)));
  return generatedMusics;
}

function matchesAudioLibrarySearch(item, search) {
  if (!search) {
    return true;
  }

  const searchValue = search.trim().toLowerCase();
  if (!searchValue) {
    return true;
  }

  const searchableText = [
    item?.title,
    item?.description,
    item?.prompt,
    item?.projectName,
    item?.speakerCharacterName,
    item?.generationType,
    ...(Array.isArray(item?.tags) ? item.tags : []),
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();

  return searchableText.includes(searchValue);
}

function dedupeAudioLibraryItems(items = []) {
  const seen = new Set();
  const dedupedItems = [];

  items.forEach((item) => {
    const dedupeKey = [
      item?.projectId || '',
      item?.libraryType || '',
      item?.url || '',
      item?.title || '',
      item?.source || '',
    ].join('|');

    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    dedupedItems.push(item);
  });

  return dedupedItems;
}

function sortAudioLibraryItemsByRecency(items = []) {
  return [...items].sort((leftItem, rightItem) => {
    const leftTimestamp = leftItem?.createdAt ? new Date(leftItem.createdAt).getTime() : 0;
    const rightTimestamp = rightItem?.createdAt ? new Date(rightItem.createdAt).getTime() : 0;
    return rightTimestamp - leftTimestamp;
  });
}

function groupAudioLibraryItemsByProject(items = []) {
  const projectGroups = new Map();

  sortAudioLibraryItemsByRecency(items).forEach((item) => {
    const projectId = item?.projectId || item?.sessionId || 'unknown_project';
    const projectName = getFallbackProjectName(projectId, item?.projectName);
    const existingGroup = projectGroups.get(projectId) || {
      projectId,
      projectName,
      items: [],
      latestCreatedAt: 0,
    };

    existingGroup.items.push(item);

    const itemTimestamp = item?.createdAt ? new Date(item.createdAt).getTime() : 0;
    existingGroup.latestCreatedAt = Math.max(existingGroup.latestCreatedAt, itemTimestamp);

    projectGroups.set(projectId, existingGroup);
  });

  return Array.from(projectGroups.values())
    .sort((leftGroup, rightGroup) => rightGroup.latestCreatedAt - leftGroup.latestCreatedAt)
    .map(({ latestCreatedAt, ...group }) => group);
}

export async function createGenerateAudioRequest(userId, payload, updateCredits = true) {

  await getDBConnectionString();
  let normalizedPayload = payload;
  if (payload?.generationType === 'music') {
    normalizedPayload = normalizeElevenLabsMusicPayload(payload);
  }
  normalizedPayload.userId = userId;

  const {
    generationType,
    sessionId,
    prompt,
    model,
    duration,
    speaker,
    ttsProvider,
    provider,
    speakerCharacterName,
    instructions,
    generationMeta,
    startTime,
    audioBindingMode,
    bindToLayer,
    studioSpeechGeneration,
  } = normalizedPayload;


  if (updateCredits && !shouldBypassGenerationCredits()) {

    let creditsIncrement = -1;

    if (generationType === 'music') {
      creditsIncrement = -2;
    }
    const updateResult = await User.updateOne(
      { _id: userId, generationCredits: { $gt: 0 } },
      { $inc: { generationCredits: creditsIncrement } }
    );

    // If no documents were updated, it means the user either doesn't exist or doesn't have enough credits
    if (updateResult.modifiedCount === 0) {
      throw new Error('Insufficient credits');
    }

    await maybeTriggerAutoRecharge(userId);

  }

  const audioLayerCreatePayload = {
    prompt,
    sessionId,
    generationType,
    model,
    duration,
  }

  if (generationType === 'speech') {
    audioLayerCreatePayload.speaker = speaker;
    audioLayerCreatePayload.provider = normalizeTTSProvider(ttsProvider || provider, speaker);
    audioLayerCreatePayload.speakerCharacterName = speakerCharacterName;
    audioLayerCreatePayload.instructions = instructions;
    audioLayerCreatePayload.generationMeta = generationMeta;
    audioLayerCreatePayload.startTime = startTime;
    audioLayerCreatePayload.audioBindingMode = audioBindingMode;
    audioLayerCreatePayload.bindToLayer = bindToLayer;
    audioLayerCreatePayload.studioSpeechGeneration = Boolean(studioSpeechGeneration);
  }

  const audioLayerId = await createNewAudioLayer(audioLayerCreatePayload);

  normalizedPayload.audioLayerId = audioLayerId;

  let generationResponse;
  try {
    if (generationType === 'music') {
      generationResponse = await createGenerateMusicRequest(normalizedPayload);
    } else if (generationType === 'speech') {
      generationResponse = await createGenerateSpeechRequest(normalizedPayload);
    } else if (generationType === 'sound') {
      generationResponse = await createGenerateSoundRequest(normalizedPayload);
    }
  } catch (error) {
    console.error('Error generating audio:', error);
    generationResponse = { error: 'Error generating audio' };
  }

  return generationResponse;
}


export async function createQuickGenerationBackgroundMusicRequest(userId, payload) {


}

export async function createBackgroundDefaultSelectedMusicRequest(userId, payload) {
  await getDBConnectionString();

  const { sessionId, prompt, model, duration } = payload;

  const generationType = "music";

  const audioLayerCreatePayload = {
    prompt,
    sessionId,
    generationType,
    defaultSelected: true,
    volume: 45,
    isEnabled: true,
    model: model,
    duration: duration,
  }



  const audioLayerId = await createNewAudioLayer(audioLayerCreatePayload);



  payload.userId = userId;
  payload.audioLayerId = audioLayerId;

  const generationResponse = await createGenerateMusicRequest(payload);


  return generationResponse;

}

export async function createBackgroundMusicFromUserSelection(userId, payload) {
  await getDBConnectionString();

  let { sessionId, prompt, musicId, userSelectedMusic, model } = payload;

  const generationType = "music";

  if (!model) {
    model = 'AUDIOCRAFT';
  }
  const audioLayerCreatePayload = {
    prompt,
    sessionId,
    generationType,
    musicId,
    volume: 45,
    isEnabled: true,
    selectedLocalAudioLink: userSelectedMusic,
    localAudioLinks: [userSelectedMusic],
    generationStatus: 'COMPLETED',
    model: model,
  }

  const audioLayerId = await createCompletedAudioLayer(audioLayerCreatePayload);
  return audioLayerId;
}



export async function createBackgroundMusicFromLibrary(userId, payload) {
  await getDBConnectionString();

  const { sessionId, prompt, musicId, userSelectedMusic } = payload;

  // Fetch all music entries for the user
  const userGeneratedMusics = await GeneratedMusic.find({ userId: userId });

  // Set up Fuse.js options
  const options = {
    includeScore: true,
    keys: ['title', 'description', 'prompt', 'tags'],
  };

  // Initialize Fuse.js with the user's music entries
  const fuse = new Fuse(userGeneratedMusics, options);

  // Search for the best match
  const result = fuse.search(prompt);

  let resultUrl;
  if (result.length > 0) {
    const bestMatch = result[0].item;
    // Return the URL of the best matching music
    resultUrl = bestMatch.url;
  } else {
    // Handle the case where no match is found
    resultUrl = null;
  }

  const generationType = "music";

  const audioLayerCreatePayload = {
    prompt,
    sessionId,
    generationType,
    musicId,
    volume: 45,
    isEnabled: true,
    selectedLocalAudioLink: resultUrl,
    localAudioLinks: [resultUrl],
    generationStatus: 'COMPLETED',
  }

  const audioLayerId = await createCompletedAudioLayer(audioLayerCreatePayload);

  return audioLayerId;


}



export async function createGenerateMusicRequest(payload) {
  const normalizedPayload = normalizeElevenLabsMusicPayload(payload);
  let {
    userId,
    sessionId,
    isInstrumental,
    prompt,
    audioLayerId,
    model,
    duration,
    defaultSelected,
    isBackingTrack,
    generationMeta,
    volume,
  } = normalizedPayload;

  if (!model) {
    model = 'AUDIOCRAFT';
  }

  const sessionData = sessionId
    ? await VideoSession.findById(sessionId)
      .select('layers audioLayers totalDuration expressGenerationBillingDurationSeconds samsarExternalProviderStages')
      .lean()
    : null;
  const externalMusicStage = sessionData?.samsarExternalProviderStages?.music_generation || null;
  const currentAudioLayer = Array.isArray(sessionData?.audioLayers)
    ? sessionData.audioLayers.find((audioLayer) => (
        audioLayer?._id?.toString?.() === audioLayerId?.toString?.()
      ))
    : null;
  const resolvedVolume = Number.isFinite(Number(volume))
    ? Number(volume)
    : Number.isFinite(Number(currentAudioLayer?.volume))
      ? Number(currentAudioLayer.volume)
      : undefined;
  const useSamsarExternalMusic =
    externalMusicStage?.provider === 'samsar' ||
    externalMusicStage?.authorization === 'deployed' ||
    normalizedPayload.externalProvider === 'samsar' ||
    normalizedPayload.samsarExternal === true;

  if (Boolean(isBackingTrack)) {
    const targetDurationSeconds = resolveBackingTrackTargetDurationSeconds({
      sessionData,
      audioLayerId,
      requestedDuration: duration,
    });

    if (targetDurationSeconds !== null) {
      duration = targetDurationSeconds;
    }
    generationMeta = buildBackingTrackGenerationMeta(generationMeta, duration);
    if (model === ELEVENLABS_MUSIC_MODEL) {
      generationMeta = syncElevenLabsBackingTrackMusicLengthMeta(generationMeta, duration);
    }
  }

  if (useSamsarExternalMusic) {
    generationMeta = {
      ...(generationMeta && typeof generationMeta === 'object' ? generationMeta : {}),
      samsarExternalAudio: true,
      externalAudioRoute: externalMusicStage?.audioRoute || normalizedPayload.externalAudioRoute || 'text_to_music',
      externalAudioStage: 'music_generation',
      externalProvider: 'samsar',
      externalAuthorization: 'deployed',
    };
  }

  const audioGeneration = new AudioGeneration({
    userId,
    sessionId,
    generationType: 'music',
    isInstrumental,
    prompt,
    musicGenerationStatus: 'INIT',
    audioLayerId: audioLayerId,
    model: model,
    duration: duration,
    defaultSelected: defaultSelected,
    isBackingTrack: Boolean(isBackingTrack),
    ...(resolvedVolume !== undefined ? { volume: resolvedVolume } : {}),
    generationMeta,
    ...(useSamsarExternalMusic
      ? {
          externalProvider: 'samsar',
          externalAudioRoute: externalMusicStage?.audioRoute || normalizedPayload.externalAudioRoute || 'text_to_music',
          samsarExternalProviderStage: externalMusicStage,
        }
      : {}),

  });
  await audioGeneration.save();
  return audioGeneration;

}

export async function getAudioGenerationStatus(sessionId) {
  await getDBConnectionString();
  const videoSessionData = await getVideoSessionById(sessionId);

  const latestLayer = videoSessionData.audioLayers[videoSessionData.audioLayers.length - 1];

  if (latestLayer.generationStatus === 'PENDING') {
    return {
      generationStatus: 'PENDING',
    }
  } else if (latestLayer.generationStatus === 'COMPLETED') {
    return {
      generationStatus: 'COMPLETED',
      videoSession: videoSessionData,
      generationType: latestLayer.generationType,
    };
  } else {
    return {
      generationStatus: latestLayer.generationStatus
    }
  }

}




export async function updateCreditsAndCreateGenerateSpeechRequest(userId, payload, updateCredits = true) {

  if (updateCredits) {

    await getDBConnectionString();
    const updateResult = await User.updateOne(
      { _id: userId, generationCredits: { $gt: 0 } },
      { $inc: { generationCredits: -1 } }
    );

    // If no documents were updated, it means the user either doesn't exist or doesn't have enough credits
    if (updateResult.modifiedCount === 0) {
      return;
    }

    await maybeTriggerAutoRecharge(userId);
  }


  payload.userId = userId;
  const audioGeneration = await createGenerateSpeechRequest(payload);
  return audioGeneration;

}


export async function createGenerateSpeechRequest(payload) {
  const { userId, sessionId, prompt, audioLayerId, speaker, ttsProvider, provider, startTime, defaultSelected,
    volume, speakerCharacterName,
    speakerVoiceId,
    speakerLabel,
    speakerDetails,
    instructions,
    generationMeta,
    languageCode,
    languageCodes,
    language,
    audioBindingMode,
    bindToLayer,
    studioSpeechGeneration,
    googleTTSInputVolume,
    ttsInputVolume,
    volumeGainDb,
    googleTTSVolumeGainDb,
  } = payload;
  const normalizedTtsProvider = normalizeTTSProvider(ttsProvider || provider, speaker);
  const sessionData = sessionId
    ? await VideoSession.findById(sessionId)
      .select('samsarExternalProviderStages')
      .lean()
    : null;
  const externalSpeechStage = sessionData?.samsarExternalProviderStages?.speech_generation || null;
  const useSamsarExternalSpeech =
    externalSpeechStage?.provider === 'samsar' ||
    externalSpeechStage?.authorization === 'deployed' ||
    payload.externalProvider === 'samsar' ||
    payload.samsarExternal === true;



	  let audioGenerationPayload = {
    userId,
    sessionId,
    generationType: 'speech',
    prompt,
    speaker,
    speakerVoiceId,
    speakerLabel,
    speakerDetails,
    audioLayerId,
    ttsProvider: normalizedTtsProvider,
    languageCode: languageCode || language,
    languageCodes,
    defaultSelected,
    audioBindingMode,
    bindToLayer,
	    studioSpeechGeneration: Boolean(studioSpeechGeneration),
	    ...(useSamsarExternalSpeech
	      ? {
	          externalProvider: 'samsar',
	          externalAudioRoute: externalSpeechStage?.audioRoute || payload.externalAudioRoute || 'text_to_speech',
	          samsarExternalProviderStage: externalSpeechStage,
	          generationMeta: {
	            ...(generationMeta && typeof generationMeta === 'object' ? generationMeta : {}),
	            samsarExternalAudio: true,
	            externalAudioRoute: externalSpeechStage?.audioRoute || payload.externalAudioRoute || 'text_to_speech',
	            externalAudioStage: 'speech_generation',
	            externalProvider: 'samsar',
	            externalAuthorization: 'deployed',
	          },
	        }
	      : {}),
	  }

  if (googleTTSInputVolume !== undefined) {
    audioGenerationPayload.googleTTSInputVolume = googleTTSInputVolume;
  }

  if (ttsInputVolume !== undefined) {
    audioGenerationPayload.ttsInputVolume = ttsInputVolume;
  }

  if (volumeGainDb !== undefined) {
    audioGenerationPayload.volumeGainDb = volumeGainDb;
  }

  if (googleTTSVolumeGainDb !== undefined) {
    audioGenerationPayload.googleTTSVolumeGainDb = googleTTSVolumeGainDb;
  }

  const parsedStartTime = Number(startTime);
  if (Number.isFinite(parsedStartTime) && parsedStartTime >= 0) {
    audioGenerationPayload.startTime = parsedStartTime;
  }

  if (volume) {
    audioGenerationPayload.volume = volume;
  }

  if (speakerCharacterName) {
    audioGenerationPayload.speakerCharacterName = speakerCharacterName;
  }

  if (instructions) {
    audioGenerationPayload.instructions = instructions;
  }

	  if (generationMeta && !useSamsarExternalSpeech) {
	    audioGenerationPayload.generationMeta = generationMeta;
	  }


  const audioGeneration = new AudioGeneration(audioGenerationPayload);
  const saveRes = await audioGeneration.save();


  const currSession = await VideoSession.findOne({ _id: sessionId });

  if (currSession) {

    let currAudioLayers = currSession.audioLayers;

    let currAudioLayer = currAudioLayers.find((layer) => layer._id == audioLayerId);



    if (currAudioLayer) {

      currAudioLayer.speaker = speaker;
      currAudioLayer.provider = normalizedTtsProvider;
      if (speakerVoiceId !== undefined) {
        currAudioLayer.speakerVoiceId = speakerVoiceId;
      }
      if (speakerLabel !== undefined) {
        currAudioLayer.speakerLabel = speakerLabel;
      }
      if (speakerDetails !== undefined) {
        currAudioLayer.speakerDetails = speakerDetails;
      }
      if (speakerCharacterName !== undefined) {
        currAudioLayer.speakerCharacterName = speakerCharacterName;
      }
      if (instructions !== undefined) {
        currAudioLayer.instructions = instructions;
      }
      if (generationMeta) {
        currAudioLayer.generationMeta = generationMeta;
      }
      if (languageCode || language) {
        currAudioLayer.languageCode = languageCode || language;
      }
      if (languageCodes !== undefined) {
        currAudioLayer.languageCodes = Array.isArray(languageCodes) ? languageCodes : [];
      }
      if (audioBindingMode !== undefined) {
        currAudioLayer.audioBindingMode = audioBindingMode;
      }
      if (bindToLayer !== undefined) {
        currAudioLayer.bindToLayer = bindToLayer;
      }
      if (studioSpeechGeneration !== undefined) {
        currAudioLayer.studioSpeechGeneration = Boolean(studioSpeechGeneration);
      }

      await currSession.save();
    }
  }




  return saveRes;
}

export async function createGenerateSoundRequest(payload) {

  const { userId, sessionId, prompt, audioLayerId, model, secondsTotal, defaultSelected } = payload;



  const audioGeneration = new AudioGeneration({
    userId,
    sessionId, generationType: 'sound', prompt,
    audioLayerId, model, secondsTotal, defaultSelected
  });
  await audioGeneration.save();
  return audioGeneration;
}


export async function getPendingAudiocraftGenerations() {
  await getDBConnectionString();
  // sort by latest first
  const pendingGenerations = await AudioGeneration.find({ 'model': 'AUDIOCRAFT', 'musicGenerationStatus': 'INIT' }).sort({ createdAt: -1 });


  return pendingGenerations;

}


export async function updateAudiocraftGenerationStatus(payload) {
  await getDBConnectionString();

  const {
    requestId,
    status,
    s3Urls,
    error
  } = payload;

  const audioGeneration = await AudioGeneration.findById(requestId);

  if (audioGeneration) {
    audioGeneration.musicGenerationStatus = status;
    audioGeneration.status = status;
    audioGeneration.remoteAudioLinks = s3Urls;

    if (error) {
      audioGeneration.error = error;
    }

    await audioGeneration.save();

    // Replicate the completion logic when status is 'COMPLETED'
    if (status === 'COMPLETED') {
      const { sessionId, audioLayerId, _id } = audioGeneration;
      const remoteAudioLinks = s3Urls;

      // Fetch VideoSession
      let sessionData = await VideoSession.findOne({ _id: sessionId });

      if (sessionData) {
        const { audioLayers } = sessionData;

        // Find the current audio layer
        let currentAudioLayer = audioLayers.find((audioLayer) => audioLayer._id == audioLayerId);

        if (currentAudioLayer) {
          currentAudioLayer.generationStatus = 'COMPLETED';
          currentAudioLayer.remoteAudioLinks = remoteAudioLinks;

          currentAudioLayer.remoteAudioData = [
            {
              "audio_url": remoteAudioLinks[0],
              "lyric": "[Instrumental]",
              "_id": audioLayerId,
            }
          ];

          // Define paths for downloading and storing audio files
          const localDownloadBase = path.join('video', 'audio', sessionId.toString(), audioLayerId.toString());
          let localDownloadFolderPath = path.join(process.cwd(), '..', 'samsar_processor', 'assets', localDownloadBase);
          if (process.env.SAMSAR_ASSETS_ROOT || isContainerRuntime()) {
            localDownloadFolderPath = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', localDownloadBase); // Docker staging volume mount path
          }

          if (!fs.existsSync(localDownloadFolderPath)) {
            fs.mkdirSync(localDownloadFolderPath, { recursive: true });
          }

          // Download the remote audio files to local storage
          const localAudioFileNames = await downloadRemoteLinks(localDownloadFolderPath, remoteAudioLinks);

          // Update local audio paths
          const localAudioPaths = localAudioFileNames.map((fileName) => path.join(localDownloadBase, fileName));
          currentAudioLayer.localAudioLinks = localAudioPaths;

          if (sessionData.isExpressGeneration) {
            currentAudioLayer.selectedLocalAudioLink = localAudioPaths[0];
          }

          // Save the updated session data
          await sessionData.save();

          // Clean up the AudioGeneration document
          await AudioGeneration.findByIdAndDelete(_id);

        } else {
          console.error(`Audio layer with ID ${audioLayerId} not found in session ${sessionId}.`);
        }
      } else {
        console.error(`Video session with ID ${sessionId} not found.`);
      }
    }
  } else {
    console.error(`AudioGeneration document with ID ${requestId} not found.`);
  }
}



export async function getUserMusicLibrary(userId, query) {
  await getDBConnectionString();

  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 50;
  const search = query.search || '';
  const requestedSessionId = typeof query.sessionId === 'string' && query.sessionId.trim()
    ? query.sessionId.trim()
    : null;

  const skip = (page - 1) * limit;

  // Preserve the legacy flat music payload for existing callers.
  const filter = { userId: userId };
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } },
    ];
  }

  // Get total count for pagination
  const totalItems = await GeneratedMusic.countDocuments(filter);


  const totalPages = Math.ceil(totalItems / limit);

  const userGeneratedMusics = await GeneratedMusic.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  await hydrateGeneratedMusicDurations(userGeneratedMusics);

  let currentSession = null;
  if (requestedSessionId) {
    currentSession = await VideoSession.findOne({ _id: requestedSessionId, userId })
      .select('_id sessionName audioLayers createdAt updatedAt')
      .lean();
  }

  const sessionQuery = { userId };

  const userSessions = await VideoSession.find(sessionQuery)
    .select('_id sessionName audioLayers createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  const projectNameBySessionId = new Map();
  if (currentSession) {
    const currentSessionId = currentSession?._id?.toString?.() || '';
    if (currentSessionId) {
      projectNameBySessionId.set(
        currentSessionId,
        getFallbackProjectName(currentSessionId, currentSession?.sessionName)
      );
    }
  }
  userSessions.forEach((sessionData) => {
    const sessionId = sessionData?._id?.toString?.() || '';
    if (!sessionId) {
      return;
    }

    projectNameBySessionId.set(
      sessionId,
      getFallbackProjectName(sessionId, sessionData?.sessionName)
    );
  });

  const globalGeneratedMusicFilter = { userId };
  if (search) {
    globalGeneratedMusicFilter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { prompt: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } },
    ];
  }

  const globalGeneratedMusics = await GeneratedMusic.find(globalGeneratedMusicFilter)
    .sort({ createdAt: -1 })
    .lean();
  await hydrateGeneratedMusicDurations(globalGeneratedMusics);

  let currentSessionGeneratedMusics = [];
  if (requestedSessionId) {
    const currentSessionGeneratedMusicFilter = {
      userId,
      sessionId: requestedSessionId,
    };
    if (search) {
      currentSessionGeneratedMusicFilter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { prompt: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
      ];
    }

    currentSessionGeneratedMusics = await GeneratedMusic.find(currentSessionGeneratedMusicFilter)
      .sort({ createdAt: -1 })
      .lean();
    await hydrateGeneratedMusicDurations(currentSessionGeneratedMusics);
  }

  const globalSessionAudioItems = [];
  userSessions.forEach((sessionData) => {
    const audioLayers = Array.isArray(sessionData?.audioLayers) ? sessionData.audioLayers : [];

    audioLayers.forEach((audioLayer) => {
      if (audioLayer?.generationStatus && audioLayer.generationStatus !== 'COMPLETED') {
        return;
      }

      const libraryItem = buildSessionAudioLibraryItem(audioLayer, sessionData);
      if (!libraryItem || !matchesAudioLibrarySearch(libraryItem, search)) {
        return;
      }

      globalSessionAudioItems.push(libraryItem);
    });
  });

  const projectSessionAudioItems = [];
  if (currentSession) {
    const audioLayers = Array.isArray(currentSession?.audioLayers) ? currentSession.audioLayers : [];

    audioLayers.forEach((audioLayer) => {
      if (audioLayer?.generationStatus && audioLayer.generationStatus !== 'COMPLETED') {
        return;
      }

      const libraryItem = buildSessionAudioLibraryItem(audioLayer, currentSession);
      if (!libraryItem || !matchesAudioLibrarySearch(libraryItem, search)) {
        return;
      }

      projectSessionAudioItems.push(libraryItem);
    });
  }

  const globalGeneratedMusicItems = globalGeneratedMusics
    .map((generatedMusic) => buildGeneratedMusicLibraryItem(generatedMusic, projectNameBySessionId))
    .filter((libraryItem) => libraryItem && matchesAudioLibrarySearch(libraryItem, search));

  const projectGeneratedMusicItems = currentSessionGeneratedMusics
    .map((generatedMusic) => buildGeneratedMusicLibraryItem(generatedMusic, projectNameBySessionId))
    .filter((libraryItem) => libraryItem && matchesAudioLibrarySearch(libraryItem, search));

  const dedupedGlobalAudioItems = dedupeAudioLibraryItems([
    ...globalSessionAudioItems,
    ...globalGeneratedMusicItems,
  ]);
  const projectItems = sortAudioLibraryItemsByRecency(dedupeAudioLibraryItems([
    ...projectSessionAudioItems,
    ...projectGeneratedMusicItems,
  ]));

  const globalArtifacts = {
    music: groupAudioLibraryItemsByProject(
      dedupedGlobalAudioItems.filter((item) => item.libraryType === AUDIO_LIBRARY_TYPE_MUSIC)
    ),
    speech: groupAudioLibraryItemsByProject(
      dedupedGlobalAudioItems.filter((item) => item.libraryType === AUDIO_LIBRARY_TYPE_SPEECH)
    ),
    soundEffect: groupAudioLibraryItemsByProject(
      dedupedGlobalAudioItems.filter((item) => item.libraryType === AUDIO_LIBRARY_TYPE_SOUND_EFFECT)
    ),
  };

  return {
    items: userGeneratedMusics,
    totalPages: totalPages,
    currentPage: page,
    projectItems,
    globalArtifacts,
  };
}


export async function getLayeredAudioGenerationStatus(sessionId, numLayers) {
  await getDBConnectionString();
  const videoSessionData = await getVideoSessionById(sessionId);

  const audioLayers = videoSessionData.audioLayers || [];
  const totalAudioLayers = audioLayers.length;

  // If there are fewer audio layers than numLayers, consider generation as pending
  if (totalAudioLayers < numLayers) {
    return { generationStatus: 'PENDING' };
  }

  // Get the last numLayers audio layers
  const layersToCheck = audioLayers.slice(-numLayers);

  // Check the generationStatus of each layer
  let allCompleted = true;
  let anyFailed = false;
  let generationType = null;

  for (const layer of layersToCheck) {
    if (!generationType) generationType = layer.generationType;

    if (layer.generationStatus === 'FAILED') {
      anyFailed = true;
      break;
    } else if (layer.generationStatus !== 'COMPLETED') {
      allCompleted = false;
      // Continue checking to detect if there's any 'FAILED' status
    }
  }

  if (anyFailed) {
    return { generationStatus: 'FAILED' };
  } else if (allCompleted) {
    return {
      generationStatus: 'COMPLETED',
      videoSession: videoSessionData,
      generationType: generationType
    };
  } else {
    return { generationStatus: 'PENDING' };
  }
}

export async function requestApplyAutoSynchronizeBeats(sessionData) {
  const videoSession = await VideoSession.findById(sessionData._id);
  const framesPerSecond = getSessionFramesPerSecond(
    videoSession,
    'Audio.requestApplyAutoSynchronizeBeats'
  );

  const sessionId = videoSession._id;


  const sessionLayers = videoSession.layers;
  const audioLayers = videoSession.audioLayers;

  const musicLayer = audioLayers.find(layer => layer.generationType === 'music' && layer.generationStatus === 'COMPLETED');

  let musicLayerUrl = musicLayer.selectedLocalAudioLink;

  if (!musicLayerUrl) {
    musicLayerUrl = musicLayer.localAudioLinks[0];
  }



  // Get beats for the music
  const musicBeatsDistribution = await getBeatsFromMusic(
    musicLayerUrl,
    framesPerSecond
  );




  // Process each layer
  for (let i = 0; i < sessionLayers.length; i++) {
    const layer = sessionLayers[i];



    const layerStartFrame = layer.durationOffset * framesPerSecond;
    const layerEndFrame = layerStartFrame + (layer.duration * framesPerSecond);


    // Find the corresponding music beats that lie within this layer
    const layerBeats = musicBeatsDistribution.filter(
      beat => beat.startFrame >= layerStartFrame && beat.endFrame <= layerEndFrame
    );

    const aspectRatio = videoSession.aspectRatio;
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);




    // Apply animations based on the beats
    const canvasAnimations = await getLayerAudioBeatAnimations(
      layer,
      layerBeats,
      i,
      canvasDimensions,
      framesPerSecond
    );

    layer.imageSession.canvasAnimations = canvasAnimations;
  }

  // Save the updated video session back to the database
  const updatedSessionResponse = await videoSession.save();


  return updatedSessionResponse;

}




export async function requestApplyAutoSynchronizeLayerDurationsToBeats(sessionData) {
  const videoSession = await VideoSession.findById(sessionData._id); // Fetch the full document
  const framesPerSecond = getSessionFramesPerSecond(
    videoSession,
    'Audio.requestApplyAutoSynchronizeLayerDurationsToBeats'
  );
  const sessionLayers = videoSession.layers;
  const audioLayers = videoSession.audioLayers;


  const musicLayer = audioLayers.find(layer => layer.generationType === 'music' && layer.generationStatus === 'COMPLETED');

  let musicLayerUrl = musicLayer.selectedLocalAudioLink;

  if (!musicLayerUrl) {
    musicLayerUrl = musicLayer.localAudioLinks[0];
  }

  // Get beats for the music
  const musicBeatsDistribution = await getBeatsFromMusic(
    musicLayerUrl,
    framesPerSecond
  );



  const numLayers = sessionLayers.length;
  const numBeats = musicBeatsDistribution.length;



  if (numLayers === numBeats) {
    // **Case 1: Number of layers equals number of beats**
    // Assign each beat to a layer directly
    let cumulativeFrames = 0;
    for (let i = 0; i < numLayers; i++) {
      const beat = musicBeatsDistribution[i];
      const layer = sessionLayers[i];

      const layerOriginalDurationFrames = Math.round(layer.duration * framesPerSecond); // Convert to frames
      const beatDurationFrames = beat.endFrame - beat.startFrame;

      const newLayerDurationFrames = Math.min(beatDurationFrames, layerOriginalDurationFrames);

      if (newLayerDurationFrames <= 0) {
        console.error(`Layer ${i}: Calculated new duration frames is zero or negative.`);
        continue;
      }

      layer.duration = newLayerDurationFrames / framesPerSecond; // Convert back to seconds
      layer.durationOffset = cumulativeFrames / framesPerSecond; // Convert back to seconds
      cumulativeFrames += newLayerDurationFrames;
    }
  } else if (numLayers < numBeats) {
    // **Case 2: Number of layers fewer than beats**
    // Intelligently divide the beats into numLayer distributions
    const beatGroups = partitionArray(musicBeatsDistribution, numLayers);
    let cumulativeFrames = 0;
    for (let i = 0; i < numLayers; i++) {
      const beatGroup = beatGroups[i];
      const layer = sessionLayers[i];

      const layerOriginalDurationFrames = Math.round(layer.duration * framesPerSecond); // Convert to frames
      let cumulativeBeatDurationFrames = 0;

      for (let beat of beatGroup) {
        const beatDurationFrames = beat.endFrame - beat.startFrame;
        cumulativeBeatDurationFrames += beatDurationFrames;
      }

      const newLayerDurationFrames = Math.min(cumulativeBeatDurationFrames, layerOriginalDurationFrames);

      if (newLayerDurationFrames <= 0) {
        console.error(`Layer ${i}: Calculated new duration frames is zero or negative.`);
        continue;
      }

      layer.duration = newLayerDurationFrames / framesPerSecond; // Convert back to seconds
      layer.durationOffset = cumulativeFrames / framesPerSecond; // Convert back to seconds
      cumulativeFrames += newLayerDurationFrames;
    }
  } else {
    // **Case 3: Number of layers more than beats**
    // Intelligently put multiple layers in the largest beat intervals
    // Sort beats by duration in descending order
    const beatsWithDuration = musicBeatsDistribution.map(beat => {
      const beatDurationFrames = beat.endFrame - beat.startFrame;
      return { ...beat, beatDurationFrames };
    });

    const sortedBeats = beatsWithDuration.sort((a, b) => b.beatDurationFrames - a.beatDurationFrames);

    const layersPerBeat = Math.floor(numLayers / numBeats);
    const remainder = numLayers % numBeats;

    let layerIndex = 0;
    let cumulativeFrames = 0;
    for (let i = 0; i < numBeats; i++) {
      const beat = sortedBeats[i];
      const numLayersInBeat = layersPerBeat + (i < remainder ? 1 : 0);
      const beatDurationFrames = beat.beatDurationFrames;

      for (let j = 0; j < numLayersInBeat; j++) {
        if (layerIndex < numLayers) {
          const layer = sessionLayers[layerIndex];

          const layerOriginalDurationFrames = Math.round(layer.duration * framesPerSecond); // Convert to frames
          const layerDurationFrames = Math.min(beatDurationFrames / numLayersInBeat, layerOriginalDurationFrames);

          if (layerDurationFrames <= 0) {
            console.error(`Layer ${layerIndex}: Calculated new duration frames is zero or negative.`);
            layerIndex++;
            continue;
          }

          layer.duration = layerDurationFrames / framesPerSecond; // Convert back to seconds
          layer.durationOffset = cumulativeFrames / framesPerSecond; // Convert back to seconds
          cumulativeFrames += layerDurationFrames;
          layerIndex++;
        } else {
          break;
        }
      }
    }
  }

  // Save the updated layers back to the database
  await VideoSession.updateOne({ _id: sessionData._id }, { layers: sessionLayers });
}



export async function requestApplyMusicVisualizer(sessionDataValue) {


  const sessionAudioTracks = sessionDataValue.audioLayers;
  const sessionMusicTrack = sessionAudioTracks.find(track => track.generationType === 'music');



  if (sessionMusicTrack) {


    sessionDataValue.applyAudioVisualizer = true;

    const updatedSession = await sessionDataValue.save();

    const sessionMusicUrl = sessionMusicTrack.selectedLocalAudioLink;

    const spectralFrequencyData = await getAudioVisualizerSpectralFrequency(sessionMusicUrl);

    // write this to file
    const pwd = process.cwd();

    const newFilePath = path.join(pwd, 'assets', 'video', 'audio_visualizers', `${sessionDataValue._id}.json`);

    // write json file

    const spectralFrequency = spectralFrequencyData.visualizer_data;


    // write json file
    fs.writeFileSync(newFilePath, JSON.stringify(spectralFrequency, null, 2), 'utf-8');

  }

}


function partitionArray(array, numGroups) {
  const len = array.length;
  const groupSize = Math.floor(len / numGroups);
  const remainder = len % numGroups;
  let groups = [];
  let startIdx = 0;

  for (let i = 0; i < numGroups; i++) {
    const extra = i < remainder ? 1 : 0;
    const endIdx = startIdx + groupSize + extra;
    groups.push(array.slice(startIdx, endIdx));
    startIdx = endIdx;
  }
  return groups;
}




/**
 * Pad silence at the beginning and end of an audio file so that its total
 * duration matches `layerDuration`.
 * 
 * @param {string} inputAudioPath – local path to the existing audio file
 * @param {number} layerDuration – desired total duration in seconds
 * @param {string} outputAudioPath – where the new padded file should be written
 * @param {number} [startOffset=0] – how many seconds of silence to add at the beginning
 * @returns {Promise<string>} – returns `outputAudioPath` once complete
 */
export async function padBlankAudioAtBeginningAndEnd(
  inputAudioPath,
  layerDuration,
  outputAudioPath,
  startOffset = 0
) {
  const targetDuration = Number(layerDuration);
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
    throw new Error('Invalid target duration for padded audio');
  }
  const safeStartOffset = Math.min(
    Math.max(0, Number(startOffset) || 0),
    targetDuration
  );

  // 1) Get original audio duration using ffprobe
  const ffprobePromise = promisify(ffmpeg.ffprobe);
  const audioMetadata = await ffprobePromise(inputAudioPath);
  const audioStreams = audioMetadata.streams.find(s => s.codec_type === 'audio');
  if (!audioStreams) {
    throw new Error('No audio stream found in the file');
  }
  const inputAudioDuration = Math.max(0, Number(audioStreams.duration) || 0);

  // 2) Calculate end-padding (in seconds). If negative, no end pad is applied.
  const endOffset = targetDuration - safeStartOffset - inputAudioDuration;
  const endPad = endOffset > 0 ? endOffset : 0;

  // 3) Build up ffmpeg filters
  //    - adelay adds silence at the beginning (in milliseconds).
  //    - apad pads silence at the end (in seconds).
  //    - atrim caps overlong audio to the exact layer duration.
  const delayMs = Math.round(safeStartOffset * 1000);
  const adelayFilter = `adelay=${delayMs}|${delayMs}`;
  const apadFilter = `apad=pad_dur=${endPad}`;
  const trimFilter = `atrim=duration=${targetDuration}`;

  try {
    // 4) Run ffmpeg to generate a new file with padded audio
    const retVal = withProcessorFfmpegResources((threadOptions) => (
      new Promise((resolve, reject) => {
        ffmpeg()
          .input(inputAudioPath)
          .inputOptions(threadOptions.inputOptions)
          .audioFilters([adelayFilter, apadFilter, trimFilter, 'asetpts=PTS-STARTPTS'])
          .duration(targetDuration)
          .outputOptions(threadOptions.outputOptions)
          .on('error', (err) => {
            console.error('Error while padding audio:', err);
            reject(err);
          })
          .on('end', () => {
            resolve(outputAudioPath);
          })
          .save(outputAudioPath);
      })
    ));
    return retVal;

  } catch (err) {
    return inputAudioPath;
  }


}



export async function requestRealignConnectedAudioLayersToLayers(sessionId) {


  await getDBConnectionString();

  const videoSession = await VideoSession.findById(sessionId);
  let audioLayers = videoSession.audioLayers;

  const sessionLayers = videoSession.layers;
  const finalLayer = sessionLayers[sessionLayers.length - 1];
  const sessionTotalDuration = finalLayer.durationOffset + finalLayer.duration;

  for (let i = 0; i < audioLayers.length; i++) {
    const audioLayer = audioLayers[i];

    if (audioLayer.generationType === 'speech') {
      continue; // we already handle it 
    }
    if (audioLayer.endTime > sessionTotalDuration) {
      audioLayer.endTime = sessionTotalDuration;
      audioLayer.duration = audioLayer.endTime - audioLayer.startTime;
    }

    const connectedLayerId = audioLayer.connectedLayerId;

    if (connectedLayerId) {
      const connectedLayerIndex = videoSession.layers.findIndex(layer => layer._id.toString() == connectedLayerId);
      const connectedLayer = connectedLayerIndex !== -1
        ? videoSession.layers[connectedLayerIndex]
        : null;


      if (connectedLayer) {
        const previousWindow = getConnectedAudioRelativeWindow(
          audioLayer,
          connectedLayer.durationOffset,
          connectedLayer.duration,
        );
        const nextRelativeStart = Math.min(
          Math.max(0, previousWindow.relativeStart),
          Math.max(0, Number(connectedLayer.duration) || 0),
        );
        const nextDuration = Math.min(
          Math.max(0, previousWindow.duration),
          Math.max(0, (Number(connectedLayer.duration) || 0) - nextRelativeStart),
        );

        applyConnectedAudioWindowToLayer({
          audioLayer,
          layer: connectedLayer,
          layerIndex: connectedLayerIndex,
          relativeStart: nextRelativeStart,
          duration: nextDuration,
          sourceTrimStartTime: previousWindow.sourceTrimStartTime,
        });
      }
    }
  }



  await videoSession.save();

}
