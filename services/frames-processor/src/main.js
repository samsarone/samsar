import { fork } from 'child_process';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import FrameGeneration from './schema/FrameGeneration.js';
import VideoSession from './schema/VideoSession.js';
import { getDBConnectionString } from './DBString.js';
import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';
import QRCode from 'qrcode';
import { getFramesPerSecondFromValue } from './utils/FpsUtils.js';
import { installStructuredLogger } from './utils/StructuredLogger.js';
import { prepareLayerSubtitlesForRendering } from './utils/SubtitleRenderPolicy.js';
import {
  buildBranchThumbnailAssetPath,
  buildEffectiveBranchSession,
  buildFrameOutputNamespace,
  isBranchPathFrameComplete,
  resolveBranchThumbnailSource,
  resolveBranchRenderContext,
} from './utils/BranchRenderPath.js';

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_frames_processor',
  component: 'frame_dispatcher',
});

let MAX_CONCURRENT_TASKS = 6;
let numChunks = 8;

let CURRENT_ENV = process.env.CURRENT_ENV;
if (CURRENT_ENV && (CURRENT_ENV === 'development' || CURRENT_ENV === 'docker')) {
  MAX_CONCURRENT_TASKS = 2;
  numChunks = 4;
}

const STALE_LOCK_RECOVERY_MS = 5 * 60 * 1000;
const DEFAULT_SCENE_TRANSITION_PRESET = 'none';
const VALID_SCENE_TRANSITION_PRESETS = new Set(['none', 'fade', 'dissolve']);
const DEFAULT_SCENE_TRANSITION_DURATION_SECONDS = 0.5;
const AI_VIDEO_FRAME_SOURCE_MANIFEST = '.source.json';


let ongoingTasks = 0;
let taskQueue = [];
const childProcessesMap = new Map();
const sharedAiVideoFramePreparation = new Map();

class ObsoleteFrameGenerationError extends Error {
  constructor(message, {
    generationId = null,
    sessionId = null,
    layerId = null,
    renderPathId = null,
    pathSequenceIndex = null,
  } = {}) {
    super(message);
    this.name = 'ObsoleteFrameGenerationError';
    this.generationId = generationId;
    this.sessionId = sessionId;
    this.layerId = layerId;
    this.renderPathId = renderPathId;
    this.pathSequenceIndex = pathSequenceIndex;
  }
}

class FatalFrameGenerationError extends Error {
  constructor(message, {
    sessionId = null,
    layerId = null,
    sourceType = null,
    videoPath = null,
    renderPathId = null,
    pathSequenceIndex = null,
  } = {}) {
    super(message);
    this.name = 'FatalFrameGenerationError';
    this.sessionId = sessionId;
    this.layerId = layerId;
    this.sourceType = sourceType;
    this.videoPath = videoPath;
    this.renderPathId = renderPathId;
    this.pathSequenceIndex = pathSequenceIndex;
  }
}

function normalizeId(value) {
  return value?.toString?.() || '';
}

function isBranchedFrameGeneration(generation = {}) {
  return Boolean(normalizeId(generation?.renderPathId));
}

function getCanvasDimensions(session = {}) {
  const sessionAspectRatio = session.aspectRatio || '1:1';
  if (sessionAspectRatio === '16:9') {
    return { width: 1792, height: 1024 };
  }
  if (sessionAspectRatio === '9:16') {
    return { width: 1024, height: 1792 };
  }
  return { width: 1024, height: 1024 };
}

function buildFrameGenerationFailureSet({ layerIndex = -1, message }) {
  const failureMessage = message || 'Frame generation failed.';
  const setPayload = {
    frameGenerationPending: false,
    videoGenerationPending: false,
    expressGenerationPending: false,
    expressGenerationFailed: true,
    expressGenerationError: failureMessage,
    generationError: failureMessage,
    'expressGenerationStatus.frame_generation': 'FAILED',
    'expressGenerationStatus.video_generation': 'FAILED',
    'expressGenerationStatus.status': 'FAILED',
  };

  if (Number.isInteger(layerIndex) && layerIndex >= 0) {
    setPayload[`layers.${layerIndex}.frameGenerationPending`] = false;
    setPayload[`layers.${layerIndex}.frameGenerationError`] = failureMessage;
  }

  return setPayload;
}

function buildBranchFrameGenerationFailureSet({
  pathIndex,
  timeline,
  pathSequenceIndex,
  message,
  hasRemainingFrameGenerations = false,
}) {
  const failureMessage = message || 'Frame generation failed.';
  const failedTimeline = Array.isArray(timeline)
    ? timeline.map((entry, arrayIndex) => {
      const entrySequenceIndex = Number.isInteger(Number(entry?.sequenceIndex))
        ? Number(entry.sequenceIndex)
        : arrayIndex;
      const isFailedEntry = entrySequenceIndex === Number(pathSequenceIndex);
      const wasPending = entry?.frameGenerationPending === true;

      return {
        ...(entry?.toObject?.() || entry),
        frameGenerationPending: false,
        ...(isFailedEntry
          ? {
            frameGenerationStatus: 'FAILED',
            frameGenerationError: failureMessage,
            error: failureMessage,
          }
          : wasPending
            ? {
              frameGenerationStatus: 'CANCELLED',
              frameGenerationError: `Cancelled because another frame task in this render path failed: ${failureMessage}`,
              error: `Cancelled because another frame task in this render path failed: ${failureMessage}`,
            }
            : {}),
      };
    })
    : [];

  return {
    frameGenerationPending: Boolean(hasRemainingFrameGenerations),
    videoGenerationPending: false,
    expressGenerationPending: false,
    expressGenerationFailed: true,
    expressGenerationError: failureMessage,
    generationError: failureMessage,
    'expressGenerationStatus.frame_generation': 'FAILED',
    'expressGenerationStatus.video_generation': 'FAILED',
    'expressGenerationStatus.status': 'FAILED',
    [`branchRenderPaths.${pathIndex}.timeline`]: failedTimeline,
    [`branchRenderPaths.${pathIndex}.frameGenerationPending`]: false,
    [`branchRenderPaths.${pathIndex}.frameGenerationStatus`]: 'FAILED',
    [`branchRenderPaths.${pathIndex}.frameGenerationError`]: failureMessage,
  };
}

async function markFrameGenerationFailed(sessionId, layerId, error, options = {}) {
  const normalizedSessionId = sessionId?.toString?.() || sessionId;
  if (!normalizedSessionId) {
    return;
  }

  const normalizedLayerId = layerId?.toString?.() || layerId;
  const message = error?.message || 'Frame generation failed.';

  if (normalizeId(options.renderPathId)) {
    const renderPathId = normalizeId(options.renderPathId);
    const branchScope = { sessionId: normalizedSessionId, renderPathId };
    await FrameGeneration.deleteMany(branchScope);
    taskQueue = taskQueue.filter((task) => (
      normalizeId(task?.sessionId) !== normalizedSessionId ||
      normalizeId(task?.renderPathId) !== renderPathId
    ));

    const [session, remainingFrameGeneration] = await Promise.all([
      VideoSession.findById(normalizedSessionId).lean(),
      FrameGeneration.findOne({ sessionId: normalizedSessionId }).select('_id').lean(),
    ]);

    if (!session) {
      return;
    }

    try {
      const context = resolveBranchRenderContext(session, {
        layerId: normalizedLayerId,
        renderPathId,
        renderPlanVersion: options.renderPlanVersion,
        pathSequenceIndex: options.pathSequenceIndex,
      });
      await VideoSession.updateOne(
        { _id: normalizedSessionId },
        {
          $set: buildBranchFrameGenerationFailureSet({
            pathIndex: context.pathIndex,
            timeline: context.renderPath.timeline,
            pathSequenceIndex: context.pathSequenceIndex,
            message,
            hasRemainingFrameGenerations: Boolean(remainingFrameGeneration),
          }),
        },
      );
      return;
    } catch (contextError) {
      console.error('[frames_processor] Failed to resolve branched task while recording failure', {
        sessionId: normalizedSessionId,
        layerId: normalizedLayerId,
        renderPathId,
        pathSequenceIndex: options.pathSequenceIndex,
        error: contextError?.message || contextError,
      });
    }

    await VideoSession.updateOne(
      { _id: normalizedSessionId },
      {
        $set: {
          frameGenerationPending: Boolean(remainingFrameGeneration),
          videoGenerationPending: false,
          expressGenerationPending: false,
          expressGenerationFailed: true,
          expressGenerationError: message,
          generationError: message,
          'expressGenerationStatus.frame_generation': 'FAILED',
          'expressGenerationStatus.video_generation': 'FAILED',
          'expressGenerationStatus.status': 'FAILED',
        },
      },
    );
    return;
  }

  const session = await VideoSession.findById(normalizedSessionId)
    .select('layers._id')
    .lean();
  const layerIndex = Array.isArray(session?.layers) && normalizedLayerId
    ? session.layers.findIndex((layer) => layer?._id?.toString?.() === normalizedLayerId)
    : -1;

  await VideoSession.updateOne(
    { _id: normalizedSessionId },
    {
      $set: buildFrameGenerationFailureSet({
        layerIndex,
        message,
      }),
    },
  );

  await FrameGeneration.deleteMany({ sessionId: normalizedSessionId });
  taskQueue = taskQueue.filter((task) => task?.sessionId?.toString?.() !== normalizedSessionId);
}

async function deleteFrameGenerationAndSyncSession(generationId, sessionId) {
  const normalizedGenerationId = generationId?.toString?.();
  if (normalizedGenerationId) {
    await FrameGeneration.findByIdAndDelete(normalizedGenerationId);
    taskQueue = taskQueue.filter(
      (task) => task?._id?.toString?.() !== normalizedGenerationId
    );
  }

  const normalizedSessionId = sessionId?.toString?.();
  if (!normalizedSessionId) {
    return;
  }

  const remainingFrameGeneration = await FrameGeneration.findOne({ sessionId: normalizedSessionId })
    .select('_id')
    .lean();

  if (!remainingFrameGeneration) {
    await VideoSession.findByIdAndUpdate(normalizedSessionId, { frameGenerationPending: false });
  }
}

function getChildCombinationKey(generation = {}) {
  const generationId = generation?._id?.toString?.();
  const sessionId = generation?.sessionId?.toString?.();
  const layerId = generation?.layerId?.toString?.();
  if (!generationId || !sessionId || !layerId) {
    return null;
  }
  const renderPathId = normalizeId(generation?.renderPathId);
  const pathSequenceIndex = Number.isInteger(Number(generation?.pathSequenceIndex))
    ? Number(generation.pathSequenceIndex)
    : '';
  const branchScope = renderPathId
    ? `_${Buffer.from(renderPathId, 'utf8').toString('base64url')}_${pathSequenceIndex}`
    : '';
  return `${generationId}_${sessionId}_${layerId}${branchScope}`;
}

async function recoverStaleLockedFrameGenerations() {
  const staleThreshold = new Date(Date.now() - STALE_LOCK_RECOVERY_MS);
  const lockedGenerations = await FrameGeneration.find({
    rowLocked: true,
    updatedAt: { $lte: staleThreshold },
  })
    .select('_id sessionId layerId renderPathId renderPlanVersion pathSequenceIndex updatedAt')
    .lean();

  for (const generation of lockedGenerations) {
    const combinationKey = getChildCombinationKey(generation);
    if (combinationKey && childProcessesMap.has(combinationKey)) {
      continue;
    }

    const sessionId = generation?.sessionId?.toString?.();
    const layerId = generation?.layerId?.toString?.();
    if (!sessionId || !layerId) {
      await deleteFrameGenerationAndSyncSession(generation?._id, sessionId);
      continue;
    }

    const session = await VideoSession.findById(sessionId).lean();

    if (isBranchedFrameGeneration(generation)) {
      try {
        const context = resolveBranchRenderContext(session, generation);
        const entryIsPending = context.timelineEntry?.frameGenerationPending === true;

        if (!entryIsPending) {
          if (
            context.renderPath?.frameGenerationStatus === 'APPLYING_TRANSITIONS' &&
            isBranchPathFrameComplete(context.renderPath)
          ) {
            await VideoSession.updateOne(
              { _id: sessionId },
              {
                $set: {
                  [`branchRenderPaths.${context.pathIndex}.frameGenerationStatus`]: 'PENDING',
                  [`branchRenderPaths.${context.pathIndex}.frameGenerationPending`]: true,
                },
              },
            );
          }

          if (isBranchPathFrameComplete(context.renderPath)) {
            await finalizeBranchPathFrames(sessionId, context.renderPathId, {
              canvasDimensions: getCanvasDimensions(session),
              framesPerSecond: getFramesPerSecondFromValue(session?.framesPerSecond),
            });
          }

          console.warn(
            `Deleting stale locked FrameGeneration ${generation._id} for completed/non-pending path entry ${context.renderPathId}:${context.pathSequenceIndex} in session ${sessionId}.`
          );
          await deleteFrameGenerationAndSyncSession(generation._id, sessionId);
          continue;
        }

        console.warn(
          `Recovering stale locked FrameGeneration ${generation._id} for path ${context.renderPathId}, sequence ${context.pathSequenceIndex}, layer ${layerId} in session ${sessionId}.`
        );
        await FrameGeneration.findByIdAndUpdate(
          generation._id,
          { rowLocked: false },
          { new: true }
        );
        continue;
      } catch (error) {
        console.error('[frames_processor] Stale branched FrameGeneration is invalid', {
          generationId: generation?._id?.toString?.(),
          sessionId,
          layerId,
          renderPathId: generation?.renderPathId,
          pathSequenceIndex: generation?.pathSequenceIndex,
          error: error?.message || error,
        });
        await markFrameGenerationFailed(sessionId, layerId, error, generation);
        continue;
      }
    }

    const layer = Array.isArray(session?.layers)
      ? session.layers.find((currentLayer) => currentLayer?._id?.toString?.() === layerId)
      : null;

    if (!layer || !layer.frameGenerationPending) {
      console.warn(
        `Deleting stale locked FrameGeneration ${generation._id} for non-pending layer ${layerId} in session ${sessionId}.`
      );
      await deleteFrameGenerationAndSyncSession(generation._id, sessionId);
      continue;
    }

    console.warn(
      `Recovering stale locked FrameGeneration ${generation._id} for layer ${layerId} in session ${sessionId}.`
    );
    await FrameGeneration.findByIdAndUpdate(
      generation._id,
      { rowLocked: false },
      { new: true }
    );
  }
}

function resolveSamsarProcessorAssetsRoot(version = 'legacy') {
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

function normalizeString(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function isGeneratedOutroItem(item = {}) {
  if (item?.isBlendCarryOver === true) {
    return false;
  }

  const image = normalizeString(item?.image);
  const src = normalizeString(item?.src);
  return (
    image === 'server_generated_outro_image' ||
    image === 'server_generated_outro_background' ||
    image === 'server_generated_outro_qr' ||
    image === 'server_generated_outro_tile' ||
    item?.isOutroFadeOverlay === true ||
    item?.isOutroCtaText === true ||
    item?.isGeneratedOutroTile === true ||
    src.includes('video/outro/')
  );
}

function isOutroLayer(layer = {}) {
  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const hasOutroItems = activeItemList.some(isGeneratedOutroItem);
  const layerType = normalizeString(layer?.layerAiVideoType).toLowerCase();
  const baseType = normalizeString(layer?.layerBaseAiImageType).toLowerCase();
  return Boolean(
    layer?.isGeneratedOutroLayer === true ||
    layer?.generatedOutroImage === true ||
    layer?.outroImagePath ||
    layer?.outroFocusImagePath ||
    hasOutroItems ||
    (
      (layer?.skipAiVideoGeneration === true || layer?.skipAiVideoGeneration === 'true') &&
      layerType === 'none' &&
      baseType === 'none'
    )
  );
}

function normalizeSceneTransitionPreset(value) {
  if (typeof value !== 'string') {
    return DEFAULT_SCENE_TRANSITION_PRESET;
  }

  const normalizedValue = value.trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (normalizedValue === 'crossfade' || normalizedValue === 'cross_fade') {
    return 'dissolve';
  }

  return VALID_SCENE_TRANSITION_PRESETS.has(normalizedValue)
    ? normalizedValue
    : DEFAULT_SCENE_TRANSITION_PRESET;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeInOutQuad(value) {
  const clampedValue = clamp(value, 0, 1);
  if (clampedValue < 0.5) {
    return 2 * clampedValue * clampedValue;
  }

  return 1 - (Math.pow(-2 * clampedValue + 2, 2) / 2);
}

function resolveAssetAbsolutePath(assetPath) {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!normalizedAssetPath) {
    return null;
  }

  const hasV2Prefix = normalizedAssetPath.startsWith('assets_v2/');
  const relativePath = stripAssetPrefix(normalizedAssetPath);
  const candidates = hasV2Prefix
    ? [path.join(resolveSamsarProcessorAssetsRoot('v2'), relativePath)]
    : [
      path.join(resolveSamsarProcessorAssetsRoot('v2'), relativePath),
      path.join(resolveSamsarProcessorAssetsRoot('legacy'), relativePath),
    ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function persistBranchThumbnailFrame({ sessionId, renderPathId, sourceFramePath }) {
  if (!sourceFramePath || !fs.existsSync(sourceFramePath)) {
    throw new Error(
      `Cannot create branch thumbnail for ${renderPathId}: source frame is missing.`,
    );
  }

  const thumbnailPath = buildBranchThumbnailAssetPath({ sessionId, renderPathId });
  const relativeThumbnailPath = stripAssetPrefix(thumbnailPath);
  const thumbnailTargets = [
    path.join(resolveSamsarProcessorAssetsRoot('v2'), relativeThumbnailPath),
    path.join(resolveSamsarProcessorAssetsRoot('legacy'), relativeThumbnailPath),
  ];
  const errors = [];
  let persisted = false;

  for (const targetPath of thumbnailTargets) {
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourceFramePath, targetPath);
      persisted = true;
    } catch (error) {
      errors.push(`${targetPath}: ${error?.message || error}`);
    }
  }

  if (!persisted) {
    throw new Error(
      `Failed to persist branch thumbnail for ${renderPathId}: ${errors.join('; ')}`,
    );
  }
  if (errors.length > 0) {
    console.warn('[frames_processor] Branch thumbnail was not mirrored to every asset root', {
      sessionId,
      renderPathId,
      errors,
    });
  }

  return thumbnailPath;
}

function getFrameSourceIdentity({ sourceType, normalizedVideoPath, videoPath }) {
  const identity = {
    sourceType: sourceType || null,
    normalizedVideoPath: normalizedVideoPath || null,
    videoPath: videoPath || null,
    sourceSize: null,
    sourceMtimeMs: null,
  };

  try {
    const stat = fs.statSync(videoPath);
    identity.sourceSize = stat.size;
    identity.sourceMtimeMs = stat.mtimeMs;
  } catch {
    // The caller will decide whether an existing frame cache is acceptable.
  }

  return identity;
}

function readFrameSourceManifest(dirPath) {
  try {
    const manifestPath = path.join(dirPath, AI_VIDEO_FRAME_SOURCE_MANIFEST);
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeFrameSourceManifest(dirPath, sourceIdentity) {
  try {
    fs.writeFileSync(
      path.join(dirPath, AI_VIDEO_FRAME_SOURCE_MANIFEST),
      JSON.stringify({
        ...sourceIdentity,
        generatedAt: new Date().toISOString(),
      }, null, 2)
    );
  } catch (error) {
    console.warn('[frames_processor] Failed to write AI video frame source manifest', {
      dirPath,
      error: error?.message || error,
    });
  }
}

function isFrameSourceManifestCurrent(manifest, sourceIdentity) {
  if (!manifest || !sourceIdentity) {
    return false;
  }

  return (
    manifest.normalizedVideoPath === sourceIdentity.normalizedVideoPath &&
    manifest.sourceSize === sourceIdentity.sourceSize &&
    Math.round(Number(manifest.sourceMtimeMs) || 0) === Math.round(Number(sourceIdentity.sourceMtimeMs) || 0)
  );
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

function getFooterQrAssetRelativePath(sessionId, layerId, url) {
  const urlHash = createHash('sha256')
    .update(url)
    .digest('hex')
    .slice(0, 16);

  return path
    .join('video', 'footer_qr', `${sessionId}`, `${layerId}`, `qr_${urlHash}.png`)
    .split(path.sep)
    .join('/');
}

async function ensureFooterQrCodeForLayer({ layer, sessionId, layerId }) {
  if (layer?.addFooterAnimation !== true) {
    return layer;
  }

  const footerMetadata = normalizeFooterMetadata(layer.footerMetadata ?? layer.footer_metadata);
  if (!footerMetadata) {
    return {
      ...layer,
      addFooterAnimation: false,
      footerMetadata: null,
      footerQrImagePath: null,
    };
  }

  let footerQrImagePath = null;
  if (footerMetadata.url) {
    footerQrImagePath = getFooterQrAssetRelativePath(sessionId, layerId, footerMetadata.url);
    const qrAbsolutePath = path.join(resolveSamsarProcessorAssetsRoot('v2'), footerQrImagePath);

    if (!fs.existsSync(qrAbsolutePath)) {
      fs.mkdirSync(path.dirname(qrAbsolutePath), { recursive: true });
      const qrBuffer = await QRCode.toBuffer(footerMetadata.url, {
        type: 'png',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 1024,
        color: {
          dark: '#111827',
          light: '#ffffff',
        },
      });
      fs.writeFileSync(qrAbsolutePath, qrBuffer);
    }
  }

  return {
    ...layer,
    addFooterAnimation: true,
    footerMetadata,
    footerQrImagePath,
  };
}

function getSceneTransitionSideFrameCount(framesPerSecond, outgoingFrameCount, incomingFrameCount) {
  const normalizedFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  const preferredTotalFrameCount = Math.max(
    2,
    Math.round(normalizedFramesPerSecond * DEFAULT_SCENE_TRANSITION_DURATION_SECONDS)
  );
  const preferredSideFrameCount = Math.max(1, Math.ceil(preferredTotalFrameCount / 2));

  return Math.max(
    0,
    Math.min(preferredSideFrameCount, outgoingFrameCount, incomingFrameCount)
  );
}

function renderTransitionFrame({
  outgoingImage,
  incomingImage,
  canvasDimensions,
  preset,
  progress,
}) {
  const canvas = createCanvas(canvasDimensions.width, canvasDimensions.height);
  const ctx = canvas.getContext('2d');
  const easedProgress = easeInOutQuad(progress);

  ctx.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height);
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvasDimensions.width, canvasDimensions.height);

  if (preset === 'fade') {
    if (easedProgress < 0.5) {
      const outgoingAlpha = 1 - easeInOutQuad(easedProgress / 0.5);
      if (outgoingAlpha > 0) {
        ctx.globalAlpha = outgoingAlpha;
        ctx.drawImage(outgoingImage, 0, 0, canvasDimensions.width, canvasDimensions.height);
      }
    } else {
      const incomingAlpha = easeInOutQuad((easedProgress - 0.5) / 0.5);
      if (incomingAlpha > 0) {
        ctx.globalAlpha = incomingAlpha;
        ctx.drawImage(incomingImage, 0, 0, canvasDimensions.width, canvasDimensions.height);
      }
    }
  } else {
    ctx.globalAlpha = 1;
    ctx.drawImage(outgoingImage, 0, 0, canvasDimensions.width, canvasDimensions.height);
    ctx.globalAlpha = easedProgress;
    ctx.drawImage(incomingImage, 0, 0, canvasDimensions.width, canvasDimensions.height);
  }

  ctx.globalAlpha = 1;
  return canvas.toBuffer('image/png');
}

function hasLayerTransitionContent(layer = {}) {
  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];

  if (activeItemList.some((item) => item && item.isHidden !== true)) {
    return true;
  }

  return Boolean(
    layer?.hasAiVideoLayer ||
      layer?.hasLipSyncVideoLayer ||
      layer?.hasSoundEffectVideoLayer ||
      layer?.hasUserVideoLayer ||
      layer?.aiVideoLayer ||
      layer?.lipSyncVideoLayer ||
      layer?.soundEffectVideoLayer ||
      layer?.userVideoLayer ||
      layer?.addFooterAnimation
  );
}

async function overwriteTransitionFrame({
  outgoingFrameAssetPath,
  incomingFrameAssetPath,
  destinationFrameAssetPath,
  canvasDimensions,
  preset,
  progress,
}) {
  const outgoingFrameAbsolutePath = resolveAssetAbsolutePath(outgoingFrameAssetPath);
  const incomingFrameAbsolutePath = resolveAssetAbsolutePath(incomingFrameAssetPath);
  const destinationFrameAbsolutePath = resolveAssetAbsolutePath(destinationFrameAssetPath);

  if (!outgoingFrameAbsolutePath || !incomingFrameAbsolutePath || !destinationFrameAbsolutePath) {
    return;
  }

  if (!fs.existsSync(outgoingFrameAbsolutePath) || !fs.existsSync(incomingFrameAbsolutePath)) {
    return;
  }

  const [outgoingImage, incomingImage] = await Promise.all([
    loadImage(outgoingFrameAbsolutePath),
    loadImage(incomingFrameAbsolutePath),
  ]);

  const buffer = renderTransitionFrame({
    outgoingImage,
    incomingImage,
    canvasDimensions,
    preset,
    progress,
  });

  fs.mkdirSync(path.dirname(destinationFrameAbsolutePath), { recursive: true });
  fs.writeFileSync(destinationFrameAbsolutePath, buffer);
}

async function applySceneTransitionsToLayers(session, layers, { canvasDimensions, framesPerSecond }) {
  const normalizedPreset = normalizeSceneTransitionPreset(session?.sceneTransitionPreset);
  const orderedLayers = Array.isArray(layers) ? layers : [];

  if (normalizedPreset === DEFAULT_SCENE_TRANSITION_PRESET || orderedLayers.length < 2) {
    return normalizedPreset;
  }

  for (let layerIndex = 0; layerIndex < orderedLayers.length - 1; layerIndex += 1) {
    const outgoingLayer = orderedLayers[layerIndex];
    const incomingLayer = orderedLayers[layerIndex + 1];

    if (!hasLayerTransitionContent(incomingLayer)) {
      continue;
    }

    const outgoingFrames = Array.isArray(outgoingLayer?.frames) ? outgoingLayer.frames : [];
    const incomingFrames = Array.isArray(incomingLayer?.frames) ? incomingLayer.frames : [];
    const sideFrameCount = getSceneTransitionSideFrameCount(
      framesPerSecond,
      outgoingFrames.length,
      incomingFrames.length
    );

    if (sideFrameCount <= 0) {
      continue;
    }

    const totalTransitionFrameCount = sideFrameCount * 2;

    for (let offset = 0; offset < sideFrameCount; offset += 1) {
      const outgoingFrameAssetPath = outgoingFrames[outgoingFrames.length - sideFrameCount + offset];
      const incomingFrameAssetPath = incomingFrames[offset];

      if (!outgoingFrameAssetPath || !incomingFrameAssetPath) {
        continue;
      }

      try {
        await overwriteTransitionFrame({
          outgoingFrameAssetPath,
          incomingFrameAssetPath,
          destinationFrameAssetPath: outgoingFrameAssetPath,
          canvasDimensions,
          preset: normalizedPreset,
          progress: (offset + 1) / (totalTransitionFrameCount + 1),
        });

        await overwriteTransitionFrame({
          outgoingFrameAssetPath,
          incomingFrameAssetPath,
          destinationFrameAssetPath: incomingFrameAssetPath,
          canvasDimensions,
          preset: normalizedPreset,
          progress: (sideFrameCount + offset + 1) / (totalTransitionFrameCount + 1),
        });
      } catch (error) {
        console.error('[frames_processor] Failed to write scene transition frame', {
          preset: normalizedPreset,
          outgoingLayerId: outgoingLayer?._id?.toString?.() || outgoingLayer?._id,
          incomingLayerId: incomingLayer?._id?.toString?.() || incomingLayer?._id,
          offset,
          error: error?.message || error,
        });
      }
    }
  }

  return normalizedPreset;
}

async function applySceneTransitionsToSession(session, options) {
  return applySceneTransitionsToLayers(session, session?.layers, options);
}

async function finalizeBranchPathFrames(
  sessionId,
  renderPathId,
  { canvasDimensions, framesPerSecond },
) {
  const session = await VideoSession.findById(sessionId).lean();
  if (!session) {
    return false;
  }

  const pathIndex = Array.isArray(session.branchRenderPaths)
    ? session.branchRenderPaths.findIndex(
      (candidate) => normalizeId(candidate?.pathId) === normalizeId(renderPathId),
    )
    : -1;
  if (pathIndex < 0) {
    throw new Error(`Render path ${renderPathId} was not found while finalizing frames.`);
  }

  const renderPath = session.branchRenderPaths[pathIndex];
  if (renderPath?.frameGenerationStatus === 'COMPLETED') {
    return true;
  }
  if (!isBranchPathFrameComplete(renderPath)) {
    return false;
  }

  const claimResult = await VideoSession.updateOne(
    {
      _id: sessionId,
      [`branchRenderPaths.${pathIndex}.pathId`]: normalizeId(renderPathId),
      [`branchRenderPaths.${pathIndex}.frameGenerationStatus`]: {
        $nin: ['APPLYING_TRANSITIONS', 'COMPLETED', 'FAILED'],
      },
    },
    {
      $set: {
        [`branchRenderPaths.${pathIndex}.frameGenerationStatus`]: 'APPLYING_TRANSITIONS',
        [`branchRenderPaths.${pathIndex}.frameGenerationPending`]: true,
        [`branchRenderPaths.${pathIndex}.frameGenerationError`]: null,
      },
    },
  );

  if (claimResult.modifiedCount !== 1) {
    const latestSession = await VideoSession.findById(sessionId)
      .select(`branchRenderPaths.${pathIndex}.frameGenerationStatus`)
      .lean();
    return latestSession?.branchRenderPaths?.[pathIndex]?.frameGenerationStatus === 'COMPLETED';
  }

  try {
    const effectiveSession = buildEffectiveBranchSession(session, renderPath);
    const appliedSceneTransitionPreset = await applySceneTransitionsToLayers(
      effectiveSession,
      effectiveSession.layers,
      { canvasDimensions, framesPerSecond },
    );

    await VideoSession.updateOne(
      {
        _id: sessionId,
        [`branchRenderPaths.${pathIndex}.pathId`]: normalizeId(renderPathId),
      },
      {
        $set: {
          [`branchRenderPaths.${pathIndex}.frameGenerationStatus`]: 'COMPLETED',
          [`branchRenderPaths.${pathIndex}.frameGenerationPending`]: false,
          [`branchRenderPaths.${pathIndex}.frameGenerationError`]: null,
          [`branchRenderPaths.${pathIndex}.appliedSceneTransitionPreset`]: appliedSceneTransitionPreset,
          appliedSceneTransitionPreset,
        },
      },
    );
    return true;
  } catch (error) {
    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          [`branchRenderPaths.${pathIndex}.frameGenerationStatus`]: 'PENDING',
          [`branchRenderPaths.${pathIndex}.frameGenerationPending`]: true,
          [`branchRenderPaths.${pathIndex}.frameGenerationError`]: error?.message || String(error),
        },
      },
    );
    throw error;
  }
}

function getMaxNumericPngFrameIndex(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    let maxIndex = -1;

    for (const file of files) {
      if (!file.endsWith('.png')) {
        continue;
      }
      const base = file.slice(0, -'.png'.length);
      const parsed = Number.parseInt(base, 10);
      if (Number.isFinite(parsed) && parsed > maxIndex) {
        maxIndex = parsed;
      }
    }

    return maxIndex;
  } catch {
    return -1;
  }
}

function padAiVideoFrames(aiFramesDir, lastFrameIndex, requiredFrameCount, options = {}) {
  if (options?.skipStillFramePadding) {
    return;
  }
  if (!Number.isFinite(lastFrameIndex) || lastFrameIndex < 0) {
    return;
  }
  if (!Number.isFinite(requiredFrameCount) || requiredFrameCount <= 0) {
    return;
  }
  if (lastFrameIndex >= requiredFrameCount - 1) {
    return;
  }

  const src = path.join(aiFramesDir, `${lastFrameIndex}.png`);
  if (!fs.existsSync(src)) {
    return;
  }

  for (let i = lastFrameIndex + 1; i < requiredFrameCount; i += 1) {
    const dest = path.join(aiFramesDir, `${i}.png`);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
    }
  }
}

function getLayerVideoSourceType(layer = {}) {
  if (layer?.hasLipSyncVideoLayer || layer?.lipSyncVideoLayer) {
    return 'lip_sync';
  }
  if (layer?.hasSoundEffectVideoLayer || layer?.soundEffectVideoLayer) {
    return 'sound_effect';
  }
  if (layer?.hasUserVideoLayer || layer?.userVideoLayer || layer?.layerAiVideoType === 'user_video') {
    return 'user_video';
  }
  if (layer?.hasAiVideoLayer || layer?.aiVideoLayer) {
    return 'ai_video';
  }
  return 'none';
}

function extractAiVideoFramesWithFfmpeg({
  videoPath,
  aiFramesDir,
  canvasDimensions,
  framesPerSecond,
  preserveAspectRatio = false,
  fitMode,
}) {
  return new Promise((resolve, reject) => {
    const fps = getFramesPerSecondFromValue(framesPerSecond);
    const normalizedFitMode = fitMode || (preserveAspectRatio ? 'contain' : 'stretch');
    const scaleFilter = normalizedFitMode === 'cover'
      ? `scale=${canvasDimensions.width}:${canvasDimensions.height}:force_original_aspect_ratio=increase,crop=${canvasDimensions.width}:${canvasDimensions.height}`
      : normalizedFitMode === 'contain'
        ? `scale=${canvasDimensions.width}:${canvasDimensions.height}:force_original_aspect_ratio=decrease,pad=${canvasDimensions.width}:${canvasDimensions.height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
        : `scale=${canvasDimensions.width}:${canvasDimensions.height}`;
    const frameFilter = `fps=${fps}:round=down,${scaleFilter}`;
    const args = [
      '-y',
      '-i', videoPath,
      '-start_number', '0',
      '-threads', '2',
      '-vf', frameFilter,
      '-sws_flags', 'lanczos',
      path.join(aiFramesDir, '%d.png'),
    ];

    if (normalizedFitMode !== 'stretch') {
      args.splice(args.length - 1, 0, '-pix_fmt', 'rgba');
    }

    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 120000) {
        stderr = stderr.slice(-120000);
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-4000)}`));
      }
    });
  });
}

async function ensureAiVideoFramesAvailable({
  layer,
  sessionId,
  layerId,
  canvasDimensions,
  framesPerSecond,
  requiredFrameCount,
}) {
  const hasAnyAiVideoLayer = Boolean(
    layer?.hasAiVideoLayer
      || layer?.aiVideoLayer
      || layer?.hasLipSyncVideoLayer
      || layer?.lipSyncVideoLayer
      || layer?.hasSoundEffectVideoLayer
      || layer?.soundEffectVideoLayer
      || layer?.hasUserVideoLayer
      || layer?.userVideoLayer
  );

  if (!hasAnyAiVideoLayer) {
    return;
  }

  const clipStartOffset =
    layer?.clipStart && typeof layer?.clipStartFrames === 'number' && layer.clipStartFrames > 0
      ? layer.clipStartFrames
      : 0;
  const effectiveRequiredFrameCount = Math.max(1, requiredFrameCount + clipStartOffset);

  const assetsRoot = resolveSamsarProcessorAssetsRoot('v2');
  const legacyAssetsRoot = resolveSamsarProcessorAssetsRoot('legacy');
  const baseAiFramesDir = path.join(assetsRoot, 'ai_video', 'frames', `${sessionId}`, `${layerId}`);
  const audioVideoAiFramesDir = path.join(baseAiFramesDir, 'audio_video');
  const legacyBaseAiFramesDir = path.join(legacyAssetsRoot, 'ai_video', 'frames', `${sessionId}`, `${layerId}`);
  const legacyAudioVideoAiFramesDir = path.join(legacyBaseAiFramesDir, 'audio_video');
  const prefersAudioVideoFrames = Boolean(
    layer?.hasLipSyncVideoLayer ||
    layer?.lipSyncVideoLayer ||
    layer?.hasSoundEffectVideoLayer ||
    layer?.soundEffectVideoLayer
  );
  const preserveUserVideoAspectRatio = Boolean(
    layer?.hasUserVideoLayer ||
    layer?.userVideoLayer ||
    layer?.layerAiVideoType === 'user_video'
  );
  const sourceType = getLayerVideoSourceType(layer);

  let aiVideoLink = layer?.aiVideoLayer;
  if ((layer?.hasLipSyncVideoLayer || layer?.lipSyncVideoLayer) && layer?.lipSyncVideoLayer) {
    aiVideoLink = layer.lipSyncVideoLayer;
  } else if ((layer?.hasSoundEffectVideoLayer || layer?.soundEffectVideoLayer) && layer?.soundEffectVideoLayer) {
    aiVideoLink = layer.soundEffectVideoLayer;
  } else if ((layer?.hasUserVideoLayer || layer?.userVideoLayer) && layer?.userVideoLayer) {
    aiVideoLink = layer.userVideoLayer;
  } else if ((layer?.hasAiVideoLayer || layer?.aiVideoLayer) && layer?.aiVideoLayer) {
    aiVideoLink = layer.aiVideoLayer;
  }

  const normalizedVideoPath = normalizeAssetPath(aiVideoLink);
  if (!normalizedVideoPath) {
    throw new FatalFrameGenerationError(
      `Missing ${sourceType} video path for layer ${layerId} in session ${sessionId}; cannot generate frames.`,
      { sessionId, layerId, sourceType }
    );
  }

  const videoPath = resolveAssetAbsolutePath(aiVideoLink);
  const sourceIdentity = getFrameSourceIdentity({
    sourceType,
    normalizedVideoPath,
    videoPath,
  });

  const ensureFramesIfPresent = (dirPath, options = {}) => {
    const existingMaxIndex = getMaxNumericPngFrameIndex(dirPath);
    if (existingMaxIndex < 0) {
      return false;
    }
    const manifest = readFrameSourceManifest(dirPath);
    if (!isFrameSourceManifestCurrent(manifest, sourceIdentity)) {
      console.warn('[frames_processor] Ignoring stale extracted AI video frame cache', {
        sessionId,
        layerId,
        sourceType,
        framesDir: dirPath,
        cachedSource: manifest?.normalizedVideoPath || null,
        currentSource: sourceIdentity.normalizedVideoPath,
      });
      fs.rmSync(dirPath, { recursive: true, force: true });
      return false;
    }
    if (existingMaxIndex < effectiveRequiredFrameCount - 1) {
      padAiVideoFrames(dirPath, existingMaxIndex, effectiveRequiredFrameCount, options);
      writeFrameSourceManifest(dirPath, sourceIdentity);
    }
    return true;
  };

  let aiFramesDir = baseAiFramesDir;
  if (!preserveUserVideoAspectRatio) {
    if (prefersAudioVideoFrames) {
      // Audio-video outputs replace the base AI-video frames. If the dedicated
      // frames are missing, extract them from the lip-sync/sound-effect video
      // instead of silently reusing stale base AI-video frames.
      if (ensureFramesIfPresent(audioVideoAiFramesDir, { skipStillFramePadding: true })) {
        return;
      }
      if (ensureFramesIfPresent(legacyAudioVideoAiFramesDir, { skipStillFramePadding: true })) {
        return;
      }
      aiFramesDir = audioVideoAiFramesDir;
    } else if (ensureFramesIfPresent(baseAiFramesDir)) {
      return;
    } else if (ensureFramesIfPresent(legacyBaseAiFramesDir)) {
      return;
    }
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new FatalFrameGenerationError(
      `Missing ${sourceType} video file for layer ${layerId} in session ${sessionId}: ${videoPath || normalizedVideoPath}`,
      { sessionId, layerId, sourceType, videoPath }
    );
  }

  try {
    fs.rmSync(aiFramesDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  fs.mkdirSync(aiFramesDir, { recursive: true });

  console.log('[frames_processor] Extracting layer video frames via ffmpeg', {
    sessionId,
    layerId,
    sourceType,
    videoPath,
    framesDir: aiFramesDir,
  });

  try {
    await extractAiVideoFramesWithFfmpeg({
      videoPath,
      aiFramesDir,
      canvasDimensions,
      framesPerSecond,
      preserveAspectRatio: preserveUserVideoAspectRatio,
    });
  } catch (error) {
    console.error('[frames_processor] Failed to extract layer video frames', {
      sessionId,
      layerId,
      sourceType,
      error: error?.message || error,
    });
    throw error;
  }

  const maxIndexAfter = getMaxNumericPngFrameIndex(aiFramesDir);
  if (maxIndexAfter < 0) {
    throw new FatalFrameGenerationError(
      `No ${sourceType} frames extracted for layer ${layerId} in session ${sessionId}.`,
      { sessionId, layerId, sourceType, videoPath }
    );
  }

  if (maxIndexAfter < effectiveRequiredFrameCount - 1) {
    padAiVideoFrames(aiFramesDir, maxIndexAfter, effectiveRequiredFrameCount, {
      skipStillFramePadding: prefersAudioVideoFrames,
    });
  }
  writeFrameSourceManifest(aiFramesDir, sourceIdentity);
}

async function ensureSharedAiVideoFramesAvailable(options = {}) {
  const sessionId = normalizeId(options.sessionId);
  const layerId = normalizeId(options.layerId);
  const preparationKey = `${sessionId}_${layerId}`;
  const existingPreparation = sharedAiVideoFramePreparation.get(preparationKey);
  if (existingPreparation) {
    await existingPreparation;
    // A shorter path may have prepared the shared source first. Re-run the
    // inexpensive completeness check so a longer path can pad if necessary.
    return ensureAiVideoFramesAvailable(options);
  }

  const preparation = ensureAiVideoFramesAvailable(options);
  sharedAiVideoFramePreparation.set(preparationKey, preparation);
  try {
    return await preparation;
  } finally {
    if (sharedAiVideoFramePreparation.get(preparationKey) === preparation) {
      sharedAiVideoFramePreparation.delete(preparationKey);
    }
  }
}

function getNarratorAvatarOverlayDimensions(canvasDimensions = {}) {
  const canvasWidth = Number(canvasDimensions.width) || 1024;
  const canvasHeight = Number(canvasDimensions.height) || 1024;
  let width = Math.round(clamp(canvasWidth * 0.28, 240, canvasWidth * 0.42));
  let height = Math.round(width * 9 / 16);
  const maxHeight = Math.round(canvasHeight * 0.22);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * 16 / 9);
  }
  return { width, height };
}

async function ensureNarratorAvatarFramesAvailable({
  session,
  sessionId,
  layerId,
  canvasDimensions,
  framesPerSecond,
  requiredFrameCount,
}) {
  const shouldAddAvatar = session?.addNarratorAvatar === true || session?.add_narrator_avatar === true;
  if (!shouldAddAvatar) {
    return null;
  }

  const videoStatus = typeof session?.narratorAvatarVideoStatus === 'string'
    ? session.narratorAvatarVideoStatus.trim().toUpperCase()
    : '';
  const avatarVideoLink = session?.narratorAvatarVideoAssetPath || session?.narratorAvatarVideoPath;
  if (videoStatus !== 'COMPLETED' || !avatarVideoLink) {
    return null;
  }

  const normalizedVideoPath = normalizeAssetPath(avatarVideoLink);
  if (!normalizedVideoPath) {
    return null;
  }

  const assetsRoot = resolveSamsarProcessorAssetsRoot('v2');
  const videoPath = resolveAssetAbsolutePath(avatarVideoLink);
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.warn('[frames_processor] Narrator avatar video file missing; skipping overlay', {
      sessionId,
      layerId,
      videoPath,
    });
    return null;
  }

  const overlayDimensions = getNarratorAvatarOverlayDimensions(canvasDimensions);
  const framesDir = path.join(assetsRoot, 'video', 'narrator_avatar', 'frames', `${sessionId}`, `${layerId}`);
  const existingMaxIndex = getMaxNumericPngFrameIndex(framesDir);
  const effectiveRequiredFrameCount = Math.max(1, requiredFrameCount);
  if (existingMaxIndex >= effectiveRequiredFrameCount - 1) {
    return {
      enabled: true,
      framesDir,
      framesPerSecond: getFramesPerSecondFromValue(framesPerSecond),
      width: overlayDimensions.width,
      height: overlayDimensions.height,
    };
  }

  try {
    fs.rmSync(framesDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  fs.mkdirSync(framesDir, { recursive: true });

  console.log('[frames_processor] Extracting narrator avatar video frames via ffmpeg', {
    sessionId,
    layerId,
    videoPath,
    framesDir,
  });

  try {
    await extractAiVideoFramesWithFfmpeg({
      videoPath,
      aiFramesDir: framesDir,
      canvasDimensions: overlayDimensions,
      framesPerSecond,
      fitMode: 'contain',
    });
  } catch (error) {
    console.error('[frames_processor] Failed to extract narrator avatar frames; continuing without overlay', {
      sessionId,
      layerId,
      error: error?.message || error,
    });
    return null;
  }

  const maxIndexAfter = getMaxNumericPngFrameIndex(framesDir);
  if (maxIndexAfter < 0) {
    return null;
  }
  if (maxIndexAfter < effectiveRequiredFrameCount - 1) {
    padAiVideoFrames(framesDir, maxIndexAfter, effectiveRequiredFrameCount);
  }

  return {
    enabled: true,
    framesDir,
    framesPerSecond: getFramesPerSecondFromValue(framesPerSecond),
    width: overlayDimensions.width,
    height: overlayDimensions.height,
  };
}

async function ensureJoinedNarratorAvatarFramesAvailable({
  session,
  sessionId,
  layerId,
  canvasDimensions,
  framesPerSecond,
}) {
  const joinedOverlays = Array.isArray(session?.joinedNarratorAvatarOverlays)
    ? session.joinedNarratorAvatarOverlays
    : [];
  if (!joinedOverlays.length) {
    return null;
  }

  const assetsRoot = resolveSamsarProcessorAssetsRoot('v2');
  const overlayDimensions = getNarratorAvatarOverlayDimensions(canvasDimensions);
  const segments = [];

  for (let index = 0; index < joinedOverlays.length; index += 1) {
    const sourceOverlay = joinedOverlays[index];
    const startTime = Math.max(0, Number(sourceOverlay?.startTime) || 0);
    const endTime = Number.isFinite(Number(sourceOverlay?.endTime))
      ? Number(sourceOverlay.endTime)
      : startTime + Math.max(0, Number(sourceOverlay?.duration) || 0);
    const duration = Math.max(0, endTime - startTime);
    const assetPath = normalizeAssetPath(
      sourceOverlay?.assetPath ||
      sourceOverlay?.videoAssetPath ||
      sourceOverlay?.narratorAvatarVideoAssetPath
    );

    if (!assetPath || duration <= 0) {
      continue;
    }

    const videoPath = resolveAssetAbsolutePath(
      sourceOverlay?.assetPath ||
      sourceOverlay?.videoAssetPath ||
      sourceOverlay?.narratorAvatarVideoAssetPath
    );
    if (!videoPath || !fs.existsSync(videoPath)) {
      console.warn('[frames_processor] Joined narrator avatar video file missing; skipping segment', {
        sessionId,
        layerId,
        videoPath,
      });
      continue;
    }

    const segmentFramesPerSecond = getFramesPerSecondFromValue(sourceOverlay?.framesPerSecond || framesPerSecond);
    const requiredFrameCount = Math.max(1, Math.ceil(duration * segmentFramesPerSecond));
    const framesDir = path.join(
      assetsRoot,
      'video',
      'narrator_avatar',
      'joined_frames',
      `${sessionId}`,
      `${layerId}`,
      `${index}`,
    );
    const existingMaxIndex = getMaxNumericPngFrameIndex(framesDir);

    if (existingMaxIndex < requiredFrameCount - 1) {
      try {
        fs.rmSync(framesDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      fs.mkdirSync(framesDir, { recursive: true });

      console.log('[frames_processor] Extracting joined narrator avatar segment frames via ffmpeg', {
        sessionId,
        layerId,
        videoPath,
        framesDir,
        startTime,
        endTime,
      });

      try {
        await extractAiVideoFramesWithFfmpeg({
          videoPath,
          aiFramesDir: framesDir,
          canvasDimensions: overlayDimensions,
          framesPerSecond: segmentFramesPerSecond,
          fitMode: 'contain',
        });
      } catch (error) {
        console.error('[frames_processor] Failed to extract joined narrator avatar frames; skipping segment', {
          sessionId,
          layerId,
          error: error?.message || error,
        });
        continue;
      }

      const maxIndexAfter = getMaxNumericPngFrameIndex(framesDir);
      if (maxIndexAfter < 0) {
        continue;
      }
      if (maxIndexAfter < requiredFrameCount - 1) {
        padAiVideoFrames(framesDir, maxIndexAfter, requiredFrameCount);
      }
    }

    segments.push({
      startTime,
      endTime,
      framesDir,
      framesPerSecond: segmentFramesPerSecond,
      width: overlayDimensions.width,
      height: overlayDimensions.height,
    });
  }

  if (!segments.length) {
    return null;
  }

  return {
    enabled: true,
    segments,
    width: overlayDimensions.width,
    height: overlayDimensions.height,
    framesPerSecond: getFramesPerSecondFromValue(framesPerSecond),
  };
}

async function getTimeout(timeout = 1000) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}

// Main loop to keep checking for new tasks
export async function checkPendingFramesAndProcess() {
  while (true) {
    try {
      await getTimeout();
      await generateFramesForPendingSessions();
    } catch (error) {
      console.error('Frames processor loop error; continuing', error);
      await getTimeout(1000);
    }
  }
}

export async function generateFramesForPendingSessions() {
  await getDBConnectionString();
  await recoverStaleLockedFrameGenerations();

  const tenSecondsAgo = new Date(Date.now() - 10000);

  const pendingFrameGenerations = await FrameGeneration.find({
    rowLocked: false,
    $or: [
      { createdAt: { $lte: tenSecondsAgo } },
      { isVideoGenerationRequest: true }
    ]
  })
    .sort({ createdAt: 1 })
    .limit(MAX_CONCURRENT_TASKS);

  const taskQueueIds = new Set(taskQueue.map(task => task._id.toString()));

  // Add new pending tasks to the queue if not already queued
  pendingFrameGenerations.forEach(frameGeneration => {
    if (taskQueue.length < MAX_CONCURRENT_TASKS) {
      const frameGenerationId = frameGeneration?._id?.toString?.();
      if (!frameGenerationId || taskQueueIds.has(frameGenerationId)) {
        return;
      }

      const combinationLayerKey = getChildCombinationKey(frameGeneration);

      // Check if any key in childProcessesMap contains combinationLayerKey as a substring
      const hasCombinationLayerKey = Array.from(childProcessesMap.keys()).some(key => 
        key.includes(combinationLayerKey)
      );

      if (!hasCombinationLayerKey) {
        taskQueue.push(frameGeneration);
        taskQueueIds.add(frameGeneration._id.toString());
      }
    }
  });

  // Process tasks up to the concurrency limit
  while (ongoingTasks < MAX_CONCURRENT_TASKS && taskQueue.length > 0) {
    processNextTask();
  }
}

async function processNextTask() {
  if (taskQueue.length === 0 || ongoingTasks >= MAX_CONCURRENT_TASKS) {
    return;
  }

  const queuedFrameGeneration = taskQueue.shift();
  const childCombinationKey = getChildCombinationKey(queuedFrameGeneration);
  const lockedFrameGeneration = await FrameGeneration.findOneAndUpdate(
    {
      _id: queuedFrameGeneration?._id,
      rowLocked: false,
    },
    { rowLocked: true },
    { new: true }
  ).lean();

  if (!lockedFrameGeneration) {
    childProcessesMap.delete(childCombinationKey);
    processNextTask();
    return;
  }

  const {
    sessionId,
    layerId,
    renderPathId = null,
    renderPlanVersion = null,
    pathSequenceIndex = null,
    _id,
    numRetries = 0,
  } = lockedFrameGeneration;
  const branchOptions = {
    renderPathId,
    renderPlanVersion,
    pathSequenceIndex,
  };

  ongoingTasks++;
  childProcessesMap.set(childCombinationKey, null); // Just to track the child

  try {
    const session = await VideoSession.findById(sessionId);
    if (!session) {
      throw new ObsoleteFrameGenerationError(
        `Session with ID ${sessionId} not found`,
        { generationId: _id, sessionId, layerId }
      );
    }

    if (isBranchedFrameGeneration(lockedFrameGeneration)) {
      try {
        resolveBranchRenderContext(session, lockedFrameGeneration);
      } catch (error) {
        throw new FatalFrameGenerationError(error.message, {
          sessionId,
          layerId,
          renderPathId,
          pathSequenceIndex,
        });
      }
    } else {
      const layerExists = session.layers.some(layer => layer._id.toString() === layerId);
      if (!layerExists) {
        throw new ObsoleteFrameGenerationError(
          `Layer with ID ${layerId} not found in session ${sessionId}`,
          { generationId: _id, sessionId, layerId }
        );
      }
    }

    await generateFramesForSession(_id.toString(), sessionId, layerId, branchOptions);
    childProcessesMap.delete(childCombinationKey);

  } catch (error) {
    if (error instanceof ObsoleteFrameGenerationError) {
      console.warn(
        `Discarding obsolete frame generation ${_id} (layer ${layerId} in session ${sessionId}): ${error.message}`
      );
      await deleteFrameGenerationAndSyncSession(error.generationId || _id, error.sessionId || sessionId);
      childProcessesMap.delete(childCombinationKey);
      ongoingTasks--;
      processNextTask();
      return;
    }

    console.error(
      `Error processing task for generation ${_id} (layer ${layerId} in session ${sessionId}): ${error.message}`
    );

    const newRetryCount = (numRetries || 0) + 1;

    // Decide how many retries you allow
    const isFatalFrameGenerationError = error instanceof FatalFrameGenerationError;
    if (isFatalFrameGenerationError || newRetryCount >= 3) {
      console.error(
        `Task for session ${sessionId} and layer ${layerId} ${isFatalFrameGenerationError ? 'failed fatally' : 'exceeded max retries'}. Marking frame generation failed.`
      );
      await markFrameGenerationFailed(sessionId, layerId, error, branchOptions);
      childProcessesMap.delete(childCombinationKey);
    } else {
      // Otherwise, unlock for re-pickup
      await getTimeout(100);
      await FrameGeneration.findByIdAndUpdate(
        _id,
        { numRetries: newRetryCount, rowLocked: false },
        { new: true }
      );
      childProcessesMap.delete(childCombinationKey);
    }
  }

  ongoingTasks--;
  processNextTask();
}

async function generateFramesForSession(generationId, sessionId, layerId, branchOptions = {}) {
  const session = await VideoSession.findById(sessionId).lean();
  if (!session) {
    throw new ObsoleteFrameGenerationError(
      `Session with ID ${sessionId} not found`,
      { generationId, sessionId, layerId, ...branchOptions }
    );
  }

  let applyAudioVisualizer = session.applyAudioVisualizer;
  const visualizedDataFilePath = path.join(
    resolveSamsarProcessorAssetsRoot('legacy'),
    'video',
    'audio_visualizers',
    `${sessionId}.json`
  );

  const isBranchJob = Boolean(normalizeId(branchOptions.renderPathId));
  let branchContext = null;
  let renderingSession = session;
  let layerIndex = -1;
  let layer = null;

  if (isBranchJob) {
    try {
      branchContext = resolveBranchRenderContext(session, {
        layerId,
        ...branchOptions,
      });
      renderingSession = buildEffectiveBranchSession(session, branchContext.renderPath);
      layerIndex = branchContext.layerIndex;
      layer = renderingSession.layers[branchContext.timelineIndex];
    } catch (error) {
      throw new FatalFrameGenerationError(error.message, {
        sessionId,
        layerId,
        renderPathId: branchOptions.renderPathId,
        pathSequenceIndex: branchOptions.pathSequenceIndex,
      });
    }
  } else {
    layerIndex = session.layers.findIndex(layer => layer._id.toString() === layerId);
    if (layerIndex === -1) {
      throw new ObsoleteFrameGenerationError(
        `Layer with ID ${layerId} not found in session ${sessionId}`,
        { generationId, sessionId, layerId }
      );
    }
    layer = session.layers[layerIndex];
  }

  const enableSubtitles = session.enableSubtitles !== false;
  if (!enableSubtitles && layer?.imageSession?.activeItemList?.length) {
    layer.imageSession.activeItemList = layer.imageSession.activeItemList.filter(
      (item) => !(item?.type === 'text' && item?.subType === 'subtitle'),
    );
  } else if (enableSubtitles) {
    layer = prepareLayerSubtitlesForRendering(layer, renderingSession);
  }

  // If AI video is still pending, bail
  if (layer.aiVideoFrameGenerationPending) {
    await FrameGeneration.findByIdAndUpdate(
      generationId,
      { rowLocked: false },
      { new: true }
    );
    return;
  }

  // If frames are not needed, return
  const frameGenerationIsPending = isBranchJob
    ? branchContext.timelineEntry?.frameGenerationPending === true
    : layer.frameGenerationPending;
  if (!frameGenerationIsPending) {
    if (
      isBranchJob &&
      isBranchPathFrameComplete(branchContext.renderPath) &&
      branchContext.renderPath?.frameGenerationStatus !== 'COMPLETED'
    ) {
      await finalizeBranchPathFrames(sessionId, branchContext.renderPathId, {
        canvasDimensions: getCanvasDimensions(session),
        framesPerSecond: getFramesPerSecondFromValue(session?.framesPerSecond),
      });
    }
    await deleteFrameGenerationAndSyncSession(generationId, sessionId);
    return;
  }

  if (isBranchJob) {
    const startResult = await VideoSession.updateOne(
      {
        _id: sessionId,
        [`branchRenderPaths.${branchContext.pathIndex}.pathId`]: branchContext.renderPathId,
        [`branchRenderPaths.${branchContext.pathIndex}.frameGenerationStatus`]: { $ne: 'FAILED' },
        [`branchRenderPaths.${branchContext.pathIndex}.timeline.${branchContext.timelineIndex}.frameGenerationPending`]: true,
      },
      {
        $set: {
          [`branchRenderPaths.${branchContext.pathIndex}.timeline.${branchContext.timelineIndex}.frameGenerationStatus`]: 'GENERATING',
          [`branchRenderPaths.${branchContext.pathIndex}.timeline.${branchContext.timelineIndex}.frameGenerationPending`]: true,
          [`branchRenderPaths.${branchContext.pathIndex}.timeline.${branchContext.timelineIndex}.frameGenerationError`]: null,
          [`branchRenderPaths.${branchContext.pathIndex}.timeline.${branchContext.timelineIndex}.error`]: null,
          [`branchRenderPaths.${branchContext.pathIndex}.frameGenerationStatus`]: 'GENERATING',
          [`branchRenderPaths.${branchContext.pathIndex}.frameGenerationPending`]: true,
          [`branchRenderPaths.${branchContext.pathIndex}.frameGenerationError`]: null,
        },
      },
    );
    if (startResult.matchedCount !== 1) {
      throw new ObsoleteFrameGenerationError(
        `Render path ${branchContext.renderPathId}, sequence ${branchContext.pathSequenceIndex}, is no longer pending.`,
        { generationId, sessionId, layerId, ...branchOptions },
      );
    }
  }

  const canvasDimensions = getCanvasDimensions(session);
  const framesPerSecond = getFramesPerSecondFromValue(session?.framesPerSecond);
  const frameCount = Math.floor(layer.duration * framesPerSecond);
  const totalVideoDuration = isBranchJob
    ? branchContext.pathDuration * 1000
    : session.layers.reduce((sum, layer) => sum + layer.duration, 0) * 1000;
  const totalFrameCount = Math.max(1, Math.ceil((totalVideoDuration / 1000) * framesPerSecond));
  layer = await ensureFooterQrCodeForLayer({ layer, sessionId, layerId });

  if (layer?.footerQrImagePath) {
    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          [`layers.${layerIndex}.footerQrImagePath`]: layer.footerQrImagePath,
          [`layers.${layerIndex}.footerMetadata`]: layer.footerMetadata,
          [`layers.${layerIndex}.addFooterAnimation`]: true,
        },
      },
    );
  }

  await ensureSharedAiVideoFramesAvailable({
    layer,
    sessionId,
    layerId,
    canvasDimensions,
    framesPerSecond,
    requiredFrameCount: frameCount,
  });

  const narratorAvatarOverlay = isOutroLayer(layer)
    ? null
    : (
      await ensureJoinedNarratorAvatarFramesAvailable({
        session: renderingSession,
        sessionId,
        layerId,
        canvasDimensions,
        framesPerSecond,
      }) ||
      await ensureNarratorAvatarFramesAvailable({
        session: renderingSession,
        sessionId,
        layerId,
        canvasDimensions,
        framesPerSecond,
        requiredFrameCount: totalFrameCount,
      })
    );

  let visualizerData = null;
  if (applyAudioVisualizer) {
    if (fs.existsSync(visualizedDataFilePath)) {
      const rawData = fs.readFileSync(visualizedDataFilePath, 'utf8');
      visualizerData = JSON.parse(rawData);
    } else {
      console.error(`Visualizer data file not found at ${visualizedDataFilePath}`);
      applyAudioVisualizer = false; 
    }
  }

  // Cleanup frame directory if it exists and has extra files
  const frameOutputNamespace = isBranchJob
    ? branchContext.frameOutputNamespace
    : buildFrameOutputNamespace({ sessionId, layerId });
  const frameDirectory = path.join(
    resolveSamsarProcessorAssetsRoot('v2'),
    ...frameOutputNamespace.split('/'),
  );

  fs.rmSync(frameDirectory, { recursive: true, force: true });
  fs.mkdirSync(frameDirectory, { recursive: true });

  // Spawn children in chunks
  const globalVideosForLayer = getGlobalVideosForLayer(renderingSession, layer);
  const chunkSize = Math.ceil(frameCount / numChunks);
  const workerPromises = [];

  for (let i = 0; i < numChunks; i++) {
    const startFrame = i * chunkSize;
    const endFrame = Math.min((i + 1) * chunkSize, frameCount);

    workerPromises.push(
      createFramesInChildProcess(
        generationId,
        layer,
        sessionId,
        startFrame,
        endFrame,
        canvasDimensions,
        applyAudioVisualizer,
        visualizerData,
        totalVideoDuration,
        framesPerSecond,
        globalVideosForLayer,
        narratorAvatarOverlay,
        frameOutputNamespace,
      )
    );
  }

  // Wait for all children
  const results = await Promise.all(workerPromises);
  const framesList = results.flatMap(result => result.framesList);

  if (!framesList || framesList.length === 0) {
    throw new Error(`No frames generated for layer ${layerId} in session ${sessionId}`);
  }

  // Re-fetch session (it may have changed in DB)
  const latestSession = await VideoSession.findById(sessionId);
  if (!latestSession) {
    throw new ObsoleteFrameGenerationError(
      `Session with ID ${sessionId} not found`,
      { generationId, sessionId, layerId, ...branchOptions }
    );
  }

  if (isBranchJob) {
    let latestBranchContext;
    try {
      latestBranchContext = resolveBranchRenderContext(latestSession, {
        layerId,
        ...branchOptions,
      });
    } catch (error) {
      throw new FatalFrameGenerationError(error.message, {
        sessionId,
        layerId,
        renderPathId: branchOptions.renderPathId,
        pathSequenceIndex: branchOptions.pathSequenceIndex,
      });
    }

    const branchPathPrefix = `branchRenderPaths.${latestBranchContext.pathIndex}`;
    const branchUpdateSet = {
      [`${branchPathPrefix}.timeline.${latestBranchContext.timelineIndex}.frames`]: framesList,
      [`${branchPathPrefix}.timeline.${latestBranchContext.timelineIndex}.frameGenerationPending`]: false,
      [`${branchPathPrefix}.timeline.${latestBranchContext.timelineIndex}.frameGenerationStatus`]: 'COMPLETED',
      [`${branchPathPrefix}.timeline.${latestBranchContext.timelineIndex}.frameGenerationError`]: null,
      [`${branchPathPrefix}.timeline.${latestBranchContext.timelineIndex}.error`]: null,
      [`${branchPathPrefix}.frameGenerationPending`]: true,
      [`${branchPathPrefix}.frameGenerationStatus`]: 'GENERATING',
      [`${branchPathPrefix}.frameGenerationError`]: null,
      frameGenerationPending: true,
    };
    const branchThumbnailSource = resolveBranchThumbnailSource(
      latestSession.branchRenderPaths?.[latestBranchContext.pathIndex],
      latestSession.branchRenderPaths,
    );
    if (
      branchThumbnailSource &&
      branchThumbnailSource.pathSequenceIndex === latestBranchContext.pathSequenceIndex
    ) {
      const firstFrame = framesList[0];
      const firstFramePath = resolveAssetAbsolutePath(firstFrame);
      branchUpdateSet[`${branchPathPrefix}.thumbnailPath`] = persistBranchThumbnailFrame({
        sessionId,
        renderPathId: latestBranchContext.renderPathId,
        sourceFramePath: firstFramePath,
      });
      branchUpdateSet[`${branchPathPrefix}.thumbnailUrl`] = null;
      branchUpdateSet[`${branchPathPrefix}.thumbnailSource`] = {
        ...branchThumbnailSource,
        framePath: firstFrame,
      };
    }

    const branchUpdateResult = await VideoSession.updateOne(
      {
        _id: sessionId,
        [`${branchPathPrefix}.pathId`]: latestBranchContext.renderPathId,
        [`${branchPathPrefix}.frameGenerationStatus`]: { $ne: 'FAILED' },
        [`${branchPathPrefix}.timeline.${latestBranchContext.timelineIndex}.frameGenerationStatus`]: { $ne: 'FAILED' },
      },
      {
        $set: branchUpdateSet,
      },
    );
    if (branchUpdateResult.matchedCount !== 1) {
      throw new ObsoleteFrameGenerationError(
        `Render path ${latestBranchContext.renderPathId}, sequence ${latestBranchContext.pathSequenceIndex}, stopped accepting frames.`,
        { generationId, sessionId, layerId, ...branchOptions },
      );
    }

    await finalizeBranchPathFrames(sessionId, latestBranchContext.renderPathId, {
      canvasDimensions,
      framesPerSecond,
    });

    const defaultBranchPathId = normalizeId(latestSession.defaultBranchPathId) ||
      normalizeId(latestSession.branchRenderPaths?.[0]?.pathId);
    if (
      latestBranchContext.pathSequenceIndex === 0 &&
      latestBranchContext.renderPathId === defaultBranchPathId
    ) {
      const firstFrame = framesList[0];
      if (firstFrame) {
        const firstFramePath = resolveAssetAbsolutePath(firstFrame);
        const frameNameSpace = path.join('video', 'splash', sessionId);
        const splashTargets = [
          path.join(resolveSamsarProcessorAssetsRoot('v2'), frameNameSpace, 'splash.png'),
          path.join(resolveSamsarProcessorAssetsRoot('legacy'), frameNameSpace, 'splash.png'),
        ];
        for (const filePath of splashTargets) {
          try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.copyFileSync(firstFramePath, filePath);
          } catch (error) {
            console.error(`Error copying splash frame to ${filePath}: ${error.message}`);
          }
        }
      }
    }

    await handleFrameGenerationCompletion(
      generationId,
      sessionId,
      layerId,
      branchOptions,
    );
    return;
  }

  const latestLayerIndex = latestSession.layers.findIndex(
    layer => layer._id.toString() === layerId
  );
  if (latestLayerIndex === -1) {
    throw new ObsoleteFrameGenerationError(
      `Layer with ID ${layerId} not found in session ${sessionId}`,
      { generationId, sessionId, layerId }
    );
  }

  const latestLayer = latestSession.layers[latestLayerIndex];
  const updatedLayer = {
    ...latestLayer.toObject(),
    frames: framesList,
    frameGenerationPending: false
  };
  const isFinalPendingLayer = latestSession.layers.every((currentLayer, index) => (
    index === latestLayerIndex ? true : !currentLayer.frameGenerationPending
  ));

  let updateQuery = {
    $set: {
      [`layers.${latestLayerIndex}`]: updatedLayer,
      // Mark session's overall `frameGenerationPending` as false if *all* layers are done
      frameGenerationPending: !latestSession.layers.every((l, index) =>
        index === latestLayerIndex ? !updatedLayer.frameGenerationPending : !l.frameGenerationPending
      )
    }
  };

  if (isFinalPendingLayer) {
    const sessionAfterCurrentLayerCompletion = latestSession.toObject();
    sessionAfterCurrentLayerCompletion.layers[latestLayerIndex] = updatedLayer;
    sessionAfterCurrentLayerCompletion.frameGenerationPending = false;

    const appliedSceneTransitionPreset = await applySceneTransitionsToSession(
      sessionAfterCurrentLayerCompletion,
      {
        canvasDimensions,
        framesPerSecond,
      }
    );

    updateQuery.$set.appliedSceneTransitionPreset = appliedSceneTransitionPreset;
  }

  // If it's the first layer, copy the first frame as a splash
  if (latestLayerIndex === 0) {
    const firstFrame = framesList[0];
    if (firstFrame) {
      const firstFramePath = resolveAssetAbsolutePath(firstFrame);

      const frameNameSpace = path.join('video', 'splash', sessionId);
      const splashTargets = [
        path.join(resolveSamsarProcessorAssetsRoot('v2'), frameNameSpace, 'splash.png'),
        path.join(resolveSamsarProcessorAssetsRoot('legacy'), frameNameSpace, 'splash.png'),
      ];

      for (const filePath of splashTargets) {
        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.copyFileSync(firstFramePath, filePath);
        } catch (error) {
          console.error(`Error copying splash frame to ${filePath}: ${error.message}`);
        }
      }
    }
  }

  const updatedSession = await VideoSession.findByIdAndUpdate(sessionId, updateQuery, { new: true });
  if (!updatedSession) {
    throw new Error(`Failed to update session ${sessionId}`);
  }

  await handleFrameGenerationCompletion(generationId, sessionId, layerId);
}

function getGlobalVideosForLayer(session = {}, layer = {}) {
  const globalVideos = Array.isArray(session.global_videos)
    ? session.global_videos
    : Array.isArray(session.globalVideos)
      ? session.globalVideos
      : [];
  const layerStartTime = Math.max(0, Number(layer?.durationOffset) || 0);
  const layerEndTime = layerStartTime + Math.max(0, Number(layer?.duration) || 0);

  if (!(layerEndTime > layerStartTime)) {
    return [];
  }

  return globalVideos.filter((globalVideo) => {
    const startTime = Math.max(0, Number(globalVideo?.startTime) || 0);
    const endTime = Number.isFinite(Number(globalVideo?.endTime))
      ? Number(globalVideo.endTime)
      : startTime + Math.max(0, Number(globalVideo?.duration) || 0);
    return endTime > layerStartTime && startTime < layerEndTime;
  });
}

async function handleFrameGenerationCompletion(
  generationId,
  sessionId,
  layerId,
  branchOptions = {},
) {
  try {
    const latestSession = await VideoSession.findById(sessionId);
    if (!latestSession) {
      await deleteFrameGenerationAndSyncSession(generationId, sessionId);
      return;
    }

    if (normalizeId(branchOptions.renderPathId)) {
      let branchContext;
      try {
        branchContext = resolveBranchRenderContext(latestSession, {
          layerId,
          ...branchOptions,
        });
      } catch (error) {
        console.error('[frames_processor] Could not verify branched frame completion', {
          generationId,
          sessionId,
          layerId,
          renderPathId: branchOptions.renderPathId,
          pathSequenceIndex: branchOptions.pathSequenceIndex,
          error: error?.message || error,
        });
        await FrameGeneration.findByIdAndUpdate(
          generationId,
          { rowLocked: false, $inc: { numRetries: 1 } },
          { new: true },
        );
        return;
      }

      const latestEntry = branchContext.timelineEntry;
      if (
        Array.isArray(latestEntry?.frames) &&
        latestEntry.frames.length > 0 &&
        latestEntry.frameGenerationPending !== true &&
        latestEntry.frameGenerationStatus === 'COMPLETED'
      ) {
        await FrameGeneration.findByIdAndDelete(generationId);
      } else {
        await FrameGeneration.findByIdAndUpdate(
          generationId,
          { rowLocked: false, $inc: { numRetries: 1 } },
          { new: true },
        );
      }

      const remainingFrameGeneration = await FrameGeneration.findOne({ sessionId })
        .select('_id')
        .lean();
      await VideoSession.findByIdAndUpdate(sessionId, {
        frameGenerationPending: Boolean(remainingFrameGeneration),
      });
      return;
    }

    const latestLayerIndex = latestSession.layers.findIndex(
      layer => layer._id.toString() === layerId
    );
    if (latestLayerIndex === -1) {
      await deleteFrameGenerationAndSyncSession(generationId, sessionId);
      return;
    }

    const latestLayer = latestSession.layers[latestLayerIndex];
    if (latestLayer.frames && latestLayer.frames.length > 0 && !latestLayer.frameGenerationPending) {
      // Everything done for this layer
      await FrameGeneration.findByIdAndDelete(generationId);
    } else {
      // Not fully done? or error?
      await FrameGeneration.findByIdAndUpdate(
        generationId,
        {
          rowLocked: false,
          $inc: { numRetries: 1 }
        },
        { new: true }
      );
    }

    // If no more frame-generation records, mark the entire session as not pending
    const frameGenerationPending = await FrameGeneration.findOne({ sessionId: sessionId });
    if (!frameGenerationPending) {
      await VideoSession.findByIdAndUpdate(sessionId, { frameGenerationPending: false });
    }

  } catch (error) {
    console.error(`Error handling frame generation completion for ${generationId}: ${error.message}`);
  }
}

function createFramesInChildProcess(...args) {
  return new Promise((resolve, reject) => {
    // This is the child worker script
    const child = fork(path.resolve('./src/frameWorker.js'));

    const timeoutDuration = 600000; // e.g. 10 mins
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      console.error('Child timed out. Asking child to cancel gracefully...');
      child.send({ type: 'CANCEL' });

      // If it doesn’t exit in 5 seconds, force kill
      setTimeout(() => {
        child.kill('SIGTERM');
      }, 5000);
    }, timeoutDuration);

    // Handle normal close
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (signal) {
        console.error(`Child was killed by signal ${signal}`);
        reject(new Error(`Child killed by signal ${signal}`));
      } else if (code !== 0) {
        console.error(`Child exited with code ${code}`);
        reject(new Error(`Child exited with code ${code}`));
      } else {
        // code=0 => normal exit (which could be success or CANCEL)
        if (timedOut) {
          console.warn('Child exited gracefully after cancel/timeout');
          reject(new Error('Child canceled due to timeout'));
        } else {
          // If the child exited normally without sending a "COMPLETED" message,
          // we still consider it as completed but no frames were returned.
          resolve({ status: 'COMPLETED', framesList: [] });
        }
      }
    });

    // Listen for messages from the child
    child.on('message', (message) => {
      if (message.status === 'COMPLETED') {
        clearTimeout(timeout);
        resolve(message);
      } else if (message.status === 'ERROR') {
        clearTimeout(timeout);
        reject(new Error(message.error));
      }
      // "CANCELLED" or other statuses can be handled likewise, if desired
    });

    // Kick off the child's actual work
    child.send({
      type: 'START',
      generationId: args[0],
      layer: args[1],
      sessionId: args[2],
      startFrame: args[3],
      endFrame: args[4],
      canvasDimensions: args[5],
      applyAudioVisualizer: args[6],
      visualizerData: args[7],
      totalVideoDuration: args[8],
      framesPerSecond: args[9],
      globalVideos: args[10],
      narratorAvatarOverlay: args[11] || null,
      frameOutputNamespace: args[12],
    });
  });
}

// Optionally use this helper elsewhere
export async function removeAndRecreateDirectory(dirPath, maxRetries = 2, retryDelay = 1000) {
  return new Promise((resolve, reject) => {
    const attemptRemoval = (retriesLeft) => {
      try {
        if (fs.existsSync(dirPath)) {
          const removeRecursive = (currentPath) => {
            const files = fs.readdirSync(currentPath);
            for (const file of files) {
              const filePath = path.join(currentPath, file);
              if (fs.lstatSync(filePath).isDirectory()) {
                removeRecursive(filePath);
              } else {
                fs.unlinkSync(filePath);
              }
            }
            fs.rmdirSync(currentPath);
          };
          removeRecursive(dirPath);
        }
        fs.mkdirSync(dirPath, { recursive: true });
        resolve();
      } catch (error) {
        console.warn(
          `Failed to remove/recreate directory ${dirPath}. Retries left: ${retriesLeft}. Error: ${error.message}`
        );
        if (retriesLeft > 0) {
          setTimeout(() => attemptRemoval(retriesLeft - 1), retryDelay);
        } else {
          reject(
            new Error(
              `Failed to remove/recreate directory after ${maxRetries} attempts: ${error.message}`
            )
          );
        }
      }
    };
    attemptRemoval(maxRetries);
  });
}

export const __testOnly__ = {
  FatalFrameGenerationError,
  buildFrameGenerationFailureSet,
  buildBranchFrameGenerationFailureSet,
};
