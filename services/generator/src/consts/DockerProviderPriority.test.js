import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  DOCKER_ADAPTER_PROVIDER,
  getDockerImageGenerationProviderPriority,
  resolveDockerImageGenerationProvider,
  resolveGPTImageTwoGenerationProvider,
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

test('uses native OpenAI, Fal, then Samsar for GPT Image 2 Docker routing', () => {
  assert.deepEqual(getDockerImageGenerationProviderPriority('gptimage2'), [
    DOCKER_ADAPTER_PROVIDER.OPENAI,
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
