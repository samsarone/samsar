import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'SAMSAR_MEDIA_TUNNEL_PUBLIC_URL',
  'MEDIA_PUBLIC_URL',
  'PUBLIC_STATIC_CDN_URL',
  'STATIC_CDN_URL',
  'SAMSAR_RUNTIME_CONFIG_FILE',
  'SAMSAR_ASSETS_V2_ROOT',
  'SAMSAR_ASSETS_ROOT',
  'SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL',
  'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  'API_SERVER',
  'PUBLIC_API_BASE_URL',
  'PROCESSOR_API',
  'PROCESSOR_URL',
  'SAMSAR_VALIDATE_PUBLIC_MEDIA_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
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

function prepareDockerMediaFixture({ publicMediaUrl }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-ai-video-media-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  const configPath = path.join(tempRoot, 'samsar.config.json');
  const mediaRelativePath = 'assets_v2/generations/64b000000000000000000001/start.png';
  const mediaPath = path.join(assetsV2Root, 'generations/64b000000000000000000001/start.png');

  fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.writeFileSync(mediaPath, 'png');
  fs.writeFileSync(configPath, JSON.stringify({
    publicUrls: {
      media: publicMediaUrl,
    },
  }));

  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL = 'http://localhost:8080/';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL = 'http://localhost:8080/';
  process.env.MEDIA_PUBLIC_URL = 'http://localhost:8080/';
  process.env.PUBLIC_STATIC_CDN_URL = 'http://localhost:8080/';
  process.env.STATIC_CDN_URL = 'http://localhost:8080/';
  process.env.SAMSAR_VALIDATE_PUBLIC_MEDIA_URL = 'false';
  process.env.SAMSAR_RUNTIME_CONFIG_FILE = configPath;
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  return {
    tempRoot,
    mediaRelativePath,
  };
}

test('normalizes Docker local media references to runtime public tunnel URLs', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(`http://localhost:8080/${mediaRelativePath}`);
    assert.equal(url, `https://media-example.trycloudflare.com/${mediaRelativePath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('rejects Docker local media references when no public tunnel URL exists', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:8080/',
  });

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    await assert.rejects(
      () => normalizeProviderMediaUrl(`/${mediaRelativePath}`),
      /A tunneled media URL is required/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker local media references through the tunnel instead of a configured public IP processor path', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:8080/',
  });
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://203.0.113.10/api';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(`http://localhost:8080/${mediaRelativePath}`);
    assert.equal(url, `https://media-tunnel.trycloudflare.com/${mediaRelativePath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker asset references to a tunnel URL without requiring a local file', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:8080/',
  });
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://203.0.113.10/api';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(
      '/assets_v2/generations/64b000000000000000000001/missing-start.png'
    );
    assert.equal(
      url,
      'https://media-tunnel.trycloudflare.com/assets_v2/generations/64b000000000000000000001/missing-start.png'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('keeps private IP processor bases out of external AI provider media URLs', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:8080/',
  });
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://192.168.1.25';

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    await assert.rejects(
      () => normalizeProviderMediaUrl(`/${mediaRelativePath}`),
      /A tunneled media URL is required/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker media references to CloudFront URLs when external media publishing is enabled', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:8080/',
  });
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  process.env.STATIC_CDN_URL = 'https://static.example.com/';

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(`http://203.0.113.10/api/${mediaRelativePath}`, {
      prime: false,
    });
    assert.equal(url, `https://static.example.com/${mediaRelativePath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('returns Docker local persisted media URLs through the processor API', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });
  const sourceVideoPath = path.join(tempRoot, 'generated.mp4');
  fs.writeFileSync(sourceVideoPath, 'mp4');
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://localhost:3002';

  try {
    const { uploadFrameLayerVideoToCDN } = await importAwsModule();
    const url = await uploadFrameLayerVideoToCDN(
      sourceVideoPath,
      'user_resources/64b000000000000000000001/ai_videos/64b000000000000000000002/64b000000000000000000003/video.mp4'
    );
    assert.equal(
      url,
      'http://localhost:3002/assets_v2/user_resources/64b000000000000000000001/ai_videos/64b000000000000000000002/64b000000000000000000003/video.mp4'
    );
    assert.equal(
      fs.existsSync(path.join(
        process.env.SAMSAR_ASSETS_V2_ROOT,
        'user_resources/64b000000000000000000001/ai_videos/64b000000000000000000002/64b000000000000000000003/video.mp4'
      )),
      true
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});
