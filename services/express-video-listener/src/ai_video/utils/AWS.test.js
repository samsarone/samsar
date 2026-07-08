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
  'SAMSAR_MEDIA_TUNNEL_PUBLIC_URL',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'MEDIA_PUBLIC_URL',
  'PUBLIC_API_BASE_URL',
  'PROCESSOR_API',
  'PROCESSOR_URL',
  'PUBLIC_STATIC_CDN_URL',
  'STATIC_CDN_URL',
  'SAMSAR_VALIDATE_PUBLIC_MEDIA_URL',
  'SAMSAR_ASSETS_V2_ROOT',
  'SAMSAR_ASSETS_ROOT',
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

async function importAwsModule() {
  const moduleUrl = new URL('./AWS.js', import.meta.url).href;
  return import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`);
}

test('normalizes Docker assets_v2 image references to the media tunnel without local rasterization', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-media-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  fs.mkdirSync(assetsV2Root, { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });

  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.AWS_CDN_REGION = 'us-west-2';
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://203.0.113.10/api';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';
  process.env.SAMSAR_VALIDATE_PUBLIC_MEDIA_URL = 'false';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(
      '/assets_v2/generations/64b000000000000000000001/start.png'
    );
    assert.equal(
      url,
      'https://media-tunnel.trycloudflare.com/assets_v2/generations/64b000000000000000000001/start.png'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker padded audio references to the media tunnel for lip sync providers', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-audio-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  fs.mkdirSync(assetsV2Root, { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });

  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.AWS_CDN_REGION = 'us-west-2';
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://203.0.113.10/api';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';
  process.env.SAMSAR_VALIDATE_PUBLIC_MEDIA_URL = 'false';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(
      'http://localhost:8080/assets_v2/temp_audio/64b000000000000000000001_64b000000000000000000002_speech_padded.mp3'
    );
    assert.equal(
      url,
      'https://media-tunnel.trycloudflare.com/assets_v2/temp_audio/64b000000000000000000001_64b000000000000000000002_speech_padded.mp3'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker local media references to the tunnel without AWS credentials', async () => {
  const envSnapshot = snapshotEnv();

  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_CDN_REGION;
  delete process.env.AWS_REGION;
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';
  process.env.SAMSAR_VALIDATE_PUBLIC_MEDIA_URL = 'false';

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(
      '/assets_v2/video/audio/64b000000000000000000001/speech_padded.mp3'
    );
    assert.equal(
      url,
      'https://media-tunnel.trycloudflare.com/assets_v2/video/audio/64b000000000000000000001/speech_padded.mp3'
    );
  } finally {
    restoreEnv(envSnapshot);
  }
});

test('keeps reachable production local media on the signed CDN URL', async () => {
  const envSnapshot = snapshotEnv();
  const originalFetch = globalThis.fetch;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-prod-cdn-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  const mediaPath = path.join(
    assetsV2Root,
    'user_resources/user-1/ai_videos/64b000000000000000000001/layer-1/video.mp4'
  );
  fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.writeFileSync(mediaPath, 'mp4');

  process.env.CURRENT_ENV = 'production';
  delete process.env.SAMSAR_MEDIA_DELIVERY_MODE;
  delete process.env.MEDIA_DELIVERY_MODE;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  process.env.STATIC_CDN_URL = 'https://static.example.com/';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  globalThis.fetch = async () => ({
    ok: true,
    status: 206,
    body: { cancel: async () => {} },
  });

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(
      'https://static.example.com/assets_v2/user_resources/user-1/ai_videos/64b000000000000000000001/layer-1/video.mp4?Expires=old'
    );
    assert.equal(
      url,
      'https://static.example.com/assets_v2/user_resources/user-1/ai_videos/64b000000000000000000001/layer-1/video.mp4'
    );
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('falls back to a public processor media URL when production CDN signing cannot read a local asset', async () => {
  const envSnapshot = snapshotEnv();
  const originalFetch = globalThis.fetch;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-prod-fallback-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  const mediaPath = path.join(
    assetsV2Root,
    'user_resources/user-1/ai_videos/64b000000000000000000001/layer-1/video.mp4'
  );
  fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.writeFileSync(mediaPath, 'mp4');

  process.env.CURRENT_ENV = 'production';
  delete process.env.SAMSAR_MEDIA_DELIVERY_MODE;
  delete process.env.MEDIA_DELIVERY_MODE;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  process.env.STATIC_CDN_URL = 'https://static.example.com/';
  process.env.PUBLIC_API_BASE_URL = 'https://api.example.com';
  process.env.SAMSAR_VALIDATE_PUBLIC_MEDIA_URL = 'true';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  globalThis.fetch = async (url) => ({
    ok: String(url).startsWith('https://api.example.com/'),
    status: String(url).startsWith('https://api.example.com/') ? 206 : 403,
    body: { cancel: async () => {} },
  });

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(
      'https://static.example.com/assets_v2/user_resources/user-1/ai_videos/64b000000000000000000001/layer-1/video.mp4?Expires=old'
    );
    assert.equal(
      url,
      'https://api.example.com/assets_v2/user_resources/user-1/ai_videos/64b000000000000000000001/layer-1/video.mp4'
    );
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});
