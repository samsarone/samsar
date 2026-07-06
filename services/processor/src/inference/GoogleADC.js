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
    return scopes
      .map(normalizeString)
      .filter(Boolean);
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

function getConfiguredLocation() {
  return (
    normalizeString(process.env.GOOGLE_CLOUD_LOCATION) ||
    normalizeString(process.env.GCP_LOCATION) ||
    normalizeString(process.env.GOOGLE_CLOUD_REGION) ||
    'us-central1'
  );
}

function getConfiguredScopes() {
  return normalizeScopes(
    process.env.GOOGLE_CLOUD_SCOPES ||
    process.env.GOOGLE_ADC_SCOPES
  );
}

function getAuthOptions(options = {}) {
  const credentials = options.credentials || getConfiguredCredentials();
  const projectId =
    normalizeString(options.projectId) ||
    getConfiguredProjectId() ||
    normalizeString(credentials?.project_id);
  const scopes = normalizeScopes(options.scopes || getConfiguredScopes());

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

function getAuthSource() {
  if (normalizeString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64)) {
    return 'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64';
  }

  if (normalizeString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)) {
    return 'GOOGLE_APPLICATION_CREDENTIALS_JSON';
  }

  if (normalizeString(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return 'GOOGLE_APPLICATION_CREDENTIALS';
  }

  if (
    normalizeString(process.env.K_SERVICE) ||
    normalizeString(process.env.GAE_SERVICE) ||
    normalizeString(process.env.FUNCTION_TARGET) ||
    normalizeString(process.env.GCE_METADATA_HOST)
  ) {
    return 'attached_service_account';
  }

  return 'application_default_credentials';
}

function getAccessTokenValue(tokenResponse) {
  if (typeof tokenResponse === 'string') {
    return tokenResponse;
  }
  return normalizeString(tokenResponse?.token);
}

function sanitizeAuthError(error) {
  return {
    name: error?.name || 'GoogleAuthError',
    code: error?.code || null,
    message: error?.message || 'Google ADC authentication failed',
  };
}

function buildFailedStatus(config, error) {
  return {
    ok: false,
    credentialsAvailable: false,
    projectConfigured: Boolean(config.projectId),
    projectId: config.projectId || null,
    location: config.location,
    scopes: config.scopes,
    authSource: getAuthSource(),
    credentialType: null,
    error: sanitizeAuthError(error),
  };
}

export function getGoogleCloudConfig(options = {}) {
  const credentials = options.credentials || getConfiguredCredentials();
  return {
    projectId:
      normalizeString(options.projectId) ||
      getConfiguredProjectId() ||
      normalizeString(credentials?.project_id),
    location: normalizeString(options.location) || getConfiguredLocation(),
    scopes: normalizeScopes(options.scopes || getConfiguredScopes()),
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

export async function getGoogleADCStatus(options = {}) {
  const config = getGoogleCloudConfig(options);
  const status = {
    ok: false,
    credentialsAvailable: false,
    projectConfigured: Boolean(config.projectId),
    projectId: config.projectId || null,
    location: config.location,
    scopes: config.scopes,
    authSource: getAuthSource(),
    credentialType: null,
  };

  try {
    const auth = getGoogleAuth(config);
    const client = await auth.getClient();
    const token = getAccessTokenValue(await client.getAccessToken());

    let resolvedProjectId = config.projectId;
    try {
      resolvedProjectId = normalizeString(await auth.getProjectId()) || resolvedProjectId;
    } catch {
      // A missing project ID is reported below without exposing auth internals.
    }

    status.credentialsAvailable = Boolean(token);
    status.projectConfigured = Boolean(resolvedProjectId);
    status.projectId = resolvedProjectId || null;
    status.credentialType = client?.constructor?.name || null;
    status.ok = status.credentialsAvailable && status.projectConfigured;

    if (!status.projectConfigured) {
      status.error = {
        name: 'GoogleProjectIdMissing',
        code: null,
        message: 'Set GOOGLE_CLOUD_PROJECT or configure a default project for ADC.',
      };
    }

    return status;
  } catch (error) {
    return buildFailedStatus(config, error);
  }
}

export async function getGoogleADCStatusWithTimeout(options = {}) {
  const timeoutMs = Number(options.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return getGoogleADCStatus(options);
  }

  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      getGoogleADCStatus(options),
      timeoutPromise,
    ]);
  } catch (error) {
    return buildFailedStatus(getGoogleCloudConfig(options), error);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
