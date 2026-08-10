import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __testOnly__,
  cleanupOldLocalAssetsV2Media,
  isTaskProcessorFileCleanupEnabled,
  isTaskProcessorGenerationSideEffectsEnabled,
} from '../src/TaskProcessor.js';
import {
  getTaskProcessorSchedule,
  runTaskProcessorSchedule,
} from '../src/TaskScheduler.js';

test('generation side effects preserve legacy behavior outside Docker', () => {
  assert.equal(
    isTaskProcessorGenerationSideEffectsEnabled(
      { CURRENT_ENV: 'production' },
      false,
    ),
    true,
  );
  assert.equal(
    isTaskProcessorGenerationSideEffectsEnabled(
      {
        CURRENT_ENV: 'production',
        TASK_PROCESSOR_ENABLE_GENERATION_SIDE_EFFECTS: 'false',
      },
      false,
    ),
    false,
  );
});

test('generation side effects fail closed in Docker unless explicitly enabled', () => {
  assert.equal(
    isTaskProcessorGenerationSideEffectsEnabled(
      { SAMSAR_RUNTIME: 'docker' },
      false,
    ),
    false,
  );
  assert.equal(
    isTaskProcessorGenerationSideEffectsEnabled(
      { CURRENT_ENV: 'docker' },
      false,
    ),
    false,
  );
  assert.equal(
    isTaskProcessorGenerationSideEffectsEnabled(
      { CURRENT_ENV: 'production' },
      true,
    ),
    false,
  );
  assert.equal(
    isTaskProcessorGenerationSideEffectsEnabled(
      {
        CURRENT_ENV: 'production',
        TASK_PROCESSOR_ENABLE_GENERATION_SIDE_EFFECTS: 'true',
      },
      true,
    ),
    true,
  );
  assert.equal(
    isTaskProcessorGenerationSideEffectsEnabled(
      {
        CURRENT_ENV: 'production',
        TASK_PROCESSOR_ENABLE_GENERATION_SIDE_EFFECTS: 'invalid',
      },
      true,
    ),
    false,
  );
});

test('safe file cleanup is enabled by default in Docker and remains overridable', () => {
  assert.equal(
    isTaskProcessorFileCleanupEnabled(
      { CURRENT_ENV: 'production' },
      false,
    ),
    true,
  );
  assert.equal(
    isTaskProcessorFileCleanupEnabled(
      { SAMSAR_RUNTIME: 'docker' },
      false,
    ),
    true,
  );
  assert.equal(
    isTaskProcessorFileCleanupEnabled(
      { CURRENT_ENV: 'production' },
      true,
    ),
    true,
  );
  assert.equal(
    isTaskProcessorFileCleanupEnabled(
      {
        CURRENT_ENV: 'production',
        TASK_PROCESSOR_ENABLE_FILE_CLEANUP: 'true',
      },
      true,
    ),
    true,
  );
  assert.equal(
    isTaskProcessorFileCleanupEnabled(
      {
        CURRENT_ENV: 'production',
        TASK_PROCESSOR_ENABLE_FILE_CLEANUP: 'false',
      },
      false,
    ),
    false,
  );
});

test('disabled file cleanup skips both maintenance tasks', async () => {
  const calls = [];

  const ran = await __testOnly__.runFileCleanupTasksIfEnabled(
    false,
    async () => calls.push('assets-v2'),
    async () => calls.push('stale-frames'),
  );

  assert.equal(ran, false);
  assert.deepEqual(calls, []);
});

test('enabled file cleanup runs both maintenance tasks in order', async () => {
  const calls = [];

  const ran = await __testOnly__.runFileCleanupTasksIfEnabled(
    true,
    async () => calls.push('assets-v2'),
    async () => calls.push('stale-frames'),
  );

  assert.equal(ran, true);
  assert.deepEqual(calls, ['assets-v2', 'stale-frames']);
});

test('stale-session query uses an id-only lean cursor with a bounded batch', () => {
  const calls = [];
  const expectedCursor = { name: 'bounded-cursor' };
  const query = {
    select(projection) {
      calls.push(['select', projection]);
      return this;
    },
    lean() {
      calls.push(['lean']);
      return this;
    },
    batchSize(value) {
      calls.push(['batchSize', value]);
      return this;
    },
    cursor() {
      calls.push(['cursor']);
      return expectedCursor;
    },
  };
  const model = {
    find(filter) {
      calls.push(['find', filter]);
      return query;
    },
  };
  const staleBefore = new Date('2026-07-01T00:00:00.000Z');

  const cursor = __testOnly__.createStaleVideoSessionCursor(
    model,
    staleBefore,
    64,
  );

  assert.equal(cursor, expectedCursor);
  assert.deepEqual(calls, [
    [
      'find',
      {
        updatedAt: { $lt: staleBefore },
        isGuestSession: false,
        isIntroSession: false,
      },
    ],
    ['select', { _id: 1 }],
    ['lean'],
    ['batchSize', 64],
    ['cursor'],
  ]);
});

test('frame regeneration flags are updated in place without replacing layers', async () => {
  const updates = [];
  const model = {
    async updateOne(filter, update) {
      updates.push({ filter, update });
    },
  };

  await __testOnly__.markSessionFramesForRegeneration('session-1', model);

  assert.deepEqual(updates, [
    {
      filter: { _id: 'session-1' },
      update: { $set: { frameGenerationPending: true } },
    },
    {
      filter: { _id: 'session-1', 'layers.0': { $exists: true } },
      update: { $set: { 'layers.$[].frameGenerationPending': true } },
    },
  ]);
  assert.equal(
    Object.hasOwn(updates[1].update.$set, 'layers'),
    false,
  );
});

test('intermediate media cleanup never sweeps final or user resources', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-task-cleanup-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const temporaryRender = path.join(assetsV2Root, 'ai_video', 'temp', 'old.png');
  const finalRender = path.join(assetsV2Root, 'video', 'output', 'session', 'final.mp4');
  const userResource = path.join(assetsV2Root, 'user_resources', 'user', 'video.mp4');
  const oldTime = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const previousRoot = process.env.SAMSAR_ASSETS_V2_ROOT;
  const previousCleanupHours = process.env.INTERMEDIATE_MEDIA_CLEANUP_HOURS;
  const previousCronLogPath = process.env.TASK_PROCESSOR_CRON_LOG_PATH;

  try {
    for (const filePath of [temporaryRender, finalRender, userResource]) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'media');
      await fs.utimes(filePath, oldTime, oldTime);
    }

    process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
    process.env.INTERMEDIATE_MEDIA_CLEANUP_HOURS = '4';
    process.env.TASK_PROCESSOR_CRON_LOG_PATH = path.join(tempRoot, 'cronTabs.log');
    const counters = await cleanupOldLocalAssetsV2Media();

    await assert.rejects(fs.stat(temporaryRender), { code: 'ENOENT' });
    await fs.stat(finalRender);
    await fs.stat(userResource);
    assert.equal(counters.deletedFiles, 1);
  } finally {
    if (previousRoot === undefined) delete process.env.SAMSAR_ASSETS_V2_ROOT;
    else process.env.SAMSAR_ASSETS_V2_ROOT = previousRoot;
    if (previousCleanupHours === undefined) delete process.env.INTERMEDIATE_MEDIA_CLEANUP_HOURS;
    else process.env.INTERMEDIATE_MEDIA_CLEANUP_HOURS = previousCleanupHours;
    if (previousCronLogPath === undefined) delete process.env.TASK_PROCESSOR_CRON_LOG_PATH;
    else process.env.TASK_PROCESSOR_CRON_LOG_PATH = previousCronLogPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('task processor remains one shot outside Docker and recurs every three hours in Docker', () => {
  assert.deepEqual(getTaskProcessorSchedule({}, false), {
    recurring: false,
    intervalMs: 0,
    retryMs: 5 * 60 * 1000,
  });
  assert.deepEqual(
    getTaskProcessorSchedule({ SAMSAR_RUNTIME: 'docker' }, false),
    {
      recurring: true,
      intervalMs: 3 * 60 * 60 * 1000,
      retryMs: 5 * 60 * 1000,
    },
  );
  assert.deepEqual(
    getTaskProcessorSchedule(
      {
        TASK_PROCESSOR_INTERVAL_HOURS: '6',
        TASK_PROCESSOR_RETRY_MINUTES: '7',
      },
      false,
    ),
    {
      recurring: true,
      intervalMs: 6 * 60 * 60 * 1000,
      retryMs: 7 * 60 * 1000,
    },
  );
});

test('recurring task processor retries a failed run and remains scheduled', async () => {
  const calls = [];
  const delays = [];
  const logger = {
    log(message) {
      calls.push(['log', message]);
    },
    error(message) {
      calls.push(['error', message]);
    },
  };
  let runCount = 0;

  const result = await runTaskProcessorSchedule({
    env: {
      TASK_PROCESSOR_INTERVAL_HOURS: '3',
      TASK_PROCESSOR_RETRY_MINUTES: '5',
    },
    maxIterations: 2,
    logger,
    sleep: async (milliseconds) => delays.push(milliseconds),
    runTask: async () => {
      runCount += 1;
      if (runCount === 1) {
        throw new Error('temporary database outage');
      }
    },
  });

  assert.deepEqual(result, { iterations: 2, recurring: true });
  assert.equal(runCount, 2);
  assert.deepEqual(delays, [5 * 60 * 1000]);
  assert.equal(calls.some(([level]) => level === 'error'), true);
});
