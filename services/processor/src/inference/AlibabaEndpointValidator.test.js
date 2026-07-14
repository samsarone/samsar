import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAlibabaCompatibleBaseUrl,
  validateAlibabaCloudCredential,
} from './AlibabaEndpointValidator.js';

const PUBLIC_DNS_LOOKUP = async () => [{ address: '8.8.8.8', family: 4 }];

function response(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: { cancel: async () => {} },
  };
}

test('normalizes an Alibaba workspace host to the OpenAI-compatible base URL', () => {
  assert.equal(
    normalizeAlibabaCompatibleBaseUrl({
      apiHost: 'ws-example.ap-southeast-1.maas.aliyuncs.com',
    }),
    'https://ws-example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
});

test('validates Alibaba credentials with exactly one sandboxed models request', async () => {
  const requests = [];
  const result = await validateAlibabaCloudCredential(
    {
      apiKey: 'secret-key',
      apiHost: 'ws-example.ap-southeast-1.maas.aliyuncs.com',
    },
    {
      dnsLookup: PUBLIC_DNS_LOOKUP,
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return response(200);
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 'valid');
  assert.equal(result.validationMode, 'remote_models');
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://ws-example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models',
  );
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'manual');
});

test('rejects authentication failures without enabling Alibaba Cloud', async () => {
  const result = await validateAlibabaCloudCredential(
    {
      apiKey: 'invalid-key',
      apiHost: 'ws-example.ap-southeast-1.maas.aliyuncs.com',
    },
    {
      dnsLookup: PUBLIC_DNS_LOOKUP,
      fetchImpl: async () => response(401),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid');
  assert.equal(result.statusCode, 401);
});

test('does not enable Alibaba Cloud when validation is rate limited', async () => {
  const result = await validateAlibabaCloudCredential(
    {
      apiKey: 'unverified-key',
      apiHost: 'ws-example.ap-southeast-1.maas.aliyuncs.com',
    },
    {
      dnsLookup: PUBLIC_DNS_LOOKUP,
      fetchImpl: async () => response(429),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.equal(result.statusCode, 429);
});

test('rejects non-Alibaba endpoints before making a network request', async () => {
  let requested = false;
  const result = await validateAlibabaCloudCredential(
    {
      apiKey: 'secret-key',
      baseUrl: 'https://example.com/compatible-mode/v1',
    },
    {
      dnsLookup: PUBLIC_DNS_LOOKUP,
      fetchImpl: async () => {
        requested = true;
        return response(200);
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 'invalid');
  assert.match(result.message, /official aliyuncs\.com hostname/i);
  assert.equal(requested, false);
});

test('rejects Alibaba hostnames that resolve to a private address', async () => {
  let requested = false;
  const result = await validateAlibabaCloudCredential(
    {
      apiKey: 'secret-key',
      apiHost: 'ws-example.ap-southeast-1.maas.aliyuncs.com',
    },
    {
      dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
      fetchImpl: async () => {
        requested = true;
        return response(200);
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.message, /public network addresses/i);
  assert.equal(requested, false);
});
