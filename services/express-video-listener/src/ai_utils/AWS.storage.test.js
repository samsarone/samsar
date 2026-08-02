import assert from 'node:assert/strict';
import test from 'node:test';

const ENV_KEYS = [
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_RUNTIME',
  'CURRENT_ENV',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'SAMSAR_EXTERNAL_MEDIA_BUCKET',
  'STATIC_CDN_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_CDN_REGION',
  'AWS_REGION',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

async function importAwsModule(label) {
  return import(`./AWS.js?${label}-${Date.now()}-${Math.random()}`);
}

test('standalone helper uses the installer media bucket and URL', async (t) => {
  const snapshot = snapshotEnv();
  t.after(() => restoreEnv(snapshot));
  Object.assign(process.env, {
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
    MEDIA_BUCKET_NAME: 'customer-media',
    STATIC_CDN_URL: 'https://customer-media.example/',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    AWS_CDN_REGION: 'us-east-005',
  });

  const { __testOnly__ } = await importAwsModule('custom-bucket');
  assert.deepEqual(__testOnly__, {
    mediaBucketName: 'customer-media',
    staticCdnUrl: 'https://customer-media.example/',
    region: 'us-east-005',
  });
});

test('standalone helper rejects the hosted production bucket fallback', async (t) => {
  const snapshot = snapshotEnv();
  t.after(() => restoreEnv(snapshot));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    AWS_CDN_REGION: 'us-east-005',
  });

  await assert.rejects(
    () => importAwsModule('missing-bucket'),
    /requires an explicitly configured MEDIA_BUCKET_NAME/,
  );
});
