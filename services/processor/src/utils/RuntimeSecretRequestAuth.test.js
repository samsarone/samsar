import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractRuntimeRequestSecret,
  requestHasValidRuntimeSecret,
} from './RuntimeSecretRequestAuth.js';

const VALID_SECRET = 'internal-route-secret-9f8c7b6a5d4e3f2a1c0b';

test('internal request authentication fails closed when either secret is absent', () => {
  assert.equal(requestHasValidRuntimeSecret({}, { env: {} }), false);
  assert.equal(
    requestHasValidRuntimeSecret(
      { query: { secret: 'attacker-controlled' } },
      { env: {} },
    ),
    false,
  );
});

test('internal request authentication prefers the header and requires an exact match', () => {
  const env = { INTERNAL_SECRET: VALID_SECRET };
  assert.equal(
    requestHasValidRuntimeSecret(
      { headers: { 'x-internal-secret': VALID_SECRET } },
      { env },
    ),
    true,
  );
  assert.equal(
    requestHasValidRuntimeSecret(
      {
        headers: { 'x-internal-secret': 'wrong-secret' },
        query: { secret: VALID_SECRET },
      },
      { env },
    ),
    false,
  );
});

test('legacy query authentication remains supported only with a configured strong secret', () => {
  assert.equal(
    extractRuntimeRequestSecret({ query: { secret: VALID_SECRET } }),
    VALID_SECRET,
  );
  assert.equal(
    requestHasValidRuntimeSecret(
      { query: { secret: VALID_SECRET } },
      { env: { INTERNAL_SECRET: VALID_SECRET } },
    ),
    true,
  );
});
