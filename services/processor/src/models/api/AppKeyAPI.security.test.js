import test from 'node:test';
import assert from 'node:assert/strict';

import { getAppKeyHashSecret } from './AppKeyAPI.js';

const VALID_APP_KEY_SECRET = 'app-key-hash-secret-9f8c7b6a5d4e3f2a1c0b';
const VALID_TOKEN_SECRET = 'token-secret-fallback-8e7d6c5b4a3f2e1d0c9b';

test('prefers and validates the dedicated app-key hash secret', () => {
  assert.equal(
    getAppKeyHashSecret({
      APP_KEY_HASH_SECRET: VALID_APP_KEY_SECRET,
      TOKEN_SECRET: `samsar-local-${'x'.repeat(32)}`,
    }),
    VALID_APP_KEY_SECRET,
  );
  assert.equal(
    getAppKeyHashSecret({ SAMSAR_APP_KEY_HASH_SECRET: VALID_APP_KEY_SECRET }),
    VALID_APP_KEY_SECRET,
  );
});

test('accepts only a validated TOKEN_SECRET compatibility fallback', () => {
  assert.equal(
    getAppKeyHashSecret({ TOKEN_SECRET: VALID_TOKEN_SECRET }),
    VALID_TOKEN_SECRET,
  );

  assert.throws(
    () => getAppKeyHashSecret({}),
    (error) => (
      error.status === 500 &&
      /TOKEN_SECRET.*explicitly configured/.test(error.message)
    ),
  );

  for (const value of [
    'short-token-secret',
    'change-me-in-production',
    `samsar-local-${'x'.repeat(32)}`,
  ]) {
    assert.throws(
      () => getAppKeyHashSecret({ TOKEN_SECRET: value }),
      (error) => error.status === 500 && /TOKEN_SECRET/.test(error.message),
    );
  }
});

test('rejects an invalid dedicated app-key secret instead of using TOKEN_SECRET', () => {
  assert.throws(
    () => getAppKeyHashSecret({
      APP_KEY_HASH_SECRET: `samsar-local-${'x'.repeat(32)}`,
      TOKEN_SECRET: VALID_TOKEN_SECRET,
    }),
    (error) => (
      error.status === 500 &&
      /APP_KEY_HASH_SECRET.*known public\/default value/.test(error.message)
    ),
  );
});
