import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNanoBananaEditAdapterProvider } from './NanoBananaDispatcher.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
];
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

test('standalone Nano Banana edits stay pinned to the selected adapter', () => {
  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';

  assert.equal(resolveNanoBananaEditAdapterProvider({
    model: 'NANOBANANAPROEDIT',
    adapterProviderOverride: 'fal',
  }), 'fal');
  assert.equal(resolveNanoBananaEditAdapterProvider({
    model: 'NANOBANANAPROEDIT',
    apiEditStatus: 'PENDING',
    apiRequestId: 'google-native-nanobanana-edit:request-1',
  }), 'googleCloud');
});

test('production Nano Banana edits keep the legacy dispatcher behavior', () => {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';

  assert.equal(resolveNanoBananaEditAdapterProvider({
    model: 'NANOBANANAPROEDIT',
    adapterProviderOverride: 'samsar',
  }), '');
});
