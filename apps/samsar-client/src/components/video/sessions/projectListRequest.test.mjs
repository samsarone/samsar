import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getProjectListErrorMessage,
  shouldRetryProjectListRequest,
} from './projectListRequest.mjs';

test('project list retries transient network and server failures', () => {
  assert.equal(shouldRetryProjectListRequest(new Error('Network Error')), true);
  assert.equal(shouldRetryProjectListRequest({ response: { status: 429 } }), true);
  assert.equal(shouldRetryProjectListRequest({ response: { status: 503 } }), true);
});

test('project list does not retry authentication and client failures', () => {
  assert.equal(shouldRetryProjectListRequest({ response: { status: 401 } }), false);
  assert.equal(shouldRetryProjectListRequest({ response: { status: 404 } }), false);
});

test('project list exposes a useful final error message', () => {
  assert.equal(
    getProjectListErrorMessage({ response: { status: 401 } }),
    'Your session expired. Sign in again, then retry.'
  );
  assert.equal(
    getProjectListErrorMessage({ response: { status: 500, data: { error: 'Temporary failure' } } }),
    'Temporary failure'
  );
});
