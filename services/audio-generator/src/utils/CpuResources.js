import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CGROUP_ROOT = '/sys/fs/cgroup';
const DEFAULT_SELF_CGROUP_PATH = '/proc/self/cgroup';

export function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(parsed));
}

export function parseNonNegativeInteger(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.ceil(parsed);
}

function readTextFile(filePath, readFileSync) {
  try {
    return String(readFileSync(filePath, 'utf8')).trim();
  } catch {
    return '';
  }
}

function parseCpuQuota(quotaValue, periodValue) {
  if (String(quotaValue).trim().toLowerCase() === 'max') {
    return null;
  }

  const quota = Number(quotaValue);
  const period = Number(periodValue);
  if (!Number.isFinite(quota) || !Number.isFinite(period) || quota <= 0 || period <= 0) {
    return null;
  }

  // A fractional CPU cannot safely satisfy a request for another whole worker.
  return Math.max(1, Math.floor(quota / period));
}

function parseCgroupMemberships(content) {
  const memberships = {
    unified: [],
    cpu: [],
  };

  for (const line of String(content || '').split(/\r?\n/)) {
    const match = line.match(/^\d+:([^:]*):(.*)$/);
    if (!match) continue;

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
  let current = path.posix.normalize(`/${String(cgroupPath || '').replace(/^\/+/, '')}`);
  const ancestors = [];

  while (true) {
    ancestors.push(current);
    if (current === '/') break;
    current = path.posix.dirname(current);
  }

  return ancestors;
}

function joinCgroupPath(root, cgroupPath, fileName) {
  const relativePath = cgroupPath === '/' ? '' : cgroupPath.replace(/^\/+/, '');
  return path.join(root, relativePath, fileName);
}

export function getCgroupCpuLimit({
  readFileSync = fs.readFileSync,
  cgroupRoot = DEFAULT_CGROUP_ROOT,
  selfCgroupPath = DEFAULT_SELF_CGROUP_PATH,
} = {}) {
  const memberships = parseCgroupMemberships(readTextFile(selfCgroupPath, readFileSync));
  const limits = [];
  const visited = new Set();

  const readV2Limit = (cgroupPath) => {
    const filePath = joinCgroupPath(cgroupRoot, cgroupPath, 'cpu.max');
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const [quota, period] = readTextFile(filePath, readFileSync).split(/\s+/);
    const limit = parseCpuQuota(quota, period);
    if (limit) limits.push(limit);
  };

  const unifiedMemberships = memberships.unified.length > 0 ? memberships.unified : ['/'];
  for (const membership of unifiedMemberships) {
    for (const ancestor of getCgroupAncestors(membership)) {
      readV2Limit(ancestor);
    }
  }

  const v1Roots = [
    cgroupRoot,
    path.join(cgroupRoot, 'cpu'),
    path.join(cgroupRoot, 'cpu,cpuacct'),
    path.join(cgroupRoot, 'cpuacct,cpu'),
  ];
  const cpuMemberships = memberships.cpu.length > 0 ? memberships.cpu : ['/'];
  for (const v1Root of v1Roots) {
    for (const membership of cpuMemberships) {
      for (const ancestor of getCgroupAncestors(membership)) {
        const quotaPath = joinCgroupPath(v1Root, ancestor, 'cpu.cfs_quota_us');
        const periodPath = joinCgroupPath(v1Root, ancestor, 'cpu.cfs_period_us');
        const key = `${quotaPath}:${periodPath}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const limit = parseCpuQuota(
          readTextFile(quotaPath, readFileSync),
          readTextFile(periodPath, readFileSync),
        );
        if (limit) limits.push(limit);
      }
    }
  }

  return limits.length > 0 ? Math.min(...limits) : null;
}

export function getAvailableCpuCount({
  env = process.env,
  availableParallelism = os.availableParallelism,
  cpus = os.cpus,
  ...cgroupOptions
} = {}) {
  const candidates = [];

  try {
    const available = typeof availableParallelism === 'function'
      ? parsePositiveInteger(availableParallelism())
      : null;
    if (available) {
      candidates.push(available);
    } else {
      const fallback = parsePositiveInteger(cpus?.()?.length);
      if (fallback) candidates.push(fallback);
    }
  } catch {
    try {
      const fallback = parsePositiveInteger(cpus()?.length);
      if (fallback) candidates.push(fallback);
    } catch {
      // The final minimum below guarantees at least one usable CPU.
    }
  }

  const cgroupLimit = getCgroupCpuLimit(cgroupOptions);
  if (cgroupLimit) candidates.push(cgroupLimit);

  const explicitProcessLimit = parsePositiveInteger(env?.SAMSAR_PROCESS_CPU_LIMIT);
  if (explicitProcessLimit) candidates.push(explicitProcessLimit);

  const detectedCpuCount = Math.max(
    1,
    candidates.length > 0 ? Math.min(...candidates) : 1,
  );
  const reservedCpuCount = parseNonNegativeInteger(env?.SAMSAR_CPU_RESERVE) ?? 1;
  const effectiveCpuCount = Math.max(1, detectedCpuCount - reservedCpuCount);

  // A parent may assign this already-reserved share to a child process.
  const assignedProcessBudget = parsePositiveInteger(env?.SAMSAR_PROCESS_CPU_BUDGET);
  return assignedProcessBudget
    ? Math.min(effectiveCpuCount, assignedProcessBudget)
    : effectiveCpuCount;
}

export function resolveCpuUpperBound(
  configuredValue,
  defaultUpperLimit,
  {
    availableCpuCount,
    ...cpuOptions
  } = {},
) {
  const upperLimit = parsePositiveInteger(configuredValue)
    ?? parsePositiveInteger(defaultUpperLimit)
    ?? 1;
  const available = parsePositiveInteger(availableCpuCount)
    ?? getAvailableCpuCount(cpuOptions);

  return Math.max(1, Math.min(upperLimit, available));
}
