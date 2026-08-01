import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  buildCustomAdapterHeaders,
  decryptCustomAdapterSecret,
  getImageUrl,
  getUserCustomTextToImageEndpoint,
  interpolateCustomAdapterUrl,
  isCustomTextToImageModel,
  normalizeProviderStatus,
} from './CustomTextToImage.js';

function encryptFixture(value, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'enc',
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

test('recognizes generic and per-user custom text-to-image model keys', () => {
  assert.equal(isCustomTextToImageModel('CUSTOM_TEXT_TO_IMAGE'), true);
  assert.equal(isCustomTextToImageModel('CUSTOM_TEXT_TO_IMAGE:flux2'), true);
  assert.equal(isCustomTextToImageModel('FLUX1PRO'), false);
});

test('builds configured auth headers and interpolates encoded request ids', () => {
  assert.deepEqual(buildCustomAdapterHeaders({
    header_key: 'X-API-Key',
    header_value: 'demo-secret',
  }), {
    'Content-Type': 'application/json',
    'X-API-Key': 'demo-secret',
  });
  assert.equal(
    interpolateCustomAdapterUrl(
      'https://images.example/requests/{request_id}/status',
      'request/42',
    ),
    'https://images.example/requests/request%2F42/status',
  );
});

test('selects only the requested per-user endpoint', () => {
  const endpoints = {
    custom_endpoints: [
      {
        id: 'flux-a',
        operation: 'text_to_image',
        generate_url: 'https://a.example/generate',
        status_url: 'https://a.example/{request_id}/status',
        result_url: 'https://a.example/{request_id}/result',
      },
      {
        id: 'flux-b',
        operation: 'text_to_image',
        generate_url: 'https://b.example/generate',
        status_url: 'https://b.example/{request_id}/status',
        result_url: 'https://b.example/{request_id}/result',
      },
    ],
  };
  assert.equal(getUserCustomTextToImageEndpoint(endpoints, 'flux-b')?.id, 'flux-b');
  assert.equal(getUserCustomTextToImageEndpoint(endpoints, 'missing'), null);
});

test('decrypts processor-compatible AES-GCM credentials', () => {
  const previousSecret = process.env.CUSTOM_ADAPTER_SECRET_KEY;
  process.env.CUSTOM_ADAPTER_SECRET_KEY = 'custom-adapter-test-secret';
  try {
    const encrypted = encryptFixture('Bearer private-token', process.env.CUSTOM_ADAPTER_SECRET_KEY);
    assert.equal(decryptCustomAdapterSecret(encrypted), 'Bearer private-token');
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CUSTOM_ADAPTER_SECRET_KEY;
    } else {
      process.env.CUSTOM_ADAPTER_SECRET_KEY = previousSecret;
    }
  }
});

test('normalizes asynchronous provider states and common image payloads', () => {
  assert.equal(normalizeProviderStatus({ state: 'running' }), 'PENDING');
  assert.equal(normalizeProviderStatus({ data: { status: 'succeeded' } }), 'COMPLETED');
  assert.equal(normalizeProviderStatus({ status: 'generation_failed' }), 'FAILED');
  assert.equal(getImageUrl({ data: { images: [{ url: 'https://images.example/result.png' }] } }),
    'https://images.example/result.png');
});
