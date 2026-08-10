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

function withSecretEnvironment(environment, callback) {
  const keys = ['CUSTOM_ADAPTER_SECRET_KEY', 'CUSTOM_CREDENTIALS_SECRET', 'TOKEN_SECRET'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    delete process.env[key];
  }
  Object.assign(process.env, environment);
  try {
    return callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
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
  const secret = 'custom-adapter-test-secret-with-32-characters';
  withSecretEnvironment({ CUSTOM_ADAPTER_SECRET_KEY: secret }, () => {
    const encrypted = encryptFixture('Bearer private-token', secret);
    assert.equal(decryptCustomAdapterSecret(encrypted), 'Bearer private-token');
  });
});

test('requires an explicit CUSTOM_ADAPTER_SECRET_KEY instead of legacy fallbacks', () => {
  const secret = 'legacy-fallback-secret-with-at-least-32-characters';
  const encrypted = encryptFixture('Bearer private-token', secret);

  for (const environment of [
    {},
    { TOKEN_SECRET: secret },
    { CUSTOM_CREDENTIALS_SECRET: secret },
  ]) {
    withSecretEnvironment(environment, () => {
      assert.throws(
        () => decryptCustomAdapterSecret(encrypted),
        /CUSTOM_ADAPTER_SECRET_KEY is required/,
      );
    });
  }
});

test('rejects weak and known public custom adapter secrets', () => {
  for (const secret of [
    'short-secret',
    'change-me-in-production',
    'local-development-only-secret',
    'replace-with-at-least-32-random-characters',
    'samsar-local-token-secret-change-me',
    'samsar-local-custom-adapter-secret-change-me',
    `valid-length-secret-${'x'.repeat(20)}\n`,
  ]) {
    const encrypted = encryptFixture('Bearer private-token', secret.trim());
    withSecretEnvironment({ CUSTOM_ADAPTER_SECRET_KEY: secret }, () => {
      assert.throws(
        () => decryptCustomAdapterSecret(encrypted),
        /must be at least 32 characters/,
      );
    });
  }
});

test('normalizes asynchronous provider states and common image payloads', () => {
  assert.equal(normalizeProviderStatus({ state: 'running' }), 'PENDING');
  assert.equal(normalizeProviderStatus({ data: { status: 'succeeded' } }), 'COMPLETED');
  assert.equal(normalizeProviderStatus({ status: 'generation_failed' }), 'FAILED');
  assert.equal(getImageUrl({ data: { images: [{ url: 'https://images.example/result.png' }] } }),
    'https://images.example/result.png');
});
