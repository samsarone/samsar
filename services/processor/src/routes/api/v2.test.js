import assert from 'node:assert/strict';
import test from 'node:test';

import router, { __testOnly__ } from './v2.js';

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

test('v2 exposes the unified text-to-interactive-video routes', () => {
  const postPaths = getRegisteredPostPaths();

  assert.ok(postPaths.includes('/text_to_interactive_video'));
  assert.ok(postPaths.includes('/external/video/text_to_interactive_video'));
  assert.ok(postPaths.includes('/text_to_interactive_video/session'));
});

test('v2 exposes metered interactive publication metadata generation', () => {
  const postPaths = getRegisteredPostPaths();

  assert.ok(postPaths.includes('/interactive_publication/generate_meta'));
});

test('interactive publication metadata requires a signed-in user auth token', () => {
  assert.doesNotThrow(() => __testOnly__.assertUserAuthTokenCredential({
    authType: 'auth_token',
  }));
  assert.throws(
    () => __testOnly__.assertUserAuthTokenCredential({ authType: 'api_key' }),
    (error) => error?.status === 403 && error?.code === 'USER_AUTH_TOKEN_REQUIRED',
  );
  assert.throws(
    () => __testOnly__.assertUserAuthTokenCredential({ authType: 'app_key' }),
    (error) => error?.status === 403 && error?.code === 'USER_AUTH_TOKEN_REQUIRED',
  );
});
