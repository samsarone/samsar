import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__, getPublicationsMediaConfig } from './AWS.js';

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
