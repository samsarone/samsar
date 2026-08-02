import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  resolveNanoBananaEditAdapterProvider,
  resolveNanoBananaImageSetAdapterProvider,
} from './NanoBananaDispatcher.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'FAL_API_KEY',
  'SAMSAR_API_KEY',
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

test('multi-output image sets skip GMI according to saved adapter order without legacy fallthrough', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-nano-edit-set-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  const catalogPath = path.join(temporaryDirectory, 'genblaze-model-catalog.json');
  fs.writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      NANOBANANA2: ['gmicloud', 'googleCloud', 'fal', 'samsar'],
    },
  }));
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      NANOBANANA2EDIT: { image: { modelId: 'gemini-3.1-flash-image' } },
    },
  }));

  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = preferencePath;
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64 = 'google-credentials';
  delete process.env.FAL_API_KEY;
  delete process.env.SAMSAR_API_KEY;

  const payload = {
    model: 'NANOBANANA2EDIT',
    case_type: 'image_list_to_image_set',
    adapterProviderOverride: 'gmicloud',
  };
  assert.equal(resolveNanoBananaEditAdapterProvider(payload), 'gmicloud');
  assert.equal(resolveNanoBananaImageSetAdapterProvider(payload), 'googleCloud');

  delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_B64;
  assert.equal(resolveNanoBananaImageSetAdapterProvider(payload), '');
});
