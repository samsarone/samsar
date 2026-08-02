import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBackblazePublicBucketUrl,
  LOCAL_MINIO_MEDIA_BUCKET,
  resolveRuntimeMediaBucketName,
  validateExternalStorageConfig,
} from './storageConfig.mjs';

test('Backblaze public bucket URL is derived from the bucket and S3 endpoint', () => {
  assert.equal(
    buildBackblazePublicBucketUrl('customer-media', 's3.us-east-005.backblazeb2.com'),
    'https://customer-media.s3.us-east-005.backblazeb2.com/',
  );
});

function buildBackblazeStorage(overrides = {}) {
  return {
    mode: 'backblaze-b2',
    backend: 'backblaze-b2',
    mediaBucketName: 'customer-media',
    staticCdnUrl: 'https://customer-media.s3.us-east-005.backblazeb2.com/',
    accessKeyId: 'application-key-id',
    secretAccessKey: 'application-key',
    s3Endpoint: 'https://s3.us-east-005.backblazeb2.com',
    externalMediaPublishEnabled: true,
    ...overrides,
  };
}

test('standalone external storage preserves the installer bucket exactly', () => {
  assert.equal(
    resolveRuntimeMediaBucketName(buildBackblazeStorage(), { dockerRuntime: true }),
    'customer-media',
  );
});

test('standalone generic S3 preserves the installer bucket exactly', () => {
  assert.equal(
    resolveRuntimeMediaBucketName({
      mode: 'external-s3',
      backend: 'generic-s3',
      mediaBucketName: 'customer-s3-media',
      externalMediaPublishEnabled: true,
    }, { dockerRuntime: true }),
    'customer-s3-media',
  );
});

test('standalone external storage never falls back to the production bucket', () => {
  assert.throws(
    () => resolveRuntimeMediaBucketName(
      buildBackblazeStorage({ mediaBucketName: '' }),
      { dockerRuntime: true },
    ),
    /hosted samsar-resources bucket is not a fallback/,
  );
});

test('local MinIO retains its internal bucket default', () => {
  assert.equal(
    resolveRuntimeMediaBucketName({
      mode: 'local-minio',
      backend: 'minio',
      externalMediaPublishEnabled: false,
    }, { dockerRuntime: true }),
    LOCAL_MINIO_MEDIA_BUCKET,
  );
});

test('Backblaze bucket URL must correspond to the selected bucket and endpoint region', () => {
  assert.doesNotThrow(() => validateExternalStorageConfig({
    storage: buildBackblazeStorage(),
  }));
  assert.throws(
    () => validateExternalStorageConfig({
      storage: buildBackblazeStorage({
        staticCdnUrl: 'https://different-bucket.s3.us-east-005.backblazeb2.com/',
      }),
    }),
    /must reference the configured bucket "customer-media"/,
  );
  assert.throws(
    () => validateExternalStorageConfig({
      storage: buildBackblazeStorage({
        staticCdnUrl: 'https://customer-media.s3.us-west-004.backblazeb2.com/',
      }),
    }),
    /region must match the S3 endpoint region "us-east-005"/,
  );
});

test('Backblaze requires an explicit S3 endpoint and derives its region from that endpoint', () => {
  assert.doesNotThrow(() => validateExternalStorageConfig({
    storage: buildBackblazeStorage(),
  }));
  assert.throws(
    () => validateExternalStorageConfig({
      storage: buildBackblazeStorage({ s3Endpoint: '' }),
    }),
    /B2 S3 endpoint/,
  );
  assert.throws(
    () => validateExternalStorageConfig({
      storage: buildBackblazeStorage({
        s3Endpoint: 'https://s3.us-west-004.backblazeb2.com',
      }),
    }),
    /public bucket URL region must match the S3 endpoint region "us-west-004"/,
  );
  assert.throws(
    () => validateExternalStorageConfig({
      storage: buildBackblazeStorage({
        s3Endpoint: 'https://customer-media.s3.us-east-005.backblazeb2.com',
      }),
    }),
    /must look like https:\/\/s3\.us-east-005\.backblazeb2\.com/,
  );
  assert.doesNotThrow(() => validateExternalStorageConfig({
    storage: buildBackblazeStorage({
      s3Endpoint: 's3.us-east-005.backblazeb2.com',
    }),
  }));
});

test('Backblaze native public download URLs must contain the selected bucket', () => {
  assert.doesNotThrow(() => validateExternalStorageConfig({
    storage: buildBackblazeStorage({
      staticCdnUrl: 'https://f005.backblazeb2.com/file/customer-media/',
    }),
  }));
  assert.throws(
    () => validateExternalStorageConfig({
      storage: buildBackblazeStorage({
        staticCdnUrl: 'https://f005.backblazeb2.com/file/different-bucket/',
      }),
    }),
    /must reference the configured bucket "customer-media"/,
  );
});
