import { GoogleAuth } from 'google-auth-library';

const DEFAULT_GOOGLE_CLOUD_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/cloud-platform',
]);

const PROJECT_ENV_KEYS = Object.freeze([
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PROJECT_ID',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'PROJECT_ID',
]);

const authCache = new Map();

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseCredentialsJSON(rawValue, sourceName) {
  try {
    return JSON.parse(rawValue);
  } catch {
    throw new Error(`${sourceName} must contain valid Google credentials JSON.`);
  }
}

function getConfiguredCredentials() {
  const rawCredentialsJSON = normalizeString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  if (rawCredentialsJSON) {
    return parseCredentialsJSON(rawCredentialsJSON, 'GOOGLE_APPLICATION_CREDENTIALS_JSON');
  }

  const rawCredentialsBase64 = normalizeString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64);
  if (rawCredentialsBase64) {
    const decodedCredentials = Buffer.from(rawCredentialsBase64, 'base64').toString('utf8');
    return parseCredentialsJSON(decodedCredentials, 'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64');
  }

  return null;
}

function normalizeScopes(scopes) {
  if (Array.isArray(scopes)) {
    return scopes.map(normalizeString).filter(Boolean);
  }

  const rawScopes = normalizeString(scopes);
  if (!rawScopes) {
    return [...DEFAULT_GOOGLE_CLOUD_SCOPES];
  }

  const parsedScopes = rawScopes
    .split(/[,\s]+/)
    .map(normalizeString)
    .filter(Boolean);

  return parsedScopes.length ? parsedScopes : [...DEFAULT_GOOGLE_CLOUD_SCOPES];
}

function getConfiguredProjectId() {
  for (const envKey of PROJECT_ENV_KEYS) {
    const projectId = normalizeString(process.env[envKey]);
    if (projectId) {
      return projectId;
    }
  }
  return null;
}

function getAuthOptions(options = {}) {
  const credentials = options.credentials || getConfiguredCredentials();
  const projectId =
    normalizeString(options.projectId) ||
    getConfiguredProjectId() ||
    normalizeString(credentials?.project_id);
  const scopes = normalizeScopes(
    options.scopes ||
    process.env.GOOGLE_CLOUD_SCOPES ||
    process.env.GOOGLE_ADC_SCOPES
  );

  return {
    ...(projectId ? { projectId } : {}),
    ...(credentials ? { credentials } : {}),
    scopes,
  };
}

function getAuthCacheKey(options) {
  const projectId = options.projectId || '';
  const scopes = Array.isArray(options.scopes) ? options.scopes.join(',') : '';
  const credentialId =
    options.credentials?.client_email ||
    options.credentials?.client_id ||
    options.credentials?.private_key_id ||
    '';
  return JSON.stringify({ projectId, scopes, credentialId });
}

function getAccessTokenValue(tokenResponse) {
  if (typeof tokenResponse === 'string') {
    return tokenResponse;
  }
  return normalizeString(tokenResponse?.token);
}

export function getGoogleCloudConfig(options = {}) {
  const credentials = options.credentials || getConfiguredCredentials();
  return {
    projectId:
      normalizeString(options.projectId) ||
      getConfiguredProjectId() ||
      normalizeString(credentials?.project_id),
    scopes: normalizeScopes(
      options.scopes ||
      process.env.GOOGLE_CLOUD_SCOPES ||
      process.env.GOOGLE_ADC_SCOPES
    ),
  };
}

export function getGoogleAuth(options = {}) {
  const authOptions = getAuthOptions(options);
  const cacheKey = getAuthCacheKey(authOptions);

  if (!authCache.has(cacheKey)) {
    authCache.set(cacheKey, new GoogleAuth(authOptions));
  }

  return authCache.get(cacheKey);
}

export async function getGoogleAuthClient(options = {}) {
  return getGoogleAuth(options).getClient();
}

export async function getGoogleAccessToken(options = {}) {
  const client = await getGoogleAuthClient(options);
  const token = getAccessTokenValue(await client.getAccessToken());

  if (!token) {
    throw new Error('Google ADC did not return an access token');
  }

  return token;
}
