import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
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
  { id: 'compose', label: 'Build and start containers' },
  { id: 'media', label: 'Publish local media gateway' },
  { id: 'processor', label: 'Verify processor API' },
  { id: 'client', label: 'Verify Samsar client' },
  { id: 'login', label: 'Prepare local login' },
];

const MAINTENANCE_STEPS = [
  { id: 'runtime', label: 'Render runtime environment' },
  { id: 'pull', label: 'Pull latest images' },
  { id: 'compose', label: 'Update and restart containers' },
  { id: 'media', label: 'Publish local media gateway' },
  { id: 'processor', label: 'Verify processor API' },
  { id: 'client', label: 'Verify Samsar client' },
];

const runs = new Map();
const maintenanceRuns = new Map();
const ALL_COMPOSE_PROFILES = ['core', 'workers', 'local-mongo', 'minio', 'local-media', 'logger'];
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
    sanitized.ses = {
      region: normalizeString(mail.sesRegion || mail.ses?.region) || 'us-east-1',
      accessKeyConfigured: Boolean(normalizeString(mail.sesAccessKeyId || mail.ses?.accessKeyId)),
      sessionTokenConfigured: Boolean(normalizeString(mail.sesSessionToken || mail.ses?.sessionToken)),
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
    secrets.ses = {
      region: normalizeString(mail.sesRegion || mail.ses?.region) || 'us-east-1',
      accessKeyId: normalizeString(mail.sesAccessKeyId || mail.ses?.accessKeyId),
      secretAccessKey: typeof mail.sesSecretAccessKey === 'string' ? mail.sesSecretAccessKey : mail.ses?.secretAccessKey || '',
      sessionToken: typeof mail.sesSessionToken === 'string' ? mail.sesSessionToken : mail.ses?.sessionToken || '',
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
  const accessKeyId = normalizeString(mail.sesAccessKeyId || mail.ses?.accessKeyId);
  const secretAccessKey = typeof mail.sesSecretAccessKey === 'string' ? mail.sesSecretAccessKey : mail.ses?.secretAccessKey || '';
  const sessionToken = typeof mail.sesSessionToken === 'string' ? mail.sesSessionToken : mail.ses?.sessionToken || '';

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('SES access key ID and secret access key are required.');
  }

  const client = new SESClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });

  await client.send(new GetSendQuotaCommand({}));

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
    publicUrls: {
      ...(exampleConfig.publicUrls || {}),
	      clientApp: CLIENT_URL,
	      processorApi: PROCESSOR_PUBLIC_URL,
	      samsarApi: exampleConfig.publicUrls?.samsarApi || 'https://api.samsar.one/v1',
	      media: storage.staticCdnUrl || (storage.externalMediaPublishEnabled ? '' : exampleConfig.publicUrls?.media || 'http://localhost:8080'),
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

function getComposeProfiles(services = {}, infrastructure = {}) {
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
  return storage.externalMediaPublishEnabled !== true && hasConfiguredRemoteMediaProvider(credentials);
}

function shouldPublishRuntimeLocalMediaGateway(config = {}) {
  const storage = config.storage || {};
  const providers = config.providers || {};
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
  await runCommand('docker', [
    'compose',
    '-f',
    COMPOSE_FILE,
    ...profileArgs,
    'up',
    '-d',
    '--no-deps',
    '--force-recreate',
    ...restartServices,
  ], {
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
  { timeoutMs = 120000, intervalMs = 2000, isReady = isSuccessfulHttpResponse } = {},
) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (isReady(response)) {
        return response;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
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
  await runCommand('docker', [
    'compose',
    '-f',
    COMPOSE_FILE,
    '--profile',
    'core',
    'up',
    '-d',
    '--no-deps',
    '--force-recreate',
    'processor',
  ], {
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

async function cleanupComposeStack(run) {
  const profileArgs = ALL_COMPOSE_PROFILES.flatMap((profile) => ['--profile', profile]);
  await ensureComposeEnvFile();
  setStepStatus(run, 'cleanup', 'running', 'Cleaning any previous Samsar Docker Compose containers.');
  await removeMediaTunnelContainer(run);
  await runCommand('docker', ['compose', '-f', COMPOSE_FILE, ...profileArgs, 'down', '--remove-orphans'], {
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

  ['cleanup', 'config', 'runtime', 'compose', 'media'].forEach((stepId) => {
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
    );
    const profileArgs = profiles.flatMap((profile) => ['--profile', profile]);
    setStepStatus(run, 'compose', 'running', `Starting Docker Compose profiles: ${profiles.join(', ')}`);
    await runCommand('docker', ['compose', '-f', COMPOSE_FILE, ...profileArgs, 'up', '-d', '--build'], {
      cwd: ROOT_DIR,
      env: { COMPOSE_BAKE: 'false' },
      run,
      onOutput: (text) => appendLog(run, text.trim()),
    });
    setStepStatus(run, 'compose', 'complete', 'Docker containers started.');

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

    setStepStatus(run, 'pull', 'running', 'Pulling available images.');
    try {
      await runCommand('docker', ['compose', '-f', COMPOSE_FILE, ...profileArgs, 'pull', '--ignore-pull-failures'], {
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

    setStepStatus(run, 'compose', 'running', 'Rebuilding and restarting Docker containers.');
    await runCommand('docker', ['compose', '-f', COMPOSE_FILE, ...profileArgs, 'up', '-d', '--build', '--remove-orphans'], {
      cwd: ROOT_DIR,
      env: composeEnv,
      run,
      onOutput: (text) => appendLog(run, text.trim()),
    });
    setStepStatus(run, 'compose', 'complete', 'Docker containers updated and restarted.');

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
  await removeMediaTunnelContainer();
  await runCommand('docker', ['compose', '-f', COMPOSE_FILE, ...profileArgs, 'down', '--remove-orphans'], {
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
