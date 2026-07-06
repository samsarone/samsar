import { useMemo, useState } from 'react';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import SecondaryButton from '../../common/SecondaryButton.tsx';
import { FaChevronLeft, FaDownload, FaEye, FaPlus } from 'react-icons/fa';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API || '';

const firstNonEmptyString = (values = []) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const resolveRawAssetSource = (asset) => {
  if (typeof asset === 'string') {
    return asset.trim();
  }
  if (!asset || typeof asset !== 'object') {
    return '';
  }
  return firstNonEmptyString([
    asset.rawSrc,
    asset.raw_src,
    asset.rawUrl,
    asset.raw_url,
    asset.assetPath,
    asset.asset_path,
    asset.src,
    asset.image,
    asset.imageUrl,
    asset.image_url,
    asset.url,
  ]);
};

const resolveDisplayAssetSource = (asset, fallbackSource = '') => {
  if (typeof asset === 'string') {
    return asset.trim();
  }
  if (!asset || typeof asset !== 'object') {
    return fallbackSource;
  }
  return firstNonEmptyString([
    asset.previewUrl,
    asset.preview_url,
    asset.signedUrl,
    asset.signed_url,
    asset.displayUrl,
    asset.display_url,
    asset.url,
    asset.imageUrl,
    asset.image_url,
    asset.src,
    asset.image,
    fallbackSource,
  ]);
};

const resolvePreviewUrl = (assetSource) => {
  if (!assetSource || typeof assetSource !== 'string') {
    return null;
  }
  const trimmed = assetSource.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const apiBase = typeof API_SERVER === 'string' ? API_SERVER.trim().replace(/\/+$/, '') : '';
  if (withLeadingSlash.startsWith('/assets_v2/') || withLeadingSlash.startsWith('/assets/')) {
    return apiBase ? `${apiBase}${withLeadingSlash}` : withLeadingSlash;
  }
  if (withLeadingSlash.startsWith('/video/') || withLeadingSlash.startsWith('/generations/')) {
    return apiBase ? `${apiBase}${withLeadingSlash}` : withLeadingSlash;
  }
  if (withLeadingSlash.includes('generation') || withLeadingSlash.includes('outpaint')) {
    const imageName = withLeadingSlash.replace(/^\/?generations\//, '').replace(/^\//, '');
    return apiBase ? `${apiBase}/generations/${imageName}` : `/generations/${imageName}`;
  }
  return apiBase ? `${apiBase}${withLeadingSlash}` : withLeadingSlash;
};

const normalizeSelectionSource = (previewUrl) => {
  if (typeof previewUrl !== 'string') {
    return previewUrl;
  }
  const apiBase = typeof API_SERVER === 'string' ? API_SERVER.trim().replace(/\/+$/, '') : '';
  if (apiBase && previewUrl.startsWith(apiBase)) {
    const stripped = previewUrl.slice(apiBase.length);
    if (stripped.startsWith('/')) {
      return stripped;
    }
    return stripped ? `/${stripped}` : '/';
  }
  return previewUrl;
};

const resolveAssetDimension = (asset, keyList = []) => {
  if (!asset || typeof asset !== 'object') {
    return undefined;
  }

  for (const key of keyList) {
    const value = key.split('.').reduce((acc, part) => acc?.[part], asset);
    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
  }

  return undefined;
};

const resolveAssetAspectRatio = (asset) => {
  const explicitRatio = resolveAssetDimension(asset, ['aspectRatio', 'aspect_ratio']);
  if (explicitRatio) {
    return explicitRatio;
  }

  const width = resolveAssetDimension(asset, ['width', 'naturalWidth', 'imageWidth', 'metadata.width']);
  const height = resolveAssetDimension(asset, ['height', 'naturalHeight', 'imageHeight', 'metadata.height']);
  return width && height ? width / height : undefined;
};

const resolveAssetFilename = (asset, fallbackUrl) => {
  const explicitName = firstNonEmptyString([
    asset?.fileName,
    asset?.filename,
    asset?.name,
    asset?.title,
  ]);
  if (explicitName) {
    return explicitName;
  }

  try {
    const parsedUrl = new URL(fallbackUrl, window.location.origin);
    const urlName = decodeURIComponent(parsedUrl.pathname.split('/').filter(Boolean).pop() || '');
    return urlName || 'library-image.png';
  } catch  {
    return 'library-image.png';
  }
};

export default function ImageLibraryHome(props) {
  const {
    generationImages = [],
    globalGenerationImages = [],
    globalPagination = {},
    onGlobalPageChange,
    isGlobalLoading = false,
    globalError = null,
    selectImageFromLibrary,
    showStudioBackButton = false,
    onBackToStudio,
  } = props;
  const [selectedImage, setSelectedImage] = useState(null);
  const [isSelectingImage, setIsSelectingImage] = useState(false);
  const [downloadingImageKey, setDownloadingImageKey] = useState(null);
  const { colorMode } = useColorMode();

  const currentSessionAssets = useMemo(
    () => (Array.isArray(generationImages) ? generationImages : []),
    [generationImages]
  );
  const globalAssets = useMemo(
    () => (Array.isArray(globalGenerationImages) ? globalGenerationImages : []),
    [globalGenerationImages]
  );

  const handleImageClick = (imageLink) => {
    setSelectedImage(imageLink);
  };

  const handleView = (previewLink) => {
    if (!previewLink) {
      return;
    }
    window.open(previewLink, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = async ({ previewLink, asset, selectedKey }) => {
    if (!previewLink || downloadingImageKey) {
      return;
    }

    setDownloadingImageKey(selectedKey);
    const filename = resolveAssetFilename(asset, previewLink);
    try {
      const response = await fetch(previewLink, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) {
        throw new Error('Download request failed');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch  {
      const link = document.createElement('a');
      link.href = previewLink;
      link.download = filename;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setDownloadingImageKey(null);
    }
  };

  const handleSelect = async (imageLink, selectionMeta = {}) => {
    const imagePath = normalizeSelectionSource(imageLink);
    if (typeof selectImageFromLibrary !== 'function' || isSelectingImage) {
      return;
    }

    setIsSelectingImage(true);
    try {
      await selectImageFromLibrary(imagePath, selectionMeta);
      setSelectedImage(null);
    } catch  {
    } finally {
      setIsSelectingImage(false);
    }
  };

  const panelSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d]'
      : 'bg-white text-slate-900 border border-slate-200';
  const sectionSurface =
    colorMode === 'dark'
      ? 'bg-[#0b1226] border border-[#1f2a3d]'
      : 'bg-slate-50 border border-slate-200';
  const tileSurface =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] hover:border-rose-300/40'
      : 'bg-white border border-slate-200 hover:border-rose-300';
  const selectedTileSurface =
    colorMode === 'dark'
      ? 'border-sky-400/60 ring-2 ring-sky-400/25'
      : 'border-sky-400 ring-2 ring-sky-200';
  const actionButton =
    colorMode === 'dark'
      ? 'border border-[#2b3853] bg-[#0f1629] text-slate-200 hover:bg-[#17233a] disabled:opacity-50'
      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50';
  const paginationButton =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-200 hover:bg-[#16213a] disabled:opacity-50'
      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-50';
  const helperText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const backButtonStyle =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-100 hover:bg-[#16213a]'
      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100';
  const headerSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629]/95 border-b border-[#1f2a3d]'
      : 'bg-white/95 border-b border-slate-200';

  const renderAssetsGrid = (assets, sectionKey, emptyMessage) => {
    const cards = assets
      .map((asset, index) => {
        const rawSource = resolveRawAssetSource(asset);
        const displaySource = resolveDisplayAssetSource(asset, rawSource);
        const previewLink = resolvePreviewUrl(displaySource);
        const selectionSource = rawSource || displaySource;
        if (!previewLink) {
          return null;
        }
        const selectionPath = normalizeSelectionSource(selectionSource);
        const selectedKey = `${sectionKey}-${selectionPath || previewLink}-${index}`;
        const assetAspectRatio = resolveAssetAspectRatio(asset);
        const assetWidth = resolveAssetDimension(asset, ['width', 'naturalWidth', 'imageWidth', 'metadata.width']);
        const assetHeight = resolveAssetDimension(asset, ['height', 'naturalHeight', 'imageHeight', 'metadata.height']);
        return (
          <div
            key={selectedKey}
            className={`mb-3 break-inside-avoid overflow-hidden rounded-lg transition-all ${tileSurface} ${
              selectedImage === selectedKey ? selectedTileSurface : ''
            }`}
          >
            <button
              type="button"
              onClick={() => handleImageClick(selectedKey)}
              className="block w-full bg-transparent p-0 text-left"
              title="Focus image"
              aria-label="Focus image"
            >
              <img
                src={previewLink}
                alt="library asset"
                width={assetWidth}
                height={assetHeight}
                style={assetAspectRatio ? { aspectRatio: `${assetAspectRatio}` } : undefined}
                className="block h-auto w-full object-cover"
              />
            </button>
            <div className="flex items-center gap-1.5 p-2">
              <button
                type="button"
                onClick={() => handleView(previewLink)}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-xs transition ${actionButton}`}
                title="View"
                aria-label="View image"
              >
                <FaEye />
              </button>
              <button
                type="button"
                onClick={() => void handleDownload({ previewLink, asset, selectedKey })}
                disabled={downloadingImageKey === selectedKey}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-xs transition ${actionButton}`}
                title="Download"
                aria-label="Download image"
              >
                <FaDownload />
              </button>
              <div className="min-w-0 flex-1" />
              <SecondaryButton
                onClick={() => {
                  void handleSelect(selectionPath || previewLink, {
                    asset,
                    previewUrl: previewLink,
                    rawSrc: selectionPath,
                    source: selectionPath,
                  });
                }}
                disabled={isSelectingImage}
                className="h-8 justify-center gap-1.5 px-2 text-xs"
                title="Select"
                aria-label="Select image"
              >
                <FaPlus className="text-[10px]" />
                <span>{isSelectingImage ? 'Adding...' : 'Select'}</span>
              </SecondaryButton>
            </div>
          </div>
        );
      })
      .filter(Boolean);

    if (!cards.length) {
      return <div className={`text-xs ${helperText}`}>{emptyMessage}</div>;
    }

    return <div className="columns-1 gap-3 sm:columns-2 xl:columns-3 2xl:columns-4">{cards}</div>;
  };

  const page = Number.isFinite(globalPagination.page) ? globalPagination.page : 1;
  const totalPages = Number.isFinite(globalPagination.totalPages) ? globalPagination.totalPages : 1;
  const hasPreviousPage = Boolean(globalPagination.hasPreviousPage);
  const hasNextPage = Boolean(globalPagination.hasNextPage);

  return (
    <div className={`w-full h-full overflow-y-auto px-3 pb-4 pt-6 lg:pt-8 ${panelSurface}`}>
      {showStudioBackButton && (
        <div className={`sticky top-0 z-10 -mx-3 mb-4 flex items-center gap-3 px-3 pb-3 pt-2 backdrop-blur ${headerSurface}`}>
          <button
            type="button"
            onClick={onBackToStudio}
            className={`inline-flex items-center gap-2 text-sm px-3 py-2 rounded-md transition ${backButtonStyle}`}
          >
            <FaChevronLeft className="text-xs" />
            <span>Back to Studio</span>
          </button>
          <div className="text-sm font-semibold">Image Library</div>
        </div>
      )}

      <div className={`rounded-xl p-3 ${sectionSurface}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Current Session</div>
          <div className={`text-[11px] ${helperText}`}>
            {currentSessionAssets.length} items
          </div>
        </div>
        {renderAssetsGrid(
          currentSessionAssets,
          'current-session',
          'No generated or edited assets yet in this session.'
        )}
      </div>

      <div className={`rounded-xl p-3 mt-3 ${sectionSurface}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Global Sessions</div>
          <div className={`text-[11px] ${helperText}`}>{globalAssets.length} items</div>
        </div>
        <div className={`mb-2 text-[11px] ${helperText}`}>
          Page {page} of {Math.max(1, totalPages)}
        </div>

        {isGlobalLoading ? (
          <div className={`text-xs ${helperText}`}>Loading assets...</div>
        ) : globalError ? (
          <div className="text-xs text-rose-500">{globalError}</div>
        ) : (
          renderAssetsGrid(
            globalAssets,
            'global-session',
            'No assets found in other sessions.'
          )
        )}

        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            type="button"
            className={`text-xs px-2 py-1 rounded-md transition ${paginationButton}`}
            disabled={isGlobalLoading || !hasPreviousPage}
            onClick={() => onGlobalPageChange?.(Math.max(1, page - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className={`text-xs px-2 py-1 rounded-md transition ${paginationButton}`}
            disabled={isGlobalLoading || !hasNextPage}
            onClick={() => onGlobalPageChange?.(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
