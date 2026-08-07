import { getDBConnectionString } from "./DBString.js";
import VideoSession from "../schema/VideoSession.js";
import VideoSessionEditLog from "../schema/VideoSessionEditLog.js";
import Session from '../schema/Session.js';
import { Comment, Publication } from '../schema/Publication.js';
import GeneratedMusic from '../schema/generations/GeneratedMusic.js';
import GeneratedAIVideo from '../schema/generations/GeneratedAIVideo.js';
import GeneratedImage from '../schema/generations/GeneratedImage.js';
import { addImageGeneratorRequest, addImageEditRequest } from './Images.js';
import {
  updatePendingFramesFromLayers, getLayerFrameStartIndex,
  setSessionLayerFrames,
} from '../utils/video_utils/FrameUtils.js';
import fetch from 'node-fetch';
import FrameGeneration from "../schema/FrameGeneration.js";
import AudioGeneration from "../schema/AudioGeneration.js";
import UserVideoUploadTask from "../schema/UserVideoUploadTask.js";
import User from "../schema/User.js";
import {
  updatePromptWithTheme, generateThemeKeywords,
  updateCharacterPromptWithTheme,
  updatePromptWithCharacterPOV
} from './OpenAI.js';

import mongoose from "mongoose";
import axios from 'axios';
import fsExtra from 'fs-extra';
import hat from 'hat';
import path from 'path';
import { promisify } from 'util';
import { createCanvasFromLayer } from '../utils/video_utils/CanvasUtils.js';
import { uploadImageToFileSystem } from '../storage/Files.js';
import dns from 'dns';
import { createCanvas, loadImage } from 'canvas';
import { getAnimationPresetForType } from '../utils/AnimationUtils.js';
import { getModerationForNarrative } from './moderation/CreateModeration.js';
import { normalizeInferenceModel } from '../consts/InferenceModels.js';
import { assertSubtitleGenerationAvailable } from '../consts/DockerAudioAvailability.js';
import { resolveDockerLocalPublicProcessorBaseUrl } from '../consts/DockerDeploymentUrls.js';
import { translateSpeech } from './agent/AudioCreatorAgent.js';
import {
  applySubtitleLanguageSelectionForRerun,
  backfillTranslatedSubtitleMetadataForRerun,
  refreshSessionSubtitleTranslationRequired,
} from './movie_session/SubtitleLanguage.js';

import { requestGenerateCustomAIVideo } from './ai_video/index.js';

import { getModelType } from '../utils/video_utils/VideoTypeUtils.js';
import sharp from "sharp";
import ffmpeg from 'fluent-ffmpeg';
import { withProcessorFfmpegResources } from '../utils/FfmpegResources.js';
import { deletePublicPublicationMediaForSession } from './PublicationMedia.js';
import { deleteInteractivePublicationForSession } from './InteractivePublication.js';



import {
  updateCreditsAndCreateGenerateSpeechRequest,
  requestApplyAutoSynchronizeLayerDurationsToBeats,
  requestApplyMusicVisualizer,
  padBlankAudioAtBeginningAndEnd,

  requestRealignConnectedAudioLayersToLayers,

} from './audio/Audio.js';
import { getPresetAnimationListForDistribution } from '../utils/animation/AnimationUtils.js';
import { getCanvasDimensionsForAspectRatio } from '../utils/CanvasUtils.js';
import { normalizeStudioAiVideoSourceFramePayload } from '../utils/StudioAiVideoSourceFrame.js';
import { getAspectRatioPrefix, getAspectRatioPostfix } from './Utility.js';
import { getSessionFramesPerSecond as getSessionFramesPerSecondWithLog } from '../utils/FpsUtils.js';
import {
  applyAudioLayerManualVolumeDefaults,
} from '../utils/AudioVolumeAutomation.js';

import {
  requestApplyAutoSynchronizeBeats,
} from './audio/Audio.js';

import { getDurationForVideo } from './video/VideoUtils.js';

import {
  regenerateTranscriptsForSessionAudioLayer,
  removeTranscriptsForSessionAudioLayer
} from './transcripts/AudioLayerTranscript.js';

import { generateTranscriptsForSessionAudioLayer } from './transcripts/StudioSpeechSubtitles.js';

import {
  generateTranscriptsForSessionAudioLayers,
  generateTranscriptsForSessionAudioLayersAfterLayer,
} from "./transcripts/TranscriptGenerator.js";

import {
  processVideoAsFrames,
  processVideoAsFramesAndAudio,
  extractVideoBoundaryFrames,
  getVideoMetadata,
  saveUploadedVideoBuffer,
  appendUploadedVideoChunk,
  normalizeVideoAssetToMp4WithoutAudio,
  extractAudioFromVideoIfPresent,
} from './video/VideoProcessor.js';
import {
  annotateVideoEditSegmentsWithOutputTimeline,
  buildAudioEditSegmentsForConnectedAudio,
  applyConnectedAudioWindowToLayer,
  getConnectedAudioRelativeWindow,
  mapConnectedAudioWindowThroughEdgeTrim,
  mapConnectedAudioWindowThroughVideoEditSegments,
  recalculateLayerOffsetsAndConnectedAudio,
  roundConnectedAudioSeconds,
} from './video/ConnectedAudioTimeline.js';
import {
  resetLayerSoundEffectState,
} from './video/SoundEffectLayerState.js';
import {
  reconcileOrphanedLipSyncGenerationState,
} from './video/LipSyncLayerState.js';
import {
  extendSessionTimelineToCustomSpeechEnd,
  extendSessionTimelineToEndTime,
} from './video/SessionTimelineExtension.js';

import { buildSecureMediaDeliveryUrl, getObjectFromS3, uploadSpeechAudioToCDN } from './AWS.js';

import fs from 'fs';
import fsPromises from 'fs/promises';
import { resolveLocalMediaFilePath } from '../utils/LocalMediaAsset.js';
import { isContainerRuntime } from '../utils/EnvironmentUtils.js';
import { randomBytes, randomUUID } from 'crypto';
import VideoLayerEditTask from '../schema/VideoLayerEditTask.js';
import {
  createLoopedAudioTrackForDuration,
  getAudioDurationSecondsForLink,
  getAudioDurationSeconds,
  getSessionAudioFolderPath,
  resolveAudioLinkToLocalPath,
  toAssetRelativePath,
} from './audio/AudioUtils.js';

const IMAGE_SERVER = 'http://127.0.0.1:3021';

const API_SERVER = process.env.API_SERVER;

const DEFAULT_FRAMES_PER_SECOND = 24;
const VALID_FRAMES_PER_SECOND = new Set([16, 24, 30]);
const MAX_SESSION_NAME_LENGTH = 120;
const MAX_SESSION_DESCRIPTION_LENGTH = 1000;
const TRACK_EDITOR_FRAMES_PER_SECOND = 30;
const VIDEO_EDIT_MAX_OPERATIONS = 12;
const DEFAULT_SCENE_TRANSITION_PRESET = 'none';
const VALID_SCENE_TRANSITION_PRESETS = new Set(['none', 'fade', 'dissolve']);
const READ_ONLY_SHARE_TOKEN_BYTES = 32;
const READ_ONLY_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const EDITABLE_SHARE_TOKEN_BYTES = 32;
const DEFAULT_STATIC_ASSET_BASE_URL = 'https://static.samsar.one';
const USER_RESOURCES_PREFIX = 'user_resources/';
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET || 'samsar-resources';
const SHARE_OG_IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif)(?:\?.*)?$/i;
const GUEST_MEDIA_ROUTE_PREFIX = '/video_sessions/guest_media';

function normalizeReadOnlyShareToken(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const token = value.trim();
  return READ_ONLY_SHARE_TOKEN_PATTERN.test(token) ? token : null;
}

function normalizeEditableShareToken(value) {
  return normalizeReadOnlyShareToken(value);
}

function normalizeAiVideoGenerationRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  return value
    .trim()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/+/, '')
    .replace(/^assets_v2\/?/, '')
    .replace(/^assets\/?/, '')
    .replace(/^ai_video\/generations\/?/, '');
}

function resolveLayerAiVideoRemoteUrl({ layer, userId }) {
  // Prefer the durable mounted copy. Provider result URLs (FAL, signed CDN,
  // etc.) may expire before a later lip-sync or sound-effect request. The
  // downstream video worker resolves this canonical asset into a fresh public
  // URL only when it submits to the external adapter.
  const relativeVideoPath = normalizeAiVideoGenerationRelativePath(layer?.aiVideoLayer);
  if (relativeVideoPath && userId) {
    return `/${SECURE_ASSET_PREFIX}/${USER_RESOURCES_PREFIX}${userId}/ai_videos/${relativeVideoPath}`;
  }

  const remoteLink = [
    layer?.aiVideoRemoteLink,
    layer?.soundEffectRemoteLink,
    layer?.lipSyncRemoteLink,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim());
  if (remoteLink) {
    return buildSecureMediaDeliveryUrl(remoteLink) || remoteLink;
  }
  return null;
}

function shouldUseDockerLocalMediaDelivery(env = process.env) {
  const mode = String(env.SAMSAR_MEDIA_DELIVERY_MODE || env.MEDIA_DELIVERY_MODE || '')
    .trim()
    .toLowerCase();
  if (mode === 'docker-local' || mode === 'local-filesystem') return true;
  if (mode === 's3-cloudfront' || mode === 'external-s3') return false;
  const externalBucket = String(
    env.MEDIA_BUCKET_NAME || env.STATIC_CDN_BUCKET || env.SAMSAR_EXTERNAL_MEDIA_BUCKET || '',
  ).trim();
  const externalBaseUrl = String(
    env.STATIC_CDN_URL || env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL || '',
  ).trim();
  if (externalBucket && /^https:\/\//i.test(externalBaseUrl)) return false;
  const externalPublish = ['1', 'true', 'yes', 'on'].includes(
    String(env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED || env.EXTERNAL_MEDIA_PUBLISH_ENABLED || '')
      .trim()
      .toLowerCase(),
  );
  return isContainerRuntime(env) && !externalPublish;
}

function selectMediaDeliverySource({ local, remote, generated } = {}, env = process.env) {
  return shouldUseDockerLocalMediaDelivery(env)
    ? getFirstNonEmptyString(local, generated, remote)
    : getFirstNonEmptyString(remote, generated, local);
}

async function generateUniqueReadOnlyShareToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(READ_ONLY_SHARE_TOKEN_BYTES).toString('base64url');
    const existingSession = await VideoSession.exists({ shareToken: token });
    if (!existingSession) {
      return token;
    }
  }
  throw new Error('Unable to generate a unique share token.');
}

async function generateUniqueEditableShareToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(EDITABLE_SHARE_TOKEN_BYTES).toString('base64url');
    const existingSession = await VideoSession.exists({ editableShareToken: token });
    if (!existingSession) {
      return token;
    }
  }
  throw new Error('Unable to generate a unique editable share token.');
}

function normalizeShareMode(value) {
  const normalized = normalizeShareOgString(value).toLowerCase().replace(/[\s-]+/g, '_');
  return normalized === 'editable' || normalized === 'edit' || normalized === 'editable_link'
    ? 'editable'
    : 'read_only';
}

function getSessionIdFromPayload(payload = {}) {
  return (
    payload.sessionId ||
    payload.videoSessionId ||
    payload.id ||
    payload.video_session_id ||
    payload.session_id ||
    null
  );
}

function getEditableShareTokenFromPayload(payload = {}) {
  return normalizeEditableShareToken(
    payload.editableShareToken ||
    payload.editable_share_token ||
    payload.shareEditToken ||
    payload.share_edit_token
  );
}

function toUserIdString(userId) {
  return userId?.toString?.() || userId || null;
}

function isSessionOwner(session, userId) {
  const ownerId = toUserIdString(session?.userId);
  const requesterId = toUserIdString(userId);
  return Boolean(ownerId && requesterId && ownerId === requesterId);
}

function getEditableShareImportedUserIds(session = {}) {
  return Array.isArray(session?.editableShareImportedUserIds)
    ? session.editableShareImportedUserIds.map(toUserIdString).filter(Boolean)
    : [];
}

function hasImportedEditableSession(session, userId) {
  const requesterId = toUserIdString(userId);
  return Boolean(requesterId && getEditableShareImportedUserIds(session).includes(requesterId));
}

function sanitizeEditLogValue(value, depth = 0) {
  if (depth > 3) {
    return '[nested]';
  }

  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return '[data-url]';
    }
    return value.length > 800 ? `${value.slice(0, 800)}...` : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > 20) {
      return {
        type: 'array',
        length: value.length,
        sample: value.slice(0, 5).map((item) => sanitizeEditLogValue(item, depth + 1)),
      };
    }
    return value.map((item) => sanitizeEditLogValue(item, depth + 1));
  }

  const result = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes('authorization') ||
      normalizedKey.includes('token') ||
      normalizedKey.includes('apikey') ||
      normalizedKey.includes('api_key') ||
      normalizedKey.includes('password')
    ) {
      continue;
    }
    if (['layers', 'audioLayers', 'global_audio_layers', 'activeItemList'].includes(key)) {
      result[key] = Array.isArray(entryValue)
        ? { type: 'array', length: entryValue.length }
        : '[omitted]';
      continue;
    }
    result[key] = sanitizeEditLogValue(entryValue, depth + 1);
  }
  return result;
}

async function markEditableShareAccess(session, userId, { edited = false } = {}) {
  const requesterId = toUserIdString(userId);
  if (!session || !requesterId || isSessionOwner(session, requesterId)) {
    return;
  }

  const now = new Date();
  const collaborators = Array.isArray(session.editableShareCollaborators)
    ? [...session.editableShareCollaborators]
    : [];
  const existingIndex = collaborators.findIndex(
    (collaborator) => toUserIdString(collaborator?.userId) === requesterId
  );

  if (existingIndex >= 0) {
    collaborators[existingIndex] = {
      ...collaborators[existingIndex],
      userId: requesterId,
      lastAccessedAt: now,
      lastEditedAt: edited ? now : collaborators[existingIndex].lastEditedAt,
    };
  } else {
    collaborators.push({
      userId: requesterId,
      firstAccessedAt: now,
      lastAccessedAt: now,
      lastEditedAt: edited ? now : null,
    });
  }

  session.editableShareCollaborators = collaborators;
  const importedUserIds = getEditableShareImportedUserIds(session);
  if (!importedUserIds.includes(requesterId)) {
    session.editableShareImportedUserIds = [...importedUserIds, requesterId];
  }
  session.editableShareLastViewedAt = now;
  if (edited) {
    session.editableShareLastEditedAt = now;
  }
}

async function findVideoSessionForStudioAccess(userId, sessionId, payload = {}, options = {}) {
  const normalizedUserId = toUserIdString(userId);
  if (!normalizedUserId || !sessionId) {
    return null;
  }

  const session = await VideoSession.findById(sessionId);
  if (!session) {
    return null;
  }

  if (isSessionOwner(session, normalizedUserId)) {
    return session;
  }

  if (options.ownerOnly) {
    return null;
  }

  if (session.editableShareEnabled === true && hasImportedEditableSession(session, normalizedUserId)) {
    await markEditableShareAccess(session, normalizedUserId, { edited: Boolean(options.markEdited) });
    return session;
  }

  const editableShareToken = getEditableShareTokenFromPayload(payload);
  if (
    editableShareToken &&
    session.editableShareEnabled === true &&
    session.editableShareToken === editableShareToken
  ) {
    await markEditableShareAccess(session, normalizedUserId, { edited: Boolean(options.markEdited) });
    return session;
  }

  return null;
}

async function requireVideoSessionForStudioAccess(userId, sessionId, payload = {}, options = {}) {
  const session = await findVideoSessionForStudioAccess(userId, sessionId, payload, options);
  if (!session) {
    const error = new Error('Video session not found or not editable by this user.');
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }
  return session;
}

export async function assertVideoSessionEditableAccess(userId, payload = {}, options = {}) {
  await getDBConnectionString();
  const sessionId = getSessionIdFromPayload(payload);
  return requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    ...options,
    markEdited: options.markEdited !== false,
  });
}

export async function logSharedSessionEditOperation(userId, payload = {}, options = {}) {
  try {
    await getDBConnectionString();
    const sessionId = getSessionIdFromPayload(payload);
    if (!sessionId) {
      return null;
    }

    const session = await VideoSession.findById(sessionId).select(
      'userId shareEnabled editableShareEnabled editableShareToken editableShareImportedUserIds'
    );
    if (!session || (session.shareEnabled !== true && session.editableShareEnabled !== true)) {
      return null;
    }

    const editableShareToken = getEditableShareTokenFromPayload(payload);
    const shareMode = isSessionOwner(session, userId)
      ? 'owner'
      : editableShareToken && session.editableShareToken === editableShareToken
        ? 'editable_link'
        : hasImportedEditableSession(session, userId)
          ? 'editable_imported'
          : 'shared';

    return VideoSessionEditLog.create({
      sessionId,
      sessionOwnerId: toUserIdString(session.userId),
      userId: toUserIdString(userId),
      operation: options.operation || 'studio_update',
      category: options.category || 'update',
      route: options.route || null,
      shareMode,
      payloadSummary: sanitizeEditLogValue(payload || {}),
      metadata: sanitizeEditLogValue(options.metadata || {}),
    });
  } catch (error) {
    console.error('Unable to write shared session edit log', error?.message || error);
    return null;
  }
}

function normalizeShareOgString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPublicApiBaseUrl() {
  if (shouldUseDockerLocalMediaDelivery()) {
    return resolveDockerLocalPublicProcessorBaseUrl();
  }
  return (
    normalizeShareOgString(API_SERVER) ||
    normalizeShareOgString(process.env.PUBLIC_API_BASE_URL) ||
    normalizeShareOgString(process.env.PUBLIC_BASE_URL) ||
    normalizeShareOgString(process.env.PROCESSOR_API)
  ).replace(/\/+$/, '');
}

function getStaticAssetBaseUrl() {
  return (
    normalizeShareOgString(process.env.STATIC_CDN_URL) ||
    normalizeShareOgString(process.env.PUBLIC_STATIC_CDN_URL) ||
    DEFAULT_STATIC_ASSET_BASE_URL
  ).replace(/\/+$/, '');
}

function normalizeShareOgRawAssetPath(value) {
  const normalized = normalizeShareOgString(value);
  if (!normalized || /^data:|^blob:/i.test(normalized)) {
    return null;
  }

  if (/^\/\//.test(normalized)) {
    return `https:${normalized}`;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const assetsIndex = normalized.indexOf('/assets/');
  const strippedAssetsPath = assetsIndex >= 0
    ? normalized.slice(assetsIndex + '/assets/'.length)
    : normalized
      .replace(/^\.?\/?assets\//, '')
      .replace(/^\/+/, '');

  if (
    !strippedAssetsPath.includes('/') &&
    SHARE_OG_IMAGE_EXTENSION_PATTERN.test(strippedAssetsPath)
  ) {
    return `generations/${strippedAssetsPath}`;
  }

  return strippedAssetsPath;
}

function normalizeShareOgAssetUrl(value) {
  const normalized = normalizeShareOgRawAssetPath(value);
  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (pathname.startsWith(USER_RESOURCES_PREFIX)) {
        return {
          url: `${getStaticAssetBaseUrl()}/${pathname}${parsedUrl.search || ''}`,
          path: pathname,
        };
      }
    } catch {
      return null;
    }
    return { url: normalized, path: null };
  }

  if (!SHARE_OG_IMAGE_EXTENSION_PATTERN.test(normalized)) {
    return null;
  }

  const relativePath = normalized.replace(/^\/+/, '');
  if (relativePath.startsWith(USER_RESOURCES_PREFIX)) {
    return {
      url: `${getStaticAssetBaseUrl()}/${relativePath}`,
      path: relativePath,
    };
  }

  const localCandidates = getProcessorAssetPathCandidates(normalized);
  const localAssetExists = localCandidates.some((candidate) => fs.existsSync(candidate));
  if (!localAssetExists) {
    return null;
  }

  const baseUrl = getPublicApiBaseUrl();

  return {
    url: baseUrl ? `${baseUrl}/${relativePath}` : `/${relativePath}`,
    path: relativePath,
  };
}

function getShareOgImageItemAssetUrl(item = {}) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return [
    item.aiLayerStartFrame,
    item.aiVideoFrameImage,
    item.videoFrameImage,
    item.sourceImage,
    item.sourceImageUrl,
    item.sourceImageURL,
    item.src,
    item.image,
    item.url,
    item.imageUrl,
    item.image_url,
    item.selectedImageUrl,
    item.selected_image_url,
    item.generatedImage?.url,
    item.generatedImage?.src,
    item.generated_image?.url,
    item.generated_image?.src,
    item.remoteURL,
    item.remoteUrl,
    item.remote_url,
  ].find((candidate) => normalizeShareOgString(candidate)) || null;
}

function pushShareOgImageCandidate(candidates, value, source) {
  const normalizedAsset = normalizeShareOgAssetUrl(value);
  if (!normalizedAsset?.url) {
    return;
  }

  if (candidates.some((candidate) => candidate.url === normalizedAsset.url)) {
    return;
  }

  candidates.push({
    url: normalizedAsset.url,
    path: normalizedAsset.path,
    source,
  });
}

function getOrderedShareOgLayers(session = {}) {
  const layers = Array.isArray(session?.layers) ? session.layers : [];
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => {
      const leftOffset = Number(left.layer?.durationOffset);
      const rightOffset = Number(right.layer?.durationOffset);
      const normalizedLeftOffset = Number.isFinite(leftOffset) ? leftOffset : left.index;
      const normalizedRightOffset = Number.isFinite(rightOffset) ? rightOffset : right.index;
      if (normalizedLeftOffset !== normalizedRightOffset) {
        return normalizedLeftOffset - normalizedRightOffset;
      }
      return left.index - right.index;
    });
}

function resolveReadOnlyShareOgImage(session = {}) {
  const sessionCandidates = [];
  pushShareOgImageCandidate(sessionCandidates, session.splashImage, 'session.splashImage');
  pushShareOgImageCandidate(sessionCandidates, session.publishedSplashImage, 'session.publishedSplashImage');

  const orderedLayers = getOrderedShareOgLayers(session);
  for (const { layer, index } of orderedLayers) {
    const candidates = [];
    const imageSession = layer?.imageSession || {};

    pushShareOgImageCandidate(candidates, layer?.aiLayerStartFrame, `layers.${index}.aiLayerStartFrame`);
    pushShareOgImageCandidate(candidates, layer?.baseLayerStartFrame, `layers.${index}.baseLayerStartFrame`);
    pushShareOgImageCandidate(candidates, imageSession?.videoRenderStartFrameImage, `layers.${index}.imageSession.videoRenderStartFrameImage`);
    pushShareOgImageCandidate(candidates, layer?.aiVideoThumbnailPath, `layers.${index}.aiVideoThumbnailPath`);
    pushShareOgImageCandidate(candidates, layer?.lipSyncThumbnailPath, `layers.${index}.lipSyncThumbnailPath`);
    pushShareOgImageCandidate(candidates, layer?.soundEffectThumbnailPath, `layers.${index}.soundEffectThumbnailPath`);
    pushShareOgImageCandidate(candidates, layer?.userVideoThumbnailPath, `layers.${index}.userVideoThumbnailPath`);
    pushShareOgImageCandidate(candidates, layer?.thumbnailPath, `layers.${index}.thumbnailPath`);

    const activeItems = Array.isArray(imageSession?.activeItemList) ? imageSession.activeItemList : [];
    const baseImageItem = activeItems.find((item) => item?.is_base_image === true) ||
      activeItems.find((item) => item?.type === 'image') ||
      null;
    pushShareOgImageCandidate(
      candidates,
      getShareOgImageItemAssetUrl(baseImageItem),
      `layers.${index}.imageSession.activeItemList`
    );

    pushShareOgImageCandidate(candidates, imageSession?.activeImageRemoteLink, `layers.${index}.imageSession.activeImageRemoteLink`);
    pushShareOgImageCandidate(candidates, imageSession?.activeGeneratedImage, `layers.${index}.imageSession.activeGeneratedImage`);
    pushShareOgImageCandidate(candidates, imageSession?.activeEditedImage, `layers.${index}.imageSession.activeEditedImage`);
    pushShareOgImageCandidate(candidates, imageSession?.activeSelectedImage, `layers.${index}.imageSession.activeSelectedImage`);

    if (candidates.length > 0) {
      return candidates[0];
    }
  }

  return sessionCandidates[0] || null;
}

function normalizeSessionListThumbnailCandidate(value) {
  const normalized = normalizeShareOgString(value);
  if (!normalized) {
    return null;
  }

  if (/^data:image\//i.test(normalized) || /^blob:/i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = decodeURIComponent(parsedUrl.pathname);
      return SHARE_OG_IMAGE_EXTENSION_PATTERN.test(pathname) ? normalized : null;
    } catch {
      return null;
    }
  }

  const relativePath = normalizeShareOgRawAssetPath(normalized) || normalized.replace(/^\/+/, '');
  return SHARE_OG_IMAGE_EXTENSION_PATTERN.test(relativePath) ? normalized : null;
}

function buildSessionListThumbnailUrl(value) {
  const normalized = normalizeShareOgString(value);
  if (!normalized) {
    return null;
  }

  if (/^data:image\//i.test(normalized) || /^blob:/i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      const localAssetUrl = buildProcessorStaticAssetUrlForLocalAsset(pathname);
      if (localAssetUrl) {
        return localAssetUrl;
      }
      if (pathname.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
        return buildSecureMediaDeliveryUrl(pathname) || normalized;
      }
      if (pathname.startsWith(USER_RESOURCES_PREFIX)) {
        return `${getStaticAssetBaseUrl()}/${pathname}${parsedUrl.search || ''}`;
      }
    } catch {
      return null;
    }
    return normalized;
  }

  const relativePath = (normalizeShareOgRawAssetPath(normalized) || normalized).replace(/^\/+/, '');
  const localAssetUrl = buildProcessorStaticAssetUrlForLocalAsset(relativePath);
  if (localAssetUrl) {
    return localAssetUrl;
  }
  if (relativePath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return buildSecureMediaDeliveryUrl(relativePath);
  }
  if (relativePath.startsWith(USER_RESOURCES_PREFIX)) {
    return `${getStaticAssetBaseUrl()}/${relativePath}`;
  }

  const baseUrl = getPublicApiBaseUrl();
  return baseUrl ? `${baseUrl}/${relativePath}` : `/${relativePath}`;
}

function pushSessionListThumbnailCandidate(candidates, value) {
  const normalized = normalizeSessionListThumbnailCandidate(value);
  if (!normalized || candidates.includes(normalized)) {
    return;
  }
  candidates.push(normalized);
}

function collectSessionListThumbnailCandidates(session = {}) {
  const candidates = [];
  pushSessionListThumbnailCandidate(candidates, session.splashImage);
  pushSessionListThumbnailCandidate(candidates, session.publishedSplashImage);

  const orderedLayers = getOrderedShareOgLayers(session);
  for (const { layer } of orderedLayers) {
    const imageSession = layer?.imageSession || {};
    const activeItems = Array.isArray(imageSession?.activeItemList) ? imageSession.activeItemList : [];
    const baseImageItem = activeItems.find((item) => item?.is_base_image === true) ||
      activeItems.find((item) => item?.type === 'image') ||
      null;
    // Prefer the durable image selected for the scene. Boundary frames and
    // generated video thumbnails are transient artifacts and were cleaned up
    // for some older sessions even though their source image still exists.
    pushSessionListThumbnailCandidate(candidates, getShareOgImageItemAssetUrl(baseImageItem));
    pushSessionListThumbnailCandidate(candidates, imageSession?.activeImageRemoteLink);
    pushSessionListThumbnailCandidate(candidates, imageSession?.activeSelectedImage);
    pushSessionListThumbnailCandidate(candidates, imageSession?.activeEditedImage);
    pushSessionListThumbnailCandidate(candidates, imageSession?.activeGeneratedImage);
    pushSessionListThumbnailCandidate(candidates, imageSession?.videoRenderStartFrameImage);
    pushSessionListThumbnailCandidate(candidates, layer?.aiLayerStartFrame);
    pushSessionListThumbnailCandidate(candidates, layer?.baseLayerStartFrame);
    pushSessionListThumbnailCandidate(candidates, layer?.aiVideoThumbnailPath);
    pushSessionListThumbnailCandidate(candidates, layer?.lipSyncThumbnailPath);
    pushSessionListThumbnailCandidate(candidates, layer?.soundEffectThumbnailPath);
    pushSessionListThumbnailCandidate(candidates, layer?.userVideoThumbnailPath);
    pushSessionListThumbnailCandidate(candidates, layer?.thumbnailPath);
  }

  return candidates;
}

function buildProcessorStaticAssetUrl(publicPath) {
  const normalizedPath = normalizeShareOgString(publicPath).replace(/^\/+/, '');
  if (!normalizedPath) {
    return null;
  }

  const baseUrl = getPublicApiBaseUrl();
  return baseUrl ? `${baseUrl}/${normalizedPath}` : `/${normalizedPath}`;
}

function buildProcessorStaticAssetUrlForLocalAsset(assetPath) {
  const publicPath = resolveProcessorStaticAssetPublicPath(assetPath);
  return publicPath ? buildProcessorStaticAssetUrl(publicPath) : null;
}

function buildSessionListThumbnailPayload(session = {}, sessionId) {
  const fallbackThumbnail = `/video/splash/${sessionId}/splash.png`;
  const candidates = collectSessionListThumbnailCandidates(session);
  const resolvedCandidates = [];
  for (const thumbnail of candidates) {
    const thumbnailUrl = buildSessionListThumbnailUrl(thumbnail);
    if (!thumbnailUrl || resolvedCandidates.some((candidate) => candidate.thumbnailUrl === thumbnailUrl)) {
      continue;
    }
    resolvedCandidates.push({ thumbnail, thumbnailUrl });
    if (resolvedCandidates.length >= 4) {
      break;
    }
  }

  if (resolvedCandidates.length > 0) {
    return {
      ...resolvedCandidates[0],
      thumbnailUrls: resolvedCandidates.map((candidate) => candidate.thumbnailUrl),
    };
  }

  const fallbackThumbnailUrl = buildSessionListThumbnailUrl(fallbackThumbnail) || fallbackThumbnail;
  return {
    thumbnail: fallbackThumbnail,
    thumbnailUrl: fallbackThumbnailUrl,
    thumbnailUrls: [fallbackThumbnailUrl],
  };
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

function shouldRefreshFramesForSceneTransitionPreset(videoSession, desiredPreset) {
  const desiredTransitionPreset = normalizeSceneTransitionPreset(desiredPreset);
  const appliedTransitionPreset = normalizeSceneTransitionPreset(
    videoSession?.appliedSceneTransitionPreset
  );
  const layerCount = Array.isArray(videoSession?.layers)
    ? videoSession.layers.length
    : 0;

  return layerCount > 1 && desiredTransitionPreset !== appliedTransitionPreset;
}

function markAllSessionLayersPendingForFrameGeneration(videoSession) {
  if (!videoSession || !Array.isArray(videoSession.layers)) {
    return;
  }

  for (const layer of videoSession.layers) {
    layer.frameGenerationPending = true;
  }

  if (videoSession.layers.length > 0) {
    videoSession.frameGenerationPending = true;
  }
}
const VIDEO_EDIT_MAX_SPEED_MULTIPLIER = 8;
const VIDEO_EDIT_EDITOR_FRAME_TOLERANCE_SECONDS = (1 / TRACK_EDITOR_FRAMES_PER_SECOND) + 0.001;
const VIDEO_EDIT_STATUS = {
  INIT: 'INIT',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};
const VIDEO_EDIT_OPERATION_TYPES = {
  REMOVE: 'REMOVE',
  SPEED: 'SPEED',
};

function normalizeFramesPerSecond(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.round(parsed);
  if (!VALID_FRAMES_PER_SECOND.has(rounded)) {
    return null;
  }
  return rounded;
}

function resolveFramesPerSecond(value) {
  return normalizeFramesPerSecond(value) ?? DEFAULT_FRAMES_PER_SECOND;
}

function normalizeSessionText(value, maxLength) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getFirstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function getSessionMetadataFromPayload(payload = {}) {
  return {
    sessionName: normalizeSessionText(
      payload.sessionName || payload.session_name || payload.name,
      MAX_SESSION_NAME_LENGTH
    ),
    sessionDescription: normalizeSessionText(
      payload.sessionDescription || payload.session_description || payload.description,
      MAX_SESSION_DESCRIPTION_LENGTH
    ),
  };
}

async function getUserFramesPerSecond(userId) {
  if (!userId) {
    return DEFAULT_FRAMES_PER_SECOND;
  }
  const userData = await User.findById(userId).select('videoFramesPerSecond').lean();
  return resolveFramesPerSecond(userData?.videoFramesPerSecond);
}

function resolveFramesPerSecondOverride(overrideFramesPerSecond) {
  const parsedOverride = Number(overrideFramesPerSecond);
  if (Number.isFinite(parsedOverride) && parsedOverride > 0) {
    return parsedOverride;
  }
  return null;
}

function resolveSessionSubtitlesEnabled(sessionData = {}) {
  if (typeof sessionData?.hasSubtitles === 'boolean') {
    return sessionData.hasSubtitles;
  }

  if (typeof sessionData?.has_subtitles === 'boolean') {
    return sessionData.has_subtitles;
  }

  if (typeof sessionData?.enableSubtitles === 'boolean') {
    return sessionData.enableSubtitles;
  }

  return true;
}

function shouldRegenerateSubtitlesForSession(sessionData) {
  if (!sessionData) {
    return false;
  }
  if (!resolveSessionSubtitlesEnabled(sessionData)) {
    return false;
  }
  const speechAudioLayers = (sessionData.audioLayers || []).filter(
    (layer) => layer.generationType === 'speech'
  );
  return speechAudioLayers.length > 0;
}

function normalizeAudioLayerArrayManualVolumeSettings(audioLayers = []) {
  if (!Array.isArray(audioLayers)) {
    return [];
  }

  return audioLayers.map((audioLayer) => applyAudioLayerManualVolumeDefaults(audioLayer));
}

function resolveProcessorAssetsRoot() {
  if (process.env.SAMSAR_ASSETS_V2_ROOT) return process.env.SAMSAR_ASSETS_V2_ROOT;
  if (isContainerRuntime()) return '/assets_v2';
  return path.join(process.cwd(), 'assets_v2');
}

function getProcessorAssetsV2RootCandidates() {
  const candidates = [];
  const isDockerLike = isContainerRuntime();

  if (isDockerLike) {
    candidates.push(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2');
    candidates.push(path.join(process.cwd(), 'assets_v2'));
    candidates.push(path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2'));
  } else {
    candidates.push(path.join(process.cwd(), 'assets_v2'));
    candidates.push(path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2'));
    candidates.push(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2');
  }

  return candidates;
}

function getProcessorLegacyAssetsRootCandidates() {
  const candidates = [];
  const isDockerLike = isContainerRuntime();

  if (isDockerLike) {
    candidates.push(process.env.SAMSAR_ASSETS_ROOT || '/assets');
    candidates.push(path.join(process.cwd(), 'assets'));
    candidates.push(path.join(process.cwd(), '..', 'samsar_processor', 'assets'));
  } else {
    candidates.push(path.join(process.cwd(), 'assets'));
    candidates.push(path.join(process.cwd(), '..', 'samsar_processor', 'assets'));
    candidates.push('/assets');
  }

  return candidates;
}

function dedupePaths(candidates) {
  const seen = new Set();
  const unique = [];
  for (const root of candidates) {
    if (!root || seen.has(root)) {
      continue;
    }
    seen.add(root);
    unique.push(root);
  }

  return unique;
}

function getProcessorAssetsRootCandidates() {
  return dedupePaths([
    ...getProcessorAssetsV2RootCandidates(),
    ...getProcessorLegacyAssetsRootCandidates(),
  ]);
}

function getNormalizedAssetPath(assetPath) {
  if (typeof assetPath !== 'string') {
    return '';
  }
  const trimmedPath = assetPath.trim();
  if (/^https?:\/\//i.test(trimmedPath)) {
    try {
      const urlPath = decodeURIComponent(new URL(trimmedPath).pathname).replace(/^\/+/, '');
      if (urlPath.startsWith('assets_v2/')) {
        return urlPath;
      }
      return urlPath.replace(/^assets\//, '');
    } catch {
      return '';
    }
  }
  const normalizedPath = trimmedPath.replace(/^\/+/, '');
  if (normalizedPath.startsWith('assets_v2/')) {
    return normalizedPath;
  }
  return normalizedPath.replace(/^assets\//, '');
}

function getProcessorAssetPathCandidates(assetPath) {
  const normalized = getNormalizedAssetPath(assetPath);
  if (!normalized) {
    return [];
  }

  const isAssetsV2Path = normalized.startsWith('assets_v2/');
  const normalizedWithoutPrefix = isAssetsV2Path
    ? normalized.replace(/^assets_v2\//, '')
    : normalized;
  const normalizedVariants = [normalizedWithoutPrefix];
  if (normalizedWithoutPrefix.startsWith('ai_video/')) {
    normalizedVariants.push(normalizedWithoutPrefix.replace(/^ai_video\//, 'video/'));
  } else if (normalizedWithoutPrefix.startsWith('video/')) {
    normalizedVariants.push(normalizedWithoutPrefix.replace(/^video\//, 'ai_video/'));
  }

  const candidateRelativePaths = isAssetsV2Path
    ? normalizedVariants
    : normalizedVariants;
  const roots = isAssetsV2Path
    ? getProcessorAssetsV2RootCandidates()
    : getProcessorAssetsRootCandidates();
  const candidates = [];
  for (const root of roots) {
    for (const relPath of candidateRelativePaths) {
      candidates.push(path.join(root, relPath));
    }
  }

  return candidates;
}

function getProcessorAssetPublicPathCandidates(assetPath) {
  const normalized = getNormalizedAssetPath(assetPath);
  if (!normalized) {
    return [];
  }

  const isAssetsV2Path = normalized.startsWith('assets_v2/');
  const normalizedWithoutPrefix = isAssetsV2Path
    ? normalized.replace(/^assets_v2\//, '')
    : normalized;
  const normalizedVariants = [normalizedWithoutPrefix];
  if (normalizedWithoutPrefix.startsWith('ai_video/')) {
    normalizedVariants.push(normalizedWithoutPrefix.replace(/^ai_video\//, 'video/'));
  } else if (normalizedWithoutPrefix.startsWith('video/')) {
    normalizedVariants.push(normalizedWithoutPrefix.replace(/^video\//, 'ai_video/'));
  }

  const candidates = [];
  const seen = new Set();
  const pushCandidates = (roots, buildPublicPath) => {
    for (const root of roots) {
      for (const relPath of normalizedVariants) {
        const absolutePath = path.join(root, relPath);
        const publicPath = buildPublicPath(relPath);
        const key = `${absolutePath}:${publicPath}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        candidates.push({ absolutePath, publicPath });
      }
    }
  };

  if (isAssetsV2Path) {
    pushCandidates(
      getProcessorAssetsV2RootCandidates(),
      (relPath) => path.posix.join('assets_v2', relPath.split(path.sep).join('/'))
    );
  } else {
    pushCandidates(
      getProcessorAssetsV2RootCandidates(),
      (relPath) => path.posix.join('assets_v2', relPath.split(path.sep).join('/'))
    );
    pushCandidates(
      getProcessorLegacyAssetsRootCandidates(),
      (relPath) => relPath.split(path.sep).join('/')
    );
  }

  return candidates;
}

function resolveProcessorStaticAssetPublicPath(assetPath) {
  const candidates = getProcessorAssetPublicPathCandidates(assetPath);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.absolutePath)) {
      return candidate.publicPath;
    }
  }
  return null;
}

function resolveProcessorAssetAbsolutePath(assetPath) {
  const candidates = getProcessorAssetPathCandidates(assetPath);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] || path.join(resolveProcessorAssetsRoot(), getNormalizedAssetPath(assetPath));
}

function getMaxNumericPngFrameIndexFromDir(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    let maxIndex = -1;
    for (const file of files) {
      if (!file.endsWith('.png')) {
        continue;
      }
      const parsed = Number.parseInt(file.slice(0, -4), 10);
      if (Number.isFinite(parsed) && parsed > maxIndex) {
        maxIndex = parsed;
      }
    }
    return maxIndex;
  } catch {
    return -1;
  }
}

function parseNumericPngFrameName(fileName) {
  if (typeof fileName !== 'string' || !fileName.endsWith('.png')) {
    return null;
  }

  const parsed = Number.parseInt(fileName.slice(0, -4), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAvailableNumericPngFrames(dirPath) {
  try {
    return fs.readdirSync(dirPath)
      .map(parseNumericPngFrameName)
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
  } catch {
    return [];
  }
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

  const availableFrames = getAvailableNumericPngFrames(path.dirname(requestedPath));
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

  const resolvedPath = path.join(path.dirname(requestedPath), `${resolvedFrameIndex}.png`);
  return fs.existsSync(resolvedPath) ? resolvedPath : null;
}

function resolveExactFramePath(requestedPath) {
  return typeof requestedPath === 'string' && fs.existsSync(requestedPath)
    ? requestedPath
    : null;
}

function shouldPreferAudioVideoFrames(layer = {}) {
  return Boolean(
    layer?.lipSyncVideoLayer ||
    layer?.soundEffectVideoLayer ||
    layer?.hasLipSyncVideoLayer ||
    layer?.hasSoundEffectVideoLayer
  );
}

function shouldConsiderAudioVideoFramesForRealign(layer = {}) {
  if (shouldPreferAudioVideoFrames(layer)) {
    return true;
  }

  const normalizedLayerType = typeof layer?.layerAiVideoType === 'string'
    ? layer.layerAiVideoType.trim().toLowerCase()
    : '';
  const normalizedBaseType = typeof layer?.layerBaseAiImageType === 'string'
    ? layer.layerBaseAiImageType.trim().toLowerCase()
    : '';

  return (
    normalizedLayerType === 'character' ||
    normalizedLayerType === 'lip_sync' ||
    normalizedLayerType === 'sound_effect' ||
    normalizedBaseType === 'character' ||
    normalizedBaseType === 'sound_effect'
  );
}

function getPreferredLayerFramesSubDir(layer = {}) {
  return shouldPreferAudioVideoFrames(layer) ? 'audio_video' : null;
}

function hasAnyLayerVideoLink(layer = {}) {
  return Boolean(
    layer?.aiVideoLayer
    || layer?.lipSyncVideoLayer
    || layer?.soundEffectVideoLayer
    || layer?.userVideoLayer
  );
}

function hasPendingLayerVideoTask(layer = {}) {
  return Boolean(
    layer?.aiVideoGenerationPending
    || layer?.lipSyncGenerationPending
    || layer?.soundEffectGenerationPending
    || layer?.userVideoGenerationPending
  );
}

const ACTIVE_USER_VIDEO_UPLOAD_TASK_STATUSES = new Set(['UPLOADING', 'PROCESSING']);

function isActiveUserVideoUploadTaskStatus(status) {
  return ACTIVE_USER_VIDEO_UPLOAD_TASK_STATUSES.has(status);
}

function serializeUserVideoUploadTask(task) {
  if (!task) {
    return null;
  }

  const totalFileSize = Number(task.totalFileSize);
  const uploadedBytesRaw = Number(task.uploadedBytes);
  const uploadedBytes = Number.isFinite(uploadedBytesRaw)
    ? Math.max(0, uploadedBytesRaw)
    : 0;
  const safeTotalFileSize = Number.isFinite(totalFileSize) && totalFileSize > 0
    ? totalFileSize
    : null;
  const progressPercent = safeTotalFileSize
    ? Math.min(100, Math.round((Math.min(uploadedBytes, safeTotalFileSize) / safeTotalFileSize) * 100))
    : null;

  return {
    uploadId: task.uploadId || null,
    taskId: task.taskId || null,
    sessionId: task.sessionId || null,
    layerId: task.layerId || null,
    status: task.status || 'INIT',
    fileName: task.fileName || null,
    contentType: task.contentType || null,
    totalChunks: Number.isFinite(Number(task.totalChunks)) ? Number(task.totalChunks) : null,
    uploadedChunks: Number.isFinite(Number(task.uploadedChunks)) ? Number(task.uploadedChunks) : 0,
    totalFileSize: safeTotalFileSize,
    uploadedBytes,
    progressPercent,
    message: task.message || null,
    errorMessage: task.errorMessage || null,
    completedAt: task.completedAt || null,
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null,
  };
}

async function getActiveUserVideoUploadTaskForLayer(sessionId, layerId) {
  if (!sessionId || !layerId) {
    return null;
  }

  await getDBConnectionString();

  return UserVideoUploadTask.findOne({
    sessionId,
    layerId,
    status: { $in: Array.from(ACTIVE_USER_VIDEO_UPLOAD_TASK_STATUSES) },
  }).sort({ updatedAt: -1 });
}

async function upsertUserVideoUploadTask({
  userId = null,
  sessionId,
  layerId,
  uploadId = null,
  taskId = null,
  status = 'UPLOADING',
  fileName = null,
  contentType = null,
  totalChunks = null,
  uploadedChunks = null,
  totalFileSize = null,
  uploadedBytes = null,
  message = null,
  errorMessage = null,
  completedAt,
}) {
  if (!sessionId || !layerId) {
    return null;
  }

  await getDBConnectionString();

  const query = uploadId
    ? { sessionId, layerId, uploadId }
    : taskId
      ? { sessionId, layerId, taskId }
      : { sessionId, layerId };

  const update = {
    $set: {
      userId,
      sessionId,
      layerId,
      status,
      fileName,
      contentType,
      totalChunks,
      uploadedChunks,
      totalFileSize,
      uploadedBytes,
      message,
    },
  };

  if (uploadId) {
    update.$set.uploadId = uploadId;
  }
  if (taskId) {
    update.$set.taskId = taskId;
  }
  if (errorMessage != null) {
    update.$set.errorMessage = errorMessage;
  } else {
    update.$unset = { errorMessage: 1 };
  }
  if (completedAt !== undefined) {
    update.$set.completedAt = completedAt;
  } else {
    update.$unset = {
      ...(update.$unset || {}),
      completedAt: 1,
    };
  }

  return UserVideoUploadTask.findOneAndUpdate(query, update, {
    new: true,
    upsert: true,
  });
}

async function markUserVideoUploadTaskFailed({
  sessionId,
  layerId,
  uploadId = null,
  taskId = null,
  message,
}) {
  if (!sessionId || !layerId) {
    return null;
  }

  await getDBConnectionString();

  const query = taskId
    ? { sessionId, layerId, taskId }
    : uploadId
      ? { sessionId, layerId, uploadId }
      : { sessionId, layerId };

  return UserVideoUploadTask.findOneAndUpdate(
    query,
    {
      $set: {
        status: 'FAILED',
        message: message || 'Failed to process uploaded video.',
        errorMessage: message || 'Failed to process uploaded video.',
        completedAt: new Date(),
      },
    },
    { new: true }
  );
}

async function markUserVideoUploadTaskCompleted({
  sessionId,
  layerId,
  taskId,
}) {
  if (!sessionId || !layerId || !taskId) {
    return null;
  }

  await getDBConnectionString();

  return UserVideoUploadTask.findOneAndUpdate(
    { sessionId, layerId, taskId },
    {
      $set: {
        status: 'COMPLETED',
        message: 'Uploaded video is ready for this layer.',
        completedAt: new Date(),
      },
      $unset: {
        errorMessage: 1,
      },
    },
    { new: true }
  );
}

async function markUserVideoUploadTaskCancelled({
  sessionId,
  layerId,
  taskId = null,
}) {
  if (!sessionId || !layerId) {
    return null;
  }

  const query = taskId
    ? { sessionId, layerId, taskId }
    : {
      sessionId,
      layerId,
      status: { $in: Array.from(ACTIVE_USER_VIDEO_UPLOAD_TASK_STATUSES) },
    };

  return UserVideoUploadTask.updateMany(
    query,
    {
      $set: {
        status: 'CANCELLED',
        message: 'User video upload cancelled.',
        completedAt: new Date(),
      },
    }
  );
}

function getLayerPreferredVideoLink(layer = {}) {
  if (layer?.lipSyncVideoLayer) {
    return layer.lipSyncVideoLayer;
  }
  if (layer?.soundEffectVideoLayer) {
    return layer.soundEffectVideoLayer;
  }
  if (layer?.userVideoLayer) {
    return layer.userVideoLayer;
  }
  if (layer?.aiVideoLayer) {
    return layer.aiVideoLayer;
  }
  return null;
}

function getLayerDownloadFrameIndex({ layer, framesPerSecond, timestamp, frame }) {
  const requestedFrame = Number(frame);
  const requestedTimestamp = Number(timestamp);
  let localFrameIndex = Number.isFinite(requestedFrame)
    ? Math.round(requestedFrame)
    : Math.round((Number.isFinite(requestedTimestamp) ? requestedTimestamp : 0) * framesPerSecond);

  localFrameIndex = Math.max(0, localFrameIndex);

  const layerDurationFrames = Math.max(1, Math.ceil((Number(layer?.duration) || 0) * framesPerSecond));
  const boundedLocalFrameIndex = Math.min(localFrameIndex, layerDurationFrames - 1);
  const clipStartFrames = layer?.clipStart
    ? Math.max(0, Math.round(Number(layer?.clipStartFrames) || 0))
    : 0;

  return {
    localFrameIndex: boundedLocalFrameIndex,
    sourceFrameIndex: boundedLocalFrameIndex + clipStartFrames,
  };
}

function getLayerFrameDirectoryCandidates({ sessionId, layerId, layer, localFrameIndex, sourceFrameIndex }) {
  const roots = getProcessorAssetsRootCandidates();
  const candidates = [];
  const prefersAudioVideoFrames = shouldPreferAudioVideoFrames(layer);

  for (const assetsRoot of roots) {
    const baseAiFramesDir = path.join(assetsRoot, 'ai_video', 'frames', `${sessionId}`, `${layerId}`);
    if (prefersAudioVideoFrames) {
      candidates.push({
        dirPath: path.join(baseAiFramesDir, 'audio_video'),
        frameIndex: sourceFrameIndex,
        exactOnly: true,
      });
      candidates.push({
        dirPath: path.join(assetsRoot, 'video', 'frames', `${sessionId}`, `${layerId}`),
        frameIndex: localFrameIndex,
        exactOnly: true,
      });
      continue;
    }

    candidates.push({
      dirPath: baseAiFramesDir,
      frameIndex: sourceFrameIndex,
    });

    candidates.push({
      dirPath: path.join(assetsRoot, 'video', 'frames', `${sessionId}`, `${layerId}`),
      frameIndex: localFrameIndex,
    });
  }

  return candidates;
}

function resolveLayerFrameDownloadPath({ sessionId, layerId, layer, localFrameIndex, sourceFrameIndex }) {
  const candidates = getLayerFrameDirectoryCandidates({
    sessionId,
    layerId,
    layer,
    localFrameIndex,
    sourceFrameIndex,
  });

  for (const candidate of candidates) {
    const requestedPath = path.join(candidate.dirPath, `${candidate.frameIndex}.png`);
    const resolvedPath = candidate.exactOnly
      ? resolveExactFramePath(requestedPath)
      : resolveExistingOrNearestFramePath(requestedPath);
    if (resolvedPath) {
      return resolvedPath;
    }
  }

  return null;
}

function getRelativeAssetPathFromAbsolute(absolutePath) {
  if (typeof absolutePath !== 'string' || !absolutePath) {
    return null;
  }

  const normalizedInput = absolutePath.replace(/\\/g, '/');
  const relativeV2Path = normalizedInput.replace(/^\.?\/?assets_v2\//, 'assets_v2/');
  if (relativeV2Path.startsWith('assets_v2/')) {
    return `/${relativeV2Path}`;
  }
  const normalized = normalizedInput.includes('/assets_v2/')
    ? `assets_v2/${normalizedInput.split('/assets_v2/')[1]}`
    : (normalizedInput.split('/assets/')[1] || normalizedInput);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function buildRemoteAssetUrl(assetPath) {
  const normalizedAssetPath = getNormalizedAssetPath(assetPath);
  if (!normalizedAssetPath) {
    return '';
  }

  const apiServer = getPublicApiBaseUrl();
  return apiServer ? `${apiServer}/${normalizedAssetPath}` : `/${normalizedAssetPath}`;
}

function normalizeGenerationImageAssetSource(asset) {
  const value = typeof asset === 'string'
    ? asset
    : (
      asset?.rawSrc ||
      asset?.rawUrl ||
      asset?.src ||
      asset?.image ||
      asset?.imageUrl ||
      asset?.image_url ||
      asset?.previewUrl ||
      asset?.preview_url ||
      asset?.signedUrl ||
      asset?.signed_url ||
      asset?.displayUrl ||
      asset?.display_url ||
      asset?.url
    );

  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    try {
      const pathname = decodeURIComponent(new URL(trimmedValue).pathname).replace(/^\/+/, '');
      return pathname.startsWith(`${SECURE_ASSET_PREFIX}/`) ? pathname : trimmedValue;
    } catch {
      return trimmedValue;
    }
  }

  if (
    !trimmedValue.startsWith('/') &&
    !trimmedValue.includes('/') &&
    SHARE_OG_IMAGE_EXTENSION_PATTERN.test(trimmedValue)
  ) {
    return `/generations/${trimmedValue}`;
  }

  return trimmedValue;
}

function buildGenerationImagePreviewUrl(rawSource) {
  if (typeof rawSource !== 'string' || !rawSource.trim()) {
    return '';
  }

  const trimmedSource = rawSource.trim();
  if (/^(data:|blob:)/i.test(trimmedSource)) {
    return trimmedSource;
  }
  if (/^https?:\/\//i.test(trimmedSource)) {
    try {
      const pathname = decodeURIComponent(new URL(trimmedSource).pathname).replace(/^\/+/, '');
      const localAssetUrl = buildProcessorStaticAssetUrlForLocalAsset(pathname);
      return localAssetUrl || trimmedSource;
    } catch {
      return trimmedSource;
    }
  }

  const relativeSource = trimmedSource.replace(/^\/+/, '');
  const localAssetUrl = buildProcessorStaticAssetUrlForLocalAsset(relativeSource);
  if (localAssetUrl) {
    return localAssetUrl;
  }
  if (relativeSource.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return buildSecureMediaDeliveryUrl(relativeSource) || trimmedSource;
  }

  return buildRemoteAssetUrl(trimmedSource) || trimmedSource;
}

function getMediaReferencePath(rawSource) {
  if (typeof rawSource !== 'string' || !rawSource.trim()) {
    return '';
  }

  const trimmedSource = stripMediaReferenceQueryAndHash(rawSource.trim());
  if (/^https?:\/\//i.test(trimmedSource)) {
    try {
      return decodeURIComponent(new URL(trimmedSource).pathname).replace(/^\/+/, '');
    } catch {
      return trimmedSource.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
    }
  }

  return trimmedSource.replace(/^\/+/, '');
}

function getSessionPayloadIdString(sessionPayload = {}) {
  return getFirstNonEmptyString(
    sessionPayload?._id?.toString?.(),
    sessionPayload?._id,
    sessionPayload?.id?.toString?.(),
    sessionPayload?.id,
    sessionPayload?.sessionId?.toString?.(),
    sessionPayload?.sessionId,
  );
}

function encodeGuestMediaAssetPath(mediaPath) {
  return String(mediaPath || '')
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function isSessionScopedSecureMediaPath(mediaPath, sessionId) {
  const normalizedPath = typeof mediaPath === 'string' ? mediaPath.replace(/^\/+/, '') : '';
  if (!normalizedPath || !sessionId || !normalizedPath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return false;
  }

  return normalizedPath.split('/').includes(sessionId);
}

function buildGuestMediaProxyUrl(sessionPayload, rawSource) {
  const sessionId = getSessionPayloadIdString(sessionPayload);
  const mediaReferencePath = getMediaReferencePath(rawSource);
  if (!isSessionScopedSecureMediaPath(mediaReferencePath, sessionId)) {
    return '';
  }

  const routePath = `${GUEST_MEDIA_ROUTE_PREFIX}?sessionId=${encodeURIComponent(sessionId)}&assetKey=${encodeURIComponent(mediaReferencePath)}`;
  const apiBaseUrl = getPublicApiBaseUrl();
  return apiBaseUrl ? `${apiBaseUrl}${routePath}` : routePath;
}

function isSecureAssetReference(rawSource) {
  const mediaPath = getMediaReferencePath(rawSource);
  return mediaPath.startsWith(`${SECURE_ASSET_PREFIX}/`) || mediaPath.startsWith(USER_RESOURCES_PREFIX);
}

function isKnownStudioMediaHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname.trim()) {
    return false;
  }

  const normalizedHostname = hostname.trim().toLowerCase();
  const knownHostnames = new Set([
    new URL(DEFAULT_STATIC_ASSET_BASE_URL).hostname.toLowerCase(),
    new URL(getStaticAssetBaseUrl()).hostname.toLowerCase(),
    `${MEDIA_BUCKET_NAME}.s3.amazonaws.com`.toLowerCase(),
  ]);
  return knownHostnames.has(normalizedHostname) ||
    normalizedHostname.startsWith(`${MEDIA_BUCKET_NAME.toLowerCase()}.s3.`);
}

function buildStudioVideoRemoteUrl(rawSource) {
  if (typeof rawSource !== 'string' || !rawSource.trim()) {
    return '';
  }

  const trimmedSource = rawSource.trim();
  if (/^(data:|blob:)/i.test(trimmedSource)) {
    return trimmedSource;
  }

  const mediaReferencePath = getMediaReferencePath(trimmedSource);
  if (!mediaReferencePath) {
    return trimmedSource;
  }

  // Studio uploads are finalized into the processor's assets_v2 volume. They
  // are not necessarily copied to the media bucket (notably in docker-local
  // delivery mode), so signing the corresponding static CDN key produces a
  // valid-looking CloudFront URL for an object that does not exist in S3.
  // In docker-local mode, prefer the processor static route whenever the
  // referenced file is mounted. External-S3 mode must keep using CloudFront
  // even when the worker also retains a local copy.
  const localAssetUrl = shouldUseDockerLocalMediaDelivery()
    ? buildProcessorStaticAssetUrlForLocalAsset(mediaReferencePath)
    : null;
  if (localAssetUrl) {
    return localAssetUrl;
  }

  if (/^https?:\/\//i.test(trimmedSource)) {
    // Rebuild media URLs served by our CDN/S3 origin so stale CloudFront
    // signatures are removed (and secure assets receive a fresh signature).
    // Unknown third-party URLs must remain untouched.
    try {
      const parsedUrl = new URL(trimmedSource);
      if (
        isKnownStudioMediaHostname(parsedUrl.hostname) ||
        mediaReferencePath.startsWith(`${SECURE_ASSET_PREFIX}/`) ||
        mediaReferencePath.startsWith(USER_RESOURCES_PREFIX)
      ) {
        return buildSecureMediaDeliveryUrl(mediaReferencePath) || trimmedSource;
      }
    } catch {
      return trimmedSource;
    }
    return trimmedSource;
  }

  // Legacy uploads were stored directly under user_resources/. New uploads
  // carry the assets_v2/ prefix already, so preserving the persisted key is
  // required to address both generations correctly.
  return buildSecureMediaDeliveryUrl(mediaReferencePath) || trimmedSource;
}

function buildStudioMediaDeliveryUrl(rawSource) {
  return buildStudioVideoRemoteUrl(rawSource);
}

function buildStudioImageDeliveryUrl(rawSource) {
  const normalizedSource = normalizeGenerationImageAssetSource(rawSource);
  if (!normalizedSource) {
    return buildStudioMediaDeliveryUrl(rawSource);
  }

  if (/^(data:|blob:)/i.test(normalizedSource)) {
    return normalizedSource;
  }

  if (/^https?:\/\//i.test(normalizedSource)) {
    return buildStudioMediaDeliveryUrl(normalizedSource) || normalizedSource;
  }

  if (isSecureAssetReference(normalizedSource)) {
    return buildStudioMediaDeliveryUrl(normalizedSource) || normalizedSource;
  }

  // Before assets_v2, generated images were persisted locally as
  // /generations/<name> while the durable copy was uploaded to the public
  // temp_images/<name> key. The local container copy no longer exists for
  // older sessions, but the CDN object is still available.
  const legacyGenerationMatch = normalizedSource
    .replace(/^\/+/, '')
    .match(/^generations\/([^/]+)$/i);
  if (legacyGenerationMatch) {
    return `${getStaticAssetBaseUrl()}/temp_images/${encodeURIComponent(legacyGenerationMatch[1])}`;
  }

  return buildGenerationImagePreviewUrl(normalizedSource) || normalizedSource;
}

function stripMediaReferenceQueryAndHash(rawSource) {
  if (typeof rawSource !== 'string') {
    return '';
  }

  const trimmedSource = rawSource.trim();
  if (!trimmedSource || /^https?:\/\//i.test(trimmedSource)) {
    return trimmedSource;
  }

  const hashIndex = trimmedSource.indexOf('#');
  const withoutHash = hashIndex >= 0 ? trimmedSource.slice(0, hashIndex) : trimmedSource;
  const queryIndex = withoutHash.indexOf('?');
  return queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
}

function buildGuestMediaDeliveryUrl(rawSource, sessionPayload = null) {
  if (typeof rawSource !== 'string' || !rawSource.trim()) {
    return '';
  }

  const trimmedSource = rawSource.trim();
  if (/^(data:|blob:)/i.test(trimmedSource)) {
    return trimmedSource;
  }

  const guestMediaProxyUrl = buildGuestMediaProxyUrl(sessionPayload, trimmedSource);
  if (guestMediaProxyUrl) {
    return guestMediaProxyUrl;
  }

  const mediaReferencePath = getMediaReferencePath(trimmedSource);
  if (mediaReferencePath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return buildSecureMediaDeliveryUrl(mediaReferencePath) || trimmedSource;
  }
  if (mediaReferencePath.startsWith(USER_RESOURCES_PREFIX)) {
    return buildSecureMediaDeliveryUrl(`${SECURE_ASSET_PREFIX}/${mediaReferencePath}`) || trimmedSource;
  }

  const mediaReference = stripMediaReferenceQueryAndHash(trimmedSource);
  return buildSecureMediaDeliveryUrl(mediaReference) || trimmedSource;
}

function buildGuestImageDeliveryUrl(rawSource, sessionPayload = null) {
  const normalizedSource = normalizeGenerationImageAssetSource(rawSource);
  const secureSource = normalizedSource || rawSource;
  if (isSecureAssetReference(secureSource)) {
    const secureMediaUrl = buildGuestMediaDeliveryUrl(secureSource, sessionPayload);
    if (secureMediaUrl) {
      return secureMediaUrl;
    }
  }
  if (!normalizedSource) {
    return buildGuestMediaDeliveryUrl(rawSource, sessionPayload);
  }
  return buildGuestMediaProxyUrl(sessionPayload, normalizedSource) ||
    buildGenerationImagePreviewUrl(normalizedSource) ||
    buildGuestMediaDeliveryUrl(normalizedSource, sessionPayload);
}

function hydrateGuestMediaStringFields(target = {}, fields = [], buildUrl = buildGuestMediaDeliveryUrl) {
  const nextTarget = {
    ...target,
  };

  fields.forEach((field) => {
    const value = nextTarget[field];
    if (typeof value !== 'string' || !value.trim()) {
      return;
    }

    const hydratedUrl = buildUrl(value);
    if (hydratedUrl) {
      nextTarget[field] = hydratedUrl;
    }
  });

  return nextTarget;
}

function hydrateGuestMediaStringList(values, buildUrl = buildGuestMediaDeliveryUrl) {
  return Array.isArray(values)
    ? values.map((value) => {
      if (typeof value !== 'string' || !value.trim()) {
        return value;
      }
      return buildUrl(value) || value;
    })
    : values;
}

function hydrateGuestRemoteAudioData(remoteAudioData = [], sessionPayload = null) {
  return Array.isArray(remoteAudioData)
    ? remoteAudioData.map((audioData) => {
      if (!audioData || typeof audioData !== 'object') {
        return audioData;
      }

      return hydrateGuestMediaStringFields(audioData, [
        'audio_url',
        'audioUrl',
        'audioLink',
        'audio',
        'url',
        'src',
      ], (value) => buildGuestMediaDeliveryUrl(value, sessionPayload));
    })
    : remoteAudioData;
}

function hydrateGuestAudioLayerForResponse(audioLayer = {}, sessionPayload = null) {
  if (!audioLayer || typeof audioLayer !== 'object') {
    return audioLayer;
  }

  const hydratedLayer = hydrateGuestMediaStringFields(audioLayer, [
    'selectedLocalAudioLink',
    'selectedRemoteAudioLink',
    'audioUrl',
    'audio_url',
    'url',
    'src',
  ], (value) => buildGuestMediaDeliveryUrl(value, sessionPayload));

  hydratedLayer.localAudioLinks = hydrateGuestMediaStringList(
    hydratedLayer.localAudioLinks,
    (value) => buildGuestMediaDeliveryUrl(value, sessionPayload)
  );
  hydratedLayer.remoteAudioLinks = hydrateGuestMediaStringList(
    hydratedLayer.remoteAudioLinks,
    (value) => buildGuestMediaDeliveryUrl(value, sessionPayload)
  );
  hydratedLayer.remoteAudioData = hydrateGuestRemoteAudioData(hydratedLayer.remoteAudioData, sessionPayload);

  return hydratedLayer;
}

function hydrateGuestImageSessionForResponse(imageSession = {}, sessionPayload = null) {
  if (!imageSession || typeof imageSession !== 'object') {
    return imageSession;
  }

  const hydratedImageSession = hydrateGuestMediaStringFields(imageSession, [
    'activeSelectedImage',
    'activeGeneratedImage',
    'activeEditedImage',
    'videoRenderStartFrameImage',
    'videoRenderEndFrameImage',
    'activeImageRemoteLink',
  ], (value) => buildGuestImageDeliveryUrl(value, sessionPayload));

  hydratedImageSession.generations = hydrateGuestMediaStringList(
    hydratedImageSession.generations,
    (value) => buildGuestImageDeliveryUrl(value, sessionPayload)
  );
  hydratedImageSession.witnesses = hydrateGuestMediaStringList(
    hydratedImageSession.witnesses,
    (value) => buildGuestImageDeliveryUrl(value, sessionPayload)
  );
  hydratedImageSession.intermediates = hydrateGuestMediaStringList(
    hydratedImageSession.intermediates,
    (value) => buildGuestImageDeliveryUrl(value, sessionPayload)
  );

  return hydratedImageSession;
}

function serializeGuestActiveImageItemForResponse(item, sessionPayload = null) {
  const serializedItem = serializeActiveImageItemForResponse(item);
  if (!serializedItem || typeof serializedItem !== 'object' || serializedItem.type !== 'image') {
    return serializedItem;
  }

  const rawSource = normalizeGenerationImageAssetSource(serializedItem);
  if (!rawSource) {
    return serializedItem;
  }

  const displayUrl = buildGuestImageDeliveryUrl(rawSource, sessionPayload);
  if (!displayUrl) {
    return serializedItem;
  }

  return {
    ...serializedItem,
    src: displayUrl,
    rawSrc: rawSource,
    rawUrl: rawSource,
    image: displayUrl,
    url: displayUrl,
    previewUrl: displayUrl,
    imageUrl: displayUrl,
    image_url: displayUrl,
    signedUrl: displayUrl,
    signed_url: displayUrl,
    displayUrl,
    display_url: displayUrl,
  };
}

function hydrateGuestActiveItemListForResponse(layer = {}, sessionPayload = {}) {
  const activeItemList = hydrateStudioActiveItemListForResponse(layer, sessionPayload);
  return Array.isArray(activeItemList)
    ? activeItemList.map((item) => serializeGuestActiveImageItemForResponse(item, sessionPayload))
    : activeItemList;
}

function hydrateGuestLayerMediaForResponse(layer = {}, sessionPayload = {}) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  const hydratedLayer = hydrateGuestMediaStringFields(
    sanitizeStudioLayerVideoUrlsForResponse(layer),
    [
      'aiLayerStartFrame',
      'baseLayerStartFrame',
      'aiVideoThumbnailPath',
      'lipSyncThumbnailPath',
      'soundEffectThumbnailPath',
      'userVideoThumbnailPath',
      'thumbnailPath',
      'aiVideoFrameImage',
      'videoFrameImage',
    ],
    (value) => buildGuestImageDeliveryUrl(value, sessionPayload)
  );
  const videoSourceFields = [
    ['aiVideoLayer', 'aiVideoRemoteLink'],
    ['lipSyncVideoLayer', 'lipSyncRemoteLink'],
    ['soundEffectVideoLayer', 'soundEffectRemoteLink'],
    ['userVideoLayer', 'userVideoRemoteLink'],
  ];

  videoSourceFields.forEach(([assetField, remoteField]) => {
    const rawAssetSource = hydratedLayer[assetField];
    const rawRemoteSource = hydratedLayer[remoteField];
    const hydratedUrl = buildGuestMediaDeliveryUrl(selectMediaDeliverySource({
      local: rawAssetSource,
      remote: rawRemoteSource,
    }), sessionPayload);
    if (hydratedUrl) {
      if (rawAssetSource) {
        hydratedLayer[`raw${assetField[0].toUpperCase()}${assetField.slice(1)}`] = rawAssetSource;
      }
      if (rawRemoteSource) {
        hydratedLayer[`raw${remoteField[0].toUpperCase()}${remoteField.slice(1)}`] = rawRemoteSource;
      }
      hydratedLayer[assetField] = hydratedUrl;
      hydratedLayer[remoteField] = hydratedUrl;
    }
  });

  if (hydratedLayer.frameImages && typeof hydratedLayer.frameImages === 'object') {
    hydratedLayer.frameImages = hydrateGuestMediaStringFields(hydratedLayer.frameImages, [
      'startFrameUrl',
      'startFrame',
      'aiLayerStartFrame',
      'baseLayerStartFrame',
      'aiVideoThumbnailPath',
      'thumbnailPath',
    ], (value) => buildGuestImageDeliveryUrl(value, sessionPayload));
  }

  if (hydratedLayer.imageSession && typeof hydratedLayer.imageSession === 'object') {
    hydratedLayer.imageSession = hydrateGuestImageSessionForResponse(hydratedLayer.imageSession, sessionPayload);
    hydratedLayer.imageSession.activeItemList = hydrateGuestActiveItemListForResponse(
      hydratedLayer,
      sessionPayload
    );
  }

  delete hydratedLayer.frames;
  return hydratedLayer;
}

function hydrateGuestGlobalVideoForResponse(globalVideo = {}, sessionPayload = null) {
  if (!globalVideo || typeof globalVideo !== 'object') {
    return globalVideo;
  }

  const hydratedGlobalVideo = hydrateGuestMediaStringFields(globalVideo, [
    'url',
    'remoteURL',
    'remoteUrl',
    'remote_url',
  ], (value) => buildGuestMediaDeliveryUrl(value, sessionPayload));

  hydratedGlobalVideo.frames = hydrateGuestMediaStringList(
    hydratedGlobalVideo.frames,
    (value) => buildGuestImageDeliveryUrl(value, sessionPayload)
  );
  return hydratedGlobalVideo;
}

function hydrateGuestFooterMetadataForResponse(footerMetadata = [], sessionPayload = null) {
  return Array.isArray(footerMetadata)
    ? footerMetadata.map((footerItem) => (
      footerItem && typeof footerItem === 'object'
        ? hydrateGuestMediaStringFields(footerItem, [
          'url',
          'cta_logo',
          'ctaLogo',
          'logoUrl',
          'logoImagePath',
          'footerLogoImagePath',
        ], (value) => buildGuestImageDeliveryUrl(value, sessionPayload))
        : footerItem
    ))
    : footerMetadata;
}

function hydrateStudioAudioLayerForResponse(audioLayer = {}) {
  if (!audioLayer || typeof audioLayer !== 'object') {
    return audioLayer;
  }

  const hydratedLayer = hydrateGuestMediaStringFields(audioLayer, [
    'selectedLocalAudioLink',
    'selectedRemoteAudioLink',
    'audioUrl',
    'audio_url',
    'url',
    'src',
  ], buildStudioMediaDeliveryUrl);

  hydratedLayer.localAudioLinks = hydrateGuestMediaStringList(
    hydratedLayer.localAudioLinks,
    buildStudioMediaDeliveryUrl
  );
  hydratedLayer.remoteAudioLinks = hydrateGuestMediaStringList(
    hydratedLayer.remoteAudioLinks,
    buildStudioMediaDeliveryUrl
  );
  hydratedLayer.remoteAudioData = Array.isArray(hydratedLayer.remoteAudioData)
    ? hydratedLayer.remoteAudioData.map((audioData) => (
      audioData && typeof audioData === 'object'
        ? hydrateGuestMediaStringFields(audioData, [
          'audio_url',
          'audioUrl',
          'audioLink',
          'audio',
          'url',
          'src',
        ], buildStudioMediaDeliveryUrl)
        : audioData
    ))
    : hydratedLayer.remoteAudioData;

  return hydratedLayer;
}

function hydrateStudioImageSessionForResponse(imageSession = {}, sessionPayload = null) {
  if (!imageSession || typeof imageSession !== 'object') {
    return imageSession;
  }

  const hydratedImageSession = hydrateGuestMediaStringFields(imageSession, [
    'activeSelectedImage',
    'activeGeneratedImage',
    'activeEditedImage',
    'videoRenderStartFrameImage',
    'videoRenderEndFrameImage',
    'activeImageRemoteLink',
  ], buildStudioImageDeliveryUrl);

  hydratedImageSession.generations = hydrateGuestMediaStringList(
    hydratedImageSession.generations,
    buildStudioImageDeliveryUrl
  );
  hydratedImageSession.witnesses = hydrateGuestMediaStringList(
    hydratedImageSession.witnesses,
    buildStudioImageDeliveryUrl
  );
  hydratedImageSession.intermediates = hydrateGuestMediaStringList(
    hydratedImageSession.intermediates,
    buildStudioImageDeliveryUrl
  );

  return hydratedImageSession;
}

function hydrateStudioLayerMediaForResponse(layer = {}, sessionPayload = {}, options = {}) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  const hydratedLayer = hydrateGuestMediaStringFields({ ...layer }, [
    'aiLayerStartFrame',
    'aiLayerEndFrame',
    'baseLayerStartFrame',
    'baseLayerEndFrame',
    'aiVideoThumbnailPath',
    'lipSyncThumbnailPath',
    'soundEffectThumbnailPath',
    'userVideoThumbnailPath',
    'aiVideoEndThumbnailPath',
    'lipSyncEndThumbnailPath',
    'soundEffectEndThumbnailPath',
    'userVideoEndThumbnailPath',
    'thumbnailPath',
    'aiVideoFrameImage',
    'videoFrameImage',
  ], buildStudioImageDeliveryUrl);

  const videoSourceFields = [
    ['aiVideoLayer', 'aiVideoRemoteLink'],
    ['lipSyncVideoLayer', 'lipSyncRemoteLink'],
    ['soundEffectVideoLayer', 'soundEffectRemoteLink'],
    ['userVideoLayer', 'userVideoRemoteLink'],
  ];
  const layerId = layer?._id?.toString?.() || layer?._id;
  const generatedAiVideo = layerId
    ? options.generatedAiVideoByLayerId?.get(layerId)
    : null;

  videoSourceFields.forEach(([assetField, remoteField]) => {
    const rawAssetSource = hydratedLayer[assetField];
    const rawRemoteSource = hydratedLayer[remoteField];
    const generatedRemoteSource = assetField === 'aiVideoLayer'
      ? getFirstNonEmptyString(
        generatedAiVideo?.remoteUrl,
        generatedAiVideo?.remoteURL,
        generatedAiVideo?.remote_url,
      )
      : '';
    const hydratedUrl = buildStudioMediaDeliveryUrl(
      selectMediaDeliverySource({
        local: rawAssetSource,
        remote: rawRemoteSource,
        generated: generatedRemoteSource,
      })
    );
    if (!hydratedUrl) {
      return;
    }

    if (rawAssetSource) {
      hydratedLayer[`raw${assetField[0].toUpperCase()}${assetField.slice(1)}`] = rawAssetSource;
    }
    if (rawRemoteSource) {
      hydratedLayer[`raw${remoteField[0].toUpperCase()}${remoteField.slice(1)}`] = rawRemoteSource;
    } else if (generatedRemoteSource) {
      hydratedLayer[`raw${remoteField[0].toUpperCase()}${remoteField.slice(1)}`] = generatedRemoteSource;
    }
    hydratedLayer[assetField] = hydratedUrl;
    hydratedLayer[remoteField] = hydratedUrl;
  });

  if (hydratedLayer.frameImages && typeof hydratedLayer.frameImages === 'object') {
    hydratedLayer.frameImages = hydrateGuestMediaStringFields(hydratedLayer.frameImages, [
      'startFrameUrl',
      'startFrame',
      'endFrameUrl',
      'endFrame',
      'aiLayerStartFrame',
      'aiLayerEndFrame',
      'baseLayerStartFrame',
      'baseLayerEndFrame',
      'aiVideoThumbnailPath',
      'thumbnailPath',
    ], buildStudioImageDeliveryUrl);
  }

  if (hydratedLayer.imageSession && typeof hydratedLayer.imageSession === 'object') {
    hydratedLayer.imageSession = hydrateStudioImageSessionForResponse(
      hydratedLayer.imageSession,
      sessionPayload
    );
    hydratedLayer.imageSession.activeItemList = hydrateStudioActiveItemListForResponse(
      hydratedLayer,
      sessionPayload
    );
  }

  if (Array.isArray(hydratedLayer.filterPasses)) {
    hydratedLayer.filterPasses = hydratedLayer.filterPasses.map((filterPass) => (
      filterPass && typeof filterPass === 'object'
        ? hydrateGuestMediaStringFields(filterPass, ['src'], buildStudioImageDeliveryUrl)
        : filterPass
    ));
  }

  delete hydratedLayer.frames;
  return hydratedLayer;
}

function hydrateStudioGlobalVideoForResponse(globalVideo = {}) {
  if (!globalVideo || typeof globalVideo !== 'object') {
    return globalVideo;
  }

  const hydratedGlobalVideo = hydrateGuestMediaStringFields(globalVideo, [
    'url',
    'remoteURL',
    'remoteUrl',
    'remote_url',
    'assetPath',
  ], buildStudioMediaDeliveryUrl);
  hydratedGlobalVideo.frames = hydrateGuestMediaStringList(
    hydratedGlobalVideo.frames,
    buildStudioImageDeliveryUrl
  );
  return hydratedGlobalVideo;
}

function hydrateStudioFooterMetadataForResponse(footerMetadata = []) {
  return Array.isArray(footerMetadata)
    ? footerMetadata.map((footerItem) => (
      footerItem && typeof footerItem === 'object'
        ? hydrateGuestMediaStringFields(footerItem, [
          'url',
          'cta_logo',
          'ctaLogo',
          'logoUrl',
          'logoImagePath',
          'footerLogoImagePath',
        ], buildStudioImageDeliveryUrl)
        : footerItem
    ))
    : footerMetadata;
}

function serializeStudioGenerationImageAsset(asset) {
  const plainAsset = asset && typeof asset.toObject === 'function' ? asset.toObject() : asset;
  const rawSource = normalizeGenerationImageAssetSource(plainAsset);
  if (!rawSource) {
    return plainAsset;
  }

  const previewUrl = buildStudioImageDeliveryUrl(rawSource);
  if (plainAsset && typeof plainAsset === 'object' && !Array.isArray(plainAsset)) {
    return {
      ...plainAsset,
      src: rawSource,
      rawSrc: rawSource,
      rawUrl: rawSource,
      url: previewUrl || plainAsset.url,
      previewUrl: previewUrl || plainAsset.previewUrl,
      imageUrl: previewUrl || plainAsset.imageUrl,
      image_url: previewUrl || plainAsset.image_url,
      signedUrl: previewUrl || plainAsset.signedUrl,
      signed_url: previewUrl || plainAsset.signed_url,
      displayUrl: previewUrl || plainAsset.displayUrl,
      display_url: previewUrl || plainAsset.display_url,
    };
  }

  return {
    src: rawSource,
    rawSrc: rawSource,
    rawUrl: rawSource,
    url: previewUrl,
    previewUrl,
    imageUrl: previewUrl,
    image_url: previewUrl,
    signedUrl: previewUrl,
    signed_url: previewUrl,
    displayUrl: previewUrl,
    display_url: previewUrl,
  };
}

function hydrateStudioSessionMediaForResponse(sessionPayload = {}, options = {}) {
  const hydratedPayload = hydrateGuestMediaStringFields(sessionPayload, [
    'videoLink',
    'video_link',
    'renderedVideoURL',
    'renderedVideoUrl',
    'rendered_video_url',
    'remoteURL',
    'remoteUrl',
    'remote_url',
    'publishedVideoURL',
    'publishedVideoUrl',
    'published_video_url',
    'finalVideoURL',
    'finalVideoUrl',
    'final_video_url',
    'result_url',
    'videoURL',
    'videoUrl',
    'audio',
  ], buildStudioMediaDeliveryUrl);

  [
    'splashImage',
    'publishedSplashImage',
    'outroImageURL',
    'outroImageUrl',
    'outro_image_url',
    'shareOgImageUrl',
    'shareOgImagePath',
    'shareOgImageSource',
    'thumbnail',
    'thumbnailUrl',
    'thumbnailURL',
    'previewImageUrl',
    'ogImageUrl',
    'og_image_url',
  ].forEach((field) => {
    const hydratedImageUrl = buildStudioImageDeliveryUrl(hydratedPayload[field]);
    if (hydratedImageUrl) {
      hydratedPayload[field] = hydratedImageUrl;
    }
  });

  hydratedPayload.layers = Array.isArray(hydratedPayload.layers)
    ? hydratedPayload.layers.map((layer) => hydrateStudioLayerMediaForResponse(
      layer,
      hydratedPayload,
      options
    ))
    : [];
  hydratedPayload.audioLayers = Array.isArray(hydratedPayload.audioLayers)
    ? hydratedPayload.audioLayers.map(hydrateStudioAudioLayerForResponse)
    : hydratedPayload.audioLayers;

  const globalAudioLayers = Array.isArray(hydratedPayload.global_audio_layers)
    ? hydratedPayload.global_audio_layers
    : hydratedPayload.globalAudioLayers;
  if (Array.isArray(globalAudioLayers)) {
    const hydratedGlobalAudioLayers = globalAudioLayers.map(hydrateStudioAudioLayerForResponse);
    hydratedPayload.global_audio_layers = hydratedGlobalAudioLayers;
    hydratedPayload.globalAudioLayers = hydratedGlobalAudioLayers;
  }

  const globalVideos = Array.isArray(hydratedPayload.global_videos)
    ? hydratedPayload.global_videos
    : hydratedPayload.globalVideos;
  if (Array.isArray(globalVideos)) {
    const hydratedGlobalVideos = globalVideos.map(hydrateStudioGlobalVideoForResponse);
    hydratedPayload.global_videos = hydratedGlobalVideos;
    hydratedPayload.globalVideos = hydratedGlobalVideos;
  }

  hydratedPayload.generations = serializeGenerationImageAssets(
    hydratedPayload.generations,
    serializeStudioGenerationImageAsset
  );
  hydratedPayload.footerMetadata = hydrateStudioFooterMetadataForResponse(hydratedPayload.footerMetadata);

  return hydratedPayload;
}

async function sanitizeGuestSessionPayload(session) {
  const sessionPayload = await sanitizeStudioSessionPayload(session);
  if (!sessionPayload || typeof sessionPayload !== 'object') {
    return sessionPayload;
  }

  const hydratedPayload = hydrateGuestMediaStringFields(sessionPayload, [
    'videoLink',
    'video_link',
    'renderedVideoURL',
    'renderedVideoUrl',
    'rendered_video_url',
    'remoteURL',
    'remoteUrl',
    'remote_url',
    'publishedVideoURL',
    'publishedVideoUrl',
    'published_video_url',
    'audio',
  ], (value) => buildGuestMediaDeliveryUrl(value, sessionPayload));

  [
    'splashImage',
    'outroImageURL',
    'outroImageUrl',
    'outro_image_url',
    'shareOgImageUrl',
    'shareOgImagePath',
    'shareOgImageSource',
  ].forEach((field) => {
    const hydratedImageUrl = buildGuestImageDeliveryUrl(hydratedPayload[field], hydratedPayload);
    if (hydratedImageUrl) {
      hydratedPayload[field] = hydratedImageUrl;
    }
  });

  hydratedPayload.layers = Array.isArray(hydratedPayload.layers)
    ? hydratedPayload.layers.map((layer) => hydrateGuestLayerMediaForResponse(layer, hydratedPayload))
    : [];
  hydratedPayload.audioLayers = Array.isArray(hydratedPayload.audioLayers)
    ? hydratedPayload.audioLayers.map((audioLayer) => hydrateGuestAudioLayerForResponse(audioLayer, hydratedPayload))
    : hydratedPayload.audioLayers;
  const guestGlobalAudioLayers = Array.isArray(hydratedPayload.global_audio_layers)
    ? hydratedPayload.global_audio_layers
    : hydratedPayload.globalAudioLayers;
  const guestGlobalVideos = Array.isArray(hydratedPayload.global_videos)
    ? hydratedPayload.global_videos
    : hydratedPayload.globalVideos;

  hydratedPayload.global_audio_layers = Array.isArray(guestGlobalAudioLayers)
    ? guestGlobalAudioLayers.map((audioLayer) => hydrateGuestAudioLayerForResponse(audioLayer, hydratedPayload))
    : hydratedPayload.global_audio_layers;
  hydratedPayload.globalAudioLayers = Array.isArray(hydratedPayload.global_audio_layers)
    ? hydratedPayload.global_audio_layers
    : hydratedPayload.globalAudioLayers;
  hydratedPayload.global_videos = Array.isArray(guestGlobalVideos)
    ? guestGlobalVideos.map((globalVideo) => hydrateGuestGlobalVideoForResponse(globalVideo, hydratedPayload))
    : hydratedPayload.global_videos;
  hydratedPayload.globalVideos = Array.isArray(hydratedPayload.global_videos)
    ? hydratedPayload.global_videos
    : hydratedPayload.globalVideos;
  hydratedPayload.generations = serializeGenerationImageAssets(
    hydratedPayload.generations,
    (asset) => serializeGuestGenerationImageAsset(asset, hydratedPayload)
  );
  hydratedPayload.footerMetadata = hydrateGuestFooterMetadataForResponse(hydratedPayload.footerMetadata, hydratedPayload);

  delete hydratedPayload.userId;
  delete hydratedPayload.sessionOwnerId;
  delete hydratedPayload.isSessionOwner;
  delete hydratedPayload.isImportedSession;
  return hydratedPayload;
}

function sanitizeStudioLayerVideoUrlsForResponse(layer = {}) {
  const sanitizedLayer = {
    ...layer,
  };

  for (const field of [
    'aiVideoRemoteLink',
    'lipSyncRemoteLink',
    'soundEffectRemoteLink',
    'userVideoRemoteLink',
  ]) {
    const sanitizedUrl = buildStudioVideoRemoteUrl(sanitizedLayer[field]);
    if (sanitizedUrl) {
      sanitizedLayer[field] = sanitizedUrl;
    }
  }

  return sanitizedLayer;
}

function serializeGenerationImageAsset(asset) {
  const plainAsset = asset && typeof asset.toObject === 'function' ? asset.toObject() : asset;
  const rawSource = normalizeGenerationImageAssetSource(plainAsset);
  if (!rawSource) {
    return plainAsset;
  }

  const previewUrl = buildGenerationImagePreviewUrl(rawSource);
  if (plainAsset && typeof plainAsset === 'object' && !Array.isArray(plainAsset)) {
    return {
      ...plainAsset,
      src: rawSource,
      rawSrc: rawSource,
      url: previewUrl || plainAsset.url,
      previewUrl: previewUrl || plainAsset.previewUrl,
      imageUrl: previewUrl || plainAsset.imageUrl,
    };
  }

  return {
    src: rawSource,
    rawSrc: rawSource,
    url: previewUrl,
    previewUrl,
    imageUrl: previewUrl,
  };
}

function serializeGuestGenerationImageAsset(asset, sessionPayload = null) {
  const plainAsset = asset && typeof asset.toObject === 'function' ? asset.toObject() : asset;
  const rawSource = normalizeGenerationImageAssetSource(plainAsset);
  if (!rawSource) {
    return plainAsset;
  }

  const previewUrl = buildGuestImageDeliveryUrl(rawSource, sessionPayload);
  if (plainAsset && typeof plainAsset === 'object' && !Array.isArray(plainAsset)) {
    return {
      ...plainAsset,
      src: previewUrl || plainAsset.src,
      rawSrc: rawSource,
      rawUrl: rawSource,
      url: previewUrl || plainAsset.url,
      previewUrl: previewUrl || plainAsset.previewUrl,
      imageUrl: previewUrl || plainAsset.imageUrl,
      image_url: previewUrl || plainAsset.image_url,
      signedUrl: previewUrl || plainAsset.signedUrl,
      signed_url: previewUrl || plainAsset.signed_url,
      displayUrl: previewUrl || plainAsset.displayUrl,
      display_url: previewUrl || plainAsset.display_url,
    };
  }

  return {
    src: previewUrl,
    rawSrc: rawSource,
    rawUrl: rawSource,
    url: previewUrl,
    previewUrl,
    imageUrl: previewUrl,
    image_url: previewUrl,
    signedUrl: previewUrl,
    signed_url: previewUrl,
    displayUrl: previewUrl,
    display_url: previewUrl,
  };
}

function serializeGenerationImageAssets(generationImages = [], serializer = serializeGenerationImageAsset) {
  return Array.isArray(generationImages)
    ? generationImages.map((asset) => serializer(asset)).filter(Boolean)
    : [];
}

function serializeActiveImageItemForResponse(item) {
  const plainItem = toPlainActiveItem(item);
  if (!plainItem || typeof plainItem !== 'object' || plainItem.type !== 'image') {
    return plainItem;
  }

  const rawSource = normalizeGenerationImageAssetSource(plainItem);
  if (!rawSource) {
    return plainItem;
  }

  const previewUrl = buildStudioImageDeliveryUrl(rawSource);
  return {
    ...plainItem,
    src: rawSource,
    rawSrc: rawSource,
    rawUrl: rawSource,
    image: previewUrl || plainItem.image,
    url: previewUrl || plainItem.url,
    previewUrl: previewUrl || plainItem.previewUrl,
    imageUrl: previewUrl || plainItem.imageUrl,
    image_url: previewUrl || plainItem.image_url,
    signedUrl: previewUrl || plainItem.signedUrl,
    signed_url: previewUrl || plainItem.signed_url,
    displayUrl: previewUrl || plainItem.displayUrl,
    display_url: previewUrl || plainItem.display_url,
  };
}

function serializeActiveItemListForResponse(activeItemList = []) {
  return Array.isArray(activeItemList)
    ? activeItemList.map((item) => serializeActiveImageItemForResponse(item))
    : activeItemList;
}

function getActiveImageItemSource(item = {}) {
  return getFirstNonEmptyString(
    item?.previewUrl,
    item?.preview_url,
    item?.signedUrl,
    item?.signed_url,
    item?.displayUrl,
    item?.display_url,
    item?.url,
    item?.imageUrl,
    item?.image_url,
    item?.src,
    item?.image,
  );
}

function getLayerStudioBaseImageSource(layer = {}) {
  const imageSession = layer?.imageSession || {};
  return getFirstNonEmptyString(
    imageSession.activeImageRemoteLink,
    imageSession.activeSelectedImage,
    imageSession.activeEditedImage,
    imageSession.activeGeneratedImage,
    imageSession.videoRenderStartFrameImage,
  );
}

function hasRenderableActiveImageItem(activeItemList = []) {
  return Array.isArray(activeItemList) && activeItemList.some((item) => (
    item?.type === 'image' &&
    item?.isHidden !== true &&
    getActiveImageItemSource(item)
  ));
}

function getSyntheticStudioBaseImageItemId(activeItemList = []) {
  const existingIds = new Set(
    (Array.isArray(activeItemList) ? activeItemList : [])
      .map((item) => normalizeOptionalString(item?.id))
      .filter(Boolean)
  );
  if (!existingIds.has('item_0')) {
    return 'item_0';
  }
  if (!existingIds.has('studio_base_image')) {
    return 'studio_base_image';
  }

  let index = 1;
  while (existingIds.has(`studio_base_image_${index}`)) {
    index += 1;
  }
  return `studio_base_image_${index}`;
}

function hydrateStudioActiveItemListForResponse(layer = {}, sessionPayload = {}) {
  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];

  if (hasRenderableActiveImageItem(activeItemList)) {
    return serializeActiveItemListForResponse(activeItemList);
  }

  const baseImageSource = getLayerStudioBaseImageSource(layer);
  if (!baseImageSource) {
    return serializeActiveItemListForResponse(activeItemList);
  }

  const canvasDimensions = getCanvasDimensionsForAspectRatio(
    layer?.aspectRatio || sessionPayload?.aspectRatio || '1:1'
  );
  const nonImageItems = activeItemList.filter((item) => item?.type !== 'image');
  return serializeActiveItemListForResponse([
    {
      id: getSyntheticStudioBaseImageItemId(nonImageItems),
      type: 'image',
      x: 0,
      y: 0,
      width: canvasDimensions.width,
      height: canvasDimensions.height,
      src: baseImageSource,
      is_base_image: true,
      animations: [],
    },
    ...nonImageItems,
  ]);
}

function stripTransientActiveItemFields(item) {
  const plainItem = toPlainActiveItem(item);
  if (!plainItem || typeof plainItem !== 'object' || plainItem.type !== 'image') {
    return plainItem;
  }

  const {
    url,
    previewUrl,
    preview_url,
    imageUrl,
    image_url,
    signedUrl,
    signed_url,
    displayUrl,
    display_url,
    rawSrc,
    raw_src,
    rawUrl,
    raw_url,
    ...persistentItem
  } = plainItem;

  return persistentItem;
}

function getLayerVideoSourceType(layer = {}) {
  if (layer?.lipSyncVideoLayer || layer?.hasLipSyncVideoLayer) {
    return 'lip_sync';
  }
  if (layer?.soundEffectVideoLayer || layer?.hasSoundEffectVideoLayer) {
    return 'sound_effect';
  }
  if (layer?.userVideoLayer || layer?.hasUserVideoLayer) {
    return 'user_video';
  }
  if (layer?.aiVideoLayer || layer?.hasAiVideoLayer) {
    return 'ai_video';
  }
  return null;
}

function getConnectedVideoAudioGenerationType(sourceType) {
  if (
    sourceType === 'lip_sync'
    || sourceType === 'sound_effect'
    || sourceType === 'user_video'
  ) {
    return sourceType;
  }
  return null;
}

async function deleteQueuedSoundEffectGenerationsForLayer(sessionId, layerId) {
  const normalizedSessionId = sessionId?.toString?.() || sessionId;
  const normalizedLayerId = layerId?.toString?.() || layerId;

  if (!normalizedSessionId || !normalizedLayerId) {
    return { deletedCount: 0 };
  }

  return AIVideoLayerGeneration.deleteMany({
    sessionId: normalizedSessionId,
    layerId: normalizedLayerId,
    isAudioVideoGeneration: true,
    model: { $in: SOUND_EFFECT_GENERATION_MODELS },
  });
}

function resetLayerVideoEditState(layer = {}) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  layer.videoEditPending = false;
  layer.videoEditStatus = VIDEO_EDIT_STATUS.INIT;
  layer.videoEditError = null;
  layer.videoEditTaskId = null;
  layer.videoEditTaskMessage = null;
  layer.videoEditPendingOperations = [];
  if (!Array.isArray(layer.videoEditHistory)) {
    layer.videoEditHistory = [];
  }

  return layer;
}

function toRoundedVideoEditTime(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 1000) / 1000;
}

function normalizeVideoEditOperations(rawOperations = [], layerDurationSeconds = 0) {
  if (!Array.isArray(rawOperations) || rawOperations.length === 0) {
    return [];
  }
  if (rawOperations.length > VIDEO_EDIT_MAX_OPERATIONS) {
    throw new Error(`A maximum of ${VIDEO_EDIT_MAX_OPERATIONS} video edit operations can be applied at once.`);
  }

  const safeLayerDurationSeconds = Number(layerDurationSeconds);
  if (!Number.isFinite(safeLayerDurationSeconds) || safeLayerDurationSeconds <= 0) {
    throw new Error('Layer duration must be greater than zero.');
  }

  const normalizedOperations = rawOperations.map((operation, index) => {
    const normalizedType = typeof operation?.type === 'string'
      ? operation.type.trim().toUpperCase()
      : '';
    if (
      normalizedType !== VIDEO_EDIT_OPERATION_TYPES.REMOVE
      && normalizedType !== VIDEO_EDIT_OPERATION_TYPES.SPEED
    ) {
      throw new Error(`Unsupported video edit operation at index ${index}.`);
    }

    let startTime = toRoundedVideoEditTime(operation?.startTime);
    let endTime = toRoundedVideoEditTime(operation?.endTime);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      throw new Error(`Invalid video edit region at index ${index}.`);
    }
    if (
      endTime > safeLayerDurationSeconds
      && endTime <= safeLayerDurationSeconds + VIDEO_EDIT_EDITOR_FRAME_TOLERANCE_SECONDS
    ) {
      endTime = toRoundedVideoEditTime(safeLayerDurationSeconds);
    }
    if (endTime > safeLayerDurationSeconds + 0.001) {
      throw new Error(`Video edit region at index ${index} exceeds the current layer duration.`);
    }
    if (endTime <= startTime) {
      throw new Error(`Invalid video edit region at index ${index}.`);
    }

    let speedMultiplier = 1;
    if (normalizedType === VIDEO_EDIT_OPERATION_TYPES.SPEED) {
      speedMultiplier = Number(operation?.speedMultiplier);
      if (
        !Number.isFinite(speedMultiplier)
        || speedMultiplier <= 1
        || speedMultiplier > VIDEO_EDIT_MAX_SPEED_MULTIPLIER
      ) {
        throw new Error(`Invalid speed multiplier at index ${index}.`);
      }
      speedMultiplier = Math.round(speedMultiplier * 1000) / 1000;
    }

    return {
      id: typeof operation?.id === 'string' && operation.id.trim()
        ? operation.id.trim()
        : `video_edit_${index + 1}`,
      type: normalizedType,
      startTime,
      endTime,
      speedMultiplier,
    };
  }).sort((a, b) => a.startTime - b.startTime);

  for (let index = 1; index < normalizedOperations.length; index += 1) {
    if (normalizedOperations[index].startTime < normalizedOperations[index - 1].endTime) {
      throw new Error('Video edit regions cannot overlap.');
    }
  }

  return normalizedOperations;
}

function buildVisibleVideoEditSegments({
  operations = [],
  layerDurationSeconds = 0,
  sourceStartOffsetSeconds = 0,
}) {
  const safeLayerDurationSeconds = Number(layerDurationSeconds);
  if (!Number.isFinite(safeLayerDurationSeconds) || safeLayerDurationSeconds <= 0) {
    throw new Error('Layer duration must be greater than zero.');
  }

  const segments = [];
  let currentCursor = 0;

  const pushSegment = (segmentStart, segmentEnd, speedMultiplier = 1) => {
    const roundedStart = Math.round(segmentStart * 1000) / 1000;
    const roundedEnd = Math.round(segmentEnd * 1000) / 1000;
    if (!Number.isFinite(roundedStart) || !Number.isFinite(roundedEnd) || roundedEnd <= roundedStart) {
      return;
    }

    segments.push({
      visibleStart: roundedStart,
      visibleEnd: roundedEnd,
      sourceStart: Math.round((sourceStartOffsetSeconds + roundedStart) * 1000) / 1000,
      sourceEnd: Math.round((sourceStartOffsetSeconds + roundedEnd) * 1000) / 1000,
      speedMultiplier,
    });
  };

  operations.forEach((operation) => {
    if (operation.startTime > currentCursor) {
      pushSegment(currentCursor, operation.startTime, 1);
    }

    if (operation.type === VIDEO_EDIT_OPERATION_TYPES.SPEED) {
      pushSegment(operation.startTime, operation.endTime, operation.speedMultiplier);
    }

    currentCursor = Math.max(currentCursor, operation.endTime);
  });

  if (currentCursor < safeLayerDurationSeconds) {
    pushSegment(currentCursor, safeLayerDurationSeconds, 1);
  }

  if (segments.length === 0) {
    throw new Error('The requested edits remove the entire visible video range.');
  }

  return segments;
}

function buildAtempoFilterChain(speedMultiplier = 1) {
  const normalizedSpeedMultiplier = Number(speedMultiplier);
  if (!Number.isFinite(normalizedSpeedMultiplier) || normalizedSpeedMultiplier <= 0 || normalizedSpeedMultiplier === 1) {
    return [];
  }

  const filters = [];
  let remainingMultiplier = normalizedSpeedMultiplier;

  while (remainingMultiplier > 2) {
    filters.push('atempo=2');
    remainingMultiplier /= 2;
  }

  if (remainingMultiplier !== 1) {
    filters.push(`atempo=${remainingMultiplier.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`);
  }

  return filters;
}

async function renderVisibleVideoEdit({
  inputVideoPath,
  sessionId,
  layerId,
  segments,
  includeAudio = false,
}) {
  const editsFolder = path.join(resolveProcessorAssetsRoot(), 'ai_video', 'edits', `${sessionId}`, `${layerId}`);
  await fsExtra.ensureDir(editsFolder);

  const outputPath = path.join(editsFolder, `video_edit_${Date.now()}.mp4`);
  const filters = [];
  const concatInputs = [];

  segments.forEach((segment, index) => {
    const videoLabel = `vseg${index}`;
    filters.push(
      `[0:v]trim=start=${segment.sourceStart}:end=${segment.sourceEnd},setpts=(PTS-STARTPTS)/${segment.speedMultiplier}[${videoLabel}]`
    );
    concatInputs.push(`[${videoLabel}]`);

    if (includeAudio) {
      const audioLabel = `aseg${index}`;
      const audioFilterParts = [
        `atrim=start=${segment.sourceStart}:end=${segment.sourceEnd}`,
        'asetpts=PTS-STARTPTS',
        ...buildAtempoFilterChain(segment.speedMultiplier),
      ];
      filters.push(`[0:a]${audioFilterParts.join(',')}[${audioLabel}]`);
      concatInputs.push(`[${audioLabel}]`);
    }
  });

  const concatFilter = includeAudio
    ? `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=1[vout][aout]`
    : `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=0[vout]`;
  filters.push(concatFilter);

  await withProcessorFfmpegResources((threadOptions) => (
    new Promise((resolve, reject) => {
      const command = ffmpeg(inputVideoPath)
        .inputOptions(threadOptions.inputOptions)
        .complexFilter(filters)
        .outputOptions([
          ...threadOptions.outputOptions,
          '-map', '[vout]',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
        ]);

      if (includeAudio) {
        command.outputOptions([
          '-map', '[aout]',
          '-c:a', 'aac',
          '-b:a', '192k',
        ]);
      } else {
        command.noAudio();
      }

      command
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    })
  ));

  return outputPath;
}

async function renderEditedAudioSegments({
  inputAudioPath,
  sessionId,
  layerId,
  segments,
  prefix = 'video_edit',
}) {
  const safeSegments = Array.isArray(segments) ? segments.filter((segment) => (
    Number(segment?.sourceEnd) > Number(segment?.sourceStart)
  )) : [];
  if (!inputAudioPath || safeSegments.length === 0) {
    return null;
  }

  const outputFolder = path.join(resolveProcessorAssetsRoot(), 'ai_video', 'audio', `${sessionId}`, `${layerId}`);
  await fsExtra.ensureDir(outputFolder);

  const outputPath = path.join(outputFolder, `${prefix}_${Date.now()}.mp3`);
  const filters = [];
  const concatInputs = [];

  safeSegments.forEach((segment, index) => {
    const audioLabel = `aseg${index}`;
    const audioFilterParts = [
      `atrim=start=${segment.sourceStart}:end=${segment.sourceEnd}`,
      'asetpts=PTS-STARTPTS',
      ...buildAtempoFilterChain(segment.speedMultiplier),
    ];
    filters.push(`[0:a]${audioFilterParts.join(',')}[${audioLabel}]`);
    concatInputs.push(`[${audioLabel}]`);
  });

  filters.push(`${concatInputs.join('')}concat=n=${safeSegments.length}:v=0:a=1[aout]`);

  await withProcessorFfmpegResources((threadOptions) => (
    new Promise((resolve, reject) => {
      ffmpeg(inputAudioPath)
        .inputOptions(threadOptions.inputOptions)
        .complexFilter(filters)
        .outputOptions([
          ...threadOptions.outputOptions,
          '-map', '[aout]',
          '-c:a', 'libmp3lame',
          '-b:a', '192k',
        ])
        .noVideo()
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    })
  ));

  return outputPath;
}

function getFrameSafeDurationSecondsFromFrameCount(frameCount, framesPerSecond) {
  const safeFrameCount = Number(frameCount);
  const safeFramesPerSecond = Number(framesPerSecond) || 24;
  if (!Number.isFinite(safeFrameCount) || safeFrameCount <= 0 || !Number.isFinite(safeFramesPerSecond) || safeFramesPerSecond <= 0) {
    return null;
  }

  return Math.ceil((safeFrameCount / safeFramesPerSecond) * 1000000) / 1000000;
}

function getFrameSafeDurationSeconds(durationInSeconds, framesPerSecond) {
  const safeDuration = Number(durationInSeconds);
  const safeFramesPerSecond = Number(framesPerSecond) || 24;
  if (!Number.isFinite(safeDuration) || safeDuration <= 0 || !Number.isFinite(safeFramesPerSecond) || safeFramesPerSecond <= 0) {
    return null;
  }

  const frameCount = Math.max(1, Math.round(safeDuration * safeFramesPerSecond));
  return getFrameSafeDurationSecondsFromFrameCount(frameCount, safeFramesPerSecond);
}

async function resolveLayerDurationForRealign({
  sessionId,
  layerId,
  layer,
  framesPerSecond,
  preferFrameBasedDurations = false,
}) {
  const applyClipFramesToDuration = (durationInSeconds) => {
    const safeDuration = Number(durationInSeconds);
    if (!Number.isFinite(safeDuration) || safeDuration <= 0) {
      return null;
    }

    const safeFramesPerSecond = Number(framesPerSecond) || DEFAULT_FRAMES_PER_SECOND;
    const clipStartFrames = layer?.clipStart
      ? Math.max(0, Math.round(Number(layer?.clipStartFrames) || 0))
      : 0;
    const clipEndFrames = layer?.clipEnd
      ? Math.max(0, Math.round(Number(layer?.clipEndFrames) || 0))
      : 0;

    if (clipStartFrames === 0 && clipEndFrames === 0) {
      return getFrameSafeDurationSeconds(safeDuration, safeFramesPerSecond);
    }

    const totalSourceFrames = Math.max(1, Math.round(safeDuration * safeFramesPerSecond));
    const clippedFrameCount = Math.max(1, totalSourceFrames - clipStartFrames - clipEndFrames);
    return getFrameSafeDurationSecondsFromFrameCount(clippedFrameCount, safeFramesPerSecond);
  };

  const audioVideoDirs = [];
  const baseDirs = [];
  const roots = getProcessorAssetsRootCandidates();
  const prefersVideoNamespace = isContainerRuntime();
  const framesNamespacePriority = prefersVideoNamespace ? ['video', 'ai_video'] : ['ai_video', 'video'];

  for (const assetsRoot of roots) {
    for (const namespace of framesNamespacePriority) {
      const baseFramesDir = path.join(assetsRoot, namespace, 'frames', `${sessionId}`, `${layerId}`);
      audioVideoDirs.push(path.join(baseFramesDir, 'audio_video'));
      baseDirs.push(baseFramesDir);
    }
  }

  const getDurationFromDirs = (dirs) => {
    for (const framesDir of dirs) {
      const maxFrameIndex = getMaxNumericPngFrameIndexFromDir(framesDir);
      if (maxFrameIndex >= 0) {
        const durationFromFrames = (maxFrameIndex + 1) / (Number(framesPerSecond) || DEFAULT_FRAMES_PER_SECOND);
        return applyClipFramesToDuration(durationFromFrames);
      }
    }
    return null;
  };

  const getDurationFromFrames = () => {
    if (shouldConsiderAudioVideoFramesForRealign(layer)) {
      const durationFromAudioVideoFrames = getDurationFromDirs(audioVideoDirs);
      if (Number.isFinite(durationFromAudioVideoFrames) && durationFromAudioVideoFrames > 0) {
        return durationFromAudioVideoFrames;
      }
    }
    return getDurationFromDirs(baseDirs);
  };

  if (preferFrameBasedDurations) {
    const frameDuration = getDurationFromFrames();
    if (Number.isFinite(frameDuration) && frameDuration > 0) {
      return frameDuration;
    }
  }

  const preferredVideoLink = getLayerPreferredVideoLink(layer);
  if (preferredVideoLink) {
    try {
      const probedDuration = await getDurationForVideo(preferredVideoLink);
      if (Number.isFinite(probedDuration) && probedDuration > 0) {
        return applyClipFramesToDuration(probedDuration);
      }
    } catch {
      // fallback to frame-count-based duration below
    }
  }

  const fallbackDurationFromFrames = getDurationFromFrames();
  if (Number.isFinite(fallbackDurationFromFrames) && fallbackDurationFromFrames > 0) {
    return fallbackDurationFromFrames;
  }

  return null;
}

const LIPSYNC_MODELS = ['SYNCLIPSYNC', 'LATENTSYNC', 'KLINGLIPSYNC', 'HUMMINGBIRDLIPSYNC'];
const SOUND_EFFECT_MODELS = ['MMAUDIOV2', 'MIRELOAI'];
const SOUND_EFFECT_GENERATION_MODELS = [
  ...SOUND_EFFECT_MODELS,
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'SEEDANCEI2V',
  'SEEDANCE2.0I2V',
  'SEEDANCE2.5I2V',
];
const USER_VIDEO_MAX_DURATION_SECONDS = 5 * 60;
const USER_VIDEO_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;
const SUPPORTED_USER_VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v']);
const SUPPORTED_USER_VIDEO_CONTENT_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'application/octet-stream',
]);
const GLOBAL_VIDEO_MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;
const GLOBAL_VIDEO_DEFAULT_SHAPE = 'circle';
const GLOBAL_VIDEO_SHAPES = new Set([
  'circle',
  'oval',
  'rectangle',
  'rect',
  'rounded_rectangle',
  'rounded-rectangle',
]);
const GLOBAL_VIDEO_PROCESSING_STATUSES = new Set(['INIT', 'PROCESSING', 'COMPLETED', 'FAILED']);
const ACTIVE_GLOBAL_VIDEO_PROCESSING_TASKS = new Set();

function normalizeGlobalVideosField(sessionData = {}) {
  if (Array.isArray(sessionData.global_videos)) {
    return sessionData.global_videos;
  }
  if (Array.isArray(sessionData.globalVideos)) {
    return sessionData.globalVideos;
  }
  return [];
}

function normalizeGlobalVideoProcessingStatus(value, fallback = 'INIT') {
  const normalizedStatus = typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';

  if (GLOBAL_VIDEO_PROCESSING_STATUSES.has(normalizedStatus)) {
    return normalizedStatus;
  }
  return fallback;
}

function parseMediaDurationSeconds(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const numericValue = Number(normalizedValue);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }

  const timeParts = normalizedValue.split(':');
  if (timeParts.length < 2 || timeParts.length > 3) {
    return null;
  }

  const parsedParts = timeParts.map((part) => Number(part));
  if (parsedParts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  const [hours, minutes, seconds] = timeParts.length === 3
    ? parsedParts
    : [0, parsedParts[0], parsedParts[1]];
  const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
  return totalSeconds > 0 ? totalSeconds : null;
}

function getVideoMetadataDurationSeconds(metadata = {}) {
  const durationCandidates = [
    metadata?.format?.duration,
    metadata?.format?.tags?.DURATION,
    metadata?.format?.tags?.duration,
    ...(Array.isArray(metadata?.streams)
      ? metadata.streams.flatMap((streamMeta) => [
        streamMeta?.duration,
        streamMeta?.tags?.DURATION,
        streamMeta?.tags?.duration,
      ])
      : []),
  ];

  for (const durationCandidate of durationCandidates) {
    const durationSeconds = parseMediaDurationSeconds(durationCandidate);
    if (durationSeconds !== null) {
      return durationSeconds;
    }
  }

  return null;
}

function getGlobalVideoSourceKey(globalVideo = {}) {
  return getNormalizedAssetPath(
    globalVideo?.assetPath
      || globalVideo?.remoteURL
      || globalVideo?.url
      || ''
  );
}

function shouldRegenerateGlobalVideoFrames(inputVideo = {}, existingVideo = null) {
  const status = normalizeGlobalVideoProcessingStatus(
    inputVideo?.framesGenerationStatus
      || inputVideo?.frameGenerationStatus
      || existingVideo?.framesGenerationStatus
      || existingVideo?.frameGenerationStatus,
    ''
  );
  const isPending = status === 'PROCESSING'
    || status === 'INIT'
    || inputVideo?.framesGenerationPending === true
    || existingVideo?.framesGenerationPending === true;
  if (isPending) {
    return false;
  }

  const hasExistingFrames = Array.isArray(existingVideo?.frames) && existingVideo.frames.length > 0;
  const inputSourceKey = getGlobalVideoSourceKey(inputVideo);
  const existingSourceKey = getGlobalVideoSourceKey(existingVideo || {});
  const sourceChanged = Boolean(inputSourceKey && existingSourceKey && inputSourceKey !== existingSourceKey);

  return !existingVideo || sourceChanged || !hasExistingFrames;
}

function getGlobalVideoIdValue(globalVideo = {}) {
  return globalVideo?._id?.toString?.()
    || globalVideo?.id?.toString?.()
    || globalVideo?.globalVideoId?.toString?.()
    || '';
}

function toPlainGlobalVideo(globalVideo = {}) {
  return typeof globalVideo?.toObject === 'function'
    ? globalVideo.toObject()
    : globalVideo;
}

function getGlobalVideoTaskKey(sessionId, globalVideoId) {
  return `${sessionId?.toString?.() || sessionId}:${globalVideoId?.toString?.() || globalVideoId}`;
}

function toMongoGlobalVideoId(globalVideoId) {
  const normalizedGlobalVideoId = globalVideoId?.toString?.() || `${globalVideoId || ''}`.trim();
  if (mongoose.Types.ObjectId.isValid(normalizedGlobalVideoId)) {
    return new mongoose.Types.ObjectId(normalizedGlobalVideoId);
  }
  return normalizedGlobalVideoId;
}

function normalizeGlobalVideoShape(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return GLOBAL_VIDEO_DEFAULT_SHAPE;
  }

  const normalizedShape = value.trim().toLowerCase().replace(/\s+/g, '_');
  return GLOBAL_VIDEO_SHAPES.has(normalizedShape) ? normalizedShape : GLOBAL_VIDEO_DEFAULT_SHAPE;
}

function getGlobalVideoFramesPerSecond(sessionData = {}) {
  return resolveFramesPerSecond(sessionData?.framesPerSecond);
}

function parseGlobalVideoObjectValue(value = {}) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsedValue = JSON.parse(value);
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch {
    return {};
  }
}

function normalizeGlobalVideoDimensions(dimensions = {}, canvasDimensions = { width: 1024, height: 1024 }) {
  const normalizedDimensions = parseGlobalVideoObjectValue(dimensions);
  const referenceSide = Math.min(canvasDimensions.width, canvasDimensions.height);
  const fallbackSize = Math.max(96, Math.round(referenceSide * 0.22));
  const width = Number(normalizedDimensions?.width);
  const height = Number(normalizedDimensions?.height);

  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : fallbackSize,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : fallbackSize,
  };
}

function normalizeGlobalVideoPosition(position = {}, dimensions = {}, canvasDimensions = { width: 1024, height: 1024 }) {
  const normalizedPosition = parseGlobalVideoObjectValue(position);
  const margin = Math.max(24, Math.round(Math.min(canvasDimensions.width, canvasDimensions.height) * 0.035));
  const x = Number(normalizedPosition?.x);
  const y = Number(normalizedPosition?.y);
  const width = Number(dimensions?.width) || 0;
  const height = Number(dimensions?.height) || 0;

  return {
    x: Number.isFinite(x) ? Math.round(x) : Math.max(0, canvasDimensions.width - width - margin),
    y: Number.isFinite(y) ? Math.round(y) : Math.max(0, canvasDimensions.height - height - margin),
  };
}

function getGlobalVideoFrameDirectory(sessionId, globalVideoId) {
  return path.join(
    resolveProcessorAssetsRoot(),
    'global_videos',
    'frames',
    sessionId.toString(),
    globalVideoId.toString()
  );
}

async function listGlobalVideoFrameRelativePaths(sessionId, globalVideoId) {
  const frameDirectory = getGlobalVideoFrameDirectory(sessionId, globalVideoId);
  const files = await fsPromises.readdir(frameDirectory).catch(() => []);

  return files
    .filter((fileName) => fileName.toLowerCase().endsWith('.png'))
    .sort((leftFile, rightFile) => {
      const leftIndex = Number.parseInt(leftFile, 10);
      const rightIndex = Number.parseInt(rightFile, 10);
      if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex)) {
        return leftIndex - rightIndex;
      }
      return leftFile.localeCompare(rightFile);
    })
    .map((fileName) => `/global_videos/frames/${sessionId}/${globalVideoId}/${fileName}`);
}

async function regenerateGlobalVideoFramesForSession(sessionData, globalVideo) {
  const sessionId = sessionData?._id?.toString?.() || sessionData?.id?.toString?.();
  const globalVideoId = globalVideo?._id?.toString?.() || globalVideo?.id?.toString?.();
  const sourceVideoUrl = typeof globalVideo?.assetPath === 'string' && globalVideo.assetPath.trim()
    ? globalVideo.assetPath.trim()
    : typeof globalVideo?.url === 'string'
      ? globalVideo.url.trim()
      : '';

  if (!sessionId || !globalVideoId || !sourceVideoUrl) {
    return [];
  }

  const sourceVideoPath = resolveProcessorAssetAbsolutePath(sourceVideoUrl);
  if (!sourceVideoPath || !fs.existsSync(sourceVideoPath)) {
    return Array.isArray(globalVideo.frames) ? globalVideo.frames : [];
  }

  const canvasDimensions = getCanvasDimensionsForAspectRatio(sessionData?.aspectRatio || '1:1');
  const dimensions = normalizeGlobalVideoDimensions(globalVideo.dimensions, canvasDimensions);
  const framesPerSecond = getGlobalVideoFramesPerSecond(sessionData);

  await processVideoAsFrames(
    sourceVideoPath,
    sessionId,
    globalVideoId,
    dimensions,
    framesPerSecond,
    {
      forceFramesPerSecond: framesPerSecond,
      framesNamespace: 'global_videos',
      preserveAspectRatio: true,
    }
  );

  return listGlobalVideoFrameRelativePaths(sessionId, globalVideoId);
}

function getLayerIdsOverlappingTimeRange(layers = [], startTime, endTime) {
  const start = Math.max(0, Number(startTime) || 0);
  const end = Math.max(start, Number(endTime) || start);

  if (!(end > start) || !Array.isArray(layers)) {
    return [];
  }

  return layers
    .filter((layer) => {
      const layerStartTime = Math.max(0, Number(layer?.durationOffset) || 0);
      const layerEndTime = layerStartTime + Math.max(0, Number(layer?.duration) || 0);
      return end > layerStartTime && start < layerEndTime;
    })
    .map((layer) => layer?._id?.toString?.())
    .filter(Boolean);
}

function getGlobalVideoDirtyLayerIds(sessionData, boundsList = []) {
  if (!sessionData || !Array.isArray(sessionData.layers)) {
    return [];
  }

  const layerIdSet = new Set();
  boundsList.forEach((bounds) => {
    getLayerIdsOverlappingTimeRange(
      sessionData.layers,
      bounds?.startTime,
      bounds?.endTime
    ).forEach((layerId) => layerIdSet.add(layerId));
  });

  return Array.from(layerIdSet);
}

async function prepareGlobalVideoDirtyLayers(sessionData, boundsList = []) {
  const layerIds = getGlobalVideoDirtyLayerIds(sessionData, boundsList);
  if (layerIds.length === 0) {
    return [];
  }

  for (const layerId of layerIds) {
    await deleteUnlockedFrameGenerations(sessionData._id.toString(), layerId);
  }
  await ensureUnlockedFrameGenerations(sessionData._id.toString(), layerIds);

  return layerIds;
}

async function markGlobalVideoBoundsPending(sessionData, boundsList = []) {
  const layerIds = await prepareGlobalVideoDirtyLayers(sessionData, boundsList);
  if (layerIds.length === 0) {
    return [];
  }

  const layerIdSet = new Set(layerIds);
  sessionData.layers.forEach((layer) => {
    const layerId = layer?._id?.toString?.();
    if (layerIdSet.has(layerId)) {
      layer.frameGenerationPending = true;
    }
  });
  sessionData.frameGenerationPending = true;

  return layerIds;
}

function normalizeGlobalVideoTimeRange(sessionData, input = {}, fallbackDuration = 0) {
  const timelineEndTime = resolveSessionTimelineEndTime(sessionData);
  const rawStartTime = Number(input?.startTime);
  const startTime = Number.isFinite(rawStartTime) && rawStartTime >= 0
    ? Math.floor(rawStartTime * 100) / 100
    : 0;
  const rawDuration = Number(input?.duration);
  const rawEndTime = Number(input?.endTime);
  let duration = Number.isFinite(rawDuration) && rawDuration > 0
    ? rawDuration
    : Number.isFinite(rawEndTime) && rawEndTime > startTime
      ? rawEndTime - startTime
      : fallbackDuration;

  if (!Number.isFinite(duration) || duration <= 0) {
    duration = fallbackDuration;
  }

  if (timelineEndTime > 0) {
    duration = Math.min(duration, Math.max(timelineEndTime - startTime, 0));
  }

  duration = Math.max(0, Math.floor(duration * 100) / 100);
  const endTime = Math.floor((startTime + duration) * 100) / 100;

  return {
    startTime,
    endTime,
    duration,
  };
}

function getPlainGlobalVideoBounds(globalVideo = {}) {
  return {
    startTime: Number(globalVideo?.startTime) || 0,
    endTime: Number(globalVideo?.endTime) || 0,
  };
}

function resolveGlobalVideoId(input = {}) {
  const idCandidate = input?._id || input?.id;
  if (idCandidate && mongoose.Types.ObjectId.isValid(idCandidate)) {
    return new mongoose.Types.ObjectId(idCandidate);
  }
  return new mongoose.Types.ObjectId();
}

async function normalizePersistedGlobalVideoPayload(sessionData, input = {}, existingVideo = null, options = {}) {
  const canvasDimensions = getCanvasDimensionsForAspectRatio(sessionData?.aspectRatio || '1:1');
  const fallbackDuration = normalizePositiveSeconds(
    input?.duration,
    normalizePositiveSeconds(existingVideo?.duration, 0)
  ) || 0;
  const timeline = normalizeGlobalVideoTimeRange(sessionData, input, fallbackDuration);
  const dimensions = normalizeGlobalVideoDimensions(
    input?.dimensions || existingVideo?.dimensions || {},
    canvasDimensions
  );
  const position = normalizeGlobalVideoPosition(
    input?.position || existingVideo?.position || {},
    dimensions,
    canvasDimensions
  );
  const assetPath = typeof input?.assetPath === 'string' && input.assetPath.trim()
    ? input.assetPath.trim()
    : typeof existingVideo?.assetPath === 'string' && existingVideo.assetPath.trim()
      ? existingVideo.assetPath.trim()
      : '';
  const url = typeof input?.url === 'string' && input.url.trim()
    ? input.url.trim()
    : typeof existingVideo?.url === 'string' && existingVideo.url.trim()
      ? existingVideo.url.trim()
      : buildRemoteAssetUrl(assetPath);
  const inputFramesGenerationStatus = input?.framesGenerationStatus || input?.frameGenerationStatus;
  const existingFramesGenerationStatus = existingVideo?.framesGenerationStatus || existingVideo?.frameGenerationStatus;
  const framesGenerationStatus = normalizeGlobalVideoProcessingStatus(
    inputFramesGenerationStatus || existingFramesGenerationStatus,
    Array.isArray(existingVideo?.frames) && existingVideo.frames.length > 0 ? 'COMPLETED' : 'INIT'
  );
  const normalizedVideo = {
    _id: resolveGlobalVideoId(input || existingVideo || {}),
    ...timeline,
    url,
    remoteURL: typeof input?.remoteURL === 'string' && input.remoteURL.trim()
      ? input.remoteURL.trim()
      : typeof existingVideo?.remoteURL === 'string' && existingVideo.remoteURL.trim()
        ? existingVideo.remoteURL.trim()
        : buildRemoteAssetUrl(assetPath || url),
    assetPath: assetPath || getNormalizedAssetPath(url),
    position,
    dimensions,
    shape_overlay: normalizeGlobalVideoShape(input?.shape_overlay || input?.shapeOverlay || existingVideo?.shape_overlay),
    framesPerSecond: getGlobalVideoFramesPerSecond(sessionData),
    frames: Array.isArray(input?.frames)
      ? input.frames
      : Array.isArray(existingVideo?.frames)
        ? existingVideo.frames
        : [],
    framesGenerationStatus,
    framesGenerationPending: typeof input?.framesGenerationPending === 'boolean'
      ? input.framesGenerationPending
      : typeof existingVideo?.framesGenerationPending === 'boolean'
        ? existingVideo.framesGenerationPending
        : framesGenerationStatus === 'PROCESSING',
    framesGenerationError: typeof input?.framesGenerationError === 'string'
      ? input.framesGenerationError
      : typeof existingVideo?.framesGenerationError === 'string'
        ? existingVideo.framesGenerationError
        : '',
    framesGenerationTaskId: typeof input?.framesGenerationTaskId === 'string'
      ? input.framesGenerationTaskId
      : typeof existingVideo?.framesGenerationTaskId === 'string'
        ? existingVideo.framesGenerationTaskId
        : '',
    framesGeneratedAt: input?.framesGeneratedAt || existingVideo?.framesGeneratedAt || null,
    source: typeof input?.source === 'string' && input.source.trim()
      ? input.source.trim()
      : existingVideo?.source || 'facecam',
    title: typeof input?.title === 'string' && input.title.trim()
      ? input.title.trim()
      : existingVideo?.title || 'Facecam',
  };

  if (options?.regenerateFrames !== false && (normalizedVideo.assetPath || normalizedVideo.url)) {
    normalizedVideo.frames = await regenerateGlobalVideoFramesForSession(sessionData, normalizedVideo);
    normalizedVideo.framesGenerationStatus = 'COMPLETED';
    normalizedVideo.framesGenerationPending = false;
    normalizedVideo.framesGenerationError = '';
    normalizedVideo.framesGeneratedAt = new Date();
  }

  return normalizedVideo;
}

function scheduleGlobalVideoProcessingTask({ userId, sessionId, globalVideoId }) {
  const taskKey = getGlobalVideoTaskKey(sessionId, globalVideoId);
  if (!taskKey || ACTIVE_GLOBAL_VIDEO_PROCESSING_TASKS.has(taskKey)) {
    return false;
  }

  ACTIVE_GLOBAL_VIDEO_PROCESSING_TASKS.add(taskKey);
  setImmediate(async () => {
    try {
      await processGlobalVideoFramesForSession({ userId, sessionId, globalVideoId });
    } catch (error) {
      console.error('Failed to process global video frames:', error);
      await markGlobalVideoProcessingFailed({ userId, sessionId, globalVideoId, error }).catch((updateError) => {
        console.error('Failed to mark global video processing failed:', updateError);
      });
    } finally {
      ACTIVE_GLOBAL_VIDEO_PROCESSING_TASKS.delete(taskKey);
    }
  });

  return true;
}

async function markGlobalVideoProcessingFailed({ userId, sessionId, globalVideoId, error }) {
  await getDBConnectionString();
  const mongoGlobalVideoId = toMongoGlobalVideoId(globalVideoId);
  await VideoSession.updateOne(
    { _id: sessionId, 'global_videos._id': mongoGlobalVideoId },
    {
      $set: {
        'global_videos.$[targetGlobalVideo].framesGenerationStatus': 'FAILED',
        'global_videos.$[targetGlobalVideo].framesGenerationPending': false,
        'global_videos.$[targetGlobalVideo].framesGenerationError': error?.message || 'Unable to process facecam video.',
      },
      $inc: {
        __v: 1,
      },
    },
    {
      arrayFilters: [{ 'targetGlobalVideo._id': mongoGlobalVideoId }],
    }
  );
}

async function processGlobalVideoFramesForSession({ userId, sessionId, globalVideoId }) {
  await getDBConnectionString();
  const mongoGlobalVideoId = toMongoGlobalVideoId(globalVideoId);
  const sessionData = await VideoSession.findById(sessionId);
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const persistedGlobalVideo = normalizeGlobalVideosField(sessionData).find(
    (globalVideo) => getGlobalVideoIdValue(globalVideo) === globalVideoId?.toString?.()
      || getGlobalVideoIdValue(globalVideo) === `${globalVideoId || ''}`
  );
  if (!persistedGlobalVideo) {
    throw new Error('Global video not found');
  }

  const globalVideo = toPlainGlobalVideo(persistedGlobalVideo);
  const sourceVideoPath = resolveProcessorAssetAbsolutePath(globalVideo.assetPath || globalVideo.url);
  if (!sourceVideoPath || !fs.existsSync(sourceVideoPath)) {
    throw new Error('Uploaded facecam video file was not found.');
  }

  await VideoSession.updateOne(
    { _id: sessionId, 'global_videos._id': mongoGlobalVideoId },
    {
      $set: {
        'global_videos.$[targetGlobalVideo].framesGenerationStatus': 'PROCESSING',
        'global_videos.$[targetGlobalVideo].framesGenerationPending': true,
        'global_videos.$[targetGlobalVideo].framesGenerationError': '',
      },
    },
    {
      arrayFilters: [{ 'targetGlobalVideo._id': mongoGlobalVideoId }],
    }
  );

  const normalizedVideoPath = await normalizeVideoAssetToMp4WithoutAudio(sourceVideoPath, {
    sessionId,
    layerId: globalVideoId.toString(),
    prefix: 'global_video',
    namespace: 'global_videos',
  });
  const assetPath = toAssetRelativePath(normalizedVideoPath);
  const remoteURL = buildRemoteAssetUrl(assetPath);
  const processedGlobalVideo = {
    ...globalVideo,
    assetPath,
    url: remoteURL,
    remoteURL,
    frames: [],
  };
  const frames = await regenerateGlobalVideoFramesForSession(sessionData, processedGlobalVideo);
  const framesPerSecond = getGlobalVideoFramesPerSecond(sessionData);
  const durationFromFrames = frames.length > 0 && framesPerSecond > 0
    ? frames.length / framesPerSecond
    : null;
  let normalizedVideoDuration = null;
  try {
    normalizedVideoDuration = getVideoMetadataDurationSeconds(await getVideoMetadata(normalizedVideoPath));
  } catch (error) {
    console.error('Unable to read normalized global video duration:', {
      sessionId,
      globalVideoId,
      error: error?.message || error,
    });
  }
  const processedDuration = normalizePositiveSeconds(
    normalizedVideoDuration,
    normalizePositiveSeconds(durationFromFrames, normalizePositiveSeconds(globalVideo.duration, null))
  );
  const processedEndTime = processedDuration !== null
    ? Math.floor(((Number(globalVideo.startTime) || 0) + processedDuration) * 100) / 100
    : globalVideo.endTime;
  if (processedDuration !== null) {
    processedGlobalVideo.duration = Math.floor(processedDuration * 100) / 100;
    processedGlobalVideo.endTime = processedEndTime;
  }
  const latestSessionData = await VideoSession.findById(sessionId);
  if (!latestSessionData) {
    throw new Error('VideoSession not found');
  }
  const dirtyLayerIds = await prepareGlobalVideoDirtyLayers(latestSessionData, [processedGlobalVideo]);
  const update = {
    $set: {
      'global_videos.$[targetGlobalVideo].assetPath': assetPath,
      'global_videos.$[targetGlobalVideo].url': remoteURL,
      'global_videos.$[targetGlobalVideo].remoteURL': remoteURL,
      ...(processedDuration !== null
        ? {
          'global_videos.$[targetGlobalVideo].duration': Math.floor(processedDuration * 100) / 100,
          'global_videos.$[targetGlobalVideo].endTime': processedEndTime,
        }
        : {}),
      'global_videos.$[targetGlobalVideo].frames': frames,
      'global_videos.$[targetGlobalVideo].framesGenerationStatus': 'COMPLETED',
      'global_videos.$[targetGlobalVideo].framesGenerationPending': false,
      'global_videos.$[targetGlobalVideo].framesGenerationError': '',
      'global_videos.$[targetGlobalVideo].framesGeneratedAt': new Date(),
    },
    $inc: {
      __v: 1,
    },
  };
  const arrayFilters = [{ 'targetGlobalVideo._id': mongoGlobalVideoId }];

  if (dirtyLayerIds.length > 0) {
    update.$set.frameGenerationPending = true;
    update.$set['layers.$[dirtyLayer].frameGenerationPending'] = true;
    arrayFilters.push({
      'dirtyLayer._id': {
        $in: dirtyLayerIds.map((layerId) => (
          mongoose.Types.ObjectId.isValid(layerId)
            ? new mongoose.Types.ObjectId(layerId)
            : layerId
        )),
      },
    });
  }

  await VideoSession.updateOne(
    { _id: sessionId, 'global_videos._id': mongoGlobalVideoId },
    update,
    { arrayFilters }
  );

  if (sourceVideoPath !== normalizedVideoPath && path.basename(sourceVideoPath).startsWith('global_video_upload_')) {
    await fsExtra.remove(sourceVideoPath).catch(() => {});
  }
}

export async function getGlobalVideoProcessingStatusForSession(userId, payload = {}) {
  await getDBConnectionString();
  const { sessionId, globalVideoId } = payload;
  if (!sessionId || !globalVideoId) {
    throw new Error('sessionId and globalVideoId are required.');
  }

  const sessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: false,
  });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const persistedGlobalVideo = normalizeGlobalVideosField(sessionData).find(
    (globalVideo) => getGlobalVideoIdValue(globalVideo) === globalVideoId.toString()
  );
  if (!persistedGlobalVideo) {
    throw new Error('Global video not found');
  }

  const globalVideo = toPlainGlobalVideo(persistedGlobalVideo);
  const frames = Array.isArray(globalVideo.frames) ? globalVideo.frames : [];
  const status = normalizeGlobalVideoProcessingStatus(
    globalVideo.framesGenerationStatus,
    frames.length > 0 ? 'COMPLETED' : 'PROCESSING'
  );
  const complete = status === 'COMPLETED';
  const failed = status === 'FAILED';
  const taskKey = getGlobalVideoTaskKey(sessionId, globalVideoId);

  if (!complete && !failed && !ACTIVE_GLOBAL_VIDEO_PROCESSING_TASKS.has(taskKey)) {
    scheduleGlobalVideoProcessingTask({ userId, sessionId, globalVideoId });
  }

  return {
    status,
    complete,
    failed,
    active: ACTIVE_GLOBAL_VIDEO_PROCESSING_TASKS.has(taskKey),
    globalVideo,
  };
}

export async function uploadGlobalVideoForSession(userId, payload) {
  await getDBConnectionString();

  const {
    sessionId,
    fileBuffer,
    fileName,
    contentType,
    startTime,
    endTime,
    duration,
    position,
    dimensions,
    shapeOverlay,
    shape_overlay: shapeOverlaySnake,
    source,
    title,
  } = payload || {};

  if (!sessionId) {
    throw new Error('sessionId is required.');
  }
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error('Uploaded facecam video payload is empty.');
  }
  if (fileBuffer.length > GLOBAL_VIDEO_MAX_FILE_SIZE_BYTES) {
    throw new Error('Facecam video must be 512 MB or smaller.');
  }
  if (!isSupportedUploadedVideo({ fileName, contentType })) {
    throw new Error('Unsupported facecam video format. Please upload MP4, MOV, WEBM, or M4V.');
  }

  const uploadExtension = resolveUploadedVideoExtension(fileName, contentType);
  if (!uploadExtension) {
    throw new Error('Unable to determine a supported facecam video extension.');
  }

  await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });

  const globalVideoId = new mongoose.Types.ObjectId();
  const uploadedVideoPath = await saveUploadedVideoBuffer(fileBuffer, {
    sessionId,
    layerId: globalVideoId.toString(),
    extension: uploadExtension,
    prefix: 'global_video_upload',
    namespace: 'global_videos',
  });

  let shouldRemoveUploadedVideoPath = true;
  try {
    let probedDuration = null;
    try {
      probedDuration = getVideoMetadataDurationSeconds(await getVideoMetadata(uploadedVideoPath));
    } catch (error) {
      console.error('Unable to probe uploaded facecam video duration; falling back to requested duration:', {
        sessionId,
        globalVideoId: globalVideoId.toString(),
        error: error?.message || error,
      });
    }

    const requestedDuration = normalizePositiveSeconds(duration, null);
    const persistedDuration = normalizePositiveSeconds(
      requestedDuration,
      normalizePositiveSeconds(probedDuration, null)
    );
    if (persistedDuration === null) {
      throw new Error('Unable to determine uploaded facecam video duration.');
    }

    const taskId = getGlobalVideoTaskKey(sessionId, globalVideoId.toString());
    const assetPath = toAssetRelativePath(uploadedVideoPath);
    const remoteURL = buildRemoteAssetUrl(assetPath);
    const latestSessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
      markEdited: true,
    });
    if (!latestSessionData) {
      throw new Error('VideoSession not found');
    }

    const boundedDuration = probedDuration !== null && requestedDuration !== null
      ? Math.min(requestedDuration, probedDuration)
      : persistedDuration;
    const globalVideo = await normalizePersistedGlobalVideoPayload(
      latestSessionData,
      {
        _id: globalVideoId,
        startTime,
        endTime,
        duration: boundedDuration,
        position,
        dimensions,
        shape_overlay: shapeOverlaySnake || shapeOverlay,
        url: remoteURL,
        remoteURL,
        assetPath,
        source: source || 'facecam',
        title,
        framesGenerationStatus: 'PROCESSING',
        framesGenerationPending: true,
        framesGenerationError: '',
        framesGenerationTaskId: taskId,
      },
      {
        duration: probedDuration || persistedDuration,
      },
      {
        regenerateFrames: false,
      }
    );
    const update = {
      $push: {
        global_videos: globalVideo,
      },
      $inc: {
        __v: 1,
      },
    };

    const updateResult = await VideoSession.updateOne(
      { _id: sessionId },
      update
    );
    const matchedCount = Number(updateResult?.matchedCount ?? updateResult?.n ?? 0);
    if (matchedCount === 0) {
      throw new Error('VideoSession not found');
    }

    const savedSession = await VideoSession.findById(sessionId);
    const savedGlobalVideo = normalizeGlobalVideosField(savedSession).find(
      (video) => video?._id?.toString?.() === globalVideoId.toString()
    );
    shouldRemoveUploadedVideoPath = false;
    scheduleGlobalVideoProcessingTask({
      userId,
      sessionId,
      globalVideoId: globalVideoId.toString(),
    });

    return {
      sessionDetails: savedSession,
      globalVideo: savedGlobalVideo || globalVideo,
      dirtyLayerIds: [],
      status: 'PROCESSING',
      complete: false,
    };
  } finally {
    if (shouldRemoveUploadedVideoPath) {
      fsExtra.remove(uploadedVideoPath).catch(() => {});
    }
  }
}

export async function updateGlobalVideosForSession(userId, payload) {
  await getDBConnectionString();

  const {
    sessionId,
    globalVideos,
  } = payload || {};

  if (!sessionId) {
    throw new Error('sessionId is required.');
  }
  if (!Array.isArray(globalVideos)) {
    throw new Error('globalVideos must be an array.');
  }

  const sessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const existingGlobalVideos = normalizeGlobalVideosField(sessionData).map((video) => (
    typeof video?.toObject === 'function' ? video.toObject() : video
  ));
  const existingVideoMap = new Map(existingGlobalVideos.map((video) => [
    video?._id?.toString?.() || video?.id?.toString?.(),
    video,
  ]).filter(([id]) => Boolean(id)));
  const oldBounds = existingGlobalVideos.map(getPlainGlobalVideoBounds);
  const normalizedGlobalVideos = [];

  for (const inputVideo of globalVideos) {
    const inputId = inputVideo?._id?.toString?.() || inputVideo?.id?.toString?.();
    const existingVideo = inputId ? existingVideoMap.get(inputId) : null;
    normalizedGlobalVideos.push(await normalizePersistedGlobalVideoPayload(
      sessionData,
      inputVideo,
      existingVideo,
      {
        regenerateFrames: shouldRegenerateGlobalVideoFrames(inputVideo, existingVideo),
      }
    ));
  }

  sessionData.global_videos = normalizedGlobalVideos;
  const dirtyLayerIds = await markGlobalVideoBoundsPending(
    sessionData,
    [...oldBounds, ...normalizedGlobalVideos.map(getPlainGlobalVideoBounds)]
  );

  const savedSession = await sessionData.save();

  return {
    sessionDetails: savedSession,
    globalVideos: normalizeGlobalVideosField(savedSession),
    dirtyLayerIds,
  };
}

function roundHintSeconds(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function normalizeSessionTimelineHintPayload(hint, index, options = {}) {
  const plainHint = toPlainActiveItem(hint) || {};
  const text = (plainHint.text || plainHint.content || '').toString().replace(/\s+/g, ' ').trim();

  if (!text) {
    return null;
  }

  const minimumDuration = 1 / TRACK_EDITOR_FRAMES_PER_SECOND;
  const layerId = plainHint.layerId?.toString?.() || plainHint.layerId || null;
  const layerTimingSource = plainHint.resolveTimingFromLayer && layerId && options.layerById?.get?.(layerId);
  const startTime = layerTimingSource
    ? Math.max(0, Number(layerTimingSource.durationOffset) || 0)
    : Math.max(0, Number(plainHint.startTime ?? plainHint.start) || 0);
  const rawDuration = layerTimingSource
    ? Number(layerTimingSource.duration)
    : Number(plainHint.duration);
  const rawEndTime = layerTimingSource
    ? startTime + Math.max(minimumDuration, Number(layerTimingSource.duration) || minimumDuration)
    : Number(plainHint.endTime ?? plainHint.end);
  const endTime = Number.isFinite(rawEndTime) && rawEndTime > startTime
    ? rawEndTime
    : startTime + Math.max(minimumDuration, Number.isFinite(rawDuration) ? rawDuration : 1);
  const normalizedEndTime = Math.max(startTime + minimumDuration, endTime);
  const existingId = plainHint.id?.toString?.() || plainHint._id?.toString?.() || '';
  const {
    resolveTimingFromLayer,
    ...persistableHint
  } = plainHint;
  const normalizedHint = {
    ...persistableHint,
    id: existingId || `hint_${randomUUID() || index}`,
    text,
    startTime: roundHintSeconds(startTime),
    duration: roundHintSeconds(normalizedEndTime - startTime),
    endTime: roundHintSeconds(normalizedEndTime),
  };

  if (layerId) {
    normalizedHint.layerId = layerId;
  } else {
    delete normalizedHint.layerId;
  }

  return normalizedHint;
}

export async function updateSessionHintsForSession(userId, payload) {
  await getDBConnectionString();

  const {
    sessionId,
    hints,
  } = payload || {};

  if (!sessionId) {
    throw new Error('sessionId is required.');
  }
  if (!Array.isArray(hints)) {
    throw new Error('hints must be an array.');
  }

  const sessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const layerById = new Map(
    (Array.isArray(sessionData.layers) ? sessionData.layers : [])
      .map((layer) => [layer?._id?.toString?.() || layer?.id?.toString?.(), layer])
      .filter(([layerId]) => Boolean(layerId))
  );
  const normalizedHints = hints
    .map((hint, index) => normalizeSessionTimelineHintPayload(hint, index, { layerById }))
    .filter(Boolean)
    .sort((left, right) => left.startTime - right.startTime);

  await VideoSession.updateOne(
    { _id: sessionId },
    { $set: { timelineHints: normalizedHints } }
  );

  const savedSession = await VideoSession.findById(sessionId);
  const sessionDetails = await sanitizeStudioSessionPayload(savedSession);

  return {
    sessionDetails,
    timelineHints: sessionDetails?.timelineHints || [],
  };
}

function resolveUploadedVideoExtension(fileName = '', contentType = '') {
  const normalizedContentType = typeof contentType === 'string'
    ? contentType.split(';')[0].trim().toLowerCase()
    : '';
  const normalizedFileName = typeof fileName === 'string'
    ? fileName.trim().toLowerCase()
    : '';

  if (normalizedContentType === 'video/mp4') {
    return 'mp4';
  }
  if (normalizedContentType === 'video/quicktime') {
    return 'mov';
  }
  if (normalizedContentType === 'video/webm') {
    return 'webm';
  }
  if (normalizedContentType === 'video/x-m4v') {
    return 'm4v';
  }

  const fileExtension = path.extname(normalizedFileName).replace(/^\./, '');
  if (SUPPORTED_USER_VIDEO_EXTENSIONS.has(fileExtension)) {
    return fileExtension;
  }

  return null;
}

function isSupportedUploadedVideo({ fileName = '', contentType = '' } = {}) {
  const normalizedContentType = typeof contentType === 'string'
    ? contentType.split(';')[0].trim().toLowerCase()
    : '';

  if (normalizedContentType && SUPPORTED_USER_VIDEO_CONTENT_TYPES.has(normalizedContentType)) {
    return Boolean(resolveUploadedVideoExtension(fileName, contentType));
  }

  return Boolean(resolveUploadedVideoExtension(fileName, contentType));
}

function getUserVideoLeadingSilenceTrimSeconds(audioLayer = {}) {
  const leadingTrimSeconds = Number(audioLayer?.generationMeta?.userVideoLeadingSilenceTrimSeconds);
  return Number.isFinite(leadingTrimSeconds) && leadingTrimSeconds > 0
    ? leadingTrimSeconds
    : 0;
}

function prepareLayerActiveItemsForVideoReplacement(layer = {}) {
  if (!layer.imageSession) {
    layer.imageSession = {
      activeItemList: [],
      previousActiveItemList: null,
    };
  }

  const currentActiveItemList = Array.isArray(layer.imageSession.activeItemList)
    ? layer.imageSession.activeItemList
    : [];

  if (
    !Array.isArray(layer.imageSession.previousActiveItemList)
    || layer.imageSession.previousActiveItemList.length === 0
  ) {
    layer.imageSession.previousActiveItemList = currentActiveItemList;
  }

  // A selected video is the layer's visual base. Leaving a previous base image
  // here causes the frame worker to draw it over every extracted video frame.
  // Match generated-video replacement semantics: preserve supported text and
  // configuration items, but remove renderable images, including legacy
  // previous-scene end frames and duration-padding frames.
  layer.imageSession.activeItemList = currentActiveItemList.filter(
    (item) => item?.type === 'text' || item?.is_config_image
  );

  return layer.imageSession.activeItemList;
}

async function markUserVideoLayerUploadFailed({ sessionId, layerId, taskId, message }) {
  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (!sessionDataValue) {
    await markUserVideoUploadTaskFailed({ sessionId, layerId, taskId, message });
    return;
  }

  const layerIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === layerId
  );
  if (layerIndex === -1) {
    return;
  }

  const layer = sessionDataValue.layers[layerIndex];
  if (taskId && layer?.userVideoUploadTaskId && layer.userVideoUploadTaskId !== taskId) {
    return;
  }

  layer.userVideoGenerationPending = false;
  layer.userVideoGenerationStatus = 'FAILED';
  layer.userVideoGenerationError = message || 'Failed to process uploaded video.';
  layer.userVideoUploadTaskId = null;

  await sessionDataValue.save();
  await markUserVideoUploadTaskFailed({ sessionId, layerId, taskId, message });
}

async function finalizeUserVideoLayerUpload({
  sessionId,
  layerId,
  fileName,
  uploadedVideoPath,
  taskId = null,
}) {
  await getDBConnectionString();
  const normalizedLayerId = layerId?.toString?.() || `${layerId || ''}`.trim();

  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  const layerIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === normalizedLayerId
  );
  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  const layer = sessionDataValue.layers[layerIndex];
  if (taskId && layer?.userVideoUploadTaskId && layer.userVideoUploadTaskId !== taskId) {
    return null;
  }
  if (taskId && !layer?.userVideoGenerationPending) {
    return null;
  }

  const uploadedVideoStats = await fsPromises.stat(uploadedVideoPath);
  if (!uploadedVideoStats?.isFile() || uploadedVideoStats.size === 0) {
    throw new Error('Uploaded video payload is empty.');
  }
  if (uploadedVideoStats.size > USER_VIDEO_MAX_FILE_SIZE_BYTES) {
    throw new Error('Uploaded video must be 2 GB or smaller.');
  }

  const uploadedMetadata = await getVideoMetadata(uploadedVideoPath);
  const rawDuration = Number(uploadedMetadata?.format?.duration);
  if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
    throw new Error('Unable to read uploaded video duration.');
  }
  if (rawDuration > USER_VIDEO_MAX_DURATION_SECONDS) {
    throw new Error(`Uploaded video must be ${USER_VIDEO_MAX_DURATION_SECONDS} seconds or shorter.`);
  }

  const normalizedDuration = Math.floor(rawDuration * 100) / 100;
  const normalizedVideoPath = await normalizeVideoAssetToMp4WithoutAudio(uploadedVideoPath, {
    sessionId,
    layerId,
    prefix: 'user_video',
  });
  const {
    audioPath: extractedAudioPath,
    leadingSilenceTrimSeconds = 0,
    trailingSilenceTrimSeconds = 0,
  } = await extractAudioFromVideoIfPresent(uploadedVideoPath, {
    sessionId,
    layerId,
    prefix: 'user_video',
    preserveVideoTimeline: true,
  });

  const canvasDimensions = getCanvasDimensionsForAspectRatio(sessionDataValue.aspectRatio);
  let firstFrame = null;
  let lastFrame = null;
  try {
    const extractedFrames = await extractVideoBoundaryFrames(
      normalizedVideoPath,
      sessionId,
      layerId,
      canvasDimensions,
      {
        durationSeconds: rawDuration,
        preserveAspectRatio: true,
      }
    );
    firstFrame = extractedFrames.firstFrame;
    lastFrame = extractedFrames.lastFrame;
  } catch (error) {
    console.error('Failed to extract preview frames for uploaded user video:', error);
  } finally {
    fsExtra.remove(uploadedVideoPath).catch(() => {});
  }

  prepareLayerActiveItemsForVideoReplacement(layer);

  layer.aiVideoLayer = null;
  layer.aiVideoRemoteLink = null;
  layer.hasAiVideoLayer = false;
  layer.aiVideoGenerationPending = false;
  layer.aiVideoGenerationStatus = 'INIT';
  resetLayerVideoEditState(layer);

  layer.lipSyncVideoLayer = null;
  layer.lipSyncRemoteLink = null;
  layer.hasLipSyncVideoLayer = false;
  layer.lipSyncGenerationPending = false;
  layer.lipSyncVideoGenerationStatus = 'INIT';

  layer.soundEffectVideoLayer = null;
  layer.soundEffectRemoteLink = null;
  layer.hasSoundEffectVideoLayer = false;
  layer.soundEffectGenerationPending = false;
  layer.soundEffectVideoGenerationStatus = 'INIT';

  layer.userVideoLayer = getRelativeAssetPathFromAbsolute(normalizedVideoPath);
  layer.userVideoRemoteLink = null;
  layer.hasUserVideoLayer = true;
  layer.userVideoGenerationPending = false;
  layer.userVideoGenerationStatus = 'COMPLETED';
  layer.userVideoGenerationError = null;
  layer.userVideoUploadTaskId = null;
  layer.layerAiVideoType = 'user_video';
  layer.skipAiVideoGeneration = true;
  layer.aiVideoFrameGenerationPending = false;
  layer.initFramesGenerated = false;
  layer.frameGenerationPending = true;
  layer.duration = normalizedDuration;
  layer.frames = [];

  if (firstFrame) {
    layer.aiLayerStartFrame = getRelativeAssetPathFromAbsolute(firstFrame);
  }
  if (lastFrame) {
    layer.aiLayerEndFrame = getRelativeAssetPathFromAbsolute(lastFrame);
  }

  let updatedAudioLayers = Array.isArray(sessionDataValue.audioLayers)
    ? sessionDataValue.audioLayers.filter((audioLayer) => !(
        audioLayer?.connectedLayerId === normalizedLayerId
        && audioLayer?.generationType === 'user_video'
      ))
    : [];

  if (extractedAudioPath) {
    const audioRelativePath = (getRelativeAssetPathFromAbsolute(extractedAudioPath) || '').replace(/^\/+/, '');
    updatedAudioLayers.push(applyAudioLayerManualVolumeDefaults({
      connectedLayerId: normalizedLayerId,
      connectedLayerIndex: layerIndex,
      connectedLayerStartTimeOffset: layer.durationOffset,
      startTime: layer.durationOffset,
      endTime: layer.durationOffset + normalizedDuration,
      duration: normalizedDuration,
      sourceTrimStartTime: leadingSilenceTrimSeconds,
      originalDuration: normalizedDuration,
      generationType: 'user_video',
      generationStatus: 'COMPLETED',
      localAudioLinks: [audioRelativePath],
      selectedLocalAudioLink: audioRelativePath,
      isEnabled: true,
      isLayerLocked: true,
      defaultSelected: true,
      fadeOnEdges: false,
      volume: 100,
      prompt: fileName || 'Uploaded video audio',
      generationMeta: {
        source: 'user_video_upload',
        userVideoLeadingSilenceTrimSeconds: leadingSilenceTrimSeconds,
        userVideoTrailingSilenceTrimSeconds: trailingSilenceTrimSeconds,
      },
    }));
  }

  sessionDataValue.audioLayers = normalizeAudioLayerArrayManualVolumeSettings(updatedAudioLayers);
  for (let i = layerIndex + 1; i < sessionDataValue.layers.length; i++) {
    sessionDataValue.layers[i].frameGenerationPending = true;
  }
  const pendingFrameRefreshLayerIds = sessionDataValue.layers
    .slice(layerIndex)
    .map((sessionLayer) => sessionLayer?._id?.toString?.())
    .filter(Boolean);
  sessionDataValue.totalDuration = recalculateLayerOffsetsAndConnectedAudio(
    sessionDataValue.layers,
    sessionDataValue.audioLayers,
  );
  sessionDataValue.frameGenerationPending = true;
  if (!shouldRegenerateSubtitlesForSession(sessionDataValue)) {
    sessionDataValue.transcriptGenerationPending = false;
  }

  await deleteUnlockedFrameGenerations(sessionId, normalizedLayerId);
  await sessionDataValue.save();
  await ensureUnlockedFrameGenerations(sessionId, pendingFrameRefreshLayerIds);
  await requestRealignConnectedAudioLayersToLayers(sessionId);
  await markUserVideoUploadTaskCompleted({ sessionId, layerId, taskId });

  const updatedSession = await VideoSession.findOne({ _id: sessionId });
  const updatedLayer = updatedSession.layers.find(
    (sessionLayer) => sessionLayer._id.toString() === normalizedLayerId
  );

  return {
    session: updatedSession,
    layer: updatedLayer,
    audioLayers: updatedSession.audioLayers,
    task: serializeUserVideoUploadTask(
      await UserVideoUploadTask.findOne({ sessionId, layerId, taskId }).lean()
    ),
  };
}

function scheduleUserVideoLayerUploadTask({ sessionId, layerId, fileName, uploadedVideoPath, taskId }) {
  const start = () => {
    void finalizeUserVideoLayerUpload({
      sessionId,
      layerId,
      fileName,
      uploadedVideoPath,
      taskId,
    }).catch(async (error) => {
      const message = error?.message || 'Failed to process uploaded video.';
      console.error('[studio][user_video_upload] async task failed', {
        sessionId,
        layerId,
        taskId,
        error,
      });
      try {
        await markUserVideoLayerUploadFailed({
          sessionId,
          layerId,
          taskId,
          message,
        });
      } catch (updateError) {
        console.error('[studio][user_video_upload] failed to mark upload as FAILED', {
          sessionId,
          layerId,
          taskId,
          error: updateError,
        });
      }
      fsExtra.remove(uploadedVideoPath).catch(() => {});
    });
  };

  if (typeof setImmediate === 'function') {
    setImmediate(start);
    return;
  }

  setTimeout(start, 0);
}

async function queueUserVideoLayerUploadTask({
  userId = null,
  sessionId,
  layerId,
  fileName,
  uploadedVideoPath,
  uploadId = null,
  contentType = null,
  totalChunks = null,
  totalFileSize = null,
}) {
  await getDBConnectionString();

  if (!sessionId || !layerId) {
    throw new Error('sessionId and layerId are required.');
  }

  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  const layerIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === layerId
  );
  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  const layer = sessionDataValue.layers[layerIndex];
  if (hasAnyLayerVideoLink(layer) || layer?.hasUserVideoLayer || layer?.userVideoLayer) {
    throw new Error('This layer already has a video artefact.');
  }
  if (hasPendingLayerVideoTask(layer)) {
    throw new Error('This layer already has a pending video task.');
  }
  const activeUploadTask = await getActiveUserVideoUploadTaskForLayer(sessionId, layerId);
  if (
    activeUploadTask
    && activeUploadTask.uploadId
    && uploadId
    && activeUploadTask.uploadId !== uploadId
  ) {
    throw new Error('This layer already has a pending user video upload.');
  }

  const uploadedVideoStats = await fsPromises.stat(uploadedVideoPath);
  if (!uploadedVideoStats?.isFile() || uploadedVideoStats.size === 0) {
    throw new Error('Uploaded video payload is empty.');
  }
  if (uploadedVideoStats.size > USER_VIDEO_MAX_FILE_SIZE_BYTES) {
    throw new Error('Uploaded video must be 2 GB or smaller.');
  }

  const taskId = hat();

  layer.userVideoGenerationPending = true;
  layer.userVideoGenerationStatus = 'PENDING';
  layer.userVideoGenerationError = null;
  layer.userVideoUploadTaskId = taskId;
  layer.frameGenerationPending = true;

  await sessionDataValue.save();
  const uploadTask = await upsertUserVideoUploadTask({
    userId,
    sessionId,
    layerId,
    uploadId,
    taskId,
    status: 'PROCESSING',
    fileName,
    contentType,
    totalChunks,
    uploadedChunks: totalChunks,
    totalFileSize: uploadedVideoStats.size || totalFileSize,
    uploadedBytes: uploadedVideoStats.size,
    message: 'Upload complete. Processing video on server.',
  });

  scheduleUserVideoLayerUploadTask({
    sessionId,
    layerId,
    fileName,
    uploadedVideoPath,
    taskId,
  });

  const updatedSession = await VideoSession.findOne({ _id: sessionId });
  const updatedLayer = updatedSession.layers.find(
    (sessionLayer) => sessionLayer._id.toString() === layerId
  );

  return {
    status: 'PENDING',
    taskId,
    session: updatedSession,
    layer: updatedLayer,
    audioLayers: updatedSession.audioLayers,
    task: serializeUserVideoUploadTask(uploadTask),
  };
}

export async function startUserVideoLayerUploadTask(userId, payload) {
  const {
    sessionId,
    layerId,
    fileBuffer,
    fileName,
    contentType,
  } = payload || {};

  const uploadId = hat();

  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error('Uploaded video payload is empty.');
  }
  if (fileBuffer.length > USER_VIDEO_MAX_FILE_SIZE_BYTES) {
    throw new Error('Uploaded video must be 2 GB or smaller.');
  }
  if (!isSupportedUploadedVideo({ fileName, contentType })) {
    throw new Error('Unsupported video format. Please upload MP4, MOV, WEBM, or M4V.');
  }

  const uploadExtension = resolveUploadedVideoExtension(fileName, contentType);
  if (!uploadExtension) {
    throw new Error('Unable to determine a supported video file extension.');
  }

  const uploadedVideoPath = await saveUploadedVideoBuffer(fileBuffer, {
    sessionId,
    layerId,
    extension: uploadExtension,
    prefix: 'user_video_upload',
  });

  try {
    return await queueUserVideoLayerUploadTask({
      userId,
      sessionId,
      layerId,
      fileName,
      uploadedVideoPath,
      uploadId,
      contentType,
      totalFileSize: fileBuffer.length,
    });
  } catch (error) {
    await markUserVideoUploadTaskFailed({
      sessionId,
      layerId,
      uploadId,
      message: error?.message,
    });
    await fsExtra.remove(uploadedVideoPath).catch(() => {});
    throw error;
  }
}

export async function appendUserVideoLayerUploadChunk(userId, payload) {
  const {
    sessionId,
    layerId,
    uploadId,
    chunkIndex,
    totalChunks,
    totalFileSize,
    fileBuffer,
    fileName,
    contentType,
  } = payload || {};

  if (!sessionId || !layerId) {
    throw new Error('sessionId and layerId are required.');
  }
  if (!uploadId) {
    throw new Error('uploadId is required.');
  }
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error('Uploaded video chunk is empty.');
  }
  if (!isSupportedUploadedVideo({ fileName, contentType })) {
    throw new Error('Unsupported video format. Please upload MP4, MOV, WEBM, or M4V.');
  }

  const parsedChunkIndex = Number(chunkIndex);
  const parsedTotalChunks = Number(totalChunks);
  const parsedTotalFileSize = Number(totalFileSize);

  if (!Number.isInteger(parsedChunkIndex) || parsedChunkIndex < 0) {
    throw new Error('chunkIndex must be a non-negative integer.');
  }
  if (!Number.isInteger(parsedTotalChunks) || parsedTotalChunks <= 0) {
    throw new Error('totalChunks must be a positive integer.');
  }
  if (parsedChunkIndex >= parsedTotalChunks) {
    throw new Error('chunkIndex must be smaller than totalChunks.');
  }
  if (!Number.isFinite(parsedTotalFileSize) || parsedTotalFileSize <= 0) {
    throw new Error('totalFileSize must be a positive number.');
  }
  if (parsedTotalFileSize > USER_VIDEO_MAX_FILE_SIZE_BYTES) {
    throw new Error('Uploaded video must be 2 GB or smaller.');
  }

  const uploadExtension = resolveUploadedVideoExtension(fileName, contentType);
  if (!uploadExtension) {
    throw new Error('Unable to determine a supported video file extension.');
  }

  const activeUploadTask = await getActiveUserVideoUploadTaskForLayer(sessionId, layerId);
  if (activeUploadTask?.uploadId && activeUploadTask.uploadId !== uploadId) {
    throw new Error('This layer already has a pending user video upload.');
  }
  if (activeUploadTask?.uploadId === uploadId && activeUploadTask.status === 'PROCESSING') {
    return {
      status: 'PENDING',
      taskId: activeUploadTask.taskId || null,
      uploadId,
      complete: true,
      task: serializeUserVideoUploadTask(activeUploadTask),
    };
  }

  const uploadedVideoPath = await appendUploadedVideoChunk(fileBuffer, {
    sessionId,
    layerId,
    uploadId,
    extension: uploadExtension,
    prefix: 'user_video_upload',
    reset: parsedChunkIndex === 0,
  });

  const uploadedVideoStats = await fsPromises.stat(uploadedVideoPath);
  if (uploadedVideoStats.size > USER_VIDEO_MAX_FILE_SIZE_BYTES) {
    await markUserVideoUploadTaskFailed({
      sessionId,
      layerId,
      uploadId,
      message: 'Uploaded video must be 2 GB or smaller.',
    });
    await fsExtra.remove(uploadedVideoPath).catch(() => {});
    throw new Error('Uploaded video must be 2 GB or smaller.');
  }

  const uploadTask = await upsertUserVideoUploadTask({
    userId,
    sessionId,
    layerId,
    uploadId,
    status: 'UPLOADING',
    fileName,
    contentType,
    totalChunks: parsedTotalChunks,
    uploadedChunks: parsedChunkIndex + 1,
    totalFileSize: parsedTotalFileSize,
    uploadedBytes: uploadedVideoStats.size,
    message: parsedChunkIndex === parsedTotalChunks - 1
      ? 'Upload complete. Waiting to start processing.'
      : 'Uploading video to server.',
  });

  const isLastChunk = parsedChunkIndex === parsedTotalChunks - 1;
  if (!isLastChunk) {
    return {
      uploadId,
      chunkIndex: parsedChunkIndex,
      totalChunks: parsedTotalChunks,
      receivedBytes: uploadedVideoStats.size,
      complete: false,
      task: serializeUserVideoUploadTask(uploadTask),
    };
  }

  if (uploadedVideoStats.size !== parsedTotalFileSize) {
    await markUserVideoUploadTaskFailed({
      sessionId,
      layerId,
      uploadId,
      message: 'Uploaded video is incomplete. Please retry the upload.',
    });
    await fsExtra.remove(uploadedVideoPath).catch(() => {});
    throw new Error('Uploaded video is incomplete. Please retry the upload.');
  }

  try {
    const result = await queueUserVideoLayerUploadTask({
      userId,
      sessionId,
      layerId,
      fileName,
      uploadedVideoPath,
      uploadId,
      contentType,
      totalChunks: parsedTotalChunks,
      totalFileSize: parsedTotalFileSize,
    });

    return {
      ...result,
      uploadId,
      complete: true,
    };
  } catch (error) {
    await markUserVideoUploadTaskFailed({
      sessionId,
      layerId,
      uploadId,
      message: error?.message,
    });
    await fsExtra.remove(uploadedVideoPath).catch(() => {});
    throw error;
  }
}


const copyFile = promisify(fs.copyFile);

import VideoGeneration from "../schema/VideoGeneration.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import AIVideoLayerGeneration from "../schema/AIVideoLayerGeneration.js";

export async function deleteAllFrameGenerations(sessionId) {
  await FrameGeneration.deleteMany({ sessionId });
}

export async function deleteAllFramesForLayer(sessionId, layerId) {
  await FrameGeneration.deleteMany({ sessionId, layerId, });
}

async function deleteUnlockedFrameGenerations(sessionId, layerId) {
  await FrameGeneration.deleteMany({ sessionId, layerId, rowLocked: false });
}

async function deleteUnlockedStaleFrameGenerations(sessionId, validLayerIds = []) {
  const normalizedSessionId = sessionId?.toString?.();
  if (!normalizedSessionId) {
    return;
  }

  const normalizedLayerIds = Array.from(
    new Set(
      (Array.isArray(validLayerIds) ? validLayerIds : [])
        .map((layerId) => layerId?.toString?.() || `${layerId || ''}`.trim())
        .filter(Boolean)
    )
  );

  const deleteQuery = {
    sessionId: normalizedSessionId,
    rowLocked: false,
  };

  if (normalizedLayerIds.length > 0) {
    deleteQuery.layerId = { $nin: normalizedLayerIds };
  }

  await FrameGeneration.deleteMany(deleteQuery);
}

async function ensureUnlockedFrameGeneration(sessionId, layerId) {
  const normalizedSessionId = sessionId?.toString?.();
  const normalizedLayerId = layerId?.toString?.();

  if (!normalizedSessionId || !normalizedLayerId) {
    return null;
  }

  const existingUnlockedGeneration = await FrameGeneration.findOne({
    sessionId: normalizedSessionId,
    layerId: normalizedLayerId,
    rowLocked: false,
  })
    .select('_id')
    .lean();

  if (existingUnlockedGeneration) {
    return existingUnlockedGeneration;
  }

  return FrameGeneration.create({
    sessionId: normalizedSessionId,
    layerId: normalizedLayerId,
  });
}

async function ensureUnlockedFrameGenerations(sessionId, layerIds = []) {
  const uniqueLayerIds = Array.from(
    new Set(
      (Array.isArray(layerIds) ? layerIds : [])
        .map((layerId) => layerId?.toString?.() || `${layerId || ''}`.trim())
        .filter(Boolean)
    )
  );

  for (const layerId of uniqueLayerIds) {
    await ensureUnlockedFrameGeneration(sessionId, layerId);
  }
}

export async function createVideoSession(userId, payload) {
  await getDBConnectionString();

  const promptList = payload.prompts;
  const basicTextTheme = payload.basicTextTheme;
  const durationPerScene = payload.durationPerScene;
  const sessionMetadata = getSessionMetadataFromPayload(payload);

  let aspectRatio = payload.aspectRatio;
  if (!aspectRatio) {
    aspectRatio = '16:9';
  }

  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  const userData = await User.findOne({ _id: userId });
  const framesPerSecond = resolveFramesPerSecond(userData?.videoFramesPerSecond);

  if (promptList && promptList.length > 0) {
    if (promptList.length > 100) {
      throw new Error("Too many prompts");
    }

    let durationOffset = 0;
    const contentFilterRating = userData.contentFilterRating;
    const userCredits = userData.generationCredits;
    if (userCredits < promptList.length) {
      throw new Error("Insufficient credits");
    }

    // Create Session documents for each prompt
    const layers = promptList.map((prompt) => {
      const newSession = {
        userId,
        generations: [],
        activeSelectedImage: '',
        activeGeneratedImage: '',
        activeEditedImage: '',
        generationStatus: '',
        editStatus: '',
        witnesses: [],
        intermediates: [],
        lastWitnessSavedAt: null,
        generationError: null,
        editError: '',
        generationStatus: 'PENDING',
        prompt: prompt,
      };

      const duration = durationPerScene ? durationPerScene : 2;

      const layerPayload = {
        imageSession: newSession,
        prompt: prompt,
        status: "pending",
        duration: duration,
        durationOffset: durationOffset,
      };

      durationOffset += duration;
      // Create a frame object referencing the saved Session document
      return layerPayload;
    });

    // Create the VideoSession document
    const newVideoSession = new VideoSession({
      userId,
      promptList: promptList,
      layers,
      basicTextTheme,
      ...sessionMetadata,
      expressGenerationPending: false,
      framesPerSecond,
    });

    // Save the VideoSession document to the database
    const savedVideoSession = await newVideoSession.save({});
    const videoSessionId = savedVideoSession._id.toString();
    const vidSessionLayers = savedVideoSession.layers;

    const generationRequests = vidSessionLayers.map(async (layer) => {
      const selectedGenerationModel = 'DALLE3';
      let promptText = layer.prompt;
      if (basicTextTheme && basicTextTheme.length > 0) {
        promptText = `${promptText}`;
      }
      const generationPayload = {
        videoSessionId: videoSessionId,
        layerId: layer._id.toString(),
        prompt: promptText,
        model: selectedGenerationModel,
        userId: userId,
        aspectRatio: aspectRatio,
        contentFilterRating: contentFilterRating,
      };
      await addImageGeneratorRequest(userId, generationPayload);
    });

    await Promise.all(generationRequests);
    return savedVideoSession;
  } else {

    const newActiveItemList = [

    ]
    const newSession = {
      userId,
      generations: [],
      activeSelectedImage: '',
      activeGeneratedImage: '',
      activeEditedImage: '',
      generationStatus: '',
      editStatus: '',
      witnesses: [],
      intermediates: [],
      lastWitnessSavedAt: null,
      generationError: null,
      editError: '',
      generationStatus: 'INIT',
      prompt: '',
      activeItemList: newActiveItemList
    };

    const duration = durationPerScene ? durationPerScene : 2;

    const layerPayload = {
      imageSession: newSession,
      prompt: '',
      status: "pending",
      duration: duration,
      durationOffset: 0,
    };
    const initLayerList = [layerPayload];
    const newVideoSession = new VideoSession({
      userId,
      promptList: [],
      layers: initLayerList,
      basicTextTheme,
      ...sessionMetadata,
      defaultSceneDuration: durationPerScene,
      aspectRatio: aspectRatio,
      expressGenerationPending: false,
      framesPerSecond,
    });

    // Save the VideoSession document to the database
    const savedVideoSession = await newVideoSession.save({});
    return savedVideoSession;
  }
}

export async function getSessionDetails(payload) {

  await getDBConnectionString();
  const { userId, id } = payload;

  const videoSession = await requireVideoSessionForStudioAccess(userId, id, payload);
  return sanitizeStudioSessionPayload(videoSession, { viewerUserId: userId });
}

export async function getFrameForSession(payload) {
  await getDBConnectionString();
  const { userId, id, layer } = payload;
  const session = await Session.findOne({ _id: layer });
  return session;
}

export async function getLayerFrameDownloadForSession(userId, payload = {}) {
  await getDBConnectionString();

  const sessionId = payload.sessionId || payload.id;
  const layerId = payload.layerId || payload.layer;
  if (!sessionId || !layerId) {
    const error = new Error('Session id and layer id are required.');
    error.statusCode = 400;
    throw error;
  }

  const videoSession = await requireVideoSessionForStudioAccess(userId, sessionId, payload);
  if (!videoSession) {
    const error = new Error('Video session not found.');
    error.statusCode = 404;
    throw error;
  }

  const layer = (videoSession.layers || []).find(
    (sessionLayer) => sessionLayer?._id?.toString?.() === layerId.toString()
  );
  if (!layer) {
    const error = new Error('Layer not found.');
    error.statusCode = 404;
    throw error;
  }

  const sourceType = getLayerVideoSourceType(layer);
  if (!sourceType) {
    const error = new Error('Layer does not have a video frame source.');
    error.statusCode = 400;
    throw error;
  }

  const framesPerSecond = getSessionFramesPerSecondWithLog(
    videoSession,
    'VideoSession.getLayerFrameDownloadForSession'
  );
  const { localFrameIndex, sourceFrameIndex } = getLayerDownloadFrameIndex({
    layer,
    framesPerSecond,
    timestamp: payload.timestamp,
    frame: payload.frame,
  });
  const absolutePath = resolveLayerFrameDownloadPath({
    sessionId,
    layerId,
    layer,
    localFrameIndex,
    sourceFrameIndex,
  });

  if (!absolutePath) {
    const error = new Error('Frame image not found for this layer timestamp.');
    error.statusCode = 404;
    throw error;
  }

  return {
    absolutePath,
    fileName: `scene-layer-${layerId}-frame-${localFrameIndex}.png`,
    frameIndex: localFrameIndex,
    sourceFrameIndex,
    framesPerSecond,
    sourceType,
  };
}


export async function requestGuestVideoGeneration(sessionId, renderOptions = {}) {
  await getDBConnectionString();

  const videoSession = await VideoSession.findOne({ _id: sessionId, isGuestSession: true });


  if (!videoSession) {
    throw new Error('Video session not found');
  }

  reconcileOrphanedLipSyncGenerationState(videoSession);

  const requestedSceneTransitionPreset = normalizeSceneTransitionPreset(
    renderOptions?.sceneTransitionPreset ?? videoSession.sceneTransitionPreset
  );
  const previousApplyAudioDucking = videoSession.applyAudioDucking;
  const hasApplyAudioDuckingOption = typeof renderOptions?.applyAudioDucking === 'boolean';
  videoSession.sceneTransitionPreset = requestedSceneTransitionPreset;

  if (hasApplyAudioDuckingOption) {
    videoSession.applyAudioDucking = renderOptions.applyAudioDucking;
  }


  if (shouldRefreshFramesForSceneTransitionPreset(videoSession, requestedSceneTransitionPreset)) {
    markAllSessionLayersPendingForFrameGeneration(videoSession);
  }

  const customSpeechTimelineExtension = extendSessionTimelineToCustomSpeechEnd(videoSession);
  if (customSpeechTimelineExtension.extended) {
  }

  const pendingFrameRefreshLayerIds = videoSession.layers
    .filter((layer) => layer?.frameGenerationPending)
    .map((layer) => layer?._id?.toString?.())
    .filter(Boolean);
  await deleteUnlockedStaleFrameGenerations(sessionId, pendingFrameRefreshLayerIds);

  const sessionLayers = [];

  let sessionFrameGenerationPending = false;
  for (let i = 0; i < videoSession.layers.length; i++) {
    let layer = videoSession.layers[i];

    if (layer.frameGenerationPending) {
      sessionFrameGenerationPending = true;
      let frameGenerationExists = await FrameGeneration.findOne({ sessionId: sessionId, layerId: layer._id.toString() });
      if (!frameGenerationExists) {
        const frameGenerationPayload = new FrameGeneration({
          sessionId: sessionId,
          layerId: layer._id.toString(),
        });
        await frameGenerationPayload.save();
        layer.frames = [];
      }
    }
    // Always push the layer into sessionLayers
    sessionLayers.push(layer);
  }

  await VideoSession.updateOne(
    { _id: sessionId },
    { $set: { layers: sessionLayers, frameGenerationPending: sessionFrameGenerationPending } },
    { new: true }
  );


  let audioGenerationPending = false;

  let totalDuration = 0;
  for (let i = 0; i < videoSession.layers.length; i++) {
    totalDuration += videoSession.layers[i].duration;
  }

  for (let i = 0; i < videoSession.audioLayers.length; i++) {
    if (videoSession.audioLayers[i].isEnabled) {
      const currentAudioLayer = videoSession.audioLayers[i];
      if (!currentAudioLayer.selectedLocalAudioLink) {
        let audioDuration = currentAudioLayer.duration;
        let effAudioDuration = totalDuration - currentAudioLayer.startTime;
        if (effAudioDuration < audioDuration) {
          audioDuration = effAudioDuration;
          videoSession.audioLayers[i].duration = audioDuration;
          audioGenerationPending = true;
        }
      }
    }
  }

  // Proceed with the current logic if no pending FrameGeneration request exists
  videoSession.videoGenerationPending = true;
  if (!videoSession.isExpressGeneration) {
    videoSession.expressGenerationPending = false;
  }
  videoSession.expressGenerationPaused = false;
  videoSession.generationError = null;
  videoSession.expressGenerationFailed = false;
  videoSession.expressGenerationCancelled = false;
  videoSession.expressGenerationError = null;
  if (!shouldRegenerateSubtitlesForSession(videoSession)) {
    videoSession.transcriptGenerationPending = false;
  }
  const previousVideoLink = videoSession.videoLink;

  if (previousVideoLink) {
    for (const previousVideoLocalLink of getProcessorAssetPathCandidates(previousVideoLink)) {
      try {
        if (fs.existsSync(previousVideoLocalLink)) {
          fs.unlinkSync(previousVideoLocalLink);
        }
      } catch (err) {
        console.error(`Error deleting file ${previousVideoLocalLink}:`, err);
        // Handle error accordingly
      }
    }
  }

  videoSession.videoLink = null;
  videoSession.remoteURL = null;

  await videoSession.save();

  // Delete all VideoGeneration requests with sessionId
  await VideoGeneration.deleteMany({ videoSessionId: sessionId });


  const videoGenerationPayload = new VideoGeneration({
    videoSessionId: sessionId,
    isPremium: false,
  });

  const newVideoGenerationRow = await videoGenerationPayload.save();

  return newVideoGenerationRow;
}


export async function requestVideoGeneration(userId, sessionId, renderOptions = {}) {
  await getDBConnectionString();

  const videoSession = await requireVideoSessionForStudioAccess(userId, sessionId, renderOptions, {
    markEdited: true,
  });

  reconcileOrphanedLipSyncGenerationState(videoSession);

  const requestedSceneTransitionPreset = normalizeSceneTransitionPreset(
    renderOptions?.sceneTransitionPreset ?? videoSession.sceneTransitionPreset
  );
  const previousApplyAudioDucking = videoSession.applyAudioDucking;
  const hasApplyAudioDuckingOption = typeof renderOptions?.applyAudioDucking === 'boolean';
  videoSession.sceneTransitionPreset = requestedSceneTransitionPreset;

  if (hasApplyAudioDuckingOption) {
    videoSession.applyAudioDucking = renderOptions.applyAudioDucking;
  }


  if (shouldRefreshFramesForSceneTransitionPreset(videoSession, requestedSceneTransitionPreset)) {
    markAllSessionLayersPendingForFrameGeneration(videoSession);
  }

  const customSpeechTimelineExtension = extendSessionTimelineToCustomSpeechEnd(videoSession);
  if (customSpeechTimelineExtension.extended) {
  }

  const pendingFrameRefreshLayerIds = videoSession.layers
    .filter((layer) => layer?.frameGenerationPending)
    .map((layer) => layer?._id?.toString?.())
    .filter(Boolean);
  await deleteUnlockedStaleFrameGenerations(sessionId, pendingFrameRefreshLayerIds);

  const sessionLayers = [];

  let sessionFrameGenerationPending = false;
  for (let i = 0; i < videoSession.layers.length; i++) {
    let layer = videoSession.layers[i];

    if (layer.frameGenerationPending) {
      sessionFrameGenerationPending = true;
      let frameGenerationExists = await FrameGeneration.findOne({ sessionId: sessionId, layerId: layer._id.toString() });
      if (!frameGenerationExists) {
        const frameGenerationPayload = new FrameGeneration({
          sessionId: sessionId,
          layerId: layer._id.toString(),
        });
        await frameGenerationPayload.save();
        layer.frames = [];
      }
    }
    // Always push the layer into sessionLayers
    sessionLayers.push(layer);
  }

  await VideoSession.updateOne(
    { _id: sessionId },
    { $set: { layers: sessionLayers, frameGenerationPending: sessionFrameGenerationPending } },
    { new: true }
  );

  const userData = await User.findOne({ _id: userId });

  if (!userData) {
    throw new Error('User not found');
  }

  let notifyOnCompletion = false;
  if (userData.isPremiumUser && userData.selectedNotifyOnCompletion && sessionFrameGenerationPending) {
    notifyOnCompletion = true;
  }


  let audioGenerationPending = false;

  let totalDuration = 0;
  for (let i = 0; i < videoSession.layers.length; i++) {
    totalDuration += videoSession.layers[i].duration;
  }

  for (let i = 0; i < videoSession.audioLayers.length; i++) {
    if (videoSession.audioLayers[i].isEnabled) {
      const currentAudioLayer = videoSession.audioLayers[i];
      if (!currentAudioLayer.selectedLocalAudioLink) {
        let audioDuration = currentAudioLayer.duration;
        let effAudioDuration = totalDuration - currentAudioLayer.startTime;
        if (effAudioDuration < audioDuration) {
          audioDuration = effAudioDuration;
          videoSession.audioLayers[i].duration = audioDuration;
          audioGenerationPending = true;
        }
      }
    }
  }

  // Proceed with the current logic if no pending FrameGeneration request exists
  videoSession.videoGenerationPending = true;
  if (!videoSession.isExpressGeneration) {
    videoSession.expressGenerationPending = false;
  }
  videoSession.generationError = null;
  videoSession.expressGenerationFailed = false;
  videoSession.expressGenerationCancelled = false;
  videoSession.expressGenerationError = null;
  if (!shouldRegenerateSubtitlesForSession(videoSession)) {
    videoSession.transcriptGenerationPending = false;
  }
  const previousVideoLink = videoSession.videoLink;

  if (previousVideoLink) {
    for (const previousVideoLocalLink of getProcessorAssetPathCandidates(previousVideoLink)) {
      try {
        if (fs.existsSync(previousVideoLocalLink)) {
          fs.unlinkSync(previousVideoLocalLink);
        }
      } catch (err) {
        console.error(`Error deleting file ${previousVideoLocalLink}:`, err);
        // Handle error accordingly
      }
    }
  }

  videoSession.videoLink = null;
  videoSession.remoteURL = null;
  if (notifyOnCompletion) {
    videoSession.notifyOnCompletion = true;
    videoSession.notificationEmail = userData.email;
    videoSession.notificationSent = false;
  }
  await videoSession.save();

  // Delete all VideoGeneration requests with sessionId
  await VideoGeneration.deleteMany({ videoSessionId: sessionId });

  const isPremiumUser = userData.isPremiumUser || userData.isPartnerUser;

  const videoGenerationPayload = new VideoGeneration({
    videoSessionId: sessionId,
    isPremium: isPremiumUser,
  });

  const newVideoGenerationRow = await videoGenerationPayload.save();

  return newVideoGenerationRow;
}

const EXPRESS_PIPELINE_RESTART_CHECKPOINTS = Object.freeze({
  AFTER_IMAGES: 'after_images',
  AFTER_AI_VIDEO: 'after_ai_video',
  AFTER_FRAMES: 'after_frames',
});

function normalizeExpressPipelineRestartCheckpoint(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return Object.values(EXPRESS_PIPELINE_RESTART_CHECKPOINTS).includes(normalized)
    ? normalized
    : null;
}

async function removeExistingSessionVideoOutput(videoSession) {
  if (!videoSession?.videoLink) {
    return;
  }

  const currentVideoLink = `${videoSession.videoLink}`.trim();
  if (!currentVideoLink) {
    videoSession.videoLink = null;
    return;
  }

  const absoluteVideoPath = resolveProcessorAssetAbsolutePath(currentVideoLink);
  try {
    await fsPromises.unlink(absoluteVideoPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`Error deleting file ${absoluteVideoPath}:`, error);
    }
  }

  videoSession.videoLink = null;
}

function resetExpressRenderLayerVideoState(layer) {
  if (!layer || typeof layer !== 'object') {
    return;
  }

  layer.aiVideoLayer = null;
  layer.aiVideoRemoteLink = null;
  layer.hasAiVideoLayer = false;
  layer.aiVideoGenerationPending = false;
  layer.aiVideoGenerationStatus = 'INIT';

  layer.lipSyncVideoLayer = null;
  layer.lipSyncRemoteLink = null;
  layer.hasLipSyncVideoLayer = false;
  layer.lipSyncGenerationPending = false;
  layer.lipSyncVideoGenerationStatus = 'INIT';

  layer.soundEffectVideoLayer = null;
  layer.soundEffectRemoteLink = null;
  layer.hasSoundEffectVideoLayer = false;
  layer.soundEffectGenerationPending = false;
  layer.soundEffectVideoGenerationStatus = 'INIT';

  layer.aiVideoFrameGenerationPending = false;
  layer.initFramesGenerated = false;
  layer.frames = [];

  if (layer?.imageSession?.previousActiveItemList?.length > 0) {
    layer.imageSession.activeItemList = layer.imageSession.previousActiveItemList;
    layer.imageSession.previousActiveItemList = null;
  }
}

export async function restartExpressPipelineFromCheckpoint(userId, payload = {}) {
  await getDBConnectionString();

  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
  const checkpoint = normalizeExpressPipelineRestartCheckpoint(payload?.checkpoint);

  if (!sessionId) {
    throw new Error('Session id is required.');
  }
  if (!checkpoint) {
    throw new Error('Invalid express pipeline restart checkpoint.');
  }

  const videoSession = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!videoSession) {
    throw new Error('Video session not found');
  }
  if (!videoSession.isExpressGeneration) {
    throw new Error('Checkpoint restart is only supported for express sessions.');
  }
  if (videoSession.expressGenerationPending || videoSession.videoGenerationPending) {
    throw new Error('Cannot restart an express pipeline while a render is already pending.');
  }
  if (!videoSession.videoLink) {
    throw new Error('Only completed video renders can be restarted from a checkpoint.');
  }

  await Promise.all([
    FrameGeneration.deleteMany({ sessionId }),
    VideoGeneration.deleteMany({ videoSessionId: sessionId }),
    AIVideoLayerGeneration.deleteMany({ sessionId }),
  ]);

  if (checkpoint !== EXPRESS_PIPELINE_RESTART_CHECKPOINTS.AFTER_FRAMES) {
    const framesPath = path.join(resolveProcessorAssetsRoot(), 'video', 'frames', sessionId);
    await verifyAndDelete(framesPath);
  }

  await removeExistingSessionVideoOutput(videoSession);

  const nextExpressGenerationStatus = {
    ...(videoSession.expressGenerationStatus || {}),
    status: 'PENDING',
    video_generation: 'INIT',
  };

  videoSession.expressGenerationPending = true;
  videoSession.expressGenerationPaused = false;
  videoSession.expressGenerationCancelled = false;
  videoSession.expressGenerationFailed = false;
  videoSession.expressGenerationError = null;
  videoSession.videoGenerationPending = false;
  videoSession.notifyOnCompletion = false;
  videoSession.notificationSent = false;

  if (checkpoint === EXPRESS_PIPELINE_RESTART_CHECKPOINTS.AFTER_IMAGES) {
    nextExpressGenerationStatus.ai_video_generation = 'INIT';
    nextExpressGenerationStatus.lip_sync_generation = 'INIT';
    nextExpressGenerationStatus.sound_effect_generation = 'INIT';
    nextExpressGenerationStatus.delete_reflow = 'INIT';
    nextExpressGenerationStatus.timeline_reflowed = 'INIT';
    nextExpressGenerationStatus.transcript_generation = 'INIT';
    nextExpressGenerationStatus.frame_generation = 'INIT';

    videoSession.aiVideoGenerationPending = false;
    videoSession.lipSyncGenerationPending = false;
    videoSession.soundEffectGenerationPending = false;
    videoSession.transcriptGenerationPending = videoSession.enableSubtitles !== false;
    videoSession.frameGenerationPending = false;

    for (const layer of videoSession.layers || []) {
      resetExpressRenderLayerVideoState(layer);
      layer.frameGenerationPending = false;
    }
  } else if (checkpoint === EXPRESS_PIPELINE_RESTART_CHECKPOINTS.AFTER_AI_VIDEO) {
    nextExpressGenerationStatus.delete_reflow = 'INIT';
    nextExpressGenerationStatus.timeline_reflowed = 'INIT';
    nextExpressGenerationStatus.transcript_generation = 'INIT';
    nextExpressGenerationStatus.frame_generation = 'INIT';

    videoSession.transcriptGenerationPending = videoSession.enableSubtitles !== false;
    videoSession.frameGenerationPending = false;

    for (const layer of videoSession.layers || []) {
      layer.frameGenerationPending = true;
      layer.frames = [];
      layer.initFramesGenerated = false;
    }
  } else if (checkpoint === EXPRESS_PIPELINE_RESTART_CHECKPOINTS.AFTER_FRAMES) {
    videoSession.transcriptGenerationPending = false;
    videoSession.frameGenerationPending = false;
  }

  videoSession.expressGenerationStatus = nextExpressGenerationStatus;
  await videoSession.save();

  return videoSession;
}

// is this even needed anymore?
export async function refreshFramesForSession(id) {


  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ _id: id }).populate({
    path: 'layers.imageSession',
    model: 'Session' // Ensure the correct model is referenced
  });

  if (!videoSession) {
    throw new Error("Video session not found");
  }


  const refreshFrameResponse = setSessionLayerFrames(videoSession);

  if (!refreshFrameResponse) {
    return;
  }
  const newFrames = refreshFrameResponse.frames;
  if (newFrames) {
    videoSession.frames = newFrames;
    const vidSessionResponse = await videoSession.save({});
    return vidSessionResponse;
  }
}





export async function extractFramesFromAiVideoLayer(sessionId, layerId, options = {}) {


  // Connect to DB
  await getDBConnectionString();

  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (!sessionDataValue) return;

  const layerIndex = sessionDataValue.layers.findIndex(layer => layer._id.toString() === layerId);
  if (layerIndex === -1) return;

  // Set aiVideoFrameGenerationPending = true before starting
  sessionDataValue.layers[layerIndex].aiVideoFrameGenerationPending = true;
  await sessionDataValue.save();

  try {
    const layer = sessionDataValue.layers[layerIndex];
    const skipDurationPadding = Boolean(options?.skipDurationPadding);
    const aiVideoLink = getLayerPreferredVideoLink(layer);


    if (!aiVideoLink) {
      return;
    }

    const requestedDuration = layer.duration;
    const aspectRatio = sessionDataValue.aspectRatio || '1:1';
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
    const videoPath = resolveProcessorAssetAbsolutePath(aiVideoLink);

    const framesPerSecondOverride = resolveFramesPerSecondOverride(options?.framesPerSecondOverride);
    const framesPerSecond = framesPerSecondOverride ?? getSessionFramesPerSecondWithLog(
      sessionDataValue,
      'VideoSession.processLayerVideoFrames'
    );
    const framesSubDir = getPreferredLayerFramesSubDir(layer);
    const { firstFrame, lastFrame, duration } = await processVideoAsFrames(
      videoPath,
      sessionId,
      layerId,
      canvasDimensions,
      framesPerSecond,
      {
        framesSubDir,
        forceFramesPerSecond: framesPerSecondOverride ?? undefined,
        preserveAspectRatio: Boolean(layer?.hasUserVideoLayer || layer?.userVideoLayer || layer?.layerAiVideoType === 'user_video'),
      }
    );



    const lastFrameRelativePath = getRelativeAssetPathFromAbsolute(lastFrame) || lastFrame;
    const firstFrameRelativePath = getRelativeAssetPathFromAbsolute(firstFrame) || firstFrame;
    
    // Update the layer with the first and last frame paths

    // Reload session for updating
    let updatedSession = await VideoSession.findOne({ _id: sessionId });
    const updLayerIndex = updatedSession.layers.findIndex(layer => layer._id.toString() === layerId);


    if (updLayerIndex !== -1) {
      updatedSession.layers[updLayerIndex].aiLayerStartFrame = firstFrameRelativePath;
      updatedSession.layers[updLayerIndex].aiLayerEndFrame = lastFrameRelativePath;
    }


    if (!skipDurationPadding && requestedDuration > duration) {
      // Add last frame as an active item if needed
      const totalFramesInVideo = Math.round(duration * framesPerSecond);
      const frameOffset = totalFramesInVideo;
      const frameDuration = Math.round((requestedDuration - duration) * framesPerSecond);




      if (updLayerIndex !== -1) {
        if (!updatedSession.layers[updLayerIndex].imageSession.activeItemList) {
          updatedSession.layers[updLayerIndex].imageSession.activeItemList = [];
        }

        const activeItemList = updatedSession.layers[updLayerIndex].imageSession.activeItemList;

        // Find the highest item ID number and increment it
        const maxIdNumber = activeItemList.reduce((max, item) => {
          const match = item.id && item.id.match(/item_(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            return num > max ? num : max;
          }
          return max;
        }, -1);
        const newItemId = `item_${maxIdNumber + 1}`;

        const newImageItem = {
          type: 'image',
          src: '/' + lastFrameRelativePath.replace(/\\/g, '/'),
          x: 0,
          y: 0,
          width: canvasDimensions.width,
          height: canvasDimensions.height,
          id: newItemId,
          isAiVideoPaddingFrame: true,
          config: {
            frameRate: framesPerSecond,
            isAiVideoPaddingFrame: true,
            frameDuration: frameDuration,
            frameOffset: frameOffset,
          },
          animations: [],
        };

        updatedSession.layers[updLayerIndex].imageSession.activeItemList.push(newImageItem);
        updatedSession.layers[updLayerIndex].frameGenerationPending = true;

      }
    }


    await updatedSession.save();


  } catch (error) {
    console.error("Error extracting frames from layer video:", error);
  } finally {
    // Set aiVideoFrameGenerationPending = false after finishing
    const finalSessionData = await VideoSession.findOne({ _id: sessionId });
    const fLayerIndex = finalSessionData.layers.findIndex(layer => layer._id.toString() === layerId);
    if (fLayerIndex !== -1) {
      finalSessionData.layers[fLayerIndex].aiVideoFrameGenerationPending = false;
      await finalSessionData.save();
    }
  }
}






async function verifyAndDelete(framesPath) {
  try {
    const files = await fsExtra.readdir(framesPath);

    if (files.length === 0) {
      await fsExtra.remove(framesPath);
    } else {
      // Optionally, delete files first
      await fsExtra.emptyDir(framesPath);
      await fsExtra.remove(framesPath);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    console.error(`Error verifying/deleting frames folder:`, error);
  }
}



export async function regenerateFramesForSession(id, resetDurations = false, options = {}) {
  await getDBConnectionString();
  const videoSession = await VideoSession.findById(id);
  if (!videoSession) {
    throw new Error("Video session not found");
  }

  await VideoSession.updateOne(
    { _id: id },
    {
      $set: {
        videoGenerationPending: false,
        expressGenerationPending: false,
      }
    }
  );

  // Delete existing FrameGenerations for the session
  await FrameGeneration.deleteMany({ sessionId: id });

  // Delete frames folder from both new and legacy local storage roots.
  for (const assetsRoot of getProcessorAssetsRootCandidates()) {
    await verifyAndDelete(path.join(assetsRoot, 'video', 'frames', id));
  }


  let layers = videoSession.layers || [];
  let audioLayers = videoSession.audioLayers || [];
  const framesPerSecondOverride = resolveFramesPerSecondOverride(options?.framesPerSecondOverride);
  const preferFrameBasedDurations = Boolean(options?.preferFrameBasedDurations);
  const skipDurationPadding = Boolean(options?.skipDurationPadding);
  const prepareAiVideoFrames = options?.prepareAiVideoFrames !== false;
  const setSessionFrameGenerationPending = options?.setSessionFrameGenerationPending !== false;
  const framesPerSecond = framesPerSecondOverride ?? getSessionFramesPerSecondWithLog(
    videoSession,
    'VideoSession.regenerateFramesForSession',
  );

  if (resetDurations && preferFrameBasedDurations) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const hasAnyVideo = hasAnyLayerVideoLink(layer);
      if (!hasAnyVideo) {
        continue;
      }
      await extractFramesFromAiVideoLayer(id, layer._id.toString(), {
        framesPerSecondOverride: framesPerSecondOverride ?? undefined,
        skipDurationPadding: true,
      });
    }
  }

  if (resetDurations) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const hasAnyVideo = hasAnyLayerVideoLink(layer);
      if (!hasAnyVideo) {
        continue;
      }

      const normalizedDuration = await resolveLayerDurationForRealign({
        sessionId: id,
        layerId: layer._id.toString(),
        layer,
        framesPerSecond,
        preferFrameBasedDurations,
      });

      if (Number.isFinite(normalizedDuration) && normalizedDuration > 0) {
        layer.duration = normalizedDuration;
      }
    }
  }

  for (let i = 0; i < layers.length; i++) {
    layers[i].frameGenerationPending = true;
  }
  const durationOffset = recalculateLayerOffsetsAndConnectedAudio(layers, audioLayers);

  videoSession.layers = layers;
  videoSession.audioLayers = audioLayers;
  videoSession.totalDuration = durationOffset;
  videoSession.frameGenerationPending = setSessionFrameGenerationPending;
  videoSession.videoGenerationPending = false;
  videoSession.expressGenerationPending = false;
  await videoSession.save();

  if (prepareAiVideoFrames && !(resetDurations && preferFrameBasedDurations)) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (hasAnyLayerVideoLink(layer)) {
        await extractFramesFromAiVideoLayer(id, layer._id.toString(), {
          framesPerSecondOverride: framesPerSecondOverride ?? undefined,
          skipDurationPadding,
        });
      }
    }
  }

  // Regenerate FrameGenerations for layers
  for (const layer of layers) {
    const frameGenerationPayload = new FrameGeneration({
      sessionId: id,
      layerId: layer._id.toString(),
    });
    await frameGenerationPayload.save();

    // Update frameGenerationPending for the layer
    await VideoSession.updateOne(
      { _id: id, 'layers._id': layer._id },
      {
        $set: {
          'layers.$.frameGenerationPending': true,
        },
      }
    );
  }

  // Finally, set frameGenerationPending on the videoSession
  await VideoSession.updateOne(
    { _id: id },
    {
      $set: {
        frameGenerationPending: setSessionFrameGenerationPending,
      },
    }
  );

  // Get and return the updated videoSession
  const vidSessionResponse = await VideoSession.findById(id);
  return vidSessionResponse;
}


export async function updatePendingFramesForSession(id) {
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ _id: id }).populate({
    path: 'layers.imageSession',
    model: 'Session' // Ensure the correct model is referenced
  });

  if (!videoSession) {
    throw new Error("Video session not found");
  }

  const layersPayload = videoSession.layers.map((layer) => {
    return {
      duration: layer.duration,
      image: layer.imageSession.activeSelectedImage,
      imageSession: layer.imageSession._id.toString()
    }
  });

  const currentFrames = videoSession.frames;
  const framesPerSecond = getSessionFramesPerSecondWithLog(
    videoSession,
    'VideoSession.updatePendingFramesForSession'
  );
  const updatedFrames = updatePendingFramesFromLayers(layersPayload, currentFrames, framesPerSecond);
  if (updatedFrames) {
    videoSession.frames = updatedFrames;
    const vidSessionResponse = await videoSession.save();
    return vidSessionResponse;
  }
}

export async function addAudioToSession(id, dataURL) {
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ _id: id });
  const audioFileName = `audio_${id}.mp3`;
  const audioFileBasePath = path.join(resolveProcessorAssetsRoot(), 'video', 'audio', id.toString());
  const audioFilesPath = path.join(audioFileBasePath, audioFileName);
  
  if (!fs.existsSync(audioFileBasePath)) {
    fs.mkdirSync(audioFileBasePath, { recursive: true });
  }

  const audioData = dataURL.replace(/^data:audio\/mp3;base64,/, "");
  fs.writeFileSync(audioFilesPath, audioData, 'base64');
  videoSession.audio = path.posix.join('assets_v2', 'video', 'audio', id.toString(), audioFileName);
  const vidSessionResponse = await videoSession.save();
  return vidSessionResponse;
}

export async function updateFramesForLayer(payload) {
  const { layer, sessionId } = payload;
  await getDBConnectionString();
  let { _id, duration, imageSession } = layer;
  const session = await VideoSession.findOne({ _id: sessionId });
  if (!session) {
    throw new Error("Session not found");
  }
  const layers = session.layers;
  const currentLayer = layers.find((layer) => layer._id.toString() === _id.toString());
  if (!imageSession || !imageSession.activeItemList) {
    return;
  }
  if (!currentLayer) {
    return;
  }
  currentLayer.imageSession.activeItemList = imageSession.activeItemList;
  await session.save({});
  const framesPerSecond = getSessionFramesPerSecondWithLog(
    session,
    'VideoSession.updateFramesForLayer'
  );
  const layerFrameStartIndex = getLayerFrameStartIndex(layers, layer, framesPerSecond);
  try {
    createCanvasFromLayer(layer, sessionId, 0, framesPerSecond);
  } catch (error) {
    console.error(error);
  }
}

export async function refreshLayersForSession(sessionId) {
  await getDBConnectionString();
  const session = await VideoSession.findOne({ _id: sessionId }).populate({
    path: 'layers.imageSession',
    model: 'Session' // Ensure the correct model is referenced
  });
  if (!session) {
    throw new Error("Session not found");
  }
  return sanitizeStudioSessionPayload(session);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function toPlainActiveItem(item) {
  if (item == null) {
    return item;
  }

  if (typeof item?.toObject === 'function') {
    return item.toObject();
  }

  if (typeof item === 'object') {
    return JSON.parse(JSON.stringify(item));
  }

  return item;
}

async function sanitizeStudioSessionPayload(session, options = {}) {
  if (!session) {
    return session;
  }

  const sessionPayload = toPlainActiveItem(session);
  const sessionId = sessionPayload?._id?.toString?.();
  const viewerUserId = toUserIdString(options.viewerUserId);
  const ownerUserId = toUserIdString(sessionPayload?.userId);
  const isSessionOwnerForViewer = Boolean(viewerUserId && ownerUserId && viewerUserId === ownerUserId);
  const isImportedSessionForViewer = Boolean(
    viewerUserId &&
    ownerUserId &&
    viewerUserId !== ownerUserId &&
    sessionPayload.editableShareEnabled === true &&
    hasImportedEditableSession(sessionPayload, viewerUserId)
  );

  if (!sessionId) {
    return sessionPayload;
  }

  const shouldRecoverGeneratedAiVideoUrls = Array.isArray(sessionPayload.layers) &&
    sessionPayload.layers.some((layer) => (
      Boolean(layer?.aiVideoLayer) &&
      !getFirstNonEmptyString(layer?.aiVideoRemoteLink)
    ));

  const [pendingFrameGenerations, activeUserVideoUploadTasks, generatedAiVideos] = await Promise.all([
    FrameGeneration.find({ sessionId })
      .select('layerId')
      .lean(),
    UserVideoUploadTask.find({
      sessionId,
      status: { $in: Array.from(ACTIVE_USER_VIDEO_UPLOAD_TASK_STATUSES) },
    })
      .sort({ updatedAt: -1 })
      .lean(),
    shouldRecoverGeneratedAiVideoUrls
      ? GeneratedAIVideo.find({ sessionId })
        .select('layerId remoteUrl remoteURL remote_url createdAt')
        .sort({ createdAt: -1 })
        .lean()
      : Promise.resolve([]),
  ]);
  const pendingLayerIds = new Set(
    pendingFrameGenerations
      .map((generation) => generation?.layerId?.toString?.())
      .filter(Boolean)
  );
  const activeUserVideoUploadTaskMap = new Map();
  for (const task of activeUserVideoUploadTasks) {
    const taskLayerId = task?.layerId?.toString?.();
    if (!taskLayerId || activeUserVideoUploadTaskMap.has(taskLayerId)) {
      continue;
    }
    activeUserVideoUploadTaskMap.set(taskLayerId, serializeUserVideoUploadTask(task));
  }
  const generatedAiVideoByLayerId = new Map();
  for (const generatedAiVideo of generatedAiVideos) {
    const generatedLayerId = generatedAiVideo?.layerId?.toString?.() || generatedAiVideo?.layerId;
    if (!generatedLayerId || generatedAiVideoByLayerId.has(generatedLayerId)) {
      continue;
    }
    generatedAiVideoByLayerId.set(generatedLayerId, generatedAiVideo);
  }

  const sanitizedLayers = Array.isArray(sessionPayload.layers)
    ? sessionPayload.layers.map((layer) => {
      const layerId = layer?._id?.toString?.();
      const imageSession = layer?.imageSession && typeof layer.imageSession === 'object'
        ? {
          ...layer.imageSession,
          activeItemList: hydrateStudioActiveItemListForResponse(layer, sessionPayload),
        }
        : layer?.imageSession;
      const sanitizedLayer = {
        ...sanitizeStudioLayerVideoUrlsForResponse(layer),
        imageSession,
        userVideoUploadTask: activeUserVideoUploadTaskMap.get(layerId) || null,
        frameGenerationPending: Boolean(
          layer?.frameGenerationPending && pendingLayerIds.has(layerId)
        ),
      };
      delete sanitizedLayer.frames;
      return sanitizedLayer;
    })
    : [];

  const sanitizedPayload = {
    ...sessionPayload,
    layers: sanitizedLayers,
    frameGenerationPending: sanitizedLayers.some((layer) => layer?.frameGenerationPending),
    expressGenerationPending: Boolean(
      sessionPayload.isExpressGeneration && sessionPayload.expressGenerationPending
    ),
    expressGenerationPaused: Boolean(
      sessionPayload.isExpressGeneration && sessionPayload.expressGenerationPaused
    ),
    sessionOwnerId: ownerUserId,
    isSessionOwner: isSessionOwnerForViewer,
    isImportedSession: isImportedSessionForViewer,
  };

  const responsePayload = isSessionOwnerForViewer
    ? hydrateStudioSessionMediaForResponse(sanitizedPayload, { generatedAiVideoByLayerId })
    : sanitizedPayload;

  delete responsePayload.editableShareCollaborators;
  delete responsePayload.editableShareImportedUserIds;
  if (!isSessionOwnerForViewer) {
    delete responsePayload.shareEnabled;
    delete responsePayload.shareToken;
    delete responsePayload.shareCreatedAt;
    delete responsePayload.shareLastViewedAt;
    delete responsePayload.editableShareEnabled;
    delete responsePayload.editableShareToken;
    delete responsePayload.editableShareCreatedAt;
    delete responsePayload.editableShareLastViewedAt;
    delete responsePayload.editableShareLastEditedAt;
  }

  return responsePayload;
}

async function sanitizePublicStudioSessionPayload(session) {
  const sessionPayload = await sanitizeStudioSessionPayload(session);
  if (!sessionPayload || typeof sessionPayload !== 'object') {
    return sessionPayload;
  }

  const publicPayload = {
    ...sessionPayload,
    isReadOnlyShare: true,
  };

  delete publicPayload.userId;
  delete publicPayload.sessionOwnerId;
  delete publicPayload.isSessionOwner;
  delete publicPayload.isImportedSession;
  delete publicPayload.shareEnabled;
  delete publicPayload.shareToken;
  delete publicPayload.shareCreatedAt;
  delete publicPayload.shareLastViewedAt;
  publicPayload.ogImageUrl = publicPayload.shareOgImageUrl || null;
  publicPayload.og_image_url = publicPayload.shareOgImageUrl || null;
  delete publicPayload.shareOgImageUrl;
  delete publicPayload.shareOgImagePath;
  delete publicPayload.shareOgImageSource;
  delete publicPayload.shareOgImageCreatedAt;
  delete publicPayload.shareOgImageUpdatedAt;
  delete publicPayload.editableShareEnabled;
  delete publicPayload.editableShareToken;
  delete publicPayload.editableShareCreatedAt;
  delete publicPayload.editableShareLastViewedAt;
  delete publicPayload.editableShareLastEditedAt;
  delete publicPayload.editableShareCollaborators;
  delete publicPayload.editableShareImportedUserIds;
  delete publicPayload.custom_adapters;
  delete publicPayload.customAdapterFallbacks;
  delete publicPayload.customAdapterOperationUsage;
  delete publicPayload.apiKeyId;
  delete publicPayload.apiKeyUsage;
  delete publicPayload.externalWebhook;
  delete publicPayload.externalRequestUserId;
  delete publicPayload.externalRequestIdentityKey;
  delete publicPayload.notificationEmail;
  delete publicPayload.sessionReceipt;

  publicPayload.layers = Array.isArray(publicPayload.layers)
    ? publicPayload.layers.map((layer) => {
      if (!layer || typeof layer !== 'object') {
        return layer;
      }
      const publicLayer = { ...layer };
      if (publicLayer.imageSession && typeof publicLayer.imageSession === 'object') {
        publicLayer.imageSession = { ...publicLayer.imageSession };
        delete publicLayer.imageSession.userId;
      }
      return publicLayer;
    })
    : [];

  return publicPayload;
}

export async function createReadOnlyShareForSession(userId, payload = {}) {
  await getDBConnectionString();

  const shareMode = normalizeShareMode(payload.mode || payload.shareMode || payload.share_mode);
  const sessionId = payload.sessionId || payload.id;
  if (!sessionId) {
    const error = new Error('sessionId is required.');
    error.status = 400;
    throw error;
  }

  const session = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: false,
  });
  if (!session) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const existingToken = normalizeReadOnlyShareToken(session.shareToken);
  const shareToken = existingToken || await generateUniqueReadOnlyShareToken();
  const existingEditableToken = normalizeEditableShareToken(session.editableShareToken);
  const editableShareToken = existingEditableToken || await generateUniqueEditableShareToken();
  const now = new Date();
  const shareOgImage = resolveReadOnlyShareOgImage(session);

  if (shareMode === 'editable') {
    session.editableShareEnabled = true;
    session.editableShareToken = editableShareToken;
    session.editableShareCreatedAt = session.editableShareCreatedAt || now;
  } else {
    session.shareEnabled = true;
    session.shareToken = shareToken;
    session.shareCreatedAt = session.shareCreatedAt || now;
  }

  session.shareOgImageUrl = shareOgImage?.url || null;
  session.shareOgImagePath = shareOgImage?.path || null;
  session.shareOgImageSource = shareOgImage?.source || null;
  session.shareOgImageUpdatedAt = shareOgImage?.url ? now : null;
  session.shareOgImageCreatedAt = shareOgImage?.url
    ? (session.shareOgImageCreatedAt || now)
    : null;
  await session.save();

  if (shareMode === 'editable') {
    return {
      sessionId: session._id.toString(),
      shareMode,
      share_mode: shareMode,
      editableShareToken,
      editable_share_token: editableShareToken,
      shareToken: editableShareToken,
      share_token: editableShareToken,
      shareUrl: `/video/collab/${editableShareToken}`,
      share_url: `/video/collab/${editableShareToken}`,
      ogImageUrl: session.shareOgImageUrl,
      og_image_url: session.shareOgImageUrl,
      shareOgImageUrl: session.shareOgImageUrl,
    };
  }

  return {
    sessionId: session._id.toString(),
    shareMode,
    share_mode: shareMode,
    shareToken,
    share_token: shareToken,
    shareUrl: `/video/share/${shareToken}`,
    share_url: `/video/share/${shareToken}`,
    ogImageUrl: session.shareOgImageUrl,
    og_image_url: session.shareOgImageUrl,
    shareOgImageUrl: session.shareOgImageUrl,
  };
}

export async function getEditableSharedSessionDetails(userId, editableShareToken) {
  await getDBConnectionString();

  const normalizedToken = normalizeEditableShareToken(editableShareToken);
  if (!normalizedToken) {
    const error = new Error('Invalid editable share token.');
    error.status = 400;
    throw error;
  }

  const session = await VideoSession.findOne({
    editableShareToken: normalizedToken,
    editableShareEnabled: true,
  });
  if (!session) {
    const error = new Error('Editable shared session not found.');
    error.status = 404;
    throw error;
  }

  if (userId) {
    await markEditableShareAccess(session, userId, { edited: false });
  }
  session.editableShareLastViewedAt = new Date();
  await session.save();

  const sessionPayload = userId
    ? await sanitizeStudioSessionPayload(session, { viewerUserId: userId })
    : await sanitizePublicStudioSessionPayload(session);

  return {
    ...sessionPayload,
    isReadOnlyShare: false,
    isEditableShare: true,
    editableShareToken: normalizedToken,
  };
}

export async function getReadOnlySharedSessionDetails(shareToken) {
  await getDBConnectionString();

  const normalizedToken = normalizeReadOnlyShareToken(shareToken);
  if (!normalizedToken) {
    const error = new Error('Invalid share token.');
    error.status = 400;
    throw error;
  }

  const session = await VideoSession.findOne({
    shareToken: normalizedToken,
    shareEnabled: true,
  });
  if (!session) {
    const error = new Error('Shared session not found.');
    error.status = 404;
    throw error;
  }

  const now = new Date();
  session.shareLastViewedAt = now;
  if (!session.shareOgImageUrl) {
    const shareOgImage = resolveReadOnlyShareOgImage(session);
    if (shareOgImage?.url) {
      session.shareOgImageUrl = shareOgImage.url;
      session.shareOgImagePath = shareOgImage.path || null;
      session.shareOgImageSource = shareOgImage.source || null;
      session.shareOgImageCreatedAt = session.shareOgImageCreatedAt || now;
      session.shareOgImageUpdatedAt = now;
    }
  }
  await session.save();

  return sanitizePublicStudioSessionPayload(session);
}

function normalizeSequencedActiveItemIds(activeItemList = []) {
  let nextNumericId = 0;

  return activeItemList.map((item) => {
    const plainItem = toPlainActiveItem(item);
    if (
      plainItem &&
      typeof plainItem === 'object' &&
      typeof plainItem.id === 'string' &&
      /^item_\d+$/.test(plainItem.id)
    ) {
      return {
        ...plainItem,
        id: `item_${nextNumericId++}`,
      };
    }
    return plainItem;
  });
}

async function persistLayerActiveItemList(session, payload) {
  const { activeItemList, sessionId, layerId } = payload;
  const activeImagePrompt = typeof payload.prompt === 'string' && payload.prompt.trim()
    ? payload.prompt.trim()
    : null;
  let sessionGenerations = session.generations || [];
  const normalizedActiveItemList = Array.isArray(activeItemList)
    ? activeItemList.map((item) => stripTransientActiveItemFields(item))
    : [];

  for (let i = 0; i < normalizedActiveItemList.length; i++) {
    const item = normalizedActiveItemList[i];

    if (!item || item.type !== 'image' || typeof item.src !== 'string') {
      continue;
    }

    if (item.src.startsWith('data:image')) {

      // Create a random filename
      const imageFileName = `${hat()}.png`;
      const imageFileBasePath = path.posix.join('assets_v2', 'temp', sessionId.toString());
      let imageFilePath = path.join(resolveProcessorAssetsRoot(), 'temp', sessionId.toString());

      if (!fs.existsSync(imageFilePath)) {
        fs.mkdirSync(imageFilePath, { recursive: true });
      }
      imageFilePath = path.join(imageFilePath, imageFileName);

      // Extract base64 data
      const base64Data = item.src.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');

      // Re-encode image with Sharp to ensure it's valid
      let processedBuffer;
      try {
        processedBuffer = await sharp(buffer).png().toBuffer();
      } catch (err) {
        console.error("Error re-encoding image with sharp:", err);
        continue;
      }

      // Write to disk
      fs.writeFileSync(imageFilePath, processedBuffer);
      const imageFilePathRelative = path.posix.join(imageFileBasePath, imageFileName);
      item.src = imageFilePathRelative;

      if (!sessionGenerations.some(gen => gen.src === imageFilePathRelative)) {
        let metadata;
        try {
          metadata = await sharp(processedBuffer).metadata();
        } catch (err) {
          console.error("Error getting metadata from sharp:", err);
          continue;
        }

        sessionGenerations.push({
          src: imageFilePathRelative,
          width: metadata.width,
          height: metadata.height,
        });
      }

      normalizedActiveItemList[i] = item;
    }
  }

  const setPayload = {
    generations: sessionGenerations,
    'layers.$.imageSession.activeItemList': normalizedActiveItemList,
    'layers.$.frameGenerationPending': true,
    'layers.$.imageSession.generationStatus': 'COMPLETED',
    frameGenerationPending: true,
  };
  if (activeImagePrompt) {
    setPayload['layers.$.prompt'] = activeImagePrompt;
    setPayload['layers.$.imageSession.prompt'] = activeImagePrompt;
  }

  const updatedSession = await VideoSession.findOneAndUpdate(
    { _id: sessionId, 'layers._id': layerId },
    {
      $set: setPayload,
    },
    { new: true }
  );

  if (sessionId && layerId) {
    await deleteUnlockedFrameGenerations(sessionId, layerId);
    await ensureUnlockedFrameGeneration(sessionId, layerId);
  }

  if (!updatedSession) {
    throw new Error("Layer not found or session update failed");
  }

  const sanitizedSession = await sanitizeStudioSessionPayload(updatedSession);
  const updatedLayer = sanitizedSession?.layers?.find(
    (layer) => layer?._id?.toString?.() === layerId.toString()
  );

  return {
    session: sanitizedSession,
    layer: updatedLayer,
  };
}


export async function updateLayerActiveItemList(userId, payload) {
  await getDBConnectionString();
  const { activeItemList, sessionId, layerId } = payload;

  const session = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });

  return persistLayerActiveItemList(session, {
    activeItemList,
    sessionId,
    layerId,
  });
}

export async function updateLayerVisualItem(userId, payload) {
  await getDBConnectionString();
  const { sessionId, layerId, itemId, startFrame, endFrame } = payload;

  const session = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });

  const layer = session.layers.find((sessionLayer) => sessionLayer._id.toString() === layerId.toString());
  if (!layer) {
    throw new Error("Layer not found");
  }

  const currentActiveItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList.map((item) => toPlainActiveItem(item))
    : [];

  const itemIndex = currentActiveItemList.findIndex(
    (item) => item?.id?.toString() === itemId.toString()
  );
  if (itemIndex === -1) {
    throw new Error("Layer item not found");
  }

  const currentItem = currentActiveItemList[itemIndex];
  if (!currentItem || (currentItem.type !== 'image' && currentItem.type !== 'shape')) {
    throw new Error("Only image and shape items can be updated with this route");
  }

  const parentLayerStartFrame = Math.max(
    0,
    Math.round((Number(layer.durationOffset) || 0) * TRACK_EDITOR_FRAMES_PER_SECOND)
  );
  const parentLayerDurationFrames = Math.max(
    1,
    Math.round((Number(layer.duration) || 0) * TRACK_EDITOR_FRAMES_PER_SECOND)
  );
  const sessionFramesPerSecond = getSessionFramesPerSecondWithLog(
    session,
    'VideoSession.updateLayerVisualItem'
  );
  const parentLayerDurationSessionFrames = Math.max(
    1,
    Math.round((Number(layer.duration) || 0) * sessionFramesPerSecond)
  );
  const editorFramesToSessionFrames = (value) => Math.max(
    0,
    Math.round(((Number(value) || 0) / TRACK_EDITOR_FRAMES_PER_SECOND) * sessionFramesPerSecond)
  );

  const requestedStartFrame = Math.round(Number(startFrame));
  const requestedEndFrame = Math.round(Number(endFrame));

  const relativeStartEditorFrame = clampNumber(
    requestedStartFrame - parentLayerStartFrame,
    0,
    Math.max(0, parentLayerDurationFrames - 1)
  );
  const relativeEndEditorFrame = clampNumber(
    requestedEndFrame - parentLayerStartFrame,
    relativeStartEditorFrame + 1,
    parentLayerDurationFrames
  );
  const relativeStartFrame = clampNumber(
    editorFramesToSessionFrames(relativeStartEditorFrame),
    0,
    Math.max(0, parentLayerDurationSessionFrames - 1)
  );
  const relativeEndFrame = clampNumber(
    editorFramesToSessionFrames(relativeEndEditorFrame),
    relativeStartFrame + 1,
    parentLayerDurationSessionFrames
  );

  currentActiveItemList[itemIndex] = {
    ...currentItem,
    config: {
      ...(currentItem.config || {}),
      frameRate: sessionFramesPerSecond,
      frameOffset: relativeStartFrame,
      frameDuration: relativeEndFrame - relativeStartFrame,
    },
  };

  return persistLayerActiveItemList(session, {
    activeItemList: currentActiveItemList,
    sessionId,
    layerId,
  });
}

export async function deleteLayerVisualItem(userId, payload) {
  await getDBConnectionString();
  const { sessionId, layerId, itemId } = payload;

  const session = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });

  const layer = session.layers.find((sessionLayer) => sessionLayer._id.toString() === layerId.toString());
  if (!layer) {
    throw new Error("Layer not found");
  }

  const currentActiveItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList.map((item) => toPlainActiveItem(item))
    : [];
  const visualItem = currentActiveItemList.find(
    (item) => item?.id?.toString() === itemId.toString()
  );

  if (!visualItem) {
    throw new Error("Layer item not found");
  }
  if (visualItem.type !== 'image' && visualItem.type !== 'shape') {
    throw new Error("Only image and shape items can be deleted with this route");
  }

  const nextActiveItemList = normalizeSequencedActiveItemIds(
    currentActiveItemList.filter((item) => item?.id?.toString() !== itemId.toString())
  );

  return persistLayerActiveItemList(session, {
    activeItemList: nextActiveItemList,
    sessionId,
    layerId,
  });
}



export async function getVideoSessionGenerationStatus(sessionId, layerId) {
  await getDBConnectionString();
  const session = await VideoSession.findOne({ _id: sessionId }).populate({
    path: 'layers.imageSession',
    model: 'Session' // Ensure the correct model is referenced
  });

  if (!session) {
    throw new Error("Session not found");
  }
  const layers = session.layers;

  const layer = layers.find((layer) => layer._id.toString() === layerId);

  if (!layer) {
    throw new Error("Layer not found");
  }
  if (layer.imageSession.generationStatus === 'COMPLETED') {

    return {
      status: 'COMPLETED',
      layer: layer,
      generationImages: serializeGenerationImageAssets(session.generations),
      layers: layers,
    };
  } else {
    return {
      status: layer.imageSession.generationStatus,
    };
  }
}

export async function getVideoSessionEditStatus(sessionId, layerId) {
  await getDBConnectionString();
  const session = await VideoSession.findOne({ _id: sessionId });

  if (!session) {
    throw new Error("Session not found");
  }
  const layers = session.layers;
  const layer = layers.find((layer) => layer._id.toString() === layerId);

  if (!layer) {
    throw new Error("Layer not found");
  }


  if (layer.imageSession.editStatus === 'COMPLETED') {

    return {
      status: 'COMPLETED',
      layer: layer,
      generationImages: serializeGenerationImageAssets(session.generations),
    };
  } else {
    return {
      status: layer.imageSession.editStatus,
    };
  }

}



function adjustDistributionToRemoveGaps(layerDistribution, layerFrameDuration) {
  // Sort the distributions by startFrame
  layerDistribution.sort((a, b) => a.startFrame - b.startFrame);

  const adjustedLayerDistribution = [];
  let previousEndFrame = 0;

  for (let i = 0; i < layerDistribution.length; i++) {
    const currentDist = layerDistribution[i];

    // If there's a gap between previousEndFrame and currentDist.startFrame
    if (currentDist.startFrame > previousEndFrame) {
      // Adjust currentDist.startFrame to match previousEndFrame
      currentDist.startFrame = previousEndFrame;
    } else if (currentDist.startFrame < previousEndFrame) {
      // Overlap detected; adjust currentDist.startFrame
      currentDist.startFrame = previousEndFrame;
    }

    // Calculate the duration of the current distribution
    const duration = currentDist.endFrame - currentDist.startFrame;

    // Update currentDist.endFrame based on the new startFrame and duration
    currentDist.endFrame = currentDist.startFrame + duration;

    // Add the adjusted distribution to the new array
    adjustedLayerDistribution.push(currentDist);

    // Update previousEndFrame for the next iteration
    previousEndFrame = currentDist.endFrame + 1;
  }

  // Check if there's a gap at the end
  if (previousEndFrame < layerFrameDuration) {
    // Fill the remaining time with a new distribution
    adjustedLayerDistribution.push({
      startFrame: previousEndFrame,
      endFrame: layerFrameDuration + 1,
    });
  }

  return adjustedLayerDistribution;
}

export async function requestGenerateImage(userId, payload) {
  await getDBConnectionString();


  const videoSessionId = payload.videoSessionId;
  const layerId = payload.layerId;
  const skipApplyThemeToPrompt = payload.skipApplyThemeToPrompt;
  const isRecreateRequest = payload.isRecreateRequest;
  const preserveLayerPrompt = Boolean(
    payload.preserveLayerPrompt ||
    payload.preserve_layer_prompt ||
    payload.preserveActiveSelectedImage ||
    payload.preserve_active_selected_image ||
    payload.appendGeneratedImageCandidate ||
    payload.append_generated_image_candidate
  );


  const userData = await User.findById(userId);

  const userGenerationModel = normalizeInferenceModel(userData?.selectedInferenceModel);

  const model = payload.model;
  let useShortForm = false;


  if (model === 'RECRAFTV3') {
    useShortForm = true;
  }

  let promptText = payload.prompt;

  const moderationPassed = await getModerationForNarrative(promptText);

  if (!moderationPassed) {
    throw new Error('Prompt failed moderation');
  }


  let aspectRatio = payload.aspectRatio;

  if (!aspectRatio) {
    aspectRatio = '1:1';
  }

  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  // Find the session data
  const sessionDataValue = await requireVideoSessionForStudioAccess(userId, videoSessionId, payload, {
    markEdited: true,
  });
  await sessionDataValue.populate({
    path: 'layers.imageSession',
    model: 'Session'
  });

  const layer = sessionDataValue.layers.find(layer => layer._id.toString() === layerId);

  if (!layer) {
    throw new Error('Layer not found');
  }



  if (!skipApplyThemeToPrompt) {
    const basicTextTheme = sessionDataValue.basicTextTheme;
    const parentJsonTheme = sessionDataValue.parentJsonTheme;
    const derivedJsonTheme = sessionDataValue.derivedJsonTheme;

    const isCharacterImage = payload.isCharacterImage;

    const videoTone = "cinematic";

    if (derivedJsonTheme && derivedJsonTheme.length > 0) {
      if (isCharacterImage) {
        promptText = await updateCharacterPromptWithTheme(promptText, derivedJsonTheme, aspectRatio,
          userGenerationModel, useShortForm, videoTone);
      } else {
        promptText = await updatePromptWithTheme(promptText, derivedJsonTheme, aspectRatio,
          userGenerationModel, useShortForm, videoTone);
      }
    } else if (parentJsonTheme && parentJsonTheme.length > 0) {

      if (isCharacterImage) {
        promptText = await updateCharacterPromptWithTheme(promptText, parentJsonTheme, aspectRatio,
          userGenerationModel, useShortForm, videoTone);
      } else {
        promptText = await updatePromptWithTheme(promptText, parentJsonTheme, aspectRatio,
          userGenerationModel, useShortForm, videoTone);

      }


    } else if (basicTextTheme && basicTextTheme.length > 0) {

      if (isCharacterImage) {
        promptText = await updatePromptWithCharacterPOV(promptText, basicTextTheme, aspectRatio,
          userGenerationModel, useShortForm, videoTone);
      } else {
        promptText = `${promptText} ${basicTextTheme}`;
      }
      const aspectRatioPrefix = getAspectRatioPrefix(aspectRatio);
      const aspectRatioPostfix = getAspectRatioPostfix(aspectRatio);
      if (aspectRatioPrefix) {
        promptText = `${aspectRatioPrefix} ${promptText}`;
      }
      if (aspectRatioPostfix) {
        promptText = `${promptText} ${aspectRatioPostfix}`;
      }
    } else {
      if (isCharacterImage) {
        promptText = await updatePromptWithCharacterPOV(promptText, '', aspectRatio, userGenerationModel, useShortForm);
        // maybe need to update the system prompt to handle null theme
      }
    }
  }

  let layerBaseAiImageType = 'none';
  if (payload.isCharacterImage) {
    layerBaseAiImageType = 'character';
  }


  // Update the prompt in the corresponding layer using updateOne
  const imageGenerationSetPayload = {
    'layers.$.imageSession.generationStatus': 'PENDING',
    'layers.$.imageSession.generationError': null,
    'layers.$.filterPasses': [],
  };
  if (!preserveLayerPrompt) {
    imageGenerationSetPayload['layers.$.prompt'] = promptText;
    imageGenerationSetPayload['layers.$.imageSession.prompt'] = promptText;
    imageGenerationSetPayload['layers.$.layerBaseAiImageType'] = layerBaseAiImageType;
  }

  const updateResult = await VideoSession.updateOne(
    { _id: videoSessionId, 'layers._id': layerId },
    {
      $set: imageGenerationSetPayload,
    },
    { new: true }
  );

  if (updateResult.nModified === 0) {
    throw new Error('Failed to update the image session prompt');
  }

  // If express generation, update the active item list
  if (sessionDataValue.isExpressGeneration) {
    const pIdx = sessionDataValue.layers.findIndex(layer => layer._id.toString() === layerId);
    const layer = sessionDataValue.layers[pIdx];
    const imageSession = layer.imageSession;

    const framesPerSecond = getSessionFramesPerSecondWithLog(
      sessionDataValue,
      'VideoSession.updateImageSessionPrompt'
    );
    const layerFrameDuration = layer.duration * framesPerSecond;
    let currentActiveItemList = imageSession.activeItemList;

    const hasBaseImage = currentActiveItemList.some(item => item.type === 'image' && item.is_base_image);

    if (!hasBaseImage || isRecreateRequest) {

      let animationsList;
      let animation = sessionDataValue.expressGenerationAnimation;
      const videoType = sessionDataValue.expressGenerationType;


      if (animation) {
        if (animation === 'preset_short_animation') {


          let presetAnimationGenerated = false;
          //const distributionList = // recreate distribution list from text layers
          if (isRecreateRequest) {
            const currentImageLayer = layer.imageSession.activeItemList.find(item => item.type === 'image' && item.is_base_image);
            if (currentImageLayer && currentImageLayer.animations) {
              const currentImageAnimations = currentImageLayer.animations;
              animationsList = currentImageAnimations;
              // remove the image layer from currentActiveItemList
              currentActiveItemList = currentActiveItemList.filter(item => item.id !== currentImageLayer.id);
              presetAnimationGenerated = true;
            }
          }
          if (!presetAnimationGenerated) {
            const textLayers = currentActiveItemList.filter(item => item.type === 'text' && item.subType === 'subtitle');
            let layerDistribution = textLayers.map(function (tl) {

              const ld = {
                startFrame: tl.config.frameOffset,
                endFrame: tl.config.frameOffset + tl.config.frameDuration,
              }
              return ld;
            })

            //    layerDistribution = adjustDistributionToRemoveGaps(layerDistribution, layerFrameDuration);
            if (layerDistribution && layerDistribution.length > 0) {
              animationsList = getPresetAnimationListForDistribution(
                layerDistribution,
                pIdx,
                canvasDimensions,
                layerFrameDuration,
                framesPerSecond
              );
            }

          }

        } else if (animation === 'random') {
          const possibleAnimations = ['zoom_in', 'zoom_out', 'pan_left_to_right', 'pan_right_to_left'];
          const randomIndex = Math.floor(Math.random() * possibleAnimations.length);
          animation = possibleAnimations[randomIndex];
          animationsList = getAnimationPresetForType(videoType, animation);


        } else if (animation === 'alternate_zoom') {
          if (pIdx % 2 === 0) {
            animationsList = getAnimationPresetForType(videoType, 'zoom_in');
          } else {
            animationsList = getAnimationPresetForType(videoType, 'zoom_out');
          }
        } else if (animation === 'alternate_pan') {
          if (pIdx % 2 === 0) {
            animationsList = getAnimationPresetForType(videoType, 'pan_left_to_right');
          } else {
            animationsList = getAnimationPresetForType(videoType, 'pan_right_to_left');
          }

        } else if (animation === 'random') {
          const possibleAnimations = ['zoom_in', 'zoom_out', 'pan_left_to_right', 'pan_right_to_left'];
          const randomIndex = Math.floor(Math.random() * possibleAnimations.length);
          animation = possibleAnimations[randomIndex];
          animationsList = getAnimationPresetForType(videoType, animation);

        } else {
          animationsList = getAnimationPresetForType(videoType, animation);
        }

      }

      const newImageItem = {
        x: 0,
        y: 0,
        width: canvasDimensions.width,
        height: canvasDimensions.height,
        src: '',
        is_base_image: true,
        id: 'item_0',
        type: 'image',
        animations: animationsList,
      };

      currentActiveItemList.unshift(newImageItem);

      currentActiveItemList = currentActiveItemList.map((item, index) => {
        if (index > 0) {
          item.id = `item_${index}`;
        }
        return item;
      });

      let layerBaseAiImageTypes = 'scene';
      if (payload.isCharacterImage) {
        layerBaseAiImageTypes = 'character';
      }



      await VideoSession.updateOne(
        { _id: videoSessionId, 'layers._id': layerId },
        {
          $set: {
            'layers.$.imageSession.activeItemList': currentActiveItemList,
            'layers.$.layerBaseAiImageType': layerBaseAiImageTypes,
          }
        }
      );

      payload.isBaseGeneration = true;
    }
  }

  payload.prompt = promptText;
  payload.aspectRatio = aspectRatio;

  //   const contentFilterRating = await User.findOne({ _id: userId }).contentFilterRating;
  const userContentFilterRating = await User.findOne({ _id: userId }, { contentFilterRating: 1 });


  payload.contentFilterRating = userContentFilterRating.contentFilterRating;


  // Add the image generator request
  await addImageGeneratorRequest(userId, payload);


  return {
    prompt: promptText,
  }
}



export async function requestEditImage(userId, payload) {

  await getDBConnectionString();
  const sessionId = payload.sessionId;
  const layerId = payload.layerId;


  const sessionDataValue = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  await sessionDataValue.populate({
    path: 'layers.imageSession',
    model: 'Session'
  });


  const layer = sessionDataValue.layers.find(layer => layer._id.toString() === layerId);
  if (!layer) {
    throw new Error('Layer not found');
  }


  let imageSession = layer.imageSession;
  imageSession.editStatus = "PENDING";
  imageSession.prompt = payload.prompt;
  imageSession.editError = null;


  const saveRes = await sessionDataValue.save();

  const imageEditRes = await addImageEditRequest(userId, payload);

  return saveRes;
}



export async function updateLayerForSession(payload) {
  await getDBConnectionString();

  const { sessionId, layer, clipData = {} } = payload;
  const {
    clipStart,
    clipEnd,
    clipStartFrames,
    clipEndFrames,
  } = clipData;

  const layerId = layer._id.toString();

  // 1) Find the session
  const session = await VideoSession.findOne({ _id: sessionId });
  if (!session) {
    throw new Error("Session not found");
  }

  // 2) Mark transcripts to regenerate, since durations may change
  await VideoSession.updateOne(
    { _id: sessionId },
    { $set: { transcriptGenerationPending: true } }
  );

  let layers = session.layers;
  let audioLayers = session.audioLayers || [];

  // 3) Locate the layer to update
  const currentLayerIndex = layers.findIndex((l) => l._id.toString() === layerId);
  if (currentLayerIndex === -1) {
    throw new Error("Layer not found");
  }

  // Keep old layer data around to check AI video links, etc.
  const currentLayer = layers[currentLayerIndex];
  const previousCurrentLayerDuration = Math.max(0, Number(currentLayer?.duration) || 0);
  const sessionFramesPerSecond = getSessionFramesPerSecondWithLog(
    session,
    'VideoSession.updateLayerForSession'
  );

  const isExtendingLayerDuration = layer.duration > currentLayer.duration;
  const hasDerivedVideo = Boolean(
    currentLayer.hasLipSyncVideoLayer ||
    currentLayer.lipSyncVideoLayer ||
    layer.hasLipSyncVideoLayer ||
    layer.lipSyncVideoLayer ||
    currentLayer.hasSoundEffectVideoLayer ||
    currentLayer.soundEffectVideoLayer ||
    layer.hasSoundEffectVideoLayer ||
    layer.soundEffectVideoLayer
  );
  const shouldSkipLastFramePaddingForDerivedExtension = (
    isExtendingLayerDuration &&
    hasDerivedVideo
  );

  if (isExtendingLayerDuration) {
    // If the old layer had an AI video, re-extract frames
    const oldHasAiVideo =
      currentLayer.hasAiVideoLayer ||
      currentLayer.hasLipSyncVideoLayer ||
      currentLayer.hasSoundEffectVideoLayer ||
      currentLayer.hasUserVideoLayer ||
      currentLayer.userVideoLayer;

    if (oldHasAiVideo) {
      await extractFramesFromAiVideoLayer(sessionId, currentLayer._id.toString(), {
        skipDurationPadding: shouldSkipLastFramePaddingForDerivedExtension,
      });
    }

    // Derived video duration extensions should not synthesize base/still frames.
    if (!shouldSkipLastFramePaddingForDerivedExtension) {
      await addLastFrameForMissingDuration({
        sessionId,
        layerId: currentLayer._id.toString(),
        newDuration: layer.duration,
        oldDuration: currentLayer.duration,
        aspectRatio: session.aspectRatio,
      });
    }

    layer.frameGenerationPending = true;
  }

  // 3½) ***Safe merge – no spread, prevents copying `_doc`***
  currentLayer.set(layer);            // ← key change

  // 4) Persist clip state explicitly so stale trim values are cleared.
  const normalizedClipStartFrames = clipStart
    ? Math.max(0, Math.round(Number(clipStartFrames) || 0))
    : 0;
  const normalizedClipEndFrames = clipEnd
    ? Math.max(0, Math.round(Number(clipEndFrames) || 0))
    : 0;

  currentLayer.clipStart = normalizedClipStartFrames > 0;
  currentLayer.clipStartFrames = normalizedClipStartFrames;
  currentLayer.clipEnd = normalizedClipEndFrames > 0;
  currentLayer.clipEndFrames = normalizedClipEndFrames;

  // 5) Recompute durationOffset for all layers
  let durationOffset = 0;
  const trimStartSeconds = normalizedClipStartFrames / sessionFramesPerSecond;
  const trimEndSeconds = normalizedClipEndFrames / sessionFramesPerSecond;
  for (let i = 0; i < layers.length; i++) {
    const previousLayerStartTime = Math.max(0, Number(layers[i]?.durationOffset) || 0);
    const previousLayerDuration = i === currentLayerIndex
      ? previousCurrentLayerDuration
      : Math.max(0, Number(layers[i]?.duration) || 0);
    layers[i].durationOffset = durationOffset;
    durationOffset += layers[i].duration;

    const currentLayerId = layers[i]._id.toString();
    for (let j = 0; j < audioLayers.length; j++) {
      if (audioLayers[j]?.connectedLayerId !== currentLayerId) {
        continue;
      }

      const previousWindow = getConnectedAudioRelativeWindow(
        audioLayers[j],
        previousLayerStartTime,
        previousLayerDuration,
      );
      const nextWindow = i === currentLayerIndex
        ? mapConnectedAudioWindowThroughEdgeTrim({
          relativeStart: previousWindow.relativeStart,
          duration: previousWindow.duration,
          sourceTrimStartTime: previousWindow.sourceTrimStartTime,
          previousLayerDuration,
          trimStartSeconds,
          trimEndSeconds,
        })
        : {
          relativeStart: previousWindow.relativeStart,
          duration: previousWindow.duration,
          sourceTrimStartTime: previousWindow.sourceTrimStartTime,
        };

      applyConnectedAudioWindowToLayer({
        audioLayer: audioLayers[j],
        layer: layers[i],
        layerIndex: i,
        relativeStart: nextWindow.relativeStart,
        duration: nextWindow.duration,
        sourceTrimStartTime: nextWindow.sourceTrimStartTime,
      });
    }
  }

  // 6) Remove any existing extracted frames for this layer
  const framesPath = path.join(
    process.cwd(),
    "assets",
    "video",
    "frames",
    sessionId.toString(),
    layerId.toString()
  );
  if (fs.existsSync(framesPath)) {
    await fsExtra.emptyDir(framesPath);
    await fsExtra.remove(framesPath);
  }

  // 8) Update the DB with the new layers & audioLayers
  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        layers,
        audioLayers,
        totalDuration: durationOffset,
      },
    }
  );

  // 10) Mark transcript pending → false (done)
  await VideoSession.updateOne(
    { _id: sessionId },
    { $set: { transcriptGenerationPending: false } }
  );

  // Return the updated session
  const updatedSession = await VideoSession.findOne({ _id: sessionId });
  const updatedSessionLayers = updatedSession.layers;
  const updatedLayerIndex = updatedSessionLayers.findIndex(
    (l) => l._id.toString() === layerId
  );
  const updatedLayer = updatedSessionLayers[updatedLayerIndex];

  await generateTranscriptsForSessionAudioLayersAfterLayer(
    sessionId,
    updatedLayerIndex
  );
  await requestRealignConnectedAudioLayersToLayers(sessionId);

  for (let i = updatedLayerIndex; i < updatedSessionLayers.length; i++) {
    updatedSessionLayers[i].frameGenerationPending = true;
  }

  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        layers: updatedSessionLayers,
        frameGenerationPending: true,
      },
    }
  );

  await ensureUnlockedFrameGenerations(
    sessionId,
    updatedSessionLayers
      .slice(updatedLayerIndex)
      .map((sessionLayer) => sessionLayer?._id?.toString?.())
  );

  const refreshedSession = await VideoSession.findOne({ _id: sessionId });
  const refreshedLayer = refreshedSession?.layers?.find(
    (sessionLayer) => sessionLayer._id.toString() === layerId
  );

  return {
    session: refreshedSession,
    layer: refreshedLayer || updatedLayer,
    audioLayers: refreshedSession?.audioLayers || updatedSession.audioLayers || [],
  };
}








/**
 * addLastFrameForMissingDuration()
 * 
 * Takes a layer whose duration has *increased* from oldDuration to newDuration
 * and appends a single “last-frame” image item that covers the newly added time.
 * Optionally applies a gentle “zoom+slide” so the frame isn’t totally static. 
 */
export async function addLastFrameForMissingDuration({
  sessionId,
  layerId,
  newDuration,
  oldDuration,
  aspectRatio
}) {
  // Calculate how many seconds we need to fill
  const durationDiff = newDuration - oldDuration;
  if (durationDiff <= 0) {
    return; // No need to do anything if not strictly > 0
  }

  // 1) Load the session + layer
  const sessionData = await VideoSession.findOne({ _id: sessionId });
  if (!sessionData) {
    throw new Error("VideoSession not found");
  }
  const layerIndex = sessionData.layers.findIndex((l) => l._id.toString() === layerId);
  if (layerIndex === -1) {
    throw new Error("Layer not found");
  }

  const layer = sessionData.layers[layerIndex];
  const canvas = getCanvasDimensionsForAspectRatio(aspectRatio);
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  // 2) The last AI/video frame is stored in `layer.aiLayerEndFrame`, `layer.lipSyncVideoLayer`
  // or `layer.soundEffectVideoLayer`, or fallback to some default. For demonstration:
  let lastFramePath;

  if (layer.hasLipSyncVideoLayer && layer.lipSyncVideoLayer) {
    // If lip sync video is present, you might have called 
    // `processVideoAsFrames()` which stored the last frame in `layer.aiLayerEndFrame`.
    lastFramePath = layer.aiLayerEndFrame;
  } else if (layer.hasSoundEffectVideoLayer && layer.soundEffectVideoLayer) {
    lastFramePath = layer.aiLayerEndFrame;
  } else if (layer.hasUserVideoLayer && layer.userVideoLayer) {
    lastFramePath = layer.aiLayerEndFrame;
  } else if (layer.hasAiVideoLayer && layer.aiVideoLayer) {
    lastFramePath = layer.aiLayerEndFrame;
  }

  if (!lastFramePath) {
    // fallback
    return;
  }


  const framesPerSecond = getSessionFramesPerSecondWithLog(
    sessionData,
    'VideoSession.padLayerWithLastFrame'
  );
  // We'll treat this extra portion as (durationDiff) * session FPS frames
  const frameDuration = Math.floor(durationDiff * framesPerSecond);
  const existingFramesCount = Math.floor(oldDuration * framesPerSecond);
  const frameOffset = existingFramesCount;

  // 3) Create an optional “zoom+slide” animation:
  const durationDiffInSeconds = Math.abs(durationDiff);
  // 2% zoom per second, max of +20%
  const zoomPercentage = Math.min(durationDiffInSeconds * 2, 20);
  const finalEndScale = 100 + zoomPercentage;
  const deltaX = ((finalEndScale / 100) * canvasWidth - canvasWidth) / 2;
  const deltaY = ((finalEndScale / 100) * canvasHeight - canvasHeight) / 2;
  const finalEndX = -deltaX;
  const finalEndY = -deltaY;

  const configAnimations = [
    {
      type: 'zoom',
      params: {
        startScale: 100,
        endScale: finalEndScale,
      },
      frameDuration,
      frameOffset
    },
    {
      type: 'slide',
      params: {
        startX: 0,
        startY: 0,
        endX: finalEndX,
        endY: finalEndY,
      },
      frameDuration,
      frameOffset
    }
  ];

  const newImageItem = {
    type: 'image',
    src: '/' + lastFramePath.replace(/\\/g, '/'),
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight,
    id: `item_pad_${Date.now()}`,
    config: {
      frameDuration,
      frameOffset
    },
    animations: configAnimations
  };

  // 4) Insert that new image item into the “activeItemList,” 
  // but keep any text items already in place:
  if (!layer.imageSession.activeItemList) {
    layer.imageSession.activeItemList = [];
  }
  // If you only want to keep subtitles, filter out other images:
  const filteredList = layer.imageSession.activeItemList.filter((it) => it.type === 'text');
  filteredList.push(newImageItem);
  layer.imageSession.activeItemList = filteredList;

  // Mark the layer so frames are regenerated
  layer.frameGenerationPending = true;

  // 5) Save
  sessionData.layers[layerIndex] = layer;
  await sessionData.save();
}






export async function getVideoRenderStatus(reqBody) {
  const id = reqBody.id;
  const { userId } = reqBody;
  await getDBConnectionString();
  const session = await VideoSession.findOne({ _id: id });

  if (!session) {
    throw new Error("Session not found");
  }

  const sanitizedSession = session.isGuestSession
    ? await sanitizeGuestSessionPayload(session)
    : await sanitizeStudioSessionPayload(session, { viewerUserId: userId });

  const expressRenderPending = Boolean(session.isExpressGeneration && session.expressGenerationPending);
  const expressRenderPaused = Boolean(session.isExpressGeneration && session.expressGenerationPaused);
  if (expressRenderPaused) {
    return {
      status: 'PAUSED',
      session: sanitizedSession,
    }
  }
  if (session.videoGenerationPending || expressRenderPending) {
    return {
      status: 'PENDING',
      session: sanitizedSession,
    }
  }
  if (session.generationError) {
    return {
      status: 'FAILED',
      generationError: session.generationError,
      session: sanitizedSession,
    }
  }
  if (session.videoLink || session.remoteURL) {
    return {
      status: 'COMPLETED',
      session: sanitizedSession
    }
  }
  if (session.expressGenerationFailed) {
    return {
      status: 'FAILED',
      generationError: session.expressGenerationError,
      session: sanitizedSession,
    }
  }
  if (session.expressGenerationCancelled) {
    return {
      status: 'CANCELLED',
      generationError: session.expressGenerationError,
      session: sanitizedSession,
    }
  }

  return {
    status: 'IDLE',
    session: sanitizedSession,
  };
}

export async function cancelPendingRenderForSession(userId, payload = {}) {
  const sessionId = payload?.id || payload?.sessionId;
  if (!sessionId) {
    throw new Error('Session id not provided');
  }

  await getDBConnectionString();

  const session = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });

  session.videoGenerationPending = false;
  session.expressGenerationPending = false;
  session.expressGenerationPaused = false;
  await session.save();

  // Remove queued render requests that have not started.
  await VideoGeneration.deleteMany({ videoSessionId: sessionId, rowLocked: false });

  return session;
}

export async function getVideoSessionById(sessionId) {
  await getDBConnectionString();
  const session = await VideoSession.findOne({ _id: sessionId });
  return session;
}

export async function getSessionById(sessionId) {
  return getVideoSessionById(sessionId);
}

export async function createNewAudioLayer(sessionPayload) {
  const { sessionId, prompt, generationType, volume = 100, defaultSelected,
    isEnabled, model, duration, speaker, provider, speakerCharacterName,
    instructions, generationMeta, languageCode, languageCodes, speakerVoiceId, speakerLabel,
    speakerDetails, startTime, audioBindingMode, bindToLayer, studioSpeechGeneration
  } = sessionPayload;
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ _id: sessionId });

  if (!videoSession) {
    throw new Error("Session not found");
  }

  const parsedStartTime = Number(startTime);
  const hasExplicitStartTime = Number.isFinite(parsedStartTime) && parsedStartTime >= 0;
  const parsedDuration = Number(duration);
  const audioLayerPayload = {
    prompt: prompt,
    generationType: generationType,
    volume: volume,
    defaultSelected: defaultSelected,
    isEnabled: isEnabled,
    model: model,
    duration: duration,
    speaker,
    provider,
    languageCode,
    languageCodes,
    speakerVoiceId,
    speakerLabel,
    speakerDetails,
    speakerCharacterName,
    instructions,
    generationMeta,
    audioBindingMode,
    bindToLayer,
    studioSpeechGeneration: Boolean(studioSpeechGeneration),
  };

  if (hasExplicitStartTime) {
    audioLayerPayload.startTime = parsedStartTime;

    if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
      audioLayerPayload.endTime = parsedStartTime + parsedDuration;
    }
  }

  // Create the new audio layer object
  const newAudioLayer = applyAudioLayerManualVolumeDefaults(audioLayerPayload);


  // Check if audioLayers array exists, if not, initialize it
  if (!videoSession.audioLayers) {
    videoSession.audioLayers = [];
  }

  // Add the new audio layer to the audioLayers array
  videoSession.audioLayers.push(newAudioLayer);

  // Mark audio generation as pending
  videoSession.audioGenerationPending = true;

  // Save the updated video session data
  const updatedVideoSession = await videoSession.save();

  // Retrieve the newly added audio layer
  const audioLayerData = updatedVideoSession.audioLayers[updatedVideoSession.audioLayers.length - 1];


  // Return the ID of the newly added audio layer
  const audioLayerId = audioLayerData._id.toString();


  return audioLayerId;
}

export async function createCompletedAudioLayer(sessionPayload) {

  const { sessionId, prompt, generationType, volume = 100, defaultSelected,
    isEnabled,
    selectedLocalAudioLink,
    localAudioLinks,
    generationStatus,
  } = sessionPayload;
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ _id: sessionId });

  if (!videoSession) {
    throw new Error("Session not found");
  }

  // Create the new audio layer object
  const newAudioLayer = applyAudioLayerManualVolumeDefaults({
    prompt: prompt,
    generationType: generationType,
    volume: volume,
    defaultSelected: defaultSelected,
    isEnabled: isEnabled,
    selectedLocalAudioLink: selectedLocalAudioLink,
    localAudioLinks: localAudioLinks,
    generationStatus: generationStatus,
  });

  // Check if audioLayers array exists, if not, initialize it
  if (!videoSession.audioLayers) {
    videoSession.audioLayers = [];
  }

  // Add the new audio layer to the audioLayers array
  videoSession.audioLayers.push(newAudioLayer);

  // Mark audio generation as pending
  videoSession.audioGenerationPending = true;

  // Save the updated video session data
  const updatedVideoSession = await videoSession.save();

  // Retrieve the newly added audio layer
  const audioLayerData = updatedVideoSession.audioLayers[updatedVideoSession.audioLayers.length - 1];

  // Return the ID of the newly added audio layer
  const audioLayerId = audioLayerData._id.toString();

  return audioLayerId;

}




export async function addAudioTrackToSession(payload) {

  const { sessionId, audioLayerId, trackIndex, startTime, volume, selectedSubtitleOption } = payload;

  await getDBConnectionString();
  const videoSession = await VideoSession.findById(sessionId);

  if (!videoSession) {
    throw new Error("Session not found");
  }

  const audioLayer = videoSession.audioLayers.find(layer => layer._id.toString() === audioLayerId);

  if (!audioLayer) {
    throw new Error("Audio layer not found");
  }
  const shouldAddSubtitles = audioLayer.generationType === 'speech'
    && resolveSessionSubtitlesEnabled(videoSession);

  const audioTrackIndex = parseInt(trackIndex);
  let sourceAudioLink = null;

  if (!audioLayer.localAudioLinks || audioLayer.localAudioLinks.length === 0) {
    const remoteAudioLink = audioLayer.remoteAudioLinks[audioTrackIndex];
    audioLayer.selectedRemoteAudioLink = remoteAudioLink;
    sourceAudioLink = remoteAudioLink;
  } else {
    const localAudioLink = audioLayer.localAudioLinks[audioTrackIndex];
    audioLayer.selectedLocalAudioLink = localAudioLink;
    sourceAudioLink = localAudioLink;
  }

  audioLayer.isEnabled = true;
  audioLayer.startTime = startTime;
  audioLayer.volume = volume;
  audioLayer.addSubtitles = shouldAddSubtitles;

  if (shouldTreatSpeechAsStudioUnbound(payload, audioLayer.generationType)) {
    clearAudioLayerBinding(audioLayer);
    audioLayer.audioBindingMode = 'unbounded';
    audioLayer.bindToLayer = false;
    audioLayer.studioSpeechGeneration = true;
  }

  if (audioLayer.generationType === 'music' && sourceAudioLink) {
    const musicTrackApplication = await resolveMusicTrackApplication({
      sessionData: videoSession,
      audioLayerId,
      sourceAudioLink,
      startTime: audioLayer.startTime,
      loopOverEntireSession: normalizeBooleanValue(payload.loopOverEntireSession),
      fallbackDuration: payload.duration ?? audioLayer.duration,
      filePrefix: 'session-music',
    });

    audioLayer.duration = musicTrackApplication.duration;
    audioLayer.endTime = musicTrackApplication.endTime;
    audioLayer.originalDuration = musicTrackApplication.originalDuration;
    audioLayer.selectedSubtitleOption = selectedSubtitleOption || "SUBTITLE";

    if (Array.isArray(musicTrackApplication.localAudioLinks) && musicTrackApplication.localAudioLinks.length > 0) {
      audioLayer.localAudioLinks = musicTrackApplication.localAudioLinks;
      audioLayer.selectedLocalAudioLink = musicTrackApplication.selectedLocalAudioLink;
    }

    if (normalizeBooleanValue(payload.loopOverEntireSession)) {
      audioLayer.fadeOnEdges = true;
      audioLayer.loopOverEntireSession = true;
    } else {
      audioLayer.loopOverEntireSession = false;
    }
  } else {
    if (payload.duration) {
      audioLayer.duration = payload.duration;
    }

    if (payload.endTime) {
      audioLayer.endTime = payload.endTime;
    } else {
      audioLayer.endTime = audioLayer.startTime + audioLayer.duration;
    }

    audioLayer.selectedSubtitleOption = selectedSubtitleOption || "SUBTITLE";
  }

  // Save the updated session data
  const sessionDataRes = await videoSession.save();

  // If subtitles are to be added, generate transcripts for the audio layer
  if (shouldAddSubtitles) {

    await generateTranscriptsForSessionAudioLayer(sessionId, audioLayer);

  }

  return {
    videoSession: sessionDataRes,
  };
}

export async function addAudioTrackListToSession(payload) {
  await getDBConnectionString();

  const { sessionId, audioLayers } = payload;

  // Retrieve the session
  const videoSession = await VideoSession.findById(sessionId);

  if (!videoSession) {
    throw new Error("Session not found");
  }
  const sessionSubtitlesEnabled = resolveSessionSubtitlesEnabled(videoSession);

  // Iterate over each audio layer in the payload
  for (let audioLayerPayload of audioLayers) {
    const {
      audioLayerId,
      startTime,
      duration,
      endTime,
      volume,
      selectedSubtitleOption,
    } = audioLayerPayload;

    // Find the existing audio layer in the session using the ID
    let audioLayer = videoSession.audioLayers.find(
      (layer) => layer._id.toString() === audioLayerId
    );

    if (!audioLayer) {
      throw new Error(`Audio layer with id ${audioLayerId} not found`);
    }
    const shouldAddSubtitles = audioLayer.generationType === 'speech' && sessionSubtitlesEnabled;

    // Update the properties of the existing audio layer
    audioLayer.isEnabled = true;
    audioLayer.defaultSelected = true;
    audioLayer.startTime = startTime;
    audioLayer.duration = duration;
    audioLayer.endTime = endTime;
    audioLayer.volume = volume;
    audioLayer.addSubtitles = shouldAddSubtitles;
    audioLayer.selectedSubtitleOption = selectedSubtitleOption || "SUBTITLE";
    audioLayer.selectedLocalAudioLink = audioLayer.localAudioLinks[0];

    if (shouldTreatSpeechAsStudioUnbound(audioLayerPayload, audioLayer.generationType)) {
      clearAudioLayerBinding(audioLayer);
      audioLayer.audioBindingMode = 'unbounded';
      audioLayer.bindToLayer = false;
      audioLayer.studioSpeechGeneration = true;
    }

    // Request to generate transcripts if 'addSubtitles' is true
  }





  // Save the updated video session
  // Saving the session does not change existing IDs
  const ssessionSaveRes = await videoSession.save();


  const updatedAudioLayers = ssessionSaveRes.audioLayers;


  for (let audioLayer of updatedAudioLayers) {
    // If subtitles are to be added, generate transcripts for the audio layer
    if (audioLayer.addSubtitles && audioLayer.generationType === 'speech') {
      await generateTranscriptsForSessionAudioLayer(sessionId, audioLayer);
    }

  }

}



export async function updateAllAudioLayersForSession(userId, payload) {
  let { sessionId, audioLayers } = payload;

  await getDBConnectionString();

  const normalizedAudioLayers = normalizeAudioLayerArrayManualVolumeSettings(audioLayers);

  const audioLayerIdsToBeUpdated = normalizedAudioLayers.map(function (audioLayer) {
    if (audioLayer.isDirty) {
      return audioLayer._id.toString();
    } else {
      return null;
    }
  }).filter(Boolean);

  await VideoSession.updateOne({
    _id: sessionId
  }, {
    $set: {
      audioLayers: normalizedAudioLayers,
    }
  });

  const session = await VideoSession.findById(sessionId);
  const lipSyncReconciliation = reconcileOrphanedLipSyncGenerationState(session);
  if (lipSyncReconciliation.changed) {
    await session.save();
  }
  const updatedAudioLayers = session.audioLayers || [];

  for (let audioLayer of updatedAudioLayers) {
    // If subtitles are to be added, generate transcripts for the audio layer
    if (audioLayerIdsToBeUpdated.includes(audioLayer._id.toString())) {
      if (audioLayer.addSubtitles && audioLayer.generationType === 'speech') {
        await regenerateTranscriptsForSessionAudioLayer(sessionId, audioLayer);
      }
    }
  }

  return {
    layers: session.layers || [],
    audioLayers: updatedAudioLayers
  };

}

export async function updateAudioLayersForSession(userId, payload) {
  let { sessionId, audioLayers, audioLayerId, } = payload;


  await getDBConnectionString();
  const normalizedAudioLayers = normalizeAudioLayerArrayManualVolumeSettings(audioLayers);
  const updatedAudioLayer = normalizedAudioLayers.find(layer => layer._id.toString() === audioLayerId);

  const session = await VideoSession.findById(sessionId);
  const existingAudioLayers = session.audioLayers || [];


  let updatedAudioLayers = existingAudioLayers;

  if (updatedAudioLayer) {



    updatedAudioLayers = existingAudioLayers.map(layer => {
      if (layer._id.toString() === audioLayerId) {

        return {
          ...layer,
          startTime: updatedAudioLayer.startTime,
          duration: updatedAudioLayer.duration,
          endTime: updatedAudioLayer.startTime + updatedAudioLayer.duration,
        };
      }
      return layer;
    });



    const updateRes = await VideoSession.updateOne(
      { _id: sessionId, 'audioLayers._id': audioLayerId },
      {
        $set: {
          'audioLayers.$.startTime': updatedAudioLayer.startTime,
          'audioLayers.$.duration': updatedAudioLayer.duration,
          'audioLayers.$.endTime': updatedAudioLayer.startTime + updatedAudioLayer.duration,
          'audioLayers.$.volume': updatedAudioLayer.volume,
          'audioLayers.$.manualVolumeAdjustmentEnabled': updatedAudioLayer.manualVolumeAdjustmentEnabled,
          'audioLayers.$.startVolume': updatedAudioLayer.startVolume,
          'audioLayers.$.endVolume': updatedAudioLayer.endVolume,
          'audioLayers.$.timestampedVolumes': updatedAudioLayer.timestampedVolumes,
          'audioLayers.$.isTimelineLocked': Boolean(updatedAudioLayer.isTimelineLocked),
        },
      }
    );



  } else {

    updatedAudioLayers = existingAudioLayers.filter(layer => layer._id.toString() !== audioLayerId);
    await VideoSession.updateOne(
      { _id: sessionId },
      { $pull: { audioLayers: { _id: audioLayerId } } }
    );

  }



  if (updatedAudioLayer && updatedAudioLayer.addSubtitles) {



    await regenerateTranscriptsForSessionAudioLayer(sessionId, updatedAudioLayer);

  } else if (!updatedAudioLayer) {
    // remove subtittles

    await removeTranscriptsForSessionAudioLayer(sessionId, audioLayerId);
  }

  const latestSessionData = await VideoSession.findById(sessionId);
  const lipSyncReconciliation = reconcileOrphanedLipSyncGenerationState(latestSessionData);
  if (lipSyncReconciliation.changed) {
    await latestSessionData.save();
  }

  const latestAudioLayers = latestSessionData.audioLayers || [];

  const sessionLayers = latestSessionData.layers || [];
  return {
    layers: sessionLayers,
    audioLayers: latestAudioLayers
  };
}


export async function addNewLayerToSession(userId, payload) {
  const {
    sessionId,
    duration,
    position,         // "below", "end", or "beginning"
    currentLayerIndex // index of the layer after which we insert if position === "below"
  } = payload;

  await getDBConnectionString();

  // 1) Retrieve the session
  const videoSession = await VideoSession.findById(sessionId);
  if (!videoSession) {
    throw new Error("Session not found");
  }

  const layers = videoSession.layers || [];

  // 2) Create a new "Session" sub-document for the layer
  const newSessionData = {
    userId,
    generations: [],
    activeSelectedImage: '',
    activeGeneratedImage: '',
    activeEditedImage: '',
    generationStatus: 'INITIAL',
    editStatus: '',
    witnesses: [],
    intermediates: [],
    lastWitnessSavedAt: null,
    generationError: null,
    editError: '',
    prompt: '',
    activeItemList: [],
    previousActiveItemList: null,
    canvasAnimations: [],
  };

  // 3) Create a new layer object
  const newLayer = {
    _id: new mongoose.Types.ObjectId(), // ensure we have a new ObjectId
    imageSession: newSessionData,
    prompt: '',
    status: 'initial',
    duration: duration,
    durationOffset: 0,           // Will recalc below
    frameGenerationPending: true // Mark the new layer to regen frames
  };

  // 4) Insert the new layer into the layers array based on `position`
  if (position === 'below') {
    // Insert after the currentLayerIndex
    // (e.g., if currentLayerIndex=0, the new layer becomes layer at index=1)
    if (typeof currentLayerIndex !== 'number' || currentLayerIndex < 0 || currentLayerIndex >= layers.length) {
      throw new Error("Invalid currentLayerIndex for 'below' insertion");
    }
    layers.splice(currentLayerIndex + 1, 0, newLayer);
  } else if (position === 'beginning') {
    // Place the new layer at the start
    layers.unshift(newLayer);
  } else {
    // Default to "end"
    layers.push(newLayer);
  }

  // 5) Recompute durationOffset for all layers in the new order
  let runningOffset = 0;
  for (let i = 0; i < layers.length; i++) {
    layers[i].durationOffset = runningOffset;
    runningOffset += layers[i].duration;

    // Mark frame generation pending so the frames get refreshed
    layers[i].frameGenerationPending = true;
  }

  // 6) Mark the entire session as needing frame regeneration
  videoSession.frameGenerationPending = true;
  videoSession.layers = layers;

  // 7) Save the updated session
  let updatedVideoSession = await videoSession.save();

  // 8) Find the newly inserted layer from the updated session to return
  const updatedLayerIndex = updatedVideoSession.layers.findIndex(
    (lyr) => lyr._id.toString() === newLayer._id.toString()
  );
  const updatedLayer = updatedVideoSession.layers[updatedLayerIndex];

  let updatedLayers = updatedVideoSession.layers || [];


  let audioLayers = updatedVideoSession.audioLayers || [];

  const speechAudioLayers = audioLayers.filter((audioLayer) => audioLayer.generationType === 'speech');

  for (let i = updatedLayerIndex + 1; i < updatedLayers.length; i++) {
    updatedLayers[i].frameGenerationPending = true;
  }
  const totalDuration = recalculateLayerOffsetsAndConnectedAudio(updatedLayers, audioLayers);
  updatedVideoSession.totalDuration = totalDuration;
  updatedVideoSession.frameGenerationPending = true;

  await VideoSession.updateOne({
    _id: sessionId,
  }, {
    $set: {
      layers: updatedLayers,
      audioLayers: audioLayers,
      totalDuration,
      frameGenerationPending: true,
    }
  });


  await generateTranscriptsForSessionAudioLayers(sessionId, speechAudioLayers);

  return {
    session: updatedVideoSession,
    layer: updatedLayer,
  };
}



export async function copyLayerInSession(userId, payload) {
  const { sessionId, newLayer, index } = payload;
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ _id: sessionId });

  if (!videoSession) {
    throw new Error("Session not found");
  }

  // Create a deep copy of the new layer and assign a new ID
  const copiedLayer = {
    ...newLayer,
    _id: new mongoose.Types.ObjectId(),
    durationOffset: videoSession.layers.slice(0, index).reduce((acc, layer) => acc + layer.duration, 0),
    frameGenerationPending: true,
  };

  // Insert the copied layer at the specified index
  videoSession.layers.splice(index, 0, copiedLayer);

  for (let i = index; i < videoSession.layers.length; i++) {
    videoSession.layers[i].frameGenerationPending = true;
  }
  const totalDuration = recalculateLayerOffsetsAndConnectedAudio(
    videoSession.layers,
    videoSession.audioLayers || [],
  );
  videoSession.totalDuration = totalDuration;
  videoSession.frameGenerationPending = true;

  // Save the updated video session to the database
  const updatedVideoSession = await videoSession.save();
  return {
    videoSession: updatedVideoSession,
    newLayer: copiedLayer,
  };
}

export async function removeLayerInSession(userId, payload) {
  const { sessionId, layerId } = payload;

  await getDBConnectionString();

  // 1) Load the session
  const videoSession = await VideoSession.findOne({ _id: sessionId });
  if (!videoSession) {
    throw new Error("Session not found");
  }

  // 2) Find the layer index
  const layerIndex = videoSession.layers.findIndex(
    (layer) => layer._id.toString() === layerId
  );
  if (layerIndex === -1) {
    throw new Error("Layer not found");
  }

  // 3) Remove the layer
  videoSession.layers.splice(layerIndex, 1);

  // 4) Remove all audio tied to this layer, and shift index-only links
  //    before the shared timeline recalculation reattaches them by layer id.
  videoSession.audioLayers = Array.isArray(videoSession.audioLayers)
    ? videoSession.audioLayers.filter((audioLayer) => {
      const connectedLayerId = audioLayer?.connectedLayerId?.toString?.() || audioLayer?.connectedLayerId || null;
      const connectedLayerIndex = Number(audioLayer?.connectedLayerIndex);

      if (connectedLayerId === layerId) {
        return false;
      }

      if (!connectedLayerId && Number.isInteger(connectedLayerIndex)) {
        if (connectedLayerIndex === layerIndex) {
          return false;
        }
        if (connectedLayerIndex > layerIndex) {
          audioLayer.connectedLayerIndex = connectedLayerIndex - 1;
        }
      }

      return true;
    })
    : [];

  for (let i = layerIndex; i < videoSession.layers.length; i++) {
    videoSession.layers[i].frameGenerationPending = true;
  }
  const pendingFrameRefreshLayerIds = videoSession.layers
    .filter((layer) => layer?.frameGenerationPending)
    .map((layer) => layer?._id?.toString?.())
    .filter(Boolean);

  videoSession.totalDuration = recalculateLayerOffsetsAndConnectedAudio(
    videoSession.layers,
    videoSession.audioLayers || [],
  );

  // 7) Mark the session to regenerate frames
  videoSession.frameGenerationPending = true;

  // 8) Save the updated video session
  await videoSession.save();

  // 9) Clean up any frame data for the removed layer
  await deleteAllFramesForLayer(sessionId, layerId);
  await deleteUnlockedStaleFrameGenerations(sessionId, pendingFrameRefreshLayerIds);
  await ensureUnlockedFrameGenerations(sessionId, pendingFrameRefreshLayerIds);
  await requestRealignConnectedAudioLayersToLayers(sessionId);
  const updatedVideoSession = await VideoSession.findOne({ _id: sessionId });

  return {
    videoSession: updatedVideoSession,
  };
}





export async function updateSessionDefaults(userId, payload) {
  const { sessionId, defaults: {

    basicTextTheme,
    parentJsonTheme,
    derivedJsonTheme,
    defaultSceneDuration,
    applyAudioDucking,
    sceneTransitionPreset,
  } } = payload;
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ _id: sessionId });

  if (!videoSession) {
    throw new Error("Session not found");
  }
  if (derivedJsonTheme) {
    videoSession.derivedJsonTheme = derivedJsonTheme;
  } else if (parentJsonTheme) {
    videoSession.parentJsonTheme = parentJsonTheme;
  } else if (basicTextTheme) {
    videoSession.basicTextTheme = basicTextTheme;
  }

  if (defaultSceneDuration !== undefined) {
    videoSession.defaultSceneDuration = parseFloat(defaultSceneDuration);
  }

  if (typeof applyAudioDucking === 'boolean') {
    const previousApplyAudioDucking = videoSession.applyAudioDucking;
    videoSession.applyAudioDucking = applyAudioDucking;
  }

  if (sceneTransitionPreset !== undefined) {
    videoSession.sceneTransitionPreset = normalizeSceneTransitionPreset(sceneTransitionPreset);
  }


  const updatedVideoSession = await videoSession.save();
  return {
    videoSession: updatedVideoSession,
  };
}

export async function addLayersViaPromptList(userId, payload) {
  const { sessionId, promptList, duration, aspectRatio, model } = payload;
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ _id: sessionId });

  if (!videoSession) {
    throw new Error("Session not found");
  }

  const durationPerScene = duration ? duration : videoSession.defaultSceneDuration;

  const userData = await User.findOne({ _id: userId });

  const userGenerationModel = normalizeInferenceModel(userData?.selectedInferenceModel);


  if (!promptList || promptList.length === 0) {
    throw new Error("Prompt list is empty");
  }

  if (promptList.length > 100) {
    throw new Error("Too many prompts");
  }


  const userCredits = userData.generationCredits;
  if (userCredits < promptList.length) {
    throw new Error("Insufficient credits");
  }

  const derivedJsonTheme = videoSession.derivedJsonTheme;
  const parentJsonTheme = videoSession.parentJsonTheme;
  const basicTextTheme = videoSession.basicTextTheme;
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  // Prepare updates for prompts applying theme
  const updatedPrompts = await Promise.all(promptList.map(async (prompt) => {
    let updatedPrompt = prompt;



    if (derivedJsonTheme && derivedJsonTheme.length > 0) {
      updatedPrompt = await updatePromptWithTheme(prompt, derivedJsonTheme, aspectRatio,
        false, userGenerationModel, videoTone);
    } else if (parentJsonTheme && parentJsonTheme.length > 0) {
      updatedPrompt = await updatePromptWithTheme(prompt, parentJsonTheme, aspectRatio,
        false, userGenerationModel, videoMode);

    } else if (basicTextTheme && basicTextTheme.length > 0) {
      updatedPrompt = `${prompt} ${basicTextTheme}`;
    }

    return updatedPrompt;
  }));

  let totalExistingDuration = videoSession.layers.reduce((acc, layer) => acc + layer.duration, 0);

  // Create Session documents for each prompt
  const layers = updatedPrompts.map((prompt, index) => {
    const durationOffset = totalExistingDuration + (index * durationPerScene);
    const newSession = {
      userId,
      generations: [],
      activeSelectedImage: '',
      activeGeneratedImage: '',
      activeEditedImage: '',
      generationStatus: 'PENDING',
      prompt: prompt,
    };

    return {
      imageSession: newSession,
      prompt: prompt,
      status: "pending",
      duration: durationPerScene,
      durationOffset: durationOffset,
    };
  });

  videoSession.layers = videoSession.layers.concat(layers);

  const updatedVideoSession = await videoSession.save();

  const contentFilterRating = userData.contentFilterRating;

  const generationRequests = updatedVideoSession.layers.slice(-promptList.length).map(async (layer) => {
    const generationPayload = {
      videoSessionId: sessionId,
      layerId: layer._id.toString(),
      prompt: layer.prompt,
      model: model,
      userId: userId,
      isBatchGeneration: true,
      aspectRatio: aspectRatio,
      contentFilterRating: contentFilterRating,
    };
    await addImageGeneratorRequest(userId, generationPayload);
  });

  await Promise.all(generationRequests);
  return {
    videoSession: updatedVideoSession,
  };
}

export async function fetchLatetstGuestSession() {
  await getDBConnectionString();

  const videoSession = await VideoSession.findOne({ isGuestSession: true }).sort({ createdAt: -1 });
  return sanitizeGuestSessionPayload(videoSession);
}

function normalizeGuestMediaAssetKey(value) {
  const rawValue = normalizeOptionalString(value);
  if (!rawValue) {
    return '';
  }

  const withoutQuery = rawValue.split('?')[0].split('#')[0];
  const decodedValue = withoutQuery
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');

  return decodedValue.replace(/^\/+/, '');
}

function getGuestMediaContentType(assetKey, fallbackContentType = '') {
  const normalizedFallback = normalizeOptionalString(fallbackContentType);
  if (normalizedFallback) {
    return normalizedFallback;
  }

  const extension = path.extname(assetKey || '').toLowerCase();
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.m4a') return 'audio/mp4';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function parseGuestMediaByteRange(range, size) {
  const normalizedRange = normalizeOptionalString(range);
  if (!normalizedRange) {
    return null;
  }
  const match = normalizedRange.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) {
    const error = new Error('Invalid media byte range.');
    error.statusCode = 416;
    throw error;
  }

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      const error = new Error('Invalid media byte range.');
      error.statusCode = 416;
      throw error;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    const error = new Error('Requested media byte range is not satisfiable.');
    error.statusCode = 416;
    throw error;
  }
  return { start, end: Math.min(end, size - 1) };
}

async function buildLocalGuestMediaObject(assetKey, range = '') {
  const candidatePath = resolveLocalMediaFilePath(assetKey);
  if (!candidatePath) {
    return null;
  }

  const assetsV2Root = path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2');
  try {
    const [realRoot, realPath] = await Promise.all([
      fsPromises.realpath(assetsV2Root),
      fsPromises.realpath(candidatePath),
    ]);
    if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
      return null;
    }
    const stats = await fsPromises.stat(realPath);
    if (!stats.isFile() || stats.size <= 0) {
      return null;
    }
    const byteRange = parseGuestMediaByteRange(range, stats.size);
    const streamOptions = byteRange
      ? { start: byteRange.start, end: byteRange.end }
      : undefined;
    return {
      stream: fs.createReadStream(realPath, streamOptions),
      assetKey,
      fileName: path.basename(assetKey),
      contentType: getGuestMediaContentType(assetKey),
      contentLength: byteRange
        ? byteRange.end - byteRange.start + 1
        : stats.size,
      contentRange: byteRange
        ? `bytes ${byteRange.start}-${byteRange.end}/${stats.size}`
        : undefined,
      acceptRanges: 'bytes',
      statusCode: byteRange ? 206 : 200,
    };
  } catch (error) {
    if (error?.statusCode === 416) {
      throw error;
    }
    return null;
  }
}

export async function getGuestSessionMediaObject(payload = {}) {
  await getDBConnectionString();

  const sessionId = normalizeOptionalString(payload.sessionId);
  const assetKey = normalizeGuestMediaAssetKey(payload.assetKey);
  const range = normalizeOptionalString(payload.range);

  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    const error = new Error('Invalid guest session id.');
    error.statusCode = 400;
    throw error;
  }

  if (!isSessionScopedSecureMediaPath(assetKey, sessionId)) {
    const error = new Error('Guest media asset is not available for this session.');
    error.statusCode = 403;
    throw error;
  }

  const guestSession = await VideoSession.exists({
    _id: sessionId,
    isGuestSession: true,
  });
  if (!guestSession) {
    const error = new Error('Guest session not found.');
    error.statusCode = 404;
    throw error;
  }

  if (shouldUseDockerLocalMediaDelivery()) {
    const localMediaObject = await buildLocalGuestMediaObject(assetKey, range);
    if (localMediaObject) {
      return localMediaObject;
    }
    const error = new Error('Guest media asset was not found in mounted Docker storage.');
    error.statusCode = 404;
    throw error;
  }

  try {
    const response = await getObjectFromS3({
      bucketName: MEDIA_BUCKET_NAME,
      key: assetKey,
      range: range || null,
    });

    return {
      stream: response.Body,
      assetKey,
      fileName: path.basename(assetKey),
      contentType: getGuestMediaContentType(assetKey, response.ContentType),
      contentLength: response.ContentLength,
      contentRange: response.ContentRange,
      acceptRanges: response.AcceptRanges || 'bytes',
      statusCode: response.ContentRange ? 206 : 200,
    };
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      error.statusCode = 404;
    } else if (error?.$metadata?.httpStatusCode === 416) {
      error.statusCode = 416;
    }
    throw error;
  }
}

export async function getGuestSessionDetails(payload) {
  await getDBConnectionString();
  const { id } = payload;
  const videoSession = await VideoSession.findOne({ _id: id, isGuestSession: true });
  return sanitizeGuestSessionPayload(videoSession);
}

export async function getOrCreateSession(userId) {
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ userId }).sort({ createdAt: -1 });

  if (videoSession) {
    return videoSession;
  }

  const newSession = {
    userId,
    generations: [],
    activeSelectedImage: '',
    activeGeneratedImage: '',
    activeEditedImage: '',
    generationStatus: '',
    editStatus: '',
    witnesses: [],
    intermediates: [],
    lastWitnessSavedAt: null,
    generationError: null,
    editError: '',
    generationStatus: 'INIT',
    prompt: '',
  };

  const duration = 2;

  const layerPayload = {
    imageSession: newSession,
    prompt: '',
    status: "pending",
    duration: duration,
    durationOffset: 0,
  };
  const initLayerList = [layerPayload];
  const framesPerSecond = await getUserFramesPerSecond(userId);
  const newVideoSession = new VideoSession({
    userId,
    promptList: [],
    layers: initLayerList,
    basicTextTheme: '',
    defaultSceneDuration: duration,
    expressGenerationPending: false,
    framesPerSecond,
  });

  // Save the VideoSession document to the database
  const savedVideoSession = await newVideoSession.save({});
  return savedVideoSession;
}

export async function getSession(userId) {
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({ userId }).sort({ createdAt: -1 });

  if (videoSession) {
    return videoSession;
  }
}


export async function requestGenerateMask(userId, payload) {
  await getDBConnectionString();
  const { sessionId, layerId, maskType } = payload;

  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });

  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  let layer = sessionDataValue.layers.find(layer => layer._id.toString() === layerId);

  const random_string = hat();
  // Generate a new image name and upload the image
  const imageName = `${sessionId}_${random_string}.png`;
  const imageData = payload.image;

  const imageFile = await uploadImageToFileSystem(imageData, imageName, sessionId);
  const imagePath = getRelativeAssetPathFromAbsolute(imageFile);
  layer.objectSelectBaseImage = imagePath;
  layer.maskGenerationPending = true;
  layer.objectSelectMaskImage = null;
  layer.maskImagePath = null;
  sessionDataValue.maskGenerationPending = true;

  await sessionDataValue.save();
}

export async function getVideoSessionMaskGenerationStatus(sessionId) {
  await getDBConnectionString();
  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (sessionDataValue.maskGenerationPending) {
    return {
      status: 'PENDING'
    }
  } else {
    return {
      status: 'COMPLETED',
      session: sessionDataValue
    }
  }
}


export async function getUserSessionList(
  userId,
  page,
  limit,
  renderType = 'All',
  aspectRatio = 'All',
  publishedStatus = 'All',
  completionStatus = 'All'
) {
  await getDBConnectionString();

  try {
    page = Number.isFinite(page) && page > 0 ? page : 1;
    limit = Number.isFinite(limit) && limit > 0 ? limit : 10;

    // Build our filter query
    const normalizedUserId = toUserIdString(userId);
    const query = {
      $and: [
        {
          $or: [
            { userId },
            { editableShareImportedUserIds: normalizedUserId },
          ],
        },
        // View Projects is for composed projects, not transient one-layer
        // requests created by external or per-scene generation flows. Keep
        // this rule in the database query so pagination totals stay aligned.
        { 'layers.1': { $exists: true } },
        // Only explicit video projects belong on View Projects. Legacy
        // records with a missing/null sessionType can represent image/scene
        // documents and must never be promoted to project tiles.
        { sessionType: 'video' },
      ],
    };

    const completedVideoQuery = {
      $or: [
        { videoLink: { $exists: true, $nin: [null, ''] } },
        { remoteURL: { $exists: true, $nin: [null, ''] } },
        { publishedVideoURL: { $exists: true, $nin: [null, ''] } },
      ],
    };
    const incompleteVideoQuery = {
      $and: [
        { videoLink: { $in: [null, ''] } },
        { remoteURL: { $in: [null, ''] } },
        { publishedVideoURL: { $in: [null, ''] } },
      ],
    };

    // Handle renderType filtering
    // Keep the legacy filter, but include remote render URLs as completed too.
    if (renderType === 'Rendered') {
      query.$and.push(completedVideoQuery);
    } else if (renderType === 'Pending') {
      query.$and.push(incompleteVideoQuery);
    }

    // Handle aspectRatio filtering at the project/session level. A small
    // number of legacy projects used aspect_ratio, so support that field too;
    // do not filter on layers because layers are not top-level projects.
    const normalizedAspectRatio = normalizeOptionalString(aspectRatio);
    if (normalizedAspectRatio && normalizedAspectRatio !== 'All') {
      query.$and.push({
        $or: [
          { aspectRatio: normalizedAspectRatio },
          { aspect_ratio: normalizedAspectRatio },
        ],
      });
    }

    // Handle published/unpublished filtering. Missing legacy values are
    // treated as unpublished, matching the schema default.
    if (publishedStatus === 'Published') {
      query.$and.push({ ispublishedVideo: true });
    } else if (publishedStatus === 'Unpublished') {
      query.$and.push({
        $or: [
          { ispublishedVideo: false },
          { ispublishedVideo: { $exists: false } },
        ],
      });
    }

    // Handle explicit completion filtering. A completed project has a usable
    // rendered URL, while unpublished/idle/failed projects are not completed.
    if (completionStatus === 'Completed') {
      query.$and.push(completedVideoQuery);
    } else if (completionStatus === 'NotCompleted') {
      query.$and.push(incompleteVideoQuery);
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Count total for pagination info
    const total = await VideoSession.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    // Fetch the sessions
    const sessionList = await VideoSession.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Transform data as needed
    const sessionData = sessionList
      .map((session, idx) => {
        if (!session.layers || session.layers.length === 0) {
          return null;
        }
        const sessionId = session._id.toString();
        const sessionOwnerId = toUserIdString(session.userId);
        const isSessionOwnerForViewer = Boolean(sessionOwnerId && normalizedUserId && sessionOwnerId === normalizedUserId);
        const isImportedSessionForViewer = Boolean(
          !isSessionOwnerForViewer &&
          session.editableShareEnabled === true &&
          hasImportedEditableSession(session, normalizedUserId)
        );
        const sessionName = normalizeSessionText(session.sessionName, MAX_SESSION_NAME_LENGTH);
        const sessionDescription = normalizeSessionText(
          session.sessionDescription,
          MAX_SESSION_DESCRIPTION_LENGTH
        );

        const thumbnailPayload = buildSessionListThumbnailPayload(session, sessionId);
        const isCompleted = Boolean(
          [session.videoLink, session.remoteURL, session.publishedVideoURL]
            .some((value) => typeof value === 'string' && value.trim())
        );

        return {
          recordType: 'session',
          sessionType: 'video',
          layerCount: session.layers.length,
          name: sessionName || `Session ${idx}`,
          sessionName,
          sessionDescription,
          id: session._id,
          thumbnail: thumbnailPayload.thumbnail,
          thumbnailUrl: thumbnailPayload.thumbnailUrl,
          thumbnailUrls: thumbnailPayload.thumbnailUrls,
          previewImageUrl: thumbnailPayload.thumbnailUrl,
          isExpressGeneration: Boolean(session.isExpressGeneration),
          expressGenerationType: session.expressGenerationType || null,
          aspectRatio: getFirstNonEmptyString(session.aspectRatio, session.aspect_ratio) || '1:1',
          isPublished: Boolean(session.ispublishedVideo),
          ispublishedVideo: Boolean(session.ispublishedVideo),
          isCompleted,
          sessionOwnerId,
          isSessionOwner: isSessionOwnerForViewer,
          isImportedSession: isImportedSessionForViewer,
        };
      })
      .filter(Boolean);

    return {
      data: sessionData,
      total,
      totalPages,
      currentPage: page,
      pageSize: limit,
    };
  } catch (e) {
    console.error(e);
    throw e;
  }
}




export async function requestGenerateSegmentationForMask(payload) {
  const URL = `${IMAGE_SERVER}/segmentation_image`;

  try {
    const response = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const resData = await response.json();
    return resData;
  } catch (e) {
    console.error("Error sending segmentation request", e);
  }
}

export async function updateSessionLayers(payload) {
  let { sessionId, layers, audioLayers, sessionUpdates } = payload;

  let layerPayload = layers.map((layer) => {
    return {
      ...layer,
      frameGenerationPending: true,
    }
  });

  if (sessionUpdates?.enableSubtitles === false) {
    layerPayload = layerPayload.map((layer) => {
      const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
        ? layer.imageSession.activeItemList
        : null;

      if (!activeItemList || activeItemList.length === 0) {
        return layer;
      }

      return {
        ...layer,
        imageSession: {
          ...layer.imageSession,
          activeItemList: activeItemList.filter(
            (item) => !(item?.type === 'text' && item?.subType === 'subtitle')
          ),
        },
      };
    });
  }
  await getDBConnectionString();

  let videoSessionData = await VideoSession.findOne({ _id: sessionId }).populate({
    path: 'layers.imageSession',
    model: 'Session'
  });

  if (!videoSessionData) {
    throw new Error("Session not found");
  }

  videoSessionData.layers = layerPayload;
  if (Array.isArray(audioLayers)) {
    const nextAudioLayers = sessionUpdates?.enableSubtitles === false
      ? audioLayers.map((audioLayer) => (
        String(audioLayer?.generationType || '').toLowerCase() === 'speech'
          ? { ...audioLayer, addSubtitles: false }
          : audioLayer
      ))
      : audioLayers;
    videoSessionData.audioLayers = normalizeAudioLayerArrayManualVolumeSettings(nextAudioLayers);
  }

  if (sessionUpdates && typeof sessionUpdates === 'object') {
    [
      'enableSubtitles',
      'hasSubtitles',
      'has_subtitles',
      'transcriptGenerationPending',
      'frameGenerationPending',
    ].forEach((field) => {
      if (typeof sessionUpdates[field] === 'boolean') {
        videoSessionData[field] = sessionUpdates[field];
      }
    });
  }

  const updatedVideoSession = await videoSessionData.save();

  // Start frame generation for all layers
  // for (let layer of updatedVideoSession.layers) {
  //   await deleteUnlockedFrameGenerations(sessionId, layer._id.toString());


  //   const frameGenerationPayload = new FrameGeneration({
  //     sessionId: sessionId,
  //     layerId: layer._id.toString(),
  //   });
  //   await frameGenerationPayload.save();
  // }

  return updatedVideoSession;
}


export async function requestGenerateLayeredSpeechAndGenerateFrames(userId, data) {


  const { videoSessionId } = data;

  // const newSessionResponse = await refreshFramesForSession(videoSessionId);

  const newLayers = newSessionResponse.layers;


  await updateFrameGenerationForLayers(videoSessionId, newLayers);

  return newSessionResponse;


}

export async function requestGenerateLayeredSpeech(userId, data, updateCredits = true) {
  const {
    generationType,
    speaker,
    promptList,
    subtitlesList,
    fontSize,
    fontColor,
    fontFamily,
    backgroundColor,
    videoSessionId,
    subtitlesLanguage,
    addSubtitlesRequired,
    ttsProvider,
    aspectRatio,
    subtitleFont,
    subtitleWordAnimation,
    languageCode,
    languageCodes,
    speakerVoiceId,
    speakerLabel,
    speakerDetails,
    audioBindingMode,
    bindToLayer,
    studioSpeechGeneration,
  } = data;
  const shouldCreateUnboundStudioSpeech = shouldTreatSpeechAsStudioUnbound(
    { audioBindingMode, bindToLayer, studioSpeechGeneration },
    generationType,
  );

  await getDBConnectionString();



  // Retrieve only the layers from the session to minimize data fetching
	  const sessionData = await VideoSession.findOne({ _id: videoSessionId }, { layers: 1, sessionLanguage: 1 });
	  if (!sessionData) {
	    throw new Error('Video session not found');
	  }
	  const resolvedSpeechLanguageCode =
	    (typeof languageCode === 'string' && languageCode.trim())
	      ? languageCode.trim()
	      : (typeof sessionData.sessionLanguage === 'string' && sessionData.sessionLanguage.trim()
	        ? sessionData.sessionLanguage.trim()
	        : undefined);

  const sessionLayers = sessionData.layers;
  const layersLength = sessionLayers.length;
  const requestedAudioLayersLength = promptList.length;

  if (layersLength < requestedAudioLayersLength) {
    throw new Error('Number of prompts exceeds number of video layers');
  }

  // Create an array of new audio layers to be added
  const audioGenerationPayload = [];

  for (let index = 0; index < requestedAudioLayersLength; index++) {
    const prompt = promptList[index];
    const sessionLayer = sessionLayers[index];

    const audioLayer = applyAudioLayerManualVolumeDefaults({
      prompt: prompt,
      generationType,
      duration: sessionLayer.duration,
      startTime: sessionLayer.durationOffset,
      generationStatus: 'PENDING',
      isEnabled: false,
      volume: 100,
      defaultSelected: false,
      speaker,
      provider: ttsProvider,
      languageCode: resolvedSpeechLanguageCode,
      languageCodes,
      speakerVoiceId,
      speakerLabel,
      speakerDetails,
      subtitleFont: subtitleFont,
      subtitleWordAnimation: subtitleWordAnimation,
      ...(shouldCreateUnboundStudioSpeech
        ? {
            audioBindingMode: 'unbounded',
            bindToLayer: false,
            studioSpeechGeneration: true,
          }
        : {}),
    });
    audioGenerationPayload.push(audioLayer);
  }

  // Use findOneAndUpdate with $push to add new audio layers without modifying existing IDs
  const sessionSaveResponse = await VideoSession.findOneAndUpdate(
    { _id: videoSessionId },
    {
      $push: { audioLayers: { $each: audioGenerationPayload } },
      $set: { audioGenerationPending: true },
    },
    { new: true }
  );

  if (!sessionSaveResponse) {
    throw new Error('Failed to update audio layers');
  }

  // Retrieve the newly added audio layers based on their positions in the array
  const savedAudioLayers = sessionSaveResponse.audioLayers.slice(-promptList.length);

  // Request speech generation for each new audio layer
  const speechGenerationRequests = savedAudioLayers.map(async (layer) => {
    const generationPayload = {
      sessionId: videoSessionId,
      prompt: layer.prompt,
      generationType,
      speaker,
      duration: layer.duration,
      audioLayerId: layer._id.toString(),
      rowLocked: false,
      ttsProvider,
      languageCode: resolvedSpeechLanguageCode,
      languageCodes,
      speakerVoiceId,
      speakerLabel,
      speakerDetails,
      ...(shouldCreateUnboundStudioSpeech
        ? {
            audioBindingMode: 'unbounded',
            bindToLayer: false,
            studioSpeechGeneration: true,
          }
        : {}),
    };
    await updateCreditsAndCreateGenerateSpeechRequest(userId, generationPayload, updateCredits);
  });

  await Promise.all(speechGenerationRequests);

}



export async function requestGenerateTranscriptSpeech(userId, data, updateCredits = true) {
  const { videoSessionId, promptList, generationType, speaker, subtitlesList, subtitlesLanguage, addSubtitlesRequired,
    ttsProvider, subtitleWordAnimation, subtitleFont, languageCode, languageCodes, speakerVoiceId, speakerLabel,
    speakerDetails
  } = data;

  await getDBConnectionString();

  await VideoSession.updateOne({ _id: videoSessionId }, { $set: { transcriptGenerationPending: true } });

  const sessionData = await VideoSession.findOne({ _id: videoSessionId });
  const resolvedSpeechLanguageCode =
    (typeof languageCode === 'string' && languageCode.trim())
      ? languageCode.trim()
      : (typeof sessionData.sessionLanguage === 'string' && sessionData.sessionLanguage.trim()
        ? sessionData.sessionLanguage.trim()
        : undefined);

  const layers = sessionData.layers;

  let durationOffset = 0;

  const audioLayers = layers.map((layer, index) => {
    const audioLayer = applyAudioLayerManualVolumeDefaults({
      prompt: promptList[index],
      generationType,
      duration: layer.duration,
      startTime: durationOffset,
      generationStatus: 'PENDING',
      isEnabled: true,
      volume: 190,
      defaultSelected: true,
      speaker,
      provider: ttsProvider,
      languageCode: resolvedSpeechLanguageCode,
      languageCodes,
      speakerVoiceId,
      speakerLabel,
      speakerDetails,
      subtitleFont: subtitleFont,
      subtitleWordAnimation: subtitleWordAnimation,
    });
    durationOffset += layer.duration;
    return audioLayer;
  });

  sessionData.audioLayers = normalizeAudioLayerArrayManualVolumeSettings(audioLayers);
  sessionData.audioGenerationPending = true;

  const sessionResponse = await sessionData.save();


  // Request speech generation for each layer
  const speechGenerationRequests = layers.map(async (layer, index) => {
    const generationPayload = {
      sessionId: videoSessionId,
      prompt: promptList[index],
      generationType,
      speaker,
      duration: layer.duration,
      audioLayerId: sessionResponse.audioLayers[index]._id.toString(),
      rowLocked: false,
      ttsProvider,
      languageCode: resolvedSpeechLanguageCode,
      languageCodes,
      speakerVoiceId,
      speakerLabel,
      speakerDetails,
    };
    await updateCreditsAndCreateGenerateSpeechRequest(userId, generationPayload, updateCredits);
  });



  await VideoSession.updateOne(
    { _id: videoSessionId },
    {
      $set: {
        transcriptGenerationPending: false,
      }
    }
  );


  return;

  // Add speech generation request


  // const transcriptGenerations = await generateTranscriptForPromptList(promptList, subtitlesLanguage);


}




async function updateFrameGenerationForLayers(videoSessionId, newLayers) {

  for (let layer of newLayers) {
    await deleteUnlockedFrameGenerations(videoSessionId, layer._id.toString());

    const frameGenerationPayload = new FrameGeneration({
      sessionId: videoSessionId,
      layerId: layer._id.toString(),
    });
    await frameGenerationPayload.save();
  }
}


export async function validateSessionDetails(payload) {
  const { userId, sessionId } = payload;

  await getDBConnectionString();

  const videoSession = await VideoSession.findOne({ _id: sessionId });

  if (!videoSession) {
    throw new Error("Session not found");

  } else if (!isSessionOwner(videoSession, userId)) {
    throw new Error("Session not found");
  }

  return true;
}


export async function importIntroSessionToUser(userId, sessionId) {
  await getDBConnectionString();
  const videoSession = await VideoSession.findOne({
    _id: sessionId,
    isIntroSession: true
  });

  if (!videoSession) {
    throw new Error("Session not found");
  }

  let newLayers = videoSession.layers.map((layer) => {
    return {
      ...layer,
      _id: new mongoose.Types.ObjectId(),
      frameGenerationPending: true,
      frames: []
    }
  });


  const framesPerSecond = await getUserFramesPerSecond(userId);
  let newSession = new VideoSession({
    userId,
    promptList: [],
    layers: newLayers,
    basicTextTheme: '',
    defaultSceneDuration: videoSession.defaultSceneDuration,
    isIntroSession: false,
    frameGenerationPending: true,
    framesPerSecond,
  });

  const savedSession = await newSession.save();
  return savedSession;



}


const measureTextWidth = (char, fontSize) => {
  // A simple approximation where each character is half the font size
  // Replace this with a proper text width calculation using a canvas, etc.
  return fontSize / 2;
};

const splitTextIntoLines = (text, maxWidth, fontSize) => {

  if (!text) {
    return;
  }

  const words = text.split(' ');
  const lines = [];
  let currentLine = '';


  let actualMaxWidth = 0;

  words.forEach(word => {
    const testLine = currentLine + word + ' ';
    const testLineWidth = (testLine.length) * (fontSize / 2);

    if (testLineWidth > maxWidth) {
      actualMaxWidth = maxWidth;
      lines.push(currentLine.trim());
      currentLine = word + ' ';
    } else {
      if (testLineWidth > actualMaxWidth) {
        actualMaxWidth = testLineWidth;
      }
      currentLine = testLine;
    }
  });

  lines.push(currentLine.trim());
  return lines;
};






export async function setSessionLayerAiVideoGenerationPending(payload) {
  await getDBConnectionString();



  const { videoSessionId, currentLayerId, prompt, model } = payload;
  const existingSession = await VideoSession.findOne({ _id: videoSessionId });
  const existingLayer = existingSession?.layers?.find(
    (layer) => layer._id.toString() === currentLayerId
  );

  if (!existingLayer) {
    throw new Error('Layer or session not found');
  }
  if (existingLayer.userVideoGenerationPending || existingLayer.hasUserVideoLayer || existingLayer.userVideoLayer) {
    throw new Error('Remove the uploaded or pending video before generating AI video for this layer.');
  }

  let modelType = 'ai_video';
  const isSoundEffectGenerationRequest = SOUND_EFFECT_GENERATION_MODELS.includes(model) && Boolean(
    payload?.isAudioVideoGeneration === true ||
    payload?.isAudioVideoLayer === true ||
    payload?.videoUrl ||
    payload?.videoLink
  );
  if (LIPSYNC_MODELS.includes(model)) {
    // Canonicalize lip-sync-backed character scenes as "character".
    // Legacy sessions may still have "lip_sync" and are handled as fallback elsewhere.
    modelType = 'character';
  } else if (SOUND_EFFECT_MODELS.includes(model) || isSoundEffectGenerationRequest) {
    modelType = 'sound_effect';
  }



  // Use findOneAndUpdate to find and update the target layer's properties
  const sessionDataValue = await VideoSession.findOneAndUpdate(
    { _id: videoSessionId, "layers._id": currentLayerId }, // Find the document by sessionId and the layer by layerId
    {
      $set: {
        "layers.$.aiVideoGenerationPending": true,
        "layers.$.hasAiVideoLayer": true,
        "layers.$.videoGenerationPrompt": prompt,
        "layers.$.layerAiVideoType": modelType,
      }
    },
    { new: true } // Return the updated document
  );

  if (!sessionDataValue) {
    throw new Error('Layer or session not found');
  }

  // Return the updated session data
  return sessionDataValue;
}


export async function requestGenerateAIVideoByModel(userId, payload) {

  const { videoSessionId, currentLayerId, prompt } = payload;

  await getDBConnectionString();

  const existingSession = await VideoSession.findOne({ _id: videoSessionId });
  const existingLayer = existingSession?.layers?.find(
    (layer) => layer._id.toString() === currentLayerId
  );

  if (!existingLayer) {
    throw new Error('Layer or session not found');
  }
  if (existingLayer.userVideoGenerationPending || existingLayer.hasUserVideoLayer || existingLayer.userVideoLayer) {
    throw new Error('Remove the uploaded or pending video before generating AI video for this layer.');
  }



  if (prompt && prompt.length > 0) {
    const moderationResponse = await getModerationForNarrative(prompt);
    if (!moderationResponse) {
      throw new Error('Moderation failed');
    }
  }
  const aiVideoPayload = normalizeStudioAiVideoSourceFramePayload(payload, existingSession, existingLayer);
  await requestGenerateCustomAIVideo(userId, aiVideoPayload);

  const latestSessionData = await VideoSession.findOne({ _id: videoSessionId });

  const sanitizedSessionData = await sanitizeStudioSessionPayload(latestSessionData, { viewerUserId: userId });
  const layerData = sanitizedSessionData.layers.find(layer => layer._id.toString() === currentLayerId);

  const returnPayload = {
    session: sanitizedSessionData,
    layer: layerData
  }

  return returnPayload;


}


export async function getAIVideoRenderStatus(payload) {
  await getDBConnectionString();

  const { sessionId, layerId, aiVideoLayerType } = payload;
  const session = await VideoSession.findOne({ _id: sessionId });

  if (!session) {
    throw new Error('VideoSession not found');
  }

  const layer = session.layers.find(layer => layer._id.toString() === layerId);



  if (!layer) {
    throw new Error('Layer not found');
  }

  const buildCompletedResponse = async () => {
    const sanitizedSession = await sanitizeStudioSessionPayload(session, { viewerUserId: session.userId });
    const sanitizedLayer = Array.isArray(sanitizedSession?.layers)
      ? sanitizedSession.layers.find((currentLayer) => currentLayer?._id?.toString?.() === layerId)
      : null;

    return {
      status: 'COMPLETED',
      session: sanitizedSession,
      layer: sanitizedLayer || null,
    };
  };

  if (aiVideoLayerType === 'lip_sync') {
    if (layer.lipSyncGenerationPending) {
      return {
        status: 'PENDING'
      }
    }
    if (layer.lipSyncVideoLayer) {
      return buildCompletedResponse();
    } else if (layer.lipSyncVideoGenerationStatus === 'FAILED') {
      return {
        status: 'FAILED'
      }
    }
  } else if (aiVideoLayerType === 'sound_effect') {
    if (layer.soundEffectGenerationPending) {
      return {
        status: 'PENDING'
      }
    }
    if (layer.soundEffectVideoLayer) {
      return buildCompletedResponse();
    } else if (layer.soundEffectVideoGenerationStatus === 'FAILED') {
      return {
        status: 'FAILED'
      }
    }
  } else if (aiVideoLayerType === 'user_video') {
    if (layer.userVideoGenerationPending) {
      return {
        status: 'PENDING'
      }
    }
    if (layer.userVideoLayer) {
      return buildCompletedResponse();
    } else if (layer.userVideoGenerationStatus === 'FAILED') {
      return {
        status: 'FAILED',
        error: layer.userVideoGenerationError || 'Failed to process uploaded video.',
      }
    }
  } else {
    if (layer.aiVideoGenerationPending) {
      return {
        status: 'PENDING'
      }
    }
    if (layer.aiVideoLayer) {
      return buildCompletedResponse();
    } else if (layer.aiVideoGenerationStatus === 'FAILED') {
      return {
        status: 'FAILED'
      }
    }
  }


}


export async function removeAIVideoLayerForSession(userId, payload) {
  await getDBConnectionString();

  const { sessionId, layerId, aiVideoLayerType, removeSpeechForLipSync = false } = payload;

  // 1) Fetch the session
  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  // 2) Find the layer index
  const layerIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === layerId
  );
  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  let currentLayer = sessionDataValue.layers[layerIndex];
  resetLayerVideoEditState(currentLayer);
  const activeUserVideoUploadTask = await getActiveUserVideoUploadTaskForLayer(sessionId, layerId);
  const resolvedVideoLayerType = aiVideoLayerType || (
    currentLayer?.userVideoGenerationPending
    || currentLayer?.hasUserVideoLayer
    || currentLayer?.userVideoLayer
    || currentLayer?.userVideoUploadTaskId
    || activeUserVideoUploadTask
      ? 'user_video'
      : currentLayer?.hasLipSyncVideoLayer
        ? 'lip_sync'
        : currentLayer?.hasSoundEffectVideoLayer
          ? 'sound_effect'
          : 'ai_video'
  );
  let audioLayersUpdated = false;
  // let audioLayerUpdatedId = -1;
  let connectedAudioLayer;
  let audioLayers = sessionDataValue.audioLayers || [];

  // 3) Modify the appropriate fields based on aiVideoLayerType
  if (resolvedVideoLayerType === 'lip_sync') {
    sessionDataValue.layers[layerIndex].lipSyncVideoLayer = null;
    sessionDataValue.layers[layerIndex].lipSyncRemoteLink = null;
    sessionDataValue.layers[layerIndex].hasLipSyncVideoLayer = false;
    sessionDataValue.layers[layerIndex].lipSyncGenerationPending = false;
    sessionDataValue.layers[layerIndex].lipSyncVideoGenerationStatus = 'INIT';
    if (currentLayer.hasAiVideoLayer) {
      sessionDataValue.layers[layerIndex].layerAiVideoType = 'ai_video';
    } else {
      sessionDataValue.layers[layerIndex].layerAiVideoType = 'none';
    }
    let connectedAudioLayerIndex = sessionDataValue.audioLayers.findIndex(layer => layer.connectedLayerId === layerId);

    if (connectedAudioLayerIndex !== -1) {
      const currentAudioLayer = sessionDataValue.audioLayers[connectedAudioLayerIndex];

      if (removeSpeechForLipSync) {
        const connectedAudioLayerId = currentAudioLayer._id.toString();
        await removeTranscriptsForSessionAudioLayer(sessionId, connectedAudioLayerId);

        audioLayers.splice(connectedAudioLayerIndex, 1);
        audioLayersUpdated = true;
      } else if (currentAudioLayer?.previousAudioData) {
        const previousAudioData = currentAudioLayer.previousAudioData;
        const restoredLocalAudioLink = previousAudioData.selectedLocalAudioLink
          || previousAudioData.localAudioLinks?.[0]
          || currentAudioLayer.selectedLocalAudioLink;
        const restoredRemoteAudioLink = previousAudioData.selectedRemoteAudioLink
          || previousAudioData.remoteAudioLink
          || previousAudioData.remoteAudioLinks?.[0]
          || currentAudioLayer.selectedRemoteAudioLink;
        const restoredDuration = Number.isFinite(previousAudioData.duration)
          ? previousAudioData.duration
          : (Number.isFinite(currentAudioLayer.originalDuration) ? currentAudioLayer.originalDuration : currentAudioLayer.duration);
        const restoredStartTime = Number.isFinite(previousAudioData.startTime)
          ? previousAudioData.startTime
          : currentAudioLayer.startTime;
        const restoredEndTime = Number.isFinite(previousAudioData.endTime)
          ? previousAudioData.endTime
          : (restoredStartTime + restoredDuration);

        currentAudioLayer.audioLink = restoredRemoteAudioLink;
        currentAudioLayer.selectedLocalAudioLink = restoredLocalAudioLink;
        currentAudioLayer.selectedRemoteAudioLink = restoredRemoteAudioLink;
        currentAudioLayer.localAudioLinks = Array.isArray(previousAudioData.localAudioLinks) && previousAudioData.localAudioLinks.length > 0
          ? previousAudioData.localAudioLinks
          : (restoredLocalAudioLink ? [restoredLocalAudioLink] : []);
        currentAudioLayer.remoteAudioLinks = Array.isArray(previousAudioData.remoteAudioLinks) && previousAudioData.remoteAudioLinks.length > 0
          ? previousAudioData.remoteAudioLinks
          : (restoredRemoteAudioLink ? [restoredRemoteAudioLink] : []);
        currentAudioLayer.remoteAudioData = Array.isArray(previousAudioData.remoteAudioData) && previousAudioData.remoteAudioData.length > 0
          ? previousAudioData.remoteAudioData
          : (restoredRemoteAudioLink ? [{
            title: 'speech',
            audio_url: restoredRemoteAudioLink,
          }] : []);
        currentAudioLayer.duration = restoredDuration;
        currentAudioLayer.startTime = restoredStartTime;
        currentAudioLayer.endTime = restoredEndTime;
        currentAudioLayer.isRowLocked = false;
        currentAudioLayer.previousAudioData = null;
        currentAudioLayer.originalDuration = restoredDuration;

        audioLayers[connectedAudioLayerIndex] = currentAudioLayer;
        audioLayersUpdated = true;
      }
    }

  } else if (resolvedVideoLayerType === 'sound_effect') {
    resetLayerSoundEffectState(sessionDataValue.layers[layerIndex]);
    await deleteQueuedSoundEffectGenerationsForLayer(sessionId, layerId);
  } else if (resolvedVideoLayerType === 'user_video') {
    sessionDataValue.layers[layerIndex].userVideoLayer = null;
    sessionDataValue.layers[layerIndex].userVideoRemoteLink = null;
    sessionDataValue.layers[layerIndex].hasUserVideoLayer = false;
    sessionDataValue.layers[layerIndex].userVideoGenerationPending = false;
    sessionDataValue.layers[layerIndex].userVideoGenerationStatus = 'INIT';
    sessionDataValue.layers[layerIndex].userVideoGenerationError = null;
    sessionDataValue.layers[layerIndex].userVideoUploadTaskId = null;
    sessionDataValue.layers[layerIndex].layerAiVideoType = 'none';
    sessionDataValue.layers[layerIndex].skipAiVideoGeneration = false;
    sessionDataValue.layers[layerIndex].aiLayerStartFrame = null;
    sessionDataValue.layers[layerIndex].aiLayerEndFrame = null;

    const previousAudioLayerCount = audioLayers.length;
    audioLayers = audioLayers.filter((audioLayer) => !(
      audioLayer?.connectedLayerId === layerId
      && audioLayer?.generationType === 'user_video'
    ));
    if (audioLayers.length !== previousAudioLayerCount) {
      audioLayersUpdated = true;
    }

    await markUserVideoUploadTaskCancelled({
      sessionId,
      layerId,
      taskId: currentLayer?.userVideoUploadTaskId || activeUserVideoUploadTask?.taskId || null,
    });
  } else {
    // Default to main aiVideoLayer removal
    sessionDataValue.layers[layerIndex].aiVideoLayer = null;
    sessionDataValue.layers[layerIndex].aiVideoRemoteLink = null;
    sessionDataValue.layers[layerIndex].hasAiVideoLayer = false;
    sessionDataValue.layers[layerIndex].aiVideoGenerationPending = false;
    sessionDataValue.layers[layerIndex].aiVideoGenerationStatus = 'INIT';
  }

  if (
    currentLayer.imageSession.previousActiveItemList &&
    currentLayer.imageSession.previousActiveItemList.length > 0
  ) {
    sessionDataValue.layers[layerIndex].imageSession.activeItemList =
      currentLayer.imageSession.previousActiveItemList;
    sessionDataValue.layers[layerIndex].imageSession.previousActiveItemList = null;
  }

  currentLayer.frameGenerationPending = true;


  // 5) Save

  if (audioLayersUpdated) {
    sessionDataValue.audioLayers = audioLayers;
  }

  sessionDataValue.frameGenerationPending = true;

  const updatedSessionData = await sessionDataValue.save();
  const updatedLayer = updatedSessionData.layers[layerIndex];




  await extractFramesFromAiVideoLayer(sessionId, updatedLayer._id.toString());




  return {
    session: updatedSessionData,
    layer: updatedLayer,
    audioLayers: updatedSessionData.audioLayers,
  };


}


export async function requestRegenerateSubtitlesForVideoSession(userId, payload) {
  const { sessionId, layerId } = payload;
  await getDBConnectionString();

  const sessionDataValue = await VideoSession.findOne({
    _id

  });

}

export async function requestRegenerateSubtitles(userId, payload) {
  assertSubtitleGenerationAvailable();
  const { sessionId, realignAudio } = payload;

  await getDBConnectionString();


  // 1) Load the session
  let sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (!sessionDataValue) {
    throw new Error("VideoSession not found");
  }

  const subtitleLanguageSelection = applySubtitleLanguageSelectionForRerun(
    sessionDataValue,
    payload,
  );

  const inferenceModelUser = await User.findById(sessionDataValue.userId || userId)
    .select('selectedInferenceModel')
    .lean();
  const rerunInferenceModel = normalizeInferenceModel(
    sessionDataValue.expressGenerationInferenceModel ||
    sessionDataValue.inferenceModel ||
    inferenceModelUser?.selectedInferenceModel,
  );
  const subtitleMetadataBackfill = await backfillTranslatedSubtitleMetadataForRerun(
    sessionDataValue.audioLayers,
    {
      sessionSpeechLanguage: sessionDataValue.sessionLanguage,
      sessionSubtitleLanguage: sessionDataValue.subtitleLanguage,
      sessionSubtitleLanguageString: sessionDataValue.subtitleLanguageString,
      sessionTranslationRequired: sessionDataValue.subtitleTranslationRequired === true,
      inferenceModel: rerunInferenceModel,
      translateSpeech,
    },
  );
  if (subtitleLanguageSelection.selectionProvided) {
    refreshSessionSubtitleTranslationRequired(sessionDataValue);
  }
  if (
    subtitleLanguageSelection.selectionProvided ||
    subtitleMetadataBackfill.updatedCount > 0
  ) {
    sessionDataValue.markModified('audioLayers');
    await sessionDataValue.save();
  }

  // 2) Mark transcript generation as pending
  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        transcriptGenerationPending: true,
        enableSubtitles: true,
        hasSubtitles: true,
        has_subtitles: true,
      }
    }
  );
  sessionDataValue.enableSubtitles = true;
  sessionDataValue.hasSubtitles = true;
  sessionDataValue.has_subtitles = true;
  if (Array.isArray(sessionDataValue.audioLayers)) {
    sessionDataValue.audioLayers.forEach((audioLayer) => {
      if (audioLayer?.generationType === 'speech') {
        audioLayer.addSubtitles = true;
      }
    });
  }

  // 3) Remove all text items of type 'text' with subType='subtitle' in every layer
  let sessionLayers = sessionDataValue.layers;
  const framesPerSecond = getSessionFramesPerSecondWithLog(
    sessionDataValue,
    'VideoSession.requestRegeneratePresetAnimations'
  );
  for (let i = 0; i < sessionLayers.length; i++) {
    let layer = sessionLayers[i];
    let layerImageSession = layer.imageSession;
    // Filter out any subtitle text items
    if (layerImageSession?.activeItemList?.length) {
      const filteredActiveItemList = layerImageSession.activeItemList.filter(
        (item) => !(item.type === "text" && item.subType === "subtitle")
      );
      sessionLayers[i].imageSession.activeItemList = filteredActiveItemList;
    }
  }

  // 4) Persist the removal of old subtitle text items
  sessionDataValue.layers = sessionLayers;
  await sessionDataValue.save();

  // 5) If the user wants to realign audio to the updated layer durations, do so
  if (realignAudio) {
    let audioSpeechLayers = sessionDataValue.audioLayers.filter(
      (layer) => layer.generationType === "speech"
    );
    const isVideoGeneration = sessionDataValue.isVidGPTGen;

    // Recompute each layer's durationOffset
    let durationOffset = 0;
    for (let i = 0; i < sessionLayers.length; i++) {
      sessionLayers[i].durationOffset = durationOffset;
      durationOffset += sessionLayers[i].duration;
    }

    // Shift the startTime on each speech audio layer to match the associated layer offset
    for (let i = 0; i < audioSpeechLayers.length; i++) {
      const currentAudioLayer = audioSpeechLayers[i];

      // If connectedLayerId is used, line it up with that layer’s offset
      const connectedLayerId = currentAudioLayer.connectedLayerId;
      const connectedLayer = sessionLayers.find(
        (layer) => layer._id.toString() === connectedLayerId
      );
      if (!connectedLayer) continue;
      currentAudioLayer.startTime = connectedLayer.durationOffset;
      currentAudioLayer.endTime = connectedLayer.durationOffset + currentAudioLayer.duration;

    }

    // Save audio adjustments and updated layers
    sessionDataValue.layers = sessionLayers;
    sessionDataValue.audioLayers = sessionDataValue.audioLayers; // mutated in-place above
    await sessionDataValue.save();
  }

  // 6) Generate new transcripts for speech audio layers
  let updatedSessionData = await VideoSession.findOne({ _id: sessionId });
  const audioSpeechLayersForSubs = updatedSessionData.audioLayers.filter(
    (layer) => layer.generationType === "speech"
  );
  await generateTranscriptsForSessionAudioLayers(
    sessionId,
    audioSpeechLayersForSubs,
    { requireNonEmptySubtitles: true },
  );

  // 7) Mark all layers to regenerate frames (since on-screen text changed)
  await VideoSession.updateOne(
    { _id: sessionId },
    { $set: { "layers.$[].frameGenerationPending": true } }
  );

  // 8) Finally, mark transcript generation as complete
  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        transcriptGenerationPending: false,
        enableSubtitles: true,
        hasSubtitles: true,
        has_subtitles: true,
      }
    }
  );

  // 9) Return the updated session
  const sessionDataUpdated = await VideoSession.findOne({ _id: sessionId });
  return sessionDataUpdated;
}




export async function requestRegeneratePresetAnimations(sessionId) {
  await getDBConnectionString();

  let sessionDataValue = await VideoSession.findOne({ _id: sessionId });

  const aspectRatio = sessionDataValue.aspectRatio;
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  let sessionLayers = sessionDataValue.layers;

  for (let i = 0; i < sessionLayers.length; i++) {
    let layer = sessionLayers[i];

    const layerFrameDuration = layer.duration * framesPerSecond;
    // Skip if AI video layer is already present
    if (hasAnyLayerVideoLink(layer)) {
      continue;
    }

    let currentImageLayerIndex = layer.imageSession.activeItemList.findIndex(item => item.type === 'image');

    if (currentImageLayerIndex === -1) {
      currentImageLayerIndex = layer.imageSession.activeItemList.findIndex(item => item.type === 'image');
    }

    if (currentImageLayerIndex === -1) {
      continue;
    }


    let currentImageLayer = layer.imageSession.activeItemList[currentImageLayerIndex];
    let currentActiveItemList = layer.imageSession.activeItemList;

    // If there are animations, skip
    if (currentImageLayer && currentImageLayer.animations && currentImageLayer.animations.length > 0) {
      // continue;
    }



    // If no animations, create preset animation list
    if (currentImageLayer) {


      const textLayers = currentActiveItemList.filter(item => item.type === 'text' && item.subType === 'subtitle');
      let layerDistribution = textLayers.map(tl => ({
        startFrame: tl.config.frameOffset,
        endFrame: tl.config.frameOffset + tl.config.frameDuration,
      }));

      // layerDistribution = adjustDistributionToRemoveGaps(layerDistribution, layerFrameDuration);

      if (layerDistribution && layerDistribution.length > 0) {


        const newAnimationsList = getPresetAnimationListForDistribution(
          layerDistribution,
          i,
          canvasDimensions,
          layerFrameDuration,
          framesPerSecond
        );



        // Ensure the animations are updated in the document
        currentImageLayer.animations = newAnimationsList;

      }
      for (let j = 0; j < currentActiveItemList.length; j++) {
        if (j === currentImageLayerIndex) {
          currentActiveItemList[j] = currentImageLayer;
        }
      }

      layer.imageSession.activeItemList = currentActiveItemList;
      layer.frameGenerationPending = true;
    }

  }

  // Save the updated session after modifying the animations
  await sessionDataValue.save();

  await regenerateFramesForSession(sessionId);

  // Retrieve the updated session data and return it
  const sessionDataUpdated = await VideoSession.findOne({ _id: sessionId });



  return sessionDataUpdated;


}


export async function setAdvancedTheme(userId, payload) {

  await getDBConnectionString();
  const { sessionId, customTheme, aspectRatio } = payload;

  const themeData = await generateThemeKeywords(customTheme, aspectRatio);

  const themeJsonString = JSON.stringify(themeData);

  let sessionData = await VideoSession.findOne({ _id: sessionId });

  sessionData.parentJsonTheme = themeJsonString;

  const dataRes = await sessionData.save();

  return {
    sessionDetails: dataRes
  }

}


export async function requestApplyAutoSyncLayersToAnimations(sessionId) {
  await getDBConnectionString();

  let sessionDataValue = await VideoSession.findOne({ _id: sessionId });

  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }


  const musicBeatFrameBoundaries = await requestApplyAutoSynchronizeBeats(sessionDataValue);

  await regenerateFramesForSession(sessionId);

}


export async function requestApplyAutoSyncLayersToBeats(sessionId) {
  await getDBConnectionString();

  let sessionDataValue = await VideoSession.findOne({
    _id
      : sessionId
  });

  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }
  const musicBeatFrameBoundaries = await requestApplyAutoSynchronizeLayerDurationsToBeats(sessionDataValue);
  await regenerateFramesForSession(sessionId);

}


export async function requestApplyAutoSyncBeatsToLayersAndAnimations(sessionId) {
  await getDBConnectionString();
  let sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  const layerBeatFrameBoundaries = await requestApplyAutoSynchronizeLayerDurationsToBeats(sessionDataValue);
  sessionDataValue = await VideoSession.findOne({ _id: sessionId });

  let newSessionLayers = sessionDataValue.layers;


  const animationBeatFrameBoundaries = await requestApplyAutoSynchronizeBeats(sessionDataValue);

  sessionDataValue = await VideoSession.findOne({ _id: sessionId });

  newSessionLayers = sessionDataValue.layers;
  await regenerateFramesForSession(sessionId);
}

function resolveAudioItemLink(audioItem = {}) {
  if (typeof audioItem.selectedLocalAudioLink === 'string' && audioItem.selectedLocalAudioLink.trim()) {
    return {
      link: audioItem.selectedLocalAudioLink.trim(),
      type: 'local',
    };
  }

  if (Array.isArray(audioItem.localAudioLinks) && audioItem.localAudioLinks.length > 0) {
    const localAudioLink = audioItem.localAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (localAudioLink) {
      return {
        link: localAudioLink.trim(),
        type: 'local',
      };
    }
  }

  if (typeof audioItem.url === 'string' && audioItem.url.trim()) {
    return {
      link: audioItem.url.trim(),
      type: 'local',
    };
  }

  if (typeof audioItem.selectedRemoteAudioLink === 'string' && audioItem.selectedRemoteAudioLink.trim()) {
    return {
      link: audioItem.selectedRemoteAudioLink.trim(),
      type: 'remote',
    };
  }

  if (Array.isArray(audioItem.remoteAudioLinks) && audioItem.remoteAudioLinks.length > 0) {
    const remoteAudioLink = audioItem.remoteAudioLinks.find((link) => typeof link === 'string' && link.trim());
    if (remoteAudioLink) {
      return {
        link: remoteAudioLink.trim(),
        type: 'remote',
      };
    }
  }

  if (Array.isArray(audioItem.remoteAudioData) && audioItem.remoteAudioData.length > 0) {
    const remoteAudioData = audioItem.remoteAudioData.find((itemData) => (
      typeof itemData?.audio_url === 'string' && itemData.audio_url.trim()
    ));
    if (remoteAudioData?.audio_url) {
      return {
        link: remoteAudioData.audio_url.trim(),
        type: 'remote',
      };
    }
  }

  return {
    link: null,
    type: null,
  };
}

function getAudioFileExtensionFromLink(audioLink) {
  if (typeof audioLink !== 'string' || !audioLink.trim()) {
    return '.mp3';
  }

  const trimmedAudioLink = audioLink.trim();
  if (/^https?:\/\//i.test(trimmedAudioLink)) {
    try {
      const remoteExtension = path.extname(new URL(trimmedAudioLink).pathname);
      return remoteExtension || '.mp3';
    } catch {
      return '.mp3';
    }
  }

  return path.extname(trimmedAudioLink) || '.mp3';
}

function sanitizeCopiedAudioFilePrefix(prefix) {
  if (typeof prefix !== 'string' || !prefix.trim()) {
    return 'audio-copy';
  }

  const sanitizedPrefix = prefix
    .trim()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitizedPrefix || 'audio-copy';
}

async function copyAudioLinkToDuplicatedLayerAsset({
  sessionId,
  audioLayerId,
  audioLink,
  filePrefix = 'audio-copy',
}) {
  if (typeof audioLink !== 'string' || !audioLink.trim()) {
    throw new Error('Audio layer is missing a valid source audio link.');
  }

  const outputFolderPath = getSessionAudioFolderPath(sessionId, audioLayerId);
  await fsPromises.mkdir(outputFolderPath, { recursive: true });

  const outputFilePath = path.join(
    outputFolderPath,
    `${sanitizeCopiedAudioFilePrefix(filePrefix)}-${randomUUID()}${getAudioFileExtensionFromLink(audioLink)}`,
  );

  const trimmedAudioLink = audioLink.trim();
  if (/^https?:\/\//i.test(trimmedAudioLink)) {
    const audioResponse = await axios.get(trimmedAudioLink, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    await fsPromises.writeFile(outputFilePath, Buffer.from(audioResponse.data));
    return toAssetRelativePath(outputFilePath);
  }

  const sourceAudioPath = resolveAudioLinkToLocalPath(trimmedAudioLink);
  if (!sourceAudioPath || !fs.existsSync(sourceAudioPath)) {
    throw new Error(`Unable to locate audio source for duplication: ${trimmedAudioLink}`);
  }

  await fsPromises.copyFile(sourceAudioPath, outputFilePath);
  return toAssetRelativePath(outputFilePath);
}

function resolveLibraryAudioGenerationType(audioItem = {}) {
  if (typeof audioItem.generationType === 'string' && audioItem.generationType.trim()) {
    const normalizedGenerationType = audioItem.generationType.trim().toLowerCase();

    if (normalizedGenerationType === 'music' || normalizedGenerationType === 'background_music') {
      return 'music';
    }

    if (normalizedGenerationType === 'custom_speech' || normalizedGenerationType === 'recorded_speech') {
      return 'recorded_speech';
    }

    if (normalizedGenerationType === 'speech' || normalizedGenerationType === 'lip_sync') {
      return 'speech';
    }

    return 'sound_effect';
  }

  if (audioItem.libraryType === 'speech') {
    return audioItem.source === 'recorded_speech' ? 'recorded_speech' : 'speech';
  }

  if (audioItem.libraryType === 'sound_effect') {
    return 'sound_effect';
  }

  return 'music';
}

function normalizeBooleanValue(value) {
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === 'true') {
      return true;
    }
    if (normalizedValue === 'false') {
      return false;
    }
  }

  return Boolean(value);
}

function resolveLibraryAudioFadeOnEdges(audioItem = {}, payload = {}, generationType = '') {
  if (Object.prototype.hasOwnProperty.call(payload, 'fadeOnEdges')) {
    return normalizeBooleanValue(payload.fadeOnEdges);
  }

  if (
    generationType === 'speech' ||
    generationType === 'custom_speech' ||
    generationType === 'user_video' ||
    generationType === 'lip_sync'
  ) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(audioItem, 'fadeOnEdges')) {
    return normalizeBooleanValue(audioItem.fadeOnEdges);
  }

  return true;
}

function getExplicitAudioBindingMode(payload = {}) {
  return typeof payload.audioBindingMode === 'string'
    ? payload.audioBindingMode.trim().toLowerCase()
    : '';
}

function hasExplicitBoundAudioBinding(payload = {}) {
  const explicitBindingMode = getExplicitAudioBindingMode(payload);

  return (
    explicitBindingMode === 'bound' ||
    explicitBindingMode === 'scene' ||
    explicitBindingMode === 'layer' ||
    payload.bindToLayer === true ||
    payload.isBoundToLayer === true
  );
}

function hasExplicitUnboundAudioBinding(payload = {}) {
  const explicitBindingMode = getExplicitAudioBindingMode(payload);

  return (
    explicitBindingMode === 'unbound' ||
    explicitBindingMode === 'unbounded' ||
    explicitBindingMode === 'timeline' ||
    payload.bindToLayer === false ||
    payload.isBoundToLayer === false
  );
}

function shouldTreatSpeechAsStudioUnbound(payload = {}, generationType = '') {
  return (generationType === 'speech' || generationType === 'recorded_speech') && (
    payload.studioSpeechGeneration === true ||
    hasExplicitUnboundAudioBinding(payload)
  );
}

function clearAudioLayerBinding(audioLayer) {
  audioLayer.connectedLayerId = undefined;
  audioLayer.connectedLayerIndex = undefined;
  audioLayer.connectedLayerStartTimeOffset = undefined;
}

function shouldBindLibraryAudioToLayer(payload = {}, generationType = '') {
  if (generationType === 'speech' || generationType === 'recorded_speech') {
    return false;
  }

  if (hasExplicitBoundAudioBinding(payload)) {
    return true;
  }

  if (hasExplicitUnboundAudioBinding(payload)) {
    return false;
  }

  return generationType !== 'speech';
}

function normalizePositiveSeconds(value, fallbackValue = null) {
  const parsedValue = Number(value);
  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }

  return fallbackValue;
}

function firstPositiveSeconds(...values) {
  for (const value of values.flat()) {
    const normalizedValue = normalizePositiveSeconds(value, null);
    if (normalizedValue !== null) {
      return normalizedValue;
    }
  }

  return null;
}

function resolveSessionTimelineEndTime(sessionData) {
  const sessionLayers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  const explicitEndTime = sessionLayers.reduce((maxEndTime, layer) => {
    const layerDuration = Number(layer?.duration) || 0;
    const layerOffset = Number(layer?.durationOffset) || 0;
    return Math.max(maxEndTime, layerOffset + layerDuration);
  }, 0);

  if (explicitEndTime > 0) {
    return explicitEndTime;
  }

  return sessionLayers.reduce((totalDuration, layer) => {
    return totalDuration + (Number(layer?.duration) || 0);
  }, 0);
}

function getSessionProjectName(sessionData) {
  if (typeof sessionData?.sessionName === 'string' && sessionData.sessionName.trim()) {
    return sessionData.sessionName.trim();
  }

  const sessionId = sessionData?._id?.toString?.() || '';
  if (sessionId) {
    return `Project ${sessionId.slice(-6)}`;
  }

  return 'Current Project';
}

function sanitizeUploadedAudioFileName(fileName) {
  const MAX_UPLOADED_AUDIO_BASENAME_LENGTH = 80;

  if (typeof fileName !== 'string' || !fileName.trim()) {
    return 'uploaded-track';
  }

  const normalizedBaseName = path.parse(fileName.trim()).name
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  const trimmedBaseName = normalizedBaseName.slice(0, MAX_UPLOADED_AUDIO_BASENAME_LENGTH)
    .replace(/-+$/g, '');

  return trimmedBaseName || 'uploaded-track';
}

function getUploadedAudioExtensionForMimeType(mimeType = '') {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.includes('mpeg') || normalizedMimeType.includes('mp3')) {
    return '.mp3';
  }
  if (normalizedMimeType.includes('webm')) {
    return '.webm';
  }
  if (normalizedMimeType.includes('ogg')) {
    return '.ogg';
  }
  if (normalizedMimeType.includes('wav')) {
    return '.wav';
  }
  if (normalizedMimeType.includes('mp4')) {
    return '.m4a';
  }
  if (normalizedMimeType.includes('aac')) {
    return '.aac';
  }
  return '.audio';
}

function parseUploadedAudioDataUrl(dataURL) {
  if (typeof dataURL !== 'string' || !dataURL.trim()) {
    throw new Error('Uploaded audio payload is empty.');
  }

  const normalizedDataUrl = dataURL.trim();
  const dataUrlMatch = normalizedDataUrl.match(/^data:(audio\/[a-z0-9.+-]+)(?:;[^,]+)*;base64,(.+)$/i);
  if (!dataUrlMatch) {
    throw new Error('Uploaded audio must be a valid browser audio recording.');
  }

  const mimeType = dataUrlMatch[1].toLowerCase();
  const supportedMimeTypes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/webm',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/aac',
  ];

  if (!supportedMimeTypes.some((supportedMimeType) => mimeType.startsWith(supportedMimeType))) {
    throw new Error('Unsupported audio recording format.');
  }

  return {
    buffer: Buffer.from(dataUrlMatch[2], 'base64'),
    mimeType,
    extension: getUploadedAudioExtensionForMimeType(mimeType),
  };
}

function resolveUploadedAudioFolderPath(sessionId, uploadFolderName = 'uploaded_music') {
  return path.join(resolveProcessorAssetsRoot(), 'video', 'audio', sessionId.toString(), uploadFolderName);
}

function transcodeUploadedAudioToMp3(inputFilePath, outputFilePath) {
  return withProcessorFfmpegResources((threadOptions) => (
    new Promise((resolve, reject) => {
      ffmpeg(inputFilePath)
        .inputOptions(threadOptions.inputOptions)
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .format('mp3')
        .outputOptions(threadOptions.outputOptions)
        .on('end', resolve)
        .on('error', reject)
        .save(outputFilePath);
    })
  ));
}

async function resolveMusicTrackApplication({
  sessionData,
  audioLayerId,
  sourceAudioLink,
  startTime,
  loopOverEntireSession = false,
  fallbackDuration = 120,
  filePrefix = 'music-loop',
}) {
  const resolvedStartTime = Number.isFinite(Number(startTime)) && Number(startTime) >= 0
    ? Number(startTime)
    : 0;
  const sessionTimelineEndTime = resolveSessionTimelineEndTime(sessionData);
  const normalizedFallbackDuration = normalizePositiveSeconds(fallbackDuration, 120);

  if (loopOverEntireSession) {
    const targetDuration = Math.max(sessionTimelineEndTime - resolvedStartTime, 0);
    if (!(targetDuration > 0)) {
      throw new Error('Unable to loop music beyond the session end time.');
    }

    const loopedTrack = await createLoopedAudioTrackForDuration({
      sessionId: sessionData._id.toString(),
      audioLayerId: audioLayerId.toString(),
      sourceAudioLink,
      wantedDuration: targetDuration,
      filePrefix,
    });

    return {
      duration: targetDuration,
      endTime: sessionTimelineEndTime,
      originalDuration: normalizePositiveSeconds(loopedTrack.sourceDuration, normalizedFallbackDuration),
      selectedLocalAudioLink: loopedTrack.outputRelativePath,
      localAudioLinks: [loopedTrack.outputRelativePath],
      fadeOnEdges: true,
    };
  }

  const sourceDuration = await getAudioDurationSecondsForLink(sourceAudioLink).catch(() => null);
  const resolvedDuration = normalizePositiveSeconds(sourceDuration, normalizedFallbackDuration);

  return {
    duration: resolvedDuration,
    endTime: resolvedStartTime + resolvedDuration,
    originalDuration: resolvedDuration,
  };
}

export async function uploadAudioLibraryItemForSession(userId, payload) {
  await getDBConnectionString();

  const {
    sessionId,
    dataURL,
    fileName,
    generationType,
    libraryType,
    title,
    speakerCharacterName,
    volume,
    addTranscription,
  } = payload || {};

  const sessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const sessionTimelineEndTime = resolveSessionTimelineEndTime(sessionData);
  if (!(sessionTimelineEndTime > 0)) {
    throw new Error('Unable to determine the current video session duration.');
  }

  const requestedGenerationType = typeof generationType === 'string' && generationType.trim()
    ? generationType.trim().toLowerCase()
    : typeof libraryType === 'string' && libraryType.trim().toLowerCase() === 'speech'
      ? 'custom_speech'
      : 'music';
  const normalizedGenerationType =
    requestedGenerationType === 'custom_speech' || requestedGenerationType === 'recorded_speech'
      ? 'recorded_speech'
      : 'music';
  const normalizedLibraryType = normalizedGenerationType === 'recorded_speech' ? 'speech' : 'music';
  const uploadFolderName = normalizedGenerationType === 'recorded_speech'
    ? 'recorded_speech'
    : 'uploaded_music';
  const uploadedAudioData = parseUploadedAudioDataUrl(dataURL);
  const uploadedAudioBuffer = uploadedAudioData.buffer;
  if (!uploadedAudioBuffer || uploadedAudioBuffer.length === 0) {
    throw new Error('Uploaded audio payload is empty.');
  }

  const safeFileBaseName = sanitizeUploadedAudioFileName(fileName);
  const outputFolderPath = resolveUploadedAudioFolderPath(sessionId, uploadFolderName);
  await fsPromises.mkdir(outputFolderPath, { recursive: true });

  const uploadId = randomUUID();
  const outputFilePath = path.join(outputFolderPath, `${safeFileBaseName}-${uploadId}.mp3`);
  const shouldTranscodeAudio = uploadedAudioData.extension !== '.mp3';
  const inputFilePath = shouldTranscodeAudio
    ? path.join(outputFolderPath, `${safeFileBaseName}-${uploadId}${uploadedAudioData.extension}`)
    : outputFilePath;

  try {
    await fsPromises.writeFile(inputFilePath, uploadedAudioBuffer);
    if (shouldTranscodeAudio) {
      await transcodeUploadedAudioToMp3(inputFilePath, outputFilePath);
      await fsPromises.unlink(inputFilePath).catch(() => {});
    }

    const uploadedAudioDuration = await getAudioDurationSeconds(outputFilePath);

    if (!(uploadedAudioDuration > 0)) {
      throw new Error('Unable to determine uploaded audio duration.');
    }

    const shouldExtendSessionForUploadedSpeech = normalizedGenerationType === 'recorded_speech'
      && payload?.extendSessionToAudioEnd !== false;
    let uploadTimelineExtension = {
      extended: false,
      currentEndTime: sessionTimelineEndTime,
      targetEndTime: uploadedAudioDuration,
    };

    if (uploadedAudioDuration > sessionTimelineEndTime + 0.01 && normalizedGenerationType !== 'recorded_speech') {
      throw new Error(`Uploaded audio must be no longer than the current video session (${sessionTimelineEndTime.toFixed(1)}s).`);
    }

    if (uploadedAudioDuration > sessionTimelineEndTime + 0.01 && shouldExtendSessionForUploadedSpeech) {
      uploadTimelineExtension = extendSessionTimelineToEndTime(sessionData, uploadedAudioDuration);
      if (uploadTimelineExtension.extended) {
        await sessionData.save();
      }
    }

    const assetRelativePath = toAssetRelativePath(outputFilePath);
    const displayTitle = typeof title === 'string' && title.trim()
      ? title.trim()
      : normalizedGenerationType === 'recorded_speech'
        ? 'Recorded Speech'
        : safeFileBaseName.replace(/[-_]+/g, ' ').trim() || 'Uploaded Track';
    const resolvedSpeakerCharacterName = typeof speakerCharacterName === 'string' && speakerCharacterName.trim()
      ? speakerCharacterName.trim()
      : normalizedGenerationType === 'recorded_speech'
        ? 'Recorded speech'
        : '';
    const resolvedVolume = Number.isFinite(Number(volume)) && Number(volume) >= 0
      ? Number(volume)
      : 100;
    const generationMeta = {
      uploadType: normalizedGenerationType === 'recorded_speech' ? 'recorded_speech' : 'user_mp3',
      sourceMimeType: uploadedAudioData.mimeType,
      addTranscription: Boolean(addTranscription),
      sessionTimelineExtension: uploadTimelineExtension,
    };
    const generatedMusic = await GeneratedMusic.create({
      url: assetRelativePath,
      prompt: '',
      description: '',
      sessionId: sessionId.toString(),
      userId: userId?.toString?.() || userId,
      title: displayTitle,
      tags: normalizedGenerationType === 'recorded_speech' ? ['recorded', 'speech'] : ['uploaded'],
      duration: uploadedAudioDuration,
      generationType: normalizedGenerationType,
      libraryType: normalizedLibraryType,
      speakerCharacterName: resolvedSpeakerCharacterName,
      volume: resolvedVolume,
      generationMeta,
    });

    return {
      item: {
        _id: `generated_music:${generatedMusic._id.toString()}`,
        sessionId: sessionId.toString(),
        projectId: sessionId.toString(),
        projectName: getSessionProjectName(sessionData),
        source: normalizedGenerationType === 'recorded_speech' ? 'recorded_speech' : 'uploaded_music',
        title: displayTitle,
        description: '',
        prompt: '',
        url: assetRelativePath,
        localAudioLinks: [assetRelativePath],
        selectedLocalAudioLink: assetRelativePath,
        remoteAudioLinks: [],
        selectedRemoteAudioLink: null,
        remoteAudioData: [],
        duration: uploadedAudioDuration,
        startTime: 0,
        endTime: uploadedAudioDuration,
        volume: resolvedVolume,
        generationType: normalizedGenerationType,
        libraryType: normalizedLibraryType,
        speakerCharacterName: resolvedSpeakerCharacterName,
        tags: normalizedGenerationType === 'recorded_speech' ? ['recorded', 'speech'] : ['uploaded'],
        createdAt: generatedMusic.updatedAt || generatedMusic.createdAt || null,
        fadeOnEdges: normalizedGenerationType !== 'recorded_speech',
        generationMeta,
      },
    };
  } catch (error) {
    if (inputFilePath !== outputFilePath) {
      await fsPromises.unlink(inputFilePath).catch(() => {});
    }
    await fsPromises.unlink(outputFilePath).catch(() => {});
    throw error;
  }
}

function normalizeGeneratedMusicIdFromAudioItem(audioItem = {}) {
  const rawId = (
    audioItem.generatedMusicId ||
    audioItem.musicId ||
    audioItem._id ||
    audioItem.id ||
    ''
  )?.toString?.() || '';
  const idValue = rawId.includes(':') ? rawId.split(':').pop() : rawId;
  return mongoose.Types.ObjectId.isValid(idValue) ? idValue : null;
}

function isDeletableUploadedAudioItem(generatedMusic = {}) {
  const generationType = typeof generatedMusic?.generationType === 'string'
    ? generatedMusic.generationType.trim().toLowerCase()
    : '';
  const tags = Array.isArray(generatedMusic?.tags)
    ? generatedMusic.tags.map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
    : [];

  return (
    generationType === 'custom_speech' ||
    generationType === 'recorded_speech' ||
    tags.includes('recorded') ||
    tags.includes('uploaded')
  );
}

export async function deleteAudioLibraryItemForSession(userId, payload) {
  await getDBConnectionString();

  const { sessionId, audioItem = {}, deleteAsset = false } = payload || {};
  const generatedMusicId = normalizeGeneratedMusicIdFromAudioItem(audioItem);
  if (!generatedMusicId) {
    throw new Error('Audio library item id is required.');
  }

  const generatedMusic = await GeneratedMusic.findOne({
    _id: generatedMusicId,
    userId: userId?.toString?.() || userId,
    ...(sessionId ? { sessionId: sessionId.toString() } : {}),
  });
  if (!generatedMusic) {
    return { deleted: false };
  }

  if (!isDeletableUploadedAudioItem(generatedMusic)) {
    throw new Error('Only uploaded audio library items can be deleted here.');
  }

  const assetUrl = typeof generatedMusic.url === 'string' ? generatedMusic.url.trim() : '';
  const sessionData = sessionId
    ? await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
      markEdited: false,
    })
    : null;
  const audioLayers = Array.isArray(sessionData?.audioLayers) ? sessionData.audioLayers : [];
  const assetUsedBySession = Boolean(assetUrl) && audioLayers.some((audioLayer) => {
    const localLinks = Array.isArray(audioLayer?.localAudioLinks) ? audioLayer.localAudioLinks : [];
    const selectedLocalAudioLink = typeof audioLayer?.selectedLocalAudioLink === 'string'
      ? audioLayer.selectedLocalAudioLink
      : '';

    return selectedLocalAudioLink === assetUrl || localLinks.includes(assetUrl);
  });

  await GeneratedMusic.deleteOne({ _id: generatedMusicId });

  if (deleteAsset && assetUrl && !assetUsedBySession) {
    const assetPath = resolveAudioLinkToLocalPath(assetUrl);
    if (assetPath && fs.existsSync(assetPath)) {
      await fsPromises.unlink(assetPath).catch(() => {});
    }
  }

  return { deleted: true };
}

export async function duplicateAudioLayerInSession(userId, payload) {
  await getDBConnectionString();

  const { sessionId, audioLayerId } = payload || {};
  if (!sessionId || !audioLayerId) {
    throw new Error('Both sessionId and audioLayerId are required.');
  }

  const sessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const sourceAudioLayer = sessionData.audioLayers.find(
    (audioLayer) => audioLayer?._id?.toString() === audioLayerId.toString()
  );
  if (!sourceAudioLayer) {
    throw new Error('Audio layer not found');
  }

  const { link: sourceAudioLink } = resolveAudioItemLink(sourceAudioLayer);
  if (!sourceAudioLink) {
    throw new Error('Selected audio layer does not have a usable audio source.');
  }

  const duplicatedAudioLayerId = new mongoose.Types.ObjectId();
  const copiedAudioRelativePath = await copyAudioLinkToDuplicatedLayerAsset({
    sessionId: sessionData._id.toString(),
    audioLayerId: duplicatedAudioLayerId.toString(),
    audioLink: sourceAudioLink,
    filePrefix: sourceAudioLayer?.generationType || 'audio-copy',
  });

  const duplicatedAudioLayer = JSON.parse(
    JSON.stringify(sourceAudioLayer.toObject ? sourceAudioLayer.toObject() : sourceAudioLayer)
  );

  const startTime = Math.max(0, Number(sourceAudioLayer?.startTime) || 0);
  const duration = Number(sourceAudioLayer?.duration);
  const resolvedDuration = Number.isFinite(duration) && duration >= 0 ? duration : 0;
  const sourceEndTime = Number(sourceAudioLayer?.endTime);
  const endTime = Number.isFinite(sourceEndTime)
    ? sourceEndTime
    : startTime + resolvedDuration;

  duplicatedAudioLayer._id = duplicatedAudioLayerId;
  duplicatedAudioLayer.localAudioLinks = [copiedAudioRelativePath];
  duplicatedAudioLayer.selectedLocalAudioLink = copiedAudioRelativePath;
  duplicatedAudioLayer.startTime = startTime;
  duplicatedAudioLayer.duration = resolvedDuration;
  duplicatedAudioLayer.endTime = endTime;
  duplicatedAudioLayer.streamDownloadPending = false;
  duplicatedAudioLayer.isTimelineLocked = false;

  sessionData.audioLayers.push(applyAudioLayerManualVolumeDefaults(duplicatedAudioLayer));

  const savedSession = await sessionData.save();
  const savedDuplicatedAudioLayer = savedSession.audioLayers.find(
    (audioLayer) => audioLayer?._id?.toString() === duplicatedAudioLayerId.toString()
  );

  if (
    savedDuplicatedAudioLayer?.addSubtitles
    && savedDuplicatedAudioLayer?.generationType === 'speech'
  ) {
    await generateTranscriptsForSessionAudioLayer(
      sessionData._id.toString(),
      savedDuplicatedAudioLayer
    );
  }

  return {
    sessionDetails: savedSession,
    audioLayer: savedDuplicatedAudioLayer,
  };
}

function normalizeGlobalAudioLayersField(sessionData = {}) {
  if (Array.isArray(sessionData.global_audio_layers)) {
    return sessionData.global_audio_layers;
  }
  if (Array.isArray(sessionData.globalAudioLayers)) {
    return sessionData.globalAudioLayers;
  }
  return [];
}

function toPlainSessionObject(value = {}) {
  if (!value) {
    return {};
  }
  if (typeof value.toObject === 'function') {
    return value.toObject();
  }
  return JSON.parse(JSON.stringify(value));
}

async function resolveGlobalAudioDurationSeconds(audioLink, requestedDuration, fallbackDuration = 1) {
  const explicitDuration = firstPositiveSeconds(requestedDuration);
  if (explicitDuration) {
    return explicitDuration;
  }

  let probedDuration = null;
  if (audioLink) {
    probedDuration = await getAudioDurationSecondsForLink(audioLink).catch((error) => {
      console.error('Unable to probe global audio duration', {
        audioLink,
        error: error?.message || error,
      });
      return null;
    });
  }

  return firstPositiveSeconds(probedDuration, fallbackDuration, 1) || 1;
}

function preserveGlobalAudioSourceFields(mergedAudioLayer = {}, existingAudioLayer = {}) {
  [
    'localAudioLinks',
    'remoteAudioLinks',
    'remoteAudioData',
    'selectedLocalAudioLink',
    'selectedRemoteAudioLink',
    'url',
  ].forEach((field) => {
    const nextValue = mergedAudioLayer[field];
    const hasNextValue = Array.isArray(nextValue)
      ? nextValue.length > 0
      : typeof nextValue === 'string'
        ? nextValue.trim()
        : nextValue !== null && typeof nextValue !== 'undefined';

    if (!hasNextValue && typeof existingAudioLayer[field] !== 'undefined') {
      mergedAudioLayer[field] = existingAudioLayer[field];
    }
  });

  return mergedAudioLayer;
}

function cleanGlobalAudioLayerForPersistence(audioLayer = {}) {
  const nextAudioLayer = toPlainSessionObject(audioLayer);
  [
    'isDirty',
    'isSaving',
    'isDisplaySelected',
    'isSelected',
    'saveError',
    'trackKey',
    'durationFrames',
    'startFrame',
    'endFrame',
  ].forEach((field) => {
    delete nextAudioLayer[field];
  });

  nextAudioLayer.globalAudioLayer = true;
  nextAudioLayer.audioBindingMode = 'global';
  nextAudioLayer.bindToLayer = false;
  nextAudioLayer.generationType = 'recorded_speech';
  nextAudioLayer.libraryType = 'speech';
  nextAudioLayer.generationStatus = nextAudioLayer.generationStatus || 'COMPLETED';
  nextAudioLayer.isEnabled = nextAudioLayer.isEnabled !== false;
  nextAudioLayer.defaultSelected = nextAudioLayer.defaultSelected !== false;
  nextAudioLayer.fadeOnEdges = false;
  nextAudioLayer.addSubtitles = false;

  delete nextAudioLayer.connectedLayerId;
  delete nextAudioLayer.connectedLayerIndex;
  delete nextAudioLayer.connectedLayerStartTimeOffset;

  return applyAudioLayerManualVolumeDefaults(nextAudioLayer);
}

async function normalizeGlobalAudioLayerForSession(inputAudioLayer = {}, existingAudioLayer = null) {
  const existingPlainAudioLayer = toPlainSessionObject(existingAudioLayer);
  const mergedAudioLayer = preserveGlobalAudioSourceFields({
    ...existingPlainAudioLayer,
    ...toPlainSessionObject(inputAudioLayer),
  }, existingPlainAudioLayer);
  const audioLayerId = (
    mergedAudioLayer?._id?.toString?.()
    || mergedAudioLayer?._id
    || new mongoose.Types.ObjectId()
  );
  const startTime = Number.isFinite(Number(mergedAudioLayer.startTime))
    ? Math.max(0, Number(mergedAudioLayer.startTime))
    : 0;
  const requestedDuration = normalizePositiveSeconds(
    mergedAudioLayer.duration,
    Number.isFinite(Number(mergedAudioLayer.endTime))
      ? Math.max(0, Number(mergedAudioLayer.endTime) - startTime)
      : null
  );
  const { link: audioLink } = resolveAudioItemLink(mergedAudioLayer);
  const duration = await resolveGlobalAudioDurationSeconds(
    audioLink,
    requestedDuration,
    firstPositiveSeconds(
      mergedAudioLayer.originalDuration,
      mergedAudioLayer?.generationMeta?.recordedDuration,
      1
    )
  );
  const endTime = startTime + duration;

  return cleanGlobalAudioLayerForPersistence({
    ...mergedAudioLayer,
    _id: audioLayerId,
    startTime,
    duration,
    endTime,
    originalDuration: normalizePositiveSeconds(mergedAudioLayer.originalDuration, duration),
  });
}

export async function addGlobalAudioFromLibraryToSession(userId, payload) {
  await getDBConnectionString();

  const { sessionId, audioItem = {} } = payload || {};
  const sessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const { link: resolvedAudioLink, type: resolvedAudioLinkType } = resolveAudioItemLink(audioItem);
  if (!resolvedAudioLink) {
    throw new Error('Audio item is missing a valid audio link');
  }

  const parsedStartTime = Number(payload.startTime);
  const startTime = Number.isFinite(parsedStartTime) && parsedStartTime >= 0 ? parsedStartTime : 0;
  const sourceDuration = await getAudioDurationSecondsForLink(resolvedAudioLink).catch(() => null);
  const duration = firstPositiveSeconds(
    sourceDuration,
    audioItem.duration,
    audioItem.originalDuration,
    payload.duration,
    payload.recordedDuration,
    1
  );
  const volume = Number.isFinite(Number(payload.volume ?? audioItem.volume)) && Number(payload.volume ?? audioItem.volume) >= 0
    ? Number(payload.volume ?? audioItem.volume)
    : 100;
  const globalAudioLayerId = new mongoose.Types.ObjectId();
  const localAudioLinks = Array.isArray(audioItem.localAudioLinks)
    ? audioItem.localAudioLinks.filter((link) => typeof link === 'string' && link.trim())
    : [];
  const remoteAudioLinks = Array.isArray(audioItem.remoteAudioLinks)
    ? audioItem.remoteAudioLinks.filter((link) => typeof link === 'string' && link.trim())
    : [];

  const globalAudioLayerDraft = cleanGlobalAudioLayerForPersistence({
    _id: globalAudioLayerId,
    prompt: audioItem.prompt || audioItem.description || audioItem.title || 'Recorded speech',
    title: audioItem.title || 'Recorded speech',
    generationType: 'recorded_speech',
    libraryType: 'speech',
    source: 'recorded_speech',
    isEnabled: true,
    defaultSelected: true,
    volume,
    startTime,
    endTime: startTime + duration,
    duration,
    originalDuration: firstPositiveSeconds(sourceDuration, audioItem.originalDuration, audioItem.duration, duration),
    generationStatus: 'COMPLETED',
    streamDownloadPending: false,
    fadeOnEdges: false,
    addSubtitles: false,
    speakerCharacterName: audioItem.speakerCharacterName || 'Recorded speech',
    generationMeta: {
      ...(audioItem.generationMeta && typeof audioItem.generationMeta === 'object' ? audioItem.generationMeta : {}),
      sourceType: 'recorded_speech',
      globalAudioLayer: true,
      recordedDuration: firstPositiveSeconds(payload.recordedDuration, payload.duration, audioItem.duration, sourceDuration),
    },
  });

  if (resolvedAudioLinkType === 'local') {
    globalAudioLayerDraft.localAudioLinks = localAudioLinks.length > 0 ? localAudioLinks : [resolvedAudioLink];
    globalAudioLayerDraft.selectedLocalAudioLink = audioItem.selectedLocalAudioLink || globalAudioLayerDraft.localAudioLinks[0];
    if (remoteAudioLinks.length > 0) {
      globalAudioLayerDraft.remoteAudioLinks = remoteAudioLinks;
      globalAudioLayerDraft.selectedRemoteAudioLink = audioItem.selectedRemoteAudioLink || remoteAudioLinks[0];
    }
  } else {
    globalAudioLayerDraft.remoteAudioLinks = remoteAudioLinks.length > 0 ? remoteAudioLinks : [resolvedAudioLink];
    globalAudioLayerDraft.selectedRemoteAudioLink = audioItem.selectedRemoteAudioLink || globalAudioLayerDraft.remoteAudioLinks[0];
    if (localAudioLinks.length > 0) {
      globalAudioLayerDraft.localAudioLinks = localAudioLinks;
      globalAudioLayerDraft.selectedLocalAudioLink = audioItem.selectedLocalAudioLink || localAudioLinks[0];
    }
  }

  if (Array.isArray(audioItem.remoteAudioData) && audioItem.remoteAudioData.length > 0) {
    globalAudioLayerDraft.remoteAudioData = audioItem.remoteAudioData;
  }

  const globalAudioLayer = await normalizeGlobalAudioLayerForSession(globalAudioLayerDraft);

  sessionData.global_audio_layers = [
    ...normalizeGlobalAudioLayersField(sessionData),
    globalAudioLayer,
  ];
  extendSessionTimelineToCustomSpeechEnd(sessionData, [globalAudioLayer]);

  const savedSession = await sessionData.save();
  const savedGlobalAudioLayer = normalizeGlobalAudioLayersField(savedSession).find(
    (audioLayer) => audioLayer?._id?.toString() === globalAudioLayerId.toString()
  ) || globalAudioLayer;

  return {
    sessionDetails: savedSession,
    globalAudioLayer: savedGlobalAudioLayer,
    globalAudioLayers: normalizeGlobalAudioLayersField(savedSession),
  };
}

export async function updateGlobalAudioLayersForSession(userId, payload) {
  await getDBConnectionString();

  const { sessionId, globalAudioLayers } = payload || {};
  if (!Array.isArray(globalAudioLayers)) {
    throw new Error('globalAudioLayers must be an array.');
  }

  const sessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const existingGlobalAudioLayers = normalizeGlobalAudioLayersField(sessionData);
  const existingGlobalAudioLayerMap = new Map(existingGlobalAudioLayers.map((audioLayer) => [
    audioLayer?._id?.toString?.() || audioLayer?._id,
    audioLayer,
  ]));

  const normalizedGlobalAudioLayers = [];
  for (const inputAudioLayer of globalAudioLayers) {
    const inputAudioLayerId = inputAudioLayer?._id?.toString?.() || inputAudioLayer?._id || inputAudioLayer?.id || null;
    normalizedGlobalAudioLayers.push(await normalizeGlobalAudioLayerForSession(
      inputAudioLayer,
      inputAudioLayerId ? existingGlobalAudioLayerMap.get(inputAudioLayerId.toString()) : null
    ));
  }

  sessionData.global_audio_layers = normalizedGlobalAudioLayers;
  extendSessionTimelineToCustomSpeechEnd(sessionData, normalizedGlobalAudioLayers);
  const savedSession = await sessionData.save();

  return {
    sessionDetails: savedSession,
    globalAudioLayers: normalizeGlobalAudioLayersField(savedSession),
  };
}

export async function addAudioFromLibraryToSession(userId, payload) {

  await getDBConnectionString();
  const { sessionId, audioItem = {} } = payload;

  let sessionData = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const { link: resolvedAudioLink, type: resolvedAudioLinkType } = resolveAudioItemLink(audioItem);
  if (!resolvedAudioLink) {
    throw new Error('Audio item is missing a valid audio link');
  }

  const generationType = resolveLibraryAudioGenerationType(audioItem);
  const rawConnectedLayerId = payload.connectedLayerId || payload.currentLayerId || payload.layerId;
  const requestedConnectedLayerId = typeof rawConnectedLayerId === 'string' && rawConnectedLayerId.trim()
    ? rawConnectedLayerId.trim()
    : rawConnectedLayerId?.toString?.() || null;
  const connectedLayerId = shouldBindLibraryAudioToLayer(payload, generationType)
    ? requestedConnectedLayerId
    : null;
  const sessionLayers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const connectedLayerIndex = connectedLayerId
    ? sessionLayers.findIndex((layer) => layer?._id?.toString() === connectedLayerId)
    : -1;
  const connectedLayer = connectedLayerIndex >= 0 ? sessionLayers[connectedLayerIndex] : null;
  const connectedLayerStartTime = Number(connectedLayer?.durationOffset);
  const connectedLayerDuration = Number(connectedLayer?.duration);
  const parsedStartTime = Number(payload.startTime);
  const startTime = Number.isFinite(parsedStartTime) && parsedStartTime >= 0
    ? parsedStartTime
    : Number.isFinite(connectedLayerStartTime) && connectedLayerStartTime >= 0
      ? connectedLayerStartTime
    : 0;
  const requestedDuration = normalizePositiveSeconds(
    payload.duration ?? audioItem.duration,
    Number.isFinite(connectedLayerDuration) && connectedLayerDuration > 0 ? connectedLayerDuration : 120
  );
  const shouldLoopMusicOverEntireSession = normalizeBooleanValue(payload.loopOverEntireSession);
  const isRecordedSpeechLayer = generationType === 'recorded_speech';
  const shouldAddSubtitles = generationType === 'speech' && resolveSessionSubtitlesEnabled(sessionData);
  const isStudioSpeechLayer = generationType === 'speech' || isRecordedSpeechLayer;
  const selectedSubtitleOption = typeof payload.selectedSubtitleOption === 'string' && payload.selectedSubtitleOption.trim()
    ? payload.selectedSubtitleOption.trim()
    : typeof payload.subtitleOption === 'string' && payload.subtitleOption.trim()
      ? payload.subtitleOption.trim()
      : 'SUBTITLE';
  const parsedVolume = Number(payload.volume ?? audioItem.volume);
  const defaultVolume = generationType === 'sound_effect' ? 40 : 100;
  const volume = Number.isFinite(parsedVolume) && parsedVolume >= 0 ? parsedVolume : defaultVolume;
  const localAudioLinks = Array.isArray(audioItem.localAudioLinks)
    ? audioItem.localAudioLinks.filter((link) => typeof link === 'string' && link.trim())
    : [];
  const remoteAudioLinks = Array.isArray(audioItem.remoteAudioLinks)
    ? audioItem.remoteAudioLinks.filter((link) => typeof link === 'string' && link.trim())
    : [];
  const audioLayerId = new mongoose.Types.ObjectId();

  let duration = requestedDuration;
  let endTime = startTime + duration;
  let originalDuration = duration;
  let appliedLocalAudioLinks = localAudioLinks;
  let appliedSelectedLocalAudioLink = typeof audioItem.selectedLocalAudioLink === 'string'
    ? audioItem.selectedLocalAudioLink
    : null;

  if (generationType === 'music') {
    const musicTrackApplication = await resolveMusicTrackApplication({
      sessionData,
      audioLayerId,
      sourceAudioLink: resolvedAudioLink,
      startTime,
      loopOverEntireSession: shouldLoopMusicOverEntireSession,
      fallbackDuration: requestedDuration,
      filePrefix: 'library-music',
    });

    duration = musicTrackApplication.duration;
    endTime = musicTrackApplication.endTime;
    originalDuration = musicTrackApplication.originalDuration;

    if (Array.isArray(musicTrackApplication.localAudioLinks) && musicTrackApplication.localAudioLinks.length > 0) {
      appliedLocalAudioLinks = musicTrackApplication.localAudioLinks;
      appliedSelectedLocalAudioLink = musicTrackApplication.selectedLocalAudioLink;
    }
  }

  const audioLayer = applyAudioLayerManualVolumeDefaults({
    _id: audioLayerId,
    prompt: audioItem.prompt || audioItem.description || audioItem.title || '',
    title: audioItem.title || '',
    generationType,
    isEnabled: true,
    defaultSelected: true,
    volume,
    startTime,
    endTime,
    duration,
    generationStatus: 'COMPLETED',
    streamDownloadPending: false,
    fadeOnEdges: resolveLibraryAudioFadeOnEdges(audioItem, payload, generationType),
    addSubtitles: shouldAddSubtitles,
    originalDuration,
    ...(isStudioSpeechLayer
      ? {
          audioBindingMode: 'unbounded',
          bindToLayer: false,
          studioSpeechGeneration: true,
        }
      : {}),
  });

  if (generationType === 'speech') {
    audioLayer.selectedSubtitleOption = selectedSubtitleOption;
  }

  if (connectedLayerId) {
    audioLayer.connectedLayerId = connectedLayerId;
    audioLayer.connectedLayerStartTimeOffset = Number.isFinite(connectedLayerStartTime)
      ? connectedLayerStartTime
      : startTime;

    if (connectedLayerIndex >= 0) {
      audioLayer.connectedLayerIndex = connectedLayerIndex;
    }
  }

  if (generationType === 'music' && shouldLoopMusicOverEntireSession) {
    audioLayer.fadeOnEdges = true;
    audioLayer.loopOverEntireSession = true;
  }

  if (resolvedAudioLinkType === 'local') {
    audioLayer.localAudioLinks = appliedLocalAudioLinks.length > 0
      ? appliedLocalAudioLinks
      : [resolvedAudioLink];
    audioLayer.selectedLocalAudioLink = appliedSelectedLocalAudioLink || audioLayer.localAudioLinks[0];
    if (remoteAudioLinks.length > 0) {
      audioLayer.remoteAudioLinks = remoteAudioLinks;
      audioLayer.selectedRemoteAudioLink = audioItem.selectedRemoteAudioLink || remoteAudioLinks[0];
    }
  } else {
    audioLayer.remoteAudioLinks = remoteAudioLinks.length > 0 ? remoteAudioLinks : [resolvedAudioLink];
    audioLayer.selectedRemoteAudioLink = audioItem.selectedRemoteAudioLink || audioLayer.remoteAudioLinks[0];
    if (appliedLocalAudioLinks.length > 0) {
      audioLayer.localAudioLinks = appliedLocalAudioLinks;
      audioLayer.selectedLocalAudioLink = appliedSelectedLocalAudioLink || appliedLocalAudioLinks[0];
    }
  }

  if (Array.isArray(audioItem.remoteAudioData) && audioItem.remoteAudioData.length > 0) {
    audioLayer.remoteAudioData = audioItem.remoteAudioData;
  }

  if (typeof audioItem.speakerCharacterName === 'string' && audioItem.speakerCharacterName.trim()) {
    audioLayer.speakerCharacterName = audioItem.speakerCharacterName.trim();
  }

  if (typeof audioItem.provider === 'string' && audioItem.provider.trim()) {
    audioLayer.provider = audioItem.provider.trim();
  }

  if (typeof audioItem.speakerVoiceId === 'string' && audioItem.speakerVoiceId.trim()) {
    audioLayer.speakerVoiceId = audioItem.speakerVoiceId.trim();
  }

  if (typeof audioItem.speakerLabel === 'string' && audioItem.speakerLabel.trim()) {
    audioLayer.speakerLabel = audioItem.speakerLabel.trim();
  }

  if (audioItem.speakerDetails && typeof audioItem.speakerDetails === 'object' && !Array.isArray(audioItem.speakerDetails)) {
    audioLayer.speakerDetails = audioItem.speakerDetails;
  }

  if (typeof audioItem.languageCode === 'string' && audioItem.languageCode.trim()) {
    audioLayer.languageCode = audioItem.languageCode.trim();
  }

  if (Array.isArray(audioItem.languageCodes)) {
    audioLayer.languageCodes = audioItem.languageCodes.filter(
      (languageCode) => typeof languageCode === 'string' && languageCode.trim()
    );
  }

  if (typeof audioItem.instructions === 'string') {
    audioLayer.instructions = audioItem.instructions;
  }

  if (audioItem.generationMeta && typeof audioItem.generationMeta === 'object' && !Array.isArray(audioItem.generationMeta)) {
    audioLayer.generationMeta = audioItem.generationMeta;
  }

  if (typeof audioItem.lyrics === 'string' && audioItem.lyrics.trim()) {
    audioLayer.lyrics = audioItem.lyrics;
  }

  sessionData.audioLayers.push(audioLayer);
  extendSessionTimelineToCustomSpeechEnd(sessionData, [audioLayer]);

  let saveRes = await sessionData.save();

  const savedAudioLayer = saveRes.audioLayers.find(
    (sessionAudioLayer) => sessionAudioLayer?._id?.toString() === audioLayerId.toString()
  ) || audioLayer;

  if (shouldAddSubtitles && savedAudioLayer?.selectedLocalAudioLink) {
    try {
      await generateTranscriptsForSessionAudioLayer(sessionId, savedAudioLayer);
      const sessionWithSubtitles = await VideoSession.findById(sessionId);
      if (sessionWithSubtitles) {
        saveRes = sessionWithSubtitles;
      }
    } catch (error) {
      console.error('Unable to generate subtitles for imported library speech:', error);
    }
  }

  return {
    sessionDetails: saveRes
  }
}

export async function requestGenerateAudioVisualizer(userId, payload) {

  await getDBConnectionString();
  const { id } = payload;

  let sessionDataValue = await requireVideoSessionForStudioAccess(userId, id, {
    ...payload,
    sessionId: id,
  }, {
    markEdited: true,
  });


  await requestApplyMusicVisualizer(sessionDataValue);

}


export async function uploadUserVideoLayerToSession(userId, payload) {
  const {
    sessionId,
    layerId,
    fileBuffer,
    fileName,
    contentType,
  } = payload || {};

  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error('Uploaded video payload is empty.');
  }

  const uploadExtension = resolveUploadedVideoExtension(fileName, contentType);
  if (!uploadExtension) {
    throw new Error('Unable to determine a supported video file extension.');
  }

  const uploadedVideoPath = await saveUploadedVideoBuffer(fileBuffer, {
    sessionId,
    layerId,
    extension: uploadExtension,
    prefix: 'user_video_upload',
  });

  return finalizeUserVideoLayerUpload({
    sessionId,
    layerId,
    fileName,
    uploadedVideoPath,
  });
}

export async function addAiVideoLayerToSession(userId, payload) {
  await getDBConnectionString();

  const { sessionId, layerId, videoURL, videoModel, trimScene, audioPrompt } = payload;




  // Find the session and locate the specified layer
  let sessionDataValue = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });

  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  const layerIndex = sessionDataValue.layers.findIndex(layer => layer._id.toString() === layerId);

  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  const layer = sessionDataValue.layers[layerIndex];
  if (layer.userVideoGenerationPending || layer.hasUserVideoLayer || layer.userVideoLayer) {
    throw new Error('Remove the uploaded or pending video before adding another video artefact to this layer.');
  }
  resetLayerVideoEditState(layer);
  prepareLayerActiveItemsForVideoReplacement(layer);

  // Update the layer properties for AI video layer

  layer.aiVideoGenerationPending = false;
  layer.aiVideoGenerationStatus = 'COMPLETED';

  const canvasDimensions = getCanvasDimensionsForAspectRatio(sessionDataValue.aspectRatio);
  const videoPath = resolveProcessorAssetAbsolutePath(videoURL);
  if (!fs.existsSync(videoPath)) {
    throw new Error('The selected AI video asset could not be found on the processor.');
  }

  const modelType = getModelType(videoModel);

  const {
    isAudioVideoModel,
    isLipSyncModel,
    isSoundEffectModel,
  } = modelType;


  let firstFrame;
  let lastFrame;
  let duration;
  let audioPath;
  let frameCount;
  let frameDuration;
  const framesPerSecond = getSessionFramesPerSecondWithLog(
    sessionDataValue,
    'VideoSession.handleAiVideoCompletion'
  );

  let videoOriginalDuration;

  if (isAudioVideoModel) {


    const framesSubDir = (isLipSyncModel || isSoundEffectModel) ? 'audio_video' : null;
    const resData = await processVideoAsFramesAndAudio(
      videoPath,
      sessionId,
      layerId,
      canvasDimensions,
      framesPerSecond,
      { framesSubDir }
    );

    firstFrame = resData.firstFrame;
    lastFrame = resData.lastFrame;
    duration = resData.duration;
    audioPath = resData.audioPath;
    frameCount = resData.frameCount;
    frameDuration = resData.frameDuration;

    videoOriginalDuration = resData.duration;

    if (isLipSyncModel) {
      layer.lipSyncVideoLayer = videoURL;
      layer.lipSyncGenerationPending = false;
      layer.hasLipSyncVideoLayer = true;
      layer.layerAiVideoType = 'character';
    } else if (isSoundEffectModel) {
      layer.soundEffectVideoLayer = videoURL;
      layer.soundEffectGenerationPending = false;
      layer.hasSoundEffectVideoLayer = true;
      layer.layerAiVideoType = 'sound_effect';
    }

  } else {

    layer.aiVideoLayer = videoURL;
    layer.hasAiVideoLayer = true;
    layer.layerAiVideoType = 'ai_video';

    const resData = await processVideoAsFrames(
      videoPath,
      sessionId,
      layerId,
      canvasDimensions,
      framesPerSecond
    );



    firstFrame = resData.firstFrame;
    lastFrame = resData.lastFrame;
    duration = resData.duration;
    frameCount = resData.frameCount;
    frameDuration = resData.frameDuration;
    videoOriginalDuration = resData.duration;
  }




  const requestedDuration = layer.duration;
  const frameSafeVideoDuration = getFrameSafeDurationSecondsFromFrameCount(frameCount, framesPerSecond)
    ?? (Number.isFinite(Number(frameDuration)) && Number(frameDuration) > 0 ? Number(frameDuration) : null);
  const shouldShrinkAudioVideoLayerToOutput = Boolean(
    (isLipSyncModel || isSoundEffectModel)
    && Number.isFinite(frameSafeVideoDuration)
    && frameSafeVideoDuration > 0
    && frameSafeVideoDuration < requestedDuration - (0.5 / framesPerSecond)
  );

  if (shouldShrinkAudioVideoLayerToOutput) {
    layer.duration = frameSafeVideoDuration;
    duration = frameSafeVideoDuration;
    videoOriginalDuration = frameSafeVideoDuration;
  }

  layer.aiVideoFrameGenerationPending = false;
  layer.initFramesGenerated = false;
  layer.frameGenerationPending = true;
  layer.frames = [];

  if (firstFrame) {
    layer.aiLayerStartFrame = getRelativeAssetPathFromAbsolute(firstFrame);
  }
  if (lastFrame) {
    layer.aiLayerEndFrame = getRelativeAssetPathFromAbsolute(lastFrame);
  }

  // Handle case where AI video duration is less than layer's duration
  if (!shouldShrinkAudioVideoLayerToOutput && duration < requestedDuration) {
    // AI video is shorter than layer duration

    const paddingFramesPerSecond = getSessionFramesPerSecondWithLog(
      sessionDataValue,
      'VideoSession.applyAiVideoPadding'
    );
    const totalFramesInVideo = Math.round(duration * paddingFramesPerSecond);
    const frameOffset = totalFramesInVideo;
    const frameDuration = Math.round((requestedDuration - duration) * paddingFramesPerSecond);

    const lastFrameRelativePath = getRelativeAssetPathFromAbsolute(lastFrame)
      || path.relative(path.join(process.cwd(), 'assets'), lastFrame);

    // Create new image item
    const newImageItem = {
      type: 'image',
      src: lastFrameRelativePath.startsWith('/')
        ? lastFrameRelativePath.replace(/\\/g, '/')
        : `/${lastFrameRelativePath.replace(/\\/g, '/')}`,
      x: 0,
      y: 0,
      width: canvasDimensions.width,
      height: canvasDimensions.height,
      id: `item_last_frame_${layer._id.toString()}`,
      isAiVideoPaddingFrame: true,
      config: {
        frameRate: paddingFramesPerSecond,
        isAiVideoPaddingFrame: true,
        frameDuration: frameDuration,
        frameOffset: frameOffset,
      },
      animations: [], // No animations for the static image
    };

    if (!layer.imageSession.activeItemList) {
      layer.imageSession.activeItemList = [];
    }
    layer.imageSession.activeItemList.push(newImageItem);

    layer.frameGenerationPending = true;

    // Keep layer.duration as requestedDuration
  } else if (duration > requestedDuration) {
    // AI video is longer than layer duration
    // Optionally, implement trimming logic if necessary

    if (!trimScene) {
      // If trimScene is not set, keep the layer duration as requestedDuration
      layer.duration = videoOriginalDuration;
      layer.frameGenerationPending = true;
    }

  }

  // The layer's duration remains as requestedDuration


  // Save the updated session data
  await sessionDataValue.save();

  let updatedSessionData = await VideoSession.findOne({ _id: sessionId });

  if (isAudioVideoModel) {

    const generationType = isLipSyncModel ? 'lip_sync' : 'sound_effect';

    let volume = generationType === 'sound_effect' ? 40 : 100;
    let fadeOnEdges = generationType === 'sound_effect';



    const audioRelativePath = (getRelativeAssetPathFromAbsolute(audioPath) || audioPath)
      .replace(/^\/+/, '');


    let audioLayers = updatedSessionData.audioLayers;

    const newAudioLayer = applyAudioLayerManualVolumeDefaults({
      connectedLayerId: layerId,
      startTime: layer.durationOffset,
      endTime: layer.durationOffset + layer.duration,
      duration: layer.duration,
      generationType: generationType,
      generationStatus: 'COMPLETED',
      fadeOnEdges: fadeOnEdges,
      volume: volume,
      localAudioLinks: [audioRelativePath],
      selectedLocalAudioLink: audioRelativePath,
      isEnabled: true,
      isLayerLocked: true,
      defaultSelected: true,
      prompt: audioPrompt,
    });

    audioLayers.push(newAudioLayer);

    await VideoSession.updateOne({
      _id: sessionId
    }, {
      $set: {
        audioLayers: audioLayers
      }
    });

    let updatedSession = await VideoSession.findOne({
      _id: sessionId
    });

    const updatedAudioLayers = updatedSession.audioLayers;
    const connectedAudioLayer = updatedAudioLayers.find(layer => layer.connectedLayerId === layerId);


    if (connectedAudioLayer && audioPrompt) {
      await generateTranscriptsForSessionAudioLayer(sessionId, connectedAudioLayer);
    }


  }


  updatedSessionData = await VideoSession.findOne({
    _id: sessionId
  });



  const updatedLayerIndex = updatedSessionData.layers.findIndex(layer => layer._id.toString() === layerId);

  let updatedLayers = updatedSessionData.layers;
  let audioLayers = updatedSessionData.audioLayers;
  const updatedLayer = updatedSessionData.layers[updatedLayerIndex];
  const pendingFrameRefreshLayerIds = updatedLayers
    .slice(updatedLayerIndex)
    .map((sessionLayer) => sessionLayer?._id?.toString?.())
    .filter(Boolean);

  // const updatedLayerId = updatedLayer._id.toString();




  // update layer durations for subsequent layers
  const speechAudioLayers = audioLayers.filter((audioLayer) => audioLayer.generationType === 'speech');
  for (let i = updatedLayerIndex + 1; i < updatedLayers.length; i++) {
    updatedLayers[i].frameGenerationPending = true;
  }
  const totalDuration = recalculateLayerOffsetsAndConnectedAudio(updatedLayers, audioLayers);

  await VideoSession.updateOne({
    _id: sessionId,
  }, {
    $set: {
      layers: updatedLayers,
      audioLayers: audioLayers,
      frameGenerationPending: true,
      totalDuration,
    }
  });
  await ensureUnlockedFrameGenerations(sessionId, pendingFrameRefreshLayerIds);


  await generateTranscriptsForSessionAudioLayersAfterLayer(sessionId, updatedLayerIndex);




  const latestSessionData = await VideoSession.findOne({ _id: sessionId });
  const layerData = latestSessionData.layers.find(layer => layer._id.toString() === layerId);

  return {
    session: latestSessionData,
    layer: layerData
  };
}

function getVideoLibraryProjectName(sessionData = {}) {
  const sessionName = typeof sessionData?.sessionName === 'string'
    ? sessionData.sessionName.trim()
    : '';
  if (sessionName) {
    return sessionName;
  }

  const sessionId = sessionData?._id?.toString?.() || '';
  if (sessionId) {
    return `Project ${sessionId.slice(-6)}`;
  }

  return 'Untitled Project';
}

function normalizeVideoLibraryMediaPath(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return trimmedValue.startsWith('/') ? trimmedValue : `/${trimmedValue}`;
}

function getLayerVideoLibraryRemoteUrl(layer = {}, sourceType = 'ai_video') {
  if (sourceType === 'lip_sync') {
    return layer?.lipSyncRemoteLink || '';
  }
  if (sourceType === 'sound_effect') {
    return layer?.soundEffectRemoteLink || '';
  }
  if (sourceType === 'user_video') {
    return layer?.userVideoRemoteLink || '';
  }
  return layer?.aiVideoRemoteLink || '';
}

function buildVideoLibraryItem({
  sessionData = null,
  layer = null,
  layerIndex = null,
  sourceType = 'ai_video',
  assetPath = '',
  remoteUrl = null,
  thumbnailPath = null,
  thumbnailVideoPath = null,
  thumbnailVideoRemoteUrl = null,
  model = null,
  prompt = null,
  audioPrompt = null,
  duration = null,
  title = null,
}) {
  const normalizedAssetPath = normalizeVideoLibraryMediaPath(assetPath);
  const normalizedRemoteUrl = normalizeVideoLibraryMediaPath(
    remoteUrl || getLayerVideoLibraryRemoteUrl(layer, sourceType)
  );
  const primaryVideoPath = normalizedAssetPath || normalizedRemoteUrl;
  const normalizedThumbnailPathCandidate = typeof thumbnailPath === 'string' && thumbnailPath.trim()
    ? thumbnailPath.trim()
    : sourceType === 'lip_sync'
      ? layer?.lipSyncThumbnailPath || layer?.thumbnailPath || layer?.aiLayerStartFrame
      : sourceType === 'sound_effect'
        ? layer?.soundEffectThumbnailPath || layer?.thumbnailPath || layer?.aiLayerStartFrame
        : sourceType === 'user_video'
          ? layer?.userVideoThumbnailPath || layer?.thumbnailPath || layer?.aiLayerStartFrame
          : layer?.aiVideoThumbnailPath || layer?.thumbnailPath || layer?.aiLayerStartFrame;
  const normalizedThumbnailPath = normalizeVideoLibraryMediaPath(normalizedThumbnailPathCandidate);
  const normalizedThumbnailVideoCandidate = typeof thumbnailVideoPath === 'string' && thumbnailVideoPath.trim()
    ? thumbnailVideoPath.trim()
    : sourceType === 'lip_sync'
      ? layer?.lipSyncThumbnailVideo || layer?.thumbnailVideoPath
      : sourceType === 'sound_effect'
        ? layer?.soundEffectThumbnailVideo || layer?.thumbnailVideoPath
        : sourceType === 'user_video'
          ? layer?.userVideoThumbnailVideo || layer?.thumbnailVideoPath
          : layer?.aiVideoThumbnailVideo || layer?.thumbnailVideoPath;
  const normalizedThumbnailVideoPath = normalizeVideoLibraryMediaPath(normalizedThumbnailVideoCandidate);
  const normalizedThumbnailVideoRemoteUrl = normalizeVideoLibraryMediaPath(thumbnailVideoRemoteUrl);
  const previewVideoPath = normalizedThumbnailVideoRemoteUrl || normalizedThumbnailVideoPath;

  if (!primaryVideoPath) {
    return null;
  }

  const sessionId = sessionData?._id?.toString?.() || null;
  const layerId = layer?._id?.toString?.() || null;
  const normalizedDuration = Number(duration);
  const resolvedDuration = Number.isFinite(normalizedDuration) && normalizedDuration > 0
    ? Math.round(normalizedDuration * 100) / 100
    : null;

  const sourceLabel = sourceType === 'user_video'
    ? 'Uploaded Video'
    : sourceType === 'lip_sync'
      ? 'Lip Sync Video'
      : sourceType === 'sound_effect'
        ? 'Sound Effect Video'
        : 'AI Video';
  const fallbackPrompt = typeof layer?.videoGenerationPrompt === 'string' && layer.videoGenerationPrompt.trim()
    ? layer.videoGenerationPrompt.trim()
    : typeof layer?.prompt === 'string' && layer.prompt.trim()
      ? layer.prompt.trim()
      : null;
  const resolvedTitle = typeof title === 'string' && title.trim()
    ? title.trim()
    : layerIndex != null
      ? `Layer ${layerIndex + 1} ${sourceLabel}`
      : sourceLabel;
  const resolvedAspectRatio = typeof layer?.aspectRatio === 'string' && layer.aspectRatio.trim()
    ? layer.aspectRatio.trim()
    : typeof sessionData?.aspectRatio === 'string' && sessionData.aspectRatio.trim()
      ? sessionData.aspectRatio.trim()
      : null;

  return {
    _id: [
      sessionId || 'generated',
      layerId || 'library',
      sourceType,
      primaryVideoPath,
    ].join(':'),
    sessionId,
    layerId,
    projectName: getVideoLibraryProjectName(sessionData),
    sourceType,
    generationType: sourceType,
    sourceLabel,
    assetPath: primaryVideoPath,
    url: normalizedRemoteUrl || primaryVideoPath,
    remoteUrl: normalizedRemoteUrl || null,
    remoteURL: normalizedRemoteUrl || null,
    thumbnailPath: normalizedThumbnailPath || null,
    thumbnail: normalizedThumbnailPath || null,
    thumbnailVideoPath: normalizedThumbnailVideoPath || null,
    thumbnailVideoRemoteUrl: normalizedThumbnailVideoRemoteUrl || null,
    previewVideoPath: previewVideoPath || null,
    model: typeof model === 'string' && model.trim() ? model.trim() : null,
    prompt: typeof prompt === 'string' && prompt.trim() ? prompt.trim() : (fallbackPrompt || null),
    audioPrompt: typeof audioPrompt === 'string' && audioPrompt.trim() ? audioPrompt.trim() : null,
    duration: resolvedDuration,
    title: resolvedTitle,
    aspectRatio: resolvedAspectRatio,
    description: fallbackPrompt || resolvedTitle,
    createdAt: layer?.updatedAt || sessionData?.updatedAt || sessionData?.createdAt || null,
    updatedAt: layer?.updatedAt || sessionData?.updatedAt || sessionData?.createdAt || null,
  };
}

function extractSessionVideoLibraryItems(sessionData = {}) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  const items = [];

  layers.forEach((layer, layerIndex) => {
    const layerPrompt = typeof layer?.videoGenerationPrompt === 'string' && layer.videoGenerationPrompt.trim()
      ? layer.videoGenerationPrompt.trim()
      : typeof layer?.prompt === 'string' && layer.prompt.trim()
        ? layer.prompt.trim()
        : null;

    const preferredVideoSource = layer?.lipSyncVideoLayer
      ? { sourceType: 'lip_sync', assetPath: layer.lipSyncVideoLayer }
      : layer?.soundEffectVideoLayer
        ? { sourceType: 'sound_effect', assetPath: layer.soundEffectVideoLayer }
        : layer?.userVideoLayer
          ? { sourceType: 'user_video', assetPath: layer.userVideoLayer }
          : layer?.aiVideoLayer
            ? { sourceType: 'ai_video', assetPath: layer.aiVideoLayer }
            : null;

    if (preferredVideoSource) {
      items.push(buildVideoLibraryItem({
        sessionData,
        layer,
        layerIndex,
        sourceType: preferredVideoSource.sourceType,
        assetPath: preferredVideoSource.assetPath,
        prompt: layerPrompt,
        duration: layer.duration,
      }));
    }
  });

  return items.filter(Boolean);
}

function dedupeVideoLibraryItems(items = []) {
  const seenKeys = new Set();
  return items.filter((item) => {
    const dedupeKey = [
      item?.sessionId || 'generated',
      item?.sourceType || 'video',
      item?.assetPath || item?.url || '',
    ].join('|');

    if (!item?.assetPath || seenKeys.has(dedupeKey)) {
      return false;
    }

    seenKeys.add(dedupeKey);
    return true;
  });
}

function matchesVideoLibrarySearch(item = {}, search = '') {
  const normalizedSearch = typeof search === 'string' ? search.trim().toLowerCase() : '';
  if (!normalizedSearch) {
    return true;
  }

  return [
    item?.title,
    item?.description,
    item?.prompt,
    item?.model,
    item?.sourceLabel,
    item?.projectName,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedSearch));
}

function sortVideoLibraryItems(items = []) {
  return [...items].sort((leftItem, rightItem) => {
    const leftTimestamp = Date.parse(leftItem?.updatedAt || leftItem?.createdAt || 0) || 0;
    const rightTimestamp = Date.parse(rightItem?.updatedAt || rightItem?.createdAt || 0) || 0;
    return rightTimestamp - leftTimestamp;
  });
}

export async function getUserVideoLibrary(userId, query = {}) {
  await getDBConnectionString();

  const requestedSessionId = typeof query?.sessionId === 'string' && query.sessionId.trim()
    ? query.sessionId.trim()
    : null;
  const search = typeof query?.search === 'string' ? query.search.trim() : '';

  let currentSession = null;
  if (requestedSessionId) {
    const currentSessionDocument = await findVideoSessionForStudioAccess(userId, requestedSessionId, query, {
      markEdited: false,
    });
    currentSession = currentSessionDocument
      ? {
          _id: currentSessionDocument._id,
          sessionName: currentSessionDocument.sessionName,
          aspectRatio: currentSessionDocument.aspectRatio,
          layers: currentSessionDocument.layers,
          updatedAt: currentSessionDocument.updatedAt,
          createdAt: currentSessionDocument.createdAt,
        }
      : null;
  }

  const sessionQuery = { userId };
  if (requestedSessionId) {
    sessionQuery._id = { $ne: requestedSessionId };
  }

  const userSessions = await VideoSession.find(sessionQuery)
    .select('_id sessionName aspectRatio layers updatedAt createdAt')
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();

  const currentSessionItems = dedupeVideoLibraryItems(
    extractSessionVideoLibraryItems(currentSession)
  ).filter((item) => matchesVideoLibrarySearch(item, search));
  const globalSessionItems = dedupeVideoLibraryItems(
    userSessions.flatMap((sessionData) => extractSessionVideoLibraryItems(sessionData))
  ).filter((item) => matchesVideoLibrarySearch(item, search));

  const generatedVideoFilter = { userId };
  if (search) {
    generatedVideoFilter.$or = [
      { description: { $regex: search, $options: 'i' } },
      { prompt: { $regex: search, $options: 'i' } },
      { model: { $regex: search, $options: 'i' } },
    ];
  }

  const generatedVideos = await GeneratedAIVideo.find(generatedVideoFilter)
    .sort({ createdAt: -1 })
    .lean();

  const currentSessionGeneratedVideos = [];
  const globalGeneratedVideos = [];

  generatedVideos.forEach((generatedVideo) => {
    const generatedVideoSessionId = typeof generatedVideo?.sessionId === 'string'
      ? generatedVideo.sessionId.trim()
      : null;
    const sessionData = generatedVideoSessionId && currentSession?._id?.toString?.() === generatedVideoSessionId
      ? currentSession
      : userSessions.find((userSession) => userSession?._id?.toString?.() === generatedVideoSessionId) || null;
    const libraryItem = buildVideoLibraryItem({
      sessionData,
      sourceType: generatedVideo?.generationType || 'ai_video',
      assetPath: generatedVideo?.url,
      remoteUrl: generatedVideo?.remoteUrl,
      thumbnailPath: generatedVideo?.thumbnailPath,
      thumbnailVideoPath: generatedVideo?.thumbnailVideoPath,
      thumbnailVideoRemoteUrl: generatedVideo?.thumbnailVideoRemoteUrl,
      model: generatedVideo?.model,
      prompt: generatedVideo?.prompt,
      audioPrompt: generatedVideo?.audioPrompt,
      title: typeof generatedVideo?.description === 'string' ? generatedVideo.description : null,
      duration: generatedVideo?.duration,
    });
    if (!libraryItem || !matchesVideoLibrarySearch(libraryItem, search)) {
      return;
    }

    if (requestedSessionId && generatedVideoSessionId === requestedSessionId) {
      currentSessionGeneratedVideos.push(libraryItem);
      return;
    }

    globalGeneratedVideos.push(libraryItem);
  });

  return {
    projectItems: sortVideoLibraryItems(dedupeVideoLibraryItems([
      ...currentSessionGeneratedVideos,
      ...currentSessionItems,
    ])),
    globalItems: sortVideoLibraryItems(dedupeVideoLibraryItems([
      ...globalGeneratedVideos,
      ...globalSessionItems,
    ])),
  };
}

export async function addVideoFromLibraryToSession(userId, payload) {
  await getDBConnectionString();

  const { sessionId, layerId, videoItem = {}, trimScene = false } = payload || {};
  const sourceType = typeof videoItem?.sourceType === 'string'
    ? videoItem.sourceType.trim()
    : 'ai_video';
  const assetPath = typeof videoItem?.assetPath === 'string' && videoItem.assetPath.trim()
    ? videoItem.assetPath.trim()
    : typeof videoItem?.url === 'string' && videoItem.url.trim()
      ? videoItem.url.trim()
      : '';

  if (!sessionId || !layerId || !assetPath) {
    throw new Error('sessionId, layerId, and a valid video item are required.');
  }

  if (sourceType === 'ai_video') {
    return addAiVideoLayerToSession(userId, {
      sessionId,
      layerId,
      videoURL: assetPath,
      videoModel: videoItem?.model || null,
      trimScene,
      audioPrompt: videoItem?.audioPrompt || null,
    });
  }

  const sessionDataValue = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });

  const layerIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === layerId.toString()
  );
  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  const layer = sessionDataValue.layers[layerIndex];
  if (hasAnyLayerVideoLink(layer) || hasPendingLayerVideoTask(layer)) {
    throw new Error('Remove the existing or pending video artefact before importing another video.');
  }

  const absoluteSourceVideoPath = resolveProcessorAssetAbsolutePath(assetPath);
  if (!fs.existsSync(absoluteSourceVideoPath)) {
    throw new Error('The selected video asset could not be found on the processor.');
  }

  const sourceVideoMetadata = await getVideoMetadata(absoluteSourceVideoPath);
  const sourceDuration = Number(sourceVideoMetadata?.format?.duration);
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error('Unable to read the selected library video.');
  }

  const normalizedVideoPath = await normalizeVideoAssetToMp4WithoutAudio(absoluteSourceVideoPath, {
    sessionId,
    layerId,
    prefix: 'library_video',
  });
  const {
    audioPath: extractedAudioPath,
    leadingSilenceTrimSeconds = 0,
    trailingSilenceTrimSeconds = 0,
  } = await extractAudioFromVideoIfPresent(absoluteSourceVideoPath, {
    sessionId,
    layerId,
    prefix: 'library_video',
    trimUploadedAudioEdgeSilence: false,
  });

  const canvasDimensions = getCanvasDimensionsForAspectRatio(sessionDataValue.aspectRatio);
  const { firstFrame, lastFrame } = await extractVideoBoundaryFrames(
    normalizedVideoPath,
    sessionId,
    layerId,
    canvasDimensions,
    {
      durationSeconds: sourceDuration,
      preserveAspectRatio: true,
    }
  );

  layer.aiVideoLayer = null;
  layer.aiVideoRemoteLink = null;
  layer.hasAiVideoLayer = false;
  layer.aiVideoGenerationPending = false;
  layer.aiVideoGenerationStatus = 'INIT';

  layer.lipSyncVideoLayer = null;
  layer.lipSyncRemoteLink = null;
  layer.hasLipSyncVideoLayer = false;
  layer.lipSyncGenerationPending = false;
  layer.lipSyncVideoGenerationStatus = 'INIT';

  layer.soundEffectVideoLayer = null;
  layer.soundEffectRemoteLink = null;
  layer.hasSoundEffectVideoLayer = false;
  layer.soundEffectGenerationPending = false;
  layer.soundEffectVideoGenerationStatus = 'INIT';

  layer.userVideoLayer = getRelativeAssetPathFromAbsolute(normalizedVideoPath);
  layer.userVideoRemoteLink = null;
  layer.hasUserVideoLayer = true;
  layer.userVideoGenerationPending = false;
  layer.userVideoGenerationStatus = 'COMPLETED';
  layer.userVideoGenerationError = null;
  layer.userVideoUploadTaskId = null;
  layer.layerAiVideoType = 'user_video';
  layer.skipAiVideoGeneration = true;
  layer.aiVideoFrameGenerationPending = false;
  layer.initFramesGenerated = false;
  layer.frameGenerationPending = true;
  layer.duration = Math.floor(sourceDuration * 100) / 100;
  layer.frames = [];
  layer.clipStart = false;
  layer.clipEnd = false;
  layer.clipStartFrames = 0;
  layer.clipEndFrames = 0;
  resetLayerVideoEditState(layer);

  if (firstFrame) {
    layer.aiLayerStartFrame = getRelativeAssetPathFromAbsolute(firstFrame);
  }
  if (lastFrame) {
    layer.aiLayerEndFrame = getRelativeAssetPathFromAbsolute(lastFrame);
  }

  let updatedAudioLayers = Array.isArray(sessionDataValue.audioLayers)
    ? sessionDataValue.audioLayers.filter((audioLayer) => !(
        audioLayer?.connectedLayerId === layerId
        && (
          audioLayer?.generationType === 'user_video'
          || audioLayer?.generationType === 'lip_sync'
          || audioLayer?.generationType === 'sound_effect'
        )
      ))
    : [];

  if (extractedAudioPath) {
    const audioRelativePath = (getRelativeAssetPathFromAbsolute(extractedAudioPath) || '').replace(/^\/+/, '');
    updatedAudioLayers.push(applyAudioLayerManualVolumeDefaults({
      connectedLayerId: layerId,
      connectedLayerIndex: layerIndex,
      connectedLayerStartTimeOffset: layer.durationOffset,
      startTime: layer.durationOffset,
      endTime: layer.durationOffset + layer.duration,
      duration: layer.duration,
      sourceTrimStartTime: leadingSilenceTrimSeconds,
      originalDuration: layer.duration,
      generationType: 'user_video',
      generationStatus: 'COMPLETED',
      localAudioLinks: [audioRelativePath],
      selectedLocalAudioLink: audioRelativePath,
      isEnabled: true,
      isLayerLocked: true,
      defaultSelected: true,
      fadeOnEdges: false,
      volume: 100,
      prompt: videoItem?.title || videoItem?.description || 'Imported library video audio',
      generationMeta: {
        source: 'video_library',
        userVideoLeadingSilenceTrimSeconds: leadingSilenceTrimSeconds,
        userVideoTrailingSilenceTrimSeconds: trailingSilenceTrimSeconds,
      },
    }));
  }

  sessionDataValue.audioLayers = normalizeAudioLayerArrayManualVolumeSettings(updatedAudioLayers);
  for (let index = layerIndex + 1; index < sessionDataValue.layers.length; index += 1) {
    sessionDataValue.layers[index].frameGenerationPending = true;
  }
  sessionDataValue.totalDuration = recalculateLayerOffsetsAndConnectedAudio(
    sessionDataValue.layers,
    sessionDataValue.audioLayers,
  );
  sessionDataValue.frameGenerationPending = true;

  await deleteUnlockedFrameGenerations(sessionId, layerId);
  await sessionDataValue.save();

  const updatedSession = await VideoSession.findOne({ _id: sessionId });
  const updatedLayer = updatedSession.layers.find(
    (sessionLayer) => sessionLayer._id.toString() === layerId
  );

  return {
    session: updatedSession,
    layer: updatedLayer,
    audioLayers: updatedSession.audioLayers,
  };
}

async function markVideoLayerEditTaskFailed({ sessionId, layerId, taskId, message }) {
  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (sessionDataValue) {
    const layerIndex = sessionDataValue.layers.findIndex(
      (layer) => layer._id.toString() === layerId.toString()
    );
    if (layerIndex !== -1) {
      const layer = sessionDataValue.layers[layerIndex];
      layer.videoEditPending = false;
      layer.videoEditStatus = VIDEO_EDIT_STATUS.FAILED;
      layer.videoEditError = message || 'Video edit failed.';
      layer.videoEditTaskId = null;
      layer.videoEditTaskMessage = null;
      await sessionDataValue.save();
    }
  }

  await VideoLayerEditTask.updateOne(
    { taskId },
    {
      $set: {
        status: VIDEO_EDIT_STATUS.FAILED,
        errorMessage: message || 'Video edit failed.',
        message: message || 'Video edit failed.',
        completedAt: new Date(),
      },
    }
  );
}

async function applyQueuedVideoLayerEditTask(taskId) {
  await getDBConnectionString();

  const editTask = await VideoLayerEditTask.findOne({ taskId });
  if (!editTask) {
    return;
  }

  const sessionId = editTask.sessionId;
  const layerId = editTask.layerId;

  try {
    await VideoLayerEditTask.updateOne(
      { taskId },
      {
        $set: {
          status: VIDEO_EDIT_STATUS.PROCESSING,
          startedAt: new Date(),
          message: 'Applying video edits and rebuilding layer frames.',
        },
      }
    );

    const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
    if (!sessionDataValue) {
      throw new Error('VideoSession not found');
    }

    const layerIndex = sessionDataValue.layers.findIndex(
      (layer) => layer._id.toString() === layerId.toString()
    );
    if (layerIndex === -1) {
      throw new Error('Layer not found');
    }

    const layer = sessionDataValue.layers[layerIndex];
    const sourceType = getLayerVideoSourceType(layer);
    const sourceVideoLink = getLayerPreferredVideoLink(layer);
    if (!sourceType || !sourceVideoLink) {
      throw new Error('No editable video asset is attached to this layer.');
    }

    const currentLayerDuration = Number(layer.duration);
    if (!Number.isFinite(currentLayerDuration) || currentLayerDuration <= 0) {
      throw new Error('The selected layer has an invalid duration.');
    }

    const normalizedOperations = normalizeVideoEditOperations(
      editTask.operations,
      currentLayerDuration
    );
    const sourceVideoPath = resolveProcessorAssetAbsolutePath(sourceVideoLink);
    if (!fs.existsSync(sourceVideoPath)) {
      throw new Error('The source video asset could not be found.');
    }

    const sourceMetadata = await getVideoMetadata(sourceVideoPath);
    const hasAudioStream = Array.isArray(sourceMetadata?.streams)
      && sourceMetadata.streams.some((streamMeta) => streamMeta?.codec_type === 'audio');
    const connectedAudioGenerationType = getConnectedVideoAudioGenerationType(sourceType);

    const sessionFramesPerSecond = getSessionFramesPerSecondWithLog(
      sessionDataValue,
      'VideoSession.requestVideoLayerEdit'
    );
    const clipStartSeconds = layer?.clipStart
      ? Math.max(0, Math.round(Number(layer?.clipStartFrames) || 0) / sessionFramesPerSecond)
      : 0;
    const visibleSourceStartOffsetSeconds = clipStartSeconds;

    const visibleSegments = buildVisibleVideoEditSegments({
      operations: normalizedOperations,
      layerDurationSeconds: currentLayerDuration,
      sourceStartOffsetSeconds: visibleSourceStartOffsetSeconds,
    });
    const outputTimelineSegments = annotateVideoEditSegmentsWithOutputTimeline(visibleSegments);

    const renderedEditedVideoPath = await renderVisibleVideoEdit({
      inputVideoPath: sourceVideoPath,
      sessionId,
      layerId,
      segments: visibleSegments,
      includeAudio: hasAudioStream && !connectedAudioGenerationType,
    });

    const normalizedVideoPath = await normalizeVideoAssetToMp4WithoutAudio(renderedEditedVideoPath, {
      sessionId,
      layerId,
      prefix: 'video_edit',
    });
    let extractedAudioPath = null;
    if (hasAudioStream && !connectedAudioGenerationType) {
      ({
        audioPath: extractedAudioPath,
      } = await extractAudioFromVideoIfPresent(renderedEditedVideoPath, {
        sessionId,
        layerId,
        prefix: 'video_edit',
        trimUploadedAudioEdgeSilence: false,
      }));
    }
    const editedVideoMetadata = await getVideoMetadata(renderedEditedVideoPath);
    const editedVideoDuration = Math.floor((Number(editedVideoMetadata?.format?.duration) || 0) * 100) / 100;
    if (!Number.isFinite(editedVideoDuration) || editedVideoDuration <= 0) {
      throw new Error('Unable to read the edited video duration.');
    }

    const outputRelativeVideoPath = getRelativeAssetPathFromAbsolute(normalizedVideoPath);
    const previousDuration = layer.duration;

    if (sourceType === 'lip_sync') {
      layer.lipSyncVideoLayer = outputRelativeVideoPath;
      layer.hasLipSyncVideoLayer = true;
      layer.lipSyncGenerationPending = false;
      layer.lipSyncVideoGenerationStatus = 'COMPLETED';
    } else if (sourceType === 'sound_effect') {
      layer.soundEffectVideoLayer = outputRelativeVideoPath;
      layer.hasSoundEffectVideoLayer = true;
      layer.soundEffectGenerationPending = false;
      layer.soundEffectVideoGenerationStatus = 'COMPLETED';
    } else if (sourceType === 'user_video') {
      layer.userVideoLayer = outputRelativeVideoPath;
      layer.hasUserVideoLayer = true;
      layer.userVideoGenerationPending = false;
      layer.userVideoGenerationStatus = 'COMPLETED';
      layer.userVideoGenerationError = null;
      layer.userVideoUploadTaskId = null;
    } else {
      layer.aiVideoLayer = outputRelativeVideoPath;
      layer.hasAiVideoLayer = true;
      layer.aiVideoGenerationPending = false;
      layer.aiVideoGenerationStatus = 'COMPLETED';
    }

    layer.duration = editedVideoDuration;
    layer.clipStart = false;
    layer.clipEnd = false;
    layer.clipStartFrames = 0;
    layer.clipEndFrames = 0;
    layer.frameGenerationPending = true;
    layer.videoEditPending = false;
    layer.videoEditStatus = VIDEO_EDIT_STATUS.COMPLETED;
    layer.videoEditError = null;
    layer.videoEditTaskId = null;
    layer.videoEditTaskMessage = null;
    layer.videoEditPendingOperations = [];
    layer.videoEditHistory = Array.isArray(layer.videoEditHistory) ? layer.videoEditHistory : [];
    layer.videoEditHistory.push({
      taskId,
      appliedAt: new Date(),
      previousDuration,
      nextDuration: editedVideoDuration,
      sourceType,
      sourceVideoPath: sourceVideoLink,
      outputVideoPath: outputRelativeVideoPath,
      operations: normalizedOperations,
    });

    let audioLayers = Array.isArray(sessionDataValue.audioLayers) ? sessionDataValue.audioLayers : [];
    if (connectedAudioGenerationType) {
      const connectedAudioLayerIndex = audioLayers.findIndex((audioLayer) => (
        audioLayer?.connectedLayerId === layerId.toString()
        && audioLayer?.generationType === connectedAudioGenerationType
      ));

      const existingAudioLayer = connectedAudioLayerIndex !== -1
        ? audioLayers[connectedAudioLayerIndex]
        : null;
      const existingAudioWindow = existingAudioLayer
        ? getConnectedAudioRelativeWindow(
          existingAudioLayer,
          layer.durationOffset,
          previousDuration,
        )
        : null;
      let outputConnectedAudioPath = extractedAudioPath;
      let nextAudioSourceTrimStartTime = 0;
      let deletedExistingConnectedAudioLayer = false;

      if (!outputConnectedAudioPath) {
        let connectedAudioSourcePath = null;
        let connectedAudioSourceTrimStartTime = 0;
        let connectedAudioSourceWindow = existingAudioWindow;
        let shouldDeleteExistingConnectedAudio = connectedAudioLayerIndex !== -1;
        let temporarySourceAudioPath = null;

        const existingAudioSourcePath = resolveAudioLinkToLocalPath(
          existingAudioLayer?.selectedLocalAudioLink
          || existingAudioLayer?.localAudioLinks?.[0]
          || null
        );
        if (existingAudioSourcePath && fs.existsSync(existingAudioSourcePath)) {
          connectedAudioSourcePath = existingAudioSourcePath;
          connectedAudioSourceTrimStartTime = Math.max(0, Number(existingAudioWindow?.sourceTrimStartTime) || 0);
          shouldDeleteExistingConnectedAudio = false;
        } else if (hasAudioStream) {
          const extractedSourceAudio = await extractAudioFromVideoIfPresent(sourceVideoPath, {
            sessionId,
            layerId,
            prefix: 'video_edit_source',
            trimUploadedAudioEdgeSilence: false,
          });
          if (extractedSourceAudio?.audioPath) {
            temporarySourceAudioPath = extractedSourceAudio.audioPath;
            connectedAudioSourcePath = extractedSourceAudio.audioPath;
            connectedAudioSourceTrimStartTime = clipStartSeconds;
            connectedAudioSourceWindow = {
              relativeStart: 0,
              duration: previousDuration,
              sourceTrimStartTime: clipStartSeconds,
            };
            shouldDeleteExistingConnectedAudio = false;
          }
        }

        if (connectedAudioSourcePath && connectedAudioSourceWindow) {
          const editedAudioSegments = buildAudioEditSegmentsForConnectedAudio({
            relativeStart: connectedAudioSourceWindow.relativeStart,
            duration: connectedAudioSourceWindow.duration,
            sourceTrimStartTime: connectedAudioSourceTrimStartTime,
            segments: visibleSegments,
          });
          if (editedAudioSegments.length > 0) {
            outputConnectedAudioPath = await renderEditedAudioSegments({
              inputAudioPath: connectedAudioSourcePath,
              sessionId,
              layerId,
              segments: editedAudioSegments,
              prefix: 'video_edit',
            });
            nextAudioSourceTrimStartTime = 0;
          }
        }

        if (temporarySourceAudioPath) {
          await fsExtra.remove(temporarySourceAudioPath).catch(() => {});
        }

        if (!outputConnectedAudioPath && shouldDeleteExistingConnectedAudio) {
          audioLayers.splice(connectedAudioLayerIndex, 1);
          deletedExistingConnectedAudioLayer = true;
        }
      }

      if (outputConnectedAudioPath) {
        const audioRelativePath = (getRelativeAssetPathFromAbsolute(outputConnectedAudioPath) || '').replace(/^\/+/, '');
        const mappedAudioWindow = existingAudioWindow
          ? mapConnectedAudioWindowThroughVideoEditSegments({
            relativeStart: existingAudioWindow.relativeStart,
            duration: existingAudioWindow.duration,
            segments: outputTimelineSegments,
          })
          : null;
        const nextRelativeAudioStart = mappedAudioWindow
          ? mappedAudioWindow.relativeStart
          : 0;
        const nextRelativeAudioDuration = mappedAudioWindow
          ? mappedAudioWindow.duration
          : editedVideoDuration;
        const existingAudioLayerData = existingAudioLayer
          ? toPlainActiveItem(existingAudioLayer)
          : {};
        const nextAudioLayer = applyAudioLayerManualVolumeDefaults({
          ...existingAudioLayerData,
          connectedLayerId: layerId.toString(),
          connectedLayerIndex: layerIndex,
          connectedLayerStartTimeOffset: layer.durationOffset,
          startTime: roundConnectedAudioSeconds(layer.durationOffset + nextRelativeAudioStart),
          endTime: roundConnectedAudioSeconds(
            layer.durationOffset + nextRelativeAudioStart + nextRelativeAudioDuration
          ),
          duration: roundConnectedAudioSeconds(nextRelativeAudioDuration),
          originalDuration: outputConnectedAudioPath === extractedAudioPath
            ? editedVideoDuration
            : roundConnectedAudioSeconds(nextRelativeAudioDuration),
          sourceTrimStartTime: roundConnectedAudioSeconds(
            outputConnectedAudioPath === extractedAudioPath
              ? nextRelativeAudioStart
              : nextAudioSourceTrimStartTime
          ),
          generationType: connectedAudioGenerationType,
          generationStatus: 'COMPLETED',
          localAudioLinks: [audioRelativePath],
          selectedLocalAudioLink: audioRelativePath,
          isEnabled: true,
          isLayerLocked: true,
          defaultSelected: true,
          fadeOnEdges: connectedAudioGenerationType === 'sound_effect',
          volume: Number(existingAudioLayer?.volume) > 0
            ? existingAudioLayer.volume
            : (connectedAudioGenerationType === 'sound_effect' ? 40 : 100),
          prompt: existingAudioLayer?.prompt || `${layer.layerAiVideoType || sourceType} audio`,
        });

        if (connectedAudioLayerIndex !== -1) {
          audioLayers[connectedAudioLayerIndex] = nextAudioLayer;
        } else {
          audioLayers.push(nextAudioLayer);
        }
      } else if (connectedAudioLayerIndex !== -1 && !deletedExistingConnectedAudioLayer) {
        audioLayers.splice(connectedAudioLayerIndex, 1);
      }
    }

    for (let index = layerIndex + 1; index < sessionDataValue.layers.length; index += 1) {
      sessionDataValue.layers[index].frameGenerationPending = true;
    }
    const pendingFrameRefreshLayerIds = sessionDataValue.layers
      .slice(layerIndex)
      .map((sessionLayer) => sessionLayer?._id?.toString?.())
      .filter(Boolean);
    sessionDataValue.audioLayers = normalizeAudioLayerArrayManualVolumeSettings(audioLayers);
    sessionDataValue.totalDuration = recalculateLayerOffsetsAndConnectedAudio(
      sessionDataValue.layers,
      sessionDataValue.audioLayers,
    );
    sessionDataValue.frameGenerationPending = true;
    const shouldRegenerateSubtitles = shouldRegenerateSubtitlesForSession(sessionDataValue);
    sessionDataValue.transcriptGenerationPending = shouldRegenerateSubtitles;

    await sessionDataValue.save();
    await ensureUnlockedFrameGenerations(sessionId, pendingFrameRefreshLayerIds);
    await requestRealignConnectedAudioLayersToLayers(sessionId);
    await extractFramesFromAiVideoLayer(sessionId, layerId.toString());
    if (shouldRegenerateSubtitles) {
      try {
        await generateTranscriptsForSessionAudioLayersAfterLayer(sessionId, layerIndex);
      } catch (error) {
        console.error('[studio][video_edit] transcript regeneration after edit failed', {
          sessionId,
          layerId,
          taskId,
          error,
        });
      } finally {
        await VideoSession.updateOne(
          { _id: sessionId },
          { $set: { transcriptGenerationPending: false } }
        );
      }
    }

    await VideoLayerEditTask.updateOne(
      { taskId },
      {
        $set: {
          status: VIDEO_EDIT_STATUS.COMPLETED,
          outputVideoPath: outputRelativeVideoPath,
          outputAudioPath: extractedAudioPath
            ? (getRelativeAssetPathFromAbsolute(extractedAudioPath) || '').replace(/^\/+/, '')
            : null,
          previousDuration,
          nextDuration: editedVideoDuration,
          message: 'Video edit completed successfully.',
          completedAt: new Date(),
          errorMessage: null,
        },
      }
    );

    await fsExtra.remove(renderedEditedVideoPath).catch(() => {});
  } catch (error) {
    console.error('[studio][video_edit] failed', {
      sessionId,
      layerId,
      taskId,
      error,
    });
    await markVideoLayerEditTaskFailed({
      sessionId,
      layerId,
      taskId,
      message: error?.message || 'Video edit failed.',
    });
  }
}

function scheduleQueuedVideoLayerEditTask(taskId) {
  const startTask = () => {
    void applyQueuedVideoLayerEditTask(taskId);
  };

  if (typeof setImmediate === 'function') {
    setImmediate(startTask);
    return;
  }

  setTimeout(startTask, 0);
}

export async function requestVideoLayerEdit(userId, payload) {
  await getDBConnectionString();

  const { sessionId, layerId, operations = [] } = payload || {};
  if (!sessionId || !layerId) {
    throw new Error('sessionId and layerId are required.');
  }

  const sessionDataValue = await requireVideoSessionForStudioAccess(userId, sessionId, payload, {
    markEdited: true,
  });
  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  const layerIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === layerId.toString()
  );
  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  const layer = sessionDataValue.layers[layerIndex];
  if (layer.videoEditPending) {
    throw new Error('This layer already has a pending video edit.');
  }
  if (hasPendingLayerVideoTask(layer)) {
    throw new Error('Wait for the existing video task to complete before editing this layer.');
  }
  if (!getLayerPreferredVideoLink(layer)) {
    throw new Error('This layer does not contain a video artefact.');
  }

  const normalizedOperations = normalizeVideoEditOperations(operations, layer.duration);
  if (normalizedOperations.length === 0) {
    throw new Error('Add at least one cut or speed operation before applying video edits.');
  }

  const taskId = randomUUID();
  layer.videoEditPending = true;
  layer.videoEditStatus = VIDEO_EDIT_STATUS.PROCESSING;
  layer.videoEditError = null;
  layer.videoEditTaskId = taskId;
  layer.videoEditTaskMessage = 'Applying video edits in the background.';
  layer.videoEditPendingOperations = normalizedOperations;

  await sessionDataValue.save();

  await VideoLayerEditTask.create({
    userId,
    sessionId,
    layerId,
    taskId,
    status: VIDEO_EDIT_STATUS.PENDING,
    sourceType: getLayerVideoSourceType(layer),
    sourceVideoPath: getLayerPreferredVideoLink(layer),
    operations: normalizedOperations,
    previousDuration: layer.duration,
    message: 'Applying video edits in the background.',
  });

  scheduleQueuedVideoLayerEditTask(taskId);

  return {
    status: VIDEO_EDIT_STATUS.PENDING,
    taskId,
    session: sessionDataValue,
    layer: sessionDataValue.layers[layerIndex],
  };
}


export async function deleteVideoSessionsForUser(userId) {
  await getDBConnectionString();

  const sessions = await VideoSession.find({ userId }).select('_id').lean();
  const sessionIds = sessions.map(({ _id }) => _id.toString());
  if (sessionIds.length > 0) {
    const publications = await Publication.find({ sessionId: { $in: sessionIds } })
      .select('_id sessionId')
      .lean();
    const publicationIds = publications.map(({ _id }) => _id);
    if (publicationIds.length > 0) {
      await Comment.deleteMany({ publicationId: { $in: publicationIds } });
    }
    await Promise.all(sessionIds.map(async (sessionId) => {
      await Promise.all([
        deletePublicPublicationMediaForSession(sessionId),
        deleteInteractivePublicationForSession(sessionId),
      ]);
    }));
    await Publication.deleteMany({ sessionId: { $in: sessionIds } });
  }
  await VideoSession.deleteMany({ userId });
}

function createSessionDeleteError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDeleteSessionId(sessionId) {
  const normalizedSessionId = sessionId?.toString?.().trim?.() || '';
  if (!normalizedSessionId || !mongoose.Types.ObjectId.isValid(normalizedSessionId)) {
    throw createSessionDeleteError(400, 'A valid session id is required.');
  }
  return normalizedSessionId;
}

function getSessionScopedArtifactTargets(sessionId) {
  return [
    { type: 'directory', segments: ['video', 'splash', sessionId] },
    { type: 'directory', segments: ['video', 'frames', sessionId] },
    { type: 'directory', segments: ['video', 'audio', sessionId] },
    { type: 'directory', segments: ['video', 'footer_qr', sessionId] },
    { type: 'directory', segments: ['video', 'outro', sessionId] },
    { type: 'directory', segments: ['video', 'narrator_avatar', 'audio', sessionId] },
    { type: 'directory', segments: ['video', 'narrator_avatar', 'video', sessionId] },
    { type: 'directory', segments: ['video', 'narrator_avatar', 'frames', sessionId] },
    { type: 'directory', segments: ['video', 'narrator_avatar', 'joined_frames', sessionId] },
    { type: 'directory', segments: ['video', sessionId] },
    { type: 'directory', segments: ['ai_video', 'generations', sessionId] },
    { type: 'directory', segments: ['ai_video', 'frames', sessionId] },
    { type: 'directory', segments: ['ai_video', 'audio', sessionId] },
    { type: 'file', segments: ['video', 'audio_visualizers', `${sessionId}.json`] },
  ];
}

function getGenerationAssetTargetFromString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  let normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const isRemoteUrl = /^https?:\/\//i.test(normalizedValue);
  if (/^https?:\/\//i.test(normalizedValue)) {
    try {
      normalizedValue = new URL(normalizedValue).pathname;
    } catch {
      return null;
    }
  }

  try {
    normalizedValue = decodeURIComponent(
      normalizedValue
        .split('?')[0]
        .split('#')[0]
        .replace(/\\/g, '/')
    );
  } catch {
    return null;
  }

  const normalizedAssetPath = getNormalizedAssetPath(normalizedValue);
  const isGenerationPath = normalizedAssetPath.startsWith('generations/');
  const fileName = path.basename(
    isGenerationPath
      ? normalizedAssetPath.slice('generations/'.length)
      : normalizedAssetPath
  );
  const isKnownFlatGenerationFile = /^(generation|outpaint)_[A-Za-z0-9_.-]+\.(png|jpe?g|webp|gif)$/i.test(fileName);

  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    !SHARE_OG_IMAGE_EXTENSION_PATTERN.test(fileName) ||
    (isRemoteUrl && !isGenerationPath) ||
    (!isGenerationPath && !isKnownFlatGenerationFile)
  ) {
    return null;
  }

  return {
    type: 'file',
    segments: ['generations', fileName],
  };
}

function collectReferencedGenerationAssetTargets(assetSources = []) {
  const sources = Array.isArray(assetSources) ? assetSources : [assetSources];
  const targetsByKey = new Map();

  const visit = (value, depth = 0) => {
    if (value == null || depth > 8) {
      return;
    }

    if (typeof value === 'string') {
      const target = getGenerationAssetTargetFromString(value);
      if (target) {
        targetsByKey.set(target.segments.join('/'), target);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }

    if (typeof value === 'object') {
      Object.values(value).forEach((entry) => visit(entry, depth + 1));
    }
  };

  sources.forEach((source) => visit(source));
  return Array.from(targetsByKey.values());
}

function resolveSafeSessionArtifactPath(assetsRoot, targetSegments) {
  const resolvedAssetsRoot = path.resolve(assetsRoot);
  const targetPath = path.resolve(resolvedAssetsRoot, ...targetSegments);

  if (!targetPath.startsWith(`${resolvedAssetsRoot}${path.sep}`)) {
    throw createSessionDeleteError(400, 'Refusing to delete outside the assets directory.');
  }

  return targetPath;
}

async function removeSessionArtifactTarget(targetPath, expectedType) {
  try {
    const stat = await fsPromises.stat(targetPath);
    if (expectedType === 'directory' && !stat.isDirectory()) {
      return null;
    }
    if (expectedType === 'file' && !stat.isFile()) {
      return null;
    }

    await fsExtra.remove(targetPath);
    return {
      path: targetPath,
      type: expectedType,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function deleteLocalSessionArtifacts(sessionId, assetSources = []) {
  const normalizedSessionId = normalizeDeleteSessionId(sessionId);
  const assetsRoot = resolveProcessorAssetsRoot();
  const removed = [];
  const errors = [];
  const targets = [
    ...getSessionScopedArtifactTargets(normalizedSessionId),
    ...collectReferencedGenerationAssetTargets(assetSources),
  ];

  for (const target of targets) {
    try {
      const targetPath = resolveSafeSessionArtifactPath(assetsRoot, target.segments);
      const removedTarget = await removeSessionArtifactTarget(targetPath, target.type);
      if (removedTarget) {
        removed.push(removedTarget);
      }
    } catch (error) {
      errors.push({
        path: path.join(assetsRoot, ...target.segments),
        message: error?.message || 'Unable to delete session artifact.',
      });
    }
  }

  return {
    assetsRoot,
    removed,
    errors,
  };
}

async function deleteSessionDatabaseRecords(sessionObjectId, sessionId) {
  const deleteOperations = [
    ['videoSession', VideoSession.deleteOne({ _id: sessionObjectId })],
    ['videoSessionEditLogs', VideoSessionEditLog.deleteMany({ sessionId: sessionObjectId })],
    ['frameGenerations', FrameGeneration.deleteMany({ sessionId })],
    ['videoGenerations', VideoGeneration.deleteMany({ videoSessionId: sessionId })],
    ['aiVideoLayerGenerations', AIVideoLayerGeneration.deleteMany({ sessionId })],
    ['audioGenerations', AudioGeneration.deleteMany({ sessionId })],
    ['imageGenerations', ImageGeneration.deleteMany({
      $or: [
        { sessionId },
        { videoSessionId: sessionId },
      ],
    })],
    ['generatedImages', GeneratedImage.deleteMany({ sessionId })],
    ['generatedMusic', GeneratedMusic.deleteMany({ sessionId })],
    ['generatedAiVideos', GeneratedAIVideo.deleteMany({ sessionId })],
    ['videoLayerEditTasks', VideoLayerEditTask.deleteMany({ sessionId })],
    ['userVideoUploadTasks', UserVideoUploadTask.deleteMany({ sessionId })],
  ];

  const settledResults = await Promise.all(
    deleteOperations.map(async ([name, operation]) => {
      const result = await operation;
      return {
        name,
        deletedCount: result?.deletedCount || 0,
      };
    })
  );

  return settledResults;
}

export async function deleteVideoSessionForUser(userId, payload = {}) {
  await getDBConnectionString();

  const normalizedUserId = toUserIdString(userId);
  const sessionId = normalizeDeleteSessionId(
    payload.sessionId || payload.videoSessionId || payload.id
  );

  if (!normalizedUserId) {
    throw createSessionDeleteError(401, 'Unauthorized.');
  }

  const videoSession = await VideoSession.findById(sessionId);
  if (!videoSession) {
    throw createSessionDeleteError(404, 'Session not found.');
  }

  if (!isSessionOwner(videoSession, normalizedUserId)) {
    throw createSessionDeleteError(403, 'Only the session owner can delete this session.');
  }

  const publication = await Publication.findOne({ sessionId }).select('_id').lean();
  if (publication?._id) {
    await Comment.deleteMany({ publicationId: publication._id });
    await Publication.deleteOne({ _id: publication._id });
  }
  await deletePublicPublicationMediaForSession(sessionId);
  await deleteInteractivePublicationForSession(sessionId);

  const generatedImageRows = await GeneratedImage.find({ sessionId })
    .select('url')
    .lean();
  const localArtifactSources = [
    videoSession.toObject({ depopulate: true }),
    ...generatedImageRows,
  ];

  const databaseCleanup = await deleteSessionDatabaseRecords(videoSession._id, sessionId);
  const artifactCleanup = payload.deleteArtifacts === false
    ? {
      skipped: true,
      removed: [],
      errors: [],
    }
    : await deleteLocalSessionArtifacts(sessionId, localArtifactSources);

  return {
    status: 'deleted',
    sessionId,
    databaseCleanup,
    artifactCleanup,
  };
}



export async function updateLayersOrder(payload) {
  const { sessionId, layers } = payload; // 'layers' is a list of reordered layer IDs



  await getDBConnectionString();

  // Retrieve the current session (including its layers & audioLayers).
  const videoSession = await VideoSession.findOne({ _id: sessionId });
  if (!videoSession) {
    throw new Error("Session not found");
  }

  // Mark transcript generation as pending (we’ll set this back to false once done).
  await VideoSession.updateOne(
    { _id: sessionId },
    { $set: { transcriptGenerationPending: true } }
  );

  // Create a map from layer IDs to their corresponding layer objects.
  const layerMap = {};
  for (let layer of videoSession.layers) {
    layerMap[layer._id.toString()] = layer;
  }

  // Reorder the layers based on the array of layer IDs passed in `payload.layers`.
  const reorderedLayers = layers.map((layerId) => {
    const layer = layerMap[layerId];
    if (!layer) {
      throw new Error(`Layer with ID ${layerId} not found in session`);
    }
    return layer;
  });

  // Work in a mutable list of audioLayers so we can update them in-place.
  let updatedAudioLayers = videoSession.audioLayers || [];

  for (let i = 0; i < reorderedLayers.length; i++) {
    reorderedLayers[i].frameGenerationPending = true;
  }
  const totalDuration = recalculateLayerOffsetsAndConnectedAudio(reorderedLayers, updatedAudioLayers);

  // Assign the reordered layers (and updated audioLayers) back into the session.
  videoSession.layers = reorderedLayers;
  videoSession.audioLayers = normalizeAudioLayerArrayManualVolumeSettings(updatedAudioLayers);
  videoSession.totalDuration = totalDuration;
  videoSession.frameGenerationPending = true;

  // Save the updated session.
  let updatedVideoSession = await videoSession.save();




  // Identify all “speech” audio layers.
  const speechAudioLayers = updatedVideoSession.audioLayers.filter(
    (audio) => audio.generationType === "speech"
  );

  // First, remove old transcripts for each speech audio layer.
  // (We must do this to avoid overlapping or duplicated subtitles.)
  for (const audioLayer of speechAudioLayers) {
    await removeTranscriptsForSessionAudioLayer(sessionId, audioLayer._id.toString());
  }

  // Then generate new transcripts for the speech layers after the reorder.
  await generateTranscriptsForSessionAudioLayers(sessionId, speechAudioLayers);

  // Mark transcript generation complete
  await VideoSession.updateOne(
    { _id: sessionId },
    { $set: { transcriptGenerationPending: false } }
  );

  // Reload the session so everything is in sync
  updatedVideoSession = await VideoSession.findOne({ _id: sessionId });

  await ensureUnlockedFrameGenerations(
    sessionId,
    updatedVideoSession.layers.map((layer) => layer?._id?.toString?.())
  );

  return updatedVideoSession;
}




export async function requestRealignLayersToSpeechAndRegenerateSubtitles(userId, payload) {

  const { sessionId } = payload;

  await getDBConnectionString();

  // Retrieve the video session and populate image sessions
  let sessionData = await VideoSession.findOne({ _id: sessionId }).populate({
    path: 'layers.imageSession',
    model: 'Session'
  });

  if (!sessionData) {
    throw new Error('Video session not found');
  }

  // Identify speech audio layers
  const speechAudioLayers = sessionData.audioLayers.filter(layer => layer.generationType === 'speech');

  // Ensure that the number of speech audio layers matches the number of video layers
  if (speechAudioLayers.length !== sessionData.layers.length) {
    throw new Error('Mismatch between number of speech audio layers and video layers');
  }

  // Adjust layer durations and durationOffsets based on speech audio layer durations
  let durationOffset = 0;
  const padding = 1; // 1-second padding before speech starts

  for (let i = 0; i < sessionData.layers.length; i++) {
    const videoLayer = sessionData.layers[i];
    const audioLayer = speechAudioLayers[i];

    const isLastLayer = (i === sessionData.layers.length - 1);

    // Determine the layer duration: audio duration + padding
    let layerDuration = audioLayer.duration + padding;

    if (isLastLayer) {
      // For the last layer, add extra padding at the end
      layerDuration += 1; // Extra 1-second padding at the end
    }

    // Update video layer duration
    videoLayer.duration = layerDuration;

    // Update durationOffset for the video layer
    videoLayer.durationOffset = durationOffset;

    // Update audio layer start time to include padding
    audioLayer.startTime = videoLayer.durationOffset + padding;

    // Update audio layer end time
    audioLayer.endTime = audioLayer.startTime + audioLayer.duration;

    // Update durationOffset for the next layer
    durationOffset += videoLayer.duration;
  }

  // Set frameGenerationPending to true for all layers
  sessionData.layers.forEach(layer => {
    layer.frameGenerationPending = true;
  });
  sessionData.frameGenerationPending = true;

  // Save the updated session data
  await sessionData.save();

  await ensureUnlockedFrameGenerations(
    sessionId,
    sessionData.layers.map((layer) => layer?._id?.toString?.())
  );

  // Regenerate and realign subtitles
  // Assuming you have a function to regenerate subtitles, e.g., generateTranscriptsForSessionAudioLayers
  // We'll call this function to regenerate subtitles based on the updated layers and audio layers

  // First, extract prompts (texts) from speech audio layers for subtitles
  const promptList = speechAudioLayers.map(layer => layer.prompt);

  // Regenerate subtitles for the session
  await generateTranscriptsForSessionAudioLayers(sessionId, speechAudioLayers);

  // Update expressGenerationStatus (if applicable)
  let expressGenerationStatus = sessionData.expressGenerationStatus || {};
  expressGenerationStatus['transcript_generation'] = 'INIT';

  // Update the session document
  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        transcriptGenerationPending: false,
      }
    }
  );

  // Return the updated session data
  const updatedSessionData = await VideoSession.findOne({ _id: sessionId });

  return {
    message: 'Layers realigned to speech durations with padding and subtitles regenerated',
    session: updatedSessionData,
  };
}



export async function addTextToActiveList(userId, payload) {
  await getDBConnectionString();

  const { sessionId, layerId, textItem } = payload;



  let sessionData = await VideoSession.findOne({ _id: sessionId });

  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const layerIndex = sessionData.layers.findIndex(layer => layer._id.toString() === layerId);

  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  const layer = sessionData.layers[layerIndex];

  const canvasDimensions = getCanvasDimensionsForAspectRatio(sessionData.aspectRatio);

  const newActiveItemList = layer.imageSession.activeItemList || [];

  newActiveItemList.push(textItem);

  layer.imageSession.activeItemList = newActiveItemList;

  layer.frameGenerationPending = true;

  const updatedSessionData = await sessionData.save();

  const updatedLayer = updatedSessionData.layers[layerIndex];

  return {
    layer: updatedLayer,

  };

}

export async function requestRealignLayersToAiVideoLayerAndRegenerateSubtitles(userId, payload) {

  const { sessionId } = payload;



  await getDBConnectionString();

  // Retrieve the video session
  let sessionData = await VideoSession.findOne({ _id: sessionId });

  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  let sessionLayers = sessionData.layers || [];
  let sessionAudioLayers = sessionData.audioLayers || [];
  const framesPerSecond = getSessionFramesPerSecondWithLog(
    sessionData,
    'VideoSession.requestRealignLayersToAiVideoLayerAndRegenerateSubtitles',
  );

  for (let i = 0; i < sessionLayers.length; i++) {
    const layer = sessionLayers[i];
    const hasAnyVideo = hasAnyLayerVideoLink(layer);
    if (!hasAnyVideo) {
      continue;
    }

    const normalizedDuration = await resolveLayerDurationForRealign({
      sessionId,
      layerId: layer._id.toString(),
      layer,
      framesPerSecond,
    });

    if (Number.isFinite(normalizedDuration) && normalizedDuration > 0) {
      layer.duration = normalizedDuration;
    }
    layer.frameGenerationPending = true;
  }

  const totalDuration = recalculateLayerOffsetsAndConnectedAudio(sessionLayers, sessionAudioLayers);

  // Save the updated session with new durations and offsets
  sessionData.layers = sessionLayers;
  sessionData.audioLayers = sessionAudioLayers;
  sessionData.totalDuration = totalDuration;
  sessionData.frameGenerationPending = true;
  await sessionData.save();

  await ensureUnlockedFrameGenerations(
    sessionId,
    sessionLayers.map((layer) => layer?._id?.toString?.())
  );

  // Now regenerate frames for each AI video layer
  for (let i = 0; i < sessionLayers.length; i++) {
    const layer = sessionLayers[i];
    if (hasAnyLayerVideoLink(layer)) {
      await extractFramesFromAiVideoLayer(sessionId, layer._id.toString());
    }
  }


  const refreshedSessionData = await VideoSession.findOne({ _id: sessionId });
  const shouldRegenerateSubtitles = shouldRegenerateSubtitlesForSession(refreshedSessionData);
  const audioSpeechLayers = (refreshedSessionData?.audioLayers || []).filter(
    (layer) => layer.generationType === 'speech'
  );

  if (shouldRegenerateSubtitles) {
    // Generate transcripts after updating audio layers
    await generateTranscriptsForSessionAudioLayers(sessionId, audioSpeechLayers);
  }

  sessionData = await VideoSession.findOne({ _id: sessionId }); // reload session
  sessionData.transcriptGenerationPending = false;
  await sessionData.save();

  return {
    message: 'Layers realigned to AI video durations, frames regenerated, and subtitles re-generated',
    session: sessionData,
  };
}

export async function requestRealignLayersAndRegenerateFrames(userId, payload) {
  const { sessionId } = payload;

  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });
  if (!sessionData) {
    throw new Error('VideoSession not found');
  }

  const framesPerSecondOverride = getSessionFramesPerSecondWithLog(
    sessionData,
    'VideoSession.requestRealignLayersAndRegenerateFrames',
  );

  // 1) Regenerate AI/lip-sync/sound-effect frames and normalize layer/audio timings.
  await regenerateFramesForSession(sessionId, true, {
    framesPerSecondOverride,
    preferFrameBasedDurations: true,
    skipDurationPadding: true,
  });

  // 2) Regenerate subtitles when applicable for this session.
  const refreshedSession = await VideoSession.findOne({ _id: sessionId });
  const subtitlesRegenerated = shouldRegenerateSubtitlesForSession(refreshedSession);
  if (subtitlesRegenerated) {
    await requestRegenerateSubtitles(userId, { sessionId, realignAudio: false });
  }

  // 3) Regenerate session frames again so subtitle updates are reflected.
  await regenerateFramesForSession(sessionId, false, {
    framesPerSecondOverride,
    skipDurationPadding: true,
  });

  // 4) Queue a video render so the updated frames are automatically picked up by video generator.
  const videoGenerationRequest = await requestVideoGeneration(userId, sessionId);
  const updatedSession = await VideoSession.findOne({ _id: sessionId });

  return {
    message: 'Layers realigned, frames regenerated, and video render queued',
    subtitlesRegenerated,
    session: updatedSession,
    videoGenerationRequest,
  };
}



export async function requestGenerateLipSync(userId, payload) {

  const { sessionId, layerId, model = 'LATENTSYNC' } = payload;

  await getDBConnectionString();

  let sessionDataValue = await VideoSession.findOne({ _id: sessionId });

  if (!sessionDataValue) {
    throw new Error('VideoSession not found');
  }

  const layerIndex = sessionDataValue.layers.findIndex(layer => layer._id.toString() === layerId);

  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  const layer = sessionDataValue.layers[layerIndex];
  if (layer.userVideoGenerationPending || layer.hasUserVideoLayer || layer.userVideoLayer) {
    const error = new Error('Lip sync is not available for uploaded or pending user videos.');
    error.status = 400;
    throw error;
  }

  if (!layer.aiVideoLayer && !layer.aiVideoRemoteLink) {
    const error = new Error('Generate an AI video for this layer before requesting lip sync.');
    error.status = 400;
    throw error;
  }

  const existingLipSyncVideoLayer = layer?.lipSyncVideoLayer || null;
  const existingLipSyncRemoteLink = layer?.lipSyncRemoteLink || null;
  const hadExistingLipSyncVideo = Boolean(existingLipSyncVideoLayer);

  const speechLayers = sessionDataValue.audioLayers.filter(layer => layer.generationType === 'speech');

  const layerStartTime = layer.durationOffset;
  const layerEndTime = layer.durationOffset + layer.duration;



  // find speech layer that falls between the layer's start and end time
  let speechLayer = speechLayers.find(layer => layer.startTime >= layerStartTime);



  if (!speechLayer) {
    const error = new Error('No speech layer found for the current video layer');
    error.status = 400;
    throw error;
  }

  const audioPrompt = speechLayer.prompt ? speechLayer.prompt : '';



  let { _id, remoteAudioLinks, selectedLocalAudioLink, prompt } = speechLayer;


  const speechLayerId = speechLayer._id.toString();
  const speechRemoteUrl = speechLayer.remoteAudioLinks[0];



  const videoUrl = resolveLayerAiVideoRemoteUrl({ layer, userId });
  if (!videoUrl) {
    throw new Error('No AI video remote URL available for the current layer');
  }

  const audioDir = path.join(resolveProcessorAssetsRoot(), 'video', 'audio', sessionId.toString(), 'lip_sync');
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }
  const outputAudioPath = path.join(audioDir, `padded_${speechLayerId}.mp3`);


  if (!selectedLocalAudioLink) {
    selectedLocalAudioLink = speechLayer.localAudioLinks[0];
  }

  const localAudioPath = resolveAudioLinkToLocalPath(selectedLocalAudioLink);


  const speechStartTimeOffset = speechLayer.startTime - layerStartTime;



  const previousAudioData = {
    audioLink: selectedLocalAudioLink,
    remoteAudioLink: remoteAudioLinks[0],

    startTime: speechLayer.startTime,
    endTime: speechLayer.endTime,
    duration: speechLayer.duration,
    selectedLocalAudioLink: selectedLocalAudioLink,
    localAudioLinks: [selectedLocalAudioLink],
    remoteAudioLinks: remoteAudioLinks,
    remoteAudioData: [{
      title: 'speech',
      audio_url: remoteAudioLinks[0],
    }]
  }

  let paddedAudioRelativePath;
  let paddedAudioPath = selectedLocalAudioLink;

  let paddedAudioRemotePath = speechRemoteUrl;


  try {

    if (localAudioPath === outputAudioPath) {
      paddedAudioPath = localAudioPath;
    } else {
      // 2) Pad the audio so it matches the layer duration
      paddedAudioPath = await padBlankAudioAtBeginningAndEnd(
        localAudioPath,  // local path to the speech audio
        layer.duration,   // total length in seconds that we want
        outputAudioPath,
        speechStartTimeOffset             // optional: how many seconds to pad at the beginning
      );

    }

    paddedAudioRelativePath = toAssetRelativePath(paddedAudioPath);

    if (shouldUseDockerLocalMediaDelivery()) {
      // The padded file already lives in the shared assets_v2 mount. Keep its
      // canonical reference for UI/status/queue state; the downstream public
      // adapter resolves a fresh tunnel only when it submits the lip-sync job.
      paddedAudioRemotePath = paddedAudioRelativePath;
    } else {
      const dateString = new Date().toISOString().replace(/:/g, '-');
      const remotePaddedAudioName = `padded_${speechLayerId}_${dateString}.mp3`;
      paddedAudioRemotePath = await uploadSpeechAudioToCDN(paddedAudioPath, remotePaddedAudioName);
    }

    // update audio layer links and duration

    const audioLayerIndex = sessionDataValue.audioLayers.findIndex(layer => layer._id.toString() === speechLayerId);

    if (audioLayerIndex === -1) {
      throw new Error('Audio layer not found');
    }

    sessionDataValue.audioLayers[audioLayerIndex].audioLink = paddedAudioRemotePath;
    sessionDataValue.audioLayers[audioLayerIndex].duration = layer.duration;
    sessionDataValue.audioLayers[audioLayerIndex].startTime = layer.durationOffset;
    sessionDataValue.audioLayers[audioLayerIndex].endTime = layer.durationOffset + layer.duration;
    sessionDataValue.audioLayers[audioLayerIndex].selectedLocalAudioLink = paddedAudioRelativePath;
    sessionDataValue.audioLayers[audioLayerIndex].localAudioLinks = [paddedAudioRelativePath];
    sessionDataValue.audioLayers[audioLayerIndex].remoteAudioLinks = [paddedAudioRemotePath];
    sessionDataValue.audioLayers[audioLayerIndex].remoteAudioData = [{
      title: 'speech',
      audio_url: paddedAudioRemotePath,
    }]

    sessionDataValue.audioLayers[audioLayerIndex].previousAudioData = previousAudioData;
    sessionDataValue.audioLayers[audioLayerIndex].connectedLayerId = layerId;
    sessionDataValue.audioLayers[audioLayerIndex].isRowLocked = true;

  } catch (e) {
    console.error("Error padding audio:", e);

    sessionDataValue.layers[layerIndex].lipSyncGenerationPending = false;
    if (hadExistingLipSyncVideo) {
      // Preserve previously generated lip-sync output when a re-generation attempt fails.
      sessionDataValue.layers[layerIndex].hasLipSyncVideoLayer = true;
      sessionDataValue.layers[layerIndex].lipSyncVideoLayer = existingLipSyncVideoLayer;
      sessionDataValue.layers[layerIndex].lipSyncRemoteLink = existingLipSyncRemoteLink;
      sessionDataValue.layers[layerIndex].lipSyncVideoGenerationStatus = 'COMPLETED';
    } else {
      sessionDataValue.layers[layerIndex].lipSyncVideoGenerationStatus = 'FAILED';
      sessionDataValue.layers[layerIndex].hasLipSyncVideoLayer = false;
      sessionDataValue.layers[layerIndex].lipSyncVideoLayer = null;
      sessionDataValue.layers[layerIndex].lipSyncRemoteLink = null;

      const baseLayerType = sessionDataValue.layers[layerIndex].layerBaseAiImageType
        || (sessionDataValue.layers[layerIndex].hasAiVideoLayer ? 'ai_video' : 'none');
      sessionDataValue.layers[layerIndex].layerAiVideoType = baseLayerType;
    }

    await sessionDataValue.save();

    throw e;
  }

  //const paddedAudioUrl = `${API_SERVER}/${paddedAudioRelativePath}`;

  sessionDataValue.layers[layerIndex].lipSyncGenerationPending = true;
  sessionDataValue.layers[layerIndex].hasLipSyncVideoLayer = true;
  sessionDataValue.layers[layerIndex].layerAiVideoType = 'character';
  sessionDataValue.layers[layerIndex].lipSyncVideoGenerationStatus = 'PENDING';


  const savedResponse = await sessionDataValue.save();

  const updatedLayer = savedResponse.layers[layerIndex];

  let isSecondaryExpressGeneration = false;
  if (sessionDataValue.isExpressGeneration) {
    isSecondaryExpressGeneration = true;
  }

  const generationPayload = {
    sessionId: sessionId,
    videoSessionId: sessionId,
    generationType: 'video',
    speaker: 'default',
    audioLayerId: speechLayerId,
    rowLocked: false,
    videoLink: videoUrl,
    audioLink: paddedAudioRemotePath,
    model: model,
    aspectRatio: sessionDataValue.aspectRatio,
    currentLayerId: layerId,
    duration: layer.duration,
    prompt: prompt,
    audioPrompt: audioPrompt,

  };


  await requestGenerateCustomAIVideo(userId, generationPayload);

  return {
    session: sessionDataValue,
    layer: updatedLayer,
  };
}


export async function requestGenerateSyncedSoundEffectVideo(userId, payload) {

  const { sessionId, currentLayerId, prompt, model } = payload;

  await getDBConnectionString();

  const videoSession = await VideoSession.findOne({ _id: payload.sessionId });

  const aspectRatio = videoSession.aspectRatio;
  const layers = videoSession.layers;

  const layer = layers.find(layer => layer._id.toString() === currentLayerId);
  if (layer?.userVideoGenerationPending || layer?.hasUserVideoLayer || layer?.userVideoLayer) {
    throw new Error('Sound effects are not available for uploaded or pending user videos.');
  }


  await VideoSession.updateOne({
    _id: sessionId,
    "layers._id": currentLayerId
  }, {
    $set: {
      "layers.$.soundEffectGenerationPending": true,
      "layers.$.hasSoundEffectVideoLayer": true,
      "layers.$.aiVideoGenerationType": 'sound_effect',
      "layers.$.layerAiVideoType": 'sound_effect',
      "layers.$.soundEffectVideoGenerationStatus": 'PENDING',
    }
  })

  const videoUrl = resolveLayerAiVideoRemoteUrl({ layer, userId });
  if (!videoUrl) {
    throw new Error('No AI video remote URL available for the current layer');
  }


  const requestGeneratePayload = {
    videoSessionId: payload.sessionId,
    currentLayerId: currentLayerId,
    videoUrl: videoUrl,
    prompt: prompt,
    model: model,
    aspectRatio: aspectRatio,
  }


  await requestGenerateCustomAIVideo(userId, requestGeneratePayload);

}

export async function updateSessionMovieGenSpeakers(userId, payload) {

  const { sessionId, speakers } = payload;

  await getDBConnectionString();


  await VideoSession.updateOne({
    _id: sessionId
  }, {
    $set: {
      movieGenSpeakers: speakers
    }
  });

  return {
    message: 'MovieGen speakers updated successfully',
    speakers: speakers
  }

}

export const __testOnly__ = {
  buildStudioVideoRemoteUrl,
  buildStudioImageDeliveryUrl,
  hydrateStudioSessionMediaForResponse,
  collectSessionListThumbnailCandidates,
  buildSessionListThumbnailPayload,
  resolveLayerAiVideoRemoteUrl,
  shouldUseDockerLocalMediaDelivery,
  selectMediaDeliverySource,
  buildLocalGuestMediaObject,
  parseGuestMediaByteRange,
  prepareLayerActiveItemsForVideoReplacement,
};
