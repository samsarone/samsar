import assert from 'node:assert/strict';
import test from 'node:test';

import router from './v2.js';

function getRegisteredPostPaths() {
  return router.stack.flatMap((layer) => {
    if (!layer?.route?.methods?.post) {
      return [];
    }
    return Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
  });
}

test('v2 exposes subtitle post-processing compatibility routes', () => {
  const postPaths = getRegisteredPostPaths();

  assert.ok(postPaths.includes('/add_subtitles'));
  assert.ok(postPaths.includes('/video/add_subtitles'));
  assert.ok(postPaths.includes('/remove_subtitles'));
  assert.ok(postPaths.includes('/video/remove_subtitles'));
});

test('v2 exposes the canonical external narrative-to-video route', () => {
  const postPaths = getRegisteredPostPaths();

  assert.ok(postPaths.includes('/external/video/narrative_to_video'));
});
