import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCKER_PROVIDER,
  getDockerImageProviderPriority,
  getDockerVideoProviderPriority,
  isDockerProviderRoutingEnabled,
  resolveDockerImageProvider,
  resolveDockerVideoProvider,
} from './DockerProviderPriority.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
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

test('processor and image worker agree on Wan2.7 Pro Docker provider precedence', () => {
  assert.deepEqual(getDockerImageProviderPriority('wan2.7pro'), [
    DOCKER_PROVIDER.ALIBABA_CLOUD,
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
