// uploadImageToCDN.js

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  createBackblazeNativeClientFromEnv,
  shouldUseBackblazeNativeApi,
} from '@samsar/backblaze-native-client';
import fs from 'fs';

import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { isStandaloneEdition } from '../utils/EnvironmentUtils.js';

/**
 * Reads AWS credentials and region from environment variables.
 */
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_CDN_REGION || process.env.AWS_REGION || 'us-west-2';

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME ||
  process.env.STATIC_CDN_BUCKET ||
  process.env.SAMSAR_EXTERNAL_MEDIA_BUCKET ||
  (isStandaloneEdition() ? '' : 'samsar-resources');
const STATIC_CDN_URL = process.env.STATIC_CDN_URL ||
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL ||
  (isStandaloneEdition() ? '' : 'https://static.samsar.one/');

export const __testOnly__ = Object.freeze({
  mediaBucketName: MEDIA_BUCKET_NAME,
  staticCdnUrl: STATIC_CDN_URL,
  region: AWS_REGION,
});

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
  if (!MEDIA_BUCKET_NAME) {
    throw new Error('Standalone Docker media storage requires an explicitly configured MEDIA_BUCKET_NAME.');
  }
  if (!STATIC_CDN_URL) {
    throw new Error('Standalone Docker media storage requires an explicitly configured STATIC_CDN_URL.');
  }
}

// Call the validation function at module load time
validateAWSEnvVariables();

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

// Initialize the S3 client
const s3 = initializeS3Client();

export async function primeCDNCache(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (response.ok) {
      return;
    }
  } catch {
  }
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

  // Check if the file exists
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found at path: ${absolutePath}`);
  }

  const fileSize = fs.statSync(absolutePath).size;

  // We will manually retry up to 3 times.
  const MAX_RETRIES = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Create a fresh read stream for each attempt
    const fileStream = fs.createReadStream(absolutePath);

    // Define the S3 upload parameters
    const uploadParams = {
      Bucket: bucketName,
      Key: `${folderName}/${remoteFileName}`,
      Body: fileStream,
      ContentType: 'image/png', // Adjust if your images are not always PNG
      ContentLength: fileSize,
    };

    try {

      await s3.send(new PutObjectCommand(uploadParams));

      // If successful, construct the public (CDN) URL
      const cdnUrl = `${STATIC_CDN_URL.replace(/\/+$/, '')}/${folderName}/${remoteFileName}`;

      return cdnUrl;
    } catch (error) {
      lastError = error;
    }
  }

  // If we exit the loop, all attempts failed
  throw new Error(`Failed to upload image after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}
