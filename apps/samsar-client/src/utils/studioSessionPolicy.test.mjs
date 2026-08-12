import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getStudioSessionId,
  hasInitialStudioLayer,
  shouldAddInitialLayerToNewStudioSession,
} from './studioSessionPolicy.mjs';

test('a Studio candidate must have an id and at least one layer', () => {
  assert.equal(hasInitialStudioLayer({ _id: 'studio-1', layers: [{}] }), true);
  assert.equal(hasInitialStudioLayer({ _id: 'vidgenie-1', layers: [] }), false);
  assert.equal(hasInitialStudioLayer({ _id: 'unknown-shape' }), false);
  assert.equal(hasInitialStudioLayer({ layers: [{}] }), false);
});

test('the initial-layer fallback applies only to an explicitly empty new session', () => {
  assert.equal(
    shouldAddInitialLayerToNewStudioSession({ _id: 'new-studio', layers: [] }),
    true,
  );
  assert.equal(
    shouldAddInitialLayerToNewStudioSession({ _id: 'existing-studio', layers: [{}] }),
    false,
  );
  assert.equal(
    shouldAddInitialLayerToNewStudioSession({ _id: 'response-without-layers' }),
    false,
  );
});

test('session ids normalize Mongo object values', () => {
  assert.equal(getStudioSessionId({ _id: { $oid: 'mongo-id' } }), 'mongo-id');
});
