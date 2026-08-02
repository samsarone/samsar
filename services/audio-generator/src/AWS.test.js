import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ENV_KEYS = [
  'CURRENT_ENV',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'STATIC_CDN_URL',
  'SAMSAR_ASSETS_V2_ROOT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_CDN_REGION',
  'AWS_REGION',
];

function snapshotEnvironment() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function clearEnvironment() {
  for (const key of ENV_KEYS) delete process.env[key];
}

async function importAwsModule() {
  const moduleUrl = new URL('./AWS.js', import.meta.url).href;
  return import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`);
}

function createAudioFixture(t) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-aws-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const sourcePath = path.join(tempRoot, 'generated.wav');
  fs.writeFileSync(sourcePath, 'wave-data');
  return { tempRoot, sourcePath };
}

test('Docker external-S3 upload paths fail closed without an explicit bucket and CDN', async (t) => {
  const snapshot = snapshotEnvironment();
  t.after(() => restoreEnvironment(snapshot));
  clearEnvironment();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'external-s3';
  const { sourcePath } = createAudioFixture(t);
  const aws = await importAwsModule();

  const operations = [
    () => aws.uploadFrameLayerImageToCDN(sourcePath, 'session/frame.png'),
    () => aws.uploadMusicToCDN(sourcePath, 'session/music.wav'),
    () => aws.uploadAudioAssetToCDN(sourcePath, 'user_resources/session/audio.wav'),
    () => aws.generateS3UrlsFromLocalFile('session', sourcePath),
  ];

  for (const operation of operations) {
    await assert.rejects(
      operation,
      (error) => error?.code === 'SAMSAR_EXTERNAL_S3_CONFIG_INVALID' &&
        error?.retryable === false,
    );
  }
});

test('Docker external-S3 rejects non-public CDN origins even when a bucket is explicit', async (t) => {
  const snapshot = snapshotEnvironment();
  t.after(() => restoreEnvironment(snapshot));
  clearEnvironment();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.MEDIA_BUCKET_NAME = 'customer-media';
  process.env.STATIC_CDN_URL = 'https://host.docker.internal:3002/';
  const aws = await importAwsModule();

  assert.throws(
    () => aws.buildSecureMediaDeliveryUrl('assets_v2/session/audio.wav'),
    { code: 'SAMSAR_EXTERNAL_S3_CONFIG_INVALID' },
  );
});

test('Docker external-S3 uses an explicitly configured bucket and public HTTPS CDN', async (t) => {
  const snapshot = snapshotEnvironment();
  t.after(() => restoreEnvironment(snapshot));
  clearEnvironment();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.MEDIA_BUCKET_NAME = 'customer-media';
  process.env.STATIC_CDN_URL = 'https://media.customer.example/';
  const aws = await importAwsModule();

  assert.equal(
    aws.buildSecureMediaDeliveryUrl('assets_v2/session/audio one.wav'),
    'https://media.customer.example/assets_v2/session/audio%20one.wav',
  );
});

test('Backblaze path-prefixed public URLs remain idempotent', async (t) => {
  const snapshot = snapshotEnvironment();
  t.after(() => restoreEnvironment(snapshot));
  clearEnvironment();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.MEDIA_BUCKET_NAME = 'my-bucket';
  process.env.STATIC_CDN_URL = 'https://f000.backblazeb2.com/file/my-bucket/';
  const aws = await importAwsModule();
  const publicUrl = 'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/audio.wav';

  assert.equal(aws.buildSecureMediaDeliveryUrl(publicUrl), publicUrl);
  assert.equal(
    aws.buildSecureMediaDeliveryUrl('assets_v2/session/audio one.wav'),
    'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/audio%20one.wav',
  );
});

test('Docker-local upload persists a stable mounted reference without S3 configuration', async (t) => {
  const snapshot = snapshotEnvironment();
  t.after(() => restoreEnvironment(snapshot));
  clearEnvironment();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  const { tempRoot, sourcePath } = createAudioFixture(t);
  process.env.SAMSAR_ASSETS_V2_ROOT = path.join(tempRoot, 'assets_v2');
  const aws = await importAwsModule();

  const result = await aws.uploadAudioAssetToCDN(
    sourcePath,
    'user_resources/session/audio/generated.wav',
  );

  assert.equal(result, 'assets_v2/user_resources/session/audio/generated.wav');
  assert.equal(
    fs.readFileSync(path.join(
      process.env.SAMSAR_ASSETS_V2_ROOT,
      'user_resources/session/audio/generated.wav',
    ), 'utf8'),
    'wave-data',
  );
});
