import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCustomerSubAccountRequestedGenerationCredits } from './CustomerSubAccount.js';

test('normalizes omitted customer sub-account requested generation credits to null', () => {
  assert.equal(normalizeCustomerSubAccountRequestedGenerationCredits({}), null);
  assert.equal(
    normalizeCustomerSubAccountRequestedGenerationCredits({
      customer_sub_account: {
        external_customer_id: 'customer-1',
        requested_generation_credits: '   ',
      },
    }),
    null,
  );
});

test('normalizes customer sub-account requested generation credit aliases', () => {
  assert.equal(
    normalizeCustomerSubAccountRequestedGenerationCredits({
      customer_sub_account: {
        requested_generation_credits: 250,
      },
    }),
    250,
  );
  assert.equal(
    normalizeCustomerSubAccountRequestedGenerationCredits({
      subAccount: {
        generationCredits: '125',
      },
    }),
    125,
  );
});

test('rejects invalid customer sub-account requested generation credits', () => {
  assert.throws(
    () => normalizeCustomerSubAccountRequestedGenerationCredits({
      generation_credits: -1,
    }),
    /non-negative integer/,
  );
  assert.throws(
    () => normalizeCustomerSubAccountRequestedGenerationCredits({
      generation_credits: 1.5,
    }),
    /non-negative integer/,
  );
});
