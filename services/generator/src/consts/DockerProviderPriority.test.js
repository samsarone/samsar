import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import {
  DOCKER_ADAPTER_PROVIDER,
  getConfiguredDockerImageEditProviders,
  getConfiguredDockerImageGenerationProviders,
  getDockerImageEditProviderPriority,
  getDockerImageGenerationProviderPriority,
  resolveDockerImageGenerationProvider,
  resolveGPTImageTwoGenerationProvider,
  resolveNextDockerImageEditProvider,
  resolveNextDockerImageGenerationProvider,
  resolveWan27ImageGenerationProvider,
} from './DockerProviderPriority.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'FAL_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'OPENAI_API_KEY',
  'SAMSAR_API_KEY',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  });
});

function clearCredentials() {
  const nonCredentialKeys = new Set([
    'CURRENT_ENV',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_RUNTIME',
    'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
    'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  ]);
  ENV_KEYS.forEach((key) => {
    if (!nonCredentialKeys.has(key)) {
      delete process.env[key];
    }
  });
}

test('uses Alibaba, Fal, then Samsar for Wan2.7 Pro Docker routing', () => {
  assert.deepEqual(getDockerImageGenerationProviderPriority('wan2.7pro'), [
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ]);
});

test('uses native OpenAI, Fal, then Samsar for GPT Image 2 Docker routing', () => {
  assert.deepEqual(getDockerImageGenerationProviderPriority('gptimage2'), [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ]);
});

test('standalone saved order leads while unspecified compatible providers remain available', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-image-adapters-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'WAN2.7PRO': ['samsar', 'alibabaCloud'],
      NANOBANANA2: ['samsar', 'fal'],
    },
  }));

  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencePath;

  assert.deepEqual(getDockerImageGenerationProviderPriority('WAN2.7PRO'), [
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
  ]);
  assert.deepEqual(getDockerImageEditProviderPriority('NANOBANANA2EDIT'), [
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
  ]);
});

test('configured provider helpers follow saved order and return the next retry adapter', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-image-retry-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'WAN2.7PRO': ['samsar', 'alibabaCloud'],
      NANOBANANA2: ['samsar', 'fal'],
    },
  }));

  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencePath;
  clearCredentials();
  process.env.SAMSAR_API_KEY = 'samsar-key';
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64 = 'google-credentials';

  assert.deepEqual(getConfiguredDockerImageGenerationProviders('WAN2.7PRO'), [
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
  ]);
  assert.equal(
    resolveNextDockerImageGenerationProvider(
      'WAN2.7PRO',
      DOCKER_ADAPTER_PROVIDER.SAMSAR,
    ),
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
  );
  assert.equal(
    resolveNextDockerImageGenerationProvider(
      'WAN2.7PRO',
      DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
    ),
    DOCKER_ADAPTER_PROVIDER.FAL,
  );
  assert.equal(
    resolveNextDockerImageGenerationProvider(
      'WAN2.7PRO',
      DOCKER_ADAPTER_PROVIDER.FAL,
    ),
    '',
  );
  assert.deepEqual(getConfiguredDockerImageEditProviders('NANOBANANA2EDIT'), [
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
  ]);
  assert.equal(
    resolveNextDockerImageEditProvider(
      'NANOBANANA2EDIT',
      DOCKER_ADAPTER_PROVIDER.FAL,
    ),
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
  );
});

test('missing and malformed standalone preference files retain default order', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-image-defaults-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencePath;

  const defaultPriority = [
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ];
  assert.deepEqual(
    getDockerImageGenerationProviderPriority('WAN2.7PRO'),
    defaultPriority,
  );

  fs.writeFileSync(preferencePath, '{not-json');
  assert.deepEqual(
    getDockerImageGenerationProviderPriority('WAN2.7PRO'),
    defaultPriority,
  );
});

test('production and staging ignore standalone adapter preference files', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-image-production-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      NANOBANANAPRO: ['samsar', 'googleCloud', 'fal'],
    },
  }));

  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencePath;
  assert.deepEqual(getDockerImageGenerationProviderPriority('NANOBANANAPRO'), [
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ]);

  process.env.CURRENT_ENV = 'staging';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'staging';
  assert.deepEqual(getDockerImageGenerationProviderPriority('NANOBANANAPRO'), [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ]);
});

test('production deployment prefers Fal over Google for NanoBanana Pro only', () => {
  process.env.CURRENT_ENV = 'production';
  clearCredentials();
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64 = 'google-credentials';

  assert.deepEqual(getDockerImageGenerationProviderPriority('nanobananapro'), [
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ]);
  assert.equal(
    resolveDockerImageGenerationProvider('NANOBANANAPRO'),
    DOCKER_ADAPTER_PROVIDER.FAL,
  );

  process.env.CURRENT_ENV = 'docker';
  assert.deepEqual(getDockerImageGenerationProviderPriority('nanobananapro'), [
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
    DOCKER_ADAPTER_PROVIDER.FAL,
    DOCKER_ADAPTER_PROVIDER.SAMSAR,
  ]);
  assert.equal(
    resolveDockerImageGenerationProvider('NANOBANANAPRO'),
    DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD,
  );
});

test('uses Fal as the GPT Image 2 fallback when native OpenAI is unavailable', () => {
  process.env.CURRENT_ENV = 'docker';
  clearCredentials();
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';

  assert.equal(
    resolveDockerImageGenerationProvider('GPTIMAGE2'),
    DOCKER_ADAPTER_PROVIDER.FAL,
  );

  process.env.OPENAI_API_KEY = 'openai-key';
  assert.equal(
    resolveDockerImageGenerationProvider('GPTIMAGE2'),
    DOCKER_ADAPTER_PROVIDER.OPENAI,
  );
});

test('keeps a persisted Fal GPT Image 2 provider while polling', () => {
  process.env.CURRENT_ENV = 'docker';
  clearCredentials();
  process.env.OPENAI_API_KEY = 'openai-key';

  assert.equal(
    resolveGPTImageTwoGenerationProvider(DOCKER_ADAPTER_PROVIDER.FAL),
    DOCKER_ADAPTER_PROVIDER.FAL,
  );
});

test('uses Fal for hosted production GPT Image 2 text-to-image generation', () => {
  process.env.CURRENT_ENV = 'production';
  clearCredentials();
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.FAL_API_KEY = 'fal-key';

  assert.equal(
    resolveGPTImageTwoGenerationProvider(),
    DOCKER_ADAPTER_PROVIDER.FAL,
  );
});

test('keeps user-supplied GPT Image 2 adapter priority in Docker', () => {
  process.env.CURRENT_ENV = 'docker';
  clearCredentials();
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.FAL_API_KEY = 'fal-key';

  assert.equal(
    resolveGPTImageTwoGenerationProvider(),
    DOCKER_ADAPTER_PROVIDER.OPENAI,
  );
});

test('selects the first configured Wan2.7 Pro provider in Docker', () => {
  process.env.CURRENT_ENV = 'docker';
  clearCredentials();
  process.env.FAL_API_KEY = 'fal-key';
  process.env.SAMSAR_API_KEY = 'samsar-key';
  assert.equal(resolveDockerImageGenerationProvider('WAN2.7PRO'), DOCKER_ADAPTER_PROVIDER.FAL);

  process.env.DASHSCOPE_API_KEY = 'alibaba-key';
  assert.equal(
    resolveDockerImageGenerationProvider('WAN2.7PRO'),
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
  );
});

test('uses FAL as the hosted Wan2.7 Pro provider even when Alibaba is configured', () => {
  process.env.CURRENT_ENV = 'production';
  clearCredentials();
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';
  assert.equal(
    resolveDockerImageGenerationProvider('WAN2.7PRO'),
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
  );
  assert.equal(
    resolveWan27ImageGenerationProvider(),
    DOCKER_ADAPTER_PROVIDER.FAL,
  );
});

test('keeps a persisted Fal provider for polling even when Alibaba is now configured', () => {
  process.env.CURRENT_ENV = 'docker';
  clearCredentials();
  process.env.ALIBABA_API_KEY = 'alibaba-key';
  process.env.FAL_API_KEY = 'fal-key';

  assert.equal(
    resolveWan27ImageGenerationProvider(DOCKER_ADAPTER_PROVIDER.FAL),
    DOCKER_ADAPTER_PROVIDER.FAL,
  );
});

test('keeps a persisted native Alibaba provider for polling in hosted runtime', () => {
  process.env.CURRENT_ENV = 'production';
  clearCredentials();

  assert.equal(
    resolveWan27ImageGenerationProvider(DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD),
    DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD,
  );
});
