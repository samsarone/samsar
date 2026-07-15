import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOYMENT_PROVIDER_CAPABILITIES,
  buildAvailableDeploymentModels,
  validateDeploymentProviderCredentials,
} from './DeploymentProviderAPI.js';

test('Alibaba Cloud credentials expose Qwen, Wan2.7 Pro, and native Happy Horse', () => {
  const available = buildAvailableDeploymentModels({
    alibabaCloud: { ok: true, status: 'valid' },
  });

  assert.deepEqual(available.providers, ['alibabaCloud']);
  assert.deepEqual(available.models, ['HAPPYHORSEI2V', 'QWEN3.7', 'WAN2.7PRO']);
  assert.deepEqual(available.actions, ['assistant', 'chat', 'image', 'video']);
});

test('Samsar fallback availability includes Qwen 3.7 and media models', () => {
  const available = buildAvailableDeploymentModels({
    samsar: { ok: true, status: 'valid' },
  });

  assert.equal(DEPLOYMENT_PROVIDER_CAPABILITIES.samsar.models.includes('QWEN3.7'), true);
  assert.equal(available.models.includes('QWEN3.7'), true);
  assert.equal(available.models.includes('HAPPYHORSEI2V'), true);
  assert.equal(available.models.includes('WAN2.7PRO'), true);
});

test('OpenRouter availability exposes all inference models and no media-generation models', () => {
  const available = buildAvailableDeploymentModels({ openrouter: { ok: true, status: 'valid' } });
  assert.deepEqual(available.providers, ['openrouter']);
  assert.deepEqual(available.models, ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol']);
  assert.deepEqual(available.actions, ['assistant', 'chat']);
});

test('FAL fallback availability keeps Happy Horse and Wan2.7 Pro enabled', () => {
  const available = buildAvailableDeploymentModels({
    fal: { ok: true, status: 'valid' },
  });

  assert.equal(available.models.includes('HAPPYHORSEI2V'), true);
  assert.equal(available.models.includes('WAN2.7PRO'), true);
  assert.equal(available.actions.includes('image'), true);
  assert.equal(available.actions.includes('video'), true);
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
  assert.equal(result.available.models.includes('HAPPYHORSEI2V'), true);
  assert.equal(result.available.models.includes('WAN2.7PRO'), true);
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
