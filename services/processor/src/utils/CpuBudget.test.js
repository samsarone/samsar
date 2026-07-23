import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CGROUP_V1_CPU_QUOTA_PATHS,
  CGROUP_V2_CPU_MAX_PATHS,
  DEFAULT_CPU_RESERVE,
  detectAvailableParallelism,
  detectCgroupCpuLimit,
  distributeCpuBudget,
  normalizeNonNegativeCpuCount,
  parseCgroupV1CpuQuota,
  parseCgroupV2CpuMax,
  resolveCpuUpperBound,
  resolveProcessCpuBudget,
  resolveProcessorFfmpegThreadLimit,
  resolveProcessorInteractiveMediaTaskLimit,
  resolveProcessorSharpThreadLimit,
  resolveProcessorWorkerPlan,
} from './CpuBudget.js';

function createFileReader(files = {}) {
  return (filePath) => {
    if (!Object.prototype.hasOwnProperty.call(files, filePath)) {
      const error = new Error(`ENOENT: ${filePath}`);
      error.code = 'ENOENT';
      throw error;
    }
    return files[filePath];
  };
}

test('cgroup v2 CPU quota is floored and fractional quotas retain one CPU', () => {
  assert.equal(parseCgroupV2CpuMax('250000 100000'), 2);
  assert.equal(parseCgroupV2CpuMax('50000 100000'), 1);
  assert.equal(parseCgroupV2CpuMax('max 100000'), null);
  assert.equal(parseCgroupV2CpuMax('invalid'), null);
});

test('cgroup v1 CPU quota is floored and unlimited quotas are ignored', () => {
  assert.equal(parseCgroupV1CpuQuota('390000', '100000'), 3);
  assert.equal(parseCgroupV1CpuQuota('50000', '100000'), 1);
  assert.equal(parseCgroupV1CpuQuota('-1', '100000'), null);
  assert.equal(parseCgroupV1CpuQuota('100000', '0'), null);
});

test('cgroup detection supports v2 and v1 layouts deterministically', () => {
  const v2Path = CGROUP_V2_CPU_MAX_PATHS[0];
  const v1Paths = CGROUP_V1_CPU_QUOTA_PATHS[0];

  assert.equal(
    detectCgroupCpuLimit({
      readFileSync: createFileReader({ [v2Path]: '180000 100000' }),
    }),
    1,
  );
  assert.equal(
    detectCgroupCpuLimit({
      readFileSync: createFileReader({
        [v2Path]: 'max 100000',
        [v1Paths.quota]: '280000',
        [v1Paths.period]: '100000',
      }),
    }),
    2,
  );
  assert.equal(
    detectCgroupCpuLimit({ readFileSync: createFileReader() }),
    null,
  );
});

test('cgroup detection evaluates the active nested hierarchy and its ancestors', () => {
  assert.equal(
    detectCgroupCpuLimit({
      readFileSync: createFileReader({
        '/proc/self/cgroup': '0::/docker/workload.scope\n',
        '/sys/fs/cgroup/cpu.max': 'max 100000',
        '/sys/fs/cgroup/docker/cpu.max': '590000 100000',
        '/sys/fs/cgroup/docker/workload.scope/cpu.max': '390000 100000',
      }),
    }),
    3,
  );

  assert.equal(
    detectCgroupCpuLimit({
      readFileSync: createFileReader({
        '/proc/self/cgroup': '4:memory:/docker/workload.scope\n'
          + '5:cpu,cpuacct:/docker/workload.scope\n',
        '/sys/fs/cgroup/cpu/docker/cpu.cfs_quota_us': '490000',
        '/sys/fs/cgroup/cpu/docker/cpu.cfs_period_us': '100000',
        '/sys/fs/cgroup/cpu/docker/workload.scope/cpu.cfs_quota_us': '290000',
        '/sys/fs/cgroup/cpu/docker/workload.scope/cpu.cfs_period_us': '100000',
      }),
    }),
    2,
  );
});

test('available parallelism falls back safely and always yields at least one CPU', () => {
  assert.equal(
    detectAvailableParallelism({
      availableParallelism: () => 6,
      cpus: () => [],
    }),
    6,
  );
  assert.equal(
    detectAvailableParallelism({
      availableParallelism: () => {
        throw new Error('unsupported');
      },
      cpus: () => [{}, {}, {}],
    }),
    3,
  );
  assert.equal(
    detectAvailableParallelism({
      availableParallelism: () => 0,
      cpus: () => [],
    }),
    1,
  );
});

test('CPU reserve defaults to one, accepts zero, and rejects invalid values', () => {
  assert.equal(DEFAULT_CPU_RESERVE, 1);
  assert.equal(normalizeNonNegativeCpuCount('0'), 0);
  assert.equal(normalizeNonNegativeCpuCount('0.5'), 1);
  assert.equal(normalizeNonNegativeCpuCount('2.9'), 3);
  assert.equal(normalizeNonNegativeCpuCount(''), null);
  assert.equal(normalizeNonNegativeCpuCount('-1'), null);
  assert.equal(normalizeNonNegativeCpuCount('invalid'), null);
});

test('raw CPU ceilings are resolved before reserving capacity for sibling containers', () => {
  const v2Path = CGROUP_V2_CPU_MAX_PATHS[0];
  assert.equal(
    resolveProcessCpuBudget({
      env: { SAMSAR_PROCESS_CPU_LIMIT: '5.9' },
      availableParallelism: () => 8,
      readFileSync: createFileReader({ [v2Path]: '290000 100000' }),
    }),
    1,
  );
  assert.equal(
    resolveProcessCpuBudget({
      env: { SAMSAR_PROCESS_CPU_LIMIT: '2.9' },
      availableParallelism: () => 8,
      readFileSync: createFileReader(),
    }),
    1,
  );
  assert.equal(
    resolveProcessCpuBudget({
      env: { SAMSAR_PROCESS_CPU_LIMIT: '0.5' },
      availableParallelism: () => 8,
      readFileSync: createFileReader(),
    }),
    1,
  );
  assert.equal(
    resolveProcessCpuBudget({
      env: {
        SAMSAR_PROCESS_CPU_LIMIT: '5',
        SAMSAR_CPU_RESERVE: '0',
      },
      availableParallelism: () => 8,
      readFileSync: createFileReader(),
    }),
    5,
  );
  assert.equal(
    resolveProcessCpuBudget({
      env: {
        SAMSAR_PROCESS_CPU_LIMIT: '6',
        SAMSAR_CPU_RESERVE: '2',
      },
      availableParallelism: () => 8,
      readFileSync: createFileReader(),
    }),
    4,
  );
  assert.equal(
    resolveProcessCpuBudget({
      env: { SAMSAR_CPU_RESERVE: '99' },
      availableParallelism: () => 3,
      readFileSync: createFileReader(),
    }),
    1,
  );
});

test('cluster child budget is applied after reserve and is not reserved twice', () => {
  assert.equal(
    resolveProcessCpuBudget({
      env: {
        SAMSAR_PROCESS_CPU_LIMIT: '6',
        SAMSAR_PROCESS_CPU_BUDGET: '2',
      },
      availableParallelism: () => 8,
      readFileSync: createFileReader(),
    }),
    2,
  );
  assert.equal(
    resolveProcessCpuBudget({
      env: {
        SAMSAR_PROCESS_CPU_LIMIT: '8',
        SAMSAR_PROCESS_CPU_BUDGET: '4',
      },
      availableParallelism: () => 8,
      readFileSync: createFileReader(),
    }),
    4,
  );
});

test('configured concurrency values remain positive CPU-aware upper bounds', () => {
  assert.equal(
    resolveCpuUpperBound({
      configuredValues: ['invalid', '7.8'],
      defaultUpperBound: 2,
      cpuBudget: 4,
    }),
    4,
  );
  assert.equal(
    resolveCpuUpperBound({
      configuredValues: ['0'],
      defaultUpperBound: 2,
      cpuBudget: 8,
    }),
    2,
  );
  assert.equal(
    resolveCpuUpperBound({
      configuredValues: ['12'],
      defaultUpperBound: 2,
      cpuBudget: 1,
    }),
    1,
  );
});

test('processor workers divide the CPU ceiling without multiplying it', () => {
  assert.deepEqual(distributeCpuBudget(5, 2), [3, 2]);
  assert.deepEqual(distributeCpuBudget(2, 8), [1, 1]);

  assert.deepEqual(
    resolveProcessorWorkerPlan({
      env: {},
      cpuBudget: 5,
    }),
    {
      totalCpuBudget: 5,
      workerCount: 2,
      workerCpuBudgets: [3, 2],
    },
  );
  assert.deepEqual(
    resolveProcessorWorkerPlan({
      env: { SAMSAR_PROCESSOR_MAX_WORKERS: '8' },
      cpuBudget: 3,
    }),
    {
      totalCpuBudget: 3,
      workerCount: 3,
      workerCpuBudgets: [1, 1, 1],
    },
  );
});

test('processor interactive-media and FFmpeg caps honor env precedence on demand', () => {
  assert.equal(
    resolveProcessorInteractiveMediaTaskLimit({
      env: {},
      cpuBudget: 8,
    }),
    2,
  );
  assert.equal(
    resolveProcessorInteractiveMediaTaskLimit({
      env: { SAMSAR_PROCESSOR_MAX_INTERACTIVE_MEDIA_TASKS: '6' },
      cpuBudget: 3,
    }),
    3,
  );
  assert.equal(
    resolveProcessorFfmpegThreadLimit({
      env: {
        SAMSAR_PROCESSOR_MAX_FFMPEG_THREADS: '6',
        SAMSAR_MAX_FFMPEG_THREADS: '4',
      },
      cpuBudget: 8,
    }),
    6,
  );
  assert.equal(
    resolveProcessorFfmpegThreadLimit({
      env: {
        SAMSAR_PROCESSOR_MAX_FFMPEG_THREADS: 'invalid',
        SAMSAR_MAX_FFMPEG_THREADS: '5',
      },
      cpuBudget: 3,
    }),
    3,
  );
  assert.equal(
    resolveProcessorFfmpegThreadLimit({
      env: {},
      cpuBudget: 1,
    }),
    1,
  );
});

test('Sharp defaults to one thread and honors service/global CPU-aware ceilings', () => {
  assert.equal(
    resolveProcessorSharpThreadLimit({
      env: {},
      cpuBudget: 8,
    }),
    1,
  );
  assert.equal(
    resolveProcessorSharpThreadLimit({
      env: {
        SAMSAR_PROCESSOR_MAX_SHARP_THREADS: '6',
        SAMSAR_MAX_SHARP_THREADS: '4',
      },
      cpuBudget: 3,
    }),
    3,
  );
  assert.equal(
    resolveProcessorSharpThreadLimit({
      env: {
        SAMSAR_PROCESSOR_MAX_SHARP_THREADS: 'invalid',
        SAMSAR_MAX_SHARP_THREADS: '5',
      },
      cpuBudget: 4,
    }),
    4,
  );
});
