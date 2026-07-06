import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  FaCheck,
  FaCopy,
  FaDownload,
  FaExternalLinkAlt,
  FaPlay,
  FaRedo,
  FaSearch,
  FaSpinner,
  FaTimes,
} from 'react-icons/fa';

import { useColorMode } from '../../contexts/ColorMode.jsx';
import { fitDimensionsToCanvas, getCanvasDimensionsForAspectRatio } from '../../utils/canvas.jsx';
import { getHeaders } from '../../utils/web.jsx';

const PROCESSOR_API = import.meta.env.VITE_PROCESSOR_API || '';
const DEFAULT_PAGE_SIZE = 80;

function isAbsoluteAssetUrl(value) {
  return typeof value === 'string' && /^(https?:|data:|blob:)/i.test(value.trim());
}

function firstNonEmptyString(values = []) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function resolveAssetUrl(assetPath) {
  if (typeof assetPath !== 'string') {
    return null;
  }

  const trimmedPath = assetPath.trim();
  if (!trimmedPath) {
    return null;
  }

  if (isAbsoluteAssetUrl(trimmedPath)) {
    return trimmedPath;
  }

  const normalizedPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
  const baseUrl = typeof PROCESSOR_API === 'string' ? PROCESSOR_API.trim().replace(/\/+$/, '') : '';
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function resolveGalleryVideoUrl(item = {}) {
  return resolveAssetUrl(firstNonEmptyString([
    item?.remoteURL,
    item?.remoteUrl,
    item?.assetPath,
    item?.url,
    item?.videoLink,
  ]));
}

function resolveGalleryPreviewImageUrl(item = {}) {
  return resolveAssetUrl(firstNonEmptyString([
    item?.thumbnailPath,
    item?.thumbnail,
    item?.previewImage,
    item?.poster,
  ]));
}

function resolveGalleryPreviewVideoUrl(item = {}) {
  return resolveAssetUrl(firstNonEmptyString([
    item?.thumbnailVideoRemoteUrl,
    item?.thumbnailVideoRemoteURL,
    item?.previewVideoRemoteUrl,
    item?.previewVideoRemoteURL,
    item?.thumbnailVideoPath,
    item?.previewVideoPath,
  ]));
}

function formatGalleryTimestamp(value) {
  const parsedDate = Date.parse(value || '');
  if (!parsedDate) {
    return null;
  }

  try {
    return new Date(parsedDate).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

function formatDuration(duration) {
  const numericDuration = Number(duration);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return null;
  }

  const roundedDuration = Math.round(numericDuration * 10) / 10;
  return `${roundedDuration.toFixed(roundedDuration >= 10 ? 0 : 1)}s`;
}

function downloadAsset(assetUrl, fallbackName) {
  if (!assetUrl) {
    return;
  }

  const link = document.createElement('a');
  link.href = assetUrl;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function getGalleryAspectRatioClass(aspectRatio, mediaType) {
  const normalizedAspectRatio = typeof aspectRatio === 'string' ? aspectRatio.trim() : '';

  switch (normalizedAspectRatio) {
    case '9:16':
      return 'aspect-[9/16]';
    case '16:9':
      return 'aspect-[16/9]';
    case '4:5':
      return 'aspect-[4/5]';
    case '5:4':
      return 'aspect-[5/4]';
    case '4:3':
      return 'aspect-[4/3]';
    case '3:4':
      return 'aspect-[3/4]';
    case '3:2':
      return 'aspect-[3/2]';
    case '2:3':
      return 'aspect-[2/3]';
    case '21:9':
      return 'aspect-[21/9]';
    case '1:1':
      return 'aspect-square';
    default:
      return mediaType === 'video' ? 'aspect-[16/9]' : 'aspect-square';
  }
}

function resolveGalleryCardTitle(item) {
  if (typeof item?.projectName === 'string' && item.projectName.trim()) {
    return item.projectName.trim();
  }

  if (typeof item?.title === 'string' && item.title.trim()) {
    return item.title.trim();
  }

  if (typeof item?.sourceLabel === 'string' && item.sourceLabel.trim()) {
    return item.sourceLabel.trim();
  }

  return item?.mediaType === 'video' ? 'Untitled video' : 'Untitled image';
}

function resolvePromptSnippet(item) {
  if (typeof item?.prompt === 'string' && item.prompt.trim()) {
    return item.prompt.trim();
  }

  if (typeof item?.description === 'string' && item.description.trim()) {
    return item.description.trim();
  }

  return '';
}

function loadImageDimensions(imageUrl) {
  return new Promise((resolve, reject) => {
    if (!imageUrl) {
      reject(new Error('Missing image URL'));
      return;
    }

    const image = new Image();
    if (!imageUrl.startsWith('data:')) {
      image.crossOrigin = 'anonymous';
    }

    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error('Unable to read the selected image.'));
    image.src = imageUrl;
  });
}

async function writeTextToClipboard(text) {
  if (!text) {
    return;
  }

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

export default function GenerationsGalleryPanel({
  title = 'Generations',
  subtitle = 'A unified wall of your image and video generations.',
  embedded = false,
  onSelectImage,
  onSelectVideo,
  isSelectButtonDisabled = false,
}) {
  const navigate = useNavigate();
  const { colorMode } = useColorMode();
  const [galleryItems, setGalleryItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    totalPages: 1,
    totalItems: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [activeItem, setActiveItem] = useState(null);
  const [isSelectPending, setIsSelectPending] = useState(false);
  const [isOpenStudioPending, setIsOpenStudioPending] = useState(false);
  const [studioErrorMessage, setStudioErrorMessage] = useState('');
  const [copiedItemId, setCopiedItemId] = useState(null);
  const [failedMediaByKey, setFailedMediaByKey] = useState({});

  const fetchGallery = useCallback(
    async (pageToLoad = 1, nextSearchTerm = searchTerm) => {
      const headers = getHeaders();
      if (!headers) {
        setGalleryItems([]);
        setPagination((currentValue) => ({
          ...currentValue,
          page: 1,
          totalPages: 1,
          totalItems: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        }));
        setErrorMessage('Log in to browse your generations.');
        return;
      }

      setIsLoading(true);
      setErrorMessage('');

      try {
        const response = await axios.get(`${PROCESSOR_API}/accounts/generations_gallery`, {
          ...headers,
          params: {
            page: pageToLoad,
            pageSize: DEFAULT_PAGE_SIZE,
            search: nextSearchTerm,
          },
        });

        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        const nextPagination = response?.data?.pagination || {};

        setGalleryItems(items);
        setPagination({
          page: nextPagination.page ?? pageToLoad,
          pageSize: nextPagination.pageSize ?? DEFAULT_PAGE_SIZE,
          totalPages: nextPagination.totalPages ?? 1,
          totalItems: nextPagination.totalItems ?? items.length,
          hasNextPage: Boolean(nextPagination.hasNextPage),
          hasPreviousPage: Boolean(nextPagination.hasPreviousPage),
        });
      } catch (error) {
        setGalleryItems([]);
        setPagination((currentValue) => ({
          ...currentValue,
          page: pageToLoad,
          totalPages: 1,
          totalItems: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        }));
        setErrorMessage(error?.response?.data?.error || 'Unable to load the generations gallery.');
      } finally {
        setIsLoading(false);
      }
    },
    [searchTerm]
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchGallery(1, searchTerm);
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchGallery, searchTerm]);

  useEffect(() => {
    if (!activeItem) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setActiveItem(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [activeItem]);

  useEffect(() => {
    setStudioErrorMessage('');
  }, [activeItem]);

  const canSelectActiveItem = useMemo(() => {
    if (!activeItem) {
      return false;
    }

    if (activeItem.mediaType === 'image') {
      return typeof onSelectImage === 'function';
    }

    if (activeItem.mediaType === 'video') {
      return typeof onSelectVideo === 'function' && activeItem.sourceType !== 'final_render';
    }

    return false;
  }, [activeItem, onSelectImage, onSelectVideo]);

  const pageSurface = embedded
    ? ''
    : colorMode === 'dark'
      ? 'min-h-screen bg-[#050914]'
      : 'min-h-screen bg-[#f4f6fb]';
  const panelSurface = colorMode === 'dark'
    ? 'border border-[#1d2840] bg-[#07101f] text-slate-100'
    : 'border border-slate-200 bg-white text-slate-900';
  const headerSurface = colorMode === 'dark'
    ? 'border border-[#1d2840] bg-[#0b1426]'
    : 'border border-slate-200 bg-white';
  const tileSurface = colorMode === 'dark'
    ? 'border border-[#1d2840] bg-[#0c1528] shadow-[0_18px_35px_rgba(0,0,0,0.24)]'
    : 'border border-slate-200 bg-white shadow-[0_14px_28px_rgba(15,23,42,0.08)]';
  const inputSurface = colorMode === 'dark'
    ? 'bg-[#0f1a31] border border-[#1d2840] text-slate-100 placeholder:text-slate-500'
    : 'bg-slate-50 border border-slate-200 text-slate-700 placeholder:text-slate-400';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const pillSurface = colorMode === 'dark'
    ? 'border border-white/10 bg-black/45 text-slate-100'
    : 'border border-slate-200 bg-white/90 text-slate-700';
  const actionSurface = colorMode === 'dark'
    ? 'border border-[#31405e] bg-[#111c32] text-slate-100 hover:bg-[#16233c]'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100';
  const primaryActionSurface = colorMode === 'dark'
    ? 'bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-500 text-white'
    : 'bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 text-white';
  const modalSurface = colorMode === 'dark'
    ? 'border border-[#1d2840] bg-[#07101f] text-slate-100'
    : 'border border-slate-200 bg-white text-slate-900';
  const subtleIconButton = colorMode === 'dark'
    ? 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
    : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700';

  const markMediaFailed = useCallback((mediaKey) => {
    if (!mediaKey) {
      return;
    }

    setFailedMediaByKey((previousValue) => (
      previousValue[mediaKey]
        ? previousValue
        : { ...previousValue, [mediaKey]: true }
    ));
  }, []);

  const handleDownload = useCallback((item) => {
    if (!item) {
      return;
    }

    const assetUrl = item?.mediaType === 'video'
      ? resolveGalleryVideoUrl(item)
      : resolveAssetUrl(item?.assetPath || item?.url);
    const fileExtension = item?.mediaType === 'video' ? 'mp4' : 'png';
    const fallbackName = `${resolveGalleryCardTitle(item)}.${fileExtension}`;
    downloadAsset(assetUrl, fallbackName);
  }, []);

  const handleSelectActiveItem = useCallback(async () => {
    if (!activeItem || isSelectPending || isSelectButtonDisabled) {
      return;
    }

    try {
      setIsSelectPending(true);

      if (activeItem.mediaType === 'image' && typeof onSelectImage === 'function') {
        await Promise.resolve(onSelectImage(activeItem.assetPath || activeItem.url));
        setActiveItem(null);
        return;
      }

      if (activeItem.mediaType === 'video' && typeof onSelectVideo === 'function') {
        await Promise.resolve(onSelectVideo({
          video: activeItem,
          videoItem: activeItem,
          trimScene: false,
        }));
        setActiveItem(null);
      }
    } finally {
      setIsSelectPending(false);
    }
  }, [activeItem, isSelectPending, isSelectButtonDisabled, onSelectImage, onSelectVideo]);

  const handleCopyPrompt = useCallback(async (event, item) => {
    event.stopPropagation();

    const promptText = resolvePromptSnippet(item);
    if (!promptText) {
      return;
    }

    try {
      await writeTextToClipboard(promptText);
      setCopiedItemId(item?._id || null);
      window.setTimeout(() => {
        setCopiedItemId((currentValue) => (currentValue === (item?._id || null) ? null : currentValue));
      }, 1600);
    } catch  {
      setStudioErrorMessage('Unable to copy the prompt.');
    }
  }, []);

  const handleOpenInStudio = useCallback(async (item = activeItem) => {
    if (!item || isOpenStudioPending) {
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      setStudioErrorMessage('Log in to open this generation in studio.');
      navigate('/login');
      return;
    }

    setIsOpenStudioPending(true);
    setStudioErrorMessage('');

    try {
      if (item.mediaType === 'video') {
        if (item.sourceType === 'final_render' && item.sessionId) {
          const existingSessionId = item.sessionId.toString();
          localStorage.setItem('videoSessionId', existingSessionId);
          navigate(`/video/${existingSessionId}`);
          setActiveItem(null);
          return;
        }

        const createResponse = await axios.post(
          `${PROCESSOR_API}/video_sessions/create_video_session`,
          {
            prompts: [],
            aspectRatio: item.aspectRatio || '16:9',
          },
          headers
        );

        const createdSession = createResponse?.data || {};
        const sessionId = createdSession?._id?.toString?.() || createdSession?._id;
        const layerId = createdSession?.layers?.[0]?._id?.toString?.() || createdSession?.layers?.[0]?._id;

        if (!sessionId || !layerId) {
          throw new Error('Unable to create a video session.');
        }

        if (item.sourceType === 'ai_video') {
          await axios.post(
            `${PROCESSOR_API}/video_sessions/add_ai_video_layer`,
            {
              sessionId,
              layerId,
              videoURL: item.assetPath || item.url,
              trimScene: false,
              videoModel: item.model || null,
              audioPrompt: item.audioPrompt || null,
            },
            headers
          );
        } else {
          await axios.post(
            `${PROCESSOR_API}/video_sessions/add_video_from_library`,
            {
              sessionId,
              layerId,
              trimScene: false,
              videoItem: item,
            },
            headers
          );
        }

        localStorage.setItem('videoSessionId', sessionId.toString());
        navigate(`/video/${sessionId}`);
        setActiveItem(null);
        return;
      }

      if (item.mediaType === 'image') {
        const aspectRatio = item.aspectRatio || '1:1';
        const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
        const createResponse = await axios.post(
          `${PROCESSOR_API}/image_sessions/create_session`,
          {
            prompts: [],
            aspectRatio,
            canvasDimensions,
            sessionName: resolveGalleryCardTitle(item),
          },
          headers
        );

        const createdSession = createResponse?.data || {};
        const sessionId = createdSession?._id?.toString?.() || createdSession?._id;
        const layerId = createdSession?.layers?.[0]?._id?.toString?.() || createdSession?.layers?.[0]?._id;
        const resolvedCanvasDimensions = createdSession?.canvasDimensions || canvasDimensions;

        if (!sessionId || !layerId) {
          throw new Error('Unable to create an image session.');
        }

        const imageSourcePath = item.assetPath || item.url;
        const imageDimensions = await loadImageDimensions(resolveAssetUrl(imageSourcePath) || imageSourcePath);
        const placement = fitDimensionsToCanvas(imageDimensions, resolvedCanvasDimensions);

        await axios.post(
          `${PROCESSOR_API}/image_sessions/update_active_item_list`,
          {
            sessionId,
            layerId,
            activeItemList: [
              {
                src: imageSourcePath,
                id: 'item_0',
                type: 'image',
                x: placement.x,
                y: placement.y,
                width: placement.width,
                height: placement.height,
                source: 'library',
              },
            ],
          },
          headers
        );

        localStorage.setItem('imageSessionId', sessionId.toString());
        navigate(`/image/studio/${sessionId}`);
        setActiveItem(null);
      }
    } catch (error) {
      setStudioErrorMessage(error?.response?.data?.error || error?.message || 'Unable to open this generation in studio.');
    } finally {
      setIsOpenStudioPending(false);
    }
  }, [activeItem, isOpenStudioPending, navigate]);

  const handleRefresh = () => {
    void fetchGallery(pagination.page || 1, searchTerm);
  };

  const activeItemPrompt = resolvePromptSnippet(activeItem);

  return (
    <div className={pageSurface}>
      <div className={embedded ? '' : 'mx-auto w-full max-w-[1720px] px-4 pb-8 pt-[144px] md:px-6 md:pt-[84px]'}>
        <div className={`rounded-[30px] ${panelSurface}`}>
          <div className={`sticky ${embedded ? 'top-0' : 'top-[124px] md:top-[56px]'} z-10 rounded-t-[30px] border-b px-4 py-4 backdrop-blur md:px-6 ${headerSurface}`}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-sky-500">
                  Internal Gallery
                </div>
                <h1 className={`mt-1 font-semibold ${embedded ? 'text-xl' : 'text-2xl md:text-3xl'}`}>
                  {title}
                </h1>
                <p className={`mt-2 max-w-2xl text-sm ${mutedText}`}>
                  {subtitle}
                </p>
              </div>

              <div className="flex w-full flex-col gap-3 xl:max-w-[540px]">
                <div className={`flex items-center gap-2 rounded-full px-4 py-3 ${inputSurface}`}>
                  <FaSearch className={mutedText} />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search prompts, models, projects, and render types"
                    className="w-full bg-transparent text-sm focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className={`text-xs ${mutedText}`}>
                    {pagination.totalItems} items
                  </div>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${actionSurface}`}
                    onClick={handleRefresh}
                    disabled={isLoading}
                  >
                    <FaRedo className={isLoading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            {errorMessage && (
              <div className="mt-3 text-sm text-rose-400">{errorMessage}</div>
            )}
          </div>

          <div className="px-4 pb-5 pt-4 md:px-6">
            {isLoading && (
              <div className={`py-12 text-center text-sm ${mutedText}`}>Loading generations…</div>
            )}

            {!isLoading && !galleryItems.length && (
              <div className={`rounded-[26px] border border-dashed px-6 py-12 text-center ${tileSurface}`}>
                <div className="text-lg font-semibold">No generations yet</div>
                <div className={`mt-2 text-sm ${mutedText}`}>
                  Your images, AI videos, and completed renders will collect here automatically.
                </div>
              </div>
            )}

            {!isLoading && galleryItems.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {galleryItems.map((item) => {
                  const itemKey = `${item.mediaType}-${item._id}`;
                  const previewImageUrl = resolveGalleryPreviewImageUrl(item);
                  const previewVideoUrl = resolveGalleryPreviewVideoUrl(item);
                  const fullAssetUrl = item?.mediaType === 'video'
                    ? resolveGalleryVideoUrl(item)
                    : resolveAssetUrl(item?.assetPath || item?.url);
                  const previewImageMediaKey = `${itemKey}:image:${previewImageUrl || ''}`;
                  const previewVideoMediaKey = `${itemKey}:video-preview:${previewVideoUrl || ''}`;
                  const displayPreviewImageUrl = previewImageUrl && !failedMediaByKey[previewImageMediaKey]
                    ? previewImageUrl
                    : null;
                  const displayPreviewVideoUrl = previewVideoUrl && !failedMediaByKey[previewVideoMediaKey]
                    ? previewVideoUrl
                    : null;
                  const createdAtLabel = formatGalleryTimestamp(item?.createdAt || item?.updatedAt);
                  const durationLabel = formatDuration(item?.duration);
                  const isVideo = item?.mediaType === 'video';
                  const titleLabel = resolveGalleryCardTitle(item);
                  const promptSnippet = resolvePromptSnippet(item);
                  const aspectRatioClass = getGalleryAspectRatioClass(item?.aspectRatio, item?.mediaType);
                  const isPromptCopied = copiedItemId === item?._id;

                  return (
                    <button
                      key={itemKey}
                      type="button"
                      className={`group overflow-hidden rounded-[24px] text-left transition hover:-translate-y-[2px] ${tileSurface}`}
                      onClick={() => setActiveItem(item)}
                    >
                      <div className="flex h-full flex-col">
                        <div className={`relative overflow-hidden bg-slate-950 ${aspectRatioClass}`}>
                          {isVideo ? (
                            displayPreviewImageUrl ? (
                              <img
                                src={displayPreviewImageUrl}
                                alt={titleLabel}
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                                onError={() => markMediaFailed(previewImageMediaKey)}
                              />
                            ) : displayPreviewVideoUrl ? (
                              <video
                                src={displayPreviewVideoUrl}
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                                autoPlay
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                onError={() => markMediaFailed(previewVideoMediaKey)}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-slate-950 text-sm text-slate-300">
                                Video preview unavailable
                              </div>
                            )
                          ) : (
                            <img
                              src={previewImageUrl || fullAssetUrl || ''}
                              alt={titleLabel}
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                            />
                          )}

                          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${pillSurface}`}>
                              {item?.sourceLabel || (isVideo ? 'Video' : 'Image')}
                            </span>
                            {durationLabel && (
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${pillSurface}`}>
                                {durationLabel}
                              </span>
                            )}
                          </div>

                          {isVideo && (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
                                <FaPlay className="ml-0.5" />
                              </span>
                            </div>
                          )}
                        </div>

                        <div className={`border-t p-4 ${colorMode === 'dark' ? 'border-[#1d2840]' : 'border-slate-200'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1 truncate text-sm font-semibold">
                              {titleLabel}
                            </div>
                            {item?.model && (
                              <span className={`max-w-[46%] shrink-0 truncate rounded-full px-2.5 py-1 text-[11px] font-semibold ${pillSurface}`}>
                                {item.model}
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex items-center gap-3">
                            <div className={`min-w-0 flex-1 truncate text-xs leading-5 ${mutedText}`}>
                              {promptSnippet || createdAtLabel || 'No prompt captured'}
                            </div>
                            {promptSnippet && (
                              <button
                                type="button"
                                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${subtleIconButton}`}
                                onClick={(event) => void handleCopyPrompt(event, item)}
                                aria-label="Copy prompt"
                              >
                                {isPromptCopied ? <FaCheck className="text-[11px]" /> : <FaCopy className="text-[11px]" />}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className={`text-xs ${mutedText}`}>
                Page {pagination.page} of {Math.max(1, pagination.totalPages)}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${actionSurface}`}
                  disabled={!pagination.hasPreviousPage || isLoading}
                  onClick={() => void fetchGallery(Math.max(1, pagination.page - 1), searchTerm)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${actionSurface}`}
                  disabled={!pagination.hasNextPage || isLoading}
                  onClick={() => void fetchGallery(pagination.page + 1, searchTerm)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeItem && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close preview"
            onClick={() => setActiveItem(null)}
          />

          <div className={`relative z-10 flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] ${modalSurface} md:flex-row`}>
            <button
              type="button"
              className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white"
              onClick={() => setActiveItem(null)}
            >
              <FaTimes />
            </button>

            <div className="flex min-h-[320px] flex-1 items-center justify-center bg-slate-950 p-4">
              {activeItem.mediaType === 'video' ? (
                <video
                  src={resolveGalleryVideoUrl(activeItem) || undefined}
                  poster={resolveGalleryPreviewImageUrl(activeItem) || undefined}
                  className="max-h-[75vh] w-full rounded-[22px] bg-black object-contain"
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <img
                  src={resolveAssetUrl(activeItem.assetPath || activeItem.url) || ''}
                  alt={resolveGalleryCardTitle(activeItem)}
                  className="max-h-[75vh] w-full rounded-[22px] object-contain"
                />
              )}
            </div>

            <div className="w-full border-t border-white/10 p-5 md:w-[380px] md:border-l md:border-t-0">
              <div className={`text-[11px] font-semibold uppercase tracking-[0.25em] ${mutedText}`}>
                {activeItem.sourceLabel || activeItem.mediaType}
              </div>
              <div className="mt-2 text-xl font-semibold">
                {resolveGalleryCardTitle(activeItem)}
              </div>

              {activeItemPrompt && (
                <div className={`mt-4 rounded-2xl border p-4 ${actionSurface}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm leading-6">
                      {activeItemPrompt}
                    </div>
                    <button
                      type="button"
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${subtleIconButton}`}
                      onClick={(event) => void handleCopyPrompt(event, activeItem)}
                      aria-label="Copy prompt"
                    >
                      {copiedItemId === activeItem?._id ? <FaCheck className="text-[12px]" /> : <FaCopy className="text-[12px]" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {activeItem.model && (
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${actionSurface}`}>
                    {activeItem.model}
                  </span>
                )}
                {formatDuration(activeItem.duration) && (
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${actionSurface}`}>
                    {formatDuration(activeItem.duration)}
                  </span>
                )}
                {activeItem.aspectRatio && (
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${actionSurface}`}>
                    {activeItem.aspectRatio}
                  </span>
                )}
                {formatGalleryTimestamp(activeItem.createdAt || activeItem.updatedAt) && (
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${actionSurface}`}>
                    {formatGalleryTimestamp(activeItem.createdAt || activeItem.updatedAt)}
                  </span>
                )}
              </div>

              {studioErrorMessage && (
                <div className="mt-4 text-sm text-rose-400">{studioErrorMessage}</div>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${primaryActionSurface}`}
                  disabled={isOpenStudioPending}
                  onClick={() => void handleOpenInStudio(activeItem)}
                >
                  {isOpenStudioPending ? <FaSpinner className="animate-spin" /> : <FaExternalLinkAlt />}
                  {isOpenStudioPending
                    ? 'Opening...'
                    : activeItem.mediaType === 'image'
                      ? 'Open in Image Studio'
                      : activeItem.sourceType === 'final_render'
                        ? 'Open Session'
                        : 'Open in Video Studio'}
                </button>

                <button
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${actionSurface}`}
                  onClick={() => handleDownload(activeItem)}
                >
                  <FaDownload />
                  Download
                </button>

                {canSelectActiveItem && (
                  <button
                    type="button"
                    disabled={isSelectPending || isSelectButtonDisabled}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${actionSurface}`}
                    onClick={() => void handleSelectActiveItem()}
                  >
                    {isSelectPending
                      ? 'Adding...'
                      : activeItem.mediaType === 'video'
                        ? 'Use Video'
                        : 'Add Image'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
