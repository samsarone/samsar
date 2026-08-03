import {
  isValidEnvironmentVariableName,
  parseEnvironmentVariableReference,
} from './providerEnvironment.js';

export const DEFAULT_CONFIGURATION_ENVIRONMENT_VARIABLE_BY_FIELD = Object.freeze({
  mongoConnectionString: 'MONGO_URL',
  smtpPassword: 'SMTP_PASSWORD',
  sesAccessKeyId: 'AWS_SES_ACCESS_KEY_ID',
  sesSecretAccessKey: 'AWS_SES_SECRET_ACCESS_KEY',
  sesSessionToken: 'AWS_SES_SESSION_TOKEN',
  s3AccessKeyId: 'AWS_ACCESS_KEY_ID',
  s3SecretAccessKey: 'AWS_SECRET_ACCESS_KEY',
  s3Endpoint: 'S3_ENDPOINT',
  b2KeyId: 'B2_KEY_ID',
  b2ApplicationKey: 'B2_APPLICATION_KEY',
  b2Host: 'B2_HOST',
  cloudFrontPrivateKey: 'CLOUDFRONT_PRIVATE_KEY',
  cloudFrontPrivateKeyBase64: 'CLOUDFRONT_PRIVATE_KEY_BASE64',
});

export const CONFIGURATION_ENVIRONMENT_VARIABLE_NAMES = Object.freeze([
  ...new Set(Object.values(DEFAULT_CONFIGURATION_ENVIRONMENT_VARIABLE_BY_FIELD)),
]);

export const CONFIGURATION_SECRET_FIELDS = Object.freeze(
  Object.keys(DEFAULT_CONFIGURATION_ENVIRONMENT_VARIABLE_BY_FIELD),
);

export function getConfigurationEnvironmentReferencePlaceholder(field) {
  const variableName = DEFAULT_CONFIGURATION_ENVIRONMENT_VARIABLE_BY_FIELD[field];
  return variableName ? `$${variableName}` : '$VARIABLE_NAME';
}

export function pickConfigurationEnvironmentReferences(value = {}) {
  return Object.fromEntries(
    CONFIGURATION_SECRET_FIELDS.map((field) => [
      field,
      typeof value?.[field] === 'string' ? value[field].trim() : '',
    ]),
  );
}

export function pickApplicableConfigurationEnvironmentReferences(payload = {}, references = {}) {
  const picked = pickConfigurationEnvironmentReferences(references);
  const applicable = pickConfigurationEnvironmentReferences();
  const infrastructure = payload.deployment?.infrastructure || {};
  const database = infrastructure.database || {};
  const storage = infrastructure.storage || {};
  const mailProvider = String(payload.mail?.provider || '').trim().toLowerCase();

  if (database.provider === 'remote-mongo' || database.mode === 'remote') {
    applicable.mongoConnectionString = picked.mongoConnectionString;
  }
  if (mailProvider === 'smtp') {
    applicable.smtpPassword = picked.smtpPassword;
  } else if (mailProvider === 'ses' || mailProvider === 'ses-api') {
    applicable.sesAccessKeyId = picked.sesAccessKeyId;
    applicable.sesSecretAccessKey = picked.sesSecretAccessKey;
    applicable.sesSessionToken = picked.sesSessionToken;
  }
  if (storage.mode === 'external-s3') {
    applicable.s3AccessKeyId = picked.s3AccessKeyId;
    applicable.s3SecretAccessKey = picked.s3SecretAccessKey;
    applicable.s3Endpoint = picked.s3Endpoint;
  } else if (storage.mode === 'backblaze-b2') {
    applicable.b2KeyId = picked.b2KeyId;
    applicable.b2ApplicationKey = picked.b2ApplicationKey;
    applicable.b2Host = picked.b2Host;
  }
  if (storage.mode === 'external-s3') {
    applicable.cloudFrontPrivateKey = picked.cloudFrontPrivateKey;
    applicable.cloudFrontPrivateKeyBase64 = picked.cloudFrontPrivateKeyBase64;
  }

  return applicable;
}

export function applyConfigurationEnvironmentValuesToMail(mail = {}, values = {}) {
  return {
    ...mail,
    smtpPassword: values.smtpPassword || '',
    sesAccessKeyId: values.sesAccessKeyId || '',
    sesSecretAccessKey: values.sesSecretAccessKey || '',
    sesSessionToken: values.sesSessionToken || '',
  };
}

export function applyConfigurationEnvironmentValuesToInfrastructure(infrastructure = {}, values = {}) {
  const database = infrastructure.database || {};
  const storage = infrastructure.storage || {};
  const cloudFront = storage.cloudFront || {};
  const isBackblaze = storage.mode === 'backblaze-b2';
  return {
    ...infrastructure,
    database: {
      ...database,
      mongoUrl: values.mongoConnectionString || '',
    },
    storage: {
      ...storage,
      accessKeyId: (isBackblaze ? values.b2KeyId : values.s3AccessKeyId) || '',
      secretAccessKey: (isBackblaze ? values.b2ApplicationKey : values.s3SecretAccessKey) || '',
      s3Endpoint: (isBackblaze ? values.b2Host : values.s3Endpoint) || '',
      cloudFront: {
        ...cloudFront,
        privateKey: values.cloudFrontPrivateKey || '',
        privateKeyBase64: values.cloudFrontPrivateKeyBase64 || '',
      },
    },
  };
}

export function resolveConfigurationEnvironmentReferences(
  references = {},
  environment = {},
  { allowedVariableNames = CONFIGURATION_ENVIRONMENT_VARIABLE_NAMES } = {},
) {
  const allowedNames = new Set(
    [...allowedVariableNames]
      .map((value) => String(value || '').trim())
      .filter(isValidEnvironmentVariableName),
  );
  const values = {};
  const variableNames = {};

  for (const field of CONFIGURATION_SECRET_FIELDS) {
    const reference = typeof references?.[field] === 'string' ? references[field].trim() : '';
    if (!reference) {
      values[field] = '';
      continue;
    }

    const variableName = parseEnvironmentVariableReference(reference);
    if (!variableName) {
      throw new Error(`Use a Bash variable reference such as ${getConfigurationEnvironmentReferencePlaceholder(field)} instead of entering a secret value.`);
    }
    if (!allowedNames.has(variableName)) {
      throw new Error(`$${variableName} was not forwarded to the setup wizard. Add ${variableName} to SAMSAR_SETUP_PROVIDER_ENV_NAMES and rerun ./setup.sh.`);
    }

    const resolvedValue = typeof environment?.[variableName] === 'string' ? environment[variableName] : '';
    if (!resolvedValue.trim()) {
      throw new Error(`$${variableName} is not set or is empty. Export it in Bash and rerun ./setup.sh.`);
    }

    values[field] = resolvedValue;
    variableNames[field] = variableName;
  }

  return { values, variableNames };
}
