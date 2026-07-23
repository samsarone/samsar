import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DOCKER_VIDEO_PROVIDER,
  getConfiguredDockerVideoProviders,
  getDockerVideoProviderPriority,
  promoteDockerVideoProvider,
  resolveDockerVideoProvider,
  resolveNextDockerVideoProvider,
} from './DockerProviderPriority.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
  'SAMSAR_AVAILABLE_MODELS_PATH',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'FAL_API_KEY',
  'SAMSAR_API_KEY',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearEnv() {
  ENV_KEYS.forEach((key) => delete process.env[key]);
}

test.afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
});

test('Happy Horse Docker priority is Alibaba then FAL then Samsar', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'test';
  assert.deepEqual(getDockerVideoProviderPriority('HAPPYHORSEI2V'), [
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
});

test('WAN video keeps FAL as its Docker provider before Samsar fallback', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'test';
  assert.deepEqual(getDockerVideoProviderPriority('WANI2V'), [
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
  assert.deepEqual(getDockerVideoProviderPriority('WANI2V5B'), [
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
});

test('Happy Horse resolves each configured Docker fallback in order', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD);

  delete process.env.ALIBABA_API_KEY;
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.FAL);

  delete process.env.FAL_API_KEY;
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.SAMSAR);
});

test('production Docker keeps hosted production provider routing', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), '');
  assert.deepEqual(getConfiguredDockerVideoProviders('HAPPYHORSEI2V'), []);
});

test('Docker routing honors a saved primary and finds the next configured adapter', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-providers-'));
  const configPath = path.join(temporaryDirectory, 'available-models.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(configPath, JSON.stringify({
    providers: ['alibabaCloud', 'fal', 'samsar'],
    modelProviders: {
      HAPPYHORSEI2V: 'alibabaCloud',
      'VEO3.1I2V': 'fal',
    },
    modelProviderPriority: {
      HAPPYHORSEI2V: ['alibabaCloud', 'fal', 'samsar'],
      'VEO3.1I2V': ['fal', 'googleCloud', 'samsar'],
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = configPath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(getConfiguredDockerVideoProviders('HAPPYHORSEI2V'), [
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD);
  assert.equal(
    resolveDockerVideoProvider('HAPPYHORSEI2V', { preferredProvider: 'fal' }),
    DOCKER_VIDEO_PROVIDER.FAL,
  );
  assert.equal(
    resolveNextDockerVideoProvider('HAPPYHORSEI2V', DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD),
    DOCKER_VIDEO_PROVIDER.FAL,
  );
  assert.deepEqual(getDockerVideoProviderPriority('VEO3.1I2V'), [
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
  assert.deepEqual(getDockerVideoProviderPriority('VEO3.1I2V', { generationType: 'sound_effect' }), [
    DOCKER_VIDEO_PROVIDER.GOOGLE_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
});

test('successful alternate adapter promotion becomes the saved Docker primary', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-promotion-'));
  const configPath = path.join(temporaryDirectory, 'available-models.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(configPath, JSON.stringify({
    providers: ['alibabaCloud', 'fal'],
    modelProviders: { HAPPYHORSEI2V: 'alibabaCloud' },
    modelProviderPriority: { HAPPYHORSEI2V: ['alibabaCloud', 'fal', 'samsar'] },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = configPath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';

  assert.equal(promoteDockerVideoProvider('HAPPYHORSEI2V', DOCKER_VIDEO_PROVIDER.FAL), true);

  const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(savedConfig.modelProviders.HAPPYHORSEI2V, DOCKER_VIDEO_PROVIDER.FAL);
  assert.deepEqual(savedConfig.modelProviderPriority.HAPPYHORSEI2V, [
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.FAL);
});
