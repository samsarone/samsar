/* eslint-disable no-restricted-globals */
let API_SERVER = '';
let STATIC_CDN_URL = 'https://static.samsar.one';
let activePreload = null;

const PRELOAD_CONCURRENCY = 2;

self.onmessage = function (event) {
  const message = event?.data || {};
  if (message.type === 'CONFIG') {
    API_SERVER = message.apiServer || '';
    STATIC_CDN_URL = message.staticCdnUrl || STATIC_CDN_URL;
    return;
  }

  if (message.type === 'CANCEL_PRELOAD') {
    if (!activePreload || activePreload.requestId !== message.requestId) {
      return;
    }
    activePreload.controller.abort();
    activePreload = null;
    return;
  }

  if (message.type !== 'PRELOAD_LAYERS' && !Array.isArray(message.layers)) {
    return;
  }

  activePreload?.controller.abort();
  const controller = new AbortController();
  const requestId = message.requestId;
  activePreload = { controller, requestId };
  void preloadLayerWindow(message.layers || [], requestId, controller);
};

async function preloadLayerWindow(layers, requestId, controller) {
  const imageUrls = collectLayerImageUrls(layers);
  let cursor = 0;
  let loadedCount = 0;

  const preloadNext = async () => {
    while (!controller.signal.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= imageUrls.length) {
        return;
      }

      try {
        const response = await fetch(imageUrls[index], {
          cache: 'force-cache',
          signal: controller.signal,
        });
        if (response.ok) {
          // Consume the response so the browser's HTTP cache can serve the
          // canvas image request. Do not clone/post the blobs to the main
          // thread; the old worker retained a second copy of every scene.
          await response.blob();
          loadedCount += 1;
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          // Preloading is best effort. The canvas still performs its own load.
        }
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(PRELOAD_CONCURRENCY, imageUrls.length) },
      () => preloadNext()
    )
  );

  if (controller.signal.aborted || activePreload?.requestId !== requestId) {
    return;
  }

  activePreload = null;
  self.postMessage({ type: 'PRELOAD_COMPLETE', requestId, loadedCount });
}

function collectLayerImageUrls(layers) {
  const seenUrls = new Set();
  const imageUrls = [];

  const addImageUrl = (asset) => {
    const imageUrl = getRemoteImageLink(asset);
    if (!imageUrl || seenUrls.has(imageUrl)) {
      return;
    }
    seenUrls.add(imageUrl);
    imageUrls.push(imageUrl);
  };

  layers.forEach((layer) => {
    const imageSession = layer?.imageSession || {};
    const activeItemList = Array.isArray(imageSession.activeItemList)
      ? imageSession.activeItemList
      : [];

    activeItemList.forEach((item) => {
      if (item?.type === 'image') {
        addImageUrl(item);
      }
    });

    if (!activeItemList.some((item) => item?.type === 'image')) {
      addImageUrl(
        imageSession.activeGeneratedImage
        || imageSession.activeEditedImage
        || imageSession.activeSelectedImage
        || imageSession.activeImageRemoteLink
      );
    }
  });

  return imageUrls;
}

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
      (parsedUrl.searchParams.has('Expires') || parsedUrl.searchParams.has('Policy'))
      && parsedUrl.searchParams.has('Signature')
      && parsedUrl.searchParams.has('Key-Pair-Id')
    );
    if (
      (normalizedHost !== 'static.samsar.one' && normalizedHost !== configuredStaticHost)
      || !(normalizedPath.startsWith('assets_v2/') || normalizedPath.startsWith('assets/'))
      || normalizedPath.startsWith('assets_v2/user_resources/')
      || normalizedPath.startsWith('user_resources/')
      || hasCloudFrontSignature
    ) {
      return null;
    }

    const normalizedApiServer = typeof API_SERVER === 'string'
      ? API_SERVER.trim().replace(/\/+$/, '')
      : '';
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

  const normalizedApiServer = typeof API_SERVER === 'string'
    ? API_SERVER.trim().replace(/\/+$/, '')
    : '';
  const normalizedPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;

  if (normalizedPath.startsWith('/video_sessions/guest_media')) {
    return normalizedApiServer ? `${normalizedApiServer}${normalizedPath}` : normalizedPath;
  }

  if (normalizedPath.startsWith('/assets_v2/') || normalizedPath.startsWith('/assets/')) {
    return normalizedApiServer ? `${normalizedApiServer}${normalizedPath}` : normalizedPath;
  }

  if (normalizedPath.includes('generation') || normalizedPath.includes('outpaint')) {
    const cleanedImagePath = normalizedPath.replace(/^\/?generations\//, '').replace(/^\//, '');
    return normalizedApiServer
      ? `${normalizedApiServer}/generations/${cleanedImagePath}`
      : `/generations/${cleanedImagePath}`;
  }

  return normalizedApiServer ? `${normalizedApiServer}${normalizedPath}` : normalizedPath;
}
