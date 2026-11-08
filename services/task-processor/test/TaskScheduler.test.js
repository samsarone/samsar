import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFrameCleanupSchedule,
  runTaskProcessorMaintenance,
  runTaskProcessorSchedule,
} from '../src/TaskScheduler.js';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const logger = { log() {}, error() {} };

function clock() {
  let current = 0;
  const sleeps = [];
  return {
    now: () => current,
    sleep: async milliseconds => { sleeps.push(milliseconds); current += milliseconds; },
    advance: milliseconds => { current += milliseconds; },
    sleeps,
  };
}

test('Docker fast cleanup runs every five minutes while full maintenance retains its three-hour cadence', async () => {
  const time = clock();
  const maintenance = [], cleanup = [];
  const result = await runTaskProcessorMaintenance({
    runTask: async () => { maintenance.push(time.now()); },
    runFrameCleanup: async () => { cleanup.push(time.now()); },
    env: { SAMSAR_RUNTIME: 'docker' }, dockerMarkerPresent: false,
    now: time.now, sleep: time.sleep, logger, maxIterations: 39,
  });
  assert.deepEqual(maintenance, [0, 3 * HOUR]);
  assert.equal(cleanup.length, 37);
  assert.deepEqual(cleanup, Array.from({ length: 37 }, (_, index) => index * 5 * MINUTE));
  assert.deepEqual(result, {
    iterations: 39, recurring: true, maintenanceIterations: 2, frameCleanupIterations: 37,
  });
});

test('cleanup and maintenance never overlap even when a running task spans multiple cleanup deadlines', async () => {
  const time = clock();
  let releaseCleanup, releaseMaintenance;
  const cleanupPending = new Promise(resolve => { releaseCleanup = resolve; });
  const maintenancePending = new Promise(resolve => { releaseMaintenance = resolve; });
  const events = [];
  let active = 0, cleanupRuns = 0;
  const running = runTaskProcessorMaintenance({
    runFrameCleanup: async () => {
      assert.equal(active++, 0);
      events.push(['cleanup-start', time.now()]);
      if (++cleanupRuns === 1) await cleanupPending;
      events.push(['cleanup-end', time.now()]);
      active--;
    },
    runTask: async () => {
      assert.equal(active++, 0);
      events.push(['maintenance-start', time.now()]);
      await maintenancePending;
      events.push(['maintenance-end', time.now()]);
      active--;
    },
    env: { SAMSAR_RUNTIME: 'docker' }, dockerMarkerPresent: false,
    now: time.now, sleep: time.sleep, logger, maxIterations: 3,
  });
  await new Promise(setImmediate);
  assert.deepEqual(events, [['cleanup-start', 0]]);
  time.advance(2 * MINUTE);
  releaseCleanup();
  await new Promise(setImmediate);
  assert.deepEqual(events.at(-1), ['maintenance-start', 2 * MINUTE]);
  time.advance(16 * MINUTE);
  assert.equal(cleanupRuns, 1);
  releaseMaintenance();
  await running;
  assert.deepEqual(events, [
    ['cleanup-start', 0], ['cleanup-end', 2 * MINUTE],
    ['maintenance-start', 2 * MINUTE], ['maintenance-end', 18 * MINUTE],
    ['cleanup-start', 18 * MINUTE], ['cleanup-end', 18 * MINUTE],
  ]);
  assert.equal(active, 0);
});

test('failed cleanup retries after one minute without accelerating full maintenance', async () => {
  const time = clock();
  const cleanup = [], maintenance = [], errors = [];
  const result = await runTaskProcessorMaintenance({
    runFrameCleanup: async () => {
      cleanup.push(time.now());
      if (cleanup.length === 1) throw new Error('temporary database outage');
    },
    runTask: async () => { maintenance.push(time.now()); },
    env: { SAMSAR_RUNTIME: 'docker' }, dockerMarkerPresent: false,
    now: time.now, sleep: time.sleep,
    logger: { log() {}, error: message => errors.push(message) }, maxIterations: 4,
  });
  assert.deepEqual(cleanup, [0, MINUTE, 6 * MINUTE]);
  assert.deepEqual(maintenance, [0]);
  assert.equal(result.frameCleanupIterations, 3);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Completed-frame cleanup run failed; retrying after 1 minute/);
});

test('full maintenance retries keep their existing five-minute delay independently of fast cleanup', async () => {
  const time = clock();
  const cleanup = [], maintenance = [];
  await runTaskProcessorMaintenance({
    runFrameCleanup: async () => { cleanup.push(time.now()); },
    runTask: async () => {
      maintenance.push(time.now());
      if (maintenance.length === 1) throw new Error('maintenance unavailable');
    },
    env: { SAMSAR_RUNTIME: 'docker' }, dockerMarkerPresent: false,
    now: time.now, sleep: time.sleep, logger, maxIterations: 4,
  });
  assert.deepEqual(cleanup, [0, 5 * MINUTE]);
  assert.deepEqual(maintenance, [0, 5 * MINUTE]);
});

test('disabled file cleanup or disabled fast cleanup preserves the legacy full-maintenance schedule', async () => {
  for (const options of [
    { fileCleanupEnabled: false, env: { SAMSAR_RUNTIME: 'docker' } },
    { env: { SAMSAR_RUNTIME: 'docker', TASK_PROCESSOR_ENABLE_FILE_CLEANUP: 'false' } },
    { env: { SAMSAR_RUNTIME: 'docker', FRAME_CLEANUP_ENABLED: 'false' } },
  ]) {
    const time = clock();
    const maintenance = [];
    const result = await runTaskProcessorMaintenance({
      runTask: async () => { maintenance.push(time.now()); },
      runFrameCleanup: async () => { assert.fail('disabled cleanup ran'); },
      ...options, dockerMarkerPresent: false,
      now: time.now, sleep: time.sleep, logger, maxIterations: 2,
    });
    assert.deepEqual(maintenance, [0, 3 * HOUR]);
    assert.deepEqual(result, { iterations: 2, recurring: true });
  }
});

test('native cron retains a single maintenance run without starting the fast cleanup loop', async () => {
  let calls = 0;
  const result = await runTaskProcessorMaintenance({
    runTask: async () => { calls++; },
    runFrameCleanup: async () => { assert.fail('native fast cleanup ran'); },
    env: {}, dockerMarkerPresent: false,
    sleep: async () => { assert.fail('native cron must not sleep'); }, logger,
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { iterations: 1, recurring: false });
});

test('native cron retains its failure exit behavior and existing optional recurring override', async () => {
  const failure = new Error('native cleanup failed');
  await assert.rejects(runTaskProcessorMaintenance({
    runTask: async () => { throw failure; }, env: {}, dockerMarkerPresent: false, logger,
  }), error => error === failure);
  const time = clock();
  let calls = 0;
  await runTaskProcessorMaintenance({
    runTask: async () => { calls++; },
    env: { TASK_PROCESSOR_INTERVAL_HOURS: '2' }, dockerMarkerPresent: false,
    sleep: time.sleep, logger, maxIterations: 2,
  });
  assert.equal(calls, 2);
  assert.deepEqual(time.sleeps, [2 * HOUR]);
});

test('fast cleanup cadence is configurable and rejects invalid or overflowing timer delays', () => {
  assert.deepEqual(getFrameCleanupSchedule({}), { intervalMs: 5 * MINUTE, retryMs: MINUTE });
  assert.deepEqual(getFrameCleanupSchedule({
    FRAME_CLEANUP_INTERVAL_MINUTES: '2', FRAME_CLEANUP_RETRY_MINUTES: '0.5',
  }), { intervalMs: 2 * MINUTE, retryMs: MINUTE / 2 });
  for (const key of ['FRAME_CLEANUP_INTERVAL_MINUTES', 'FRAME_CLEANUP_RETRY_MINUTES']) {
    for (const value of ['0', '-1', 'invalid', 'Infinity', '1e100']) {
      assert.throws(() => getFrameCleanupSchedule({ [key]: value }));
    }
  }
});

test('legacy runTaskProcessorSchedule callers keep their return shape and retry behavior', async () => {
  const time = clock();
  let calls = 0;
  const result = await runTaskProcessorSchedule({
    runTask: async () => { if (++calls === 1) throw new Error('retry'); },
    env: { SAMSAR_RUNTIME: 'docker' }, dockerMarkerPresent: false,
    sleep: time.sleep, logger, maxIterations: 2,
  });
  assert.equal(calls, 2);
  assert.deepEqual(time.sleeps, [5 * MINUTE]);
  assert.deepEqual(result, { iterations: 2, recurring: true });
});
