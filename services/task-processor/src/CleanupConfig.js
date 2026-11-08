import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONTAINER_RUNTIMES = new Set(['docker', 'container', 'compose', 'kubernetes', 'k8s']);
export const DEFAULT_CLEANUP_MIN_AGE_HOURS = 168;
export const DEFAULT_STALE_SESSION_FRAME_CLEANUP_HOURS = 24;
export const DEFAULT_INTERMEDIATE_MEDIA_CLEANUP_HOURS = 48;
const GIB = 1024 ** 3;

function readCleanupBoolean(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean.`);
}

function readCleanupPositiveNumber(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive number no greater than ${maximum}.`);
  }
  return parsed;
}

// Keep completed-session cleanup independent of the legacy 24h/48h sweeps.
// The engine uses filesystem bavail (space available to applications), not bfree.
export function getCompletedFrameCleanupConfig(env = process.env) {
  const config = {
    enabled: readCleanupBoolean(env.FRAME_CLEANUP_ENABLED, true, 'FRAME_CLEANUP_ENABLED'),
    dryRun: readCleanupBoolean(env.FRAME_CLEANUP_DRY_RUN, false, 'FRAME_CLEANUP_DRY_RUN'),
    minCompletedAgeMs: readCleanupPositiveNumber(
      env.COMPLETED_SESSION_FRAME_CLEANUP_MINUTES, 15,
      'COMPLETED_SESSION_FRAME_CLEANUP_MINUTES', Number.MAX_SAFE_INTEGER / 60000,
    ) * 60000,
    pressureUsedPercent: readCleanupPositiveNumber(
      env.FRAME_CLEANUP_PRESSURE_USED_PERCENT, 80, 'FRAME_CLEANUP_PRESSURE_USED_PERCENT', 100,
    ),
    pressureAvailableBytes: readCleanupPositiveNumber(
      env.FRAME_CLEANUP_PRESSURE_AVAILABLE_GIB, 32, 'FRAME_CLEANUP_PRESSURE_AVAILABLE_GIB',
      Number.MAX_SAFE_INTEGER / GIB,
    ) * GIB,
    targetUsedPercent: readCleanupPositiveNumber(
      env.FRAME_CLEANUP_TARGET_USED_PERCENT, 75, 'FRAME_CLEANUP_TARGET_USED_PERCENT', 100,
    ),
    targetAvailableBytes: readCleanupPositiveNumber(
      env.FRAME_CLEANUP_TARGET_AVAILABLE_GIB, 64, 'FRAME_CLEANUP_TARGET_AVAILABLE_GIB',
      Number.MAX_SAFE_INTEGER / GIB,
    ) * GIB,
  };
  if (config.targetUsedPercent > config.pressureUsedPercent) {
    throw new Error('FRAME_CLEANUP_TARGET_USED_PERCENT must not exceed FRAME_CLEANUP_PRESSURE_USED_PERCENT.');
  }
  if (config.targetAvailableBytes < config.pressureAvailableBytes) {
    throw new Error('FRAME_CLEANUP_TARGET_AVAILABLE_GIB must be at least FRAME_CLEANUP_PRESSURE_AVAILABLE_GIB.');
  }
  return config;
}

const STAGE_RETENTION_DEFAULTS = Object.freeze({
  STALE_SESSION_FRAME_CLEANUP_HOURS: DEFAULT_STALE_SESSION_FRAME_CLEANUP_HOURS,
  INTERMEDIATE_MEDIA_CLEANUP_HOURS: DEFAULT_INTERMEDIATE_MEDIA_CLEANUP_HOURS,
});

export function isContainerRuntime(env = process.env, dockerMarkerPresent = fs.existsSync('/.dockerenv')) {
  return dockerMarkerPresent || [env.SAMSAR_RUNTIME, env.CURRENT_ENV].some(
    (value) => CONTAINER_RUNTIMES.has(String(value || '').trim().toLowerCase()),
  );
}

export function getProcessorAssetsRoot(folderName, {
  env = process.env,
  dockerMarkerPresent = fs.existsSync('/.dockerenv'),
  projectRoot = PROJECT_ROOT,
} = {}) {
  if (!['assets', 'assets_v2'].includes(folderName)) {
    throw new Error(`Unsupported processor assets folder: ${folderName}`);
  }
  const override = env[folderName === 'assets_v2' ? 'SAMSAR_ASSETS_V2_ROOT' : 'SAMSAR_ASSETS_ROOT'];
  if (override) return path.resolve(override);
  if (isContainerRuntime(env, dockerMarkerPresent)) return `/${folderName}`;

  // Resolve from the installed service, since host cron can start in any cwd.
  const processorName = path.basename(path.resolve(projectRoot)) === 'task-processor'
    ? 'processor'
    : 'samsar_processor';
  return path.resolve(projectRoot, '..', processorName, folderName);
}

export function getCleanupMinAgeHours(stageSetting, env = process.env) {
  const configuredStageValue = env[stageSetting];
  const hasStageOverride = configuredStageValue !== undefined && configuredStageValue !== '';
  const hasStageDefault = Object.hasOwn(STAGE_RETENTION_DEFAULTS, stageSetting);
  const setting = hasStageOverride || hasStageDefault ? stageSetting : 'CLEANUP_MIN_AGE_HOURS';
  const rawValue = hasStageOverride
    ? configuredStageValue
    : hasStageDefault
      ? STAGE_RETENTION_DEFAULTS[stageSetting]
      : env.CLEANUP_MIN_AGE_HOURS;
  if (rawValue === undefined || rawValue === '') return DEFAULT_CLEANUP_MIN_AGE_HOURS;
  const hours = Number(rawValue);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`${setting} must be a positive number; received "${rawValue}"`);
  }
  return hours;
}
