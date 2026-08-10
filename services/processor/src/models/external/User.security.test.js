import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExternalUserFromAuthToken } from './User.js';

const VALID_TOKEN_SECRET = 'external-user-token-secret-9f8c7b6a5d4e3f2a';

function restoreTokenSecret(previousSecret) {
  if (previousSecret === undefined) {
    delete process.env.TOKEN_SECRET;
  } else {
    process.env.TOKEN_SECRET = previousSecret;
  }
}

test('external auth verification rejects a missing TOKEN_SECRET', async () => {
  const previousSecret = process.env.TOKEN_SECRET;
  delete process.env.TOKEN_SECRET;
  try {
    await assert.rejects(
      () => resolveExternalUserFromAuthToken('not-a-token'),
      /TOKEN_SECRET.*explicitly configured/,
    );
  } finally {
    restoreTokenSecret(previousSecret);
  }
});

test('external auth verification rejects known public TOKEN_SECRET values', async () => {
  const previousSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = `samsar-local-${'x'.repeat(32)}`;
  try {
    await assert.rejects(
      () => resolveExternalUserFromAuthToken('not-a-token'),
      /TOKEN_SECRET.*known public\/default value/,
    );
  } finally {
    restoreTokenSecret(previousSecret);
  }
});

test('external auth verification retains invalid-token handling with a strong secret', async () => {
  const previousSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = VALID_TOKEN_SECRET;
  try {
    assert.equal(await resolveExternalUserFromAuthToken('not-a-token'), null);
  } finally {
    restoreTokenSecret(previousSecret);
  }
});
