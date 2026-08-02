import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canRemoveStudioScene,
  hasActionableStudioLayer,
} from './studioSceneLifecycle.mjs';

test('studio generation actions require a selected persisted layer', () => {
  assert.equal(hasActionableStudioLayer(null), false);
  assert.equal(hasActionableStudioLayer(undefined), false);
  assert.equal(hasActionableStudioLayer({}), false);
  assert.equal(hasActionableStudioLayer({ _id: '' }), false);
  assert.equal(hasActionableStudioLayer({ _id: 'layer-a' }), true);
  assert.equal(hasActionableStudioLayer({
    _id: { toString: () => 'layer-b' },
  }), true);
});

test('studio scene removal always preserves one remaining scene', () => {
  assert.equal(canRemoveStudioScene(undefined), false);
  assert.equal(canRemoveStudioScene([]), false);
  assert.equal(canRemoveStudioScene([{ _id: 'layer-a' }]), false);
  assert.equal(canRemoveStudioScene([
    { _id: 'layer-a' },
    { _id: 'layer-b' },
  ]), true);
});
