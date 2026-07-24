import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTE_PRELOAD_RECOVERY_KEY,
  installVitePreloadErrorRecovery,
  shouldReloadAfterPreloadError,
} from './routePreloadRecovery.mjs';

function createStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) {
    values.set(ROUTE_PRELOAD_RECOVERY_KEY, String(initialValue));
  }

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    dispatch(name, event) {
      listeners.get(name)?.(event);
    },
  };
}

test('a recent preload recovery suppresses another reload', () => {
  const storage = createStorage(9_000);

  assert.equal(shouldReloadAfterPreloadError({
    storage,
    now: 10_000,
    recoveryWindowMs: 30_000,
  }), false);
  assert.equal(shouldReloadAfterPreloadError({
    storage,
    now: 40_000,
    recoveryWindowMs: 30_000,
  }), true);
});

test('a Vite preload failure refreshes once and records the recovery', () => {
  const storage = createStorage();
  const target = createEventTarget();
  let reloadCount = 0;
  let prevented = false;

  const uninstall = installVitePreloadErrorRecovery({
    target,
    storage,
    reload: () => {
      reloadCount += 1;
    },
    now: () => 10_000,
    schedule: () => 1,
    cancelSchedule: () => {},
  });

  target.dispatch('vite:preloadError', {
    preventDefault() {
      prevented = true;
    },
  });
  target.dispatch('vite:preloadError', {
    preventDefault() {},
  });

  assert.equal(reloadCount, 1);
  assert.equal(prevented, true);
  assert.equal(storage.getItem(ROUTE_PRELOAD_RECOVERY_KEY), '10000');

  uninstall();
});
