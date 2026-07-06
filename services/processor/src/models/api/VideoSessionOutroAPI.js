import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import axios from 'axios';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { Types } from 'mongoose';

import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { createNewBlankQuickSession } from '../QuickSession.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';

import VideoSession from '../../schema/VideoSession.js';
import FrameGeneration from '../../schema/FrameGeneration.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { getFramesPerSecondFromValue } from '../../utils/FpsUtils.js';
import { readLocalMediaBufferIfAvailable } from '../../utils/LocalMediaAsset.js';
import {
  generateOutroCompositionAssetsFromImageList,
} from './OutroImageGenerationAPI.js';
import { collectGeneratedOutroTileInputs } from './OutroTileInputCollector.js';
import {
  createGeneratedOutroTileItems,
  createOutroCtaTextItems,
  createOutroFadeOverlayItem,
} from '../movie_session/image_list_to_video/OutroLayerItems.js';
import {
  buildOutroImageMetadata,
  normalizeFooterMetadataItem,
} from '../../utils/VideoOverlayMetadata.js';
import {
  normalizeOutroCtaImageFromPayload,
  normalizeOutroCtaImageTextFieldsFromPayload,
} from '../../utils/OutroCtaImagePayload.js';

export const UPDATE_OUTRO_IMAGE_CREDITS = 75;
export const ADD_OUTRO_IMAGE_CREDITS = 75;
export const UPDATE_FOOTER_IMAGE_CREDITS = UPDATE_OUTRO_IMAGE_CREDITS;
const OUTRO_LAYER_DURATION_SECONDS = 8;
const OUTRO_TRANSITION_FADE_SECONDS = 0.5;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEDIA_DOWNLOAD_TIMEOUT_MS = Number.isFinite(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.API_MEDIA_DOWNLOAD_TIMEOUT_MS)))
  : 180000;

function getFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
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
  const localAssetsRoot = path.resolve(__dirname, '../../..', 'assets_v2');
  const dockerAssetsRoot = process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
  const currentEnv = process.env.CURRENT_ENV;

  // Only use the docker volume mount in docker/staging.
  // Production uses the repo-local `samsar_processor/assets` path.
  if (currentEnv === 'staging' || currentEnv === 'docker') {
    if (fsExtra.existsSync(dockerAssetsRoot) && isWritableDirectory(dockerAssetsRoot)) {
      return dockerAssetsRoot;
    }
  }

  if (!fsExtra.existsSync(localAssetsRoot)) {
    fsExtra.ensureDirSync(localAssetsRoot);
  }

  return localAssetsRoot;
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

function stripLeadingSlash(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(/^\//, '').split('?')[0].split('#')[0];
}

function stripPublicAssetsPrefix(value) {
  return stripLeadingSlash(value)
    .replace(/^assets_v2\//, '')
    .replace(/^assets\//, '');
}

function toPublicAssetPath(assetsRoot, filePath) {
  const relativePath = path.relative(assetsRoot, filePath).split(path.sep).join('/');
  return assetsRoot.replace(/\\/g, '/').endsWith('/assets_v2')
    ? path.posix.join('assets_v2', relativePath)
    : relativePath;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageDataUrl(value) {
  return typeof value === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value.trim());
}

function decodeImageDataUrl(value) {
  if (!isImageDataUrl(value)) {
    return null;
  }
  const match = value.trim().match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return match?.[1] ? Buffer.from(match[1], 'base64') : null;
}

function normalizeOptionalText(value, maxLength = 220) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function getOptionalGeneratedOutroString(payload, snakeKey, camelKey, fieldName) {
  const rawValue = payload?.[snakeKey] ?? payload?.[camelKey];
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== 'string') {
    const error = new Error(`${fieldName} must be a string.`);
    error.status = 400;
    throw error;
  }
  return rawValue.trim();
}

function getOptionalFooterString(payload, snakeKey, camelKey, fieldName) {
  const rawValue = payload?.[snakeKey] ?? payload?.[camelKey];
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== 'string') {
    const error = new Error(`${fieldName} must be a string.`);
    error.status = 400;
    throw error;
  }
  return rawValue.trim();
}

function normalizeUpdateFooterImageOptions(payload = {}) {
  const rawRemoveFooter = payload.remove_footer ?? payload.removeFooter;
  if (
    rawRemoveFooter !== undefined &&
    rawRemoveFooter !== null &&
    typeof rawRemoveFooter !== 'boolean'
  ) {
    const error = new Error('remove_footer must be a boolean.');
    error.status = 400;
    throw error;
  }

  const removeFooter = rawRemoveFooter === true;
  const ctaText = normalizeOptionalText(
    getOptionalFooterString(payload, 'cta_text', 'ctaText', 'cta_text'),
    220,
  );
  const ctaLogo = getOptionalFooterString(payload, 'cta_logo', 'ctaLogo', 'cta_logo');
  const ctaUrl = getOptionalFooterString(payload, 'cta_url', 'ctaUrl', 'cta_url');

  if (ctaUrl && !isHttpUrl(ctaUrl)) {
    const error = new Error('cta_url must be an http or https URL.');
    error.status = 400;
    throw error;
  }

  if (ctaLogo && !isHttpUrl(ctaLogo) && !isImageDataUrl(ctaLogo)) {
    const error = new Error('cta_logo must be an http(s) URL or image data URL.');
    error.status = 400;
    throw error;
  }

  if (!removeFooter && !ctaText && !ctaLogo && !ctaUrl) {
    const error = new Error('At least one of cta_text, cta_logo, or cta_url is required unless remove_footer is true.');
    error.status = 400;
    throw error;
  }

  return {
    removeFooter,
    ctaText,
    ctaLogo: ctaLogo || null,
    ctaUrl: ctaUrl || null,
  };
}

function normalizeGeneratedOutroImageOptions(payload = {}) {
  const rawGenerateOutroImage = payload.generate_outro_image ?? payload.generateOutroImage;
  const rawOutroImageUrl = payload.outroImageUrl ?? payload.outro_image_url;
  const ctaUrl = getOptionalGeneratedOutroString(payload, 'cta_url', 'ctaUrl', 'cta_url');
  const outroCtaImage = normalizeOutroCtaImageFromPayload(payload);
  const outroCtaImageTextFields = normalizeOutroCtaImageTextFieldsFromPayload(payload);

  if (rawGenerateOutroImage === undefined || rawGenerateOutroImage === null) {
    if (typeof rawOutroImageUrl === 'string' && rawOutroImageUrl.trim() && outroCtaImage) {
      const error = new Error('Use either generate_outro_image with cta_url/outro_cta_image or outro_image_url, not both.');
      error.status = 400;
      throw error;
    }
    if ((!ctaUrl && !outroCtaImage) || (typeof rawOutroImageUrl === 'string' && rawOutroImageUrl.trim())) {
      return { generate_outro_image: false };
    }
  }

  if (
    rawGenerateOutroImage !== undefined &&
    rawGenerateOutroImage !== null &&
    typeof rawGenerateOutroImage !== 'boolean'
  ) {
    const error = new Error('generate_outro_image must be a boolean.');
    error.status = 400;
    throw error;
  }

  if (rawGenerateOutroImage === false) {
    return { generate_outro_image: false };
  }

  if (typeof rawOutroImageUrl === 'string' && rawOutroImageUrl.trim()) {
    const error = new Error('Use either generate_outro_image with cta_url/outro_cta_image or outro_image_url, not both.');
    error.status = 400;
    throw error;
  }

  if (!ctaUrl && !outroCtaImage) {
    const error = new Error('cta_url or outro_cta_image is required when generate_outro_image is true.');
    error.status = 400;
    throw error;
  }
  if (ctaUrl && !isHttpUrl(ctaUrl)) {
    const error = new Error('cta_url must be an http or https URL.');
    error.status = 400;
    throw error;
  }

  const ctaTextTop = normalizeOptionalText(
    getOptionalGeneratedOutroString(payload, 'cta_text_top', 'ctaTextTop', 'cta_text_top'),
    180,
  ) || outroCtaImageTextFields.ctaTextTop;
  const ctaTextBottom = normalizeOptionalText(
    getOptionalGeneratedOutroString(payload, 'cta_text_bottom', 'ctaTextBottom', 'cta_text_bottom'),
    180,
  ) || outroCtaImageTextFields.ctaTextBottom;
  const ctaLogo = getOptionalGeneratedOutroString(payload, 'cta_logo', 'ctaLogo', 'cta_logo');

  return {
    generate_outro_image: true,
    ...(ctaUrl ? { cta_url: ctaUrl } : {}),
    ...(outroCtaImage ? { outro_cta_image: outroCtaImage } : {}),
    cta_text_top: ctaTextTop,
    cta_text_bottom: ctaTextBottom,
    cta_logo: ctaLogo || null,
  };
}

const FAST_LINK_COPY_ERROR_CODES = new Set(['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'ENOSYS', 'EINVAL']);

async function copyFileWithOptionalHardLink(sourceFile, targetFile, useHardLinks = false) {
  await fsExtra.ensureDir(path.dirname(targetFile));
  if (!useHardLinks) {
    await fsExtra.copy(sourceFile, targetFile, {
      overwrite: true,
      errorOnExist: false,
      dereference: false,
    });
    return;
  }

  await fsExtra.remove(targetFile);
  try {
    await fs.promises.link(sourceFile, targetFile);
  } catch (error) {
    if (!FAST_LINK_COPY_ERROR_CODES.has(error?.code)) {
      throw error;
    }
    await fsExtra.copy(sourceFile, targetFile, {
      overwrite: true,
      errorOnExist: false,
      dereference: false,
    });
  }
}

async function copyDirectoryContents(sourceDir, targetDir, options = {}) {
  const useHardLinks = options.useHardLinks === true;
  const excludedTopLevelNames = options.excludedTopLevelNames instanceof Set
    ? options.excludedTopLevelNames
    : new Set();

  await fsExtra.ensureDir(targetDir);
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (excludedTopLevelNames.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, targetPath, {
        ...options,
        excludedTopLevelNames: new Set(),
      });
      continue;
    }

    await copyFileWithOptionalHardLink(sourcePath, targetPath, useHardLinks);
  }
}

async function copyDirIfExists(sourceDir, targetDir, options = {}) {
  if (!sourceDir || !targetDir) {
    return;
  }
  const exists = await fsExtra.pathExists(sourceDir);
  if (!exists) {
    return;
  }
  const stats = await fs.promises.stat(sourceDir);
  if (stats.isFile()) {
    await copyFileWithOptionalHardLink(sourceDir, targetDir, options.useHardLinks === true);
    return;
  }

  await fsExtra.ensureDir(path.dirname(targetDir));
  if (options.useHardLinks === true) {
    await fsExtra.remove(targetDir);
    await copyDirectoryContents(sourceDir, targetDir, options);
    return;
  }

  await fsExtra.copy(sourceDir, targetDir, {
    overwrite: true,
    errorOnExist: false,
    recursive: true,
  });
}

async function copyFrameOnlyPostProcessingAssets({
  assetsRoot,
  oldSessionId,
  newSessionId,
  pendingLayerIds = [],
  includeFooterAssets = false,
}) {
  const excludedFrameLayerIds = new Set(
    (Array.isArray(pendingLayerIds) ? pendingLayerIds : [])
      .map((layerId) => layerId?.toString?.() || layerId)
      .filter((layerId) => typeof layerId === 'string' && layerId.trim())
      .map((layerId) => layerId.trim()),
  );

  const linkCopyDirs = [
    ['video', 'frames'],
    ['video', 'audio'],
    ['video', 'generations'],
    ['video', 'splash'],
    ['video', 'lip_sync'],
    ['ai_video', 'frames'],
    ['ai_video', 'audio'],
    ['ai_video', 'generations'],
  ];

  const regularCopyDirs = [
    ['video', 'outro'],
    ...(includeFooterAssets ? [
      ['video', 'footer_qr'],
      ['video', 'footer_logo'],
    ] : []),
  ];

  await Promise.all([
    ...linkCopyDirs.map((segments) => copyDirIfExists(
      path.join(assetsRoot, ...segments, oldSessionId),
      path.join(assetsRoot, ...segments, newSessionId),
      {
        useHardLinks: true,
        excludedTopLevelNames: segments[1] === 'frames' ? excludedFrameLayerIds : new Set(),
      },
    )),
    ...regularCopyDirs.map((segments) => copyDirIfExists(
      path.join(assetsRoot, ...segments, oldSessionId),
      path.join(assetsRoot, ...segments, newSessionId),
    )),
  ]);
}

function rewriteSessionAssetReferences(sessionData, oldSessionId, newSessionId) {
  if (!sessionData || typeof sessionData !== 'object') {
    return;
  }

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
        value[key] = current.split(oldSessionId).join(newSessionId);
      } else if (Array.isArray(current) || (current && typeof current === 'object')) {
        visit(current);
      }
    }
  };

  visit(sessionData);
}

function buildPathCandidates(pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return new Set();
  }

  const normalized = pathValue.trim();
  const withoutLeadingSlash = normalized.replace(/^\//, '');
  const withLeadingSlash = withoutLeadingSlash ? `/${withoutLeadingSlash}` : normalized;
  return new Set([normalized, withoutLeadingSlash, withLeadingSlash]);
}

function isGeneratedOutroAssetItem(item, outroCandidates) {
  if (!item || typeof item !== 'object' || item.type !== 'image') {
    return false;
  }

  const image = typeof item.image === 'string' ? item.image.trim() : '';
  if (
    image === 'server_generated_outro_image' ||
    image === 'server_generated_outro_background' ||
    image === 'server_generated_outro_qr' ||
    image === 'server_generated_outro_cta_image' ||
    image.startsWith('server_generated_outro_tile')
  ) {
    return true;
  }

  const src = typeof item.src === 'string' ? item.src.trim() : '';
  if (src.includes('/video/outro/') || src.includes('video/outro/')) {
    return true;
  }

  const srcCandidates = buildPathCandidates(src);
  for (const srcCandidate of srcCandidates) {
    if (outroCandidates.has(srcCandidate)) {
      return true;
    }
  }

  return false;
}

function isExplicitOutroLayer(layer, sessionData) {
  if (!layer || typeof layer !== 'object') {
    return false;
  }

  if (layer.hasAiVideoLayer === true || layer.userVideoLayer || layer.aiVideoLayer) {
    return false;
  }

  if (layer.outroImageMetadata || layer.outroImagePath || layer.outro_image_path) {
    return true;
  }

  const activeItemList = layer.imageSession?.activeItemList;
  if (!Array.isArray(activeItemList) || activeItemList.length === 0) {
    return false;
  }

  const outroCandidates = buildPathCandidates(sessionData?.outroImageURL);
  return activeItemList.some((item) => isGeneratedOutroAssetItem(item, outroCandidates));
}

function findLastExplicitOutroLayerInfo(sessionData) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  if (layers.length === 0) {
    return null;
  }

  const index = layers.length - 1;
  const layer = layers[index];
  if (!isExplicitOutroLayer(layer, sessionData)) {
    return null;
  }

  return {
    index,
    layerId: layer?._id?.toString?.() ?? layer?._id ?? null,
  };
}

function resolveLayerTimelineEnd(layers = []) {
  let fallbackOffset = 0;
  let maxEnd = 0;

  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') {
      continue;
    }

    const explicitOffset = Number(layer.durationOffset);
    const duration = Number(layer.duration) || 0;
    const offset = Number.isFinite(explicitOffset) ? explicitOffset : fallbackOffset;
    const end = offset + duration;

    if (Number.isFinite(end) && end > maxEnd) {
      maxEnd = end;
    }
    fallbackOffset = end;
  }

  return maxEnd;
}

function normalizeFocusAreaForCanvas(focusArea, canvasDimensions) {
  if (!focusArea || typeof focusArea !== 'object' || Array.isArray(focusArea)) {
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

  return {
    x: focusX,
    y: focusY,
    width: focusWidth,
    height: focusHeight,
  };
}

function buildOutroLayerActiveItemList({
  outroImageUrl,
  outroBaseSrc,
  canvasDimensions,
  addOutroAnimation,
  focusSrc = null,
  focusArea = null,
  generatedOutroImage = false,
  generatedOutroComposition = null,
  ctaTextTop = null,
  ctaTextBottom = null,
}) {
  if (generatedOutroImage && generatedOutroComposition) {
    const activeItemList = [{
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

    activeItemList.push(...createGeneratedOutroTileItems({
      generatedOutroComposition,
      startIndex: activeItemList.length,
    }));

    if (addOutroAnimation) {
      activeItemList.push(createOutroFadeOverlayItem({
        id: `item_${activeItemList.length}`,
        canvasDimensions,
      }));
    }

    activeItemList.push(...createOutroCtaTextItems({
      canvasDimensions,
      ctaTextTop,
      ctaTextBottom,
      startIndex: activeItemList.length,
    }));

    activeItemList.push({
      id: `item_${activeItemList.length}`,
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

    return activeItemList;
  }

  const activeItemList = [{
    id: 'item_0',
    type: 'image',
    image: generatedOutroImage ? 'server_generated_outro_image' : (outroImageUrl || ''),
    x: 0,
    y: 0,
    width: canvasDimensions.width,
    height: canvasDimensions.height,
    src: outroBaseSrc,
    is_base_image: true,
    animations: [],
  }];

  if (addOutroAnimation) {
    activeItemList.push(createOutroFadeOverlayItem({
      id: `item_${activeItemList.length}`,
      canvasDimensions,
    }));
  }

  if (focusSrc && focusArea) {
    activeItemList.push({
      id: `item_${activeItemList.length}`,
      type: 'image',
      x: focusArea.x,
      y: focusArea.y,
      width: focusArea.width,
      height: focusArea.height,
      src: focusSrc,
      animations: [],
    });
  }

  if (generatedOutroImage) {
    activeItemList.push(...createOutroCtaTextItems({
      canvasDimensions,
      ctaTextTop,
      ctaTextBottom,
      startIndex: activeItemList.length,
    }));
  }

  return activeItemList;
}

function normalizeOutroFadeOverlayItems(activeItemList = []) {
  if (!Array.isArray(activeItemList)) {
    return activeItemList;
  }

  activeItemList.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    if (item.type !== 'shape' || item.shape !== 'rectangle') {
      return;
    }

    const animations = Array.isArray(item.animations) ? item.animations : [];
    const fadeAnimation = animations.find((animation) => animation?.type === 'fade');
    if (!fadeAnimation) {
      return;
    }

    item.isOutroFadeOverlay = true;
    fadeAnimation.params = {
      ...(fadeAnimation.params || {}),
      startFade: 0,
      endFade: 100,
    };
  });

  return activeItemList;
}

function buildOutroTransitionFadeAnimations({
  layerDuration,
  sessionFramesPerSecond,
}) {
  const fps = getFramesPerSecondFromValue(sessionFramesPerSecond);
  const totalFrames = Math.max(1, Math.round((Number(layerDuration) || 0) * fps));
  const fadeFrames = Math.max(1, Math.round(OUTRO_TRANSITION_FADE_SECONDS * fps));
  const frameDuration = Math.min(totalFrames, fadeFrames);
  const frameOffset = Math.max(0, totalFrames - frameDuration);

  return [{
    type: 'fade',
    params: {
      startFade: 0,
      endFade: 100,
    },
    frameOffset,
    frameDuration,
  }];
}

function canApplyOutroTransitionToLayer({ layers, targetLayerIndex }) {
  if (!Array.isArray(layers) || targetLayerIndex < 0 || targetLayerIndex >= layers.length) {
    return false;
  }

  const targetLayer = layers[targetLayerIndex];
  if (!targetLayer || typeof targetLayer !== 'object') {
    return false;
  }

  if (targetLayer.hasAiVideoLayer === true || targetLayer.userVideoLayer || targetLayer.aiVideoLayer) {
    return false;
  }

  const activeItemList = targetLayer.imageSession?.activeItemList;
  return Array.isArray(activeItemList) && activeItemList.length > 0;
}

function applyOutroTransitionToLayer({
  layers,
  targetLayerIndex,
  outroImageUrl,
  outroBaseSrc,
  canvasDimensions,
  sessionFramesPerSecond,
  focusSrc = null,
  focusArea = null,
}) {
  if (!Array.isArray(layers) || targetLayerIndex < 0 || targetLayerIndex >= layers.length) {
    return;
  }

  const targetLayer = layers[targetLayerIndex];
  if (!targetLayer || typeof targetLayer !== 'object') {
    return;
  }

  const imageSession = targetLayer.imageSession && typeof targetLayer.imageSession === 'object'
    ? targetLayer.imageSession
    : {};
  const activeItemList = Array.isArray(imageSession.activeItemList) ? imageSession.activeItemList : [];

  const cleanedActiveItemList = activeItemList.filter((item) => {
    if (!item || typeof item !== 'object') {
      return true;
    }
    if (item.isOutroTransitionOverlay === true) {
      return false;
    }
    const itemId = typeof item.id === 'string' ? item.id : '';
    return !itemId.startsWith('outro_transition_');
  });

  cleanedActiveItemList.push({
    id: `outro_transition_base_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'image',
    image: outroImageUrl || '',
    x: 0,
    y: 0,
    width: canvasDimensions.width,
    height: canvasDimensions.height,
    src: outroBaseSrc,
    is_base_image: false,
    isOutroTransitionOverlay: true,
    animations: buildOutroTransitionFadeAnimations({
      layerDuration: targetLayer.duration,
      sessionFramesPerSecond,
    }),
  });

  if (focusSrc && focusArea) {
    cleanedActiveItemList.push({
      id: `outro_transition_focus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'image',
      x: focusArea.x,
      y: focusArea.y,
      width: focusArea.width,
      height: focusArea.height,
      src: focusSrc,
      is_base_image: false,
      isOutroTransitionOverlay: true,
      animations: buildOutroTransitionFadeAnimations({
        layerDuration: targetLayer.duration,
        sessionFramesPerSecond,
      }),
    });
  }

  imageSession.activeItemList = cleanedActiveItemList;
  targetLayer.imageSession = imageSession;
  layers[targetLayerIndex] = targetLayer;
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
    imageBuffer = await readLocalMediaBufferIfAvailable(outroImageUrl, {
      assetsV2Root: assetsRoot,
    });
    if (!imageBuffer) {
      const response = await axios.get(outroImageUrl, {
        responseType: 'arraybuffer',
        timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
      });
      imageBuffer = Buffer.from(response.data);
    }
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

  const outroAssetRelativePath = toPublicAssetPath(assetsRoot, outroFilePath);

  return {
    outroFilePath,
    outroAssetRelativePath,
    canvasDimensions,
    outroFolder,
  };
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

  return toPublicAssetPath(assetsRoot, focusFilePath);
}

function resolveOutroOverlayConfig(activeItemList = []) {
  const overlay = {
    fade: null,
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

  const fadeShape = activeItemList.find((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    if (item.type !== 'shape' || item.shape !== 'rectangle') {
      return false;
    }
    const animations = Array.isArray(item.animations) ? item.animations : [];
    return animations.some((anim) => anim?.type === 'fade');
  });

  if (fadeShape) {
    const fadeAnim = Array.isArray(fadeShape.animations)
      ? fadeShape.animations.find((anim) => anim?.type === 'fade')
      : null;
    const params = fadeAnim?.params || {};
    overlay.fade = {
      startFade: typeof params.startFade === 'number' ? params.startFade : 100,
      endFade: typeof params.endFade === 'number' ? params.endFade : 100,
    };
  }

  return overlay;
}

async function regenerateOutroFrames({
  assetsRoot,
  newSessionId,
  outroLayerId,
  outroLayer,
  sessionFramesPerSecond,
  canvasDimensions,
  baseOutroAssetRelativePath,
  focusAssetRelativePath,
  overlay,
}) {
  if (!outroLayerId) {
    return;
  }

  const outputDir = path.join(assetsRoot, 'video', 'frames', newSessionId, outroLayerId.toString());
  await fsExtra.ensureDir(outputDir);
  await fsExtra.emptyDir(outputDir);

  const durationSeconds = Number(outroLayer?.duration);
  const fps = getFramesPerSecondFromValue(sessionFramesPerSecond);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return;
  }

  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
  const frameDurationMs = 1000 / fps;
  const layerDurationMs = durationSeconds * 1000;

  const baseImagePath = path.join(assetsRoot, stripPublicAssetsPrefix(baseOutroAssetRelativePath));
  const focusImagePath = focusAssetRelativePath
    ? path.join(assetsRoot, stripPublicAssetsPrefix(focusAssetRelativePath))
    : null;

  const hasFade = Boolean(overlay?.fade);
  const hasFocus = Boolean(focusImagePath && overlay?.focus);

  if (!hasFade && !hasFocus) {
    const baseFrameBuffer = await sharp(baseImagePath)
      .resize(canvasDimensions.width, canvasDimensions.height)
      .png()
      .toBuffer();
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const dest = path.join(outputDir, `${frame}.png`);
      await fsExtra.writeFile(dest, baseFrameBuffer);
    }
    return;
  }

  const focusBuffer = hasFocus
    ? await sharp(focusImagePath).png().toBuffer()
    : null;

  for (let frame = 0; frame < totalFrames; frame += 1) {
    const elapsedMs = frame * frameDurationMs;
    const t = Math.max(0, Math.min(1, elapsedMs / layerDurationMs));

    let pipeline = sharp(baseImagePath).resize(canvasDimensions.width, canvasDimensions.height).png();

    if (hasFade) {
      const startAlpha = (overlay.fade.startFade ?? 100) / 100;
      const endAlpha = (overlay.fade.endFade ?? 100) / 100;
      const alpha = Math.max(0, Math.min(1, startAlpha + (endAlpha - startAlpha) * t));
      const fadeOverlay = await sharp({
        create: {
          width: canvasDimensions.width,
          height: canvasDimensions.height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha },
        },
      })
        .png()
        .toBuffer();
      pipeline = pipeline.composite([{ input: fadeOverlay, left: 0, top: 0 }]);
    }

    if (hasFocus && focusBuffer) {
      const focusLeft = Math.round(overlay.focus.x);
      const focusTop = Math.round(overlay.focus.y);
      pipeline = pipeline.composite([{ input: focusBuffer, left: focusLeft, top: focusTop }]);
    }

    const dest = path.join(outputDir, `${frame}.png`);
    await pipeline.toFile(dest);
  }
}

async function queueOutroImageAndRender(userId, payload = {}, options = {}) {
  const originalSessionId = payload.videoSessionId || payload.sessionId || payload.session_id;
  const generatedOutroOptions = normalizeGeneratedOutroImageOptions(payload);
  const generateOutroImage = generatedOutroOptions.generate_outro_image === true;
  const outroImageUrl = generateOutroImage
    ? null
    : payload.outroImageUrl || payload.outro_image_url;
  const webhookUrl = typeof payload.webhookUrl === 'string' && payload.webhookUrl.trim()
    ? payload.webhookUrl.trim()
    : null;

  const addOutroAnimationOption = payload.addOutroAnimation;
  const addOutroFocusAreaOption = payload.addOutroFocusArea;
  const requestedFocusArea = payload.outroFocustArea ?? payload.outroFocusArea ?? null;
  const effectiveAddOutroAnimationOption = generateOutroImage
    ? (typeof addOutroAnimationOption === 'boolean' ? addOutroAnimationOption : true)
    : addOutroAnimationOption;
  const effectiveAddOutroFocusAreaOption = generateOutroImage
    ? effectiveAddOutroAnimationOption === true
    : addOutroFocusAreaOption;

  const allowCreateOutro = options.allowCreateOutro === true;
  const preserveExistingLayerComposition = options.preserveExistingLayerComposition === true;
  const applyTransitionOverlay = options.applyTransitionOverlay === true;
  const creditSource = getFirstNonEmptyString(options.creditSource) || 'update_outro_image';
  const sessionSubType = getFirstNonEmptyString(options.sessionSubType) || creditSource;
  const logPrefix = getFirstNonEmptyString(options.logPrefix) || sessionSubType;
  const creditsToCharge = Number.isFinite(Number(options.creditsToCharge))
    ? Math.max(0, Math.floor(Number(options.creditsToCharge)))
    : UPDATE_OUTRO_IMAGE_CREDITS;
  const skipCreditDeduction = options.skipCreditDeduction === true || payload.skipCreditDeduction === true;

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
  const normalizedOriginalSessionId = originalSessionId.trim();
  if (!Types.ObjectId.isValid(normalizedOriginalSessionId)) {
    const error = new Error('videoSessionId must be a valid video session id. Use /v1/external_users/update_outro_image for external request ids.');
    error.status = 400;
    throw error;
  }

  if (!generateOutroImage && (!outroImageUrl || typeof outroImageUrl !== 'string' || !outroImageUrl.trim())) {
    const error = new Error('outro_image_url must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  if (addOutroAnimationOption !== undefined && typeof addOutroAnimationOption !== 'boolean') {
    const error = new Error('add_outro_animation must be a boolean.');
    error.status = 400;
    throw error;
  }

  if (addOutroFocusAreaOption !== undefined && typeof addOutroFocusAreaOption !== 'boolean') {
    const error = new Error('add_outro_focus_area must be a boolean.');
    error.status = 400;
    throw error;
  }

  if (!generateOutroImage && addOutroFocusAreaOption === true && addOutroAnimationOption !== true) {
    const error = new Error('add_outro_focus_area requires add_outro_animation to be true.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();
  const originalSessionDoc = await VideoSession.findOne({ _id: normalizedOriginalSessionId, userId: userId.toString() });

  if (!originalSessionDoc) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });

  const detectedOutroLayerInfo = findLastExplicitOutroLayerInfo(originalSessionData);
  const canReplaceDetectedOutro = Boolean(detectedOutroLayerInfo?.layerId);
  const isReplacingExistingOutro = canReplaceDetectedOutro;
  const operationLogPrefix = allowCreateOutro && isReplacingExistingOutro
    ? 'update_outro_image'
    : logPrefix;
  const operationSessionSubType = allowCreateOutro && isReplacingExistingOutro
    ? 'update_outro_image'
    : sessionSubType;

  if (!canReplaceDetectedOutro && !allowCreateOutro) {
    const error = new Error('Session does not have an outro image to update.');
    error.status = 400;
    throw error;
  }

  const creditResult = skipCreditDeduction
    ? { creditsCharged: creditsToCharge, remainingCredits: null }
    : await deductGenerationCredits(userId, creditsToCharge, {
        source: creditSource,
        metadata: {
          originalSessionId: normalizedOriginalSessionId,
          requestType: 'API',
        },
      });

  const assetsRoot = resolveAssetsRoot();
  const newSessionId = await createNewBlankQuickSession(userId);
  const oldSessionId = normalizedOriginalSessionId;
  const pendingSourceLayerIds = canReplaceDetectedOutro
    ? [detectedOutroLayerInfo?.layerId].filter(Boolean)
    : [];

  try {
    await copyFrameOnlyPostProcessingAssets({
      assetsRoot,
      oldSessionId,
      newSessionId,
      pendingLayerIds: pendingSourceLayerIds,
    });

  // NOTE: Do not use structuredClone here - it can serialize BSON ObjectIds into
  // `{ buffer: Uint8Array(...) }` shapes which Mongoose cannot cast back when saving.
  // JSON serialization converts ObjectIds to hex strings which Mongoose can cast.
  const clonedSession = JSON.parse(JSON.stringify(originalSessionData));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  rewriteSessionAssetReferences(clonedSession, oldSessionId, newSessionId);

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
  // Don't let the express listener pick this session up until we've ensured all
  // layer-level pending flags are set for frame generation.
  clonedSession.expressGenerationPending = false;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationError = null;
  clonedSession.provisionalCredits = 0;
  clonedSession.isExpressGeneration = true;
  clonedSession.expressGenerativeVideoRequired = false;
  clonedSession.expressGenerativeSpeechRequired = false;
  if (webhookUrl) {
    clonedSession.externalWebhook = webhookUrl;
  }

  const originalOutroImageField = typeof originalSessionData?.outroImageURL === 'string'
    ? originalSessionData.outroImageURL
    : '';
  const outroFieldHasLeadingSlash = originalOutroImageField.startsWith('/');

  const aspectRatio = typeof originalSessionData?.aspectRatio === 'string' && originalSessionData.aspectRatio.trim()
    ? originalSessionData.aspectRatio.trim()
    : '16:9';

  let generatedOutroComposition = null;
  let persistedOutro;

  if (generateOutroImage) {
    const tileInputs = await collectGeneratedOutroTileInputs({
      sessionData: originalSessionData,
      assetsRoot,
      outroLayerIndex: detectedOutroLayerInfo?.index ?? -1,
    });

    generatedOutroComposition = await generateOutroCompositionAssetsFromImageList({
      imageListPayload: tileInputs.imageListPayload,
      imageUrls: tileInputs.imageUrls,
      aspectRatio,
      ctaUrl: generatedOutroOptions.cta_url,
      outroCtaImage: generatedOutroOptions.outro_cta_image,
      assetsRoot,
      sessionId: newSessionId,
      ctaLogo: generatedOutroOptions.cta_logo,
    });
    const outroAssetRelativePath = generatedOutroComposition.background.src;
    const outroFilePath = path.join(assetsRoot, stripPublicAssetsPrefix(outroAssetRelativePath));
    persistedOutro = {
      outroFilePath,
      outroAssetRelativePath,
      canvasDimensions: {
        width: generatedOutroComposition.width,
        height: generatedOutroComposition.height,
      },
      outroFolder: path.dirname(outroFilePath),
    };
  } else {
    persistedOutro = await downloadOutroImageToSession({
      outroImageUrl: outroImageUrl.trim(),
      newSessionId,
      assetsRoot,
      aspectRatio,
    });
  }

  const {
    outroAssetRelativePath,
    canvasDimensions,
    outroFolder,
    outroFilePath,
  } = persistedOutro;

  clonedSession.hasOutroImage = true;
  clonedSession.outroImageURL = withNormalizedAssetPath(outroAssetRelativePath, outroFieldHasLeadingSlash);

  const layers = Array.isArray(clonedSession.layers) ? clonedSession.layers : [];

  let shouldReplaceOutro = canReplaceDetectedOutro;
  let outroLayerIndex = shouldReplaceOutro ? detectedOutroLayerInfo.index : -1;
  let existingOverlay = {
    fade: null,
    focus: null,
    focusItemIndex: -1,
    baseItemIndex: -1,
  };
  let baseSrcHasLeadingSlash = false;
  let focusSrcHasLeadingSlash = false;

  if (shouldReplaceOutro) {
    const existingOutroLayer = layers[outroLayerIndex];
    const existingActiveItemList = existingOutroLayer?.imageSession?.activeItemList;
    if (!Array.isArray(existingActiveItemList)) {
      const error = new Error('Outro layer is missing activeItemList data.');
      error.status = 400;
      throw error;
    }

    existingOverlay = resolveOutroOverlayConfig(existingActiveItemList);
    if (existingOverlay.baseItemIndex < 0) {
      const error = new Error('Outro layer does not include a base image item.');
      error.status = 400;
      throw error;
    }

    const existingBaseItem = existingActiveItemList[existingOverlay.baseItemIndex];
    baseSrcHasLeadingSlash = typeof existingBaseItem?.src === 'string' && existingBaseItem.src.startsWith('/');

    if (existingOverlay.focusItemIndex >= 0) {
      const existingFocusItem = existingActiveItemList[existingOverlay.focusItemIndex];
      focusSrcHasLeadingSlash = typeof existingFocusItem?.src === 'string' && existingFocusItem.src.startsWith('/');
    }
  }

  let transitionBaseSrc = withNormalizedAssetPath(outroAssetRelativePath, baseSrcHasLeadingSlash);
  let transitionFocusSrc = null;
  let transitionFocusArea = null;
  const outroImageItemLabel = generateOutroImage
    ? 'server_generated_outro_background'
    : outroImageUrl.trim();
  const outroImageMetadata = buildOutroImageMetadata({
    generated: generateOutroImage,
    sourceUrl: generateOutroImage ? null : outroImageUrl.trim(),
    assetPath: clonedSession.outroImageURL,
    ctaUrl: generatedOutroOptions.cta_url,
    ctaTextTop: generatedOutroOptions.cta_text_top,
    ctaTextBottom: generatedOutroOptions.cta_text_bottom,
    ctaLogo: generatedOutroOptions.cta_logo,
    outroCtaImage: generatedOutroOptions.outro_cta_image,
  });
  const hasExplicitOutroLayerOptions = (
    generateOutroImage ||
    addOutroAnimationOption !== undefined ||
    addOutroFocusAreaOption !== undefined ||
    requestedFocusArea !== null && requestedFocusArea !== undefined
  );
  const shouldPreserveExistingLayerComposition =
    preserveExistingLayerComposition && !hasExplicitOutroLayerOptions;

  if (shouldReplaceOutro && shouldPreserveExistingLayerComposition) {
    const outroLayer = layers[outroLayerIndex];
    const activeItemList = Array.isArray(outroLayer?.imageSession?.activeItemList)
      ? outroLayer.imageSession.activeItemList
      : null;
    if (!activeItemList) {
      const error = new Error('Outro layer is missing activeItemList data.');
      error.status = 400;
      throw error;
    }

    if (existingOverlay.baseItemIndex < 0) {
      const error = new Error('Outro layer does not include a base image item.');
      error.status = 400;
      throw error;
    }

    const baseItem = activeItemList[existingOverlay.baseItemIndex];
    transitionBaseSrc = withNormalizedAssetPath(outroAssetRelativePath, baseSrcHasLeadingSlash);
    baseItem.image = outroImageItemLabel;
    baseItem.src = transitionBaseSrc;
    activeItemList[existingOverlay.baseItemIndex] = baseItem;

    if (existingOverlay.focus && existingOverlay.focusItemIndex >= 0) {
      const newFocusRelativePath = await writeFocusCrop({
        baseImagePath: outroFilePath,
        focusArea: existingOverlay.focus,
        canvasDimensions,
        outroFolder,
        assetsRoot,
        newSessionId,
      });

      if (newFocusRelativePath) {
        const focusItem = activeItemList[existingOverlay.focusItemIndex];
        focusItem.src = withNormalizedAssetPath(newFocusRelativePath, focusSrcHasLeadingSlash);
        activeItemList[existingOverlay.focusItemIndex] = focusItem;
        transitionFocusSrc = focusItem.src;
        transitionFocusArea = normalizeFocusAreaForCanvas(existingOverlay.focus, canvasDimensions);
      }
    }

    outroLayer.imageSession.activeItemList = normalizeOutroFadeOverlayItems(activeItemList);
    layers[outroLayerIndex] = outroLayer;
  } else {
    const addOutroAnimation = typeof effectiveAddOutroAnimationOption === 'boolean'
      ? effectiveAddOutroAnimationOption
      : Boolean(existingOverlay.fade);
    const addOutroFocusArea = typeof effectiveAddOutroFocusAreaOption === 'boolean'
      ? effectiveAddOutroFocusAreaOption
      : Boolean(existingOverlay.focus);

    const hasRequestedFocusArea = requestedFocusArea !== null && requestedFocusArea !== undefined;
    const normalizedRequestedFocusArea = normalizeFocusAreaForCanvas(requestedFocusArea, canvasDimensions);
    const normalizedExistingFocusArea = normalizeFocusAreaForCanvas(existingOverlay.focus, canvasDimensions);

    let focusAreaToUse = null;
    if (!generateOutroImage && addOutroAnimation && addOutroFocusArea) {
      focusAreaToUse = hasRequestedFocusArea
        ? normalizedRequestedFocusArea
        : normalizedExistingFocusArea;

      if (!focusAreaToUse) {
        const error = new Error('outro_focust_area is required and must be valid when add_outro_focus_area is true.');
        error.status = 400;
        throw error;
      }
    }

    const outroBaseSrc = withNormalizedAssetPath(outroAssetRelativePath, baseSrcHasLeadingSlash);

    let focusSrc = null;
    if (focusAreaToUse) {
      const newFocusRelativePath = await writeFocusCrop({
        baseImagePath: outroFilePath,
        focusArea: focusAreaToUse,
        canvasDimensions,
        outroFolder,
        assetsRoot,
        newSessionId,
      });
      if (!newFocusRelativePath) {
        const error = new Error(
          'Failed to create outro focus image from outro_focust_area.',
        );
        error.status = 400;
        throw error;
      }
      focusSrc = withNormalizedAssetPath(newFocusRelativePath, focusSrcHasLeadingSlash);
    }

    const outroActiveItemList = buildOutroLayerActiveItemList({
      outroImageUrl: outroImageItemLabel,
      outroBaseSrc,
      canvasDimensions,
      addOutroAnimation,
      focusSrc,
      focusArea: focusAreaToUse,
      generatedOutroImage: generateOutroImage,
      generatedOutroComposition,
      ctaTextTop: generatedOutroOptions.cta_text_top,
      ctaTextBottom: generatedOutroOptions.cta_text_bottom,
    });

    if (!shouldReplaceOutro) {
      outroLayerIndex = layers.length;
      layers.push({
        _id: new Types.ObjectId(),
        imageSession: {
          userId,
          generations: [],
          activeSelectedImage: '',
          activeGeneratedImage: '',
          activeOutpaintedImage: '',
          generationStatus: 'PENDING',
          outpaintStatus: 'INIT',
          witnesses: [],
          intermediates: [],
          lastWitnessSavedAt: null,
          generationError: null,
          outpaintError: '',
          prompt: '',
          activeItemList: outroActiveItemList,
        },
        prompt: '',
        status: 'pending',
        duration: OUTRO_LAYER_DURATION_SECONDS,
        durationOffset: resolveLayerTimelineEnd(layers),
        layerAiVideoType: 'none',
        layerBaseAiImageType: 'none',
        skipAiVideoGeneration: true,
        hasAiVideoLayer: false,
        aiVideoGenerationPending: false,
        aiVideoGenerationStatus: 'COMPLETED',
        lipSyncGenerationPending: false,
        soundEffectGenerationPending: false,
      });
    } else {
      const outroLayer = layers[outroLayerIndex];
      if (!outroLayer.imageSession || typeof outroLayer.imageSession !== 'object') {
        outroLayer.imageSession = {};
      }
      outroLayer.imageSession.activeItemList = outroActiveItemList;
      layers[outroLayerIndex] = outroLayer;
    }

    transitionBaseSrc = outroBaseSrc;
    transitionFocusSrc = focusSrc;
    transitionFocusArea = focusAreaToUse;
  }

  let shouldApplyTransitionOverlay = applyTransitionOverlay && !shouldReplaceOutro && outroLayerIndex > 0;
  if (
    shouldApplyTransitionOverlay &&
    !canApplyOutroTransitionToLayer({ layers, targetLayerIndex: outroLayerIndex - 1 })
  ) {
    shouldApplyTransitionOverlay = false;
  }
  if (shouldApplyTransitionOverlay) {
    applyOutroTransitionToLayer({
      layers,
      targetLayerIndex: outroLayerIndex - 1,
      outroImageUrl: outroImageItemLabel,
      outroBaseSrc: transitionBaseSrc,
      canvasDimensions,
      sessionFramesPerSecond: clonedSession?.framesPerSecond,
      focusSrc: transitionFocusSrc,
      focusArea: transitionFocusArea,
    });
  }

  clonedSession.layers = layers;
  if (outroImageMetadata) {
    clonedSession.outroImageMetadata = outroImageMetadata;
    if (outroLayerIndex >= 0 && clonedSession.layers[outroLayerIndex]) {
      clonedSession.layers[outroLayerIndex].outroImageMetadata = outroImageMetadata;
    }
  }

  const pendingOutroLayerIndexes = normalizePendingLayerIndexes([
    outroLayerIndex,
    shouldApplyTransitionOverlay ? outroLayerIndex - 1 : -1,
  ], clonedSession.layers);
  const pendingOutroLayerIndexSet = new Set(pendingOutroLayerIndexes);

  // Only the changed outro layer, plus an explicit transition layer when added,
  // needs fresh frames. Unchanged layer frames were copied to the new session.
  clonedSession.layers = (clonedSession.layers || []).map((layer, layerIndex) => {
    if (!layer || typeof layer !== 'object') {
      return layer;
    }
    const shouldRegenerateLayerFrames = pendingOutroLayerIndexSet.has(layerIndex);

    layer.frameGenerationPending = shouldRegenerateLayerFrames;
    layer.aiVideoFrameGenerationPending = false;
    if (shouldRegenerateLayerFrames) {
      layer.frames = [];
    }
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
    'lip_sync_generation',
    'sound_effect_generation',
    'delete_reflow',
    'timeline_reflowed',
    'transcript_generation',
  ]);

  for (const key of allStatusKeys) {
    status[key] = 'COMPLETED';
  }
  status.frame_generation = 'INIT';
  status.video_generation = 'INIT';
  clonedSession.expressGenerationStatus = status;

  await persistPreparedPostProcessingSession({
    logPrefix: operationLogPrefix,
    newSessionId,
    oldSessionId,
    userId,
    clonedSession,
    originalSessionData,
    sessionSubType: operationSessionSubType,
    metadata: {
      operation: operationLogPrefix,
      generatedOutroImage: generateOutroImage,
      allowCreateOutro,
      shouldReplaceOutro,
      outroLayerIndex,
      applyTransitionOverlay: shouldApplyTransitionOverlay,
      pendingLayerIndexes: pendingOutroLayerIndexes,
    },
  });

    return {
      request_id: newSessionId,
      session_id: newSessionId,
      creditsCharged: creditsToCharge,
      remainingCredits: creditResult?.remainingCredits ?? null,
    };
  } catch (error) {
    console.error(`[api][video][${operationLogPrefix}] queue failed`, {
      sessionId: newSessionId,
      originalSessionId: oldSessionId,
      step: error?.postProcessingStep,
      error: summarizeErrorForLog(error),
    });
    await markPostProcessingSessionFailed({
      logPrefix: operationLogPrefix,
      newSessionId,
      oldSessionId,
      error,
    });
    throw error;
  }
}

async function persistFooterLogoAsset({
  ctaLogo,
  assetsRoot,
  newSessionId,
}) {
  if (!ctaLogo) {
    return null;
  }

  let logoBuffer = decodeImageDataUrl(ctaLogo);
  if (!logoBuffer) {
    logoBuffer = await readLocalMediaBufferIfAvailable(ctaLogo, {
      assetsV2Root: assetsRoot,
    });
  }
  if (!logoBuffer) {
    const response = await axios.get(ctaLogo, {
      responseType: 'arraybuffer',
      timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
    });
    logoBuffer = Buffer.from(response.data);
  }

  const footerFolder = path.join(assetsRoot, 'video', 'footer_logo', newSessionId);
  await fsExtra.ensureDir(footerFolder);

  const logoFilePath = path.join(footerFolder, 'footer_logo.png');
  await sharp(logoBuffer, { failOn: 'none' })
    .rotate()
    .png()
    .toFile(logoFilePath);

  return path
    .relative(assetsRoot, logoFilePath)
    .split(path.sep)
    .join('/');
}

function buildFooterMetadata({
  ctaText,
  ctaUrl,
  ctaLogo,
  footerLogoImagePath,
}) {
  return normalizeFooterMetadataItem({
    url: ctaUrl,
    title: ctaText,
    logoUrl: ctaLogo,
    footerLogoImagePath,
  });
}

function getFooterSceneLayerIndexes(sessionData) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  const detectedOutroLayerInfo = findLastExplicitOutroLayerInfo(sessionData);
  const outroLayerIndex = Number.isInteger(detectedOutroLayerInfo?.index)
    ? detectedOutroLayerInfo.index
    : -1;

  return layers
    .map((_, index) => index)
    .filter((index) => index !== outroLayerIndex);
}

function clearFooterFieldsForLayer(layer) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  layer.addFooterAnimation = false;
  layer.footerMetadata = null;
  layer.footerQrImagePath = null;
  layer.footer_qr_image_path = null;
  layer.footerLogoImagePath = null;
  layer.footer_logo_image_path = null;
  layer.footerLogoUrl = null;
  return layer;
}

function applyFooterFieldsForLayer(layer, footerMetadata, footerLogoImagePath) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  layer.addFooterAnimation = true;
  layer.footerMetadata = footerMetadata;
  layer.footerQrImagePath = null;
  layer.footer_qr_image_path = null;
  layer.footerLogoImagePath = footerLogoImagePath || null;
  layer.footer_logo_image_path = footerLogoImagePath || null;
  layer.footerLogoUrl = footerMetadata?.logoUrl || footerMetadata?.ctaLogo || null;
  return layer;
}

function prepareLayerForFrameOnlyRegeneration(layer) {
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
}

function buildFrameOnlyExpressGenerationStatus(existingStatus = {}) {
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
    'lip_sync_generation',
    'sound_effect_generation',
    'delete_reflow',
    'timeline_reflowed',
    'transcript_generation',
  ]);

  for (const key of allStatusKeys) {
    status[key] = 'COMPLETED';
  }

  status.frame_generation = 'INIT';
  status.video_generation = 'INIT';
  return status;
}

function summarizeExpressGenerationStatus(status = {}) {
  return {
    status: status?.status,
    prompt_generation: status?.prompt_generation,
    image_generation: status?.image_generation,
    frame_generation: status?.frame_generation,
    video_generation: status?.video_generation,
    ai_video_generation: status?.ai_video_generation,
    speech_generation: status?.speech_generation,
    audio_generation: status?.audio_generation,
  };
}

function summarizeMongoWriteResult(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  return {
    acknowledged: result.acknowledged,
    matchedCount: result.matchedCount ?? result.n,
    modifiedCount: result.modifiedCount ?? result.nModified,
    deletedCount: result.deletedCount,
    insertedCount: result.insertedCount,
    upsertedCount: result.upsertedCount,
    upsertedId: result.upsertedId,
  };
}

function summarizeErrorForLog(error) {
  return {
    name: error?.name,
    message: error?.message || String(error),
    code: error?.code,
    status: error?.status || error?.response?.status,
    stack: error?.stack,
  };
}

function buildPostProcessingSessionSummary({
  newSessionId,
  oldSessionId,
  sessionSubType,
  clonedSession,
  pendingLayerIndexes = [],
  metadata = {},
}) {
  let jsonBytes = null;
  try {
    jsonBytes = Buffer.byteLength(JSON.stringify(clonedSession), 'utf8');
  } catch {
    jsonBytes = null;
  }

  return {
    sessionId: newSessionId,
    originalSessionId: oldSessionId,
    sessionSubType,
    layerCount: Array.isArray(clonedSession?.layers) ? clonedSession.layers.length : 0,
    audioLayerCount: Array.isArray(clonedSession?.audioLayers) ? clonedSession.audioLayers.length : 0,
    hasOutroImage: Boolean(clonedSession?.hasOutroImage || clonedSession?.outroImageURL),
    hasOutroImageMetadata: Boolean(clonedSession?.outroImageMetadata),
    hasFooterMetadata: Boolean(
      Array.isArray(clonedSession?.footerMetadata)
        ? clonedSession.footerMetadata.length
        : clonedSession?.footerMetadata,
    ),
    frameGenerationPending: clonedSession?.frameGenerationPending,
    videoGenerationPending: clonedSession?.videoGenerationPending,
    expressGenerationPending: clonedSession?.expressGenerationPending,
    expressGenerationStatus: summarizeExpressGenerationStatus(clonedSession?.expressGenerationStatus),
    pendingLayerIndexes,
    pendingLayerCount: pendingLayerIndexes.length,
    jsonBytes,
    ...metadata,
  };
}

const IMAGE_SESSION_RENDER_HISTORY_ARRAY_FIELDS = [
  'generations',
  'witnesses',
  'intermediates',
  'previousActiveItemList',
  'editHistory',
  'generationHistory',
  'outpaintHistory',
];

const LAYER_RENDER_HISTORY_ARRAY_FIELDS = [
  'filterPasses',
  'movieResourceList',
  'videoEditPendingOperations',
  'videoEditHistory',
];

function compactImageSessionForPostProcessingRender(imageSession) {
  if (!imageSession || typeof imageSession !== 'object') {
    return imageSession;
  }

  for (const field of IMAGE_SESSION_RENDER_HISTORY_ARRAY_FIELDS) {
    if (Array.isArray(imageSession[field])) {
      imageSession[field] = [];
    }
  }

  if (Array.isArray(imageSession.activeItemList)) {
    imageSession.activeItemList = imageSession.activeItemList.map((item, index) => {
      if (!item || typeof item !== 'object') {
        return item;
      }
      if (isImageDataUrl(item.image) && typeof item.src === 'string' && item.src.trim()) {
        return {
          ...item,
          image: item.title || item.name || item.label || `active_item_${index}`,
        };
      }
      return item;
    });
  }

  return imageSession;
}

function compactLayerForPostProcessingRender(layer, shouldRegenerateFrames) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  if (layer.imageSession && typeof layer.imageSession === 'object') {
    layer.imageSession = compactImageSessionForPostProcessingRender(layer.imageSession);
  }

  for (const field of LAYER_RENDER_HISTORY_ARRAY_FIELDS) {
    if (Array.isArray(layer[field])) {
      layer[field] = [];
    }
  }

  layer.frameGenerationPending = shouldRegenerateFrames;
  layer.aiVideoFrameGenerationPending = false;

  if (shouldRegenerateFrames) {
    layer.frames = [];
  }

  return layer;
}

function normalizePendingLayerIndexes(pendingLayerIndexes = [], layers = []) {
  const maxIndex = Array.isArray(layers) ? layers.length - 1 : -1;
  return [...new Set(
    pendingLayerIndexes
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0 && index <= maxIndex),
  )].sort((a, b) => a - b);
}

function compactSessionForPostProcessingRender(clonedSession, pendingLayerIndexes = []) {
  const layers = Array.isArray(clonedSession?.layers) ? clonedSession.layers : [];
  const normalizedPendingLayerIndexes = normalizePendingLayerIndexes(pendingLayerIndexes, layers);
  const pendingLayerIndexSet = new Set(normalizedPendingLayerIndexes);

  clonedSession.layers = layers.map((layer, index) => (
    compactLayerForPostProcessingRender(layer, pendingLayerIndexSet.has(index))
  ));

  if (Array.isArray(clonedSession?.generations)) {
    clonedSession.generations = [];
  }
  if (Array.isArray(clonedSession?.timelineHints)) {
    clonedSession.timelineHints = [];
  }
  if (Array.isArray(clonedSession?.sessionMessages)) {
    clonedSession.sessionMessages = [];
  }

  const hasPendingFrameLayers = normalizedPendingLayerIndexes.length > 0;
  clonedSession.frameGenerationPending = hasPendingFrameLayers;
  clonedSession.videoGenerationPending = false;
  clonedSession.expressGenerationPending = false;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationError = null;
  clonedSession.expressGenerationStatus = {
    ...(clonedSession.expressGenerationStatus || {}),
    status: 'PENDING',
    frame_generation: hasPendingFrameLayers ? 'PENDING' : 'COMPLETED',
    video_generation: 'INIT',
  };

  return normalizedPendingLayerIndexes;
}

function getLayerIdsForIndexes(layers = [], pendingLayerIndexes = []) {
  return pendingLayerIndexes
    .map((index) => layers[index]?._id?.toString?.() || layers[index]?._id)
    .filter((layerId) => typeof layerId === 'string' && layerId.trim())
    .map((layerId) => layerId.trim());
}

async function runLoggedPostProcessingStep({
  logPrefix,
  step,
  metadata = {},
  operation,
}) {
  try {
    const result = await operation();
    return result;
  } catch (error) {
    const message = error?.message || String(error);
    if (!error.publicMessage) {
      error.publicMessage = `${logPrefix} failed while ${step}: ${message}`;
    }
    error.postProcessingStep = step;
    console.error(`[api][video][${logPrefix}] ${step} failed`, {
      ...metadata,
      error: summarizeErrorForLog(error),
    });
    throw error;
  }
}

async function markPostProcessingSessionFailed({
  logPrefix,
  newSessionId,
  oldSessionId,
  error,
}) {
  if (!newSessionId) {
    return;
  }

  const message = error?.publicMessage || error?.message || `Failed to queue ${logPrefix}.`;
  try {
    await VideoSession.updateOne(
      { _id: newSessionId },
      {
        $set: {
          expressGenerationPending: false,
          frameGenerationPending: false,
          videoGenerationPending: false,
          expressGenerationFailed: true,
          expressGenerationError: message,
          'expressGenerationStatus.status': 'FAILED',
          'expressGenerationStatus.frame_generation': 'FAILED',
          'expressGenerationStatus.video_generation': 'FAILED',
        },
      },
    );
  } catch (markError) {
    console.error(`[api][video][${logPrefix}] failed to mark post-processing session failed`, {
      sessionId: newSessionId,
      originalSessionId: oldSessionId,
      error: summarizeErrorForLog(markError),
    });
  }
}

async function persistPreparedPostProcessingSession({
  logPrefix,
  newSessionId,
  oldSessionId,
  userId,
  clonedSession,
  originalSessionData,
  sessionSubType,
  metadata = {},
}) {
  const pendingLayerIndexes = compactSessionForPostProcessingRender(
    clonedSession,
    metadata.pendingLayerIndexes,
  );
  const pendingLayerIds = getLayerIdsForIndexes(clonedSession.layers, pendingLayerIndexes);
  const summary = buildPostProcessingSessionSummary({
    newSessionId,
    oldSessionId,
    sessionSubType,
    clonedSession,
    pendingLayerIndexes,
    metadata,
  });


  const saveResult = await runLoggedPostProcessingStep({
    logPrefix,
    step: 'save cloned session',
    metadata: {
      sessionId: newSessionId,
      originalSessionId: oldSessionId,
    },
    operation: () => VideoSession.updateOne({ _id: newSessionId }, { $set: clonedSession }),
  });

  const matchedCount = saveResult?.matchedCount ?? saveResult?.n ?? 0;
  if (matchedCount === 0) {
    const error = new Error(`New post-processing session ${newSessionId} was not found while saving cloned data.`);
    error.publicMessage = `${logPrefix} failed while save cloned session: session ${newSessionId} was not found.`;
    error.postProcessingStep = 'save cloned session';
    throw error;
  }

  await runLoggedPostProcessingStep({
    logPrefix,
    step: 'enqueue frame regeneration',
    metadata: {
      sessionId: newSessionId,
      originalSessionId: oldSessionId,
      pendingLayerIds,
    },
    operation: async () => {
      await FrameGeneration.deleteMany({ sessionId: newSessionId });
      if (!pendingLayerIds.length) {
        return { acknowledged: true, deletedExistingRows: true, insertedCount: 0 };
      }
      const createdRows = await FrameGeneration.insertMany(
        pendingLayerIds.map((layerId) => ({
          sessionId: newSessionId,
          layerId,
          isVideoGenerationRequest: true,
        })),
      );
      return {
        acknowledged: true,
        deletedExistingRows: true,
        insertedCount: createdRows.length,
      };
    },
  });

  await runLoggedPostProcessingStep({
    logPrefix,
    step: 'activate post-processing render',
    metadata: {
      sessionId: newSessionId,
      originalSessionId: oldSessionId,
      pendingLayerIds,
    },
    operation: () => VideoSession.updateOne(
      { _id: newSessionId },
      {
        $set: {
          expressGenerationPending: true,
          frameGenerationPending: pendingLayerIds.length > 0,
          videoGenerationPending: false,
        },
      },
    ),
  });

  await runLoggedPostProcessingStep({
    logPrefix,
    step: 'upsert global session mapping',
    metadata: {
      sessionId: newSessionId,
      originalSessionId: oldSessionId,
      sessionSubType,
    },
    operation: () => upsertGlobalSessionMapping({
      sessionId: newSessionId,
      sessionType: 'video',
      requestId: newSessionId,
      provider: getFirstNonEmptyString(
        originalSessionData?.expressGenerativeVideoModel,
        originalSessionData?.video_model,
        originalSessionData?.provider,
        originalSessionData?.videoGenerationModelSubType,
      ),
      userId,
      status: 'PENDING',
      requestType: 'API',
      sessionSubType,
    }),
  });
}

async function queueFooterImageAndRender(userId, payload = {}, options = {}) {
  const originalSessionId = payload.videoSessionId || payload.sessionId || payload.session_id;
  const footerOptions = normalizeUpdateFooterImageOptions(payload);
  const webhookUrl = typeof payload.webhookUrl === 'string' && payload.webhookUrl.trim()
    ? payload.webhookUrl.trim()
    : null;
  const creditSource = getFirstNonEmptyString(options.creditSource) || 'update_footer_image';
  const sessionSubType = getFirstNonEmptyString(options.sessionSubType) || creditSource;
  const logPrefix = getFirstNonEmptyString(options.logPrefix) || sessionSubType;
  const creditsToCharge = Number.isFinite(Number(options.creditsToCharge))
    ? Math.max(0, Math.floor(Number(options.creditsToCharge)))
    : UPDATE_FOOTER_IMAGE_CREDITS;
  const skipCreditDeduction = options.skipCreditDeduction === true || payload.skipCreditDeduction === true;

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

  const normalizedOriginalSessionId = originalSessionId.trim();
  if (!Types.ObjectId.isValid(normalizedOriginalSessionId)) {
    const error = new Error('videoSessionId must be a valid video session id. Use /v1/external_users/update_footer_image for external request ids.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();
  const originalSessionDoc = await VideoSession.findOne({ _id: normalizedOriginalSessionId, userId: userId.toString() });
  if (!originalSessionDoc) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const originalSessionData = originalSessionDoc.toObject({ depopulate: true });
  const sceneLayerIndexes = getFooterSceneLayerIndexes(originalSessionData);
  const pendingSourceLayerIds = sceneLayerIndexes
    .map((index) => originalSessionData?.layers?.[index]?._id?.toString?.() || originalSessionData?.layers?.[index]?._id)
    .filter((layerId) => typeof layerId === 'string' && layerId.trim());
  if (!footerOptions.removeFooter && sceneLayerIndexes.length === 0) {
    const error = new Error('Session does not include any scene layers to receive a footer.');
    error.status = 400;
    throw error;
  }

  const creditResult = skipCreditDeduction
    ? { creditsCharged: creditsToCharge, remainingCredits: null }
    : await deductGenerationCredits(userId, creditsToCharge, {
        source: creditSource,
        metadata: {
          originalSessionId: normalizedOriginalSessionId,
          requestType: 'API',
        },
      });

  const assetsRoot = resolveAssetsRoot();
  const newSessionId = await createNewBlankQuickSession(userId);
  const oldSessionId = normalizedOriginalSessionId;

  try {
    await copyFrameOnlyPostProcessingAssets({
      assetsRoot,
      oldSessionId,
      newSessionId,
      pendingLayerIds: pendingSourceLayerIds,
      includeFooterAssets: true,
    });

  const clonedSession = JSON.parse(JSON.stringify(originalSessionData));

  delete clonedSession._id;
  delete clonedSession.__v;
  delete clonedSession.createdAt;
  delete clonedSession.updatedAt;

  rewriteSessionAssetReferences(clonedSession, oldSessionId, newSessionId);

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
  clonedSession.expressGenerationPending = false;
  clonedSession.expressGenerationFailed = false;
  clonedSession.expressGenerationError = null;
  clonedSession.provisionalCredits = 0;
  clonedSession.isExpressGeneration = true;
  clonedSession.expressGenerativeVideoRequired = false;
  clonedSession.expressGenerativeSpeechRequired = false;
  if (webhookUrl) {
    clonedSession.externalWebhook = webhookUrl;
  }

  const footerLogoImagePath = footerOptions.removeFooter
    ? null
    : await persistFooterLogoAsset({
        ctaLogo: footerOptions.ctaLogo,
        assetsRoot,
        newSessionId,
      });
  const footerMetadata = footerOptions.removeFooter
    ? null
    : buildFooterMetadata({
        ctaText: footerOptions.ctaText,
        ctaUrl: footerOptions.ctaUrl,
        ctaLogo: footerOptions.ctaLogo,
        footerLogoImagePath,
      });

  const layers = Array.isArray(clonedSession.layers) ? clonedSession.layers : [];
  const sceneIndexSet = new Set(sceneLayerIndexes);

  clonedSession.layers = layers.map((layer, index) => {
    let nextLayer = layer;
    const shouldRegenerateLayerFrames = sceneIndexSet.has(index);
    if (footerOptions.removeFooter || !sceneIndexSet.has(index)) {
      nextLayer = clearFooterFieldsForLayer(nextLayer);
    } else {
      nextLayer = applyFooterFieldsForLayer(nextLayer, footerMetadata, footerLogoImagePath);
    }
    return shouldRegenerateLayerFrames
      ? prepareLayerForFrameOnlyRegeneration(nextLayer)
      : nextLayer;
  });

  clonedSession.addFooterAnimation = !footerOptions.removeFooter;
  clonedSession.footerMetadata = footerOptions.removeFooter
    ? []
    : sceneLayerIndexes.map(() => footerMetadata);
  clonedSession.footerLogoImagePath = footerOptions.removeFooter ? null : footerLogoImagePath;
  clonedSession.footerCtaText = footerOptions.removeFooter ? null : footerOptions.ctaText;
  clonedSession.footerCtaUrl = footerOptions.removeFooter ? null : footerOptions.ctaUrl;
  clonedSession.footerCtaLogo = footerOptions.removeFooter ? null : footerOptions.ctaLogo;

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

  clonedSession.expressGenerationStatus = buildFrameOnlyExpressGenerationStatus(
    clonedSession.expressGenerationStatus,
  );

  await persistPreparedPostProcessingSession({
    logPrefix,
    newSessionId,
    oldSessionId,
    userId,
    clonedSession,
    originalSessionData,
    sessionSubType,
    metadata: {
      operation: logPrefix,
      removeFooter: footerOptions.removeFooter,
      footerSceneLayerCount: sceneLayerIndexes.length,
      hasFooterLogo: Boolean(footerLogoImagePath),
      hasFooterCtaUrl: Boolean(footerOptions.ctaUrl),
      pendingLayerIndexes: sceneLayerIndexes,
    },
  });

    return {
      request_id: newSessionId,
      session_id: newSessionId,
      creditsCharged: creditsToCharge,
      remainingCredits: creditResult?.remainingCredits ?? null,
    };
  } catch (error) {
    console.error(`[api][video][${logPrefix}] queue failed`, {
      sessionId: newSessionId,
      originalSessionId: oldSessionId,
      step: error?.postProcessingStep,
      error: summarizeErrorForLog(error),
    });
    await markPostProcessingSessionFailed({
      logPrefix,
      newSessionId,
      oldSessionId,
      error,
    });
    throw error;
  }
}

export async function updateFooterImageAndQueueRender(userId, payload = {}) {
  return queueFooterImageAndRender(userId, payload, {
    creditSource: 'update_footer_image',
    sessionSubType: 'update_footer_image',
    creditsToCharge: UPDATE_FOOTER_IMAGE_CREDITS,
    logPrefix: 'update_footer_image',
  });
}

export async function updateOutroImageAndQueueRender(userId, payload = {}) {
  return queueOutroImageAndRender(userId, payload, {
    allowCreateOutro: true,
    preserveExistingLayerComposition: true,
    applyTransitionOverlay: false,
    creditSource: 'update_outro_image',
    sessionSubType: 'update_outro_image',
    creditsToCharge: UPDATE_OUTRO_IMAGE_CREDITS,
    logPrefix: 'update_outro_image',
  });
}

export async function addOutroImageAndQueueRender(userId, payload = {}) {
  return queueOutroImageAndRender(userId, payload, {
    allowCreateOutro: true,
    preserveExistingLayerComposition: false,
    applyTransitionOverlay: false,
    creditSource: 'add_outro_image',
    sessionSubType: 'add_outro_image',
    creditsToCharge: ADD_OUTRO_IMAGE_CREDITS,
    logPrefix: 'add_outro_image',
  });
}
