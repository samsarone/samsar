import assert from 'node:assert/strict';
import test from 'node:test';
import { getCleanupMinAgeHours, getCompletedFrameCleanupConfig, getProcessorAssetsRoot } from '../src/CleanupConfig.js';
import { getTaskProcessorSchedule } from '../src/TaskScheduler.js';

test('hosted and standalone containers use mounted media paths and recurring maintenance', () => {
  for (const runtime of ['docker', 'container', 'compose', 'kubernetes', 'k8s']) {
    for (const edition of ['production', 'standalone']) {
      const env = { SAMSAR_RUNTIME: runtime, CURRENT_ENV: edition };
      for (const folder of ['assets', 'assets_v2']) {
        assert.equal(getProcessorAssetsRoot(folder, { env, dockerMarkerPresent: false }), `/${folder}`);
      }
      assert.equal(getTaskProcessorSchedule(env, false).intervalMs, 3 * 3600000);
    }
  }
  assert.equal(getProcessorAssetsRoot('assets_v2', { env: {}, dockerMarkerPresent: true }), '/assets_v2');
});

test('native cron paths follow the installed sources, independent of its working directory', () => {
  for (const [projectRoot, expectedRoot] of [
    ['/srv/workspace/samsar_task_processor', '/srv/workspace/samsar_processor'],
    ['/srv/samsar/services/task-processor', '/srv/samsar/services/processor'],
  ]) {
    for (const folder of ['assets', 'assets_v2']) {
      assert.equal(getProcessorAssetsRoot(folder, {
        env: {}, dockerMarkerPresent: false, projectRoot,
      }), `${expectedRoot}/${folder}`);
    }
  }
});

test('explicit media roots override native and container defaults', () => {
  for (const dockerMarkerPresent of [true, false]) {
    const options = { env: { SAMSAR_ASSETS_ROOT: '/mnt/assets', SAMSAR_ASSETS_V2_ROOT: '/mnt/assets_v2' }, dockerMarkerPresent };
    assert.equal(getProcessorAssetsRoot('assets', options), '/mnt/assets');
    assert.equal(getProcessorAssetsRoot('assets_v2', options), '/mnt/assets_v2');
  }
});

test('frame and intermediate-media retention use stage defaults despite the legacy global setting', () => {
  for (const [setting, defaultHours] of [
    ['STALE_SESSION_FRAME_CLEANUP_HOURS', 24],
    ['INTERMEDIATE_MEDIA_CLEANUP_HOURS', 48],
  ]) {
    assert.equal(getCleanupMinAgeHours(setting, {}), defaultHours);
    assert.equal(getCleanupMinAgeHours(setting, { CLEANUP_MIN_AGE_HOURS: '168' }), defaultHours);
    assert.equal(getCleanupMinAgeHours(setting, { CLEANUP_MIN_AGE_HOURS: '72', [setting]: '' }), defaultHours);
    assert.equal(getCleanupMinAgeHours(setting, { CLEANUP_MIN_AGE_HOURS: '72', [setting]: '96' }), 96);
    for (const value of ['invalid', '24hours', '0', '-1', 'Infinity']) {
      assert.throws(() => getCleanupMinAgeHours(setting, { [setting]: value }), /positive number/);
    }
  }
});

test('other cleanup stages retain the shared global fallback', () => {
  assert.equal(getCleanupMinAgeHours('OTHER_CLEANUP_HOURS', {}), 168);
  assert.equal(getCleanupMinAgeHours('OTHER_CLEANUP_HOURS', { CLEANUP_MIN_AGE_HOURS: '72' }), 72);
  assert.equal(getCleanupMinAgeHours('OTHER_CLEANUP_HOURS', { CLEANUP_MIN_AGE_HOURS: '72', OTHER_CLEANUP_HOURS: '96' }), 96);
  assert.throws(() => getCleanupMinAgeHours('OTHER_CLEANUP_HOURS', { CLEANUP_MIN_AGE_HOURS: '0' }), /positive number/);
});

test('completed-frame defaults use a short grace and disk-pressure hysteresis independently of legacy retention', () => {
  const expected = {
    enabled: true,
    dryRun: false,
    minCompletedAgeMs: 15 * 60000,
    pressureUsedPercent: 80,
    pressureAvailableBytes: 32 * 1024 ** 3,
    targetUsedPercent: 75,
    targetAvailableBytes: 64 * 1024 ** 3,
  };
  assert.deepEqual(getCompletedFrameCleanupConfig({}), expected);
  assert.deepEqual(getCompletedFrameCleanupConfig({ CLEANUP_MIN_AGE_HOURS: '168' }), expected);
});

test('completed-frame policy accepts explicit controls without changing the safety threshold units', () => {
  assert.deepEqual(getCompletedFrameCleanupConfig({
    FRAME_CLEANUP_ENABLED: 'false',
    FRAME_CLEANUP_DRY_RUN: 'true',
    COMPLETED_SESSION_FRAME_CLEANUP_MINUTES: '30',
    FRAME_CLEANUP_PRESSURE_USED_PERCENT: '90',
    FRAME_CLEANUP_PRESSURE_AVAILABLE_GIB: '16',
    FRAME_CLEANUP_TARGET_USED_PERCENT: '70',
    FRAME_CLEANUP_TARGET_AVAILABLE_GIB: '48',
  }), {
    enabled: false, dryRun: true, minCompletedAgeMs: 30 * 60000,
    pressureUsedPercent: 90, pressureAvailableBytes: 16 * 1024 ** 3,
    targetUsedPercent: 70, targetAvailableBytes: 48 * 1024 ** 3,
  });
  for (const value of ['false', '0', 'no', 'OFF', false]) {
    assert.equal(getCompletedFrameCleanupConfig({ FRAME_CLEANUP_ENABLED: value }).enabled, false);
  }
  for (const value of ['true', '1', 'yes', 'ON', true]) {
    assert.equal(getCompletedFrameCleanupConfig({ FRAME_CLEANUP_DRY_RUN: value }).dryRun, true);
  }
});

test('invalid completed-frame controls fail closed instead of weakening the configured policy', () => {
  for (const key of ['FRAME_CLEANUP_ENABLED', 'FRAME_CLEANUP_DRY_RUN']) {
    assert.throws(() => getCompletedFrameCleanupConfig({ [key]: 'maybe' }), /must be a boolean/);
  }
  for (const key of [
    'COMPLETED_SESSION_FRAME_CLEANUP_MINUTES',
    'FRAME_CLEANUP_PRESSURE_AVAILABLE_GIB',
    'FRAME_CLEANUP_TARGET_AVAILABLE_GIB',
    'FRAME_CLEANUP_PRESSURE_USED_PERCENT',
    'FRAME_CLEANUP_TARGET_USED_PERCENT',
  ]) {
    for (const value of ['invalid', '15minutes', '0', '-1', 'Infinity']) {
      assert.throws(() => getCompletedFrameCleanupConfig({ [key]: value }), /positive number/);
    }
  }
  assert.throws(() => getCompletedFrameCleanupConfig({ FRAME_CLEANUP_PRESSURE_USED_PERCENT: '101' }), /positive number/);
  assert.throws(() => getCompletedFrameCleanupConfig({ FRAME_CLEANUP_TARGET_USED_PERCENT: '81' }), /must not exceed/);
  assert.throws(() => getCompletedFrameCleanupConfig({ FRAME_CLEANUP_TARGET_AVAILABLE_GIB: '31' }), /must be at least/);
});
