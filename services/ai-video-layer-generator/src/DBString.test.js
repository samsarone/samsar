import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMongoConnectionString } from './DBString.js';

test('explicit MONGO_URL has precedence in container deployments', () => {
  const mongoUrl = 'mongodb://app-user:app-password@mongo:27017/SamsarOne?authSource=admin';
  assert.equal(resolveMongoConnectionString({
    CURRENT_ENV: 'standalone',
    SAMSAR_RUNTIME: 'docker',
    MONGO_URL: mongoUrl,
  }), mongoUrl);
});

test('standalone and container deployments fail closed without MONGO_URL', () => {
  assert.throws(() => resolveMongoConnectionString({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
  }), /MONGO_URL must be explicitly configured/);
  assert.throws(() => resolveMongoConnectionString({
    CURRENT_ENV: 'staging',
  }), /MONGO_URL must be explicitly configured/);
});

test('hosted Cosmos deployments require and encode both credentials', () => {
  assert.throws(() => resolveMongoConnectionString({
    CURRENT_ENV: 'production',
    COSMOS_DB_USERNAME: 'user-only',
  }), /COSMOS_DB_USERNAME and COSMOS_DB_PASSWORD are required/);

  const value = resolveMongoConnectionString({
    CURRENT_ENV: 'production',
    COSMOS_DB_USERNAME: 'hosted user',
    COSMOS_DB_PASSWORD: 'password/value',
  });
  assert.match(value, /^mongodb\+srv:\/\/hosted%20user:password%2Fvalue@/);
});

test('unmarked local development retains its localhost fallback', () => {
  assert.equal(resolveMongoConnectionString({ CURRENT_ENV: 'development' }),
    'mongodb://localhost:27017/SamsarOne');
});
