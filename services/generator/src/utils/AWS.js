// uploadImageToCDN.js

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  createBackblazeNativeClientFromEnv,
  shouldUseBackblazeNativeApi,
} from './BackblazeNativeClient.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  assertExplicitDockerExternalMediaConfiguration,
  buildStableDockerMediaUrl,
} from './DockerMediaDeliveryUrl.js';
import { isDockerRuntime as isConfiguredDockerRuntime } from './Environment.js';

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
    return buildStableDockerMediaUrl(key);
  }
  const cdnUrl = buildStaticCdnUrl(key);
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
 * You can set maxAttempts to 3, but note that streaming PUTs can still be “non-retryable”
 * if the body cannot be re-sent. We will implement manual retries below.
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
    requestHandler: new NodeHttpHandler({
      // Timeouts in milliseconds
      connectionTimeout: 30000, // 30s to establish a TCP connection
      socketTimeout: 300000,    // 5 minutes for an HTTP request
    }),
    maxAttempts: 3,      // AWS SDK retry attempts (some streaming requests are not retried)
    retryMode: 'standard'
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
      console.error(`Failed to prime CDN cache for URL: ${url}. Status: ${response.status}`);
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

/**
 * Uploads an image to S3 with up to 3 manual retry attempts.
 *
 * @param {string} absolutePath - The absolute file path on the local file system.
 * @param {string} remoteFileName - The file name (key) to use when storing in S3.
 * @returns {string} - The CDN URL of the uploaded file.
 * @throws {Error} - If all attempts fail.
 */
export async function uploadImageToCDN(absolutePath, remoteFileName) {
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

  assertExplicitDockerExternalMediaConfiguration();

  const s3 = getS3Client();

  // We will manually retry up to 3 times.
  const MAX_RETRIES = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Create a fresh read stream for each attempt
    const fileStream = fs.createReadStream(absolutePath);

    // Define the S3 upload parameters
    const uploadParams = {
      Bucket: bucketName,
      Key: uploadKey,
      Body: fileStream,
      ContentType: 'image/png', // Adjust if your images are not always PNG
    };

    try {

      await s3.send(new PutObjectCommand(uploadParams));


      const cdnUrl = buildMediaDeliveryUrl(uploadKey);
      await primeCDNCache(cdnUrl, { requireSuccess: true });
      return cdnUrl;
    } catch (error) {
      console.error(`Upload attempt #${attempt} failed:`, error);
      lastError = error;

      // If this is not the last attempt, optionally wait or implement an exponential backoff
      if (attempt < MAX_RETRIES) {
        // swallow and retry
      }
    }
  }

  // If we exit the loop, all attempts failed
  throw new Error(`Failed to upload image after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}
