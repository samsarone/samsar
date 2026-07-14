import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOYMENT_PROVIDER_CAPABILITIES,
  buildAvailableDeploymentModels,
  validateDeploymentProviderCredentials,
} from './DeploymentProviderAPI.js';

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
  const result = await validateDeploymentProviderCredentials({
    alibaba_cloud_api_key: 'test-key',
    dashscope_base_url: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
  });

  assert.equal(result.providers.alibabaCloud.status, 'format_valid');
  assert.equal(result.providers.alibabaCloud.validationMode, 'format_only');
  assert.equal(
    result.providers.alibabaCloud.baseUrl,
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(result.available.models.includes('QWEN3.7'), true);
});

test('accepts ALIBABA_API_HOST and expands it to the compatible endpoint', async () => {
  const result = await validateDeploymentProviderCredentials({
    alibaba_api_key: 'test-key',
    alibaba_api_host: 'ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com',
  });

  assert.equal(result.providers.alibabaCloud.status, 'format_valid');
  assert.equal(
    result.providers.alibabaCloud.baseUrl,
    'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
});
