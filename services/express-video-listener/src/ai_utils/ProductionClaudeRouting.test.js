import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getConfiguredInferenceProviders,
  resolveConfiguredInferenceProvider,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';

const models = ['claude-opus-5.5', 'claude-opus-5.5-xhigh', 'claude-fable-5.2', 'claude-fable-5.2-xhigh'];
const deployments = [
  { CURRENT_ENV: 'production' },
  { CURRENT_ENV: 'docker', SAMSAR_DEPLOYMENT_EDITION: 'production' },
  { CURRENT_ENV: 'docker', SAMSAR_DEPLOYMENT_EDITION: 'standalone' },
];

function withEnvironment(t, overrides) {
  const values = {
    CURRENT_ENV: '', SAMSAR_DEPLOYMENT_EDITION: '', SAMSAR_EDITION: '',
    ANTHROPIC_API_KEY: 'test-native', OPENROUTER_API_KEY: 'test-router',
    SAMSAR_API_KEY: '', SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false',
    SAMSAR_FORCE_EXTERNAL_INFERENCE: 'false', SAMSAR_GENBLAZE_ENABLED: 'false',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: '/tmp/no-production-claude-preferences.json',
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

for (const deployment of deployments) {
  for (const model of models) {
    test(`${model} prefers native Claude in ${JSON.stringify(deployment)} for text and vision`, (t) => {
      withEnvironment(t, deployment);
      for (const content of [
        'Hello',
        [{ type: 'image_url', image_url: { url: 'https://example.com/frame.png' } }],
      ]) {
        const request = { model, messages: [{ role: 'user', content }] };
        assert.deepEqual(getConfiguredInferenceProviders(model, request), ['anthropic', 'openrouter']);
        assert.equal(resolveConfiguredInferenceProvider(model, request), 'anthropic');
        assert.equal(shouldUseOpenRouterInference(request), false);
        assert.equal(shouldUseSamsarExternalInference(request), false);
        assert.equal(shouldUseOpenRouterInference({...request, authorization: 'openrouter'}), true);
        assert.equal(shouldUseSamsarExternalInference({...request, authorization: 'openrouter'}), true);
      }
    });
  }
}

for (const model of models) {
  test(`${model} retains OpenRouter fallback when the production native credential is missing`, (t) => {
    withEnvironment(t, { CURRENT_ENV: 'docker', SAMSAR_DEPLOYMENT_EDITION: 'production', ANTHROPIC_API_KEY: ' ' });
    assert.deepEqual(getConfiguredInferenceProviders(model), ['openrouter']);
    assert.equal(shouldUseOpenRouterInference({ model }), true);
    process.env.OPENROUTER_API_KEY = '';
    assert.deepEqual(getConfiguredInferenceProviders(model), []);
  });
}
