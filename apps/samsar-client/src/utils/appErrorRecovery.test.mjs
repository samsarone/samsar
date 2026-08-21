import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  APP_ERROR_REVEAL_DELAY_MS,
  shouldDelayAppErrorDisplay,
} from './appErrorRecovery.mjs';

test('delays an error caught during initial application startup', () => {
  assert.equal(shouldDelayAppErrorDisplay({
    appStartedAt: 10_000,
    errorCaughtAt: 12_000,
  }), true);
  assert.equal(APP_ERROR_REVEAL_DELAY_MS, 5_000);
});

test('shows a genuine later render error without the startup delay', () => {
  assert.equal(shouldDelayAppErrorDisplay({
    appStartedAt: 10_000,
    errorCaughtAt: 30_001,
    startupErrorWindowMs: 20_000,
  }), false);
});

test('delays a confirmed preload recovery even after startup', () => {
  assert.equal(shouldDelayAppErrorDisplay({
    appStartedAt: 10_000,
    errorCaughtAt: 60_000,
    preloadRecoveryPending: true,
  }), true);
});

test('client nginx never caches the HTML shell and permanently caches hashed assets', () => {
  const nginxConfig = fs.readFileSync(
    new URL('../../nginx.conf', import.meta.url),
    'utf8',
  );

  assert.match(nginxConfig, /location = \/index\.html/);
  assert.match(nginxConfig, /no-cache, no-store, must-revalidate/);
  assert.match(nginxConfig, /location \^~ \/assets\//);
  assert.match(nginxConfig, /max-age=31536000, immutable/);
});
