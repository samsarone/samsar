const VIDEO_LAYER_CANDIDATES = [
  {
    type: 'lip_sync',
    preferredField: 'hasLipSyncVideoLayer',
    assetField: 'lipSyncVideoLayer',
    remoteField: 'lipSyncRemoteLink',
    rawRemoteField: 'rawLipSyncRemoteLink',
    structuredField: 'lipSyncVideo',
  },
  {
    type: 'sound_effect',
    preferredField: 'hasSoundEffectVideoLayer',
    assetField: 'soundEffectVideoLayer',
    remoteField: 'soundEffectRemoteLink',
    rawRemoteField: 'rawSoundEffectRemoteLink',
    structuredField: 'soundEffectVideo',
  },
  {
    type: 'user_video',
    preferredField: 'hasUserVideoLayer',
    assetField: 'userVideoLayer',
    remoteField: 'userVideoRemoteLink',
    rawRemoteField: 'rawUserVideoRemoteLink',
    structuredField: 'userVideo',
  },
  {
    type: 'ai_video',
    preferredField: 'hasAiVideoLayer',
    assetField: 'aiVideoLayer',
    remoteField: 'aiVideoRemoteLink',
    rawRemoteField: 'rawAiVideoRemoteLink',
    structuredField: 'aiVideo',
  },
];

function normalizeBaseUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function firstString(values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

export function isStudioVideoSourceReady(currentVideoSource, readyVideoSource) {
  const currentSource = firstString([currentVideoSource]);
  return Boolean(currentSource && currentSource === firstString([readyVideoSource]));
}

export function canPreloadNextStudioVideo(currentVideoSource, readyVideoSource) {
  return !firstString([currentVideoSource])
    || isStudioVideoSourceReady(currentVideoSource, readyVideoSource);
}

export function shouldSuppressStudioBaseImage(item, currentVideoSource, readyVideoSource) {
  return isStudioVideoSourceReady(currentVideoSource, readyVideoSource)
    && item?.type === 'image'
    && (item?.is_base_image === true || item?.isBaseImage === true);
}

function isAbsoluteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function isStaticCdnHost(hostname, staticCdnUrl) {
  if (typeof hostname !== 'string') {
    return false;
  }

  const normalizedHost = hostname.toLowerCase();
  if (normalizedHost === 'static.samsar.one') {
    return true;
  }

  try {
    return Boolean(staticCdnUrl)
      && normalizedHost === new URL(staticCdnUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
}

function isRemoteUserResourcePath(pathname) {
  return pathname.startsWith('assets_v2/user_resources/')
    || pathname.startsWith('user_resources/');
}

export function isCloudFrontSignedVideoUrl(value) {
  if (!isAbsoluteUrl(value)) {
    return false;
  }

  try {
    const parsedUrl = new URL(value.trim());
    return (
      (parsedUrl.searchParams.has('Expires') || parsedUrl.searchParams.has('Policy'))
      && parsedUrl.searchParams.has('Signature')
      && parsedUrl.searchParams.has('Key-Pair-Id')
    );
  } catch {
    return false;
  }
}

function resolveProcessorAssetUrlFromStaticUrl(value, options) {
  if (!isAbsoluteUrl(value)) {
    return null;
  }

  const { processorApiUrl = '', staticCdnUrl = '' } = options;
  try {
    const parsedUrl = new URL(value.trim());
    const normalizedPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
    if (
      !isStaticCdnHost(parsedUrl.hostname, staticCdnUrl)
      || !(normalizedPath.startsWith('assets_v2/') || normalizedPath.startsWith('assets/'))
      || isRemoteUserResourcePath(normalizedPath)
      || isCloudFrontSignedVideoUrl(value)
    ) {
      return null;
    }

    const processorBaseUrl = normalizeBaseUrl(processorApiUrl);
    return processorBaseUrl
      ? `${processorBaseUrl}/${normalizedPath}`
      : `/${normalizedPath}`;
  } catch {
    return null;
  }
}

function looksLikeStudioVideoRoute(value) {
  return typeof value === 'string' && /^\/?video\/[a-f0-9]{24}$/i.test(value.trim());
}

export function resolveStudioMediaUrl(value, baseUrl = '', options = {}) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue || looksLikeStudioVideoRoute(trimmedValue)) {
    return null;
  }
  if (/^(data:|blob:)/i.test(trimmedValue)) {
    return trimmedValue;
  }
  if (isAbsoluteUrl(trimmedValue)) {
    return resolveProcessorAssetUrlFromStaticUrl(trimmedValue, options) || trimmedValue;
  }

  const normalizedPath = trimmedValue.startsWith('/') ? trimmedValue : `/${trimmedValue}`;
  if (normalizedPath.startsWith('/video_sessions/guest_media')) {
    const processorBaseUrl = normalizeBaseUrl(options.processorApiUrl);
    return processorBaseUrl ? `${processorBaseUrl}${normalizedPath}` : normalizedPath;
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return normalizedBaseUrl ? `${normalizedBaseUrl}${normalizedPath}` : normalizedPath;
}

function getSessionId(sessionDetails = {}) {
  return (
    sessionDetails?._id?.toString?.()
    || sessionDetails?._id
    || sessionDetails?.id?.toString?.()
    || sessionDetails?.id
    || sessionDetails?.sessionId?.toString?.()
    || sessionDetails?.sessionId
    || ''
  );
}

function getMediaAssetPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const trimmedValue = value.trim();
  if (/^(data:|blob:)/i.test(trimmedValue) || trimmedValue.includes('/video_sessions/guest_media')) {
    return '';
  }
  if (isAbsoluteUrl(trimmedValue)) {
    try {
      const parsedUrl = new URL(trimmedValue);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      return pathname.startsWith('assets_v2/') ? pathname : '';
    } catch {
      return '';
    }
  }

  return trimmedValue.replace(/^\/+/, '').split('?')[0].split('#')[0];
}

export function buildStudioGuestMediaUrl(sessionDetails, value, options = {}) {
  if (!sessionDetails?.isGuestSession) {
    return null;
  }

  const sessionId = getSessionId(sessionDetails);
  const mediaPath = getMediaAssetPath(value);
  if (
    !sessionId
    || !mediaPath.startsWith('assets_v2/')
    || !mediaPath.split('/').includes(sessionId.toString())
  ) {
    return null;
  }

  const processorBaseUrl = normalizeBaseUrl(options.processorApiUrl);
  const routePath = '/video_sessions/guest_media'
    + `?sessionId=${encodeURIComponent(sessionId)}`
    + `&assetKey=${encodeURIComponent(mediaPath)}`;
  return processorBaseUrl ? `${processorBaseUrl}${routePath}` : routePath;
}

function getStructuredVideoSource(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!value || typeof value !== 'object') {
    return '';
  }

  return firstString([
    value.url,
    value.remoteURL,
    value.remoteUrl,
    value.remote_url,
    value.assetPath,
    value.src,
  ]);
}

function resolveCandidateUrl(layer, sessionDetails, candidate, options) {
  const processorApiUrl = normalizeBaseUrl(options.processorApiUrl);
  const staticCdnUrl = normalizeBaseUrl(options.staticCdnUrl);
  const rawAssetSource = firstString([layer[candidate.assetField]]);
  const rawRemoteSource = firstString([layer[candidate.remoteField]]);
  const rawFreshRemoteSource = firstString([layer[candidate.rawRemoteField]]);
  const structuredSource = getStructuredVideoSource(layer[candidate.structuredField]);

  const signedGuestSource = sessionDetails?.isGuestSession
    ? [rawFreshRemoteSource, rawRemoteSource, structuredSource, rawAssetSource]
      .find(isCloudFrontSignedVideoUrl)
    : '';
  if (signedGuestSource) {
    return resolveStudioMediaUrl(signedGuestSource, staticCdnUrl, options);
  }

  const sourceEntries = [
    { value: rawRemoteSource, baseUrl: staticCdnUrl },
    { value: structuredSource, baseUrl: staticCdnUrl },
    { value: rawAssetSource, baseUrl: processorApiUrl },
  ].filter(({ value }) => value);

  if (sessionDetails?.isGuestSession) {
    const guestSourceEntries = rawFreshRemoteSource
      ? [{ value: rawFreshRemoteSource, baseUrl: staticCdnUrl }, ...sourceEntries]
      : sourceEntries;
    const existingGuestMedia = guestSourceEntries.find(({ value }) => (
      value.includes('/video_sessions/guest_media')
    ));
    if (existingGuestMedia) {
      return resolveStudioMediaUrl(existingGuestMedia.value, existingGuestMedia.baseUrl, options);
    }

    for (const sourceEntry of guestSourceEntries) {
      const guestMediaUrl = buildStudioGuestMediaUrl(
        sessionDetails,
        sourceEntry.value,
        options
      );
      if (guestMediaUrl) {
        return resolveStudioMediaUrl(guestMediaUrl, processorApiUrl, options);
      }
    }
  }

  const sourceEntry = sourceEntries[0];
  return sourceEntry
    ? resolveStudioMediaUrl(sourceEntry.value, sourceEntry.baseUrl, options)
    : null;
}

export function resolveStudioLayerVideo(layer, sessionDetails = {}, options = {}) {
  if (!layer || typeof layer !== 'object') {
    return { url: null, type: null };
  }

  const resolvedCandidates = VIDEO_LAYER_CANDIDATES.map((candidate) => ({
    type: candidate.type,
    isPreferred: Boolean(
      layer[candidate.preferredField]
      || layer.layerAiVideoType === candidate.type
    ),
    url: resolveCandidateUrl(layer, sessionDetails, candidate, options),
  }));
  const resolvedVideo = resolvedCandidates.find((candidate) => (
    candidate.isPreferred && candidate.url
  )) || resolvedCandidates.find((candidate) => candidate.url);

  return resolvedVideo
    ? { url: resolvedVideo.url, type: resolvedVideo.type }
    : { url: null, type: null };
}
