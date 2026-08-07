import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSubmissionOutcomeUnknownError,
  isSubmissionOutcomeUnknown,
} from './ProviderSubmissionSafety.js';

test('classifies explicit provider rejections separately from ambiguous submissions', () => {
  assert.equal(isSubmissionOutcomeUnknown({ status: 400 }), false);
  assert.equal(isSubmissionOutcomeUnknown(new Error('400 prompt rejected')), false);
  assert.equal(isSubmissionOutcomeUnknown({ status: 429 }), false);
  assert.equal(isSubmissionOutcomeUnknown({ status: 503 }), true);
  assert.equal(isSubmissionOutcomeUnknown({ code: 'ECONNRESET' }), true);
});

test('tags only ambiguous submission failures as non-retryable unknown outcomes', () => {
  const rejected = new Error('invalid request');
  rejected.status = 400;
  assert.equal(createSubmissionOutcomeUnknownError(rejected), rejected);

  const reset = new Error('socket reset');
  reset.code = 'ECONNRESET';
  const wrapped = createSubmissionOutcomeUnknownError(reset, 'FAL audio submission');
  assert.equal(wrapped.submissionOutcomeUnknown, true);
  assert.equal(wrapped.retryable, false);
  assert.equal(wrapped.cause, reset);
});
