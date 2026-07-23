import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cloudflaredOutputHasRegisteredConnection,
  configAllowsLocalMediaTunnel,
  configRequiresLocalMediaTunnel,
  consumeRefreshMarker,
  extractQuickTunnelUrl,
  getConfiguredStableProviderMediaBaseUrl,
  MediaTunnelController,
  normalizeStablePublicHttpsBaseUrl,
  readRefreshMarkerToken,
  updateRuntimeConfigAtomically,
  validateHealthMarker,
  validateStableProviderMediaOrigin,
} from './controller.mjs';

test('extracts only a Cloudflared quick-tunnel origin from process output', () => {
  assert.equal(
    extractQuickTunnelUrl('INF Your quick Tunnel has been created! https://bright-sky.trycloudflare.com'),
    'https://bright-sky.trycloudflare.com',
  );
  assert.equal(extractQuickTunnelUrl('https://example.com'), '');
  assert.equal(extractQuickTunnelUrl(''), '');
});

test('does not treat a quick-tunnel URL as ready before Cloudflared registers its connector', () => {
  const urlOutput = [
    'INF Your quick Tunnel has been created!',
    'https://bright-sky.trycloudflare.com',
  ].join('\n');
  assert.equal(extractQuickTunnelUrl(urlOutput), 'https://bright-sky.trycloudflare.com');
  assert.equal(cloudflaredOutputHasRegisteredConnection(urlOutput), false);

  const registeredOutput = [
    urlOutput,
    'INF Registered tunnel connection connIndex=0 connection=abc location=bkk01 protocol=http2',
  ].join('\n');
  assert.equal(cloudflaredOutputHasRegisteredConnection(registeredOutput), true);
});

test('waits for Cloudflared connector registration before returning a discovered URL', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-cloudflared-fixture-'));
  const fixturePath = path.join(tempRoot, 'cloudflared-fixture.mjs');
  await fs.writeFile(fixturePath, `#!/usr/bin/env node
console.error('INF Your quick Tunnel has been created! https://registered-later.trycloudflare.com');
setTimeout(() => console.error('INF Registered tunnel connection connIndex=0 protocol=http2'), 75);
process.once('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`);
  await fs.chmod(fixturePath, 0o700);

  const controller = new MediaTunnelController({
    SAMSAR_CLOUDFLARED_BINARY: fixturePath,
    SAMSAR_MEDIA_TUNNEL_START_TIMEOUT_MS: '1000',
    SAMSAR_MEDIA_TUNNEL_DNS_SETTLE_MS: '0',
  });
  try {
    let resolved = false;
    const launched = controller.launchCloudflared().then((url) => {
      resolved = true;
      return url;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(resolved, false);
    assert.equal(await launched, 'https://registered-later.trycloudflare.com');
  } finally {
    await controller.stopTunnel();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('detects when Docker-local config needs the media tunnel', () => {
  assert.equal(configRequiresLocalMediaTunnel({
    runtime: 'docker',
    storage: { externalMediaPublishEnabled: false },
    providers: { alibabaCloud: { enabled: true } },
    services: { mediaGateway: true },
  }), true);
  assert.equal(configRequiresLocalMediaTunnel({
    runtime: 'docker',
    storage: { externalMediaPublishEnabled: true },
    providers: { alibabaCloud: { enabled: true } },
  }), false);
  assert.equal(configRequiresLocalMediaTunnel({
    runtime: 'docker',
    storage: { externalMediaPublishEnabled: false },
    providers: {},
    localMediaTunnel: { enabled: false },
  }), false);
  assert.equal(configAllowsLocalMediaTunnel({
    runtime: 'docker',
    storage: { externalMediaPublishEnabled: false },
    services: { mediaGateway: true },
  }), true);
});

test('accepts only globally public HTTPS stable provider media origins', async () => {
  assert.equal(
    normalizeStablePublicHttpsBaseUrl('https://media.example.com/api/'),
    'https://media.example.com/api',
  );
  assert.equal(normalizeStablePublicHttpsBaseUrl('http://media.example.com/api'), '');
  assert.equal(normalizeStablePublicHttpsBaseUrl('https://localhost:3002'), '');
  assert.equal(normalizeStablePublicHttpsBaseUrl('https://10.0.0.4/api'), '');
  assert.equal(normalizeStablePublicHttpsBaseUrl('https://old.trycloudflare.com'), '');
  assert.equal(await validateStableProviderMediaOrigin('http://media.example.com'), false);
});

test('prefers configured stable media then processor origins and ignores tunnel aliases', () => {
  assert.equal(getConfiguredStableProviderMediaBaseUrl({
    publicUrls: {
      media: 'https://media.example.com',
      processorApi: 'https://api.example.com',
    },
  }), 'https://media.example.com');
  assert.equal(getConfiguredStableProviderMediaBaseUrl({
    publicUrls: {
      media: 'https://fallback.trycloudflare.com',
      processorApi: 'https://api.example.com/api',
    },
  }), 'https://api.example.com/api');
  assert.equal(getConfiguredStableProviderMediaBaseUrl({
    publicUrls: {
      media: 'http://203.0.113.10:3002',
      processorApi: 'http://localhost:3002',
    },
  }), '');
});

test('atomically publishes tunnel state without replacing browser preview media URL', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-controller-'));
  const configPath = path.join(tempRoot, 'samsar.config.json');
  const untouched = { nested: { value: 42 } };
  await fs.writeFile(configPath, `${JSON.stringify({
    runtime: 'docker',
    storage: { externalMediaPublishEnabled: false },
    services: { mediaGateway: true },
    providers: { openrouter: { enabled: true } },
    publicUrls: {
      processorApi: 'http://localhost:3002',
      media: 'https://expired.trycloudflare.com',
    },
    localMediaTunnel: {
      enabled: false,
      refreshWaitMs: 120000,
    },
    untouched,
  }, null, 2)}\n`);

  try {
    await updateRuntimeConfigAtomically(
      configPath,
      'https://replacement.trycloudflare.com',
      { now: new Date('2026-07-19T12:00:00.000Z') },
    );
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.deepEqual(config.untouched, untouched);
    assert.equal(config.publicUrls.media, 'http://localhost:3002');
    assert.deepEqual(config.localMediaTunnel, {
      enabled: true,
      refreshWaitMs: 120000,
      provider: 'cloudflared',
      publicUrl: 'https://replacement.trycloudflare.com',
      refreshedAt: '2026-07-19T12:00:00.000Z',
      healthCheckedAt: '2026-07-19T12:00:00.000Z',
      healthPath: '/__samsar_media_health',
      healthMarker: 'samsar-media-gateway',
      managedBy: 'compose-media-tunnel-controller',
    });
    assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);
    assert.deepEqual(
      (await fs.readdir(tempRoot)).filter((name) => name.includes('.tmp-')),
      [],
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('preserves a configured stable processor or reverse-proxy browser media URL', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-controller-stable-'));
  const configPath = path.join(tempRoot, 'samsar.config.json');
  await fs.writeFile(configPath, `${JSON.stringify({
    runtime: 'docker',
    storage: { externalMediaPublishEnabled: false },
    services: { mediaGateway: true },
    providers: { alibabaCloud: { enabled: true } },
    publicUrls: {
      processorApi: 'https://docker.example.com/api',
      media: 'https://docker.example.com/api',
    },
  }, null, 2)}\n`);

  try {
    await updateRuntimeConfigAtomically(configPath, 'https://new-tunnel.trycloudflare.com');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    assert.equal(config.publicUrls.media, 'https://docker.example.com/api');
    assert.equal(config.localMediaTunnel.publicUrl, 'https://new-tunnel.trycloudflare.com');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('does not consume a refresh marker that changed during rotation', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-media-marker-'));
  const markerPath = path.join(tempRoot, 'media-tunnel-refresh.request.json');
  try {
    await fs.writeFile(markerPath, '{"requestedAt":"first"}\n');
    const firstToken = await readRefreshMarkerToken(markerPath);
    await fs.writeFile(markerPath, '{"requestedAt":"second"}\n');
    assert.equal(await consumeRefreshMarker(markerPath, firstToken), false);
    const secondToken = await readRefreshMarkerToken(markerPath);
    assert.equal(await consumeRefreshMarker(markerPath, secondToken), true);
    await assert.rejects(() => fs.stat(markerPath), (error) => error?.code === 'ENOENT');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('validates the exact media gateway health marker', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(request.url === '/__samsar_media_health' ? 'samsar-media-gateway\n' : 'wrong\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    assert.equal(await validateHealthMarker(`http://127.0.0.1:${address.port}`, {
      allowPinnedDns: false,
    }), true);
    assert.equal(await validateHealthMarker(`http://127.0.0.1:${address.port}`, {
      healthMarker: 'wrong-marker',
      allowPinnedDns: false,
    }), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
