import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import axios from 'axios';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { Types } from 'mongoose';

import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';
import VideoSession from '../../schema/VideoSession.js';
import AudioGeneration from '../../schema/AudioGeneration.js';
import User from '../../schema/User.js';
import { normalizeSupportedLanguage, SUPPORTED_LANGUAGES } from '../../consts/SupportedLanguages.js';
import { getLanguageStringFromLanguageCode } from '../../consts/LanguageCodes.js';
import { translateTextContent } from '../OpenAI.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { createOutroCtaTextItems } from '../movie_session/image_list_to_video/OutroLayerItems.js';
import {
  buildOutroImageMetadata,
  normalizeFooterMetadataItem,
  normalizeOutroImageMetadata,
} from '../../utils/VideoOverlayMetadata.js';

const TRANSLATE_VIDEO_CREDITS_PER_SECOND = 3;
const DEFAULT_FRAMES_PER_SECOND = 24;
const VALID_FRAMES_PER_SECOND = new Set([16, 24, 30]);
const MEDIA_DOWNLOAD_TIMEOUT_MS = Number.isFinite(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS)))
  : 180000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveFramesPerSecond(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_FRAMES_PER_SECOND;
  }
  const rounded = Math.round(parsed);
  return VALID_FRAMES_PER_SECOND.has(rounded) ? rounded : DEFAULT_FRAMES_PER_SECOND;
}

async function createNewBlankVideoSession(userId, sessionOverrides = {}) {
  const userData = await User.findById(userId).select('videoFramesPerSecond').lean();
  const framesPerSecond = resolveFramesPerSecond(userData?.videoFramesPerSecond);
  const overrides = sessionOverrides && typeof sessionOverrides === 'object' ? sessionOverrides : {};
  const newSession = await VideoSession.create({ userId, framesPerSecond, ...overrides });
  return newSession._id.toString();
}

function isWritableDirectory(dirPath) {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveAssetsRoot() {
  const localAssetsRoot = path.resolve(__dirname, '../../..', 'assets');
  const dockerAssetsRoot = '/assets';
  const currentEnv = process.env.CURRENT_ENV;

  if (currentEnv === 'staging' || currentEnv === 'docker' || currentEnv === 'production') {
    if (fsExtra.existsSync(dockerAssetsRoot) && isWritableDirectory(dockerAssetsRoot)) {
      return dockerAssetsRoot;
    }
  }

  if (!fsExtra.existsSync(localAssetsRoot)) {
    fsExtra.ensureDirSync(localAssetsRoot);
  }

  return localAssetsRoot;
}

async function copyDirIfExists(sourceDir, targetDir) {
  if (!sourceDir || !targetDir) {
    return;
  }
  const exists = await fsExtra.pathExists(sourceDir);
  if (!exists) {
    return;
  }
  await fsExtra.ensureDir(path.dirname(targetDir));
  await fsExtra.copy(sourceDir, targetDir, {
    overwrite: true,
    errorOnExist: false,
    recursive: true,
  });
}

async function copySessionAssetDirectories({ assetsRoot, oldSessionId, newSessionId }) {
  await Promise.all([
    copyDirIfExists(path.join(assetsRoot, 'video', oldSessionId), path.join(assetsRoot, 'video', newSessionId)),
    copyDirIfExists(path.join(assetsRoot, 'video', 'frames', oldSessionId), path.join(assetsRoot, 'video', 'frames', newSessionId)),
    copyDirIfExists(path.join(assetsRoot, 'video', 'audio', oldSessionId), path.join(assetsRoot, 'video', 'audio', newSessionId)),
    copyDirIfExists(path.join(assetsRoot, 'video', 'outro', oldSessionId), path.join(assetsRoot, 'video', 'outro', newSessionId)),
    copyDirIfExists(path.join(assetsRoot, 'video', 'splash', oldSessionId), path.join(assetsRoot, 'video', 'splash', newSessionId)),
    copyDirIfExists(path.join(assetsRoot, 'video', 'lip_sync', oldSessionId), path.join(assetsRoot, 'video', 'lip_sync', newSessionId)),
    copyDirIfExists(
      path.join(assetsRoot, 'video', 'narrator_avatar', 'audio', oldSessionId),
      path.join(assetsRoot, 'video', 'narrator_avatar', 'audio', newSessionId),
    ),
    copyDirIfExists(
      path.join(assetsRoot, 'video', 'narrator_avatar', 'video', oldSessionId),
      path.join(assetsRoot, 'video', 'narrator_avatar', 'video', newSessionId),
    ),
    copyDirIfExists(
      path.join(assetsRoot, 'video', 'narrator_avatar', 'frames', oldSessionId),
      path.join(assetsRoot, 'video', 'narrator_avatar', 'frames', newSessionId),
    ),
    copyDirIfExists(path.join(assetsRoot, 'video', 'generations', oldSessionId), path.join(assetsRoot, 'video', 'generations', newSessionId)),
    copyDirIfExists(path.join(assetsRoot, 'ai_video', 'frames', oldSessionId), path.join(assetsRoot, 'ai_video', 'frames', newSessionId)),
    copyDirIfExists(path.join(assetsRoot, 'ai_video', 'audio', oldSessionId), path.join(assetsRoot, 'ai_video', 'audio', newSessionId)),
    copyDirIfExists(path.join(assetsRoot, 'ai_video', 'generations', oldSessionId), path.join(assetsRoot, 'ai_video', 'generations', newSessionId)),
  ]);
}

function rewriteSessionAssetReferences(sessionData, oldSessionId, newSessionId) {
  if (!sessionData || typeof sessionData !== 'object') {
    return;
  }

  const escapedOldSessionId = oldSessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replaceSessionPathSegment = (value) => {
    if (typeof value !== 'string' || !value.includes(oldSessionId)) {
      return value;
    }

    const hashIndex = value.indexOf('#');
    const pathAndQuery = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
    const hashSuffix = hashIndex >= 0 ? value.slice(hashIndex) : '';

    const queryIndex = pathAndQuery.indexOf('?');
    const rawPath = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
    const querySuffix = queryIndex >= 0 ? pathAndQuery.slice(queryIndex) : '';

    // Rewrite only path segments (`/.../<sessionId>/...`) and keep filename tokens intact.
    // Some assets (e.g. outro_focus_*_<sessionId>.png) include session id in filename.
    const segmentPattern = new RegExp(`(^|[\\\\/])${escapedOldSessionId}(?=([\\\\/]|$))`, 'g');
    const rewrittenPath = rawPath.replace(segmentPattern, `$1${newSessionId}`);
    return `${rewrittenPath}${querySuffix}${hashSuffix}`;
  };

  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }

    for (const key of Object.keys(value)) {
      const current = value[key];
      if (typeof current === 'string') {
        if (!current.includes(oldSessionId)) {
          continue;
        }
        const looksLikeLocalAsset =
          current.startsWith('/') ||
          current.startsWith('video/') ||
          current.startsWith('ai_video/') ||
          current.includes('/video/') ||
          current.includes('/ai_video/') ||
          current.includes('video/') ||
          current.includes('ai_video/');
        if (!looksLikeLocalAsset) {
          continue;
        }
        const rewritten = replaceSessionPathSegment(current);
        if (rewritten !== current) {
          value[key] = rewritten;
        }
      } else if (Array.isArray(current) || (current && typeof current === 'object')) {
        visit(current);
      }
    }
  };

  visit(sessionData);
}

function withNormalizedAssetPath(assetRelativePath, shouldHaveLeadingSlash) {
  if (!assetRelativePath || typeof assetRelativePath !== 'string') {
    return assetRelativePath;
  }

  const normalized = assetRelativePath.split(path.sep).join('/');
  if (shouldHaveLeadingSlash) {
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
  return normalized.replace(/^\//, '');
}

function findOutroLayerInfo(sessionData) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  if (layers.length === 0) {
    return null;
  }

  const outroImageUrlPath = typeof sessionData?.outroImageURL === 'string' ? sessionData.outroImageURL.trim() : '';

  const candidates = new Set();
  if (outroImageUrlPath) {
    candidates.add(outroImageUrlPath);
    candidates.add(outroImageUrlPath.startsWith('/') ? outroImageUrlPath.slice(1) : `/${outroImageUrlPath}`);
  }

  if (candidates.size > 0) {
    const foundIndex = layers.findIndex((layer) => {
      const activeItemList = layer?.imageSession?.activeItemList;
      if (!Array.isArray(activeItemList)) {
        return false;
      }
      return activeItemList.some((item) => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const src = typeof item.src === 'string' ? item.src.trim() : '';
        return src && candidates.has(src);
      });
    });

    if (foundIndex >= 0) {
      const layer = layers[foundIndex];
      return {
        index: foundIndex,
        layerId: layer?._id?.toString?.() ?? layer?._id ?? null,
      };
    }
  }

  const lastLayer = layers[layers.length - 1];
  return {
    index: layers.length - 1,
    layerId: lastLayer?._id?.toString?.() ?? lastLayer?._id ?? null,
  };
}

function resolveOutroOverlayConfig(activeItemList = []) {
  const overlay = {
    focus: null,
    focusItemIndex: -1,
    baseItemIndex: -1,
  };

  if (!Array.isArray(activeItemList)) {
    return overlay;
  }

  overlay.baseItemIndex = activeItemList.findIndex((item) => item?.type === 'image' && item?.is_base_image);
  if (overlay.baseItemIndex < 0) {
    overlay.baseItemIndex = activeItemList.findIndex((item) => item?.type === 'image');
  }

  overlay.focusItemIndex = activeItemList.findIndex((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    if (item.type !== 'image' || item.is_base_image) {
      return false;
    }
    const src = typeof item.src === 'string' ? item.src : '';
    return src.includes('outro_focus');
  });

  if (overlay.focusItemIndex >= 0) {
    const focusItem = activeItemList[overlay.focusItemIndex];
    overlay.focus = {
      x: typeof focusItem.x === 'number' ? focusItem.x : 0,
      y: typeof focusItem.y === 'number' ? focusItem.y : 0,
      width: typeof focusItem.width === 'number' ? focusItem.width : 0,
      height: typeof focusItem.height === 'number' ? focusItem.height : 0,
    };
  }

  return overlay;
}

async function writeFocusCrop({
  baseImagePath,
  focusArea,
  canvasDimensions,
  outroFolder,
  assetsRoot,
  newSessionId,
}) {
  if (!focusArea) {
    return null;
  }
  const { x, y, width, height } = focusArea;
  const hasInvalidNumber = [x, y, width, height].some(
    (value) => typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value),
  );
  if (hasInvalidNumber) {
    return null;
  }

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
  if (!isValidFocusArea) {
    return null;
  }

  await fsExtra.ensureDir(outroFolder);
  const focusFileName = `outro_focus_${Date.now()}_${newSessionId}.png`;
  const focusFilePath = path.join(outroFolder, focusFileName);

  await sharp(baseImagePath)
    .resize(canvasDimensions.width, canvasDimensions.height)
    .extract({
      left: focusX,
      top: focusY,
      width: focusWidth,
      height: focusHeight,
    })
    .png()
    .toFile(focusFilePath);

  return path
    .relative(assetsRoot, focusFilePath)
    .split(path.sep)
    .join('/');
}

async function downloadOutroImageToSession({
  outroImageUrl,
  newSessionId,
  assetsRoot,
  aspectRatio,
}) {
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio || '16:9');
  const outroFolder = path.join(assetsRoot, 'video', 'outro', newSessionId);
  await fsExtra.ensureDir(outroFolder);

  let extension = '.png';
  if (typeof outroImageUrl === 'string' && !outroImageUrl.startsWith('data:image')) {
    try {
      const parsedUrl = new URL(outroImageUrl);
      const extFromUrl = path.extname(parsedUrl.pathname);
      if (extFromUrl) {
        extension = extFromUrl;
      }
    } catch {
      // ignore URL parse errors; default extension stays
    }
  } else if (typeof outroImageUrl === 'string' && outroImageUrl.startsWith('data:image')) {
    const match = outroImageUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,/);
    if (match?.[1]) {
      extension = `.${match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()}`;
    }
  }

  const outroFileName = `outro${extension || '.png'}`;
  const outroFilePath = path.join(outroFolder, outroFileName);

  let imageBuffer;
  if (typeof outroImageUrl !== 'string') {
    const error = new Error('outro_image_url must be a string.');
    error.status = 400;
    throw error;
  }

  if (outroImageUrl.startsWith('data:image')) {
    const base64Data = outroImageUrl.replace(/^data:image\/\w+;base64,/, '');
    imageBuffer = Buffer.from(base64Data, 'base64');
  } else {
    const response = await axios.get(outroImageUrl, {
      responseType: 'arraybuffer',
      timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
    });
    imageBuffer = Buffer.from(response.data);
  }

  await fsExtra.writeFile(outroFilePath, imageBuffer);

  const metadata = await sharp(outroFilePath).metadata();
  const width = metadata.width;
  const height = metadata.height;

  if (!width || !height) {
    const error = new Error('Unable to determine dimensions for the outro image.');
    error.status = 400;
    throw error;
  }

  const requiredWidth = canvasDimensions.width;
  const requiredHeight = canvasDimensions.height;

  if (width < requiredWidth || height < requiredHeight) {
    const error = new Error(
      `Outro image must be at least ${requiredWidth}x${requiredHeight} for ${aspectRatio || '16:9'} generation.`,
    );
    error.status = 400;
    throw error;
  }

  if (width !== requiredWidth || height !== requiredHeight) {
    const cropLeft = Math.floor((width - requiredWidth) / 2);
    const cropTop = Math.floor((height - requiredHeight) / 2);
    const croppedBuffer = await sharp(outroFilePath)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: requiredWidth,
        height: requiredHeight,
      })
      .toBuffer();
    await fsExtra.writeFile(outroFilePath, croppedBuffer);
  }

  const outroAssetRelativePath = path
    .relative(assetsRoot, outroFilePath)
    .split(path.sep)
    .join('/');

  return {
    outroFilePath,
    outroAssetRelativePath,
    canvasDimensions,
    outroFolder,
  };
}

function resolveSessionDurationSeconds(sessionData = {}) {
  const totalDuration = Number(sessionData?.totalDuration);
  if (Number.isFinite(totalDuration) && totalDuration > 0) {
    return totalDuration;
  }

  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  if (!layers.length) {
    return 0;
  }

  const lastLayer = layers[layers.length - 1] || {};
  const lastOffset = Number(lastLayer.durationOffset) || 0;
  const lastDuration = Number(lastLayer.duration) || 0;
  const computedByOffset = lastOffset + lastDuration;
  if (Number.isFinite(computedByOffset) && computedByOffset > 0) {
    return computedByOffset;
  }

  const summed = layers.reduce((sum, layer) => sum + (Number(layer?.duration) || 0), 0);
  return Number.isFinite(summed) && summed > 0 ? summed : 0;
}

function getFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getOptionalBooleanPayloadValue(payload = {}, keys = [], fieldName, defaultValue) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      continue;
    }
    const value = payload[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'boolean') {
      const error = new Error(`${fieldName} must be a boolean.`);
      error.status = 400;
      throw error;
    }
    return value;
  }

  return defaultValue;
}

async function localizeOverlayText(originalText, languageCode) {
  const text = typeof originalText === 'string' ? originalText.trim() : '';
  if (!text) {
    return null;
  }

  const languageName = getLanguageStringFromLanguageCode(languageCode) || languageCode;
  const translated = await translateTextContent([text], languageName);
  const localized = Array.isArray(translated) && typeof translated[0] === 'string'
    ? translated[0].trim()
    : '';
  return localized || text;
}

function resolveSessionLanguageForStorage(sessionData = {}, fallbackLanguage = 'EN') {
  const candidate = getFirstNonEmptyString(
    sessionData.sessionLanguage,
    sessionData.language,
    sessionData.language_code,
    sessionData.langauge,
  );
  if (!candidate || candidate.toLowerCase() === 'auto') {
    return fallbackLanguage;
  }
  return candidate;
}

function getSessionLanguageString(sessionData = {}, sessionLanguage = null) {
  return getFirstNonEmptyString(sessionData.languageString) ||
    (sessionLanguage ? getLanguageStringFromLanguageCode(sessionLanguage) : null);
}

function shouldUseNarratorAvatar(sessionData = {}) {
  return sessionData?.addNarratorAvatar === true || sessionData?.add_narrator_avatar === true;
}

function resetNarratorAvatarVoiceoverForRetranslate(sessionData = {}) {
  if (!shouldUseNarratorAvatar(sessionData)) {
    return false;
  }

  sessionData.addNarratorAvatar = true;
  sessionData.add_narrator_avatar = true;
  sessionData.narratorAvatarGenerationSkipped = false;

  sessionData.narratorAvatarAudioStatus = 'INIT';
  sessionData.narratorAvatarAudioAssetPath = '';
  sessionData.narratorAvatarAudioUrl = '';
  sessionData.narratorAvatarAudioDuration = 0;
  sessionData.narratorAvatarSceneDurationSeconds = 0;
  sessionData.narratorAvatarSpeechSegments = [];
  sessionData.narratorAvatarAudioError = '';

  sessionData.narratorAvatarVideoTaskId = '';
  sessionData.narratorAvatarVideoStatus = 'INIT';
  sessionData.narratorAvatarVideoUrl = '';
  sessionData.narratorAvatarVideoAssetPath = '';
  sessionData.narratorAvatarVideoRunwayResponse = null;
  sessionData.narratorAvatarVideoError = '';

  return true;
}

function isSpeechAudioLayer(audioLayer = {}) {
  const rawType = audioLayer?.generationType;
  if (typeof rawType !== 'string') return false;
  return rawType.trim().toLowerCase() === 'speech';
}

function normalizePositiveNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function createNewObjectId() {
  return new Types.ObjectId();
}

function regenerateLayerAndAudioLayerIds(sessionData = {}) {
  const layerIdMap = new Map();
  const layerIdByIndex = new Map();
  const audioLayerIdMap = new Map();

  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  layers.forEach((layer, index) => {
    if (!layer || typeof layer !== 'object') {
      return;
    }
    const oldLayerId = layer?._id?.toString?.() ?? layer?._id ?? null;
    const newLayerId = createNewObjectId();

    if (oldLayerId) {
      layerIdMap.set(oldLayerId.toString(), newLayerId.toString());
    }

    layer._id = newLayerId;
    layerIdByIndex.set(index, newLayerId.toString());

    // Frames are always regenerated for translate_video requests.
    layer.frames = [];

    const activeItemList = layer?.imageSession?.activeItemList;
    if (Array.isArray(activeItemList)) {
      layer.imageSession.activeItemList = activeItemList.map((item) => {
        if (!item || typeof item !== 'object') {
          return item;
        }
        return { ...item, _id: createNewObjectId() };
      });
    }

    const filterPasses = layer?.filterPasses;
    if (Array.isArray(filterPasses)) {
      layer.filterPasses = filterPasses.map((pass) => {
        if (!pass || typeof pass !== 'object') {
          return pass;
        }
        return { ...pass, _id: createNewObjectId() };
      });
    }
  });

  const audioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];
  audioLayers.forEach((audioLayer) => {
    if (!audioLayer || typeof audioLayer !== 'object') {
      return;
    }
    const oldAudioLayerId = audioLayer?._id?.toString?.() ?? audioLayer?._id ?? null;
    const newAudioLayerId = createNewObjectId();
    if (oldAudioLayerId) {
      audioLayerIdMap.set(oldAudioLayerId.toString(), newAudioLayerId.toString());
    }
    audioLayer._id = newAudioLayerId;
  });

  audioLayers.forEach((audioLayer) => {
    if (!audioLayer || typeof audioLayer !== 'object') {
      return;
    }
    const rawConnectedLayerId = audioLayer.connectedLayerId?.toString?.() ?? audioLayer.connectedLayerId ?? null;
    const mappedById = rawConnectedLayerId ? layerIdMap.get(rawConnectedLayerId.toString()) : null;
    if (mappedById) {
      audioLayer.connectedLayerId = mappedById;
      return;
    }

    const connectedLayerIndexRaw = audioLayer.connectedLayerIndex;
    const connectedLayerIndex = typeof connectedLayerIndexRaw === 'number'
      ? connectedLayerIndexRaw
      : typeof connectedLayerIndexRaw === 'string' && connectedLayerIndexRaw.trim()
        ? Number.parseInt(connectedLayerIndexRaw.trim(), 10)
        : null;

    if (Number.isFinite(connectedLayerIndex) && layerIdByIndex.has(connectedLayerIndex)) {
      audioLayer.connectedLayerId = layerIdByIndex.get(connectedLayerIndex);
    }
  });

  sessionData.layers = layers;
  sessionData.audioLayers = audioLayers;

  return {
    layerIdMap,
    audioLayerIdMap,
  };
}

function resolveDefaultSceneDurationSeconds(session = {}) {
  return normalizePositiveNumber(session?.defaultSceneDuration) ?? 2;
}

function getMovieResourceList(session = {}) {
  const resourceList = session?.movieResourceList;
  if (!resourceList || typeof resourceList !== 'object') {
    return null;
  }
  return resourceList;
}

function resetTimelineDurationsFromMovieResourceList(sessionData = {}) {
  const movieResourceList = getMovieResourceList(sessionData);
  const scenes = Array.isArray(movieResourceList?.scenes) ? movieResourceList.scenes : null;
  if (!scenes || scenes.length === 0) {
    const error = new Error('Session is missing movieResourceList scenes; cannot reset durations for translation.');
    error.status = 400;
    throw error;
  }

  const defaultSceneDuration = resolveDefaultSceneDurationSeconds(sessionData);
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  if (layers.length === 0) {
    const error = new Error('Session has no layers to translate.');
    error.status = 400;
    throw error;
  }

  let durationOffset = 0;
  const layerIndexById = new Map();
  layers.forEach((layer, idx) => {
    const layerId = layer?._id?.toString?.() ?? layer?._id ?? null;
    if (layerId) {
      layerIndexById.set(layerId.toString(), idx);
    }
  });

  layers.forEach((layer, idx) => {
    if (!layer || typeof layer !== 'object') {
      return;
    }

    const scene = idx < scenes.length ? scenes[idx] : null;
    const sceneDuration = normalizePositiveNumber(scene?.duration) ?? defaultSceneDuration;

    if (idx < scenes.length) {
      layer.duration = sceneDuration;
    } else {
      const existingDuration = normalizePositiveNumber(layer.duration);
      layer.duration = existingDuration ?? defaultSceneDuration;
    }

    layer.durationOffset = durationOffset;
    durationOffset += layer.duration;
  });

  const sounds = Array.isArray(movieResourceList?.sounds) ? movieResourceList.sounds : [];
  const speechSounds = sounds.filter((sound) => sound && typeof sound === 'object' && sound.type !== 'sound_effect');

  const audioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];
  let speechLayerFallbackIndex = 0;
  audioLayers.forEach((audioLayer) => {
    if (!audioLayer || typeof audioLayer !== 'object') {
      return;
    }
    if (!isSpeechAudioLayer(audioLayer)) {
      return;
    }

    const connectedLayerId = audioLayer.connectedLayerId?.toString?.() ?? audioLayer.connectedLayerId ?? null;
    const connectedLayerIndex = typeof audioLayer.connectedLayerIndex === 'number'
      ? audioLayer.connectedLayerIndex
      : connectedLayerId
        ? layerIndexById.get(connectedLayerId.toString())
        : undefined;

    const resolvedLayerIndex = typeof connectedLayerIndex === 'number'
      ? connectedLayerIndex
      : speechLayerFallbackIndex;
    const connectedLayer = layers[resolvedLayerIndex];
    if (!connectedLayer) {
      return;
    }

    const soundIndex = typeof audioLayer.connectedLayerIndex === 'number' ? audioLayer.connectedLayerIndex : resolvedLayerIndex;
    const sound = speechSounds[soundIndex];

    const duration = normalizePositiveNumber(sound?.duration)
      ?? normalizePositiveNumber(connectedLayer.duration)
      ?? defaultSceneDuration;

    audioLayer.duration = duration;
    audioLayer.connectedLayerStartTimeOffset = 0;
    audioLayer.startTime = connectedLayer.durationOffset;
    audioLayer.endTime = connectedLayer.durationOffset + duration;

    speechLayerFallbackIndex += 1;
  });

  sessionData.layers = layers;
  sessionData.audioLayers = audioLayers;
  sessionData.totalDuration = durationOffset;
}

function getSpeechTextFromAudioLayer(audioLayer = {}) {
  if (!audioLayer || typeof audioLayer !== 'object') {
    return '';
  }
  return getFirstNonEmptyString(
    audioLayer.speechText,
    audioLayer.prompt,
    audioLayer.transcriptText,
    audioLayer.transcript,
    audioLayer.instructions,
  ) || '';
}

function getSpeakerNameFromAudioLayer(audioLayer = {}) {
  if (!audioLayer || typeof audioLayer !== 'object') {
    return '';
  }
  return getFirstNonEmptyString(audioLayer.speakerCharacterName) || '';
}

async function translateSpeechTextList(speechTextList, translationLanguageName) {
  const normalizedLanguageName = typeof translationLanguageName === 'string' && translationLanguageName.trim()
    ? translationLanguageName.trim()
    : 'English';

  const entries = speechTextList
    .map((text, idx) => ({ idx, text: typeof text === 'string' ? text : '' }))
    .filter((entry) => entry.text.trim().length > 0);

  const translationsByIndex = new Map();
  const batchSize = 12;

  for (let start = 0; start < entries.length; start += batchSize) {
    const batch = entries.slice(start, start + batchSize);
    const batchTexts = batch.map((entry) => entry.text);
    let batchTranslations = await translateTextContent(batchTexts, normalizedLanguageName);

    if (!Array.isArray(batchTranslations) || batchTranslations.length !== batchTexts.length) {
      batchTranslations = [];
      for (let i = 0; i < batchTexts.length; i += 1) {
        const line = batchTexts[i];
        try {
          const single = await translateTextContent([line], normalizedLanguageName);
          batchTranslations.push(Array.isArray(single) && single[0] ? single[0] : line);
        } catch {
          batchTranslations.push(line);
        }
      }
    }

    if (batchTranslations.length !== batchTexts.length) {
      const error = new Error('OpenAI translation returned unexpected number of lines.');
      error.status = 502;
      throw error;
    }

    batch.forEach((entry, offset) => {
      translationsByIndex.set(entry.idx, batchTranslations[offset]);
    });
  }

  return speechTextList.map((text, idx) => {
    if (typeof text !== 'string') {
      return text;
    }
    if (!text.trim()) {
      return text;
    }
    return translationsByIndex.get(idx) || text;
  });
}

function applyTranslatedSpeechTextToSession(clonedSession = {}, translatedSpeechTextList = []) {
  const audioLayers = Array.isArray(clonedSession.audioLayers) ? clonedSession.audioLayers : [];
  let speechIndex = 0;

  audioLayers.forEach((audioLayer) => {
    if (!audioLayer || typeof audioLayer !== 'object') {
      return;
    }
    if (!isSpeechAudioLayer(audioLayer)) {
      return;
    }

    const translatedTextRaw = translatedSpeechTextList[speechIndex];
    const translatedText = typeof translatedTextRaw === 'string' ? translatedTextRaw.trim() : '';
    if (translatedText) {
      audioLayer.prompt = translatedText;
      audioLayer.speechText = translatedText;
      audioLayer.transcriptText = translatedText;
    }

    speechIndex += 1;
  });

  clonedSession.audioLayers = audioLayers;
}

function applyTranslatedSpeakerNamesToSession(clonedSession = {}, translatedSpeakerNameList = []) {
  const audioLayers = Array.isArray(clonedSession.audioLayers) ? clonedSession.audioLayers : [];
  let speechIndex = 0;

  audioLayers.forEach((audioLayer) => {
    if (!audioLayer || typeof audioLayer !== 'object') {
      return;
    }
    if (!isSpeechAudioLayer(audioLayer)) {
      return;
    }

    const translatedNameRaw = translatedSpeakerNameList[speechIndex];
    const translatedName = typeof translatedNameRaw === 'string' ? translatedNameRaw.trim() : '';
    if (translatedName) {
      audioLayer.speakerCharacterName = translatedName;
    }

    speechIndex += 1;
  });

  clonedSession.audioLayers = audioLayers;
}

function resolveOutroImageMetadataFromSession(sessionData = {}) {
  const explicitMetadata = normalizeOutroImageMetadata(sessionData.outroImageMetadata);
  if (explicitMetadata) {
    return explicitMetadata;
  }

  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const outroLayerInfo = findOutroLayerInfo(sessionData);
  const layerMetadata = outroLayerInfo
    ? normalizeOutroImageMetadata(layers[outroLayerInfo.index]?.outroImageMetadata)
    : null;
  if (layerMetadata) {
    return layerMetadata;
  }

  return buildOutroImageMetadata({
    generated: sessionData.generatedOutroImage === true,
    assetPath: getFirstNonEmptyString(sessionData.outroImageURL),
    ctaUrl: getFirstNonEmptyString(sessionData.outroCtaUrl, sessionData.ctaUrl, sessionData.cta_url),
    ctaTextTop: getFirstNonEmptyString(sessionData.outroCtaTextTop, sessionData.ctaTextTop, sessionData.cta_text_top),
    ctaTextBottom: getFirstNonEmptyString(sessionData.outroCtaTextBottom, sessionData.ctaTextBottom, sessionData.cta_text_bottom),
    ctaLogo: getFirstNonEmptyString(sessionData.outroCtaLogo, sessionData.ctaLogo, sessionData.cta_logo),
  });
}

function replaceOutroCtaTextItems(outroLayer, outroMetadata, aspectRatio = '16:9') {
  const activeItemList = outroLayer?.imageSession?.activeItemList;
  if (!Array.isArray(activeItemList)) {
    return;
  }

  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio || '16:9');
  const existingWithoutCtaText = activeItemList.filter((item) => {
    if (!item || typeof item !== 'object') {
      return true;
    }
    if (item.isOutroCtaText === true) {
      return false;
    }
    return !(item.type === 'text' && item.subType !== 'subtitle');
  });
  const ctaItems = createOutroCtaTextItems({
    canvasDimensions,
    ctaTextTop: outroMetadata?.topText || null,
    ctaTextBottom: outroMetadata?.bottomText || null,
    startIndex: existingWithoutCtaText.length,
  });

  const qrIndex = existingWithoutCtaText.findIndex((item) => item?.image === 'server_generated_outro_qr');
  if (qrIndex >= 0) {
    existingWithoutCtaText.splice(qrIndex, 0, ...ctaItems);
  } else {
    existingWithoutCtaText.push(...ctaItems);
  }

  outroLayer.imageSession.activeItemList = existingWithoutCtaText;
}

async function localizeOutroImageMetadataForSession({
  clonedSession,
  normalizedLanguageCode,
}) {
  const outroMetadata = resolveOutroImageMetadataFromSession(clonedSession);
  if (!outroMetadata) {
    return;
  }

  let changed = false;
  const nextMetadata = { ...outroMetadata };
  if (outroMetadata.topText) {
    nextMetadata.topText = await localizeOverlayText(outroMetadata.topText, normalizedLanguageCode);
    changed = changed || nextMetadata.topText !== outroMetadata.topText;
  }
  if (outroMetadata.bottomText) {
    nextMetadata.bottomText = await localizeOverlayText(outroMetadata.bottomText, normalizedLanguageCode);
    changed = changed || nextMetadata.bottomText !== outroMetadata.bottomText;
  }

  if (!changed && !outroMetadata.topText && !outroMetadata.bottomText) {
    return;
  }

  clonedSession.outroImageMetadata = nextMetadata;

  const outroLayerInfo = (clonedSession?.hasOutroImage || clonedSession?.outroImageURL)
    ? findOutroLayerInfo(clonedSession)
    : null;
  if (!outroLayerInfo) {
    return;
  }

  const layers = Array.isArray(clonedSession.layers) ? clonedSession.layers : [];
  const outroLayer = layers[outroLayerInfo.index];
  if (!outroLayer || typeof outroLayer !== 'object') {
    return;
  }

  outroLayer.outroImageMetadata = nextMetadata;
  replaceOutroCtaTextItems(outroLayer, nextMetadata, clonedSession.aspectRatio || '16:9');
  layers[outroLayerInfo.index] = outroLayer;
  clonedSession.layers = layers;
}

async function localizeFooterMetadataForSession({
  clonedSession,
  normalizedLanguageCode,
}) {
  const layers = Array.isArray(clonedSession.layers) ? clonedSession.layers : [];
  if (!layers.some((layer) => layer?.addFooterAnimation === true)) {
    return;
  }

  const rootFooterMetadata = Array.isArray(clonedSession.footerMetadata)
    ? clonedSession.footerMetadata.map((item) => normalizeFooterMetadataItem(item))
    : [];
  const localizedTextCache = new Map();
  const getLocalizedText = async (text) => {
    const normalized = typeof text === 'string' ? text.trim() : '';
    if (!normalized) {
      return null;
    }
    if (!localizedTextCache.has(normalized)) {
      localizedTextCache.set(normalized, await localizeOverlayText(normalized, normalizedLanguageCode));
    }
    return localizedTextCache.get(normalized);
  };

  const nextFooterMetadataList = [];
  let footerLayerIndex = -1;
  const nextLayers = [];

  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || layer.addFooterAnimation !== true) {
      nextLayers.push(layer);
      continue;
    }

    footerLayerIndex += 1;
    const footerMetadata = normalizeFooterMetadataItem(
      layer.footerMetadata ??
      layer.footer_metadata ??
      rootFooterMetadata[footerLayerIndex] ??
      rootFooterMetadata[0],
    );
    if (!footerMetadata) {
      nextLayers.push(layer);
      continue;
    }

    const localizedCtaText = await getLocalizedText(footerMetadata.ctaText || footerMetadata.title);
    const nextFooterMetadata = localizedCtaText
      ? { ...footerMetadata, title: localizedCtaText, ctaText: localizedCtaText }
      : footerMetadata;

    layer.footerMetadata = nextFooterMetadata;
    nextFooterMetadataList.push(nextFooterMetadata);
    nextLayers.push(layer);
  }

  clonedSession.layers = nextLayers;

  if (nextFooterMetadataList.length > 0) {
    clonedSession.addFooterAnimation = true;
    clonedSession.footerMetadata = nextFooterMetadataList;
    if (nextFooterMetadataList[0]?.ctaText) {
      clonedSession.footerCtaText = nextFooterMetadataList[0].ctaText;
    }
  }
}

function stripTextItemsFromActiveItemLists(sessionData = {}) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];

  layers.forEach((layer) => {
    const activeItemList = layer?.imageSession?.activeItemList;
    if (!Array.isArray(activeItemList) || activeItemList.length === 0) {
      return;
    }

    layer.imageSession.activeItemList = activeItemList.filter((item) => {
      const rawType = item?.type;
      if (typeof rawType !== 'string') {
        return true;
      }
      if (rawType.trim().toLowerCase() !== 'text') {
        return true;
      }
      return item?.subType !== 'subtitle';
    });
  });

  sessionData.layers = layers;
}

async function applyOutroImageOverrideToSession({ clonedSession, outroImageUrl, newSessionId, assetsRoot }) {
  const normalizedOutroUrl = typeof outroImageUrl === 'string' ? outroImageUrl.trim() : '';
  if (!normalizedOutroUrl) {
    return;
  }

  if (!clonedSession?.hasOutroImage && !clonedSession?.outroImageURL) {
    const error = new Error('Session does not have an outro image to update.');
    error.status = 400;
    throw error;
  }

  const outroLayerInfo = findOutroLayerInfo(clonedSession);
  if (!outroLayerInfo) {
    const error = new Error('Unable to locate outro layer for the provided session.');
    error.status = 400;
    throw error;
  }

  const layers = Array.isArray(clonedSession.layers) ? clonedSession.layers : [];
  const outroLayer = layers[outroLayerInfo.index];
  if (!outroLayer?.imageSession?.activeItemList || !Array.isArray(outroLayer.imageSession.activeItemList)) {
    const error = new Error('Outro layer is missing activeItemList data.');
    error.status = 400;
    throw error;
  }

  const aspectRatio = typeof clonedSession?.aspectRatio === 'string' && clonedSession.aspectRatio.trim()
    ? clonedSession.aspectRatio.trim()
    : '16:9';

  const { outroAssetRelativePath, canvasDimensions, outroFolder, outroFilePath } = await downloadOutroImageToSession({
    outroImageUrl: normalizedOutroUrl,
    newSessionId,
    assetsRoot,
    aspectRatio,
  });

  const originalOutroImageField = typeof clonedSession?.outroImageURL === 'string' ? clonedSession.outroImageURL : '';
  const outroFieldHasLeadingSlash = originalOutroImageField.startsWith('/');
  clonedSession.outroImageURL = withNormalizedAssetPath(outroAssetRelativePath, outroFieldHasLeadingSlash);
  clonedSession.hasOutroImage = true;

  const activeItemList = outroLayer.imageSession.activeItemList;
  const overlay = resolveOutroOverlayConfig(activeItemList);
  if (overlay.baseItemIndex < 0) {
    const error = new Error('Outro layer does not include a base image item.');
    error.status = 400;
    throw error;
  }

  const baseItem = activeItemList[overlay.baseItemIndex];
  const baseSrcHasLeadingSlash = typeof baseItem?.src === 'string' && baseItem.src.startsWith('/');
  activeItemList[overlay.baseItemIndex] = {
    ...baseItem,
    image: normalizedOutroUrl,
    src: withNormalizedAssetPath(outroAssetRelativePath, baseSrcHasLeadingSlash),
  };

  if (overlay.focus && overlay.focusItemIndex >= 0) {
    const newFocusRelativePath = await writeFocusCrop({
      baseImagePath: outroFilePath,
      focusArea: overlay.focus,
      canvasDimensions,
      outroFolder,
      assetsRoot,
      newSessionId,
    });

    if (newFocusRelativePath) {
      const focusItem = activeItemList[overlay.focusItemIndex];
      const focusSrcHasLeadingSlash = typeof focusItem?.src === 'string' && focusItem.src.startsWith('/');
      activeItemList[overlay.focusItemIndex] = {
        ...focusItem,
        src: withNormalizedAssetPath(newFocusRelativePath, focusSrcHasLeadingSlash),
      };
    }
  }

  outroLayer.imageSession.activeItemList = activeItemList;
  layers[outroLayerInfo.index] = outroLayer;
  clonedSession.layers = layers;
}

function prepareSessionForTranslate({
  clonedSession,
  normalizedLanguageCode,
  enableSubtitles,
}) {
  const shouldEnableSubtitles = enableSubtitles === true;
  const shouldRegenerateNarratorAvatar = resetNarratorAvatarVoiceoverForRetranslate(clonedSession);

  clonedSession.videoLink = null;
  clonedSession.remoteURL = null;
  clonedSession.videoGenerationPending = false;
  clonedSession.frameGenerationPending = false;
  clonedSession.expressGenerationPending = true;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationError = null;
  clonedSession.provisionalCredits = 0;
  clonedSession.isExpressGeneration = true;
  clonedSession.expressGenerativeVideoRequired = false;
  // Duration normalization should happen via the usual lip sync flow (not via speech generation).
  clonedSession.setAutoDurationPerScene = false;

  clonedSession.sessionLanguage = normalizedLanguageCode;
  clonedSession.language = normalizedLanguageCode;
  clonedSession.languageString = getLanguageStringFromLanguageCode(normalizedLanguageCode);
  clonedSession.enableSubtitles = shouldEnableSubtitles;
  clonedSession.hasSubtitles = shouldEnableSubtitles;
  clonedSession.has_subtitles = shouldEnableSubtitles;

  clonedSession.layers = (clonedSession.layers || []).map((layer) => {
    if (!layer || typeof layer !== 'object') {
      return layer;
    }

    const layerBaseType = typeof layer.layerBaseAiImageType === 'string'
      ? layer.layerBaseAiImageType.trim().toLowerCase()
      : '';
    const layerType = typeof layer.layerAiVideoType === 'string'
      ? layer.layerAiVideoType.trim().toLowerCase()
      : '';
    const isCharacterLayer = layerBaseType === 'character' || layerType === 'character';
    const hasReusableBaseAiVideo = Boolean(
      layer.hasAiVideoLayer ||
      layer.aiVideoLayer ||
      layer.aiVideoRemoteLink
    );
    if (isCharacterLayer) {
      layer.layerAiVideoType = 'character';
      if (hasReusableBaseAiVideo) {
        layer.hasAiVideoLayer = true;
      }
    }

    layer.frameGenerationPending = true;
    layer.aiVideoGenerationPending = false;
    layer.soundEffectGenerationPending = false;
    layer.aiVideoFrameGenerationPending = false;

    const requiresLipSync = isCharacterLayer && hasReusableBaseAiVideo;
    layer.lipSyncGenerationPending = Boolean(requiresLipSync);

    if (requiresLipSync) {
      layer.hasLipSyncVideoLayer = false;
      layer.lipSyncVideoLayer = null;
      layer.lipSyncRemoteLink = null;
      layer.lipSyncVideoGenerationStatus = 'INIT';
    } else {
      layer.lipSyncGenerationPending = false;
      if (layer.lipSyncVideoGenerationStatus === 'PENDING') {
        layer.lipSyncVideoGenerationStatus = 'COMPLETED';
      }
    }

    const imageSession = layer.imageSession;
    if (imageSession && typeof imageSession === 'object') {
      imageSession.generationStatus = 'COMPLETED';
      if (imageSession.editStatus !== 'INIT' && imageSession.editStatus !== 'COMPLETED') {
        imageSession.editStatus = 'COMPLETED';
      }
    }

    const aiStatus = layer.aiVideoGenerationStatus;
    if (aiStatus && aiStatus !== 'COMPLETED' && aiStatus !== 'FAILED') {
      layer.aiVideoGenerationStatus = 'COMPLETED';
    }

    return layer;
  });

  const audioLayers = Array.isArray(clonedSession.audioLayers) ? clonedSession.audioLayers : [];
  let hasPendingSpeechLayers = false;

  clonedSession.audioLayers = audioLayers.map((audioLayer) => {
    if (!audioLayer || typeof audioLayer !== 'object') {
      return audioLayer;
    }

    const isSpeech = isSpeechAudioLayer(audioLayer);
    if (!isSpeech) {
      if (audioLayer.generationStatus === 'PENDING') {
        audioLayer.generationStatus = 'COMPLETED';
      }
      if (audioLayer.streamDownloadPending === true) {
        audioLayer.streamDownloadPending = false;
      }
      return audioLayer;
    }

    audioLayer.generationStatus = 'PENDING';
    audioLayer.generationError = null;
    audioLayer.streamDownloadPending = false;
    audioLayer.streamCreatedAt = null;
    audioLayer.audioLink = null;
    audioLayer.localAudioLinks = [];
    audioLayer.remoteAudioLinks = [];
    audioLayer.remoteAudioData = [];
    audioLayer.selectedLocalAudioLink = null;
    audioLayer.selectedRemoteAudioLink = null;
    audioLayer.connectedLayerStartTimeOffset = 0;
    audioLayer.previousAudioData = null;
    // Ensure the audio generator marks this as the chosen variant so lip sync can run.
    audioLayer.defaultSelected = true;
    audioLayer.addSubtitles = shouldEnableSubtitles;
    audioLayer.addTranscriptionsRequired = shouldEnableSubtitles;

    hasPendingSpeechLayers = true;
    return audioLayer;
  });

  clonedSession.audioGenerationPending = hasPendingSpeechLayers;
  clonedSession.transcriptGenerationPending = shouldEnableSubtitles;

  const status = { ...(clonedSession.expressGenerationStatus || {}) };
  const allStatusKeys = new Set([
    ...Object.keys(status),
    'prompt_generation',
    'image_generation',
    'audio_generation',
    'frame_generation',
    'video_generation',
    'ai_video_generation',
    'speech_generation',
    'music_generation',
    'delete_reflow',
    'timeline_reflowed',
    'lip_sync_generation',
    'sound_effect_generation',
    'transcript_generation',
    'narrator_avatar_generation',
  ]);

  for (const key of allStatusKeys) {
    status[key] = 'COMPLETED';
  }

  status.audio_generation = hasPendingSpeechLayers ? 'PENDING' : 'COMPLETED';
  status.speech_generation = hasPendingSpeechLayers ? 'PENDING' : 'COMPLETED';
  status.music_generation = 'COMPLETED';
  status.ai_video_generation = 'COMPLETED';
  status.sound_effect_generation = 'COMPLETED';
  status.delete_reflow = 'INIT';
  status.timeline_reflowed = 'INIT';

  status.lip_sync_generation = 'INIT';
  status.narrator_avatar_generation = shouldRegenerateNarratorAvatar ? 'INIT' : 'COMPLETED';
  status.transcript_generation = shouldEnableSubtitles ? 'INIT' : 'COMPLETED';
  status.frame_generation = 'INIT';
  status.video_generation = 'INIT';

  clonedSession.expressGenerationStatus = status;
}

function prepareSessionForSubtitleRemoval({
  clonedSession,
  webhookUrl,
}) {
  clonedSession.videoLink = null;
  clonedSession.remoteURL = null;
  clonedSession.videoGenerationPending = false;
  clonedSession.frameGenerationPending = true;
  clonedSession.audioGenerationPending = false;
  clonedSession.transcriptGenerationPending = false;
  clonedSession.maskGenerationPending = false;
  clonedSession.sessionMessageGenerationPending = false;
  clonedSession.aiVideoGenerationPending = false;
  clonedSession.lipSyncGenerationPending = false;
  // Ensure the express listener does not pick this up before layer flags are updated.
  clonedSession.expressGenerationPending = false;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationError = null;
  clonedSession.provisionalCredits = 0;
  clonedSession.isExpressGeneration = true;
  clonedSession.expressGenerativeVideoRequired = false;
  clonedSession.expressGenerativeSpeechRequired = false;
  clonedSession.enableSubtitles = false;
  clonedSession.hasSubtitles = false;
  clonedSession.has_subtitles = false;

  if (webhookUrl) {
    clonedSession.externalWebhook = webhookUrl;
  }

  clonedSession.layers = (clonedSession.layers || []).map((layer) => {
    if (!layer || typeof layer !== 'object') {
      return layer;
    }

    layer.frameGenerationPending = true;
    layer.aiVideoFrameGenerationPending = false;
    layer.frames = [];
    layer.aiVideoGenerationPending = false;
    layer.lipSyncGenerationPending = false;
    layer.soundEffectGenerationPending = false;

    const imageSession = layer.imageSession;
    if (imageSession && typeof imageSession === 'object') {
      imageSession.generationStatus = 'COMPLETED';
      if (imageSession.editStatus !== 'INIT' && imageSession.editStatus !== 'COMPLETED') {
        imageSession.editStatus = 'COMPLETED';
      }
    }

    const aiStatus = layer.aiVideoGenerationStatus;
    if (aiStatus && aiStatus !== 'COMPLETED' && aiStatus !== 'FAILED') {
      layer.aiVideoGenerationStatus = 'COMPLETED';
    }

    const lipSyncStatus = layer.lipSyncVideoGenerationStatus;
    if (lipSyncStatus && lipSyncStatus !== 'COMPLETED' && lipSyncStatus !== 'FAILED') {
      layer.lipSyncVideoGenerationStatus = 'COMPLETED';
    }

    const soundEffectStatus = layer.soundEffectVideoGenerationStatus;
    if (soundEffectStatus && soundEffectStatus !== 'COMPLETED' && soundEffectStatus !== 'FAILED') {
      layer.soundEffectVideoGenerationStatus = 'COMPLETED';
    }

    return layer;
  });

  clonedSession.audioLayers = (clonedSession.audioLayers || []).map((audioLayer) => {
    if (!audioLayer || typeof audioLayer !== 'object') {
      return audioLayer;
    }
    if (audioLayer.generationStatus !== 'COMPLETED') {
      audioLayer.generationStatus = 'COMPLETED';
      if (audioLayer.generationError) {
        audioLayer.generationError = null;
      }
    }
    if (audioLayer.streamDownloadPending === true) {
      audioLayer.streamDownloadPending = false;
    }
    return audioLayer;
  });

  clonedSession.expressGenerationStatus = buildRemoveSubtitlesExpressGenerationStatus(
    clonedSession.expressGenerationStatus,
  );
}

function buildRemoveSubtitlesExpressGenerationStatus(existingStatus = {}) {
  const status = { ...(existingStatus || {}) };
  const allStatusKeys = new Set([
    ...Object.keys(status),
    'prompt_generation',
    'image_generation',
    'audio_generation',
    'frame_generation',
    'video_generation',
    'ai_video_generation',
    'speech_generation',
    'music_generation',
    'delete_reflow',
    'timeline_reflowed',
    'lip_sync_generation',
    'sound_effect_generation',
    'transcript_generation',
    'narrator_avatar_generation',
  ]);

  for (const key of allStatusKeys) {
    status[key] = 'COMPLETED';
  }

  // Match "no transcription" semantics used by other API entry points.
  status.audio_generation = 'COMPLETED';
  status.speech_generation = 'COMPLETED';
  status.transcript_generation = 'COMPLETED';
  status.narrator_avatar_generation = 'COMPLETED';
  status.frame_generation = 'INIT';
  status.video_generation = 'INIT';

  return status;
}

function buildAddSubtitlesExpressGenerationStatus(existingStatus = {}) {
  const status = buildRemoveSubtitlesExpressGenerationStatus(existingStatus);
  status.transcript_generation = 'INIT';
  status.frame_generation = 'INIT';
  status.video_generation = 'INIT';
  return status;
}

function prepareSessionForSubtitleAddition({
  clonedSession,
  webhookUrl,
}) {
  clonedSession.videoLink = null;
  clonedSession.remoteURL = null;
  clonedSession.videoGenerationPending = false;
  clonedSession.frameGenerationPending = true;
  clonedSession.audioGenerationPending = false;
  clonedSession.transcriptGenerationPending = true;
  clonedSession.maskGenerationPending = false;
  clonedSession.sessionMessageGenerationPending = false;
  clonedSession.aiVideoGenerationPending = false;
  clonedSession.lipSyncGenerationPending = false;
  clonedSession.expressGenerationPending = false;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationError = null;
  clonedSession.provisionalCredits = 0;
  clonedSession.isExpressGeneration = true;
  clonedSession.expressGenerativeVideoRequired = false;
  clonedSession.expressGenerativeSpeechRequired = false;
  clonedSession.enableSubtitles = true;
  clonedSession.hasSubtitles = true;
  clonedSession.has_subtitles = true;

  if (webhookUrl) {
    clonedSession.externalWebhook = webhookUrl;
  }

  clonedSession.layers = (clonedSession.layers || []).map((layer) => {
    if (!layer || typeof layer !== 'object') {
      return layer;
    }

    layer.frameGenerationPending = true;
    layer.aiVideoFrameGenerationPending = false;
    layer.frames = [];
    layer.aiVideoGenerationPending = false;
    layer.lipSyncGenerationPending = false;
    layer.soundEffectGenerationPending = false;

    const imageSession = layer.imageSession;
    if (imageSession && typeof imageSession === 'object') {
      imageSession.generationStatus = 'COMPLETED';
      if (imageSession.editStatus !== 'INIT' && imageSession.editStatus !== 'COMPLETED') {
        imageSession.editStatus = 'COMPLETED';
      }
    }

    const aiStatus = layer.aiVideoGenerationStatus;
    if (aiStatus && aiStatus !== 'COMPLETED' && aiStatus !== 'FAILED') {
      layer.aiVideoGenerationStatus = 'COMPLETED';
    }

    const lipSyncStatus = layer.lipSyncVideoGenerationStatus;
    if (lipSyncStatus && lipSyncStatus !== 'COMPLETED' && lipSyncStatus !== 'FAILED') {
      layer.lipSyncVideoGenerationStatus = 'COMPLETED';
    }

    const soundEffectStatus = layer.soundEffectVideoGenerationStatus;
    if (soundEffectStatus && soundEffectStatus !== 'COMPLETED' && soundEffectStatus !== 'FAILED') {
      layer.soundEffectVideoGenerationStatus = 'COMPLETED';
    }

    return layer;
  });

  clonedSession.audioLayers = (clonedSession.audioLayers || []).map((audioLayer) => {
    if (!audioLayer || typeof audioLayer !== 'object') {
      return audioLayer;
    }
    if (audioLayer.generationStatus !== 'COMPLETED') {
      audioLayer.generationStatus = 'COMPLETED';
      if (audioLayer.generationError) {
        audioLayer.generationError = null;
      }
    }
    if (audioLayer.streamDownloadPending === true) {
      audioLayer.streamDownloadPending = false;
    }
    return audioLayer;
  });

  clonedSession.expressGenerationStatus = buildAddSubtitlesExpressGenerationStatus(
    clonedSession.expressGenerationStatus,
  );
}

async function processTranslateVideoSessionJob({
  userId,
  oldSessionId,
  newSessionId,
  normalizedLanguageCode,
  enableSubtitles,
  translateOutro,
  translateFooter,
  webhookUrl,
}) {
  await getDBConnectionString();

  const originalSessionDoc = await VideoSession.findOne({ _id: oldSessionId, userId: userId.toString() });

  if (!originalSessionDoc) {
    throw new Error('Video session not found for translation.');
  }

  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });

  const originalSpeechLayers = Array.isArray(originalSessionData?.audioLayers)
    ? originalSessionData.audioLayers.filter(isSpeechAudioLayer)
    : [];

  if (!originalSpeechLayers.length) {
    throw new Error('Session does not contain any speech audio layers to translate.');
  }

  const originalSpeechTextList = originalSpeechLayers.map(getSpeechTextFromAudioLayer);
  const originalSpeakerNameList = originalSpeechLayers.map(getSpeakerNameFromAudioLayer);
  const translationLanguageName = getLanguageStringFromLanguageCode(normalizedLanguageCode) || normalizedLanguageCode;
  const translatedSpeechTextList = await translateSpeechTextList(originalSpeechTextList, translationLanguageName);
  let translatedSpeakerNameList = originalSpeakerNameList;
  try {
    translatedSpeakerNameList = await translateSpeechTextList(originalSpeakerNameList, translationLanguageName);
  } catch (error) {
    console.error('[api][video][translate_video] failed to translate speaker names; using originals', {
      newSessionId,
      originalSessionId: oldSessionId,
      language: normalizedLanguageCode,
      error: error?.message || error,
    });
  }

  const assetsRoot = resolveAssetsRoot();
  await copySessionAssetDirectories({ assetsRoot, oldSessionId, newSessionId });

  // NOTE: Do not use structuredClone here - it can serialize BSON ObjectIds into
  // `{ buffer: Uint8Array(...) }` shapes which Mongoose cannot cast back when saving.
  // JSON serialization converts ObjectIds to hex strings which Mongoose can cast.
  const clonedSession = JSON.parse(JSON.stringify(originalSessionData));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  rewriteSessionAssetReferences(clonedSession, oldSessionId, newSessionId);
  regenerateLayerAndAudioLayerIds(clonedSession);
  resetTimelineDurationsFromMovieResourceList(clonedSession);

  if (webhookUrl) {
    clonedSession.externalWebhook = webhookUrl;
  }

  applyTranslatedSpeechTextToSession(clonedSession, translatedSpeechTextList);
  applyTranslatedSpeakerNamesToSession(clonedSession, translatedSpeakerNameList);
  stripTextItemsFromActiveItemLists(clonedSession);

  if (translateOutro === true) {
    await localizeOutroImageMetadataForSession({
      clonedSession,
      normalizedLanguageCode,
    });
  }
  if (translateFooter === true) {
    await localizeFooterMetadataForSession({
      clonedSession,
      normalizedLanguageCode,
    });
  }

  prepareSessionForTranslate({
    clonedSession,
    normalizedLanguageCode,
    enableSubtitles,
  });

  try {
  } catch (error) {
    console.error('[api][video][translate_video] failed to stringify new session state', {
      newSessionId,
      originalSessionId: oldSessionId,
      language: normalizedLanguageCode,
      error: error?.message || error,
    });
  }

  await VideoSession.updateOne({ _id: newSessionId }, { $set: clonedSession });

  const speechGenerationRequests = (clonedSession.audioLayers || [])
    .filter(isSpeechAudioLayer)
    .map(async (audioLayer) => {
      const audioLayerId = audioLayer?._id?.toString?.() ?? audioLayer?._id ?? null;
      if (!audioLayerId) {
        return null;
      }

      const prompt = getSpeechTextFromAudioLayer(audioLayer);
      const ttsProvider = getFirstNonEmptyString(audioLayer.ttsProvider, audioLayer.provider) || 'ELEVENLABS';
      const speaker = getFirstNonEmptyString(audioLayer.speaker) || null;

      const audioGenerationPayload = {
        sessionId: newSessionId,
        generationType: 'speech',
        prompt,
        speaker,
        audioLayerId: audioLayerId.toString(),
        ttsProvider,
        defaultSelected: true,
        duration: audioLayer.duration,
        startTime: audioLayer.startTime,
        endTime: audioLayer.endTime,
        volume: audioLayer.volume,
        speakerCharacterName: audioLayer.speakerCharacterName,
        instructions: audioLayer.instructions,
        generationMeta: audioLayer.generationMeta,
      };

      const audioGeneration = new AudioGeneration(audioGenerationPayload);
      return audioGeneration.save();
    });

  await Promise.all(speechGenerationRequests);
}

export async function translateVideoSessionAndQueueGeneration(userId, payload = {}) {
  const {
    oldSessionId,
    originalSessionData,
    normalizedLanguageCode,
    enableSubtitles,
    translateOutro,
    translateFooter,
    durationSeconds,
    billableSeconds,
    creditsToCharge,
  } = await getTranslateVideoBillingPreview(userId, payload);
  const webhookUrl = typeof payload.webhookUrl === 'string' && payload.webhookUrl.trim()
    ? payload.webhookUrl.trim()
    : null;
  const skipCreditDeduction = payload.skipCreditDeduction === true;

  const creditResult = skipCreditDeduction
    ? { creditsCharged: creditsToCharge, remainingCredits: null }
    : await deductGenerationCredits(userId, creditsToCharge, {
        source: 'translate_video',
        metadata: {
          originalSessionId: oldSessionId,
          language: normalizedLanguageCode,
          enableSubtitles,
          translateOutro,
          translateFooter,
          durationSeconds,
          billableSeconds,
          requestType: 'API',
        },
      });

  const newSessionId = await createNewBlankVideoSession(userId, {
    aspectRatio: originalSessionData?.aspectRatio || '16:9',
    enableSubtitles,
    hasSubtitles: enableSubtitles,
    has_subtitles: enableSubtitles,
    language: normalizedLanguageCode,
    sessionLanguage: normalizedLanguageCode,
    languageString: getLanguageStringFromLanguageCode(normalizedLanguageCode),
    transcriptGenerationPending: enableSubtitles,
  });
  await upsertGlobalSessionMapping({
    sessionId: newSessionId,
    sessionType: 'video',
    requestId: newSessionId,
    provider: getFirstNonEmptyString(
      originalSessionData?.expressGenerativeVideoModel,
      originalSessionData?.video_model,
      originalSessionData?.provider,
      originalSessionData?.videoGenerationModelSubType,
    ) || 'translate_video',
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'translate_video',
    metadata: {
      originalSessionId: oldSessionId,
      language: normalizedLanguageCode,
      enableSubtitles,
      translateOutro,
      translateFooter,
    },
  });

  void processTranslateVideoSessionJob({
    userId,
    oldSessionId,
    newSessionId,
    normalizedLanguageCode,
    enableSubtitles,
    translateOutro,
    translateFooter,
    webhookUrl,
  }).catch(async (error) => {
    const message = error?.message || 'Failed to translate video session.';
    console.error('[api][video][translate_video] async job failed', {
      newSessionId,
      originalSessionId: oldSessionId,
      language: normalizedLanguageCode,
      error,
    });
    try {
      await VideoSession.updateOne(
        { _id: newSessionId },
        {
          $set: {
            expressGenerationFailed: true,
            expressGenerationPending: false,
            expressGenerationError: message,
          },
        },
      );
    } catch (updateError) {
      console.error('[api][video][translate_video] failed to mark session as FAILED', {
        newSessionId,
        error: updateError,
      });
    }
  });

  return {
    request_id: newSessionId,
    session_id: newSessionId,
    creditsCharged: creditsToCharge,
    remainingCredits: creditResult?.remainingCredits ?? null,
  };
}

export async function getTranslateVideoBillingPreview(userId, payload = {}) {
  const originalSessionId = payload.videoSessionId || payload.sessionId || payload.session_id;
  const languageCode = payload.language || payload.languageCode || payload.language_code;
  const enableSubtitles = getOptionalBooleanPayloadValue(
    payload,
    ['enable_subtitles', 'enableSubtitles', 'add_subtitles', 'addSubtitles'],
    'enable_subtitles',
    false,
  );
  const translateOutro = getOptionalBooleanPayloadValue(
    payload,
    ['translate_outro', 'translateOutro'],
    'translate_outro',
    true,
  );
  const translateFooter = getOptionalBooleanPayloadValue(
    payload,
    ['translate_footer', 'translateFooter'],
    'translate_footer',
    true,
  );

  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  if (!originalSessionId || typeof originalSessionId !== 'string' || !originalSessionId.trim()) {
    const error = new Error('videoSessionId (or session_id) must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  if (!languageCode || typeof languageCode !== 'string' || !languageCode.trim()) {
    const error = new Error('language must be a non-empty string language code.');
    error.status = 400;
    throw error;
  }

  const normalizedLanguageCode = normalizeSupportedLanguage(languageCode);
  if (!normalizedLanguageCode) {
    const supportedCodes = SUPPORTED_LANGUAGES.map((code) => code.toUpperCase()).join(', ');
    const error = new Error(`language must be one of: ${supportedCodes}.`);
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();
  const oldSessionId = originalSessionId.trim();
  const originalSessionDoc = await VideoSession.findOne({ _id: oldSessionId, userId: userId.toString() });

  if (!originalSessionDoc) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });
  const durationSeconds = resolveSessionDurationSeconds(originalSessionData);
  const billableSeconds = Math.ceil(durationSeconds);
  if (!Number.isFinite(billableSeconds) || billableSeconds <= 0) {
    const error = new Error('Unable to determine video duration for billing.');
    error.status = 400;
    throw error;
  }

  const originalSpeechLayers = Array.isArray(originalSessionData?.audioLayers)
    ? originalSessionData.audioLayers.filter(isSpeechAudioLayer)
    : [];

  if (!originalSpeechLayers.length) {
    const error = new Error('Session does not contain any speech audio layers to translate.');
    error.status = 400;
    throw error;
  }

  const movieResourceList = getMovieResourceList(originalSessionData);
  const resourceScenes = Array.isArray(movieResourceList?.scenes) ? movieResourceList.scenes : null;
  if (!resourceScenes || resourceScenes.length === 0) {
    const error = new Error('Session is missing movieResourceList scenes; cannot reset durations for translation.');
    error.status = 400;
    throw error;
  }

  const creditsToCharge = TRANSLATE_VIDEO_CREDITS_PER_SECOND * billableSeconds;

  return {
    oldSessionId,
    originalSessionData,
    normalizedLanguageCode,
    enableSubtitles,
    translateOutro,
    translateFooter,
    durationSeconds,
    billableSeconds,
    creditsToCharge,
  };
}

export async function removeSubtitlesAndQueueGeneration(userId, payload = {}) {
  const originalSessionId = payload.videoSessionId || payload.sessionId || payload.session_id;
  const webhookUrl = typeof payload.webhookUrl === 'string' && payload.webhookUrl.trim()
    ? payload.webhookUrl.trim()
    : null;

  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  if (!originalSessionId || typeof originalSessionId !== 'string' || !originalSessionId.trim()) {
    const error = new Error('videoSessionId (or session_id) must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  if (!Types.ObjectId.isValid(originalSessionId.trim())) {
    const error = new Error('videoSessionId must be a valid id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();
  const oldSessionId = originalSessionId.trim();
  const originalSessionMeta = await VideoSession.findOne({ _id: oldSessionId, userId: userId.toString() })
    .select('expressGenerativeVideoModel video_model provider videoGenerationModelSubType aspectRatio sessionLanguage language language_code langauge languageString')
    .lean();

  if (!originalSessionMeta) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const sessionLanguage = resolveSessionLanguageForStorage(originalSessionMeta);
  const newSessionId = await createNewBlankVideoSession(userId, {
    aspectRatio: originalSessionMeta?.aspectRatio || '16:9',
    expressGenerationPending: false,
    frameGenerationPending: false,
    videoGenerationPending: false,
    audioGenerationPending: false,
    transcriptGenerationPending: false,
    enableSubtitles: false,
    hasSubtitles: false,
    has_subtitles: false,
    language: getFirstNonEmptyString(originalSessionMeta?.language) || sessionLanguage || 'auto',
    sessionLanguage,
    languageString: getSessionLanguageString(originalSessionMeta, sessionLanguage),
    expressGenerationStatus: buildRemoveSubtitlesExpressGenerationStatus(),
  });

  await upsertGlobalSessionMapping({
    sessionId: newSessionId,
    sessionType: 'video',
    requestId: newSessionId,
    provider: getFirstNonEmptyString(
      originalSessionMeta?.expressGenerativeVideoModel,
      originalSessionMeta?.video_model,
      originalSessionMeta?.provider,
      originalSessionMeta?.videoGenerationModelSubType,
    ) || 'remove_subtitles',
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'remove_subtitles',
    metadata: {
      originalSessionId: oldSessionId,
    },
  });

  scheduleRemoveSubtitlesSessionJob({
    userId,
    oldSessionId,
    newSessionId,
    webhookUrl,
  });

  return {
    request_id: newSessionId,
    session_id: newSessionId,
  };
}

export async function addSubtitlesAndQueueGeneration(userId, payload = {}) {
  const originalSessionId = payload.videoSessionId || payload.sessionId || payload.session_id;
  const webhookUrl = typeof payload.webhookUrl === 'string' && payload.webhookUrl.trim()
    ? payload.webhookUrl.trim()
    : null;

  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  if (!originalSessionId || typeof originalSessionId !== 'string' || !originalSessionId.trim()) {
    const error = new Error('videoSessionId (or session_id) must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  if (!Types.ObjectId.isValid(originalSessionId.trim())) {
    const error = new Error('videoSessionId must be a valid id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();
  const oldSessionId = originalSessionId.trim();
  const originalSessionMeta = await VideoSession.findOne({ _id: oldSessionId, userId: userId.toString() })
    .select('expressGenerativeVideoModel video_model provider videoGenerationModelSubType aspectRatio sessionLanguage language language_code langauge languageString')
    .lean();

  if (!originalSessionMeta) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const sessionLanguage = resolveSessionLanguageForStorage(originalSessionMeta);
  const newSessionId = await createNewBlankVideoSession(userId, {
    aspectRatio: originalSessionMeta?.aspectRatio || '16:9',
    expressGenerationPending: false,
    frameGenerationPending: false,
    videoGenerationPending: false,
    audioGenerationPending: false,
    transcriptGenerationPending: true,
    enableSubtitles: true,
    hasSubtitles: true,
    has_subtitles: true,
    language: getFirstNonEmptyString(originalSessionMeta?.language) || sessionLanguage || 'auto',
    sessionLanguage,
    languageString: getSessionLanguageString(originalSessionMeta, sessionLanguage),
    expressGenerationStatus: buildAddSubtitlesExpressGenerationStatus(),
  });

  await upsertGlobalSessionMapping({
    sessionId: newSessionId,
    sessionType: 'video',
    requestId: newSessionId,
    provider: getFirstNonEmptyString(
      originalSessionMeta?.expressGenerativeVideoModel,
      originalSessionMeta?.video_model,
      originalSessionMeta?.provider,
      originalSessionMeta?.videoGenerationModelSubType,
    ) || 'add_subtitles',
    userId,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'add_subtitles',
    metadata: {
      originalSessionId: oldSessionId,
    },
  });

  scheduleAddSubtitlesSessionJob({
    userId,
    oldSessionId,
    newSessionId,
    webhookUrl,
  });

  return {
    request_id: newSessionId,
    session_id: newSessionId,
  };
}

function scheduleAddSubtitlesSessionJob({ userId, oldSessionId, newSessionId, webhookUrl }) {
  const start = () => {
    void processAddSubtitlesSessionJob({ userId, oldSessionId, newSessionId, webhookUrl }).catch(async (error) => {
      const message = error?.message || 'Failed to add subtitles to video session.';
      console.error('[api][video][add_subtitles] async job failed', {
        newSessionId,
        originalSessionId: oldSessionId,
        error,
      });
      try {
        await VideoSession.updateOne(
          { _id: newSessionId },
          {
            $set: {
              expressGenerationFailed: true,
              expressGenerationPending: false,
              frameGenerationPending: false,
              expressGenerationError: message,
            },
          },
        );
      } catch (updateError) {
        console.error('[api][video][add_subtitles] failed to mark session as FAILED', {
          newSessionId,
          error: updateError,
        });
      }
    });
  };

  if (typeof setImmediate === 'function') {
    setImmediate(start);
    return;
  }

  setTimeout(start, 0);
}

function scheduleRemoveSubtitlesSessionJob({ userId, oldSessionId, newSessionId, webhookUrl }) {
  const start = () => {
    void processRemoveSubtitlesSessionJob({ userId, oldSessionId, newSessionId, webhookUrl }).catch(async (error) => {
      const message = error?.message || 'Failed to remove subtitles from video session.';
      console.error('[api][video][remove_subtitles] async job failed', {
        newSessionId,
        originalSessionId: oldSessionId,
        error,
      });
      try {
        await VideoSession.updateOne(
          { _id: newSessionId },
          {
            $set: {
              expressGenerationFailed: true,
              expressGenerationPending: false,
              frameGenerationPending: false,
              expressGenerationError: message,
            },
          },
        );
      } catch (updateError) {
        console.error('[api][video][remove_subtitles] failed to mark session as FAILED', {
          newSessionId,
          error: updateError,
        });
      }
    });
  };

  if (typeof setImmediate === 'function') {
    setImmediate(start);
    return;
  }

  setTimeout(start, 0);
}

async function processRemoveSubtitlesSessionJob({ userId, oldSessionId, newSessionId, webhookUrl }) {
  await getDBConnectionString();
  const originalSessionDoc = await VideoSession.findOne({ _id: oldSessionId, userId: userId.toString() });

  if (!originalSessionDoc) {
    throw new Error('Video session not found for subtitle removal.');
  }

  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });
  const assetsRoot = resolveAssetsRoot();

  await copySessionAssetDirectories({ assetsRoot, oldSessionId, newSessionId });

  // NOTE: Do not use structuredClone here - it can serialize BSON ObjectIds into
  // `{ buffer: Uint8Array(...) }` shapes which Mongoose cannot cast back when saving.
  // JSON serialization converts ObjectIds to hex strings which Mongoose can cast.
  const clonedSession = JSON.parse(JSON.stringify(originalSessionData));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  rewriteSessionAssetReferences(clonedSession, oldSessionId, newSessionId);
  stripTextItemsFromActiveItemLists(clonedSession);
  prepareSessionForSubtitleRemoval({
    clonedSession,
    webhookUrl,
  });

  await VideoSession.updateOne({ _id: newSessionId }, { $set: clonedSession });
  await VideoSession.updateOne(
    { _id: newSessionId },
    {
      $set: {
        expressGenerationPending: true,
        frameGenerationPending: true,
        'layers.$[].frameGenerationPending': true,
        'layers.$[].aiVideoFrameGenerationPending': false,
        'layers.$[].frames': [],
      },
    },
  );
}

async function processAddSubtitlesSessionJob({ userId, oldSessionId, newSessionId, webhookUrl }) {
  await getDBConnectionString();
  const originalSessionDoc = await VideoSession.findOne({ _id: oldSessionId, userId: userId.toString() });

  if (!originalSessionDoc) {
    throw new Error('Video session not found for subtitle addition.');
  }

  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });
  const assetsRoot = resolveAssetsRoot();

  await copySessionAssetDirectories({ assetsRoot, oldSessionId, newSessionId });

  const clonedSession = JSON.parse(JSON.stringify(originalSessionData));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  rewriteSessionAssetReferences(clonedSession, oldSessionId, newSessionId);
  stripTextItemsFromActiveItemLists(clonedSession);
  prepareSessionForSubtitleAddition({
    clonedSession,
    webhookUrl,
  });

  await VideoSession.updateOne({ _id: newSessionId }, { $set: clonedSession });
  await VideoSession.updateOne(
    { _id: newSessionId },
    {
      $set: {
        expressGenerationPending: true,
        frameGenerationPending: true,
        transcriptGenerationPending: true,
        enableSubtitles: true,
        hasSubtitles: true,
        has_subtitles: true,
        'layers.$[].frameGenerationPending': true,
        'layers.$[].aiVideoFrameGenerationPending': false,
        'layers.$[].frames': [],
      },
    },
  );
}
