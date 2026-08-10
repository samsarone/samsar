import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildAuthenticatedMongoUrl,
  isStrongSecret,
  readCredentialEnvironment,
  resolveApplicationCredentials,
  resolveGrafanaCredentials,
  resolveMinioCredentials,
  resolveMongoCredentials,
  writeCredentialEnvironment,
} from './infrastructure-credentials.mjs';

const generatedSecrets = () => {
  let index = 0;
  return () => `generated-${String(index += 1).padStart(2, '0')}-${'x'.repeat(32)}`;
};

test('replaces public application defaults with distinct generated secrets', () => {
  const credentials = resolveApplicationCredentials({
    configuredSecurity: {
      tokenSecret: 'samsar-local-token-secret-change-me',
      customAdapterSecret: 'samsar-local-custom-adapter-secret-change-me',
    },
    generateSecret: generatedSecrets(),
  });

  assert.equal(isStrongSecret(credentials.TOKEN_SECRET), true);
  assert.equal(isStrongSecret(credentials.CUSTOM_ADAPTER_SECRET_KEY), true);
  assert.equal(isStrongSecret(credentials.INTERNAL_SECRET), true);
  assert.notEqual(credentials.TOKEN_SECRET, credentials.CUSTOM_ADAPTER_SECRET_KEY);
  assert.notEqual(credentials.TOKEN_SECRET, credentials.INTERNAL_SECRET);
  assert.notEqual(credentials.CUSTOM_ADAPTER_SECRET_KEY, credentials.INTERNAL_SECRET);
});

test('preserves existing secure application secrets across renders', () => {
  const existingCredentials = {
    TOKEN_SECRET: `token-${'a'.repeat(40)}`,
    CUSTOM_ADAPTER_SECRET_KEY: `adapter-${'b'.repeat(40)}`,
    INTERNAL_SECRET: `internal-${'c'.repeat(40)}`,
  };
  assert.deepEqual(resolveApplicationCredentials({ existingCredentials }), existingCredentials);
});

test('adds a generated internal secret to legacy two-key application credentials', () => {
  const existingCredentials = {
    TOKEN_SECRET: `token-${'a'.repeat(40)}`,
    CUSTOM_ADAPTER_SECRET_KEY: `adapter-${'b'.repeat(40)}`,
  };
  const resolved = resolveApplicationCredentials({
    existingCredentials,
    generateSecret: generatedSecrets(),
  });

  assert.equal(resolved.TOKEN_SECRET, existingCredentials.TOKEN_SECRET);
  assert.equal(
    resolved.CUSTOM_ADAPTER_SECRET_KEY,
    existingCredentials.CUSTOM_ADAPTER_SECRET_KEY,
  );
  assert.equal(isStrongSecret(resolved.INTERNAL_SECRET), true);
});

test('materializes the legacy TOKEN_SECRET adapter fallback without rotating encrypted data', () => {
  const legacyTokenSecret = `legacy-token-${'a'.repeat(40)}`;
  const resolved = resolveApplicationCredentials({
    existingRootEnvironment: { TOKEN_SECRET: legacyTokenSecret },
    generateSecret: generatedSecrets(),
  });

  assert.equal(resolved.TOKEN_SECRET, legacyTokenSecret);
  assert.equal(resolved.CUSTOM_ADAPTER_SECRET_KEY, legacyTokenSecret);
  assert.notEqual(resolved.INTERNAL_SECRET, legacyTokenSecret);

  assert.equal(
    resolveApplicationCredentials({
      existingCredentials: resolved,
      generateSecret: generatedSecrets(),
    }).CUSTOM_ADAPTER_SECRET_KEY,
    legacyTokenSecret,
  );
});

test('creates distinct local infrastructure passwords and stable usernames', () => {
  const generateSecret = generatedSecrets();
  const mongo = resolveMongoCredentials({ generateSecret });
  const minio = resolveMinioCredentials({ generateSecret });
  const grafana = resolveGrafanaCredentials({ generateSecret });

  assert.equal(mongo.MONGO_APP_USERNAME, 'samsar_app');
  assert.equal(mongo.MONGO_ROOT_USERNAME, 'samsar_admin');
  assert.notEqual(mongo.MONGO_APP_PASSWORD, mongo.MONGO_ROOT_PASSWORD);
  assert.match(minio.MINIO_ROOT_USER, /^samsar_[a-f0-9]{18}$/);
  assert.equal(isStrongSecret(minio.MINIO_ROOT_PASSWORD), true);
  assert.equal(grafana.GF_SECURITY_ADMIN_USER, 'admin');
  assert.equal(isStrongSecret(grafana.GF_SECURITY_ADMIN_PASSWORD), true);
});

test('percent-encodes MongoDB credentials and rejects control characters', () => {
  const url = buildAuthenticatedMongoUrl({
    username: 'app:user',
    password: 'p@ss/word?with#symbols%',
    database: 'Samsar One',
  });
  assert.equal(
    url,
    'mongodb://app%3Auser:p%40ss%2Fword%3Fwith%23symbols%25@mongo:27017/Samsar%20One?authSource=admin',
  );
  assert.throws(
    () => buildAuthenticatedMongoUrl({ username: 'app', password: 'bad\nsecret' }),
    /must not contain/,
  );
});

test('writes credential files privately and refuses partial persisted state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-credentials-'));
  const credentialPath = path.join(directory, 'mongo.env');
  const credentials = resolveMongoCredentials({ generateSecret: generatedSecrets() });
  writeCredentialEnvironment(credentialPath, credentials);

  assert.deepEqual(
    readCredentialEnvironment(credentialPath, Object.keys(credentials)),
    credentials,
  );
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(credentialPath).mode & 0o777, 0o600);
  }

  fs.writeFileSync(credentialPath, 'MONGO_ROOT_USERNAME=samsar_admin\n', { mode: 0o600 });
  assert.throws(
    () => readCredentialEnvironment(credentialPath, Object.keys(credentials)),
    /is incomplete/,
  );
});
