import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getAccessibleProviderMediaUrl,
  readMountedProviderMediaBufferIfAvailable,
} from '../src/ProviderMediaUrl.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'SAMSAR_RUNTIME_CONFIG_FILE',
  'SAMSAR_CONFIG_FILE',
  'SAMSAR_MEDIA_TUNNEL_PUBLIC_URL',
  'SAMSAR_PROVIDER_MEDIA_BASE_URL',
  'SAMSAR_PUBLIC_MEDIA_BASE_URL',
  'SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL',
  'MEDIA_PUBLIC_URL',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH',
  'SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS',
  'SAMSAR_ASSETS_V2_ROOT',
  'SAMSAR_ASSETS_ROOT',
  'PUBLIC_STATIC_CDN_URL',
  'STATIC_CDN_URL',
  'LEGACY_STATIC_CDN_URL',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
];

let fixture;
const originalFetch = globalThis.fetch;

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function writeRuntimeConfig(publicUrl, options = {}) {
  fs.writeFileSync(fixture.configPath, JSON.stringify({
    localMediaTunnel: {
      enabled: options.enabled !== false,
      publicUrl,
    },
    publicUrls: {
      media: options.localMediaUrl || 'http://localhost:3002',
    },
    storage: options.storage || {},
  }));
}

function responseFor(url, { status = 206, contentType = 'image/png', finalUrl = url } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    headers: {
      get: (name) => name.toLowerCase() === 'content-type' ? contentType : null,
    },
    body: { cancel: async () => {} },
  };
}

test.beforeEach(() => {
  fixture = {
    env: snapshotEnv(),
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-provider-media-')),
  };
  fixture.configPath = path.join(fixture.root, 'samsar.config.json');
  fixture.markerPath = path.join(fixture.root, 'media-tunnel-refresh.request.json');

  for (const key of ENV_KEYS) delete process.env[key];
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_RUNTIME_CONFIG_FILE = fixture.configPath;
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = fixture.markerPath;
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '30';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_PUBLIC_MEDIA_PROBE_TIMEOUT_MS = '100';
  process.env.SAMSAR_ASSETS_V2_ROOT = path.join(fixture.root, 'assets_v2');
  process.env.SAMSAR_ASSETS_ROOT = path.join(fixture.root, 'assets');
  fs.mkdirSync(process.env.SAMSAR_ASSETS_V2_ROOT, { recursive: true });
  fs.mkdirSync(process.env.SAMSAR_ASSETS_ROOT, { recursive: true });
  writeRuntimeConfig('https://fresh-assistant.trycloudflare.com');
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(fixture.root, { recursive: true, force: true });
  restoreEnv(fixture.env);
  fixture = null;
});

test('Docker mounted image, video, and audio references use the exact live managed tunnel', async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    requestedUrls.push(value);
    const contentType = value.endsWith('.mp4')
      ? 'video/mp4'
      : value.endsWith('.mp3')
        ? 'audio/mpeg'
        : 'image/png';
    return responseFor(value, { contentType });
  };

  const image = await getAccessibleProviderMediaUrl(
    'http://localhost:3002/api/assets_v2/generations/session/frame one.png?cache=old',
    { mediaKind: 'image' },
  );
  const video = await getAccessibleProviderMediaUrl(
    '/assets_v2/video/session/source.mp4',
    { mediaKind: 'video' },
  );
  const audio = await getAccessibleProviderMediaUrl(
    '/assets/avatar_voiceover/session/speech.mp3',
    { mediaKind: 'audio' },
  );

  assert.equal(
    image,
    'https://fresh-assistant.trycloudflare.com/assets_v2/generations/session/frame%20one.png',
  );
  assert.equal(video, 'https://fresh-assistant.trycloudflare.com/assets_v2/video/session/source.mp4');
  assert.equal(audio, 'https://fresh-assistant.trycloudflare.com/assets/avatar_voiceover/session/speech.mp3');
  assert.deepEqual(requestedUrls, [image, video, audio]);
});

test('production Docker probes a configured stable media origin before its tunnel fallback', async () => {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_PROVIDER_MEDIA_BASE_URL = 'https://media.production.example';
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    requestedUrls.push(value);
    return responseFor(value, { contentType: 'image/png' });
  };

  const resolved = await getAccessibleProviderMediaUrl(
    '/assets_v2/generations/session/production.png',
    { mediaKind: 'image' },
  );

  assert.equal(
    resolved,
    'https://media.production.example/assets_v2/generations/session/production.png',
  );
  assert.deepEqual(requestedUrls, [resolved]);
  assert.equal(fs.existsSync(fixture.markerPath), false);
});

test('inline providers read mounted media bytes without resolving a tunnel', async () => {
  const imagePath = path.join(
    process.env.SAMSAR_ASSETS_V2_ROOT,
    'generations',
    'session',
    'frame.png',
  );
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'mounted-image');

  const bytes = await readMountedProviderMediaBufferIfAvailable(
    'http://localhost:3002/assets_v2/generations/session/frame.png',
    { mediaKind: 'image' },
  );

  assert.equal(bytes.toString(), 'mounted-image');
});

test('a stale tunnel writes the controller marker and returns only the replacement URL', async () => {
  const staleBase = 'https://stale-assistant.trycloudflare.com';
  const freshBase = 'https://replacement-assistant.trycloudflare.com';
  writeRuntimeConfig(staleBase);
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '250';
  const requestedUrls = [];
  let replacementScheduled = false;
  globalThis.fetch = async (url) => {
    const value = String(url);
    requestedUrls.push(value);
    if (value.startsWith(staleBase)) {
      if (!replacementScheduled) {
        replacementScheduled = true;
        setTimeout(() => writeRuntimeConfig(freshBase), 5);
      }
      return responseFor(value, { status: 502, contentType: 'text/html' });
    }
    return responseFor(value);
  };

  const resolved = await getAccessibleProviderMediaUrl(
    `${staleBase}/assets_v2/generations/session/frame.png`,
    { mediaKind: 'image', serviceName: 'assistant-retry-test' },
  );

  assert.equal(resolved, `${freshBase}/assets_v2/generations/session/frame.png`);
  assert.equal(requestedUrls.includes(`${staleBase}/assets_v2/generations/session/frame.png`), true);
  assert.equal(requestedUrls.includes(resolved), true);
  const marker = JSON.parse(fs.readFileSync(fixture.markerPath, 'utf8'));
  assert.equal(marker.service, 'assistant-retry-test');
  assert.equal(marker.mediaPath, 'assets_v2/generations/session/frame.png');
  assert.equal(marker.reason, 'exact_provider_media_url_unreachable');
});

test('a successful HTML/JSON tunnel response is rejected instead of becoming a provider media URL', async () => {
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  globalThis.fetch = async (url) => responseFor(String(url), {
    status: 200,
    contentType: 'application/json',
  });

  await assert.rejects(
    () => getAccessibleProviderMediaUrl(
      '/assets_v2/generations/session/not-an-image.png',
      { mediaKind: 'image' },
    ),
    (error) => error?.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE' &&
      error?.retryable === true,
  );
});

test('Docker preserves independent public HTTPS/data media but rejects local, malformed, and unsafe paths', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return responseFor(String(url));
  };
  const publicImage = 'https://images.example.net/reference.png?version=2';
  const imageData = 'data:image/png;base64,QUJD';

  assert.equal(await getAccessibleProviderMediaUrl(publicImage, { mediaKind: 'image' }), publicImage);
  const foreignTunnelImage = 'https://foreign.trycloudflare.com/assets_v2/other/frame.png';
  assert.equal(
    await getAccessibleProviderMediaUrl(foreignTunnelImage, { mediaKind: 'image' }),
    foreignTunnelImage,
  );
  assert.equal(await getAccessibleProviderMediaUrl(imageData, { mediaKind: 'image' }), imageData);
  for (const invalidReference of [
    'http://localhost:3002/not-a-media-route/frame.png',
    'http://public.example.net/frame.png',
    'blob:http://localhost/frame.png',
    '/tmp/unmounted-frame.png',
    '/assets_v2/generations/../private.png',
    '/assets_v2/%252e%252e/private.png',
    'data:audio/mpeg;base64,QUJD',
  ]) {
    await assert.rejects(
      () => getAccessibleProviderMediaUrl(invalidReference, { mediaKind: 'image' }),
      (error) => error?.code === 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' &&
        error?.retryable === false,
      invalidReference,
    );
  }
  assert.equal(fetchCount, 0);
});

test('external S3 mode uses only a configured reachable public HTTPS CDN and has no implicit fallback', async () => {
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.MEDIA_DELIVERY_MODE = 's3-cloudfront';
  process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED = 'true';
  process.env.MEDIA_BUCKET_NAME = 'assistant-demo-media';
  process.env.STATIC_CDN_URL = 'https://cdn.example.net/media';
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return responseFor(String(url), { contentType: 'video/mp4' });
  };

  const resolved = await getAccessibleProviderMediaUrl(
    'http://localhost:3002/assets_v2/video/session/source.mp4',
    { mediaKind: 'video' },
  );
  assert.equal(resolved, 'https://cdn.example.net/media/assets_v2/video/session/source.mp4');
  assert.deepEqual(requestedUrls, [resolved]);

  delete process.env.MEDIA_BUCKET_NAME;
  await assert.rejects(
    () => getAccessibleProviderMediaUrl(
      'http://localhost:3002/assets_v2/video/session/missing-bucket.mp4',
      { mediaKind: 'video' },
    ),
    (error) => error?.code === 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' &&
      error?.message.includes('explicitly configured bucket and public HTTPS CDN'),
  );

  process.env.MEDIA_BUCKET_NAME = 'assistant-demo-media';
  delete process.env.STATIC_CDN_URL;
  await assert.rejects(
    () => getAccessibleProviderMediaUrl(
      'http://localhost:3002/assets_v2/video/session/second.mp4',
      { mediaKind: 'video' },
    ),
    (error) => error?.code === 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' &&
      error?.message.includes('explicitly configured bucket and public HTTPS CDN'),
  );
});
