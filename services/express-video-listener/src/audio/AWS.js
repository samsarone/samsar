// uploadImageToCDN.js

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage'; 
import fs from 'fs';
import path from 'path';

/**
 * Reads AWS credentials and region from environment variables.
 */
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_CDN_REGION || process.env.AWS_REGION || 'us-west-2';
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME || process.env.STATIC_CDN_BUCKET || 'samsar-resources';
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');

const STATIC_CDN_URL = process.env.STATIC_CDN_URL || 'https://static.samsar.one/';

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

function toSecureAssetKey(key) {
  const normalizedKey = normalizeObjectKey(key);
  return normalizedKey.startsWith(`${SECURE_ASSET_PREFIX}/`)
    ? normalizedKey
    : `${SECURE_ASSET_PREFIX}/${normalizedKey}`;
}

function buildMediaUploadKey(folderName, remoteFileName) {
  const folderKey = normalizeObjectKey(folderName).replace(/\/+$/g, '');
  const remoteKey = normalizeObjectKey(remoteFileName);
  const uploadKey = remoteKey.startsWith(`${SECURE_ASSET_PREFIX}/`) || !folderKey
    ? remoteKey
    : `${folderKey}/${remoteKey}`;
  return toSecureAssetKey(uploadKey);
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
  return buildStaticCdnUrl(key);
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

  const fileSize = fs.statSync(absolutePath).size;

  // Create a read stream for the file
  const fileStream = fs.createReadStream(absolutePath);

  // Define the S3 upload parameters
  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: fileStream,
    ContentType: 'image/png', // Assuming all images are PNG
    ContentLength: fileSize,
  };

  try {
    // Upload the file to S3
    await getS3Client().send(new PutObjectCommand(uploadParams));

    // Construct the public URL
    return buildStaticCdnUrl(uploadKey);
  } catch {
    throw new Error('Failed to upload image to CDN');
  }
}

export async function uploadSpeechAudioToCDN(absolutePath, remoteFileName) {
  const bucketName = MEDIA_BUCKET_NAME;
  const folderName = 'temp_audio';
  const uploadKey = buildMediaUploadKey(folderName, remoteFileName);

  // Check if the file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaFile(absolutePath, uploadKey);
  }

  const fileSize = fs.statSync(absolutePath).size;

  // Create a read stream for the file
  const fileStream = fs.createReadStream(absolutePath);

  // Define the S3 upload parameters
  const uploadParams = {
    Bucket: bucketName,
    Key: uploadKey,
    Body: fileStream,
    ContentType: 'audio/mp3', // Assuming all audio files are MP3
    ContentLength: fileSize,
  };

  try {
    // Upload the file to S3
    await getS3Client().send(new PutObjectCommand(uploadParams));

    // Construct the public URL
    return buildStaticCdnUrl(uploadKey);
  } catch {
    throw new Error('Failed to upload audio to CDN');
  }
}

/**
 * Uploads a large video to S3 in a multipart upload with up to 3 retries.
 * 
 * @param {string} absolutePath - The absolute path to the video file on local disk.
 * @param {string} remoteFileName - The desired filename (key) on S3.
 * @returns {string} - The public URL of the uploaded video.
 */
export async function uploadVideoToCDN(absolutePath, remoteFileName) {
  const bucketName = MEDIA_BUCKET_NAME;
  const folderName = 'temp_video';
  const uploadKey = buildMediaUploadKey(folderName, remoteFileName);

  // Check if the file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  if (shouldUseDockerLocalMedia()) {
    return persistDockerMediaFile(absolutePath, uploadKey);
  }

  // We'll try up to 3 times before giving up
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Prepare the multipart upload
      const upload = new Upload({
        client: getS3Client(),
        params: {
          Bucket: bucketName,
          Key: uploadKey,
          Body: fs.createReadStream(absolutePath),
          ContentType: 'video/mp4', // Adjust if needed
        },
        // Optional configuration for concurrency/part size:
        // partSize: 5 * 1024 * 1024, // 5MB part size
        // queueSize: 4, // concurrency for uploading parts
        leavePartsOnError: false, // automatically clean up parts if upload fails
      });

      // Initiate the upload
      await upload.done();

      // If upload succeeds, return the public URL
      return buildStaticCdnUrl(uploadKey);
    } catch {
      if (attempt === 3) {
        throw new Error('Failed to upload video to CDN after 3 attempts.');
      }
    }
  }
}

/**
 * Helper function to access a URL to prime the CDN cache.
 *
 * @param {string} url - The URL to access.
 */
export async function primeCDNCache(url) {
  if (shouldUseDockerLocalMedia()) {
    return true;
  }

  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
