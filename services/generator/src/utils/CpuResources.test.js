import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAvailableCpuCount,
  getCgroupCpuLimit,
  parseNonNegativeInteger,
  resolveCpuUpperBound,
  resolvePerTaskCpuUpperBound,
} from './CpuResources.js';

function createReader(files = {}) {
  return (filePath) => {
    if (!Object.hasOwn(files, filePath)) {
      const error = new Error(`Missing test file: ${filePath}`);
      error.code = 'ENOENT';
      throw error;
    }
    return files[filePath];
  };
}

test('normalizes CPU reserves and preserves an explicit zero opt-out', () => {
  assert.equal(parseNonNegativeInteger('0.5'), 1);
  assert.equal(parseNonNegativeInteger('2.9'), 3);
  assert.equal(parseNonNegativeInteger('0'), 0);
  assert.equal(parseNonNegativeInteger(''), null);
  assert.equal(parseNonNegativeInteger('-1'), null);
});

test('detects the strictest cgroup v2 quota and floors fractional CPUs', () => {
  const readFileSync = createReader({
    '/proc/self/cgroup': '0::/jobs/image\n',
    '/sys/fs/cgroup/jobs/image/cpu.max': '250000 100000\n',
    '/sys/fs/cgroup/jobs/cpu.max': 'max 100000\n',
    '/sys/fs/cgroup/cpu.max': '800000 100000\n',
  });

  assert.equal(getCgroupCpuLimit({ readFileSync }), 2);
});

test('detects a cgroup v1 CPU quota', () => {
  const readFileSync = createReader({
    '/proc/self/cgroup': '4:cpu,cpuacct:/image-worker\n',
    '/sys/fs/cgroup/cpu/image-worker/cpu.cfs_quota_us': '200000\n',
    '/sys/fs/cgroup/cpu/image-worker/cpu.cfs_period_us': '100000\n',
  });

  assert.equal(getCgroupCpuLimit({ readFileSync }), 2);
});

test('detects the alternate cgroup v1 cpuacct,cpu mount order', () => {
  const readFileSync = createReader({
    '/proc/self/cgroup': '4:cpu,cpuacct:/image-worker\n',
    '/sys/fs/cgroup/cpuacct,cpu/image-worker/cpu.cfs_quota_us': '300000\n',
    '/sys/fs/cgroup/cpuacct,cpu/image-worker/cpu.cfs_period_us': '100000\n',
  });

  assert.equal(getCgroupCpuLimit({ readFileSync }), 3);
});

test('uses the minimum detected limit before reserving CPU headroom', () => {
  const readFileSync = createReader({
    '/proc/self/cgroup': '0::/\n',
    '/sys/fs/cgroup/cpu.max': '600000 100000\n',
  });

  assert.equal(getAvailableCpuCount({
    env: { SAMSAR_PROCESS_CPU_LIMIT: '3' },
    availableParallelism: () => 12,
    readFileSync,
  }), 2);
});

test('falls back to the CPU list when availableParallelism returns no count', () => {
  assert.equal(getAvailableCpuCount({
    env: { SAMSAR_CPU_RESERVE: '0' },
    availableParallelism: () => null,
    cpus: () => [{}, {}],
    readFileSync: createReader({}),
  }), 2);
});

test('reserves one CPU by default and supports configured reserve and opt-out', () => {
  const cpuOptions = {
    availableParallelism: () => 8,
    readFileSync: createReader({}),
  };

  assert.equal(getAvailableCpuCount({ ...cpuOptions, env: {} }), 7);
  assert.equal(getAvailableCpuCount({
    ...cpuOptions,
    env: { SAMSAR_CPU_RESERVE: '2' },
  }), 6);
  assert.equal(getAvailableCpuCount({
    ...cpuOptions,
    env: { SAMSAR_CPU_RESERVE: '0' },
  }), 8);
  assert.equal(getAvailableCpuCount({
    availableParallelism: () => 1,
    readFileSync: createReader({}),
    env: {},
  }), 1);
});

test('applies an already-reserved process budget without subtracting twice', () => {
  assert.equal(getAvailableCpuCount({
    env: {
      SAMSAR_CPU_RESERVE: '1',
      SAMSAR_PROCESS_CPU_BUDGET: '2',
    },
    availableParallelism: () => 4,
    readFileSync: createReader({}),
  }), 2);
});

test('reserves from an explicit process CPU allocation before applying child budgets', () => {
  assert.equal(getAvailableCpuCount({
    env: { SAMSAR_PROCESS_CPU_LIMIT: '2' },
    availableParallelism: () => 8,
    readFileSync: createReader({}),
  }), 1);
});

test('image concurrency values remain upper bounds', () => {
  assert.equal(resolveCpuUpperBound('4', 4, { availableCpuCount: 1 }), 1);
  assert.equal(resolveCpuUpperBound('4', 4, { availableCpuCount: 8 }), 4);
  assert.equal(resolveCpuUpperBound('12', 4, { availableCpuCount: 8 }), 8);
  assert.equal(resolveCpuUpperBound('invalid', 4, { availableCpuCount: 2 }), 2);
});

test('image concurrency uses the effective post-reserve budget', () => {
  assert.equal(resolveCpuUpperBound('8', 4, {
    env: {},
    availableParallelism: () => 4,
    readFileSync: createReader({}),
  }), 3);
});

test('native threads are divided across the outer request limit', () => {
  assert.equal(resolvePerTaskCpuUpperBound('8', 8, {
    availableCpuCount: 7,
    maxConcurrentTasks: 4,
  }), 1);
  assert.equal(resolvePerTaskCpuUpperBound('8', 8, {
    availableCpuCount: 7,
    maxConcurrentTasks: 2,
  }), 3);
  assert.equal(resolvePerTaskCpuUpperBound('2', 8, {
    availableCpuCount: 7,
    maxConcurrentTasks: 2,
  }), 2);
});
