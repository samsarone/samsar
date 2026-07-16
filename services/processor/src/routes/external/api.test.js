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
