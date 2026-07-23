import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMongoConnectionString } from './DBString.js';

test('explicit MONGO_URL wins for production Docker', () => {
  assert.equal(buildMongoConnectionString({
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
    MONGO_URL: 'mongodb://mongo:27017/SamsarOne',
  }), 'mongodb://mongo:27017/SamsarOne');
});

test('production Docker defaults to the Compose Mongo service', () => {
  assert.equal(buildMongoConnectionString({
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
  }), 'mongodb://mongo:27017/SamsarOne');
});

test('legacy hosted production still uses Cosmos', () => {
  const value = buildMongoConnectionString({
    CURRENT_ENV: 'production',
    COSMOS_DB_USERNAME: 'user',
    COSMOS_DB_PASSWORD: 'password',
  });
  assert.match(value, /^mongodb\+srv:\/\/user:password@samsaroneproduction\./);
});
