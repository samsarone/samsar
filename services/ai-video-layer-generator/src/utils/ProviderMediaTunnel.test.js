import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveFreshManagedProviderMediaUrl } from './ProviderMediaTunnel.js';

const originalFetch = globalThis.fetch;
const ENV_KEYS = [
  'SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS',
  'SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH',
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('requests a replacement and returns only the refreshed exact asset URL', async () => {
  const env = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-provider-tunnel-'));
  const markerPath = path.join(tempRoot, 'media-tunnel-refresh.request.json');
  const mediaPath = 'assets_v2/generations/session/frame.png';
  const staleBase = 'https://stale.trycloudflare.com';
  const freshBase = 'https://fresh.trycloudflare.com';
  let refreshObserved = false;

  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '250';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = markerPath;
  globalThis.fetch = async (url) => ({
    ok: String(url).startsWith(freshBase),
    status: String(url).startsWith(freshBase) ? 206 : 502,
    headers: { get: () => 'image/png' },
    body: { cancel: async () => {} },
  });

  try {
    const resolved = await resolveFreshManagedProviderMediaUrl({
      mediaPath,
      serviceName: 'test_worker',
      getBaseUrlCandidates: () => {
        if (fs.existsSync(markerPath)) refreshObserved = true;
        return refreshObserved ? [freshBase] : [staleBase];
      },
    });

    assert.equal(resolved, `${freshBase}/${mediaPath}`);
    assert.equal(refreshObserved, true);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    assert.equal(marker.reason, 'exact_provider_media_url_unreachable');
    assert.deepEqual(marker.attemptedUrls, [`${staleBase}/${mediaPath}`]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(env);
  }
});

test('fails retryably and never returns a stale tunnel URL', async () => {
  const env = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-provider-tunnel-'));
  const markerPath = path.join(tempRoot, 'media-tunnel-refresh.request.json');
  const staleBase = 'https://stale.trycloudflare.com';

  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '20';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = markerPath;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    headers: { get: () => 'text/html' },
    body: { cancel: async () => {} },
  });

  try {
    await assert.rejects(
      () => resolveFreshManagedProviderMediaUrl({
        mediaPath: 'assets_v2/video/source.mp4',
        serviceName: 'test_worker',
        getBaseUrlCandidates: () => [staleBase],
      }),
      (error) => {
        assert.equal(error.code, 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE');
        assert.equal(error.retryable, true);
        assert.deepEqual(error.attemptedUrls, [`${staleBase}/assets_v2/video/source.mp4`]);
        return true;
      },
    );
    assert.equal(fs.existsSync(markerPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(env);
  }
});

test('rejects encoded traversal before constructing or probing a provider URL', async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('must not fetch');
  };

  await assert.rejects(
    () => resolveFreshManagedProviderMediaUrl({
      mediaPath: 'assets_v2/%2e%2e/secret.png',
      getBaseUrlCandidates: () => ['https://media.trycloudflare.com'],
    }),
    /safe non-empty relative path/,
  );
  assert.equal(fetchCalled, false);
});

test('rejects managed tunnel bases containing a path, query, or fragment', async () => {
  const env = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-provider-tunnel-'));
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = path.join(tempRoot, 'refresh.json');
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('must not fetch');
  };

  try {
    await assert.rejects(
      () => resolveFreshManagedProviderMediaUrl({
        mediaPath: 'assets_v2/generations/session/frame.png',
        getBaseUrlCandidates: () => [
          'https://media.trycloudflare.com/assets_v2',
          'https://media.trycloudflare.com?token=bad',
          'https://media.trycloudflare.com#bad',
        ],
      }),
      (error) => error?.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE' && error?.attemptedUrls?.length === 0,
    );
    assert.equal(fetchCalled, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(env);
  }
});

test('rejects wrong media MIME types and redirects away from public HTTPS', async () => {
  const env = snapshotEnv();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-provider-tunnel-'));
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = path.join(tempRoot, 'refresh.json');
  let mode = 'mime';
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 206,
    url: mode === 'redirect' ? 'https://169.254.169.254/assets_v2/frame.png' : String(url),
    headers: { get: () => mode === 'mime' ? 'video/mp4' : 'image/png' },
    body: { cancel: async () => {} },
  });

  try {
    for (const nextMode of ['mime', 'redirect']) {
      mode = nextMode;
      await assert.rejects(
        () => resolveFreshManagedProviderMediaUrl({
          mediaPath: 'assets_v2/generations/session/frame.png',
          getBaseUrlCandidates: () => ['https://media.trycloudflare.com'],
          expectedContentTypePrefix: 'image/',
        }),
        (error) => error?.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE',
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    restoreEnv(env);
  }
});
