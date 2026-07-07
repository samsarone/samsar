import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import nodemailer from 'nodemailer';
import {
  SESClient,
  GetIdentityVerificationAttributesCommand,
  GetSendQuotaCommand,
} from '@aws-sdk/client-ses';

const PORT = Number.parseInt(process.env.PORT || '80', 10);
const STATIC_DIR = process.env.SETUP_WIZARD_STATIC_DIR || path.resolve('dist');

function resolveRootDir() {
  const configuredRoot = process.env.SAMSAR_SETUP_ROOT_DIR;
  if (configuredRoot) {
    return configuredRoot;
  }

  const candidates = [
    path.resolve(process.cwd(), '..', '..'),
    '/workspace/samsar',
    process.cwd(),
  ];

  return candidates.find((candidate) => (
    existsSync(path.join(candidate, 'deploy', 'compose', 'docker-compose.yml'))
  )) || candidates[0];
}

const ROOT_DIR = resolveRootDir();
const COMPOSE_FILE = path.join(ROOT_DIR, 'deploy', 'compose', 'docker-compose.yml');
const CONFIG_PATH = path.join(ROOT_DIR, 'runtime', 'config', 'samsar.config.json');
const AVAILABLE_MODELS_PATH = path.join(ROOT_DIR, 'runtime', 'config', 'available-models.json');
const ROOT_ENV_PATH = path.join(ROOT_DIR, 'runtime', 'secrets', 'root.env');
const MAIL_SECRETS_PATH = path.join(ROOT_DIR, 'runtime', 'secrets', 'mail.credentials.json');
const REVERSE_PROXY_DIR = path.join(ROOT_DIR, 'runtime', 'reverse-proxy');
const REVERSE_PROXY_NGINX_CONFIG_PATH = path.join(REVERSE_PROXY_DIR, 'nginx.conf');
const REVERSE_PROXY_CERTBOT_WEBROOT = path.join(REVERSE_PROXY_DIR, 'certbot', 'www');
const REVERSE_PROXY_CERTBOT_CONFIG = path.join(REVERSE_PROXY_DIR, 'letsencrypt');
const REVERSE_PROXY_CERT_NAME = 'samsar-reverse-proxy';
const REVERSE_PROXY_CERT_DOMAINS_PATH = path.join(REVERSE_PROXY_DIR, 'cert-domains.json');
const MANAGED_FIREWALL_PORTS_PATH = path.join(REVERSE_PROXY_DIR, 'managed-firewall-ports.json');
const EXAMPLE_CONFIG_PATH = path.join(ROOT_DIR, 'samsar.config.example.json');
const CLIENT_URL = process.env.SAMSAR_SETUP_CLIENT_URL || 'http://localhost:3000';
const PROCESSOR_PUBLIC_URL = process.env.SAMSAR_SETUP_PROCESSOR_PUBLIC_URL || 'http://localhost:3002';
const PROCESSOR_INTERNAL_URL = process.env.SAMSAR_SETUP_PROCESSOR_INTERNAL_URL || 'http://host.docker.internal:3002';
const CLIENT_INTERNAL_URL = process.env.SAMSAR_SETUP_CLIENT_INTERNAL_URL || 'http://host.docker.internal:3000';
const PROCESSOR_READY_URL = `${PROCESSOR_INTERNAL_URL}/v1/health/ready`;
const MEDIA_TUNNEL_CONTAINER_NAME = process.env.SAMSAR_MEDIA_TUNNEL_CONTAINER || 'samsar-media-tunnel';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const SETUP_STEPS = [
  { id: 'cleanup', label: 'Clean previous containers' },
  { id: 'config', label: 'Save deployment config' },
  { id: 'runtime', label: 'Render runtime environment' },
  { id: 'firewall', label: 'Open external ports' },
  { id: 'compose', label: 'Build and start containers' },
  { id: 'proxy', label: 'Configure reverse proxy' },
  { id: 'media', label: 'Publish local media gateway' },
  { id: 'processor', label: 'Verify processor API' },
  { id: 'client', label: 'Verify Samsar client' },
  { id: 'login', label: 'Prepare local login' },
];

const MAINTENANCE_STEPS = [
  { id: 'runtime', label: 'Render runtime environment' },
  { id: 'pull', label: 'Pull latest images' },
  { id: 'firewall', label: 'Open external ports' },
  { id: 'compose', label: 'Update and restart containers' },
  { id: 'proxy', label: 'Configure reverse proxy' },
  { id: 'media', label: 'Publish local media gateway' },
  { id: 'processor', label: 'Verify processor API' },
  { id: 'client', label: 'Verify Samsar client' },
];

const runs = new Map();
const maintenanceRuns = new Map();
const ALL_COMPOSE_PROFILES = ['core', 'workers', 'local-mongo', 'minio', 'local-media', 'logger', 'reverse-proxy'];
const MEDIA_GATEWAY_ENV_SERVICES = [
  'processor',
  'generator',
  'audio-generator',
  'assistant-query-processor',
  'ai-video-layer-generator',
  'express-video-listener',
  'task-processor',
];

function cloneRun(run) {
  return {
    id: run.id,
    status: run.status,
    currentStep: run.currentStep,
    steps: run.steps,
    logs: run.logs.slice(-160),
    error: run.error,
    redirectUrl: run.redirectUrl,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

function appendLog(run, message) {
  run.logs.push({
    at: new Date().toISOString(),
    message,
  });
  if (run.logs.length > 240) {
    run.logs.splice(0, run.logs.length - 240);
  }
}

function setStepStatus(run, stepId, status, message = '', options = {}) {
  run.currentStep = stepId;
  run.steps = run.steps.map((step) => (
    step.id === stepId
      ? { ...step, status, message }
      : step
  ));
  if (message && options.log !== false) {
    appendLog(run, message);
  }
}

function failRun(run, error) {
  if (run.cancelled) {
    return;
  }
  run.status = 'failed';
  run.error = error?.message || String(error);
  run.completedAt = new Date().toISOString();
  if (run.currentStep) {
    setStepStatus(run, run.currentStep, 'failed', run.error);
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
    });
    let stderr = '';

    if (options.run) {
      options.run.children = options.run.children || new Set();
      options.run.children.add(child);
    }

    child.stdout.on('data', (chunk) => {
      options.onOutput?.(chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options.onOutput?.(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (options.run?.children) {
        options.run.children.delete(child);
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}${stderr ? `: ${stderr.slice(-800)}` : ''}`));
    });
  });
}

function runCommandCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}${stderr ? `: ${stderr.slice(-800)}` : ''}`));
    });
  });
}

function getComposeArgs(...args) {
  return ['compose', '--env-file', ROOT_ENV_PATH, '-f', COMPOSE_FILE, ...args];
}

function cancelRun(run, message = 'Setup was reset by the user.') {
  run.cancelled = true;
  run.status = 'failed';
  run.error = message;
  run.completedAt = new Date().toISOString();
  if (run.currentStep) {
    setStepStatus(run, run.currentStep, 'failed', message);
  }
  for (const child of run.children || []) {
    if (!child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000).unref?.();
    }
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeSecretString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTemporaryAwsAccessKeyId(value) {
  return normalizeString(value).toUpperCase().startsWith('ASIA');
}

function getSesAccessKeyId(mail = {}) {
  return normalizeString(mail.sesAccessKeyId || mail.ses?.accessKeyId);
}

function getSesSecretAccessKey(mail = {}) {
  return normalizeSecretString(
    typeof mail.sesSecretAccessKey === 'string'
      ? mail.sesSecretAccessKey
      : mail.ses?.secretAccessKey || '',
  );
}

function shouldUseSesSessionToken(mail = {}, accessKeyId = getSesAccessKeyId(mail)) {
  return isTemporaryAwsAccessKeyId(accessKeyId);
}

function getSesSessionToken(mail = {}, accessKeyId = getSesAccessKeyId(mail)) {
  if (!shouldUseSesSessionToken(mail, accessKeyId)) {
    return '';
  }
  return normalizeSecretString(
    typeof mail.sesSessionToken === 'string'
      ? mail.sesSessionToken
      : mail.ses?.sessionToken || '',
  );
}

function isAwsCredentialError(error) {
  const name = String(error?.name || error?.Code || error?.code || '');
  const message = String(error?.message || error || '');
  return [
    'InvalidClientTokenId',
    'UnrecognizedClientException',
    'SignatureDoesNotMatch',
    'InvalidSignatureException',
  ].includes(name) ||
    /security token/i.test(message) ||
    /signature/i.test(message);
}

function formatSesCredentialError(error, accessKeyId, sessionToken) {
  const originalMessage = normalizeString(error?.message) || 'AWS rejected the SES credentials.';
  if (isTemporaryAwsAccessKeyId(accessKeyId) && !sessionToken) {
    return new Error('Temporary AWS SES credentials require the AWS session token. Paste the session token that was issued with the access key and secret access key.');
  }
  if (!isTemporaryAwsAccessKeyId(accessKeyId) && sessionToken) {
    return new Error(`AWS rejected the SES credentials. This access key looks like a long-lived IAM key, so disable the temporary session token field unless you are using STS credentials. AWS said: ${originalMessage}`);
  }
  return new Error(`AWS rejected the SES credentials. Use the IAM secret access key for Amazon SES API credentials. If you have SES SMTP credentials instead, choose SMTP and use the SES SMTP host for your region. AWS said: ${originalMessage}`);
}

function parseMongoConnectionString(value) {
  const mongoUrl = normalizeString(value);
  if (!mongoUrl) {
    return null;
  }
  try {
    const parsedUrl = new URL(mongoUrl);
    if (!['mongodb:', 'mongodb+srv:'].includes(parsedUrl.protocol)) {
      return null;
    }
    return {
      scheme: parsedUrl.protocol.replace(':', ''),
      hosts: parsedUrl.host,
      database: parsedUrl.pathname.replace(/^\/+/, '') || 'SamsarOne',
      username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : '',
      authSource: parsedUrl.searchParams.get('authSource') || '',
      tls: parsedUrl.searchParams.get('tls') || parsedUrl.searchParams.get('ssl') || '',
    };
  } catch {
    return null;
  }
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = normalizeString(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeMailProvider(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (['smtp', 'ses', 'ses-api', 'none', 'disabled'].includes(normalized)) {
    return normalized === 'ses-api' ? 'ses' : normalized === 'disabled' ? 'none' : normalized;
  }
  return 'none';
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function extractEmailAddress(value) {
  const normalized = normalizeString(value);
  const angleMatch = normalized.match(/<([^>]+)>/);
  return (angleMatch ? angleMatch[1] : normalized).trim().toLowerCase();
}

function assertValidEmail(value, label = 'email') {
  const email = extractEmailAddress(value);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Enter a valid ${label}.`);
  }
  return email;
}

function buildSanitizedMailConfig(mail = {}, validation = null) {
  const provider = normalizeMailProvider(mail.provider);
  if (provider === 'none') {
    return {
      configured: false,
      provider: 'none',
    };
  }

  const fromAddress = normalizeString(mail.fromAddress);
  const replyToAddress = normalizeString(mail.replyToAddress) || fromAddress;
  const sanitized = {
    configured: true,
    provider,
    fromAddress,
    replyToAddress,
    validatedAt: validation?.validatedAt || new Date().toISOString(),
  };

  if (provider === 'smtp') {
    sanitized.smtp = {
      host: normalizeString(mail.smtpHost || mail.smtp?.host),
      port: parsePort(mail.smtpPort || mail.smtp?.port, normalizeBoolean(mail.smtpSecure || mail.smtp?.secure) ? 465 : 587),
      secure: normalizeBoolean(mail.smtpSecure ?? mail.smtp?.secure),
      usernameConfigured: Boolean(normalizeString(mail.smtpUser || mail.smtp?.username)),
    };
  } else {
    const accessKeyId = getSesAccessKeyId(mail);
    const sessionToken = getSesSessionToken(mail, accessKeyId);
    sanitized.ses = {
      region: normalizeString(mail.sesRegion || mail.ses?.region) || 'us-east-1',
      accessKeyConfigured: Boolean(accessKeyId),
      sessionTokenConfigured: Boolean(sessionToken),
    };
  }

  return sanitized;
}

function buildMailSecrets(mail = {}, validation = null) {
  const provider = normalizeMailProvider(mail.provider);
  if (provider === 'none') {
    return {
      configured: false,
      provider: 'none',
    };
  }

  const fromAddress = normalizeString(mail.fromAddress);
  const replyToAddress = normalizeString(mail.replyToAddress) || fromAddress;
  const secrets = {
    configured: true,
    provider,
    fromAddress,
    replyToAddress,
    validatedAt: validation?.validatedAt || new Date().toISOString(),
  };

  if (provider === 'smtp') {
    const secure = normalizeBoolean(mail.smtpSecure ?? mail.smtp?.secure);
    secrets.smtp = {
      host: normalizeString(mail.smtpHost || mail.smtp?.host),
      port: parsePort(mail.smtpPort || mail.smtp?.port, secure ? 465 : 587),
      secure,
      username: normalizeString(mail.smtpUser || mail.smtp?.username),
      password: typeof mail.smtpPassword === 'string' ? mail.smtpPassword : mail.smtp?.password || '',
    };
  } else {
    const accessKeyId = getSesAccessKeyId(mail);
    secrets.ses = {
      region: normalizeString(mail.sesRegion || mail.ses?.region) || 'us-east-1',
      accessKeyId,
      secretAccessKey: getSesSecretAccessKey(mail),
      sessionToken: getSesSessionToken(mail, accessKeyId),
    };
  }

  return secrets;
}

async function validateSmtpMailConfig(mail = {}) {
  const fromAddress = normalizeString(mail.fromAddress);
  assertValidEmail(fromAddress, 'from address');
  const replyToAddress = normalizeString(mail.replyToAddress);
  if (replyToAddress) {
    assertValidEmail(replyToAddress, 'reply-to address');
  }

  const host = normalizeString(mail.smtpHost || mail.smtp?.host);
  if (!host) {
    throw new Error('SMTP host is required.');
  }

  const secure = normalizeBoolean(mail.smtpSecure ?? mail.smtp?.secure);
  const port = parsePort(mail.smtpPort || mail.smtp?.port, secure ? 465 : 587);
  const username = normalizeString(mail.smtpUser || mail.smtp?.username);
  const password = typeof mail.smtpPassword === 'string' ? mail.smtpPassword : mail.smtp?.password || '';

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: username || password ? { user: username, pass: password } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  await transporter.verify();

  return {
    ok: true,
    provider: 'smtp',
    validatedAt: new Date().toISOString(),
    message: 'SMTP connection verified.',
    config: buildSanitizedMailConfig({ ...mail, provider: 'smtp' }),
  };
}

async function validateSesMailConfig(mail = {}) {
  const fromAddress = normalizeString(mail.fromAddress);
  const emailAddress = assertValidEmail(fromAddress, 'from address');
  const replyToAddress = normalizeString(mail.replyToAddress);
  if (replyToAddress) {
    assertValidEmail(replyToAddress, 'reply-to address');
  }

  const region = normalizeString(mail.sesRegion || mail.ses?.region) || 'us-east-1';
  const accessKeyId = getSesAccessKeyId(mail);
  const secretAccessKey = getSesSecretAccessKey(mail);
  const sessionToken = getSesSessionToken(mail, accessKeyId);

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('SES access key ID and secret access key are required.');
  }
  if (shouldUseSesSessionToken(mail, accessKeyId) && !sessionToken) {
    throw new Error('AWS session token is required for temporary SES credentials.');
  }

  const client = new SESClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });

  try {
    await client.send(new GetSendQuotaCommand({}));
  } catch (error) {
    if (isAwsCredentialError(error)) {
      throw formatSesCredentialError(error, accessKeyId, sessionToken);
    }
    throw error;
  }

  const domain = emailAddress.split('@')[1];
  try {
    const identityResponse = await client.send(new GetIdentityVerificationAttributesCommand({
      Identities: [emailAddress, domain],
    }));
    const attributes = identityResponse?.VerificationAttributes || {};
    const emailStatus = attributes[emailAddress]?.VerificationStatus;
    const domainStatus = attributes[domain]?.VerificationStatus;
    if (emailStatus !== 'Success' && domainStatus !== 'Success') {
      throw new Error(`SES sender identity ${emailAddress} or ${domain} is not verified in ${region}.`);
    }
  } catch (error) {
    if (isAwsCredentialError(error)) {
      throw formatSesCredentialError(error, accessKeyId, sessionToken);
    }
    if (String(error?.message || '').includes('not verified')) {
      throw error;
    }
    // Some IAM policies allow sending but not identity inspection. Quota validation still proves credentials.
  }

  return {
    ok: true,
    provider: 'ses',
    validatedAt: new Date().toISOString(),
    message: 'SES credentials verified.',
    config: buildSanitizedMailConfig({ ...mail, provider: 'ses' }),
  };
}

async function validateMailConfig(mail = {}) {
  const provider = normalizeMailProvider(mail.provider);
  if (provider === 'none') {
    return {
      ok: true,
      provider: 'none',
      configured: false,
      message: 'Mail provider skipped.',
      config: buildSanitizedMailConfig({ provider: 'none' }),
    };
  }

  if (provider === 'smtp') {
    return validateSmtpMailConfig({ ...mail, provider });
  }

  return validateSesMailConfig({ ...mail, provider });
}

async function writeMailSecrets(mail = {}, validation = null) {
  const secrets = buildMailSecrets(mail, validation);
  await fs.mkdir(path.dirname(MAIL_SECRETS_PATH), { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(path.dirname(MAIL_SECRETS_PATH), 0o700);
  } catch (_) {
    // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
  }

  if (!secrets.configured) {
    await fs.rm(MAIL_SECRETS_PATH, { force: true });
    return;
  }

  await fs.writeFile(MAIL_SECRETS_PATH, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  try {
    await fs.chmod(MAIL_SECRETS_PATH, 0o600);
  } catch (_) {
    // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
  }
}

function buildAdminConfig(admin = {}) {
  const email = assertValidEmail(admin.email, 'admin email');
  const password = typeof admin.password === 'string' ? admin.password : '';
  const organizationName = normalizeString(admin.organizationName || admin.organization?.name);

  if (password.length < 8) {
    throw new Error('Admin password must be at least 8 characters.');
  }

  return {
    email,
    password,
    organizationName,
  };
}

function ensureTrailingSlash(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function buildDatabaseConfig(infrastructure = {}) {
  const database = infrastructure.database || {};
  const remoteMongoUrl = normalizeString(database.mongoUrl);
  if (database.provider === 'remote-mongo' || database.mode === 'remote') {
    return {
      provider: 'remote-mongo',
      mongoUrl: remoteMongoUrl,
      parsed: parseMongoConnectionString(remoteMongoUrl),
    };
  }

  return {
    provider: 'local-mongo',
    mongoUrl: 'mongodb://mongo:27017/SamsarOne',
  };
}

function buildStorageConfig(infrastructure = {}) {
  const storage = infrastructure.storage || {};
  if (storage.mode === 'external-s3') {
    return {
      provider: 's3-compatible',
      mediaBucketName: normalizeString(storage.mediaBucketName) || 'samsar-resources',
      staticCdnUrl: ensureTrailingSlash(storage.staticCdnUrl),
      secureAssetPrefix: normalizeString(storage.secureAssetPrefix) || 'assets_v2',
      accessKeyId: normalizeString(storage.accessKeyId),
      secretAccessKey: normalizeString(storage.secretAccessKey),
      region: normalizeString(storage.region) || 'us-east-1',
      s3Endpoint: normalizeString(storage.s3Endpoint),
      s3ForcePathStyle: normalizeBoolean(storage.s3ForcePathStyle),
      externalMediaPublishEnabled: true,
      cloudFront: {
        keyPairId: normalizeString(storage.cloudFront?.keyPairId),
        privateKey: typeof storage.cloudFront?.privateKey === 'string' ? storage.cloudFront.privateKey : '',
        privateKeyBase64: normalizeString(storage.cloudFront?.privateKeyBase64),
        signedUrlTtlSeconds: normalizeString(storage.cloudFront?.signedUrlTtlSeconds) || '604800',
      },
    };
  }

  return {
    provider: 's3-compatible',
    mediaBucketName: 'samsar-resources',
    staticCdnUrl: 'http://localhost:8080/',
    secureAssetPrefix: 'assets_v2',
    accessKeyId: 'samsar',
    secretAccessKey: 'samsar-local-password',
    region: 'us-east-1',
    s3Endpoint: 'http://minio:9000',
    s3ForcePathStyle: true,
    externalMediaPublishEnabled: false,
  };
}

function normalizeHostInput(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return '';
  }
  try {
    const parsedUrl = new URL(/^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`);
    return parsedUrl.hostname.toLowerCase();
  } catch {
    return normalized
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .split(':')[0]
      .toLowerCase();
  }
}

function normalizeReverseProxyAccessType(value) {
  const normalized = normalizeString(value);
  if (['publicDomain', 'publicIp', 'privateIp'].includes(normalized)) {
    return normalized;
  }
  return 'publicDomain';
}

function isValidDomainName(host) {
  return /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i.test(host);
}

function isPrivateIpAddress(host) {
  if (net.isIP(host) !== 4) {
    return false;
  }
  const [first, second] = host.split('.').map((value) => Number.parseInt(value, 10));
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 127) ||
    (first === 169 && second === 254);
}

function isIntranetIpAddress(host) {
  if (net.isIP(host) !== 4) {
    return false;
  }
  const [first, second] = host.split('.').map((value) => Number.parseInt(value, 10));
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function isLocalOrPrivateHost(host) {
  const normalizedHost = normalizeHostInput(host);
  return !normalizedHost ||
    ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'media-gateway', 'host.docker.internal'].includes(normalizedHost) ||
    normalizedHost.endsWith('.local') ||
    isPrivateIpAddress(normalizedHost);
}

function isPublicHttpUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return ['http:', 'https:'].includes(parsedUrl.protocol) && !isLocalOrPrivateHost(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function buildUrlForHost(host, useHttps = false) {
  const normalizedHost = normalizeHostInput(host);
  if (!normalizedHost) {
    return '';
  }
  return `${useHttps ? 'https' : 'http'}://${normalizedHost}`;
}

function buildUrlForHostPath(host, pathName = '', useHttps = false) {
  const baseUrl = buildUrlForHost(host, useHttps);
  const normalizedPath = normalizeString(pathName).replace(/^\/+/, '');
  return baseUrl && normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
}

function buildReverseProxyConfig(reverseProxy = {}) {
  const enabled = normalizeBoolean(reverseProxy.enabled);
  const accessType = normalizeReverseProxyAccessType(reverseProxy.accessType);
  const sslEnabled = enabled && accessType === 'publicDomain' && normalizeBoolean(reverseProxy.sslEnabled ?? reverseProxy.ssl?.enabled);
  const isIpAccess = accessType === 'publicIp' || accessType === 'privateIp';
  const ipAddress = normalizeHostInput(
    reverseProxy.machineIp ||
    reverseProxy.ipAddress ||
    reverseProxy.publicIp ||
    reverseProxy.privateIp ||
    reverseProxy.clientHost ||
    reverseProxy.processorHost ||
    reverseProxy.clientIp ||
    reverseProxy.processorIp,
  );
  const clientHost = isIpAccess
    ? ipAddress
    : normalizeHostInput(reverseProxy.clientHost || reverseProxy.clientDomain || reverseProxy.clientIp);
  const processorHost = isIpAccess
    ? ipAddress
    : normalizeHostInput(reverseProxy.processorHost || reverseProxy.processorDomain || reverseProxy.processorIp);
  const clientApp = buildUrlForHost(clientHost, sslEnabled);
  const processorApi = isIpAccess
    ? buildUrlForHostPath(ipAddress, 'api', sslEnabled)
    : buildUrlForHost(processorHost, sslEnabled);

  if (!enabled) {
    return {
      enabled: false,
      accessType,
      openFirewallPorts: false,
      ssl: { enabled: false },
      publicUrls: {},
    };
  }

  return {
    enabled: true,
    accessType,
    clientHost,
    processorHost,
    machineIp: isIpAccess ? ipAddress : normalizeString(reverseProxy.machineIp),
    ipAddress,
    openFirewallPorts: normalizeBoolean(reverseProxy.openFirewallPorts),
    ssl: {
      enabled: sslEnabled,
      email: sslEnabled ? normalizeString(reverseProxy.sslEmail || reverseProxy.ssl?.email).toLowerCase() : '',
      certName: REVERSE_PROXY_CERT_NAME,
    },
    publicUrls: {
      clientApp,
      processorApi,
      media: processorApi,
    },
  };
}

function getReverseProxyHostList(reverseProxy = {}) {
  return [...new Set([
    normalizeHostInput(reverseProxy.clientHost),
    normalizeHostInput(reverseProxy.processorHost),
  ].filter(Boolean))];
}

async function resolveDomainAddresses(host) {
  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    dns.resolve4(host),
    dns.resolve6(host),
  ]);
  return [
    ...(ipv4Result.status === 'fulfilled' ? ipv4Result.value : []),
    ...(ipv6Result.status === 'fulfilled' ? ipv6Result.value : []),
  ];
}

function uniqueIpv4Addresses(values = []) {
  return [...new Set(values.map(normalizeHostInput).filter((value) => net.isIP(value) === 4))];
}

function collectPrivateIpsFromNetworkInterfaces() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
    .filter(isIntranetIpAddress);
}

function extractIpv4Addresses(value = '') {
  return String(value).match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
}

function collectPrivateIpsFromSetupEnvironment() {
  return uniqueIpv4Addresses(
    extractIpv4Addresses(process.env.SAMSAR_SETUP_HOST_PRIVATE_IPS || ''),
  ).filter(isIntranetIpAddress);
}

async function fetchPublicIpAddress() {
  const candidates = [
    'https://api.ipify.org?format=json',
    'https://ifconfig.me/ip',
    'https://checkip.amazonaws.com',
  ];
  for (const url of candidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        continue;
      }
      const text = await response.text();
      const parsed = text.trim().startsWith('{')
        ? JSON.parse(text)
        : { ip: text.trim() };
      const ip = normalizeHostInput(parsed.ip || parsed.origin || text);
      if (net.isIP(ip) === 4 && !isPrivateIpAddress(ip)) {
        return ip;
      }
    } catch {
      // Try the next public IP service.
    }
  }
  return '';
}

async function collectPrivateIpsFromHostNetwork() {
  const command = "ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i==\"src\") {print $(i+1); exit}}'; hostname -I 2>/dev/null || true";
  const commandResults = await Promise.allSettled([
    runCommandCapture('sh', ['-lc', command], { cwd: ROOT_DIR }),
    runCommandCapture('docker', [
      'run',
      '--rm',
      '--network',
      'host',
      'alpine:3.20',
      'sh',
      '-lc',
      command,
    ], { cwd: ROOT_DIR }),
  ]);
  return commandResults
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => extractIpv4Addresses(result.value))
    .filter(isIntranetIpAddress);
}

async function discoverReverseProxyIpCandidates() {
  const [publicIp, hostPrivateIps, dockerDesktopRuntime] = await Promise.all([
    fetchPublicIpAddress(),
    collectPrivateIpsFromHostNetwork().catch(() => []),
    isDockerDesktopRuntime(),
  ]);
  const publicIpReachability = publicIp
    ? await probePublicIpReverseProxyReachability(publicIp)
    : { checked: false, reachable: false, message: 'No public IP detected.' };
  const setupHostPrivateIps = collectPrivateIpsFromSetupEnvironment();
  const privateIps = uniqueIpv4Addresses([
    ...setupHostPrivateIps,
    ...hostPrivateIps,
    ...collectPrivateIpsFromNetworkInterfaces(),
  ]).filter(isIntranetIpAddress);
  return {
    ok: true,
    publicIp,
    publicIpReachability,
    privateIps,
    recommendedPrivateIp: setupHostPrivateIps[0] || privateIps[0] || '',
    hostPrivateIps: setupHostPrivateIps,
    runtime: {
      dockerDesktop: dockerDesktopRuntime,
    },
  };
}

async function probePublicIpReverseProxyReachability(publicIp) {
  const host = normalizeHostInput(publicIp);
  if (!host || net.isIP(host) !== 4 || isPrivateIpAddress(host)) {
    return {
      checked: false,
      reachable: false,
      message: 'Enter a public IPv4 address.',
    };
  }

  const clientUrl = `http://${host}`;
  const processorHealthUrl = `http://${host}/api/v1/health/live`;
  const [clientReachable, processorReachable] = await Promise.all([
    checkHttp(clientUrl, {
      timeoutMs: 5000,
      isReady: isClientReadyHttpResponse,
    }),
    checkHttp(processorHealthUrl, {
      timeoutMs: 5000,
    }),
  ]);
  const reachable = clientReachable && processorReachable;
  return {
    checked: true,
    reachable,
    clientReachable,
    processorReachable,
    message: reachable
      ? 'Public IP is reachable on port 80.'
      : 'Public IP is not reachable on port 80. Use Private IP for intranet access unless your router/ISP/cloud firewall forwards public HTTP to this machine.',
  };
}

async function validateReverseProxyConfig(reverseProxyInput = {}) {
  const config = buildReverseProxyConfig(reverseProxyInput);
  if (!config.enabled) {
    return {
      ok: true,
      enabled: false,
      message: 'Reverse proxy skipped.',
      config,
    };
  }

  const hosts = getReverseProxyHostList(config);
  if (!config.clientHost || !config.processorHost) {
    throw new Error('Enter Studio and processor API host values, or skip reverse proxy.');
  }

  if (config.accessType === 'publicDomain') {
    const invalidDomains = hosts.filter((host) => net.isIP(host) || !isValidDomainName(host));
    if (invalidDomains.length) {
      throw new Error(`Enter valid domains or subdomains: ${invalidDomains.join(', ')}.`);
    }
    if (config.ssl.enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.ssl.email)) {
      throw new Error("Enter a valid email for Let's Encrypt SSL.");
    }
    if (config.machineIp && net.isIP(config.machineIp) !== 4) {
      throw new Error('Enter a valid public IPv4 address for the machine IP, or leave it blank.');
    }
    if (config.machineIp && isPrivateIpAddress(config.machineIp)) {
      throw new Error('Public domain access requires a public machine IP. Use Private IP for intranet deployments.');
    }

    const resolved = {};
    for (const host of hosts) {
      const addresses = await resolveDomainAddresses(host);
      if (!addresses.length) {
        throw new Error(`${host} does not resolve yet. Add an A record and wait for DNS propagation.`);
      }
      resolved[host] = addresses;
    }

    if (config.machineIp) {
      const mismatchedHost = Object.entries(resolved).find(([, addresses]) => !addresses.includes(config.machineIp));
      if (mismatchedHost) {
        throw new Error(`${mismatchedHost[0]} does not currently resolve to ${config.machineIp}.`);
      }
    }

    return {
      ok: true,
      enabled: true,
      message: config.ssl.enabled
        ? 'DNS validated. SSL will be requested during setup.'
        : 'DNS validated.',
      config: {
        ...config,
        resolvedAddresses: resolved,
      },
    };
  }

  const invalidIp = hosts.find((host) => net.isIP(host) !== 4);
  if (invalidIp) {
    throw new Error(`Enter IPv4 addresses for ${config.accessType === 'publicIp' ? 'public' : 'private'} IP access.`);
  }
  if (config.accessType === 'publicIp' && hosts.some(isPrivateIpAddress)) {
    throw new Error('Public IP access requires public IPv4 addresses. Use Private IP for intranet deployments.');
  }
  if (config.accessType === 'privateIp' && hosts.some((host) => !isIntranetIpAddress(host))) {
    throw new Error('Private IP access requires RFC1918 intranet addresses such as 10.x, 172.16-31.x, or 192.168.x.');
  }

  if (config.accessType === 'publicIp' && await isDockerDesktopRuntime()) {
    const reachability = await probePublicIpReverseProxyReachability(config.ipAddress || hosts[0]);
    if (!reachability.reachable) {
      throw new Error(`Public IP access is not reachable on port 80 for ${hosts.join(', ')}. This usually means the machine is behind NAT, CGNAT, a router without port forwarding, or a firewall that blocks inbound HTTP. Use Private IP for devices on this network.`);
    }
  }

  return {
    ok: true,
    enabled: true,
    message: `${config.accessType === 'publicIp' ? 'Public' : 'Private'} IP configuration validated.`,
    config,
  };
}

function normalizeGoogleCredentials(rawValue) {
  const value = normalizeString(rawValue);
  if (!value) {
    return { credentialsJsonB64: '', projectId: '' };
  }

  try {
    const parsed = JSON.parse(value);
    return {
      credentialsJsonB64: Buffer.from(JSON.stringify(parsed)).toString('base64'),
      projectId: normalizeString(parsed.project_id),
    };
  } catch {
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return {
        credentialsJsonB64: value,
        projectId: normalizeString(parsed.project_id),
      };
    } catch {
      return { credentialsJsonB64: value, projectId: '' };
    }
  }
}

function buildRuntimeConfig(payload) {
  const deployment = payload?.deployment || {};
  const credentials = payload?.credentials || {};
  const admin = payload?.admin || {};
  const services = deployment.services || {};
  const infrastructure = deployment.infrastructure || {};
  const database = buildDatabaseConfig(infrastructure);
  const storage = buildStorageConfig(infrastructure);
  const reverseProxy = buildReverseProxyConfig(deployment.reverseProxy || {});
  const publicUrls = reverseProxy.enabled
    ? reverseProxy.publicUrls
    : {
      clientApp: CLIENT_URL,
      processorApi: PROCESSOR_PUBLIC_URL,
      media: storage.staticCdnUrl || (storage.externalMediaPublishEnabled ? '' : 'http://localhost:8080'),
    };
  const googleCredentials = normalizeGoogleCredentials(credentials.googleCredentialsJson);
  const mail = buildSanitizedMailConfig(payload?.mail || {}, payload?.mailValidation);
  const workerKeys = [
    'generator',
    'assistantQueryProcessor',
    'audioGenerator',
    'aiVideoLayerGenerator',
    'videoGenerator',
    'framesProcessor',
    'expressVideoListener',
  ];
  const workersEnabled = workerKeys.some((key) => services[key] !== false);

  return readJson(EXAMPLE_CONFIG_PATH).then((exampleConfig) => ({
    ...exampleConfig,
    runtime: 'docker',
    security: {
      ...(exampleConfig.security || {}),
      dockerSetupSecret: normalizeString(payload?.setupSecret),
    },
    organization: {
      ...(exampleConfig.organization || {}),
      name: normalizeString(admin.organizationName),
    },
    mail,
    reverseProxy,
    publicUrls: {
      ...(exampleConfig.publicUrls || {}),
	      clientApp: publicUrls.clientApp || CLIENT_URL,
	      processorApi: publicUrls.processorApi || PROCESSOR_PUBLIC_URL,
	      samsarApi: exampleConfig.publicUrls?.samsarApi || 'https://api.samsar.one/v1',
	      media: publicUrls.media || storage.staticCdnUrl || (storage.externalMediaPublishEnabled ? '' : exampleConfig.publicUrls?.media || 'http://localhost:8080'),
	    },
	    database,
	    storage,
	    providers: {
      samsar: {
        enabled: Boolean(normalizeString(credentials.samsarApiKey)),
        apiKey: normalizeString(credentials.samsarApiKey),
      },
      openai: {
        enabled: Boolean(normalizeString(credentials.openaiApiKey)),
        apiKey: normalizeString(credentials.openaiApiKey),
      },
      googleCloud: {
        enabled: Boolean(googleCredentials.credentialsJsonB64),
        projectId: googleCredentials.projectId,
        credentialsJsonB64: googleCredentials.credentialsJsonB64,
      },
      fal: {
        enabled: Boolean(normalizeString(credentials.falApiKey)),
        apiKey: normalizeString(credentials.falApiKey),
      },
      elevenlabs: {
        enabled: Boolean(normalizeString(credentials.elevenLabsApiKey)),
        apiKey: normalizeString(credentials.elevenLabsApiKey),
      },
      runway: {
        enabled: Boolean(normalizeString(credentials.runwayApiKey)),
        apiKey: normalizeString(credentials.runwayApiKey),
      },
    },
    services: {
      ...(exampleConfig.services || {}),
      workers: workersEnabled,
      setupWizard: true,
      localMongo: database.provider === 'local-mongo',
      minio: storage.externalMediaPublishEnabled !== true,
      mediaGateway: storage.externalMediaPublishEnabled !== true,
      logger: services.logger !== false,
      reverseProxy: reverseProxy.enabled,
    },
  }));
}

async function writeRuntimeConfig(payload) {
  const config = await buildRuntimeConfig(payload);
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

async function writeExistingRuntimeConfig(config) {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    await fs.chmod(CONFIG_PATH, 0o600);
  } catch (_) {
    // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
  }
}

function getComposeProfiles(services = {}, infrastructure = {}, reverseProxyInput = {}) {
  const profiles = ['core'];
  const workerKeys = [
    'generator',
    'assistantQueryProcessor',
    'audioGenerator',
    'aiVideoLayerGenerator',
    'videoGenerator',
    'framesProcessor',
    'expressVideoListener',
  ];

  const database = buildDatabaseConfig(infrastructure);
  const storage = buildStorageConfig(infrastructure);
  const reverseProxy = buildReverseProxyConfig(reverseProxyInput);
  const localMongoEnabled = typeof services.localMongo === 'boolean'
    ? services.localMongo
    : database.provider === 'local-mongo';
  const minioEnabled = typeof services.minio === 'boolean'
    ? services.minio
    : storage.externalMediaPublishEnabled !== true;
  const mediaGatewayEnabled = typeof services.mediaGateway === 'boolean'
    ? services.mediaGateway
    : storage.externalMediaPublishEnabled !== true;
  const loggerEnabled = services.logger !== false;

  if (workerKeys.some((key) => services[key] !== false)) {
    profiles.push('workers');
  }
  if (localMongoEnabled) {
    profiles.push('local-mongo');
  }
  if (minioEnabled) {
    profiles.push('minio');
  }
  if (mediaGatewayEnabled) {
    profiles.push('local-media');
  }
  if (loggerEnabled) {
    profiles.push('logger');
  }
  if (reverseProxy.enabled) {
    profiles.push('reverse-proxy');
  }

  return profiles;
}

function getRuntimeComposeProfiles(config = {}) {
  const services = config.services || {};
  const profiles = ['core'];

  if (services.workers !== false) {
    profiles.push('workers');
  }
  if (services.localMongo !== false) {
    profiles.push('local-mongo');
  }
  if (services.minio !== false) {
    profiles.push('minio');
  }
  if (services.mediaGateway !== false) {
    profiles.push('local-media');
  }
  if (services.logger !== false) {
    profiles.push('logger');
  }
  if (services.reverseProxy === true || config.reverseProxy?.enabled === true) {
    profiles.push('reverse-proxy');
  }

  return profiles;
}

function hasConfiguredSamsarApiKey(credentials = {}) {
  return Boolean(normalizeString(credentials.samsarApiKey || credentials?.samsar?.apiKey));
}

function hasConfiguredRemoteMediaProvider(credentials = {}) {
  return Boolean(
    hasConfiguredSamsarApiKey(credentials) ||
    normalizeString(credentials.falApiKey || credentials?.fal?.apiKey) ||
    normalizeString(credentials.runwayApiKey || credentials?.runway?.apiKey) ||
    normalizeString(credentials.googleCredentialsJson) ||
    normalizeString(credentials.googleCloudCredentialsJsonB64 || credentials?.googleCloud?.credentialsJsonB64)
  );
}

function shouldPublishLocalMediaGateway(payload) {
  const deployment = payload?.deployment || {};
  const credentials = payload?.credentials || {};
  const infrastructure = deployment.infrastructure || {};
  const storage = buildStorageConfig(infrastructure);
  const publicMediaUrl = deployment.reverseProxy?.publicUrls?.media || deployment.publicUrls?.media;
  if (isPublicHttpUrl(publicMediaUrl)) {
    return false;
  }
  return storage.externalMediaPublishEnabled !== true && hasConfiguredRemoteMediaProvider(credentials);
}

function shouldPublishRuntimeLocalMediaGateway(config = {}) {
  const storage = config.storage || {};
  const providers = config.providers || {};
  if (isPublicHttpUrl(config.publicUrls?.media)) {
    return false;
  }
  return storage.externalMediaPublishEnabled !== true && Boolean(
    normalizeString(providers.samsar?.apiKey) ||
    normalizeString(providers.fal?.apiKey) ||
    normalizeString(providers.runway?.apiKey) ||
    normalizeString(providers.googleCloud?.credentialsJsonB64)
  );
}

async function publishLocalMediaGateway(run, profileArgs, options = {}) {
  const shouldPublish = options.runtimeConfig
    ? shouldPublishRuntimeLocalMediaGateway(options.runtimeConfig)
    : shouldPublishLocalMediaGateway(options.payload);

  if (!shouldPublish) {
    setStepStatus(run, 'media', 'complete', 'Public media gateway not required for this configuration.', { log: false });
    return;
  }

  setStepStatus(run, 'media', 'running', 'Publishing local media gateway for external Samsar adapter requests.');
  await runCommand('bash', [path.join(ROOT_DIR, 'scripts', 'start-local-media-tunnel.sh')], {
    cwd: ROOT_DIR,
    run,
    onOutput: (text) => appendLog(run, text.trim()),
  });

  const restartServices = options.includeWorkers === false
    ? ['processor']
    : MEDIA_GATEWAY_ENV_SERVICES;
  setStepStatus(run, 'media', 'running', 'Restarting Samsar services with public media gateway URL.');
  await runCommand('docker', getComposeArgs(
    ...profileArgs,
    'up',
    '-d',
    '--no-deps',
    '--force-recreate',
    ...restartServices,
  ), {
    cwd: ROOT_DIR,
    env: { COMPOSE_BAKE: 'false' },
    run,
    onOutput: (text) => appendLog(run, text.trim()),
  });
  setStepStatus(run, 'media', 'complete', 'Local media gateway published.');
}

function isSuccessfulHttpResponse(response) {
  return response.ok;
}

function isClientReadyHttpResponse(response) {
  return response.ok || response.status === 403;
}

async function waitForHttp(
  url,
  {
    timeoutMs = 120000,
    intervalMs = 2000,
    requestTimeoutMs = 8000,
    isReady = isSuccessfulHttpResponse,
    headers = {},
  } = {},
) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    const controller = requestTimeoutMs > 0 ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), requestTimeoutMs)
      : null;
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (isReady(response)) {
        return response;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError || new Error(`${url} did not become ready in time.`);
}

async function checkHttp(url, { timeoutMs = 2500, isReady = isSuccessfulHttpResponse } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    return isReady(response);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestLocalLoginUrl(admin = {}, setupSecret = '') {
  const url = new URL('/users/docker_setup_admin', PROCESSOR_INTERNAL_URL);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-docker-setup-secret': setupSecret,
    },
    body: JSON.stringify({
      email: admin.email || '',
      password: admin.password || '',
      organizationName: admin.organizationName || '',
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.message || body?.error || `Docker admin bootstrap returned ${response.status}`);
  }
  const body = await response.json();
  return body.loginUrl || CLIENT_URL;
}

async function bootstrapExistingDockerAdmin(admin) {
  const config = await readJson(CONFIG_PATH).catch(() => null);
  if (!config) {
    throw new Error('Runtime config was not found. Run setup first.');
  }

  const existingSetupSecret = normalizeString(config.security?.dockerSetupSecret);
  if (existingSetupSecret) {
    throw new Error('Docker admin setup is already configured for this installation.');
  }

  const setupSecret = randomBytes(32).toString('hex');
  const nextConfig = {
    ...config,
    security: {
      ...(config.security || {}),
      dockerSetupSecret: setupSecret,
    },
    organization: {
      ...(config.organization || {}),
      name: normalizeString(admin.organizationName),
    },
  };

  await writeExistingRuntimeConfig(nextConfig);
  await runCommand('node', [path.join(ROOT_DIR, 'scripts', 'generate-runtime-config.mjs')], {
    cwd: ROOT_DIR,
  });
  await runCommand('docker', getComposeArgs(
    '--profile',
    'core',
    'up',
    '-d',
    '--no-deps',
    '--force-recreate',
    'processor',
  ), {
    cwd: ROOT_DIR,
    env: { COMPOSE_BAKE: 'false' },
  });
  await waitForHttp(PROCESSOR_READY_URL, { timeoutMs: 180000 });
  return requestLocalLoginUrl(admin, setupSecret);
}

async function removeMediaTunnelContainer(run = null) {
  try {
    await runCommand('docker', ['rm', '-f', MEDIA_TUNNEL_CONTAINER_NAME], {
      cwd: ROOT_DIR,
      ...(run ? { run } : {}),
      onOutput: (text) => run && appendLog(run, text.trim()),
    });
  } catch {
    // The tunnel container is optional and may not exist yet.
  }
}

function normalizeFirewallPorts(ports = [], fallbackPorts = [80]) {
  const values = Array.isArray(ports) ? ports : [ports];
  const normalized = values
    .map((port) => Number.parseInt(String(port), 10))
    .filter((port) => port === 80 || port === 443);
  const uniquePorts = [...new Set(normalized)].sort((left, right) => left - right);
  return uniquePorts.length ? uniquePorts : fallbackPorts;
}

function formatFirewallPorts(ports = []) {
  const normalizedPorts = normalizeFirewallPorts(ports);
  if (normalizedPorts.length === 1) {
    return `port ${normalizedPorts[0]}`;
  }
  return `ports ${normalizedPorts.join(' and ')}`;
}

function formatTcpFirewallPorts(ports = []) {
  return normalizeFirewallPorts(ports).map((port) => `${port}/tcp`).join(' and ');
}

function parseChangedFirewallPorts(output = '') {
  const match = output.match(/SAMSAR_FIREWALL_CHANGED_PORTS=([0-9 ]*)/);
  if (!match) {
    return [];
  }
  return normalizeFirewallPorts(match[1].trim().split(/\s+/).filter(Boolean), []);
}

function cleanFirewallScriptOutput(output = '') {
  return output
    .split('\n')
    .filter((line) => !line.startsWith('SAMSAR_FIREWALL_CHANGED_PORTS='))
    .join('\n')
    .trim();
}

function shellSingleQuote(value = '') {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function summarizeCommandError(error) {
  const message = normalizeString(error?.message || error);
  if (!message) {
    return '';
  }
  const exitMatch = message.match(/failed with exit code \d+(?::\s*([\s\S]+))?$/);
  if (exitMatch) {
    return exitMatch[1]?.trim() || exitMatch[0];
  }
  return message;
}

function normalizeManagedFirewallState(value = {}) {
  const openedByPort = value.openedByPort && typeof value.openedByPort === 'object'
    ? value.openedByPort
    : {};
  const statePorts = [
    ...(Array.isArray(value.ports) ? value.ports : []),
    ...(Array.isArray(value.managedPorts) ? value.managedPorts : []),
    ...Object.keys(openedByPort),
  ];
  const ports = normalizeFirewallPorts(statePorts, []);
  return {
    ports,
    openedByPort: ports.reduce((result, port) => {
      result[port] = openedByPort[port] && typeof openedByPort[port] === 'object'
        ? openedByPort[port]
        : {};
      return result;
    }, {}),
    updatedAt: normalizeString(value.updatedAt),
  };
}

async function readManagedFirewallState() {
  const parsed = await readJson(MANAGED_FIREWALL_PORTS_PATH).catch(() => null);
  return normalizeManagedFirewallState(parsed || {});
}

async function writeManagedFirewallState(state = {}) {
  const normalizedState = normalizeManagedFirewallState({
    ...state,
    updatedAt: new Date().toISOString(),
  });
  await fs.mkdir(path.dirname(MANAGED_FIREWALL_PORTS_PATH), { recursive: true, mode: 0o700 });
  if (!normalizedState.ports.length) {
    await fs.rm(MANAGED_FIREWALL_PORTS_PATH, { force: true });
    return normalizedState;
  }

  await fs.writeFile(
    MANAGED_FIREWALL_PORTS_PATH,
    `${JSON.stringify(normalizedState, null, 2)}\n`,
    { mode: 0o600 },
  );
  return normalizedState;
}

async function rememberManagedFirewallPorts(ports = [], source = 'setup-wizard') {
  const normalizedPorts = normalizeFirewallPorts(ports, []);
  if (!normalizedPorts.length) {
    return readManagedFirewallState();
  }

  const currentState = await readManagedFirewallState();
  const openedByPort = { ...currentState.openedByPort };
  const now = new Date().toISOString();
  normalizedPorts.forEach((port) => {
    openedByPort[port] = {
      ...(openedByPort[port] || {}),
      source,
      openedAt: openedByPort[port]?.openedAt || now,
      lastConfirmedAt: now,
    };
  });
  return writeManagedFirewallState({
    ports: [...new Set([...currentState.ports, ...normalizedPorts])],
    openedByPort,
  });
}

async function forgetManagedFirewallPorts(ports = []) {
  const normalizedPorts = normalizeFirewallPorts(ports, []);
  if (!normalizedPorts.length) {
    return readManagedFirewallState();
  }

  const currentState = await readManagedFirewallState();
  const removeSet = new Set(normalizedPorts);
  const openedByPort = { ...currentState.openedByPort };
  normalizedPorts.forEach((port) => {
    delete openedByPort[port];
  });
  return writeManagedFirewallState({
    ports: currentState.ports.filter((port) => !removeSet.has(port)),
    openedByPort,
  });
}

async function closeManagedExternalAccessPorts(run = null, {
  source = 'setup-wizard',
  message = 'Closing host firewall ports opened by Samsar setup.',
} = {}) {
  const state = await readManagedFirewallState();
  if (!state.ports.length) {
    return {
      ok: true,
      source,
      ports: [],
      closedPorts: [],
      message: 'No Samsar-managed host firewall ports are recorded.',
    };
  }

  if (run) {
    appendLog(run, `${message} Ports: ${state.ports.join(', ')}.`);
  }
  const result = await tryCloseExternalAccessPorts(state.ports);
  if (!result.ok) {
    const failure = {
      ...result,
      source,
      closedPorts: [],
      message: result.message || `Unable to close ${formatFirewallPorts(state.ports)} automatically.`,
    };
    if (run) {
      appendLog(run, failure.message);
    }
    return failure;
  }

  await forgetManagedFirewallPorts(state.ports);
  const success = {
    ...result,
    source,
    closedPorts: state.ports,
    message: result.message || `Closed ${formatFirewallPorts(state.ports)} opened by Samsar setup.`,
  };
  if (run) {
    appendLog(run, success.message);
  }
  return success;
}

function getReverseProxyRequiredFirewallPorts(reverseProxy = {}) {
  if (!reverseProxy.enabled) {
    return [];
  }
  return reverseProxy.ssl?.enabled ? [80, 443] : [80];
}

function buildHostFirewallScript(action, ports = []) {
  const normalizedPorts = normalizeFirewallPorts(ports);
  const isOpenAction = action === 'open';
  const actionLabel = isOpenAction ? 'Opened' : 'Closed';
  const manualActionLabel = isOpenAction ? 'Open' : 'Close';
  const portList = normalizedPorts.join(' ');
  const tcpPortList = formatTcpFirewallPorts(normalizedPorts);

  return `
set -eu
PORTS="${portList}"
CHANGED_PORTS=""
mark_changed() {
  if [ -z "$CHANGED_PORTS" ]; then
    CHANGED_PORTS="$1"
  else
    CHANGED_PORTS="$CHANGED_PORTS $1"
  fi
}
service_for_port() {
  case "$1" in
    80) echo "http" ;;
    443) echo "https" ;;
    *) echo "$1" ;;
  esac
}
if command -v ufw >/dev/null 2>&1; then
  for port in $PORTS; do
    if [ "${isOpenAction ? 'open' : 'close'}" = "open" ]; then
      ufw status | grep -Eq "(^|[[:space:]])$port/tcp([[:space:]]|$).*ALLOW" || mark_changed "$port"
      ufw allow "$port/tcp"
    else
      ufw delete allow "$port/tcp" || true
    fi
  done
  ufw reload || true
  echo "${actionLabel} tcp ports: $PORTS with ufw."
elif command -v firewall-cmd >/dev/null 2>&1; then
  for port in $PORTS; do
    service_name="$(service_for_port "$port")"
    if [ "${isOpenAction ? 'open' : 'close'}" = "open" ]; then
      firewall-cmd --permanent --query-service="$service_name" >/dev/null 2>&1 || mark_changed "$port"
      firewall-cmd --permanent --add-service="$service_name"
    else
      firewall-cmd --permanent --remove-service="$service_name" || true
    fi
  done
  firewall-cmd --reload
  echo "${actionLabel} web service ports with firewalld."
elif command -v iptables >/dev/null 2>&1; then
  for port in $PORTS; do
    if [ "${isOpenAction ? 'open' : 'close'}" = "open" ]; then
      if iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
        :
      else
        iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
        mark_changed "$port"
      fi
    else
      while iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; do
        iptables -D INPUT -p tcp --dport "$port" -j ACCEPT || break
      done
    fi
  done
  echo "${actionLabel} iptables allow rules for tcp ports: $PORTS."
else
  echo "No supported host firewall manager found. ${manualActionLabel} ${tcpPortList} in your host, cloud firewall, or router."
  exit 3
fi
echo "SAMSAR_FIREWALL_CHANGED_PORTS=$CHANGED_PORTS"
`;
}

async function runHostFirewallScript(script) {
  try {
    return await runCommandCapture('sh', ['-lc', script], { cwd: ROOT_DIR });
  } catch (directError) {
    try {
      return await runCommandCapture('docker', [
        'run',
        '--rm',
        '--privileged',
        '--pid=host',
        '--network=host',
        'alpine:3.20',
        'sh',
        '-lc',
        `apk add --no-cache util-linux >/dev/null && nsenter -t 1 -m -u -n -i sh -lc ${shellSingleQuote(script)}`,
      ], { cwd: ROOT_DIR });
    } catch (dockerError) {
      const dockerMessage = summarizeCommandError(dockerError);
      const directMessage = summarizeCommandError(directError);
      const error = new Error(
        dockerMessage ||
        directMessage ||
        'Unable to update host firewall automatically.',
      );
      error.cause = dockerError || directError;
      throw error;
    }
  }
}

async function tryUpdateExternalAccessPorts(action, ports = []) {
  const normalizedPorts = normalizeFirewallPorts(ports);
  const script = buildHostFirewallScript(action, normalizedPorts);
  try {
    const stdout = await runHostFirewallScript(script);
    return {
      ok: true,
      ports: normalizedPorts,
      changedPorts: parseChangedFirewallPorts(stdout),
      message: cleanFirewallScriptOutput(stdout) || `${action === 'open' ? 'Opened' : 'Closed'} ${formatFirewallPorts(normalizedPorts)}.`,
    };
  } catch (error) {
    return {
      ok: false,
      ports: normalizedPorts,
      changedPorts: [],
      message: error?.message || `Unable to ${action} ${formatFirewallPorts(normalizedPorts)} automatically.`,
    };
  }
}

function tryOpenExternalAccessPorts(ports = [80]) {
  return tryUpdateExternalAccessPorts('open', ports);
}

function tryCloseExternalAccessPorts(ports = [80]) {
  return tryUpdateExternalAccessPorts('close', ports);
}

async function maybeOpenExternalAccessPorts(run, reverseProxy = {}) {
  run.openedReverseProxyPorts = [];
  const requiredPorts = getReverseProxyRequiredFirewallPorts(reverseProxy);
  if (!requiredPorts.length) {
    setStepStatus(run, 'firewall', 'complete', 'Automatic port opening skipped.', { log: false });
    return;
  }

  setStepStatus(run, 'firewall', 'running', `Trying to open host firewall ${formatFirewallPorts(requiredPorts)}.`);
  const result = await tryOpenExternalAccessPorts(requiredPorts);
  if (result.ok) {
    run.openedReverseProxyPorts = result.changedPorts || [];
    if (run.openedReverseProxyPorts.length) {
      await rememberManagedFirewallPorts(run.openedReverseProxyPorts, 'setup-wizard-run');
    }
    setStepStatus(run, 'firewall', 'complete', result.message || `${formatFirewallPorts(requiredPorts)} opened.`);
    return;
  }
  appendLog(run, result.message);
  setStepStatus(run, 'firewall', 'complete', 'Automatic port opening did not complete; continuing setup.');
}

async function maybeCloseTemporaryHttpPortAfterSsl(run, reverseProxy = {}) {
  if (!reverseProxy.enabled || !reverseProxy.ssl?.enabled || !run.openedReverseProxyPorts?.includes(80)) {
    return;
  }

  appendLog(run, 'Closing temporary host firewall port 80 after SSL setup.');
  const result = await tryCloseExternalAccessPorts([80]);
  if (result.ok) {
    await forgetManagedFirewallPorts([80]);
    appendLog(run, result.message || 'Temporary host firewall port 80 closed.');
    return;
  }
  appendLog(run, `Unable to close temporary host firewall port 80 automatically: ${result.message}`);
}

async function ensureReverseProxyRuntimeDirs() {
  await Promise.all([
    fs.mkdir(path.dirname(REVERSE_PROXY_NGINX_CONFIG_PATH), { recursive: true }),
    fs.mkdir(REVERSE_PROXY_CERTBOT_WEBROOT, { recursive: true }),
    fs.mkdir(REVERSE_PROXY_CERTBOT_CONFIG, { recursive: true }),
  ]);
}

function getReverseProxyCertPath(fileName) {
  return path.join(REVERSE_PROXY_CERTBOT_CONFIG, 'live', REVERSE_PROXY_CERT_NAME, fileName);
}

async function readReverseProxyCertificateDomains() {
  const parsed = await readJson(REVERSE_PROXY_CERT_DOMAINS_PATH).catch(() => null);
  return Array.isArray(parsed?.domains)
    ? parsed.domains.map(normalizeHostInput).filter(Boolean).sort()
    : [];
}

async function writeReverseProxyCertificateDomains(domains = []) {
  await fs.mkdir(path.dirname(REVERSE_PROXY_CERT_DOMAINS_PATH), { recursive: true });
  await fs.writeFile(
    REVERSE_PROXY_CERT_DOMAINS_PATH,
    `${JSON.stringify({ domains: [...new Set(domains)].sort() }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function reverseProxyCertificateExists() {
  try {
    await Promise.all([
      fs.access(getReverseProxyCertPath('fullchain.pem')),
      fs.access(getReverseProxyCertPath('privkey.pem')),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function requestLetsEncryptCertificate(run, reverseProxy = {}) {
  const domains = getReverseProxyHostList(reverseProxy)
    .filter((host) => isValidDomainName(host) && !net.isIP(host))
    .sort();
  if (!reverseProxy.ssl?.enabled || !domains.length) {
    return false;
  }
  const existingDomains = await readReverseProxyCertificateDomains();
  if (await reverseProxyCertificateExists() && existingDomains.length && domains.join('\n') === existingDomains.join('\n')) {
    appendLog(run, "Let's Encrypt certificate already exists.");
    return false;
  }

  const email = normalizeString(reverseProxy.ssl.email);
  if (!email) {
    throw new Error("Let's Encrypt email is required for SSL setup.");
  }

  appendLog(run, `Requesting Let's Encrypt certificate for ${domains.join(', ')}.`);
  await ensureReverseProxyRuntimeDirs();
  await runCommand('docker', [
    'run',
    '--rm',
    '-v',
    `${REVERSE_PROXY_CERTBOT_CONFIG}:/etc/letsencrypt`,
    '-v',
    `${REVERSE_PROXY_CERTBOT_WEBROOT}:/var/www/certbot`,
    'certbot/certbot:latest',
    'certonly',
    '--webroot',
    '--webroot-path',
    '/var/www/certbot',
    '--non-interactive',
    '--agree-tos',
    '--no-eff-email',
    '--keep-until-expiring',
    '--expand',
    '--cert-name',
    REVERSE_PROXY_CERT_NAME,
    '--email',
    email,
    ...domains.flatMap((domain) => ['-d', domain]),
  ], {
    cwd: ROOT_DIR,
    run,
    onOutput: (text) => appendLog(run, text.trim()),
  });
  await writeReverseProxyCertificateDomains(domains);
  return true;
}

let dockerDesktopRuntimePromise = null;

async function isDockerDesktopRuntime() {
  if (!dockerDesktopRuntimePromise) {
    dockerDesktopRuntimePromise = runCommandCapture('docker', [
      'info',
      '--format',
      '{{.OperatingSystem}}|{{.Name}}',
    ], { cwd: ROOT_DIR })
      .then((output) => /docker desktop|docker-desktop/i.test(output))
      .catch(() => false);
  }
  return dockerDesktopRuntimePromise;
}

function getUrlHostHeader(value) {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function getUrlPathWithSuffix(value, suffix = '') {
  let basePath = '';
  try {
    basePath = new URL(value).pathname || '';
  } catch {
    basePath = '';
  }
  const normalizedBase = basePath.replace(/\/+$/, '');
  const normalizedSuffix = normalizeString(suffix).replace(/^\/+/, '');
  if (normalizedBase && normalizedSuffix) {
    return `${normalizedBase}/${normalizedSuffix}`;
  }
  if (normalizedBase) {
    return normalizedBase;
  }
  return normalizedSuffix ? `/${normalizedSuffix}` : '/';
}

function buildLocalReverseProxyProbeUrl(publicUrl, suffix = '') {
  const localBaseUrl = normalizeString(process.env.SAMSAR_SETUP_REVERSE_PROXY_INTERNAL_URL) || 'http://host.docker.internal';
  return `${localBaseUrl.replace(/\/+$/, '')}${getUrlPathWithSuffix(publicUrl, suffix)}`;
}

async function validateReverseProxyLocalRouting(clientUrl, processorApi) {
  const clientHostHeader = getUrlHostHeader(clientUrl);
  const processorHostHeader = getUrlHostHeader(processorApi);
  if (!clientHostHeader || !processorHostHeader) {
    throw new Error('Reverse proxy public URLs are incomplete.');
  }

  await waitForHttp(buildLocalReverseProxyProbeUrl(clientUrl), {
    timeoutMs: 20000,
    requestTimeoutMs: 5000,
    headers: { Host: clientHostHeader },
    isReady: isClientReadyHttpResponse,
  });
  await waitForHttp(buildLocalReverseProxyProbeUrl(processorApi, '/v1/health/live'), {
    timeoutMs: 20000,
    requestTimeoutMs: 5000,
    headers: { Host: processorHostHeader },
  });
}

async function validateReverseProxyExternalUrls(clientUrl, processorApi, {
  timeoutMs = 90000,
  requestTimeoutMs = 8000,
  portHint = '',
} = {}) {
  try {
    await waitForHttp(clientUrl, {
      timeoutMs,
      requestTimeoutMs,
      isReady: isClientReadyHttpResponse,
    });
  } catch (error) {
    throw new Error(`Reverse proxy client URL ${clientUrl} was not reachable: ${error?.message || error}.${portHint}`);
  }

  const processorHealthUrl = `${processorApi.replace(/\/+$/, '')}/v1/health/live`;
  try {
    await waitForHttp(processorHealthUrl, {
      timeoutMs,
      requestTimeoutMs,
    });
  } catch (error) {
    throw new Error(`Reverse proxy processor URL ${processorHealthUrl} was not reachable: ${error?.message || error}.${portHint}`);
  }
}

async function validateReverseProxyReachability(reverseProxy = {}) {
  const clientUrl = reverseProxy.publicUrls?.clientApp;
  const processorApi = reverseProxy.publicUrls?.processorApi;
  if (!clientUrl || !processorApi) {
    throw new Error('Reverse proxy public URLs are incomplete.');
  }
  const requiredPorts = getReverseProxyRequiredFirewallPorts(reverseProxy);
  const portHint = requiredPorts.length
    ? ` Confirm ${formatFirewallPorts(requiredPorts)} ${requiredPorts.length === 1 ? 'is' : 'are'} reachable in the host firewall, cloud firewall, and any router or load balancer.`
    : '';

  const dockerDesktopRuntime = await isDockerDesktopRuntime();
  if (dockerDesktopRuntime && reverseProxy.accessType === 'privateIp' && !reverseProxy.ssl?.enabled) {
    await validateReverseProxyLocalRouting(clientUrl, processorApi);
    try {
      await validateReverseProxyExternalUrls(clientUrl, processorApi, {
        timeoutMs: 8000,
        requestTimeoutMs: 4000,
        portHint,
      });
      return { warning: '' };
    } catch (error) {
      return {
        warning: `${error?.message || error} Local nginx routing is valid, so setup will continue for private IP access. Public internet providers cannot use this private address; tunneled media URLs will still be used for external AI adapter requests.`,
      };
    }
  }

  try {
    await validateReverseProxyExternalUrls(clientUrl, processorApi, {
      timeoutMs: 90000,
      requestTimeoutMs: 8000,
      portHint,
    });
    return { warning: '' };
  } catch (error) {
    throw error;
  }
}

async function ensureReverseProxy(run, profileArgs, reverseProxy = {}) {
  if (!reverseProxy.enabled) {
    setStepStatus(run, 'proxy', 'complete', 'Reverse proxy skipped.', { log: false });
    return;
  }

  await ensureReverseProxyRuntimeDirs();
  setStepStatus(run, 'proxy', 'running', 'Configuring nginx reverse proxy.');

  if (reverseProxy.ssl?.enabled) {
    const issuedCertificate = await requestLetsEncryptCertificate(run, reverseProxy);
    if (issuedCertificate) {
      await runCommand('node', [path.join(ROOT_DIR, 'scripts', 'generate-runtime-config.mjs')], {
        cwd: ROOT_DIR,
        run,
        onOutput: (text) => appendLog(run, text.trim()),
      });
    }
  }

  await runCommand('docker', [
    ...getComposeArgs(...profileArgs, 'up', '-d', '--no-deps', '--force-recreate', 'reverse-proxy'),
  ], {
    cwd: ROOT_DIR,
    env: { COMPOSE_BAKE: 'false' },
    run,
    onOutput: (text) => appendLog(run, text.trim()),
  });

  setStepStatus(run, 'proxy', 'running', 'Validating configured reverse proxy URLs.');
  let reverseProxyValidation = { warning: '' };
  try {
    reverseProxyValidation = await validateReverseProxyReachability(reverseProxy);
  } finally {
    await maybeCloseTemporaryHttpPortAfterSsl(run, reverseProxy);
  }
  if (reverseProxyValidation?.warning) {
    appendLog(run, reverseProxyValidation.warning);
    setStepStatus(run, 'proxy', 'complete', 'Reverse proxy is reachable locally; external self-check returned a warning.');
    return;
  }
  setStepStatus(run, 'proxy', 'complete', 'Reverse proxy is reachable.');
}

async function cleanupComposeStack(run) {
  const profileArgs = ALL_COMPOSE_PROFILES.flatMap((profile) => ['--profile', profile]);
  await ensureComposeEnvFile();
  setStepStatus(run, 'cleanup', 'running', 'Cleaning any previous Samsar Docker Compose containers.');
  await closeManagedExternalAccessPorts(run, {
    source: 'setup-wizard-cleanup',
    message: 'Closing host firewall ports opened by previous Samsar setup before deleting or recreating containers.',
  });
  await removeMediaTunnelContainer(run);
  await runCommand('docker', getComposeArgs(...profileArgs, 'down', '--remove-orphans'), {
    cwd: ROOT_DIR,
    env: { COMPOSE_BAKE: 'false' },
    run,
    onOutput: (text) => appendLog(run, text.trim()),
  });
  setStepStatus(run, 'cleanup', 'complete', 'Previous Docker Compose containers cleaned.');
}

async function recoverSetupRun(runId, existingRun = null) {
  const run = existingRun || {
    id: runId || randomUUID(),
    status: 'running',
    currentStep: 'processor',
    steps: SETUP_STEPS.map((step) => ({ ...step, status: 'pending', message: '' })),
    logs: [],
    error: '',
    redirectUrl: '',
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  run.recovered = true;

  if (!run.recoveryLogged) {
    appendLog(run, 'Recovered setup state after the setup wizard restarted.');
    run.recoveryLogged = true;
  }

  ['cleanup', 'config', 'runtime', 'firewall', 'compose', 'proxy', 'media'].forEach((stepId) => {
    setStepStatus(run, stepId, 'complete', 'Recovered from local Docker state.', { log: false });
  });

  run.status = 'running';
  run.error = '';
  run.completedAt = null;

  const processorReady = await checkHttp(PROCESSOR_READY_URL);
  if (!processorReady) {
    setStepStatus(run, 'processor', 'running', 'Waiting for samsar-processor after setup wizard restart.', { log: false });
    runs.set(run.id, run);
    return run;
  }
  setStepStatus(run, 'processor', 'complete', 'samsar-processor is ready.', { log: false });

  const clientReady = await checkHttp(CLIENT_INTERNAL_URL, { isReady: isClientReadyHttpResponse });
  if (!clientReady) {
    setStepStatus(run, 'client', 'running', 'Waiting for samsar-client after setup wizard restart.', { log: false });
    runs.set(run.id, run);
    return run;
  }
  setStepStatus(run, 'client', 'complete', 'samsar-client is ready.', { log: false });

  try {
    setStepStatus(run, 'login', 'running', 'Preparing local authenticated session.', { log: false });
    run.redirectUrl = `${CLIENT_URL.replace(/\/+$/, '')}/login?redirect=%2Fvidgenie`;
    setStepStatus(run, 'login', 'complete', 'Open the client and sign in with the configured admin credentials.', { log: false });
    run.status = 'completed';
    run.completedAt = new Date().toISOString();
  } catch (error) {
    run.status = 'failed';
    run.error = `Local containers are running, but the login URL could not be created: ${error?.message || String(error)}`;
    setStepStatus(run, 'login', 'failed', run.error, { log: false });
  }

  runs.set(run.id, run);
  return run;
}

async function runSetup(run, payload) {
  try {
    await cleanupComposeStack(run);

    setStepStatus(run, 'config', 'running', 'Writing runtime/config/samsar.config.json');
    await writeRuntimeConfig(payload);
    await writeMailSecrets(payload?.mail || {}, payload?.mailValidation);
    setStepStatus(run, 'config', 'complete', 'Runtime config saved.');

    setStepStatus(run, 'runtime', 'running', 'Rendering runtime env files.');
    await runCommand('node', [path.join(ROOT_DIR, 'scripts', 'generate-runtime-config.mjs')], {
      cwd: ROOT_DIR,
      run,
      onOutput: (text) => appendLog(run, text.trim()),
    });
    setStepStatus(run, 'runtime', 'complete', 'Runtime env files rendered.');

    const profiles = getComposeProfiles(
      payload?.deployment?.services || {},
      payload?.deployment?.infrastructure || {},
      payload?.deployment?.reverseProxy || {},
    );
    const profileArgs = profiles.flatMap((profile) => ['--profile', profile]);
    const reverseProxy = buildReverseProxyConfig(payload?.deployment?.reverseProxy || {});
    await maybeOpenExternalAccessPorts(run, reverseProxy);

    setStepStatus(run, 'compose', 'running', `Starting Docker Compose profiles: ${profiles.join(', ')}`);
    await runCommand('docker', getComposeArgs(...profileArgs, 'up', '-d', '--build'), {
      cwd: ROOT_DIR,
      env: { COMPOSE_BAKE: 'false' },
      run,
      onOutput: (text) => appendLog(run, text.trim()),
    });
    setStepStatus(run, 'compose', 'complete', 'Docker containers started.');

    await ensureReverseProxy(run, profileArgs, reverseProxy);

    await publishLocalMediaGateway(run, profileArgs, {
      payload,
      includeWorkers: profiles.includes('workers'),
    });

    setStepStatus(run, 'processor', 'running', 'Waiting for samsar-processor.');
    await waitForHttp(PROCESSOR_READY_URL, { timeoutMs: 180000 });
    setStepStatus(run, 'processor', 'complete', 'samsar-processor is ready.');

    setStepStatus(run, 'client', 'running', 'Waiting for samsar-client.');
    await waitForHttp(CLIENT_INTERNAL_URL, {
      timeoutMs: 180000,
      isReady: isClientReadyHttpResponse,
    });
    setStepStatus(run, 'client', 'complete', 'samsar-client is ready.');

    setStepStatus(run, 'login', 'running', 'Preparing local authenticated session.');
    run.redirectUrl = await requestLocalLoginUrl(payload.admin, payload.setupSecret);
    setStepStatus(run, 'login', 'complete', 'Admin account prepared.');

    run.status = 'completed';
    run.completedAt = new Date().toISOString();
  } catch (error) {
    if (!run.cancelled) {
      failRun(run, error);
    }
  }
}

async function runDockerMaintenance(run) {
  const composeEnv = { COMPOSE_BAKE: 'false' };

  try {
    await ensureComposeEnvFile();

    setStepStatus(run, 'runtime', 'running', 'Rendering runtime env files.');
    await runCommand('node', [path.join(ROOT_DIR, 'scripts', 'generate-runtime-config.mjs')], {
      cwd: ROOT_DIR,
      run,
      onOutput: (text) => appendLog(run, text.trim()),
    });
    setStepStatus(run, 'runtime', 'complete', 'Runtime env files rendered.');

    const runtimeConfig = await readJson(CONFIG_PATH).catch(() => readJson(EXAMPLE_CONFIG_PATH));
    const profiles = getRuntimeComposeProfiles(runtimeConfig);
    const profileArgs = profiles.flatMap((profile) => ['--profile', profile]);
    const reverseProxy = buildReverseProxyConfig(runtimeConfig.reverseProxy || {});

    await closeManagedExternalAccessPorts(run, {
      source: 'setup-wizard-maintenance',
      message: 'Closing host firewall ports opened by previous Samsar setup before recreating containers.',
    });

    setStepStatus(run, 'pull', 'running', 'Pulling available images.');
    try {
      await runCommand('docker', getComposeArgs(...profileArgs, 'pull', '--ignore-pull-failures'), {
        cwd: ROOT_DIR,
        env: composeEnv,
        run,
        onOutput: (text) => appendLog(run, text.trim()),
      });
      setStepStatus(run, 'pull', 'complete', 'Image pull finished.');
    } catch (error) {
      appendLog(run, error?.message || String(error));
      setStepStatus(run, 'pull', 'complete', 'Image pull finished with warnings; continuing with rebuild.');
    }

    await maybeOpenExternalAccessPorts(run, reverseProxy);

    setStepStatus(run, 'compose', 'running', 'Rebuilding and restarting Docker containers.');
    await runCommand('docker', getComposeArgs(...profileArgs, 'up', '-d', '--build', '--remove-orphans'), {
      cwd: ROOT_DIR,
      env: composeEnv,
      run,
      onOutput: (text) => appendLog(run, text.trim()),
    });
    setStepStatus(run, 'compose', 'complete', 'Docker containers updated and restarted.');

    await ensureReverseProxy(run, profileArgs, reverseProxy);

    await publishLocalMediaGateway(run, profileArgs, {
      runtimeConfig,
      includeWorkers: profiles.includes('workers'),
    });

    setStepStatus(run, 'processor', 'running', 'Waiting for samsar-processor.');
    await waitForHttp(PROCESSOR_READY_URL, { timeoutMs: 180000 });
    setStepStatus(run, 'processor', 'complete', 'samsar-processor is ready.');

    setStepStatus(run, 'client', 'running', 'Waiting for samsar-client.');
    await waitForHttp(CLIENT_INTERNAL_URL, {
      timeoutMs: 180000,
      isReady: isClientReadyHttpResponse,
    });
    setStepStatus(run, 'client', 'complete', 'samsar-client is ready.');

    run.redirectUrl = CLIENT_URL;
    run.status = 'completed';
    run.completedAt = new Date().toISOString();
  } catch (error) {
    if (!run.cancelled) {
      failRun(run, error);
    }
  }
}

async function ensureComposeEnvFile() {
  await fs.mkdir(path.dirname(ROOT_ENV_PATH), { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(path.dirname(ROOT_ENV_PATH), 0o700);
  } catch (_) {
    // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
  }
  try {
    await fs.access(ROOT_ENV_PATH);
  } catch {
    await fs.writeFile(ROOT_ENV_PATH, '', { mode: 0o600 });
  }
  try {
    await fs.chmod(ROOT_ENV_PATH, 0o600);
  } catch (_) {
    // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
  }
}

async function removeGeneratedRuntimeFiles() {
  await Promise.allSettled([
    fs.rm(CONFIG_PATH, { force: true }),
    fs.rm(AVAILABLE_MODELS_PATH, { force: true }),
    fs.rm(ROOT_ENV_PATH, { force: true }),
    fs.rm(MAIL_SECRETS_PATH, { force: true }),
    fs.rm(REVERSE_PROXY_NGINX_CONFIG_PATH, { force: true }),
    fs.rm(REVERSE_PROXY_CERT_DOMAINS_PATH, { force: true }),
  ]);
}

async function resetSetup(payload = {}) {
  const runId = typeof payload.runId === 'string' ? payload.runId : '';
  const runsToCancel = [...runs.values()].filter((run) => (
    run.status === 'running' && (!runId || run.id === runId)
  ));
  runsToCancel.forEach((run) => cancelRun(run));
  [...maintenanceRuns.values()]
    .filter((run) => run.status === 'running')
    .forEach((run) => cancelRun(run, 'Setup reset cancelled the Docker maintenance run.'));

  const profileArgs = ALL_COMPOSE_PROFILES.flatMap((profile) => ['--profile', profile]);

  await ensureComposeEnvFile();
  await closeManagedExternalAccessPorts(null, {
    source: 'setup-wizard-reset',
    message: 'Closing host firewall ports opened by Samsar setup before deleting containers.',
  });
  await removeMediaTunnelContainer();
  await runCommand('docker', getComposeArgs(...profileArgs, 'down', '--remove-orphans'), {
    cwd: ROOT_DIR,
  });
  await removeGeneratedRuntimeFiles();
}

function redactConfiguredValue(value) {
  return Boolean(normalizeString(value));
}

function summarizeRuntimeConfig(config = {}) {
  const providers = config.providers || {};
  const services = config.services || {};
  const database = config.database || {};
  const storage = config.storage || {};
  const publicUrls = config.publicUrls || {};
  const reverseProxy = config.reverseProxy || {};

  return {
    runtime: config.runtime || 'docker',
    providers: Object.fromEntries(
      Object.entries(providers).map(([key, provider]) => [
        key,
        {
          enabled: provider?.enabled === true,
          configured: redactConfiguredValue(provider?.apiKey || provider?.credentialsJsonB64 || provider?.projectId),
        },
      ]),
    ),
    services: {
      workers: services.workers !== false,
      localMongo: services.localMongo !== false,
      minio: services.minio !== false,
      mediaGateway: services.mediaGateway !== false,
      logger: services.logger !== false,
      reverseProxy: services.reverseProxy === true || reverseProxy.enabled === true,
    },
    database: {
      provider: database.provider || 'local-mongo',
      mode: database.provider === 'remote-mongo' ? 'remote' : 'local',
    },
    storage: {
      provider: storage.provider || 's3-compatible',
      mode: storage.externalMediaPublishEnabled === true ? 'external-s3' : 'local-minio',
      mediaBucketName: storage.mediaBucketName || '',
      staticCdnUrl: storage.staticCdnUrl || '',
      externalMediaPublishEnabled: storage.externalMediaPublishEnabled === true,
    },
    publicUrls: {
      clientApp: publicUrls.clientApp || CLIENT_URL,
      processorApi: publicUrls.processorApi || PROCESSOR_PUBLIC_URL,
      media: publicUrls.media || '',
    },
    reverseProxy: {
      enabled: reverseProxy.enabled === true,
      accessType: reverseProxy.accessType || '',
      clientHost: reverseProxy.clientHost || '',
      processorHost: reverseProxy.processorHost || '',
      sslEnabled: reverseProxy.ssl?.enabled === true,
    },
    security: {
      dockerSetupConfigured: Boolean(config.security?.dockerSetupSecret),
    },
    mail: {
      configured: config.mail?.configured === true,
      provider: config.mail?.provider || 'none',
      fromAddress: config.mail?.fromAddress || '',
      replyToAddress: config.mail?.replyToAddress || '',
    },
  };
}

async function getComposeContainerSummary() {
  try {
    const stdout = await runCommandCapture('docker', [
      'ps',
      '-a',
      '--filter',
      'label=com.docker.compose.project=samsar',
      '--format',
      '{{.Names}}\t{{.State}}\t{{.Status}}',
    ]);
    const containers = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, state, status] = line.split('\t');
        return { name, state, status };
      });

    return {
      total: containers.length,
      running: containers.filter((container) => container.state === 'running').length,
      containers,
    };
  } catch {
    return {
      total: 0,
      running: 0,
      containers: [],
    };
  }
}

async function getInstallStatus() {
  const config = await readJson(CONFIG_PATH).catch(() => null);
  const compose = await getComposeContainerSummary();
  const processorReady = compose.total > 0
    ? await checkHttp(PROCESSOR_READY_URL, { timeoutMs: 1200 })
    : false;
  const clientReady = compose.total > 0
    ? await checkHttp(CLIENT_INTERNAL_URL, { timeoutMs: 1200, isReady: isClientReadyHttpResponse })
    : false;

  return {
    installed: Boolean(config && compose.total > 0),
    hasRuntimeConfig: Boolean(config),
    compose,
    readiness: {
      processor: processorReady,
      client: clientReady,
    },
    config: config ? summarizeRuntimeConfig(config) : null,
  };
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/setup/health') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/setup/install-status') {
    sendJson(res, 200, await getInstallStatus());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/setup/reverse-proxy/ip-candidates') {
    try {
      sendJson(res, 200, await discoverReverseProxyIpCandidates());
    } catch (error) {
      sendJson(res, 500, { ok: false, message: error?.message || 'Unable to detect system IP addresses.' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/setup/mail/validate') {
    const payload = await readRequestBody(req);
    try {
      const validation = await validateMailConfig(payload.mail || payload);
      sendJson(res, 200, validation);
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error?.message || 'Mail validation failed.' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/setup/reverse-proxy/validate') {
    const payload = await readRequestBody(req);
    try {
      const validation = await validateReverseProxyConfig(payload.reverseProxy || payload);
      sendJson(res, 200, validation);
    } catch (error) {
      sendJson(res, 400, { ok: false, message: error?.message || 'Reverse proxy validation failed.' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/setup/firewall/open-web-ports') {
    const payload = await readRequestBody(req);
    const result = await tryOpenExternalAccessPorts(payload.ports || [80]);
    if (result.ok && result.changedPorts?.length) {
      await rememberManagedFirewallPorts(result.changedPorts, payload.source || 'setup-wizard-manual');
    }
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/setup/firewall/close-managed-ports') {
    const payload = await readRequestBody(req);
    const result = await closeManagedExternalAccessPorts(null, {
      source: payload.source || 'setup-wizard-api',
      message: payload.message || 'Closing host firewall ports opened by Samsar setup.',
    });
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/setup/start') {
    const payload = await readRequestBody(req);
    const runningRun = [...runs.values()].find((run) => run.status === 'running');
    if (runningRun) {
      sendJson(res, 200, cloneRun(runningRun));
      return true;
    }

    try {
      payload.admin = buildAdminConfig(payload.admin);
      payload.setupSecret = randomBytes(32).toString('hex');
      payload.mailValidation = await validateMailConfig(payload.mail || {});
      const reverseProxyValidation = await validateReverseProxyConfig(payload.deployment?.reverseProxy || {});
      payload.reverseProxyValidation = reverseProxyValidation;
      payload.deployment = {
        ...(payload.deployment || {}),
        reverseProxy: reverseProxyValidation.config,
      };
    } catch (error) {
      sendJson(res, 400, { message: error?.message || 'Setup validation failed.' });
      return true;
    }

    const run = {
      id: randomUUID(),
      status: 'running',
      currentStep: 'cleanup',
      steps: SETUP_STEPS.map((step) => ({ ...step, status: 'pending', message: '' })),
      logs: [],
      error: '',
      redirectUrl: '',
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    runs.set(run.id, run);
    void runSetup(run, payload);
    sendJson(res, 202, cloneRun(run));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/setup/admin/bootstrap-existing') {
    try {
      const payload = await readRequestBody(req);
      const admin = buildAdminConfig(payload.admin || payload);
      const redirectUrl = await bootstrapExistingDockerAdmin(admin);
      sendJson(res, 200, { ok: true, redirectUrl });
    } catch (error) {
      sendJson(res, 400, { message: error?.message || 'Unable to bootstrap Docker admin.' });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/setup/reset') {
    const payload = await readRequestBody(req);
    await resetSetup(payload);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/setup/maintenance/update-restart') {
    const runningRun = [...maintenanceRuns.values()].find((run) => run.status === 'running');
    if (runningRun) {
      sendJson(res, 200, cloneRun(runningRun));
      return true;
    }

    const run = {
      id: randomUUID(),
      status: 'running',
      currentStep: 'runtime',
      steps: MAINTENANCE_STEPS.map((step) => ({ ...step, status: 'pending', message: '' })),
      logs: [],
      error: '',
      redirectUrl: '',
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
    maintenanceRuns.set(run.id, run);
    void runDockerMaintenance(run);
    sendJson(res, 202, cloneRun(run));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/setup/maintenance/status') {
    const requestUrl = new URL(req.url, 'http://localhost');
    const runId = requestUrl.searchParams.get('id');
    const run = maintenanceRuns.get(runId);
    if (!run) {
      sendJson(res, 404, { message: 'Docker maintenance run not found.' });
      return true;
    }
    sendJson(res, 200, cloneRun(run));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/setup/status') {
    const requestUrl = new URL(req.url, 'http://localhost');
    const runId = requestUrl.searchParams.get('id');
    const run = runs.get(runId);
    if (run?.recovered && run.status === 'running') {
      sendJson(res, 200, cloneRun(await recoverSetupRun(run.id, run)));
      return true;
    }
    if (!run) {
      sendJson(res, 200, cloneRun(await recoverSetupRun(runId)));
      return true;
    }
    sendJson(res, 200, cloneRun(run));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/setup/recover') {
    const requestUrl = new URL(req.url, 'http://localhost');
    const runId = requestUrl.searchParams.get('id');
    const run = await recoverSetupRun(runId, runs.get(runId));
    sendJson(res, 200, cloneRun(run));
    return true;
  }

  return false;
}

function isAllowedCorsOrigin(origin) {
  if (!origin) {
    return false;
  }
  return [
    CLIENT_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].includes(origin);
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedCorsOrigin(origin)) {
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function serveStatic(req, res, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const decodedPath = decodeURIComponent(requestPath);
  const candidatePath = path.join(STATIC_DIR, decodedPath);
  const filePath = isPathInside(STATIC_DIR, candidatePath) ? candidatePath : path.join(STATIC_DIR, 'index.html');

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error('Not a file');
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': stat.size,
    });
    createReadStream(filePath).pipe(res);
  } catch {
    const indexPath = path.join(STATIC_DIR, 'index.html');
    const stat = await fs.stat(indexPath);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': stat.size,
    });
    createReadStream(indexPath).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname.startsWith('/api/')) {
      applyCorsHeaders(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      const handled = await handleApi(req, res, requestUrl.pathname);
      if (!handled) {
        sendJson(res, 404, { message: 'Not found.' });
      }
      return;
    }
    await serveStatic(req, res, requestUrl.pathname);
  } catch (error) {
    sendJson(res, 500, { message: error?.message || 'Internal setup wizard error.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Samsar setup wizard listening on ${PORT}`);
});
