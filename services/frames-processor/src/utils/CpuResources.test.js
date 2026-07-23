import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectCgroupCpuLimit,
  getAvailableCpuCount,
  getCpuResourceBudget,
  parseCgroupV1CpuQuota,
  parseCgroupV2CpuMax,
  WeightedCpuResourcePool,
} from './CpuResources.js';

function createFileReader(files = {}) {
  return (filePath) => {
    if (!(filePath in files)) {
      const error = new Error(`Missing test file ${filePath}`);
      error.code = 'ENOENT';
      throw error;
    }
    return files[filePath];
  };
}

test('cgroup quota parsers floor fractional CPUs and retain a minimum of one', () => {
  assert.equal(parseCgroupV2CpuMax('250000 100000'), 2);
  assert.equal(parseCgroupV2CpuMax('50000 100000'), 1);
  assert.equal(parseCgroupV2CpuMax('max 100000'), null);
  assert.equal(parseCgroupV1CpuQuota('350000', '100000'), 3);
  assert.equal(parseCgroupV1CpuQuota('-1', '100000'), null);
});

test('fractional CPU limits floor to one while fractional reserves retain headroom', () => {
  assert.deepEqual(getCpuResourceBudget({
    env: {
      SAMSAR_PROCESS_CPU_LIMIT: '0.5',
      SAMSAR_CPU_RESERVE: '0',
    },
    availableParallelism: () => 8,
    readFile: createFileReader(),
  }), {
    detectedCpuCount: 1,
    configuredCpuReserve: 0,
    cpuReserve: 0,
    heavyWorkCpuBudget: 1,
  });

  assert.deepEqual(getCpuResourceBudget({
    env: { SAMSAR_CPU_RESERVE: '0.5' },
    availableParallelism: () => 4,
    readFile: createFileReader(),
  }), {
    detectedCpuCount: 4,
    configuredCpuReserve: 1,
    cpuReserve: 1,
    heavyWorkCpuBudget: 3,
  });
});

test('detects cgroup v2 and v1 CPU quotas', () => {
  assert.equal(detectCgroupCpuLimit({
    readFile: createFileReader({
      '/sys/fs/cgroup/cpu.max': '450000 100000',
    }),
  }), 4);

  assert.equal(detectCgroupCpuLimit({
    readFile: createFileReader({
      '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '250000',
      '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
    }),
  }), 2);
});

test('detects CPU quotas in a nested process cgroup', () => {
  assert.equal(detectCgroupCpuLimit({
    readFile: createFileReader({
      '/proc/self/cgroup': '0::/system.slice/samsar.service\n',
      '/sys/fs/cgroup/system.slice/cpu.max': '250000 100000',
      '/sys/fs/cgroup/system.slice/samsar.service/cpu.max': 'max 100000',
    }),
  }), 2);

  assert.equal(detectCgroupCpuLimit({
    readFile: createFileReader({
      '/proc/self/cgroup': '2:cpu,cpuacct:/docker/samsar\n',
      '/sys/fs/cgroup/cpu,cpuacct/docker/cpu.cfs_quota_us': '300000',
      '/sys/fs/cgroup/cpu,cpuacct/docker/cpu.cfs_period_us': '100000',
    }),
  }), 3);
});

test('available CPU count is the minimum of runtime, cgroup, and configured ceilings', () => {
  const readFile = createFileReader({
    '/sys/fs/cgroup/cpu.max': '400000 100000',
  });

  assert.equal(getAvailableCpuCount({
    env: { SAMSAR_CPU_RESERVE: '0' },
    availableParallelism: () => 8,
    readFile,
  }), 4);
  assert.equal(getAvailableCpuCount({
    env: {
      SAMSAR_PROCESS_CPU_LIMIT: '2',
      SAMSAR_CPU_RESERVE: '0',
    },
    availableParallelism: () => 8,
    readFile,
  }), 2);
  assert.equal(getAvailableCpuCount({
    env: {
      SAMSAR_PROCESS_CPU_LIMIT: '12',
      SAMSAR_CPU_RESERVE: '0',
    },
    availableParallelism: () => 8,
    readFile,
  }), 4);
});

test('reserves one CPU by default and supports zero-reserve opt-out', () => {
  const common = {
    availableParallelism: () => 4,
    readFile: createFileReader(),
  };

  assert.deepEqual(getCpuResourceBudget({
    env: {},
    ...common,
  }), {
    detectedCpuCount: 4,
    configuredCpuReserve: 1,
    cpuReserve: 1,
    heavyWorkCpuBudget: 3,
  });
  assert.deepEqual(getCpuResourceBudget({
    env: { SAMSAR_CPU_RESERVE: '0' },
    ...common,
  }), {
    detectedCpuCount: 4,
    configuredCpuReserve: 0,
    cpuReserve: 0,
    heavyWorkCpuBudget: 4,
  });
});

test('clamps CPU reserve so at least one CPU remains for heavy work', () => {
  assert.deepEqual(getCpuResourceBudget({
    env: { SAMSAR_CPU_RESERVE: '20' },
    availableParallelism: () => 4,
    readFile: createFileReader(),
  }), {
    detectedCpuCount: 4,
    configuredCpuReserve: 20,
    cpuReserve: 3,
    heavyWorkCpuBudget: 1,
  });

  assert.deepEqual(getCpuResourceBudget({
    env: {},
    availableParallelism: () => 1,
    readFile: createFileReader(),
  }), {
    detectedCpuCount: 1,
    configuredCpuReserve: 1,
    cpuReserve: 0,
    heavyWorkCpuBudget: 1,
  });
});

test('available CPU count falls back safely when runtime and cgroup values are unavailable', () => {
  assert.equal(getAvailableCpuCount({
    env: {
      SAMSAR_PROCESS_CPU_LIMIT: 'invalid',
      SAMSAR_CPU_RESERVE: '0',
    },
    availableParallelism: () => {
      throw new Error('unavailable');
    },
    logicalCpuCount: () => 3,
    readFile: createFileReader(),
  }), 3);

  assert.equal(getAvailableCpuCount({
    env: { SAMSAR_PROCESS_CPU_LIMIT: '0' },
    availableParallelism: () => 0,
    logicalCpuCount: () => 0,
    readFile: createFileReader(),
  }), 1);
});

test('weighted CPU pool queues work until enough resources are released', async () => {
  const pool = new WeightedCpuResourcePool(3);
  const releaseTwo = await pool.acquire(2);
  let queuedAcquired = false;
  const queued = pool.acquire(2).then((release) => {
    queuedAcquired = true;
    return release;
  });

  await Promise.resolve();
  assert.equal(queuedAcquired, false);
  assert.equal(pool.available, 1);
  assert.equal(pool.pending, 1);

  releaseTwo();
  const releaseQueued = await queued;
  assert.equal(queuedAcquired, true);
  assert.equal(pool.available, 1);
  assert.equal(pool.pending, 0);

  releaseQueued();
  releaseQueued();
  assert.equal(pool.available, 3);
});

test('weighted CPU pool releases resources after task success and error', async () => {
  const pool = new WeightedCpuResourcePool(2);

  assert.equal(await pool.run(2, async () => 'done'), 'done');
  assert.equal(pool.available, 2);

  await assert.rejects(
    pool.run(1, async () => {
      throw new Error('failed');
    }),
    /failed/,
  );
  assert.equal(pool.available, 2);
});
