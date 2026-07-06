import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getHeaders } from '../../utils/web';
import { useAlertDialog } from '../../contexts/AlertDialogContext';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import SecondaryButton from '../common/SecondaryButton.tsx';

const PROCESSOR_API = import.meta.env.VITE_PROCESSOR_API;
const DEFAULT_PAGE_SIZE = 20;

function getProcessorApiBaseUrl() {
  return typeof PROCESSOR_API === 'string' ? PROCESSOR_API.trim().replace(/\/+$/, '') : '';
}

function isAbsoluteAssetUrl(value) {
  return typeof value === 'string' && /^(https?:|data:|blob:)/i.test(value.trim());
}

function firstNonEmptyString(values = []) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function resolveImageAssetUrl(image = {}) {
  const rawPath = firstNonEmptyString([
    image.displayUrl,
    image.imageUrl,
    image.assetPath,
    image.thumbnailPath,
    image.thumbnail,
    image.url,
  ]);

  if (!rawPath) {
    return null;
  }

  const trimmedPath = rawPath.trim();
  if (isAbsoluteAssetUrl(trimmedPath)) {
    return trimmedPath;
  }
  if (trimmedPath.startsWith('//')) {
    return `https:${trimmedPath}`;
  }

  const baseUrl = getProcessorApiBaseUrl();
  const relativePath = trimmedPath.replace(/^\/+/, '');
  const normalizedPath = relativePath.includes('/')
    ? `/${relativePath.replace(/^assets\/generations\//, 'generations/')}`
    : `/generations/${relativePath}`;

  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export default function ImagePanelContent() {
  const [images, setImages] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    totalPages: 1,
    totalItems: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const { openAlertDialog } = useAlertDialog();
  const { colorMode } = useColorMode();

  const textColor = colorMode === "dark" ? "text-slate-100" : "text-slate-900";
  const secondaryTextColor = colorMode === "dark" ? "text-slate-400" : "text-slate-600";
  const cardBgColor = colorMode === "dark" ? "bg-[#0f1629]" : "bg-white";
  const borderColor = colorMode === "dark" ? "border-[#1f2a3d]" : "border-slate-200";
  const mutedBg = colorMode === "dark" ? "bg-[#0b1224]" : "bg-slate-50";

  const fetchImages = useCallback(
    async (pageToLoad = 1) => {
      const headers = getHeaders();
      const config = {
        ...(headers || {}),
        params: {
          page: pageToLoad,
          pageSize: DEFAULT_PAGE_SIZE,
        },
      };

      try {
        setIsLoading(true);
        setError(null);
        const res = await axios.get(
          `${PROCESSOR_API}/accounts/user_image_generations`,
          config
        );

        const data = res.data ?? {};
        const items = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data)
            ? data
            : [];

        setImages(items);
        const paginationData = data.pagination || {};
        setPagination({
          page: paginationData.page ?? pageToLoad,
          pageSize: paginationData.pageSize ?? DEFAULT_PAGE_SIZE,
          totalPages: paginationData.totalPages ?? 1,
          totalItems: paginationData.totalItems ?? items.length,
          hasNextPage: paginationData.hasNextPage ?? false,
          hasPreviousPage: paginationData.hasPreviousPage ?? false,
        });
      } catch (err) {
        console.error('Failed to load user images', err);
        setImages([]);
        setPagination((prev) => ({
          ...prev,
          page: pageToLoad,
          totalPages: 1,
          totalItems: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        }));
        setError('Unable to load your images right now.');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchImages(1);
  }, [fetchImages]);

  const handleImageClick = (image) => {
    const imageUrl = resolveImageAssetUrl(image);
    const adComponent = (
      <div className={`space-y-4 ${textColor}`}>
        <div className="flex justify-between items-center">
          <a
            href={imageUrl || '#'}
            download
            className="inline-flex items-center rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
          >
            Download image
          </a>
        </div>

        <img
          src={imageUrl || ''}
          alt={image.prompt}
          className="w-full h-full object-cover rounded-xl border shadow-sm"
        />
        <p className={`mt-2 text-sm rounded-lg border ${borderColor} ${mutedBg} ${secondaryTextColor} p-4`}>
          {image.prompt}
        </p>
      </div>
    );
    openAlertDialog(adComponent);
  };

  const handlePageChange = (nextPage) => {
    if (nextPage < 1) return;
    if (pagination.totalPages && nextPage > pagination.totalPages) return;
    fetchImages(nextPage);
  };

  return (
    <div className={`min-w-0 space-y-4 ${textColor}`}>
      {error && <div className="mb-4 text-sm text-red-500">{error}</div>}
      <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-3 shadow-sm sm:p-4`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isLoading && (
            <div className={`col-span-full text-center text-sm ${secondaryTextColor}`}>Loading images…</div>
          )}
          {!isLoading && images.length === 0 && (
            <div className={`col-span-full text-center text-sm ${secondaryTextColor}`}>
              No images found yet.
            </div>
          )}
          {images.map((image) => {
            const imageUrl = resolveImageAssetUrl(image);
            return (
              <div
                key={image._id}
                className={`cursor-pointer rounded-lg overflow-hidden border ${borderColor} ${cardBgColor} shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
                onClick={() => handleImageClick(image)}
              >
                <img
                  src={imageUrl || ''}
                  alt={image.prompt}
                  className="w-full aspect-square object-cover"
                />
                <div className={`border-t ${borderColor} px-3 py-2`}>
                  <p className={`text-sm ${secondaryTextColor} truncate`}>
                    {image.prompt ? `${image.prompt.split(' ').slice(0, 6).join(' ')}...` : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className={`text-sm ${secondaryTextColor}`}>
          Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.totalItems} total
        </span>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <SecondaryButton
            disabled={!pagination.hasPreviousPage && pagination.page <= 1}
            onClick={() => handlePageChange(pagination.page - 1)}
            extraClasses="px-4 py-2"
            className="w-full sm:w-auto"
          >
            Previous
          </SecondaryButton>
          <SecondaryButton
            disabled={!pagination.hasNextPage && pagination.page >= pagination.totalPages}
            onClick={() => handlePageChange(pagination.page + 1)}
            extraClasses="px-4 py-2"
            className="w-full sm:w-auto"
          >
            Next
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}
