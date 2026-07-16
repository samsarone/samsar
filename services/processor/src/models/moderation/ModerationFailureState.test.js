import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NARRATIVE_MODERATION_FAILURE_MESSAGE,
  buildNarrativeModerationFailureUpdate,
  markNarrativeModerationFailure,
} from './ModerationFailureState.js';

test('narrative moderation failure update preserves the status map and clears pending state', () => {
  const update = buildNarrativeModerationFailureUpdate();

  assert.equal(Object.hasOwn(update.$set, 'expressGenerationStatus'), false);
  assert.deepEqual(update, {
    $set: {
      'expressGenerationStatus.status': 'FAILED',
      'expressGenerationStatus.prompt_generation': 'FAILED',
      'expressGenerationStatus.video_generation': 'FAILED',
      expressGenerationPending: false,
      videoGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: NARRATIVE_MODERATION_FAILURE_MESSAGE,
    },
  });
});

test('markNarrativeModerationFailure applies the terminal update to the requested session', async () => {
  const calls = [];
  const result = await markNarrativeModerationFailure('session-123', {
    message: '  Content moderation failed  ',
    VideoSessionModel: {
      findByIdAndUpdate: async (...args) => {
        calls.push(args);
        return { acknowledged: true };
      },
    },
  });

  assert.deepEqual(result, { acknowledged: true });
  assert.deepEqual(calls, [[
    'session-123',
    buildNarrativeModerationFailureUpdate('Content moderation failed'),
  ]]);
});

test('markNarrativeModerationFailure is best-effort and does not mask the moderation error', async (t) => {
  t.mock.method(console, 'error', () => {});
  const result = await markNarrativeModerationFailure('session-123', {
    VideoSessionModel: {
      findByIdAndUpdate: async () => {
        throw new Error('database unavailable');
      },
    },
  });

  assert.equal(result, null);
});
