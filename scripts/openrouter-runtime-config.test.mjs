import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDockerAvailableModelsFromEnabledProviders } from '../apps/setup-wizard/src/constants/dockerModelAvailability.js';
import {
  DEFAULT_OPENROUTER_GEMINI_31_PRO_MODEL,
  applyEffectiveOpenRouterProviderConfig,
  resolveOpenRouterRuntimeConfig,
} from './openrouter-runtime-config.mjs';

test('disabled OpenRouter does not expose a stored credential or model mapping', () => {
  assert.deepEqual(
    resolveOpenRouterRuntimeConfig({
      providerConfig: { enabled: false },
      providerSecrets: { apiKey: 'stored-key' },
    }),
    { enabled: false, apiKey: '', gemini31ProModel: '' },
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
    ).models.includes('QWEN3.7'),
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
      gemini31ProModel: DEFAULT_OPENROUTER_GEMINI_31_PRO_MODEL,
    },
  );
});

test('legacy config key and explicit Gemini mapping remain supported', () => {
  assert.deepEqual(
    resolveOpenRouterRuntimeConfig({
      providerConfig: {
        enabled: true,
        apiKey: 'legacy-config-key',
        gemini31ProModel: 'google/custom-gemini-model',
      },
    }),
    {
      enabled: true,
      apiKey: 'legacy-config-key',
      gemini31ProModel: 'google/custom-gemini-model',
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
    available.models.filter((model) => ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7'].includes(model)),
    ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol'],
  );
});
