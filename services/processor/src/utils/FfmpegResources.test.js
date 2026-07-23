import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProcessorFfmpegThreadOptions,
  createOnDemandWeightedCpuPool,
} from './FfmpegResources.js';

test('FFmpeg options cap decoder, filters, and encoder independently', () => {
  assert.deepEqual(
    buildProcessorFfmpegThreadOptions(4, { decoderThreads: 1 }),
    {
      threadCount: 4,
      decoderThreadCount: 1,
      inputOptions: ['-threads', '1'],
      simpleFilterOptions: ['-filter_threads', '4'],
      complexFilterOptions: ['-filter_complex_threads', '4'],
      encoderOptions: ['-threads', '4'],
      outputOptions: [
        '-filter_threads', '4',
        '-filter_complex_threads', '4',
        '-threads', '4',
      ],
    },
  );

  assert.equal(
    buildProcessorFfmpegThreadOptions(2, { decoderThreads: 8 }).decoderThreadCount,
    2,
  );
});

test('weighted pool admits work only when CPU capacity is available', async () => {
  let capacityReads = 0;
  const pool = createOnDemandWeightedCpuPool({
    getCapacity: () => {
      capacityReads += 1;
      return 3;
    },
  });

  assert.equal(capacityReads, 0);
  assert.deepEqual(pool.getSnapshot(), {
    activeWeight: 0,
    pendingCount: 0,
  });

  const first = await pool.acquire(2);
  const secondPromise = pool.acquire(2);
  await Promise.resolve();
  assert.deepEqual(pool.getSnapshot(), {
    activeWeight: 2,
    pendingCount: 1,
  });

  first.release();
  const second = await secondPromise;
  assert.deepEqual(pool.getSnapshot(), {
    activeWeight: 2,
    pendingCount: 0,
  });

  second.release();
  second.release();
  assert.deepEqual(pool.getSnapshot(), {
    activeWeight: 0,
    pendingCount: 0,
  });
  assert.ok(capacityReads > 0);
});

test('weighted pool clamps oversized requests to current capacity', async () => {
  const pool = createOnDemandWeightedCpuPool({
    getCapacity: () => 2,
  });
  const allocation = await pool.acquire(8);

  assert.equal(allocation.weight, 2);
  assert.deepEqual(pool.getSnapshot(), {
    activeWeight: 2,
    pendingCount: 0,
  });

  allocation.release();
});
