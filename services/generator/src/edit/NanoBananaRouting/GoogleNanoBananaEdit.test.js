import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseGoogleNativeNanoBananaEdit } from './GoogleNanoBananaEdit.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'FAL_API_KEY',
  'GOOGLE_NANOBANANA_USE_FAL',
  'GOOGLE_NANOBANANA_EDIT_USE_FAL',
  'GOOGLE_NANOBANANA_NATIVE_ENABLED',
  'GOOGLE_NANOBANANA_EDIT_NATIVE_ENABLED',
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

test('production starts NanoBanana Pro edits on Fal when Fal is configured', () => {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.FAL_API_KEY = 'fal-key';
  process.env.GOOGLE_NANOBANANA_NATIVE_ENABLED = 'true';
  process.env.GOOGLE_NANOBANANA_EDIT_NATIVE_ENABLED = 'true';

  assert.equal(shouldUseGoogleNativeNanoBananaEdit({
    model: 'NANOBANANAPROEDIT',
    apiEditStatus: 'INIT',
  }), false);

  delete process.env.FAL_API_KEY;
  assert.equal(shouldUseGoogleNativeNanoBananaEdit({
    model: 'NANOBANANAPROEDIT',
    apiEditStatus: 'INIT',
  }), true);
});

test('production preserves an already accepted native Google edit for polling only', () => {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.FAL_API_KEY = 'fal-key';

  assert.equal(shouldUseGoogleNativeNanoBananaEdit({
    model: 'NANOBANANAPROEDIT',
    apiEditStatus: 'PENDING',
    apiRequestId: 'google-native-nanobanana-edit:existing-request',
  }), true);
});
