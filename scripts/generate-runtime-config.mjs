import fs from 'node:fs';
import path from 'node:path';
import { buildDockerAvailableModelsFromEnabledProviders } from '../apps/setup-wizard/src/constants/dockerModelAvailability.js';
import { buildDockerAudioAvailability } from './docker-audio-provider-config.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const runtimeConfigDir = path.join(root, 'runtime', 'config');
const runtimeSecretsDir = path.join(root, 'runtime', 'secrets');
const configPath = path.join(runtimeConfigDir, 'samsar.config.json');
const exampleConfigPath = path.join(root, 'samsar.config.example.json');
const mailSecretsPath = path.join(runtimeSecretsDir, 'mail.credentials.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? readJson(filePath) : null;
}

const config = fs.existsSync(configPath)
  ? readJson(configPath)
  : readJson(exampleConfigPath);
const mailSecrets = readJsonIfExists(mailSecretsPath) || {};
const storageConfig = config.storage || {};
const databaseConfig = config.database || {};
const cloudFrontConfig = storageConfig.cloudFront || {};
const mailConfig = config.mail || {};
const isDockerRuntime = config.runtime !== 'local';
const storageProvider = storageConfig.provider || (isDockerRuntime ? 's3-compatible' : 'aws-s3-cloudfront');
const isS3CompatibleStorage = storageProvider === 's3-compatible';
const defaultLocalS3AccessKey = isDockerRuntime && isS3CompatibleStorage ? 'samsar' : '';
const defaultLocalS3SecretKey = isDockerRuntime && isS3CompatibleStorage ? 'samsar-local-password' : '';
const s3Endpoint = storageConfig.s3Endpoint || '';
const s3ForcePathStyle = String(Boolean(storageConfig.s3ForcePathStyle));
const storageBucketName = storageConfig.mediaBucketName || 'samsar-resources';
const storageRegion = storageConfig.region || storageConfig.awsRegion || 'us-east-1';
const storageAccessKeyId = storageConfig.accessKeyId || storageConfig.awsAccessKeyId || defaultLocalS3AccessKey;
const storageSecretAccessKey = storageConfig.secretAccessKey || storageConfig.awsSecretAccessKey || defaultLocalS3SecretKey;
const externalMediaPublishEnabled = Boolean(storageConfig.externalMediaPublishEnabled);
const mediaDeliveryMode = isDockerRuntime && !externalMediaPublishEnabled
  ? 'docker-local'
  : 's3-cloudfront';
const loggerEnabled = config.services?.logger !== false;
const mediaPublicUrl = externalMediaPublishEnabled
  ? (storageConfig.staticCdnUrl || config.publicUrls?.media || '')
  : (config.publicUrls?.media || 'http://localhost:8080');
const externalMediaPublicBaseUrl = externalMediaPublishEnabled
  ? (storageConfig.staticCdnUrl || '')
  : mediaPublicUrl;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMailProvider(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (['smtp', 'ses', 'ses-api', 'none', 'disabled'].includes(normalized)) {
    return normalized === 'ses-api' ? 'ses' : normalized === 'disabled' ? 'none' : normalized;
  }
  return 'none';
}

function buildMailEnv() {
  const provider = normalizeMailProvider(mailSecrets.provider || mailConfig.provider);
  const configured = Boolean(mailSecrets.configured && provider !== 'none');
  const fromAddress =
    normalizeString(mailSecrets.fromAddress) ||
    normalizeString(mailConfig.fromAddress) ||
    '';
  const replyToAddress =
    normalizeString(mailSecrets.replyToAddress) ||
    normalizeString(mailConfig.replyToAddress) ||
    fromAddress;

  if (!configured) {
    return {
      MAIL_PROVIDER: 'none',
      SAMSAR_MAIL_PROVIDER: 'none',
      SAMSAR_MAIL_CONFIGURED: 'false',
      SES_FROM_ADDRESS: '',
      SES_REPLY_TO_ADDRESS: '',
    };
  }

  const baseEnv = {
    MAIL_PROVIDER: provider,
    SAMSAR_MAIL_PROVIDER: provider,
    SAMSAR_MAIL_CONFIGURED: 'true',
    MAIL_FROM_ADDRESS: fromAddress,
    MAIL_REPLY_TO_ADDRESS: replyToAddress,
    SES_FROM_ADDRESS: fromAddress,
    SES_REPLY_TO_ADDRESS: replyToAddress,
    SMTP_FROM_ADDRESS: fromAddress,
    SMTP_REPLY_TO_ADDRESS: replyToAddress,
  };

  if (provider === 'smtp') {
    const smtp = mailSecrets.smtp || {};
    return {
      ...baseEnv,
      SMTP_HOST: normalizeString(smtp.host),
      SMTP_PORT: normalizeString(smtp.port || '587'),
      SMTP_SECURE: String(Boolean(smtp.secure)),
      SMTP_USER: normalizeString(smtp.username),
      SMTP_PASSWORD: typeof smtp.password === 'string' ? smtp.password : '',
    };
  }

  const ses = mailSecrets.ses || {};
  return {
    ...baseEnv,
    SES_REGION: normalizeString(ses.region) || 'us-east-1',
    AWS_SES_REGION: normalizeString(ses.region) || 'us-east-1',
    AWS_SES_ACCESS_KEY_ID: normalizeString(ses.accessKeyId),
    AWS_SES_SECRET_ACCESS_KEY: typeof ses.secretAccessKey === 'string' ? ses.secretAccessKey : '',
    AWS_SES_SESSION_TOKEN: typeof ses.sessionToken === 'string' ? ses.sessionToken : '',
  };
}

function isProviderEnabled(providerConfig = {}) {
  return Boolean(providerConfig.enabled);
}

function buildAvailableModels(providers = {}) {
  const providerNames = Object.entries(providers)
    .filter(([, providerConfig]) => isProviderEnabled(providerConfig))
    .map(([provider]) => provider);

  return {
    ...buildDockerAvailableModelsFromEnabledProviders(providerNames),
    audio: buildDockerAudioAvailability(providers),
  };
}

fs.mkdirSync(runtimeConfigDir, { recursive: true });
fs.mkdirSync(runtimeSecretsDir, { recursive: true, mode: 0o700 });
try {
  fs.chmodSync(runtimeSecretsDir, 0o700);
} catch (_) {
  // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
}

const env = {
  CURRENT_ENV: config.runtime === 'local' ? 'development' : 'docker',
  NODE_ENV: config.runtime === 'local' ? 'development' : 'production',
  TOKEN_SECRET: config.security?.tokenSecret || 'samsar-local-token-secret-change-me',
  CUSTOM_ADAPTER_SECRET_KEY: config.security?.customAdapterSecret || config.security?.tokenSecret || 'samsar-local-custom-adapter-secret-change-me',
	  LOGIN_TOKEN_TTL_SECONDS: config.security?.loginTokenTtlSeconds || 3600,
	  ENABLE_DOCKER_SETUP_LOGIN: config.runtime === 'docker' ? 'true' : 'false',
	  DATABASE_PROVIDER: databaseConfig.provider || 'local-mongo',
	  MONGO_URL: databaseConfig.mongoUrl || '',
	  MONGO_HOSTS: databaseConfig.parsed?.hosts || '',
	  MONGO_DATABASE: databaseConfig.parsed?.database || '',
	  MONGO_USERNAME: databaseConfig.parsed?.username || '',
	  MONGO_AUTH_SOURCE: databaseConfig.parsed?.authSource || '',
	  MONGO_TLS: databaseConfig.parsed?.tls || '',
		  STORAGE_PROVIDER: storageProvider,
	  MEDIA_BUCKET_NAME: storageBucketName,
	  STATIC_CDN_BUCKET: storageBucketName,
	  STATIC_CDN_URL: storageConfig.staticCdnUrl || '',
	  PUBLIC_STATIC_CDN_URL: storageConfig.staticCdnUrl || '',
	  SECURE_ASSET_PREFIX: storageConfig.secureAssetPrefix || 'assets_v2',
	  S3_ENDPOINT: s3Endpoint,
	  S3_FORCE_PATH_STYLE: s3ForcePathStyle,
	  AWS_ACCESS_KEY_ID: storageAccessKeyId,
	  AWS_SECRET_ACCESS_KEY: storageSecretAccessKey,
	  AWS_REGION: storageRegion,
	  AWS_CDN_REGION: storageRegion,
	  AWS_S3_REGION: storageRegion,
	  AWS_S3_ENDPOINT: s3Endpoint,
	  AWS_S3_FORCE_PATH_STYLE: s3ForcePathStyle,
	  CLOUDFRONT_KEY_PAIR_ID: cloudFrontConfig.keyPairId || '',
	  CLOUDFRONT_PRIVATE_KEY: cloudFrontConfig.privateKey || '',
	  CLOUDFRONT_PRIVATE_KEY_BASE64: cloudFrontConfig.privateKeyBase64 || '',
	  CLOUDFRONT_SIGNED_URL_TTL_SECONDS: cloudFrontConfig.signedUrlTtlSeconds || '',
	  SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED: String(externalMediaPublishEnabled),
	  MEDIA_DELIVERY_MODE: mediaDeliveryMode,
	  SAMSAR_MEDIA_DELIVERY_MODE: mediaDeliveryMode,
	  SAMSAR_EXTERNAL_MEDIA_BUCKET: storageBucketName,
	  SAMSAR_EXTERNAL_MEDIA_REGION: storageRegion,
	  SAMSAR_EXTERNAL_MEDIA_S3_ENDPOINT: s3Endpoint,
	  SAMSAR_EXTERNAL_MEDIA_S3_FORCE_PATH_STYLE: s3ForcePathStyle,
	  SAMSAR_EXTERNAL_MEDIA_ACCESS_KEY_ID: storageAccessKeyId,
	  SAMSAR_EXTERNAL_MEDIA_SECRET_ACCESS_KEY: storageSecretAccessKey,
	  SAMSAR_PUBLIC_MEDIA_BASE_URL: externalMediaPublicBaseUrl,
	  SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL: externalMediaPublicBaseUrl,
	  SAMSAR_EXTERNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: cloudFrontConfig.keyPairId || '',
	  SAMSAR_EXTERNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY: cloudFrontConfig.privateKey || '',
	  SAMSAR_EXTERNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64: cloudFrontConfig.privateKeyBase64 || '',
	  SAMSAR_EXTERNAL_MEDIA_CLOUDFRONT_SIGNED_URL_TTL_SECONDS: cloudFrontConfig.signedUrlTtlSeconds || '',
	  CLIENT_APP: config.publicUrls?.clientApp || 'http://localhost:3000',
  PROCESSOR_API: config.publicUrls?.processorApi || 'http://localhost:3002',
  PROCESSOR_URL: config.publicUrls?.processorApi || 'http://localhost:3002',
  SAMSAR_JS_API_URL: config.publicUrls?.samsarApi || 'https://api.samsar.one/v1',
  LOGGER_HEALTH_REQUIRED: String(loggerEnabled),
  LOKI_HEALTH_URL: isDockerRuntime ? 'http://loki:3100/ready' : 'http://127.0.0.1:4100/ready',
  GRAFANA_HEALTH_URL: isDockerRuntime ? 'http://grafana:3000/api/health' : 'http://127.0.0.1:4000/api/health',
	  MEDIA_PUBLIC_URL: mediaPublicUrl,
  SAMSAR_ASSETS_ROOT: '/assets',
  SAMSAR_ASSETS_V2_ROOT: '/assets_v2',
  SAMSAR_AVAILABLE_MODELS_PATH: '/persistent/config/available-models.json',
  SAMSAR_API_KEY: config.providers?.samsar?.apiKey || '',
	  OPENAI_API_KEY: config.providers?.openai?.apiKey || '',
	  FAL_API_KEY: config.providers?.fal?.apiKey || '',
	  ELEVENLABS_API_TOKEN: config.providers?.elevenlabs?.apiKey || '',
	  ELEVENLABS_API_KEY: config.providers?.elevenlabs?.apiKey || '',
	  RUNWAY_API_KEY: config.providers?.runway?.apiKey || '',
  RUNWAYML_API_KEY: config.providers?.runway?.apiKey || '',
  GOOGLE_CLOUD_PROJECT: config.providers?.googleCloud?.projectId || '',
  GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: config.providers?.googleCloud?.credentialsJsonB64 || '',
  DOCKER_SETUP_SECRET: config.security?.dockerSetupSecret || '',
  SAMSAR_ORGANIZATION_NAME: config.organization?.name || '',
  ...buildMailEnv(),
};

const envContent = Object.entries(env)
  .map(([key, value]) => `${key}=${String(value).replace(/\n/g, '\\n')}`)
  .join('\n') + '\n';

const rootEnvPath = path.join(runtimeSecretsDir, 'root.env');
fs.writeFileSync(rootEnvPath, envContent, { mode: 0o600 });
try {
  fs.chmodSync(rootEnvPath, 0o600);
} catch (_) {
  // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
}

const availableModelsPath = path.join(runtimeConfigDir, 'available-models.json');
fs.writeFileSync(
  availableModelsPath,
  JSON.stringify(buildAvailableModels(config.providers || {}), null, 2) + '\n',
  { mode: 0o600 },
);

console.log(`Rendered ${path.relative(root, rootEnvPath)}`);
console.log(`Rendered ${path.relative(root, availableModelsPath)}`);
