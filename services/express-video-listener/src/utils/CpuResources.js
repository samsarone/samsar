import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function toPositiveCpuCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(number));
}

function toNonNegativeInteger(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.ceil(number);
}

function readText(filePath, readFile) {
  try {
    return String(readFile(filePath, 'utf8')).trim();
  } catch {
    return null;
  }
}

function parseCgroupV2CpuMax(value) {
  if (!value) {
    return null;
  }
  const [quotaValue, periodValue] = value.trim().split(/\s+/);
  if (quotaValue === 'max') {
    return null;
  }
  const quota = Number(quotaValue);
  const period = Number(periodValue);
  if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(quota / period));
}

function parseCgroupV1CpuQuota(quotaValue, periodValue) {
  const quota = Number(quotaValue);
  const period = Number(periodValue);
  if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(quota / period));
}

function parseSelfCgroup(value) {
  const result = {
    v2Path: null,
    v1CpuPath: null,
  };
  if (!value) {
    return result;
  }

  for (const line of value.split(/\r?\n/)) {
    const firstColon = line.indexOf(':');
    const secondColon = line.indexOf(':', firstColon + 1);
    if (firstColon < 0 || secondColon < 0) {
      continue;
    }
    const hierarchy = line.slice(0, firstColon);
    const controllers = line.slice(firstColon + 1, secondColon);
    const groupPath = line.slice(secondColon + 1);
    if (hierarchy === '0' && controllers === '') {
      result.v2Path = groupPath;
    }
    if (controllers.split(',').includes('cpu')) {
      result.v1CpuPath = groupPath;
    }
  }
  return result;
}

function safeRelativeCgroupPath(groupPath) {
  return String(groupPath || '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function getCgroupPathPrefixes(groupPath) {
  const parts = safeRelativeCgroupPath(groupPath).split('/').filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function pushUnique(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

export function getCgroupCpuLimit({
  platform = process.platform,
  readFile = readFileSync,
} = {}) {
  if (platform !== 'linux') {
    return null;
  }

  const selfCgroup = parseSelfCgroup(readText('/proc/self/cgroup', readFile));
  const limits = [];
  const v2Candidates = ['/sys/fs/cgroup/cpu.max'];
  for (const v2RelativePath of getCgroupPathPrefixes(selfCgroup.v2Path)) {
    pushUnique(v2Candidates, path.join('/sys/fs/cgroup', v2RelativePath, 'cpu.max'));
  }

  for (const cpuMaxPath of v2Candidates) {
    const limit = parseCgroupV2CpuMax(readText(cpuMaxPath, readFile));
    if (limit !== null) {
      limits.push(limit);
    }
  }

  const v1Roots = [
    '/sys/fs/cgroup/cpu',
    '/sys/fs/cgroup/cpu,cpuacct',
    '/sys/fs/cgroup/cpuacct,cpu',
  ];
  const v1RelativePaths = getCgroupPathPrefixes(selfCgroup.v1CpuPath);
  const v1Candidates = [];
  for (const root of v1Roots) {
    v1Candidates.push({
      quotaPath: path.join(root, 'cpu.cfs_quota_us'),
      periodPath: path.join(root, 'cpu.cfs_period_us'),
    });
    for (const v1RelativePath of v1RelativePaths) {
      v1Candidates.push({
        quotaPath: path.join(root, v1RelativePath, 'cpu.cfs_quota_us'),
        periodPath: path.join(root, v1RelativePath, 'cpu.cfs_period_us'),
      });
    }
  }

  for (const candidate of v1Candidates) {
    const quotaValue = readText(candidate.quotaPath, readFile);
    const periodValue = readText(candidate.periodPath, readFile);
    const limit = parseCgroupV1CpuQuota(quotaValue, periodValue);
    if (limit !== null) {
      limits.push(limit);
    }
  }

  return limits.length > 0 ? Math.min(...limits) : null;
}

export function getAvailableCpuCount({
  env = process.env,
  platform = process.platform,
  readFile = readFileSync,
  availableParallelism = os.availableParallelism,
  cpus = os.cpus,
} = {}) {
  let detectedCount = null;
  if (typeof availableParallelism === 'function') {
    try {
      detectedCount = toPositiveCpuCount(availableParallelism());
    } catch {
      detectedCount = null;
    }
  }
  if (detectedCount === null && typeof cpus === 'function') {
    try {
      const cpuList = cpus();
      detectedCount = toPositiveCpuCount(Array.isArray(cpuList) ? cpuList.length : null);
    } catch {
      detectedCount = null;
    }
  }

  const candidates = [detectedCount || 1];
  const cgroupLimit = getCgroupCpuLimit({ platform, readFile });
  if (cgroupLimit !== null) {
    candidates.push(cgroupLimit);
  }
  const configuredProcessLimit = toPositiveCpuCount(env?.SAMSAR_PROCESS_CPU_LIMIT);
  if (configuredProcessLimit !== null) {
    candidates.push(configuredProcessLimit);
  }
  return Math.max(1, Math.min(...candidates));
}

export function resolveCpuCeiling({
  defaultCeiling = 1,
  envNames = [],
  env = process.env,
  ...cpuOptions
} = {}) {
  let ceiling = toPositiveCpuCount(defaultCeiling) || 1;
  for (const envName of envNames) {
    const configuredCeiling = toPositiveCpuCount(env?.[envName]);
    if (configuredCeiling !== null) {
      ceiling = configuredCeiling;
      break;
    }
  }
  const availableCpuCount = getAvailableCpuCount({
    ...cpuOptions,
    env,
  });
  const configuredReserve = toNonNegativeInteger(env?.SAMSAR_CPU_RESERVE);
  const reservedCpuCount = configuredReserve ?? 1;
  const heavyWorkCpuCount = Math.max(1, availableCpuCount - reservedCpuCount);
  return Math.min(
    ceiling,
    heavyWorkCpuCount,
  );
}

export function createOnDemandWeightedPool({ getCapacity }) {
  if (typeof getCapacity !== 'function') {
    throw new TypeError('createOnDemandWeightedPool requires getCapacity');
  }

  let activeWeight = 0;
  const pending = [];

  function resolveCapacity() {
    try {
      return toPositiveCpuCount(getCapacity()) || 1;
    } catch {
      return 1;
    }
  }

  function drain() {
    while (pending.length > 0) {
      const capacity = resolveCapacity();
      const next = pending[0];
      const grantedWeight = Math.min(next.requestedWeight, capacity);
      if (activeWeight + grantedWeight > capacity) {
        return;
      }

      pending.shift();
      activeWeight += grantedWeight;
      let released = false;
      next.resolve(() => {
        if (released) {
          return;
        }
        released = true;
        activeWeight = Math.max(0, activeWeight - grantedWeight);
        drain();
      });
    }
  }

  async function acquire(weight = 1) {
    const requestedWeight = toPositiveCpuCount(weight) || 1;
    return new Promise((resolve) => {
      pending.push({ requestedWeight, resolve });
      drain();
    });
  }

  async function run(weight, operation) {
    if (typeof operation !== 'function') {
      throw new TypeError('Pool operation must be a function');
    }
    const release = await acquire(weight);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  return {
    acquire,
    run,
    getSnapshot() {
      return {
        activeWeight,
        pendingCount: pending.length,
      };
    },
  };
}
