import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DOCKER_PROVIDER,
  getDockerImageProviderPriority,
  getDockerVideoProviderPriority,
  isDockerProviderRoutingEnabled,
  resolveDockerImageProvider,
  resolveNextDockerImageProvider,
  resolveDockerVideoProvider,
} from './DockerProviderPriority.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'FAL_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
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

test('processor and worker agree on Happy Horse Docker provider precedence', () => {
  assert.deepEqual(getDockerVideoProviderPriority('HAPPYHORSEI2V'), [
    DOCKER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
  ]);
});

test('processor chooses Alibaba, FAL, and Samsar Happy Horse fallbacks in order', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_PROVIDER.ALIBABA_CLOUD);

  delete process.env.ALIBABA_API_KEY;
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_PROVIDER.FAL);

  delete process.env.FAL_API_KEY;
  assert.equal(resolveDockerVideoProvider('HAPPYHORSEI2V'), DOCKER_PROVIDER.SAMSAR);
});

test('processor keeps Seedance 2.0 on deployment-owned video adapters', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(getDockerVideoProviderPriority('SEEDANCE2.0I2V'), [
    DOCKER_PROVIDER.FAL,
  ]);
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.0I2V'), DOCKER_PROVIDER.FAL);

  delete process.env.FAL_API_KEY;
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.0I2V'), '');
});

test('processor resolves one Seedance 2.5 standalone adapter in saved priority order', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-processor-seedance-25-'));
  const catalogPath = path.join(temporaryDirectory, 'genblaze-model-catalog.json');
  const preferencesPath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(catalogPath, JSON.stringify({
    provider: 'gmicloud',
    models: {
      'SEEDANCE2.5I2V': {
        video: { modelId: 'seedance-2-5-260628', operation: 'video.generate' },
      },
    },
  }));
  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      'SEEDANCE2.5I2V': ['fal', 'gmicloud', 'samsar'],
    },
  }));
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencesPath;
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(getDockerVideoProviderPriority('SEEDANCE2.5I2V'), [
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.GMICLOUD,
    DOCKER_PROVIDER.SAMSAR,
  ]);
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.5I2V'), DOCKER_PROVIDER.FAL);

  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      'SEEDANCE2.5I2V': ['gmicloud', 'samsar', 'fal'],
    },
  }));
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.5I2V'), DOCKER_PROVIDER.GMICLOUD);

  fs.writeFileSync(preferencesPath, JSON.stringify({
    modelProviderPriority: {
      'SEEDANCE2.5I2V': ['samsar', 'gmicloud', 'fal'],
    },
  }));
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.5I2V'), DOCKER_PROVIDER.SAMSAR);
});

test('processor pins production Seedance 2.5 to validated GMICloud only', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-processor-hosted-seedance-25-'));
  const catalogPath = path.join(temporaryDirectory, 'genblaze-model-catalog.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(catalogPath, JSON.stringify({
    provider: 'gmicloud',
    models: {
      'SEEDANCE2.5I2V': {
        video: { modelId: 'seedance-2-5-260628', operation: 'video.generate' },
      },
    },
  }));
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(getDockerVideoProviderPriority('SEEDANCE2.5I2V'), [
    DOCKER_PROVIDER.GMICLOUD,
  ]);
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.5I2V'), DOCKER_PROVIDER.GMICLOUD);

  fs.writeFileSync(catalogPath, JSON.stringify({ provider: 'gmicloud', models: {} }));
  assert.equal(resolveDockerVideoProvider('SEEDANCE2.5I2V'), '');
});

test('processor and image worker agree on Wan2.7 Pro Docker provider precedence', () => {
  assert.deepEqual(getDockerImageProviderPriority('wan2.7pro'), [
    DOCKER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
  ]);
});

test('processor and image worker agree on GPT Image 2 Docker provider precedence', () => {
  assert.deepEqual(getDockerImageProviderPriority('GPTIMAGE2'), [
    DOCKER_PROVIDER.OPENAI,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
  ]);
});

test('production deployment prefers Fal for NanoBanana Pro only', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64 = 'google-credentials';

  assert.deepEqual(getDockerImageProviderPriority('nanobananapro'), [
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_PROVIDER.SAMSAR,
  ]);
  assert.equal(resolveDockerImageProvider('NANOBANANAPRO'), DOCKER_PROVIDER.FAL);

  process.env.CURRENT_ENV = 'docker';
  assert.deepEqual(getDockerImageProviderPriority('nanobananapro'), [
    DOCKER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
  ]);
  assert.equal(resolveDockerImageProvider('NANOBANANAPRO'), DOCKER_PROVIDER.GOOGLE_CLOUD);
  assert.deepEqual(getDockerImageProviderPriority('nanobanana2'), [
    DOCKER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
  ]);
});

test('processor chooses Alibaba, FAL, and Samsar Wan2.7 Pro fallbacks in order', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(resolveDockerImageProvider('WAN2.7PRO'), DOCKER_PROVIDER.ALIBABA_CLOUD);

  delete process.env.ALIBABA_API_KEY;
  assert.equal(resolveDockerImageProvider('WAN2.7PRO'), DOCKER_PROVIDER.FAL);

  delete process.env.FAL_API_KEY;
  assert.equal(resolveDockerImageProvider('WAN2.7PRO'), DOCKER_PROVIDER.SAMSAR);
});

test('production Docker does not enable standalone provider routing implicitly', () => {
  clearEnv();
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.FAL_API_KEY = 'fal-key';

  assert.equal(isDockerProviderRoutingEnabled(), false);
  assert.equal(resolveDockerImageProvider('WAN2.7PRO'), '');

  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  assert.equal(isDockerProviderRoutingEnabled(), true);
  assert.equal(resolveDockerImageProvider('WAN2.7PRO'), DOCKER_PROVIDER.FAL);
});

test('standalone routing honors the saved order and exposes the next configured adapter', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'processor-adapter-order-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'WAN2.7PRO': ['samsar', 'fal', 'alibabaCloud'],
    },
  }));
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencePath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(getDockerImageProviderPriority('WAN2.7PRO'), [
    DOCKER_PROVIDER.SAMSAR,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.ALIBABA_CLOUD,
  ]);
  assert.equal(resolveDockerImageProvider('WAN2.7PRO'), DOCKER_PROVIDER.SAMSAR);
  assert.equal(
    resolveNextDockerImageProvider('WAN2.7PRO', DOCKER_PROVIDER.SAMSAR),
    DOCKER_PROVIDER.FAL,
  );
});

test('production ignores a standalone preference artifact', (t) => {
  clearEnv();
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'processor-prod-adapter-order-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'WAN2.7PRO': ['samsar', 'fal', 'alibabaCloud'],
    },
  }));
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencePath;
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.deepEqual(getDockerImageProviderPriority('WAN2.7PRO'), [
    DOCKER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_PROVIDER.FAL,
    DOCKER_PROVIDER.SAMSAR,
  ]);
});
