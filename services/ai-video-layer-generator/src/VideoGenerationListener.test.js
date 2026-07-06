import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTransientProviderErrorUpdate,
  buildBaseGenerationTerminalFailureUpdate,
  isTransientProviderError,
  resolveCompletedLayerDuration,
  resolveConnectedAudioLayerDuration,
  selectFilterPassForBaseGenerationRetry,
} from './VideoGenerationListener.js';
import { isTransientMongoError } from './DBString.js';

test('base generation retry picks the next highest scored filter pass for each retry', () => {
  const passes = [
    { score: 0.45, src: 'low.png' },
    { score: 0.95, src: 'best.png' },
    { score: 0.72, src: 'middle.png' },
  ];

  assert.equal(selectFilterPassForBaseGenerationRetry(passes, 0).pass.src, 'best.png');
  assert.equal(selectFilterPassForBaseGenerationRetry(passes, 1).pass.src, 'middle.png');
  assert.equal(selectFilterPassForBaseGenerationRetry(passes, 2).pass.src, 'low.png');
});

test('base generation retry reuses the last available filter pass only after choices are exhausted', () => {
  const passes = [
    { score: 10, src: 'best.png' },
    { score: 5, src: 'second.png' },
  ];

  const selected = selectFilterPassForBaseGenerationRetry(passes, 4);

  assert.equal(selected.pass.src, 'second.png');
  assert.equal(selected.rank, 1);
  assert.equal(selected.reusedLastAvailablePass, true);
});

test('connected audio duration is clamped to the connected scene duration', () => {
  assert.equal(
    resolveConnectedAudioLayerDuration({
      generationType: 'sound_effect',
      generatedAudioDuration: 11.4,
      layerDuration: 8,
    }),
    8,
  );
  assert.equal(
    resolveConnectedAudioLayerDuration({
      generationType: 'speech',
      generatedAudioDuration: 11.4,
      layerDuration: 8,
    }),
    8,
  );
});

test('lip-sync completion shrinks to materially shorter extracted frame duration', () => {
  assert.equal(
    resolveCompletedLayerDuration({
      currentLayerDuration: 4.87,
      generatedLayerDuration: 4.04,
      generatedFrameCount: 97,
      framesPerSecond: 24,
      model: 'SYNCLIPSYNC',
      isAudioVideoGeneration: true,
    }),
    4.041667,
  );
});

test('lip-sync completion keeps the existing duration for frame-rounding differences', () => {
  assert.equal(
    resolveCompletedLayerDuration({
      currentLayerDuration: 4.87,
      generatedLayerDuration: 4.875,
      generatedFrameCount: 117,
      framesPerSecond: 24,
      model: 'SYNCLIPSYNC',
      isAudioVideoGeneration: true,
    }),
    4.87,
  );
});

test('non-lip-sync completion follows generated duration', () => {
  assert.equal(
    resolveCompletedLayerDuration({
      currentLayerDuration: 4.87,
      generatedLayerDuration: 2.16,
      model: 'COSMOS3SUPERI2V',
      isAudioVideoGeneration: false,
    }),
    2.16,
  );
});

test('terminal base failure leaves express session active for delete reflow', () => {
  const update = buildBaseGenerationTerminalFailureUpdate(
    { layerAiVideoType: 'narration' },
    'AI video generation failed after 4 attempts.'
  );

  assert.equal(update['layers.$.aiVideoGenerationStatus'], 'FAILED');
  assert.equal(update['layers.$.aiVideoGenerationPending'], false);
  assert.equal(update['expressGenerationStatus.delete_reflow'], 'INIT');
  assert.equal(update['expressGenerationStatus.timeline_reflowed'], 'INIT');
  assert.equal(Object.hasOwn(update, 'expressGenerationPending'), false);
  assert.equal(Object.hasOwn(update, 'expressGenerationFailed'), false);
  assert.equal(Object.hasOwn(update, 'expressGenerationStatus.status'), false);
  assert.equal(Object.hasOwn(update, 'expressGenerationStatus.ai_video_generation'), false);
});

test('terminal character base failure also disables pending lip sync on that layer', () => {
  const update = buildBaseGenerationTerminalFailureUpdate(
    { layerAiVideoType: 'character' },
    'AI video generation failed after 4 attempts.'
  );

  assert.equal(update['layers.$.lipSyncGenerationPending'], false);
});

test('Runway polling 429 is treated as transient provider backoff, not failure', () => {
  const error = {
    message: 'Request failed with status code 429',
    response: {
      status: 429,
      headers: { 'retry-after': '12' },
    },
  };

  assert.equal(isTransientProviderError(error), true);

  const update = buildTransientProviderErrorUpdate(
    { status: 'PENDING', transientProviderErrorCount: 0 },
    error,
    'poll'
  );

  assert.equal(update.set.status, 'PENDING');
  assert.equal(update.set.rowLocked, false);
  assert.equal(update.set.lastTransientProviderErrorStatus, 429);
  assert.equal(update.set.transientProviderErrorPhase, 'poll');
  assert.deepEqual(update.inc, { transientProviderErrorCount: 1 });
  assert.ok(update.set.nextAttemptAfter instanceof Date);
  assert.equal(Object.hasOwn(update.set, 'numRetries'), false);
});

test('provider submit 503 is held in INIT for retry without consuming generation retries', () => {
  const error = {
    message: 'Service unavailable',
    response: { status: 503, headers: {} },
  };

  const update = buildTransientProviderErrorUpdate(
    { status: 'INIT', transientProviderErrorCount: 2 },
    error,
    'submit'
  );

  assert.equal(isTransientProviderError(error), true);
  assert.equal(update.set.status, 'INIT');
  assert.equal(update.set.lastTransientProviderErrorStatus, 503);
  assert.equal(update.set.transientProviderErrorPhase, 'submit');
  assert.equal(Object.hasOwn(update.set, 'numRetries'), false);
});

test('repeated transient provider errors are promoted to FAILED for normal retry handling', () => {
  const error = {
    message: 'Internal Server Error',
    response: { status: 500, headers: {} },
  };

  const update = buildTransientProviderErrorUpdate(
    { status: 'PENDING', transientProviderErrorCount: 99 },
    error,
    'poll'
  );

  assert.equal(update.set.status, 'FAILED');
  assert.equal(update.set.rowLocked, false);
  assert.equal(update.set.nextAttemptAfter, null);
  assert.equal(update.set.transientProviderErrorExhausted, true);
  assert.equal(Object.hasOwn(update.set, 'numRetries'), false);
});

test('stale base provider polling transient errors are promoted to FAILED', () => {
  const error = {
    message: 'Internal Server Error',
    response: { status: 500, headers: {} },
  };

  const update = buildTransientProviderErrorUpdate(
    {
      status: 'PENDING',
      model: 'HAPPYHORSEI2V',
      transientProviderErrorCount: 1,
      requestSubmitAt: new Date(Date.now() - 31 * 60 * 1000),
    },
    error,
    'poll'
  );

  assert.equal(update.set.status, 'FAILED');
  assert.equal(update.set.transientProviderErrorExhausted, true);
});

test('Mongo server selection timeouts are treated as transient DB errors', () => {
  const error = {
    name: 'MongoServerSelectionError',
    message: 'connection timed out',
    cause: {
      name: 'MongoNetworkTimeoutError',
      message: 'connection timed out',
    },
  };

  assert.equal(isTransientMongoError(error), true);
});

test('non-Mongo application errors are not treated as transient DB errors', () => {
  const error = new Error('Provider returned invalid payload');

  assert.equal(isTransientMongoError(error), false);
});
