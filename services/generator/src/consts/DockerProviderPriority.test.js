import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  DOCKER_ADAPTER_PROVIDER,
  getDockerImageGenerationProviderPriority,
  resolveDockerImageGenerationProvider,
  resolveWan27ImageGenerationProvider,
} from './DockerProviderPriority.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'FAL_API_KEY',
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
  ENV_KEYS.forEach((key) => {
    if (key !== 'CURRENT_ENV' && key !== 'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED') {
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
