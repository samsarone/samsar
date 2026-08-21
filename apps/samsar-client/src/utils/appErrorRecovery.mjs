export const APP_ERROR_REVEAL_DELAY_MS = 5_000;
export const APP_STARTUP_ERROR_WINDOW_MS = 15_000;

export function shouldDelayAppErrorDisplay({
  appStartedAt,
  errorCaughtAt = Date.now(),
  preloadRecoveryPending = false,
  startupErrorWindowMs = APP_STARTUP_ERROR_WINDOW_MS,
} = {}) {
  if (preloadRecoveryPending) return true;
  if (!Number.isFinite(appStartedAt) || !Number.isFinite(errorCaughtAt)) return false;

  return errorCaughtAt - appStartedAt <= startupErrorWindowMs;
}
