import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCKER_PROVIDER,
  getDockerImageProviderPriority,
  getDockerVideoProviderPriority,
  resolveDockerImageProvider,
  resolveDockerVideoProvider,
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

test('processor and image worker agree on Wan2.7 Pro Docker provider precedence', () => {
  assert.deepEqual(getDockerImageProviderPriority('wan2.7pro'), [
    DOCKER_PROVIDER.ALIBABA_CLOUD,
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
