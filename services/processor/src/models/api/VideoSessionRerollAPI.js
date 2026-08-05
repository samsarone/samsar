import mongoose from 'mongoose';
import VideoSession from '../../schema/VideoSession.js';
import ImageGeneration from '../../schema/ImageGeneration.js';
import AIVideoLayerGeneration from '../../schema/AIVideoLayerGeneration.js';
import FrameGeneration from '../../schema/FrameGeneration.js';
import VideoGeneration from '../../schema/VideoGeneration.js';
import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';
import { addImageGeneratorRequest } from '../Images.js';
import { copyVideoSession } from './VideoSessionCloneAPI.js';
import { buildMovieResourceListVisualPrompts } from '../movie_session/TranscriptMovieGenerator.js';
import { IMAGE_MODEL_PRICES } from '../../consts/ModelPrices.js';
import { getExpressVideoStageCreditsPerSecond } from '../../consts/pricing/ExpressVideoPricingDistribution.js';

const DEFAULT_IMAGE_MODEL = 'GPTIMAGE2';
const DEFAULT_VIDEO_MODEL = 'RUNWAYML';
const DEFAULT_IMAGE_CREDITS = 8;
const REROLL_CREDIT_SOURCE = 'reroll_layers';
const REROLL_SESSION_SUB_TYPE = 'reroll_layers';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModelKey(value) {
  return normalizeString(value).toUpperCase();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function parseMaybeJson(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getMovieResourceList(sessionData = {}) {
  const parsed = parseMaybeJson(sessionData.movieResourceList);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function getNarrativeResourceList(sessionData = {}) {
  const parsed = parseMaybeJson(sessionData.narrativeJson);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function getRerollVisualMovieResourceList(sessionData = {}) {
  const movieResourceList = getMovieResourceList(sessionData) || {};
  const narrativeJson = getNarrativeResourceList(sessionData) || {};
  const movieScenes = Array.isArray(movieResourceList.scenes) ? movieResourceList.scenes : [];
  const narrativeScenes = Array.isArray(narrativeJson.scenes) ? narrativeJson.scenes : [];
  const sceneCount = Math.max(movieScenes.length, narrativeScenes.length);
  const scenes = Array.from({ length: sceneCount }, (_, sceneIndex) => {
    const movieScene = movieScenes[sceneIndex] || {};
    const narrativeScene = narrativeScenes[sceneIndex] || {};
    const narrativeVisual = normalizeString(narrativeScene.visual);

    return {
      ...movieScene,
      ...narrativeScene,
      ...(narrativeVisual ? { visual: narrativeVisual } : {}),
    };
  });
  const movieSounds = Array.isArray(movieResourceList.sounds) ? movieResourceList.sounds : [];
  const narrativeSounds = Array.isArray(narrativeJson.sounds) ? narrativeJson.sounds : [];

  return {
    ...movieResourceList,
    scenes,
    sounds: movieSounds.length ? movieSounds : narrativeSounds,
  };
}

function normalizeLayerIndexes(rawLayerIndexes) {
  const source = Array.isArray(rawLayerIndexes)
    ? rawLayerIndexes
    : typeof rawLayerIndexes === 'string'
      ? rawLayerIndexes.split(',')
      : [];

  const indexes = [];
  const seen = new Set();
  for (const value of source) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      const error = new Error('layer_indexes must contain positive 1-based integers.');
      error.status = 400;
      throw error;
    }
    if (!seen.has(parsed)) {
      seen.add(parsed);
      indexes.push(parsed);
    }
  }

  if (!indexes.length) {
    const error = new Error('layer_indexes must include at least one layer index.');
    error.status = 400;
    throw error;
  }

  return indexes.sort((a, b) => a - b);
}

function getImageCreditsForModel(modelKey, aspectRatio) {
  const normalizedModel = normalizeModelKey(modelKey) || DEFAULT_IMAGE_MODEL;
  const pricing = IMAGE_MODEL_PRICES.find((model) => normalizeModelKey(model.key) === normalizedModel);
  const price =
    pricing?.prices?.find((entry) => entry.aspectRatio === aspectRatio)?.price ??
    pricing?.prices?.find((entry) => entry.aspectRatio === '1:1')?.price ??
    pricing?.prices?.[0]?.price;

  return Number.isFinite(Number(price)) ? Number(price) : DEFAULT_IMAGE_CREDITS;
}

function getLayerDurationSeconds(layer = {}) {
  const duration = Number(layer.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function normalizeOptionalInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function getMovieResourceScenes(sessionData = {}) {
  const movieResourceList = getMovieResourceList(sessionData);
  return Array.isArray(movieResourceList?.scenes) ? movieResourceList.scenes : [];
}

function getLayerIdString(layer = {}) {
  return layer?._id?.toString?.() || layer?._id || '';
}

function getSceneAtIndex(sessionData = {}, sceneIndex = null) {
  const normalizedIndex = normalizeOptionalInteger(sceneIndex);
  if (normalizedIndex === null) {
    return null;
  }
  const scenes = getMovieResourceScenes(sessionData);
  return scenes[normalizedIndex] || null;
}

function resolveLayerSourceSceneIndexDetails(sessionData = {}, layer = {}, zeroBasedIndex = -1) {
  const scenes = getMovieResourceScenes(sessionData);
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  if (!scenes.length) {
    return {
      sourceSceneIndex: null,
      sourceSceneIndexSource: '',
      sceneCount: 0,
      layerCount: layers.length,
    };
  }

  const layerCandidates = [
    { value: layer?.sourceSceneIndex, source: 'sourceLayer.sourceSceneIndex' },
    { value: layer?.sceneIndex, source: 'sourceLayer.sceneIndex' },
    { value: layer?.movieResourceIndex, source: 'sourceLayer.movieResourceIndex' },
    { value: layer?.imageSession?.sourceSceneIndex, source: 'sourceLayer.imageSession.sourceSceneIndex' },
    { value: layer?.imageSession?.sceneIndex, source: 'sourceLayer.imageSession.sceneIndex' },
    { value: layer?.imageSession?.movieResourceIndex, source: 'sourceLayer.imageSession.movieResourceIndex' },
  ];
  for (const candidate of layerCandidates) {
    const sceneIndex = normalizeOptionalInteger(candidate.value);
    if (sceneIndex !== null && scenes[sceneIndex]) {
      return {
        sourceSceneIndex: sceneIndex,
        sourceSceneIndexSource: candidate.source,
        sceneCount: scenes.length,
        layerCount: layers.length,
      };
    }
  }

  const layerId = getLayerIdString(layer);
  const audioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];
  const connectedAudioLayer = audioLayers.find((audioLayer) =>
    layerId && String(audioLayer?.connectedLayerId || '') === String(layerId)
  );
  if (connectedAudioLayer) {
    const audioCandidates = [
      { value: connectedAudioLayer.sceneIndex, source: 'connectedAudioLayer.sceneIndex' },
      { value: connectedAudioLayer.sourceSceneIndex, source: 'connectedAudioLayer.sourceSceneIndex' },
      { value: connectedAudioLayer.movieResourceIndex, source: 'connectedAudioLayer.movieResourceIndex' },
      { value: connectedAudioLayer.connectedLayerIndex, source: 'connectedAudioLayer.connectedLayerIndex' },
    ];
    for (const candidate of audioCandidates) {
      const sceneIndex = normalizeOptionalInteger(candidate.value);
      if (sceneIndex !== null && scenes[sceneIndex]) {
        return {
          sourceSceneIndex: sceneIndex,
          sourceSceneIndexSource: candidate.source,
          sceneCount: scenes.length,
          layerCount: layers.length,
        };
      }
    }
  }

  if (zeroBasedIndex >= 0 && scenes.length === layers.length && scenes[zeroBasedIndex]) {
    return {
      sourceSceneIndex: zeroBasedIndex,
      sourceSceneIndexSource: 'layerIndexEqualSceneIndexFallback',
      sceneCount: scenes.length,
      layerCount: layers.length,
    };
  }

  return {
    sourceSceneIndex: null,
    sourceSceneIndexSource: '',
    sceneCount: scenes.length,
    layerCount: layers.length,
  };
}

function resolveLayerSourceSceneIndex(sessionData = {}, layer = {}, zeroBasedIndex = -1) {
  return resolveLayerSourceSceneIndexDetails(sessionData, layer, zeroBasedIndex).sourceSceneIndex;
}

function getLayerPromptInfo(sessionData, layer, zeroBasedIndex, sourceSceneIndex = null) {
  const scene = getSceneAtIndex(
    sessionData,
    sourceSceneIndex ?? resolveLayerSourceSceneIndex(sessionData, layer, zeroBasedIndex)
  );
  const candidates = [
    { value: layer?.originalImageGenerationPrompt, source: 'original' },
    { value: layer?.imageSession?.originalImageGenerationPrompt, source: 'original' },
    { value: layer?.originalImagePrompt, source: 'legacy_original' },
    { value: layer?.imageSession?.originalImagePrompt, source: 'legacy_original' },
    { value: layer?.sourcePrompt, source: 'legacy_original' },
    { value: layer?.imageSession?.sourcePrompt, source: 'legacy_original' },
    { value: layer?.originalPrompt, source: 'legacy_original' },
    { value: layer?.imageSession?.originalPrompt, source: 'legacy_original' },
    { value: scene?.visual, source: 'seed' },
    { value: scene?.imagePrompt, source: 'seed' },
    { value: scene?.image_prompt, source: 'seed' },
    { value: scene?.visualPrompt, source: 'seed' },
    { value: scene?.visual_prompt, source: 'seed' },
    { value: layer?.imageSession?.originalRetryPrompt, source: 'retry_original' },
    { value: layer?.imageSession?.prompt, source: 'mutable' },
    { value: layer?.prompt, source: 'mutable' },
  ];

  for (const candidate of candidates) {
    const prompt = normalizeString(candidate.value);
    if (prompt) {
      return { prompt, source: candidate.source };
    }
  }

  return { prompt: '', source: '' };
}

function getLayerPrompt(sessionData, layer, zeroBasedIndex) {
  const sourceSceneIndex = resolveLayerSourceSceneIndex(sessionData, layer, zeroBasedIndex);
  return getLayerPromptInfo(sessionData, layer, zeroBasedIndex, sourceSceneIndex).prompt;
}

function getBaseLayerType(layer = {}) {
  const baseType = normalizeString(layer.layerBaseAiImageType || layer.layerAiVideoType).toLowerCase();
  if (baseType === 'ai_video') {
    return normalizeString(layer.layerBaseAiImageType).toLowerCase();
  }
  return baseType || 'scene';
}

function getRuntimeLayerType(baseType) {
  if (baseType === 'base') {
    return 'scene';
  }
  return baseType || 'scene';
}

function isRerollableLayer(layer = {}) {
  const baseType = getBaseLayerType(layer);
  return Boolean(
    layer &&
    layer.skipAiVideoGeneration !== true &&
    baseType !== 'none' &&
    baseType !== 'outro',
  );
}

function resolveImageModel(sessionData = {}) {
  return normalizeModelKey(
    sessionData.expressGenerationImageModel ||
    sessionData.imageModel ||
    sessionData.customAdapterFallbacks?.text_to_image ||
    DEFAULT_IMAGE_MODEL,
  ) || DEFAULT_IMAGE_MODEL;
}

function resolveVideoModel(sessionData = {}) {
  return normalizeModelKey(
    sessionData.expressGenerativeVideoModel ||
    sessionData.videoGenerationModel ||
    sessionData.customAdapterFallbacks?.image_to_video ||
    DEFAULT_VIDEO_MODEL,
  ) || DEFAULT_VIDEO_MODEL;
}

function resolveRerollVisualTheme(sessionData = {}) {
  const candidates = [
    sessionData.themeJson,
    sessionData.parentJsonTheme,
    sessionData.derivedJsonTheme,
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') {
      continue;
    }
    const parsed = parseMaybeJson(candidate);
    if (parsed !== null && parsed !== undefined && parsed !== '') {
      return parsed;
    }
  }

  return {};
}

async function regenerateRerollVisualPrompts(sessionData, sceneIndexes, dependencies = {}) {
  const requestedSceneIndexes = [...new Set((Array.isArray(sceneIndexes) ? sceneIndexes : [])
    .map(normalizeOptionalInteger))];
  if (!requestedSceneIndexes.length || requestedSceneIndexes.some((sceneIndex) => sceneIndex === null)) {
    const error = new Error('Unable to resolve a narrative scene for visual prompt regeneration.');
    error.code = 'REROLL_VISUAL_SCENE_MISSING';
    error.status = 422;
    throw error;
  }

  const visualPromptBuilder = dependencies.buildMovieResourceListVisualPrompts ||
    buildMovieResourceListVisualPrompts;
  const result = await visualPromptBuilder({
    movieResourceList: getRerollVisualMovieResourceList(sessionData),
    themeJson: resolveRerollVisualTheme(sessionData),
    aspectRatio: normalizeString(sessionData.aspectRatio) || '16:9',
    inferenceModel: firstNonEmptyString(
      sessionData.expressGenerationInferenceModel,
      sessionData.inferenceModel,
    ) || undefined,
    videoTone: normalizeString(sessionData.videoTone) || 'cinematic',
    requestKeyPrefix: `reroll:${sessionData._id?.toString?.() || sessionData._id || 'session'}:visual`,
    sceneIndexes: requestedSceneIndexes,
  });

  if (!Array.isArray(result?.promptList) || result.promptList.length !== requestedSceneIndexes.length) {
    const error = new Error('Visual prompt regeneration did not return every requested scene.');
    error.code = 'REROLL_VISUAL_PROMPT_GENERATION_FAILED';
    error.status = 502;
    throw error;
  }

  return requestedSceneIndexes.map((sceneIndex, resultIndex) => ({
    sceneIndex,
    prompt: normalizeString(result.promptList[resultIndex]?.prompt),
  }));
}

function resolveRerollProvider(sessionData = {}) {
  return firstNonEmptyString(
    sessionData.expressGenerativeVideoModel,
    sessionData.video_model,
    sessionData.provider,
    sessionData.videoGenerationModelSubType,
    REROLL_SESSION_SUB_TYPE,
  );
}

function assertSessionCanReroll(sessionData = {}) {
  if (sessionData.expressGenerationPending || sessionData.videoGenerationPending || sessionData.frameGenerationPending) {
    const error = new Error('Session is still rendering. Wait for the current render to complete before rerolling layers.');
    error.status = 409;
    throw error;
  }
  if (sessionData.expressGenerationPaused) {
    const error = new Error('Session is paused. Resume or cancel the current render before rerolling layers.');
    error.status = 409;
    throw error;
  }
  if (!Array.isArray(sessionData.layers) || !sessionData.layers.length) {
    const error = new Error('Session has no layers to reroll.');
    error.status = 400;
    throw error;
  }
}

function buildQuote(sessionData, layerIndexes) {
  const aspectRatio = normalizeString(sessionData.aspectRatio) || '16:9';
  const imageModel = resolveImageModel(sessionData);
  const videoModel = resolveVideoModel(sessionData);
  const imageCreditsPerLayer = getImageCreditsForModel(imageModel, aspectRatio);
  const aiVideoCreditsPerSecond = getExpressVideoStageCreditsPerSecond('ai_video_generation', videoModel);
  const layers = [];

  for (const layerIndex of layerIndexes) {
    const zeroBasedIndex = layerIndex - 1;
    const layer = sessionData.layers[zeroBasedIndex];
    if (!layer) {
      const error = new Error(`Layer index ${layerIndex} is out of range.`);
      error.status = 400;
      throw error;
    }
    if (!isRerollableLayer(layer)) {
      const error = new Error(`Layer index ${layerIndex} cannot be rerolled.`);
      error.status = 400;
      throw error;
    }

    const prompt = getLayerPrompt(sessionData, layer, zeroBasedIndex);
    if (!prompt) {
      const error = new Error(`Layer index ${layerIndex} is missing an image prompt.`);
      error.status = 400;
      throw error;
    }

    const durationSeconds = getLayerDurationSeconds(layer);
    const aiVideoCredits = durationSeconds > 0 && aiVideoCreditsPerSecond > 0
      ? Math.ceil(durationSeconds * aiVideoCreditsPerSecond)
      : 0;
    const imageCredits = Math.ceil(imageCreditsPerLayer);

    layers.push({
      layerIndex,
      layerId: layer._id?.toString?.() || layer._id,
      durationSeconds,
      imageCredits,
      aiVideoCredits,
      totalCredits: imageCredits + aiVideoCredits,
      promptPreview: prompt.slice(0, 160),
      baseLayerType: getBaseLayerType(layer),
    });
  }

  const imageCredits = layers.reduce((total, layer) => total + layer.imageCredits, 0);
  const aiVideoCredits = layers.reduce((total, layer) => total + layer.aiVideoCredits, 0);
  const durationSeconds = layers.reduce((total, layer) => total + layer.durationSeconds, 0);

  return {
    layerCount: layers.length,
    layerIndexes,
    aspectRatio,
    imageModel,
    videoModel,
    imageCreditsPerLayer,
    aiVideoCreditsPerSecond,
    durationSeconds,
    imageCredits,
    aiVideoCredits,
    totalCredits: imageCredits + aiVideoCredits,
    layers,
  };
}

async function loadOwnedSession(userId, videoSessionId) {
  const normalizedUserId = userId?.toString?.() || userId;
  if (!normalizedUserId) {
    const error = new Error('User ID is required.');
    error.status = 401;
    throw error;
  }
  if (!mongoose.Types.ObjectId.isValid(videoSessionId)) {
    const error = new Error('videoSessionId must be a valid video session id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();
  const sessionData = await VideoSession.findOne({
    _id: videoSessionId,
    userId: normalizedUserId,
  });

  if (!sessionData) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  return sessionData;
}

function resolveCopiedSessionId(copyResult = {}) {
  return firstNonEmptyString(
    copyResult.session_id,
    copyResult.sessionId,
    copyResult.session?._id?.toString?.(),
    copyResult.session?._id,
    copyResult.session?.id?.toString?.(),
    copyResult.session?.id,
  );
}

function getLayerId(layer = {}) {
  return layer?._id?.toString?.() || layer?._id || layer?.id?.toString?.() || layer?.id || '';
}

function assertRerollCloneIntegrity(sourceSessionData = {}, clonedSessionData = {}, layerIndexes = []) {
  const sourceLayers = Array.isArray(sourceSessionData.layers) ? sourceSessionData.layers : [];
  const clonedLayers = Array.isArray(clonedSessionData.layers) ? clonedSessionData.layers : [];

  if (sourceLayers.length !== clonedLayers.length) {
    const error = new Error(
      `Reroll clone is incomplete: expected ${sourceLayers.length} layers but cloned ${clonedLayers.length}.`,
    );
    error.status = 500;
    throw error;
  }

  for (const layerIndex of layerIndexes) {
    const zeroBasedIndex = layerIndex - 1;
    const sourceLayer = sourceLayers[zeroBasedIndex];
    const clonedLayer = clonedLayers[zeroBasedIndex];
    if (!sourceLayer || !clonedLayer) {
      const error = new Error(`Reroll clone is missing layer index ${layerIndex}.`);
      error.status = 500;
      throw error;
    }

    const sourceLayerId = getLayerId(sourceLayer);
    const clonedLayerId = getLayerId(clonedLayer);
    if (sourceLayerId && clonedLayerId && sourceLayerId !== clonedLayerId) {
      const error = new Error(
        `Reroll clone layer mismatch at index ${layerIndex}: expected ${sourceLayerId} but found ${clonedLayerId}.`,
      );
      error.status = 500;
      throw error;
    }
  }
}

export async function quoteVideoSessionLayerReroll(userId, {
  videoSessionId,
  layerIndexes,
} = {}) {
  const sessionData = await loadOwnedSession(userId, videoSessionId);
  assertSessionCanReroll(sessionData);
  const normalizedLayerIndexes = normalizeLayerIndexes(layerIndexes);
  return {
    session_id: sessionData._id.toString(),
    request_id: sessionData._id.toString(),
    creditQuote: buildQuote(sessionData, normalizedLayerIndexes),
  };
}

function resetLayerForReroll(sessionData, layer, layerIndex, promptInfo, sourceSceneIndex = null, sourceSceneIndexSource = '') {
  const prompt = promptInfo?.prompt || '';
  const shouldReplaceOriginalPrompt = promptInfo?.source === 'reroll_visual_pipeline';
  const shouldPersistOriginalPrompt = shouldReplaceOriginalPrompt ||
    ['original', 'seed', 'legacy_original', 'retry_original'].includes(promptInfo?.source);
  const getOriginalPromptValue = (currentValue) => shouldReplaceOriginalPrompt
    ? prompt
    : currentValue || prompt;
  const getOriginalPromptSource = (currentValue) => shouldReplaceOriginalPrompt
    ? promptInfo.source
    : currentValue || promptInfo.source;
  const resolvedSourceSceneIndex = normalizeOptionalInteger(sourceSceneIndex);
  const baseType = getBaseLayerType(layer);
  const runtimeType = getRuntimeLayerType(baseType);
  const requiresLipSync = runtimeType === 'character';
  const requiresSoundEffect = runtimeType === 'sound_effect';
  const activeItemsBeforeReset = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const imageItemsBeforeReset = activeItemsBeforeReset.filter((item) => item?.type === 'image').length;
  const previousRetryState = {
    layerFailureRetryCount: Number(layer?.failureRetryCount) || 0,
    layerFilterRetryCount: Number(layer?.filterRetryCount) || 0,
    layerRetryCount: Number(layer?.retryCount) || 0,
    imageFailureRetryCount: Number(layer?.imageSession?.failureRetryCount) || 0,
    imageFilterRetryCount: Number(layer?.imageSession?.filterRetryCount) || 0,
    imageRetryCount: Number(layer?.imageSession?.retryCount) || 0,
  };
  const previousLayerState = {
    imageGenerationStatus: layer?.imageSession?.generationStatus || null,
    imageApiGenerationStatus: layer?.imageSession?.apiGenerationStatus || null,
    hasActiveGeneratedImage: Boolean(normalizeString(layer?.imageSession?.activeGeneratedImage)),
    hasActiveSelectedImage: Boolean(normalizeString(layer?.imageSession?.activeSelectedImage)),
    hasActiveImageRemoteLink: Boolean(normalizeString(layer?.imageSession?.activeImageRemoteLink)),
    hasAiVideoLayer: Boolean(normalizeString(layer?.aiVideoLayer)),
    hasAiVideoRemoteLink: Boolean(normalizeString(layer?.aiVideoRemoteLink)),
    imageItemsBeforeReset,
    nonImageItemsBeforeReset: activeItemsBeforeReset.length - imageItemsBeforeReset,
  };

  layer.prompt = prompt;
  if (resolvedSourceSceneIndex !== null) {
    layer.sourceSceneIndex = resolvedSourceSceneIndex;
    layer.sourceSceneIndexSource = sourceSceneIndexSource;
  }
  if (shouldPersistOriginalPrompt) {
    layer.originalImageGenerationPrompt = getOriginalPromptValue(layer.originalImageGenerationPrompt);
    layer.originalImageGenerationPromptSource = getOriginalPromptSource(layer.originalImageGenerationPromptSource);
    layer.originalImagePrompt = getOriginalPromptValue(layer.originalImagePrompt);
    layer.sourcePrompt = getOriginalPromptValue(layer.sourcePrompt);
    layer.originalPrompt = getOriginalPromptValue(layer.originalPrompt);
  }
  layer.layerAiVideoType = runtimeType;
  layer.layerBaseAiImageType = baseType || runtimeType;
  layer.status = 'pending';
  layer.aiVideoGenerationPending = false;
  layer.aiVideoGenerationStatus = 'INIT';
  layer.hasAiVideoLayer = false;
  layer.aiVideoGenerationError = null;
  layer.processVideoGenerationFailed = false;
  layer.aiVideoLayer = null;
  layer.aiVideoRemoteLink = null;
  layer.aiLayerStartFrame = null;
  layer.aiLayerEndFrame = null;
  layer.frameGenerationPending = false;
  layer.initFramesGenerated = false;
  layer.aiVideoFrameGenerationPending = false;

  layer.lipSyncGenerationPending = requiresLipSync;
  layer.lipSyncVideoGenerationStatus = 'INIT';
  layer.hasLipSyncVideoLayer = false;
  layer.lipSyncVideoLayer = null;
  layer.lipSyncRemoteLink = null;

  layer.soundEffectGenerationPending = requiresSoundEffect;
  layer.soundEffectVideoGenerationStatus = 'INIT';
  layer.hasSoundEffectVideoLayer = false;
  layer.soundEffectVideoLayer = null;
  layer.soundEffectRemoteLink = null;
  if (requiresSoundEffect) {
    layer.isAudioVideoLayer = false;
  }

  layer.refilterImageScore = 100;
  layer.filterPasses = [];
  layer.failureRetryCount = 0;
  layer.filterRetryCount = 0;
  layer.retryCount = 0;
  layer.failureHistory = [];
  layer.activeImageDescription = '';

  if (!layer.imageSession || typeof layer.imageSession !== 'object') {
    layer.imageSession = {};
  }
  layer.imageSession.userId = layer.imageSession.userId || sessionData.userId;
  layer.imageSession.prompt = prompt;
  if (resolvedSourceSceneIndex !== null) {
    layer.imageSession.sourceSceneIndex = resolvedSourceSceneIndex;
    layer.imageSession.sourceSceneIndexSource = sourceSceneIndexSource;
  }
  if (shouldPersistOriginalPrompt) {
    layer.imageSession.originalImageGenerationPrompt = getOriginalPromptValue(
      layer.imageSession.originalImageGenerationPrompt,
    );
    layer.imageSession.originalImageGenerationPromptSource = getOriginalPromptSource(
      layer.imageSession.originalImageGenerationPromptSource,
    );
    layer.imageSession.originalImagePrompt = getOriginalPromptValue(layer.imageSession.originalImagePrompt);
    layer.imageSession.sourcePrompt = getOriginalPromptValue(layer.imageSession.sourcePrompt);
    layer.imageSession.originalPrompt = getOriginalPromptValue(layer.imageSession.originalPrompt);
  }
  layer.imageSession.originalRetryPrompt = prompt;
  layer.imageSession.generationStatus = 'PENDING';
  layer.imageSession.apiGenerationStatus = 'INIT';
  layer.imageSession.generationError = null;
  layer.imageSession.lastFailureAt = null;
  layer.imageSession.lastFailureMessage = null;
  layer.imageSession.lastFailureSource = null;
  layer.imageSession.failureRetryCount = 0;
  layer.imageSession.filterRetryCount = 0;
  layer.imageSession.retryCount = 0;
  layer.imageSession.failureHistory = [];
  layer.imageSession.activeGeneratedImage = '';
  layer.imageSession.activeSelectedImage = '';
  layer.imageSession.activeEditedImage = '';
  layer.imageSession.activeImageRemoteLink = '';
  layer.imageSession.activeImageDescription = '';
  layer.imageSession.activeItemList = Array.isArray(layer.imageSession.activeItemList)
    ? layer.imageSession.activeItemList.filter((item) => item?.type !== 'image')
    : [];
  layer.imageSession.refilterImageGenerationsRequired = true;
  layer.imageSession.refilterImageGenerationCompleted = false;
  layer.imageSession.refilterImagePassNumber = 1;
  layer.imageSession.imageFilterScoreRequired = true;

  return {
    layerIndex,
    layerId: layer._id?.toString?.() || layer._id,
    baseType,
    prompt,
    promptSource: promptInfo?.source || '',
    sourceSceneIndex: resolvedSourceSceneIndex,
    sourceSceneIndexSource,
    runtimeType,
    requiresLipSync,
    requiresSoundEffect,
    promptLength: prompt.length,
    previousRetryState,
    previousLayerState,
  };
}

function resetGeneratedOutroTiles(sessionData) {
  if (sessionData.generatedOutroImage !== true) {
    return false;
  }
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const outroLayer = [...layers].reverse().find((layer) =>
    layer?.isGeneratedOutroLayer === true ||
    layer?.generatedOutroImage === true ||
    layer?.generatedOutroTilesCompleted === true ||
    layer?.generatedOutroTilesPending === true
  );

  if (!outroLayer) {
    return false;
  }

  sessionData.generatedOutroTilesPending = true;
  sessionData.generatedOutroTilesCompleted = false;
  sessionData.generatedOutroTileCount = 0;
  outroLayer.generatedOutroTilesPending = true;
  outroLayer.generatedOutroTilesCompleted = false;
  outroLayer.generatedOutroTileCount = 0;
  outroLayer.frameGenerationPending = true;
  return true;
}

function markAllLayersForFrameRegeneration(sessionData) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  if (sessionData && typeof sessionData === 'object') {
    sessionData.frameGenerationPending = true;
  }
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') {
      continue;
    }
    layer.frameGenerationPending = true;
    layer.aiVideoFrameGenerationPending = false;
    layer.initFramesGenerated = false;
    layer.frames = [];
  }
}

async function deleteStaleQueuedWork(sessionId, layerIds) {
  const [
    imageGenerationResult,
    aiVideoLayerGenerationResult,
    frameGenerationResult,
    videoGenerationResult,
  ] = await Promise.all([
    ImageGeneration.deleteMany({
      $or: [
        { sessionId },
        { videoSessionId: sessionId },
      ],
      layerId: { $in: layerIds },
    }),
    AIVideoLayerGeneration.deleteMany({
      sessionId,
      layerId: { $in: layerIds },
    }),
    FrameGeneration.deleteMany({ sessionId }),
    VideoGeneration.deleteMany({ videoSessionId: sessionId }),
  ]);

  return {
    imageGenerationDeletedCount: imageGenerationResult?.deletedCount || 0,
    aiVideoLayerGenerationDeletedCount: aiVideoLayerGenerationResult?.deletedCount || 0,
    frameGenerationDeletedCount: frameGenerationResult?.deletedCount || 0,
    videoGenerationDeletedCount: videoGenerationResult?.deletedCount || 0,
  };
}

async function queueImageRerollRequests(userId, sessionData, rerollLayers, quote) {
  const aspectRatio = quote.aspectRatio;
  const imageModel = quote.imageModel;
  const customFallbackModel = sessionData.customAdapterFallbacks?.text_to_image;
  const imageStyle = normalizeString(sessionData.imageStyle || sessionData.expressGenerationImageStyle);

  for (const layer of rerollLayers) {
    const payload = {
      userId: userId?.toString?.() || userId,
      sessionId: sessionData._id.toString(),
      videoSessionId: sessionData._id.toString(),
      layerId: layer.layerId,
      prompt: layer.prompt,
      originalRetryPrompt: layer.prompt,
      originalImageGenerationPrompt: layer.prompt,
      originalImageGenerationPromptSource: layer.promptSource || 'reroll',
      originalImagePrompt: layer.prompt,
      sourcePrompt: layer.prompt,
      originalPrompt: layer.prompt,
      ...(layer.sourceSceneIndex !== null && layer.sourceSceneIndex !== undefined
        ? { sourceSceneIndex: layer.sourceSceneIndex }
        : {}),
      ...(layer.sourceSceneIndexSource
        ? { sourceSceneIndexSource: layer.sourceSceneIndexSource }
        : {}),
      model: imageModel,
      isBaseGeneration: true,
      isBatchGeneration: true,
      aspectRatio,
      contentFilterRating: 3,
      refilterImageGenerationsRequired: true,
      refilterImagePassNumber: 1,
      imageFilterScoreRequired: true,
      requestType: 'POST_PROCESSING_REROLL_LAYERS',
      ...(imageStyle ? { imageStyle } : {}),
      ...(customFallbackModel ? { customFallbackModel } : {}),
    };

    const imageRequest = await addImageGeneratorRequest(userId, payload, false);
  }
}

export async function rerollVideoSessionLayersAndQueueGeneration(userId, {
  videoSessionId,
  layerIndexes,
  webhookUrl = null,
  apiKeyId = null,
} = {}) {
  const sourceSessionData = await loadOwnedSession(userId, videoSessionId);
  assertSessionCanReroll(sourceSessionData);
  const sourceSessionId = sourceSessionData._id.toString();
  const normalizedLayerIndexes = normalizeLayerIndexes(layerIndexes);
  const quote = buildQuote(sourceSessionData, normalizedLayerIndexes);

  const creditResult = await deductGenerationCredits(userId, quote.totalCredits, {
    source: REROLL_CREDIT_SOURCE,
    apiKeyId,
    metadata: {
      sessionId: sourceSessionId,
      sourceSessionId,
      layerIndexes: normalizedLayerIndexes,
      imageModel: quote.imageModel,
      videoModel: quote.videoModel,
      aspectRatio: quote.aspectRatio,
      durationSeconds: quote.durationSeconds,
      imageCredits: quote.imageCredits,
      aiVideoCredits: quote.aiVideoCredits,
      totalCredits: quote.totalCredits,
    },
  });

  const copyResult = await copyVideoSession(userId, { videoSessionId: sourceSessionId });
  const rerollSessionId = resolveCopiedSessionId(copyResult);
  if (!rerollSessionId) {
    const error = new Error('Unable to clone video session before reroll.');
    error.status = 500;
    throw error;
  }

  const sessionData = await loadOwnedSession(userId, rerollSessionId);
  assertRerollCloneIntegrity(sourceSessionData, sessionData, normalizedLayerIndexes);
  assertSessionCanReroll(sessionData);

  const rerollTargets = normalizedLayerIndexes.map((layerIndex) => {
    const zeroBasedIndex = layerIndex - 1;
    const sourceLayer = sourceSessionData.layers[zeroBasedIndex];
    const sourceSceneIndexDetails = resolveLayerSourceSceneIndexDetails(sourceSessionData, sourceLayer, zeroBasedIndex);
    const { sourceSceneIndex, sourceSceneIndexSource } = sourceSceneIndexDetails;

    return {
      layerIndex,
      zeroBasedIndex,
      sourceSceneIndex,
      sourceSceneIndexSource,
    };
  });
  const regeneratedVisualPrompts = await regenerateRerollVisualPrompts(
    sourceSessionData,
    rerollTargets.map((target) => target.sourceSceneIndex),
  );
  const regeneratedPromptBySceneIndex = new Map(
    regeneratedVisualPrompts.map((item) => [item.sceneIndex, item.prompt]),
  );

  const rerollLayers = [];
  for (const target of rerollTargets) {
    const {
      layerIndex,
      zeroBasedIndex,
      sourceSceneIndex,
      sourceSceneIndexSource,
    } = target;
    const layer = sessionData.layers[zeroBasedIndex];
    const regeneratedPrompt = regeneratedPromptBySceneIndex.get(sourceSceneIndex);
    if (!regeneratedPrompt) {
      const error = new Error(`Visual prompt regeneration returned no prompt for layer index ${layerIndex}.`);
      error.code = 'REROLL_VISUAL_PROMPT_GENERATION_FAILED';
      error.status = 502;
      throw error;
    }
    rerollLayers.push(resetLayerForReroll(
      sessionData,
      layer,
      layerIndex,
      { prompt: regeneratedPrompt, source: 'reroll_visual_pipeline' },
      sourceSceneIndex,
      sourceSceneIndexSource,
    ));
  }

  const rerolledLayerIds = rerollLayers.map((layer) => layer.layerId);
  const rerollRequiresLipSync = rerollLayers.some((layer) => layer.baseType === 'character');
  const rerollRequiresSoundEffect = rerollLayers.some((layer) => layer.baseType === 'sound_effect');
  const staleWorkDeleteResult = await deleteStaleQueuedWork(sessionData._id.toString(), rerolledLayerIds);

  const nextStatus = {
    ...(sessionData.expressGenerationStatus || {}),
    image_generation: 'PENDING',
    ai_video_generation: 'INIT',
    lip_sync_generation: rerollRequiresLipSync
      ? 'INIT'
      : (sessionData.expressGenerationStatus?.lip_sync_generation || 'COMPLETED'),
    sound_effect_generation: rerollRequiresSoundEffect
      ? 'INIT'
      : (sessionData.expressGenerationStatus?.sound_effect_generation || 'COMPLETED'),
    frame_generation: 'INIT',
    video_generation: 'INIT',
    status: 'PENDING',
  };

  const shouldRerenderOutroTiles = resetGeneratedOutroTiles(sessionData);
  if (shouldRerenderOutroTiles) {
    nextStatus.outro_tile_generation = 'INIT';
  }
  markAllLayersForFrameRegeneration(sessionData);

  sessionData.expressGenerationStatus = nextStatus;
  sessionData.generationStatus = 'PENDING';
  sessionData.videoLink = null;
  sessionData.remoteURL = null;
  sessionData.expressGenerationPending = true;
  sessionData.expressGenerativeVideoRequired = true;
  sessionData.expressGenerationPaused = false;
  sessionData.expressGenerationCancelled = false;
  sessionData.expressGenerationFailed = false;
  sessionData.expressGenerationError = null;
  sessionData.videoGenerationPending = false;
  sessionData.frameGenerationPending = true;
  sessionData.aiVideoGenerationPending = false;
  sessionData.lipSyncGenerationPending = false;
  sessionData.soundEffectGenerationPending = false;
  sessionData.refilterImageGenerationsRequired = true;
  sessionData.refilterImageGenerationCompleted = false;
  sessionData.refilterImagePassNumber = 1;
  if (webhookUrl) {
    sessionData.externalWebhook = webhookUrl;
  }

  sessionData.markModified('layers');
  sessionData.markModified('expressGenerationStatus');
  sessionData.markModified('generatedOutroTilesPending');
  sessionData.markModified('generatedOutroTilesCompleted');
  sessionData.markModified('generatedOutroTileCount');

  await sessionData.save();
  await queueImageRerollRequests(userId, sessionData, rerollLayers, quote);
  await upsertGlobalSessionMapping({
    sessionId: rerollSessionId,
    sessionType: 'video',
    requestId: rerollSessionId,
    provider: resolveRerollProvider(sourceSessionData),
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: REROLL_SESSION_SUB_TYPE,
    metadata: {
      originalSessionId: sourceSessionId,
      sourceSessionId,
      clonedFromSessionId: sourceSessionId,
      layerIndexes: normalizedLayerIndexes,
      layerIds: rerolledLayerIds,
      imageModel: quote.imageModel,
      videoModel: quote.videoModel,
      aspectRatio: quote.aspectRatio,
      durationSeconds: quote.durationSeconds,
      imageCredits: quote.imageCredits,
      aiVideoCredits: quote.aiVideoCredits,
      totalCredits: quote.totalCredits,
    },
  });

  return {
    session_id: rerollSessionId,
    request_id: rerollSessionId,
    source_session_id: sourceSessionId,
    original_session_id: sourceSessionId,
    cloned_from_session_id: sourceSessionId,
    status: 'PENDING',
    layer_indexes: normalizedLayerIndexes,
    layer_ids: rerolledLayerIds,
    creditQuote: quote,
    creditsCharged: quote.totalCredits,
    remainingCredits: creditResult?.remainingCredits ?? null,
  };
}

export const __testOnly__ = {
  assertRerollCloneIntegrity,
  getLayerPromptInfo,
  getRerollVisualMovieResourceList,
  markAllLayersForFrameRegeneration,
  regenerateRerollVisualPrompts,
  resolveLayerSourceSceneIndexDetails,
  resolveLayerSourceSceneIndex,
  resetLayerForReroll,
};
