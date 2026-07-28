import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DOCKER_VIDEO_PROVIDER,
  getConfiguredDockerVideoProviders,
  getDockerVideoProviderPriority,
  resolveDockerVideoProvider,
  resolveNextDockerVideoProvider,
} from './DockerProviderPriority.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
  'SAMSAR_AVAILABLE_MODELS_PATH',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
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

test('standalone routing overlays the saved preference and finds each next configured adapter', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-providers-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      HAPPYHORSEI2V: ['fal', 'samsar', 'alibabaCloud'],
      'VEO3.1I2V': ['fal', 'googleCloud', 'samsar'],
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(getConfiguredDockerVideoProviders('HAPPYHORSEI2V'), [
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
  ]);
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.FAL);
  assert.equal(
    resolveDockerVideoProvider('HAPPYHORSEI2V', { preferredProvider: 'samsar' }),
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  );
  assert.equal(
    resolveNextDockerVideoProvider('HAPPYHORSEI2V', DOCKER_VIDEO_PROVIDER.FAL),
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  );
  assert.equal(
    resolveNextDockerVideoProvider('HAPPYHORSEI2V', DOCKER_VIDEO_PROVIDER.SAMSAR, {
      attemptedProviders: [DOCKER_VIDEO_PROVIDER.FAL],
    }),
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
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

test('standalone preference reads do not mutate available-models configuration', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-readonly-'));
  const configPath = path.join(temporaryDirectory, 'available-models.json');
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const availableModels = {
    providers: ['alibabaCloud', 'fal'],
    modelProviders: { HAPPYHORSEI2V: 'alibabaCloud' },
    modelProviderPriority: { HAPPYHORSEI2V: ['alibabaCloud', 'fal', 'samsar'] },
  };
  fs.writeFileSync(configPath, JSON.stringify(availableModels));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: { HAPPYHORSEI2V: ['fal', 'alibabaCloud'] },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = configPath;
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';

  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.FAL);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), availableModels);
});

test('production ignores standalone preferences even when adapter routing is explicitly enabled', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-production-'));
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  const availableModelsPath = path.join(temporaryDirectory, 'missing-available-models.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: { HAPPYHORSEI2V: ['samsar', 'fal', 'alibabaCloud'] },
  }));
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = availableModelsPath;
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(getDockerVideoProviderPriority('HAPPYHORSEI2V'), [
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD);
});

test('staging keeps its legacy available-models provider selection', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-staging-'));
  const availableModelsPath = path.join(temporaryDirectory, 'available-models.json');
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(availableModelsPath, JSON.stringify({
    modelProviders: { HAPPYHORSEI2V: 'fal' },
    modelProviderPriority: { HAPPYHORSEI2V: ['fal', 'alibabaCloud', 'samsar'] },
  }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: { HAPPYHORSEI2V: ['samsar', 'alibabaCloud', 'fal'] },
  }));
  process.env.CURRENT_ENV = 'staging';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = availableModelsPath;
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.FAL);
});
