import { useState, useCallback } from 'react';
import { fitDimensionsToCanvas, normalizeCanvasDimensions } from '../../utils/canvas.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import MinimalTaskSkeleton from '../common/MinimalTaskSkeleton.jsx';

const MAX_UPLOADED_VIDEO_DURATION_SECONDS = 5 * 60;
const MAX_UPLOADED_VIDEO_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

export default function ImageUploadDialog({ setUploadURL, setUploadVideo, aspectRatio, canvasDimensions }) {
  const [images, setImages] = useState([]);
  const [videoPreviewName, setVideoPreviewName] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { colorMode } = useColorMode();
  const supportsVideoUpload = typeof setUploadVideo === 'function';
  const isDark = colorMode === 'dark';

  const shellClass = isDark
    ? 'border border-[#1d2940] bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.12),transparent_34%),linear-gradient(180deg,#0b1220_0%,#0f1729_100%)] text-slate-100 shadow-[0_30px_90px_rgba(2,6,23,0.55)]'
    : 'border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(251,113,133,0.12),transparent_30%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] text-slate-800 shadow-[0_24px_70px_rgba(15,23,42,0.12)]';
  const panelClass = isDark
    ? 'border border-[#1f2a3d] bg-[#0f1629]/88'
    : 'border border-slate-200 bg-white/92';
  const mutedTextClass = isDark ? 'text-slate-400' : 'text-slate-500';
  const secondaryTextClass = isDark ? 'text-slate-300' : 'text-slate-600';
  const dropZoneClass = isDark
    ? isDragging
      ? 'border-rose-400 bg-rose-500/10 shadow-[0_0_0_1px_rgba(251,113,133,0.35)]'
      : 'border-[#32415d] bg-[#0b1322]/85 hover:border-[#4a5d83] hover:bg-[#10192d]'
    : isDragging
      ? 'border-rose-500 bg-rose-50 shadow-[0_0_0_1px_rgba(244,63,94,0.15)]'
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
        reject(new Error('Unable to read video metadata.'));
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
        reject(new Error('Missing data URL'));
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
        reject(new Error('Unable to read image'));
      };
      img.src = dataUrl;
    });

  const processFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) {
      setUploadStatus(supportsVideoUpload ? 'Please upload an image or video file.' : 'Please upload an image file.');
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
      setUploadStatus('Upload images or one video at a time.');
      return;
    }

    if (validVideoFiles.length > 0) {
      if (validVideoFiles.length > 1) {
        setUploadStatus('Please upload a single video file.');
        return;
      }

      const [videoFile] = validVideoFiles;
      setIsProcessing(true);
      setImages([]);
      setVideoPreviewName(videoFile.name || 'Uploaded video');
      setUploadStatus('Validating video...');

      try {
        if (videoFile.size > MAX_UPLOADED_VIDEO_FILE_SIZE_BYTES) {
          throw new Error('Video uploads must be 2 GB or smaller.');
        }

        const { duration } = await resolveVideoMetadata(videoFile);
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error('Unable to determine video duration.');
        }
        if (duration > MAX_UPLOADED_VIDEO_DURATION_SECONDS) {
          throw new Error(`Video uploads must be ${MAX_UPLOADED_VIDEO_DURATION_SECONDS} seconds or shorter.`);
        }

        setUploadStatus('Uploading video...');
        await setUploadVideo(videoFile);
        setUploadStatus('Video uploaded successfully.');
      } catch (error) {
        setUploadStatus(error?.message || 'Video upload failed. Please try another file.');
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (!validImageFiles.length) {
      setUploadStatus(supportsVideoUpload ? 'Please upload an image or video file.' : 'Please upload an image file.');
      return;
    }

    setIsProcessing(true);
    setVideoPreviewName('');
    setUploadStatus(`Processing ${validImageFiles.length} image${validImageFiles.length > 1 ? 's' : ''}...`);
    setImages([]);

    try {
      const dataUrls = await Promise.all(
        validImageFiles.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target.result);
              reader.onerror = () => reject(new Error('Upload failed.'));
              reader.readAsDataURL(file);
            })
        )
      );

      setImages(dataUrls);

      const placements = await Promise.all(dataUrls.map((dataUrl) => resolveCanvasPlacement(dataUrl)));
      setUploadStatus(`Upload successful! Added ${placements.length} image${placements.length > 1 ? 's' : ''} to canvas.`);
      setIsProcessing(false);
      if (setUploadURL) {
        setUploadURL(placements.length === 1 ? placements[0] : placements);
      }
    } catch  {
      setUploadStatus('Upload failed. Please try another image.');
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
            <div className={`text-[10px] uppercase tracking-[0.28em] ${mutedTextClass}`}>
              Upload
            </div>
            <div className="mt-2 text-[24px] font-semibold leading-tight">
              {supportsVideoUpload ? 'Images or one video' : 'Images'}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${isDark ? 'bg-white/8 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
              Paste ready
            </div>
            {supportsVideoUpload && (
              <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${isDark ? 'bg-rose-500/14 text-rose-100' : 'bg-rose-50 text-rose-700'}`}>
                1 video max
              </div>
            )}
          </div>
        </div>

        <label
          htmlFor="image-upload-input"
          className={`group relative flex min-h-[280px] cursor-pointer flex-col overflow-hidden rounded-[24px] border p-5 transition-all ${dropZoneClass}`}
        >
          <div className="pointer-events-none absolute inset-0 opacity-80">
            <div className={`absolute left-4 top-4 h-24 w-24 rounded-full blur-3xl ${isDark ? 'bg-rose-500/20' : 'bg-rose-200/70'}`} />
            <div className={`absolute bottom-0 right-2 h-28 w-28 rounded-full blur-3xl ${isDark ? 'bg-cyan-500/10' : 'bg-cyan-100/80'}`} />
          </div>

          <div className="relative z-10 flex h-full flex-col justify-between">
            <div className="flex items-start justify-between gap-4">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-semibold ${isDark ? 'bg-white/10 text-white' : 'bg-white text-slate-800 shadow-sm'}`}>
                {supportsVideoUpload ? 'IV' : 'IM'}
              </div>
              <div className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${isDark ? 'bg-[#111a2f] text-slate-300' : 'bg-white text-slate-600 shadow-sm'}`}>
                {isDragging ? 'Drop now' : 'Click or drag'}
              </div>
            </div>

            <div className="mt-10">
              <div className="text-left text-[22px] font-semibold leading-tight">
                {supportsVideoUpload ? 'Drop media here' : 'Drop images here'}
              </div>
              <div className={`mt-3 max-w-sm text-left text-sm leading-6 ${secondaryTextClass}`}>
                {supportsVideoUpload
                  ? 'PNG, JPG, WEBP, HEIC, HEIF, MP4, MOV, WEBM, M4V'
                  : 'PNG, JPG, WEBP, HEIC, HEIF'}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              <div className={`rounded-full px-3 py-1 text-[11px] ${isDark ? 'bg-[#111a2f]/92 text-slate-300' : 'bg-white/90 text-slate-600 shadow-sm'}`}>
                Multi-image
              </div>
              {supportsVideoUpload && (
                <>
                  <div className={`rounded-full px-3 py-1 text-[11px] ${isDark ? 'bg-[#111a2f]/92 text-slate-300' : 'bg-white/90 text-slate-600 shadow-sm'}`}>
                    5 min max
                  </div>
                  <div className={`rounded-full px-3 py-1 text-[11px] ${isDark ? 'bg-[#111a2f]/92 text-slate-300' : 'bg-white/90 text-slate-600 shadow-sm'}`}>
                    2 GB
                  </div>
                </>
              )}
            </div>
          </div>
        </label>

        {(images.length > 0 || videoPreviewName) && (
          <div className={`rounded-[24px] p-4 ${panelClass}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={`text-[11px] uppercase tracking-[0.22em] ${mutedTextClass}`}>Preview</div>
                <div className="mt-1 break-all text-sm font-medium">
                  {images.length > 0
                    ? `${images.length} image${images.length > 1 ? 's' : ''} ready`
                    : videoPreviewName}
                </div>
              </div>
              {videoPreviewName && (
                <div className={`rounded-full px-3 py-1 text-[11px] font-medium ${isDark ? 'bg-white/8 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>
                  Video
                </div>
              )}
            </div>

            {images.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {images.slice(0, 6).map((previewUrl, index) => (
                  <div
                    key={`${previewUrl}-${index}`}
                    className={`overflow-hidden rounded-2xl ${isDark ? 'border border-[#22314b] bg-[#0b1322]' : 'border border-slate-200 bg-white'} shadow-sm`}
                  >
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="h-20 w-20 object-cover"
                    />
                  </div>
                ))}
                {images.length > 6 && (
                  <div className={`flex h-20 w-20 items-center justify-center rounded-2xl text-xs font-medium ${isDark ? 'border border-[#22314b] bg-[#0b1322] text-slate-300' : 'border border-slate-200 bg-white text-slate-600'}`}>
                    +{images.length - 6}
                  </div>
                )}
              </div>
            )}

            {!images.length && videoPreviewName && (
              <div className={`mt-4 rounded-2xl px-4 py-4 text-sm ${isDark ? 'bg-[#0b1322] text-slate-200 border border-[#22314b]' : 'bg-white text-slate-700 border border-slate-200'} shadow-sm`}>
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
            isDark ? 'bg-[#09101d]/78 backdrop-blur-sm' : 'bg-white/72 backdrop-blur-sm'
          }`}
        >
          <MinimalTaskSkeleton
            title={videoPreviewName ? 'Preparing uploaded video' : 'Processing upload'}
            subtitle={videoPreviewName ? 'Starting a background task for this layer.' : 'Placing your media on the canvas.'}
          />
        </div>
      )}
    </div>
  );
}
