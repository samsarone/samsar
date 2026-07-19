import assert from 'node:assert/strict';
import test from 'node:test';

import router from './narrative.js';

test('create_single is POST-only and protected by external API authentication', () => {
  const layer = router.stack.find((entry) => entry.route?.path === '/create_single');

  assert.ok(layer, 'create_single route must be registered');
  assert.deepEqual(layer.route.methods, { post: true });
  assert.equal(layer.route.stack.length, 2);
  assert.equal(layer.route.stack[0].name, 'validateAPIKeyAndUserId');
  assert.equal(layer.route.stack[1].name, 'handleCreateSingleNarrative');
});

test('create_branching is POST-only and protected by external API authentication', () => {
  const layer = router.stack.find((entry) => entry.route?.path === '/create_branching');

  assert.ok(layer, 'create_branching route must be registered');
  assert.deepEqual(layer.route.methods, { post: true });
  assert.equal(layer.route.stack.length, 2);
  assert.equal(layer.route.stack[0].name, 'validateAPIKeyAndUserId');
  assert.equal(layer.route.stack[1].name, 'handleCreateBranchingNarrative');
});

test('narrative polling aliases are GET-only and authenticated', () => {
  const layer = router.stack.find((entry) => (
    Array.isArray(entry.route?.path) && entry.route.path.includes('/status')
  ));

  assert.ok(layer, 'narrative status routes must be registered');
  assert.deepEqual(layer.route.methods, { get: true });
  assert.equal(layer.route.stack.length, 2);
  assert.equal(layer.route.stack[0].name, 'validateAPIKeyAndUserId');
  assert.equal(layer.route.stack[1].name, 'handleNarrativeStatus');
  assert.ok(layer.route.path.includes('/create_single/:request_id/status'));
  assert.ok(layer.route.path.includes('/create_branching/status'));
  assert.ok(layer.route.path.includes('/create_branching/:request_id/status'));
});
