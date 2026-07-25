import fs from 'node:fs';

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

function isDockerRuntime(
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
) {
  const samsarRuntime = String(env.SAMSAR_RUNTIME || '').trim().toLowerCase();
  const currentEnv = String(env.CURRENT_ENV || '').trim().toLowerCase();
  return (
    dockerMarkerPresent
    || samsarRuntime === 'docker'
    || currentEnv === 'docker'
  );
}

export function getTaskProcessorSchedule(
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
) {
  const defaultIntervalHours = isDockerRuntime(env, dockerMarkerPresent)
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
