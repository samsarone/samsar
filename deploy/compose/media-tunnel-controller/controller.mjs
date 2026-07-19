import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fsp from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CONFIG_PATH = '/persistent/config/samsar.config.json';
const DEFAULT_REFRESH_REQUEST_PATH = '/persistent/config/media-tunnel-refresh.request.json';
const DEFAULT_READY_PATH = '/tmp/samsar-media-tunnel.ready';
const DEFAULT_INTERNAL_MEDIA_URL = 'http://media-gateway';
const DEFAULT_HEALTH_PATH = '/__samsar_media_health';
const DEFAULT_HEALTH_MARKER = 'samsar-media-gateway';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function log(message, details = '') {
  const suffix = details ? ` ${details}` : '';
  console.log(`[media-tunnel-controller] ${message}${suffix}`);
}

function logError(message, error) {
  console.error(`[media-tunnel-controller] ${message}`, error?.message || error || '');
}

function normalizeHealthPath(value) {
  const normalized = normalizeString(value) || DEFAULT_HEALTH_PATH;
  if (!normalized.startsWith('/') || normalized.includes('?') || normalized.includes('#')) {
    throw new Error('SAMSAR_MEDIA_TUNNEL_HEALTH_PATH must be an absolute URL path.');
  }
  return normalized;
}

function buildHealthUrl(baseUrl, healthPath) {
  const parsedUrl = new URL(baseUrl);
  parsedUrl.pathname = `${parsedUrl.pathname.replace(/\/+$/, '')}${healthPath}`;
  parsedUrl.search = '';
  parsedUrl.hash = '';
  return parsedUrl.toString();
}

export function extractQuickTunnelUrl(value) {
  const matches = normalizeString(value).match(/https:\/\/[-a-zA-Z0-9]+\.trycloudflare\.com/g) || [];
  const candidate = matches.at(-1) || '';
  if (!candidate) {
    return '';
  }
  try {
    const parsedUrl = new URL(candidate);
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.toLowerCase().endsWith('.trycloudflare.com')) {
      return '';
    }
    return parsedUrl.origin;
  } catch {
    return '';
  }
}

function isTemporaryTunnelUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.endsWith('.trycloudflare.com') ||
      hostname.endsWith('.loca.lt') ||
      hostname.endsWith('.share.zrok.io');
  } catch {
    return false;
  }
}

function hasRemoteMediaConsumer(config = {}) {
  const providers = config.providers || {};
  return Boolean(
    providers.samsar?.enabled === true || normalizeString(providers.samsar?.apiKey) ||
    providers.openai?.enabled === true || normalizeString(providers.openai?.apiKey) ||
    providers.openrouter?.enabled === true || normalizeString(providers.openrouter?.apiKey) ||
    providers.alibabaCloud?.enabled === true || normalizeString(providers.alibabaCloud?.apiKey) ||
    providers.googleCloud?.enabled === true || normalizeString(providers.googleCloud?.credentialsJsonB64) ||
    providers.fal?.enabled === true || normalizeString(providers.fal?.apiKey) ||
    providers.elevenlabs?.enabled === true || normalizeString(providers.elevenlabs?.apiKey) ||
    providers.runway?.enabled === true || normalizeString(providers.runway?.apiKey)
  );
}

export function configAllowsLocalMediaTunnel(config = {}) {
  if (!config || typeof config !== 'object') {
    return false;
  }
  if (config.runtime === 'local' || config.storage?.externalMediaPublishEnabled === true) {
    return false;
  }
  if (config.services?.mediaGateway === false) {
    return false;
  }
  return true;
}

export function configRequiresLocalMediaTunnel(config = {}) {
  if (!configAllowsLocalMediaTunnel(config)) {
    return false;
  }
  const tunnelConfig = config.localMediaTunnel || config.mediaTunnel || {};
  return tunnelConfig.enabled === true || hasRemoteMediaConsumer(config);
}

async function readJsonFile(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function syncDirectory(directoryPath) {
  let directoryHandle;
  try {
    directoryHandle = await fsp.open(directoryPath, 'r');
    await directoryHandle.sync();
  } catch {
    // Directory fsync is not supported by every Docker Desktop bind mount.
  } finally {
    await directoryHandle?.close().catch(() => {});
  }
}

export async function updateRuntimeConfigAtomically(
  configPath,
  tunnelUrl,
  {
    now = new Date(),
    healthPath = DEFAULT_HEALTH_PATH,
    healthMarker = DEFAULT_HEALTH_MARKER,
    maxAttempts = 5,
  } = {},
) {
  const normalizedTunnelUrl = extractQuickTunnelUrl(tunnelUrl);
  if (!normalizedTunnelUrl || normalizedTunnelUrl !== normalizeString(tunnelUrl).replace(/\/+$/, '')) {
    throw new Error('Refusing to publish a malformed Cloudflared quick-tunnel URL.');
  }

  const refreshedAt = now.toISOString();
  const configDirectory = path.dirname(configPath);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const originalJson = await fsp.readFile(configPath, 'utf8');
    const config = JSON.parse(originalJson);
    if (!configAllowsLocalMediaTunnel(config)) {
      const error = new Error('Runtime configuration no longer requires a local media tunnel.');
      error.code = 'SAMSAR_LOCAL_MEDIA_TUNNEL_DISABLED';
      throw error;
    }

    const publicUrls = config.publicUrls && typeof config.publicUrls === 'object'
      ? { ...config.publicUrls }
      : {};
    if (isTemporaryTunnelUrl(publicUrls.media)) {
      publicUrls.media = publicUrls.processorApi || 'http://localhost:3002';
    }
    config.publicUrls = publicUrls;
    config.localMediaTunnel = {
      ...(config.localMediaTunnel || config.mediaTunnel || {}),
      enabled: true,
      provider: 'cloudflared',
      publicUrl: normalizedTunnelUrl,
      refreshedAt,
      healthCheckedAt: refreshedAt,
      healthPath,
      healthMarker,
      managedBy: 'compose-media-tunnel-controller',
    };

    const temporaryPath = path.join(
      configDirectory,
      `.samsar.config.json.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    );
    let published = false;
    try {
      const handle = await fsp.open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      const currentJson = await fsp.readFile(configPath, 'utf8').catch(() => '');
      if (currentJson !== originalJson) {
        if (attempt < maxAttempts) {
          await sleep(25 * attempt);
          continue;
        }
        throw new Error('Runtime configuration changed repeatedly while publishing the tunnel URL.');
      }

      await fsp.rename(temporaryPath, configPath);
      published = true;
    } finally {
      if (!published) {
        await fsp.rm(temporaryPath, { force: true }).catch(() => {});
      }
    }
    await fsp.chmod(configPath, 0o600).catch(() => {});
    await syncDirectory(configDirectory);
    return config;
  }

  throw new Error('Unable to atomically publish the tunnel URL.');
}

export async function readRefreshMarkerToken(markerPath) {
  try {
    const marker = await fsp.readFile(markerPath);
    return crypto.createHash('sha256').update(marker).digest('hex');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export async function consumeRefreshMarker(markerPath, expectedToken) {
  if (!expectedToken) {
    return false;
  }
  const currentToken = await readRefreshMarkerToken(markerPath);
  if (!currentToken || currentToken !== expectedToken) {
    return false;
  }
  await fsp.rm(markerPath, { force: true });
  return true;
}

async function readHttpsResponseBody(url, address, timeoutMs) {
  return new Promise((resolve) => {
    const request = https.get(url, {
      headers: { 'Cache-Control': 'no-store' },
      lookup: (_hostname, options, callback) => {
        if (options?.all) {
          callback(null, [{ address, family: 4 }]);
        } else {
          callback(null, address, 4);
        }
      },
      timeout: timeoutMs,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 4096) {
          body += chunk;
        }
      });
      response.on('end', () => resolve(
        response.statusCode >= 200 && response.statusCode < 300 ? body.trim() : '',
      ));
      response.on('error', () => resolve(''));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(''));
  });
}

async function resolvePublicIpv4(hostname, timeoutMs) {
  try {
    const queryUrl = new URL('https://cloudflare-dns.com/dns-query');
    queryUrl.searchParams.set('name', hostname);
    queryUrl.searchParams.set('type', 'A');
    const response = await fetch(queryUrl, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return '';
    }
    const payload = await response.json();
    return payload.Answer?.find(
      (answer) => answer?.type === 1 && typeof answer?.data === 'string',
    )?.data || '';
  } catch {
    return '';
  }
}

async function fetchHealthBody(healthUrl, timeoutMs, allowPinnedDns) {
  try {
    const response = await fetch(healthUrl, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-store' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      return (await response.text()).trim();
    }
  } catch {
    // Docker Desktop can briefly cache the DNS result for a replaced quick tunnel.
  }

  if (!allowPinnedDns) {
    return '';
  }
  try {
    const parsedUrl = new URL(healthUrl);
    if (parsedUrl.protocol !== 'https:') {
      return '';
    }
    const address = await resolvePublicIpv4(parsedUrl.hostname, timeoutMs);
    return address ? readHttpsResponseBody(parsedUrl, address, timeoutMs) : '';
  } catch {
    return '';
  }
}

export async function validateHealthMarker(
  baseUrl,
  {
    healthPath = DEFAULT_HEALTH_PATH,
    healthMarker = DEFAULT_HEALTH_MARKER,
    timeoutMs = 5000,
    allowPinnedDns = true,
  } = {},
) {
  try {
    const healthUrl = buildHealthUrl(baseUrl, normalizeHealthPath(healthPath));
    return await fetchHealthBody(healthUrl, timeoutMs, allowPinnedDns) === healthMarker;
  } catch {
    return false;
  }
}

class MediaTunnelController {
  constructor(env = process.env) {
    this.configPath = normalizeString(env.SAMSAR_RUNTIME_CONFIG_FILE) || DEFAULT_CONFIG_PATH;
    this.refreshMarkerPath = normalizeString(
      env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_PATH || env.SAMSAR_MEDIA_TUNNEL_REFRESH_REQUEST_FILE,
    ) || DEFAULT_REFRESH_REQUEST_PATH;
    this.readyPath = normalizeString(env.SAMSAR_MEDIA_TUNNEL_READY_FILE) || DEFAULT_READY_PATH;
    this.internalMediaUrl = normalizeString(env.SAMSAR_INTERNAL_MEDIA_BASE_URL) || DEFAULT_INTERNAL_MEDIA_URL;
    this.healthPath = normalizeHealthPath(env.SAMSAR_MEDIA_TUNNEL_HEALTH_PATH);
    this.healthMarker = normalizeString(env.SAMSAR_MEDIA_TUNNEL_HEALTH_MARKER) || DEFAULT_HEALTH_MARKER;
    this.cloudflaredBinary = normalizeString(env.SAMSAR_CLOUDFLARED_BINARY) || '/usr/local/bin/cloudflared';
    this.cloudflaredProtocol = normalizeString(env.SAMSAR_CLOUDFLARED_PROTOCOL) || 'http2';
    this.monitorIntervalMs = positiveInteger(env.SAMSAR_MEDIA_TUNNEL_MONITOR_INTERVAL_MS, 5000, 250);
    this.startTimeoutMs = positiveInteger(env.SAMSAR_MEDIA_TUNNEL_START_TIMEOUT_MS, 60000, 1000);
    this.healthTimeoutMs = positiveInteger(env.SAMSAR_MEDIA_TUNNEL_HEALTH_TIMEOUT_MS, 60000, 1000);
    this.requestTimeoutMs = positiveInteger(env.SAMSAR_MEDIA_TUNNEL_REQUEST_TIMEOUT_MS, 5000, 250);
    this.restartDelayMs = positiveInteger(env.SAMSAR_MEDIA_TUNNEL_RESTART_DELAY_MS, 3000, 100);
    this.failureThreshold = positiveInteger(env.SAMSAR_MEDIA_TUNNEL_FAILURE_THRESHOLD, 3, 1);
    this.stopping = false;
    this.child = null;
    this.currentUrl = '';
    this.failureCount = 0;
  }

  async removeReadyState() {
    await fsp.rm(this.readyPath, { force: true }).catch(() => {});
  }

  async writeReadyState(tunnelUrl) {
    const temporaryPath = `${this.readyPath}.tmp-${process.pid}`;
    await fsp.writeFile(temporaryPath, `${tunnelUrl}\n`, { mode: 0o600 });
    await fsp.rename(temporaryPath, this.readyPath);
  }

  async ensureIdleReadyState() {
    const currentState = await fsp.readFile(this.readyPath, 'utf8').catch(() => '');
    if (currentState.trim() !== 'idle') {
      await this.writeReadyState('idle');
    }
  }

  async getRuntimeConfig() {
    try {
      return await readJsonFile(this.configPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        logError('Runtime config is not readable yet:', error);
      }
      return null;
    }
  }

  async waitForInternalGateway() {
    const deadline = Date.now() + this.healthTimeoutMs;
    while (!this.stopping && Date.now() < deadline) {
      if (await validateHealthMarker(this.internalMediaUrl, {
        healthPath: this.healthPath,
        healthMarker: this.healthMarker,
        timeoutMs: this.requestTimeoutMs,
        allowPinnedDns: false,
      })) {
        return true;
      }
      await sleep(500);
    }
    return false;
  }

  async stopTunnel() {
    const child = this.child;
    this.child = null;
    this.currentUrl = '';
    await this.removeReadyState();
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), sleep(5000)]).catch(() => {});
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
  }

  async launchCloudflared() {
    const args = [
      'tunnel',
      '--no-autoupdate',
      '--protocol',
      this.cloudflaredProtocol,
      '--url',
      this.internalMediaUrl,
    ];
    const child = spawn(this.cloudflaredBinary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child = child;

    child.once('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null;
        this.currentUrl = '';
        void this.removeReadyState();
        log(`Cloudflared exited (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`);
      }
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      let logTail = '';
      const formatLogTail = () => logTail.replace(/\s+/g, ' ').trim().slice(-1000);
      const timeout = setTimeout(() => finish(new Error(
        `Timed out discovering the Cloudflared quick-tunnel URL. Last output: ${formatLogTail() || '(none)'}`,
      )), this.startTimeoutMs);

      const finish = (error, tunnelUrl = '') => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        child.off('error', onError);
        child.off('exit', onEarlyExit);
        if (error) {
          reject(error);
        } else {
          resolve(tunnelUrl);
        }
      };
      const onError = (error) => finish(error);
      const onEarlyExit = (code, signal) => finish(
        new Error(
          `Cloudflared exited before publishing a URL (code=${code ?? 'null'}, signal=${signal ?? 'none'}). ` +
          `Last output: ${formatLogTail() || '(none)'}`,
        ),
      );
      const onOutput = (chunk) => {
        const text = String(chunk);
        logTail = `${logTail}${text}`.slice(-32768);
        const tunnelUrl = extractQuickTunnelUrl(logTail);
        if (tunnelUrl) {
          finish(null, tunnelUrl);
        }
      };

      child.on('error', onError);
      child.on('exit', onEarlyExit);
      child.stdout.on('data', onOutput);
      child.stderr.on('data', onOutput);
    });
  }

  async waitForPublicGateway(tunnelUrl) {
    const deadline = Date.now() + this.healthTimeoutMs;
    while (!this.stopping && Date.now() < deadline) {
      if (await validateHealthMarker(tunnelUrl, {
        healthPath: this.healthPath,
        healthMarker: this.healthMarker,
        timeoutMs: this.requestTimeoutMs,
        allowPinnedDns: true,
      })) {
        return true;
      }
      if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
        return false;
      }
      await sleep(1000);
    }
    return false;
  }

  async rotateTunnel(reason) {
    log(`Rotating media tunnel (${reason}).`);
    await this.stopTunnel();
    if (!await this.waitForInternalGateway()) {
      throw new Error('Internal media gateway health marker is unreachable.');
    }

    const tunnelUrl = await this.launchCloudflared();
    log('Discovered Cloudflared URL:', tunnelUrl);
    if (!await this.waitForPublicGateway(tunnelUrl)) {
      throw new Error('Cloudflared URL did not return the Samsar media gateway health marker.');
    }

    const markerToConsume = await readRefreshMarkerToken(this.refreshMarkerPath);
    await updateRuntimeConfigAtomically(this.configPath, tunnelUrl, {
      healthPath: this.healthPath,
      healthMarker: this.healthMarker,
    });
    await this.writeReadyState(tunnelUrl);
    await consumeRefreshMarker(this.refreshMarkerPath, markerToConsume);
    this.currentUrl = tunnelUrl;
    this.failureCount = 0;
    log('Published healthy tunnel URL to runtime config:', tunnelUrl);
  }

  async isCurrentTunnelHealthy() {
    if (!this.child || !this.currentUrl) {
      return false;
    }
    return validateHealthMarker(this.currentUrl, {
      healthPath: this.healthPath,
      healthMarker: this.healthMarker,
      timeoutMs: this.requestTimeoutMs,
      allowPinnedDns: true,
    });
  }

  async run() {
    const stop = () => {
      this.stopping = true;
      void this.stopTunnel();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    log('Started without Docker socket access.');

    try {
      while (!this.stopping) {
        const config = await this.getRuntimeConfig();
        const refreshMarkerToken = await readRefreshMarkerToken(this.refreshMarkerPath).catch((error) => {
          logError('Unable to read refresh marker:', error);
          return '';
        });
        const tunnelRequired = configRequiresLocalMediaTunnel(config) ||
          (Boolean(refreshMarkerToken) && configAllowsLocalMediaTunnel(config));
        if (!tunnelRequired) {
          if (this.child) {
            log('Runtime config no longer requires a public local-media tunnel; stopping Cloudflared.');
            await this.stopTunnel();
          }
          await this.ensureIdleReadyState().catch((error) => {
            logError('Unable to publish idle controller readiness:', error);
          });
          await sleep(this.monitorIntervalMs);
          continue;
        }

        let rotationReason = '';
        if (!this.child || !this.currentUrl) {
          rotationReason = 'controller startup or Cloudflared exit';
        } else if (refreshMarkerToken) {
          rotationReason = 'shared refresh marker requested replacement';
        } else if (await this.isCurrentTunnelHealthy()) {
          this.failureCount = 0;
        } else {
          this.failureCount += 1;
          log(`Public health marker check failed (${this.failureCount}/${this.failureThreshold}).`);
          if (this.failureCount >= this.failureThreshold) {
            rotationReason = 'public health marker failure threshold reached';
          }
        }

        if (rotationReason) {
          try {
            await this.rotateTunnel(rotationReason);
          } catch (error) {
            logError('Tunnel rotation failed:', error);
            await this.stopTunnel();
            if (!this.stopping) {
              await sleep(this.restartDelayMs);
            }
          }
        }

        if (!this.stopping) {
          await sleep(this.monitorIntervalMs);
        }
      }
    } finally {
      await this.stopTunnel();
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
      log('Stopped.');
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const controller = new MediaTunnelController();
  controller.run().catch((error) => {
    logError('Fatal controller error:', error);
    process.exitCode = 1;
  });
}
