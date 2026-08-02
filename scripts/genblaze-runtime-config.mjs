import { buildGmiCloudCredentialFingerprint } from '../apps/setup-wizard/gmiCloudValidation.mjs';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isGmiCloudCredentialValidationCurrent({
  apiKey = '',
  credentialFingerprint = '',
} = {}) {
  const normalizedApiKey = normalizeString(apiKey);
  const normalizedFingerprint = normalizeString(credentialFingerprint).toLowerCase();
  return Boolean(
    normalizedApiKey &&
    /^[a-f0-9]{64}$/.test(normalizedFingerprint) &&
    buildGmiCloudCredentialFingerprint(normalizedApiKey) === normalizedFingerprint
  );
}

export function applyEffectiveGmiCloudProviderConfig(providers = {}, secrets = {}) {
  const provider = providers.gmicloud || {};
  const apiKey = normalizeString(secrets.apiKey || provider.apiKey);
  const enabled = provider.enabled === true && Boolean(apiKey);

  return {
    apiKey,
    enabled,
    providers: {
      ...providers,
      gmicloud: {
        ...provider,
        enabled,
        apiKey: undefined,
      },
    },
  };
}

export function buildGenBlazeServiceEnvironment({
  apiKey = '',
  chatBaseUrl = '',
  mediaBaseUrl = '',
  jobTokenSecret = '',
} = {}) {
  return {
    GMI_API_KEY: normalizeString(apiKey),
    GMI_CHAT_BASE_URL: normalizeString(chatBaseUrl),
    GMI_BASE_URL: normalizeString(mediaBaseUrl),
    GENBLAZE_JOB_TOKEN_SECRET: normalizeString(jobTokenSecret),
  };
}

export function readEnvironmentValue(content = '', key = '') {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) return '';
  const line = String(content)
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${normalizedKey}=`));
  return line ? line.slice(normalizedKey.length + 1).trim() : '';
}

export function serializeEnvironment(environment = {}) {
  return `${Object.entries(environment)
    .map(([key, value]) => `${key}=${String(value ?? '').replace(/\n/g, '\\n')}`)
    .join('\n')}\n`;
}
