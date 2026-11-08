import { useEffect, useRef, useState } from 'react';
import { FaCheck, FaImage, FaPause, FaPlay } from 'react-icons/fa';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { resolvePrivateMediaUrl } from '../../utils/privateMediaUrl.mjs';
const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
const CDN_URI = import.meta.env.VITE_STATIC_CDN_URL;
const STATIC_ASSET_BASE_URL = (
  CDN_URI ||
  'https://static.samsar.one'
).replace(/\/+$/, '');
const USER_RESOURCES_PREFIX = 'user_resources/';
const DIRECT_PROCESSOR_ASSET_PREFIXES = [
  'assets_v2/',
  'assets/',
  'generations/',
  'intermediates/',
  'temp_images/',
  'video/',
  'ai_video/',
];

function normalizeRerollLayerIndexes(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const indexes = source
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1);
  return [...new Set(indexes)].sort((a, b) => a - b);
}

function normalizeRerollLayerType(layer) {
  const value = layer?.layerBaseAiImageType || layer?.layerAiVideoType;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function looksLikeStudioVideoRoute(value) {
  return typeof value === 'string' && /^\/?video\/[a-f0-9]{24}$/i.test(value.trim());
}

function isDirectProcessorAssetPath(value) {
  return DIRECT_PROCESSOR_ASSET_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isRemoteUserResourcePath(value) {
  return value.startsWith('assets_v2/user_resources/') ||
    value.startsWith(USER_RESOURCES_PREFIX);
}

function buildProcessorAssetUrl(relativePath) {
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '');
  return PROCESSOR_API_URL ? `${PROCESSOR_API_URL}/${normalizedPath}` : `/${normalizedPath}`;
}

function hasExpiredCloudFrontSignature(url) {
  const expires = Number(url.searchParams.get('Expires'));
  return Number.isFinite(expires) && expires > 0 && expires * 1000 <= Date.now() + 60_000;
}

function getProcessorAssetFallbackUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  const privateMediaUrl = resolvePrivateMediaUrl(trimmed, {
    processorApiUrl: PROCESSOR_API_URL,
    staticCdnUrl: STATIC_ASSET_BASE_URL,
  });
  if (privateMediaUrl) return privateMediaUrl;

  const relativePath = trimmed.replace(/^\/+/, '');
  if (isDirectProcessorAssetPath(relativePath) && !isRemoteUserResourcePath(relativePath)) {
    return buildProcessorAssetUrl(relativePath);
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return '';
  }

  try {
    const parsedUrl = new URL(trimmed);
    const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
    return isDirectProcessorAssetPath(pathname) && !isRemoteUserResourcePath(pathname)
      ? buildProcessorAssetUrl(`${pathname}${parsedUrl.search}${parsedUrl.hash}`)
      : '';
  } catch {
    return '';
  }
}

function normalizeRerollAssetUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (looksLikeStudioVideoRoute(trimmed)) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  const privateMediaUrl = resolvePrivateMediaUrl(trimmed, {
    processorApiUrl: PROCESSOR_API_URL,
    staticCdnUrl: STATIC_ASSET_BASE_URL,
  });
  if (privateMediaUrl) return privateMediaUrl;

  const relativePath = trimmed.replace(/^\/+/, '');
  if (isRemoteUserResourcePath(relativePath)) {
    return `${STATIC_ASSET_BASE_URL}/${relativePath}`;
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    try {
      const parsedUrl = new URL(trimmed);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (isRemoteUserResourcePath(pathname)) {
        return `${STATIC_ASSET_BASE_URL}/${pathname}${parsedUrl.search || ''}`;
      }
      if (
        isDirectProcessorAssetPath(pathname) &&
        !isRemoteUserResourcePath(pathname) &&
        hasExpiredCloudFrontSignature(parsedUrl)
      ) {
        return buildProcessorAssetUrl(pathname);
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (isDirectProcessorAssetPath(relativePath)) {
    return buildProcessorAssetUrl(relativePath);
  }
  return `${PROCESSOR_API_URL}/${relativePath}`;
}

function getRerollAssetUrlPair(values = []) {
  for (const value of values) {
    const url = normalizeRerollAssetUrl(value);
    if (!url) continue;
    const fallbackUrl = getProcessorAssetFallbackUrl(value) || getProcessorAssetFallbackUrl(url);
    return {
      url,
      fallbackUrl: fallbackUrl && fallbackUrl !== url ? fallbackUrl : '',
    };
  }
  return { url: '', fallbackUrl: '' };
}

function isRerollCandidateLayer(layer) {
  const layerType = normalizeRerollLayerType(layer);
  return Boolean(
    layer &&
    layer.skipAiVideoGeneration !== true &&
    layerType !== 'none' &&
    layerType !== 'outro'
  );
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
    item.enhanced_url ||
    item.enhancedUrl ||
    item.assetPath ||
    item.path ||
    (typeof item.image === 'string' && item.image.includes('/') ? item.image : '')
  );
}

function getLayerVisualUrl(layer) {
  const detailedItemUrl = Array.isArray(layer?.image?.items)
    ? layer.image.items.find((item) => item?.isPrimary)?.url || layer.image.items[0]?.url
    : '';
  const rawActiveItems = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const rawBaseItem = rawActiveItems.find((item) => item?.is_base_image === true) ||
    rawActiveItems.find((item) => item?.type === 'image') ||
    rawActiveItems[0] ||
    null;
  const frameImages = layer?.frameImages || {};
  const candidates = [
    frameImages.startFrameUrl,
    frameImages.startFrame,
    frameImages.aiLayerStartFrame,
    frameImages.baseLayerStartFrame,
    frameImages.aiVideoThumbnailPath,
    frameImages.thumbnailPath,
    layer?.aiLayerStartFrame,
    layer?.baseLayerStartFrame,
    layer?.aiVideoThumbnailPath,
    layer?.thumbnailPath,
    layer?.preview?.type !== 'video' ? layer?.preview?.url : '',
    layer?.image?.url,
    detailedItemUrl,
    getRawItemAssetUrl(rawBaseItem),
    layer?.imageSession?.activeImageRemoteLink,
    layer?.imageSession?.activeGeneratedImage,
    layer?.imageSession?.activeEditedImage,
    layer?.imageSession?.activeSelectedImage,
    layer?.thumbnailPath,
    layer?.aiVideoThumbnailPath,
  ];
  return getRerollAssetUrlPair(candidates);
}

function getLayerPreviewVideoUrlPair(layer) {
  const candidates = [
    layer?.lipSyncVideo?.url,
    layer?.soundEffectVideo?.url,
    layer?.userVideo?.url,
    layer?.aiVideo?.url,
    layer?.preview?.type === 'video' ? layer?.preview?.url : '',
    layer?.lipSyncRemoteLink,
    layer?.soundEffectRemoteLink,
    layer?.userVideoRemoteLink,
    layer?.aiVideoRemoteLink,
    layer?.lipSyncVideoLayer,
    layer?.soundEffectVideoLayer,
    layer?.userVideoLayer,
    layer?.aiVideoLayer,
  ];
  return getRerollAssetUrlPair(candidates);
}

function getRerollPromptPreview(layer) {
  const prompt =
    layer?.originalImagePrompt ||
    layer?.sourcePrompt ||
    layer?.originalPrompt ||
    layer?.imageSession?.originalImagePrompt ||
    layer?.imageSession?.sourcePrompt ||
    layer?.imageSession?.originalPrompt ||
    layer?.image?.prompt ||
    layer?.imageSession?.prompt ||
    layer?.prompt ||
    '';
  return typeof prompt === 'string' ? prompt.trim().slice(0, 80) : '';
}

function getRerollCandidateLayers(session) {
  const layers = Array.isArray(session?.layers) ? session.layers : [];
  return layers
    .map((layer, index) => {
      const visualUrlPair = getLayerVisualUrl(layer);
      const videoUrlPair = getLayerPreviewVideoUrlPair(layer);
      return {
        layer,
        layerIndex: index + 1,
        layerId: layer?._id || layer?.id || `${index + 1}`,
        duration: Number(layer?.duration) || 0,
        promptPreview: getRerollPromptPreview(layer),
        visualUrl: visualUrlPair.url,
        visualFallbackUrl: visualUrlPair.fallbackUrl,
        videoUrl: videoUrlPair.url,
        videoFallbackUrl: videoUrlPair.fallbackUrl,
      };
    })
    .filter((item) => isRerollCandidateLayer(item.layer));
}

function getRerollLocalCreditEstimate({
  layerIndexes,
  candidateLayers,
  imageModel,
  videoModel,
  aspectRatio,
}) {
  const selectedIndexes = normalizeRerollLayerIndexes(layerIndexes);
  if (!selectedIndexes.length) {
    return null;
  }

  const selectedIndexSet = new Set(selectedIndexes);
  const selectedLayers = candidateLayers.filter((item) => selectedIndexSet.has(item.layerIndex));
  if (!selectedLayers.length) {
    return null;
  }

  const imageCreditsPerLayer = 0; // Image-model calls settle separately on completion.
  const videoStageCreditsPerSecond =
    0; // Model calls settle individually when completed.
  const durationSeconds = selectedLayers.reduce((total, item) => total + (Number(item.duration) || 0), 0);
  const imageCredits = Math.ceil(imageCreditsPerLayer * selectedLayers.length);
  const aiVideoCredits = Math.ceil(Math.max(0, durationSeconds * videoStageCreditsPerSecond));

  return {
    totalCredits: imageCredits + aiVideoCredits,
    imageCredits,
    aiVideoCredits,
    imageBilling: 'ON_COMPLETION',
  };
}

function RerollScenePreviewTile({
  item,
  isSelected,
  isPlaying,
  isDisabled,
  colorMode,
  mutedText,
  activeActionClass,
  inactiveActionClass,
  onToggleSelect,
  onTogglePlayback,
}) {
  useUiLanguage();
  const videoRef = useRef(null);
  const [currentVideoUrl, setCurrentVideoUrl] = useState(item.videoUrl || '');
  const [currentVisualUrl, setCurrentVisualUrl] = useState(item.visualUrl || '');
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);

  useEffect(() => {
    setCurrentVideoUrl(item.videoUrl || '');
    setCurrentVisualUrl(item.visualUrl || '');
    setVideoLoadFailed(false);
  }, [item.videoFallbackUrl, item.videoUrl, item.visualFallbackUrl, item.visualUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying && currentVideoUrl && !videoLoadFailed) {
      const playPromise = video.play();
      if (playPromise?.catch) playPromise.catch(() => undefined);
    } else {
      video.pause();
    }
  }, [currentVideoUrl, isPlaying, videoLoadFailed]);

  const handleVideoError = () => {
    if (item.videoFallbackUrl && currentVideoUrl !== item.videoFallbackUrl) {
      setCurrentVideoUrl(item.videoFallbackUrl);
      setVideoLoadFailed(false);
      return;
    }
    setVideoLoadFailed(true);
    if (isPlaying) {
      onTogglePlayback(null);
    }
  };

  const handleImageError = () => {
    if (item.visualFallbackUrl && currentVisualUrl !== item.visualFallbackUrl) {
      setCurrentVisualUrl(item.visualFallbackUrl);
      return;
    }
    setCurrentVisualUrl('');
  };

  const handleVideoLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video || isPlaying || !Number.isFinite(video.duration) || video.duration <= 0) return;

    // Fetch a real frame without eagerly downloading every scene video in full.
    video.currentTime = Math.min(0.1, video.duration / 2);
  };

  const handlePlaybackClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isDisabled || !currentVideoUrl || videoLoadFailed) return;

    const video = videoRef.current;
    if (isPlaying) {
      video?.pause();
      onTogglePlayback(null);
      return;
    }

    onTogglePlayback(item.layerId);
  };

  const handleSelect = () => {
    if (!isDisabled) {
      onToggleSelect(item.layerIndex);
    }
  };

  const handleSelectKeyDown = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect();
    }
  };

  const canAttemptPlayback = Boolean(currentVideoUrl) && !videoLoadFailed;

  return (
    <div
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      onClick={handleSelect}
      onKeyDown={handleSelectKeyDown}
      aria-pressed={isSelected}
      aria-disabled={isDisabled}
      className={`
        min-h-[146px] rounded-lg p-1.5 text-left text-xs ring-1 transition
        ${isSelected ? activeActionClass : inactiveActionClass}
        ${isDisabled ? 'cursor-not-allowed opacity-50' : 'active:scale-[0.99]'}
      `}
    >
      <div className={`relative aspect-video w-full overflow-hidden rounded-md ${
        colorMode === 'dark' ? 'bg-slate-900' : 'bg-slate-100'
      }`}>
        {!currentVisualUrl && !canAttemptPlayback ? (
          <div className={`flex h-full w-full items-center justify-center ${mutedText}`}>
            <FaImage className="h-5 w-5" aria-hidden="true" />
          </div>
        ) : null}
        {canAttemptPlayback ? (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            preload="metadata"
            playsInline
            loop
            muted
            aria-label={uiText("Scene {value0} video preview", { value0: item.layerIndex })}
            onError={handleVideoError}
            onLoadedMetadata={handleVideoLoadedMetadata}
            onLoadedData={() => setVideoLoadFailed(false)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        {currentVisualUrl && !isPlaying ? (
          <img
            src={currentVisualUrl}
            alt={uiText("Scene {value0}", { value0: item.layerIndex })}
            loading="eager"
            onError={handleImageError}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-caption font-semibold text-white">{uiText("Scene {value0}", { value0: item.layerIndex })}</span>
        {canAttemptPlayback ? (
          <button
            type="button"
            disabled={isDisabled}
            aria-label={uiText("{value0} scene {value1} preview", { value0: isPlaying ? 'Pause' : 'Play', value1: item.layerIndex })}
            title={uiText("{value0} scene preview", { value0: isPlaying ? 'Pause' : 'Play' })}
            onClick={handlePlaybackClick}
            className={`
              absolute bottom-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full
              bg-black/70 text-white shadow transition hover:bg-black/85
              ${isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
            `}
          >
            {isPlaying ? (
              <FaPause className="h-3 w-3" aria-hidden="true" />
            ) : (
              <FaPlay className="h-3 w-3 translate-x-px" aria-hidden="true" />
            )}
          </button>
        ) : null}
        {isSelected ? (
          <span className={`absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full shadow ${
            colorMode === 'dark'
              ? 'bg-[#f6c453] text-[#111318] shadow-[0_0_0_2px_rgba(246,196,83,0.18)]'
              : 'bg-cyan-300 text-slate-950'
          }`}>
            <FaCheck className="h-3 w-3" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{uiText("Scene {value0}", { value0: item.layerIndex })}</span>
        <span className={mutedText}>{item.duration ? `${item.duration}s` : ''}</span>
      </div>
      {item.promptPreview ? (
        <div className={`mt-1 truncate ${mutedText}`}>{item.promptPreview}</div>
      ) : null}
    </div>
  );
}

export { normalizeRerollLayerIndexes, getRerollCandidateLayers, getRerollLocalCreditEstimate, RerollScenePreviewTile };
