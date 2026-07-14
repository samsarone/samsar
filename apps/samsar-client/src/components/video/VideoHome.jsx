import { useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';
import CommonContainer from '../common/CommonContainer.tsx';
import FrameToolbar from './toolbars/frame_toolbar/index.jsx';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { CURRENT_EDITOR_VIEW, FRAME_TOOLBAR_VIEW } from '../../constants/Types.ts';
import { getHeaders } from '../../utils/web.jsx';
import VideoEditorContainer from './VideoEditorContainer.jsx';
import PreviewPlaybackController from './PreviewPlaybackController.jsx';
import AddAudioDialog from './util/AddAudioDialog.jsx';
import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';
import { debounce } from './util/debounce.jsx';
import AuthContainer, { AUTH_DIALOG_OPTIONS } from '../auth/AuthContainer.jsx';
import AssistantHome from '../assistant/AssistantHome.jsx';
import { getImagePreloaderWorker } from './workers/imagePreloaderWorkerSingleton'; // Import the worker singleton
import { useUser } from '../../contexts/UserContext.jsx';
import { FaCheck } from 'react-icons/fa';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { NavCanvasControlContext } from '../../contexts/NavCanvasControlContext.jsx';
import { getCanvasDimensionsForAspectRatio } from '../../utils/canvas.jsx';
import { normalizeActiveTextItemListForCanvas } from '../../constants/TextConfig.jsx';
import useUndoRedoState from '../../hooks/useUndoRedoState.js';
import {
  findLayerIndexAtDisplayFrame,
  getLayerDisplayFrameRanges,
  resolveTimelineDuration,
} from './util/studioPreviewTimeline.mjs';


import FrameToolbarHorizontal from './toolbars/frame_toolbar/FrameToolbarHorizontal.jsx';

import ScreenLoader from './util/ScreenLoader.jsx';
import StudioSkeletonLoader from './util/StudioSkeletonLoader.jsx';
import VideoEditAdvancedDialog from './advanced/VideoEditAdvancedDialog.jsx';

import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
const DEFAULT_SCENE_TRANSITION_PRESET = 'none';
const VALID_SCENE_TRANSITION_PRESETS = new Set(['none', 'fade', 'dissolve']);
const VIDEO_CANVAS_ZOOM_MODE_STORAGE_KEY = 'videoCanvasZoomMode';
const VIDEO_CANVAS_ZOOM_SCALE_STORAGE_KEY = 'videoCanvasZoomScale';
const CANVAS_ZOOM_STEP_RATIO = 0.25;
const MIN_CANVAS_ZOOM_RATIO = 0.5;
const PORTRAIT_CANVAS_INITIAL_ZOOM_RATIO = 0.5;
const MAX_CANVAS_ZOOM_RATIO = 4;
const ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY = 'advancedVideoEditPendingSession';
const SHARE_COPY_AFTER_AUTH_KEY = 'studioShareCopyAfterAuth';
const GUEST_SAMPLE_COPY_AFTER_AUTH_KEY = 'studioGuestSampleCopyAfterAuth';
const PENDING_COPY_MAX_AGE_MS = 10 * 60 * 1000;
const RENDER_STATUS_POLL_MS = 3000;
const MAX_RENDER_STATUS_FAILURES = 5;
const SCENE_PRELOAD_LOOKAHEAD = 2;

function isSessionRenderPending(sessionDetails) {
  return Boolean(
    sessionDetails?.videoGenerationPending ||
    (sessionDetails?.isExpressGeneration && sessionDetails?.expressGenerationPending)
  );
}

function normalizeVideoDownloadUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  return `${PROCESSOR_API_URL}/${trimmed.replace(/^\/+/, '')}`;
}

function upsertDocumentMeta(selector, attributes) {
  if (typeof document === 'undefined') {
    return;
  }

  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      element.removeAttribute(key);
      return;
    }
    element.setAttribute(key, value);
  });
}

function updateSharedSessionDocumentMetadata(sessionDetails) {
  if (typeof document === 'undefined') {
    return;
  }

  const title = sessionDetails?.sessionName || sessionDetails?.publishedTitle || 'Samsar One Studio Session';
  const description = sessionDetails?.publishedDescription || 'View this read-only Samsar One studio session.';
  const ogImageUrl = sessionDetails?.ogImageUrl || sessionDetails?.og_image_url || sessionDetails?.shareOgImageUrl;
  const pageUrl = window.location.href;

  document.title = title;
  upsertDocumentMeta('meta[name="description"]', { name: 'description', content: description });
  upsertDocumentMeta('meta[property="og:title"]', { property: 'og:title', content: title });
  upsertDocumentMeta('meta[property="og:description"]', { property: 'og:description', content: description });
  upsertDocumentMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
  upsertDocumentMeta('meta[property="og:url"]', { property: 'og:url', content: pageUrl });
  upsertDocumentMeta('meta[name="twitter:card"]', {
    name: 'twitter:card',
    content: ogImageUrl ? 'summary_large_image' : 'summary',
  });
  upsertDocumentMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
  upsertDocumentMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });

  if (ogImageUrl) {
    upsertDocumentMeta('meta[property="og:image"]', { property: 'og:image', content: ogImageUrl });
    upsertDocumentMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: ogImageUrl });
  }
}

function resolveAssistantFrameAssetUrl(assetPath, baseUrl) {
  if (typeof assetPath !== 'string') return null;
  const trimmed = assetPath.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return normalizedBaseUrl ? `${normalizedBaseUrl}${normalizedPath}` : normalizedPath;
}

async function imageUrlToAssistantFrameImageData(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
    return null;
  }

  if (imageUrl.startsWith('data:image/')) {
    const mimeType = imageUrl.slice(5, imageUrl.indexOf(';')) || 'image/png';
    return { dataUrl: imageUrl, mimeType };
  }

  try {
    const response = await fetch(imageUrl, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      return null;
    }

    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });

    return dataUrl ? { dataUrl, mimeType: blob.type || 'image/png' } : null;
  } catch {
    return null;
  }
}

function getAssistantFrameFallbackAssetPath(layer) {
  if (!layer || typeof layer !== 'object') {
    return null;
  }

  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const topImageItem = [...activeItemList].reverse().find((item) => item?.type === 'image') || {};

  return [
    topImageItem?.aiLayerStartFrame,
    topImageItem?.aiVideoFrameImage,
    topImageItem?.videoFrameImage,
    topImageItem?.sourceImage,
    topImageItem?.sourceImageUrl,
    topImageItem?.sourceImageURL,
    layer?.frameImages?.startFrameUrl,
    layer?.frameImages?.startFrame,
    layer?.frameImages?.aiLayerStartFrame,
    layer?.frameImages?.baseLayerStartFrame,
    layer?.frameImages?.aiVideoThumbnailPath,
    layer?.frameImages?.thumbnailPath,
    layer?.aiLayerStartFrame,
    layer?.aiVideoThumbnailPath,
    layer?.thumbnailPath,
    layer?.baseLayerStartFrame,
    layer?.imageSession?.activeImageRemoteLink,
    layer?.imageSession?.videoRenderStartFrameImage,
    layer?.imageSession?.activeGeneratedImage,
    layer?.imageSession?.activeEditedImage,
    layer?.imageSession?.activeSelectedImage,
  ].find((value) => typeof value === 'string' && value.trim()) || null;
}

function layerHasGeneratedVideoVisual(layer) {
  if (!layer || typeof layer !== 'object') {
    return false;
  }

  return Boolean(
    layer.hasAiVideoLayer ||
    layer.aiVideoLayer ||
    layer.aiVideoRemoteLink ||
    layer.hasLipSyncVideoLayer ||
    layer.lipSyncVideoLayer ||
    layer.lipSyncRemoteLink ||
    layer.hasSoundEffectVideoLayer ||
    layer.soundEffectVideoLayer ||
    layer.soundEffectRemoteLink ||
    layer.hasUserVideoLayer ||
    layer.userVideoLayer ||
    layer.userVideoRemoteLink ||
    layer.aiVideo?.url ||
    layer.lipSyncVideo?.url ||
    layer.soundEffectVideo?.url ||
    layer.userVideo?.url
  );
}

async function getAssistantFallbackFrameImageData(layer, baseUrl) {
  const fallbackAssetPath = getAssistantFrameFallbackAssetPath(layer);
  const fallbackImageUrl = resolveAssistantFrameAssetUrl(fallbackAssetPath, baseUrl);
  return await imageUrlToAssistantFrameImageData(fallbackImageUrl);
}

function isGuestMediaUrl(candidate) {
  return typeof candidate === 'string' && candidate.includes('/video_sessions/guest_media');
}

function resolveLatestSessionVideoUrl(sessionDetails) {
  const candidates = [
    sessionDetails?.renderedVideoURL,
    sessionDetails?.renderedVideoUrl,
    sessionDetails?.rendered_video_url,
    sessionDetails?.remoteURL,
    sessionDetails?.remoteUrl,
    sessionDetails?.remote_url,
    sessionDetails?.publishedVideoURL,
    sessionDetails?.publishedVideoUrl,
    sessionDetails?.published_video_url,
    sessionDetails?.result_url,
    Array.isArray(sessionDetails?.result_urls) ? sessionDetails.result_urls[0] : null,
    sessionDetails?.videoLink,
    sessionDetails?.video_link,
    sessionDetails?.result?.videoLink,
    sessionDetails?.result?.video_link,
  ];
  const guestMediaUrl = sessionDetails?.isGuestSession ? candidates.find(isGuestMediaUrl) : null;
  const videoUrl = guestMediaUrl ||
    candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  return normalizeVideoDownloadUrl(videoUrl);
}

function resolveCompletedSessionVideoUrl(sessionDetails) {
  if (isSessionRenderPending(sessionDetails)) {
    return null;
  }

  return resolveLatestSessionVideoUrl(sessionDetails);
}

function resolveCopiedSessionId(data) {
  return (
    data?.session_id ||
    data?.sessionId ||
    data?.session?._id ||
    data?.session?.id ||
    null
  );
}

function isFreshPendingCopyRequest(startedAt) {
  const numericStartedAt = Number(startedAt);
  return Number.isFinite(numericStartedAt) && Date.now() - numericStartedAt < PENDING_COPY_MAX_AGE_MS;
}

function getImageItemUrlCandidate(item) {
  return [
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
  ].find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
}

function hasRenderableImageItemUrl(item) {
  const candidate = getImageItemUrlCandidate(item);
  if (!candidate) {
    return false;
  }

  const trimmedCandidate = candidate.trim();
  return /^(https?:|data:|blob:)/i.test(trimmedCandidate)
    || trimmedCandidate.startsWith('/')
    || trimmedCandidate.includes('/');
}

function getGuestSessionId(sessionDetails) {
  return (
    sessionDetails?._id?.toString?.() ||
    sessionDetails?._id ||
    sessionDetails?.id?.toString?.() ||
    sessionDetails?.id ||
    sessionDetails?.sessionId?.toString?.() ||
    sessionDetails?.sessionId ||
    ''
  );
}

function getMediaAssetPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const trimmedValue = value.trim();
  if (/^(data:|blob:)/i.test(trimmedValue)) {
    return '';
  }
  if (trimmedValue.startsWith('/video_sessions/guest_media')) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmedValue)) {
    try {
      const parsedUrl = new URL(trimmedValue);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      return pathname.startsWith('assets_v2/') ? pathname : '';
    } catch {
      return '';
    }
  }

  return trimmedValue.replace(/^\/+/, '').split('?')[0].split('#')[0];
}

function buildGuestSessionMediaUrl(sessionDetails, value) {
  const sessionId = getGuestSessionId(sessionDetails);
  const mediaPath = getMediaAssetPath(value);
  if (!sessionId || !mediaPath.startsWith('assets_v2/') || !mediaPath.split('/').includes(sessionId)) {
    return value;
  }

  const apiBaseUrl = typeof PROCESSOR_API_URL === 'string'
    ? PROCESSOR_API_URL.trim().replace(/\/+$/, '')
    : '';
  const routePath = `/video_sessions/guest_media?sessionId=${encodeURIComponent(sessionId)}&assetKey=${encodeURIComponent(mediaPath)}`;
  return apiBaseUrl ? `${apiBaseUrl}${routePath}` : routePath;
}

function normalizeGuestImageItemForStudio(item, sessionDetails) {
  if (!item || typeof item !== 'object' || item.type !== 'image') {
    return item;
  }

  const source = getImageItemUrlCandidate(item);
  const displayUrl = buildGuestSessionMediaUrl(sessionDetails, source);
  if (!displayUrl || displayUrl === source) {
    return item;
  }

  return {
    ...item,
    src: displayUrl,
    image: displayUrl,
    url: displayUrl,
    previewUrl: displayUrl,
    imageUrl: displayUrl,
    image_url: displayUrl,
    signedUrl: displayUrl,
    signed_url: displayUrl,
    displayUrl,
    display_url: displayUrl,
    rawSrc: item.rawSrc || item.src || source,
    rawUrl: item.rawUrl || item.url || source,
  };
}

function getGuestLayerBaseImageSource(layer = {}) {
  const imageSession = layer?.imageSession || {};
  return [
    imageSession.activeGeneratedImage,
    imageSession.activeSelectedImage,
    imageSession.activeEditedImage,
    imageSession.videoRenderStartFrameImage,
    imageSession.activeImageRemoteLink,
    layer?.aiLayerStartFrame,
    layer?.baseLayerStartFrame,
    layer?.aiVideoThumbnailPath,
    layer?.thumbnailPath,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
}

function layerHasRenderableImageItem(activeItemList = []) {
  return Array.isArray(activeItemList) && activeItemList.some((item) => (
    item?.type === 'image' &&
    item?.isHidden !== true &&
    hasRenderableImageItemUrl(item)
  ));
}

function normalizeGuestLayerForStudio(layer, sessionDetails) {
  if (!layer || typeof layer !== 'object') {
    return layer;
  }

  const imageSession = layer.imageSession && typeof layer.imageSession === 'object'
    ? layer.imageSession
    : {};
  const nextImageSession = { ...imageSession };
  [
    'activeSelectedImage',
    'activeGeneratedImage',
    'activeEditedImage',
    'videoRenderStartFrameImage',
    'videoRenderEndFrameImage',
    'activeImageRemoteLink',
  ].forEach((field) => {
    if (typeof nextImageSession[field] === 'string' && nextImageSession[field].trim()) {
      nextImageSession[field] = buildGuestSessionMediaUrl(sessionDetails, nextImageSession[field]);
    }
  });

  const rawActiveItemList = Array.isArray(nextImageSession.activeItemList)
    ? nextImageSession.activeItemList
    : [];
  let activeItemList = rawActiveItemList.map((item) => normalizeGuestImageItemForStudio(item, sessionDetails));

  if (!layerHasRenderableImageItem(activeItemList)) {
    const baseImageSource = getGuestLayerBaseImageSource({ ...layer, imageSession: nextImageSession });
    const baseImageUrl = buildGuestSessionMediaUrl(sessionDetails, baseImageSource);
    if (baseImageUrl) {
      const canvasDimensions = getCanvasDimensionsForAspectRatio(
        layer.aspectRatio || sessionDetails?.aspectRatio || '1:1'
      );
      const nonImageItems = activeItemList.filter((item) => item?.type !== 'image');
      activeItemList = [
        {
          id: 'studio_base_image',
          type: 'image',
          x: 0,
          y: 0,
          width: canvasDimensions.width,
          height: canvasDimensions.height,
          src: baseImageUrl,
          image: baseImageUrl,
          url: baseImageUrl,
          previewUrl: baseImageUrl,
          imageUrl: baseImageUrl,
          image_url: baseImageUrl,
          displayUrl: baseImageUrl,
          display_url: baseImageUrl,
          rawSrc: baseImageSource,
          rawUrl: baseImageSource,
          is_base_image: true,
          animations: [],
        },
        ...nonImageItems,
      ];
    }
  }

  nextImageSession.activeItemList = activeItemList;

  const nextLayer = {
    ...layer,
    imageSession: nextImageSession,
  };

  [
    ['aiVideoLayer', 'aiVideoRemoteLink'],
    ['lipSyncVideoLayer', 'lipSyncRemoteLink'],
    ['soundEffectVideoLayer', 'soundEffectRemoteLink'],
    ['userVideoLayer', 'userVideoRemoteLink'],
  ].forEach(([assetField, remoteField]) => {
    const rawRemoteField = `raw${remoteField.charAt(0).toUpperCase()}${remoteField.slice(1)}`;
    if (
      !nextLayer[rawRemoteField]
      && typeof nextLayer[remoteField] === 'string'
      && nextLayer[remoteField].trim()
    ) {
      nextLayer[rawRemoteField] = nextLayer[remoteField];
    }
    const source = nextLayer[assetField] || nextLayer[remoteField];
    const displayUrl = buildGuestSessionMediaUrl(sessionDetails, source);
    if (displayUrl && displayUrl !== source) {
      nextLayer[assetField] = displayUrl;
      nextLayer[remoteField] = displayUrl;
    }
  });

  return nextLayer;
}

function normalizeGuestSessionForStudio(sessionDetails) {
  if (!sessionDetails || typeof sessionDetails !== 'object' || !sessionDetails.isGuestSession) {
    return sessionDetails;
  }

  const normalizedSessionDetails = {
    ...sessionDetails,
    layers: Array.isArray(sessionDetails.layers)
      ? sessionDetails.layers.map((layer) => normalizeGuestLayerForStudio(layer, sessionDetails))
      : sessionDetails.layers,
  };

  [
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
  ].forEach((field) => {
    if (typeof normalizedSessionDetails[field] === 'string' && normalizedSessionDetails[field].trim()) {
      normalizedSessionDetails[field] = buildGuestSessionMediaUrl(
        normalizedSessionDetails,
        normalizedSessionDetails[field]
      );
    }
  });

  return normalizedSessionDetails;
}

function hasHydratedStudioLayers(sessionDetails) {
  const sessionLayers = Array.isArray(sessionDetails?.layers) ? sessionDetails.layers : [];
  if (sessionLayers.length === 0) {
    return false;
  }

  return sessionLayers.every((layer) => {
    const activeItemList = layer?.imageSession?.activeItemList;
    if (!Array.isArray(activeItemList)) {
      return false;
    }

    return activeItemList.every((item) => (
      item?.type !== 'image' || hasRenderableImageItemUrl(item)
    ));
  });
}

function mergeRenderStatusSessionDetails(previousSessionDetails, renderSessionDetails) {
  if (!previousSessionDetails || !renderSessionDetails) {
    return renderSessionDetails || previousSessionDetails;
  }

  const previousLayers = Array.isArray(previousSessionDetails.layers)
    ? previousSessionDetails.layers
    : [];

  if (previousLayers.length > 0 && !hasHydratedStudioLayers(renderSessionDetails)) {
    return {
      ...previousSessionDetails,
      ...renderSessionDetails,
      layers: previousLayers,
    };
  }

  return renderSessionDetails;
}

function clampCanvasZoomScale(nextScale, fitZoomScale = 1) {
  const safeBaseScale = Math.max(Number(fitZoomScale) || 1, 0.01);
  const minScale = safeBaseScale * MIN_CANVAS_ZOOM_RATIO;
  const maxScale = safeBaseScale * MAX_CANVAS_ZOOM_RATIO;
  return Math.min(Math.max(Number(nextScale) || safeBaseScale, minScale), maxScale);
}

function isPortraitAspectRatio(aspectRatio) {
  if (typeof aspectRatio !== 'string') {
    return false;
  }

  const [width, height] = aspectRatio.split(':').map((value) => Number(value));
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > width;
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

function isActiveUserVideoUploadTask(task) {
  return task?.status === 'UPLOADING' || task?.status === 'PROCESSING';
}

function getLayerActiveItemListForCanvas(layer, sessionDetails, previousActiveItemList = [], options = {}) {
  const layerActiveItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const visibleActiveItemList = resolveSessionSubtitlesEnabled(sessionDetails)
    ? layerActiveItemList
    : layerActiveItemList.filter((item) => !isSubtitleTranscriptItem(item));

  return normalizeActiveTextItemListForCanvas(
    visibleActiveItemList,
    getCanvasDimensionsForAspectRatio(sessionDetails?.aspectRatio),
    previousActiveItemList,
    options
  ).map((item) => ({ ...item, isHidden: false }));
}

function shouldIgnoreCanvasHistoryShortcut(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"]')
  );
}

function isSubtitleTranscriptItem(item) {
  return item?.type === 'text' && item?.subType === 'subtitle';
}

function removeSubtitleTranscriptItemsFromLayer(layer) {
  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : null;

  if (!activeItemList || activeItemList.length === 0) {
    return layer;
  }

  const filteredActiveItemList = activeItemList.filter((item) => !isSubtitleTranscriptItem(item));
  if (filteredActiveItemList.length === activeItemList.length) {
    return layer;
  }

  return {
    ...layer,
    imageSession: {
      ...layer.imageSession,
      activeItemList: filteredActiveItemList,
    },
  };
}

function removeSubtitleTranscriptItemsFromLayers(layers = []) {
  if (!Array.isArray(layers) || layers.length === 0) {
    return layers;
  }

  let didRemoveSubtitles = false;
  const nextLayers = layers.map((layer) => {
    const nextLayer = removeSubtitleTranscriptItemsFromLayer(layer);
    if (nextLayer !== layer) {
      didRemoveSubtitles = true;
    }
    return nextLayer;
  });

  return didRemoveSubtitles ? nextLayers : layers;
}

function resolveSessionSubtitlesEnabled(sessionDetails = {}) {
  if (sessionDetails?.enableSubtitles === false) {
    return false;
  }

  if (typeof sessionDetails?.hasSubtitles === 'boolean') {
    return sessionDetails.hasSubtitles;
  }

  if (typeof sessionDetails?.has_subtitles === 'boolean') {
    return sessionDetails.has_subtitles;
  }

  if (typeof sessionDetails?.enableSubtitles === 'boolean') {
    return sessionDetails.enableSubtitles;
  }

  return true;
}

function getSessionLayerId(layer) {
  return layer?._id?.toString?.() || layer?._id || layer?.id || null;
}

function getAudioLayerId(layer) {
  return layer?._id?.toString?.() || layer?._id || layer?.id || null;
}

const previewAudioLayerMergeCache = {
  sessionAudioLayers: null,
  workingAudioLayers: null,
  mergedAudioLayers: [],
};

function mergePreviewAudioLayers(sessionAudioLayers, workingAudioLayers) {
  if (
    previewAudioLayerMergeCache.sessionAudioLayers === sessionAudioLayers
    && previewAudioLayerMergeCache.workingAudioLayers === workingAudioLayers
  ) {
    return previewAudioLayerMergeCache.mergedAudioLayers;
  }

  const sessionLayers = Array.isArray(sessionAudioLayers)
    ? sessionAudioLayers.filter(Boolean)
    : [];
  const workingLayers = Array.isArray(workingAudioLayers)
    ? workingAudioLayers.filter(Boolean)
    : [];
  let mergedAudioLayers;

  if (sessionLayers.length === 0) {
    mergedAudioLayers = workingLayers;
  } else if (workingLayers.length === 0) {
    mergedAudioLayers = sessionLayers;
  } else {
    const workingLayerById = new Map();
    workingLayers.forEach((audioLayer) => {
      const layerId = getAudioLayerId(audioLayer);
      if (layerId) {
        workingLayerById.set(layerId.toString(), audioLayer);
      }
    });

    const sessionLayerIds = new Set();
    mergedAudioLayers = sessionLayers.map((sessionLayer) => {
      const layerId = getAudioLayerId(sessionLayer);
      if (layerId) {
        sessionLayerIds.add(layerId.toString());
      }

      const workingLayer = layerId ? workingLayerById.get(layerId.toString()) : null;
      return workingLayer ? { ...sessionLayer, ...workingLayer } : sessionLayer;
    });

    workingLayers.forEach((workingLayer) => {
      const layerId = getAudioLayerId(workingLayer);
      if (!layerId || sessionLayerIds.has(layerId.toString())) {
        return;
      }
      mergedAudioLayers.push(workingLayer);
    });
  }

  previewAudioLayerMergeCache.sessionAudioLayers = sessionAudioLayers;
  previewAudioLayerMergeCache.workingAudioLayers = workingAudioLayers;
  previewAudioLayerMergeCache.mergedAudioLayers = mergedAudioLayers;
  return mergedAudioLayers;
}

export default function VideoHome() {
  const {
    setZoomCanvasIn,
    setZoomCanvasOut,
    setResetCanvasZoom,
    setCanvasZoomPercent,
    setCanZoomInCanvas,
    setCanZoomOutCanvas,
  } = useContext(NavCanvasControlContext);
  const [videoSessionDetails, setVideoSessionDetails] = useState(null);
  const [selectedLayerIndex, setSelectedLayerIndex] = useState(0);
  const [currentLayer, setCurrentLayer] = useState({});
  const [layers, setLayers] = useState([]);
  const [frames, setFrames] = useState([]);
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const [currentLayerSeek, setCurrentLayerSeek] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isLayerGenerationPending, setIsLayerGenerationPending] = useState(false);
  const [audioFileTrack, setAudioFileTrack] = useState(null);
  const [isRecordSpeechRecording, setIsRecordSpeechRecording] = useState(false);
  const [currentEditorView, setCurrentEditorView] = useState(CURRENT_EDITOR_VIEW.VIEW);
  const [downloadVideoDisplay, setDownloadVideoDisplay] = useState(false);
  const [renderedVideoPath, setRenderedVideoPath] = useState(null);
  const {
    state: activeItemList,
    setState: setActiveItemList,
    syncState: syncActiveItemList,
    undo: undoActiveItemList,
    redo: redoActiveItemList,
    canUndo: canUndoActiveItemList,
    canRedo: canRedoActiveItemList,
  } = useUndoRedoState([], { limit: 5 });
  const [isLayerSeeking, setIsLayerSeeking] = useState(false);
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const [frameToolbarView, setFrameToolbarView] = useState(FRAME_TOOLBAR_VIEW.DEFAULT);
  const [focusHintsPanelRequest, setFocusHintsPanelRequest] = useState(0);
  const [audioLayers, setAudioLayers] = useState([]);
  const [isAudioLayerDirty, setIsAudioLayerDirty] = useState(false);
  const [generationImages, setGenerationImages] = useState([]);
  const [layerListRequestAdded, setLayerListRequestAdded] = useState(false);
  const [sessionMessages, setSessionMessages] = useState([]);
  const [isCanvasDirty, setIsCanvasDirty] = useState(false);
  const [isAssistantQueryGenerating, setIsAssistantQueryGenerating] = useState(false);
  const [polling, setPolling] = useState(false); // New state variable to track polling status
  const [displayZoomType, setDisplayZoomType] = useState('fit'); // fit or manual
  const [stageZoomScale, setStageZoomScale] = useState(1);

  const [sessionMetadata, setSessionMetadata] = useState(null);

  const [aspectRatio, setAspectRatio] = useState(null);

  const [applyAudioDucking, setApplyAudioDucking] = useState(true);
  const [regenerateFramesBeforeRender, setRegenerateFramesBeforeRender] = useState(false);
  const [sceneTransitionPreset, setSceneTransitionPreset] = useState(DEFAULT_SCENE_TRANSITION_PRESET);

  const [isGuestSession, setIsGuestSession] = useState(false);

  // update current layer on update layers
  const [, setToggleUpdateCurrentLayer] = useState(false);
  const [currentLayerToBeUpdated, setCurrentLayerToBeUpdated] = useState(-1);

  const [isVideoPreviewPlaying, setIsVideoPreviewPlaying] = useState(false);
  const [isPreviewPlaybackActive, setIsPreviewPlaybackActive] = useState(false);
  const previewAudioLayers = useMemo(
    () => mergePreviewAudioLayers(videoSessionDetails?.audioLayers, audioLayers),
    [audioLayers, videoSessionDetails?.audioLayers]
  );

  const [downloadLink, setDownloadLink] = useState(null);

  const [renderCompletedThisSession, setRenderCompletedThisSession] = useState(false);
  const renderPollTimerRef = useRef(null);
  const renderPollFailureCountRef = useRef(0);
  const layerPollTimerRef = useRef(null);
  const layersRef = useRef([]);
  const currentLayerRef = useRef({});
  const activeItemListRef = useRef([]);
  const previousSyncedLayerIdRef = useRef(null);
  const sessionIdRef = useRef(null);
  const videoSessionDetailsRef = useRef(null);
  const latestActiveItemListSaveRequestRef = useRef(0);
  const debouncedUpdateSessionLayerActiveItemListRef = useRef(null);
  const assistantFrameCaptureRef = useRef(null);
  const scenePreloadRequestRef = useRef(0);
  const showLoginDialogRef = useRef(null);

  const { id: routeSessionId, shareToken, editableShareToken } = useParams();
  const [sharedSessionId, setSharedSessionId] = useState(null);
  const isReadOnlyShareView = Boolean(shareToken);
  const isEditableShareView = Boolean(editableShareToken);
  const isSharedSessionView = isReadOnlyShareView || isEditableShareView;
  const id = isSharedSessionView ? (sharedSessionId || routeSessionId) : routeSessionId;
  const navigate = useNavigate();
  const location = useLocation();

  const { user } = useUser();
  const { t } = useLocalization();
  const { colorMode } = useColorMode();

  const [isUpdateLayerPending, setIsUpdateLayerPending] = useState(false);


  const [canvasProcessLoading, setCanvasProcessLoading] = useState(false);

  const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
  const setAdvancedVideoEditPendingSession = (nextSessionId) => {
    if (!nextSessionId || typeof window === 'undefined') return;
    sessionStorage.setItem(
      ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY,
      JSON.stringify({ sessionId: nextSessionId, startedAt: Date.now() })
    );
  };

  const shouldForceAdvancedVideoEditPolling = (candidateSessionId) => {
    if (!candidateSessionId || typeof window === 'undefined') return false;
    try {
      const rawValue = sessionStorage.getItem(ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY);
      if (!rawValue) return false;
      const parsedValue = JSON.parse(rawValue);
      const startedAt = Number(parsedValue?.startedAt);
      const isFresh = Number.isFinite(startedAt) && Date.now() - startedAt < 10 * 60 * 1000;
      return parsedValue?.sessionId === candidateSessionId && isFresh;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!isEditableShareView || !editableShareToken) {
      return undefined;
    }

    const interceptorId = axios.interceptors.request.use((config) => {
      const requestUrl = typeof config?.url === 'string' ? config.url : '';
      if (
        !requestUrl.includes('/video_sessions/') &&
        !requestUrl.includes('/audio/') &&
        !requestUrl.includes('/assistants/')
      ) {
        return config;
      }

      const nextConfig = { ...config };
      const method = (nextConfig.method || 'get').toLowerCase();
      const data = nextConfig.data;
      const isPlainObjectPayload =
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        !(data instanceof FormData) &&
        !(data instanceof Blob) &&
        !(data instanceof ArrayBuffer) &&
        !(ArrayBuffer.isView(data));

      nextConfig.params = {
        ...(nextConfig.params || {}),
        editableShareToken,
      };

      if (method !== 'get' && isPlainObjectPayload) {
        nextConfig.data = {
          ...data,
          editableShareToken,
        };
      }

      return nextConfig;
    });

    return () => {
      axios.interceptors.request.eject(interceptorId);
    };
  }, [editableShareToken, isEditableShareView]);

  const clearAdvancedVideoEditPendingSession = (candidateSessionId) => {
    if (!candidateSessionId || typeof window === 'undefined') return;
    try {
      const rawValue = sessionStorage.getItem(ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY);
      if (!rawValue) return;
      const parsedValue = JSON.parse(rawValue);
      if (parsedValue?.sessionId === candidateSessionId) {
        sessionStorage.removeItem(ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY);
      }
    } catch {
      sessionStorage.removeItem(ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY);
    }
  };

  const hasPendingFrameOrLayerGeneration = (sessionData) => {
    if (!sessionData) {
      return false;
    }

    const sessionLayers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
    // Keep refresh_session_layers scoped to states that still depend on this legacy poll.
    // Video uploads and AI video tasks have their own status endpoints.
    return sessionLayers.some((layer) => (
      layer?.imageSession?.generationStatus === 'PENDING'
      || layer?.videoEditPending
    ));
  };

  const hasBlockingLayerGenerationForRender = (sessionData) => {
    if (!sessionData) {
      return false;
    }

    const sessionLayers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
    return sessionLayers.some((layer) => (
      layer?.imageSession?.generationStatus === 'PENDING'
      || layer?.aiVideoGenerationPending
      || layer?.lipSyncGenerationPending
      || layer?.soundEffectGenerationPending
      || layer?.userVideoGenerationPending
      || layer?.videoEditPending
      || isActiveUserVideoUploadTask(layer?.userVideoUploadTask)
    ));
  };

  const stopLayerPolling = () => {
    if (layerPollTimerRef.current) {
      clearInterval(layerPollTimerRef.current);
      layerPollTimerRef.current = null;
    }
    setPolling(false);
  };




  useEffect(() => {
    // Reset all state variables
    if (layerPollTimerRef.current) {
      clearInterval(layerPollTimerRef.current);
      layerPollTimerRef.current = null;
    }
    setSharedSessionId(null);
    setVideoSessionDetails(null);
    setSelectedLayerIndex(0);
    setCurrentLayer({});
    setLayers([]);
    setFrames([]);
    setCurrentLayerSeek(0);
    setIsVideoPreviewPlaying(false);
    setIsPreviewPlaybackActive(false);
    setTotalDuration(0);
    setIsLayerGenerationPending(false);
    setAudioFileTrack(null);
    setCurrentEditorView(CURRENT_EDITOR_VIEW.VIEW);
    setDownloadVideoDisplay(false);
    setRenderedVideoPath(null);
    syncActiveItemList([], { resetHistory: true });
    setIsLayerSeeking(false);
    setIsVideoGenerating(false);
    setFrameToolbarView(FRAME_TOOLBAR_VIEW.DEFAULT);
    setAudioLayers([]);
    setIsAudioLayerDirty(false);
    setGenerationImages([]);
    setLayerListRequestAdded(false);
    setIsCanvasDirty(false);
    setPolling(false); // Reset polling status
    setDisplayZoomType('fit'); // Reset zoom mode
    setStageZoomScale(getFitZoomScale()); // Reset zoom scale
    setAspectRatio(null);
    setApplyAudioDucking(true);
    setRegenerateFramesBeforeRender(false);
    setSceneTransitionPreset(DEFAULT_SCENE_TRANSITION_PRESET);
    setToggleUpdateCurrentLayer(false);
    setCurrentLayerToBeUpdated(-1);
    setRenderCompletedThisSession(false);
    layersRef.current = [];
    currentLayerRef.current = {};
    activeItemListRef.current = [];
    previousSyncedLayerIdRef.current = null;

    // Now, load any default values from localStorage into state
    const defaultModel = localStorage.getItem("defaultModel") || 'DALLE3';
    const defaultSceneDuration = parseFloat(localStorage.getItem("defaultSceneDuration")) || 2;
    const defaultApplyAudioDucking = localStorage.getItem("applyAudioDucking") !== 'false'; // defaults to true
    const storedZoomMode = localStorage.getItem(VIDEO_CANVAS_ZOOM_MODE_STORAGE_KEY);
    const storedZoomScaleValue = Number(localStorage.getItem(VIDEO_CANVAS_ZOOM_SCALE_STORAGE_KEY));
    const normalizedZoomMode = storedZoomMode === 'manual' ? 'manual' : 'fit';
    const fitZoomScale = getFitZoomScale();

    // If you have state variables for these, set them
    setApplyAudioDucking(defaultApplyAudioDucking);
    setDisplayZoomType(normalizedZoomMode);
    setStageZoomScale(
      normalizedZoomMode === 'manual' && Number.isFinite(storedZoomScaleValue)
        ? clampCanvasZoomScale(storedZoomScaleValue, fitZoomScale)
        : fitZoomScale
    );

    // If you need to pass these defaults to other components or use them in functions, make sure they're updated
    setVideoSessionDetails(prevDetails => (
      prevDetails
        ? {
          ...prevDetails,
          defaultModel: defaultModel,
          defaultSceneDuration: defaultSceneDuration,
          applyAudioDucking: defaultApplyAudioDucking,
          sceneTransitionPreset: DEFAULT_SCENE_TRANSITION_PRESET,
        }
        : prevDetails
    ));
  }, [routeSessionId, shareToken, editableShareToken]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    currentLayerRef.current = currentLayer;
  }, [currentLayer]);

  useEffect(() => {
    activeItemListRef.current = activeItemList;
  }, [activeItemList]);

  useEffect(() => {
    sessionIdRef.current = id;
  }, [id]);

  useEffect(() => {
    videoSessionDetailsRef.current = videoSessionDetails;
  }, [videoSessionDetails]);

  useEffect(() => {
    if (resolveSessionSubtitlesEnabled(videoSessionDetails)) {
      return;
    }

    setLayers((prevLayers) => removeSubtitleTranscriptItemsFromLayers(prevLayers));
    setCurrentLayer((prevLayer) => removeSubtitleTranscriptItemsFromLayer(prevLayer));
  }, [
    videoSessionDetails?.enableSubtitles,
    videoSessionDetails?.hasSubtitles,
    videoSessionDetails?.has_subtitles,
  ]);

  useEffect(() => {
    if (!isCanvasDirty || !renderCompletedThisSession) {
      return;
    }

    setRenderCompletedThisSession(false);
  }, [isCanvasDirty, renderCompletedThisSession]);

  const generateMeta = async () => {

    const payload = {
      sessionId: id,
    };

    const headers = getHeaders();

    const resData = await axios.post(`${PROCESSOR_API_URL}/video_sessions/generate_meta`, payload, headers);

    const sessionMeta = resData.data;

    setSessionMetadata(sessionMeta);
  }




  useEffect(() => {
    if (
      Array.isArray(layers) &&
      typeof currentLayerToBeUpdated === 'number' &&
      currentLayerToBeUpdated >= 0 &&
      currentLayerToBeUpdated < layers.length
    ) {
      setCurrentLayer(layers[currentLayerToBeUpdated]);
      setSelectedLayerIndex(currentLayerToBeUpdated);
      setLayerListRequestAdded(true);
    }
  }, [currentLayerToBeUpdated, layers]);


  const getCurrentShareRedirectPath = useCallback(() => (
    `${location.pathname}${location.search || ''}`
  ), [location.pathname, location.search]);

  const isGuestSampleView = Boolean(
    isGuestSession &&
    !isSharedSessionView &&
    videoSessionDetails?.isGuestSession
  );

  const showLoginDialog = useCallback((options = {}) => {
    const authOptions = { ...options };

    if (!getHeaders() && isGuestSampleView && routeSessionId) {
      const redirectPath = getCurrentShareRedirectPath();
      sessionStorage.setItem(
        GUEST_SAMPLE_COPY_AFTER_AUTH_KEY,
        JSON.stringify({ sessionId: routeSessionId, path: redirectPath, startedAt: Date.now() })
      );
      if (!authOptions.redirectTo) {
        authOptions.redirectTo = redirectPath;
      }
    }

    const loginComponent = (
      <AuthContainer {...authOptions} />
    );
    openAlertDialog(loginComponent, undefined, false, AUTH_DIALOG_OPTIONS);
  }, [getCurrentShareRedirectPath, isGuestSampleView, openAlertDialog, routeSessionId]);
  showLoginDialogRef.current = showLoginDialog;

  const copySharedSessionForEditing = useCallback(async () => {
    if (!shareToken) {
      return false;
    }

    const headers = getHeaders();
    if (!headers) {
      sessionStorage.setItem(
        SHARE_COPY_AFTER_AUTH_KEY,
        JSON.stringify({ shareToken, path: getCurrentShareRedirectPath(), startedAt: Date.now() })
      );
      showLoginDialog({ redirectTo: getCurrentShareRedirectPath() });
      return false;
    }

    try {
      toast.info('Creating an editable copy...', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/_copy_session`,
        { shareToken },
        headers
      );
      const nextSessionId = resolveCopiedSessionId(response?.data);

      if (!nextSessionId) {
        throw new Error('Copy completed without a session id.');
      }

      sessionStorage.removeItem(SHARE_COPY_AFTER_AUTH_KEY);
      localStorage.setItem('sessionId', nextSessionId);
      localStorage.setItem('videoSessionId', nextSessionId);
      navigate(`/video/${nextSessionId}`, { replace: true });
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Unable to create an editable copy.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
      return false;
    }
  }, [getCurrentShareRedirectPath, navigate, shareToken, showLoginDialog]);

  const requestEditableSharedSession = useCallback(() => {
    if (isEditableShareView) {
      if (!getHeaders()) {
        showLoginDialog({ redirectTo: getCurrentShareRedirectPath() });
        return false;
      }

      return true;
    }

    if (!isReadOnlyShareView) {
      return true;
    }

    if (!getHeaders() || !user?._id) {
      sessionStorage.setItem(
        SHARE_COPY_AFTER_AUTH_KEY,
        JSON.stringify({ shareToken, path: getCurrentShareRedirectPath(), startedAt: Date.now() })
      );
      showLoginDialog({ redirectTo: getCurrentShareRedirectPath() });
      return false;
    }

    void copySharedSessionForEditing();
    return false;
  }, [
    copySharedSessionForEditing,
    getCurrentShareRedirectPath,
    isEditableShareView,
    isReadOnlyShareView,
    shareToken,
    showLoginDialog,
    user?._id,
  ]);

  const copyGuestSampleSessionForEditing = useCallback(async () => {
    if (!isGuestSampleView || !routeSessionId) {
      return false;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog({ redirectTo: getCurrentShareRedirectPath() });
      return false;
    }

    try {
      toast.info('Creating an editable copy...', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/_copy_session`,
        { videoSessionId: routeSessionId, allowGuestSession: true },
        headers
      );
      const nextSessionId = resolveCopiedSessionId(response?.data);

      if (!nextSessionId) {
        throw new Error('Copy completed without a session id.');
      }

      sessionStorage.removeItem(GUEST_SAMPLE_COPY_AFTER_AUTH_KEY);
      localStorage.setItem('sessionId', nextSessionId);
      localStorage.setItem('videoSessionId', nextSessionId);
      navigate(`/video/${nextSessionId}`, { replace: true });
      return true;
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Unable to create an editable copy.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
      return false;
    }
  }, [
    getCurrentShareRedirectPath,
    isGuestSampleView,
    navigate,
    routeSessionId,
    showLoginDialog,
  ]);

  const requireEditableStudioAction = useCallback(() => {
    if (isSharedSessionView) {
      return requestEditableSharedSession();
    }

    if (isGuestSampleView) {
      void copyGuestSampleSessionForEditing();
      return false;
    }

    if (!getHeaders()) {
      showLoginDialog();
      return false;
    }

    return true;
  }, [
    copyGuestSampleSessionForEditing,
    isGuestSampleView,
    isSharedSessionView,
    requestEditableSharedSession,
    showLoginDialog,
  ]);

  useEffect(() => {
    if (!isReadOnlyShareView || !shareToken || !user?._id) {
      return;
    }

    try {
      const rawPendingCopy = sessionStorage.getItem(SHARE_COPY_AFTER_AUTH_KEY);
      if (!rawPendingCopy) {
        return;
      }
      const pendingCopy = JSON.parse(rawPendingCopy);
      if (pendingCopy?.shareToken === shareToken) {
        void copySharedSessionForEditing();
      }
    } catch {
      sessionStorage.removeItem(SHARE_COPY_AFTER_AUTH_KEY);
    }
  }, [copySharedSessionForEditing, isReadOnlyShareView, shareToken, user?._id]);

  useEffect(() => {
    if (!isGuestSampleView || !routeSessionId || !user?._id) {
      return;
    }

    try {
      const rawPendingCopy = sessionStorage.getItem(GUEST_SAMPLE_COPY_AFTER_AUTH_KEY);
      if (!rawPendingCopy) {
        return;
      }

      const pendingCopy = JSON.parse(rawPendingCopy);
      if (!isFreshPendingCopyRequest(pendingCopy?.startedAt)) {
        sessionStorage.removeItem(GUEST_SAMPLE_COPY_AFTER_AUTH_KEY);
        return;
      }

      if (pendingCopy?.sessionId === routeSessionId) {
        void copyGuestSampleSessionForEditing();
      }
    } catch {
      sessionStorage.removeItem(GUEST_SAMPLE_COPY_AFTER_AUTH_KEY);
    }
  }, [copyGuestSampleSessionForEditing, isGuestSampleView, routeSessionId, user?._id]);

  useEffect(() => {
    if (!isSharedSessionView || !videoSessionDetails) {
      return;
    }

    updateSharedSessionDocumentMetadata(videoSessionDetails);
  }, [isSharedSessionView, videoSessionDetails]);

  useEffect(() => {
    if (layerListRequestAdded) {
      if (videoSessionDetails && !videoSessionDetails.isExpressGeneration) {
        //  pollForLayersUpdate();
      }
    }
  }, [layerListRequestAdded, layers]);

  useEffect(() => {
    if (isSharedSessionView) {
      return;
    }

    if (layerPollTimerRef.current) {
      clearInterval(layerPollTimerRef.current);
      layerPollTimerRef.current = null;
    }
    setSharedSessionId(null);
    setVideoSessionDetails(null);
    setSelectedLayerIndex(0);
    setCurrentLayer({});
    setLayers([]);
    setFrames([]);
    setCurrentLayerSeek(0);
    setTotalDuration(0);
    setIsLayerGenerationPending(false);
    setAudioFileTrack(null);
    setCurrentEditorView(CURRENT_EDITOR_VIEW.VIEW);
    setDownloadVideoDisplay(false);
    setRenderedVideoPath(null);
    syncActiveItemList([], { resetHistory: true });
    setIsLayerSeeking(false);
    setIsVideoGenerating(false);
    setFrameToolbarView(FRAME_TOOLBAR_VIEW.DEFAULT);
    setAudioLayers([]);
    setIsAudioLayerDirty(false);
    setGenerationImages([]);
    setLayerListRequestAdded(false);
    setIsCanvasDirty(false);
    setPolling(false); // Reset polling status
  }, [id, isSharedSessionView]);


  const getFitZoomScale = (nextAspectRatio = aspectRatio) => {
    if (nextAspectRatio === '1:1') {
      return 1;
    } else if (nextAspectRatio === '16:9') {
      return 0.56;
    } else if (nextAspectRatio === '9:16') {
      return 0.7;
    } else {
      return 1;
    }
  }

  const applyInitialCanvasZoomForAspectRatio = (nextAspectRatio) => {
    const fitZoomScale = getFitZoomScale(nextAspectRatio);

    if (!isPortraitAspectRatio(nextAspectRatio)) {
      setDisplayZoomType('fit');
      setStageZoomScale(fitZoomScale);
      return;
    }

    setDisplayZoomType('manual');
    setStageZoomScale(
      clampCanvasZoomScale(fitZoomScale * PORTRAIT_CANVAS_INITIAL_ZOOM_RATIO, fitZoomScale)
    );
  };

  useEffect(() => {
    const fitZoomScale = getFitZoomScale();
    if (displayZoomType === 'fit') {
      setStageZoomScale(fitZoomScale);
    }
  }, [aspectRatio, displayZoomType]);

  useEffect(() => {
    localStorage.setItem(
      VIDEO_CANVAS_ZOOM_MODE_STORAGE_KEY,
      displayZoomType === 'manual' ? 'manual' : 'fit'
    );
    localStorage.setItem(VIDEO_CANVAS_ZOOM_SCALE_STORAGE_KEY, String(stageZoomScale));
  }, [displayZoomType, stageZoomScale]);

  const zoomCanvasIn = useCallback(() => {
    const fitZoomScale = getFitZoomScale();
    const stepSize = fitZoomScale * CANVAS_ZOOM_STEP_RATIO;
    setDisplayZoomType('manual');
    setStageZoomScale((prevScale) => clampCanvasZoomScale(prevScale + stepSize, fitZoomScale));
  }, [aspectRatio]);

  const zoomCanvasOut = useCallback(() => {
    const fitZoomScale = getFitZoomScale();
    const stepSize = fitZoomScale * CANVAS_ZOOM_STEP_RATIO;
    setDisplayZoomType('manual');
    setStageZoomScale((prevScale) => clampCanvasZoomScale(prevScale - stepSize, fitZoomScale));
  }, [aspectRatio]);

  const resetCanvasZoom = useCallback(() => {
    const fitZoomScale = getFitZoomScale();
    setDisplayZoomType('fit');
    setStageZoomScale(fitZoomScale);
  }, [aspectRatio]);

  const toggleStageZoom = resetCanvasZoom;
  const fitZoomScale = getFitZoomScale();
  const canvasZoomPercent = Math.round((stageZoomScale / Math.max(fitZoomScale, 0.01)) * 100);
  const canZoomInCanvas =
    stageZoomScale < clampCanvasZoomScale(fitZoomScale * MAX_CANVAS_ZOOM_RATIO, fitZoomScale) - 0.001;
  const canZoomOutCanvas =
    stageZoomScale > clampCanvasZoomScale(fitZoomScale * MIN_CANVAS_ZOOM_RATIO, fitZoomScale) + 0.001;

  useEffect(() => {
    setZoomCanvasIn(() => zoomCanvasIn);
    setZoomCanvasOut(() => zoomCanvasOut);
    setResetCanvasZoom(() => resetCanvasZoom);
  }, [resetCanvasZoom, setResetCanvasZoom, setZoomCanvasIn, setZoomCanvasOut, zoomCanvasIn, zoomCanvasOut]);

  useEffect(() => {
    setCanvasZoomPercent(canvasZoomPercent);
    setCanZoomInCanvas(canZoomInCanvas);
    setCanZoomOutCanvas(canZoomOutCanvas);
  }, [
    canvasZoomPercent,
    canZoomInCanvas,
    canZoomOutCanvas,
    setCanvasZoomPercent,
    setCanZoomInCanvas,
    setCanZoomOutCanvas,
  ]);

  const setSelectedLayer = (layer) => {
    const selectedLayerId = getSessionLayerId(layer);
    if (!selectedLayerId) {
      return;
    }
    const index = layers.findIndex(
      (candidateLayer) => getSessionLayerId(candidateLayer) === selectedLayerId
    );
    if (index < 0) {
      return;
    }
    setSelectedLayerIndex(index);
    currentLayerRef.current = layer;
    setCurrentLayer(layer);
    const { startFrame: newLayerSeek } = getLayerDisplayFrameRanges(layers)[index];
    if (!isLayerSeeking && !isVideoPreviewPlaying) {
      setCurrentLayerSeek(newLayerSeek);
    }
  }

  useEffect(() => {
    if (isLayerSeeking || isVideoPreviewPlaying || !currentLayer) {
      return;
    }

    const currentLayerIndex = layers.findIndex(
      (layer) => getSessionLayerId(layer) === getSessionLayerId(currentLayer)
    );
    if (currentLayerIndex < 0) {
      return;
    }
    const {
      startFrame: newLayerSeek,
      endFrame: currentLayerEndFrame,
    } = getLayerDisplayFrameRanges(layers)[currentLayerIndex];
    const resolvedCurrentLayerSeek = Number(currentLayerSeek);
    const isSeekWithinCurrentLayer = Number.isFinite(resolvedCurrentLayerSeek)
      && resolvedCurrentLayerSeek >= newLayerSeek
      && resolvedCurrentLayerSeek < currentLayerEndFrame;

    if (!isSeekWithinCurrentLayer) {
      setCurrentLayerSeek(newLayerSeek);
    }
  }, [currentLayer, currentLayerSeek, isLayerSeeking, isVideoPreviewPlaying, layers]);



  useEffect(() => {
    if (videoSessionDetails) {
      const defaultApplyAudioDucking = localStorage.getItem("applyAudioDucking") !== 'false';
      const resolvedApplyAudioDucking = typeof videoSessionDetails.applyAudioDucking === 'boolean'
        ? videoSessionDetails.applyAudioDucking
        : defaultApplyAudioDucking;
      setApplyAudioDucking(resolvedApplyAudioDucking);
      setSceneTransitionPreset(
        normalizeSceneTransitionPreset(videoSessionDetails.sceneTransitionPreset)
      );
    }
  }, [videoSessionDetails]);

  const handleApplyAudioDuckingChange = (nextValue) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    const resolvedValue = Boolean(nextValue);
    localStorage.setItem("applyAudioDucking", resolvedValue ? 'true' : 'false');
    setApplyAudioDucking(resolvedValue);
    setIsCanvasDirty(true);
    setVideoSessionDetails((prevDetails) => {
      if (!prevDetails) {
        return prevDetails;
      }

      return {
        ...prevDetails,
        applyAudioDucking: resolvedValue,
      };
    });

    if (isGuestSession) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      return;
    }

    axios.post(`${PROCESSOR_API_URL}/video_sessions/update_defaults`, {
      sessionId: id,
      defaults: {
        applyAudioDucking: resolvedValue,
      },
    }, headers).catch(() => {});
  };

  const handleRegenerateFramesBeforeRenderChange = (nextValue) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    setRegenerateFramesBeforeRender(Boolean(nextValue));
    setIsCanvasDirty(true);
  };

  const handleSceneTransitionPresetChange = (nextValue) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    const resolvedPreset = normalizeSceneTransitionPreset(nextValue);
    setSceneTransitionPreset(resolvedPreset);
    setIsCanvasDirty(true);
    setVideoSessionDetails((prevDetails) => {
      if (!prevDetails) {
        return prevDetails;
      }

      return {
        ...prevDetails,
        sceneTransitionPreset: resolvedPreset,
      };
    });

    if (isGuestSession) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      return;
    }

    axios.post(`${PROCESSOR_API_URL}/video_sessions/update_defaults`, {
      sessionId: id,
      defaults: {
        sceneTransitionPreset: resolvedPreset,
      },
    }, headers).catch(() => {});
  };

  useEffect(() => {
    let isCancelled = false;
    const headers = getHeaders();

    const sessionDetailsRequest = isReadOnlyShareView
      ? axios.get(`${PROCESSOR_API_URL}/video_sessions/share/${encodeURIComponent(shareToken)}`)
      : isEditableShareView
        ? axios.get(
          `${PROCESSOR_API_URL}/video_sessions/editable_share/${encodeURIComponent(editableShareToken)}`,
          headers || undefined
        )
        : axios.get(
          `${PROCESSOR_API_URL}/video_sessions/session_details?id=${encodeURIComponent(routeSessionId)}&cacheBust=${Date.now()}`,
          headers
        );

    sessionDetailsRequest.then((dataRes) => {
      if (isCancelled) {
        return;
      }
      const sessionDetails = normalizeGuestSessionForStudio(dataRes.data);
      const resolvedSessionId = sessionDetails?._id?.toString?.() || sessionDetails?._id || routeSessionId;
      const forceAdvancedEditPoll = shouldForceAdvancedVideoEditPolling(resolvedSessionId);

      if (isSharedSessionView && resolvedSessionId) {
        setSharedSessionId(resolvedSessionId);
      }

      if (sessionDetails.audio) {
        const audioFileTrack = `${PROCESSOR_API_URL}/video/audio/${sessionDetails.audio}`;
        setAudioFileTrack(audioFileTrack);
      }
      setVideoSessionDetails(sessionDetails);
      setIsGuestSession(Boolean(sessionDetails.isGuestSession || isReadOnlyShareView));
      const layers = Array.isArray(sessionDetails.layers) ? sessionDetails.layers : [];
      const initialLayerIndex = 0;
      const initialLayer = layers[initialLayerIndex] || null;
      const initialActiveItemList = getLayerActiveItemListForCanvas(initialLayer, sessionDetails);
      layersRef.current = layers;
      currentLayerRef.current = initialLayer || {};
      activeItemListRef.current = initialActiveItemList;
      previousSyncedLayerIdRef.current = getSessionLayerId(initialLayer);
      setLayers(layers);
      setCurrentLayer(initialLayer);
      setSelectedLayerIndex(initialLayerIndex);
      syncActiveItemList(initialActiveItemList, { resetHistory: true });
      setAspectRatio(sessionDetails.aspectRatio);
      applyInitialCanvasZoomForAspectRatio(sessionDetails.aspectRatio);
      setAudioLayers(sessionDetails.audioLayers || []);

      if (isSessionRenderPending(sessionDetails) || forceAdvancedEditPoll) {
        setIsVideoGenerating(true);
        startVideoRenderPoll();
      }

      const downloadLink = resolveCompletedSessionVideoUrl(sessionDetails);

      setDownloadLink(downloadLink);
      if (downloadLink) {
        setRenderedVideoPath(downloadLink);
        setDownloadVideoDisplay(true);
        setRenderCompletedThisSession(false);
        clearAdvancedVideoEditPendingSession(resolvedSessionId);
      }

      setTotalDuration(resolveTimelineDuration(layers, sessionDetails));
      setIsLayerGenerationPending(hasPendingFrameOrLayerGeneration(sessionDetails));
      setGenerationImages(sessionDetails.generations);
      setSessionMessages(sessionDetails.sessionMessages);
    }).catch(function (err) {
      if (isCancelled) {
        return;
      }
      if (isReadOnlyShareView) {
        toast.error('This shared session link is unavailable.', {
          position: 'bottom-center',
          className: 'custom-toast',
        });
        return;
      }
      if (isEditableShareView) {
        if (err?.response?.status === 401) {
          showLoginDialogRef.current?.({ redirectTo: getCurrentShareRedirectPath() });
          return;
        }
        toast.error(err?.response?.data?.error || 'This editable shared session link is unavailable.', {
          position: 'bottom-center',
          className: 'custom-toast',
        });
        return;
      }
      if (err?.response?.status === 401) {
        showLoginDialogRef.current?.({ redirectTo: getCurrentShareRedirectPath() });
        return;
      }
      if (routeSessionId && (err?.response?.status === 400 || err?.response?.status === 404)) {
        try {
          if (localStorage.getItem('videoSessionId') === routeSessionId) {
            localStorage.removeItem('videoSessionId');
          }
          if (localStorage.getItem('sessionId') === routeSessionId) {
            localStorage.removeItem('sessionId');
          }
        } catch  {

        }
      }
      toast.error(err?.response?.data?.error || 'Unable to open this session.', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [
    editableShareToken,
    getCurrentShareRedirectPath,
    isEditableShareView,
    isReadOnlyShareView,
    isSharedSessionView,
    navigate,
    routeSessionId,
    shareToken,
  ]);

  useEffect(() => {
    if (!Array.isArray(layers) || layers.length === 0) {
      return;
    }

    const activeLayerIndex = findLayerIndexAtDisplayFrame(layers, currentLayerSeek);
    const activeLayer = layers[activeLayerIndex];
    const activeLayerId = getSessionLayerId(activeLayer);
    const currentLayerId = getSessionLayerId(currentLayer);
    if (!activeLayer || activeLayerId === currentLayerId) {
      return;
    }

    currentLayerRef.current = activeLayer;
    setCurrentLayer(activeLayer);
    setSelectedLayerIndex(activeLayerIndex);
  }, [currentLayer, currentLayerSeek, layers]);





  useEffect(() => {
    const currentLayerId = currentLayer?._id?.toString?.() || null;
    const shouldReuseLocalTextConfig =
      currentLayerId && previousSyncedLayerIdRef.current === currentLayerId;

    if (currentLayer && currentLayer.imageSession && currentLayer.imageSession.activeItemList) {
      const activeList = getLayerActiveItemListForCanvas(
        currentLayer,
        videoSessionDetails,
        shouldReuseLocalTextConfig ? activeItemListRef.current : [],
        { preferFallbackTextConfig: shouldReuseLocalTextConfig }
      );
      activeItemListRef.current = activeList;
      syncActiveItemList(activeList, { resetHistory: !shouldReuseLocalTextConfig });
      // const newLayerSeek = Math.floor(currentLayer.durationOffset * 30);
      //setCurrentLayerSeek(newLayerSeek);
    } else {
      activeItemListRef.current = [];
      syncActiveItemList([], { resetHistory: true });
    }
    previousSyncedLayerIdRef.current = currentLayerId;
  }, [
    currentLayer,
    syncActiveItemList,
    videoSessionDetails?.aspectRatio,
    videoSessionDetails?.enableSubtitles,
    videoSessionDetails?.hasSubtitles,
    videoSessionDetails?.has_subtitles,
  ]);

  // Warm only the active scene and a small lookahead window. Preloading every
  // scene at once competes with the initial canvas media and makes long,
  // already-rendered sessions substantially slower to open.
  useEffect(() => {
    if (!Array.isArray(layers) || layers.length === 0) {
      return undefined;
    }

    const currentLayerId = getSessionLayerId(currentLayer);
    const currentLayerIndex = Math.max(
      0,
      layers.findIndex((layer) => getSessionLayerId(layer) === currentLayerId)
    );
    const preloadLayers = layers.slice(
      currentLayerIndex,
      currentLayerIndex + SCENE_PRELOAD_LOOKAHEAD + 1
    );
    const imagePreloaderWorker = getImagePreloaderWorker();
    const requestId = ++scenePreloadRequestRef.current;
    imagePreloaderWorker.postMessage({
      type: 'PRELOAD_LAYERS',
      requestId,
      layers: preloadLayers,
    });

    return () => {
      imagePreloaderWorker.postMessage({ type: 'CANCEL_PRELOAD', requestId });
    };
  }, [currentLayer, layers]);

  const toggleHideItemInLayer = (itemId) => {
    const updatedActiveItemList = activeItemList.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          isHidden: !item.isHidden,
        };
      }
      return item;
    });
    setActiveItemList(updatedActiveItemList);
  }

  useEffect(() => {
    if (isLayerGenerationPending) {
      pollForLayersUpdate();
    }
  }, [isLayerGenerationPending]);

  useEffect(() => {
    if (currentLayer && currentLayer.imageSession && currentLayer.imageSession.generationStatus === 'PENDING') {
      const currentLayerListData = layers.find((layer) => (layer._id.toString() === currentLayer._id.toString()));
      if (currentLayerListData.imageSession.generationStatus === 'COMPLETED') {
        setCurrentLayer(currentLayerListData);
      }
    }

  }, [layers, currentLayer]);


  const updateSessionLayersOrder = (newLayersOrder, updatedLayerId) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    setCanvasProcessLoading(true);


    const newLayerIds = newLayersOrder.map(layer => layer._id);

    const reqPayload = {
      sessionId: id,
      layers: newLayerIds,
    };

    axios.post(`${PROCESSOR_API_URL}/video_sessions/update_layers_order`, reqPayload, headers)
      .then((response) => {
        // Handle successful update
        const videoSessionData = response.data;
        const updatedLayers = videoSessionData.layers;

        const updatedLayerIndex = updatedLayers.findIndex(layer => layer._id === updatedLayerId);


        // Use updateCurrentLayerAndLayerList to update layers and selected layer
        updateCurrentLayerAndLayerList(updatedLayers, updatedLayerIndex);

        setCanvasProcessLoading(false);

        setIsCanvasDirty(true); // If needed
      })
      .catch(() => {
        // Handle error


        setCanvasProcessLoading(false);
      });
  };

  const pollForLayersUpdate = () => {
    if (polling || layerPollTimerRef.current) return; // Check if already polling
    setPolling(true); // Set polling status to true

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      setPolling(false);
      return;
    }

    const timer = setInterval(() => {
      axios.post(`${PROCESSOR_API_URL}/video_sessions/refresh_session_layers`, { id: id }, headers).then((dataRes) => {
        const frameResponse = dataRes.data;
        if (frameResponse) {
          const newLayers = Array.isArray(frameResponse.layers) ? frameResponse.layers : [];
          const isGenerationPending = hasPendingFrameOrLayerGeneration(frameResponse);
          const previousLayers = layersRef.current;
          let layersUpdated = newLayers.length !== previousLayers.length;

          if (!layersUpdated) {
            for (let i = 0; i < newLayers.length; i++) {
              const prevLayer = previousLayers[i];
              const nextLayer = newLayers[i];
              if (!prevLayer || !nextLayer) {
                layersUpdated = true;
                break;
              }

              const didImageStatusChange =
                prevLayer?.imageSession?.generationStatus !== nextLayer?.imageSession?.generationStatus;
              const didFrameStatusChange =
                prevLayer?.frameGenerationPending !== nextLayer?.frameGenerationPending
                || prevLayer?.aiVideoFrameGenerationPending !== nextLayer?.aiVideoFrameGenerationPending;
              const didVideoTaskChange =
                prevLayer?.aiVideoGenerationPending !== nextLayer?.aiVideoGenerationPending
                || prevLayer?.lipSyncGenerationPending !== nextLayer?.lipSyncGenerationPending
                || prevLayer?.soundEffectGenerationPending !== nextLayer?.soundEffectGenerationPending
                || prevLayer?.userVideoGenerationPending !== nextLayer?.userVideoGenerationPending
                || prevLayer?.videoEditPending !== nextLayer?.videoEditPending
                || prevLayer?.videoEditStatus !== nextLayer?.videoEditStatus
                || prevLayer?.videoEditError !== nextLayer?.videoEditError
                || prevLayer?.videoEditTaskId !== nextLayer?.videoEditTaskId
                || prevLayer?.videoEditTaskMessage !== nextLayer?.videoEditTaskMessage
                || JSON.stringify(prevLayer?.videoEditPendingOperations || [])
                  !== JSON.stringify(nextLayer?.videoEditPendingOperations || [])
                || prevLayer?.userVideoGenerationStatus !== nextLayer?.userVideoGenerationStatus
                || prevLayer?.userVideoLayer !== nextLayer?.userVideoLayer
                || prevLayer?.userVideoGenerationError !== nextLayer?.userVideoGenerationError
                || prevLayer?.userVideoUploadTaskId !== nextLayer?.userVideoUploadTaskId
                || prevLayer?.userVideoUploadTask?.status !== nextLayer?.userVideoUploadTask?.status
                || prevLayer?.userVideoUploadTask?.uploadedBytes !== nextLayer?.userVideoUploadTask?.uploadedBytes
                || prevLayer?.userVideoUploadTask?.uploadedChunks !== nextLayer?.userVideoUploadTask?.uploadedChunks
                || prevLayer?.userVideoUploadTask?.message !== nextLayer?.userVideoUploadTask?.message;

              if (didImageStatusChange || didFrameStatusChange || didVideoTaskChange) {
                layersUpdated = true;
                break;
              }
            }
          }

          if (layersUpdated) {
            setLayers(newLayers);
            setVideoSessionDetails(frameResponse);
            setAudioLayers(frameResponse.audioLayers || []);
            if (Number.isFinite(frameResponse.totalDuration)) {
              setTotalDuration(frameResponse.totalDuration);
            }

            if (currentLayerRef.current?._id) {
              const refreshedCurrentLayer = newLayers.find(
                (layer) => layer._id === currentLayerRef.current._id
              );
              if (refreshedCurrentLayer) {
                setCurrentLayer(refreshedCurrentLayer);
              }
            }
          }

          setIsLayerGenerationPending(isGenerationPending);

          if (!isGenerationPending) {
            stopLayerPolling();
          }
        }
      }).catch(() => {
        stopLayerPolling();
      });
    }, 1000);

    layerPollTimerRef.current = timer;
  }

  const clearRenderPollTimer = (timer) => {
    if (timer) {
      clearInterval(timer);
    }
    if (!timer || renderPollTimerRef.current === timer) {
      renderPollTimerRef.current = null;
    }
    renderPollFailureCountRef.current = 0;
  };

  const stopRenderPollAfterFailureLimit = (timer, message) => {
    renderPollFailureCountRef.current += 1;
    if (renderPollFailureCountRef.current < MAX_RENDER_STATUS_FAILURES) {
      return false;
    }

    clearRenderPollTimer(timer);
    setIsVideoGenerating(false);
    clearAdvancedVideoEditPendingSession(id);
    toast.error(message, {
      position: "bottom-center",
      className: "custom-toast",
    });
    return true;
  };

  const startVideoRenderPoll = () => {
    setRenderCompletedThisSession(false);
    renderPollFailureCountRef.current = 0;
    if (isReadOnlyShareView) {
      if (!shareToken) {
        return;
      }

      if (renderPollTimerRef.current) {
        clearRenderPollTimer(renderPollTimerRef.current);
      }

      let isStatusRequestInFlight = false;
      const timer = setInterval(async () => {
        if (isStatusRequestInFlight) {
          return;
        }
        isStatusRequestInFlight = true;

        try {
          const dataRes = await axios.get(`${PROCESSOR_API_URL}/video_sessions/share/${encodeURIComponent(shareToken)}`);
          const sessionData = normalizeGuestSessionForStudio(dataRes.data);
          if (!sessionData) {
            stopRenderPollAfterFailureLimit(
              timer,
              'Unable to confirm render status after several attempts. Refresh the session before trying again.'
            );
            return;
          }

          renderPollFailureCountRef.current = 0;
          const resolvedSessionId = sessionData?._id?.toString?.() || sessionData?._id || null;
          if (resolvedSessionId) {
            setSharedSessionId(resolvedSessionId);
          }

          const sessionLayers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
          const currentLayerId = getSessionLayerId(currentLayerRef.current);
          const refreshedLayerIndex = Math.max(
            0,
            sessionLayers.findIndex((layer) => getSessionLayerId(layer) === currentLayerId)
          );
          const refreshedCurrentLayer = sessionLayers[refreshedLayerIndex] || null;

          layersRef.current = sessionLayers;
          currentLayerRef.current = refreshedCurrentLayer || {};
          setVideoSessionDetails(sessionData);
          setLayers(sessionLayers);
          setCurrentLayer(refreshedCurrentLayer);
          setSelectedLayerIndex(refreshedLayerIndex);
          setAudioLayers(sessionData.audioLayers || []);
          setIsLayerGenerationPending(hasPendingFrameOrLayerGeneration(sessionData));

          const videoLink = resolveCompletedSessionVideoUrl(sessionData);
          if (videoLink) {
            setRenderedVideoPath(videoLink);
            setDownloadVideoDisplay(true);
            setDownloadLink(videoLink);
          }

          if (!isSessionRenderPending(sessionData)) {
            clearRenderPollTimer(timer);
            setIsVideoGenerating(false);
          }
        } catch {
          stopRenderPollAfterFailureLimit(
            timer,
            'Unable to confirm render status after several attempts. Refresh the session before trying again.'
          );
        } finally {
          isStatusRequestInFlight = false;
        }
      }, RENDER_STATUS_POLL_MS);

      renderPollTimerRef.current = timer;
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    if (renderPollTimerRef.current) {
      clearRenderPollTimer(renderPollTimerRef.current);
    }

    let isStatusRequestInFlight = false;
    const timer = setInterval(async () => {
      if (isStatusRequestInFlight) {
        return;
      }
      isStatusRequestInFlight = true;

      try {
        const dataRes = await axios.post(`${PROCESSOR_API_URL}/video_sessions/get_render_video_status`, { id: id }, headers);
        const renderData = dataRes.data || {};
        const renderStatus = renderData.status;
        const sessionData = renderData.session;

        if (sessionData) {
          setVideoSessionDetails((prevDetails) => (
            mergeRenderStatusSessionDetails(prevDetails, sessionData)
          ));
        }

        if (renderStatus === 'PENDING') {
          renderPollFailureCountRef.current = 0;
          setIsVideoGenerating(true);
          return;
        }

        if (!renderStatus) {
          stopRenderPollAfterFailureLimit(
            timer,
            'Unable to confirm render status after several attempts. Refresh the session before trying again.'
          );
          return;
        }

        if (renderStatus === 'IDLE' && shouldForceAdvancedVideoEditPolling(id)) {
          const didStopPolling = stopRenderPollAfterFailureLimit(
            timer,
            'Render status stayed unavailable after several attempts. Refresh the session before trying again.'
          );
          if (didStopPolling) {
            return;
          }
          setIsVideoGenerating(true);
          return;
        }

        clearRenderPollTimer(timer);
        setIsVideoGenerating(false);

        if (renderStatus === 'COMPLETED' && sessionData) {
          const videoLink = resolveLatestSessionVideoUrl(sessionData);
          if (!videoLink) {
            return;
          }

          setRenderedVideoPath(`${videoLink}`);
          setDownloadVideoDisplay(true);
          setIsCanvasDirty(false);
          setDownloadLink(videoLink);
          setRenderCompletedThisSession(true);
          clearAdvancedVideoEditPendingSession(id);
          toast.success(<div>{t("studio.notifications.renderFinished")}</div>, {
            position: "bottom-center",
            className: "custom-toast",
          });
          return;
        }

        if (renderStatus === 'FAILED') {
          clearAdvancedVideoEditPendingSession(id);
          toast.error(renderData.generationError || sessionData?.generationError || 'Video render failed.', {
            position: "bottom-center",
            className: "custom-toast",
          });
        }

        setVideoSessionDetails((prev) => {
          if (!prev) {
            return prev;
          }

          return {
            ...prev,
            videoGenerationPending: false,
            expressGenerationPending: false,
          };
        });
      } catch {
        stopRenderPollAfterFailureLimit(
          timer,
          'Unable to confirm render status after several attempts. Refresh the session before trying again.'
        );
      } finally {
        isStatusRequestInFlight = false;
      }
    }, RENDER_STATUS_POLL_MS);

    renderPollTimerRef.current = timer;
  }

  const stopVideoRenderPoll = () => {
    if (renderPollTimerRef.current) {
      clearRenderPollTimer(renderPollTimerRef.current);
    }
  };

  useEffect(() => {
    if (videoSessionDetails && videoSessionDetails.audioLayers) {
      const audioLayerMap = videoSessionDetails.audioLayers.filter(layer => layer && layer.isEnabled).map(audioLayer => ({
        isSelected: false,
        ...audioLayer
      }));
      setAudioLayers(audioLayerMap);
    }
  }, [videoSessionDetails]);

  useEffect(() => {



    if (selectedLayerIndex && selectedLayerIndex === layers.length - 1) {

      setSelectedLayer(layers[selectedLayerIndex]);
    }
  }, [layers, selectedLayerIndex]);

  const requestVideoLayerEdit = async ({ layerId, operations }) => {
    if (!requireEditableStudioAction()) {
      return { success: false, authRequired: true };
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return { success: false };
    }

    try {
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/request_video_layer_edit`,
        {
          sessionId: id,
          layerId,
          operations,
        },
        headers
      );

      const sessionData = response?.data?.session;
      const updatedLayers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
      const updatedLayer = updatedLayers.find(
        (layer) => layer?._id?.toString?.() === layerId?.toString?.()
      );

      if (sessionData) {
        setVideoSessionDetails(sessionData);
        setLayers(updatedLayers);
        setIsLayerGenerationPending(true);
        setIsCanvasDirty(true);
        if (updatedLayer) {
          setCurrentLayer(updatedLayer);
        }
      }

      pollForLayersUpdate();

      toast.success(
        <div>
          <FaCheck className='inline-flex mr-2' /> Video edit queued
        </div>,
        {
          position: "bottom-center",
          className: "custom-toast",
        }
      );

      return {
        success: true,
        session: sessionData,
        layer: updatedLayer,
      };
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Unable to queue the video edit.', {
        position: "bottom-center",
        className: "custom-toast",
      });
      return {
        success: false,
        error,
      };
    }
  };

  const requestFrameRegenerationForRender = async (headers) => {
    const response = await axios.post(
      `${PROCESSOR_API_URL}/video_sessions/regenerate_frames`,
      { sessionId: id },
      headers
    );
    const videoSessionData = response.data;
    if (videoSessionData?.layers) {
      setLayers(videoSessionData.layers);
      setVideoSessionDetails(videoSessionData);
    }
    setIsCanvasDirty(true);
    return videoSessionData;
  };

  const submitRenderVideo = async (renderOptions = {}) => {
    if (!requireEditableStudioAction()) {
      return false;
    }

    if (isUpdateLayerPending) {
      toast.error('Please wait for the scene update to finish before rendering.', {
        position: "bottom-center",
        className: "custom-toast",
      });
      return false;
    }
    if (hasBlockingLayerGenerationForRender(videoSessionDetails)) {
      toast.error('Wait for the current layer processing to finish before rendering.', {
        position: "bottom-center",
        className: "custom-toast",
      });
      return false;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return false;
    }

    const resolvedApplyAudioDucking = typeof renderOptions?.applyAudioDucking === 'boolean'
      ? renderOptions.applyAudioDucking
      : applyAudioDucking;
    const resolvedRegenerateFramesBeforeRender = typeof renderOptions?.regenerateFramesBeforeRender === 'boolean'
      ? renderOptions.regenerateFramesBeforeRender
      : regenerateFramesBeforeRender;
    const resolvedSceneTransitionPreset = renderOptions?.sceneTransitionPreset || sceneTransitionPreset;

    const renderPayload = {
      id,
      applyAudioDucking: resolvedApplyAudioDucking,
      sceneTransitionPreset: resolvedSceneTransitionPreset,
    };

    setRenderCompletedThisSession(false);

    if (resolvedRegenerateFramesBeforeRender) {
      setIsVideoGenerating(true);
      try {
        await requestFrameRegenerationForRender(headers);
      } catch (error) {
        setIsVideoGenerating(false);
        toast.error(error?.response?.data?.error || 'Failed to regenerate frames before render', {
          position: "bottom-center",
          className: "custom-toast",
        });
        return false;
      }
    }

    try {
      await axios.post(`${PROCESSOR_API_URL}/video_sessions/request_render_video`, renderPayload, headers);
      setIsVideoGenerating(true);
      startVideoRenderPoll();
      return true;
    } catch (error) {
      setIsVideoGenerating(false);
      toast.error(error?.response?.data?.error || 'Failed to request video render', {
        position: "bottom-center",
        className: "custom-toast",
      });
      return false;
    }
  }

  const cancelPendingRender = () => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/cancel_pending_render`, { id }, headers)
      .then((response) => {
        stopVideoRenderPoll();
        setIsVideoGenerating(false);
        if (response?.data?.session) {
          setVideoSessionDetails(response.data.session);
        } else {
          setVideoSessionDetails((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              videoGenerationPending: false,
              expressGenerationPending: false,
            };
          });
        }
        toast.success("Render cancelled", {
          position: "bottom-center",
          className: "custom-toast",
        });
      })
      .catch(() => {
      });
  };

  const setLayerDuration = (value, index) => {
    const newLayers = layers;
    newLayers[index].duration = parseFloat(value);
    setLayers(newLayers);
  }


  const updateAllAudioLayersOneShot = async (updatedAudioLayers) => {
    try {
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return;
      }

      const payload = {
        sessionId: id,
        audioLayers: updatedAudioLayers
      };
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/update_all_audio_layers`,
        payload,
        headers
      );

      const { audioLayers: returnedLayers } = response.data;
      // Update local state with the “official” audioLayers from the server
      setAudioLayers(returnedLayers);
      setIsCanvasDirty(true);

      // Let FrameToolbar know the server accepted changes
      // so we can clear "isDirty" states on that side:
      return { success: true, serverLayers: returnedLayers };
    } catch (error) {

      return { success: false, error };
    }
  };

  const updateGlobalAudioLayersOneShot = async (updatedGlobalAudioLayers) => {
    try {
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return { success: false };
      }

      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/update_global_audio_layers`,
        {
          sessionId: id,
          globalAudioLayers: updatedGlobalAudioLayers,
        },
        headers
      );
      const sessionDetails = response.data?.sessionDetails || null;
      const returnedGlobalAudioLayers = response.data?.globalAudioLayers
        || sessionDetails?.global_audio_layers
        || [];

      if (sessionDetails) {
        setVideoSessionDetails(sessionDetails);
        setLayers(sessionDetails.layers || []);
        setAudioLayers(sessionDetails.audioLayers || []);
      }
      setIsCanvasDirty(true);

      return { success: true, serverGlobalAudioLayers: returnedGlobalAudioLayers };
    } catch (error) {
      return { success: false, error };
    }
  };

  const updateGlobalVideosOneShot = async (updatedGlobalVideos) => {
    try {
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return { success: false };
      }

      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/update_global_videos`,
        {
          sessionId: id,
          globalVideos: updatedGlobalVideos,
        },
        headers
      );
      const sessionDetails = response.data?.sessionDetails || null;
      const returnedGlobalVideos = response.data?.globalVideos
        || sessionDetails?.global_videos
        || [];

      if (sessionDetails) {
        setVideoSessionDetails(sessionDetails);
        setLayers(sessionDetails.layers || []);
        setAudioLayers(sessionDetails.audioLayers || []);
      }
      setIsCanvasDirty(true);

      return { success: true, serverGlobalVideos: returnedGlobalVideos };
    } catch (error) {
      return { success: false, error };
    }
  };

  const updateSessionHints = async (updatedHints) => {
    try {
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return { success: false };
      }

      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/update_hints`,
        {
          sessionId: id,
          hints: updatedHints,
        },
        headers
      );
      const sessionDetails = response.data?.sessionDetails || null;
      const returnedHints = response.data?.timelineHints
        || sessionDetails?.timelineHints
        || [];

      setVideoSessionDetails((previousSessionDetails) => (
        previousSessionDetails
          ? {
            ...previousSessionDetails,
            ...(sessionDetails || {}),
            layers: Array.isArray(layersRef.current)
              ? layersRef.current
              : previousSessionDetails.layers,
            audioLayers: previousSessionDetails.audioLayers,
            timelineHints: returnedHints,
          }
          : sessionDetails
            ? { ...sessionDetails, timelineHints: returnedHints }
            : previousSessionDetails
      ));

      return { success: true, serverHints: returnedHints };
    } catch (error) {
      return { success: false, error };
    }
  };

  const duplicateAudioLayer = async (audioLayer) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return { success: false };
    }

    try {
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/duplicate_audio_layer`,
        {
          sessionId: id,
          audioLayerId: audioLayer?._id?.toString?.() || audioLayer?._id,
        },
        headers
      );

      const sessionDetails = response?.data?.sessionDetails;
      const duplicatedAudioLayer = response?.data?.audioLayer;
      if (sessionDetails) {
        setVideoSessionDetails(sessionDetails);
        setIsCanvasDirty(true);
      }

      toast.success('Audio layer duplicated', {
        position: 'bottom-center',
        className: 'custom-toast',
      });

      return {
        success: true,
        duplicatedAudioLayerId: duplicatedAudioLayer?._id?.toString?.() || duplicatedAudioLayer?._id || null,
      };
    } catch (error) {
      toast.error('Unable to duplicate audio layer', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
      return { success: false, error };
    }
  };

  useEffect(() => {
    setTotalDuration(resolveTimelineDuration(layers, videoSessionDetails));
  }, [layers, videoSessionDetails?.duration, videoSessionDetails?.totalDuration]);

  useEffect(() => {
    return () => {
      if (layerPollTimerRef.current) {
        clearInterval(layerPollTimerRef.current);
        layerPollTimerRef.current = null;
      }
      stopVideoRenderPoll();
    };
  }, []);

  const setNewSeek = (newSeek) => {
    setCurrentLayerSeek(newSeek);
  };

  const addAudioToProject = (file) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataURL = reader.result;
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return;
      }

      const payload = {
        id,
        dataURL,
      }
      axios.post(`${PROCESSOR_API_URL}/video_sessions/add_audio`, payload, headers)
        .then(response => {
          const sessionData = response.data;
          setVideoSessionDetails(sessionData);
          setIsCanvasDirty(true);
          if (sessionData.audio) {
            const audioFileTrack = `${PROCESSOR_API_URL}/video/audio/${sessionData.audio}`;
            setAudioFileTrack(audioFileTrack);
          }
          closeAlertDialog();
        })
        .catch(() => {

        });
    };
    reader.readAsDataURL(file);
  }

  const showAddAudioToProjectDialog = () => {
    openAlertDialog(
      <AddAudioDialog addAudioToProject={addAudioToProject} />,
    )
  }



  const setFrameEditDisplay = (frame) => {
    const layerID = frame.layerId;
    const layerItem = layers.find(layer => layer._id === layerID);
    setSelectedLayer(layerItem);
    setCurrentEditorView(CURRENT_EDITOR_VIEW.EDIT);
  }

  const toggleFrameDisplayType = () => {
    if (currentEditorView === CURRENT_EDITOR_VIEW.VIEW) {
      setCurrentEditorView(CURRENT_EDITOR_VIEW.EDIT);
    } else {
      setCurrentEditorView(CURRENT_EDITOR_VIEW.VIEW);
    }
  }

  const startPlayFrames = () => {
    const audio = audioFileTrack ? new Audio(audioFileTrack) : null;
    if (audio) {
      audio.load();
    }

    let currentFrameIndex = 0;
    const frameRate = 1000 / 30;

    const updateFrame = () => {
      if (currentFrameIndex >= frames.length) {
        clearInterval(playbackInterval);
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        return;
      }
      setCurrentLayerSeek(currentFrameIndex);
      currentFrameIndex++;
    };

    if (audio) {
      audio.play();
    }

    const playbackInterval = setInterval(updateFrame, frameRate);
  };

  if (!debouncedUpdateSessionLayerActiveItemListRef.current) {
    debouncedUpdateSessionLayerActiveItemListRef.current = debounce((newActiveItemList) => {
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return;
      }

      const currentLayerSnapshot = currentLayerRef.current;
      const currentSessionId = sessionIdRef.current;
      const sessionDetailsSnapshot = videoSessionDetailsRef.current;
      const requestLayerId = currentLayerSnapshot?._id?.toString?.();

      if (!currentSessionId || !requestLayerId) {
        return;
      }

      const requestId = latestActiveItemListSaveRequestRef.current + 1;
      latestActiveItemListSaveRequestRef.current = requestId;

      const reqPayload = {
        sessionId: currentSessionId,
        activeItemList: newActiveItemList,
        layerId: requestLayerId,
        aspectRatio: sessionDetailsSnapshot?.aspectRatio,
      };

      activeItemListRef.current = newActiveItemList;
      setActiveItemList(newActiveItemList);

      axios
        .post(`${PROCESSOR_API_URL}/video_sessions/update_active_item_list`, reqPayload, headers)
        .then((response) => {
          if (requestId !== latestActiveItemListSaveRequestRef.current) {
            return;
          }

          const videoSessionData = response.data;
          const { session, layer } = videoSessionData || {};
          const updatedLayerId = layer?._id?.toString?.();

          if (session) {
            setVideoSessionDetails(session);
          }

          if (updatedLayerId) {
            const nextLayers = [...layersRef.current];
            const updatedLayerIndex = nextLayers.findIndex(
              (existingLayer) => existingLayer?._id?.toString?.() === updatedLayerId
            );

            if (updatedLayerIndex > -1) {
              nextLayers[updatedLayerIndex] = layer;
              setLayers(nextLayers);
            }
          }

          if (
            updatedLayerId
            && currentLayerRef.current?._id?.toString?.() === requestLayerId
            && updatedLayerId === requestLayerId
          ) {
            const normalizedItemList = normalizeActiveTextItemListForCanvas(
              layer?.imageSession?.activeItemList || [],
              getCanvasDimensionsForAspectRatio(session?.aspectRatio || sessionDetailsSnapshot?.aspectRatio),
              newActiveItemList,
              { preferFallbackTextConfig: true }
            );
            activeItemListRef.current = normalizedItemList;
            setCurrentLayer(layer);
            syncActiveItemList(normalizedItemList);
          }

          setIsCanvasDirty(true);
        })
        .catch(function () {

        });
    }, 5);
  }

  const syncSessionAfterLayerItemMutation = (sessionData, updatedLayer) => {
    if (!sessionData) {
      return;
    }

    const updatedLayers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
    setVideoSessionDetails(sessionData);
    setLayers(updatedLayers);
    setIsLayerGenerationPending(hasPendingFrameOrLayerGeneration(sessionData));

    if (!updatedLayer?._id) {
      return;
    }

    if (currentLayer?._id?.toString?.() === updatedLayer._id.toString()) {
      setCurrentLayer(updatedLayer);
      syncActiveItemList(updatedLayer.imageSession?.activeItemList || []);
      return;
    }

    const refreshedCurrentLayer = updatedLayers.find(
      (layer) => layer?._id?.toString?.() === currentLayer?._id?.toString?.()
    );
    if (refreshedCurrentLayer) {
      setCurrentLayer(refreshedCurrentLayer);
    }
  };

  const updateSessionLayerActiveItemList = (newActiveItemList) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }



    //setActiveItemList(newActiveItemList);
    if (currentEditorView !== CURRENT_EDITOR_VIEW.SHOW_ANIMATE_DISPLAY) {
      debouncedUpdateSessionLayerActiveItemListRef.current?.(newActiveItemList);
    }
  };

  const updateSessionLayerActiveItemListAnimations = (newActiveItemList) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    //setActiveItemList(newActiveItemList);
    if (currentEditorView !== CURRENT_EDITOR_VIEW.SHOW_ANIMATE_DISPLAY) {
      debouncedUpdateSessionLayerActiveItemListRef.current?.(newActiveItemList);
    }
  };

  const handleUndoCanvasHistory = useCallback(() => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    if (!canUndoActiveItemList) {
      return;
    }

    const nextActiveItemList = undoActiveItemList();
    activeItemListRef.current = nextActiveItemList;
    updateSessionLayerActiveItemList(nextActiveItemList);
  }, [canUndoActiveItemList, isSharedSessionView, requestEditableSharedSession, undoActiveItemList, updateSessionLayerActiveItemList]);

  const handleRedoCanvasHistory = useCallback(() => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    if (!canRedoActiveItemList) {
      return;
    }

    const nextActiveItemList = redoActiveItemList();
    activeItemListRef.current = nextActiveItemList;
    updateSessionLayerActiveItemList(nextActiveItemList);
  }, [canRedoActiveItemList, isSharedSessionView, redoActiveItemList, requestEditableSharedSession, updateSessionLayerActiveItemList]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      if (shouldIgnoreCanvasHistoryShortcut(event.target)) {
        return;
      }

      const key = `${event.key || ''}`.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedoCanvasHistory();
        } else {
          handleUndoCanvasHistory();
        }
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        handleRedoCanvasHistory();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRedoCanvasHistory, handleUndoCanvasHistory]);

  const handleSceneActionApplied = useCallback((responseData = {}) => {
    const sessionData = responseData.sessionDetails || responseData.session;
    const updatedLayer = responseData.layer;

    if (sessionData) {
      const updatedLayers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
      setVideoSessionDetails(sessionData);
      setLayers(updatedLayers);
      setIsLayerGenerationPending(hasPendingFrameOrLayerGeneration(sessionData));
      if (Array.isArray(sessionData.sessionMessages)) {
        setSessionMessages(sessionData.sessionMessages);
      }
    }

    if (updatedLayer?._id && currentLayerRef.current?._id?.toString?.() === updatedLayer._id.toString()) {
      const resolvedCanvasDimensions = getCanvasDimensionsForAspectRatio(
        sessionData?.aspectRatio || videoSessionDetailsRef.current?.aspectRatio
      );
      const normalizedItemList = normalizeActiveTextItemListForCanvas(
        updatedLayer.imageSession?.activeItemList || [],
        resolvedCanvasDimensions,
        activeItemListRef.current,
        { preferFallbackTextConfig: true }
      ).map((item) => ({ ...item, isHidden: false }));

      activeItemListRef.current = normalizedItemList;
      setCurrentLayer(updatedLayer);
      setActiveItemList(normalizedItemList);
    }

    setIsCanvasDirty(true);
  }, [setActiveItemList]);

  const updateLayerVisualItem = async ({ layerId, itemId, startFrame, endFrame }) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return { success: false };
    }

    try {
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/update_layer_visual_item`,
        {
          sessionId: id,
          layerId,
          itemId,
          startFrame,
          endFrame,
        },
        headers
      );

      syncSessionAfterLayerItemMutation(response.data?.session, response.data?.layer);
      setIsCanvasDirty(true);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      toast.error('Failed to update image or shape timing');
      return {
        success: false,
        error,
      };
    }
  };

  const deleteLayerVisualItem = async ({ layerId, itemId }) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return { success: false };
    }

    try {
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/delete_layer_visual_item`,
        {
          sessionId: id,
          layerId,
          itemId,
        },
        headers
      );

      syncSessionAfterLayerItemMutation(response.data?.session, response.data?.layer);
      setIsCanvasDirty(true);

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      toast.error('Failed to delete image or shape item');
      return {
        success: false,
        error,
      };
    }
  };

  const showAudioTrackView = () => {
    if (frameToolbarView === FRAME_TOOLBAR_VIEW.EXPANDED) {
      setFrameToolbarView(FRAME_TOOLBAR_VIEW.DEFAULT);
    } else {
      setFrameToolbarView(FRAME_TOOLBAR_VIEW.EXPANDED);
    }
  }


  const applySynchronizeAnimationsToBeats = () => {
    toast.success(<div>{t("studio.notifications.applySyncAnimationBeats")}</div>, {
      position: "bottom-center",
      className: "custom-toast",
    });


    const headers = getHeaders();
    axios.post(`${PROCESSOR_API_URL}/video_sessions/apply_auto_synchronize_animations_to_beats`, { id: id }, headers).then((dataRes) => {
      const sessionData = dataRes.data;
      setVideoSessionDetails(sessionData);
      setIsCanvasDirty(true);

    });

  }


  const applySynchronizeLayersToBeats = () => {
    toast.success(<div>{t("studio.notifications.applySyncLayersBeats")}</div>, {
      position: "bottom-center",
      className: "custom-toast",
    });


    const headers = getHeaders();
    axios.post(`${PROCESSOR_API_URL}/video_sessions/apply_auto_synchronize_layers_to_beats`, { id: id }, headers).then((dataRes) => {
      const sessionData = dataRes.data;
      setVideoSessionDetails(sessionData);
      setIsCanvasDirty(true);
    });
  }

  const applySynchronizeLayersAndAnimationsToBeats = () => {
    toast.success(<div>{t("studio.notifications.applySyncLayersAndAnimations")}</div>, {
      position: "bottom-center",
      className: "custom-toast",
    });

    const headers = getHeaders();
    axios.post(`${PROCESSOR_API_URL}/video_sessions/apply_auto_synchronize_layers_to_animations_and_beats`, { id: id }, headers).then((dataRes) => {
      const sessionData = dataRes.data;
      setVideoSessionDetails(sessionData);
      setIsCanvasDirty(true);


    });
  }


  const updateAudioLayer = (audioLayerId, startTime, endTime, duration) => {



    const updatedAudioLayers = audioLayers.map(audioLayer => {
      if (audioLayer._id.toString() === audioLayerId.toString()) {
        audioLayer.startTime = startTime;
        audioLayer.isSelected = true;
        audioLayer.endTime = endTime;
        audioLayer.duration = duration;
        audioLayer.isDirty = true;
      } else {
        audioLayer.isSelected = false;
        audioLayer.isDirty = false;
      }
      return audioLayer;
    });

    setAudioLayers(updatedAudioLayers);
    setIsAudioLayerDirty(true);

  };






  const removeAudioLayer = (audioLayer) => {

    const updatedAudioLayers = audioLayers.filter(ad => ad._id.toString() !== audioLayer._id.toString());
    setAudioLayers(updatedAudioLayers);
    setIsAudioLayerDirty(true);

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const audioLayerId = audioLayer._id.toString();
    const reqPayload = {
      sessionId: id,
      audioLayers: updatedAudioLayers,
      audioLayerId: audioLayerId
    };
    axios.post(`${PROCESSOR_API_URL}/video_sessions/update_audio_layers`, reqPayload, headers).then((response) => {
      setIsAudioLayerDirty(false);
      setIsCanvasDirty(true);

      const resData = response.data;


      const { audioLayers } = resData;
      setAudioLayers(audioLayers);


      toast.success(<div>{t("studio.notifications.audioLayerRemoved")}</div>, {
        position: "bottom-center",
        className: "custom-toast",
      });
    });
  }

  const updateChangesToActiveAudioLayers = (e) => {
    e.preventDefault();
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }


    const formData = new FormData(e.target);

    // Retrieve the layerId from the hidden input
    const layerId = formData.get('layerId');
    const reqPayload = {
      sessionId: id,
      audioLayers: audioLayers,
      audioLayerId: layerId
    };

    axios.post(`${PROCESSOR_API_URL}/video_sessions/update_audio_layers`, reqPayload, headers).then((response) => {
      setIsAudioLayerDirty(false);
      setIsCanvasDirty(true);

      const resData = response.data;

      const { audioLayers } = resData;
      setAudioLayers(audioLayers);

      toast.success(<div>{t("studio.notifications.audioLayersUpdated")}</div>, {
        position: "bottom-center",
        className: "custom-toast",
      });
    });
  }


  // Inside VideoHome component


  const updateChangesToActiveSessionLayers = (e) => {



    e.preventDefault();
    const formData = new FormData(e.target);

    // Extract data from the form
    const combinedLayerId = formData.get('layerId'); // e.g. "someLayerId_textItemId"
    const startTime = parseFloat(formData.get('startTime'));
    const endTime = parseFloat(formData.get('endTime'));

    if (!combinedLayerId) {

      return;
    }

    // Parse combinedLayerId into layerId and itemId
    const underscoreIndex = combinedLayerId.indexOf('_');
    if (underscoreIndex === -1) {

      return;
    }

    const layerId = combinedLayerId.substring(0, underscoreIndex);
    const itemId = combinedLayerId.substring(underscoreIndex + 1);

    // Find the target layer
    const layerIndex = layers.findIndex((l) => l._id.toString() === layerId.toString());
    if (layerIndex === -1) {

      return;
    }

    // Copy layer to avoid direct state mutation
    const updatedLayer = { ...layers[layerIndex] };

    if (!updatedLayer.imageSession || !updatedLayer.imageSession.activeItemList) {

      return;
    }

    // Find the text item within the layer
    const itemIndex = updatedLayer.imageSession.activeItemList.findIndex(
      (item) => item.id.toString() === itemId.toString()
    );

    if (itemIndex === -1) {

      return;
    }

    const updatedItem = { ...updatedLayer.imageSession.activeItemList[itemIndex] };

    // Convert times to frames
    const fps = 30;
    const newStartFrame = Math.round(startTime * fps);
    const newEndFrame = Math.round(endTime * fps);

    // Update item frames and duration based on startTime/endTime
    updatedItem.startFrame = newStartFrame;
    updatedItem.endFrame = newEndFrame;

    updatedItem.startTime = startTime;
    updatedItem.endTime = endTime;

    // The frameOffset is relative to the layer's durationOffset
    const layerStartFrame = Math.floor(updatedLayer.durationOffset * fps);
    updatedItem.frameOffset = newStartFrame - layerStartFrame;
    updatedItem.frameDuration = newEndFrame - newStartFrame;

    // Update the item in the layer
    updatedLayer.imageSession.activeItemList[itemIndex] = updatedItem;

    // Now update the activeItemList on the server
    // Instead of calling updateSessionLayer, we call updateSessionLayerActiveItemList
    const newActiveItemList = [...updatedLayer.imageSession.activeItemList];

    // This function is already defined in VideoHome and will handle the API call.
    updateSessionLayerActiveItemList(newActiveItemList);

    // Optionally, update local activeItemList state immediately
    setActiveItemList(newActiveItemList);
  };






  const addLayerToComposition = (position) => {

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    setCanvasProcessLoading(true);

    const currentLayerIndex = layers.findIndex(layer => layer._id === currentLayer._id);

    const payload = {
      sessionId: id,
      duration: videoSessionDetails.defaultSceneDuration ? videoSessionDetails.defaultSceneDuration : 2,
      position: position,
      currentLayerIndex: currentLayerIndex,
    };



    axios.post(`${PROCESSOR_API_URL}/video_sessions/add_layer`, payload, headers).then((dataRes) => {
      const resData = dataRes.data;

      const videoSessionDetails = resData.session;
      const newLayers = videoSessionDetails.layers;
      const newLayer = resData.layer;
      const newLayerIndex = newLayers.findIndex(layer => layer._id === newLayer._id);
      const insertedLayer = newLayers[newLayerIndex] || newLayer;

      activeItemListRef.current = [];
      previousSyncedLayerIdRef.current = insertedLayer?._id?.toString?.() || null;
      syncActiveItemList([], { resetHistory: true });

      const { startFrame: newLayerSeek } = getLayerDisplayFrameRange(insertedLayer);
      setCurrentLayerSeek(newLayerSeek);

      updateCurrentLayerAndLayerList(newLayers, newLayerIndex);
      setIsCanvasDirty(true);
      setCanvasProcessLoading(false);
    }).catch(function () {

      setCanvasProcessLoading(false);
    });
  }



  const copyCurrentLayerBelow = () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const newLayer = { ...currentLayer, _id: undefined };

    const currentIndex = layers.findIndex((layer) => layer._id === currentLayer._id);
    const newLayerIndex = currentIndex + 1;

    const payload = {
      sessionId: id,
      newLayer,
      index: newLayerIndex,
    };

    axios.post(`${PROCESSOR_API_URL}/video_sessions/copy_layer`, payload, headers).then((dataRes) => {
      const resData = dataRes.data;
      const videoSessionDetails = resData.videoSession;
      const newLayers = videoSessionDetails.layers;

      setLayers(newLayers);
      setSelectedLayerIndex(newLayerIndex);
      setCurrentLayer(newLayers[newLayerIndex]);
      setIsCanvasDirty(true);
    });
  };

  const updateSessionLayer = (newLayer, clipPayload) => {
    setIsUpdateLayerPending(true);
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const reqPayload = {
      sessionId: id,
      layer: newLayer,
      clipData: clipPayload
    };

    axios.post(`${PROCESSOR_API_URL}/video_sessions/update_layer`, reqPayload, headers).then((response) => {
      const resData = response.data;
      const { session, layer, audioLayers: updatedAudioLayers } = resData;


      const layers = session.layers;
      const authoritativeAudioLayers = (updatedAudioLayers || session.audioLayers || [])
        .filter((audioLayer) => audioLayer && audioLayer.isEnabled)
        .map((audioLayer) => ({
          isSelected: false,
          isDirty: false,
          ...audioLayer,
        }));

      const newLayerIndex = layers.findIndex(l => l._id.toString() === layer._id.toString());



      setVideoSessionDetails(session);
      setAudioLayers(authoritativeAudioLayers);
      updateCurrentLayerAndLayerList(layers, newLayerIndex);

      setIsUpdateLayerPending(false);

      setIsCanvasDirty(true);
    });
  } // Adjust the delay as needed

  const removeSessionLayer = (layerIndex) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    if (!Array.isArray(layers) || !layers[layerIndex]) {
      return;
    }
    setCanvasProcessLoading(true);

    const layerId = layers[layerIndex]._id.toString();
    const selectedLayerIdBeforeDelete = getSessionLayerId(currentLayerRef.current)
      || getSessionLayerId(layers[selectedLayerIndex]);
    const reqPayload = {
      sessionId: id,
      layerId: layerId
    }
    axios.post(`${PROCESSOR_API_URL}/video_sessions/remove_layer`, reqPayload, headers).then((response) => {
      const videoSessionDataResponse = response.data;
      const videoSessionData = videoSessionDataResponse.videoSession;
      const updatedLayers = Array.isArray(videoSessionData?.layers) ? videoSessionData.layers : [];
      const updatedAudioLayers = Array.isArray(videoSessionData?.audioLayers)
        ? videoSessionData.audioLayers.map((audioLayer) => ({
          isSelected: false,
          isDirty: false,
          ...audioLayer,
        }))
        : [];
      let newLayerIndex = -1;

      if (selectedLayerIdBeforeDelete && selectedLayerIdBeforeDelete !== layerId) {
        newLayerIndex = updatedLayers.findIndex(
          (layer) => getSessionLayerId(layer) === selectedLayerIdBeforeDelete
        );
      }

      if (newLayerIndex < 0 && updatedLayers.length > 0) {
        newLayerIndex = Math.min(layerIndex, updatedLayers.length - 1);
      }

      setVideoSessionDetails({
        ...videoSessionData,
        audioLayers: updatedAudioLayers,
      });
      setLayers(updatedLayers);
      setAudioLayers(updatedAudioLayers);
      setCurrentLayer(newLayerIndex >= 0 ? updatedLayers[newLayerIndex] : null);
      setSelectedLayerIndex(newLayerIndex);
      setIsCanvasDirty(true);
      setCanvasProcessLoading(false);
    }).catch(function () {

      setCanvasProcessLoading(false);
    })
  }

  const publishVideoSession = (payload) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const sessionLanguage =
      typeof payload.sessionLanguage === 'string' && payload.sessionLanguage.trim().length > 0
        ? payload.sessionLanguage.trim()
        : typeof videoSessionDetails?.sessionLanguage === 'string' &&
          videoSessionDetails.sessionLanguage.trim().length > 0
          ? videoSessionDetails.sessionLanguage.trim()
          : typeof videoSessionDetails?.language === 'string' &&
            videoSessionDetails.language.trim().length > 0
            ? videoSessionDetails.language.trim()
            : null;

    const languageString =
      typeof payload.languageString === 'string' && payload.languageString.trim().length > 0
        ? payload.languageString.trim()
        : typeof videoSessionDetails?.languageString === 'string' &&
          videoSessionDetails.languageString.trim().length > 0
          ? videoSessionDetails.languageString.trim()
          : null;

    const publishPayload = {
      ...payload,
      aspectRatio: aspectRatio,
      ispublishedVideo: true,
    };
    const latestVideoUrl = resolveLatestSessionVideoUrl(videoSessionDetails);
    const latestThumbnailUrl = [
      publishPayload.splashImage,
      videoSessionDetails?.splashImage,
      videoSessionDetails?.publishedSplashImage,
    ].find((value) => typeof value === 'string' && value.trim());
    if (sessionLanguage) {
      publishPayload.sessionLanguage = sessionLanguage;
    }
    if (languageString) {
      publishPayload.languageString = languageString;
    }
    if (latestVideoUrl) {
      publishPayload.renderedVideoURL = latestVideoUrl;
    }
    if (latestThumbnailUrl) {
      publishPayload.splashImage = latestThumbnailUrl;
    }

    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/publish_session`, publishPayload, headers)
      .then((response) => {
        const publicationData = response.data;
        const updatedPublication = publicationData?.publication || publicationData || {};
        const updatedSession = publicationData?.session || {};
        setVideoSessionDetails((prevDetails) => {
          if (!prevDetails) {
            return prevDetails;
          }

          return {
            ...prevDetails,
            ...updatedSession,
            ispublishedVideo: true,
            publishedTitle:
              updatedSession.publishedTitle ||
              updatedPublication.title ||
              publishPayload.title ||
              prevDetails.publishedTitle,
            publishedDescription:
              typeof updatedSession.publishedDescription === 'string'
                ? updatedSession.publishedDescription
                : typeof updatedPublication.description === 'string'
                ? updatedPublication.description
                : publishPayload.description,
            publishedAspectRatio:
              updatedSession.publishedAspectRatio || publishPayload.aspectRatio,
            publishedVideoURL:
              updatedSession.publishedVideoURL ||
              publicationData?.videoURL ||
              publicationData?.video_url ||
              publicationData?.publication?.videoURL ||
              publicationData?.publication?.video_url ||
              resolveLatestSessionVideoUrl(prevDetails) ||
              prevDetails.publishedVideoURL ||
              prevDetails.remoteURL,
            publishedAt:
              updatedSession.publishedAt ||
              publicationData?.updatedAt ||
              publicationData?.publication?.updatedAt ||
              prevDetails.publishedAt ||
              new Date().toISOString(),
            publishedPublicationId:
              updatedSession.publishedPublicationId ||
              publicationData?.publicationId ||
              publicationData?.publication_id ||
              publicationData?._id ||
              publicationData?.id ||
              publicationData?.publication?.publication_id ||
              publicationData?.publication?.id ||
              prevDetails.publishedPublicationId ||
              null,
          };
        });
        toast.success('Video published successfully.', {
          position: 'bottom-center',
          autoClose: 3000,
          hideProgressBar: true,
          className: 'custom-toast',
        });
      })
      .catch((error) => {
        toast.error(error?.response?.data?.error || 'Unable to publish video.', {
          position: 'bottom-center',
          autoClose: 5000,
          hideProgressBar: true,
          className: 'custom-toast',
        });
      });
  }

  const restartExpressRenderFromCheckpoint = (checkpoint) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    if (isUpdateLayerPending) {
      toast.error('Please wait for the scene update to finish before restarting the render pipeline.', {
        position: "bottom-center",
        className: "custom-toast",
      });
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    stopVideoRenderPoll();
    setRenderCompletedThisSession(false);

    axios.post(`${PROCESSOR_API_URL}/video_sessions/restart_express_pipeline`, {
      sessionId: id,
      checkpoint,
    }, headers).then((response) => {
      const session = response?.data?.session;
      if (session) {
        setVideoSessionDetails(session);
      }
      setRenderedVideoPath(null);
      setDownloadLink(null);
      setDownloadVideoDisplay(false);
      setIsCanvasDirty(false);
      setIsVideoGenerating(true);
      startVideoRenderPoll();

      toast.success('Express pipeline restarted.', {
        position: "bottom-center",
        className: "custom-toast",
      });
    }).catch((error) => {
      toast.error(error?.response?.data?.error || 'Unable to restart the express pipeline.', {
        position: "bottom-center",
        className: "custom-toast",
      });
    });
  };

  const handleAdvancedVideoEditAccepted = useCallback((requestInfo) => {
    const nextSessionId = requestInfo?.sessionId || requestInfo?.requestId;
    closeAlertDialog();

    if (requestInfo?.status === 'CANCELLED') {
      stopVideoRenderPoll();
      setIsVideoGenerating(false);
      setVideoSessionDetails((prevDetails) => {
        if (!prevDetails) {
          return prevDetails;
        }

        return {
          ...prevDetails,
          videoGenerationPending: false,
          expressGenerationPending: false,
          expressGenerationCancelled: true,
        };
      });
      toast.success('Render cancelled', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
      return;
    }

    if (requestInfo?.operation === 'copy_session') {
      if (nextSessionId && nextSessionId !== id) {
        localStorage.setItem('sessionId', nextSessionId);
        localStorage.setItem('videoSessionId', nextSessionId);
        toast.success('Session copied', {
          position: 'bottom-center',
          className: 'custom-toast',
        });
        navigate(`/video/${nextSessionId}`);
        return;
      }

      toast.success('Session copied', {
        position: 'bottom-center',
        className: 'custom-toast',
      });
      return;
    }

    setRenderCompletedThisSession(false);
    setRenderedVideoPath(null);
    setDownloadLink(null);
    setDownloadVideoDisplay(false);
    setIsCanvasDirty(false);
    setIsVideoGenerating(true);

    if (nextSessionId && nextSessionId !== id) {
      setAdvancedVideoEditPendingSession(nextSessionId);
      localStorage.setItem('sessionId', nextSessionId);
      localStorage.setItem('videoSessionId', nextSessionId);
      navigate(`/video/${nextSessionId}`);
      return;
    }

    startVideoRenderPoll();
  }, [closeAlertDialog, id, navigate]);

  const openAdvancedVideoEditDialog = useCallback(() => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    openAlertDialog(
      <VideoEditAdvancedDialog
        sessionId={id}
        currentSession={videoSessionDetails}
        onClose={closeAlertDialog}
        onRequestAccepted={handleAdvancedVideoEditAccepted}
      />,
      undefined,
      true,
      { hideBorder: true, hideCloseButton: true, centerContent: true }
    );
  }, [closeAlertDialog, handleAdvancedVideoEditAccepted, id, isSharedSessionView, openAlertDialog, requestEditableSharedSession, videoSessionDetails]);

  const unpublishVideoSession = () => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const sessionId = (videoSessionDetails?._id || id) ?? null;
    if (!sessionId) {
      return;
    }

    const confirmation = window.confirm('Are you sure you want to unpublish this video?');
    if (!confirmation) {
      return;
    }

    axios
      .post(
        `${PROCESSOR_API_URL}/video_sessions/unpublish_session`,
        { sessionId },
        headers
      )
      .then(() => {
        setVideoSessionDetails((prevDetails) => {
          if (!prevDetails) {
            return prevDetails;
          }

          return {
            ...prevDetails,
            ispublishedVideo: false,
            publishedTitle: null,
            publishedDescription: null,
            publishedTags: [],
            publishedAspectRatio: null,
            publishedVideoURL: null,
            publishedAt: null,
            publishedOriginalPrompt: null,
            publishedSplashImage: null,
            publishedImageModel: null,
            publishedVideoModel: null,
            publishedPublicationId: null,
          };
        });
      })
      .catch(() => {

      });
  };

  const updateCurrentActiveLayer = (imageItem) => {

    // stripe any query params from the image src
    const src = imageItem.src.split('?')[0];
    const imageItemNew = { ...imageItem, src: src };
    const newActiveItemList = activeItemList.concat(imageItemNew);
    debouncedUpdateSessionLayerActiveItemListRef.current?.(newActiveItemList);
  }

  const addLayersViaPromptList = (payload) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const { promptList, duration } = payload;

    const localPayloadModel = localStorage.getItem("defaultModel");


    let payloadModel = 'DALLE3';
    if (localPayloadModel) {
      payloadModel = localPayloadModel;
    }
    const reqPayload = {
      sessionId: id,
      promptList: promptList,
      duration: duration,
      aspectRatio: aspectRatio,
      model: payloadModel,
    };




    setLayerListRequestAdded(false);
    axios.post(`${PROCESSOR_API_URL}/video_sessions/add_layers_via_prompt_list`, reqPayload, headers).then((response) => {
      const videoSessionDataResponse = response.data;
      const videoSessionData = videoSessionDataResponse.videoSession;
      const previousLength = layers.length; // Calculate the previous length

      setVideoSessionDetails(videoSessionData);
      const updatedLayers = videoSessionData.layers;
      setLayers(updatedLayers);
      setLayerListRequestAdded(true);
      setSelectedLayerIndex(previousLength); // Set selected index to the first item of the new prompt list
      setCurrentLayer(updatedLayers[previousLength]);
      setIsCanvasDirty(true);
    });
  }

  const updateLayerMask = (layerData) => {
    let layerDataNew = Object.assign({}, currentLayer, { segmentation: layerData.segmentation })
    setCurrentLayer(layerDataNew);
  }

  const resetLayerMask = () => {
    Object.assign({}, currentLayer, { segmentation: null });
    // setCurrentLayer(layerDataNew);
  }

  const updateCurrentLayer = (layerData) => {
    const layerId = layerData._id.toString();


    const updatedLayers = layers.map(layer => {
      if (layer._id.toString() === layerId) {
        return layerData;
      }
      return layer;
    });


    setLayers(updatedLayers);
    setCurrentLayer(layerData);

    const { startFrame: newLayerSeek } = getLayerDisplayFrameRange(layerData);
    if (!isLayerSeeking) {
      setCurrentLayerSeek(newLayerSeek);
    }
    // setCurrentLayerSeek(newLayerSeek);

  }

  const updateCurrentLayerInSessionList = (layerData) => {
    setCurrentLayer(layerData);
  }



  const updateCurrentLayerAndLayerList = (layerList, updatedLayerIndex, options = {}) => {
    setLayers(layerList);

    if (options.preserveCurrentLayer) {
      const currentLayerId = currentLayerRef.current?._id?.toString?.();
      const refreshedCurrentLayer = Array.isArray(layerList)
        ? layerList.find((layer) => layer?._id?.toString?.() === currentLayerId)
        : null;

      if (refreshedCurrentLayer) {
        setCurrentLayer(refreshedCurrentLayer);
        const refreshedCurrentLayerIndex = layerList.findIndex(
          (layer) => layer?._id?.toString?.() === currentLayerId
        );
        if (refreshedCurrentLayerIndex >= 0) {
          setSelectedLayerIndex(refreshedCurrentLayerIndex);
        }
      }
      return;
    }

    if (
      Array.isArray(layerList) &&
      typeof updatedLayerIndex === 'number' &&
      updatedLayerIndex >= 0 &&
      updatedLayerIndex < layerList.length
    ) {
      setCurrentLayer(layerList[updatedLayerIndex]);
      setSelectedLayerIndex(updatedLayerIndex);
      setLayerListRequestAdded(true);
    }

    setCurrentLayerToBeUpdated(updatedLayerIndex);
  };

  const setAssistantFrameCapture = useCallback((captureFn) => {
    assistantFrameCaptureRef.current = typeof captureFn === 'function' ? captureFn : null;
  }, []);

  const getAssistantFrameImageData = useCallback(async () => {
    const currentAssistantLayer = currentLayerRef.current;
    if (layerHasGeneratedVideoVisual(currentAssistantLayer)) {
      const fallbackFrameImage = await getAssistantFallbackFrameImageData(currentAssistantLayer, PROCESSOR_API_URL);
      if (fallbackFrameImage?.dataUrl) {
        return fallbackFrameImage;
      }
      return null;
    }

    if (typeof assistantFrameCaptureRef.current !== 'function') {
      return await getAssistantFallbackFrameImageData(currentAssistantLayer, PROCESSOR_API_URL);
    }

    const capturedFrameImage = await assistantFrameCaptureRef.current();
    if (capturedFrameImage?.dataUrl) {
      return capturedFrameImage;
    }

    return await getAssistantFallbackFrameImageData(currentAssistantLayer, PROCESSOR_API_URL);
  }, []);

  const focusHintsPanel = useCallback(() => {
    setFrameToolbarView(FRAME_TOOLBAR_VIEW.EXPANDED);
    setFocusHintsPanelRequest((requestCount) => requestCount + 1);
  }, []);

  if (!videoSessionDetails) {
    return <StudioSkeletonLoader />;
  }



  const startAssistantQueryPoll = () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const timer = setInterval(() => {
      axios.get(`${PROCESSOR_API_URL}/assistants/assistant_query_status?id=${id}`, headers).then((dataRes) => {
        const assistantQueryData = dataRes.data;
        const assistantQueryStatus = assistantQueryData.status;
        if (assistantQueryStatus === 'COMPLETED') {
          const sessionData = assistantQueryData.sessionDetails;
          clearInterval(timer);

          setSessionMessages(sessionData.sessionMessages);
          setIsAssistantQueryGenerating(false);
        }
      });
    }, 1000);

  }

  const submitAssistantQuery = (query, options = {}) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    setIsAssistantQueryGenerating(true);
    axios.post(`${PROCESSOR_API_URL}/assistants/submit_assistant_query`, {
      id: id,
      query: query,
      frameImage: options?.frameImage || null,
    }, headers).then((response) => {
      const assistantResponse = response.data;
      if (assistantResponse?.status === 'COMPLETED' && assistantResponse?.sessionDetails) {
        setSessionMessages(assistantResponse.sessionDetails.sessionMessages || []);
        setIsAssistantQueryGenerating(false);
        return;
      }
      startAssistantQueryPoll();
    }).catch(function () {
      setIsAssistantQueryGenerating(false);
    });
  }

  const applyAnimationToAllLayers = (animationData, animationType) => {
    const updatedLayers = layers.map(layer => {
      if (layer.imageSession && layer.imageSession.activeItemList) {
        const updatedActiveItemList = layer.imageSession.activeItemList.map(item => {
          if (item.type === 'image') {
            let animations = item.animations || [];
            const existingAnimationIndex = animations.findIndex(animation => animation.type === animationType);
            if (existingAnimationIndex !== -1) {
              animations[existingAnimationIndex] = {
                type: animationType,
                params: animationData
              };
            } else {
              animations.push({
                type: animationType,
                params: animationData
              });
            }
            return {
              ...item,
              animations: animations
            };
          }
          return item;
        });
        return {
          ...layer,
          imageSession: {
            ...layer.imageSession,
            activeItemList: updatedActiveItemList
          }
        };
      }
      return layer;
    });

    setLayers(updatedLayers);
    updateSessionLayersOnServer(updatedLayers);
  };

  const updateSessionLayersOnServer = (updatedLayers) => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }


    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const reqPayload = {
      sessionId: id,
      layers: updatedLayers
    };

    axios.post(`${PROCESSOR_API_URL}/video_sessions/update_layers`, reqPayload, headers).then((response) => {
      const videoSessionData = response.data;
      setLayers(videoSessionData.layers);
      setIsCanvasDirty(true);
    });
  };

  const removeAllSubtitles = () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const subtitleSessionUpdates = {
      enableSubtitles: false,
      hasSubtitles: false,
      has_subtitles: false,
      transcriptGenerationPending: false,
      frameGenerationPending: true,
    };
    const currentLayerId = getSessionLayerId(currentLayer);
    const updatedLayers = layers.map((layer) => {
      const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
        ? layer.imageSession.activeItemList
        : null;
      const updatedLayer = {
        ...layer,
        frameGenerationPending: true,
      };

      if (activeItemList) {
        updatedLayer.imageSession = {
          ...layer.imageSession,
          activeItemList: activeItemList.filter((item) => !isSubtitleTranscriptItem(item)),
        };
      }

      return updatedLayer;
    });
    const updatedAudioLayers = Array.isArray(audioLayers)
      ? audioLayers.map((audioLayer) => (
        String(audioLayer?.generationType || '').toLowerCase() === 'speech'
          ? { ...audioLayer, addSubtitles: false }
          : audioLayer
      ))
      : audioLayers;

    const selectedUpdatedLayer = updatedLayers.find(
      (layer) => getSessionLayerId(layer) === currentLayerId
    ) || updatedLayers[selectedLayerIndex];
    const selectedUpdatedActiveItemList = selectedUpdatedLayer?.imageSession?.activeItemList || [];

    setLayers(updatedLayers);
    setAudioLayers(updatedAudioLayers);
    setVideoSessionDetails((prevDetails) => (
      prevDetails
        ? {
          ...prevDetails,
          ...subtitleSessionUpdates,
          layers: updatedLayers,
          audioLayers: updatedAudioLayers,
        }
        : prevDetails
    ));
    if (selectedUpdatedLayer) {
      setCurrentLayer(selectedUpdatedLayer);
      activeItemListRef.current = selectedUpdatedActiveItemList;
      syncActiveItemList(selectedUpdatedActiveItemList);
    }
    setIsLayerGenerationPending(false);
    setIsCanvasDirty(true);

    const reqPayload = {
      sessionId: id,
      layers: updatedLayers,
      audioLayers: updatedAudioLayers,
      sessionUpdates: subtitleSessionUpdates,
    };

    axios.post(`${PROCESSOR_API_URL}/video_sessions/update_layers`, reqPayload, headers).then((response) => {
      const videoSessionData = response.data;
      const responseLayers = Array.isArray(videoSessionData?.layers)
        ? videoSessionData.layers
        : updatedLayers;
      const responseAudioLayers = Array.isArray(videoSessionData?.audioLayers)
        ? videoSessionData.audioLayers
        : updatedAudioLayers;
      const responseCurrentLayer = responseLayers.find(
        (layer) => getSessionLayerId(layer) === currentLayerId
      ) || responseLayers[selectedLayerIndex];

      setVideoSessionDetails((prevDetails) => ({
        ...(prevDetails || {}),
        ...(videoSessionData || {}),
        ...subtitleSessionUpdates,
        layers: responseLayers,
        audioLayers: responseAudioLayers,
      }));
      setLayers(responseLayers);
      setAudioLayers(responseAudioLayers);
      if (responseCurrentLayer) {
        setCurrentLayer(responseCurrentLayer);
        syncActiveItemList(responseCurrentLayer.imageSession?.activeItemList || []);
      }
      setIsLayerGenerationPending(false);
      setIsCanvasDirty(true);
      toast.success(
        <div>
          <FaCheck className='inline-flex mr-2' /> Removed all subtitles. Frames will regenerate on next render.
        </div>,
        {
          position: "bottom-center",
          className: "custom-toast",
        }
      );
    }).catch((error) => {
      toast.error(error?.response?.data?.error || 'Failed to remove subtitles');
    });
  };

  const submitRegenerateFrames = () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    axios.post(`${PROCESSOR_API_URL}/video_sessions/regenerate_frames`, { sessionId: id }, headers).then((response) => {
      const videoSessionData = response.data;
      if (videoSessionData?.layers) {
        setLayers(videoSessionData.layers);
        setVideoSessionDetails(videoSessionData);
      }
      toast.success(t("studio.notifications.framesRegenerationRequested"));
      setIsCanvasDirty(true);
      setIsVideoGenerating(false);
      stopLayerPolling();
      setIsLayerGenerationPending(false);
    }).catch((error) => {
      toast.error(error?.response?.data?.error || 'Failed to request frame regeneration');
    });
  }

  const applyAudioTrackVisualizerToProject = () => {
    toast.success(<div><FaCheck className='inline-flex mr-2' />  {t("studio.notifications.audioVisualizerRequested")}</div>, {
      position: "bottom-center",
      className: "custom-toast",
    });

    const headers = getHeaders();
    axios.post(`${PROCESSOR_API_URL}/video_sessions/apply_audio_track_visualizer`, { id: id }, headers).then(() => {

      setIsCanvasDirty(true);

    });

  }



  const regenerateVideoSessionSubtitles = () => {
    if (isSharedSessionView && !requestEditableSharedSession()) {
      return;
    }

    const headers = getHeaders();
    setCanvasProcessLoading(true);

    axios.post(`${PROCESSOR_API_URL}/video_sessions/request_regenerate_subtitles`, { sessionId: id, realignAudio: true }, headers).then((response) => {
      const videoSessionData = response.data;
      const responseLayers = Array.isArray(videoSessionData?.layers) ? videoSessionData.layers : null;
      const responseAudioLayers = Array.isArray(videoSessionData?.audioLayers) ? videoSessionData.audioLayers : null;
      const currentLayerId = getSessionLayerId(currentLayerRef.current);
      setVideoSessionDetails(videoSessionData);
      if (responseLayers) {
        setLayers(responseLayers);
        const responseCurrentLayer = responseLayers.find(
          (layer) => getSessionLayerId(layer) === currentLayerId
        ) || responseLayers[selectedLayerIndex];
        if (responseCurrentLayer) {
          setCurrentLayer(responseCurrentLayer);
          syncActiveItemList(responseCurrentLayer.imageSession?.activeItemList || []);
        }
      }
      if (responseAudioLayers) {
        setAudioLayers(responseAudioLayers);
      }
      setIsCanvasDirty(true);
      setCanvasProcessLoading(false);
    });
  }

  const requestRealignLayers = () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    setCanvasProcessLoading(true);
    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/request_realign_layers`, { sessionId: id }, headers)
      .then((response) => {
        if (response?.data?.session) {
          setVideoSessionDetails(response.data.session);
        }
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.realignLayersToAiVideoRequested")}
          </div>,
          {
            position: "bottom-center",
            className: "custom-toast",
          }
        );
        setIsCanvasDirty(true);
      })
      .catch(() => {
      })
      .finally(() => {
        setCanvasProcessLoading(false);
      });
  }

  const isVideoRenderPending = Boolean(
    isVideoGenerating ||
    isSessionRenderPending(videoSessionDetails)
  );
  const collapsedFrameToolbarWidth = 'min(10vw, 128px)';
  const collapsedRightPanelWidth = 'clamp(148px, 11vw, 168px)';
  const studioInsetPx = 16;
  const studioTopInsetPx = 56;
  const reservedLeftRailWidth = `calc(${collapsedFrameToolbarWidth} + ${studioInsetPx * 2}px)`;
  const reservedRightRailWidth = `calc(${collapsedRightPanelWidth} + ${studioInsetPx}px)`;
  const editorContainerDisplay = (
    <div className='h-full min-h-0'>
      <VideoEditorContainer
        selectedLayerIndex={selectedLayerIndex}
        layers={layers}
        currentLayerSeek={currentLayerSeek}
        currentEditorView={currentEditorView}
        setCurrentEditorView={setCurrentEditorView}
        toggleFrameDisplayType={toggleFrameDisplayType}
        setFrameEditDisplay={setFrameEditDisplay}
        currentLayer={currentLayer}
        setCurrentLayerSeek={setCurrentLayerSeek}
        updateSessionLayerActiveItemList={updateSessionLayerActiveItemList}
        updateSessionLayerActiveItemListAnimations={updateSessionLayerActiveItemListAnimations}
        activeItemList={activeItemList}
        setActiveItemList={setActiveItemList}
        isLayerSeeking={isLayerSeeking}
        showAddAudioToProjectDialog={showAddAudioToProjectDialog}
        generationImages={generationImages}
        setGenerationImages={setGenerationImages}
        updateCurrentActiveLayer={updateCurrentActiveLayer}
        videoSessionDetails={videoSessionDetails}
        setVideoSessionDetails={setVideoSessionDetails}
        toggleHideItemInLayer={toggleHideItemInLayer}
        updateLayerMask={updateLayerMask}
        resetLayerMask={resetLayerMask}
        pollForLayersUpdate={pollForLayersUpdate}
        setIsCanvasDirty={setIsCanvasDirty}
        updateCurrentLayer={updateCurrentLayer}
        applyAnimationToAllLayers={applyAnimationToAllLayers}
        isExpressGeneration={videoSessionDetails.isExpressGeneration}
        aspectRatio={videoSessionDetails.aspectRatio}
        displayZoomType={displayZoomType}
        toggleStageZoom={toggleStageZoom}
        stageZoomScale={stageZoomScale}
        zoomCanvasIn={zoomCanvasIn}
        zoomCanvasOut={zoomCanvasOut}
        resetCanvasZoom={resetCanvasZoom}
        canvasZoomPercent={canvasZoomPercent}
        canZoomInCanvas={canZoomInCanvas}
        canZoomOutCanvas={canZoomOutCanvas}
        updateCurrentLayerInSessionList={updateCurrentLayerInSessionList}
        updateCurrentLayerAndLayerList={updateCurrentLayerAndLayerList}
        totalDuration={totalDuration}
        isUpdateLayerPending={isUpdateLayerPending}
        isVideoPreviewPlaying={isVideoPreviewPlaying}
        isPreviewPlaybackActive={isPreviewPlaybackActive}
        applyAudioDucking={applyAudioDucking}
        audioLayers={audioLayers}
        setIsVideoPreviewPlaying={setIsVideoPreviewPlaying}
        onRecordSpeechRecordingChange={setIsRecordSpeechRecording}
        setAudioLayers={setAudioLayers}
        isRenderPending={isVideoRenderPending}

        setIsLayerSeeking={setIsLayerSeeking}

        setSelectedLayerIndex={setSelectedLayerIndex}
        setSelectedLayer={setSelectedLayer}
        onAssistantFrameCaptureChange={setAssistantFrameCapture}
        onSetAvatarHints={focusHintsPanel}
        isReadOnlyShareView={isReadOnlyShareView}
        onRequestEditableSession={requestEditableSharedSession}





      />




    </div>
  );

  const showEditableLoginPrompt = isEditableShareView && !getHeaders();
  const sharedViewPromptLabel = isReadOnlyShareView ? 'View only' : 'Editable link';
  const sharedViewPromptAction = isReadOnlyShareView ? 'Edit a copy' : 'Log in to edit';
  const sharedViewPromptClassName = colorMode === 'dark'
    ? 'border-[#263650] bg-[#0a1526]/95 text-slate-100 shadow-[0_12px_30px_rgba(0,0,0,0.34)]'
    : 'border-slate-200 bg-white/95 text-slate-800 shadow-[0_12px_30px_rgba(15,23,42,0.14)]';
  const sharedViewPromptButtonClassName = colorMode === 'dark'
    ? 'bg-cyan-400/14 text-cyan-100 ring-1 ring-cyan-300/25 hover:bg-cyan-400/20'
    : 'bg-slate-900 text-white hover:bg-slate-800';

  return (
    <CommonContainer
      isVideoPreviewPlaying={isVideoPreviewPlaying}
      setIsVideoPreviewPlaying={setIsVideoPreviewPlaying}
      isRenderPending={isVideoRenderPending}
      submitRenderVideo={submitRenderVideo}
      cancelPendingRender={cancelPendingRender}
      renderedVideoPath={renderedVideoPath}
      downloadLink={downloadLink}
      isVideoGenerating={isVideoGenerating}
      isUpdateLayerPending={isUpdateLayerPending}
      isCanvasDirty={isCanvasDirty}
      isSessionPublished={Boolean(videoSessionDetails?.ispublishedVideo)}
      publishedTitle={videoSessionDetails?.publishedTitle}
      publishedDescription={videoSessionDetails?.publishedDescription}
      publishVideoSession={publishVideoSession}
      unpublishVideoSession={unpublishVideoSession}
      renderCompletedThisSession={renderCompletedThisSession}
      sessionId={id}
      openAdvancedVideoEditDialog={openAdvancedVideoEditDialog}
      isReadOnlyShareView={isReadOnlyShareView}
      isEditableShareView={isEditableShareView}
      isImportedSession={Boolean(videoSessionDetails?.isImportedSession)}
      onRequestEditSession={requestEditableSharedSession}
      openAuthDialog={showLoginDialog}
    >
      <PreviewPlaybackController
        applyAudioDucking={applyAudioDucking}
        audioLayers={previewAudioLayers}
        currentLayerSeek={currentLayerSeek}
        framesPerSecond={videoSessionDetails?.framesPerSecond ?? 24}
        isVideoPreviewPlaying={isVideoPreviewPlaying}
        onPlaybackActiveChange={setIsPreviewPlaybackActive}
        setCurrentLayerSeek={setCurrentLayerSeek}
        setIsVideoPreviewPlaying={setIsVideoPreviewPlaying}
        suspendAudioPreview={isRecordSpeechRecording}
        totalDuration={totalDuration}
      />
      <div
        className='relative box-border h-[100dvh] overflow-hidden px-4 pb-4'
        style={{ paddingTop: `${studioTopInsetPx}px` }}
      >
        <div className='grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden'>
          <div className='flex min-h-0 gap-4 overflow-hidden'>
            <div className='shrink-0' style={{ width: reservedLeftRailWidth }}>
              <FrameToolbar
                layers={layers}
                setSelectedLayerIndex={setSelectedLayerIndex}
                currentLayer={currentLayer}
                setCurrentLayer={setCurrentLayer}
                setLayerDuration={setLayerDuration}
                selectedLayerIndex={selectedLayerIndex}
                setCurrentLayerSeek={setNewSeek}
                currentLayerSeek={currentLayerSeek}
                submitRenderVideo={submitRenderVideo}
                totalDuration={totalDuration}
                showAddAudioToProjectDialog={showAddAudioToProjectDialog}
                audioFileTrack={audioFileTrack}
                setSelectedLayer={setSelectedLayer}
                startPlayFrames={startPlayFrames}
                renderedVideoPath={renderedVideoPath}
                downloadVideoDisplay={downloadVideoDisplay}
                sessionId={id}
                sessionDetails={videoSessionDetails}
                updateSessionLayerActiveItemList={updateSessionLayerActiveItemList}
                updateSessionLayer={updateSessionLayer}
                setIsLayerSeeking={setIsLayerSeeking}
                isLayerSeeking={isLayerSeeking}
                isVideoGenerating={isVideoGenerating}
                showAudioTrackView={showAudioTrackView}
                frameToolbarView={frameToolbarView}
                audioLayers={audioLayers}
                globalAudioLayers={videoSessionDetails?.global_audio_layers || videoSessionDetails?.globalAudioLayers || []}
                globalVideos={videoSessionDetails?.global_videos || videoSessionDetails?.globalVideos || []}
                updateAudioLayer={updateAudioLayer}
                isAudioLayerDirty={isAudioLayerDirty}
                removeAudioLayer={removeAudioLayer}
                updateChangesToActiveAudioLayers={updateChangesToActiveAudioLayers}
                updateChangesToActiveSessionLayers={updateChangesToActiveSessionLayers}
                updateLayerVisualItem={updateLayerVisualItem}
                deleteLayerVisualItem={deleteLayerVisualItem}
                addLayerToComposition={addLayerToComposition}
                copyCurrentLayerBelow={copyCurrentLayerBelow}
                removeSessionLayer={removeSessionLayer}
                addLayersViaPromptList={addLayersViaPromptList}
                defaultSceneDuration={videoSessionDetails.defaultSceneDuration}
                isCanvasDirty={isCanvasDirty}
                downloadLink={downloadLink}
                submitRegenerateFrames={submitRegenerateFrames}
                applySynchronizeAnimationsToBeats={applySynchronizeAnimationsToBeats}
                applyAudioDucking={applyAudioDucking}
                regenerateFramesBeforeRender={regenerateFramesBeforeRender}
                sceneTransitionPreset={sceneTransitionPreset}
                onSceneTransitionPresetChange={handleSceneTransitionPresetChange}
                onApplyAudioDuckingChange={handleApplyAudioDuckingChange}
                onRegenerateFramesBeforeRenderChange={handleRegenerateFramesBeforeRenderChange}
                applySynchronizeLayersToBeats={applySynchronizeLayersToBeats}
                applySynchronizeLayersAndAnimationsToBeats={applySynchronizeLayersAndAnimationsToBeats}
                applyAudioTrackVisualizerToProject={applyAudioTrackVisualizerToProject}
                onLayersOrderChange={updateSessionLayersOrder}
                updateSessionLayersOnServer={updateSessionLayersOnServer}
                regenerateVideoSessionSubtitles={regenerateVideoSessionSubtitles}
                sessionSubtitlesEnabled={resolveSessionSubtitlesEnabled(videoSessionDetails)}
                removeAllSubtitles={removeAllSubtitles}
                duplicateAudioLayer={duplicateAudioLayer}
                publishVideoSession={publishVideoSession}
                unpublishVideoSession={unpublishVideoSession}
                isSessionPublished={Boolean(videoSessionDetails?.ispublishedVideo)}
                generateMeta={generateMeta}
                sessionMetadata={sessionMetadata}
                isGuestSession={isGuestSession}
                updateAllAudioLayersOneShot={updateAllAudioLayersOneShot}
                updateGlobalAudioLayers={updateGlobalAudioLayersOneShot}
                updateGlobalVideos={updateGlobalVideosOneShot}
                updateSessionHints={updateSessionHints}
                focusHintsPanelRequest={focusHintsPanelRequest}
                requestVideoLayerEdit={requestVideoLayerEdit}
                onRequireEditableAction={requireEditableStudioAction}
                renderCompletedThisSession={renderCompletedThisSession}
                isRenderPending={isVideoRenderPending}
                isUpdateLayerPending={isUpdateLayerPending}
                isVideoPreviewPlaying={isVideoPreviewPlaying}
                requestRealignLayers={requestRealignLayers}
                restartExpressRenderFromCheckpoint={restartExpressRenderFromCheckpoint}
                cancelPendingRender={cancelPendingRender}
                isExpressSession={Boolean(videoSessionDetails?.isExpressGeneration)}
                framesPerSecond={videoSessionDetails?.framesPerSecond ?? 24}
              />
            </div>
            <div
              className='flex min-h-0 min-w-0 flex-1'
              style={{ paddingRight: reservedRightRailWidth }}
            >
              <div className='relative min-h-0 flex-1 overflow-hidden'>
                {canvasProcessLoading && (
                  <div className="absolute z-10 top-0 left-0 w-full h-full flex items-center justify-center bg-opacity-50">
                    <ScreenLoader />
                  </div>
                )}
                {editorContainerDisplay}
              </div>
            </div>
            <AssistantHome
              submitAssistantQuery={submitAssistantQuery}
              sessionId={id}
              sessionMessages={sessionMessages}
              onSessionMessagesChange={setSessionMessages}
              onSessionDetailsChange={setVideoSessionDetails}
              onAssistantQueryGeneratingChange={setIsAssistantQueryGenerating}
              isAssistantQueryGenerating={isAssistantQueryGenerating}
              getFrameImageData={getAssistantFrameImageData}
              currentLayerId={currentLayer?._id?.toString?.()}
              onSceneActionApplied={handleSceneActionApplied}
              canUndoCanvasHistory={canUndoActiveItemList}
              canRedoCanvasHistory={canRedoActiveItemList}
              onUndoCanvasHistory={handleUndoCanvasHistory}
              onRedoCanvasHistory={handleRedoCanvasHistory}
            />
          </div>
          <div className='flex items-end gap-4'>
            <div className='shrink-0' style={{ width: reservedLeftRailWidth }} />
            <div className='min-w-0 flex-1 box-border overflow-hidden' style={{ paddingRight: reservedRightRailWidth }}>
              <div className='relative min-w-0 overflow-hidden'>
                <FrameToolbarHorizontal
                  key={`layers-${layers.length}`}
                  layers={layers}
                  selectedLayerIndex={selectedLayerIndex}
                  setSelectedLayerIndex={setSelectedLayerIndex}
                  setSelectedLayer={setSelectedLayer}
                  totalDuration={totalDuration}
                  currentLayerSeek={currentLayerSeek}
                  setCurrentLayerSeek={setNewSeek}
                  onLayersOrderChange={updateSessionLayersOrder}
                  submitRenderVideo={submitRenderVideo}
                  isVideoGenerating={isVideoGenerating}
                  downloadLink={downloadLink}
                  isGuestSession={isGuestSession}
                  setIsLayerSeeking={setIsLayerSeeking}
                  isRenderPending={isVideoRenderPending}
                />
              </div>
            </div>
          </div>
        </div>
        <ToastContainer
          position="bottom-center"
          autoClose={5000}
          hideProgressBar={true}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          className="custom-toast-container"
          toastClassName="custom-toast"
          bodyClassName="custom-toast-body"
        />

        {(isReadOnlyShareView || showEditableLoginPrompt) && (
          <div
            className={`pointer-events-none absolute top-[72px] z-[90] flex items-center gap-3 rounded-xl border px-4 py-2 text-sm font-semibold backdrop-blur ${sharedViewPromptClassName}`}
            style={{ left: `calc(${reservedLeftRailWidth} + 16px)` }}
          >
            <span>{sharedViewPromptLabel}</span>
            <button
              type="button"
              className={`pointer-events-auto rounded-lg px-3 py-1.5 text-xs font-semibold transition ${sharedViewPromptButtonClassName}`}
              onClick={(event) => {
                event.stopPropagation();
                requestEditableSharedSession();
              }}
            >
              {sharedViewPromptAction}
            </button>
          </div>
        )}

      </div>
    </CommonContainer>
  );
}
