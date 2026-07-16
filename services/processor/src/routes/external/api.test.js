import assert from 'node:assert/strict';
import test from 'node:test';

import router from './api.js';

test('external moderation aliases are POST-only and protected by API-key authentication', () => {
  const moderationLayer = router.stack.find((layer) => (
    Array.isArray(layer.route?.path) &&
    layer.route.path.includes('/moderation') &&
    layer.route.path.includes('/moderations')
  ));

  assert.ok(moderationLayer, 'moderation routes must be registered');
  assert.deepEqual(moderationLayer.route.path, ['/moderation', '/moderations']);
  assert.deepEqual(moderationLayer.route.methods, { post: true });
  assert.equal(moderationLayer.route.stack.length, 2);
  assert.equal(moderationLayer.route.stack[0].name, 'validateAPIKeyAndUserId');
  assert.equal(moderationLayer.route.stack[1].name, 'handleExternalModeration');
});

test('external assistant polling status aliases are GET-only and authenticated', () => {
  const statusLayer = router.stack.find((layer) => (
    Array.isArray(layer.route?.path) &&
    layer.route.path.includes('/chat/status') &&
    layer.route.path.includes('/assistant/status')
  ));

  assert.ok(statusLayer, 'external assistant status routes must be registered');
  assert.deepEqual(statusLayer.route.methods, { get: true });
  assert.equal(statusLayer.route.stack.length, 2);
  assert.equal(statusLayer.route.stack[0].name, 'validateAPIKeyAndUserId');
  assert.equal(statusLayer.route.stack[1].name, 'handleExternalChatCompletionStatus');
});
