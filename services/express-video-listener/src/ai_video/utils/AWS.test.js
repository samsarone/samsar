import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_CDN_REGION',
  'AWS_REGION',
  'S3_ENDPOINT',
  'AWS_S3_ENDPOINT',
  'S3_FORCE_PATH_STYLE',
  'AWS_S3_FORCE_PATH_STYLE',
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
  'SAMSAR_RUNTIME_CONFIG_FILE',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'SAMSAR_S3_CLIENT_MAX_ATTEMPTS',
  'SAMSAR_S3_CONNECTION_TIMEOUT_MS',
  'SAMSAR_S3_SOCKET_TIMEOUT_MS',
  'SAMSAR_MEDIA_UPLOAD_MAX_ATTEMPTS',
  'SAMSAR_MEDIA_UPLOAD_RETRY_BASE_DELAY_MS',
  'SAMSAR_MEDIA_UPLOAD_RETRY_MAX_DELAY_MS',
];

const originalGlobalFetch = globalThis.fetch;

test.beforeEach(() => {
  globalThis.fetch = async (url) => {
    const value = String(url);
    const contentType = /\.(?:mp3|wav|m4a|aac)(?:$|[?#])/i.test(value)
      ? 'audio/mpeg'
      : /\.(?:mp4|mov|webm)(?:$|[?#])/i.test(value)
        ? 'video/mp4'
        : 'image/png';
    return {
      ok: true,
      status: 206,
      url: value,
      headers: { get: () => contentType },
      body: { cancel: async () => {} },
    };
  };
});

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

test('Docker external-S3 provider media does not fall back to an implicit hosted CDN or tunnel', async () => {
  const envSnapshot = snapshotEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  delete process.env.MEDIA_BUCKET_NAME;
  delete process.env.STATIC_CDN_BUCKET;
  delete process.env.STATIC_CDN_URL;

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    await assert.rejects(
      () => normalizeProviderMediaUrl('/assets_v2/generations/session/start.png'),
      (error) => error?.code === 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID',
    );
  } finally {
    restoreEnv(envSnapshot);
  }
});

test('Docker-local uploads persist a stable processor URL instead of the default hosted CDN', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-local-upload-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const sourcePath = path.join(tempRoot, 'source.png');
  const configPath = path.join(tempRoot, 'samsar.config.json');
  fs.mkdirSync(assetsV2Root, { recursive: true });
  fs.writeFileSync(sourcePath, 'png');
  fs.writeFileSync(configPath, JSON.stringify({
    publicUrls: {
      processorApi: 'http://localhost:3999',
      media: 'https://short-lived.trycloudflare.com',
    },
  }));

  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_RUNTIME_CONFIG_FILE = configPath;
  delete process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL;
  delete process.env.SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL;
  delete process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL;
  delete process.env.MEDIA_PUBLIC_URL;
  delete process.env.PUBLIC_API_BASE_URL;
  delete process.env.PROCESSOR_URL;
  delete process.env.PROCESSOR_API;
  delete process.env.STATIC_CDN_URL;

  try {
    const { uploadFrameLayerImageToCDN } = await importAwsModule();
    const url = await uploadFrameLayerImageToCDN(sourcePath, 'frame.png');
    assert.equal(url, 'http://localhost:3999/assets_v2/temp_images/frame.png');
    assert.equal(
      fs.readFileSync(path.join(assetsV2Root, 'temp_images', 'frame.png'), 'utf8'),
      'png',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('Docker external-S3 uploads reject implicit bucket and CDN defaults', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-external-upload-'));
  const sourcePath = path.join(tempRoot, 'source.png');
  fs.writeFileSync(sourcePath, 'png');

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
    const { uploadFrameLayerImageToCDN } = await importAwsModule();
    await assert.rejects(
      () => uploadFrameLayerImageToCDN(sourcePath, 'frame.png'),
      /explicitly configured MEDIA_BUCKET_NAME/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('external-S3 image uploads do not fail or repeat after a CDN cache-prime reset', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-cdn-reset-'));
  const sourcePath = path.join(tempRoot, 'source.png');
  fs.writeFileSync(sourcePath, 'png');
  let objectWrites = 0;
  let cachePrimeRequests = 0;
  const server = http.createServer((request, response) => {
    objectWrites += 1;
    response.writeHead(200, {
      ETag: '"test-etag"',
      'x-amz-request-id': 'test-request-id',
    });
    response.end();
  });

  try {
    const endpoint = await listenOnLocalhost(server);
    configureExternalS3TestEnv(endpoint);
    globalThis.fetch = async () => {
      cachePrimeRequests += 1;
      const error = new Error('read ECONNRESET');
      error.name = 'TimeoutError';
      error.code = 'ECONNRESET';
      throw error;
    };

    const { uploadFrameLayerImageToCDN, primeCDNCache } = await importAwsModule();
    const url = await uploadFrameLayerImageToCDN(sourcePath, 'frame.png');

    assert.equal(url, 'https://cdn.example/assets_v2/temp_images/frame.png');
    assert.equal(objectWrites, 1);
    assert.equal(cachePrimeRequests, 0);
    assert.equal(await primeCDNCache(url), false);
    assert.equal(cachePrimeRequests, 1);
  } finally {
    await closeServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test('external-S3 image uploads retry a reset object write with a fresh request', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-s3-reset-'));
  const sourcePath = path.join(tempRoot, 'source.png');
  fs.writeFileSync(sourcePath, 'png');
  let objectWriteAttempts = 0;
  const server = http.createServer((request, response) => {
    objectWriteAttempts += 1;
    if (objectWriteAttempts === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, {
      ETag: '"test-etag"',
      'x-amz-request-id': 'test-request-id',
    });
    response.end();
  });

  try {
    const endpoint = await listenOnLocalhost(server);
    configureExternalS3TestEnv(endpoint);

    const { uploadFrameLayerImageToCDN } = await importAwsModule();
    const url = await uploadFrameLayerImageToCDN(sourcePath, 'frame.png');

    assert.equal(url, 'https://cdn.example/assets_v2/temp_images/frame.png');
    assert.equal(objectWriteAttempts, 2);
  } finally {
    await closeServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
  }
});

test.afterEach(() => {
  globalThis.fetch = originalGlobalFetch;
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

function configureExternalS3TestEnv(endpoint) {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.MEDIA_DELIVERY_MODE = 'external-s3';
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.AWS_CDN_REGION = 'us-west-2';
  process.env.MEDIA_BUCKET_NAME = 'test-bucket';
  process.env.STATIC_CDN_URL = 'https://cdn.example/';
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.SAMSAR_S3_CLIENT_MAX_ATTEMPTS = '1';
  process.env.SAMSAR_MEDIA_UPLOAD_MAX_ATTEMPTS = '3';
  process.env.SAMSAR_MEDIA_UPLOAD_RETRY_BASE_DELAY_MS = '1';
  process.env.SAMSAR_MEDIA_UPLOAD_RETRY_MAX_DELAY_MS = '2';
}

function listenOnLocalhost(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server) {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
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
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = path.join(tempRoot, 'media-tunnel-refresh.request.json');
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
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = path.join(tempRoot, 'media-tunnel-refresh.request.json');
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    const url = await normalizeProviderMediaUrl(
      'http://localhost:3002/assets_v2/temp_audio/64b000000000000000000001_64b000000000000000000002_speech_padded.mp3'
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
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = path.join(os.tmpdir(), `samsar-refresh-${Date.now()}-${Math.random()}.json`);

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

test('uses explicit gateway namespaces and fails closed for malformed Docker provider media', async () => {
  const envSnapshot = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-listener-canonical-media-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  const bareReference = 'generations/session/start.png';
  const localPath = path.join(assetsV2Root, bareReference);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.writeFileSync(localPath, 'png');

  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';
  process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
  process.env.SAMSAR_ASSETS_ROOT = assetsRoot;

  try {
    const { normalizeProviderMediaUrl } = await importAwsModule();
    assert.equal(
      await normalizeProviderMediaUrl(bareReference),
      'https://media-tunnel.trycloudflare.com/assets_v2/generations/session/start.png',
    );
    assert.equal(
      await normalizeProviderMediaUrl('https://third-party.example/archive/assets_v2/reference.png'),
      'https://third-party.example/archive/assets_v2/reference.png',
    );
    assert.equal(
      await normalizeProviderMediaUrl('https://s3.us-east-1.amazonaws.com/unrelated-bucket/assets_v2/reference.png'),
      'https://s3.us-east-1.amazonaws.com/unrelated-bucket/assets_v2/reference.png',
    );
    assert.equal(
      await normalizeProviderMediaUrl('https://foreign.trycloudflare.com/assets_v2/other/reference.png'),
      'https://foreign.trycloudflare.com/assets_v2/other/reference.png',
    );
    assert.equal(
      await normalizeProviderMediaUrl('https://static.samsar.one/assets_v2/other/reference.png'),
      'https://static.samsar.one/assets_v2/other/reference.png',
    );
    assert.equal(
      await normalizeProviderMediaUrl(
        'https://expired.trycloudflare.com/assets_v2/generations/session/start.png',
        { mediaKind: 'image' },
      ),
      'https://media-tunnel.trycloudflare.com/assets_v2/generations/session/start.png',
    );
    await assert.rejects(
      () => normalizeProviderMediaUrl('http://localhost:3002/not-assets/input.png'),
      (error) => error?.code === 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' && error?.retryable === false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
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
