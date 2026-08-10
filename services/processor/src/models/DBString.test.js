import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMongoConnectionString } from './DBString.js';

test('explicit MONGO_URL wins in production Docker even when Cosmos credentials exist', () => {
  const explicitUrl = 'mongodb://app-user:app-password@mongo:27017/ProductionCompose?authSource=admin';
  assert.equal(resolveMongoConnectionString({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
    MONGO_URL: explicitUrl,
    COSMOS_DB_USERNAME: 'hosted-user',
    COSMOS_DB_PASSWORD: 'hosted-password',
  }), explicitUrl);
});

test('hosted production still builds the Cosmos connection when explicitly configured', () => {
  const connectionString = resolveMongoConnectionString({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'host',
    COSMOS_DB_USERNAME: 'hosted user',
    COSMOS_DB_PASSWORD: 'password/value',
    MONGO_DATABASE: 'HostedDatabase',
  });
  assert.match(connectionString, /^mongodb\+srv:\/\/hosted%20user:password%2Fvalue@/);
  assert.match(connectionString, /\/HostedDatabase\?/);
});

test('standalone and container deployments require an explicit Mongo URL', () => {
  assert.throws(() => resolveMongoConnectionString({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
  }), /MONGO_URL must be explicitly configured/);
  assert.throws(() => resolveMongoConnectionString({
    CURRENT_ENV: 'staging',
  }), /MONGO_URL must be explicitly configured/);
});

test('unmarked local development retains its localhost fallback', () => {
  assert.equal(resolveMongoConnectionString({
    SAMSAR_DEPLOYMENT_EDITION: 'development',
    MONGO_DATABASE: 'LocalDatabase',
  }), 'mongodb://localhost:27017/LocalDatabase');
});

test('hosted production and explicit Cosmos deployments fail closed without credentials', () => {
  assert.throws(() => resolveMongoConnectionString({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'host',
  }), /COSMOS_DB_USERNAME and COSMOS_DB_PASSWORD are required/);
  assert.throws(() => resolveMongoConnectionString({
    DATABASE_PROVIDER: 'cosmos',
    COSMOS_DB_USERNAME: 'user-only',
  }), /COSMOS_DB_USERNAME and COSMOS_DB_PASSWORD are required/);
});
