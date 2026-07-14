import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import { applyRGBSplit, applyNoiseOverlay, applyDisplacementShifts, applyScanLineDisturbances } from './utils/AnimationUtils.js';
import { applySnowfallEffect } from './utils/SnowFallUtils.js';
import { applyLightTransitionEffect } from './utils/LightTransitionUtils.js';
import { applyHologramEffect } from './utils/HologramUtils.js';
import { applyNebulaEffect } from './utils/NebulaUtils.js';
import { applyParticleEffect } from './utils/ParticleUtils.js';
import { applyBloomEffect } from './utils/BloomUtils.js';
import { applyLensFlareEffect } from './utils/LensFlareUtils.js';
import { applyTextAnimations } from './animations/TextAnimations.js';
import { applyTextSubtitleAnimations } from './animations/SubtitleAnimations.js';
import { ensureFontsRegistered } from './utils/fontRegistry.js';
import { getFramesPerSecondFromValue } from './utils/FpsUtils.js';
import { installStructuredLogger } from './utils/StructuredLogger.js';
import { isMotionlessSubtitleItem } from './utils/SubtitleRenderPolicy.js';
import { selectActiveItemsForFrame } from './utils/ActiveSubtitleItems.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_frames_processor',
  component: 'frame_worker',
});


const MAX_RETRIES = 3;
let framesPerSecond = getFramesPerSecondFromValue();
let frameDuration = 1000 / framesPerSecond;
const numericPngFrameCache = new Map();

function parseNumericPngFrameName(fileName) {
  if (typeof fileName !== 'string') {
    return null;
  }

  const match = fileName.match(/^(\d+)\.png$/i);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getAvailableNumericPngFrames(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return [];
  }

  if (numericPngFrameCache.has(dirPath)) {
    return numericPngFrameCache.get(dirPath);
  }

  const availableFrames = fs.readdirSync(dirPath)
    .map(parseNumericPngFrameName)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  numericPngFrameCache.set(dirPath, availableFrames);
  return availableFrames;
}

function resolveExistingOrNearestFramePath(requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    return null;
  }

  if (fs.existsSync(requestedPath)) {
    return requestedPath;
  }

  const requestedFrameIndex = parseNumericPngFrameName(path.basename(requestedPath));
  if (!Number.isFinite(requestedFrameIndex)) {
    return null;
  }

  const dirPath = path.dirname(requestedPath);
  const availableFrames = getAvailableNumericPngFrames(dirPath);
  if (availableFrames.length === 0) {
    return null;
  }

  let resolvedFrameIndex = availableFrames[0];
  for (const frameIndex of availableFrames) {
    if (frameIndex > requestedFrameIndex) {
      break;
    }
    resolvedFrameIndex = frameIndex;
  }

  const resolvedPath = path.join(dirPath, `${resolvedFrameIndex}.png`);
  return fs.existsSync(resolvedPath) ? resolvedPath : null;
}

function resolveExistingOrTailFramePath(requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    return null;
  }

  if (fs.existsSync(requestedPath)) {
    return requestedPath;
  }

  const requestedFrameIndex = parseNumericPngFrameName(path.basename(requestedPath));
  if (!Number.isFinite(requestedFrameIndex)) {
    return null;
  }

  const dirPath = path.dirname(requestedPath);
  const availableFrames = getAvailableNumericPngFrames(dirPath);
  if (availableFrames.length === 0) {
    return null;
  }

  const lastFrameIndex = availableFrames[availableFrames.length - 1];
  if (requestedFrameIndex <= lastFrameIndex) {
    return null;
  }

  const resolvedPath = path.join(dirPath, `${lastFrameIndex}.png`);
  return fs.existsSync(resolvedPath) ? resolvedPath : null;
}

function resolveAssetsRoot(version = 'legacy') {
  if (version === 'v2' && process.env.SAMSAR_ASSETS_V2_ROOT) {
    return process.env.SAMSAR_ASSETS_V2_ROOT;
  }
  if (version !== 'v2' && process.env.SAMSAR_ASSETS_ROOT) {
    return process.env.SAMSAR_ASSETS_ROOT;
  }
  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    return version === 'v2' ? '/assets_v2' : '/assets';
  }

  const folderName = version === 'v2' ? 'assets_v2' : 'assets';
  return path.join(process.cwd(), '../', 'samsar_processor', folderName);
}

function normalizeAssetPath(assetPath) {
  if (typeof assetPath !== 'string') {
    return null;
  }

  let value = assetPath.trim();
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      return null;
    }
  }

  value = value.split('?')[0].split('#')[0];
  value = value.replace(/^\/?samsar_processor\/assets_v2\//, 'assets_v2/');
  value = value.replace(/^\/?samsar_processor\/assets\//, '');
  value = value.replace(/^\/?assets\//, '');
  value = value.replace(/^\/+/, '');

  return value;
}

function stripAssetPrefix(assetPath) {
  return assetPath
    .replace(/^\/+/, '')
    .replace(/^assets_v2\/?/, '')
    .replace(/^assets\/?/, '');
}

function resolveAssetAbsolutePath(assetPath) {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!normalizedAssetPath) {
    return null;
  }

  const hasV2Prefix = normalizedAssetPath.startsWith('assets_v2/');
  const relativePath = stripAssetPrefix(normalizedAssetPath);
  const candidates = hasV2Prefix
    ? [path.join(resolveAssetsRoot('v2'), relativePath)]
    : [
      path.join(resolveAssetsRoot('v2'), relativePath),
      path.join(resolveAssetsRoot('legacy'), relativePath),
    ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function resolveAssetWritePath(...segments) {
  return path.join(resolveAssetsRoot('v2'), ...segments);
}

function getGlobalVideoId(globalVideo = {}) {
  return globalVideo?._id?.toString?.()
    || globalVideo?.id?.toString?.()
    || globalVideo?.globalVideoId?.toString?.()
    || '';
}

function normalizeGlobalVideoShape(shapeOverlay = '') {
  const normalizedShape = typeof shapeOverlay === 'string'
    ? shapeOverlay.trim().toLowerCase().replace(/\s+/g, '_')
    : '';

  if (normalizedShape === 'rect') {
    return 'rectangle';
  }
  if (normalizedShape === 'rounded-rectangle') {
    return 'rounded_rectangle';
  }
  return ['circle', 'oval', 'rectangle', 'rounded_rectangle'].includes(normalizedShape)
    ? normalizedShape
    : 'circle';
}

function resolveGlobalVideoFramePath(globalVideo = {}, elapsedTime, sessionId) {
  const elapsedSeconds = elapsedTime / 1000;
  const startTime = Math.max(0, Number(globalVideo?.startTime) || 0);
  const endTime = Number.isFinite(Number(globalVideo?.endTime))
    ? Number(globalVideo.endTime)
    : startTime + Math.max(0, Number(globalVideo?.duration) || 0);

  if (elapsedSeconds < startTime || elapsedSeconds > endTime) {
    return null;
  }

  const globalVideoFramesPerSecond = getFramesPerSecondFromValue(globalVideo?.framesPerSecond);
  const localFrameIndex = Math.max(0, Math.round((elapsedSeconds - startTime) * globalVideoFramesPerSecond));
  const frames = Array.isArray(globalVideo?.frames) ? globalVideo.frames : [];
  const frameCandidate = frames[Math.min(localFrameIndex, Math.max(0, frames.length - 1))];

  if (frameCandidate) {
    const absoluteFramePath = resolveAssetAbsolutePath(frameCandidate);
    const resolvedFramePath = resolveExistingOrNearestFramePath(absoluteFramePath);
    if (resolvedFramePath) {
      return resolvedFramePath;
    }
  }

  const globalVideoId = getGlobalVideoId(globalVideo);
  if (!globalVideoId) {
    return null;
  }

  const fallbackFramePath = resolveAssetAbsolutePath(path.join(
    'global_videos',
    'frames',
    sessionId.toString(),
    globalVideoId,
    `${localFrameIndex}.png`
  ));
  return resolveExistingOrNearestFramePath(fallbackFramePath);
}

function drawGlobalVideoImage(ctx, frameImage, globalVideo = {}, canvasDimensions = {}) {
  const width = Number(globalVideo?.dimensions?.width);
  const height = Number(globalVideo?.dimensions?.height);
  const fallbackSize = Math.max(96, Math.round(Math.min(canvasDimensions.width, canvasDimensions.height) * 0.22));
  const drawWidth = clampNumber(Number.isFinite(width) && width > 0 ? width : fallbackSize, 1, canvasDimensions.width);
  const drawHeight = clampNumber(Number.isFinite(height) && height > 0 ? height : fallbackSize, 1, canvasDimensions.height);
  const x = clampNumber(Number(globalVideo?.position?.x) || 0, 0, Math.max(0, canvasDimensions.width - drawWidth));
  const y = clampNumber(Number(globalVideo?.position?.y) || 0, 0, Math.max(0, canvasDimensions.height - drawHeight));
  const shapeOverlay = normalizeGlobalVideoShape(globalVideo?.shape_overlay || globalVideo?.shapeOverlay);

  ctx.save();
  ctx.beginPath();

  if (shapeOverlay === 'circle') {
    const radius = Math.min(drawWidth, drawHeight) / 2;
    ctx.arc(x + drawWidth / 2, y + drawHeight / 2, radius, 0, Math.PI * 2);
  } else if (shapeOverlay === 'oval') {
    ctx.ellipse(x + drawWidth / 2, y + drawHeight / 2, drawWidth / 2, drawHeight / 2, 0, 0, Math.PI * 2);
  } else if (shapeOverlay === 'rounded_rectangle') {
    roundRect(ctx, x, y, drawWidth, drawHeight, Math.min(drawWidth, drawHeight) * 0.12);
  } else {
    ctx.rect(x, y, drawWidth, drawHeight);
  }

  ctx.clip();
  ctx.drawImage(frameImage, x, y, drawWidth, drawHeight);
  ctx.restore();
}

async function drawGlobalVideoOverlays(ctx, globalVideos = [], elapsedTime, canvasDimensions, sessionId) {
  if (!Array.isArray(globalVideos) || globalVideos.length === 0) {
    return;
  }

  for (const globalVideo of globalVideos) {
    const framePath = resolveGlobalVideoFramePath(globalVideo, elapsedTime, sessionId);
    if (!framePath) {
      continue;
    }

    try {
      const frameImage = await loadImage(framePath);
      drawGlobalVideoImage(ctx, frameImage, globalVideo, canvasDimensions);
    } catch (error) {
      console.warn('Skipping global video overlay frame', {
        sessionId,
        globalVideoId: getGlobalVideoId(globalVideo),
        framePath,
        error: error?.message,
      });
    }
  }
}

function resolveNarratorAvatarFramePath(narratorAvatarOverlay = {}, elapsedTime) {
  if (!narratorAvatarOverlay?.enabled) {
    return null;
  }

  const elapsedSeconds = Math.max(0, elapsedTime / 1000);
  let activeOverlay = narratorAvatarOverlay;
  let localElapsedSeconds = elapsedSeconds;

  if (Array.isArray(narratorAvatarOverlay.segments) && narratorAvatarOverlay.segments.length) {
    activeOverlay = narratorAvatarOverlay.segments.find((segment) => {
      const startTime = Math.max(0, Number(segment?.startTime) || 0);
      const endTime = Number.isFinite(Number(segment?.endTime))
        ? Number(segment.endTime)
        : startTime;
      return elapsedSeconds >= startTime && elapsedSeconds <= endTime;
    });
    if (!activeOverlay) {
      return null;
    }
    localElapsedSeconds = Math.max(0, elapsedSeconds - (Number(activeOverlay.startTime) || 0));
  }

  if (!activeOverlay?.framesDir) {
    return null;
  }

  const overlayFramesPerSecond = getFramesPerSecondFromValue(activeOverlay.framesPerSecond);
  const frameIndex = Math.max(0, Math.round(localElapsedSeconds * overlayFramesPerSecond));
  const framePath = path.join(activeOverlay.framesDir, `${frameIndex}.png`);
  return resolveExistingOrNearestFramePath(framePath);
}

function drawImageCover(ctx, image, rect) {
  const imageWidth = Number(image?.width) || 0;
  const imageHeight = Number(image?.height) || 0;
  if (imageWidth <= 0 || imageHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const sourceAspectRatio = imageWidth / imageHeight;
  const targetAspectRatio = rect.width / rect.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = imageWidth;
  let sourceHeight = imageHeight;

  if (sourceAspectRatio > targetAspectRatio) {
    sourceWidth = imageHeight * targetAspectRatio;
    sourceX = (imageWidth - sourceWidth) / 2;
  } else if (sourceAspectRatio < targetAspectRatio) {
    sourceHeight = imageWidth / targetAspectRatio;
    sourceY = (imageHeight - sourceHeight) / 2;
  }

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}

function getNarratorAvatarDrawRect(narratorAvatarOverlay = {}, footerOverlay, canvasDimensions = {}) {
  const { width: canvasWidth, height: canvasHeight } = canvasDimensions;
  const footerLayout = footerOverlay ? getFooterOverlayLayout(canvasDimensions) : null;
  const elapsedSeconds = Number(narratorAvatarOverlay.elapsedSeconds);
  const activeOverlay = Array.isArray(narratorAvatarOverlay.segments) && Number.isFinite(elapsedSeconds)
    ? narratorAvatarOverlay.segments.find((segment) => {
      const startTime = Math.max(0, Number(segment?.startTime) || 0);
      const endTime = Number.isFinite(Number(segment?.endTime))
        ? Number(segment.endTime)
        : startTime;
      return elapsedSeconds >= startTime && elapsedSeconds <= endTime;
    }) || narratorAvatarOverlay
    : narratorAvatarOverlay;
  const sourceWidth = Number(activeOverlay.width) || Number(narratorAvatarOverlay.width) || Math.round(canvasWidth * 0.28);
  const sourceHeight = Number(activeOverlay.height) || Number(narratorAvatarOverlay.height) || Math.round(sourceWidth * 9 / 16);
  const sourceAspectRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;

  let drawHeight;
  let drawWidth;

  if (footerLayout) {
    const maxHeight = Math.max(1, Math.round(footerLayout.footerHeight));
    const maxWidth = Math.max(1, Math.round(canvasWidth * 0.42));
    drawWidth = maxWidth;
    drawHeight = Math.max(1, Math.round(drawWidth / sourceAspectRatio));

    if (drawHeight > maxHeight) {
      drawHeight = maxHeight;
      drawWidth = Math.max(1, Math.round(drawHeight * sourceAspectRatio));
    }
  } else {
    drawHeight = Math.round(clampNumber(canvasHeight * 0.18, 140, canvasHeight * 0.24));
    drawWidth = Math.max(1, Math.round(drawHeight * sourceAspectRatio));
    const maxWidth = canvasWidth * 0.42;
    if (drawWidth > maxWidth) {
      drawWidth = Math.round(maxWidth);
      drawHeight = Math.max(1, Math.round(drawWidth / sourceAspectRatio));
    }
  }

  const x = Math.round((canvasWidth - drawWidth) / 2);
  const y = footerLayout
    ? Math.round(footerLayout.y + (footerLayout.footerHeight - drawHeight) / 2)
    : Math.round(canvasHeight - drawHeight - clampNumber(canvasHeight * 0.035, 24, 64));

  return { x, y, width: drawWidth, height: drawHeight };
}

async function drawNarratorAvatarOverlay(
  ctx,
  narratorAvatarOverlay = null,
  footerOverlay = null,
  canvasDimensions = {},
  elapsedTime,
  sessionId,
) {
  const framePath = resolveNarratorAvatarFramePath(narratorAvatarOverlay, elapsedTime);
  if (!framePath) {
    return;
  }

  try {
    const frameImage = await loadImage(framePath);
    const rect = getNarratorAvatarDrawRect(
      { ...narratorAvatarOverlay, elapsedSeconds: Math.max(0, elapsedTime / 1000) },
      footerOverlay,
      canvasDimensions,
    );
    ctx.save();
    if (footerOverlay) {
      const footerLayout = getFooterOverlayLayout(canvasDimensions);
      ctx.beginPath();
      ctx.rect(0, footerLayout.y, footerLayout.footerWidth, footerLayout.footerHeight);
      ctx.clip();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = Math.round(Math.min(canvasDimensions.width, canvasDimensions.height) * 0.012);
      ctx.shadowOffsetY = Math.max(2, Math.round(Math.min(canvasDimensions.width, canvasDimensions.height) * 0.004));
    }
    if (footerOverlay) {
      ctx.drawImage(frameImage, rect.x, rect.y, rect.width, rect.height);
    } else {
      drawImageCover(ctx, frameImage, rect);
    }
    ctx.restore();
  } catch (error) {
    console.warn('Skipping narrator avatar overlay frame', {
      sessionId,
      framePath,
      error: error?.message || error,
    });
  }
}

function normalizeFooterMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const url = typeof value.url === 'string' && value.url.trim()
    ? value.url.trim()
    : typeof value.cta_url === 'string' && value.cta_url.trim()
      ? value.cta_url.trim()
      : typeof value.ctaUrl === 'string' && value.ctaUrl.trim()
        ? value.ctaUrl.trim()
        : '';
  const title = typeof value.title === 'string' && value.title.trim()
    ? value.title.trim()
    : typeof value.cta_text === 'string' && value.cta_text.trim()
      ? value.cta_text.trim()
      : typeof value.ctaText === 'string' && value.ctaText.trim()
        ? value.ctaText.trim()
        : typeof value.text === 'string' && value.text.trim()
          ? value.text.trim()
          : '';
  const logoUrl = typeof value.logoUrl === 'string' && value.logoUrl.trim()
    ? value.logoUrl.trim()
    : typeof value.cta_logo === 'string' && value.cta_logo.trim()
      ? value.cta_logo.trim()
      : typeof value.ctaLogo === 'string' && value.ctaLogo.trim()
        ? value.ctaLogo.trim()
        : typeof value.logo_url === 'string' && value.logo_url.trim()
          ? value.logo_url.trim()
          : typeof value.footer_logo_url === 'string' && value.footer_logo_url.trim()
            ? value.footer_logo_url.trim()
            : '';
  const logoImagePath = typeof value.logoImagePath === 'string' && value.logoImagePath.trim()
    ? value.logoImagePath.trim()
    : typeof value.footerLogoImagePath === 'string' && value.footerLogoImagePath.trim()
      ? value.footerLogoImagePath.trim()
      : typeof value.footer_logo_image_path === 'string' && value.footer_logo_image_path.trim()
        ? value.footer_logo_image_path.trim()
        : '';

  if (!url && !title && !logoUrl && !logoImagePath) {
    return null;
  }

  return {
    ...(url ? { url, ctaUrl: url } : {}),
    ...(title ? { title, ctaText: title } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(logoImagePath ? { logoImagePath, footerLogoImagePath: logoImagePath } : {}),
  };
}

function resolveFooterLogoSource(layer, footerMetadata) {
  const candidates = [
    layer.footerLogoImagePath,
    layer.footer_logo_image_path,
    footerMetadata?.logoImagePath,
    footerMetadata?.footerLogoImagePath,
    layer.footerLogoUrl,
    footerMetadata?.logoUrl,
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (!value) {
      continue;
    }
    if (value.startsWith('data:image') || value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }
    const absolutePath = resolveAssetAbsolutePath(value);
    if (absolutePath && fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  return null;
}

async function loadFooterOverlayForLayer(layer = {}, sessionId, layerId) {
  if (layer?.addFooterAnimation !== true) {
    return null;
  }

  const footerMetadata = normalizeFooterMetadata(layer.footerMetadata ?? layer.footer_metadata);
  const qrImagePath = layer.footerQrImagePath ?? layer.footer_qr_image_path;
  const qrAbsolutePath = footerMetadata?.url ? resolveAssetAbsolutePath(qrImagePath) : null;

  if (!footerMetadata) {
    console.warn('Footer animation requested but footer metadata is unavailable', {
      sessionId,
      layerId,
      qrImagePath,
    });
    return null;
  }

  try {
    let qrImage = null;
    if (footerMetadata.url) {
      if (!qrAbsolutePath || !fs.existsSync(qrAbsolutePath)) {
        console.warn('Footer animation requested but QR image is unavailable', {
          sessionId,
          layerId,
          hasFooterMetadata: Boolean(footerMetadata),
          qrImagePath,
        });
      } else {
        qrImage = await loadImage(qrAbsolutePath);
      }
    }

    let logoImage = null;
    const logoSource = resolveFooterLogoSource(layer, footerMetadata);
    if (logoSource) {
      logoImage = await loadImage(logoSource);
    }

    if (!footerMetadata.title && !qrImage && !logoImage) {
      return null;
    }

    return {
      title: footerMetadata.title,
      url: footerMetadata.url,
      qrImage,
      logoImage,
    };
  } catch (error) {
    console.warn('Failed to load footer image asset', {
      sessionId,
      layerId,
      qrImagePath,
      error: error?.message || error,
    });
    return null;
  }
}



// Ensure required fonts are loaded into Pango before any rendering
ensureFontsRegistered();


process.on('message', async (data) => {
  // If there's a "CANCEL" type, handle gracefully:
  if (data.type === 'CANCEL') {
    // Just do any cleanup needed, then exit or return
    console.warn('Received CANCEL message. Exiting child process gracefully...');
    process.exit(0);
    return;
  }

  if (data.type === 'START') {
    try {
      const {
        generationId,
        layer,
        sessionId,
        startFrame,
        endFrame,
        canvasDimensions,
        applyAudioVisualizer,
        visualizerData,
        totalVideoDuration,
        framesPerSecond: payloadFramesPerSecond,
        globalVideos = [],
        narratorAvatarOverlay = null,
      } = data;

      framesPerSecond = getFramesPerSecondFromValue(payloadFramesPerSecond);
      frameDuration = 1000 / framesPerSecond;

      const framesList = await generateFrames(
        generationId,
        layer,
        sessionId,
        startFrame,
        endFrame,
        canvasDimensions,
        applyAudioVisualizer,
        visualizerData,
        totalVideoDuration,
        globalVideos,
        narratorAvatarOverlay,
      );

      safeSend({ status: 'COMPLETED', framesList });
      // Once done, you can optionally exit
      process.exit(0);

    } catch (error) {
      let status = 'ERROR';
      let errorMessage = error.message;

      if (errorMessage.startsWith('CANCELLED')) {
        status = 'CANCELLED';
        errorMessage = errorMessage.slice('CANCELLED: '.length);
      } else if (errorMessage.startsWith('FAILED')) {
        status = 'FAILED';
        errorMessage = errorMessage.slice('FAILED: '.length);
      }

      console.error(`Child process error:`, error);

      // Attempt to notify parent
      try {
        safeSend({ status, error: errorMessage });
      } catch (sendError) {
        console.error('Error sending message to parent:', sendError);
      }
      // Do NOT kill the entire process. Just exit child.
      process.exit(0);
    }
  }
});

// A safe send function that won't throw if parent is disconnected
function safeSend(msg) {
  if (!process.connected) {
    console.warn('Parent disconnected; ignoring send.');
    return;
  }
  try {
    process.send(msg);
  } catch (err) {
    if (err.code === 'EPIPE') {
      console.warn('Got EPIPE; parent is gone.');
    } else {
      console.error('Error sending message:', err);
    }
  }
}

// If the parent forcibly disconnects, just exit the child
process.on('disconnect', () => {
  console.error(`Parent disconnected. Child process will exit.`);
  process.exit(0);
});



function getAudioFrameIndex(elapsedTime, totalVideoDuration, totalAudioFrames) {
  const audioFrameIndex = Math.floor((elapsedTime / totalVideoDuration) * totalAudioFrames);
  return Math.min(audioFrameIndex, totalAudioFrames - 1); // Ensure index is within bounds
}

async function generateFrames(generationId, layer, sessionId, startFrame, endFrame,
  canvasDimensions, applyAudioVisualizer = false, visualizerData, totalVideoDuration, globalVideos = [], narratorAvatarOverlay = null) {

  const { imageSession, duration, durationOffset, _id, hasAiVideoLayer, aiVideoLayer,
    hasLipSyncVideoLayer,
    hasSoundEffectVideoLayer,
    hasUserVideoLayer,
  } = layer;

  let processAiVideoLayer = false;

  if (hasAiVideoLayer || hasLipSyncVideoLayer || hasSoundEffectVideoLayer || hasUserVideoLayer) {
    // Handle AI video layer


    processAiVideoLayer = true;

  } else {



    if (imageSession.generationStatus === 'PENDING' || imageSession.editStatus === 'PENDING') {
      console.error(`Image session not complete for layer ${layer._id} in session ${sessionId}`);
      return [];
    }
  }
  const layerId = _id.toString();
  const activeItemList = imageSession.activeItemList;
  const footerOverlay = await loadFooterOverlayForLayer(layer, sessionId, layerId);

  if (processAiVideoLayer) {

    // Handle AI video layer
  } else {



    if (!activeItemList || activeItemList.length === 0) {
      console.error(`No active items in image session for layer ${layer._id} in session ${sessionId}`);

      const layerId = _id.toString();
      const frameNameSpace = path.join('video', 'frames', sessionId, layerId);
      const frameFileBasePath = resolveAssetWritePath('video', 'frames', sessionId, layerId);


      if (!fs.existsSync(frameFileBasePath)) {
        fs.mkdirSync(frameFileBasePath, { recursive: true });
      }

      const framesList = [];

      // Create a blank canvas using the given dimensions
      const blankCanvas = createCanvas(canvasDimensions.width, canvasDimensions.height);
      const blankCtx = blankCanvas.getContext('2d');

      // Fill the canvas with the background color
      blankCtx.fillStyle = '#1f2937';
      blankCtx.fillRect(0, 0, canvasDimensions.width, canvasDimensions.height);

      // Generate blank frames for the entire frame range
      for (let frame = startFrame; frame < endFrame; frame++) {
        blankCtx.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height);
        blankCtx.fillStyle = '#1f2937';
        blankCtx.fillRect(0, 0, canvasDimensions.width, canvasDimensions.height);
        const elapsedTime = frame * frameDuration + durationOffset * 1000;
        if (footerOverlay) {
          drawFooterOverlay(blankCtx, footerOverlay, canvasDimensions, elapsedTime, duration, durationOffset);
        }
        await drawGlobalVideoOverlays(blankCtx, globalVideos, elapsedTime, canvasDimensions, sessionId);
        await drawNarratorAvatarOverlay(
          blankCtx,
          narratorAvatarOverlay,
          footerOverlay,
          canvasDimensions,
          elapsedTime,
          sessionId,
        );
        const buffer = blankCanvas.toBuffer('image/png');
        const imageName = `/${frameNameSpace}/${frame}.png`;
        framesList.push(imageName);

        fs.writeFileSync(path.join(frameFileBasePath, `${frame}.png`), buffer);
      }

      process.send({
        status: 'COMPLETED',
        framesList,
      });

      return framesList;
    }


  }

  const frameNameSpace = path.join('video', 'frames', sessionId, layerId);
  const frameFileBasePath = resolveAssetWritePath('video', 'frames', sessionId, layerId);

  if (!fs.existsSync(frameFileBasePath)) {
    fs.mkdirSync(frameFileBasePath, { recursive: true });
  }

  const framesList = [];

  // Preload all images
  const images = {};
  await Promise.all(activeItemList.map(async (item) => {
    if (item.type === 'image') {

      let itemSrc;

      if (item.editStatus === 'COMPLETED') {
        itemSrc = item.activeEditedImage;
      } else {
        if (item.src) {
          itemSrc = item.src;
        } else {
          itemSrc = item.activeSelectedImage;


        }
      }


      const originalImagePath = resolveAssetAbsolutePath(itemSrc);



      const resolvedImagePath = resolveExistingOrNearestFramePath(originalImagePath);
      if (!resolvedImagePath) {
        console.warn('Skipping missing image asset during frame preload', {
          requestedPath: originalImagePath,
          sessionId,
          layerId,
          itemId: item?.id ?? null,
        });
        return;
      }

      images[item.src] = await loadImage(resolvedImagePath);
    }
  }));

  let videoImages = {};
  let videoImageFolderPath = null;
  let prefersAudioVideoFrames = false;

  if (hasAiVideoLayer || hasLipSyncVideoLayer || hasSoundEffectVideoLayer || hasUserVideoLayer) {
    const baseVideoImageFolderPath = resolveAssetWritePath('ai_video', 'frames', `${sessionId}`, `${layerId}`);
    const legacyBaseVideoImageFolderPath = path.join(
      resolveAssetsRoot('legacy'),
      'ai_video',
      'frames',
      `${sessionId}`,
      `${layerId}`
    );

    prefersAudioVideoFrames = hasLipSyncVideoLayer || hasSoundEffectVideoLayer;
    const audioVideoImageFolderPath = path.join(baseVideoImageFolderPath, 'audio_video');
    const legacyAudioVideoImageFolderPath = path.join(legacyBaseVideoImageFolderPath, 'audio_video');

    if (prefersAudioVideoFrames) {
      // Lip-sync/sound-effect outputs replace base AI-video frames for rendering.
      const hasAudioVideoFramesFolder = fs.existsSync(audioVideoImageFolderPath);
      const hasLegacyAudioVideoFramesFolder = fs.existsSync(legacyAudioVideoImageFolderPath);
      videoImageFolderPath = hasAudioVideoFramesFolder
        ? audioVideoImageFolderPath
        : hasLegacyAudioVideoFramesFolder
          ? legacyAudioVideoImageFolderPath
          : audioVideoImageFolderPath;
    } else {
      videoImageFolderPath = fs.existsSync(baseVideoImageFolderPath)
        ? baseVideoImageFolderPath
        : legacyBaseVideoImageFolderPath;
    }

  }

  const canvas = createCanvas(canvasDimensions.width, canvasDimensions.height);
  const ctx = canvas.getContext('2d');

  const canvasAnimations = imageSession.canvasAnimations || [];

  // Precompute audio frame indices for each video frame if audio visualizer is applied
  let audioFrameIndices = [];
  if (applyAudioVisualizer && visualizerData) {

    const totalAudioFrames = visualizerData[0].length; // Assuming visualizerData is an array of arrays [frequencyBins][audioFrames]
    for (let frame = startFrame; frame < endFrame; frame++) {
      const elapsedTime = frame * frameDuration + durationOffset * 1000;
      const audioFrameIndex = getAudioFrameIndex(elapsedTime, totalVideoDuration, totalAudioFrames);
      audioFrameIndices.push(audioFrameIndex);
    }
  }

  for (let frame = startFrame; frame < endFrame; frame++) {
    try {
      // Get the audio frame index for this frame if applicable
      let audioFrameData = null;

      if (applyAudioVisualizer && visualizerData) {
        const audioFrameIndex = audioFrameIndices[frame - startFrame];

        // Extract frequency data for this audio frame
        audioFrameData = visualizerData.map((freqArray) => freqArray[audioFrameIndex]);
      }

      await processFrameAtIndex(
        canvas,
        frame,
        images,
        ctx,
        layer,
        framesList,
        durationOffset,
        duration,
        frameNameSpace,
        frameFileBasePath,
        processAiVideoLayer,
        videoImageFolderPath,
        prefersAudioVideoFrames,
        canvasDimensions,
        canvasAnimations,
        applyAudioVisualizer,
        audioFrameData,
        sessionId,
        footerOverlay,
        globalVideos,
        narratorAvatarOverlay,
      );

      // No need to check for file existence here since errors are handled inside processFrameAtIndex
    } catch (error) {
      console.error(`Unexpected error processing frame ${frame} for layer ${layer._id} in session ${sessionId}:`, error);
      // Optionally handle unexpected errors here
    }
  }

  if (framesList.length === 0) {
    console.error(`No frames generated for layer ${layer._id} in session ${sessionId}`);
    process.send({ status: 'CANCELLED', framesList: [] });
    return [];
  }

  return framesList;
}


async function processFrameAtIndex(
  canvas,
  frame,
  images,
  ctx,
  layer,
  framesList,
  durationOffset,
  duration,
  frameNameSpace,
  frameFileBasePath,
  processAiVideoLayer,
  videoImageFolderPath,
  prefersAudioVideoFrames,
  canvasDimensions,
  canvasAnimations,
  applyAudioVisualizer = false,
  audioFrameData = null,
  sessionId,
  footerOverlay = null,
  globalVideos = [],
  narratorAvatarOverlay = null,
) {

  const layerId = layer._id.toString();


  try {
    const elapsedTime = frame * frameDuration + durationOffset * 1000;

    const activeItemList = layer.imageSession.activeItemList;
    const { clipStart, clipStartFrames, clipEnd, clipEndFrames } = layer;

    // Clear and save the context
    ctx.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height);
    ctx.save();

    // Apply any canvas-level transformations/animations (camera moves, etc.)
    applyCanvasTransformations(ctx, canvasAnimations, elapsedTime, duration, durationOffset, canvasDimensions);

    // ------------------------------
    // Updated: AI video clipping logic
    // ------------------------------
    if (processAiVideoLayer && videoImageFolderPath) {


      // Calculate the effective frame by applying clipStart offset
      const clipStartFrameOffset = clipStart && clipStartFrames && clipStartFrames > 0
        ? clipStartFrames
        : 0;
      const effectiveFrame = frame + clipStartFrameOffset;

      // Decide if we skip the frame due to clipEnd
      let skipFrame = false;
      if (clipEnd && clipEndFrames && clipEndFrames > 0) {


        // If the current frame is at or beyond the threshold, skip drawing video
        const skipThreshold = layer.endFrame - clipEndFrames;
        if (frame >= skipThreshold) {
          skipFrame = true;
        }
      }

      if (!skipFrame) {
        // Attempt to load the corresponding AI video frame
        const baseVideoFramePath = path.join(videoImageFolderPath, `${effectiveFrame}.png`);
        const resolvedBaseVideoFramePath = prefersAudioVideoFrames
          ? resolveExistingOrTailFramePath(baseVideoFramePath)
          : resolveExistingOrNearestFramePath(baseVideoFramePath);
        if (resolvedBaseVideoFramePath) {
          const videoFrameImage = await loadImage(resolvedBaseVideoFramePath);
          ctx.drawImage(videoFrameImage, 0, 0, canvasDimensions.width, canvasDimensions.height);
        } else {
          // check if we have active item list image
          const activeItemListImage = activeItemList.find(item => item.type === 'image');
          if (activeItemListImage) {


              const frameNameSpace = path.join('video', 'frames', sessionId, layerId);
              const frameFileBasePath = resolveAssetWritePath('video', 'frames', sessionId, layerId);



              const buffer = canvas.toBuffer('image/png');
              const imgName = `/${frameNameSpace}/${frame}.png`;
              framesList.push(imgName);
              fs.writeFileSync(path.join(frameFileBasePath, `${frame}.png`), buffer);


          } else {

            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvasDimensions.width, canvasDimensions.height);
          }

        }
      } else {


        // check if we have active item list image
        const activeItemListImage = activeItemList.find(item => item.type === 'image');
        if (activeItemListImage) {

          const frameNameSpace = path.join('video', 'frames', sessionId, layerId);
          const frameFileBasePath = resolveAssetWritePath('video', 'frames', sessionId, layerId);

          const buffer = canvas.toBuffer('image/png');
          const imgName = `/${frameNameSpace}/${frame}.png`;
          framesList.push(imgName);
          fs.writeFileSync(path.join(frameFileBasePath, `${frame}.png`), buffer);
        } else {
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, canvasDimensions.width, canvasDimensions.height);
        }
      }
    }

    // Now render the layer's items (images, shapes, text, etc.) on top
    const { clipStart: _, clipStartFrames: __, clipEnd: ___, clipEndFrames: ____, ...rest } = layer;
    const activeItemsForFrame = selectActiveItemsForFrame(activeItemList, frame, {
      durationOffsetFrames: durationOffset * framesPerSecond,
    });
    activeItemsForFrame.forEach(item => {
      renderActiveItem(ctx, item, images, elapsedTime, duration, durationOffset, canvasDimensions);
    });

    // Restore to pre-canvas-transformation state
    ctx.restore();

    // Apply any final canvas-wide effects (glitch, snowfall, etc.)
    applyCanvasEffects(ctx, canvasAnimations, elapsedTime, duration, durationOffset, canvasDimensions);

    // If audio visualizer is enabled, draw it on top
    if (applyAudioVisualizer && audioFrameData) {
      drawAudioVisualizer(ctx, audioFrameData, canvasDimensions);
    }

    if (footerOverlay) {
      drawFooterOverlay(ctx, footerOverlay, canvasDimensions, elapsedTime, duration, durationOffset);
    }

    await drawGlobalVideoOverlays(ctx, globalVideos, elapsedTime, canvasDimensions, sessionId);
    await drawNarratorAvatarOverlay(ctx, narratorAvatarOverlay, footerOverlay, canvasDimensions, elapsedTime, sessionId);

    // Save the composed frame
    const buffer = canvas.toBuffer('image/png');
    const imageName = `/${frameNameSpace}/${frame}.png`;
    framesList.push(imageName);

    // Make sure the directory exists, then write the frame
    if (!fs.existsSync(frameFileBasePath)) {
      fs.mkdirSync(frameFileBasePath, { recursive: true });
    }
    fs.writeFileSync(path.join(frameFileBasePath, `${frame}.png`), buffer);

  } catch (error) {
    console.error(`Error processing frame ${frame}:`, error);
    console.warn('Falling back to a blank frame for this index.');

    // Fallback: create and save a blank frame if there's any error
    ctx.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height);
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvasDimensions.width, canvasDimensions.height);
    const elapsedTime = frame * frameDuration + durationOffset * 1000;
    if (footerOverlay) {
      drawFooterOverlay(ctx, footerOverlay, canvasDimensions, elapsedTime, duration, durationOffset);
    }
    await drawGlobalVideoOverlays(ctx, globalVideos, elapsedTime, canvasDimensions, sessionId);
    await drawNarratorAvatarOverlay(ctx, narratorAvatarOverlay, footerOverlay, canvasDimensions, elapsedTime, sessionId);

    const buffer = canvas.toBuffer('image/png');
    const imageName = `/${frameNameSpace}/${frame}.png`;
    framesList.push(imageName);

    if (!fs.existsSync(frameFileBasePath)) {
      fs.mkdirSync(frameFileBasePath, { recursive: true });
    }
    fs.writeFileSync(path.join(frameFileBasePath, `${frame}.png`), buffer);
  }
}



function roundRect(ctx, x, y, width, height, radius) {
  if (width < 2 * radius) radius = width / 2;
  if (height < 2 * radius) radius = height / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawAudioVisualizer(ctx, frequencyData, canvasDimensions) {
  // Normalize the frequency data
  const minDb = -80; // Adjust based on your data
  const maxDb = -20; // Adjust to control sensitivity
  const normalizedData = frequencyData.map((value) => (value - minDb) / (maxDb - minDb));
  const clampedData = normalizedData.map((value) => Math.max(0, Math.min(1, value)));

  // Visualizer settings
  const { width: canvasWidth, height: canvasHeight } = canvasDimensions;
  const visualizerHeight = canvasHeight * 0.08; // 12% of canvas height
  const visualizerWidth = canvasWidth * 0.25; // 40% of canvas width
  const visualizerX = (canvasWidth - visualizerWidth) / 2;
  const visualizerY = canvasHeight - visualizerHeight - 50; // 50px from bottom

  const barWidth = visualizerWidth / clampedData.length;
  const maxBarHeight = visualizerHeight;

  // Create neon gradient for bars
  const gradient = ctx.createLinearGradient(0, visualizerY, 0, visualizerY + maxBarHeight);
  gradient.addColorStop(0, '#0ff'); // Neon Cyan at the top
  gradient.addColorStop(1, '#f0f'); // Neon Magenta at the bottom

  ctx.fillStyle = gradient;

  // Set shadow properties for neon glow effect
  ctx.shadowColor = 'rgba(255, 0, 255, 0.6)'; // Neon Magenta glow
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Draw bars
  for (let i = 0; i < clampedData.length; i++) {
    const value = clampedData[i];
    const barHeight = value * maxBarHeight;

    const x = visualizerX + i * barWidth + barWidth * 0.1; // Add spacing
    const y = visualizerY + (maxBarHeight - barHeight);

    // Draw bar with rounded corners using the helper function
    roundRect(ctx, x, y, barWidth * 0.8, barHeight, 5); // 80% width, corner radius 5
    ctx.fill();
  }

  // Reset shadow properties
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function truncateTextToWidth(ctx, text, maxWidth) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText || ctx.measureText(normalizedText).width <= maxWidth) {
    return normalizedText;
  }

  let candidate = normalizedText;
  while (candidate.length > 0 && ctx.measureText(`${candidate}...`).width > maxWidth) {
    candidate = candidate.slice(0, -1).trimEnd();
  }

  return candidate ? `${candidate}...` : '';
}

function wrapTextToLines(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines <= 0) {
    return [];
  }

  const lines = [];
  let currentLine = '';

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      lines.push(truncateTextToWidth(ctx, word, maxWidth));
      currentLine = '';
    }

    if (lines.length === maxLines) {
      const remainingText = [currentLine, ...words.slice(index + 1)].filter(Boolean).join(' ');
      lines[maxLines - 1] = truncateTextToWidth(ctx, `${lines[maxLines - 1]} ${remainingText}`, maxWidth);
      return lines;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(truncateTextToWidth(ctx, currentLine, maxWidth));
  }

  return lines.slice(0, maxLines);
}

function getFooterOverlayLayout(canvasDimensions = {}) {
  const { width: canvasWidth, height: canvasHeight } = canvasDimensions;
  const referenceSide = Math.min(canvasWidth, canvasHeight);
  const footerHeight = Math.round(clampNumber(
    canvasHeight * 0.2,
    referenceSide * 0.16,
    referenceSide * 0.28,
  ));
  const footerWidth = canvasWidth;
  const y = canvasHeight - footerHeight;
  return {
    canvasWidth,
    canvasHeight,
    referenceSide,
    footerHeight,
    footerWidth,
    y,
  };
}

function drawFooterOverlay(ctx, footerOverlay, canvasDimensions, elapsedTime, duration, durationOffset) {
  if (!footerOverlay?.qrImage && !footerOverlay?.title && !footerOverlay?.logoImage) {
    return null;
  }

  const {
    canvasWidth,
    referenceSide,
    footerHeight,
    footerWidth,
    y,
  } = getFooterOverlayLayout(canvasDimensions);
  const horizontalPadding = Math.round(clampNumber(referenceSide * 0.032, 28, 48));
  const hasQr = Boolean(footerOverlay.qrImage);
  const qrSectionWidth = hasQr
    ? Math.round(Math.min(footerHeight, footerWidth * 0.2))
    : 0;
  const qrInnerPadding = Math.round(clampNumber(footerHeight * 0.12, 12, 22));
  const qrSize = hasQr
    ? Math.round(Math.max(
      1,
      Math.min(
        qrSectionWidth - qrInnerPadding * 2,
        clampNumber(referenceSide * 0.24, 170, 240),
      ),
    ))
    : 0;
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = 'rgba(5, 8, 15, 0.60)';
  ctx.fillRect(0, y, footerWidth, footerHeight);

  const qrSectionX = footerWidth - qrSectionWidth;
  const qrX = qrSectionX + Math.round((qrSectionWidth - qrSize) / 2);
  const qrY = y + qrInnerPadding;
  const qrSectionLeft = hasQr
    ? Math.max(0, qrSectionX - horizontalPadding)
    : footerWidth - horizontalPadding;

  if (hasQr) {
    ctx.drawImage(
      footerOverlay.qrImage,
      qrX,
      qrY,
      qrSize,
      qrSize,
    );
  }

  const textX = horizontalPadding;
  const textMaxWidth = Math.max(120, qrSectionLeft - horizontalPadding - textX);
  const fontSize = Math.round(clampNumber(referenceSide * 0.04, 30, 48));
  const lineHeight = Math.round(fontSize * 1.12);
  const title = footerOverlay.title || '';
  const lines = title ? wrapTextToLines(ctx, title, textMaxWidth, 2) : [];
  const logoImage = footerOverlay.logoImage;
  const maxLogoWidth = Math.max(1, Math.min(textMaxWidth, canvasWidth * 0.18, referenceSide * 0.28));
  const maxLogoHeight = Math.max(1, Math.min(footerHeight * 0.26, referenceSide * 0.07));
  let logoWidth = 0;
  let logoHeight = 0;

  if (logoImage?.width && logoImage?.height) {
    const logoScale = Math.min(
      maxLogoWidth / logoImage.width,
      maxLogoHeight / logoImage.height,
      1,
    );
    logoWidth = Math.max(1, Math.round(logoImage.width * logoScale));
    logoHeight = Math.max(1, Math.round(logoImage.height * logoScale));
  }

  const textBlockHeight = lines.length > 0 ? lines.length * lineHeight : 0;
  const stackGap = lines.length > 0 && logoHeight > 0
    ? Math.max(6, Math.round(referenceSide * 0.007))
    : 0;
  const contentHeight = textBlockHeight + stackGap + logoHeight;
  let cursorY = y + Math.max(0, (footerHeight - contentHeight) / 2);

  ctx.fillStyle = 'rgba(248, 250, 252, 0.94)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.58)';
  ctx.shadowBlur = Math.round(referenceSide * 0.006);
  ctx.shadowOffsetY = Math.max(1, Math.round(referenceSide * 0.0025));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${fontSize}px "Poppins", "Montserrat", "Arial", sans-serif`;

  if (lines.length > 0) {
    const firstBaseline = cursorY + lineHeight / 2;
    lines.forEach((line, index) => {
      ctx.fillText(line, textX, firstBaseline + index * lineHeight);
    });
    cursorY += textBlockHeight + stackGap;
  }

  if (logoImage && logoWidth > 0 && logoHeight > 0) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(logoImage, textX, cursorY, logoWidth, logoHeight);
  }

  ctx.restore();
  return getFooterOverlayLayout(canvasDimensions);
}



function applyCanvasTransformations(ctx, canvasAnimations, elapsedTime, duration, durationOffset, canvasDimensions) {

  // Initialize transformations
  let cumulativeTranslateX = 0;
  let cumulativeTranslateY = 0;

  // Variables for orbit
  let orbitApplied = false;
  let orbitTranslateX = 0;
  let orbitTranslateY = 0;

  // Collect transformations
  if (canvasAnimations) {

    canvasAnimations.forEach(animation => {
      const { type, params, frameOffset, frameDuration } = animation;

      // Ignore 'zoom' transformations
      if (type === 'zoom' || type === 'scale') {
        return; // Skip to the next animation
      }

      // Determine animation start and end times
      let startTime = frameOffset !== undefined ? (frameOffset * (1000 / framesPerSecond)) : 0;
      let endTime = frameDuration !== undefined
        ? startTime + (frameDuration * (1000 / framesPerSecond))
        : duration * 1000;

      const animationElapsed = elapsedTime - startTime;
      const totalDuration = endTime - startTime;

      // Process animation if within time boundaries
      if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
        const t = animationElapsed / totalDuration; // Linear easing

        switch (type) {
          case 'sway':
            {
              const { amplitude, frequency } = params;
              const swayValue = amplitude * Math.sin(2 * Math.PI * frequency * (elapsedTime / 1000));
              cumulativeTranslateX += swayValue;
            }
            break;

          case 'slide':
            {
              const { startX, endX, startY, endY } = params;
              const translateXValue = startX + (endX - startX) * t;
              const translateYValue = startY + (endY - startY) * t;
              cumulativeTranslateX += translateXValue;
              cumulativeTranslateY += translateYValue;
            }
            break;

          case 'orbit':
            {
              orbitApplied = true;
              const {
                startAngle: orbitStartAngle,
                endAngle: orbitEndAngle,
                radius,
              } = params;

              let currentAngle = orbitStartAngle + (orbitEndAngle - orbitStartAngle) * t;
              currentAngle = ((currentAngle % 360) + 360) % 360; // Normalize angle

              // Convert to radians
              const orbitRadians = (currentAngle * Math.PI) / 180;

              // Calculate orbit translation relative to origin (center of canvas)
              orbitTranslateX = radius * Math.cos(orbitRadians);
              orbitTranslateY = radius * Math.sin(orbitRadians);
            }
            break;

          default:
            break;
        }
      }
    });
  }

  // Apply transformations in the correct order
  ctx.save(); // Save the initial context state

  // Step 1: Translate to the center of the canvas
  ctx.translate(canvasDimensions.width / 2, canvasDimensions.height / 2);

  // Step 2: Apply orbit translation
  if (orbitApplied) {
    ctx.translate(orbitTranslateX, orbitTranslateY);
  }



  // Step 4: Apply cumulative translations (sway and slide)
  ctx.translate(cumulativeTranslateX, cumulativeTranslateY);

  // Step 5: Translate back to the top-left corner before drawing
  ctx.translate(-canvasDimensions.width / 2, -canvasDimensions.height / 2);
}


function applyCanvasEffects(ctx, canvasAnimations, elapsedTime, duration, durationOffset, canvasDimensions) {
  if (!canvasAnimations) return;

  canvasAnimations.forEach(animation => {
    const { type, params, frameOffset, frameDuration } = animation;

    // Only apply effects, not transformations
    if (['glitch', 'snowfall', 'light_transition', 'hologram', 'nebula', 'particle', 'bloom', 'lens_flare'].includes(type)) {
      // Determine animation start and end times
      let startTime, endTime;

      if (frameOffset !== undefined && frameDuration !== undefined) {



        const durationOffsetEffective = durationOffset * 1000;
        startTime = (frameOffset * (1000 / framesPerSecond));
        endTime = startTime + (frameDuration * (1000 / framesPerSecond));
      } else {
        // Use default layer duration
        startTime = durationOffset * 1000;
        endTime = startTime + duration * 1000;
      }

      const animationElapsed = elapsedTime - startTime;
      const totalDuration = endTime - startTime;

      // Only process animation if current time is within animation boundaries
      if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
        const t = animationElapsed / totalDuration; // Linear easing

        switch (type) {
          case 'glitch':
            // Implement enhanced glitch effect
            const glitchParams = params;
            const {
              intensity,
              rgbSplit = true,
              noise = true,
              displacement = true,
              scanLines = true,
              glitchDuration = 100,    // Default glitch duration in ms
              glitchFrequency = 2      // Default glitches per second
            } = glitchParams;

            // Calculate whether to apply glitch based on frequency and duration
            const glitchInterval = 1000 / glitchFrequency; // Time between glitches in ms
            const timeSinceGlitchStart = animationElapsed % glitchInterval;

            if (timeSinceGlitchStart <= glitchDuration) {
              // Apply glitch effects
              if (rgbSplit) {
                applyRGBSplit(ctx, intensity);
              }

              if (noise) {
                applyNoiseOverlay(ctx, intensity);
              }

              if (displacement) {
                applyDisplacementShifts(ctx, intensity);
              }

              if (scanLines) {
                applyScanLineDisturbances(ctx, intensity);
              }
            }
            break;

          case 'snowfall':
            // Apply snowfall effect
            applySnowfallEffect(ctx, params, t);
            break;

          case 'light_transition':
            // Apply light transition effect
            applyLightTransitionEffect(ctx, params, t);
            break;

          case 'hologram':
            applyHologramEffect(ctx, params, t);
            break;

          case 'nebula':
            applyNebulaEffect(ctx, params, t);
            break;

          case 'particle':
            applyParticleEffect(ctx, params, t);
            break;

          case 'bloom':
            applyBloomEffect(ctx, params, t);
            break;

          case 'lens_flare':
            applyLensFlareEffect(ctx, params, t);
            break;

          default:
            break;
        }
      }
    }
  });
}

// Helper that returns the alpha for "fade" animations at a given elapsedTime
function getFadeAlpha(item, elapsedTime, duration, durationOffset) {
  let alpha = 1.0; // Default to fully opaque if no fade animations

  if (!item.animations) return alpha;

  item.animations.forEach((animation) => {
    if (animation.type === 'fade') {
      const { startFade = 100, endFade = 100 } = animation.params;

      // Calculate startTime & endTime in ms from frameOffset/frameDuration
      let startTime, endTime;
      if (
        animation.frameOffset !== undefined &&
        animation.frameDuration !== undefined
      ) {
        const offsetMs = durationOffset * 1000;
        startTime = offsetMs + animation.frameOffset * (1000 / framesPerSecond);
        endTime = startTime + animation.frameDuration * (1000 / framesPerSecond);
      } else {
        // Default to entire layer duration
        startTime = durationOffset * 1000;
        endTime = startTime + duration * 1000;
      }

      const animationElapsed = elapsedTime - startTime;
      const totalDuration = endTime - startTime;

      // Only apply fade if we are within the time range
      if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
        const t = animationElapsed / totalDuration; // simple linear ease

        const startAlpha = startFade / 100; // e.g. 100 => 1.0
        const endAlpha = endFade / 100;   // e.g. 50  => 0.5

        // Lerp from startAlpha to endAlpha
        alpha = startAlpha + (endAlpha - startAlpha) * t;
      }
    }
  });

  return alpha;
}


function renderActiveItem(ctx, item, images, elapsedTime, duration, durationOffset, canvasDimensions) {
  let { x, y, width = canvasDimensions.width, height = canvasDimensions.height, src, fillColor, strokeColor, strokeWidth, type,
    subType,
    text, fontFamily, fontSize, radius, shape, pointerWidth = 20, pointerHeight = 20 } = item;



  const renderWithoutItemMotion = isMotionlessSubtitleItem(item);

  // Initialize currentTransform if not present
  if (!item.currentTransform) {
    item.currentTransform = {
      scale: 1, // Starting scale (1 means 100%)
      translateX: renderWithoutItemMotion ? 0 : x,
      translateY: renderWithoutItemMotion ? 0 : y,
      rotateAngle: 0, // In degrees
    };
  }

  ctx.save();

  // Translated subtitles intentionally render without item-level motion.
  if (!renderWithoutItemMotion) {
    applyZoomAnimation(ctx, elapsedTime, item, duration, durationOffset);
    applySlideAnimations(ctx, elapsedTime, item, duration, durationOffset);
    applyRotateAnimation(ctx, item, images, elapsedTime, duration, durationOffset);
    applyOrbitAnimation(ctx, item, images, elapsedTime, duration, durationOffset);
    applySwayAnimation(ctx, item, elapsedTime, duration, durationOffset);
  }


  const fadeAlpha = renderWithoutItemMotion
    ? 1
    : getFadeAlpha(item, elapsedTime, duration, durationOffset);
  // (You'd write something like the code in applyFadeAnimations, but return the alpha)
  ctx.globalAlpha = fadeAlpha;


  // Apply transformations from currentTransform if no animations updated them
  const currentTransform = renderWithoutItemMotion
    ? { scale: 1, translateX: 0, translateY: 0, rotateAngle: 0 }
    : item.currentTransform;

  // Save the context before applying transformations
  ctx.save();

  // Apply translation
  ctx.translate(currentTransform.translateX, currentTransform.translateY);

  // Apply scale
  const scale = currentTransform.scale;
  ctx.scale(scale, scale); // Apply scaling

  // Now render the item at (0,0) since transformations have been applied
  switch (type) {
    case 'image':
      const img = images[item.src];
      ctx.drawImage(img, 0, 0, width, height);
      break;
    case 'text':

      if (item.subType === 'subtitle') {
        applyTextSubtitleAnimations(ctx, item, elapsedTime, durationOffset, framesPerSecond);
      } else {
        applyTextAnimations(ctx, item, elapsedTime, framesPerSecond);
      }
      break;
    case 'shape':
      renderShape(ctx, { ...item, x: 0, y: 0 });
      break;
    default:
      break;
  }

  // Restore the context to apply any post-render animations
  ctx.restore();


  // Apply any other animations that modify the item after rendering
  // applyFadeAnimations(ctx, item, images, elapsedTime, duration, durationOffset);
  if (!renderWithoutItemMotion) {
    applyCustomAnimations(ctx, item, images, elapsedTime, duration, durationOffset);
  }

  ctx.restore();
}


function applySwayAnimation(ctx, item, elapsedTime, duration, durationOffset) {
  const { animations, currentTransform } = item;
  if (!animations) return;

  animations.forEach(animation => {
    if (animation.type === 'sway') {
      const { amplitude, frequency } = animation.params;

      // Determine animation start and end times
      let startTime, endTime;

      if (animation.frameOffset !== undefined && animation.frameDuration !== undefined) {
        const durationOffsetEffective = durationOffset * 1000;
        startTime = durationOffsetEffective + (animation.frameOffset * (1000 / framesPerSecond));
        endTime = startTime + (animation.frameDuration * (1000 / framesPerSecond));
      } else {
        // Use default layer duration
        startTime = durationOffset * 1000;
        endTime = startTime + duration * 1000;
      }

      const animationElapsed = elapsedTime - startTime;
      const totalDuration = endTime - startTime;

      // Only process animation if current time is within animation boundaries
      if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
        // Calculate the sway value
        const swayValue = amplitude * Math.sin(2 * Math.PI * frequency * (elapsedTime / 1000));

        // Update currentTransform.translateX with sway
        currentTransform.translateX += swayValue;
      }
    }
  });
}

function applyOrbitAnimation(ctx, item, images, elapsedTime, duration, durationOffset) {
  const { animations } = item;
  if (!animations) return;

  animations.forEach(animation => {
    const { type, params } = animation;

    if (type !== 'orbit') return; // Only handle orbit animations here

    // Determine animation start and end times
    let startTime, endTime;

    if (animation.frameOffset !== undefined && animation.frameDuration !== undefined) {
      const durationOffsetEffective = durationOffset * 1000;
      startTime = durationOffsetEffective + (animation.frameOffset * (1000 / framesPerSecond));
      endTime = startTime + (animation.frameDuration * (1000 / framesPerSecond));
    } else {
      // Use default layer duration
      startTime = durationOffset * 1000;
      endTime = startTime + duration * 1000;
    }

    const animationElapsed = elapsedTime - startTime;
    const totalDuration = endTime - startTime;

    // Only process animation if within time boundaries
    if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
      const t = animationElapsed / totalDuration; // Linear easing

      // Calculate the current angle based on time
      const currentAngle = params.startAngle + (params.endAngle - params.startAngle) * t;
      const radians = (currentAngle * Math.PI) / 180;

      // Calculate the new position based on the orbit
      const orbitX = params.centerX + params.radius * Math.cos(radians);
      const orbitY = params.centerY + params.radius * Math.sin(radians);

      // Translate the context to the new position
      ctx.translate(orbitX - item.x, orbitY - item.y);
    }
  });
}


function applySlideAnimations(ctx, elapsedTime, item, duration, durationOffset) {
  const { animations, currentTransform } = item;
  if (!animations) return;

  animations.forEach(animation => {
    if (animation.type === 'slide') {
      const { startX, endX, startY, endY } = animation.params;

      // Determine animation start and end times
      let startTime, endTime;

      if (animation.frameOffset !== undefined && animation.frameDuration !== undefined) {
        // Convert frameOffset and frameDuration from frames to milliseconds
        const durationOffsetEffective = durationOffset * 1000;
        startTime = durationOffsetEffective + (animation.frameOffset * (1000 / framesPerSecond));
        endTime = startTime + (animation.frameDuration * (1000 / framesPerSecond));
      } else {
        // Use default layer duration
        startTime = durationOffset * 1000;
        endTime = startTime + duration * 1000;
      }

      const animationElapsed = elapsedTime - startTime;
      const totalDuration = endTime - startTime;

      // Only process animation if current time is within animation boundaries
      if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
        const t = animationElapsed / totalDuration; // Linear easing

        const translateX = startX + (endX - startX) * t;
        const translateY = startY + (endY - startY) * t;

        // Update currentTransform
        currentTransform.translateX = translateX;
        currentTransform.translateY = translateY;
      }
    }
  });
}

function applyZoomAnimation(ctx, elapsedTime, item, duration, durationOffset) {
  const { animations, currentTransform } = item;
  if (!animations) return;

  animations.forEach(animation => {
    if (animation.type === 'zoom') {
      const { startScale, endScale } = animation.params;

      // Determine animation start and end times
      let startTime, endTime;

      if (animation.frameOffset !== undefined && animation.frameDuration !== undefined) {
        const durationOffsetEffective = durationOffset * 1000;
        startTime = durationOffsetEffective + (animation.frameOffset * (1000 / framesPerSecond));
        endTime = startTime + (animation.frameDuration * (1000 / framesPerSecond));

      } else {
        // Use default layer duration
        startTime = durationOffset * 1000;
        endTime = startTime + duration * 1000;
      }

      const animationElapsed = elapsedTime - startTime;
      const totalDuration = endTime - startTime;

      // Only process animation if current time is within animation boundaries
      if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
        const t = animationElapsed / totalDuration; // Linear easing

        const scale = startScale / 100 + ((endScale / 100 - startScale / 100) * t);

        // Update item's current scale
        currentTransform.scale = scale;
      }
    }
  });
}

function applyRotateAnimation(ctx, item, images, elapsedTime, duration, durationOffset) {
  const { animations, currentTransform } = item;
  if (!animations) return;

  animations.forEach(animation => {
    const { type, params } = animation;

    // Determine animation start and end times
    let startTime, endTime;

    if (animation.frameOffset !== undefined && animation.frameDuration !== undefined) {
      const durationOffsetEffective = durationOffset * 1000;
      startTime = durationOffsetEffective + (animation.frameOffset * (1000 / framesPerSecond));
      endTime = startTime + (animation.frameDuration * (1000 / framesPerSecond));
    } else {
      // Use default layer duration
      startTime = durationOffset * 1000;
      endTime = startTime + duration * 1000;
    }

    const animationElapsed = elapsedTime - startTime;
    const totalDuration = endTime - startTime;

    // Only process animation if current time is within animation boundaries
    if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
      const t = animationElapsed / totalDuration; // Linear easing

      switch (type) {

        case 'rotate':
          if (params.rotationSpeed) {
            const rotationSpeed = params.rotationSpeed;
            const angle = t * rotationSpeed * 360;
            // Update currentTransform.rotateAngle
            currentTransform.rotateAngle = angle;
          } else {
            // Enhanced rotation with pivot points
            // Calculate the current angle
            const angle = params.startAngle + (params.endAngle - params.startAngle) * t;
            // Update currentTransform.rotateAngle
            currentTransform.rotateAngle = angle;
          }

          break;
        default:
          break;
      }
    }
  });
}



function applyCustomAnimations(ctx, item, images, elapsedTime, duration, durationOffset) {
  const { animations } = item;
  if (!animations) return;

  animations.forEach(animation => {
    const { type, params } = animation;

    // Determine animation start and end times
    let startTime, endTime;

    if (animation.frameOffset !== undefined && animation.frameDuration !== undefined) {
      const durationOffsetEffective = durationOffset * 1000;
      startTime = durationOffsetEffective + (animation.frameOffset * (1000 / framesPerSecond));
      endTime = startTime + (animation.frameDuration * (1000 / framesPerSecond));
    } else {
      // Use default layer duration
      startTime = durationOffset * 1000;
      endTime = startTime + duration * 1000;
    }

    const animationElapsed = elapsedTime - startTime;
    const totalDuration = endTime - startTime;



    // Only process animation if current time is within animation boundaries
    if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
      const t = animationElapsed / totalDuration; // Linear easing



      switch (type) {
        case 'glitch':
          // Implement enhanced glitch effect
          const glitchParams = params;
          const {
            intensity,
            rgbSplit,
            noise,
            displacement,
            scanLines,
            glitchDuration,
            glitchFrequency
          } = glitchParams;

          // Calculate whether to apply glitch based on frequency and duration
          const glitchInterval = 1000 / glitchFrequency; // Time between glitches in ms
          const timeSinceGlitchStart = elapsedTime % glitchInterval;

          if (timeSinceGlitchStart <= glitchDuration) {
            // Apply glitch effects
            if (rgbSplit) {
              applyRGBSplit(ctx, intensity);
            }

            if (noise) {
              applyNoiseOverlay(ctx, intensity);
            }

            if (displacement) {
              applyDisplacementShifts(ctx, intensity);
            }

            if (scanLines) {
              applyScanLineDisturbances(ctx, intensity);
            }
          }
          break;
        case 'snowfall':
          // Apply snowfall effect
          applySnowfallEffect(ctx, params, t);
          break;
        case 'light_transition':
          // Apply light transition effect
          applyLightTransitionEffect(ctx, params, t);
          break;
        case 'hologram':
          applyHologramEffect(ctx, params, t);
          break;
        case 'nebula':
          applyNebulaEffect(ctx, params, t);
          break;
        case 'particle':
          applyParticleEffect(ctx, params, t);
          break;
        case 'bloom':
          applyBloomEffect(ctx, params, t);
          break;
        case 'lens_flare':
          applyLensFlareEffect(ctx, params, t);
          break;

        default:
          break;
      }
    }
  });
}



function renderShape(ctx, item) {
  const { shape } = item;
  const { x, y, width, height, radius, fillColor, strokeColor, strokeWidth, pointerWidth, pointerHeight } = item.config;

  ctx.fillStyle = fillColor;

  switch (shape) {
    case 'rectangle':
      ctx.fillRect(x, y, width, height);
      if (strokeColor && strokeWidth) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.strokeRect(x, y, width, height);
      }
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2, true);
      ctx.fill();
      if (strokeColor && strokeWidth) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      }
      break;
    case 'dialog':
      ctx.beginPath();
      ctx.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (strokeColor && strokeWidth) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(x - pointerWidth / 2, y + height / 2);
      ctx.quadraticCurveTo(x, y + height / 2 + pointerHeight, x + pointerWidth / 2, y + height / 2);
      ctx.closePath();
      ctx.fill();
      if (strokeColor && strokeWidth) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      }
      break;
    default:
      break;
  }
}
