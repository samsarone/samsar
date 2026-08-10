import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatUserClientProfile,
  normalizeCustomAdaptersPayload,
} from './User.js';

const ENDPOINT = {
  id: 'flux2-klein',
  name: 'FLUX.2 Klein 4B',
  operation: 'text_to_image',
  generate_url: 'https://images.example/generate',
  status_url: 'https://images.example/generate/{request_id}/status',
  result_url: 'https://images.example/generate/{request_id}/result',
  header_key: 'Authorization',
  header_value: 'Bearer private-token',
};

test('normalizes text-to-image endpoints and derives immutable model keys', () => {
  const previousSecret = process.env.CUSTOM_ADAPTER_SECRET_KEY;
  process.env.CUSTOM_ADAPTER_SECRET_KEY = 'processor-custom-adapter-test-secret';
  try {
    const normalized = normalizeCustomAdaptersPayload({ custom_endpoints: [ENDPOINT] });
    const endpoint = normalized.custom_endpoints[0];
    assert.equal(endpoint.model_key, 'CUSTOM_TEXT_TO_IMAGE:flux2-klein');
    assert.equal(endpoint.header_key, 'Authorization');
    assert.match(endpoint.header_value, /^enc:v1:/);

    const clientProfile = formatUserClientProfile({
      _id: 'user-id',
      custom_adapters: normalized,
    });
    assert.equal(clientProfile.custom_adapters.custom_endpoints[0].header_value, undefined);
    assert.equal(clientProfile.custom_adapters.custom_endpoints[0].has_header_value, true);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CUSTOM_ADAPTER_SECRET_KEY;
    } else {
      process.env.CUSTOM_ADAPTER_SECRET_KEY = previousSecret;
    }
  }
});

test('preserves an existing encrypted header value when the browser leaves it blank', () => {
  const previousSecret = process.env.CUSTOM_ADAPTER_SECRET_KEY;
  process.env.CUSTOM_ADAPTER_SECRET_KEY = 'processor-custom-adapter-test-secret';
  try {
    const current = normalizeCustomAdaptersPayload({ custom_endpoints: [ENDPOINT] });
    const next = normalizeCustomAdaptersPayload({
      custom_endpoints: [{
        ...ENDPOINT,
        header_value: '',
        has_header_value: true,
      }],
    }, current);
    assert.equal(
      next.custom_endpoints[0].header_value,
      current.custom_endpoints[0].header_value,
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CUSTOM_ADAPTER_SECRET_KEY;
    } else {
      process.env.CUSTOM_ADAPTER_SECRET_KEY = previousSecret;
    }
  }
});

test('rejects poll URLs that cannot be bound to a request id', () => {
  assert.throws(
    () => normalizeCustomAdaptersPayload({
      custom_endpoints: [{
        ...ENDPOINT,
        status_url: 'https://images.example/status',
      }],
    }),
    /status_url.*\{request_id\}/,
  );
});

test('requires CUSTOM_ADAPTER_SECRET_KEY instead of falling back to shared secrets', () => {
  const previous = {
    CUSTOM_ADAPTER_SECRET_KEY: process.env.CUSTOM_ADAPTER_SECRET_KEY,
    CUSTOM_CREDENTIALS_SECRET: process.env.CUSTOM_CREDENTIALS_SECRET,
    TOKEN_SECRET: process.env.TOKEN_SECRET,
  };
  delete process.env.CUSTOM_ADAPTER_SECRET_KEY;
  process.env.CUSTOM_CREDENTIALS_SECRET = 'legacy-custom-credentials-secret-9f8c7b6a';
  process.env.TOKEN_SECRET = 'shared-token-secret-9f8c7b6a5d4e3f2a1c0b';
  try {
    assert.throws(
      () => normalizeCustomAdaptersPayload({ custom_endpoints: [ENDPOINT] }),
      /CUSTOM_ADAPTER_SECRET_KEY.*explicitly configured/,
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test('rejects a known public custom-adapter secret', () => {
  const previousSecret = process.env.CUSTOM_ADAPTER_SECRET_KEY;
  process.env.CUSTOM_ADAPTER_SECRET_KEY = `samsar-local-${'x'.repeat(32)}`;
  try {
    assert.throws(
      () => normalizeCustomAdaptersPayload({ custom_endpoints: [ENDPOINT] }),
      /CUSTOM_ADAPTER_SECRET_KEY.*known public\/default value/,
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CUSTOM_ADAPTER_SECRET_KEY;
    } else {
      process.env.CUSTOM_ADAPTER_SECRET_KEY = previousSecret;
    }
  }
});
