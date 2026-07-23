import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveFreshManagedProviderMediaUrl } from './ProviderMediaTunnel.js';
import {
  getAccessibleProviderMediaUrl,
  readMountedProviderMediaBufferIfAvailable,
} from './ProviderMediaUrl.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_RUNTIME',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
  'MEDIA_BUCKET_NAME',
  'STATIC_CDN_BUCKET',
  'STATIC_CDN_URL',
  'PUBLIC_STATIC_CDN_URL',
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
  'SAMSAR_ASSETS_V2_ROOT',
  'SAMSAR_ASSETS_ROOT',
];

function setEnvironment(t, values) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

test('maps mounted and stale managed Docker references through a fresh exact resolver', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-provider-media-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const staleVideoPath = path.join(assetsV2Root, 'run', 'clip.mp4');
  fs.mkdirSync(path.dirname(staleVideoPath), { recursive: true });
  fs.writeFileSync(staleVideoPath, 'video');
  setEnvironment(t, {
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    SAMSAR_ASSETS_V2_ROOT: assetsV2Root,
    SAMSAR_ASSETS_ROOT: path.join(tempRoot, 'assets'),
  });
  const resolutions = [];
  const resolveManagedUrl = async (request) => {
    resolutions.push(request);
    return `https://fresh.example.test/${request.mediaPath}`;
  };

  assert.equal(
    await getAccessibleProviderMediaUrl('/assets_v2/run/frame.png', {
      mediaKind: 'image', resolveManagedUrl,
    }),
    'https://fresh.example.test/assets_v2/run/frame.png',
  );
  assert.equal(
    await getAccessibleProviderMediaUrl(
      'https://expired.trycloudflare.com/assets_v2/run/clip.mp4?token=old',
      { mediaKind: 'video', resolveManagedUrl },
    ),
    'https://fresh.example.test/assets_v2/run/clip.mp4',
  );
  assert.equal(resolutions[0].expectedContentTypePrefix, 'image/');
  assert.equal(resolutions[1].expectedContentTypePrefix, 'video/');
});

test('reads mounted media bytes without resolving a public URL', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-inline-media-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const imagePath = path.join(assetsV2Root, 'generations', 'session', 'frame.png');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, 'mounted-image');
  setEnvironment(t, {
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    SAMSAR_ASSETS_V2_ROOT: assetsV2Root,
    SAMSAR_ASSETS_ROOT: path.join(tempRoot, 'assets'),
  });

  const bytes = await readMountedProviderMediaBufferIfAvailable(
    'http://localhost:3002/assets_v2/generations/session/frame.png',
    { mediaKind: 'image' },
  );

  assert.equal(bytes.toString(), 'mounted-image');
});

test('preserves independent public and valid data URLs but rejects unsafe references', async (t) => {
  setEnvironment(t, { CURRENT_ENV: 'docker', SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local' });
  const publicUrl = 'https://independent.example.test/media/frame.png';
  const dataUrl = 'data:image/png;base64,YWJj';
  assert.equal(await getAccessibleProviderMediaUrl(publicUrl, { mediaKind: 'image' }), publicUrl);
  const foreignTunnelUrl = 'https://foreign.trycloudflare.com/assets_v2/other/frame.png';
  assert.equal(
    await getAccessibleProviderMediaUrl(foreignTunnelUrl, { mediaKind: 'image' }),
    foreignTunnelUrl,
  );
  assert.equal(await getAccessibleProviderMediaUrl(dataUrl, { mediaKind: 'image' }), dataUrl);

  await assert.rejects(
    getAccessibleProviderMediaUrl('http://127.0.0.1:3002/not-an-asset.png', { mediaKind: 'image' }),
    { code: 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' },
  );
  await assert.rejects(
    getAccessibleProviderMediaUrl('file:///etc/passwd', { mediaKind: 'image' }),
    { code: 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' },
  );
  await assert.rejects(
    getAccessibleProviderMediaUrl('data:video/mp4;base64,YWJj', { mediaKind: 'image' }),
    { code: 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' },
  );
});

test('external-S3 mode requires and primes a configured public HTTPS URL', async (t) => {
  setEnvironment(t, {
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    MEDIA_BUCKET_NAME: 'demo-bucket',
    STATIC_CDN_URL: 'https://cdn.example.test/',
  });
  const primed = [];
  const result = await getAccessibleProviderMediaUrl('assets_v2/run/frame.png', {
    mediaKind: 'image',
    buildCloudUrl: (key) => `https://cdn.example.test/${key}`,
    primeCloudUrl: async (url, options) => primed.push([url, options]),
  });
  assert.equal(result, 'https://cdn.example.test/assets_v2/run/frame.png');
  assert.deepEqual(primed, [[result, { requireSuccess: true }]]);

  await assert.rejects(
    getAccessibleProviderMediaUrl('assets_v2/run/frame.png', {
      mediaKind: 'image',
      buildCloudUrl: (key) => `http://cdn.example.test/${key}`,
      primeCloudUrl: async () => {},
    }),
    { code: 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' },
  );

  delete process.env.STATIC_CDN_URL;
  await assert.rejects(
    getAccessibleProviderMediaUrl('assets_v2/run/frame.png', {
      mediaKind: 'image',
      buildCloudUrl: (key) => `https://static.samsar.one/${key}`,
      primeCloudUrl: async () => {},
    }),
    { code: 'SAMSAR_PROVIDER_MEDIA_REFERENCE_INVALID' },
  );
});

test('managed tunnel resolver probes the exact encoded asset and MIME type', async () => {
  const requests = [];
  const url = await resolveFreshManagedProviderMediaUrl({
    mediaPath: 'assets_v2/run/frame one.png',
    getBaseUrlCandidates: () => ['https://fresh.example.test/media'],
    expectedContentTypePrefix: 'image/',
    fetchImpl: async (candidate, options) => {
      requests.push([candidate, options]);
      return {
        ok: true,
        status: 206,
        url: candidate,
        headers: { get: () => 'image/png' },
      };
    },
  });
  assert.equal(url, 'https://fresh.example.test/media/assets_v2/run/frame%20one.png');
  assert.equal(requests[0][1].headers.Range, 'bytes=0-0');
});

test('a configured stable public HTTPS media origin is probed before tunnel fallback', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-tunnel-candidates-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const configPath = path.join(tempRoot, 'samsar.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    publicUrls: { media: 'https://ordinary-public.example.test' },
  }));
  setEnvironment(t, {
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local',
    SAMSAR_RUNTIME_CONFIG_FILE: configPath,
    SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS: '1',
    SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS: '10',
    SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH: path.join(tempRoot, 'refresh.json'),
  });
  const requestedUrls = [];
  const resolved = await getAccessibleProviderMediaUrl('assets_v2/run/clip.mp4', {
    mediaKind: 'video',
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 206,
        url,
        headers: { get: () => 'video/mp4' },
      };
    },
  });
  assert.equal(resolved, 'https://ordinary-public.example.test/assets_v2/run/clip.mp4');
  assert.deepEqual(requestedUrls, [resolved]);
});
