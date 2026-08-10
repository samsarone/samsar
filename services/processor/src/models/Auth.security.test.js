import test from 'node:test';
import assert from 'node:assert/strict';

import { generateAuthToken, verifyAuthToken } from './Auth.js';

const VALID_TOKEN_SECRET = 'auth-token-secret-9f8c7b6a5d4e3f2a1c0b';

function restoreTokenSecret(previousSecret) {
  if (previousSecret === undefined) {
    delete process.env.TOKEN_SECRET;
  } else {
    process.env.TOKEN_SECRET = previousSecret;
  }
}

test('generates and verifies auth tokens with an explicit strong secret', () => {
  const previousSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = VALID_TOKEN_SECRET;
  try {
    const token = generateAuthToken('security-test-user');
    assert.equal(verifyAuthToken(token)._id, 'security-test-user');
  } finally {
    restoreTokenSecret(previousSecret);
  }
});

test('auth token generation and verification reject a missing secret', () => {
  const previousSecret = process.env.TOKEN_SECRET;
  delete process.env.TOKEN_SECRET;
  try {
    assert.throws(
      () => generateAuthToken('security-test-user'),
      /TOKEN_SECRET.*explicitly configured/,
    );
    assert.throws(
      () => verifyAuthToken('not-a-token'),
      /TOKEN_SECRET.*explicitly configured/,
    );
  } finally {
    restoreTokenSecret(previousSecret);
  }
});

test('auth token generation rejects short and known public secrets', () => {
  const previousSecret = process.env.TOKEN_SECRET;
  try {
    process.env.TOKEN_SECRET = 'short-token-secret';
    assert.throws(
      () => generateAuthToken('security-test-user'),
      /TOKEN_SECRET.*at least 32 bytes/,
    );

    process.env.TOKEN_SECRET = `samsar-local-${'x'.repeat(32)}`;
    assert.throws(
      () => generateAuthToken('security-test-user'),
      /TOKEN_SECRET.*known public\/default value/,
    );
  } finally {
    restoreTokenSecret(previousSecret);
  }
});
