import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const CONTROL_CHARACTER_PATTERN = /[\0\r\n]/;
const LEGACY_INSECURE_SECRETS = new Set([
  'change-me',
  'samsar-local-password',
  'samsar-local-token-secret-change-me',
  'samsar-local-custom-adapter-secret-change-me',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assertSafeScalar(name, value) {
  if (CONTROL_CHARACTER_PATTERN.test(String(value))) {
    throw new Error(`${name} must not contain NUL, carriage-return, or newline characters.`);
  }
}

export function parseEnvironment(content = '') {
  return Object.fromEntries(
    String(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
          throw new Error('Credential environment files must contain KEY=value entries only.');
        }
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      }),
  );
}

export function serializeEnvironment(environment = {}) {
  return `${Object.entries(environment)
    .map(([key, rawValue]) => {
      const value = String(rawValue ?? '');
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable name: ${key}`);
      }
      assertSafeScalar(key, value);
      return `${key}=${value}`;
    })
    .join('\n')}\n`;
}

export function isStrongSecret(value, { minimumLength = 32 } = {}) {
  const normalized = normalizeString(value);
  return Boolean(
    normalized.length >= minimumLength &&
    !CONTROL_CHARACTER_PATTERN.test(normalized) &&
    !LEGACY_INSECURE_SECRETS.has(normalized),
  );
}

export function generateSecureSecret(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url');
}

function generateDistinctSecret(generateSecret, disallowed = new Set()) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateSecret();
    if (isStrongSecret(candidate) && !disallowed.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('Unable to generate a distinct high-entropy credential.');
}

export function readCredentialEnvironment(filePath, requiredKeys) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) {
    return null;
  }
  const environment = parseEnvironment(content);
  const missingKeys = requiredKeys.filter((key) => !normalizeString(environment[key]));
  if (missingKeys.length) {
    throw new Error(
      `${path.basename(filePath)} is incomplete; missing ${missingKeys.join(', ')}. ` +
      'Restore the complete credential file instead of silently rotating persistent-service credentials.',
    );
  }
  return environment;
}

export function writeCredentialEnvironment(filePath, environment) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch (_) {
    // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
  }

  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, serializeEnvironment(environment), {
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch (_) {
      // Best effort; Docker Desktop bind mounts may ignore chmod on some hosts.
    }
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch (_) {
      // The atomic rename normally removes the temporary path.
    }
  }
}

export function resolveApplicationCredentials({
  configuredSecurity = {},
  existingCredentials = {},
  existingRootEnvironment = {},
  generateSecret = generateSecureSecret,
} = {}) {
  const configuredTokenSecret = normalizeString(configuredSecurity.tokenSecret);
  const configuredAdapterSecret = normalizeString(configuredSecurity.customAdapterSecret);
  const existingTokenSecret = normalizeString(
    existingCredentials.TOKEN_SECRET || existingRootEnvironment.TOKEN_SECRET,
  );
  const existingAdapterSecret = normalizeString(
    existingCredentials.CUSTOM_ADAPTER_SECRET_KEY ||
    existingRootEnvironment.CUSTOM_ADAPTER_SECRET_KEY ||
    // Before CUSTOM_ADAPTER_SECRET_KEY existed, custom-adapter records were
    // encrypted with TOKEN_SECRET. Materialize that legacy key explicitly so
    // an upgrade does not silently make persisted credentials undecryptable.
    existingRootEnvironment.TOKEN_SECRET,
  );
  const existingInternalSecret = normalizeString(
    existingCredentials.INTERNAL_SECRET || existingRootEnvironment.INTERNAL_SECRET,
  );

  const tokenSecret = isStrongSecret(configuredTokenSecret)
    ? configuredTokenSecret
    : isStrongSecret(existingTokenSecret)
      ? existingTokenSecret
      : generateDistinctSecret(generateSecret);
  const customAdapterSecret = isStrongSecret(configuredAdapterSecret) && configuredAdapterSecret !== tokenSecret
    ? configuredAdapterSecret
    : isStrongSecret(existingAdapterSecret)
      ? existingAdapterSecret
      : generateDistinctSecret(generateSecret, new Set([tokenSecret]));
  const internalSecret = isStrongSecret(existingInternalSecret) &&
    existingInternalSecret !== tokenSecret &&
    existingInternalSecret !== customAdapterSecret
    ? existingInternalSecret
    : generateDistinctSecret(generateSecret, new Set([tokenSecret, customAdapterSecret]));

  return {
    TOKEN_SECRET: tokenSecret,
    CUSTOM_ADAPTER_SECRET_KEY: customAdapterSecret,
    INTERNAL_SECRET: internalSecret,
  };
}

export function resolveMongoCredentials({
  existingCredentials = {},
  generateSecret = generateSecureSecret,
} = {}) {
  const rootUsername = normalizeString(existingCredentials.MONGO_ROOT_USERNAME) || 'samsar_admin';
  const appUsername = normalizeString(existingCredentials.MONGO_APP_USERNAME) || 'samsar_app';
  const database = normalizeString(existingCredentials.MONGO_APP_DATABASE) || 'SamsarOne';
  [rootUsername, appUsername, database].forEach((value) => assertSafeScalar('MongoDB credential', value));

  const rootPassword = isStrongSecret(existingCredentials.MONGO_ROOT_PASSWORD)
    ? existingCredentials.MONGO_ROOT_PASSWORD
    : generateDistinctSecret(generateSecret);
  const appPassword = isStrongSecret(existingCredentials.MONGO_APP_PASSWORD) &&
    existingCredentials.MONGO_APP_PASSWORD !== rootPassword
    ? existingCredentials.MONGO_APP_PASSWORD
    : generateDistinctSecret(generateSecret, new Set([rootPassword]));

  return {
    MONGO_ROOT_USERNAME: rootUsername,
    MONGO_ROOT_PASSWORD: rootPassword,
    MONGO_APP_USERNAME: appUsername,
    MONGO_APP_PASSWORD: appPassword,
    MONGO_APP_DATABASE: database,
  };
}

export function buildAuthenticatedMongoUrl({
  username,
  password,
  database = 'SamsarOne',
  host = 'mongo',
  port = 27017,
  authSource = 'admin',
} = {}) {
  const values = { username, password, database, host, authSource };
  for (const [name, value] of Object.entries(values)) {
    if (!normalizeString(value)) {
      throw new Error(`MongoDB ${name} is required.`);
    }
    assertSafeScalar(`MongoDB ${name}`, value);
  }
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('MongoDB port must be between 1 and 65535.');
  }

  return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}` +
    `@${host}:${Number(port)}/${encodeURIComponent(database)}` +
    `?authSource=${encodeURIComponent(authSource)}`;
}

export function resolveMinioCredentials({
  configuredStorage = {},
  existingCredentials = {},
  existingRootEnvironment = {},
  generateSecret = generateSecureSecret,
} = {}) {
  const configuredAccessKey = normalizeString(
    configuredStorage.accessKeyId || configuredStorage.awsAccessKeyId,
  );
  const configuredSecretKey = normalizeString(
    configuredStorage.secretAccessKey || configuredStorage.awsSecretAccessKey,
  );
  const existingAccessKey = normalizeString(
    existingCredentials.MINIO_ROOT_USER || existingRootEnvironment.AWS_ACCESS_KEY_ID,
  );
  const existingSecretKey = normalizeString(
    existingCredentials.MINIO_ROOT_PASSWORD || existingRootEnvironment.AWS_SECRET_ACCESS_KEY,
  );
  const accessKey = configuredAccessKey && configuredAccessKey !== 'samsar'
    ? configuredAccessKey
    : existingAccessKey && existingAccessKey !== 'samsar'
      ? existingAccessKey
      : `samsar_${randomBytes(9).toString('hex')}`;
  const secretKey = isStrongSecret(configuredSecretKey)
    ? configuredSecretKey
    : isStrongSecret(existingSecretKey)
      ? existingSecretKey
      : generateDistinctSecret(generateSecret);
  assertSafeScalar('MinIO access key', accessKey);

  return {
    MINIO_ROOT_USER: accessKey,
    MINIO_ROOT_PASSWORD: secretKey,
  };
}

export function resolveGrafanaCredentials({
  existingCredentials = {},
  generateSecret = generateSecureSecret,
} = {}) {
  // Grafana persists the first administrator as `admin` in existing volumes and
  // its reset-password CLI does not rename that account. Keep the generated
  // credential file aligned with both legacy and fresh volumes.
  const username = normalizeString(existingCredentials.GF_SECURITY_ADMIN_USER) || 'admin';
  const password = isStrongSecret(existingCredentials.GF_SECURITY_ADMIN_PASSWORD)
    ? existingCredentials.GF_SECURITY_ADMIN_PASSWORD
    : generateDistinctSecret(generateSecret);
  assertSafeScalar('Grafana admin username', username);
  return {
    GF_SECURITY_ADMIN_USER: username,
    GF_SECURITY_ADMIN_PASSWORD: password,
  };
}
