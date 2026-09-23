import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCustomAdapterSecret,
  getTokenSecret,
  runtimeSecretMatches,
  validateRuntimeSecret,
} from './RuntimeSecrets.js';

const VALID_SECRET = 'runtime-secret-9f8c7b6a5d4e3f2a1c0b';

test('accepts explicitly configured runtime secrets of at least 32 bytes', () => {
  assert.equal(validateRuntimeSecret('TEST_SECRET', VALID_SECRET), VALID_SECRET);
  assert.equal(getTokenSecret({ TOKEN_SECRET: VALID_SECRET }), VALID_SECRET);
  assert.equal(
    getCustomAdapterSecret({ CUSTOM_ADAPTER_SECRET_KEY: VALID_SECRET }),
    VALID_SECRET,
  );
});

test('rejects missing and short runtime secrets', () => {
  assert.throws(
    () => validateRuntimeSecret('TEST_SECRET'),
    /TEST_SECRET.*explicitly configured/,
  );
  assert.throws(
    () => validateRuntimeSecret('TEST_SECRET', 'x'.repeat(31)),
    /TEST_SECRET.*at least 32 bytes/,
  );
});

test('rejects known public and placeholder runtime secrets', () => {
  const publicValues = [
    'change-me-in-production',
    'local-development-only-secret',
    'replace-with-at-least-32-random-characters',
    'samsar-newsletter-unsubscribe',
    `samsar-local-${'x'.repeat(32)}`,
  ];

  for (const value of publicValues) {
    assert.throws(
      () => validateRuntimeSecret('TEST_SECRET', value),
      /TEST_SECRET.*known public\/default value/,
    );
  }
});

test('rejects credential-file control characters', () => {
  assert.throws(
    () => validateRuntimeSecret('TEST_SECRET', `safe-prefix-${'x'.repeat(32)}\nunsafe-suffix`),
    /must not contain NUL, carriage-return, or newline characters/,
  );
});

test('requires a dedicated custom-adapter secret', () => {
  assert.throws(
    () => getCustomAdapterSecret({
      TOKEN_SECRET: VALID_SECRET,
      CUSTOM_CREDENTIALS_SECRET: VALID_SECRET,
    }),
    /CUSTOM_ADAPTER_SECRET_KEY.*explicitly configured/,
  );
});

test('runtime secret comparison fails closed and compares exact values', () => {
  assert.equal(runtimeSecretMatches('INTERNAL_SECRET', undefined, {}), false);
  assert.equal(runtimeSecretMatches('INTERNAL_SECRET', 'anything', {}), false);
  assert.equal(
    runtimeSecretMatches('INTERNAL_SECRET', VALID_SECRET, {
      INTERNAL_SECRET: 'change-me-in-production',
    }),
    false,
  );
  assert.equal(
    runtimeSecretMatches('INTERNAL_SECRET', VALID_SECRET, {
      INTERNAL_SECRET: VALID_SECRET,
    }),
    true,
  );
  assert.equal(
    runtimeSecretMatches('INTERNAL_SECRET', `${VALID_SECRET} `, {
      INTERNAL_SECRET: VALID_SECRET,
    }),
    false,
  );
});
