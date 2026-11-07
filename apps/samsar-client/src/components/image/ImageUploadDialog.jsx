import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText, getUiLanguage } from '../../utils/localization.js';
import { useState, useCallback } from 'react';
import { fitDimensionsToCanvas, normalizeCanvasDimensions } from '../../utils/canvas.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import MinimalTaskSkeleton from '../common/MinimalTaskSkeleton.jsx';

const MAX_UPLOADED_VIDEO_DURATION_SECONDS = 5 * 60;
const MAX_UPLOADED_VIDEO_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

export default function ImageUploadDialog({ setUploadURL, setUploadVideo, aspectRatio, canvasDimensions }) {
  useUiLanguage();
  const [images, setImages] = useState([]);
  const [videoPreviewName, setVideoPreviewName] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { colorMode } = useColorMode();
  const supportsVideoUpload = typeof setUploadVideo === 'function';
  const isDark = colorMode === 'dark';

  const shellClass = isDark
    ? 'border border-[#3a4050] bg-[linear-gradient(180deg,#181b24_0%,#151720_52%,#0c0d12_100%)] text-slate-100 shadow-[0_30px_90px_rgba(0,0,0,0.52)]'
    : 'border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(251,113,133,0.12),transparent_30%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] text-slate-800 shadow-[0_24px_70px_rgba(15,23,42,0.12)]';
  const panelClass = isDark
    ? 'border border-[#3a4050] bg-[#181b24]/88'
    : 'border border-slate-200 bg-white/92';
  const mutedTextClass = isDark ? 'text-slate-400' : 'text-slate-500';
  const secondaryTextClass = isDark ? 'text-slate-300' : 'text-slate-600';
  const dropZoneClass = isDark
    ? isDragging
      ? 'border-[#f6c453] bg-[#f6c453]/10 shadow-[0_0_24px_rgba(246,196,83,0.12)]'
      : 'border-[#3a4050] bg-[#151720]/90 hover:border-[#667188] hover:bg-[#181b24]'
    : isDragging
      ? 'border-rose-500 bg-rose-50 shadow-[0_0_18px_rgba(244,63,94,0.10)]'
      : 'border-slate-300 bg-slate-50/80 hover:border-slate-400 hover:bg-white';

  const normalizedStatus = uploadStatus.toLowerCase();
  const statusToneClass = uploadStatus
    ? normalizedStatus.includes('failed') || normalizedStatus.includes('please') || normalizedStatus.includes('unable')
      ? (isDark
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
          : 'border-rose-200 bg-rose-50 text-rose-700')
      : normalizedStatus.includes('success')
        ? (isDark
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700')
        : (isDark
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
            : 'border-amber-200 bg-amber-50 text-amber-700')
    : '';

  const isSupportedVideoFile = (file) => {
    if (!file) return false;
    const fileName = file.name ? file.name.toLowerCase() : '';
    const fileType = file.type ? file.type.toLowerCase() : '';
    return (
      fileType.startsWith('video/')
      || fileName.endsWith('.mp4')
      || fileName.endsWith('.mov')
      || fileName.endsWith('.webm')
      || fileName.endsWith('.m4v')
    );
  };

  const resolveVideoMetadata = (file) =>
    new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = Number(video.duration);
        URL.revokeObjectURL(objectUrl);
        resolve({ duration });
      };
      video.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(uiText("Unable to read video metadata.")));
      };
      video.src = objectUrl;
    });

  const handleFileChange = (event) => {
    processFiles(event.target.files);
    event.target.value = '';
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      processFiles(event.dataTransfer.files);
      event.dataTransfer.clearData();
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const resolveCanvasPlacement = (dataUrl) =>
    new Promise((resolve, reject) => {
      if (!dataUrl) {
        reject(new Error(uiText("Missing data URL")));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const resolvedCanvasDimensions = normalizeCanvasDimensions(canvasDimensions, aspectRatio);
        const placement = fitDimensionsToCanvas(
          { width: img.width, height: img.height },
          resolvedCanvasDimensions
        );

        resolve({
          url: dataUrl,
          width: placement.width,
          height: placement.height,
          x: placement.x,
          y: placement.y,
        });
      };
      img.onerror = () => {
        reject(new Error(uiText("Unable to read image")));
      };
      img.src = dataUrl;
    });

  const processFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) {
      setUploadStatus(supportsVideoUpload ? uiText("Please upload an image or video file.") : uiText("Please upload an image file."));
      return;
    }

    const validImageFiles = files.filter((file) => {
      if (!file) return false;
      const fileName = file.name ? file.name.toLowerCase() : '';
      const isHeicFile = fileName.endsWith('.heic') || fileName.endsWith('.heif');
      const isWebpFile = fileName.endsWith('.webp');
      return Boolean(file.type && file.type.startsWith('image/')) || isHeicFile || isWebpFile;
    });
    const validVideoFiles = supportsVideoUpload
      ? files.filter((file) => isSupportedVideoFile(file))
      : [];

    if (validImageFiles.length > 0 && validVideoFiles.length > 0) {
      setUploadStatus(uiText("Upload images or one video at a time."));
      return;
    }

    if (validVideoFiles.length > 0) {
      if (validVideoFiles.length > 1) {
        setUploadStatus(uiText("Please upload a single video file."));
        return;
      }

      const [videoFile] = validVideoFiles;
      setIsProcessing(true);
      setImages([]);
      setVideoPreviewName(videoFile.name || uiText("Uploaded video"));
      setUploadStatus(uiText("Validating video..."));

      try {
        if (videoFile.size > MAX_UPLOADED_VIDEO_FILE_SIZE_BYTES) {
          throw new Error(uiText("Video uploads must be 2 GB or smaller."));
        }

        const { duration } = await resolveVideoMetadata(videoFile);
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error(uiText("Unable to determine video duration."));
        }
        if (duration > MAX_UPLOADED_VIDEO_DURATION_SECONDS) {
          throw new Error(uiText("Video uploads must be {value0} seconds or shorter.", { value0: MAX_UPLOADED_VIDEO_DURATION_SECONDS }));
        }

        setUploadStatus(uiText("Uploading video..."));
        await setUploadVideo(videoFile);
        setUploadStatus(uiText("Video uploaded successfully."));
      } catch (error) {
        setUploadStatus(error?.message || uiText("Video upload failed. Please try another file."));
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (!validImageFiles.length) {
      setUploadStatus(supportsVideoUpload ? uiText("Please upload an image or video file.") : uiText("Please upload an image file."));
      return;
    }

    setIsProcessing(true);
    setVideoPreviewName('');
    setUploadStatus(uiText("Processing {value0} image{value1}...", { value0: validImageFiles.length, value1: validImageFiles.length > 1 && getUiLanguage() === 'en' ? 's' : '' }));
    setImages([]);

    try {
      const dataUrls = await Promise.all(
        validImageFiles.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target.result);
              reader.onerror = () => reject(new Error(uiText("Upload failed.")));
              reader.readAsDataURL(file);
            })
        )
      );

      setImages(dataUrls);

      const placements = await Promise.all(dataUrls.map((dataUrl) => resolveCanvasPlacement(dataUrl)));
      setUploadStatus(uiText("Upload successful! Added {value0} image{value1} to canvas.", { value0: placements.length, value1: placements.length > 1 && getUiLanguage() === 'en' ? 's' : '' }));
      setIsProcessing(false);
      if (setUploadURL) {
        setUploadURL(placements.length === 1 ? placements[0] : placements);
      }
    } catch  {
      setUploadStatus(uiText("Upload failed. Please try another image."));
      setIsProcessing(false);
    }
  };

  const handlePaste = useCallback((event) => {
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    const files = [];
    for (const item of items) {
      if (item.type.indexOf('image') === 0) {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
    if (files.length) {
      processFiles(files);
    }
  }, []);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePaste}
      className={`upload-container relative w-full max-w-[460px] overflow-x-hidden rounded-[28px] p-4 transition-colors ${shellClass}`}
    >
      <input
        id="image-upload-input"
        type="file"
        multiple
        accept={supportsVideoUpload
          ? 'image/*,image/heic,image/heif,image/webp,.heic,.heif,.webp,video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v'
          : 'image/*,image/heic,image/heif,image/webp,.heic,.heif,.webp'}
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="relative z-10 flex h-full min-h-[392px] flex-col gap-4">
        <div className="flex items-start justify-between gap-4 px-1">
          <div className="min-w-0">
            <div className={`text-micro uppercase tracking-[0.28em] ${mutedTextClass}`}>{uiText("Upload")}</div>
            <div className="mt-2 text-[24px] font-semibold leading-tight">
              {supportsVideoUpload ? uiText("Images or one video") : uiText("Images")}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <div className={`rounded-full px-3 py-1 text-caption font-medium ${isDark ? 'bg-white/8 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>{uiText("Paste ready")}</div>
            {supportsVideoUpload && (
              <div className={`rounded-full px-3 py-1 text-caption font-medium ${isDark ? 'bg-[#f6c453]/12 text-[#ffe0a3]' : 'bg-rose-50 text-rose-700'}`}>{uiText("1 video max")}</div>
            )}
          </div>
        </div>

        <label
          htmlFor="image-upload-input"
          className={`group relative flex min-h-[280px] cursor-pointer flex-col overflow-hidden rounded-[24px] border p-5 transition-all ${dropZoneClass}`}
        >
          {!isDark && (
            <div className="pointer-events-none absolute inset-0 opacity-80">
              <div className="absolute left-4 top-4 h-24 w-24 rounded-full bg-rose-200/70 blur-3xl" />
              <div className="absolute bottom-0 right-2 h-28 w-28 rounded-full bg-cyan-100/80 blur-3xl" />
            </div>
          )}

          <div className="relative z-10 flex h-full flex-col justify-between">
            <div className="flex items-start justify-between gap-4">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-semibold ${isDark ? 'bg-white/10 text-white' : 'bg-white text-slate-800 shadow-sm'}`}>
                {supportsVideoUpload ? uiText("IV") : uiText("IM")}
              </div>
              <div className={`rounded-full px-3 py-1 text-caption uppercase tracking-[0.24em] ${isDark ? 'bg-[#20232e] text-slate-300' : 'bg-white text-slate-600 shadow-sm'}`}>
                {isDragging ? uiText("Drop now") : uiText("Click or drag")}
              </div>
            </div>

            <div className="mt-10">
              <div className="text-left text-[22px] font-semibold leading-tight">
                {supportsVideoUpload ? uiText("Drop media here") : uiText("Drop images here")}
              </div>
              <div className={`mt-3 max-w-sm text-left text-sm leading-6 ${secondaryTextClass}`}>
                {supportsVideoUpload
                  ? uiText("PNG, JPG, WEBP, HEIC, HEIF, MP4, MOV, WEBM, M4V")
                  : uiText("PNG, JPG, WEBP, HEIC, HEIF")}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              <div className={`rounded-full px-3 py-1 text-caption ${isDark ? 'bg-[#20232e]/92 text-slate-300' : 'bg-white/90 text-slate-600 shadow-sm'}`}>{uiText("Multi-image")}</div>
              {supportsVideoUpload && (
                <>
                  <div className={`rounded-full px-3 py-1 text-caption ${isDark ? 'bg-[#20232e]/92 text-slate-300' : 'bg-white/90 text-slate-600 shadow-sm'}`}>{uiText("5 min max")}</div>
                  <div className={`rounded-full px-3 py-1 text-caption ${isDark ? 'bg-[#20232e]/92 text-slate-300' : 'bg-white/90 text-slate-600 shadow-sm'}`}>{uiText("2 GB")}</div>
                </>
              )}
            </div>
          </div>
        </label>

        {(images.length > 0 || videoPreviewName) && (
          <div className={`rounded-[24px] p-4 ${panelClass}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={`text-caption uppercase tracking-[0.22em] ${mutedTextClass}`}>{uiText("Preview")}</div>
                <div className="mt-1 break-all text-sm font-medium">
                  {images.length > 0
                    ? uiText("{value0} image{value1} ready", { value0: images.length, value1: images.length > 1 && getUiLanguage() === 'en' ? 's' : '' })
                    : videoPreviewName}
                </div>
              </div>
              {videoPreviewName && (
                <div className={`rounded-full px-3 py-1 text-caption font-medium ${isDark ? 'bg-white/8 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>{uiText("Video")}</div>
              )}
            </div>

            {images.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {images.slice(0, 6).map((previewUrl, index) => (
                  <div
                    key={`${previewUrl}-${index}`}
                    className={`overflow-hidden rounded-2xl ${isDark ? 'border border-[#3a4050] bg-[#151720]' : 'border border-slate-200 bg-white'} shadow-sm`}
                  >
                    <img
                      src={previewUrl}
                      alt={uiText("Preview")}
                      className="h-20 w-20 object-cover"
                    />
                  </div>
                ))}
                {images.length > 6 && (
                  <div className={`flex h-20 w-20 items-center justify-center rounded-2xl text-xs font-medium ${isDark ? 'border border-[#3a4050] bg-[#151720] text-slate-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
                    +{images.length - 6}
                  </div>
                )}
              </div>
            )}

            {!images.length && videoPreviewName && (
              <div className={`mt-4 rounded-2xl px-4 py-4 text-sm ${isDark ? 'bg-[#151720] text-slate-200 border border-[#3a4050]' : 'bg-white text-slate-700 border border-slate-200'} shadow-sm`}>
                <div className="break-all font-medium">{videoPreviewName}</div>
              </div>
            )}
          </div>
        )}

        {uploadStatus && (
          <div className={`break-words rounded-2xl border px-4 py-3 text-sm ${statusToneClass}`}>
            {uploadStatus}
          </div>
        )}
      </div>

      {isProcessing && (
        <div
          className={`absolute inset-0 z-20 flex items-center justify-center rounded-[28px] ${
            isDark ? 'bg-[#0c0d12]/80 backdrop-blur-sm' : 'bg-white/72 backdrop-blur-sm'
          }`}
        >
          <MinimalTaskSkeleton
            title={videoPreviewName ? uiText("Preparing uploaded video") : uiText("Processing upload")}
            subtitle={videoPreviewName ? uiText("Starting a background task for this layer.") : uiText("Placing your media on the canvas.")}
          />
        </div>
      )}
    </div>
  );
}
