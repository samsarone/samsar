import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fetch from 'node-fetch';
import {
  copyObjectToPublicationsMedia,
  deleteObjectFromPublicationsMedia,
  getObjectFromS3,
  getPublicationsMediaConfig,
  isPublicPublicationMediaConfigured,
  isPublicPublicationMediaUrl,
  uploadBufferToPublicationsMedia,
  uploadFileToPublicationsMedia,
} from './AWS.js';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET || 'samsar-resources';
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const MEDIA_HOSTS = new Set([
  'static.samsar.one',
  `${MEDIA_BUCKET_NAME}.s3.amazonaws.com`,
]);
const INTERACTIVE_PUBLICATION_MEDIA_NAMES = new Set(['video.mp4', 'thumbnail.png']);
const INTERACTIVE_PATH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_INTERACTIVE_PATH_ID_LENGTH = 256;
const SAFE_PUBLICATION_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SAFE_INTERACTIVE_MEDIA_REVISION_PATTERN = /^[A-Za-z0-9_-]+$/;

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const firstNonEmptyString = (values = []) => (
  values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
);

const normalizeSessionId = (session) => (
  session?._id?.toString?.() || session?.id?.toString?.() || normalizeString(session?.sessionId)
);

const getAssetsRoots = () => {
  const v2Root = process.env.SAMSAR_ASSETS_V2_ROOT || (
    process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker'
      ? '/assets_v2'
      : path.join(process.cwd(), 'assets_v2')
  );
  const legacyRoot = process.env.SAMSAR_ASSETS_ROOT || (
    process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker'
      ? '/assets'
      : path.join(process.cwd(), 'assets')
  );

  return [v2Root, legacyRoot, path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2')]
    .filter((root, index, roots) => root && roots.indexOf(root) === index);
};

const decodeDataUrl = (value) => {
  const match = typeof value === 'string'
    ? value.match(/^data:([^;,]+);base64,(.+)$/)
    : null;
  return match ? Buffer.from(match[2], 'base64') : null;
};

const getPathnameFromReference = (reference) => {
  const normalized = normalizeString(reference);
  if (!normalized) {
    return '';
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      return decodeURIComponent(new URL(normalized).pathname);
    } catch {
      return '';
    }
  }

  return normalized.split('?')[0].split('#')[0];
};

const normalizeAssetKey = (reference) => {
  const pathname = getPathnameFromReference(reference)
    .replace(/^\/+/, '')
    .replace(/^samsar_processor\//, '');

  if (!pathname || pathname.split('/').includes('..')) {
    return '';
  }

  if (pathname.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return pathname;
  }
  if (pathname.startsWith('assets/')) {
    return pathname;
  }
  if (pathname.startsWith('published/')) {
    return pathname;
  }
  if (pathname.startsWith('temp_video/')) {
    return pathname;
  }
  if (
    pathname.startsWith('video/') ||
    pathname.startsWith('ai_video/') ||
    pathname.startsWith('generations/') ||
    pathname.startsWith('user_resources/') ||
    pathname.startsWith('temp_images/')
  ) {
    return `${SECURE_ASSET_PREFIX}/${pathname}`;
  }

  return '';
};

const resolveLocalFilePath = (reference) => {
  const rawReference = normalizeString(reference);
  if (!rawReference || /^data:/i.test(rawReference) || !isLocalMediaReference(rawReference)) {
    return null;
  }

  if (path.isAbsolute(rawReference) && fs.existsSync(rawReference)) {
    return rawReference;
  }

  const normalizedPath = getPathnameFromReference(rawReference)
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${SECURE_ASSET_PREFIX}/`), '')
    .replace(/^assets\//, '')
    .replace(/^samsar_processor\//, '');

  if (!normalizedPath || normalizedPath.split('/').includes('..')) {
    return null;
  }

  return getAssetsRoots()
    .map((root) => path.join(root, normalizedPath))
    .find((candidate) => fs.existsSync(candidate)) || null;
};

const isLocalMediaReference = (reference) => {
  if (!/^https?:\/\//i.test(reference)) {
    return true;
  }

  try {
    const hostname = new URL(reference).hostname.toLowerCase();
    return new Set(['localhost', '127.0.0.1', '::1', 'processor', 'samsar-processor', 'media-gateway'])
      .has(hostname);
  } catch {
    return false;
  }
};

const isS3MediaReference = (reference) => {
  const normalized = normalizeString(reference);
  if (!normalized) {
    return false;
  }

  if (!/^https?:\/\//i.test(normalized)) {
    return Boolean(normalizeAssetKey(normalized));
  }

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    const assetKey = normalizeAssetKey(normalized);
    return Boolean(assetKey?.startsWith(`${SECURE_ASSET_PREFIX}/`)) ||
      MEDIA_HOSTS.has(hostname) ||
      hostname.startsWith(`${MEDIA_BUCKET_NAME}.s3.`) ||
      hostname === new URL(getPublicationsMediaConfig().cdnUrl || 'http://invalid').hostname;
  } catch {
    return false;
  }
};

const collectStreamBuffer = async (body) => {
  if (!body) {
    return null;
  }
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const writeStreamToFile = async (body, filePath) => {
  if (!body) {
    throw new Error('Media response did not contain a body.');
  }

  if (typeof body.pipe === 'function') {
    await pipeline(body, fs.createWriteStream(filePath));
    return;
  }

  const buffer = typeof body.transformToByteArray === 'function'
    ? Buffer.from(await body.transformToByteArray())
    : await collectStreamBuffer(body);
  await fs.promises.writeFile(filePath, buffer);
};

const readMediaReference = async (reference) => {
  const dataBuffer = decodeDataUrl(reference);
  if (dataBuffer) {
    return dataBuffer;
  }

  const localFilePath = resolveLocalFilePath(reference);
  if (localFilePath) {
    return fs.promises.readFile(localFilePath);
  }

  if (!isS3MediaReference(reference)) {
    return null;
  }

  const key = normalizeAssetKey(reference);
  if (!key) {
    return null;
  }

  const response = await getObjectFromS3({
    bucketName: MEDIA_BUCKET_NAME,
    key,
  });
  return collectStreamBuffer(response.Body);
};

const resolveFirstFrameReferences = (session = {}) => {
  const references = [];
  const addReference = (value) => {
    const normalized = normalizeString(value);
    if (normalized && !references.includes(normalized)) {
      references.push(normalized);
    }
  };
  const sessionId = normalizeSessionId(session);
  const layers = Array.isArray(session.layers) ? session.layers : [];

  // Preserve the normal publication thumbnail order: use the rendered splash
  // reference first, then the first frame of the first layer, then older
  // source-layer references. Video-frame extraction is the final fallback.
  addReference(session.publishedSplashImage);
  addReference(session.splashImage);
  if (sessionId) {
    addReference(`${SECURE_ASSET_PREFIX}/video/splash/${sessionId}/splash.png`);
    addReference(`assets/video/splash/${sessionId}/splash.png`);
  }

  const firstLayer = layers[0];
  if (firstLayer) {
    addReference(Array.isArray(firstLayer.frames) ? firstLayer.frames[0] : '');
  }

  const orderedLayers = layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => {
      const leftOffset = Number(left.layer?.durationOffset);
      const rightOffset = Number(right.layer?.durationOffset);
      const normalizedLeft = Number.isFinite(leftOffset) ? leftOffset : left.index;
      const normalizedRight = Number.isFinite(rightOffset) ? rightOffset : right.index;
      return normalizedLeft - normalizedRight || left.index - right.index;
    });

  for (const { layer } of orderedLayers) {
    const imageSession = layer?.imageSession || {};
    const frame = Array.isArray(layer?.frames)
      ? firstNonEmptyString([layer.frames[0]])
      : '';
    const candidate = firstNonEmptyString([
      frame,
      layer?.aiLayerStartFrame,
      layer?.baseLayerStartFrame,
      imageSession?.videoRenderStartFrameImage,
      imageSession?.activeImageRemoteLink,
      imageSession?.activeGeneratedImage,
      imageSession?.activeEditedImage,
      imageSession?.activeSelectedImage,
    ]);
    if (candidate) {
      addReference(candidate);
    }
  }

  return references;
};

const resolveFirstFrameReference = (session = {}) => resolveFirstFrameReferences(session)[0] || '';

const buildPublicationMediaKey = (sessionId, mediaName) => {
  const { keyPrefix } = getPublicationsMediaConfig();
  return [keyPrefix, sessionId, mediaName].filter(Boolean).join('/');
};

const normalizeInteractivePublicationSessionId = (sessionId) => {
  const normalized = sessionId?._id?.toString?.() ||
    sessionId?.id?.toString?.() ||
    sessionId?.toString?.() ||
    '';
  if (
    !normalized ||
    normalized.length > 128 ||
    !SAFE_PUBLICATION_SESSION_ID_PATTERN.test(normalized)
  ) {
    throw new Error('Interactive publication media requires a safe session ID.');
  }
  return normalized;
};

/**
 * Validates the logical branch path ID before it can influence a storage key.
 * Whitespace, separators, percent escapes, and traversal-shaped values are
 * rejected instead of normalized so distinct IDs can never collapse together.
 */
export function validateInteractivePublicationPathId(pathId) {
  const normalized = typeof pathId === 'string' ? pathId : '';
  if (!normalized) {
    throw new Error('Interactive publication media requires a path ID.');
  }
  if (normalized.length > MAX_INTERACTIVE_PATH_ID_LENGTH) {
    throw new Error(
      `Interactive publication path ID cannot exceed ${MAX_INTERACTIVE_PATH_ID_LENGTH} characters.`
    );
  }
  if (
    normalized === '.' ||
    normalized === '..' ||
    !INTERACTIVE_PATH_ID_PATTERN.test(normalized)
  ) {
    throw new Error(`Unsafe interactive publication path ID: ${normalized}`);
  }
  return normalized;
}

/**
 * Base64url is injective over the validated UTF-8 ID and contains no path
 * separators. Keep the original path ID in publication metadata for clients;
 * this segment exists only to make object keys collision- and traversal-safe.
 */
export function buildInteractivePublicationSafePathId(pathId) {
  return Buffer.from(validateInteractivePublicationPathId(pathId), 'utf8').toString('base64url');
}

const normalizeInteractivePublicationMediaRevision = (revisionId) => {
  const normalized = normalizeString(revisionId);
  if (
    !normalized ||
    normalized.length > 128 ||
    !SAFE_INTERACTIVE_MEDIA_REVISION_PATTERN.test(normalized)
  ) {
    throw new Error('Interactive publication media requires a safe revision ID.');
  }
  return normalized;
};

export function buildInteractivePublicationMediaKey(
  sessionId,
  pathId,
  mediaName,
  { revisionId = null } = {},
) {
  const normalizedSessionId = normalizeInteractivePublicationSessionId(sessionId);
  if (!INTERACTIVE_PUBLICATION_MEDIA_NAMES.has(mediaName)) {
    throw new Error(`Unsupported interactive publication media name: ${mediaName || '<empty>'}`);
  }
  const safePathId = buildInteractivePublicationSafePathId(pathId);
  const mediaPath = revisionId
    ? `interactive/revisions/${normalizeInteractivePublicationMediaRevision(revisionId)}/paths/${safePathId}/${mediaName}`
    : `interactive/paths/${safePathId}/${mediaName}`;
  return buildPublicationMediaKey(
    normalizedSessionId,
    mediaPath,
  );
}

const resolveVideoSource = (session = {}) => firstNonEmptyString([
  session.remoteURL,
  session.videoLink,
]);

const resolveInteractivePathVideoSource = (branchPath = {}) => firstNonEmptyString([
  branchPath.remoteURL,
  branchPath.remote_url,
  branchPath.videoLink,
  branchPath.video_link,
  branchPath.resultUrl,
  branchPath.result_url,
  branchPath.contentUrl,
  branchPath.videoUrl,
  branchPath.video_url,
  branchPath.url,
]);

const resolveInteractivePathId = (branchPath) => {
  if (typeof branchPath === 'string') {
    return validateInteractivePublicationPathId(branchPath);
  }
  if (!branchPath || typeof branchPath !== 'object' || Array.isArray(branchPath)) {
    throw new Error('Interactive publication media requires a path ID or path media entry.');
  }
  return validateInteractivePublicationPathId(firstNonEmptyString([
    branchPath.pathId,
    branchPath.path_id,
    branchPath.id,
  ]));
};

const materializeVideoUrl = async (session) => {
  const source = resolveVideoSource(session);
  const sessionId = normalizeSessionId(session);
  const currentUrl = firstNonEmptyString([session.publishedVideoURL]);
  if (!sessionId) {
    throw new Error(`No rendered video source is available for session ${sessionId || 'unknown'}.`);
  }

  if (!source) {
    if (isPublicPublicationMediaUrl(currentUrl)) {
      return { url: currentUrl, source: currentUrl };
    }
    throw new Error(`No rendered video source is available for session ${sessionId}.`);
  }

  const key = buildPublicationMediaKey(sessionId, 'video.mp4');
  const localFilePath = resolveLocalFilePath(source);
  if (localFilePath) {
    return {
      url: await uploadFileToPublicationsMedia({
        filePath: localFilePath,
        key,
        contentType: 'video/mp4',
      }),
      source: localFilePath,
    };
  }

  const sourceKey = normalizeAssetKey(source);
  if (sourceKey && isS3MediaReference(source)) {
    return {
      url: await copyObjectToPublicationsMedia({
        sourceBucketName: MEDIA_BUCKET_NAME,
        sourceKey,
        key,
        contentType: 'video/mp4',
      }),
      source: `s3:${sourceKey}`,
    };
  }

  throw new Error(`Unable to resolve rendered video source for session ${sessionId}.`);
};

const materializeInteractivePathVideoUrl = async (
  sessionId,
  branchPath,
  { revisionId = null } = {},
) => {
  const pathId = resolveInteractivePathId(branchPath);
  const source = resolveInteractivePathVideoSource(branchPath);
  if (!source) {
    throw new Error(`No rendered video source is available for interactive path ${pathId}.`);
  }

  const completionStatus = firstNonEmptyString([
    branchPath.videoGenerationStatus,
    branchPath.video_generation_status,
    branchPath.status,
  ]).toUpperCase();
  if (completionStatus && completionStatus !== 'COMPLETED') {
    throw new Error(`Interactive path ${pathId} is not complete.`);
  }

  const key = buildInteractivePublicationMediaKey(
    sessionId,
    pathId,
    'video.mp4',
    { revisionId },
  );
  const localFilePath = resolveLocalFilePath(source);
  if (localFilePath) {
    return {
      key,
      url: await uploadFileToPublicationsMedia({
        filePath: localFilePath,
        key,
        contentType: 'video/mp4',
      }),
      source: localFilePath,
    };
  }

  const sourceKey = normalizeAssetKey(source);
  if (sourceKey && isS3MediaReference(source)) {
    return {
      key,
      url: await copyObjectToPublicationsMedia({
        sourceBucketName: MEDIA_BUCKET_NAME,
        sourceKey,
        key,
        contentType: 'video/mp4',
      }),
      source: `s3:${sourceKey}`,
    };
  }

  if (/^https?:\/\//i.test(source)) {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'samsar-interactive-publication-video-')
    );
    try {
      const inputPath = await createTemporaryVideoInput(source, tempDir);
      return {
        key,
        url: await uploadFileToPublicationsMedia({
          filePath: inputPath,
          key,
          contentType: 'video/mp4',
        }),
        // Keep the durable source reference. The temporary input is removed
        // before this function returns and must never leak into publication data.
        source,
      };
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  throw new Error(`Unable to resolve rendered video source for interactive path ${pathId}.`);
};

const resolveVideoSourceKey = (source) => {
  const normalized = normalizeString(source);
  if (normalized.startsWith('s3:')) {
    return normalizeAssetKey(normalized.slice(3));
  }
  return isS3MediaReference(normalized) ? normalizeAssetKey(normalized) : '';
};

const createTemporaryVideoInput = async (videoSource, tempDir) => {
  const normalizedSource = normalizeString(videoSource);
  const localFilePath = resolveLocalFilePath(normalizedSource);
  if (localFilePath) {
    return localFilePath;
  }

  const inputPath = path.join(tempDir, 'publication-source.mp4');
  const sourceKey = resolveVideoSourceKey(normalizedSource);
  if (sourceKey) {
    const response = await getObjectFromS3({
      bucketName: MEDIA_BUCKET_NAME,
      key: sourceKey,
    });
    await writeStreamToFile(response.Body, inputPath);
    return inputPath;
  }

  if (/^https?:\/\//i.test(normalizedSource)) {
    const response = await fetch(normalizedSource);
    if (!response.ok) {
      throw new Error(`Unable to download video for thumbnail fallback (HTTP ${response.status}).`);
    }
    await writeStreamToFile(response.body, inputPath);
    return inputPath;
  }

  throw new Error('Unable to resolve the rendered video for thumbnail fallback.');
};

const extractThumbnailFromVideo = async (videoSource) => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-publication-thumbnail-'));
  const outputPath = path.join(tempDir, 'thumbnail.png');

  try {
    const inputPath = await createTemporaryVideoInput(videoSource, tempDir);
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(['-frames:v', '1'])
        .noAudio()
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    return fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
};

const materializeThumbnailUrl = async (
  session,
  { thumbnailReference = '', forceFirstFrame = false, videoSource = '' } = {}
) => {
  const currentUrl = firstNonEmptyString([session.publishedSplashImage]);
  const firstFrameReferences = resolveFirstFrameReferences(session);
  const candidates = forceFirstFrame
    ? firstFrameReferences
    : [thumbnailReference, ...firstFrameReferences];
  const sessionId = normalizeSessionId(session);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const buffer = await readMediaReference(candidate).catch(() => null);
    if (!buffer || buffer.length === 0) {
      continue;
    }

    return {
      url: await uploadBufferToPublicationsMedia({
        key: buildPublicationMediaKey(sessionId, 'thumbnail.png'),
        buffer,
        contentType: 'image/png',
      }),
      source: candidate,
    };
  }

  if (!forceFirstFrame && isPublicPublicationMediaUrl(currentUrl)) {
    return { url: currentUrl, source: 'existing-public-url' };
  }

  if (videoSource) {
    try {
      const buffer = await extractThumbnailFromVideo(videoSource);
      if (buffer.length > 0) {
        return {
          url: await uploadBufferToPublicationsMedia({
            key: buildPublicationMediaKey(sessionId, 'thumbnail.png'),
            buffer,
            contentType: 'image/png',
          }),
          source: 'ffmpeg-video-frame',
        };
      }
    } catch (error) {
      console.error(`FFmpeg thumbnail fallback failed for session ${sessionId || 'unknown'}:`, error);
    }
  }

  throw new Error(`Unable to resolve a first-frame thumbnail for session ${sessionId || 'unknown'}.`);
};

export async function preparePublicPublicationMedia(
  session,
  { thumbnailReference = '', forceFirstFrame = false } = {}
) {
  if (!isPublicPublicationMediaConfigured()) {
    throw new Error(
      'Publication media is not configured. Set MEDIA_BUCKET_NAME and STATIC_CDN_URL.'
    );
  }

  const video = await materializeVideoUrl(session);
  const thumbnail = await materializeThumbnailUrl(session, {
    thumbnailReference,
    forceFirstFrame,
    videoSource: video.source,
  });

  return {
    videoUrl: video.url,
    videoSource: video.source,
    thumbnailUrl: thumbnail.url,
    thumbnailSource: thumbnail.source,
  };
}

export async function preparePublicPublicationVideo(session) {
  if (!isPublicPublicationMediaConfigured()) {
    throw new Error(
      'Publication media is not configured. Set MEDIA_BUCKET_NAME and STATIC_CDN_URL.'
    );
  }
  return materializeVideoUrl(session);
}

export async function preparePublicPublicationThumbnail(
  session,
  { thumbnailReference = '', forceFirstFrame = false } = {}
) {
  if (!isPublicPublicationMediaConfigured()) {
    throw new Error(
      'Publication media is not configured. Set MEDIA_BUCKET_NAME and STATIC_CDN_URL.'
    );
  }
  return materializeThumbnailUrl(session, { thumbnailReference, forceFirstFrame });
}

/**
 * Publishes one completed branch render without consulting any session-level
 * splash or frame candidates. Its thumbnail is always decoded from frame zero
 * of this path's own rendered video.
 */
export async function preparePublicInteractivePublicationPathMedia(
  session,
  branchPath,
  { revisionId = null } = {},
) {
  if (!isPublicPublicationMediaConfigured()) {
    throw new Error(
      'Publication media is not configured. Set MEDIA_BUCKET_NAME and STATIC_CDN_URL.'
    );
  }

  const sessionId = normalizeInteractivePublicationSessionId(normalizeSessionId(session));
  const pathId = resolveInteractivePathId(branchPath);
  const safePathId = buildInteractivePublicationSafePathId(pathId);
  const video = await materializeInteractivePathVideoUrl(
    sessionId,
    branchPath,
    { revisionId },
  );
  const thumbnailBuffer = await extractThumbnailFromVideo(video.source);
  if (!thumbnailBuffer || thumbnailBuffer.length === 0) {
    throw new Error(`Unable to extract a first-frame thumbnail for interactive path ${pathId}.`);
  }

  const thumbnailKey = buildInteractivePublicationMediaKey(
    sessionId,
    pathId,
    'thumbnail.png',
    { revisionId },
  );
  const thumbnailUrl = await uploadBufferToPublicationsMedia({
    key: thumbnailKey,
    buffer: thumbnailBuffer,
    contentType: 'image/png',
  });

  return {
    pathId,
    safePathId,
    revisionId,
    videoUrl: video.url,
    thumbnailUrl,
    storageKeys: {
      video: video.key,
      thumbnail: thumbnailKey,
    },
    videoSource: video.source,
    thumbnailSource: 'ffmpeg-first-video-frame',
  };
}

/**
 * Removes only the two exact objects owned by each supplied interactive path.
 * The session's existing linear `video.mp4` and `thumbnail.png` are deliberately
 * outside this key set and are never touched here.
 */
export async function deletePublicInteractivePublicationMediaForSession(
  sessionId,
  pathIdsOrEntries = [],
  { revisionId = null } = {},
) {
  const normalizedSessionId = normalizeInteractivePublicationSessionId(sessionId);
  const entries = Array.isArray(pathIdsOrEntries)
    ? pathIdsOrEntries
    : [pathIdsOrEntries];
  const pathsBySafeId = new Map();

  entries.forEach((entry) => {
    const pathId = resolveInteractivePathId(entry);
    const safePathId = buildInteractivePublicationSafePathId(pathId);
    const existingPathId = pathsBySafeId.get(safePathId);
    if (existingPathId && existingPathId !== pathId) {
      throw new Error(
        `Interactive publication path IDs ${existingPathId} and ${pathId} collide in storage.`
      );
    }
    pathsBySafeId.set(safePathId, pathId);
  });

  const pathIds = [...pathsBySafeId.values()];
  const keys = pathIds.flatMap((pathId) => [
    buildInteractivePublicationMediaKey(
      normalizedSessionId,
      pathId,
      'video.mp4',
      { revisionId },
    ),
    buildInteractivePublicationMediaKey(
      normalizedSessionId,
      pathId,
      'thumbnail.png',
      { revisionId },
    ),
  ]);
  const results = await Promise.allSettled(
    keys.map((key) => deleteObjectFromPublicationsMedia({ key }))
  );
  const failed = results
    .map((result, index) => ({ result, key: keys[index] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, key }) => ({
      key,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    }));

  failed.forEach(({ key, error }) => {
    console.error(`Failed to delete interactive publication media object ${key}: ${error}`);
  });

  return {
    sessionId: normalizedSessionId,
    revisionId,
    pathIds,
    deleted: keys.filter((_, index) => results[index].status === 'fulfilled'),
    failed,
  };
}

export async function deletePublicPublicationMediaForSession(sessionId) {
  const normalizedSessionId = sessionId?.toString?.() || normalizeString(sessionId);
  if (!normalizedSessionId) {
    return { sessionId: null, deleted: [], failed: [] };
  }

  const keys = [
    buildPublicationMediaKey(normalizedSessionId, 'video.mp4'),
    buildPublicationMediaKey(normalizedSessionId, 'thumbnail.png'),
  ];
  const results = await Promise.allSettled(
    keys.map((key) => deleteObjectFromPublicationsMedia({ key }))
  );
  const failed = results
    .map((result, index) => ({ result, key: keys[index] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, key }) => ({
      key,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    }));

  failed.forEach(({ key, error }) => {
    console.error(`Failed to delete public publication media object ${key}: ${error}`);
  });

  return {
    sessionId: normalizedSessionId,
    deleted: keys.filter((_, index) => results[index].status === 'fulfilled'),
    failed,
  };
}

export function inspectPublicPublicationMedia(session = {}) {
  const sessionId = normalizeSessionId(session);
  const currentVideoUrl = firstNonEmptyString([session.publishedVideoURL]);
  const currentThumbnailUrl = firstNonEmptyString([session.publishedSplashImage]);
  return {
    sessionId,
    configured: isPublicPublicationMediaConfigured(),
    videoUrl: currentVideoUrl,
    videoIsPublic: isPublicPublicationMediaUrl(currentVideoUrl),
    thumbnailUrl: currentThumbnailUrl,
    thumbnailIsPublic: isPublicPublicationMediaUrl(currentThumbnailUrl),
    firstFrameReference: resolveFirstFrameReference(session),
    videoSource: resolveVideoSource(session),
  };
}
