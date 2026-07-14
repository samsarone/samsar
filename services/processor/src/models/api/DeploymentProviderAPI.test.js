import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOYMENT_PROVIDER_CAPABILITIES,
  buildAvailableDeploymentModels,
  validateDeploymentProviderCredentials,
} from './DeploymentProviderAPI.js';

const ALIBABA_VALIDATION_OPTIONS = {
  dnsLookup: async () => [{ address: '8.8.8.8', family: 4 }],
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    body: { cancel: async () => {} },
  }),
};

test('Alibaba Cloud credentials expose Qwen 3.7 for chat and assistant tasks', () => {
  const available = buildAvailableDeploymentModels({
    alibabaCloud: { ok: true, status: 'valid' },
  });

  assert.deepEqual(available.providers, ['alibabaCloud']);
  assert.deepEqual(available.models, ['QWEN3.7']);
  assert.deepEqual(available.actions, ['assistant', 'chat']);
});

test('Samsar fallback availability includes Qwen 3.7', () => {
  const available = buildAvailableDeploymentModels({
    samsar: { ok: true, status: 'valid' },
  });

  assert.equal(DEPLOYMENT_PROVIDER_CAPABILITIES.samsar.models.includes('QWEN3.7'), true);
  assert.equal(available.models.includes('QWEN3.7'), true);
});

test('accepts deployment-friendly Alibaba credential and base URL aliases', async () => {
  const result = await validateDeploymentProviderCredentials(
    {
      alibaba_cloud_api_key: 'test-key',
      dashscope_base_url: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
    },
    ALIBABA_VALIDATION_OPTIONS,
  );

  assert.equal(result.providers.alibabaCloud.status, 'valid');
  assert.equal(result.providers.alibabaCloud.validationMode, 'remote_models');
  assert.equal(
    result.providers.alibabaCloud.baseUrl,
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(result.available.models.includes('QWEN3.7'), true);
});

test('accepts ALIBABA_API_HOST and expands it to the compatible endpoint', async () => {
  const result = await validateDeploymentProviderCredentials(
    {
      alibaba_api_key: 'test-key',
      alibaba_api_host: 'ws-example.ap-southeast-1.maas.aliyuncs.com',
    },
    ALIBABA_VALIDATION_OPTIONS,
  );

  assert.equal(result.providers.alibabaCloud.status, 'valid');
  assert.equal(
    result.providers.alibabaCloud.baseUrl,
    'https://ws-example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
});
