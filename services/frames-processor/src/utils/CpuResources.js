import { readFileSync } from 'node:fs';
import os from 'node:os';

const CGROUP_V2_CPU_MAX_PATHS = [
  '/sys/fs/cgroup/cpu.max',
];

const CGROUP_V1_CPU_QUOTA_PATHS = [
  [
    '/sys/fs/cgroup/cpu/cpu.cfs_quota_us',
    '/sys/fs/cgroup/cpu/cpu.cfs_period_us',
  ],
  [
    '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us',
    '/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us',
  ],
  [
    '/sys/fs/cgroup/cpuacct,cpu/cpu.cfs_quota_us',
    '/sys/fs/cgroup/cpuacct,cpu/cpu.cfs_period_us',
  ],
];

function normalizeCgroupPath(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

function getCgroupPathPrefixes(value) {
  const segments = normalizeCgroupPath(value).split('/').filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

export function parsePositiveInteger(value) {
  if (typeof value === 'string' && !value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.floor(parsed))
    : null;
}

export function parseNonNegativeInteger(value) {
  if (typeof value === 'string' && !value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.ceil(parsed)
    : null;
}

function cpuCountFromQuota(quota, period) {
  const parsedQuota = Number(quota);
  const parsedPeriod = Number(period);
  if (
    !Number.isFinite(parsedQuota) ||
    !Number.isFinite(parsedPeriod) ||
    parsedQuota <= 0 ||
    parsedPeriod <= 0
  ) {
    return null;
  }

  return Math.max(1, Math.floor(parsedQuota / parsedPeriod));
}

export function parseCgroupV2CpuMax(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const [quota, period] = value.trim().split(/\s+/);
  if (!quota || !period || quota === 'max') {
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

function readTextFile(filePath, readFile = readFileSync) {
  try {
    return readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function getCgroupCpuPaths(readFile) {
  const v2CpuMaxPaths = [...CGROUP_V2_CPU_MAX_PATHS];
  const v1CpuQuotaPaths = [...CGROUP_V1_CPU_QUOTA_PATHS];
  const membership = readTextFile('/proc/self/cgroup', readFile);
  if (!membership) {
    return { v2CpuMaxPaths, v1CpuQuotaPaths };
  }

  for (const line of membership.split(/\r?\n/)) {
    const [hierarchyId, controllers = '', ...cgroupPathParts] = line.split(':');
    const relativePaths = getCgroupPathPrefixes(cgroupPathParts.join(':'));
    if (relativePaths.length === 0) {
      continue;
    }

    if (hierarchyId === '0' && !controllers) {
      for (const relativePath of relativePaths) {
        v2CpuMaxPaths.push(`/sys/fs/cgroup/${relativePath}/cpu.max`);
      }
      continue;
    }

    if (controllers.split(',').includes('cpu')) {
      for (const [quotaPath, periodPath] of CGROUP_V1_CPU_QUOTA_PATHS) {
        const quotaBase = quotaPath.slice(0, -'/cpu.cfs_quota_us'.length);
        const periodBase = periodPath.slice(0, -'/cpu.cfs_period_us'.length);
        for (const relativePath of relativePaths) {
          v1CpuQuotaPaths.push([
            `${quotaBase}/${relativePath}/cpu.cfs_quota_us`,
            `${periodBase}/${relativePath}/cpu.cfs_period_us`,
          ]);
        }
      }
    }
  }

  return { v2CpuMaxPaths, v1CpuQuotaPaths };
}

export function detectCgroupCpuLimit({ readFile = readFileSync } = {}) {
  const limits = [];
  const { v2CpuMaxPaths, v1CpuQuotaPaths } = getCgroupCpuPaths(readFile);

  for (const filePath of v2CpuMaxPaths) {
    const parsed = parseCgroupV2CpuMax(readTextFile(filePath, readFile));
    if (parsed !== null) {
      limits.push(parsed);
    }
  }

  for (const [quotaPath, periodPath] of v1CpuQuotaPaths) {
    const parsed = parseCgroupV1CpuQuota(
      readTextFile(quotaPath, readFile),
      readTextFile(periodPath, readFile),
    );
    if (parsed !== null) {
      limits.push(parsed);
    }
  }

  return limits.length > 0 ? Math.min(...limits) : null;
}

export function getCpuResourceBudget({
  env = process.env,
  availableParallelism = os.availableParallelism,
  logicalCpuCount = () => os.cpus().length,
  readFile = readFileSync,
} = {}) {
  let hostParallelism = null;
  try {
    hostParallelism = parsePositiveInteger(availableParallelism?.());
  } catch {
    hostParallelism = null;
  }

  if (hostParallelism === null) {
    try {
      hostParallelism = parsePositiveInteger(logicalCpuCount?.());
    } catch {
      hostParallelism = null;
    }
  }

  const candidates = [
    hostParallelism || 1,
    detectCgroupCpuLimit({ readFile }),
    parsePositiveInteger(env?.SAMSAR_PROCESS_CPU_LIMIT),
  ].filter((value) => value !== null);

  const detectedCpuCount = Math.max(1, Math.min(...candidates));
  const configuredCpuReserve = parseNonNegativeInteger(env?.SAMSAR_CPU_RESERVE) ?? 1;
  const cpuReserve = Math.min(configuredCpuReserve, Math.max(0, detectedCpuCount - 1));
  const heavyWorkCpuBudget = Math.max(1, detectedCpuCount - cpuReserve);

  return {
    detectedCpuCount,
    configuredCpuReserve,
    cpuReserve,
    heavyWorkCpuBudget,
  };
}

export function getAvailableCpuCount(options = {}) {
  return getCpuResourceBudget(options).heavyWorkCpuBudget;
}

export function getHeavyWorkCpuBudget(options = {}) {
  return getCpuResourceBudget(options).heavyWorkCpuBudget;
}

export class WeightedCpuResourcePool {
  constructor(capacity) {
    const parsedCapacity = parsePositiveInteger(capacity);
    if (parsedCapacity === null) {
      throw new TypeError('CPU resource pool capacity must be a positive integer.');
    }

    this.capacity = parsedCapacity;
    this._available = parsedCapacity;
    this._queue = [];
  }

  get available() {
    return this._available;
  }

  get pending() {
    return this._queue.length;
  }

  acquire(weight = 1) {
    const parsedWeight = parsePositiveInteger(weight);
    if (parsedWeight === null) {
      return Promise.reject(new TypeError('CPU resource weight must be a positive integer.'));
    }
    if (parsedWeight > this.capacity) {
      return Promise.reject(
        new RangeError(`CPU resource weight ${parsedWeight} exceeds pool capacity ${this.capacity}.`),
      );
    }

    return new Promise((resolve) => {
      this._queue.push({ weight: parsedWeight, resolve });
      this._drain();
    });
  }

  async run(weight, task) {
    if (typeof task !== 'function') {
      throw new TypeError('CPU resource task must be a function.');
    }

    const release = await this.acquire(weight);
    try {
      return await task();
    } finally {
      release();
    }
  }

  _drain() {
    while (this._queue.length > 0) {
      const next = this._queue[0];
      if (next.weight > this._available) {
        return;
      }

      this._queue.shift();
      this._available -= next.weight;
      let released = false;

      next.resolve(() => {
        if (released) {
          return;
        }
        released = true;
        this._available += next.weight;
        this._drain();
      });
    }
  }
}
