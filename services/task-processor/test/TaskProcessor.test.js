import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __testOnly__,
  cleanupOldLocalAssetsV2Media,
  cleanupCompletedSessionFramesTask,
  deleteFramesForStaleSessions,
  isTaskProcessorFileCleanupEnabled,
  isTaskProcessorGenerationSideEffectsEnabled,
} from '../src/TaskProcessor.js';
import {
  getTaskProcessorSchedule,
  runTaskProcessorSchedule,
} from '../src/TaskScheduler.js';

test('container full maintenance uses the completed-session guard instead of legacy deletion', async () => {
  const env = { SAMSAR_RUNTIME: 'docker' };
  let calls = 0;
  const result = await deleteFramesForStaleSessions({
    env,
    completedFrameCleanupTask: async (options) => {
      assert.equal(options.env, env);
      calls++;
      return { skippedActive: 1 };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { skippedActive: 1 });
});

test('disabled completed-frame cleanup never queries session state', async () => {
  const result = await cleanupCompletedSessionFramesTask({
    env: { TASK_PROCESSOR_ENABLE_FILE_CLEANUP: 'false' },
    loadSessionState: async () => { throw new Error('should not query'); },
  });
  assert.deepEqual(result, { disabled: true });
});

test('a full disk cannot make maintenance log appends crash the runner', (t) => {
  const messages = [];
  t.mock.method(fsSync, 'appendFileSync', () => {
    throw Object.assign(new Error('No space left on device'), { code: 'ENOSPC' });
  });
  t.mock.method(console, 'error', (...args) => messages.push(args));
  assert.doesNotThrow(() => __testOnly__.appendMaintenanceLog('/unwritable/log', 'message'));
  assert.equal(messages[0][1].code, 'ENOSPC');
});

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

test('old sessions keep frame directories containing recent files or directories', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-frame-age-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const nowMs = Date.parse('2026-10-22T00:00:00.000Z');
  const cutoffTimeMs = nowMs - 24 * 3600000;
  const oldTime = new Date(nowMs - 25 * 3600000);
  const recentTime = new Date(nowMs - 23 * 3600000);
  const cases = [
    ['old', oldTime, oldTime, oldTime],
    ['recent-file', oldTime, oldTime, recentTime],
    ['recent-nested-directory', oldTime, recentTime, oldTime],
    ['recent-session-directory', recentTime, oldTime, oldTime],
  ];
  for (const [name, sessionTime, layerTime, fileTime] of cases) {
    const sessionPath = path.join(tempRoot, name);
    const layerPath = path.join(sessionPath, 'layer');
    const framePath = path.join(layerPath, '0.png');
    await fs.mkdir(layerPath, { recursive: true });
    await fs.writeFile(framePath, 'frame');
    await fs.utimes(framePath, fileTime, fileTime);
    await fs.utimes(layerPath, layerTime, layerTime);
    await fs.utimes(sessionPath, sessionTime, sessionTime);
  }
  const symlinkedSession = path.join(tempRoot, 'symlinked-session');
  await fs.mkdir(symlinkedSession);
  await fs.symlink(path.join(tempRoot, 'old/layer/0.png'), path.join(symlinkedSession, '0.png'));
  await fs.utimes(symlinkedSession, oldTime, oldTime);
  const missingSession = path.join(tempRoot, 'missing-session');

  assert.deepEqual(
    await __testOnly__.findEligibleFramePaths(
      cases.map(([name]) => path.join(tempRoot, name)).concat(symlinkedSession, missingSession),
      cutoffTimeMs,
    ),
    [path.join(tempRoot, 'old')],
  );
  await fs.stat(path.join(tempRoot, 'recent-file/layer/0.png'));
});

test('intermediate media cleanup never sweeps final or user resources', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-task-cleanup-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  const temporaryRender = path.join(assetsV2Root, 'ai_video', 'temp', 'old.png');
  const legacyTemporaryRender = path.join(assetsRoot, 'ai_video', 'temp', 'old.png');
  const finalRender = path.join(assetsV2Root, 'video', 'output', 'session', 'final.mp4');
  const legacyFinalRender = path.join(assetsRoot, 'video', 'output', 'session', 'final.mp4');
  const linkedFinalRender = path.join(assetsRoot, 'ai_video', 'temp', 'final-link.mp4');
  const userResource = path.join(assetsV2Root, 'user_resources', 'user', 'video.mp4');
  const legacyUserResource = path.join(assetsRoot, 'user_resources', 'user', 'video.mp4');
  const oldTime = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const previousRoot = process.env.SAMSAR_ASSETS_V2_ROOT;
  const previousLegacyRoot = process.env.SAMSAR_ASSETS_ROOT;
  const previousCleanupHours = process.env.INTERMEDIATE_MEDIA_CLEANUP_HOURS;
  const previousCronLogPath = process.env.TASK_PROCESSOR_CRON_LOG_PATH;

  try {
    for (const filePath of [
      temporaryRender, legacyTemporaryRender,
      finalRender, legacyFinalRender,
      userResource, legacyUserResource,
    ]) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'media');
      await fs.utimes(filePath, oldTime, oldTime);
    }
    await fs.symlink(legacyFinalRender, linkedFinalRender);

    process.env.SAMSAR_ASSETS_V2_ROOT = assetsV2Root;
    process.env.SAMSAR_ASSETS_ROOT = assetsRoot;
    process.env.INTERMEDIATE_MEDIA_CLEANUP_HOURS = '4';
    process.env.TASK_PROCESSOR_CRON_LOG_PATH = path.join(tempRoot, 'cronTabs.log');
    const counters = await cleanupOldLocalAssetsV2Media();

    await assert.rejects(fs.stat(temporaryRender), { code: 'ENOENT' });
    await assert.rejects(fs.stat(legacyTemporaryRender), { code: 'ENOENT' });
    await fs.stat(finalRender);
    await fs.stat(legacyFinalRender);
    assert.equal((await fs.lstat(linkedFinalRender)).isSymbolicLink(), true);
    await fs.stat(userResource);
    await fs.stat(legacyUserResource);
    assert.equal(counters.deletedFiles, 2);
  } finally {
    if (previousRoot === undefined) delete process.env.SAMSAR_ASSETS_V2_ROOT;
    else process.env.SAMSAR_ASSETS_V2_ROOT = previousRoot;
    if (previousLegacyRoot === undefined) delete process.env.SAMSAR_ASSETS_ROOT;
    else process.env.SAMSAR_ASSETS_ROOT = previousLegacyRoot;
    if (previousCleanupHours === undefined) delete process.env.INTERMEDIATE_MEDIA_CLEANUP_HOURS;
    else process.env.INTERMEDIATE_MEDIA_CLEANUP_HOURS = previousCleanupHours;
    if (previousCronLogPath === undefined) delete process.env.TASK_PROCESSOR_CRON_LOG_PATH;
    else process.env.TASK_PROCESSOR_CRON_LOG_PATH = previousCronLogPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('intermediate media cleanup refuses a symlinked legacy temp root before deleting files', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-task-cleanup-'));
  const assetsV2Root = path.join(tempRoot, 'assets_v2');
  const assetsRoot = path.join(tempRoot, 'assets');
  const v2OldFile = path.join(assetsV2Root, 'ai_video/temp/old.png');
  const protectedFile = path.join(assetsRoot, 'user_resources/user/old.png');
  const settings = {
    SAMSAR_ASSETS_V2_ROOT: assetsV2Root,
    SAMSAR_ASSETS_ROOT: assetsRoot,
    INTERMEDIATE_MEDIA_CLEANUP_HOURS: '4',
  };
  const previous = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
  Object.assign(process.env, settings);
  t.after(async () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  for (const filePath of [v2OldFile, protectedFile]) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'media');
    const oldTime = new Date(Date.now() - 5 * 3600000);
    await fs.utimes(filePath, oldTime, oldTime);
  }
  await fs.mkdir(path.join(assetsRoot, 'ai_video'));
  await fs.symlink(path.join(assetsRoot, 'user_resources'), path.join(assetsRoot, 'ai_video/temp'));

  await assert.rejects(cleanupOldLocalAssetsV2Media(), /symlink/);
  await fs.stat(v2OldFile);
  await fs.stat(protectedFile);
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

test('worker applies 48-hour temp-media retention despite the legacy global setting', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-task-cleanup-'));
  const root = path.join(tempRoot, 'assets_v2');
  const legacyRoot = path.join(tempRoot, 'assets');
  const settings = {
    SAMSAR_ASSETS_V2_ROOT: root,
    SAMSAR_ASSETS_ROOT: legacyRoot,
    CLEANUP_MIN_AGE_HOURS: '168',
    INTERMEDIATE_MEDIA_CLEANUP_HOURS: '',
    TASK_PROCESSOR_CRON_LOG_PATH: path.join(tempRoot, 'cronTabs.log'),
  };
  const previous = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
  Object.assign(process.env, settings);
  t.after(async () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await assert.rejects(cleanupOldLocalAssetsV2Media(), /root does not exist/);
  for (const mediaRoot of [root, legacyRoot]) {
    const oldFile = path.join(mediaRoot, 'ai_video/temp/old.png');
    const recentFile = path.join(mediaRoot, 'ai_video/temp/recent.png');
    await fs.mkdir(path.dirname(oldFile), { recursive: true });
    for (const [file, hours] of [[oldFile, 49], [recentFile, 47]]) {
      await fs.writeFile(file, 'media');
      const mtime = new Date(Date.now() - hours * 3600000);
      await fs.utimes(file, mtime, mtime);
    }
  }
  const counters = await cleanupOldLocalAssetsV2Media();
  assert.equal(counters.deletedFiles, 2);
  for (const mediaRoot of [root, legacyRoot]) {
    await assert.rejects(fs.stat(path.join(mediaRoot, 'ai_video/temp/old.png')), { code: 'ENOENT' });
    await fs.stat(path.join(mediaRoot, 'ai_video/temp/recent.png'));
  }
});

test('file cleanup errors propagate to the scheduler for failure reporting and retry', async () => {
  await assert.rejects(__testOnly__.runFileCleanupTasksIfEnabled(
    true,
    async () => { throw new Error('missing media mount'); },
    async () => assert.fail('stale session cleanup must not run after mount failure'),
  ), /missing media mount/);
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
