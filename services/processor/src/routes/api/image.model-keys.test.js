import assert from 'node:assert/strict';
import test from 'node:test';
import router from './image.js';

test('image generation API aliases return HTTP 400 for GPTIMAGE2', async () => {
  const route = router.stack.find((entry) => entry.route?.methods?.post &&
    Array.isArray(entry.route.path) && entry.route.path.includes('/text_to_image')).route;
  const handler = route.stack.at(-1).handle;
  for (const path of ['/text_to_image', '/generate', '/generations']) {
    assert.ok(route.path.includes(path));
    for (const field of ['model', 'mode']) {
      for (const nested of [false, true]) {
        const payload = { prompt: 'An anime frame', [field]: 'GPTIMAGE2' };
        let status, body;
        await handler({ path, userId: 'test-user', body: nested ? { input: payload } : payload }, {
          status(value) { status = value; return this; },
          json(value) { body = value; return this; },
        });
        assert.equal(status, 400);
        assert.equal(body.message, 'Invalid model: GPTIMAGE2. Use GPTIMAGE2.5.');
      }
    }
  }
});
