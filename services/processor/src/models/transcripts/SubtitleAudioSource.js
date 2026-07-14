import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { getObjectFromS3 } from '../AWS.js';

const DEFAULT_MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME ||
  process.env.STATIC_CDN_BUCKET ||
  'samsar-resources';
const DEFAULT_SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2')
  .replace(/^\/+|\/+$/g, '');
const DEFAULT_MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const AUDIO_FILE_EXTENSIONS = new Set([
  '.flac',
  '.m4a',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.mpga',
  '.oga',
  '.ogg',
  '.wav',
  '.webm',
]);
const LOCAL_MEDIA_HOSTS = new Set([
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
  'localhost',
  'media-gateway',
  'processor',
  'samsar-processor',
]);
const SECURE_AUDIO_KEY_PREFIXES = [
  'audio/',
  'generations/',
  'temp_audio/',
  'user_resources/',
  'video/audio/',
];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addUniqueString(list, seen, value) {
  const normalized = normalizeString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  list.push(normalized);
}

export function collectSubtitleAudioSourceReferences(audioLayer = {}) {
  const references = [];
  const seen = new Set();

  addUniqueString(references, seen, audioLayer.selectedRemoteAudioLink);
  (Array.isArray(audioLayer.remoteAudioLinks) ? audioLayer.remoteAudioLinks : [])
    .forEach((value) => addUniqueString(references, seen, value));
  (Array.isArray(audioLayer.remoteAudioData) ? audioLayer.remoteAudioData : [])
    .forEach((audioData) => {
      addUniqueString(references, seen, audioData?.audio_url);
      addUniqueString(references, seen, audioData?.audioUrl);
    });

  // Modern audio is also persisted under assets_v2. If the selected local
  // mount has disappeared, its durable object key can still be useful.
  addUniqueString(references, seen, audioLayer.selectedLocalAudioLink);
  (Array.isArray(audioLayer.localAudioLinks) ? audioLayer.localAudioLinks : [])
    .forEach((value) => addUniqueString(references, seen, value));
  addUniqueString(references, seen, audioLayer.audioLink);
  addUniqueString(references, seen, audioLayer.url);

  return references;
}

function decodeReferencePathname(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function containsUnsafePathSegment(value) {
  if (!value || value.includes('\0') || value.includes('\\')) {
    return true;
  }
  return value
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
}

function getConfiguredRemoteHosts({
  mediaBucketName = DEFAULT_MEDIA_BUCKET_NAME,
  trustedRemoteHosts = [],
} = {}) {
  const hosts = new Set(['static.samsar.one']);
  const configuredUrls = [
    process.env.STATIC_CDN_URL,
    process.env.PUBLIC_STATIC_CDN_URL,
  ];

  configuredUrls.forEach((value) => {
    try {
      const parsedUrl = new URL(value);
      if (parsedUrl.hostname) {
        hosts.add(parsedUrl.hostname.toLowerCase());
      }
    } catch {
      // Optional configuration can be absent or malformed.
    }
  });
  trustedRemoteHosts.forEach((value) => {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized) {
      hosts.add(normalized);
    }
  });

  const normalizedBucketName = normalizeString(mediaBucketName).toLowerCase();
  if (normalizedBucketName) {
    hosts.add(`${normalizedBucketName}.s3.amazonaws.com`);
  }
  return hosts;
}

function isTrustedRemoteMediaUrl(parsedUrl, options = {}) {
  const hostname = parsedUrl.hostname.toLowerCase();
  const mediaBucketName = normalizeString(
    options.mediaBucketName || DEFAULT_MEDIA_BUCKET_NAME,
  ).toLowerCase();
  if (getConfiguredRemoteHosts(options).has(hostname)) {
    return true;
  }

  return Boolean(
    mediaBucketName &&
    hostname.startsWith(`${mediaBucketName}.s3.`) &&
    hostname.endsWith('.amazonaws.com')
  );
}

function normalizeAudioObjectKeyPath(rawPath, secureAssetPrefix) {
  const decodedPath = decodeReferencePathname(rawPath)
    .replace(/^\/+/, '')
    .replace(/^samsar_processor\//, '');
  if (!decodedPath || containsUnsafePathSegment(decodedPath)) {
    return null;
  }

  if (decodedPath.startsWith(`${secureAssetPrefix}/`)) {
    const relativeSecurePath = decodedPath.slice(secureAssetPrefix.length + 1);
    return SECURE_AUDIO_KEY_PREFIXES.some((prefix) => relativeSecurePath.startsWith(prefix))
      ? decodedPath
      : null;
  }

  if (decodedPath.startsWith('assets/')) {
    const legacyRelativePath = decodedPath.slice('assets/'.length);
    return SECURE_AUDIO_KEY_PREFIXES.some((prefix) => legacyRelativePath.startsWith(prefix))
      ? decodedPath
      : null;
  }

  return SECURE_AUDIO_KEY_PREFIXES.some((prefix) => decodedPath.startsWith(prefix))
    ? `${secureAssetPrefix}/${decodedPath}`
    : null;
}

/**
 * Converts only Samsar-owned media references into an object key. URL query
 * strings are deliberately ignored, so an expired CloudFront signature does
 * not prevent server-side recovery through S3. Arbitrary URLs are rejected
 * and are never fetched.
 */
export function normalizeTrustedSubtitleAudioObjectKey(reference, options = {}) {
  const normalizedReference = normalizeString(reference);
  if (!normalizedReference) {
    return null;
  }
  const secureAssetPrefix = normalizeString(
    options.secureAssetPrefix || DEFAULT_SECURE_ASSET_PREFIX,
  ).replace(/^\/+|\/+$/g, '');
  if (!secureAssetPrefix) {
    return null;
  }

  if (/^https?:\/\//i.test(normalizedReference)) {
    try {
      const parsedUrl = new URL(normalizedReference);
      if (
        !['http:', 'https:'].includes(parsedUrl.protocol) ||
        parsedUrl.username ||
        parsedUrl.password ||
        !isTrustedRemoteMediaUrl(parsedUrl, options)
      ) {
        return null;
      }
      return normalizeAudioObjectKeyPath(parsedUrl.pathname, secureAssetPrefix);
    } catch {
      return null;
    }
  }

  return normalizeAudioObjectKeyPath(
    normalizedReference.split('?')[0].split('#')[0],
    secureAssetPrefix,
  );
}

function getDefaultLocalAssetRoots() {
  const isContainer = ['docker', 'staging'].includes(
    normalizeString(process.env.CURRENT_ENV).toLowerCase(),
  );
  const roots = [
    process.env.SAMSAR_ASSETS_V2_ROOT,
    process.env.SAMSAR_ASSETS_ROOT,
    isContainer ? '/assets_v2' : path.join(process.cwd(), 'assets_v2'),
    isContainer ? '/assets' : path.join(process.cwd(), 'assets'),
    path.join(process.cwd(), '..', 'samsar_processor', 'assets_v2'),
    path.join(process.cwd(), '..', 'samsar_processor', 'assets'),
  ];

  return [...new Set(roots.map(normalizeString).filter(Boolean).map((root) => path.resolve(root)))];
}

function isPathInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function resolveExistingTrustedLocalFile(candidate, trustedLocalRoots) {
  const normalizedCandidate = normalizeString(candidate);
  if (!normalizedCandidate) {
    return null;
  }

  let filePath;
  try {
    filePath = await fs.promises.realpath(normalizedCandidate);
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  for (const configuredRoot of trustedLocalRoots) {
    try {
      const rootPath = await fs.promises.realpath(configuredRoot);
      if (isPathInsideRoot(filePath, rootPath)) {
        return filePath;
      }
    } catch {
      // A missing optional mount cannot contain the existing candidate.
    }
  }
  return null;
}

function getLocalReferencePath(reference) {
  const normalizedReference = normalizeString(reference);
  if (!normalizedReference) {
    return null;
  }

  if (/^https?:\/\//i.test(normalizedReference)) {
    try {
      const parsedUrl = new URL(normalizedReference);
      if (!LOCAL_MEDIA_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
        return null;
      }
      return decodeReferencePathname(parsedUrl.pathname).replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  if (path.isAbsolute(normalizedReference)) {
    return normalizedReference;
  }
  return decodeReferencePathname(normalizedReference.split('?')[0].split('#')[0])
    .replace(/^\/+/, '');
}

function orderRootsForReference(trustedLocalRoots, referencePath, secureAssetPrefix) {
  let preferredRootName = null;
  if (referencePath.startsWith(`${secureAssetPrefix}/`)) {
    preferredRootName = secureAssetPrefix;
  } else if (referencePath.startsWith('assets/')) {
    preferredRootName = 'assets';
  }
  if (!preferredRootName) {
    return trustedLocalRoots;
  }

  return trustedLocalRoots
    .map((root, index) => ({
      root,
      index,
      preferred: path.basename(root) === preferredRootName,
    }))
    .sort((left, right) => Number(right.preferred) - Number(left.preferred) || left.index - right.index)
    .map(({ root }) => root);
}

function buildLocalPathCandidates(
  audioLayer,
  preferredLocalFilePath,
  trustedLocalRoots,
  secureAssetPrefix,
) {
  const candidates = [];
  const seen = new Set();
  addUniqueString(candidates, seen, preferredLocalFilePath);

  const localReferences = [
    audioLayer?.selectedLocalAudioLink,
    ...(Array.isArray(audioLayer?.localAudioLinks) ? audioLayer.localAudioLinks : []),
  ];

  localReferences.forEach((reference) => {
    const referencePath = getLocalReferencePath(reference);
    if (!referencePath || containsUnsafePathSegment(referencePath)) {
      return;
    }
    if (path.isAbsolute(referencePath)) {
      addUniqueString(candidates, seen, referencePath);
      return;
    }

    const withoutSecurePrefix = referencePath.startsWith(`${secureAssetPrefix}/`)
      ? referencePath.slice(secureAssetPrefix.length + 1)
      : referencePath;
    const withoutAssetPrefix = withoutSecurePrefix.startsWith('assets/')
      ? withoutSecurePrefix.slice('assets/'.length)
      : withoutSecurePrefix;
    orderRootsForReference(trustedLocalRoots, referencePath, secureAssetPrefix).forEach((root) => {
      addUniqueString(candidates, seen, path.resolve(root, withoutAssetPrefix));
    });
  });

  return candidates;
}

function getAudioTempExtension(reference) {
  let pathname = normalizeString(reference);
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      pathname = '';
    }
  }
  const extension = path.extname(pathname.split('?')[0].split('#')[0]).toLowerCase();
  return AUDIO_FILE_EXTENSIONS.has(extension) ? extension : '.mp3';
}

function resolveMaxAudioBytes(value) {
  const configuredValue = Number(value ?? process.env.SUBTITLE_ALIGNMENT_MAX_AUDIO_BYTES);
  return Number.isFinite(configuredValue) && configuredValue > 0
    ? Math.floor(configuredValue)
    : DEFAULT_MAX_AUDIO_BYTES;
}

async function writeObjectBodyToFile(body, filePath, maxBytes) {
  if (!body) {
    throw new Error('Stored audio response did not contain a body.');
  }

  const fileHandle = await fs.promises.open(filePath, 'wx');
  let totalBytes = 0;
  try {
    const writeChunk = async (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        throw new Error(`Stored subtitle audio exceeds the ${maxBytes}-byte recovery limit.`);
      }
      await fileHandle.write(buffer);
    };

    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      await writeChunk(body);
    } else if (typeof body.transformToByteArray === 'function') {
      await writeChunk(await body.transformToByteArray());
    } else if (body[Symbol.asyncIterator]) {
      for await (const chunk of body) {
        await writeChunk(chunk);
      }
    } else {
      throw new Error('Stored audio response body cannot be streamed.');
    }
  } finally {
    await fileHandle.close();
  }

  if (totalBytes === 0) {
    throw new Error('Stored subtitle audio is empty.');
  }
}

function createNoopCleanup() {
  return async () => {};
}

/**
 * Materializes a speech layer's audio for subtitle alignment. Existing files
 * under trusted asset mounts win. When those files have been evicted, the
 * function reads only a trusted Samsar media key from the configured bucket
 * into an isolated temporary directory and returns an idempotent cleanup.
 */
export async function resolveSubtitleAudioSource({
  audioLayer = {},
  preferredLocalFilePath = null,
  getObject = getObjectFromS3,
  mediaBucketName = DEFAULT_MEDIA_BUCKET_NAME,
  secureAssetPrefix = DEFAULT_SECURE_ASSET_PREFIX,
  trustedLocalRoots = getDefaultLocalAssetRoots(),
  trustedRemoteHosts = [],
  tempRoot = os.tmpdir(),
  maxAudioBytes = undefined,
} = {}) {
  const normalizedLocalRoots = [...new Set(
    trustedLocalRoots.map(normalizeString).filter(Boolean).map((root) => path.resolve(root)),
  )];
  const localCandidates = buildLocalPathCandidates(
    audioLayer,
    preferredLocalFilePath,
    normalizedLocalRoots,
    secureAssetPrefix,
  );

  for (const localCandidate of localCandidates) {
    const resolvedLocalFile = await resolveExistingTrustedLocalFile(
      localCandidate,
      normalizedLocalRoots,
    );
    if (resolvedLocalFile) {
      return {
        filePath: resolvedLocalFile,
        isTemporary: false,
        sourceReference: audioLayer.selectedLocalAudioLink || localCandidate,
        objectKey: null,
        cleanup: createNoopCleanup(),
      };
    }
  }

  const references = collectSubtitleAudioSourceReferences(audioLayer);
  const attemptedObjectKeys = new Set();
  let lastRecoveryError = null;
  for (const reference of references) {
    const objectKey = normalizeTrustedSubtitleAudioObjectKey(reference, {
      mediaBucketName,
      secureAssetPrefix,
      trustedRemoteHosts,
    });
    if (!objectKey || attemptedObjectKeys.has(objectKey)) {
      continue;
    }
    attemptedObjectKeys.add(objectKey);

    let tempDirectory = null;
    try {
      const response = await getObject({
        bucketName: mediaBucketName,
        key: objectKey,
      });
      const maxBytes = resolveMaxAudioBytes(maxAudioBytes);
      const contentLength = Number(response?.ContentLength);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`Stored subtitle audio exceeds the ${maxBytes}-byte recovery limit.`);
      }

      tempDirectory = await fs.promises.mkdtemp(
        path.join(path.resolve(tempRoot), 'samsar-subtitle-audio-'),
      );
      const tempAudioPath = path.join(
        tempDirectory,
        `speech-${randomUUID()}${getAudioTempExtension(reference)}`,
      );
      await writeObjectBodyToFile(response?.Body, tempAudioPath, maxBytes);

      let cleaned = false;
      return {
        filePath: tempAudioPath,
        isTemporary: true,
        sourceReference: reference,
        objectKey,
        cleanup: async () => {
          if (cleaned) {
            return;
          }
          cleaned = true;
          await fs.promises.rm(tempDirectory, { recursive: true, force: true });
        },
      };
    } catch (error) {
      lastRecoveryError = error;
      if (tempDirectory) {
        await fs.promises.rm(tempDirectory, { recursive: true, force: true });
      }
    }
  }

  const audioLayerId = audioLayer?._id?.toString?.() || 'unknown';
  const error = new Error(
    `Subtitle alignment audio is unavailable for audio layer ${audioLayerId}: ` +
    `no existing trusted local file or readable stored audio object was found.`,
  );
  if (lastRecoveryError) {
    error.cause = lastRecoveryError;
  }
  throw error;
}
