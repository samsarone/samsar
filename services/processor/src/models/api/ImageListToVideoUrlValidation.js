export const BLOCKED_IMAGE_LIST_TO_VIDEO_URL_MESSAGE =
  'image_urls contains a URL that cannot be fetched server-side. Please provide a direct, publicly accessible image URL instead of a redirect page URL.';

export function isBlockedImageListToVideoImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value.trim());
  } catch (_) {
    return false;
  }

  const pathname = decodeURIComponent(parsedUrl.pathname || '');
  return /^\/wiki\/Special:Redirect\/file\//i.test(pathname);
}

export function assertImageListToVideoUrlsAreFetchable(imageUrls = []) {
  const blockedUrl = imageUrls.find((url) => isBlockedImageListToVideoImageUrl(url));
  if (!blockedUrl) {
    return;
  }

  const error = new Error(BLOCKED_IMAGE_LIST_TO_VIDEO_URL_MESSAGE);
  error.status = 400;
  error.code = 'BLOCKED_IMAGE_LIST_TO_VIDEO_IMAGE_URL';
  error.blocked_url = blockedUrl;
  throw error;
}
