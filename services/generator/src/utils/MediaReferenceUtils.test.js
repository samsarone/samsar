import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getAccessibleMediaUrlForProvider } from './MediaReferenceUtils.js';

const originalFetch = globalThis.fetch;
const originalTunnelTestEnv = {
  SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS: process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS,
  SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS: process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS,
  SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH: process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH,
};

test.beforeEach(() => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 206,
    headers: { get: () => 'image/png' },
    body: { cancel: async () => {} },
  });
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS = '1';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS = '10';
  process.env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH = path.join(
    os.tmpdir(),
    `samsar-generator-media-refresh-${Date.now()}-${Math.random()}.json`,
  );
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalTunnelTestEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('docker media URLs can prefer the internal media gateway for local provider fetches', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_ASSETS_V2_ROOT: process.env.SAMSAR_ASSETS_V2_ROOT,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
    SAMSAR_PUBLIC_MEDIA_BASE_URL: process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL: process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    SAMSAR_MEDIA_TUNNEL_PUBLIC_URL: process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    SAMSAR_INTERNAL_MEDIA_BASE_URL: process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL,
    SAMSAR_MEDIA_DELIVERY_MODE: process.env.SAMSAR_MEDIA_DELIVERY_MODE,
    MEDIA_DELIVERY_MODE: process.env.MEDIA_DELIVERY_MODE,
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-ref-'));

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_ASSETS_V2_ROOT = tempRoot;
    process.env.MEDIA_PUBLIC_URL = 'http://localhost:3002/';
    process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL = 'http://media-gateway';
    process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
    process.env.MEDIA_DELIVERY_MODE = 'docker-local';

    const mediaPath = path.join(tempRoot, 'generations', 'session-id', 'frame.png');
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from([0]));

    const resolved = await getAccessibleMediaUrlForProvider(
      'http://localhost:3002/assets_v2/generations/session-id/frame.png',
      { preferInternalDockerUrl: true },
    );

    assert.equal(resolved, 'http://media-gateway/assets_v2/generations/session-id/frame.png');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('docker media URLs can prefer inline data URLs for vision requests', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_ASSETS_V2_ROOT: process.env.SAMSAR_ASSETS_V2_ROOT,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
    SAMSAR_PUBLIC_MEDIA_BASE_URL: process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL: process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    SAMSAR_MEDIA_TUNNEL_PUBLIC_URL: process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    SAMSAR_INTERNAL_MEDIA_BASE_URL: process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL,
    SAMSAR_MEDIA_DELIVERY_MODE: process.env.SAMSAR_MEDIA_DELIVERY_MODE,
    MEDIA_DELIVERY_MODE: process.env.MEDIA_DELIVERY_MODE,
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-ref-'));

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_ASSETS_V2_ROOT = tempRoot;
    process.env.MEDIA_PUBLIC_URL = 'http://localhost:3002/';
    process.env.SAMSAR_INTERNAL_MEDIA_BASE_URL = 'http://media-gateway';
    process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
    process.env.MEDIA_DELIVERY_MODE = 'docker-local';

    const mediaPath = path.join(tempRoot, 'generations', 'session-id', 'frame.png');
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from([1, 2, 3]));

    const resolved = await getAccessibleMediaUrlForProvider(
      'http://localhost:3002/assets_v2/generations/session-id/frame.png',
      { preferDataUrl: true, preferInternalDockerUrl: true },
    );

    assert.equal(resolved, 'data:image/png;base64,AQID');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('docker media URLs use the media tunnel for remote provider requests', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_ASSETS_V2_ROOT: process.env.SAMSAR_ASSETS_V2_ROOT,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
    SAMSAR_PUBLIC_MEDIA_BASE_URL: process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL: process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    SAMSAR_MEDIA_TUNNEL_PUBLIC_URL: process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    SAMSAR_MEDIA_DELIVERY_MODE: process.env.SAMSAR_MEDIA_DELIVERY_MODE,
    MEDIA_DELIVERY_MODE: process.env.MEDIA_DELIVERY_MODE,
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-ref-'));

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_ASSETS_V2_ROOT = tempRoot;
    process.env.MEDIA_PUBLIC_URL = 'http://20.24.15.143/api';
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL = 'http://20.24.15.143/api';
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL = 'http://20.24.15.143/api';
    process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL = 'https://media-tunnel.trycloudflare.com';
    process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
    process.env.MEDIA_DELIVERY_MODE = 'docker-local';

    const mediaPath = path.join(tempRoot, 'generations', 'session-id', 'frame.png');
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from([4]));

    const resolved = await getAccessibleMediaUrlForProvider(
      'http://20.24.15.143/api/assets_v2/generations/session-id/frame.png',
    );

    assert.equal(resolved, 'https://media-tunnel.trycloudflare.com/assets_v2/generations/session-id/frame.png');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('docker media URLs require a media tunnel for remote provider requests', async () => {
  const previousEnv = {
    CURRENT_ENV: process.env.CURRENT_ENV,
    SAMSAR_ASSETS_V2_ROOT: process.env.SAMSAR_ASSETS_V2_ROOT,
    MEDIA_PUBLIC_URL: process.env.MEDIA_PUBLIC_URL,
    SAMSAR_PUBLIC_MEDIA_BASE_URL: process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL,
    SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL: process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
    SAMSAR_MEDIA_TUNNEL_PUBLIC_URL: process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL,
    SAMSAR_MEDIA_DELIVERY_MODE: process.env.SAMSAR_MEDIA_DELIVERY_MODE,
    MEDIA_DELIVERY_MODE: process.env.MEDIA_DELIVERY_MODE,
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-ref-'));

  try {
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_ASSETS_V2_ROOT = tempRoot;
    process.env.MEDIA_PUBLIC_URL = 'http://20.24.15.143/api';
    process.env.SAMSAR_PUBLIC_MEDIA_BASE_URL = 'http://20.24.15.143/api';
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL = 'http://20.24.15.143/api';
    delete process.env.SAMSAR_MEDIA_TUNNEL_PUBLIC_URL;
    process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
    process.env.MEDIA_DELIVERY_MODE = 'docker-local';

    const mediaPath = path.join(tempRoot, 'generations', 'session-id', 'frame.png');
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from([5]));

    await assert.rejects(
      () => getAccessibleMediaUrlForProvider(
        'http://20.24.15.143/api/assets_v2/generations/session-id/frame.png',
      ),
      (error) => error?.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE' && error?.retryable === true,
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
