import test from 'node:test';
import assert from 'node:assert/strict';
import { __testOnly__ } from './Image.js';
import { shouldUseSamsarExternalImageProvider } from './providers/SamsarExternalImage.js';

test('image worker routes Kling through Samsar with only a Samsar key and preserves accepted provider affinity', () => {
  const keys = ['SAMSAR_DEPLOYMENT_EDITION', 'CURRENT_ENV', 'SAMSAR_API_KEY', 'FAL_API_KEY',
    'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED', 'SAMSAR_EXTERNAL_PROVIDERS_ENABLED',
    'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
    process.env.CURRENT_ENV = 'docker';
    process.env.SAMSAR_API_KEY = 'test-key';
    process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
    process.env.SAMSAR_EXTERNAL_PROVIDERS_ENABLED = 'true';
    process.env.SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH = '/nonexistent-kling-preferences.json';
    delete process.env.FAL_API_KEY;
    const payload = { model: 'KLINGIMAGE4', operationType: 'GENERATE', apiGenerationStatus: 'INIT' };
    assert.equal(__testOnly__.resolveImageProviderForModel(payload.model, payload), 'samsar');
    assert.equal(shouldUseSamsarExternalImageProvider(payload), true);
    process.env.FAL_API_KEY = 'test-fal';
    assert.equal(__testOnly__.resolveImageProviderForModel(payload.model, payload), 'fal');
    assert.equal(shouldUseSamsarExternalImageProvider(payload), false);
    const accepted = { ...payload, apiGenerationStatus: 'PENDING', submittedAdapter: 'samsar',
      apiRequestId: 'samsar-external-image:original-kling' };
    assert.equal(__testOnly__.resolveImageProviderForModel(accepted.model, accepted), 'samsar');
    assert.equal(shouldUseSamsarExternalImageProvider(accepted), true);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});
