import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInferenceModel, getGPT56SolReasoningEffort } from './InferenceModels.js';
import { getReasoningModelBase, supportsInferenceEffort } from './ReasoningModels.js';
import { getOpenRouterModelForInferenceRequest } from './SamsarExternalInferenceAdapter.js';

for (const base of ['gpt-6.2-astra', 'gpt-6-astra', 'gpt-5.6-sol']) {
  for (const effort of ['high', 'xhigh']) {
    test(`Astra 6.2 upgrades ${base}/${effort} without losing effort`, () => {
      const alias = `${base}-${effort}`;
      assert.equal(normalizeInferenceModel(alias), `gpt-6.2-astra${effort === 'xhigh' ? '-xhigh' : ''}`);
      assert.equal(getGPT56SolReasoningEffort(alias), effort);
      assert.equal(getOpenRouterModelForInferenceRequest({ model: alias }, {}), 'openai/gpt-6.2-astra');
    });
  }
}

test('Astra 6.2 supports native reasoning and ignores stale Astra OpenRouter IDs', () => {
  assert.equal(supportsInferenceEffort('openai/gpt-6.2-astra-xhigh'), true);
  assert.equal(getReasoningModelBase('openai/gpt-6-astra-xhigh'), 'gpt-6.2-astra');
  for (const model of ['openai/gpt-6-astra', 'gpt-6-astra-high', 'openai/gpt-5.6-sol']) {
    assert.equal(getOpenRouterModelForInferenceRequest({ model: 'gpt-6.2-astra' }, {
      OPENROUTER_GPT_6_ASTRA_MODEL: model,
    }), 'openai/gpt-6.2-astra');
  }
  assert.equal(getOpenRouterModelForInferenceRequest({ model: 'gpt-6.2-astra' }, {
    OPENROUTER_GPT_62_ASTRA_MODEL: 'openai/gpt-6.2-astra',
    OPENROUTER_GPT_6_ASTRA_MODEL: 'openai/gpt-6-astra',
  }), 'openai/gpt-6.2-astra');
  assert.equal(getOpenRouterModelForInferenceRequest({ model: 'gpt-6.1-sol-xhigh' }, {}), 'openai/gpt-6.1-sol');
});
