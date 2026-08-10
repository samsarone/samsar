import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMongoConnectionString } from './DBString.js';

test('explicit MONGO_URL wins for production Docker', () => {
  const mongoUrl = 'mongodb://samsar-app:secret@mongo:27017/SamsarOne?authSource=admin';

  assert.equal(buildMongoConnectionString({
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
    MONGO_URL: `  ${mongoUrl}  `,
  }), mongoUrl);
});

test('deployed runtimes fail closed without an explicit MONGO_URL', () => {
  for (const env of [
    { CURRENT_ENV: 'production', SAMSAR_RUNTIME: 'docker' },
    { CURRENT_ENV: 'staging' },
    { CURRENT_ENV: 'docker' },
    { CURRENT_ENV: 'standalone' },
    { CURRENT_ENV: 'standalone', MONGO_URL: '   ' },
    { SAMSAR_RUNTIME: ' Kubernetes ' },
    { SAMSAR_DEPLOYMENT_RUNTIME: 'compose' },
    { SAMSAR_DEPLOYMENT_EDITION: 'standalone' },
  ]) {
    assert.throws(
      () => buildMongoConnectionString(env),
      /MONGO_URL is required for deployed MongoDB connections/,
    );
  }
});

test('legacy hosted production still uses Cosmos', () => {
  const value = buildMongoConnectionString({
    CURRENT_ENV: 'production',
    COSMOS_DB_USERNAME: 'user',
    COSMOS_DB_PASSWORD: 'password',
  });
  assert.match(value, /^mongodb\+srv:\/\/user:password@samsaroneproduction\./);
});

test('hosted production fails closed without Cosmos credentials', () => {
  assert.throws(
    () => buildMongoConnectionString({ CURRENT_ENV: 'production' }),
    /Missing COSMOS_DB_USERNAME or COSMOS_DB_PASSWORD/,
  );
});

test('local development retains the localhost MongoDB fallback', () => {
  assert.equal(
    buildMongoConnectionString({ CURRENT_ENV: 'development' }),
    'mongodb://localhost:27017/SamsarOne',
  );
});
