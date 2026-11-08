import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { JOB_CONSUMER_SERVICES, writeJobsDisabledOverride } from './docker-maintenance.mjs';

export const DEFAULT_RECOVERY_POLICY = Object.freeze({
  failureThreshold: 3, maxRecoveries: 2, cooldownMs: 120000,
  recoveryWindowMs: 3600000, probeTimeoutMs: 4000,
});

export function normalizeRecoveryState(value = {}) {
  return {
    version: 1,
    engineId: typeof value.engineId === 'string' ? value.engineId : '',
    failures: Number.isSafeInteger(value.failures) && value.failures >= 0 ? value.failures : 0,
    recoveryTimes: Array.isArray(value.recoveryTimes) ? value.recoveryTimes.filter(Number.isFinite) : [],
  };
}

export function assessRuntimeRecovery(stateValue, { engineHealthy, now, recover = false, policy = DEFAULT_RECOVERY_POLICY }) {
  const state = normalizeRecoveryState(stateValue);
  // A backwards clock change must not erase the restart budget.
  state.recoveryTimes = state.recoveryTimes.filter(time => now - time < policy.recoveryWindowMs);
  state.failures = engineHealthy ? 0 : state.failures + 1;
  if (engineHealthy) return { action: 'healthy', state };
  if (!recover) return { action: 'report', state };
  if (state.failures < policy.failureThreshold) return { action: 'waiting', state };
  if (state.recoveryTimes.length >= policy.maxRecoveries) return { action: 'exhausted', state };
  const last = state.recoveryTimes.at(-1);
  if (last !== undefined && now - last < policy.cooldownMs) return { action: 'cooldown', state };
  // Commit the attempt before issuing a restart. A command timeout must not
  // grant another immediate restart when the host action may still be running.
  state.recoveryTimes.push(now);
  return { action: 'recover', state };
}

export function recoveryCommand(platform, endpoint) {
  const desktop = (platform === 'darwin' && (endpoint.includes('/.docker/run/') ||
    endpoint.includes('/Library/Containers/com.docker.docker/Data/'))) ||
    (platform === 'win32' && endpoint.includes('dockerDesktop')) ||
    (platform === 'linux' && endpoint.includes('/.docker/desktop/'));
  if (desktop) return { command: 'docker', args: ['desktop', 'restart'] };
  if (platform === 'linux' && ['unix:///var/run/docker.sock', 'unix:///run/docker.sock'].includes(endpoint)) {
    return { command: 'systemctl', args: ['--no-ask-password', 'restart', 'docker.service'] };
  }
  throw new Error('Automatic recovery is supported only for local Docker Desktop or rootful native Linux Docker.');
}

export function socketPathForEndpoint(endpoint) {
  if (endpoint.startsWith('unix://')) return endpoint.slice('unix://'.length);
  if (endpoint.startsWith('npipe://')) return endpoint.slice('npipe://'.length).replaceAll('/', '\\');
  throw new Error('Refusing automatic recovery of a remote or unrecognized Docker endpoint.');
}

export function requestDocker(socketPath, method, requestPath, body, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({ socketPath, method, path: requestPath,
      headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        data += chunk;
        if (data.length > 4 * 1024 * 1024) request.destroy(new Error('Docker response exceeded the diagnostic limit.'));
      });
      response.on('end', () => {
        clearTimeout(timer);
        let parsed = null;
        if (data.trim()) {
          try { parsed = JSON.parse(data); } catch { parsed = data; }
        }
        resolve({ status: response.statusCode, data: parsed });
      });
      response.on('error', error => { clearTimeout(timer); reject(error); });
    });
    const timer = setTimeout(() => request.destroy(new Error('Docker API probe timed out.')), timeoutMs);
    request.on('error', error => { clearTimeout(timer); reject(error); });
    if (payload) request.write(payload);
    request.end();
  });
}

export async function inspectDocker(socketPath, request = requestDocker, timeoutMs = 4000) {
  const result = await request(socketPath, 'GET', '/info', undefined, timeoutMs);
  if (result.status !== 200 || !result.data || typeof result.data.ID !== 'string' || !result.data.ID.trim()) {
    throw new Error('Docker engine did not return a valid identity.');
  }
  return { id: result.data.ID };
}

function belongsToProject(labels, root, project) {
  if (labels?.['com.docker.compose.project'] !== project) return false;
  const directory = path.resolve(labels['com.docker.compose.project.working_dir'] || '/');
  const accepted = [path.resolve(root), path.resolve(root, 'deploy', 'compose')];
  const config = path.resolve(root, 'deploy', 'compose', 'docker-compose.yml');
  const files = String(labels['com.docker.compose.project.config_files'] || '').split(',').map(file => path.resolve(file));
  return accepted.includes(directory) && files.includes(config);
}

// This path is intentionally narrow. It never discovers an arbitrary socket or
// silently changes engines: identity and project labels must agree first.
export async function quiesceDesktopJobs({
  root, project = 'samsar', expectedEngineId, socketPath,
  platform = process.platform, home = os.homedir(), request = requestDocker,
  persistMaintenance = writeJobsDisabledOverride,
}) {
  const canonical = path.join(home, 'Library', 'Containers', 'com.docker.docker', 'Data', 'docker.raw.sock');
  if (platform !== 'darwin' || path.resolve(socketPath) !== path.resolve(canonical)) {
    throw new Error('No-jobs recovery requires the canonical local Docker Desktop raw control socket.');
  }
  if (!expectedEngineId) throw new Error('No-jobs recovery requires a previously verified or explicit expected engine ID.');
  const info = await inspectDocker(socketPath, request);
  if (info.id !== expectedEngineId) throw new Error('Raw Docker socket engine identity does not match; no containers were changed.');
  const infrastructure = new Set(['client', 'mongo', 'mongo-auth-bootstrap', 'minio', 'media-gateway',
    'media-tunnel-controller', 'reverse-proxy', 'loki', 'promtail', 'grafana']);
  const inspectContainers = async () => {
    const response = await request(socketPath, 'GET', '/containers/json?all=1');
    if (response.status !== 200 || !Array.isArray(response.data)) throw new Error('Unable to inspect Docker containers safely.');
    const found = [];
    for (const container of response.data) {
      const labels = container.Labels || {};
      const names = container.Names || [];
      // The standalone wizard has no task consumer and is not managed by Compose.
      const wizard = names.length === 1 && names[0] === '/samsar-setup-wizard-preview' &&
        /^samsar-setup-wizard(?::|@)/.test(container.Image || '');
      if (!belongsToProject(labels, root, project)) {
        if (wizard) continue;
        if (container.State === 'running') {
          throw new Error('An unrelated running container prevents safe no-jobs VM recovery.');
        }
        if (!/^[a-f0-9]{64}$/.test(container.Id || '')) throw new Error('Invalid container identity; refusing recovery.');
        const current = await request(socketPath, 'GET', `/containers/${container.Id}/json`);
        if (current.status !== 200 || current.data?.State?.Running !== false ||
            !['', 'no'].includes(current.data?.HostConfig?.RestartPolicy?.Name)) {
          throw new Error('An unrelated container could automatically restart; refusing no-jobs VM recovery.');
        }
        continue;
      }
      const service = labels['com.docker.compose.service'];
      if (JOB_CONSUMER_SERVICES.includes(service)) {
        if (!/^[a-f0-9]{64}$/.test(container.Id || '')) throw new Error('Invalid container identity; refusing recovery.');
        found.push({ id: container.Id, service, running: container.State === 'running' });
      } else if (!infrastructure.has(service)) {
        throw new Error('An unrecognized project service prevents safe no-jobs VM recovery.');
      }
    }
    return found;
  };
  const consumers = await inspectContainers();
  if (!consumers.some(container => container.service === 'processor')) {
    throw new Error('The expected processor container was not found; refusing recovery.');
  }
  persistMaintenance(root);
  // Disable every consumer's automatic restart before stopping any of them.
  for (const container of consumers) {
    const result = await request(socketPath, 'POST', `/containers/${container.id}/update`,
      { RestartPolicy: { Name: 'no', MaximumRetryCount: 0 } });
    if (result.status !== 200) throw new Error('Could not disable a job consumer restart policy; refusing VM restart.');
  }
  for (const container of consumers) {
    const result = await request(socketPath, 'POST', `/containers/${container.id}/stop?t=20`, undefined, 25000);
    if (![204, 304].includes(result.status)) throw new Error('Could not stop every job consumer; refusing VM restart.');
    const current = await request(socketPath, 'GET', `/containers/${container.id}/json`);
    if (current.status !== 200 || current.data?.State?.Running !== false ||
        current.data?.HostConfig?.RestartPolicy?.Name !== 'no') {
      throw new Error('A job consumer is not safely stopped; refusing VM restart.');
    }
  }
  const final = await inspectContainers();
  if (final.length !== consumers.length || final.some(container => container.running ||
      !consumers.some(previous => previous.id === container.id))) {
    throw new Error('The container inventory changed during quiescence; refusing VM restart.');
  }
  return { engineId: info.id, stoppedServices: consumers.map(container => container.service) };
}
