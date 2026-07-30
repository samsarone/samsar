import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
}

async function readText(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
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

test('every generic Docker service has a synchronized npm lockfile', async () => {
  const compose = await readText('deploy/compose/docker-compose.yml');
  const servicePaths = [...compose.matchAll(/SERVICE_PATH:\s*([^\s]+)/g)].map((match) => match[1]);

  for (const servicePath of servicePaths) {
    const manifest = await readJson(path.join(servicePath, 'package.json'));
    const lock = await readJson(path.join(servicePath, 'package-lock.json'));
    const lockedRoot = lock.packages?.[''];

    assert.ok(lock.lockfileVersion >= 3, `${servicePath}/package-lock.json must use lockfileVersion 3`);
    assert.equal(lockedRoot?.name, manifest.name, `${servicePath} lockfile name must match package.json`);
    assert.equal(
      lockedRoot?.version,
      manifest.version,
      `${servicePath} lockfile version must match package.json`,
    );
    assert.deepEqual(
      lockedRoot?.dependencies || {},
      manifest.dependencies || {},
      `${servicePath} lockfile root dependencies must match package.json`,
    );
  }
});

test('Docker dependency installs are immutable and include platform optionals', async () => {
  const [serviceDockerfile, clientDockerfile, setupWizardDockerfile] = await Promise.all([
    readText('Dockerfile'),
    readText('apps/samsar-client/Dockerfile'),
    readText('apps/setup-wizard/Dockerfile'),
  ]);

  assert.match(serviceDockerfile, /test -f package-lock\.json/);
  assert.match(serviceDockerfile, /npm ci --omit=dev --include=optional/);
  assert.doesNotMatch(serviceDockerfile, /npm install/);
  assert.match(serviceDockerfile, /FFMPEG_PATH=\/usr\/bin\/ffmpeg/);
  assert.match(serviceDockerfile, /FFPROBE_PATH=\/usr\/bin\/ffprobe/);

  assert.match(clientDockerfile, /yarn install --frozen-lockfile --non-interactive/);
  assert.doesNotMatch(clientDockerfile, /yarn add/);

  assert.equal(
    [...setupWizardDockerfile.matchAll(/npm ci\b/g)].length,
    2,
    'setup wizard must use npm ci in both build stages',
  );
  assert.doesNotMatch(setupWizardDockerfile, /npm install/);
});

test('native frontend and image dependencies cover Linux x64 and arm64', async () => {
  const compose = await readText('deploy/compose/docker-compose.yml');
  const servicePaths = [...compose.matchAll(/SERVICE_PATH:\s*([^\s]+)/g)].map((match) => match[1]);

  for (const servicePath of servicePaths) {
    const manifest = await readJson(path.join(servicePath, 'package.json'));
    if (!manifest.dependencies?.sharp) continue;

    const lock = await readJson(path.join(servicePath, 'package-lock.json'));
    for (const packageName of [
      '@img/sharp-linux-arm64',
      '@img/sharp-linux-x64',
      '@img/sharp-libvips-linux-arm64',
      '@img/sharp-libvips-linux-x64',
    ]) {
      assert.ok(
        lock.packages?.[`node_modules/${packageName}`],
        `${servicePath}/package-lock.json must include ${packageName}`,
      );
    }
  }

  const [clientLock, setupWizardLock] = await Promise.all([
    readText('apps/samsar-client/yarn.lock'),
    readJson('apps/setup-wizard/package-lock.json'),
  ]);
  assert.match(clientLock, /@esbuild\/linux-arm64@/);
  assert.match(clientLock, /@esbuild\/linux-x64@/);
  assert.ok(setupWizardLock.packages?.['node_modules/@esbuild/linux-arm64']);
  assert.ok(setupWizardLock.packages?.['node_modules/@esbuild/linux-x64']);
  assert.ok(setupWizardLock.packages?.['node_modules/@rollup/rollup-linux-arm64-gnu']);
  assert.ok(setupWizardLock.packages?.['node_modules/@rollup/rollup-linux-x64-gnu']);
});

test('the example runtime config keeps external access and providers disabled', async () => {
  const config = await readJson('samsar.config.example.json');

  assert.equal(config.runtime, 'docker');
  assert.equal(config.deploymentEdition, 'standalone');
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

test('Kimi K3 setup renders into the shared backend environment for every inference consumer', async () => {
  const [config, compose, runtimeRenderer, setupServer, setupWizard] = await Promise.all([
    readJson('samsar.config.example.json'),
    readText('deploy/compose/docker-compose.yml'),
    readText('scripts/generate-runtime-config.mjs'),
    readText('apps/setup-wizard/server.mjs'),
    readText('apps/setup-wizard/src/components/OnboardingWizard.jsx'),
  ]);

  assert.deepEqual(config.providers.kimi, { enabled: false, apiKey: '' });
  assert.match(
    runtimeRenderer,
    /KIMI_K3_API_KEY:\s*config\.providers\?\.kimi\?\.apiKey\s*\|\|\s*''/,
  );
  assert.match(
    setupServer,
    /kimi:\s*\{\s*enabled:\s*Boolean\(normalizeSecretString\(credentials\.kimiK3ApiKey\)\),\s*apiKey:\s*normalizeSecretString\(credentials\.kimiK3ApiKey\)/s,
  );
  assert.match(
    setupWizard,
    /key:\s*'kimi',\s*title:\s*'Kimi K3',[\s\S]*?field:\s*'kimiK3ApiKey'/,
  );
  assert.match(
    setupWizard,
    /key:\s*'kimiK3',[\s\S]*?providerKeys:\s*\['kimi',\s*'samsar'\],[\s\S]*?modelKeys:\s*\['KIMIK3'\]/,
  );
  assert.match(
    setupWizard,
    /credentials:\s*\{\s*\.\.\.credentials,\s*kimiK3ApiKey:\s*''/s,
    'the browser session copy must redact the Kimi API key',
  );

  for (const serviceName of [
    'processor',
    'generator',
    'audio-generator',
    'ai-video-layer-generator',
    'express-video-listener',
    'assistant-query-processor',
  ]) {
    assert.match(
      compose,
      new RegExp(`^  ${serviceName}:\\n    <<: \\*service-env`, 'm'),
      `${serviceName} must inherit the shared provider environment`,
    );
  }
});

test('standalone edition and Docker runtime are independent deployment metadata', async () => {
  const [compose, clientDockerfile, runtimeRenderer] = await Promise.all([
    readText('deploy/compose/docker-compose.yml'),
    readText('apps/samsar-client/Dockerfile'),
    readText('scripts/generate-runtime-config.mjs'),
  ]);

  assert.match(compose, /CURRENT_ENV:\s*standalone/);
  assert.match(compose, /SAMSAR_DEPLOYMENT_EDITION:\s*standalone/);
  assert.match(compose, /SAMSAR_RUNTIME:\s*docker/);
  assert.match(compose, /VITE_SAMSAR_DEPLOYMENT_EDITION:\s*standalone/);
  assert.match(compose, /VITE_DOCKER_INSTALL:\s*"true"/);
  assert.match(clientDockerfile, /ARG VITE_CURRENT_ENV=standalone/);
  assert.match(clientDockerfile, /ARG VITE_SAMSAR_DEPLOYMENT_EDITION=standalone/);
  assert.match(runtimeRenderer, /CURRENT_ENV:\s*'standalone'/);
  assert.match(runtimeRenderer, /SAMSAR_DEPLOYMENT_EDITION:\s*'standalone'/);
  assert.match(runtimeRenderer, /SAMSAR_RUNTIME:\s*'docker'/);
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

test('intermediate cleanup workers run every few hours with a reuse grace period', async () => {
  const [compose, taskProcessorSource, taskSchedulerSource] = await Promise.all([
    readText('deploy/compose/docker-compose.yml'),
    readText('services/task-processor/src/TaskProcessor.js'),
    readText('services/task-processor/src/TaskScheduler.js'),
  ]);
  const taskProcessorBlock = compose
    .split(/\n  docker-cleanup:\n/, 1)[0]
    .split(/\n  task-processor:\n/, 2)[1];
  const cleanupBlock = compose
    .split(/\n  mongo:\n/, 1)[0]
    .split(/\n  docker-cleanup:\n/, 2)[1];

  assert.ok(taskProcessorBlock);
  assert.match(taskProcessorBlock, /restart:\s*unless-stopped/);
  assert.doesNotMatch(taskProcessorBlock, /TASK_PROCESSOR_(?:ENABLE|INTERVAL|RETRY)_/);
  assert.match(taskSchedulerSource, /DEFAULT_DOCKER_INTERVAL_HOURS\s*=\s*3/);
  assert.match(taskProcessorSource, /DEFAULT_STALE_SESSION_FRAME_CLEANUP_HOURS\s*=\s*4/);
  assert.match(
    taskProcessorSource,
    /'TASK_PROCESSOR_ENABLE_FILE_CLEANUP',\s*env,\s*dockerMarkerPresent,\s*true/s,
  );

  assert.ok(cleanupBlock);
  assert.match(cleanupBlock, /restart:\s*unless-stopped/);
  assert.match(cleanupBlock, /CLEANUP_MIN_AGE_HOURS:[^\n]*:-24/);
  assert.match(cleanupBlock, /CLEANUP_CRON_SCHEDULE:[^\n]*17 \*\/3 \* \* \*/);
});
