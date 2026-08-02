import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_CDN_REGION',
  'AWS_REGION',
  'CURRENT_ENV',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'MEDIA_PUBLIC_URL',
  'PUBLIC_API_BASE_URL',
  'PROCESSOR_URL',
  'PROCESSOR_API',
  'STATIC_CDN_URL',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'SAMSAR_ASSETS_V2_ROOT',
  'SAMSAR_RUNTIME_CONFIG_FILE',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

async function importAudioAwsModule() {
  const moduleUrl = new URL('./AWS.js', import.meta.url).href;
  return import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`);
}

test('Docker-local audio uploads return the configured processor URL, not static.samsar.one', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-local-upload-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const sourcePath = path.join(tempRoot, 'speech.wav');
  fs.mkdirSync(assetsV2Root, { recursive: true });
  fs.writeFileSync(sourcePath, 'wav');

  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://localhost:3002';
  delete process.env.STATIC_CDN_URL;

  try {
    const { uploadSpeechAudioToCDN } = await importAudioAwsModule();
    const url = await uploadSpeechAudioToCDN(sourcePath, 'speech.wav');
    assert.equal(url, 'http://localhost:3002/assets_v2/temp_audio/speech.wav');
    assert.equal(
      fs.readFileSync(path.join(assetsV2Root, 'temp_audio', 'speech.wav'), 'utf8'),
      'wav',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('Docker external-S3 audio uploads reject implicit hosted defaults', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-external-upload-'));
  const sourcePath = path.join(tempRoot, 'speech.wav');
  fs.writeFileSync(sourcePath, 'wav');

  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.AWS_CDN_REGION = 'us-west-2';
  delete process.env.MEDIA_BUCKET_NAME;
  delete process.env.STATIC_CDN_BUCKET;
  delete process.env.STATIC_CDN_URL;

  try {
    const { uploadSpeechAudioToCDN } = await importAudioAwsModule();
    await assert.rejects(
      () => uploadSpeechAudioToCDN(sourcePath, 'speech.wav'),
      /explicitly configured MEDIA_BUCKET_NAME/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('path-prefixed Backblaze URLs do not become duplicated storage keys', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-b2-audio-upload-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const sourcePath = path.join(tempRoot, 'speech.wav');
  fs.mkdirSync(assetsV2Root, { recursive: true });
  fs.writeFileSync(sourcePath, 'wav');

  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    MEDIA_DELIVERY_MODE: 'docker-local',
    SAMSAR_ASSETS_V2_ROOT: assetsV2Root,
    SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL: 'http://localhost:3002',
    STATIC_CDN_URL: 'https://f000.backblazeb2.com/file/my-bucket/',
  });

  try {
    const { uploadSpeechAudioToCDN } = await importAudioAwsModule();
    const publicB2Url = 'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/audio.wav';
    assert.equal(
      await uploadSpeechAudioToCDN(sourcePath, publicB2Url),
      'http://localhost:3002/assets_v2/session/audio.wav',
    );
    assert.equal(
      fs.readFileSync(path.join(assetsV2Root, 'session/audio.wav'), 'utf8'),
      'wav',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});
