import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __testOnly__,
  buildSecureMediaDeliveryUrl,
  getPublicationsMediaConfig,
} from './AWS.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'PROCESSOR_API',
  'PROCESSOR_URL',
  'API_SERVER',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'STATIC_CDN_URL',
  'SAMSAR_EXTERNAL_MEDIA_BUCKET',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_S3_OBJECT_TAGGING_SUPPORTED',
];

function withEnv(overrides, callback) {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, overrides);
  try {
    return callback();
  } finally {
    ENV_KEYS.forEach((key) => {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    });
  }
}

test('Docker-local persistence returns the stable processor URL and never the provider tunnel', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    PROCESSOR_URL: 'http://localhost:3002',
    API_SERVER: 'https://temporary-provider-tunnel.example',
  }, () => {
    assert.equal(
      __testOnly__.buildMediaDeliveryUrl('assets_v2/user_resources/user-1/video.mp4'),
      'http://localhost:3002/assets_v2/user_resources/user-1/video.mp4',
    );
    assert.deepEqual(getPublicationsMediaConfig(), {
      bucketName: 'samsar-resources',
      cdnUrl: 'http://localhost:3002',
      region: 'us-west-2',
      keyPrefix: 'published',
      configured: true,
      deliveryMode: 'docker-local',
      externalStorageConfigured: false,
    });
  });
});

test('Docker external-S3 delivery fails closed without explicit bucket and HTTPS CDN', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
  }, () => {
    assert.equal(getPublicationsMediaConfig().configured, false);
    assert.throws(
      () => __testOnly__.buildMediaDeliveryUrl('assets_v2/user_resources/user-1/video.mp4'),
      /requires an explicit bucket and public HTTPS CDN URL/,
    );
  });
});

test('Docker external-S3 delivery uses only the explicitly configured CDN', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    MEDIA_BUCKET_NAME: 'customer-media',
    STATIC_CDN_URL: 'https://media.customer.example/',
  }, () => {
    assert.equal(
      __testOnly__.buildMediaDeliveryUrl('assets_v2/user_resources/user-1/video.mp4'),
      'https://media.customer.example/assets_v2/user_resources/user-1/video.mp4',
    );
    assert.equal(getPublicationsMediaConfig().externalStorageConfigured, true);
  });
});

test('Backblaze path-prefixed public URLs remain idempotent', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    MEDIA_BUCKET_NAME: 'my-bucket',
    STATIC_CDN_URL: 'https://f000.backblazeb2.com/file/my-bucket/',
  }, () => {
    const publicUrl = 'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/image.png';
    assert.equal(buildSecureMediaDeliveryUrl(publicUrl), publicUrl);
    assert.equal(
      buildSecureMediaDeliveryUrl('assets_v2/session/image one.png'),
      'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/image%20one.png',
    );
  });
});

test('Backblaze-compatible storage disables unsupported S3 object tagging explicitly', () => {
  withEnv({ SAMSAR_S3_OBJECT_TAGGING_SUPPORTED: 'false' }, () => {
    assert.equal(__testOnly__.shouldUseS3ObjectTagging(), false);
  });
  withEnv({}, () => {
    assert.equal(__testOnly__.shouldUseS3ObjectTagging(), true);
  });
});

test('CloudFront signing caps the refresh bucket below a short configured TTL', () => {
  const ttlSeconds = 15 * 60;
  const refreshIntervalSeconds = __testOnly__.resolveCloudFrontSignedUrlRefreshIntervalSeconds({
    ttlSeconds,
    configuredRefreshIntervalSeconds: Number.NaN,
  });

  assert.equal(refreshIntervalSeconds, ttlSeconds / 2);

  const nowSeconds = (60 * 60) + ttlSeconds + 147;
  const expiresAt = __testOnly__.getCloudFrontSignedUrlExpirationSeconds(nowSeconds, {
    ttlSeconds,
    refreshIntervalSeconds,
  });

  assert.ok(expiresAt > nowSeconds);
  assert.ok(expiresAt - nowSeconds >= ttlSeconds / 2);
});

test('CloudFront signing retains shorter explicit and safe default refresh intervals', () => {
  assert.equal(
    __testOnly__.resolveCloudFrontSignedUrlRefreshIntervalSeconds({
      ttlSeconds: 15 * 60,
      configuredRefreshIntervalSeconds: 5 * 60,
    }),
    5 * 60,
  );
  assert.equal(
    __testOnly__.resolveCloudFrontSignedUrlRefreshIntervalSeconds({
      ttlSeconds: 7 * 24 * 60 * 60,
      configuredRefreshIntervalSeconds: Number.NaN,
    }),
    60 * 60,
  );
});
