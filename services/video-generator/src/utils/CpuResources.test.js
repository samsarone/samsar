import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOnDemandWeightedPool,
  getAvailableCpuCount,
  getCgroupCpuLimit,
  resolveCpuCeiling,
} from './CpuResources.js';

function createReader(files = {}) {
  return (filePath) => {
    if (Object.prototype.hasOwnProperty.call(files, filePath)) {
      return files[filePath];
    }
    const error = new Error(`ENOENT: ${filePath}`);
    error.code = 'ENOENT';
    throw error;
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('reads a nested cgroup v2 quota and floors fractional CPUs', () => {
  const readFile = createReader({
    '/proc/self/cgroup': '0::/docker/test-container\n',
    '/sys/fs/cgroup/cpu.max': 'max 100000\n',
    '/sys/fs/cgroup/docker/cpu.max': '350000 100000\n',
    '/sys/fs/cgroup/docker/test-container/cpu.max': 'max 100000\n',
  });

  assert.equal(getCgroupCpuLimit({ platform: 'linux', readFile }), 3);
});

test('reads a nested cgroup v1 quota and keeps sub-CPU quotas at one', () => {
  const readFile = createReader({
    '/proc/self/cgroup': '2:cpu,cpuacct:/docker/test-container\n',
    '/sys/fs/cgroup/cpu/docker/test-container/cpu.cfs_quota_us': '50000\n',
    '/sys/fs/cgroup/cpu/docker/test-container/cpu.cfs_period_us': '100000\n',
  });

  assert.equal(getCgroupCpuLimit({ platform: 'linux', readFile }), 1);
});

test('uses the smallest affinity, cgroup, and process CPU limit', () => {
  const readFile = createReader({
    '/sys/fs/cgroup/cpu.max': '400000 100000\n',
  });

  assert.equal(getAvailableCpuCount({
    env: { SAMSAR_PROCESS_CPU_LIMIT: '3' },
    platform: 'linux',
    readFile,
    availableParallelism: () => 12,
  }), 3);
});

test('resolves the first positive configured ceiling and falls back to os.cpus', () => {
  assert.equal(resolveCpuCeiling({
    defaultCeiling: 8,
    envNames: ['SERVICE_LIMIT', 'GLOBAL_LIMIT'],
    env: {
      SERVICE_LIMIT: 'invalid',
      GLOBAL_LIMIT: '4',
    },
    platform: 'darwin',
    availableParallelism: () => {
      throw new Error('not supported');
    },
    cpus: () => new Array(6).fill({}),
  }), 4);
});

test('reserves one CPU for other containers by default and allows an explicit opt-out', () => {
  const cpuOptions = {
    defaultCeiling: 8,
    platform: 'darwin',
    availableParallelism: () => 4,
  };

  assert.equal(resolveCpuCeiling({
    ...cpuOptions,
    env: {},
  }), 3);
  assert.equal(resolveCpuCeiling({
    ...cpuOptions,
    env: { SAMSAR_CPU_RESERVE: '' },
  }), 3);
  assert.equal(resolveCpuCeiling({
    ...cpuOptions,
    env: { SAMSAR_CPU_RESERVE: '0.5' },
  }), 3);
  assert.equal(resolveCpuCeiling({
    ...cpuOptions,
    env: { SAMSAR_CPU_RESERVE: '0' },
  }), 4);
  assert.equal(resolveCpuCeiling({
    ...cpuOptions,
    env: { SAMSAR_CPU_RESERVE: '10' },
  }), 1);
});

test('weighted pool is lazy and queues work until capacity is released', async () => {
  let capacityReads = 0;
  const pool = createOnDemandWeightedPool({
    getCapacity: () => {
      capacityReads += 1;
      return 2;
    },
  });
  assert.equal(capacityReads, 0);

  const firstStarted = createDeferred();
  const releaseFirst = createDeferred();
  let secondStarted = false;
  const first = pool.run(2, async () => {
    firstStarted.resolve();
    await releaseFirst.promise;
  });
  await firstStarted.promise;

  const second = pool.run(1, async () => {
    secondStarted = true;
  });
  await Promise.resolve();
  assert.equal(secondStarted, false);
  assert.deepEqual(pool.getSnapshot(), {
    activeWeight: 2,
    pendingCount: 1,
  });

  releaseFirst.resolve();
  await Promise.all([first, second]);
  assert.equal(secondStarted, true);
  assert.deepEqual(pool.getSnapshot(), {
    activeWeight: 0,
    pendingCount: 0,
  });
});

test('weighted pool releases capacity when work throws', async () => {
  const pool = createOnDemandWeightedPool({ getCapacity: () => 1 });

  await assert.rejects(
    pool.run(1, async () => {
      throw new Error('expected failure');
    }),
    /expected failure/,
  );
  assert.equal(await pool.run(1, async () => 'next'), 'next');
  assert.deepEqual(pool.getSnapshot(), {
    activeWeight: 0,
    pendingCount: 0,
  });
});
