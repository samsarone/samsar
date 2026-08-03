import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyConfigurationEnvironmentValuesToInfrastructure,
  applyConfigurationEnvironmentValuesToMail,
  getConfigurationEnvironmentReferencePlaceholder,
  pickApplicableConfigurationEnvironmentReferences,
  pickConfigurationEnvironmentReferences,
  resolveConfigurationEnvironmentReferences,
} from './configurationEnvironment.js';

test('selects only secrets applicable to the active mail and data choices', () => {
  const references = pickApplicableConfigurationEnvironmentReferences({
    deployment: {
      infrastructure: {
        database: { mode: 'remote' },
        storage: { mode: 'backblaze-b2' },
      },
    },
    mail: { provider: 'smtp' },
  }, {
    mongoConnectionString: '$MONGO_URL',
    smtpPassword: '$SMTP_PASSWORD',
    sesSecretAccessKey: '$STALE_SES_SECRET',
    b2KeyId: '$B2_KEY_ID',
    b2ApplicationKey: '$B2_APPLICATION_KEY',
    b2Host: '$B2_HOST',
    cloudFrontPrivateKey: '$STALE_CLOUDFRONT_KEY',
  });

  assert.equal(references.mongoConnectionString, '$MONGO_URL');
  assert.equal(references.smtpPassword, '$SMTP_PASSWORD');
  assert.equal(references.b2KeyId, '$B2_KEY_ID');
  assert.equal(references.b2ApplicationKey, '$B2_APPLICATION_KEY');
  assert.equal(references.b2Host, '$B2_HOST');
  assert.equal(references.s3AccessKeyId, '');
  assert.equal(references.s3SecretAccessKey, '');
  assert.equal(references.s3Endpoint, '');
  assert.equal(references.sesSecretAccessKey, '');
  assert.equal(references.cloudFrontPrivateKey, '');
});

test('applies resolved values to the runtime payload shapes', () => {
  const values = {
    mongoConnectionString: 'mongodb://demo:secret@example.test/SamsarOne',
    smtpPassword: 'smtp-secret',
    s3AccessKeyId: 'storage-key-id',
    s3SecretAccessKey: 'storage-secret',
    s3Endpoint: 'https://s3.us-east-005.backblazeb2.com',
    cloudFrontPrivateKeyBase64: 'base64-private-key',
  };
  const mail = applyConfigurationEnvironmentValuesToMail({ provider: 'smtp' }, values);
  const infrastructure = applyConfigurationEnvironmentValuesToInfrastructure({
    database: { mode: 'remote' },
    storage: { mode: 'external-s3', cloudFront: { keyPairId: 'K123' } },
  }, values);

  assert.equal(mail.smtpPassword, 'smtp-secret');
  assert.equal(infrastructure.database.mongoUrl, values.mongoConnectionString);
  assert.equal(infrastructure.storage.accessKeyId, 'storage-key-id');
  assert.equal(infrastructure.storage.secretAccessKey, 'storage-secret');
  assert.equal(infrastructure.storage.s3Endpoint, values.s3Endpoint);
  assert.equal(infrastructure.storage.cloudFront.keyPairId, 'K123');
  assert.equal(infrastructure.storage.cloudFront.privateKeyBase64, 'base64-private-key');
});

test('maps Backblaze-specific environment values into the storage payload', () => {
  const values = {
    b2KeyId: 'b2-key-id',
    b2ApplicationKey: 'b2-application-key',
    b2Host: 'https://s3.us-east-005.backblazeb2.com',
  };
  const infrastructure = applyConfigurationEnvironmentValuesToInfrastructure({
    storage: { mode: 'backblaze-b2' },
  }, values);

  assert.equal(infrastructure.storage.accessKeyId, values.b2KeyId);
  assert.equal(infrastructure.storage.secretAccessKey, values.b2ApplicationKey);
  assert.equal(infrastructure.storage.s3Endpoint, values.b2Host);
});

test('resolves setup configuration secrets without returning unrelated environment values', () => {
  const result = resolveConfigurationEnvironmentReferences({
    mongoConnectionString: '$MONGO_URL',
    smtpPassword: '${SMTP_PASSWORD}',
    s3SecretAccessKey: '$AWS_SECRET_ACCESS_KEY',
  }, {
    MONGO_URL: 'mongodb://demo:secret@example.test/SamsarOne',
    SMTP_PASSWORD: 'smtp-secret',
    AWS_SECRET_ACCESS_KEY: 'storage-secret',
    UNRELATED_SECRET: 'must-not-be-returned',
  });

  assert.deepEqual(result.variableNames, {
    mongoConnectionString: 'MONGO_URL',
    smtpPassword: 'SMTP_PASSWORD',
    s3SecretAccessKey: 'AWS_SECRET_ACCESS_KEY',
  });
  assert.equal(result.values.mongoConnectionString, 'mongodb://demo:secret@example.test/SamsarOne');
  assert.equal(result.values.smtpPassword, 'smtp-secret');
  assert.equal(result.values.s3SecretAccessKey, 'storage-secret');
  assert.equal(result.values.sesSecretAccessKey, '');
  assert.equal(result.values.UNRELATED_SECRET, undefined);
});

test('supports explicitly forwarded custom secret variables', () => {
  assert.throws(
    () => resolveConfigurationEnvironmentReferences(
      { smtpPassword: '$LIVE_DEMO_SMTP_PASSWORD' },
      { LIVE_DEMO_SMTP_PASSWORD: 'secret' },
    ),
    /SAMSAR_SETUP_PROVIDER_ENV_NAMES/,
  );

  const result = resolveConfigurationEnvironmentReferences(
    { smtpPassword: '$LIVE_DEMO_SMTP_PASSWORD' },
    { LIVE_DEMO_SMTP_PASSWORD: 'secret' },
    { allowedVariableNames: ['LIVE_DEMO_SMTP_PASSWORD'] },
  );
  assert.equal(result.values.smtpPassword, 'secret');
});

test('normalizes references and reports missing values without exposing secrets', () => {
  const references = pickConfigurationEnvironmentReferences({
    mongoConnectionString: '  $MONGO_URL  ',
    smtpPassword: 42,
    unknown: '$UNKNOWN',
  });
  assert.equal(references.mongoConnectionString, '$MONGO_URL');
  assert.equal(references.smtpPassword, '');
  assert.equal(references.unknown, undefined);
  assert.equal(getConfigurationEnvironmentReferencePlaceholder('sesSecretAccessKey'), '$AWS_SES_SECRET_ACCESS_KEY');
  assert.equal(getConfigurationEnvironmentReferencePlaceholder('b2KeyId'), '$B2_KEY_ID');
  assert.equal(getConfigurationEnvironmentReferencePlaceholder('b2ApplicationKey'), '$B2_APPLICATION_KEY');
  assert.equal(getConfigurationEnvironmentReferencePlaceholder('b2Host'), '$B2_HOST');
  assert.throws(
    () => resolveConfigurationEnvironmentReferences({ smtpPassword: '$SMTP_PASSWORD' }, {}),
    /\$SMTP_PASSWORD is not set or is empty/,
  );
});
