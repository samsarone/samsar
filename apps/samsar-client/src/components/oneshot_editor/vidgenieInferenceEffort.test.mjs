import assert from 'node:assert/strict';
import test from 'node:test';

import { getHydratedInferenceEffortPreferenceUpdate } from './vidgenieInferenceEffort.mjs';

test('does not persist a default effort before account hydration resolves', () => {
  assert.deepEqual(
    getHydratedInferenceEffortPreferenceUpdate('high', {
      userInitiated: false,
      userFetching: true,
    }),
    {},
  );
  assert.deepEqual(
    getHydratedInferenceEffortPreferenceUpdate('high', {
      userInitiated: true,
      userFetching: true,
    }),
    {},
  );
});

test('persists the resolved lowercase effort after account hydration', () => {
  assert.deepEqual(
    getHydratedInferenceEffortPreferenceUpdate('xhigh', {
      userInitiated: true,
      userFetching: false,
    }),
    { inferenceEffort: 'xhigh' },
  );
  assert.deepEqual(
    getHydratedInferenceEffortPreferenceUpdate(undefined, {
      userInitiated: true,
      userFetching: false,
    }),
    { inferenceEffort: 'high' },
  );
});
