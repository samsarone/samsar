import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMongoConnectionString } from './DBString.js';

test('explicit MONGO_URL wins in production Docker even when Cosmos credentials exist', () => {
  const explicitUrl = 'mongodb://mongo:27017/ProductionCompose';
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

test('container and host fallbacks do not depend on product edition', () => {
  assert.equal(resolveMongoConnectionString({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
    MONGO_DATABASE: 'ContainerDatabase',
  }), 'mongodb://mongo:27017/ContainerDatabase');

  assert.equal(resolveMongoConnectionString({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'host',
    MONGO_DATABASE: 'LocalDatabase',
  }), 'mongodb://localhost:27017/LocalDatabase');
});
