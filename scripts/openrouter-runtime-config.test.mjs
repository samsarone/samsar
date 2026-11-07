import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDockerAvailableModelsFromEnabledProviders } from '../apps/setup-wizard/src/constants/dockerModelAvailability.js';
import {
  DEFAULT_OPENROUTER_GEMINI_4_ARGON_MODEL,
  applyEffectiveOpenRouterProviderConfig,
  resolveOpenRouterRuntimeConfig,
} from './openrouter-runtime-config.mjs';

test('disabled OpenRouter does not expose a stored credential or model mapping', () => {
  assert.deepEqual(
    resolveOpenRouterRuntimeConfig({
      providerConfig: { enabled: false },
      providerSecrets: { apiKey: 'stored-key' },
    }),
    { enabled: false, apiKey: '', gemini4ArgonModel: '' },
  );
});

test('enabled OpenRouter without a credential is effectively disabled', () => {
  const result = applyEffectiveOpenRouterProviderConfig({
    openrouter: { enabled: true },
  });

  assert.equal(result.openrouter.enabled, false);
  assert.equal(result.providers.openrouter.enabled, false);
  assert.equal(
    buildDockerAvailableModelsFromEnabledProviders(
      Object.entries(result.providers)
        .filter(([, provider]) => provider.enabled === true)
        .map(([provider]) => provider),
    ).models.includes('QWEN3.8'),
    false,
  );
});

test('enabled OpenRouter reads the provider secret and renders the current Gemini mapping', () => {
  assert.deepEqual(
    resolveOpenRouterRuntimeConfig({
      providerConfig: { enabled: true },
      providerSecrets: { apiKey: ' stored-key ' },
    }),
    {
      enabled: true,
      apiKey: 'stored-key',
      gemini4ArgonModel: DEFAULT_OPENROUTER_GEMINI_4_ARGON_MODEL,
    },
  );
});

test('legacy config key and explicit Gemini mapping remain supported', () => {
  assert.deepEqual(
    resolveOpenRouterRuntimeConfig({
      providerConfig: {
        enabled: true,
        apiKey: 'legacy-config-key',
        gemini4ArgonModel: 'google/custom-gemini-model',
      },
    }),
    {
      enabled: true,
      apiKey: 'legacy-config-key',
      gemini4ArgonModel: 'google/custom-gemini-model',
    },
  );
});

test('provider secret takes precedence over the legacy config key', () => {
  const result = resolveOpenRouterRuntimeConfig({
    providerConfig: { enabled: true, apiKey: 'legacy-config-key' },
    providerSecrets: { apiKey: 'provider-secret-key' },
  });

  assert.equal(result.apiKey, 'provider-secret-key');
});

test('Gemini 4 uses its configured provider model', () => {
  assert.equal(resolveOpenRouterRuntimeConfig({
    providerConfig: { enabled: true, gemini4ArgonModel: 'google/custom-gemini' },
    providerSecrets: { apiKey: 'stored-key' },
  }).gemini4ArgonModel, 'google/custom-gemini');
});

test('effective enabled provider exposes the routed inference models', () => {
  const result = applyEffectiveOpenRouterProviderConfig(
    { openrouter: { enabled: true } },
    { apiKey: 'provider-secret-key' },
  );
  const enabledProviders = Object.entries(result.providers)
    .filter(([, provider]) => provider.enabled === true)
    .map(([provider]) => provider);
  const available = buildDockerAvailableModelsFromEnabledProviders(enabledProviders);

  assert.deepEqual(
    available.models.filter((model) => ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.1', 'gemini-4-argon', 'QWEN3.8'].includes(model)),
    ['QWEN3.8', 'claude-fable-5.1', 'claude-opus-5.5', 'gemini-4-argon', 'gpt-6-astra', 'gpt-6.1-sol'],
  );
});
