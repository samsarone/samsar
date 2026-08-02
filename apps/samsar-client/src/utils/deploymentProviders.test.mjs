import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatDeploymentProviderLabel,
  hasSubtitleGenerationProvider,
} from './deploymentInferencePolicy.mjs';

test('subtitle generation accepts OpenAI or Samsar deployment configuration', () => {
  assert.equal(hasSubtitleGenerationProvider({ deployment: { providers: ['openai'] } }), true);
  assert.equal(hasSubtitleGenerationProvider({ available_providers: ['Samsar API Key'] }), true);
});

test('subtitle generation rejects unrelated deployment providers', () => {
  assert.equal(hasSubtitleGenerationProvider({ deployment: { providers: ['googleCloud', 'fal'] } }), false);
  assert.equal(hasSubtitleGenerationProvider({}), false);
});

test('deployment provider labels identify the native Kimi provider', () => {
  assert.equal(formatDeploymentProviderLabel('kimi'), 'Kimi');
  assert.equal(formatDeploymentProviderLabel('Moonshot AI'), 'Kimi');
});

test('deployment provider labels identify GMICloud through GenBlaze', () => {
  assert.equal(formatDeploymentProviderLabel('gmicloud'), 'GMICloud via GenBlaze');
  assert.equal(formatDeploymentProviderLabel('GenBlaze'), 'GMICloud via GenBlaze');
});
