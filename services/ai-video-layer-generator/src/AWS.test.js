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
  'SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
];

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 206,
    url: String(url),
    headers: { get: () => /\.(mp4|mov|webm)(?:$|\?)/i.test(String(url)) ? 'video/mp4' : 'image/png' },
    body: { cancel: async () => {} },
  });
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
  process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL = 'http://localhost:3002/';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL = 'http://localhost:3002/';
  process.env.MEDIA_PUBLIC_URL = 'http://localhost:3002/';
  process.env.PUBLIC_STATIC_CDN_URL = 'http://localhost:3002/';
  process.env.STATIC_CDN_URL = 'http://localhost:3002/';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = path.join(tempRoot, 'media-tunnel-refresh.request.json');
  process.env.SAMSAR_RUNTIME_CONFIG_FILE = configPath;
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  return {
    tempRoot,
    mediaRelativePath,
  };
}

test('Backblaze path-prefixed public URLs remain idempotent', async () => {
  const envSnapshot = snapshotEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  process.env.MEDIA_BUCKET_NAME = 'my-bucket';
  process.env.STATIC_CDN_URL = 'https://f000.backblazeb2.com/file/my-bucket/';
  process.env.PUBLIC_STATIC_CDN_URL = process.env.STATIC_CDN_URL;
  try {
    const { buildSecureMediaDeliveryUrl } = await importAwsModule();
    const publicUrl = 'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/video.mp4';
    assert.equal(buildSecureMediaDeliveryUrl(publicUrl), publicUrl);
  } finally {
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker local media references to runtime public tunnel URLs', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(`http://localhost:3002/${mediaRelativePath}`);
    assert.equal(url, `https://media-example.trycloudflare.com/${mediaRelativePath}`);
    assert.equal(
      await normalizeProviderMediaUrl(`https://expired.trycloudflare.com/${mediaRelativePath}`),
      `https://media-example.trycloudflare.com/${mediaRelativePath}`,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('qualifies bare generation paths with the mounted assets_v2 gateway namespace', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });
  const bareGenerationPath = mediaRelativePath.replace(/^assets_v2\//, '');

  try {
    const { getDockerPublicMediaKey, normalizeProviderMediaUrl } = await importAwsModule();
    assert.equal(
      getDockerPublicMediaKey(bareGenerationPath, path.join(process.env.SAMSAR_ASSETS_V2_ROOT, bareGenerationPath)),
      mediaRelativePath,
    );
    assert.equal(
      await normalizeProviderMediaUrl(bareGenerationPath),
      `https://media-example.trycloudflare.com/${mediaRelativePath}`,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('qualifies legacy mounted assets with the assets gateway namespace', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });
  const barePath = 'video/session/source.mp4';
  const localPath = path.join(process.env.SAMSAR_ASSETS_ROOT, barePath);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, 'mp4');

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    assert.equal(
      await normalizeProviderMediaUrl(barePath),
      `https://media-example.trycloudflare.com/assets/${barePath}`,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('does not hijack an unrelated public URL whose path contains assets_v2', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });
  const thirdPartyUrl = 'https://third-party.example/archive/assets_v2/reference.png';

  try {
    const { buildSecureMediaDeliveryUrl, normalizeProviderMediaUrl } = await importAwsModule();
    assert.equal(await normalizeProviderMediaUrl(thirdPartyUrl), thirdPartyUrl);
    const thirdPartyS3Url = 'https://s3.us-east-1.amazonaws.com/unrelated-bucket/assets_v2/reference.png';
    assert.equal(await normalizeProviderMediaUrl(thirdPartyS3Url), thirdPartyS3Url);
    const foreignTunnelUrl = 'https://foreign.trycloudflare.com/assets_v2/other/reference.png';
    assert.equal(await normalizeProviderMediaUrl(foreignTunnelUrl), foreignTunnelUrl);
    const implicitHostedUrl = 'https://static.samsar.one/assets_v2/other/reference.png';
    assert.equal(await normalizeProviderMediaUrl(implicitHostedUrl), implicitHostedUrl);
    assert.equal(buildSecureMediaDeliveryUrl(implicitHostedUrl), implicitHostedUrl);
    const implicitDefaultBucketUrl =
      'https://samsar-resources.s3.amazonaws.com/assets_v2/other/reference.png';
    assert.equal(buildSecureMediaDeliveryUrl(implicitDefaultBucketUrl), implicitDefaultBucketUrl);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('fails closed for unresolved local, file, blob, and private Docker media references', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    for (const reference of [
      '/not-mounted/input.png',
      'file:///not-mounted/input.png',
      'blob:http://localhost/id',
      'http://localhost:3002/not-assets/input.png',
    ]) {
      await assert.rejects(
        () => normalizeProviderMediaUrl(reference),
        (error) => error?.code === 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' && error?.retryable === false,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('rejects Docker local media references when no public tunnel URL exists', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:3002/',
  });

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    await assert.rejects(
      () => normalizeProviderMediaUrl(`/${mediaRelativePath}`),
      (error) => error?.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE' && error?.retryable === true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker local media references through the tunnel instead of a configured public IP processor path', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:3002/',
  });
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://203.0.113.10/api';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(`http://localhost:3002/${mediaRelativePath}`);
    assert.equal(url, `https://media-tunnel.trycloudflare.com/${mediaRelativePath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker asset references to a tunnel URL without requiring a local file', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:3002/',
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
    publicMediaUrl: 'http://localhost:3002/',
  });
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://192.168.1.25';

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    await assert.rejects(
      () => normalizeProviderMediaUrl(`/${mediaRelativePath}`),
      (error) => error?.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE' && error?.retryable === true,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('normalizes Docker media references to CloudFront URLs when external media publishing is enabled', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:3002/',
  });
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  process.env.MEDIA_BUCKET_NAME = 'demo-external-media';
  process.env.STATIC_CDN_URL = 'https://static.example.com/';
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://203.0.113.10/api';

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

test('Docker external-S3 provider media fails closed without explicit bucket and CDN config', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot, mediaRelativePath } = prepareDockerMediaFixture({
    publicMediaUrl: 'http://localhost:3002/',
  });
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  delete process.env.MEDIA_BUCKET_NAME;
  delete process.env.STATIC_CDN_BUCKET;
  delete process.env.STATIC_CDN_URL;

  try {
    const { buildSecureMediaDeliveryUrl, normalizeProviderMediaUrl } = await importAwsModule();
    assert.throws(
      () => buildSecureMediaDeliveryUrl(`/${mediaRelativePath}`),
      (error) => error?.code === 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID',
    );
    await assert.rejects(
      () => normalizeProviderMediaUrl(`/${mediaRelativePath}`, { prime: false }),
      (error) => error?.code === 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('Docker-local persistence ignores a temporary API server tunnel', async () => {
  const envSnapshot = snapshotEnv();
  const { tempRoot } = prepareDockerMediaFixture({
    publicMediaUrl: 'https://media-example.trycloudflare.com',
  });
  const sourceVideoPath = path.join(tempRoot, 'generated.mp4');
  fs.writeFileSync(sourceVideoPath, 'mp4');
  delete process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL;
  delete process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL;
  process.env.API_SERVER = 'https://temporary-provider-tunnel.trycloudflare.com';
  process.env.PROCESSOR_URL = 'http://localhost:3002';

  try {
    const { uploadFrameLayerVideoToCDN } = await importAwsModule();
    const url = await uploadFrameLayerVideoToCDN(sourceVideoPath, 'user_resources/user-1/video.mp4');
    assert.equal(url, 'http://localhost:3002/assets_v2/user_resources/user-1/video.mp4');
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
