import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAlibabaCompatibleBaseUrl,
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

test('validates the endpoint through its authenticated model listing', async () => {
  let request;
  const result = await validateAlibabaEndpoint({
    apiKey: 'test-secret-key',
    apiHost: 'workspace.ap-southeast-1.maas.aliyuncs.com',
    fetchImpl: async (...args) => {
      request = args;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
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
  assert.equal(request[1].headers.Authorization, 'Bearer test-secret-key');
  assert.deepEqual(result, {
    provider: 'alibabaCloud',
    ok: true,
    status: 'valid',
    validationMode: 'remote_models',
    baseUrl: 'https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    modelCount: 2,
    qwen37MaxAvailable: true,
    qwen37PlusAvailable: true,
  });
  assert.equal(JSON.stringify(result).includes('test-secret-key'), false);
});

test('returns a safe invalid result when Alibaba rejects the credential', async () => {
  const result = await validateAlibabaEndpoint({
    apiKey: 'test-secret-key',
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
    apiKey: 'test-secret-key',
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
