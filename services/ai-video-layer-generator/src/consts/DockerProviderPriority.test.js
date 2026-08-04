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
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'FAL_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_GENBLAZE_ENABLED',
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

test('Happy Horse Docker priority is Alibaba then Samsar then FAL', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  assert.deepEqual(getDockerVideoProviderPriority('HAPPYHORSEI2V'), [
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
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
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.SAMSAR);

  delete process.env.SAMSAR_API_KEY;
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_VIDEO_PROVIDER.FAL);
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
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ]);
});

test('standalone places credential-scoped GMICloud below native providers but ahead of Samsar', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-gmi-enabled-'));
  const catalogPath = path.join(temporaryDirectory, 'genblaze-model-catalog.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      HAPPYHORSEI2V: { video: { modelId: 'happyhorse-1.1-i2v' } },
      SEEDANCEI2V: { video: { modelId: 'seedance-1-5-pro-251215' } },
      'SEEDANCE2.0I2V': {
        video: { modelId: 'seedance-2-0-260128', operation: 'video.generate' },
      },
      KLINGIMGTOVID3PRO: { video: { modelId: 'kling-v3-image-to-video' } },
      KLINGIMGTOVIDTURBO: { video: { modelId: 'kling-3.0-turbo-i2v' } },
      KLINGIMGTOVIDPRO: { video: { modelId: 'Kling-Image2Video-V1.6-Pro' } },
      'KLINGIMGTOVID2.1MASTER': { video: { modelId: 'Kling-Image2Video-V2.1-Master' } },
      'KLINGIMGTOVID2.1PRO': { video: { modelId: 'Kling-Image2Video-V2.1-Pro' } },
      'KLINGIMGTOVID2.1STANDARD': { video: { modelId: 'Kling-Image2Video-V2.1-Standard' } },
      HAILUOPRO: { video: { modelId: 'Minimax-Hailuo-02' } },
      'VEO3.1FLIV': { video: { modelId: 'veo-3.1-generate-001' } },
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  process.env.FAL_API_KEY = 'fal-key';

  assert.deepEqual(getDockerVideoProviderPriority('HAPPYHORSEI2V'), [
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ]);
  assert.equal(
    resolveDockerVideoProvider('HAPPYHORSEI2V'),
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
  );
  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(
    resolveDockerVideoProvider('HAPPYHORSEI2V'),
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
  );
  assert.deepEqual(getDockerVideoProviderPriority('SEEDANCEI2V'), [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ]);
  assert.deepEqual(getDockerVideoProviderPriority('SEEDANCE2.0I2V'), [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
  ]);
  assert.equal(
    resolveDockerVideoProvider('SEEDANCE2.0I2V'),
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
  );
  assert.deepEqual(getDockerVideoProviderPriority('KLINGIMGTOVID3PRO'), [
    DOCKER_VIDEO_PROVIDER.GMICLOUD,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
    DOCKER_VIDEO_PROVIDER.FAL,
  ]);
  for (const model of [
    'VEO3.1FLIV',
    'KLINGIMGTOVIDTURBO',
    'KLINGIMGTOVIDPRO',
    'KLINGIMGTOVID2.1MASTER',
    'KLINGIMGTOVID2.1PRO',
    'KLINGIMGTOVID2.1STANDARD',
    'HAILUOPRO',
  ]) {
    assert.deepEqual(getDockerVideoProviderPriority(model), [
      DOCKER_VIDEO_PROVIDER.GMICLOUD,
      DOCKER_VIDEO_PROVIDER.SAMSAR,
      DOCKER_VIDEO_PROVIDER.FAL,
    ], model);
  }
});

test('credential-scoped GMICloud catalog excludes unverified video routes', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-video-gmi-catalog-'));
  const catalogPath = path.join(temporaryDirectory, 'genblaze-model-catalog.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      SEEDANCEI2V: { video: { modelId: 'seedance-1-5-pro-251215' } },
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;

  assert.equal(resolveDockerVideoProvider('SEEDANCEI2V'), DOCKER_VIDEO_PROVIDER.GMICLOUD);
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.0I2V'), '');
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), '');
  assert.equal(
    getDockerVideoProviderPriority('HAPPYHORSEI2V').includes(DOCKER_VIDEO_PROVIDER.GMICLOUD),
    false,
  );

  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      'SEEDANCE2.0I2V': {
        video: { modelId: 'seedance-2-0-preview', operation: 'video.generate' },
      },
    },
  }));
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.0I2V'), '');
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
