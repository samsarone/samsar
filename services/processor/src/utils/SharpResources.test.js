import assert from 'node:assert/strict';
import test from 'node:test';

import { configureProcessorSharpConcurrency } from './SharpResources.js';

test('Sharp concurrency is configured once from the worker CPU-aware ceiling', () => {
  const configuredValues = [];
  const sharpModule = {
    concurrency(value) {
      configuredValues.push(value);
    },
  };

  const threadLimit = configureProcessorSharpConcurrency({
    sharpModule,
    env: {
      SAMSAR_PROCESSOR_MAX_SHARP_THREADS: '6',
    },
    cpuBudget: 3,
  });

  assert.equal(threadLimit, 3);
  assert.deepEqual(configuredValues, [3]);
});

test('Sharp uses its reliability-first single-thread default', () => {
  const configuredValues = [];
  const threadLimit = configureProcessorSharpConcurrency({
    sharpModule: {
      concurrency(value) {
        configuredValues.push(value);
      },
    },
    env: {},
    cpuBudget: 8,
  });

  assert.equal(threadLimit, 1);
  assert.deepEqual(configuredValues, [1]);
});
