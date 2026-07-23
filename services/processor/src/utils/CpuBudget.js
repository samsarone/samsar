import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CGROUP_V2_CPU_MAX_PATHS = Object.freeze([
  '/sys/fs/cgroup/cpu.max',
]);

export const CGROUP_V1_CPU_QUOTA_PATHS = Object.freeze([
  Object.freeze({
    quota: '/sys/fs/cgroup/cpu/cpu.cfs_quota_us',
    period: '/sys/fs/cgroup/cpu/cpu.cfs_period_us',
  }),
  Object.freeze({
    quota: '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us',
    period: '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us',
  }),
  Object.freeze({
    quota: '/sys/fs/cgroup/cpuacct,cpu/cpu.cfs_quota_us',
    period: '/sys/fs/cgroup/cpuacct,cpu/cpu.cfs_period_us',
  }),
]);

export const DEFAULT_CPU_RESERVE = 1;
export const DEFAULT_PROCESSOR_MAX_WORKERS = 2;
export const DEFAULT_PROCESSOR_MAX_INTERACTIVE_MEDIA_TASKS = 2;
export const DEFAULT_PROCESSOR_MAX_FFMPEG_THREADS = 2;
export const DEFAULT_PROCESSOR_MAX_SHARP_THREADS = 1;

export function normalizePositiveCpuCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(parsed));
}

export function normalizeNonNegativeCpuCount(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.ceil(parsed);
}

function cpuCountFromQuota(quotaValue, periodValue) {
  const quota = Number(quotaValue);
  const period = Number(periodValue);
  if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(quota / period));
}

export function parseCgroupV2CpuMax(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const [quota, period] = value.trim().split(/\s+/);
  if (!quota || quota === 'max' || !period) {
    return null;
  }
  return cpuCountFromQuota(quota, period);
}

export function parseCgroupV1CpuQuota(quotaValue, periodValue) {
  return cpuCountFromQuota(
    typeof quotaValue === 'string' ? quotaValue.trim() : quotaValue,
    typeof periodValue === 'string' ? periodValue.trim() : periodValue,
  );
}

function readTextFile(filePath, readFileSync) {
  try {
    const value = readFileSync(filePath, 'utf8');
    return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  } catch {
    return null;
  }
}

function parseCgroupMemberships(value) {
  const memberships = {
    unified: [],
    cpu: [],
  };

  for (const line of String(value || '').split(/\r?\n/)) {
    const match = line.match(/^\d+:([^:]*):(.*)$/);
    if (!match) {
      continue;
    }

    const controllers = match[1];
    const cgroupPath = match[2] || '/';
    if (!controllers) {
      memberships.unified.push(cgroupPath);
    } else if (controllers.split(',').includes('cpu')) {
      memberships.cpu.push(cgroupPath);
    }
  }

  return memberships;
}

function getCgroupAncestors(cgroupPath) {
  let current = path.posix.normalize(
    `/${String(cgroupPath || '').replace(/^\/+/, '')}`,
  );
  const ancestors = [];

  while (true) {
    ancestors.push(current);
    if (current === '/') {
      return ancestors;
    }
    current = path.posix.dirname(current);
  }
}

function joinCgroupPath(root, cgroupPath, fileName) {
  const relativePath = cgroupPath === '/'
    ? ''
    : cgroupPath.replace(/^\/+/, '');
  return path.join(root, relativePath, fileName);
}

export function detectCgroupCpuLimit({
  readFileSync = fs.readFileSync,
  cgroupV2Paths = CGROUP_V2_CPU_MAX_PATHS,
  cgroupV1Paths = CGROUP_V1_CPU_QUOTA_PATHS,
  cgroupRoot = '/sys/fs/cgroup',
  selfCgroupPath = '/proc/self/cgroup',
} = {}) {
  const limits = [];
  const visited = new Set();
  const memberships = parseCgroupMemberships(
    readTextFile(selfCgroupPath, readFileSync),
  );
  const v2Candidates = [...cgroupV2Paths];
  const v1Candidates = [...cgroupV1Paths];

  for (const membership of memberships.unified) {
    for (const ancestor of getCgroupAncestors(membership)) {
      v2Candidates.push(joinCgroupPath(cgroupRoot, ancestor, 'cpu.max'));
    }
  }

  const v1Roots = [
    path.join(cgroupRoot, 'cpu'),
    path.join(cgroupRoot, 'cpu,cpuacct'),
    path.join(cgroupRoot, 'cpuacct,cpu'),
  ];
  for (const membership of memberships.cpu) {
    for (const root of v1Roots) {
      for (const ancestor of getCgroupAncestors(membership)) {
        v1Candidates.push({
          quota: joinCgroupPath(root, ancestor, 'cpu.cfs_quota_us'),
          period: joinCgroupPath(root, ancestor, 'cpu.cfs_period_us'),
        });
      }
    }
  }

  for (const cpuMaxPath of v2Candidates) {
    if (visited.has(cpuMaxPath)) {
      continue;
    }
    visited.add(cpuMaxPath);
    const limit = parseCgroupV2CpuMax(readTextFile(cpuMaxPath, readFileSync));
    if (limit !== null) {
      limits.push(limit);
    }
  }

  for (const paths of v1Candidates) {
    const key = `${paths.quota}:${paths.period}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    const limit = parseCgroupV1CpuQuota(
      readTextFile(paths.quota, readFileSync),
      readTextFile(paths.period, readFileSync),
    );
    if (limit !== null) {
      limits.push(limit);
    }
  }

  return limits.length > 0 ? Math.min(...limits) : null;
}

export function detectAvailableParallelism({
  availableParallelism = os.availableParallelism,
  cpus = os.cpus,
} = {}) {
  try {
    const detected = normalizePositiveCpuCount(availableParallelism());
    if (detected !== null) {
      return detected;
    }
  } catch {
    // Older or unusual runtimes can fall back to the online logical CPU list.
  }

  try {
    const cpuList = cpus();
    const detected = normalizePositiveCpuCount(Array.isArray(cpuList) ? cpuList.length : null);
    if (detected !== null) {
      return detected;
    }
  } catch {
    // A process must always retain at least one unit of usable CPU budget.
  }

  return 1;
}

export function resolveProcessCpuBudget(options = {}) {
  const env = options.env || process.env;
  const availableCpuCount = detectAvailableParallelism(options);
  const cgroupCpuLimit = detectCgroupCpuLimit(options);
  const configuredCpuLimit = normalizePositiveCpuCount(env.SAMSAR_PROCESS_CPU_LIMIT);
  const rawCpuLimits = [
    availableCpuCount,
    cgroupCpuLimit,
    configuredCpuLimit,
  ].filter((value) => value !== null);
  const rawCpuBudget = Math.max(1, Math.min(...rawCpuLimits));
  const configuredReserve = normalizeNonNegativeCpuCount(env.SAMSAR_CPU_RESERVE);
  const requestedReserve = configuredReserve ?? DEFAULT_CPU_RESERVE;
  const reservedCpuCount = Math.min(
    requestedReserve,
    Math.max(0, rawCpuBudget - 1),
  );
  const heavyWorkCpuBudget = rawCpuBudget - reservedCpuCount;

  // Cluster children receive an already-reserved share from the primary. Apply
  // that internal ceiling after calculating the host/container reserve so the
  // assigned share is not reduced by SAMSAR_CPU_RESERVE a second time.
  const assignedWorkerCpuBudget = normalizePositiveCpuCount(
    env.SAMSAR_PROCESS_CPU_BUDGET,
  );

  return assignedWorkerCpuBudget === null
    ? heavyWorkCpuBudget
    : Math.max(1, Math.min(heavyWorkCpuBudget, assignedWorkerCpuBudget));
}

export function resolveCpuUpperBound({
  configuredValues = [],
  defaultUpperBound = 1,
  cpuBudget = 1,
} = {}) {
  const candidates = Array.isArray(configuredValues)
    ? configuredValues
    : [configuredValues];
  const configuredUpperBound = candidates
    .map(normalizePositiveCpuCount)
    .find((value) => value !== null);
  const fallbackUpperBound = normalizePositiveCpuCount(defaultUpperBound) || 1;
  const normalizedCpuBudget = normalizePositiveCpuCount(cpuBudget) || 1;

  return Math.max(
    1,
    Math.min(configuredUpperBound || fallbackUpperBound, normalizedCpuBudget),
  );
}

export function distributeCpuBudget(cpuBudget, requestedWorkerCount) {
  const normalizedCpuBudget = normalizePositiveCpuCount(cpuBudget) || 1;
  const normalizedWorkerCount = Math.min(
    normalizePositiveCpuCount(requestedWorkerCount) || 1,
    normalizedCpuBudget,
  );
  const baseBudget = Math.floor(normalizedCpuBudget / normalizedWorkerCount);
  const remainder = normalizedCpuBudget % normalizedWorkerCount;

  return Array.from(
    { length: normalizedWorkerCount },
    (_, index) => baseBudget + (index < remainder ? 1 : 0),
  );
}

function getCpuBudget(options) {
  const explicitBudget = normalizePositiveCpuCount(options.cpuBudget);
  return explicitBudget || resolveProcessCpuBudget(options);
}

export function resolveProcessorWorkerPlan(options = {}) {
  const env = options.env || process.env;
  const totalCpuBudget = getCpuBudget(options);
  const workerCount = resolveCpuUpperBound({
    configuredValues: [env.SAMSAR_PROCESSOR_MAX_WORKERS],
    defaultUpperBound: DEFAULT_PROCESSOR_MAX_WORKERS,
    cpuBudget: totalCpuBudget,
  });

  return {
    totalCpuBudget,
    workerCount,
    workerCpuBudgets: distributeCpuBudget(totalCpuBudget, workerCount),
  };
}

export function resolveProcessorInteractiveMediaTaskLimit(options = {}) {
  const env = options.env || process.env;
  return resolveCpuUpperBound({
    configuredValues: [env.SAMSAR_PROCESSOR_MAX_INTERACTIVE_MEDIA_TASKS],
    defaultUpperBound: DEFAULT_PROCESSOR_MAX_INTERACTIVE_MEDIA_TASKS,
    cpuBudget: getCpuBudget(options),
  });
}

export function resolveProcessorFfmpegThreadLimit(options = {}) {
  const env = options.env || process.env;
  return resolveCpuUpperBound({
    configuredValues: [
      env.SAMSAR_PROCESSOR_MAX_FFMPEG_THREADS,
      env.SAMSAR_MAX_FFMPEG_THREADS,
    ],
    defaultUpperBound: DEFAULT_PROCESSOR_MAX_FFMPEG_THREADS,
    cpuBudget: getCpuBudget(options),
  });
}

export function resolveProcessorSharpThreadLimit(options = {}) {
  const env = options.env || process.env;
  return resolveCpuUpperBound({
    configuredValues: [
      env.SAMSAR_PROCESSOR_MAX_SHARP_THREADS,
      env.SAMSAR_MAX_SHARP_THREADS,
    ],
    defaultUpperBound: DEFAULT_PROCESSOR_MAX_SHARP_THREADS,
    cpuBudget: getCpuBudget(options),
  });
}
