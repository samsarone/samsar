import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildDockerAvailableModelsFromEnabledProviders } from '../apps/setup-wizard/src/constants/dockerModelAvailability.js';
import {
  buildGmiCloudRuntimeCatalog,
  normalizeGmiCloudModelMappings,
} from '../apps/setup-wizard/gmiCloudValidation.mjs';
import { buildDockerAudioAvailability } from './docker-audio-provider-config.mjs';
import { applyEffectiveOpenRouterProviderConfig } from './openrouter-runtime-config.mjs';
import {
  isExternalStorageConfig,
  parseBackblazeS3Endpoint,
  resolveRuntimeMediaBucketName,
  validateExternalStorageConfig,
} from '../apps/setup-wizard/storageConfig.mjs';
import {
  applyEffectiveGmiCloudProviderConfig,
  buildGenBlazeServiceEnvironment,
  isGmiCloudCredentialValidationCurrent,
  readEnvironmentValue,
  serializeEnvironment,
} from './genblaze-runtime-config.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const runtimeConfigDir = path.join(root, 'runtime', 'config');
const runtimeSecretsDir = path.join(root, 'runtime', 'secrets');
const configPath = path.join(runtimeConfigDir, 'samsar.config.json');
const exampleConfigPath = path.join(root, 'samsar.config.example.json');
const mailSecretsPath = path.join(runtimeSecretsDir, 'mail.credentials.json');
const providerSecretsPath = path.join(runtimeSecretsDir, 'provider.credentials.json');
const genblazeEnvPath = path.join(runtimeSecretsDir, 'genblaze.env');
const genblazeModelCatalogPath = path.join(runtimeConfigDir, 'genblaze-model-catalog.json');
const reverseProxyDir = path.join(root, 'runtime', 'reverse-proxy');
const reverseProxyNginxPath = path.join(reverseProxyDir, 'nginx.conf');
const reverseProxyCertbotWebroot = path.join(reverseProxyDir, 'certbot', 'www');
const reverseProxyCertbotConfig = path.join(reverseProxyDir, 'letsencrypt');
const reverseProxyCertName = 'samsar-reverse-proxy';

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
const providerSecrets = readJsonIfExists(providerSecretsPath) || {};
const storageConfig = config.storage || {};
const isDockerRuntime = config.runtime !== 'local';
const storageBackend = storageConfig.backend || (
  storageConfig.mode === 'backblaze-b2'
    ? 'backblaze-b2'
    : storageConfig.externalMediaPublishEnabled
      ? 'generic-s3'
      : isDockerRuntime ? 'minio' : 'aws-s3'
);
const localMediaTunnelConfig = config.localMediaTunnel || config.mediaTunnel || {};
const databaseConfig = config.database || {};
const cloudFrontConfig = storageConfig.cloudFront || {};
const mailConfig = config.mail || {};
const storageProvider = storageConfig.provider || (isDockerRuntime ? 's3-compatible' : 'aws-s3-cloudfront');
const isS3CompatibleStorage = storageProvider === 's3-compatible';
const defaultLocalS3AccessKey = isDockerRuntime && isS3CompatibleStorage ? 'samsar' : '';
const defaultLocalS3SecretKey = isDockerRuntime && isS3CompatibleStorage ? 'samsar-local-password' : '';
const backblazeEndpoint = storageBackend === 'backblaze-b2'
  ? parseBackblazeS3Endpoint(storageConfig.s3Endpoint)
  : null;
const s3Endpoint = backblazeEndpoint?.endpoint || storageConfig.s3Endpoint || '';
const s3ForcePathStyle = String(Boolean(storageConfig.s3ForcePathStyle));
if (isDockerRuntime && isExternalStorageConfig(storageConfig)) {
  validateExternalStorageConfig({ storage: storageConfig });
}
const storageBucketName = resolveRuntimeMediaBucketName(storageConfig, {
  dockerRuntime: isDockerRuntime,
});
const storageRegion = backblazeEndpoint?.region || storageConfig.region || storageConfig.awsRegion || 'us-east-1';
const storageAccessKeyId = storageConfig.accessKeyId || storageConfig.awsAccessKeyId || defaultLocalS3AccessKey;
const storageSecretAccessKey = storageConfig.secretAccessKey || storageConfig.awsSecretAccessKey || defaultLocalS3SecretKey;
const backblazeCredentialType = storageBackend === 'backblaze-b2'
  ? normalizeString(storageConfig.credentialType)
  : '';
const externalMediaPublishEnabled = Boolean(storageConfig.externalMediaPublishEnabled);
if (isDockerRuntime && externalMediaPublishEnabled) {
  const staticCdnUrl = normalizeString(storageConfig.staticCdnUrl);
  let parsedStaticCdnUrl;
  try {
    parsedStaticCdnUrl = new URL(staticCdnUrl);
  } catch {
    throw new Error('Docker external-S3 media publishing requires storage.staticCdnUrl to be a valid HTTPS URL.');
  }
  if (
    parsedStaticCdnUrl.protocol !== 'https:' ||
    parsedStaticCdnUrl.username ||
    parsedStaticCdnUrl.password ||
    parsedStaticCdnUrl.search ||
    parsedStaticCdnUrl.hash
  ) {
    throw new Error('Docker external-S3 storage.staticCdnUrl must be HTTPS and must not contain credentials, a query, or a fragment.');
  }
}
const secureAssetPrefix = isDockerRuntime ? 'assets_v2' : (storageConfig.secureAssetPrefix || 'assets_v2');
const mediaDeliveryMode = isDockerRuntime && !externalMediaPublishEnabled
  ? 'docker-local'
  : storageBackend === 'backblaze-b2' ? 'external-s3' : 's3-cloudfront';
const loggerEnabled = config.services?.logger !== false;
const reverseProxyConfig = config.reverseProxy || {};
const reverseProxyEnabled = reverseProxyConfig.enabled === true;
const publicClientBaseUrl = config.publicUrls?.clientApp || 'http://localhost:3000';
const publicProcessorBaseUrl = config.publicUrls?.processorApi || 'http://localhost:3002';
const configuredPublicMediaUrl = config.publicUrls?.media || '';
const configuredStableProviderMediaUrl = [
  configuredPublicMediaUrl,
  publicProcessorBaseUrl,
  reverseProxyConfig.publicUrls?.media,
  reverseProxyConfig.publicUrls?.processorApi,
].map(normalizeStablePublicHttpsBaseUrl).find(Boolean) || '';
const configuredTunnelPublicUrl = localMediaTunnelConfig.enabled === false
  ? ''
  : (localMediaTunnelConfig.publicUrl ||
    localMediaTunnelConfig.url ||
    (isTemporaryMediaTunnelUrl(configuredPublicMediaUrl) ? configuredPublicMediaUrl : ''));
const publicAssetBaseUrl = externalMediaPublishEnabled
  ? storageConfig.staticCdnUrl
  : publicProcessorBaseUrl;
const mediaPublicUrl = externalMediaPublishEnabled
  ? storageConfig.staticCdnUrl
  : (configuredStableProviderMediaUrl || configuredTunnelPublicUrl || publicProcessorBaseUrl);
const externalMediaPublicBaseUrl = externalMediaPublishEnabled
  ? storageConfig.staticCdnUrl
  : (configuredStableProviderMediaUrl || configuredTunnelPublicUrl);
const alibabaCloudConfig = config.providers?.alibabaCloud || {};
const alibabaCloudSecrets = providerSecrets.alibabaCloud || {};
const openrouterSecrets = providerSecrets.openrouter || {};
const gmiCloudConfig = config.providers?.gmicloud || {};
const gmiCloudSecrets = providerSecrets.gmicloud || {};
const openRouterProviderConfig = applyEffectiveOpenRouterProviderConfig(
  config.providers || {},
  openrouterSecrets,
);
const effectiveGmiCloudConfig = applyEffectiveGmiCloudProviderConfig(
  openRouterProviderConfig.providers,
  gmiCloudSecrets,
);
const gmiCloudCredentialValidationCurrent = isGmiCloudCredentialValidationCurrent({
  apiKey: effectiveGmiCloudConfig.apiKey,
  credentialFingerprint: gmiCloudConfig.credentialFingerprint,
});
const genblazeRuntimeEnabled = effectiveGmiCloudConfig.enabled &&
  gmiCloudCredentialValidationCurrent &&
  config.services?.genblaze === true;
const gmiCloudModelMappings = genblazeRuntimeEnabled
  ? normalizeGmiCloudModelMappings(gmiCloudConfig.modelMappings)
  : {};
const effectiveProviderConfig = {
  ...openRouterProviderConfig,
  providers: {
    ...effectiveGmiCloudConfig.providers,
    gmicloud: {
      ...effectiveGmiCloudConfig.providers.gmicloud,
      enabled: genblazeRuntimeEnabled,
    },
  },
};
if (gmiCloudConfig.enabled === true && !effectiveGmiCloudConfig.apiKey) {
  throw new Error('GMICloud is enabled but runtime/secrets/provider.credentials.json does not contain its API key. Validate GMICloud again in setup.');
}
if (gmiCloudConfig.enabled === true && effectiveGmiCloudConfig.apiKey && !gmiCloudCredentialValidationCurrent) {
  console.warn('GMICloud was disabled because its API key no longer matches the credential validated by setup. Validate GMICloud again to enable GenBlaze.');
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function classifyAlibabaEndpoint(value) {
  const configured = normalizeString(value);
  if (!configured) return '';
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(configured) ? configured : `https://${configured}`);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.includes('token-plan')) return 'token_plan';
    if (hostname === 'coding.dashscope.aliyuncs.com' ||
      hostname === 'coding-intl.dashscope.aliyuncs.com') return 'coding_plan';
    return 'pay_as_you_go';
  } catch {
    return '';
  }
}

const alibabaApiKey = normalizeString(alibabaCloudSecrets.apiKey || alibabaCloudConfig.apiKey);
const alibabaApiHost = normalizeString(
  alibabaCloudSecrets.apiHost || alibabaCloudConfig.apiHost || alibabaCloudConfig.baseUrl,
);
const alibabaEndpointType = classifyAlibabaEndpoint(alibabaApiHost) ||
  normalizeString(alibabaCloudSecrets.endpointType || alibabaCloudConfig.endpointType) ||
  'pay_as_you_go';
const alibabaKeyType = normalizeString(alibabaCloudSecrets.keyType || alibabaCloudConfig.keyType) ||
  (alibabaEndpointType !== 'pay_as_you_go'
    ? alibabaEndpointType
    : alibabaApiKey.startsWith('sk-sp-') ? 'plan' : 'pay_as_you_go');
const alibabaQwenModel = isDockerRuntime && alibabaApiKey && alibabaEndpointType === 'token_plan'
  ? 'qwen3.8-max'
  : '';

function isTemporaryMediaTunnelUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return false;
  }
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname.endsWith('.trycloudflare.com') ||
      hostname.endsWith('.loca.lt') ||
      hostname.endsWith('.share.zrok.io');
  } catch {
    return false;
  }
}

function isLocalOrPrivateHostname(value) {
  const hostname = normalizeString(value).toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname ||
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'host.docker.internal') {
    return true;
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    const [first, second] = hostname.split('.').map((part) => Number.parseInt(part, 10));
    return first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224;
  }
  if (ipVersion === 6) {
    return hostname === '::' ||
      hostname === '::1' ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      /^fe[89ab]/.test(hostname);
  }
  return !hostname.includes('.');
}

function normalizeStablePublicHttpsBaseUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized || isTemporaryMediaTunnelUrl(normalized)) {
    return '';
  }
  try {
    const parsedUrl = new URL(normalized);
    if (parsedUrl.protocol !== 'https:' ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.search ||
      parsedUrl.hash ||
      isLocalOrPrivateHostname(parsedUrl.hostname)) {
      return '';
    }
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
    return parsedUrl.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeSecretString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTemporaryAwsAccessKeyId(value) {
  return normalizeString(value).toUpperCase().startsWith('ASIA');
}

function normalizeHost(value) {
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

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function reverseProxyCertExists() {
  return fs.existsSync(path.join(reverseProxyCertbotConfig, 'live', reverseProxyCertName, 'fullchain.pem')) &&
    fs.existsSync(path.join(reverseProxyCertbotConfig, 'live', reverseProxyCertName, 'privkey.pem'));
}

const proxyApiPrefixes = [
  '/api/',
  '/v1/',
  '/v2/',
  '/external/',
  '/internal/',
  '/users/',
  '/admin/',
  '/utils/',
  '/interactions/',
  '/video_sessions/',
  '/video_session/',
  '/image_sessions/',
  '/payments/',
  '/webhooks/',
  '/audio/',
  '/assistants/',
  '/quick_session/',
  '/accounts/',
  '/ai_video/',
  '/moviegen/',
  '/content/',
  '/newsletter/',
  '/admaker/',
  '/publication/',
  '/publications/',
  '/videos/',
  '/assets_v2/',
  '/assets/',
  '/generations/',
  '/intermediates/',
  '/vidgenie/create_blank',
];

function buildProxyHeaders() {
  return [
    '    proxy_http_version 1.1;',
    '    proxy_set_header Host $host;',
    '    proxy_set_header X-Real-IP $remote_addr;',
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '    proxy_set_header X-Forwarded-Proto $scheme;',
    '    proxy_set_header Upgrade $http_upgrade;',
    '    proxy_set_header Connection $connection_upgrade;',
    '    proxy_read_timeout 3600;',
    '    proxy_send_timeout 3600;',
  ].join('\n');
}

function buildProxyLocation(prefix, upstream) {
  return [
    `  location ${prefix} {`,
    `    proxy_pass ${upstream};`,
    buildProxyHeaders(),
    '  }',
  ].join('\n');
}

function buildApiPrefixProxyLocations() {
  return [
    '  location = /api {',
    '    return 308 /api/;',
    '  }',
    buildProxyLocation('/api/', 'http://processor:3002/'),
  ];
}

function buildAcmeLocation() {
  return [
    '  location /.well-known/acme-challenge/ {',
    '    root /var/www/certbot;',
    '  }',
  ].join('\n');
}

function buildServerBlock({ serverName, sslActive, locations, defaultUpstream }) {
  const httpProxy = [
    `server {`,
    `  listen 80;`,
    `  server_name ${serverName};`,
    '  client_max_body_size 1024m;',
    buildAcmeLocation(),
    ...(sslActive
      ? [
        '  location / {',
        '    return 301 https://$host$request_uri;',
        '  }',
      ]
      : [
        ...locations,
        buildProxyLocation('/', defaultUpstream),
      ]),
    `}`,
  ].join('\n');

  if (!sslActive) {
    return httpProxy;
  }

  const httpsProxy = [
    `server {`,
    `  listen 443 ssl http2;`,
    `  server_name ${serverName};`,
    '  client_max_body_size 1024m;',
    `  ssl_certificate /etc/letsencrypt/live/${reverseProxyCertName}/fullchain.pem;`,
    `  ssl_certificate_key /etc/letsencrypt/live/${reverseProxyCertName}/privkey.pem;`,
    '  ssl_session_cache shared:SSL:10m;',
    '  ssl_session_timeout 10m;',
    buildAcmeLocation(),
    ...locations,
    buildProxyLocation('/', defaultUpstream),
    `}`,
  ].join('\n');

  return `${httpProxy}\n\n${httpsProxy}`;
}

function buildReverseProxyNginxConfig() {
  const clientHost = normalizeHost(reverseProxyConfig.clientHost);
  const processorHost = normalizeHost(reverseProxyConfig.processorHost);
  const sslActive = reverseProxyEnabled && reverseProxyConfig.ssl?.enabled === true && reverseProxyCertExists();
  const usesIpApiPath = ['publicIp', 'privateIp'].includes(reverseProxyConfig.accessType);
  const connectionMap = [
    'map $http_upgrade $connection_upgrade {',
    '  default upgrade;',
    "  '' close;",
    '}',
  ].join('\n');

  if (!reverseProxyEnabled || !clientHost || !processorHost) {
    return `${connectionMap}\n\nserver {\n  listen 80 default_server;\n  server_name _;\n${buildAcmeLocation()}\n  location / {\n    return 404;\n  }\n}\n`;
  }

  if (clientHost === processorHost) {
    const apiLocations = usesIpApiPath
      ? buildApiPrefixProxyLocations()
      : [
        ...buildApiPrefixProxyLocations(),
        ...proxyApiPrefixes.map((prefix) => buildProxyLocation(prefix, 'http://processor:3002')),
      ];
    return `${connectionMap}\n\n${buildServerBlock({
      serverName: clientHost,
      sslActive,
      locations: apiLocations,
      defaultUpstream: 'http://client:3000',
    })}\n`;
  }

  return `${connectionMap}\n\n${[
    buildServerBlock({
      serverName: clientHost,
      sslActive,
      locations: [],
      defaultUpstream: 'http://client:3000',
    }),
    buildServerBlock({
      serverName: processorHost,
      sslActive,
      locations: [],
      defaultUpstream: 'http://processor:3002',
    }),
  ].join('\n\n')}\n`;
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
  const sesAccessKeyId = normalizeString(ses.accessKeyId);
  const sesSecretAccessKey = normalizeSecretString(ses.secretAccessKey);
  const sesSessionToken = isTemporaryAwsAccessKeyId(sesAccessKeyId)
    ? normalizeSecretString(ses.sessionToken)
    : '';
  if (isTemporaryAwsAccessKeyId(sesAccessKeyId) && !sesSessionToken) {
    throw new Error('AWS_SES_SESSION_TOKEN is required when AWS_SES_ACCESS_KEY_ID uses temporary ASIA credentials.');
  }
  return {
    ...baseEnv,
    SES_REGION: normalizeString(ses.region) || 'us-east-1',
    AWS_SES_REGION: normalizeString(ses.region) || 'us-east-1',
    AWS_SES_ACCESS_KEY_ID: sesAccessKeyId,
    AWS_SES_SECRET_ACCESS_KEY: sesSecretAccessKey,
    AWS_SES_SESSION_TOKEN: sesSessionToken,
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
    ...buildDockerAvailableModelsFromEnabledProviders(providerNames, {
      gmiCloudModelMappings,
    }),
    providerKeyTypes: alibabaApiKey ? { alibabaCloud: alibabaKeyType } : {},
    providerEndpointTypes: alibabaApiKey ? { alibabaCloud: alibabaEndpointType } : {},
    audio: buildDockerAudioAvailability(providers, { gmiCloudModelMappings }),
  };
}

fs.mkdirSync(runtimeConfigDir, { recursive: true });
fs.mkdirSync(runtimeSecretsDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(reverseProxyDir, { recursive: true });
fs.mkdirSync(reverseProxyCertbotWebroot, { recursive: true });
fs.mkdirSync(reverseProxyCertbotConfig, { recursive: true });
try {
  fs.chmodSync(runtimeSecretsDir, 0o700);
} catch (_) {
  // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
}

const env = {
  CURRENT_ENV: 'standalone',
  SAMSAR_DEPLOYMENT_EDITION: 'standalone',
  SAMSAR_RUNTIME: 'docker',
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
	  SAMSAR_STORAGE_BACKEND: storageBackend,
	  SAMSAR_BACKBLAZE_CREDENTIAL_TYPE: backblazeCredentialType,
	  SAMSAR_S3_OBJECT_TAGGING_SUPPORTED: String(storageConfig.objectTaggingSupported !== false),
	  MEDIA_BUCKET_NAME: storageBucketName,
	  STATIC_CDN_BUCKET: storageBucketName,
	  STATIC_CDN_URL: storageConfig.staticCdnUrl || '',
	  PUBLIC_STATIC_CDN_URL: publicAssetBaseUrl,
	  SECURE_ASSET_PREFIX: secureAssetPrefix,
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
	  SAMSAR_MEDIA_TUNNEL_PUBLIC_URL: externalMediaPublishEnabled ? '' : configuredTunnelPublicUrl,
	  SAMSAR_MEDIA_TUNNEL_PROVIDER: localMediaTunnelConfig.provider || 'cloudflared',
	  SAMSAR_MEDIA_TUNNEL_REFRESH_WAIT_MS: localMediaTunnelConfig.refreshWaitMs || 120000,
	  SAMSAR_MEDIA_TUNNEL_REFRESH_POLL_MS: localMediaTunnelConfig.refreshPollMs || 500,
	  SAMSAR_EXTERNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: cloudFrontConfig.keyPairId || '',
	  SAMSAR_EXTERNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY: cloudFrontConfig.privateKey || '',
	  SAMSAR_EXTERNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64: cloudFrontConfig.privateKeyBase64 || '',
	  SAMSAR_EXTERNAL_MEDIA_CLOUDFRONT_SIGNED_URL_TTL_SECONDS: cloudFrontConfig.signedUrlTtlSeconds || '',
	  CLIENT_APP: publicClientBaseUrl,
  PROCESSOR_API: publicProcessorBaseUrl,
  PROCESSOR_URL: publicProcessorBaseUrl,
  SAMSAR_DOCKER_PUBLIC_CLIENT_BASE_URL: publicClientBaseUrl,
  SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL: publicProcessorBaseUrl,
  SAMSAR_DOCKER_PUBLIC_ASSET_BASE_URL: publicAssetBaseUrl,
  SAMSAR_DOCKER_PREVIEW_ASSET_BASE_URL: publicAssetBaseUrl,
  SAMSAR_REVERSE_PROXY_ENABLED: String(reverseProxyEnabled),
  SAMSAR_REVERSE_PROXY_ACCESS_TYPE: reverseProxyConfig.accessType || '',
  SAMSAR_REVERSE_PROXY_SSL_ENABLED: String(reverseProxyConfig.ssl?.enabled === true),
  SAMSAR_JS_API_URL: config.publicUrls?.samsarApi || 'https://api.samsar.one/v1',
  SAMSAR_GENBLAZE_ENABLED: String(genblazeRuntimeEnabled),
  SAMSAR_GENBLAZE_BASE_URL: genblazeRuntimeEnabled ? 'http://genblaze:8080/v1' : '',
  SAMSAR_GENBLAZE_MODEL_CATALOG_PATH: '/persistent/config/genblaze-model-catalog.json',
  LOGGER_HEALTH_REQUIRED: String(loggerEnabled),
  LOKI_HEALTH_URL: isDockerRuntime ? 'http://loki:3100/ready' : 'http://127.0.0.1:4100/ready',
  GRAFANA_HEALTH_URL: isDockerRuntime ? 'http://grafana:3000/api/health' : 'http://127.0.0.1:4000/api/health',
	  MEDIA_PUBLIC_URL: mediaPublicUrl,
  SAMSAR_ASSETS_ROOT: '/assets',
  SAMSAR_ASSETS_V2_ROOT: '/assets_v2',
  SAMSAR_AVAILABLE_MODELS_PATH: '/persistent/config/available-models.json',
  SAMSAR_API_KEY: config.providers?.samsar?.apiKey || '',
	  OPENAI_API_KEY: config.providers?.openai?.apiKey || '',
	  OPENROUTER_API_KEY: effectiveProviderConfig.openrouter.apiKey,
	  OPENROUTER_GEMINI_31_PRO_MODEL: effectiveProviderConfig.openrouter.gemini31ProModel,
	  KIMI_K3_API_KEY: config.providers?.kimi?.apiKey || '',
	  ALIBABA_API_KEY: alibabaApiKey,
	  ALIBABA_API_HOST: alibabaApiHost,
    ALIBABA_API_KEY_TYPE: alibabaKeyType,
    ALIBABA_API_ENDPOINT_TYPE: alibabaEndpointType,
    ALIBABA_QWEN_MODEL: alibabaQwenModel,
    ALIBABA_QWEN_TEXT_MODEL: alibabaQwenModel,
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

const existingGenBlazeEnvironment = fs.existsSync(genblazeEnvPath)
  ? fs.readFileSync(genblazeEnvPath, 'utf8')
  : '';
const genblazeJobTokenSecret =
  readEnvironmentValue(existingGenBlazeEnvironment, 'GENBLAZE_JOB_TOKEN_SECRET') ||
  randomBytes(32).toString('hex');
const genblazeEnvContent = serializeEnvironment(buildGenBlazeServiceEnvironment({
  apiKey: genblazeRuntimeEnabled ? effectiveGmiCloudConfig.apiKey : '',
  chatBaseUrl: gmiCloudConfig.chatBaseUrl,
  mediaBaseUrl: gmiCloudConfig.mediaBaseUrl,
  jobTokenSecret: genblazeJobTokenSecret,
}));
fs.writeFileSync(genblazeEnvPath, genblazeEnvContent, { mode: 0o600 });
try {
  fs.chmodSync(genblazeEnvPath, 0o600);
} catch (_) {
  // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
}

const availableModelsPath = path.join(runtimeConfigDir, 'available-models.json');
fs.writeFileSync(
  availableModelsPath,
  JSON.stringify(buildAvailableModels(effectiveProviderConfig.providers), null, 2) + '\n',
  { mode: 0o600 },
);

fs.writeFileSync(
  genblazeModelCatalogPath,
  JSON.stringify(buildGmiCloudRuntimeCatalog({
    apiKey: effectiveGmiCloudConfig.apiKey,
    enabled: genblazeRuntimeEnabled,
    modelMappings: gmiCloudModelMappings,
  }), null, 2) + '\n',
  { mode: 0o644 },
);

fs.writeFileSync(reverseProxyNginxPath, buildReverseProxyNginxConfig(), { mode: 0o644 });

console.log(`Rendered ${path.relative(root, rootEnvPath)}`);
console.log(`Rendered ${path.relative(root, genblazeEnvPath)}`);
console.log(`Rendered ${path.relative(root, availableModelsPath)}`);
console.log(`Rendered ${path.relative(root, genblazeModelCatalogPath)}`);
console.log(`Rendered ${path.relative(root, reverseProxyNginxPath)}`);
