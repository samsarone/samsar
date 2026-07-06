import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMongoConnectionString,
  isTransientMongoConnectionError,
  optionsToQueryString,
} from '../src/DBConnection.js';

describe('DBConnection helpers', () => {
  it('builds the production Cosmos MongoDB URI with encoded credentials', () => {
    const uri = buildMongoConnectionString({
      CURRENT_ENV: 'production',
      COSMOS_DB_USERNAME: 'user@example.com',
      COSMOS_DB_PASSWORD: 'pa:ss/word?',
    });

    assert.equal(
      uri,
      'mongodb+srv://user%40example.com:pa%3Ass%2Fword%3F@samsaroneproduction.global.mongocluster.cosmos.azure.com/SamsarOne?tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false&maxIdleTimeMS=120000',
    );
  });

  it('requires production Cosmos credentials', () => {
    assert.throws(
      () => buildMongoConnectionString({ CURRENT_ENV: 'production' }),
      /Missing COSMOS_DB_USERNAME or COSMOS_DB_PASSWORD/,
    );
  });

  it('uses MONGO_URL for staging and docker environments', () => {
    const mongoUrl = 'mongodb://example.test:27017/SamsarOne';

    assert.equal(
      buildMongoConnectionString({ CURRENT_ENV: 'staging', MONGO_URL: mongoUrl }),
      mongoUrl,
    );
    assert.equal(
      buildMongoConnectionString({ CURRENT_ENV: 'docker', MONGO_URL: mongoUrl }),
      mongoUrl,
    );
  });

  it('falls back to the local development database', () => {
    assert.equal(
      buildMongoConnectionString({ CURRENT_ENV: 'development' }),
      'mongodb://localhost:27017/SamsarOne',
    );
  });

  it('encodes query-string options consistently', () => {
    assert.equal(
      optionsToQueryString({ tls: true, authMechanism: 'SCRAM-SHA-256', retryWrites: false }),
      'tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false',
    );
  });

  it('classifies Cosmos handshake auth failures as transient', () => {
    assert.equal(
      isTransientMongoConnectionError({
        code: 18,
        message: 'Internal error',
        codeName: 'AuthenticationFailed',
      }),
      true,
    );
    assert.equal(
      isTransientMongoConnectionError({
        errorLabels: ['HandshakeError'],
      }),
      true,
    );
    assert.equal(
      isTransientMongoConnectionError({
        errorLabels: new Set(['ResetPool']),
      }),
      true,
    );
    assert.equal(
      isTransientMongoConnectionError({
        hasErrorLabel: (label) => label === 'HandshakeError',
      }),
      true,
    );
  });

  it('does not retry plain credential failures without transient labels', () => {
    assert.equal(
      isTransientMongoConnectionError({
        code: 18,
        message: 'Authentication failed',
        codeName: 'AuthenticationFailed',
      }),
      false,
    );
  });
});
