import assert from 'node:assert/strict';
import test from 'node:test';

import { hasSubtitleGenerationProvider } from './deploymentInferencePolicy.mjs';

test('subtitle generation accepts OpenAI or Samsar deployment configuration', () => {
  assert.equal(hasSubtitleGenerationProvider({ deployment: { providers: ['openai'] } }), true);
  assert.equal(hasSubtitleGenerationProvider({ available_providers: ['Samsar API Key'] }), true);
});

test('subtitle generation rejects unrelated deployment providers', () => {
  assert.equal(hasSubtitleGenerationProvider({ deployment: { providers: ['googleCloud', 'fal'] } }), false);
  assert.equal(hasSubtitleGenerationProvider({}), false);
});
