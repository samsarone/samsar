export const ROUTE_PRELOAD_RECOVERY_KEY = 'samsar:route-preload-recovery';
export const ROUTE_PRELOAD_RECOVERY_WINDOW_MS = 30_000;

function readRecoveryTimestamp(storage) {
  try {
    const timestamp = Number(storage?.getItem?.(ROUTE_PRELOAD_RECOVERY_KEY));
    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch {
    return 0;
  }
}

export function shouldReloadAfterPreloadError({
  storage,
  now = Date.now(),
  recoveryWindowMs = ROUTE_PRELOAD_RECOVERY_WINDOW_MS,
} = {}) {
  const recoveryTimestamp = readRecoveryTimestamp(storage);
  return !recoveryTimestamp || now - recoveryTimestamp >= recoveryWindowMs;
}

function markPreloadRecovery(storage, timestamp) {
  try {
    storage?.setItem?.(ROUTE_PRELOAD_RECOVERY_KEY, String(timestamp));
  } catch {
    // Reload recovery still works when sessionStorage is unavailable.
  }
}

export function clearPreloadRecovery(storage) {
  try {
    storage?.removeItem?.(ROUTE_PRELOAD_RECOVERY_KEY);
  } catch {
    // There is nothing else to clean up when storage is unavailable.
  }
}

/**
 * Vite emits `vite:preloadError` when a lazy route chunk can no longer be
 * downloaded, most commonly after a deployment replaced the old assets.
 * Refresh once to load the current index and chunk manifest. The timestamp
 * guard prevents a broken deployment from creating a reload loop.
 */
export function installVitePreloadErrorRecovery({
  target,
  storage,
  reload,
  now = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancelSchedule = (timer) => clearTimeout(timer),
  recoveryWindowMs = ROUTE_PRELOAD_RECOVERY_WINDOW_MS,
} = {}) {
  if (!target?.addEventListener || typeof reload !== 'function') {
    return () => {};
  }

  const handlePreloadError = (event) => {
    const timestamp = now();
    if (!shouldReloadAfterPreloadError({
      storage,
      now: timestamp,
      recoveryWindowMs,
    })) {
      return;
    }

    event?.preventDefault?.();
    markPreloadRecovery(storage, timestamp);
    reload();
  };

  target.addEventListener('vite:preloadError', handlePreloadError);
  const recoveryTimer = schedule(
    () => clearPreloadRecovery(storage),
    recoveryWindowMs
  );

  return () => {
    target.removeEventListener?.('vite:preloadError', handlePreloadError);
    cancelSchedule(recoveryTimer);
  };
}
