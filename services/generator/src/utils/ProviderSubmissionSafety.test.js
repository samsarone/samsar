import assert from 'node:assert/strict';
import test from 'node:test';

import { isSubmissionOutcomeUnknown } from './ProviderSubmissionSafety.js';

test('fails closed only when an image submission outcome is ambiguous', () => {
  assert.equal(isSubmissionOutcomeUnknown({ status: 400 }), false);
  assert.equal(isSubmissionOutcomeUnknown(new Error('400 prompt rejected')), false);
  assert.equal(isSubmissionOutcomeUnknown({ status: 429 }), false);
  assert.equal(isSubmissionOutcomeUnknown({ status: 500 }), true);
  assert.equal(isSubmissionOutcomeUnknown({ code: 'ETIMEDOUT' }), true);
});
