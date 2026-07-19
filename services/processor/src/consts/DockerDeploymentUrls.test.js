import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDockerLocalPublicAssetBaseUrl,
  resolveDockerLocalPublicProcessorBaseUrl,
} from './DockerDeploymentUrls.js';

test('Docker preview URLs prefer the configured processor over a provider tunnel API server', () => {
  const env = {
    API_SERVER: 'https://temporary-provider-tunnel.example',
    PROCESSOR_URL: 'http://localhost:3002/',
  };

  assert.equal(resolveDockerLocalPublicProcessorBaseUrl(env), 'http://localhost:3002');
  assert.equal(resolveDockerLocalPublicAssetBaseUrl(env), 'http://localhost:3002');
});

test('an explicit Docker public processor or asset base remains authoritative', () => {
  assert.equal(resolveDockerLocalPublicProcessorBaseUrl({
    SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL: 'https://samsar.example/api/',
    PROCESSOR_URL: 'http://processor:3002',
  }), 'https://samsar.example/api');
  assert.equal(resolveDockerLocalPublicAssetBaseUrl({
    SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL: 'https://media.samsar.example/',
    PROCESSOR_URL: 'http://localhost:3002',
  }), 'https://media.samsar.example');
});
