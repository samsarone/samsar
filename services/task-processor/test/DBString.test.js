import test from 'node:test';
import assert from 'node:assert/strict';

const originalMongoUrl = process.env.MONGO_URL;
process.env.MONGO_URL = 'mongodb://localhost:27017/test-bootstrap';
const {resolveMongoConnectionString} = await import('../src/DBString.js');
if (originalMongoUrl === undefined) {
  delete process.env.MONGO_URL;
} else {
  process.env.MONGO_URL = originalMongoUrl;
}

const protectedRuntimes = [
  ['staging', {CURRENT_ENV: 'staging'}],
  ['Docker current environment', {CURRENT_ENV: 'docker'}],
  ['standalone', {CURRENT_ENV: 'standalone'}],
  ['Docker runtime marker', {SAMSAR_RUNTIME: 'docker'}],
  ['Kubernetes runtime marker', {SAMSAR_RUNTIME: ' Kubernetes '}],
  ['Compose deployment marker', {SAMSAR_DEPLOYMENT_RUNTIME: 'compose'}],
  ['standalone deployment edition', {SAMSAR_DEPLOYMENT_EDITION: 'standalone'}],
];

test('protected runtimes require a non-empty MONGO_URL', () => {
  for (const [name, env] of protectedRuntimes) {
    assert.throws(
      () => resolveMongoConnectionString(env),
      /MONGO_URL is required/,
      `${name} should reject a missing MONGO_URL`,
    );
    assert.throws(
      () => resolveMongoConnectionString({...env, MONGO_URL: '   '}),
      /MONGO_URL is required/,
      `${name} should reject a blank MONGO_URL`,
    );
  }
});

test('protected runtimes use an explicitly configured MONGO_URL', () => {
  const expected = 'mongodb://app:secret@mongo:27017/SamsarOne?authSource=admin';

  for (const [, env] of protectedRuntimes) {
    assert.equal(resolveMongoConnectionString({...env, MONGO_URL: `  ${expected}  `}), expected);
  }
});

test('ordinary local development retains the localhost fallback', () => {
  assert.equal(
    resolveMongoConnectionString({}),
    'mongodb://localhost:27017/SamsarGG',
  );
});

test('Cosmos configuration retains precedence and credential encoding', () => {
  const connectionString = resolveMongoConnectionString({
    CURRENT_ENV: 'standalone',
    DATABASE_PROVIDER: 'cosmos',
    COSMOS_DB_USERNAME: 'cosmos user',
    COSMOS_DB_PASSWORD: 'p@ss/word',
  });

  assert.match(connectionString, /^mongodb\+srv:\/\/cosmos%20user:p%40ss%2Fword@/);
  assert.match(connectionString, /\/SamsarOne\?/);
});
