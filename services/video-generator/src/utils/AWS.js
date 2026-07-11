// uploadImageToCDN.js

import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage'; 
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { resolveDockerLocalPublicAssetBaseUrl } from '../consts/DockerDeploymentUrls.js';


const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_CDN_REGION || process.env.AWS_REGION || 'us-west-2';
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET || 'samsar-resources';

const STATIC_CDN_URL = process.env.STATIC_CDN_URL || 'https://static.samsar.one/';
const PUBLICATION_MEDIA_PREFIX = 'published';
const CDN_PRIME_RETRY_DELAY_MS = 500;
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const DEFAULT_CLOUDFRONT_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const configuredCloudFrontSignedUrlTtlSeconds = Number(process.env.CLOUDFRONT_SIGNED_URL_TTL_SECONDS);
const CLOUDFRONT_SIGNED_URL_TTL_SECONDS = Number.isFinite(configuredCloudFrontSignedUrlTtlSeconds) && configuredCloudFrontSignedUrlTtlSeconds > 0
  ? configuredCloudFrontSignedUrlTtlSeconds
  : DEFAULT_CLOUDFRONT_SIGNED_URL_TTL_SECONDS;

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

function buildUrlFromBase(baseUrl, key) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const encodedKey = String(key)
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return normalizedBase ? `${normalizedBase}/${encodedKey}` : encodedKey;
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

  const expiresAt = Math.floor(Date.now() / 1000) + CLOUDFRONT_SIGNED_URL_TTL_SECONDS;
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
  if (shouldUseDockerLocalMedia()) {
    return buildUrlFromBase(resolveDockerLocalPublicAssetBaseUrl(), key);
  }
  const cdnUrl = buildStaticCdnUrl(key);
  return isSecureAssetKey(key) ? signCloudFrontUrl(cdnUrl) : cdnUrl;
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

function getDockerAssetsV2Root() {
  return path.resolve(process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2').replace(/\\/g, '/').replace(/\/+$/, '');
}

function getDockerMediaFilePath(key) {
  const normalizedKey = normalizeObjectKey(key);
  const relativeKey = normalizedKey
    .replace(new RegExp(`^${SECURE_ASSET_PREFIX}/`), '')
    .replace(/^assets_v2\//, '');
  return path.join(getDockerAssetsV2Root(), relativeKey);
}

async function persistDockerMediaFile(absolutePath, key) {
  const destinationPath = getDockerMediaFilePath(key);
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  if (path.resolve(absolutePath) !== path.resolve(destinationPath)) {
    await fs.promises.copyFile(absolutePath, destinationPath);
  }
  return buildMediaDeliveryUrl(key);
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


export async function uploadVideoToCDN(absolutePath, remoteFileName) {
  const bucketName = MEDIA_BUCKET_NAME;
  const folderName = 'temp_video';
  const uploadKey = buildMediaUploadKey(folderName, remoteFileName);
  const downloadFileName = normalizeObjectKey(remoteFileName).split('/').pop() || remoteFileName;
  let cdnUrl;

  // Check if the file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaFile(absolutePath, uploadKey);
  }

  const s3 = getS3Client();

  // We'll try up to 3 times before giving up
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Prepare the multipart upload
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucketName,
          Key: uploadKey,
          Body: fs.createReadStream(absolutePath),
          ContentType: 'video/mp4', 
          ContentDisposition: `attachment; filename="${downloadFileName}"`,
        },
        // Optional configuration for concurrency/part size:
        // partSize: 5 * 1024 * 1024, // 5MB part size
        // queueSize: 4, // concurrency for uploading parts
        leavePartsOnError: false, // automatically clean up parts if upload fails
      });

      // Initiate the upload
      await upload.done();

      cdnUrl = buildMediaDeliveryUrl(uploadKey);
      break;
    } catch (error) {
      console.error(`Attempt ${attempt} to upload video failed:`, error);
      if (attempt === 3) {
        throw new Error('Failed to upload video to CDN after 3 attempts.');
      }
    }
  }

  await primeCDNCache(cdnUrl, { requireSuccess: true });
  return cdnUrl;
}

export async function uploadPublicationThumbnailToCDN(absolutePath, sessionId) {
  const normalizedSessionId = sessionId?.toString?.().trim?.() || '';
  if (!normalizedSessionId) {
    throw new Error('Missing sessionId for publication thumbnail upload.');
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  const publicationKey = `${PUBLICATION_MEDIA_PREFIX}/${normalizedSessionId}/thumbnail.png`;
  if (shouldUseDockerLocalMedia()) {
    // The Docker processor serves /assets_v2, while S3/CloudFront serves the
    // same object without the secure assets_v2 prefix.
    return persistDockerMediaFile(absolutePath, `${SECURE_ASSET_PREFIX}/${publicationKey}`);
  }

  const s3 = getS3Client();
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: MEDIA_BUCKET_NAME,
      Key: publicationKey,
      Body: fs.createReadStream(absolutePath),
      ContentType: 'image/png',
      CacheControl: 'public, max-age=60, must-revalidate',
    },
    leavePartsOnError: false,
  });
  await upload.done();

  const publicUrl = buildStaticCdnUrl(publicationKey);
  await primeCDNCache(publicUrl, { requireSuccess: false });
  return publicUrl;
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
