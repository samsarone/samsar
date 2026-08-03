// uploadImageToCDN.js

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  createBackblazeNativeClientFromEnv,
  shouldUseBackblazeNativeApi,
} from './utils/BackblazeNativeClient.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isDockerRuntime as isConfiguredDockerRuntime } from './util/environmentUtils.js';

/**
 * Reads AWS credentials and region from environment variables.
 */
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_CDN_REGION || process.env.AWS_REGION || 'us-west-2';
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cachedCloudFrontPrivateKey;

function buildStaticCdnUrl(key) {
  const cdnBase = STATIC_CDN_URL.endsWith('/') ? STATIC_CDN_URL.slice(0, -1) : STATIC_CDN_URL;
  const encodedKey = String(key)
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${cdnBase}/${encodedKey}`;
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
      const parsedUrl = new URL(rawKey);
      let objectKey = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      const configuredCdnUrl = new URL(process.env.STATIC_CDN_URL || STATIC_CDN_URL);
      const configuredBasePath = decodeURIComponent(configuredCdnUrl.pathname)
        .replace(/^\/+|\/+$/g, '');
      if (
        configuredBasePath &&
        parsedUrl.origin === configuredCdnUrl.origin &&
        (objectKey === configuredBasePath || objectKey.startsWith(`${configuredBasePath}/`))
      ) {
        objectKey = objectKey.slice(configuredBasePath.length).replace(/^\/+/, '');
      }
      return objectKey;
    } catch {
      return rawKey.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
    }
  }
  return rawKey.replace(/^\/+/, '');
}

function isSecureAssetKey(key) {
  return normalizeObjectKey(key).startsWith(`${SECURE_ASSET_PREFIX}/`);
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

function isKnownMediaDeliveryUrl(value) {
  try {
    const url = new URL(value);
    const staticCdnUrl = new URL(STATIC_CDN_URL);
    if (url.origin === staticCdnUrl.origin) {
      return true;
    }

    const hostname = url.hostname.toLowerCase();
    const bucketName = String(MEDIA_BUCKET_NAME || '').trim().toLowerCase();
    const objectPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    return Boolean(bucketName) && (
      hostname === `${bucketName}.s3.amazonaws.com` ||
      hostname.startsWith(`${bucketName}.s3.`) ||
      ((hostname === 's3.amazonaws.com' || hostname.startsWith('s3.')) &&
        objectPath.startsWith(`${bucketName}/`))
    );
  } catch {
    return false;
  }
}

/**
 * Build a provider-facing delivery URL only for a Samsar media key or a URL
 * owned by the configured media bucket/CDN. Independent third-party URLs are
 * deliberately not rewritten.
 */
export function buildSecureMediaDeliveryUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  if (/^https?:\/\//i.test(normalized) && !isKnownMediaDeliveryUrl(normalized)) {
    return null;
  }

  const key = normalizeObjectKey(normalized);
  assertConfiguredDockerExternalS3Delivery();
  return key ? buildMediaDeliveryUrl(key) : null;
}

function getAudioContentType(fileName = '') {
  const extension = path.extname(fileName).toLowerCase();
  const contentTypeByExtension = {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
  };
  return contentTypeByExtension[extension] || 'audio/mpeg';
}

function isDockerRuntime() {
  return isConfiguredDockerRuntime();
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

function isPrivateOrLocalHostname(value) {
  const hostname = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname === '::1' ||
    hostname === 'host.docker.internal'
  ) {
    return true;
  }

  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    const [first, second] = octets;
    return first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224;
  }

  return /^(?:fc|fd|fe[89ab])/i.test(hostname);
}

function buildExternalS3ConfigurationError() {
  const error = new Error(
    'Docker external-S3 media delivery requires an explicitly configured media bucket and public HTTPS STATIC_CDN_URL.',
  );
  error.name = 'SamsarExternalS3ConfigurationError';
  error.code = 'SAMSAR_EXTERNAL_S3_CONFIG_INVALID';
  error.retryable = false;
  return error;
}

/**
 * Docker must never fall through to the hosted production bucket/CDN defaults.
 * External publishing is allowed only when this installation explicitly owns
 * both the upload bucket and a provider-reachable HTTPS delivery origin.
 */
function assertConfiguredDockerExternalS3Delivery() {
  if (!isDockerRuntime() || shouldUseDockerLocalMedia()) {
    return;
  }

  const explicitBucket = String(
    process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET || '',
  ).trim();
  const explicitCdnBase = String(process.env.STATIC_CDN_URL || '').trim();
  let parsedCdnBase;
  try {
    parsedCdnBase = new URL(explicitCdnBase);
  } catch {}

  if (
    !explicitBucket ||
    !parsedCdnBase ||
    parsedCdnBase.protocol !== 'https:' ||
    parsedCdnBase.username ||
    parsedCdnBase.password ||
    isPrivateOrLocalHostname(parsedCdnBase.hostname)
  ) {
    throw buildExternalS3ConfigurationError();
  }
}

function getDockerAssetsV2Root() {
  return path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2').replace(/\\/g, '/').replace(/\/+$/, '');
}

function toDockerLocalAssetReference(absolutePath, remoteFileName = '') {
  const normalizedRemoteFileName = normalizeObjectKey(remoteFileName);
  if (
    normalizedRemoteFileName.startsWith(`${SECURE_ASSET_PREFIX}/`) ||
    normalizedRemoteFileName.startsWith('assets_v2/')
  ) {
    return normalizedRemoteFileName;
  }

  const normalizedAbsolutePath = path.resolve(absolutePath).replace(/\\/g, '/');
  const assetsRoot = getDockerAssetsV2Root();
  if (normalizedAbsolutePath.startsWith(`${assetsRoot}/`)) {
    return `${SECURE_ASSET_PREFIX}/${normalizedAbsolutePath.slice(assetsRoot.length + 1)}`;
  }

  return normalizedRemoteFileName || `${SECURE_ASSET_PREFIX}/${path.basename(normalizedAbsolutePath)}`;
}

function getDockerMediaFilePath(key) {
  const normalizedKey = normalizeObjectKey(key);
  if (
    normalizedKey.startsWith(`${SECURE_ASSET_PREFIX}/`) ||
    normalizedKey.startsWith('assets_v2/')
  ) {
    const relativeKey = normalizedKey
      .replace(new RegExp(`^${SECURE_ASSET_PREFIX}/`), '')
      .replace(/^assets_v2\//, '');
    return path.join(getDockerAssetsV2Root(), relativeKey);
  }
  return path.join(getDockerAssetsV2Root(), normalizedKey);
}

async function persistDockerMediaFile(absolutePath, key) {
  const destinationPath = getDockerMediaFilePath(key);
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  if (path.resolve(absolutePath) !== path.resolve(destinationPath)) {
    await fs.promises.copyFile(absolutePath, destinationPath);
  }
  return toDockerLocalAssetReference(destinationPath, key);
}


/**
 * Validates that all required AWS environment variables are set.
 */
function validateAWSEnvVariables() {
  if (!AWS_ACCESS_KEY_ID) {
    throw new Error('Missing AWS_ACCESS_KEY_ID environment variable.');
  }
  if (!AWS_SECRET_ACCESS_KEY) {
    throw new Error('Missing AWS_SECRET_ACCESS_KEY environment variable.');
  }
  if (!AWS_REGION) {
    throw new Error('Missing AWS_REGION environment variable.');
  }
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getS3EndpointOptions() {
  const options = {};
  const endpoint = process.env.S3_ENDPOINT || process.env.AWS_S3_ENDPOINT;
  if (endpoint) {
    options.endpoint = endpoint;
  }
  if (isTruthyEnv(process.env.S3_FORCE_PATH_STYLE || process.env.AWS_S3_FORCE_PATH_STYLE)) {
    options.forcePathStyle = true;
  }
  return options;
}

/**
 * Initializes and returns an S3 client with the provided credentials and region.
 *
 * @returns {S3Client} - Configured S3 client instance.
 */
function initializeS3Client() {
  if (shouldUseBackblazeNativeApi()) {
    return createBackblazeNativeClientFromEnv();
  }
  return new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
    ...getS3EndpointOptions(),
  });
}

let s3Client;

function getS3Client() {
  validateAWSEnvVariables();
  if (!s3Client) {
    s3Client = initializeS3Client();
  }
  return s3Client;
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

  assertConfiguredDockerExternalS3Delivery();

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
    const s3 = getS3Client();
    await s3.send(new PutObjectCommand(uploadParams));

    const cdnUrl = buildMediaDeliveryUrl(uploadKey);
    await primeCDNCache(cdnUrl, { requireSuccess: true });
    return cdnUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('Failed to upload image to CDN');
  }
}


export async function uploadMusicToCDN(absolutePath, remoteFileName) {
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

  assertConfiguredDockerExternalS3Delivery();

  // Create a read stream for the file
  const fileStream = fs.createReadStream(absolutePath);
  const extension = path.extname(remoteFileName || absolutePath).toLowerCase();
  const contentTypeByExtension = {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
  };

  // Define the S3 upload parameters
  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: fileStream,
    ContentType: contentTypeByExtension[extension] || 'audio/mpeg',
  };

  try {
    // Upload the file to S3
    const s3 = getS3Client();
    await s3.send(new PutObjectCommand(uploadParams));

    const cdnUrl = buildMediaDeliveryUrl(uploadKey);
    await primeCDNCache(cdnUrl, { requireSuccess: true });
    return cdnUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('Failed to upload image to CDN');
  }
}


export async function uploadAudioAssetToCDN(absolutePath, remoteFileName) {
  const bucketName = MEDIA_BUCKET_NAME;
  const uploadKey = buildMediaUploadKey('', remoteFileName);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaFile(absolutePath, uploadKey);
  }

  assertConfiguredDockerExternalS3Delivery();

  const fileStream = fs.createReadStream(absolutePath);
  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: fileStream,
    ContentType: getAudioContentType(remoteFileName || absolutePath),
  };

  try {
    const s3 = getS3Client();
    await s3.send(new PutObjectCommand(uploadParams));

    const cdnUrl = buildMediaDeliveryUrl(uploadKey);
    await primeCDNCache(cdnUrl, { requireSuccess: true });
    return cdnUrl;
  } catch (error) {
    console.error('Error uploading audio file:', error);
    throw new Error('Failed to upload audio to CDN');
  }
}



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


export async function generateS3UrlsFromLocalFile(sessionId, filePath) {



  const bucketName = MEDIA_BUCKET_NAME;
  const folderName = `music/${sessionId}`; // Adjust the folder name as per your requirement
  const remoteFileName = path.basename(filePath);
  const uploadKey = buildMediaUploadKey(folderName, remoteFileName);

  // Ensure the file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }

  if (shouldUseDockerLocalMedia()) {
    return [await persistDockerMediaFile(filePath, uploadKey)];
  }

  assertConfiguredDockerExternalS3Delivery();

  const fileStream = fs.createReadStream(filePath);

  // Determine content type based on file extension
  // For .mp3 files, 'audio/mpeg' is a suitable content type.
  let contentType = 'application/octet-stream';
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') {
    contentType = 'audio/mpeg';
  } else if (ext === '.wav') {
    contentType = 'audio/wav';
  }

  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: fileStream,
    ContentType: contentType,
  };

  try {
    // Upload the file to S3
    const s3 = getS3Client();
    await s3.send(new PutObjectCommand(uploadParams));

    const url = buildMediaDeliveryUrl(uploadKey);
    await primeCDNCache(url, { requireSuccess: true });

    
    // Since the caller expects an array of URLs, return an array
    return [url];
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('Failed to upload file to CDN');
  }
}
