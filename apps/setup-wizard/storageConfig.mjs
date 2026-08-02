export const LOCAL_MINIO_MEDIA_BUCKET = 'samsar-resources';

const EXTERNAL_STORAGE_MODES = new Set(['external-s3', 'backblaze-b2']);
const EXTERNAL_STORAGE_BACKENDS = new Set(['generic-s3', 'backblaze-b2']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeString(value).toLowerCase());
}

export function isExternalStorageConfig(storage = {}) {
  return EXTERNAL_STORAGE_MODES.has(normalizeString(storage.mode).toLowerCase()) ||
    EXTERNAL_STORAGE_BACKENDS.has(normalizeString(storage.backend).toLowerCase()) ||
    storage.externalMediaPublishEnabled === true ||
    isTruthy(storage.externalMediaPublishEnabled);
}

function parsePublicStorageUrl(storage, isBackblazeB2) {
  let publicUrl;
  try {
    publicUrl = new URL(normalizeString(storage.staticCdnUrl));
  } catch {
    throw new Error(`${isBackblazeB2 ? 'Backblaze B2 public bucket URL' : 'External S3 public CDN base URL'} must be a valid HTTPS URL.`);
  }
  if (
    publicUrl.protocol !== 'https:' ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new Error(`${isBackblazeB2 ? 'Backblaze B2 public bucket URL' : 'External S3 public CDN base URL'} must be HTTPS and must not contain credentials, a query, or a fragment.`);
  }
  return publicUrl;
}

function validateBackblazePublicBucketUrl(storage, publicUrl, region) {
  const bucketName = normalizeString(storage.mediaBucketName);
  const hostname = publicUrl.hostname.toLowerCase();
  const virtualHostedMatch = hostname.match(/^(.+)\.s3\.([a-z0-9-]+)\.backblazeb2\.com$/i);
  if (virtualHostedMatch) {
    if (virtualHostedMatch[1] !== bucketName.toLowerCase()) {
      throw new Error(`Backblaze B2 public bucket URL must reference the configured bucket "${bucketName}".`);
    }
    if (virtualHostedMatch[2] !== region) {
      throw new Error(`Backblaze B2 public bucket URL region must match the S3 endpoint region "${region}".`);
    }
    return;
  }

  if (/^f\d+\.backblazeb2\.com$/i.test(hostname)) {
    const pathSegments = decodeURIComponent(publicUrl.pathname)
      .split('/')
      .filter(Boolean);
    if (pathSegments[0] !== 'file' || pathSegments[1] !== bucketName) {
      throw new Error(`Backblaze B2 public bucket URL must reference the configured bucket "${bucketName}".`);
    }
    return;
  }

  throw new Error('Backblaze B2 public bucket URL must be a Backblaze S3 bucket URL or /file/<bucket>/ download URL.');
}

export function parseBackblazeS3Endpoint(value) {
  const configuredEndpoint = normalizeString(value);
  const endpointValue = /^[a-z][a-z\d+.-]*:\/\//i.test(configuredEndpoint)
    ? configuredEndpoint
    : `https://${configuredEndpoint}`;
  let endpoint;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new Error('Backblaze B2 S3 endpoint must be a valid hostname or HTTPS URL.');
  }

  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('Backblaze B2 S3 endpoint must be an HTTPS origin without credentials, a port, path, query, or fragment.');
  }

  const endpointMatch = endpoint.hostname.toLowerCase().match(
    /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i,
  );
  if (!endpointMatch) {
    throw new Error('Backblaze B2 S3 endpoint must look like https://s3.us-east-005.backblazeb2.com.');
  }

  return {
    endpoint: endpoint.origin,
    region: endpointMatch[1],
  };
}

export function buildBackblazePublicBucketUrl(bucketName, s3Endpoint) {
  const normalizedBucketName = normalizeString(bucketName);
  const normalizedEndpoint = normalizeString(s3Endpoint);
  if (!normalizedBucketName || !normalizedEndpoint) {
    return '';
  }

  const { endpoint } = parseBackblazeS3Endpoint(normalizedEndpoint);
  const endpointUrl = new URL(endpoint);
  return `https://${normalizedBucketName}.${endpointUrl.hostname}/`;
}

export function validateExternalStorageConfig(infrastructure = {}) {
  const storage = infrastructure.storage || {};
  if (!EXTERNAL_STORAGE_MODES.has(normalizeString(storage.mode).toLowerCase())) {
    return;
  }
  const isBackblazeB2 = storage.mode === 'backblaze-b2';
  const requiredFields = [
    ['mediaBucketName', isBackblazeB2 ? 'B2 bucket' : 'S3 bucket'],
    ...(!isBackblazeB2 ? [['region', 'S3 region']] : []),
    ['accessKeyId', isBackblazeB2 ? 'B2 application key ID' : 'S3 access key'],
    ['secretAccessKey', isBackblazeB2 ? 'B2 application key' : 'S3 secret key'],
    ...(!isBackblazeB2 ? [['staticCdnUrl', 'public CDN base URL']] : []),
    ...(isBackblazeB2 ? [['s3Endpoint', 'B2 S3 endpoint']] : []),
  ];
  const missingFields = requiredFields
    .filter(([field]) => !normalizeString(storage[field]))
    .map(([, label]) => label);
  if (missingFields.length) {
    throw new Error(`${isBackblazeB2 ? 'Backblaze B2' : 'External S3'} requires: ${missingFields.join(', ')}.`);
  }

  if (isBackblazeB2) {
    const backblazeEndpoint = parseBackblazeS3Endpoint(storage.s3Endpoint);
    const publicUrl = parsePublicStorageUrl({
      ...storage,
      staticCdnUrl: normalizeString(storage.staticCdnUrl) || buildBackblazePublicBucketUrl(
        storage.mediaBucketName,
        backblazeEndpoint.endpoint,
      ),
    }, true);
    validateBackblazePublicBucketUrl(storage, publicUrl, backblazeEndpoint.region);
  } else {
    parsePublicStorageUrl(storage, false);
  }

  const keyPairId = normalizeString(storage.cloudFront?.keyPairId);
  const privateKey = normalizeString(storage.cloudFront?.privateKey);
  const privateKeyBase64 = normalizeString(storage.cloudFront?.privateKeyBase64);
  if (!isBackblazeB2 && (keyPairId || privateKey || privateKeyBase64) && (!keyPairId || (!privateKey && !privateKeyBase64))) {
    throw new Error('CloudFront signing requires both a key pair ID and a private key or base64 private key.');
  }
}

export function resolveRuntimeMediaBucketName(storage = {}, { dockerRuntime = false } = {}) {
  const configuredBucket = normalizeString(
    storage.mediaBucketName || storage.bucketName || storage.bucket,
  );
  if (configuredBucket) {
    return configuredBucket;
  }
  if (dockerRuntime && isExternalStorageConfig(storage)) {
    throw new Error('Standalone Docker external storage requires storage.mediaBucketName; the hosted samsar-resources bucket is not a fallback.');
  }
  return LOCAL_MINIO_MEDIA_BUCKET;
}
