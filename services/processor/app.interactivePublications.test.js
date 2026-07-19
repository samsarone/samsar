import assert from 'node:assert/strict';
import test from 'node:test';

import app from './app.js';

test('app mounts public interactive publication feeds without authentication wrappers', () => {
  const mountedRouterPatterns = app._router.stack
    .filter((layer) => layer.name === 'router')
    .map((layer) => layer.regexp.toString());

  assert.equal(
    mountedRouterPatterns.includes('/^\\/interactive_publications\\/?(?=\\/|$)/i'),
    true,
  );
  assert.equal(
    mountedRouterPatterns.includes('/^\\/v1\\/interactive_publications\\/?(?=\\/|$)/i'),
    true,
  );
});
