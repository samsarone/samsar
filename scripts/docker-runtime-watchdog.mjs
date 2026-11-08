#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RECOVERY_POLICY, normalizeRecoveryState, assessRuntimeRecovery,
  recoveryCommand, socketPathForEndpoint, inspectDocker, quiesceDesktopJobs,
} from './docker-runtime-recovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseWatchdogOptions(args, rootDir = root) {
  const options = { root: rootDir, project: 'samsar', watch: false, recover: false,
    noJobs: false, allowJobResume: false, healthUrls: [], intervalMs: 15000,
    stateFile: path.join(rootDir, 'runtime', 'state', 'docker-runtime-watchdog.json'),
    policy: { ...DEFAULT_RECOVERY_POLICY }, expectedEngineId: '',
  };
  const numbers = new Map([
    ['--interval-ms', ['intervalMs', 1000, 300000]],
    ['--probe-timeout-ms', ['probeTimeoutMs', 1000, 30000]],
    ['--failure-threshold', ['failureThreshold', 1, 20]],
    ['--max-recoveries', ['maxRecoveries', 1, 5]],
    ['--cooldown-ms', ['cooldownMs', 30000, 3600000]],
  ]);
  const value = (index, flag) => {
    const next = args[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${flag} requires a value.`);
    return next;
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (['--watch', '--recover', '--no-jobs', '--allow-job-resume'].includes(flag)) {
      options[{ '--watch': 'watch', '--recover': 'recover', '--no-jobs': 'noJobs', '--allow-job-resume': 'allowJobResume' }[flag]] = true;
    } else if (flag === '--health-url') {
      const url = new URL(value(i++, flag));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Health URLs must use HTTP(S) without credentials, query parameters or fragments.');
      }
      options.healthUrls.push(url.href);
    } else if (flag === '--project') {
      options.project = value(i++, flag);
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(options.project)) throw new Error('Invalid Compose project name.');
    } else if (flag === '--state-file') options.stateFile = path.resolve(value(i++, flag));
    else if (flag === '--expected-engine-id') options.expectedEngineId = value(i++, flag);
    else if (numbers.has(flag)) {
      const [key, minimum, maximum] = numbers.get(flag);
      const number = Number(value(i++, flag));
      if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new Error(`Invalid ${flag}.`);
      if (key === 'intervalMs') options.intervalMs = number;
      else options.policy[key] = number;
    } else throw new Error(`Unknown watchdog option: ${flag}`);
  }
  if (options.noJobs && options.allowJobResume) throw new Error('--no-jobs and --allow-job-resume are mutually exclusive.');
  if (options.recover && !options.noJobs && !options.allowJobResume) {
    throw new Error('Recovery can restart containers; specify --no-jobs or explicitly --allow-job-resume.');
  }
  return options;
}

export function runBoundedCommand(command, args, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-32768); });
    child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(-32768); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args[0] || ''} ${signal ? 'timed out or was interrupted' : `failed (${code})`}.`));
    });
  });
}

export async function checkRuntime(options, dependencies = {}) {
  const run = dependencies.runCommand || runBoundedCommand;
  const inspect = dependencies.inspect || inspectDocker;
  const quiesce = dependencies.quiesce || quiesceDesktopJobs;
  const platform = dependencies.platform || process.platform;
  const home = dependencies.home || os.homedir();
  const now = (dependencies.now || Date.now)();
  const save = dependencies.saveState || (() => {});
  const environment = dependencies.environment || process.env;
  let state = normalizeRecoveryState(dependencies.state);
  // Match Docker CLI precedence: DOCKER_CONTEXT overrides DOCKER_HOST. Ignoring
  // an explicit host could restart a different local engine than the caller uses.
  const endpoint = environment.DOCKER_HOST && !environment.DOCKER_CONTEXT
    ? environment.DOCKER_HOST
    : JSON.parse((await run('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
      { timeoutMs: options.policy.probeTimeoutMs })).trim());
  if (typeof endpoint !== 'string') throw new Error('Unable to determine the active Docker endpoint.');
  // Check this before issuing commands: a remote active context must never
  // cause a restart of an unrelated local Docker service.
  const socket = socketPathForEndpoint(endpoint);
  let engineHealthy = false;
  let engineError = '';
  try {
    const engine = await inspect(socket, undefined, options.policy.probeTimeoutMs);
    if (options.expectedEngineId && options.expectedEngineId !== engine.id) {
      const error = new Error('Active Docker engine does not match the expected identity.');
      error.code = 'DOCKER_ENGINE_IDENTITY_MISMATCH';
      throw error;
    }
    state.engineId = engine.id;
    engineHealthy = true;
  } catch (error) {
    if (error.code === 'DOCKER_ENGINE_IDENTITY_MISMATCH') throw error;
    engineError = error.message;
  }
  const decision = assessRuntimeRecovery(state, { engineHealthy, now, recover: options.recover, policy: options.policy });
  state = decision.state;
  await save(state);
  const report = { at: new Date(now).toISOString(), engineHealthy, action: decision.action,
    consecutiveFailures: state.failures, recoveriesInWindow: state.recoveryTimes.length };
  if (engineError) report.error = engineError;
  if (engineHealthy && options.healthUrls.length) {
    const fetchHealth = dependencies.fetchHealth || (async (url, timeoutMs) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      await response.body?.cancel();
      return response.status;
    });
    report.applicationHealth = await Promise.all(options.healthUrls.map(async url => {
      try { return { url, status: await fetchHealth(url, options.policy.probeTimeoutMs) }; }
      catch { return { url, status: null }; }
    }));
    if (report.applicationHealth.some(probe => probe.status !== 200)) {
      report.action = 'application_unhealthy';
      report.error = 'Docker is reachable; application failure does not justify restarting the VM.';
    }
  }
  if (decision.action === 'recover') {
    const command = recoveryCommand(platform, endpoint);
    if (options.noJobs) {
      const result = await quiesce({ root: options.root, project: options.project,
        expectedEngineId: options.expectedEngineId || state.engineId,
        platform, home, socketPath: path.join(home, 'Library', 'Containers', 'com.docker.docker', 'Data', 'docker.raw.sock'),
      });
      report.stoppedServices = result.stoppedServices;
    }
    await run(command.command, command.args, { timeoutMs: 120000 });
    report.action = 'recovery_issued';
  }
  return { report, state };
}

function readState(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state?.version !== 1 || typeof state.engineId !== 'string' ||
        !Number.isSafeInteger(state.failures) || state.failures < 0 ||
        !Array.isArray(state.recoveryTimes) || !state.recoveryTimes.every(Number.isFinite)) throw new Error('Invalid state');
    return state;
  } catch {
    throw new Error('Watchdog state is unreadable; refusing to reset the recovery budget.');
  }
}

function saveState(file, state) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function acquireLock(file) {
  const lock = `${file}.lock`;
  const token = randomUUID();
  const create = () => {
    const fd = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
    fs.closeSync(fd);
  };
  try { create(); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch {
      throw new Error('Watchdog lock is unreadable; refusing concurrent recovery.');
    }
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('Watchdog lock owner is invalid.');
    try { process.kill(owner.pid, 0); throw new Error('Another watchdog owns this state file.'); } catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
    }
    fs.unlinkSync(lock);
    create();
  }
  return () => {
    try {
      if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock);
    } catch {}
  };
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/docker-runtime-watchdog.mjs [--watch] [--health-url URL]');
    console.log('Recovery is opt-in: --recover (--no-jobs --expected-engine-id ID | --allow-job-resume).');
    console.log('Optional: --project NAME --state-file FILE --interval-ms N --probe-timeout-ms N --failure-threshold N --max-recoveries N --cooldown-ms N.');
    return;
  }
  const options = parseWatchdogOptions(process.argv.slice(2));
  fs.mkdirSync(path.dirname(options.stateFile), { recursive: true, mode: 0o700 });
  const release = acquireLock(options.stateFile);
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    let state = readState(options.stateFile);
    do {
      const result = await checkRuntime(options, { state, saveState: value => saveState(options.stateFile, value) });
      state = result.state;
      console.log(JSON.stringify(result.report));
      if (result.report.action === 'exhausted') { process.exitCode = 2; break; }
      if (!options.watch) {
        process.exitCode = ['healthy', 'recovery_issued'].includes(result.report.action) ? 0 : 2;
        break;
      }
      const until = Date.now() + options.intervalMs;
      while (!stopped && Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(500, until - Date.now())));
    } while (!stopped);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
