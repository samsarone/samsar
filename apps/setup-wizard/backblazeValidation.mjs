import {
  parseBackblazeS3Endpoint,
  validateExternalStorageConfig,
} from './storageConfig.mjs';

const BACKBLAZE_AUTHORIZE_ACCOUNT_URL =
  'https://api.backblazeb2.com/b2api/v4/b2_authorize_account';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAuthorizedBucketNames(allowed = {}) {
  if (!Array.isArray(allowed.buckets)) {
    return [];
  }
  return allowed.buckets
    .map((bucket) => normalizeString(bucket?.name || bucket?.bucketName))
    .filter(Boolean);
}

export async function validateBackblazeStorageCredentials(
  storage = {},
  { fetchImpl = globalThis.fetch } = {},
) {
  validateExternalStorageConfig({ storage });
  if (typeof fetchImpl !== 'function') {
    throw new Error('Backblaze credential validation is unavailable in this runtime.');
  }

  const applicationKeyId = normalizeString(storage.accessKeyId);
  const applicationKey = normalizeString(storage.secretAccessKey);
  let response;
  try {
    response = await fetchImpl(BACKBLAZE_AUTHORIZE_ACCOUNT_URL, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${applicationKeyId}:${applicationKey}`).toString('base64')}`,
      },
    });
  } catch (error) {
    throw new Error(`Unable to reach Backblaze credential validation: ${error?.message || 'network request failed'}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? 'Backblaze rejected the Application Key ID or Application Key. Enter the key value shown once when a standard application key is created; do not enter its key name.'
        : `Backblaze credential validation failed with HTTP ${response.status}.`,
    );
  }

  const accountId = normalizeString(body.accountId);
  const credentialType = accountId && applicationKeyId === accountId ? 'master' : 'application';

  const storageApi = body.apiInfo?.storageApi || {};
  const configuredEndpoint = parseBackblazeS3Endpoint(storage.s3Endpoint);
  const authorizedEndpoint = parseBackblazeS3Endpoint(storageApi.s3ApiUrl || '');
  if (configuredEndpoint.endpoint !== authorizedEndpoint.endpoint) {
    throw new Error(
      `The Backblaze application key belongs to ${authorizedEndpoint.endpoint}, but the configured bucket endpoint is ${configuredEndpoint.endpoint}.`,
    );
  }

  const allowed = storageApi.allowed || {};
  const capabilities = Array.isArray(allowed.capabilities) ? allowed.capabilities : [];
  if (!capabilities.includes('writeFiles')) {
    throw new Error('The Backblaze application key does not have the writeFiles capability required for media uploads.');
  }

  const mediaBucketName = normalizeString(storage.mediaBucketName);
  const authorizedBucketNames = getAuthorizedBucketNames(allowed);
  if (authorizedBucketNames.length && !authorizedBucketNames.includes(mediaBucketName)) {
    throw new Error(`The Backblaze application key is not authorized for bucket "${mediaBucketName}".`);
  }

  return {
    ok: true,
    provider: 'backblaze-b2',
    credentialType,
    mediaBucketName,
    s3Endpoint: configuredEndpoint.endpoint,
    region: configuredEndpoint.region,
    message: credentialType === 'master'
      ? `Backblaze master key verified for bucket "${mediaBucketName}". Uploads will use the Native B2 API.`
      : `Backblaze application key verified for bucket "${mediaBucketName}". Uploads will use the S3-compatible API.`,
  };
}
