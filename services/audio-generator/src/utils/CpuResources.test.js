import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAvailableCpuCount,
  getCgroupCpuLimit,
  parseNonNegativeInteger,
  parsePositiveInteger,
  resolveCpuUpperBound,
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

test('normalizes positive integer limits', () => {
  assert.equal(parsePositiveInteger('4.9'), 4);
  assert.equal(parsePositiveInteger('0'), null);
  assert.equal(parsePositiveInteger('-2'), null);
  assert.equal(parsePositiveInteger('invalid'), null);
});

test('normalizes CPU reserves and preserves an explicit zero opt-out', () => {
  assert.equal(parseNonNegativeInteger('0.5'), 1);
  assert.equal(parseNonNegativeInteger('2.9'), 3);
  assert.equal(parseNonNegativeInteger('0'), 0);
  assert.equal(parseNonNegativeInteger(''), null);
  assert.equal(parseNonNegativeInteger('-1'), null);
});

test('reads the strictest cgroup v2 quota across the process hierarchy', () => {
  const readFileSync = createReader({
    '/proc/self/cgroup': '0::/workload/child\n',
    '/sys/fs/cgroup/workload/child/cpu.max': 'max 100000\n',
    '/sys/fs/cgroup/workload/cpu.max': '350000 100000\n',
    '/sys/fs/cgroup/cpu.max': '800000 100000\n',
  });

  assert.equal(getCgroupCpuLimit({ readFileSync }), 3);
});

test('reads cgroup v1 quotas and floors fractional CPUs', () => {
  const readFileSync = createReader({
    '/proc/self/cgroup': '2:cpu,cpuacct:/jobs/render\n',
    '/sys/fs/cgroup/cpu/jobs/render/cpu.cfs_quota_us': '150000\n',
    '/sys/fs/cgroup/cpu/jobs/render/cpu.cfs_period_us': '100000\n',
  });

  assert.equal(getCgroupCpuLimit({ readFileSync }), 1);
});

test('reads cgroup v1 quotas from the alternate cpuacct,cpu mount order', () => {
  const readFileSync = createReader({
    '/proc/self/cgroup': '2:cpu,cpuacct:/jobs/render\n',
    '/sys/fs/cgroup/cpuacct,cpu/jobs/render/cpu.cfs_quota_us': '200000\n',
    '/sys/fs/cgroup/cpuacct,cpu/jobs/render/cpu.cfs_period_us': '100000\n',
  });

  assert.equal(getCgroupCpuLimit({ readFileSync }), 2);
});

test('uses the minimum detected limit before reserving CPU headroom', () => {
  const readFileSync = createReader({
    '/proc/self/cgroup': '0::/\n',
    '/sys/fs/cgroup/cpu.max': '400000 100000\n',
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
    availableParallelism: () => undefined,
    cpus: () => [{}, {}, {}],
    readFileSync: createReader({}),
  }), 3);
});

test('reserves one CPU by default and supports configured reserve and opt-out', () => {
  const cpuOptions = {
    availableParallelism: () => 8,
    readFileSync: createReader({}),
  };

  assert.equal(getAvailableCpuCount({ ...cpuOptions, env: {} }), 7);
  assert.equal(getAvailableCpuCount({
    ...cpuOptions,
    env: { SAMSAR_CPU_RESERVE: '3' },
  }), 5);
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

test('applies an already-reserved child process budget without subtracting twice', () => {
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

test('configured values are upper bounds and invalid values use the default cap', () => {
  assert.equal(resolveCpuUpperBound('8', 2, { availableCpuCount: 3 }), 3);
  assert.equal(resolveCpuUpperBound('2', 2, { availableCpuCount: 12 }), 2);
  assert.equal(resolveCpuUpperBound('invalid', 4, { availableCpuCount: 2 }), 2);
  assert.equal(resolveCpuUpperBound('0', 4, { availableCpuCount: 1 }), 1);
});

test('CPU ceilings use the effective post-reserve budget', () => {
  assert.equal(resolveCpuUpperBound('8', 8, {
    env: {},
    availableParallelism: () => 4,
    readFileSync: createReader({}),
  }), 3);
});
