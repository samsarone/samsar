import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  FaDownload,
  FaPlay,
  FaPause,
  FaRedo,
  FaSearch,
  FaVideo,
} from 'react-icons/fa';
import { getHeaders } from '../../../utils/web';
import { useColorMode } from '../../../contexts/ColorMode';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API || '';

function isAbsoluteMediaUrl(value) {
  return typeof value === 'string' && /^(https?:|data:|blob:)/i.test(value.trim());
}

function looksLikeStudioVideoRoute(value) {
  return typeof value === 'string' && /^\/?video\/[a-f0-9]{24}$/i.test(value.trim());
}

function firstNonEmptyString(values = []) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function resolveVideoUrl(assetPath) {
  if (typeof assetPath !== 'string') {
    return null;
  }

  const trimmedPath = assetPath.trim();
  if (!trimmedPath || looksLikeStudioVideoRoute(trimmedPath)) {
    return null;
  }

  if (isAbsoluteMediaUrl(trimmedPath)) {
    return trimmedPath;
  }

  const normalizedPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
  const baseUrl = typeof API_SERVER === 'string' ? API_SERVER.trim().replace(/\/+$/, '') : '';
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function resolveAssetVideoUrl(item = {}) {
  return resolveVideoUrl(firstNonEmptyString([
    item?.remoteURL,
    item?.remoteUrl,
    item?.assetPath,
    item?.url,
    item?.videoLink,
  ]));
}

function resolveThumbnailUrl(item = {}) {
  const thumbnailPath = firstNonEmptyString([
    item?.thumbnailPath,
    item?.thumbnail,
    item?.startThumbnailPath,
    item?.aiVideoThumbnailPath,
    item?.userVideoThumbnailPath,
    item?.lipSyncThumbnailPath,
    item?.soundEffectThumbnailPath,
    item?.previewImage,
    item?.poster,
    item?.aiLayerStartFrame,
  ]);

  return resolveVideoUrl(thumbnailPath);
}

function resolvePreviewVideoUrl(item = {}) {
  const previewVideoPath = firstNonEmptyString([
    item?.thumbnailVideoRemoteUrl,
    item?.thumbnailVideoRemoteURL,
    item?.previewVideoRemoteUrl,
    item?.previewVideoRemoteURL,
    item?.thumbnailVideoPath,
    item?.previewVideoPath,
    item?.aiVideoThumbnailVideo,
    item?.userVideoThumbnailVideo,
    item?.lipSyncThumbnailVideo,
    item?.soundEffectThumbnailVideo,
  ]);

  return resolveVideoUrl(previewVideoPath);
}

function formatDuration(duration) {
  const numericDuration = Number(duration);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return null;
  }

  const roundedDuration = Math.round(numericDuration * 10) / 10;
  return `${roundedDuration.toFixed(roundedDuration >= 10 ? 0 : 1)}s`;
}

function resolveAspectRatioStyle(item = {}) {
  const aspectRatio = firstNonEmptyString([
    item?.aspectRatio,
    item?.sessionAspectRatio,
    item?.canvasAspectRatio,
    item?.videoAspectRatio,
  ]);
  const match = aspectRatio.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return '16 / 9';
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '16 / 9';
  }

  return `${width} / ${height}`;
}

function getTrimKey(item = {}) {
  return item?._id || `${item?.sessionId || 'global'}:${item?.assetPath || item?.url || ''}`;
}

function getItemSearchText(item = {}) {
  return [
    item?.title,
    item?.description,
    item?.prompt,
    item?.projectName,
    item?.sourceLabel,
    item?.model,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();
}

export default function VideoLibraryHome(props) {
  const {
    sessionId,
    hideSelectButton = false,
    onSelectVideo,
    isSelectButtonDisabled = false,
  } = props;
  const { colorMode } = useColorMode();
  const [searchTerm, setSearchTerm] = useState('');
  const [libraryData, setLibraryData] = useState({
    projectItems: [],
    globalItems: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [previewingVideoId, setPreviewingVideoId] = useState(null);
  const [trimByVideoId, setTrimByVideoId] = useState({});
  const [failedMediaByKey, setFailedMediaByKey] = useState({});
  const videoRefs = useRef({});

  const panelSurface = colorMode === 'dark'
    ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d]'
    : 'bg-white text-slate-900 border border-slate-200';
  const sectionSurface = colorMode === 'dark'
    ? 'bg-[#0b1226] border border-[#1f2a3d]'
    : 'bg-slate-50 border border-slate-200';
  const cardSurface = colorMode === 'dark'
    ? 'bg-[#111a2f] border border-[#1f2a3d]'
    : 'bg-white border border-slate-200';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const pillSurface = colorMode === 'dark'
    ? 'bg-slate-900/70 text-slate-200 border border-slate-700/60'
    : 'bg-slate-100 text-slate-700 border border-slate-200';
  const actionButtonSurface = colorMode === 'dark'
    ? 'bg-[#16213a] text-slate-100 hover:bg-[#1b2745] border border-[#31405e]'
    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200';
  const selectButtonSurface = colorMode === 'dark'
    ? 'bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 text-white'
    : 'bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 text-white';
  const inputSurface = colorMode === 'dark'
    ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-100 placeholder:text-slate-500'
    : 'bg-white border border-slate-200 text-slate-700 placeholder:text-slate-400';

  const fetchLibraryData = async () => {
    const headers = getHeaders();
    if (!headers) {
      setErrorMessage('Log in to browse the video library.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await axios.get(
        `${API_SERVER}/video_sessions/video_library`,
        {
          ...headers,
          params: {
            sessionId,
            search: searchTerm,
          },
        }
      );
      setLibraryData({
        projectItems: Array.isArray(response?.data?.projectItems) ? response.data.projectItems : [],
        globalItems: Array.isArray(response?.data?.globalItems) ? response.data.globalItems : [],
      });
    } catch (error) {
      setErrorMessage(error?.response?.data?.error || 'Unable to load the video library.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLibraryData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, searchTerm]);

  useEffect(() => {
    return () => {
      Object.values(videoRefs.current).forEach((videoElement) => {
        if (videoElement?.pause) {
          videoElement.pause();
        }
      });
    };
  }, []);

  const filteredProjectItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) {
      return libraryData.projectItems;
    }

    return libraryData.projectItems.filter((item) => (
      getItemSearchText(item).includes(normalizedSearch)
    ));
  }, [libraryData.projectItems, searchTerm]);

  const filteredGlobalItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) {
      return libraryData.globalItems;
    }

    return libraryData.globalItems.filter((item) => (
      getItemSearchText(item).includes(normalizedSearch)
    ));
  }, [libraryData.globalItems, searchTerm]);

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  const handlePreviewToggle = (itemId) => {
    if (previewingVideoId && previewingVideoId !== itemId) {
      const previousPreview = videoRefs.current[previewingVideoId];
      if (previousPreview?.pause) {
        previousPreview.pause();
        previousPreview.currentTime = 0;
      }
    }

    if (previewingVideoId === itemId) {
      const currentPreview = videoRefs.current[itemId];
      if (currentPreview?.pause) {
        currentPreview.pause();
        currentPreview.currentTime = 0;
      }
      setPreviewingVideoId(null);
      return;
    }

    setPreviewingVideoId(itemId);
  };

  const handleDownload = (item) => {
    const videoUrl = resolveAssetVideoUrl(item);
    if (!videoUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `${item?.title || item?.sourceLabel || 'video'}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleTrimToggle = (itemKey) => {
    setTrimByVideoId((previousValue) => ({
      ...previousValue,
      [itemKey]: !previousValue[itemKey],
    }));
  };

  const handleSelect = (item) => {
    if (typeof onSelectVideo !== 'function') {
      return;
    }

    const itemKey = getTrimKey(item);
    onSelectVideo({
      video: item,
      videoItem: item,
      trimScene: item?.sourceType === 'ai_video' ? Boolean(trimByVideoId[itemKey]) : false,
    });
  };

  const markMediaFailed = (mediaKey) => {
    if (!mediaKey) {
      return;
    }

    setFailedMediaByKey((previousValue) => (
      previousValue[mediaKey]
        ? previousValue
        : { ...previousValue, [mediaKey]: true }
    ));
  };

  const renderEmptyState = (message) => (
    <div className={`rounded-xl border border-dashed px-4 py-6 text-sm ${sectionSurface} ${mutedText}`}>
      {message}
    </div>
  );

  const renderVideoGrid = (items, sectionKey, emptyMessage) => {
    if (!items.length) {
      return renderEmptyState(emptyMessage);
    }

    return (
      <div
        className="grid items-start gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}
      >
        {items.map((item, index) => {
          const itemKey = getTrimKey(item) || `${sectionKey}-${index}`;
          const videoUrl = resolveAssetVideoUrl(item);
          const thumbnailUrl = resolveThumbnailUrl(item);
          const previewVideoUrl = resolvePreviewVideoUrl(item);
          const mediaAspectRatio = resolveAspectRatioStyle(item);
          const thumbnailMediaKey = `${itemKey}:thumbnail:${thumbnailUrl || ''}`;
          const previewVideoMediaKey = `${itemKey}:preview:${previewVideoUrl || ''}`;
          const fullVideoMediaKey = `${itemKey}:video:${videoUrl || ''}`;
          const displayThumbnailUrl = thumbnailUrl && !failedMediaByKey[thumbnailMediaKey] ? thumbnailUrl : null;
          const displayPreviewVideoUrl = previewVideoUrl && !failedMediaByKey[previewVideoMediaKey] ? previewVideoUrl : null;
          const canPlayFullVideo = Boolean(videoUrl && !failedMediaByKey[fullVideoMediaKey]);
          const durationLabel = formatDuration(item?.duration);
          const isPreviewing = previewingVideoId === itemKey;

          return (
            <div key={`${sectionKey}-${itemKey}-${index}`} className={`rounded-2xl p-3 shadow-sm ${cardSurface}`}>
              <div className="relative overflow-hidden rounded-xl bg-slate-950">
                {isPreviewing && canPlayFullVideo ? (
                  <video
                    ref={(node) => {
                      videoRefs.current[itemKey] = node;
                    }}
                    src={videoUrl}
                    poster={displayThumbnailUrl || undefined}
                    className="w-full rounded-xl bg-black object-cover"
                    style={{ aspectRatio: mediaAspectRatio }}
                    preload="metadata"
                    controls
                    autoPlay
                    playsInline
                    onError={() => {
                      markMediaFailed(fullVideoMediaKey);
                      setPreviewingVideoId((currentValue) => (currentValue === itemKey ? null : currentValue));
                    }}
                    onEnded={() => {
                      setPreviewingVideoId((currentValue) => (currentValue === itemKey ? null : currentValue));
                    }}
                  />
                ) : displayThumbnailUrl ? (
                  <button
                    type="button"
                    className="group relative block w-full overflow-hidden rounded-xl"
                    style={{ aspectRatio: mediaAspectRatio }}
                    onClick={() => handlePreviewToggle(itemKey)}
                    disabled={!canPlayFullVideo}
                  >
                    <img
                      src={displayThumbnailUrl}
                      alt={item?.title || item?.sourceLabel || 'Video preview'}
                      className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                      onError={() => markMediaFailed(thumbnailMediaKey)}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur">
                        <FaPlay className="ml-0.5" />
                      </span>
                    </div>
                  </button>
                ) : displayPreviewVideoUrl ? (
                  <button
                    type="button"
                    className="group relative block w-full overflow-hidden rounded-xl"
                    style={{ aspectRatio: mediaAspectRatio }}
                    onClick={() => handlePreviewToggle(itemKey)}
                    disabled={!canPlayFullVideo}
                  >
                    <video
                      src={displayPreviewVideoUrl}
                      className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      onError={() => markMediaFailed(previewVideoMediaKey)}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur">
                        <FaPlay className="ml-0.5" />
                      </span>
                    </div>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center justify-center rounded-xl bg-slate-900/70 text-slate-200"
                    style={{ aspectRatio: mediaAspectRatio }}
                    onClick={() => handlePreviewToggle(itemKey)}
                    disabled={!canPlayFullVideo}
                  >
                    <FaVideo className="mr-2" />
                    {canPlayFullVideo ? 'Preview video' : 'Preview unavailable'}
                  </button>
                )}

                <button
                  type="button"
                  className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-full bg-black/65 px-3 py-2 text-xs font-semibold text-white backdrop-blur"
                  onClick={() => handlePreviewToggle(itemKey)}
                  disabled={!canPlayFullVideo}
                >
                  {isPreviewing ? <FaPause /> : <FaPlay />}
                  {isPreviewing ? 'Hide' : 'Preview'}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${pillSurface}`}>
                  {item?.sourceLabel || 'Video'}
                </span>
                {durationLabel && (
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${pillSurface}`}>
                    {durationLabel}
                  </span>
                )}
                {item?.projectName && (
                  <span className={`rounded-full px-2 py-1 text-[11px] ${pillSurface}`}>
                    {item.projectName}
                  </span>
                )}
              </div>

              <div className="mt-3">
                <div className="text-sm font-semibold">{item?.title || 'Untitled video'}</div>
                {item?.prompt && (
                  <div className={`mt-1 line-clamp-3 text-xs ${mutedText}`}>
                    {item.prompt}
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${actionButtonSurface}`}
                  onClick={() => handleDownload(item)}
                >
                  <FaDownload />
                  Download
                </button>

                {!hideSelectButton && (
                  <div className="ml-auto flex items-center gap-2">
                    {item?.sourceType === 'ai_video' && (
                      <label className={`inline-flex items-center gap-2 text-[11px] ${mutedText}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-sky-500"
                          checked={Boolean(trimByVideoId[itemKey])}
                          onChange={() => handleTrimToggle(itemKey)}
                        />
                        Trim
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={isSelectButtonDisabled}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold shadow transition disabled:opacity-60 ${selectButtonSurface}`}
                      onClick={() => handleSelect(item)}
                    >
                      Select
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={`h-full w-full overflow-y-auto px-3 py-3 ${panelSurface}`}>
      <div className={`mb-3 rounded-2xl p-3 ${sectionSurface}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className={`flex flex-1 items-center gap-2 rounded-xl px-3 py-2 ${inputSurface}`}>
            <FaSearch className={mutedText} />
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search AI, uploaded, or synced videos"
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={fetchLibraryData}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${actionButtonSurface}`}
            disabled={isLoading}
          >
            <FaRedo className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {errorMessage && (
          <div className="mt-3 text-xs text-rose-400">{errorMessage}</div>
        )}
      </div>

      <div className={`rounded-2xl p-3 ${sectionSurface}`}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Current Project</div>
            <div className={`text-xs ${mutedText}`}>
              AI videos, uploaded takes, lip-sync and sound-effect layers from this studio session.
            </div>
          </div>
          <div className={`text-[11px] ${mutedText}`}>
            {filteredProjectItems.length} items
          </div>
        </div>
        {renderVideoGrid(
          filteredProjectItems,
          'project',
          'No project videos available yet.'
        )}
      </div>

      <div className={`mt-3 rounded-2xl p-3 ${sectionSurface}`}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Other Sessions</div>
            <div className={`text-xs ${mutedText}`}>
              Reuse videos generated or uploaded in your other projects.
            </div>
          </div>
          <div className={`text-[11px] ${mutedText}`}>
            {filteredGlobalItems.length} items
          </div>
        </div>
        {renderVideoGrid(
          filteredGlobalItems,
          'global',
          'No reusable videos found in other sessions.'
        )}
      </div>
    </div>
  );
}
