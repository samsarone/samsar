import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAlibabaEndpointType,
  getAlibabaCompatibleBaseUrl,
  getAlibabaKeyType,
  validateAlibabaEndpoint,
} from './validate-alibaba-endpoint.mjs';

test('normalizes an Alibaba API host or compatible endpoint', () => {
  assert.equal(
    getAlibabaCompatibleBaseUrl('workspace.ap-southeast-1.maas.aliyuncs.com'),
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCompatibleBaseUrl(
      'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
    ),
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaCompatibleBaseUrl(
      'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models',
    ),
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.throws(
    () => getAlibabaCompatibleBaseUrl('http://workspace.example.com'),
    /must use HTTPS/,
  );
});

test('classifies Alibaba keys and endpoints without rejecting plan credentials', () => {
  assert.equal(
    getAlibabaEndpointType('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
    'pay_as_you_go',
  );
  assert.equal(
    getAlibabaKeyType(
      'sk-sp-plan-test',
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    ),
    'plan',
  );
  assert.equal(
    getAlibabaEndpointType('https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'),
    'token_plan',
  );
  assert.equal(
    getAlibabaEndpointType('https://coding-intl.dashscope.aliyuncs.com/v1'),
    'coding_plan',
  );
});

test('validates Token Plan credentials and records their type', async () => {
  const planEndpoint = await validateAlibabaEndpoint({
    apiKey: 'sk-sp-plan-key',
    apiHost: 'token-plan.ap-southeast-1.maas.aliyuncs.com',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'qwen3.8-max' }] }),
    }),
  });
  assert.equal(planEndpoint.status, 'valid');
  assert.equal(planEndpoint.keyType, 'token_plan');
  assert.equal(planEndpoint.endpointType, 'token_plan');
  assert.equal(planEndpoint.billingMode, 'token_plan');
});

test('validates the endpoint through its authenticated model listing', async () => {
  let request;
  const result = await validateAlibabaEndpoint({
    apiKey: 'sk-test-secret-key',
    apiHost: 'workspace.ap-southeast-1.maas.aliyuncs.com',
    fetchImpl: async (...args) => {
      request = args;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'qwen3.8-max' },
          ],
        }),
      };
    },
  });

  assert.equal(
    request[0],
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models',
  );
  assert.equal(request[1].headers.Authorization, 'Bearer sk-test-secret-key');
  assert.deepEqual(result, {
    provider: 'alibabaCloud',
    ok: true,
    status: 'valid',
    validationMode: 'remote_models',
    baseUrl: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    billingMode: 'pay_as_you_go',
    keyType: 'pay_as_you_go',
    endpointType: 'pay_as_you_go',
    modelCount: 1,
    qwen38MaxAvailable: true,
  });
  assert.equal(JSON.stringify(result).includes('sk-test-secret-key'), false);
});

test('returns a safe invalid result when Alibaba rejects the credential', async () => {
  const result = await validateAlibabaEndpoint({
    apiKey: 'sk-test-secret-key',
    apiHost: 'workspace.ap-southeast-1.maas.aliyuncs.com',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Rejected test-secret-key' }),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid');
  assert.equal(result.statusCode, 401);
  assert.equal(JSON.stringify(result).includes('test-secret-key'), false);
});

test('rejects a successful response that is not a compatible model listing', async () => {
  const result = await validateAlibabaEndpoint({
    apiKey: 'sk-test-secret-key',
    apiHost: 'workspace.ap-southeast-1.maas.aliyuncs.com',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid');
});
