import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAlibabaCompatibleBaseUrl,
  isAlibabaPayAsYouGoApiKey,
  isAlibabaPayAsYouGoBaseUrl,
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

test('identifies pay-as-you-go keys and endpoints', () => {
  assert.equal(isAlibabaPayAsYouGoApiKey('sk-payg-test'), true);
  assert.equal(isAlibabaPayAsYouGoApiKey('sk-sp-plan-test'), false);
  assert.equal(
    isAlibabaPayAsYouGoBaseUrl('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
    true,
  );
  assert.equal(
    isAlibabaPayAsYouGoBaseUrl('https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'),
    true,
  );
  assert.equal(
    isAlibabaPayAsYouGoBaseUrl('https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'),
    false,
  );
  assert.equal(
    isAlibabaPayAsYouGoBaseUrl('https://coding-intl.dashscope.aliyuncs.com/v1'),
    false,
  );
});

test('rejects plan-specific Alibaba keys and endpoints without sending a request', async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    throw new Error('unexpected request');
  };
  const planKey = await validateAlibabaEndpoint({
    apiKey: 'sk-sp-plan-key',
    apiHost: 'dashscope-intl.aliyuncs.com',
    fetchImpl,
  });
  assert.equal(planKey.status, 'invalid');
  assert.match(planKey.message, /pay-as-you-go/i);

  const planEndpoint = await validateAlibabaEndpoint({
    apiKey: 'sk-payg-test',
    apiHost: 'token-plan.ap-southeast-1.maas.aliyuncs.com',
    fetchImpl,
  });
  assert.equal(planEndpoint.status, 'invalid');
  assert.match(planEndpoint.message, /pay-as-you-go/i);
  assert.equal(requests, 0);
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
            { id: 'qwen3.8-max-preview' },
            { id: 'qwen3.7-max' },
            { id: 'qwen3.7-plus' },
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
    modelCount: 3,
    qwen38MaxPreviewAvailable: true,
    qwen37MaxAvailable: true,
    qwen37PlusAvailable: true,
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
