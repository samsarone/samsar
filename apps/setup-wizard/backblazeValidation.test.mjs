import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBackblazeStorageCredentials } from './backblazeValidation.mjs';

function buildStorage(overrides = {}) {
  return {
    mode: 'backblaze-b2',
    backend: 'backblaze-b2',
    mediaBucketName: 'samsar',
    accessKeyId: 'standard-application-key-id',
    secretAccessKey: 'one-time-application-key-value',
    s3Endpoint: 'https://s3.us-east-005.backblazeb2.com',
    externalMediaPublishEnabled: true,
    ...overrides,
  };
}

function buildAuthorizationResponse(overrides = {}) {
  const body = {
    accountId: 'account-id-does-not-match-standard-key',
    apiInfo: {
      storageApi: {
        s3ApiUrl: 'https://s3.us-east-005.backblazeb2.com',
        allowed: {
          capabilities: ['readFiles', 'writeFiles'],
          buckets: [{ name: 'samsar' }],
        },
      },
    },
    ...overrides,
  };
  return async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

test('accepts a standard Backblaze application key with upload access', async () => {
  const result = await validateBackblazeStorageCredentials(buildStorage(), {
    fetchImpl: buildAuthorizationResponse(),
  });
  assert.deepEqual(result, {
    ok: true,
    provider: 'backblaze-b2',
    credentialType: 'application',
    mediaBucketName: 'samsar',
    s3Endpoint: 'https://s3.us-east-005.backblazeb2.com',
    region: 'us-east-005',
    message: 'Backblaze application key verified for bucket "samsar". Uploads will use the S3-compatible API.',
  });
});

test('detects a valid Backblaze master key and selects the Native B2 API', async () => {
  const storage = buildStorage({ accessKeyId: 'master-account-id' });
  const result = await validateBackblazeStorageCredentials(storage, {
      fetchImpl: buildAuthorizationResponse({ accountId: 'master-account-id' }),
  });
  assert.equal(result.credentialType, 'master');
  assert.match(result.message, /Native B2 API/);
});

test('rejects a key for a different Backblaze endpoint', async () => {
  await assert.rejects(
    validateBackblazeStorageCredentials(buildStorage(), {
      fetchImpl: buildAuthorizationResponse({
        apiInfo: {
          storageApi: {
            s3ApiUrl: 'https://s3.us-west-004.backblazeb2.com',
            allowed: { capabilities: ['writeFiles'] },
          },
        },
      }),
    }),
    /belongs to https:\/\/s3\.us-west-004\.backblazeb2\.com/,
  );
});

test('rejects keys without Backblaze upload capability or bucket access', async () => {
  await assert.rejects(
    validateBackblazeStorageCredentials(buildStorage(), {
      fetchImpl: buildAuthorizationResponse({
        apiInfo: {
          storageApi: {
            s3ApiUrl: 'https://s3.us-east-005.backblazeb2.com',
            allowed: { capabilities: ['readFiles'] },
          },
        },
      }),
    }),
    /writeFiles capability/,
  );

  await assert.rejects(
    validateBackblazeStorageCredentials(buildStorage(), {
      fetchImpl: buildAuthorizationResponse({
        apiInfo: {
          storageApi: {
            s3ApiUrl: 'https://s3.us-east-005.backblazeb2.com',
            allowed: {
              capabilities: ['writeFiles'],
              buckets: [{ name: 'another-bucket' }],
            },
          },
        },
      }),
    }),
    /not authorized for bucket "samsar"/,
  );
});

test('explains that the application key value is not the key name', async () => {
  await assert.rejects(
    validateBackblazeStorageCredentials(buildStorage(), {
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    }),
    /key value shown once[\s\S]*do not enter its key name/,
  );
});
