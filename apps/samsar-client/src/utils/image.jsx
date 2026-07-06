const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
const STATIC_CDN_URL = import.meta.env.VITE_STATIC_CDN_URL || 'https://static.samsar.one';

function firstImageUrlValue(values = []) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function resolveProcessorAssetUrlFromStaticUrl(value, apiServer = API_SERVER) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsedUrl = new URL(value.trim());
    const normalizedHost = parsedUrl.hostname.toLowerCase();
    const configuredStaticHost = new URL(STATIC_CDN_URL).hostname.toLowerCase();
    const normalizedPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
    const hasCloudFrontSignature = (
      (parsedUrl.searchParams.has('Expires') || parsedUrl.searchParams.has('Policy')) &&
      parsedUrl.searchParams.has('Signature') &&
      parsedUrl.searchParams.has('Key-Pair-Id')
    );
    if (
      (normalizedHost !== 'static.samsar.one' && normalizedHost !== configuredStaticHost) ||
      !(
        normalizedPath.startsWith('assets_v2/') ||
        normalizedPath.startsWith('assets/')
      )
    ) {
      return null;
    }
    if (hasCloudFrontSignature) {
      return null;
    }

    const normalizedApiServer = typeof apiServer === 'string'
      ? apiServer.trim().replace(/\/+$/, '')
      : '';
    return normalizedApiServer ? `${normalizedApiServer}/${normalizedPath}` : `/${normalizedPath}`;
  } catch {
    return null;
  }
}

export function getRenderableImageUrl(asset, apiServer = API_SERVER) {
  const imagePath = typeof asset === 'string'
    ? asset
    : firstImageUrlValue([
      asset?.previewUrl,
      asset?.preview_url,
      asset?.signedUrl,
      asset?.signed_url,
      asset?.displayUrl,
      asset?.display_url,
      asset?.url,
      asset?.imageUrl,
      asset?.image_url,
      asset?.src,
      asset?.image,
    ]);

  if (!imagePath) {
    return '';
  }

  if (/^(https?:|data:|blob:)/i.test(imagePath)) {
    return resolveProcessorAssetUrlFromStaticUrl(imagePath, apiServer) || imagePath;
  }

  const normalizedApiServer = typeof apiServer === 'string'
    ? apiServer.trim().replace(/\/+$/, '')
    : '';
  const normalizedPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;

  if (normalizedPath.startsWith('/video_sessions/guest_media')) {
    return normalizedApiServer ? `${normalizedApiServer}${normalizedPath}` : normalizedPath;
  }

  if (normalizedPath.startsWith('/assets_v2/') || normalizedPath.startsWith('/assets/')) {
    return normalizedApiServer ? `${normalizedApiServer}${normalizedPath}` : normalizedPath;
  }

  if (normalizedPath.includes('generation') || normalizedPath.includes('outpaint')) {
    // Remove "/generations/" from imagePath if it exists
    const cleanedImagePath = normalizedPath.replace(/^\/?generations\//, '').replace(/^\//, '');
    return normalizedApiServer
      ? `${normalizedApiServer}/generations/${cleanedImagePath}`
      : `/generations/${cleanedImagePath}`;
  }

  return normalizedApiServer ? `${normalizedApiServer}${normalizedPath}` : normalizedPath;
}
