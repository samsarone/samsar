import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveVidgenieLoadedProjectView } from './vidgenieProjectViewState.mjs';

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
