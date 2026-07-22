import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOYMENT_PROVIDER_CAPABILITIES,
  buildAvailableDeploymentModels,
  validateDeploymentProviderCredentials,
  validateOpenRouterKey,
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
  assert.equal(available.actions.includes('moderation'), true);
});

test('OpenRouter availability exposes all inference models and no media-generation models', () => {
  const available = buildAvailableDeploymentModels({ openrouter: { ok: true, status: 'valid' } });
  assert.deepEqual(available.providers, ['openrouter']);
  assert.deepEqual(available.models, ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol']);
  assert.deepEqual(available.actions, ['assistant', 'chat']);
});

test('OpenRouter validation uses the authenticated current-key endpoint', async () => {
  let observedUrl = '';
  let observedAuthorization = '';
  const result = await validateOpenRouterKey('openrouter-test-key', {
    fetchImpl: async (url, options) => {
      observedUrl = url;
      observedAuthorization = options?.headers?.Authorization;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { label: 'test-key' } }),
      };
    },
  });

  assert.equal(observedUrl, 'https://openrouter.ai/api/v1/key');
  assert.equal(observedAuthorization, 'Bearer openrouter-test-key');
  assert.equal(result.status, 'valid');
  assert.equal(result.ok, true);
});

test('OpenRouter validation rejects unauthorized and non-key responses', async () => {
  const unauthorized = await validateOpenRouterKey('invalid-key', {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } }),
    }),
  });
  assert.equal(unauthorized.status, 'invalid');
  assert.equal(unauthorized.statusCode, 401);

  const publicCatalogShape = await validateOpenRouterKey('invalid-key', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }),
  });
  assert.equal(publicCatalogShape.status, 'invalid');
  assert.match(publicCatalogShape.message, /key-validation response/i);
});

test('OpenRouter validation rejects management keys and reports upstream failures as errors', async () => {
  const managementKey = await validateOpenRouterKey('management-key', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { is_management_key: true } }),
    }),
  });
  assert.equal(managementKey.status, 'invalid');
  assert.match(managementKey.message, /management keys cannot be used for inference/i);

  const upstreamFailure = await validateOpenRouterKey('possibly-valid-key', {
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Internal server error' } }),
    }),
  });
  assert.equal(upstreamFailure.status, 'error');
  assert.equal(upstreamFailure.ok, false);
  assert.match(upstreamFailure.message, /status 500/i);
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
    alibaba_cloud_api_key: 'sk-test-key',
    dashscope_base_url: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
  });

  assert.equal(result.providers.alibabaCloud.status, 'format_valid');
  assert.equal(result.providers.alibabaCloud.validationMode, 'format_only');
  assert.equal(result.providers.alibabaCloud.billingMode, 'pay_as_you_go');
  assert.equal(result.providers.alibabaCloud.keyType, 'pay_as_you_go');
  assert.equal(result.providers.alibabaCloud.endpointType, 'pay_as_you_go');
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
    alibaba_api_key: 'sk-test-key',
    alibaba_api_host: 'ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com',
  });

  assert.equal(result.providers.alibabaCloud.status, 'format_valid');
  assert.equal(
    result.providers.alibabaCloud.baseUrl,
    'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
});

test('accepts Token Plan Alibaba credentials for native deployment', async () => {
  const planKey = await validateDeploymentProviderCredentials({
    alibaba_api_key: 'sk-sp-plan-key',
    alibaba_api_host: 'dashscope-intl.aliyuncs.com',
  });
  assert.equal(planKey.providers.alibabaCloud.status, 'format_valid');
  assert.equal(planKey.providers.alibabaCloud.keyType, 'plan');

  const planEndpoint = await validateDeploymentProviderCredentials({
    alibaba_api_key: 'sk-payg-key',
    alibaba_api_host: 'token-plan.ap-southeast-1.maas.aliyuncs.com',
  });
  assert.equal(planEndpoint.providers.alibabaCloud.status, 'format_valid');
  assert.equal(planEndpoint.providers.alibabaCloud.keyType, 'token_plan');
  assert.equal(planEndpoint.providers.alibabaCloud.endpointType, 'token_plan');
});
