import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCKER_VIDEO_PROVIDER,
  getDockerVideoProviderPriority,
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

test('Happy Horse Docker priority is Alibaba then FAL then Samsar', () => {
  assert.deepEqual(getDockerVideoProviderPriority('HAPPYHORSEI2V'), [
    DOCKER_VIDEO_PROVIDER.ALIBABA_CLOUD,
    DOCKER_VIDEO_PROVIDER.FAL,
    DOCKER_VIDEO_PROVIDER.SAMSAR,
  ]);
});

test('WAN video keeps FAL as its Docker provider before Samsar fallback', () => {
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
