import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { decryptCustomAdapterSecret } from './CustomFalCompatibleListener.js';

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

test('decrypts AES-GCM credentials with a strong explicit custom adapter secret', () => {
  const secret = 'custom-adapter-test-secret-with-32-characters';
  const encrypted = encryptFixture('Bearer private-token', secret);

  withSecretEnvironment({ CUSTOM_ADAPTER_SECRET_KEY: secret }, () => {
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
