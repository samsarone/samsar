import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
}

async function fileExists(relativePath) {
  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function getWorkspaceManifests() {
  const rootPackage = await readJson('package.json');
  const manifests = [];

  for (const workspacePattern of rootPackage.workspaces) {
    assert.match(workspacePattern, /^[^*]+\/\*$/);
    const workspaceRoot = workspacePattern.slice(0, -2);
    const entries = await fs.readdir(path.join(root, workspaceRoot), { withFileTypes: true });

    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const manifestPath = path.join(workspaceRoot, entry.name, 'package.json');
      if (await fileExists(manifestPath)) {
        manifests.push({ manifestPath, manifest: await readJson(manifestPath) });
      }
    }
  }

  return manifests;
}

test('every workspace pattern resolves to valid package manifests', async () => {
  const manifests = await getWorkspaceManifests();

  assert.ok(manifests.length >= 12);
  for (const { manifestPath, manifest } of manifests) {
    assert.equal(typeof manifest.name, 'string', `${manifestPath} must declare a package name`);
    assert.ok(manifest.name.trim(), `${manifestPath} must declare a non-empty package name`);
  }
});

test('workspace package names are unique', async () => {
  const names = (await getWorkspaceManifests()).map(({ manifest }) => manifest.name);
  assert.equal(new Set(names).size, names.length);
});

test('generic Docker service paths resolve to synced workspace packages', async () => {
  const compose = await fs.readFile(path.join(root, 'deploy/compose/docker-compose.yml'), 'utf8');
  const servicePaths = [...compose.matchAll(/SERVICE_PATH:\s*([^\s]+)/g)].map((match) => match[1]);

  assert.ok(servicePaths.length >= 9);
  for (const servicePath of servicePaths) {
    assert.equal(
      await fileExists(path.join(servicePath, 'package.json')),
      true,
      `${servicePath} must contain a package.json`,
    );
  }
});

test('the example runtime config keeps external access and providers disabled', async () => {
  const config = await readJson('samsar.config.example.json');

  assert.equal(config.runtime, 'docker');
  assert.equal(config.storage.externalMediaPublishEnabled, false);
  assert.equal(config.localMediaTunnel.enabled, false);
  assert.equal(config.reverseProxy.enabled, false);
  assert.equal(config.publicUrls.clientApp, 'http://localhost:3000');
  assert.equal(config.publicUrls.processorApi, 'http://localhost:3002');
  for (const [providerName, provider] of Object.entries(config.providers)) {
    assert.equal(provider.enabled, false, `${providerName} must be disabled by default`);
    assert.equal(provider.apiKey || '', '', `${providerName} must not include an API key`);
  }
});

test('Docker Compose support files required by the deployment are present', async () => {
  const requiredFiles = [
    'Dockerfile',
    'apps/samsar-client/Dockerfile',
    'services/docker-cleanup/Dockerfile',
    'deploy/compose/logger/loki-config.yml',
    'deploy/compose/logger/promtail-config.yml',
    'deploy/compose/media-gateway.conf',
    'deploy/compose/media-tunnel-controller/Dockerfile',
    'deploy/compose/media-tunnel-controller/controller.mjs',
  ];

  for (const requiredFile of requiredFiles) {
    assert.equal(await fileExists(requiredFile), true, `${requiredFile} must exist`);
  }
});
