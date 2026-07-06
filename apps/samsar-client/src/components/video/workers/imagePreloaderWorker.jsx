/* eslint-disable no-restricted-globals */
let API_SERVER = '';
let STATIC_CDN_URL = 'https://static.samsar.one';

self.onmessage = async function (e) {
  if (e?.data?.type === 'CONFIG') {
    API_SERVER = e.data.apiServer || '';
    STATIC_CDN_URL = e.data.staticCdnUrl || STATIC_CDN_URL;
    return;
  }

  const { layers } = e.data;

  const fetchPromises = layers.flatMap(layer => {
    if (layer.imageSession?.generationStatus === 'COMPLETED') {
      return layer.imageSession?.activeItemList.map(function (item) {
        if (item.type === 'image') {
          const itemUrl = getRemoteImageLink(item);
          if (!itemUrl) {
            return null;
          }
          return fetch(itemUrl)
            .then((response) => (response.ok ? response.blob() : null))
            .catch(() => null);
        }
        return null;
      }).filter(promise => promise !== null) || [];
    }
    return [];
  });

  const fetchedImages = (await Promise.all(fetchPromises)).filter(Boolean);
  self.postMessage({ fetchedImages });
};

function firstImageUrlValue(values = []) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function resolveProcessorAssetUrlFromStaticUrl(value) {
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
    if (
      normalizedPath.startsWith('assets_v2/user_resources/') ||
      normalizedPath.startsWith('user_resources/')
    ) {
      return null;
    }
    if (hasCloudFrontSignature) {
      return null;
    }

    const normalizedApiServer = typeof API_SERVER === 'string' ? API_SERVER.trim().replace(/\/+$/, '') : '';
    return normalizedApiServer ? `${normalizedApiServer}/${normalizedPath}` : `/${normalizedPath}`;
  } catch {
    return null;
  }
}

function getRemoteImageLink(asset) {
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
    return resolveProcessorAssetUrlFromStaticUrl(imagePath) || imagePath;
  }

  const normalizedApiServer = typeof API_SERVER === 'string' ? API_SERVER.trim().replace(/\/+$/, '') : '';
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
