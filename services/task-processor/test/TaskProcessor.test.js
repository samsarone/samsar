import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __testOnly__,
  isTaskProcessorFileCleanupEnabled,
  isTaskProcessorGenerationSideEffectsEnabled,
} from '../src/TaskProcessor.js';

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

test('file cleanup preserves legacy behavior outside Docker and fails closed in Docker', () => {
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
    false,
  );
  assert.equal(
    isTaskProcessorFileCleanupEnabled(
      { CURRENT_ENV: 'production' },
      true,
    ),
    false,
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
