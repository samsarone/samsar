import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

const originalMongoUrl = process.env.MONGO_URL;
process.env.MONGO_URL = 'mongodb://localhost:27017/test-bootstrap';
const {createMongoConnectionManager, resolveMongoConnectionString} = await import('../src/DBString.js');
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

test('connection manager waits for readiness and shares concurrent attempts', async () => {
  let finish;
  let calls = 0;
  const driver = {
    connection: { readyState: 0 },
    async connect(uri, options) {
      calls++;
      assert.equal(uri, 'mongodb://test.invalid/db');
      assert.equal(options.maxPoolSize, 4);
      assert.equal(options.serverSelectionTimeoutMS, 10000);
      await new Promise((resolve) => { finish = resolve; });
      this.connection.readyState = 1;
    },
  };
  const ensureConnected = createMongoConnectionManager({
    mongooseImpl: driver, connectionString: () => 'mongodb://test.invalid/db',
  });
  let ready = false;
  const first = ensureConnected().then((result) => { ready = true; return result; });
  const second = ensureConnected();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(ready, false);
  finish();
  assert.equal(await first, driver);
  assert.equal(await second, driver);
  assert.equal(await ensureConnected(), driver);
  assert.equal(calls, 1);
});

test('connection manager retries after failures and reconnects after disconnection', async () => {
  let calls = 0;
  const driver = {
    connection: { readyState: 0 },
    async connect() {
      calls++;
      if (calls === 1) throw new Error('database unavailable');
      this.connection.readyState = 1;
    },
  };
  const ensureConnected = createMongoConnectionManager({
    mongooseImpl: driver, connectionString: () => 'mongodb://test.invalid/db',
  });
  await assert.rejects(ensureConnected(), /database unavailable/);
  assert.equal(await ensureConnected(), driver);
  driver.connection.readyState = 0;
  assert.equal(await ensureConnected(), driver);
  assert.equal(calls, 3);
});

test('default connection manager uses the Mongoose connection instance under ESM', async (t) => {
  const connect = t.mock.method(mongoose, 'connect', async () => mongoose);
  const ensureConnected = createMongoConnectionManager({
    connectionString: () => 'mongodb://test.invalid/db',
  });
  assert.equal(await ensureConnected(), mongoose);
  assert.equal(connect.mock.callCount(), 1);
});
