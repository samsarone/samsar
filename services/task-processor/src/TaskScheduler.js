import fs from 'node:fs';
import { getCompletedFrameCleanupConfig, isContainerRuntime } from './CleanupConfig.js';

const DEFAULT_DOCKER_INTERVAL_HOURS = 3;
const DEFAULT_RETRY_MINUTES = 5;

function parsePositiveNumber(value, fallbackValue, name) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive number; received "${value}"`);
  }
  return parsedValue;
}

export function getTaskProcessorSchedule(
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
) {
  const defaultIntervalHours = isContainerRuntime(env, dockerMarkerPresent)
    ? DEFAULT_DOCKER_INTERVAL_HOURS
    : 0;
  const intervalHours = parsePositiveNumber(
    env.TASK_PROCESSOR_INTERVAL_HOURS,
    defaultIntervalHours,
    'TASK_PROCESSOR_INTERVAL_HOURS',
  );
  const retryMinutes = parsePositiveNumber(
    env.TASK_PROCESSOR_RETRY_MINUTES,
    DEFAULT_RETRY_MINUTES,
    'TASK_PROCESSOR_RETRY_MINUTES',
  );

  return {
    recurring: intervalHours > 0,
    intervalMs: intervalHours * 60 * 60 * 1000,
    retryMs: retryMinutes * 60 * 1000,
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runTaskProcessorSchedule({
  runTask,
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
  sleep = wait,
  logger = console,
  maxIterations = Number.POSITIVE_INFINITY,
} = {}) {
  if (typeof runTask !== 'function') {
    throw new Error('runTask must be a function');
  }

  const schedule = getTaskProcessorSchedule(env, dockerMarkerPresent);
  if (!schedule.recurring) {
    await runTask();
    return { iterations: 1, recurring: false };
  }

  logger.log(
    `[task-processor] Scheduled maintenance every ${schedule.intervalMs / 3600000} hour(s); retrying failed runs after ${schedule.retryMs / 60000} minute(s).`,
  );

  let iterations = 0;
  while (iterations < maxIterations) {
    let nextDelayMs = schedule.intervalMs;
    try {
      await runTask();
      logger.log(`[task-processor] Maintenance run completed at ${new Date().toISOString()}`);
    } catch (error) {
      nextDelayMs = schedule.retryMs;
      logger.error(
        `[task-processor] Maintenance run failed; continuing after retry delay: ${error?.stack || error?.message || error}`,
      );
    }

    iterations += 1;
    if (iterations < maxIterations) {
      await sleep(nextDelayMs);
    }
  }

  return { iterations, recurring: true };
}

export function getFrameCleanupSchedule(env = process.env) {
  const readDelay = (key, fallback) => {
    const delayMs = parsePositiveNumber(env[key], fallback, key) * 60000;
    if (!Number.isFinite(delayMs) || delayMs > 2147483647) {
      throw new Error(`${key} exceeds the maximum scheduler delay.`);
    }
    return delayMs;
  };
  return {
    intervalMs: readDelay('FRAME_CLEANUP_INTERVAL_MINUTES', 5),
    retryMs: readDelay('FRAME_CLEANUP_RETRY_MINUTES', 1),
  };
}

// One dispatcher owns both deadlines. Awaiting each operation prevents the fast
// cleanup from overlapping itself or a full maintenance run, even during retries.
export async function runTaskProcessorMaintenance({
  runTask,
  runFrameCleanup,
  fileCleanupEnabled,
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
  sleep = wait,
  now = Date.now,
  logger = console,
  maxIterations = Number.POSITIVE_INFINITY,
} = {}) {
  if (typeof runTask !== 'function') throw new Error('runTask must be a function');
  if (fileCleanupEnabled !== undefined && typeof fileCleanupEnabled !== 'boolean') {
    throw new Error('fileCleanupEnabled must be a boolean');
  }
  const configuredFileCleanup = env.TASK_PROCESSOR_ENABLE_FILE_CLEANUP;
  const allowFileCleanup = fileCleanupEnabled ?? (
    configuredFileCleanup === undefined || configuredFileCleanup === '' ||
    String(configuredFileCleanup).trim().toLowerCase() === 'true'
  );

  // Preserve native cron's one-shot behavior, including its existing optional
  // maintenance interval, and the legacy scheduler API when cleanup is disabled.
  if (!isContainerRuntime(env, dockerMarkerPresent) || !allowFileCleanup ||
      !getCompletedFrameCleanupConfig(env).enabled) {
    return runTaskProcessorSchedule({ runTask, env, dockerMarkerPresent, sleep, logger, maxIterations });
  }
  if (typeof runFrameCleanup !== 'function') throw new Error('runFrameCleanup must be a function');

  const maintenance = getTaskProcessorSchedule(env, dockerMarkerPresent);
  const frameCleanup = getFrameCleanupSchedule(env);
  const dueAt = { cleanup: now(), maintenance: now() };
  const counts = { cleanup: 0, maintenance: 0 };
  let iterations = 0;
  logger.log(
    `[task-processor] Completed-frame cleanup every ${frameCleanup.intervalMs / 60000} minute(s), retry ${frameCleanup.retryMs / 60000} minute(s); full maintenance every ${maintenance.intervalMs / 3600000} hour(s).`,
  );

  while (iterations < maxIterations) {
    // Cleanup wins a tie so startup can release disposable frames before the
    // database-backed full sweep. Each task retains its own completion cadence.
    const job = dueAt.cleanup <= dueAt.maintenance ? 'cleanup' : 'maintenance';
    const delay = dueAt[job] - now();
    if (delay > 0) {
      await sleep(delay);
      continue;
    }
    const schedule = job === 'cleanup' ? frameCleanup : maintenance;
    let nextDelay = schedule.intervalMs;
    try {
      await (job === 'cleanup' ? runFrameCleanup() : runTask());
      logger.log(`[task-processor] ${job === 'cleanup' ? 'Completed-frame cleanup' : 'Maintenance'} run completed at ${new Date(now()).toISOString()}`);
    } catch (error) {
      nextDelay = schedule.retryMs;
      logger.error(
        `[task-processor] ${job === 'cleanup' ? 'Completed-frame cleanup' : 'Maintenance'} run failed; retrying after ${nextDelay / 60000} minute(s): ${error?.stack || error?.message || error}`,
      );
    }
    dueAt[job] = now() + nextDelay;
    counts[job] += 1;
    iterations += 1;
  }
  return {
    iterations,
    recurring: true,
    maintenanceIterations: counts.maintenance,
    frameCleanupIterations: counts.cleanup,
  };
}
