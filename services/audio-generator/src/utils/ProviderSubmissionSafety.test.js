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

test('typed provider media failures remain terminal infrastructure failures without content false positives', async () => {
  const { rethrowAudioInfrastructureError } = await import('./ProviderSubmissionSafety.js');
  assert.throws(() => rethrowAudioInfrastructureError({ status: 'FAILED', detail: [{ type: 'file_download_error' }] }), { code: 'PROVIDER_MEDIA_DOWNLOAD_FAILED', providerMediaUnavailable: true });
  assert.doesNotThrow(() => rethrowAudioInfrastructureError({ status: 'FAILED', detail: [{ type: 'content_policy_violation', message: 'prompt mentions download' }] }));
  const network = Object.assign(new Error('Disconnected'), { code: 'ENETDOWN' });
  assert.throws(() => rethrowAudioInfrastructureError(network), error => error === network);
});

test('known terminal output-download statuses cannot trigger regeneration of an accepted request', async () => {
  const { rethrowAudioMediaDownloadError } = await import('./ProviderSubmissionSafety.js');
  for (const status of [400, 403, 404, 410]) {
    const error = Object.assign(new Error('Output unavailable'), { status });
    assert.throws(() => rethrowAudioMediaDownloadError(error), actual => actual === error && actual.providerMediaUnavailable === true);
  }
  const transient = Object.assign(new Error('Unavailable'), { status: 503 });
  assert.throws(() => rethrowAudioMediaDownloadError(transient), actual => actual === transient && !actual.providerMediaUnavailable);
});
