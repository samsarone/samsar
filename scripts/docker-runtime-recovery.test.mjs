import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  DEFAULT_RECOVERY_POLICY, assessRuntimeRecovery, recoveryCommand,
  quiesceDesktopJobs, requestDocker,
} from './docker-runtime-recovery.mjs';
import { checkRuntime, parseWatchdogOptions } from './docker-runtime-watchdog.mjs';
import { JOB_CONSUMER_SERVICES, getJobsDisabledOverride, resolveJobsDisabledOverride } from './docker-maintenance.mjs';

const policy = { ...DEFAULT_RECOVERY_POLICY, cooldownMs: 100, recoveryWindowMs: 1000 };
const home = '/Users/operator';
const root = '/workspace/samsar';
const rawSocket = `${home}/Library/Containers/com.docker.docker/Data/docker.raw.sock`;
const processorId = 'a'.repeat(64);
const audioId = 'b'.repeat(64);
const projectLabels = service => ({
  'com.docker.compose.project': 'samsar', 'com.docker.compose.service': service,
  'com.docker.compose.project.working_dir': `${root}/deploy/compose`,
  'com.docker.compose.project.config_files': `${root}/deploy/compose/docker-compose.yml,${root}/runtime/config/compose.bind-content.json`,
});

function rawFixture({ id = 'engine-one', foreign = false, foreignStopped = false, foreignRestart = 'no', stopFails = false, stillRunning = false, badProject = false } = {}) {
  const calls = [];
  const containers = [
    { Id: processorId, State: 'running', Names: ['/samsar-processor-1'], Labels: projectLabels('processor') },
    { Id: audioId, State: 'running', Names: ['/samsar-audio-generator-1'], Labels: projectLabels('audio-generator') },
    { Id: 'c'.repeat(64), State: 'running', Names: ['/samsar-mongo-1'], Labels: projectLabels('mongo') },
  ];
  if (badProject) containers[0].Labels['com.docker.compose.project.working_dir'] = '/other/project';
  if (foreign) containers.push({ Id: 'd'.repeat(64), State: 'running', Names: ['/other-worker'], Labels: {} });
  if (foreignStopped) containers.push({ Id: 'd'.repeat(64), State: 'exited', Names: ['/other-worker'], Labels: {} });
  return { calls, async request(socket, method, url, body) {
    assert.equal(socket, rawSocket);
    calls.push({ method, url, body });
    if (url === '/info') return { status: 200, data: { ID: id } };
    if (url === '/containers/json?all=1') return { status: 200, data: containers };
    if (url.endsWith('/update')) return { status: 200, data: {} };
    if (url.includes('/stop?')) {
      if (!stopFails) containers.find(container => url.includes(container.Id)).State = 'exited';
      return { status: stopFails ? 500 : 204 };
    }
    if (url.endsWith('/json')) return { status: 200, data: { State: { Running: stillRunning }, HostConfig: { RestartPolicy: { Name: url.includes('d'.repeat(64)) ? foreignRestart : 'no' } } } };
    throw new Error(`Unexpected Docker API operation ${method} ${url}`);
  } };
}

test('default watchdog reports a fault without issuing recovery', () => {
  const options = parseWatchdogOptions([]);
  const result = assessRuntimeRecovery({}, { engineHealthy: false, now: 1000, recover: options.recover, policy });
  assert.equal(result.action, 'report');
  assert.deepEqual(result.state.recoveryTimes, []);
});

test('transient outages require consecutive failures and a healthy probe resets the threshold', () => {
  let state = {};
  for (const now of [1, 2]) {
    const result = assessRuntimeRecovery(state, { engineHealthy: false, now, recover: true, policy });
    assert.equal(result.action, 'waiting'); state = result.state;
  }
  state = assessRuntimeRecovery(state, { engineHealthy: true, now: 3, recover: true, policy }).state;
  assert.equal(state.failures, 0);
  for (const now of [4, 5]) state = assessRuntimeRecovery(state, { engineHealthy: false, now, recover: true, policy }).state;
  const result = assessRuntimeRecovery(state, { engineHealthy: false, now: 6, recover: true, policy });
  assert.equal(result.action, 'recover');
  assert.deepEqual(result.state.recoveryTimes, [6]);
});

test('cooldown and persisted rolling budget prevent endless restarts, including clock rollback', () => {
  let state = { failures: 3, recoveryTimes: [100] };
  assert.equal(assessRuntimeRecovery(state, { engineHealthy: false, now: 150, recover: true, policy }).action, 'cooldown');
  state = assessRuntimeRecovery(state, { engineHealthy: false, now: 250, recover: true, policy }).state;
  assert.deepEqual(state.recoveryTimes, [100, 250]);
  assert.equal(assessRuntimeRecovery(state, { engineHealthy: false, now: 500, recover: true, policy }).action, 'exhausted');
  assert.equal(assessRuntimeRecovery(state, { engineHealthy: false, now: 50, recover: true, policy }).action, 'exhausted');
  assert.equal(assessRuntimeRecovery(state, { engineHealthy: false, now: 1300, recover: true, policy }).action, 'recover');
});

test('recovery must explicitly choose whether queue consumers may resume', () => {
  assert.throws(() => parseWatchdogOptions(['--recover']), /can restart containers/);
  assert.throws(() => parseWatchdogOptions(['--recover', '--no-jobs', '--allow-job-resume']), /mutually exclusive/);
  assert.throws(() => parseWatchdogOptions(['--health-url', 'https://user:secret@example.test/health']), /without credentials/);
  assert.throws(() => parseWatchdogOptions(['--max-recoveries', '100']), /Invalid/);
});

test('platform recovery never selects a different host or privilege scope', () => {
  assert.deepEqual(recoveryCommand('darwin', 'unix:///Users/operator/.docker/run/docker.sock'), { command: 'docker', args: ['desktop', 'restart'] });
  assert.deepEqual(recoveryCommand('linux', 'unix:///var/run/docker.sock'), { command: 'systemctl', args: ['--no-ask-password', 'restart', 'docker.service'] });
  assert.deepEqual(recoveryCommand('linux', 'unix:///home/operator/.docker/desktop/docker.sock'), { command: 'docker', args: ['desktop', 'restart'] });
  assert.throws(() => recoveryCommand('linux', 'unix:///run/user/1000/docker.sock'), /local Docker Desktop or rootful/);
  assert.throws(() => recoveryCommand('darwin', 'unix:///Users/operator/.colima/default/docker.sock'), /local Docker Desktop or rootful/);
});

test('no-jobs raw control disables all consumers before stopping and verifying them', async () => {
  const f = rawFixture();
  let maintenance = false;
  const result = await quiesceDesktopJobs({ root, home, platform: 'darwin', socketPath: rawSocket,
    expectedEngineId: 'engine-one', request: f.request, persistMaintenance: () => { maintenance = true; } });
  assert.equal(maintenance, true);
  assert.deepEqual(result.stoppedServices, ['processor', 'audio-generator']);
  const writes = f.calls.filter(call => call.method === 'POST');
  assert.deepEqual(writes.slice(0, 2).map(call => call.url), [`/containers/${processorId}/update`, `/containers/${audioId}/update`]);
  assert.ok(writes.slice(0, 2).every(call => call.body.RestartPolicy.Name === 'no'));
  assert.ok(writes.slice(2).every(call => call.url.includes('/stop?')));
  assert.equal(f.calls.some(call => /start|create|exec|delete|prune/.test(call.url)), false);
});

for (const [name, options, pattern] of [
  ['wrong engine', { id: 'other-engine' }, /identity/],
  ['foreign running workload', { foreign: true }, /unrelated running/],
  ['stopped foreign workload that could restart', { foreignStopped: true, foreignRestart: 'always' }, /automatically restart/],
  ['wrong project directory', { badProject: true }, /unrelated running/],
]) {
  test(`raw control refuses ${name} before changing any container`, async () => {
    const f = rawFixture(options);
    await assert.rejects(quiesceDesktopJobs({ root, home, platform: 'darwin', socketPath: rawSocket,
      expectedEngineId: 'engine-one', request: f.request, persistMaintenance: () => { throw new Error('must not persist'); } }), pattern);
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
  });
}

test('an unverified socket or missing engine baseline cannot quiesce any job', async () => {
  const request = () => { throw new Error('must not call Docker'); };
  await assert.rejects(quiesceDesktopJobs({ root, home, platform: 'darwin', socketPath: '/tmp/other.sock', expectedEngineId: 'engine-one', request }), /canonical/);
  await assert.rejects(quiesceDesktopJobs({ root, home, platform: 'darwin', socketPath: rawSocket, request }), /expected engine ID/);
});

test('stopped unrelated containers with restart=no cannot resume during recovery', async () => {
  const f = rawFixture({ foreignStopped: true });
  const result = await quiesceDesktopJobs({ root, home, platform: 'darwin', socketPath: rawSocket,
    expectedEngineId: 'engine-one', request: f.request, persistMaintenance: () => {} });
  assert.deepEqual(result.stoppedServices, ['processor', 'audio-generator']);
});

test('a new consumer appearing during quiescence prevents the VM restart', async () => {
  const f = rawFixture();
  let lists = 0;
  const request = async (...args) => {
    const result = await f.request(...args);
    if (args[2] === '/containers/json?all=1' && ++lists === 2) {
      result.data.push({ Id: 'e'.repeat(64), State: 'running', Names: ['/samsar-task-processor-1'], Labels: projectLabels('task-processor') });
    }
    return result;
  };
  await assert.rejects(quiesceDesktopJobs({ root, home, platform: 'darwin', socketPath: rawSocket,
    expectedEngineId: 'engine-one', request, persistMaintenance: () => {} }), /inventory changed/);
});

test('failed stop or verification never permits successful no-jobs quiescence', async () => {
  for (const options of [{ stopFails: true }, { stillRunning: true }]) {
    const f = rawFixture(options);
    await assert.rejects(quiesceDesktopJobs({ root, home, platform: 'darwin', socketPath: rawSocket,
      expectedEngineId: 'engine-one', request: f.request, persistMaintenance: () => {} }), /refusing VM restart/);
  }
});

function runtimeFixture(options = {}) {
  const calls = [];
  const selected = parseWatchdogOptions(['--recover', '--no-jobs', '--failure-threshold', '1', '--expected-engine-id', 'engine-one'], root);
  const dependencies = { platform: 'darwin', home, now: () => 1000,
    environment: {},
    inspect: async () => { throw new Error('engine unreachable'); },
    quiesce: async () => { calls.push('quiesce'); return { stoppedServices: ['processor'] }; },
    saveState: async state => { calls.push(['save', state.recoveryTimes.slice()]); },
    runCommand: async (command, args) => {
      if (args[0] === 'context') return JSON.stringify('unix:///Users/operator/.docker/run/docker.sock');
      calls.push([command, args]);
    }, ...options,
  };
  return { selected, dependencies, calls };
}

test('a no-jobs restart is recorded first, then consumers are stopped, then Desktop is restarted', async () => {
  const f = runtimeFixture();
  const result = await checkRuntime(f.selected, f.dependencies);
  assert.equal(result.report.action, 'recovery_issued');
  assert.deepEqual(f.calls, [['save', [1000]], 'quiesce', ['docker', ['desktop', 'restart']]]);
});

test('quiescence failure prevents the host restart and retains its bounded attempt', async () => {
  const f = runtimeFixture({ quiesce: async () => { throw new Error('unable to stop consumers'); } });
  await assert.rejects(checkRuntime(f.selected, f.dependencies), /unable to stop/);
  assert.deepEqual(f.calls, [['save', [1000]]]);
});

test('an unhealthy application with a healthy engine does not restart every running container', async () => {
  const f = runtimeFixture({ inspect: async () => ({ id: 'engine-one' }), fetchHealth: async () => 503 });
  f.selected.healthUrls = ['http://localhost:3002/v1/health/live'];
  const result = await checkRuntime(f.selected, f.dependencies);
  assert.equal(result.report.action, 'application_unhealthy');
  assert.deepEqual(f.calls, [['save', []]]);
});

test('an unexpected active engine identity cannot trigger any restart', async () => {
  const f = runtimeFixture({ inspect: async () => ({ id: 'other-engine' }) });
  await assert.rejects(checkRuntime(f.selected, f.dependencies), /expected identity/);
  assert.deepEqual(f.calls, []);
});

test('remote contexts are rejected without issuing local restart commands', async () => {
  const f = runtimeFixture({ runCommand: async () => JSON.stringify('ssh://operator@other-host') });
  await assert.rejects(checkRuntime(f.selected, f.dependencies), /remote/);
  assert.deepEqual(f.calls, []);
});

test('an explicit remote DOCKER_HOST is refused rather than inspecting a different local engine', async () => {
  const f = runtimeFixture({ environment: { DOCKER_HOST: 'tcp://remote.test:2376' },
    runCommand: async () => { throw new Error('must not run local Docker commands'); } });
  await assert.rejects(checkRuntime(f.selected, f.dependencies), /remote/);
  assert.deepEqual(f.calls, []);
});

test('explicit DOCKER_CONTEXT takes precedence over DOCKER_HOST', async () => {
  const f = runtimeFixture({ environment: { DOCKER_CONTEXT: 'desktop-linux', DOCKER_HOST: 'tcp://remote.test:2376' },
    inspect: async () => ({ id: 'engine-one' }) });
  const result = await checkRuntime(f.selected, f.dependencies);
  assert.equal(result.report.action, 'healthy');
  assert.deepEqual(f.calls, [['save', []]]);
});

test('Docker API probes have a total deadline when the socket accepts but never responds', { skip: process.platform === 'win32' }, async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-'));
  const socket = path.join(folder, 'd.sock');
  const server = http.createServer(() => {});
  const sockets = new Set();
  server.on('connection', connection => { sockets.add(connection); connection.on('close', () => sockets.delete(connection)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  t.after(async () => {
    for (const connection of sockets) connection.destroy();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  await assert.rejects(requestDocker(socket, 'GET', '/info', undefined, 30), /timed out/);
});

test('maintenance overrides idle every task consumer and remain sticky until explicitly enabled', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-no-jobs-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = resolveJobsDisabledOverride(folder, { noJobs: true });
  const override = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(override.services), JOB_CONSUMER_SERVICES);
  assert.equal(override.services.processor.environment.SAMSAR_BACKGROUND_JOBS_ENABLED, 'false');
  for (const service of JOB_CONSUMER_SERVICES.filter(name => name !== 'processor')) {
    assert.equal(override.services[service].restart, 'no');
    assert.deepEqual(override.services[service].command, []);
    assert.equal(override.services[service].healthcheck.disable, true);
    assert.ok(override.services[service].entrypoint.join(' ').includes('job processing is disabled'));
  }
  assert.deepEqual(override, getJobsDisabledOverride());
  assert.equal(resolveJobsDisabledOverride(folder), file);
  assert.equal(resolveJobsDisabledOverride(folder, { enableJobs: true }), null);
  assert.equal(fs.existsSync(file), false);
});

test('corrupt maintenance state fails closed rather than silently resuming jobs', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-no-jobs-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = resolveJobsDisabledOverride(folder, { noJobs: true });
  fs.writeFileSync(file, '{}');
  assert.throws(() => resolveJobsDisabledOverride(folder), /invalid/);
});
