import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAPIKeyUsageContext } from './RequestAuthContext.js';

test('normalizes missing API key usage context to null', () => {
  assert.equal(normalizeAPIKeyUsageContext(), null);
  assert.equal(normalizeAPIKeyUsageContext(null), null);
  assert.equal(normalizeAPIKeyUsageContext(''), null);
  assert.equal(normalizeAPIKeyUsageContext([]), null);
  assert.equal(normalizeAPIKeyUsageContext({}), null);
  assert.equal(normalizeAPIKeyUsageContext({ apiKeyId: null }), null);
});

test('normalizes API key usage context with limit fields', () => {
  assert.deepEqual(
    normalizeAPIKeyUsageContext({
      apiKeyId: '  api_key_123  ',
      usageLimit: 500,
      usageLimitPeriod: 'monthly',
    }),
    {
      apiKeyId: 'api_key_123',
      apiKeyUsageLimit: 500,
      apiKeyUsageLimitPeriod: 'monthly',
    },
  );
});
