import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_CDN_REGION',
  'CURRENT_ENV',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_MEDIA_TUNNEL_PUBLIC_URL',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'MEDIA_PUBLIC_URL',
  'PUBLIC_STATIC_CDN_URL',
  'STATIC_CDN_URL',
  'SAMSAR_RUNTIME_CONFIG_FILE',
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

async function importProviderMediaUrlModule() {
  const moduleUrl = new URL('./ProviderMediaUrl.js', import.meta.url).href;
  return import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`);
}

function prepareDockerMediaFixture({ publicMediaUrl }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-express-provider-media-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  const configPath = path.join(tempRoot, 'samsar.config.json');
  const userId = '64b000000000000000000001';
  const mediaRelativePath = `assets_v2/user_resources/${userId}/ai_videos/64b000000000000000000002/64b000000000000000000003/video.mp4`;
  const mediaPath = path.join(assetsV2Root, mediaRelativePath.slice('assets_v2/'.length));

  fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.writeFileSync(mediaPath, 'mp4');
  fs.writeFileSync(configPath, JSON.stringify({
    publicUrls: {
      media: publicMediaUrl,
    },
  }));

  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.AWS_CDN_REGION = 'us-west-2';
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'false';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  delete process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL;
  process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL = 'http://localhost:8080/';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL = 'http://localhost:8080/';
  process.env.MEDIA_PUBLIC_URL = 'http://localhost:8080/';
  process.env.PUBLIC_STATIC_CDN_URL = 'http://localhost:8080/';
  process.env.STATIC_CDN_URL = 'http://localhost:8080/';
  process.env.SAMSAR_RUNTIME_CONFIG_FILE = configPath;
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  return {
    tempRoot,
    userId,
    mediaRelativePath,
  };
}

test('resolves Docker provider AI-video URLs through the configured public media tunnel', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, userId, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });

  try {
    const { resolveProviderAiVideoUrl } = await importProviderMediaUrlModule();
    const url = await resolveProviderAiVideoUrl({
      userId,
      layer: {
        aiVideoRemoteLink: `http://localhost:8080/${mediaRelativePath}`,
      },
    });
    assert.equal(url, `https://media-example.trycloudflare.com/${mediaRelativePath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('rejects Docker local provider AI-video URLs when no public media tunnel is configured', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, userId, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:8080/',
  });

  try {
    const { resolveProviderAiVideoUrl } = await importProviderMediaUrlModule();
    await assert.rejects(
      () => resolveProviderAiVideoUrl({
        userId,
        layer: {
          aiVideoRemoteLink: `http://localhost:8080/${mediaRelativePath}`,
        },
      }),
      /A public media URL is required/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});
