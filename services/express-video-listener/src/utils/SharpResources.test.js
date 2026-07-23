import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureExpressVideoSharpConcurrency,
  resolveExpressVideoSharpThreads,
} from './SharpResources.js';

test('Sharp concurrency respects its upper bound and the sibling-container reserve', () => {
  assert.equal(resolveExpressVideoSharpThreads({
    env: {
      SAMSAR_EXPRESS_VIDEO_MAX_SHARP_THREADS: '8',
      SAMSAR_CPU_RESERVE: '1',
    },
    platform: 'darwin',
    availableParallelism: () => 4,
  }), 3);
});

test('Sharp concurrency is configured without starting any image operation', () => {
  const calls = [];
  const threads = configureExpressVideoSharpConcurrency({
    concurrency(value) {
      calls.push(value);
    },
  }, {
    env: {
      SAMSAR_MAX_SHARP_THREADS: '2',
      SAMSAR_CPU_RESERVE: '0',
    },
    platform: 'darwin',
    availableParallelism: () => 8,
  });

  assert.equal(threads, 2);
  assert.deepEqual(calls, [2]);
});
