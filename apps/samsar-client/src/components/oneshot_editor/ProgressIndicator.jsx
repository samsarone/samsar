// ProgressIndicator.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaPause, FaPlay, FaSpinner, FaStepForward, FaVolumeMute, FaVolumeUp } from 'react-icons/fa';
import './mobileStyles.css';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';
import StepImageReviewPanel from './StepImageReviewPanel.jsx';
import {
  clampAudioValue,
  isMusicLikeAudioType,
  isSpeechLikeAudioType,
  shouldDuckMusicAgainstAudioType,
} from '../video/util/audioPreviewDucking.js';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
const IS_DOCKER_INSTALL = String(import.meta.env.VITE_DOCKER_INSTALL || '').trim().toLowerCase() === 'true';
const STATIC_ASSET_BASE_URL = (
  import.meta.env.VITE_STATIC_CDN_URL ||
  'https://static.samsar.one'
).replace(/\/+$/, '');
const PREVIEW_MUSIC_DUCKED_VOLUME_RATIO = 0.225;
const PREVIEW_MEDIA_PRELOAD_TIMEOUT_MS = 15000;
const PREVIEW_MEDIA_OBJECT_URL_CACHE_TTL_MS = 10 * 60 * 1000;
const PREVIEW_MEDIA_OBJECT_URL_FAILURE_TTL_MS = 60 * 1000;
const PREVIEW_MEDIA_OBJECT_URL_CACHE_MAX_ENTRIES = 24;
const PREVIEW_MEDIA_OBJECT_URL_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const PREVIEW_AUDIO_SEEK_TOLERANCE_SECONDS = 0.12;
const PREVIEW_VIDEO_SEEK_TOLERANCE_SECONDS = 0.12;
const PREVIEW_VIDEO_METADATA_READY_STATE = 1;
const PREVIEW_VIDEO_FRAME_READY_STATE = 2;
const MOBILE_PREVIEW_MEDIA_QUERY = '(hover: none), (pointer: coarse), (max-width: 767px)';
const USER_RESOURCES_PREFIX = 'user_resources/';
const LAYER_ID_FIELDS = ['id', '_id', 'layerId', 'layer_id'];
const MOBILE_SINGLE_VIDEO_LOAD_STAGES = new Set(['ai_video_generation', 'lip_sync_generation']);
const TIMELINE_STRIP_MIN_WIDTH_PX = 420;
const TIMELINE_SEGMENT_MIN_WIDTH_PX = 88;
const TIMELINE_SECONDS_WIDTH_PX = 24;
const previewVisualReadyCache = new Set();
const previewVisualPreloadPromises = new Map();
const previewVisualObjectUrlCache = new Map();
const previewVisualObjectUrlPromises = new Map();
const previewVisualObjectUrlFailures = new Map();

const STAGE_ORDER = [
  'prompt_generation',
  'image_generation',
  'speech_generation',
  'music_generation',
  'audio_generation',
  'ai_video_generation',
  'lip_sync_generation',
  'sound_effect_generation',
  'narrator_avatar_generation',
  'frame_generation',
  'video_generation',
];

const STAGE_LABELS = {
  prompt_generation: 'Generating prompt',
  image_generation: 'Generating images',
  speech_generation: 'Generating speech',
  music_generation: 'Generating music',
  audio_generation: 'Generating audio',
  ai_video_generation: 'Generating video clips',
  lip_sync_generation: 'Generating lip sync',
  sound_effect_generation: 'Generating sound effects',
  narrator_avatar_generation: 'Generating narrator avatar',
  frame_generation: 'Rendering frames',
  video_generation: 'Rendering final video',
};

function normalizeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildProcessorAssetUrl(path) {
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const baseUrl = typeof PROCESSOR_API_URL === 'string'
    ? PROCESSOR_API_URL.trim().replace(/\/+$/, '')
    : '';
  return baseUrl ? `${baseUrl}/${normalizedPath}` : `/${normalizedPath}`;
}

function normalizeAssetUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const relativePath = trimmed.replace(/^\/+/, '');
  if (relativePath.startsWith(USER_RESOURCES_PREFIX)) {
    return `${STATIC_ASSET_BASE_URL}/${relativePath}`;
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    try {
      const parsedUrl = new URL(trimmed);
      const pathname = parsedUrl.pathname.replace(/^\/+/, '');
      if (pathname.startsWith(USER_RESOURCES_PREFIX)) {
        return `${STATIC_ASSET_BASE_URL}/${pathname}${parsedUrl.search || ''}`;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  return buildProcessorAssetUrl(relativePath);
}

function normalizeStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isCompletedStatus(value) {
  const normalized = normalizeStatus(value);
  return normalized === 'COMPLETED' || normalized === 'SUCCESS' || normalized === 'SUCCEEDED' || normalized === 'DONE';
}

function getStatusMap(expressGenerationStatus, generationStatusDetails) {
  if (expressGenerationStatus && typeof expressGenerationStatus === 'object') {
    return expressGenerationStatus;
  }
  return generationStatusDetails?.session?.stages || {};
}

function getProgressPercentage(status, generationStatusDetails) {
  const completedStages = Array.isArray(generationStatusDetails?.session?.completedStages)
    ? generationStatusDetails.session.completedStages
    : null;
  if (completedStages && completedStages.length > 0) {
    return Math.min(100, (completedStages.length / STAGE_ORDER.length) * 100);
  }
  if (!status || Object.keys(status).length === 0) return 0;
  const stageKeys = STAGE_ORDER.filter((stage) => status[stage] !== undefined);
  const keys = stageKeys.length ? stageKeys : Object.keys(status);
  const completedTasks = keys.filter((key) => isCompletedStatus(status[key])).length;
  return (completedTasks / keys.length) * 100;
}

function getStageLabel(stage, t) {
  if (!stage) return null;
  const translationMap = {
    prompt_generation: t('progress.generatingPrompt'),
    image_generation: t('progress.generatingImage'),
    audio_generation: t('progress.generatingAudio'),
    ai_video_generation: t('progress.generatingAiVideo'),
    lip_sync_generation: t('progress.generatingLipSync'),
    sound_effect_generation: t('progress.generatingSoundEffects'),
    frame_generation: t('progress.generatingFrames'),
    video_generation: t('progress.finalVideoGeneration'),
  };
  return translationMap[stage] || STAGE_LABELS[stage] || stage.replace(/_/g, ' ');
}

function getCurrentStep(status, t, generationStatusDetails) {
  const explicitLabel =
    generationStatusDetails?.current_step_label ||
    generationStatusDetails?.step?.current_step_label ||
    generationStatusDetails?.session?.currentStage;
  if (explicitLabel && !STAGE_ORDER.includes(explicitLabel)) {
    return explicitLabel;
  }

  const explicitStage =
    generationStatusDetails?.current_step ||
    generationStatusDetails?.step?.current_step ||
    generationStatusDetails?.session?.currentStage;
  if (explicitStage) {
    return getStageLabel(explicitStage, t);
  }

  if (!status) return null;
  for (const stage of STAGE_ORDER) {
    if (status[stage] !== undefined && !isCompletedStatus(status[stage])) {
      return getStageLabel(stage, t);
    }
  }
  return t('progress.allStepsCompleted');
}

function getCurrentStageKey(status, generationStatusDetails) {
  const explicitStage =
    generationStatusDetails?.current_step ||
    generationStatusDetails?.step?.current_step ||
    generationStatusDetails?.session?.currentStage;
  if (STAGE_ORDER.includes(explicitStage)) {
    return explicitStage;
  }

  if (!status) return null;
  for (const stage of STAGE_ORDER) {
    if (status[stage] !== undefined && !isCompletedStatus(status[stage])) {
      return stage;
    }
  }
  return null;
}

function resolveSegmentEnd(startTime, duration, endTime, fallbackDuration) {
  if (endTime !== null && endTime > startTime) return endTime;
  if (duration !== null && duration > 0) return startTime + duration;
  return startTime + fallbackDuration;
}

function buildVideoSegment({
  source,
  asset,
  index,
  keyPrefix,
  title,
  startTime,
  endTime,
}) {
  const normalizedUrl = normalizeAssetUrl(asset?.url);
  if (!normalizedUrl) return null;
  const sourceId = source?.id || source?._id || index;
  const assetStage = asset.stage || source?.preview?.stage || 'media';

  return {
    key: `${keyPrefix}-${sourceId}-${assetStage}-${normalizedUrl}`,
    title,
    type: asset.type === 'video' ? 'video' : 'image',
    stage: assetStage,
    status: source?.preview?.status || source?.image?.status || source?.aiVideo?.status || source?.status || asset?.status || null,
    startTime,
    endTime,
    duration: Math.max(0.2, endTime - startTime),
    url: normalizedUrl,
  };
}

function normalizeLayerIdentifier(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value).trim();
}

function getLayerIdentifierSet(layer = {}) {
  const identifiers = new Set();
  LAYER_ID_FIELDS.forEach((field) => {
    const identifier = normalizeLayerIdentifier(layer?.[field]);
    if (identifier) {
      identifiers.add(identifier);
    }
  });
  return identifiers;
}

function findRawLayerForPreview(rawLayers, layer, index) {
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    return {};
  }

  const identifiers = getLayerIdentifierSet(layer);
  if (identifiers.size > 0) {
    const matchingLayer = rawLayers.find((candidate) => {
      const candidateIdentifiers = getLayerIdentifierSet(candidate);
      return [...candidateIdentifiers].some((identifier) => identifiers.has(identifier));
    });
    if (matchingLayer) {
      return matchingLayer;
    }
  }

  return rawLayers[index] || {};
}

function firstAssetCandidate(candidates = []) {
  return candidates.find((candidate) => normalizeAssetUrl(candidate.url)) || null;
}

function getRawItemAssetUrl(item) {
  if (!item || typeof item !== 'object') return '';
  return (
    item.url ||
    item.previewUrl ||
    item.preview_url ||
    item.signedUrl ||
    item.signed_url ||
    item.displayUrl ||
    item.display_url ||
    item.src ||
    item.imageUrl ||
    item.image_url ||
    item.rawUrl ||
    item.raw_url ||
    item.enhancedUrl ||
    item.enhanced_url ||
    item.assetPath ||
    item.path ||
    (typeof item.image === 'string' && item.image.includes('/') ? item.image : '')
  );
}

function buildVideoAssetCandidates({ stage, status, localUrls = [], remoteUrls = [] }) {
  const orderedUrls = IS_DOCKER_INSTALL
    ? [...localUrls, ...remoteUrls]
    : [...remoteUrls, ...localUrls];
  return orderedUrls
    .filter((url, index, urls) => typeof url === 'string' && url.trim() && urls.indexOf(url) === index)
    .map((url) => ({
      type: 'video',
      stage,
      status,
      url,
    }));
}

function resolveLayerPreviewAsset(layer = {}, rawLayer = {}) {
  const rawImageSession = rawLayer.imageSession || layer.imageSession || {};
  const rawActiveItems = Array.isArray(rawImageSession.activeItemList)
    ? rawImageSession.activeItemList
    : [];
  const rawBaseItem = rawActiveItems.find((item) => item?.is_base_image === true) ||
    rawActiveItems.find((item) => item?.type === 'image') ||
    rawActiveItems[0] ||
    null;
  const detailedItemUrl = Array.isArray(layer.image?.items)
    ? layer.image.items.find((item) => item?.isPrimary)?.url || layer.image.items[0]?.url
    : '';
  const frameImages = layer.frameImages || rawLayer.frameImages || {};
  const editedImageUrl = layer.image?.editedImage ||
    layer.editedImage?.url ||
    (typeof layer.editedImage === 'string' ? layer.editedImage : '') ||
    rawImageSession.activeEditedImage;
  const previewVideoCandidate = layer.preview?.type === 'video'
    ? {
        type: 'video',
        stage: layer.preview?.stage || 'media',
        status: layer.preview?.status,
        url: layer.preview?.url,
      }
    : null;
  const videoCandidates = [
    ...buildVideoAssetCandidates({
      stage: 'lip_sync_generation',
      status: layer.lipSyncVideo?.status || rawLayer.lipSyncVideoGenerationStatus,
      localUrls: [rawLayer.lipSyncVideoLayer],
      remoteUrls: [layer.lipSyncVideo?.url, rawLayer.lipSyncRemoteLink],
    }),
    ...buildVideoAssetCandidates({
      stage: 'sound_effect_generation',
      status: layer.soundEffectVideo?.status || rawLayer.soundEffectVideoGenerationStatus,
      localUrls: [rawLayer.soundEffectVideoLayer],
      remoteUrls: [layer.soundEffectVideo?.url, rawLayer.soundEffectRemoteLink],
    }),
    ...buildVideoAssetCandidates({
      stage: 'ai_video_generation',
      status: layer.aiVideo?.status || rawLayer.aiVideoGenerationStatus,
      localUrls: [rawLayer.aiVideoLayer],
      remoteUrls: [layer.aiVideo?.url, rawLayer.aiVideoRemoteLink],
    }),
    ...buildVideoAssetCandidates({
      stage: 'user_video',
      status: layer.userVideo?.status || rawLayer.userVideoGenerationStatus,
      localUrls: [rawLayer.userVideoLayer],
      remoteUrls: [layer.userVideo?.url, rawLayer.userVideoRemoteLink],
    }),
    ...(previewVideoCandidate ? [previewVideoCandidate] : []),
  ];
  const imageCandidates = [
    { type: 'image', stage: 'image_generation', url: frameImages.startFrameUrl },
    { type: 'image', stage: 'image_generation', url: frameImages.startFrame },
    { type: 'image', stage: 'image_generation', url: frameImages.aiLayerStartFrame },
    { type: 'image', stage: 'image_generation', url: frameImages.baseLayerStartFrame },
    { type: 'image', stage: 'image_generation', url: frameImages.aiVideoThumbnailPath },
    { type: 'image', stage: 'image_generation', url: frameImages.thumbnailPath },
    { type: 'image', stage: 'image_generation', url: layer.aiLayerStartFrame || rawLayer.aiLayerStartFrame },
    { type: 'image', stage: 'image_generation', url: layer.baseLayerStartFrame || rawLayer.baseLayerStartFrame },
    { type: 'image', stage: 'image_generation', url: layer.aiVideoThumbnailPath || rawLayer.aiVideoThumbnailPath },
    { type: 'image', stage: 'image_generation', url: layer.thumbnailPath || rawLayer.thumbnailPath },
    { type: 'image', stage: 'image_generation', url: editedImageUrl },
    {
      type: layer.preview?.type || 'image',
      stage: layer.preview?.stage || 'image_generation',
      url: layer.preview?.type !== 'video' ? layer.preview?.url : '',
    },
    { type: 'image', stage: 'image_generation', url: layer.image?.url },
    { type: 'image', stage: 'image_generation', url: detailedItemUrl },
    { type: 'image', stage: 'image_generation', url: getRawItemAssetUrl(rawBaseItem) },
    { type: 'image', stage: 'image_generation', url: rawImageSession.activeImageRemoteLink },
    { type: 'image', stage: 'image_generation', url: rawImageSession.videoRenderStartFrameImage },
    { type: 'image', stage: 'image_generation', url: rawImageSession.activeGeneratedImage },
    { type: 'image', stage: 'image_generation', url: rawImageSession.activeEditedImage },
    { type: 'image', stage: 'image_generation', url: rawImageSession.activeSelectedImage },
  ];
  return firstAssetCandidate(videoCandidates) || firstAssetCandidate(imageCandidates);
}

function buildVisualSegments(sessionPreview, rawSessionDetails) {
  const normalizedLayers = Array.isArray(sessionPreview?.layers) ? sessionPreview.layers : [];
  const rawLayers = Array.isArray(rawSessionDetails?.layers) ? rawSessionDetails.layers : [];
  const shouldUseRawLayers = normalizedLayers.length === 0 && rawLayers.length > 0;
  const layers = shouldUseRawLayers ? rawLayers : normalizedLayers;
  const globalVideos = Array.isArray(sessionPreview?.globalVideos) ? sessionPreview.globalVideos : [];
  const layerSegments = layers
    .map((layer, index) => {
      const rawLayer = shouldUseRawLayers ? layer : findRawLayerForPreview(rawLayers, layer, index);
      const asset = resolveLayerPreviewAsset(layer, rawLayer);
      const startTime = Math.max(0, normalizeNumber(layer.startTime ?? layer.durationOffset, 0));
      const duration = normalizeNumber(layer.duration, null);
      const endTime = resolveSegmentEnd(startTime, duration, normalizeNumber(layer.endTime, null), 4);
      return buildVideoSegment({
        source: layer,
        asset,
        index,
        keyPrefix: 'layer',
        title: layer.prompt || layer.videoGenerationPrompt || layer.image?.prompt || layer.imageSession?.prompt || `Scene ${index + 1}`,
        startTime,
        endTime,
      });
    })
    .filter(Boolean);

  const globalVideoSegments = globalVideos
    .map((video, index) => {
      const startTime = Math.max(0, normalizeNumber(video.startTime, 0));
      const duration = normalizeNumber(video.duration, null);
      const endTime = resolveSegmentEnd(startTime, duration, normalizeNumber(video.endTime, null), 4);
      return buildVideoSegment({
        source: video,
        asset: {
          ...video,
          type: 'video',
          stage: 'ai_video_generation',
          url: video.url,
        },
        index,
        keyPrefix: 'global-video',
        title: video.title || `Video ${index + 1}`,
        startTime,
        endTime,
      });
    })
    .filter(Boolean);

  return [...layerSegments, ...globalVideoSegments]
    .sort((left, right) => left.startTime - right.startTime);
}

function buildAudioSegments(sessionPreview) {
  const audioLayers = [
    ...(Array.isArray(sessionPreview?.audioLayers) ? sessionPreview.audioLayers : []),
    ...(Array.isArray(sessionPreview?.globalAudioLayers) ? sessionPreview.globalAudioLayers : []),
  ];

  return audioLayers
    .filter((layer) => isPreviewAudioLayerPlayable(layer))
    .map((layer, index) => {
      const url = normalizeAssetUrl(layer.url);
      if (!url) return null;
      const startTime = Math.max(0, normalizeNumber(layer.startTime, 0));
      const duration = normalizeNumber(layer.duration, null);
      const endTime = resolveSegmentEnd(startTime, duration, normalizeNumber(layer.endTime, null), 4);
      const type = typeof layer.type === 'string' ? layer.type.toLowerCase() : 'audio';
      const volumeValue = normalizeNumber(layer.volume, 1);
      const volume = Math.max(0, Math.min(1, volumeValue > 1 ? volumeValue / 100 : volumeValue));
      return {
        key: `audio-${layer.id || index}`,
        title: layer.prompt || layer.speakerCharacterName || layer.speaker || `${type} ${index + 1}`,
        type,
        status: layer.status,
        startTime,
        endTime,
        duration: Math.max(0.2, endTime - startTime),
        sourceTrimStartTime: Math.max(0, normalizeNumber(layer.sourceTrimStartTime, 0)),
        volume,
        url,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startTime - right.startTime);
}

function resolveTimelineDuration(sessionPreview, visualSegments, audioSegments) {
  const explicitDuration = normalizeNumber(sessionPreview?.duration, null);
  if (explicitDuration && explicitDuration > 0) return explicitDuration;
  const ends = [...visualSegments, ...audioSegments].map((segment) => segment.endTime).filter(Number.isFinite);
  return ends.length ? Math.max(...ends) : 0;
}

function findActiveVisualSegment(segments, previewTime) {
  if (!segments.length) return null;
  return (
    segments.find((segment) => previewTime >= segment.startTime && previewTime < segment.endTime) ||
    [...segments].reverse().find((segment) => previewTime >= segment.startTime) ||
    segments[0]
  );
}

function normalizeAudioType(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'background_music' ||
    normalized === 'background music' ||
    normalized === 'bgm' ||
    normalized === 'backing_track' ||
    normalized === 'backing track'
  ) {
    return 'music';
  }
  if (
    normalized === 'custom_speech' ||
    normalized === 'custom speech' ||
    normalized === 'recorded_speech' ||
    normalized === 'recorded speech'
  ) {
    return 'speech';
  }
  if (normalized === 'sound') {
    return 'sound_effect';
  }
  if (normalized === 'lip sync') {
    return 'lip_sync';
  }
  return normalized;
}

function isPreviewAudioLayerPlayable(layer = {}) {
  const hasExplicitSelectionState =
    typeof layer.isEnabled === 'boolean' || typeof layer.defaultSelected === 'boolean';
  const isSelectedLayer = hasExplicitSelectionState
    ? Boolean(layer.isEnabled || layer.defaultSelected)
    : true;
  const status = normalizeStatus(layer.status);

  return isSelectedLayer && status !== 'PENDING' && status !== 'FAILED';
}

function isSpeechAudio(segment) {
  const type = normalizeAudioType(segment?.type);
  return isSpeechLikeAudioType(type) || type === 'voice' || type === 'voiceover';
}

function isSegmentActiveAtTime(segment, previewTime) {
  return previewTime >= segment.startTime && previewTime < segment.endTime;
}

function getTimelineStripWidth(segments = [], timelineDuration) {
  const segmentCountWidth = Math.max(1, segments.length) * TIMELINE_SEGMENT_MIN_WIDTH_PX;
  const durationWidth = Math.max(0, timelineDuration) * TIMELINE_SECONDS_WIDTH_PX;
  return Math.ceil(Math.max(TIMELINE_STRIP_MIN_WIDTH_PX, segmentCountWidth, durationWidth));
}

function getTimelineSegmentStyle(segment, timelineDuration, constrainToTimeline = false) {
  if (!segment || timelineDuration <= 0) {
    return { left: '0%', width: '100%' };
  }

  const rawLeft = (segment.startTime / timelineDuration) * 100;
  const rawWidth = (segment.duration / timelineDuration) * 100;

  if (!constrainToTimeline) {
    return { left: `${rawLeft}%`, width: `${Math.max(rawWidth, 2)}%` };
  }

  const left = Math.max(0, Math.min(rawLeft, 99.5));
  const right = Math.min(100, left + Math.max(rawWidth, 2));
  const width = Math.max(0.5, right - left);

  return { left: `${left}%`, width: `${width}%` };
}

function resolveAudioVolume(segment, audioSegments, previewTime, masterVolume = 1, muted = false) {
  if (muted) return 0;
  const baseVolume = clampAudioValue((segment.volume ?? 1) * masterVolume);
  if (!isMusicLikeAudioType(segment?.type)) return baseVolume;
  const hasActiveDuckingLayer = audioSegments.some((candidate) => (
    candidate.key !== segment.key &&
    shouldDuckMusicAgainstAudioType(candidate?.type) &&
    isSegmentActiveAtTime(candidate, previewTime)
  ));
  return hasActiveDuckingLayer ? baseVolume * PREVIEW_MUSIC_DUCKED_VOLUME_RATIO : baseVolume;
}

function formatTime(seconds) {
  const normalized = Math.max(0, normalizeNumber(seconds, 0));
  const minutes = Math.floor(normalized / 60);
  const wholeSeconds = Math.floor(normalized % 60);
  return `${minutes}:${wholeSeconds.toString().padStart(2, '0')}`;
}

function normalizePreviewAspectRatio(sessionPreview) {
  const value =
    sessionPreview?.aspectRatio ||
    sessionPreview?.aspect_ratio ||
    sessionPreview?.input?.aspect_ratio;
  return value === '9:16' ? '9:16' : '16:9';
}

function getPreviewVisualCacheKey(segment) {
  if (!segment?.url) return null;
  return `${segment.type || 'media'}:${segment.url}`;
}

function canCachePreviewVisualUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

function revokePreviewVisualObjectUrl(entry) {
  if (!entry?.objectUrl || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return;
  }
  URL.revokeObjectURL(entry.objectUrl);
}

function clearPreviewVisualCaches() {
  previewVisualObjectUrlCache.forEach((entry) => revokePreviewVisualObjectUrl(entry));
  previewVisualReadyCache.clear();
  previewVisualPreloadPromises.clear();
  previewVisualObjectUrlCache.clear();
  previewVisualObjectUrlPromises.clear();
  previewVisualObjectUrlFailures.clear();
}

function prunePreviewVisualObjectUrlCache(now = Date.now()) {
  previewVisualObjectUrlFailures.forEach((expiresAt, cacheKey) => {
    if (expiresAt <= now) {
      previewVisualObjectUrlFailures.delete(cacheKey);
    }
  });

  previewVisualObjectUrlCache.forEach((entry, cacheKey) => {
    if (!entry || entry.expiresAt <= now) {
      revokePreviewVisualObjectUrl(entry);
      previewVisualObjectUrlCache.delete(cacheKey);
    }
  });

  const entriesByLastAccess = [...previewVisualObjectUrlCache.entries()]
    .sort((left, right) => (left[1]?.lastAccessed || 0) - (right[1]?.lastAccessed || 0));

  const getTotalBytes = () => [...previewVisualObjectUrlCache.values()]
    .reduce((total, entry) => total + (entry?.bytes || 0), 0);

  while (previewVisualObjectUrlCache.size > PREVIEW_MEDIA_OBJECT_URL_CACHE_MAX_ENTRIES) {
    const oldest = entriesByLastAccess.shift();
    if (!oldest) break;
    const [cacheKey, entry] = oldest;
    revokePreviewVisualObjectUrl(entry);
    previewVisualObjectUrlCache.delete(cacheKey);
  }

  let totalBytes = getTotalBytes();
  while (totalBytes > PREVIEW_MEDIA_OBJECT_URL_CACHE_MAX_BYTES && entriesByLastAccess.length > 0) {
    const [cacheKey, entry] = entriesByLastAccess.shift();
    revokePreviewVisualObjectUrl(entry);
    previewVisualObjectUrlCache.delete(cacheKey);
    totalBytes -= entry?.bytes || 0;
  }
}

function getCachedPreviewVisualObjectUrl(segment) {
  const cacheKey = getPreviewVisualCacheKey(segment);
  if (!cacheKey) return null;

  const now = Date.now();
  prunePreviewVisualObjectUrlCache(now);
  const entry = previewVisualObjectUrlCache.get(cacheKey);
  if (!entry) return null;

  entry.lastAccessed = now;
  entry.expiresAt = now + PREVIEW_MEDIA_OBJECT_URL_CACHE_TTL_MS;
  return entry.objectUrl;
}

function storePreviewVisualObjectUrl(cacheKey, blob) {
  if (
    !cacheKey ||
    !blob ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }

  const previousEntry = previewVisualObjectUrlCache.get(cacheKey);
  if (previousEntry) {
    revokePreviewVisualObjectUrl(previousEntry);
  }

  const now = Date.now();
  const objectUrl = URL.createObjectURL(blob);
  previewVisualObjectUrlCache.set(cacheKey, {
    objectUrl,
    bytes: blob.size || 0,
    expiresAt: now + PREVIEW_MEDIA_OBJECT_URL_CACHE_TTL_MS,
    lastAccessed: now,
  });
  prunePreviewVisualObjectUrlCache(now);
  return objectUrl;
}

function cachePreviewVisualObjectUrl(segment) {
  const cacheKey = getPreviewVisualCacheKey(segment);
  if (!cacheKey || !canCachePreviewVisualUrl(segment?.url)) {
    return Promise.resolve(null);
  }

  const now = Date.now();
  const failureExpiresAt = previewVisualObjectUrlFailures.get(cacheKey);
  if (failureExpiresAt && failureExpiresAt > now) {
    return Promise.resolve(null);
  }
  if (failureExpiresAt) {
    previewVisualObjectUrlFailures.delete(cacheKey);
  }

  const cachedUrl = getCachedPreviewVisualObjectUrl(segment);
  if (cachedUrl) {
    return Promise.resolve(cachedUrl);
  }

  if (
    typeof fetch !== 'function' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return Promise.resolve(null);
  }

  if (previewVisualObjectUrlPromises.has(cacheKey)) {
    return previewVisualObjectUrlPromises.get(cacheKey);
  }

  const promise = fetch(segment.url, { cache: 'force-cache' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Preview media fetch failed: ${response.status}`);
      }

      const contentLength = Number(response.headers?.get?.('content-length'));
      if (
        Number.isFinite(contentLength) &&
        contentLength > PREVIEW_MEDIA_OBJECT_URL_CACHE_MAX_BYTES
      ) {
        throw new Error('Preview media is too large to cache.');
      }

      return response.blob();
    })
    .then((blob) => {
      if (!blob || blob.size > PREVIEW_MEDIA_OBJECT_URL_CACHE_MAX_BYTES) {
        return null;
      }
      return storePreviewVisualObjectUrl(cacheKey, blob);
    })
    .catch(() => {
      previewVisualObjectUrlFailures.set(
        cacheKey,
        Date.now() + PREVIEW_MEDIA_OBJECT_URL_FAILURE_TTL_MS
      );
      return null;
    })
    .finally(() => {
      previewVisualObjectUrlPromises.delete(cacheKey);
    });

  previewVisualObjectUrlPromises.set(cacheKey, promise);
  return promise;
}

function primeInactiveAudioElement(element) {
  if (!element) return;
  const previousTime = element.currentTime;
  const previousVolume = element.volume;
  const previousMuted = element.muted;

  const restore = () => {
    element.pause();
    if (Number.isFinite(previousTime)) {
      try {
        element.currentTime = previousTime;
      } catch {
        // Ignore best-effort media priming restore failures.
      }
    }
    element.volume = previousVolume;
    element.muted = previousMuted;
  };

  element.muted = true;
  element.volume = 0;
  let playPromise = null;
  try {
    playPromise = element.play();
  } catch {
    restore();
    return;
  }
  if (playPromise?.then) {
    playPromise.then(restore).catch(restore);
  } else {
    restore();
  }
}

function markPreviewVisualReady(cacheKey) {
  if (!cacheKey) return;
  previewVisualReadyCache.add(cacheKey);
  previewVisualPreloadPromises.delete(cacheKey);
}

function preloadPreviewImage(url, cacheKey) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let timeoutId = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      markPreviewVisualReady(cacheKey);
      resolve();
    };

    image.onload = () => {
      if (typeof image.decode === 'function') {
        image.decode().then(finish).catch(finish);
        return;
      }
      finish();
    };
    image.onerror = finish;
    timeoutId = window.setTimeout(finish, PREVIEW_MEDIA_PRELOAD_TIMEOUT_MS);
    image.src = url;

    if (image.complete) {
      finish();
    }
  });
}

function preloadPreviewVideo(url, cacheKey) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', finish);
      video.removeEventListener('canplay', finish);
      video.removeEventListener('error', finish);
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // Ignore cleanup failures from detached media elements.
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      markPreviewVisualReady(cacheKey);
      resolve();
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('loadeddata', finish);
    video.addEventListener('canplay', finish);
    video.addEventListener('error', finish);
    timeoutId = window.setTimeout(finish, PREVIEW_MEDIA_PRELOAD_TIMEOUT_MS);
    video.src = url;
    video.load();
  });
}

function preloadPreviewVisualSegment(segment) {
  const cacheKey = getPreviewVisualCacheKey(segment);
  if (!cacheKey || previewVisualReadyCache.has(cacheKey)) {
    return Promise.resolve();
  }
  if (previewVisualPreloadPromises.has(cacheKey)) {
    return previewVisualPreloadPromises.get(cacheKey);
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    markPreviewVisualReady(cacheKey);
    return Promise.resolve();
  }

  const promise = segment.type === 'video'
    ? preloadPreviewVideo(segment.url, cacheKey)
    : preloadPreviewImage(segment.url, cacheKey);
  previewVisualPreloadPromises.set(cacheKey, promise);
  return promise;
}

export default function ProgressIndicator(props) {
  const {
    isGenerationPending,
    isGenerationPaused = false,
    isGenerationWaitingForApproval,
    isProcessingNextStep,
    expressGenerationStatus,
    generationStatusDetails,
    videoLink,
    pendingPreviewVideoLink,
    errorMessage,
    rawSessionDetails,
    canProcessNextStep = false,
    canReviewStepImages = false,
    viewInStudio,
    getSessionImageLayers,
    onProcessNextStep,
    onSelectStepImage,
    onRegenerateStepImage,
    enableScrollableLayerTimeline = false,
  } = props;

  const [hasCalledGetSessionImageLayers, setHasCalledGetSessionImageLayers] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewAudioMuted, setPreviewAudioMuted] = useState(true);
  const [previewAudioVolume, setPreviewAudioVolume] = useState(1);
  const [previewAudioUnlocked, setPreviewAudioUnlocked] = useState(false);
  const [visualPreloadVersion, setVisualPreloadVersion] = useState(0);
  const [activeVideoReadyKey, setActiveVideoReadyKey] = useState(null);
  const [isMobilePreviewDevice, setIsMobilePreviewDevice] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(MOBILE_PREVIEW_MEDIA_QUERY).matches;
  });
  const audioRefs = useRef(new Map());
  const activeVideoRef = useRef(null);
  const timelineSegmentRefs = useRef(new Map());
  const previousSessionPreviewIdentityRef = useRef(null);
  const { colorMode } = useColorMode();
  const { t } = useLocalization();

  const statusMap = useMemo(
    () => getStatusMap(expressGenerationStatus, generationStatusDetails),
    [expressGenerationStatus, generationStatusDetails],
  );
  const progressPercentage = useMemo(
    () => getProgressPercentage(statusMap, generationStatusDetails),
    [generationStatusDetails, statusMap],
  );
  const hasProgressStatus = useMemo(
    () => (
      Object.keys(statusMap || {}).length > 0 ||
      Array.isArray(generationStatusDetails?.session?.completedStages)
    ),
    [generationStatusDetails, statusMap],
  );
  const currentStep = useMemo(
    () => getCurrentStep(statusMap, t, generationStatusDetails),
    [generationStatusDetails, statusMap, t],
  );
  const currentStageKey = useMemo(
    () => getCurrentStageKey(statusMap, generationStatusDetails),
    [generationStatusDetails, statusMap],
  );
  const sessionPreview = generationStatusDetails?.session || null;
  const sessionPreviewIdentity =
    sessionPreview?.id ||
    sessionPreview?.requestId ||
    generationStatusDetails?.session_id ||
    generationStatusDetails?.request_id ||
    null;
  const shouldLimitMobileVideoPreload =
    isMobilePreviewDevice &&
    isGenerationPending &&
    !videoLink &&
    MOBILE_SINGLE_VIDEO_LOAD_STAGES.has(currentStageKey);
  const visualSegments = useMemo(
    () => buildVisualSegments(sessionPreview, rawSessionDetails),
    [rawSessionDetails, sessionPreview],
  );
  const visualAssetSignature = useMemo(
    () => visualSegments.map((segment) => (
      `${segment.key}:${segment.type}:${segment.stage}:${segment.url}`
    )).join('|'),
    [visualSegments],
  );
  const audioSegments = useMemo(() => buildAudioSegments(sessionPreview), [sessionPreview]);
  const timelineDuration = useMemo(
    () => resolveTimelineDuration(sessionPreview, visualSegments, audioSegments),
    [audioSegments, sessionPreview, visualSegments],
  );
  const hasTimelinePreview = visualSegments.length > 0 || audioSegments.length > 0;
  const hasPreviewAudio = audioSegments.length > 0;
  const isPreviewAudioEffectivelyMuted =
    previewAudioMuted || !previewAudioUnlocked || previewAudioVolume <= 0;
  const activeVisualSegment = useMemo(
    () => findActiveVisualSegment(visualSegments, previewTime),
    [previewTime, visualSegments],
  );
  const activeAudioSegment = useMemo(
    () => audioSegments.find((segment) => isSegmentActiveAtTime(segment, previewTime)) || null,
    [audioSegments, previewTime],
  );
  const visualTimelineStripStyle = useMemo(
    () => (enableScrollableLayerTimeline
      ? { minWidth: `${getTimelineStripWidth(visualSegments, timelineDuration)}px` }
      : undefined),
    [enableScrollableLayerTimeline, timelineDuration, visualSegments],
  );
  const audioTimelineStripStyle = useMemo(
    () => (enableScrollableLayerTimeline
      ? { minWidth: `${getTimelineStripWidth(audioSegments, timelineDuration)}px` }
      : undefined),
    [audioSegments, enableScrollableLayerTimeline, timelineDuration],
  );
  const visualSegmentsToPreload = useMemo(() => {
    if (!shouldLimitMobileVideoPreload) {
      return visualSegments;
    }

    return visualSegments.filter((segment) => (
      segment.type !== 'video' ||
      (activeVisualSegment?.key && segment.key === activeVisualSegment.key)
    ));
  }, [activeVisualSegment?.key, shouldLimitMobileVideoPreload, visualSegments]);
  const activeVisualCacheKey = getPreviewVisualCacheKey(activeVisualSegment);
  const activeVisualSourceUrl = getCachedPreviewVisualObjectUrl(activeVisualSegment) || activeVisualSegment?.url || '';
  const activeVisualRenderKey = activeVisualSegment
    ? `${activeVisualSegment.key}-${activeVisualSegment.stage}-${activeVisualSourceUrl || activeVisualSegment.url}`
    : null;
  const isVisualSegmentPreloaded = useCallback((segment) => {
    // visualPreloadVersion intentionally forces recalculation after async preloads settle.
    const cacheKey = getPreviewVisualCacheKey(segment);
    return !cacheKey || previewVisualReadyCache.has(cacheKey);
  }, [visualPreloadVersion]);
  const isPreviewMediaReadyAtTime = useCallback((time) => {
    const segmentAtTime = findActiveVisualSegment(visualSegments, time);
    if (
      segmentAtTime?.type === 'video' &&
      segmentAtTime.key !== activeVisualSegment?.key
    ) {
      return true;
    }
    return isVisualSegmentPreloaded(segmentAtTime);
  }, [activeVisualSegment?.key, isVisualSegmentPreloaded, visualSegments]);
  const isActiveVisualPreloaded = isVisualSegmentPreloaded(activeVisualSegment);
  const isActiveVideoElementReady = activeVisualSegment?.type !== 'video'
    || activeVideoReadyKey === activeVisualRenderKey
    || (activeVideoRef.current?.readyState ?? 0) >= PREVIEW_VIDEO_FRAME_READY_STATE;
  const isActiveVisualReady = !activeVisualSegment
    || (isActiveVisualPreloaded && isActiveVideoElementReady);
  const previewAspectRatio = normalizePreviewAspectRatio(sessionPreview);
  const isPortraitPreview = previewAspectRatio === '9:16';
  const aspectRatio = isPortraitPreview ? '9 / 16' : '16 / 9';
  const previewFrameStyle = {
    aspectRatio,
    width: isPortraitPreview
      ? 'min(100%, 31.5dvh, 292px)'
      : 'min(100%, calc(100vw - 48px), 640px)',
    maxWidth: '100%',
    maxHeight: isPortraitPreview
      ? 'min(56dvh, 520px)'
      : 'min(44dvh, 360px)',
  };
  const previewPlaybackButtonLabel = isPreviewPlaying ? 'Pause preview' : 'Play preview';

  useEffect(() => {
    if (!sessionPreviewIdentity) return;
    if (previousSessionPreviewIdentityRef.current === sessionPreviewIdentity) return;
    previousSessionPreviewIdentityRef.current = sessionPreviewIdentity;
    clearPreviewVisualCaches();
    setPreviewTime(0);
    setActiveVideoReadyKey(null);
    setVisualPreloadVersion((version) => version + 1);
  }, [sessionPreviewIdentity]);

  useEffect(() => {
    setActiveVideoReadyKey(null);
    setVisualPreloadVersion((version) => version + 1);
  }, [visualAssetSignature]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_PREVIEW_MEDIA_QUERY);
    const handleMediaQueryChange = () => {
      setIsMobilePreviewDevice(mediaQuery.matches);
    };
    handleMediaQueryChange();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaQueryChange);
      return () => mediaQuery.removeEventListener('change', handleMediaQueryChange);
    }

    mediaQuery.addListener(handleMediaQueryChange);
    return () => mediaQuery.removeListener(handleMediaQueryChange);
  }, []);

  const syncActiveAudioElements = useCallback((time, shouldPlay, options = {}) => {
    const activeAudioKeys = new Set();
    const isAudioUnlocked = previewAudioUnlocked || Boolean(options.forceAudioUnlocked);
    const isAudioMuted = Object.prototype.hasOwnProperty.call(options, 'forceAudioMuted')
      ? Boolean(options.forceAudioMuted)
      : previewAudioMuted;

    audioSegments.forEach((segment) => {
      const element = audioRefs.current.get(segment.key);
      if (!element) return;
      const isActive = isSegmentActiveAtTime(segment, time);
      if (!isActive || videoLink) {
        element.pause();
        return;
      }

      const localTime = Math.max(0, time - segment.startTime + segment.sourceTrimStartTime);
      if (Math.abs(element.currentTime - localTime) > PREVIEW_AUDIO_SEEK_TOLERANCE_SECONDS) {
        element.currentTime = localTime;
      }
      element.muted = isAudioMuted || !isAudioUnlocked;
      element.volume = resolveAudioVolume(
        segment,
        audioSegments,
        time,
        previewAudioVolume,
        isAudioMuted,
      );
      activeAudioKeys.add(segment.key);

      if (shouldPlay && element.paused) {
        element.play().catch(() => undefined);
      } else if (!shouldPlay) {
        element.pause();
      }
    });

    if (shouldPlay && options.primeInactive) {
      audioRefs.current.forEach((element, key) => {
        if (!activeAudioKeys.has(key)) {
          primeInactiveAudioElement(element);
        }
      });
    }
  }, [audioSegments, previewAudioMuted, previewAudioUnlocked, previewAudioVolume, videoLink]);

  const syncActiveVideoElement = useCallback((time, shouldPlay) => {
    const element = activeVideoRef.current;
    if (!element || activeVisualSegment?.type !== 'video') return;
    const localTime = Math.max(0, time - activeVisualSegment.startTime);
    if (
      (element.readyState ?? 0) >= PREVIEW_VIDEO_METADATA_READY_STATE &&
      Math.abs(element.currentTime - localTime) > PREVIEW_VIDEO_SEEK_TOLERANCE_SECONDS
    ) {
      element.currentTime = localTime;
    }
    if (shouldPlay && !videoLink) {
      element.play().catch(() => undefined);
    } else {
      element.pause();
    }
  }, [activeVisualSegment, videoLink]);

  const handlePreviewPlaybackToggle = useCallback(() => {
    const shouldPlay = !isPreviewPlaying;
    if (shouldPlay) {
      setPreviewAudioUnlocked(true);
    }
    syncActiveVideoElement(previewTime, shouldPlay);
    syncActiveAudioElements(previewTime, shouldPlay, {
      forceAudioUnlocked: shouldPlay,
      primeInactive: shouldPlay,
    });
    setIsPreviewPlaying(shouldPlay);
  }, [
    isPreviewPlaying,
    previewTime,
    syncActiveAudioElements,
    syncActiveVideoElement,
  ]);

  const handlePreviewAudioMuteToggle = useCallback(() => {
    setPreviewAudioUnlocked(true);
    if (isPreviewAudioEffectivelyMuted && previewAudioVolume <= 0) {
      setPreviewAudioVolume(1);
    }
    const shouldMute = !isPreviewAudioEffectivelyMuted;
    setPreviewAudioMuted(shouldMute);
    syncActiveAudioElements(previewTime, isPreviewPlaying && !videoLink && isActiveVisualReady, {
      forceAudioMuted: shouldMute,
      forceAudioUnlocked: true,
      primeInactive: isPreviewPlaying && !shouldMute,
    });
  }, [
    isActiveVisualReady,
    isPreviewPlaying,
    isPreviewAudioEffectivelyMuted,
    previewAudioVolume,
    previewTime,
    syncActiveAudioElements,
    videoLink,
  ]);

  const handlePreviewAudioVolumeChange = useCallback((event) => {
    const nextVolume = clampAudioValue(event.target.value);
    setPreviewAudioUnlocked(true);
    setPreviewAudioVolume(nextVolume);
    setPreviewAudioMuted(nextVolume <= 0);
  }, []);

  useEffect(() => {
    if (
      statusMap?.image_generation === 'COMPLETED' &&
      !hasCalledGetSessionImageLayers
    ) {
      // getSessionImageLayers?.();
      setHasCalledGetSessionImageLayers(true);
    }
  }, [
    statusMap?.image_generation,
    hasCalledGetSessionImageLayers,
    getSessionImageLayers,
  ]);

  useEffect(() => {
    if (!timelineDuration || previewTime <= timelineDuration) return;
    setPreviewTime(0);
  }, [previewTime, timelineDuration]);

  useEffect(() => {
    if (!visualSegmentsToPreload.length) return undefined;
    let isMounted = true;
    visualSegmentsToPreload.forEach((segment) => {
      preloadPreviewVisualSegment(segment).then(() => {
        if (isMounted) {
          setVisualPreloadVersion((version) => version + 1);
        }
      });
      cachePreviewVisualObjectUrl(segment).then((objectUrl) => {
        if (isMounted && objectUrl) {
          setVisualPreloadVersion((version) => version + 1);
        }
      });
    });
    setVisualPreloadVersion((version) => version + 1);
    return () => {
      isMounted = false;
    };
  }, [visualSegmentsToPreload]);

  useEffect(() => {
    if (activeVisualSegment?.type !== 'video') {
      setActiveVideoReadyKey(null);
      return;
    }
    const element = activeVideoRef.current;
    setActiveVideoReadyKey(
      (element?.readyState ?? 0) >= PREVIEW_VIDEO_FRAME_READY_STATE
        ? activeVisualRenderKey
        : null
    );
  }, [activeVisualRenderKey, activeVisualSegment?.type]);

  useEffect(() => {
    if (!hasTimelinePreview || !timelineDuration || !isPreviewPlaying || videoLink || !isActiveVisualReady) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      setPreviewTime((current) => {
        const next = current + 0.25;
        const nextTime = next >= timelineDuration ? 0 : next;
        return isPreviewMediaReadyAtTime(nextTime) ? nextTime : current;
      });
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [
    hasTimelinePreview,
    isActiveVisualReady,
    isPreviewMediaReadyAtTime,
    isPreviewPlaying,
    timelineDuration,
    videoLink,
  ]);

  useEffect(() => {
    const canPlayPreviewMedia = isPreviewPlaying && !videoLink && isActiveVisualReady;
    syncActiveAudioElements(previewTime, canPlayPreviewMedia);
  }, [isActiveVisualReady, isPreviewPlaying, previewTime, syncActiveAudioElements, videoLink]);

  useEffect(() => {
    syncActiveVideoElement(previewTime, isPreviewPlaying && !videoLink && isActiveVisualReady);
  }, [isActiveVisualReady, isPreviewPlaying, previewTime, syncActiveVideoElement, videoLink]);

  const handleActiveVideoReady = useCallback((event) => {
    const element = event.currentTarget;
    markPreviewVisualReady(activeVisualCacheKey);
    setVisualPreloadVersion((version) => version + 1);
    if (!element || activeVisualSegment?.type !== 'video') {
      setActiveVideoReadyKey(activeVisualRenderKey);
      return;
    }
    const localTime = Math.max(0, previewTime - activeVisualSegment.startTime);
    if (
      (element.readyState ?? 0) >= PREVIEW_VIDEO_METADATA_READY_STATE &&
      Math.abs(element.currentTime - localTime) > PREVIEW_VIDEO_SEEK_TOLERANCE_SECONDS
    ) {
      element.currentTime = localTime;
      if (element.seeking) return;
    }
    setActiveVideoReadyKey(activeVisualRenderKey);
  }, [activeVisualCacheKey, activeVisualRenderKey, activeVisualSegment, previewTime]);

  const handleActiveVideoWaiting = useCallback((event) => {
    if ((event.currentTarget?.readyState ?? 0) >= PREVIEW_VIDEO_FRAME_READY_STATE) {
      return;
    }
    setActiveVideoReadyKey(null);
  }, []);

  const handleActiveImageReady = useCallback(() => {
    markPreviewVisualReady(activeVisualCacheKey);
    setVisualPreloadVersion((version) => version + 1);
  }, [activeVisualCacheKey]);

  const registerAudioRef = useCallback((key, element) => {
    if (element) {
      audioRefs.current.set(key, element);
    } else {
      audioRefs.current.delete(key);
    }
  }, []);

  const registerTimelineSegmentRef = useCallback((trackKey, segmentKey, element) => {
    const refKey = `${trackKey}:${segmentKey}`;
    if (element) {
      timelineSegmentRefs.current.set(refKey, element);
    } else {
      timelineSegmentRefs.current.delete(refKey);
    }
  }, []);

  const scrollTimelineSegmentIntoView = useCallback((trackKey, segmentKey) => {
    if (!segmentKey || typeof window === 'undefined') return;
    const element = timelineSegmentRefs.current.get(`${trackKey}:${segmentKey}`);
    element?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, []);

  useEffect(() => {
    if (!enableScrollableLayerTimeline) return;
    scrollTimelineSegmentIntoView('visual', activeVisualSegment?.key);
  }, [activeVisualSegment?.key, enableScrollableLayerTimeline, scrollTimelineSegmentIntoView]);

  useEffect(() => {
    if (!enableScrollableLayerTimeline) return;
    scrollTimelineSegmentIntoView('audio', activeAudioSegment?.key);
  }, [activeAudioSegment?.key, enableScrollableLayerTimeline, scrollTimelineSegmentIntoView]);



  const videoActualLink = normalizeAssetUrl(videoLink);
  const pendingPreviewActualLink = normalizeAssetUrl(pendingPreviewVideoLink);

  const panelShell =
    colorMode === 'dark'
      ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d] shadow-[0_10px_28px_rgba(0,0,0,0.35)]'
      : 'bg-white/95 text-slate-900 border border-[#d7deef] shadow-sm';
  const progressTrack = colorMode === 'dark' ? 'bg-[#1f2a3d]' : 'bg-slate-200';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const timelineTrack = colorMode === 'dark' ? 'bg-[#0b1224]' : 'bg-slate-100';
  const errorPanel =
    colorMode === 'dark'
      ? 'bg-rose-900/50 text-rose-100 border border-rose-700/60'
      : 'bg-red-50 text-red-700 border border-red-200';
  const waitingPanel =
    colorMode === 'dark'
      ? 'border-amber-300/20 bg-amber-300/10 text-amber-100'
      : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <div className={`vidgenie-progress-panel ${panelShell} rounded-xl p-3 pt-3 transition-shadow duration-200 sm:rounded-2xl sm:p-4`}>
      {errorMessage && (
        <div className={`${errorPanel} p-3 rounded-xl mb-3`}>
          {errorMessage.error}
          <div>
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
              onClick={viewInStudio}
            >
              {t("common.viewInStudio")}
            </button>
          </div>
        </div>
      )}

      {(isGenerationPending || isGenerationWaitingForApproval || isGenerationPaused) && hasProgressStatus ? (
        <div className="clear-both mt-4 flex flex-col gap-2 text-left sm:flex-row sm:items-center">
          <div className={`w-full ${progressTrack} rounded-full overflow-hidden h-3`}>
            <div
              className={`h-full transition-all duration-300 ${isGenerationPaused ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <div className="min-w-0 break-words text-sm sm:whitespace-nowrap">
            {Math.round(progressPercentage)}% - {isGenerationPaused ? `Paused - ${currentStep || 'Preparing generation'}` : (currentStep || 'Preparing generation')}
          </div>
        </div>
      ) : expressGenerationStatus === null && !videoLink && !hasTimelinePreview && !pendingPreviewActualLink ? (
        <div className="flex justify-center items-center h-48">
          <FaSpinner className="animate-spin text-4xl" />
        </div>
      ) : null}

      {isGenerationWaitingForApproval && canProcessNextStep && onProcessNextStep && (
        <div className={`mt-4 rounded-xl border p-3 ${waitingPanel}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Images are ready for review</div>
              <p className="mt-1 text-xs opacity-80">
                Continue when the preview is ready to move into image-to-video generation.
              </p>
            </div>
            <button
              type="button"
              onClick={onProcessNextStep}
              disabled={isProcessingNextStep}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isProcessingNextStep ? <FaSpinner className="animate-spin" /> : <FaStepForward />}
              {isProcessingNextStep ? 'Continuing...' : 'Generate video'}
            </button>
          </div>
        </div>
      )}

      {isGenerationWaitingForApproval && canReviewStepImages && (
        <StepImageReviewPanel
          sessionPreview={sessionPreview}
          colorMode={colorMode}
          onSelectImage={onSelectStepImage}
          onRegenerateImage={onRegenerateStepImage}
        />
      )}

      {pendingPreviewActualLink && isGenerationPending && !videoLink && (
        <div className="vidgenie-preview-section mt-5">
          <div className="vidgenie-preview-header mb-3 text-left">
            <div className="text-sm font-semibold">Current render preview</div>
            <div className={`mt-0.5 break-words text-xs ${mutedText}`}>
              Your post-processing changes are still rendering. This preview remains on the previous version until the new video is ready.
            </div>
          </div>
          <div
            className={`vidgenie-preview-frame ${isPortraitPreview ? 'vidgenie-preview-frame-portrait' : 'vidgenie-preview-frame-landscape'} mx-auto overflow-hidden rounded-xl ${timelineTrack} ring-1 ${colorMode === 'dark' ? 'ring-white/10' : 'ring-slate-200'}`}
            style={previewFrameStyle}
          >
            <video
              key={pendingPreviewActualLink}
              controls
              playsInline
              preload="metadata"
              src={pendingPreviewActualLink}
              className="h-full w-full object-contain"
            >
              {t("progress.videoUnsupported")}
            </video>
          </div>
        </div>
      )}

      {hasTimelinePreview && !videoLink && !pendingPreviewActualLink && (
        <div className="vidgenie-preview-section mt-5">
          <div className="vidgenie-preview-header mb-3 flex flex-wrap items-center justify-between gap-2 text-left">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Timeline preview</div>
              <div className={`mt-0.5 break-words text-xs ${mutedText}`}>
                {sessionPreview?.previewStage ? getStageLabel(sessionPreview.previewStage, t) : currentStep}
              </div>
            </div>
            <div className={`text-xs tabular-nums ${mutedText}`}>
              {formatTime(previewTime)} / {formatTime(timelineDuration)}
            </div>
          </div>

          <div
            className={`vidgenie-preview-frame ${isPortraitPreview ? 'vidgenie-preview-frame-portrait' : 'vidgenie-preview-frame-landscape'} mx-auto flex items-center justify-center overflow-hidden rounded-xl ${timelineTrack} ring-1 ${colorMode === 'dark' ? 'ring-white/10' : 'ring-slate-200'}`}
            style={previewFrameStyle}
          >
            {activeVisualSegment?.url ? (
              activeVisualSegment.type === 'video' ? (
                <div className="relative h-full w-full">
                  <video
                    key={activeVisualRenderKey}
                    ref={activeVideoRef}
                    src={activeVisualSourceUrl}
                    muted
                    playsInline
                    preload="auto"
                    onLoadedData={handleActiveVideoReady}
                    onCanPlay={handleActiveVideoReady}
                    onSeeked={handleActiveVideoReady}
                    onError={handleActiveVideoReady}
                    onWaiting={handleActiveVideoWaiting}
                    onStalled={handleActiveVideoWaiting}
                    className={`h-full w-full object-contain transition-opacity duration-150 ${isActiveVisualReady ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {!isActiveVisualReady && (
                    <div className={`absolute inset-0 flex items-center justify-center gap-2 text-sm ${mutedText}`}>
                      <FaSpinner className="animate-spin" />
                      Loading preview media
                    </div>
                  )}
                </div>
              ) : isActiveVisualReady ? (
                <img
                  src={activeVisualSourceUrl}
                  alt={activeVisualSegment.title || 'Generated preview'}
                  onLoad={handleActiveImageReady}
                  onError={handleActiveImageReady}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className={`flex h-full w-full items-center justify-center gap-2 text-sm ${mutedText}`}>
                  <FaSpinner className="animate-spin" />
                  Loading preview media
                </div>
              )
            ) : (
              <div className={`flex h-full w-full items-center justify-center text-sm ${mutedText}`}>
                Waiting for preview assets
              </div>
            )}
          </div>

          <div className="vidgenie-preview-controls mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePreviewPlaybackToggle}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition ${
                colorMode === 'dark'
                  ? 'bg-white/10 text-white hover:bg-white/15'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              aria-label={previewPlaybackButtonLabel}
              title={previewPlaybackButtonLabel}
            >
              {isPreviewPlaying ? <FaPause /> : <FaPlay />}
            </button>
            <input
              type="range"
              min="0"
              max={Math.max(0.1, timelineDuration)}
              step="0.1"
              value={Math.min(previewTime, Math.max(0.1, timelineDuration))}
              onChange={(event) => setPreviewTime(Number(event.target.value))}
              className="min-w-[160px] flex-1"
              aria-label="Preview timeline"
            />
            {hasPreviewAudio && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreviewAudioMuteToggle}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition ${
                    colorMode === 'dark'
                      ? 'bg-white/10 text-white hover:bg-white/15'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  aria-label={
                    isPreviewAudioEffectivelyMuted
                      ? 'Unmute preview audio'
                      : 'Mute preview audio'
                  }
                  title={
                    isPreviewAudioEffectivelyMuted
                      ? 'Unmute preview audio'
                      : 'Mute preview audio'
                  }
                >
                  {isPreviewAudioEffectivelyMuted ? <FaVolumeMute /> : <FaVolumeUp />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isPreviewAudioEffectivelyMuted ? 0 : previewAudioVolume}
                  onChange={handlePreviewAudioVolumeChange}
                  className="w-24 sm:w-28"
                  aria-label="Preview audio volume"
                />
                <span className={`w-9 text-right text-[11px] tabular-nums ${mutedText}`}>
                  {Math.round((isPreviewAudioEffectivelyMuted ? 0 : previewAudioVolume) * 100)}%
                </span>
              </div>
            )}
          </div>

          <div className="vidgenie-timeline-group mt-3 space-y-2">
            {visualSegments.length > 0 && (
              <div>
                <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}>Visuals</div>
                <div className="vidgenie-timeline-scroller overflow-x-auto pb-1">
                  <div
                    className={`vidgenie-timeline-strip relative h-9 w-full overflow-hidden rounded-lg ${timelineTrack}`}
                    style={visualTimelineStripStyle}
                  >
                    {visualSegments.map((segment) => {
                      const isActive = enableScrollableLayerTimeline && activeVisualSegment?.key === segment.key;
                      return (
                        <div
                          key={segment.key}
                          ref={enableScrollableLayerTimeline
                            ? (element) => registerTimelineSegmentRef('visual', segment.key, element)
                            : null}
                          className={`absolute top-1 h-7 rounded-md px-2 text-[11px] font-semibold leading-7 text-white transition-shadow ${
                            isActive
                              ? 'bg-indigo-400 ring-2 ring-white/80 shadow-sm'
                              : 'bg-indigo-500/80'
                          }`}
                          style={getTimelineSegmentStyle(segment, timelineDuration, enableScrollableLayerTimeline)}
                          title={segment.title}
                        >
                          <span className="block truncate">{segment.type === 'video' ? 'Video' : 'Image'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {audioSegments.length > 0 && (
              <div>
                <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}>Audio</div>
                <div className="vidgenie-timeline-scroller overflow-x-auto pb-1">
                  <div
                    className={`vidgenie-timeline-strip relative h-9 w-full overflow-hidden rounded-lg ${timelineTrack}`}
                    style={audioTimelineStripStyle}
                  >
                    {audioSegments.map((segment) => {
                      const isActive = enableScrollableLayerTimeline && activeAudioSegment?.key === segment.key;
                      return (
                        <div
                          key={segment.key}
                          ref={enableScrollableLayerTimeline
                            ? (element) => registerTimelineSegmentRef('audio', segment.key, element)
                            : null}
                          className={`absolute top-1 h-7 rounded-md px-2 text-[11px] font-semibold leading-7 text-white transition-shadow ${
                            isSpeechAudio(segment) ? 'bg-emerald-500/80' : 'bg-cyan-500/80'
                          } ${
                            isActive ? 'ring-2 ring-white/80 shadow-sm' : ''
                          }`}
                          style={getTimelineSegmentStyle(segment, timelineDuration, enableScrollableLayerTimeline)}
                          title={segment.title}
                        >
                          <span className="block truncate">{isSpeechAudio(segment) ? 'Speech' : 'Audio'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="hidden">
            {audioSegments.map((segment) => (
              <audio
                key={segment.key}
                ref={(element) => registerAudioRef(segment.key, element)}
                src={segment.url}
                preload="auto"
                muted={previewAudioMuted || !previewAudioUnlocked}
              />
            ))}
          </div>
        </div>
      )}

      {videoActualLink && !isGenerationPending && (
        <div className="vidgenie-preview-section mt-5 clear-both">
          <div
            className={`vidgenie-preview-frame ${isPortraitPreview ? 'vidgenie-preview-frame-portrait' : 'vidgenie-preview-frame-landscape'} mx-auto overflow-hidden rounded-xl ${timelineTrack} ring-1 ${colorMode === 'dark' ? 'ring-white/10' : 'ring-slate-200'}`}
            style={previewFrameStyle}
          >
            <video
              key={videoActualLink}
              controls
              playsInline
              preload="metadata"
              src={videoActualLink}
              className="h-full w-full object-contain"
            >
              {t("progress.videoUnsupported")}
            </video>
          </div>
        </div>
      )}
    </div>
  );
}
