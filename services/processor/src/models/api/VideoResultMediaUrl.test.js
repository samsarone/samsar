import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveVideoResultUrl } from './VideoResultMediaUrl.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'PROCESSOR_API',
  'PROCESSOR_URL',
  'API_SERVER',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
];

function withEnv(overrides, callback) {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, overrides);
  try {
    callback();
  } finally {
    ENV_KEYS.forEach((key) => {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    });
  }
}

test('Docker completed-video APIs prefer the mounted result on the processor', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    PROCESSOR_URL: 'http://localhost:3002',
    API_SERVER: 'https://temporary-provider-tunnel.example',
  }, () => {
    assert.equal(resolveVideoResultUrl({
      videoLink: 'assets_v2/video/output/session-1/final.mp4',
      remoteURL: 'https://provider.example/expiring-final.mp4',
    }), 'http://localhost:3002/assets_v2/video/output/session-1/final.mp4');
  });
});

test('explicit external-S3 completed-video APIs preserve the public result', () => {
  withEnv({
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
  }, () => {
    assert.equal(resolveVideoResultUrl({
      videoLink: 'assets_v2/video/output/session-1/final.mp4',
      remoteURL: 'https://media.customer.example/final.mp4',
    }), 'https://media.customer.example/final.mp4');
  });
});
