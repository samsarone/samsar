// uploadImageToCDN.js

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetBucketLocationCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import sharp from 'sharp';

const DEFAULT_AWS_REGION = 'us-west-2';
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET || 'samsar-resources';
const STATIC_CDN_URL = process.env.STATIC_CDN_URL || 'https://static.samsar.one/';
const CDN_PRIME_RETRY_DELAY_MS = 500;
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const DEFAULT_CLOUDFRONT_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const configuredCloudFrontSignedUrlTtlSeconds = Number(process.env.CLOUDFRONT_SIGNED_URL_TTL_SECONDS);
const CLOUDFRONT_SIGNED_URL_TTL_SECONDS = Number.isFinite(configuredCloudFrontSignedUrlTtlSeconds) && configuredCloudFrontSignedUrlTtlSeconds > 0
  ? configuredCloudFrontSignedUrlTtlSeconds
  : DEFAULT_CLOUDFRONT_SIGNED_URL_TTL_SECONDS;
const DEFAULT_CLOUDFRONT_SIGNED_URL_REFRESH_INTERVAL_SECONDS = 60 * 60;
const configuredCloudFrontSignedUrlRefreshIntervalSeconds = Number(
  process.env.CLOUDFRONT_SIGNED_URL_REFRESH_INTERVAL_SECONDS ||
  process.env.AWS_CLOUDFRONT_SIGNED_URL_REFRESH_INTERVAL_SECONDS
);
const CLOUDFRONT_SIGNED_URL_REFRESH_INTERVAL_SECONDS = Number.isFinite(configuredCloudFrontSignedUrlRefreshIntervalSeconds) &&
  configuredCloudFrontSignedUrlRefreshIntervalSeconds > 0
  ? configuredCloudFrontSignedUrlRefreshIntervalSeconds
  : DEFAULT_CLOUDFRONT_SIGNED_URL_REFRESH_INTERVAL_SECONDS;
const HEIC_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const HEIC_EXTENSION_MAP = {
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/heic-sequence': 'heic',
  'image/heif-sequence': 'heif',
};
const JPEG_MIME_TYPE = 'image/jpeg';
const JPEG_EXTENSION = 'jpg';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cachedCloudFrontPrivateKey;

const replaceFileExtension = (fileName, extension) => {
  if (!fileName || typeof fileName !== 'string') {
    return `upload.${extension}`;
  }
  const trimmedName = fileName.trim();
  if (!trimmedName) {
    return `upload.${extension}`;
  }
  const lastDotIndex = trimmedName.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return `${trimmedName}.${extension}`;
  }
  return `${trimmedName.slice(0, lastDotIndex)}.${extension}`;
};

let cachedS3Client;
let cachedS3Region;
const s3ClientCache = new Map();

const resolveCdnRegion = () => (process.env.AWS_CDN_REGION || DEFAULT_AWS_REGION);
const resolveBucketRegion = () => (
  process.env.USER_GENERATIONS_BUCKET_REGION ||
  process.env.AWS_S3_REGION ||
  process.env.AWS_REGION ||
  process.env.AWS_CDN_REGION ||
  DEFAULT_AWS_REGION
);
const resolveS3Endpoint = () => process.env.S3_ENDPOINT || process.env.AWS_S3_ENDPOINT || '';
const isTruthyEnv = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const shouldForceS3PathStyle = () => isTruthyEnv(process.env.S3_FORCE_PATH_STYLE || process.env.AWS_S3_FORCE_PATH_STYLE);
const getS3EndpointOptions = () => {
  const options = {};
  const endpoint = resolveS3Endpoint();
  if (endpoint) {
    options.endpoint = endpoint;
  }
  if (shouldForceS3PathStyle()) {
    options.forcePathStyle = true;
  }
  return options;
};

const getS3ClientForRegion = (region) => {
  const resolvedRegion = region || resolveBucketRegion();
  const cacheKey = `${resolvedRegion}:${resolveS3Endpoint()}:${shouldForceS3PathStyle()}`;
  if (s3ClientCache.has(cacheKey)) {
    return s3ClientCache.get(cacheKey);
  }

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId) {
    throw new Error('Missing AWS_ACCESS_KEY_ID environment variable.');
  }
  if (!secretAccessKey) {
    throw new Error('Missing AWS_SECRET_ACCESS_KEY environment variable.');
  }

  const client = new S3Client({
    region: resolvedRegion,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    ...getS3EndpointOptions(),
  });
  s3ClientCache.set(cacheKey, client);
  cachedS3Client = client;
  cachedS3Region = resolvedRegion;
  return client;
};

function encodeObjectKeyForUrl(key) {
  return String(key)
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildStaticCdnUrl(key) {
  const cdnBase = STATIC_CDN_URL.endsWith('/') ? STATIC_CDN_URL.slice(0, -1) : STATIC_CDN_URL;
  return `${cdnBase}/${encodeObjectKeyForUrl(key)}`;
}

function toCloudFrontSafeBase64(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~');
}

function resolveCloudFrontPrivateKey() {
  if (cachedCloudFrontPrivateKey !== undefined) {
    return cachedCloudFrontPrivateKey;
  }

  const rawPrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY || process.env.AWS_CLOUDFRONT_PRIVATE_KEY;
  const base64PrivateKey = process.env.CLOUDFRONT_PRIVATE_KEY_BASE64 || process.env.AWS_CLOUDFRONT_PRIVATE_KEY_BASE64;
  const privateKeyPath = process.env.CLOUDFRONT_PRIVATE_KEY_PATH || process.env.AWS_CLOUDFRONT_PRIVATE_KEY_PATH;

  if (base64PrivateKey) {
    cachedCloudFrontPrivateKey = Buffer.from(base64PrivateKey, 'base64').toString('utf8');
  } else if (rawPrivateKey) {
    cachedCloudFrontPrivateKey = rawPrivateKey.replace(/\\n/g, '\n');
  } else if (privateKeyPath) {
    cachedCloudFrontPrivateKey = fs.readFileSync(privateKeyPath, 'utf8');
  } else {
    cachedCloudFrontPrivateKey = null;
  }

  return cachedCloudFrontPrivateKey;
}

function getCloudFrontSigningConfig() {
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID || process.env.AWS_CLOUDFRONT_KEY_PAIR_ID;
  const privateKey = resolveCloudFrontPrivateKey();
  if (!keyPairId || !privateKey) {
    return null;
  }
  return { keyPairId, privateKey };
}

function signCloudFrontUrl(url) {
  const signingConfig = getCloudFrontSigningConfig();
  if (!signingConfig) {
    return url;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuedAt = Math.floor(nowSeconds / CLOUDFRONT_SIGNED_URL_REFRESH_INTERVAL_SECONDS) *
    CLOUDFRONT_SIGNED_URL_REFRESH_INTERVAL_SECONDS;
  const expiresAt = issuedAt + CLOUDFRONT_SIGNED_URL_TTL_SECONDS;
  const policy = JSON.stringify({
    Statement: [{
      Resource: url,
      Condition: {
        DateLessThan: {
          'AWS:EpochTime': expiresAt,
        },
      },
    }],
  });
  const signer = crypto.createSign('RSA-SHA1');
  signer.update(policy);
  const signature = signer.sign(signingConfig.privateKey);
  const separator = url.includes('?') ? '&' : '?';

  return `${url}${separator}Expires=${expiresAt}&Signature=${toCloudFrontSafeBase64(signature)}&Key-Pair-Id=${encodeURIComponent(signingConfig.keyPairId)}`;
}

function normalizeObjectKey(key) {
  const rawKey = String(key || '').trim();
  if (!rawKey) {
    return '';
  }
  if (/^https?:\/\//i.test(rawKey)) {
    try {
      return decodeURIComponent(new URL(rawKey).pathname).replace(/^\/+/, '');
    } catch {
      return rawKey.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
    }
  }
  return rawKey.replace(/^\/+/, '');
}

function isSecureAssetKey(key) {
  return normalizeObjectKey(key).startsWith(`${SECURE_ASSET_PREFIX}/`);
}

function isDockerRuntime() {
  return String(process.env.CURRENT_ENV || '').trim().toLowerCase() === 'docker';
}

function isExternalMediaPublishEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED || process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED || '')
      .trim()
      .toLowerCase()
  );
}

function shouldUseDockerLocalMedia() {
  const configuredMode = String(process.env.SAMSAR_MEDIA_DELIVERY_MODE || process.env.MEDIA_DELIVERY_MODE || '')
    .trim()
    .toLowerCase();
  if (configuredMode === 'docker-local' || configuredMode === 'local-filesystem') {
    return true;
  }
  if (configuredMode === 's3-cloudfront' || configuredMode === 'external-s3') {
    return false;
  }
  return isDockerRuntime() && !isExternalMediaPublishEnabled();
}

function toSecureAssetKey(key) {
  const normalizedKey = normalizeObjectKey(key);
  return isSecureAssetKey(normalizedKey) ? normalizedKey : `${SECURE_ASSET_PREFIX}/${normalizedKey}`;
}

function buildMediaUploadKey(folderName, remoteFileName) {
  const folderKey = normalizeObjectKey(folderName).replace(/\/+$/g, '');
  const remoteKey = normalizeObjectKey(remoteFileName);
  const uploadKey = isSecureAssetKey(remoteKey) || !folderKey
    ? remoteKey
    : `${folderKey}/${remoteKey}`;
  return toSecureAssetKey(uploadKey);
}

function buildMediaDeliveryUrl(key) {
  const cdnUrl = buildStaticCdnUrl(key);
  if (shouldUseDockerLocalMedia()) {
    return cdnUrl;
  }
  return isSecureAssetKey(key) ? signCloudFrontUrl(cdnUrl) : cdnUrl;
}

function getDockerMediaFilePath(key) {
  const normalizedKey = normalizeObjectKey(key);
  if (normalizedKey.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return path.join(
      process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2',
      normalizedKey.slice(SECURE_ASSET_PREFIX.length + 1)
    );
  }
  return path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', normalizedKey.replace(/^assets\//, ''));
}

async function persistDockerMediaFile(absolutePath, key) {
  const destinationPath = getDockerMediaFilePath(key);
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  if (path.resolve(absolutePath) !== path.resolve(destinationPath)) {
    await fs.promises.copyFile(absolutePath, destinationPath);
  }
  return buildMediaDeliveryUrl(key);
}

async function persistDockerMediaBuffer(buffer, key) {
  const destinationPath = getDockerMediaFilePath(key);
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.promises.writeFile(destinationPath, buffer);
  return buildMediaDeliveryUrl(key);
}

function isKnownMediaDeliveryUrl(value) {
  try {
    const parsedUrl = new URL(value);
    const staticCdnHostname = new URL(STATIC_CDN_URL).hostname;
    return parsedUrl.hostname === staticCdnHostname ||
      parsedUrl.hostname === `${MEDIA_BUCKET_NAME}.s3.amazonaws.com` ||
      parsedUrl.hostname.startsWith(`${MEDIA_BUCKET_NAME}.s3.`);
  } catch {
    return false;
  }
}

export function buildSecureMediaDeliveryUrl(value) {
  if (/^https?:\/\//i.test(String(value || '')) && !isKnownMediaDeliveryUrl(value)) {
    return null;
  }
  const key = normalizeObjectKey(value);
  if (!key) {
    return null;
  }
  return buildMediaDeliveryUrl(key);
}

function buildUploadedObjectUrl({ bucketName, key, region }) {
  if (bucketName === MEDIA_BUCKET_NAME) {
    return buildMediaDeliveryUrl(key);
  }
  return `https://${bucketName}.s3.${region}.amazonaws.com/${encodeObjectKeyForUrl(key)}`;
}

async function primeMediaBucketUrl({ bucketName, url }) {
  if (shouldUseDockerLocalMedia()) {
    return;
  }
  if (bucketName !== MEDIA_BUCKET_NAME) {
    return;
  }
  await primeCDNCache(url, { requireSuccess: true });
}

const ensureS3Client = () => {
  const region = resolveBucketRegion();
  if (cachedS3Client && cachedS3Region === region) {
    return cachedS3Client;
  }
  return getS3ClientForRegion(region);
};

const ensureCdnS3Client = () => getS3ClientForRegion(resolveCdnRegion());

function scheduleS3ObjectDeletion({ s3, bucketName, key, expiresInSeconds }) {
  const ttlSeconds = Number(expiresInSeconds);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return;
  }

  const timer = setTimeout(async () => {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    } catch (error) {
      console.error(`Failed to delete expired S3 object ${bucketName}/${key}:`, error);
    }
  }, ttlSeconds * 1000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export async function uploadFrameLayerImageToCDN(absolutePath, remoteFileName) {
  const bucketName = MEDIA_BUCKET_NAME;
  const folderName = 'temp_images';
  const uploadKey = buildMediaUploadKey(folderName, remoteFileName);


  // Check if the file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaFile(absolutePath, uploadKey);
  }

  const s3 = ensureCdnS3Client();

  // Create a read stream for the file
  const fileStream = fs.createReadStream(absolutePath);

  // Define the S3 upload parameters
  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: fileStream,
    ContentType: 'image/png', // Assuming all images are PNG
  };

  try {
    // Upload the file to S3
    await s3.send(new PutObjectCommand(uploadParams));

    const uploadedUrl = buildUploadedObjectUrl({
      bucketName,
      key: uploadKey,
      region: resolveCdnRegion(),
    });
    await primeMediaBucketUrl({ bucketName, url: uploadedUrl });
    return uploadedUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('Failed to upload image to CDN');
  }
}

export async function uploadSpeechAudioToCDN(absolutePath, remoteFileName) {
  const bucketName = MEDIA_BUCKET_NAME;
  const folderName = 'temp_audio';
  const region = resolveCdnRegion();
  const uploadKey = buildMediaUploadKey(folderName, remoteFileName);

  // Check if the file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaFile(absolutePath, uploadKey);
  }

  const s3 = ensureCdnS3Client();

  // Create a read stream for the file
  const fileStream = fs.createReadStream(absolutePath);

  // Define the S3 upload parameters
  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: fileStream,
    ContentType: 'audio/mp3', // Assuming all audio files are MP3
  };

  try {
    // Upload the file to S3
    await s3.send(new PutObjectCommand(uploadParams));

    const uploadedUrl = buildUploadedObjectUrl({
      bucketName,
      key: uploadKey,
      region,
    });
    await primeMediaBucketUrl({ bucketName, url: uploadedUrl });
    return uploadedUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('Failed to upload audio to CDN');
  }
}


/**
 * Uploads a browser‑side Data URL (e.g. "data:image/png;base64,…")
 * to S3, primes the CDN, and returns the public CDN URL.
 *
 * @param {string} imageDataUrl – A complete data‑URL string.
 * @param {string} imageName    – Desired file name, including extension (e.g. "frame‑123.png").
 * @returns {Promise<string>}   – The CDN URL for the uploaded image.
 */
export async function uploadImageDataUrlToCDN(imageDataUrl, imageName, options = {}) {
  const bucketName = MEDIA_BUCKET_NAME;
  const folderName = 'temp_images';

  // ── 1. Validate & decode the Data‑URL ──────────────────────────────
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data URL.');

  const [, rawMimeType, base64Payload] = match;
  const mimeType = rawMimeType.toLowerCase();
  const buffer = Buffer.from(base64Payload, 'base64');

  let resolvedBuffer = buffer;
  let resolvedMimeType = mimeType;
  let resolvedImageName = imageName;

  if (HEIC_MIME_TYPES.has(mimeType)) {
    try {
      resolvedBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
      resolvedMimeType = JPEG_MIME_TYPE;
      resolvedImageName = replaceFileExtension(imageName, JPEG_EXTENSION);
    } catch (error) {
      console.error(
        '[uploadImageDataUrlToCDN] Failed to convert HEIC to JPEG; uploading original.',
        error
      );
      const fallbackExtension = HEIC_EXTENSION_MAP[mimeType] || 'heic';
      resolvedImageName = replaceFileExtension(imageName, fallbackExtension);
    }
  }
  const uploadKey = buildMediaUploadKey(folderName, resolvedImageName);

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaBuffer(resolvedBuffer, uploadKey);
  }

  const s3 = ensureCdnS3Client();

  // ── 2. Upload to S3 ────────────────────────────────────────────────
  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: resolvedBuffer,
    ContentType: resolvedMimeType,
    ContentEncoding: 'base64',
  };

  try {
    if (Number.isFinite(Number(options.expiresInSeconds)) && Number(options.expiresInSeconds) > 0) {
      const expiresAt = new Date(Date.now() + Number(options.expiresInSeconds) * 1000);
      const ttlSeconds = Math.floor(Number(options.expiresInSeconds));
      uploadParams.Expires = expiresAt;
      uploadParams.Metadata = {
        ...(uploadParams.Metadata || {}),
        expires_at: expiresAt.toISOString(),
      };
      uploadParams.Tagging = `ttl_seconds=${encodeURIComponent(String(ttlSeconds))}`;
    }

    await s3.send(new PutObjectCommand(uploadParams));

    const cdnUrl = buildUploadedObjectUrl({
      bucketName,
      key: uploadKey,
      region: resolveCdnRegion(),
    });
    await primeMediaBucketUrl({ bucketName, url: cdnUrl });
    scheduleS3ObjectDeletion({
      s3,
      bucketName,
      key: uploadKey,
      expiresInSeconds: options.expiresInSeconds,
    });

    return cdnUrl;
  } catch (err) {
    console.error('Error uploading image data‑URL:', err);
    throw new Error('Failed to upload image to CDN');
  }
}

export async function uploadImageBufferToCDN(buffer, imageName, contentType = 'image/png', options = {}) {
  const bucketName = MEDIA_BUCKET_NAME;
  const folderName = options.folderName || 'temp_images';
  const uploadKey = buildMediaUploadKey(folderName, imageName);

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Invalid image buffer.');
  }
  if (typeof imageName !== 'string' || !imageName.trim()) {
    throw new Error('Missing image name.');
  }

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaBuffer(buffer, uploadKey);
  }

  const s3 = ensureCdnS3Client();

  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: buffer,
    ContentType: contentType || 'image/png',
  };

  if (Number.isFinite(Number(options.expiresInSeconds)) && Number(options.expiresInSeconds) > 0) {
    const expiresAt = new Date(Date.now() + Number(options.expiresInSeconds) * 1000);
    const ttlSeconds = Math.floor(Number(options.expiresInSeconds));
    uploadParams.Expires = expiresAt;
    uploadParams.Metadata = {
      expires_at: expiresAt.toISOString(),
    };
    uploadParams.Tagging = `ttl_seconds=${encodeURIComponent(String(ttlSeconds))}`;
  }

  try {
    await s3.send(new PutObjectCommand(uploadParams));
    const cdnUrl = buildUploadedObjectUrl({
      bucketName,
      key: uploadKey,
      region: resolveCdnRegion(),
    });
    await primeMediaBucketUrl({ bucketName, url: cdnUrl });
    scheduleS3ObjectDeletion({
      s3,
      bucketName,
      key: uploadKey,
      expiresInSeconds: options.expiresInSeconds,
    });
    return cdnUrl;
  } catch (err) {
    console.error('Error uploading image buffer:', err);
    throw new Error('Failed to upload image to CDN');
  }
}


/**
 * Helper function to access a URL to prime the CDN cache.
 *
 * @param {string} url - The URL to access.
 * @param {{ requireSuccess?: boolean, attempts?: number, retryDelayMs?: number }} options
 */
export async function primeCDNCache(url, options = {}) {
  if (shouldUseDockerLocalMedia()) {
    return true;
  }

  const requireSuccess = Boolean(options.requireSuccess);
  const attempts = Math.max(1, Number(options.attempts || (requireSuccess ? 3 : 1)));
  const retryDelayMs = Number(options.retryDelayMs || CDN_PRIME_RETRY_DELAY_MS);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      if (response.body) {
        try {
          if (typeof response.body.cancel === 'function') {
            await response.body.cancel();
          } else if (typeof response.body.destroy === 'function') {
            response.body.destroy();
          }
        } catch {}
      }
      if (response.ok) {
        return true;
      }
      lastError = new Error(`CDN cache prime returned status ${response.status}`);
    } catch (error) {
      lastError = error;
      console.error(`Error priming CDN cache for URL: ${url}.`, error);
    }

    if (attempt < attempts) {
      await delay(retryDelayMs);
    }
  }

  if (requireSuccess) {
    throw lastError || new Error(`Failed to prime CDN cache for URL: ${url}`);
  }
  return false;
}

export async function uploadBufferToS3({ bucketName, key, buffer, contentType }) {
  // Legacy behavior: use the default/resolved region (often CDN region) to avoid breaking existing flows.
  if (!bucketName) {
    throw new Error('Missing bucketName for uploadBufferToS3');
  }
  if (!key) {
    throw new Error('Missing key for uploadBufferToS3');
  }
  if (!buffer) {
    throw new Error('Missing buffer for uploadBufferToS3');
  }

  if (shouldUseDockerLocalMedia() && bucketName === MEDIA_BUCKET_NAME) {
    return persistDockerMediaBuffer(buffer, key);
  }

  const s3 = ensureS3Client();

  const uploadParams = {
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  };

  await s3.send(new PutObjectCommand(uploadParams));

  const region = resolveCdnRegion();
  const uploadedUrl = buildUploadedObjectUrl({ bucketName, key, region });
  await primeMediaBucketUrl({ bucketName, url: uploadedUrl });
  return uploadedUrl;
}

/**
 * Upload that first resolves the bucket's actual region to avoid endpoint mismatch errors.
 * Use this for buckets that live outside the default/CDN region (e.g., rollup banner bucket).
 */
export async function uploadBufferToS3WithRegion({ bucketName, key, buffer, contentType }) {
  if (!bucketName) {
    throw new Error('Missing bucketName for uploadBufferToS3WithRegion');
  }
  if (!key) {
    throw new Error('Missing key for uploadBufferToS3WithRegion');
  }
  if (!buffer) {
    throw new Error('Missing buffer for uploadBufferToS3WithRegion');
  }

  if (shouldUseDockerLocalMedia() && bucketName === MEDIA_BUCKET_NAME) {
    return persistDockerMediaBuffer(buffer, key);
  }

  const region = await getBucketRegion(bucketName);
  const s3 = getS3ClientForRegion(region);

  const uploadParams = {
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  };

  await s3.send(new PutObjectCommand(uploadParams));

  const urlRegion = region || resolveCdnRegion();
  const uploadedUrl = buildUploadedObjectUrl({ bucketName, key, region: urlRegion });
  await primeMediaBucketUrl({ bucketName, url: uploadedUrl });
  return uploadedUrl;
}

export async function getObjectFromS3({ bucketName, key, range = null }) {
  if (!bucketName) {
    throw new Error('Missing bucketName for getObjectFromS3');
  }
  if (!key) {
    throw new Error('Missing key for getObjectFromS3');
  }

  const region = await getBucketRegion(bucketName);
  const s3 = getS3ClientForRegion(region);

  return s3.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ...(range ? { Range: range } : {}),
  }));
}

export async function getObjectStreamFromS3({ bucketName, key }) {
  const response = await getObjectFromS3({ bucketName, key });
  return response.Body;
}

const bucketRegionCache = new Map();

async function getBucketRegion(bucketName) {
  if (bucketRegionCache.has(bucketName)) {
    return bucketRegionCache.get(bucketName);
  }

  const fallbackRegion = resolveBucketRegion();
  try {
    const s3 = getS3ClientForRegion(fallbackRegion);
    const location = await s3.send(new GetBucketLocationCommand({ Bucket: bucketName }));
    let region = location?.LocationConstraint || 'us-east-1';
    // Legacy buckets sometimes return an empty string; treat that as us-east-1.
    if (region === '') {
      region = 'us-east-1';
    }
    bucketRegionCache.set(bucketName, region);
    return region;
  } catch (err) {
    bucketRegionCache.set(bucketName, fallbackRegion);
    return fallbackRegion;
  }
}

export async function deleteObjectsWithPrefix({ bucketName, prefix }) {
  const region = await getBucketRegion(bucketName);
  const s3 = getS3ClientForRegion(region);

  if (!bucketName) {
    throw new Error('Missing bucketName for deleteObjectsWithPrefix');
  }
  if (!prefix) {
    throw new Error('Missing prefix for deleteObjectsWithPrefix');
  }

  let continuationToken = undefined;
  do {
    const listResponse = await s3.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    const objects = (listResponse?.Contents || []).map((obj) => ({ Key: obj.Key }));

    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: objects,
          Quiet: true,
        },
      }));
    }

    continuationToken = listResponse?.IsTruncated ? listResponse.NextContinuationToken : undefined;
  } while (continuationToken);
}
