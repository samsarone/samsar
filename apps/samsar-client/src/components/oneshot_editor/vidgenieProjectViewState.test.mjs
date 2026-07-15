import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveVidgenieLoadedProjectView,
  shouldDeferVidgenieProjectLoad,
} from './vidgenieProjectViewState.mjs';

test('pending projects show their partial result timeline', () => {
  assert.deepEqual(resolveVidgenieLoadedProjectView({
    hasPendingGeneration: true,
    hasStartedGeneration: true,
  }), {
    isPaused: false,
    isPending: true,
    hasFailure: false,
    showResultDisplay: true,
  });
});

test('started failed projects keep their partial timeline visible after reopening', () => {
  assert.deepEqual(resolveVidgenieLoadedProjectView({
    hasStartedGeneration: true,
    failureStatus: 'FAILED',
  }), {
    isPaused: false,
    isPending: false,
    hasFailure: true,
    showResultDisplay: true,
  });
});

test('an untouched blank project continues to show the request form', () => {
  assert.equal(resolveVidgenieLoadedProjectView().showResultDisplay, false);
});

test('a project route waits for authentication bootstrap before loading private session data', () => {
  assert.equal(shouldDeferVidgenieProjectLoad({
    sessionId: '6a573a3fb530bc6f473657ec',
    userInitiated: false,
    userFetching: true,
  }), true);

  assert.equal(shouldDeferVidgenieProjectLoad({
    sessionId: '6a573a3fb530bc6f473657ec',
    userInitiated: true,
    userFetching: true,
  }), true);
});

test('authenticated and resolved guest project routes can load immediately', () => {
  assert.equal(shouldDeferVidgenieProjectLoad({
    sessionId: '6a573a3fb530bc6f473657ec',
    userInitiated: true,
    userFetching: false,
  }), false);

  assert.equal(shouldDeferVidgenieProjectLoad({
    userInitiated: false,
    userFetching: true,
  }), false);
});
