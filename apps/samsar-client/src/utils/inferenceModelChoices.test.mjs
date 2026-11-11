import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeploymentInferenceModelValue, inferGPT56SolEffortFromModelValue, resolveAllowedInferenceModelOption, filterOptionsForDeploymentInferenceModels } from './deploymentInferencePolicy.mjs';
import { supportsInferenceEffort } from './inferenceModelChoices.mjs';

for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.2']) {
  test(`${model} retains its identity, saved effort, and deployment filtering`, () => {
    assert.equal(normalizeDeploymentInferenceModelValue(model + '-xhigh'), model);
    assert.equal(inferGPT56SolEffortFromModelValue(model + '-xhigh'), 'xhigh');
    assert.equal(supportsInferenceEffort(model), true);
    const options = [{ value: model }, { value: model + '-xhigh' }];
    assert.equal(resolveAllowedInferenceModelOption(model + '-xhigh', options).value, model + '-xhigh');
    assert.deepEqual(filterOptionsForDeploymentInferenceModels(options, [model]), options);
  });
}
test('unrelated providers do not acquire a GPT/Claude effort selector', () => {
  assert.equal(supportsInferenceEffort('gemini-4-carbon'), false);
  assert.equal(supportsInferenceEffort('QWEN3.8'), false);
});


test('saved Fable 5.1 choices retain High/XHigh when selecting Fable 5.2', () => {
  const options = [{ value: 'claude-fable-5.2' }, { value: 'claude-fable-5.2-xhigh' }];
  for (const effort of ['high', 'xhigh']) {
    const legacy = 'claude-fable-5.1' + (effort === 'xhigh' ? '-xhigh' : '');
    assert.equal(normalizeDeploymentInferenceModelValue(legacy), 'claude-fable-5.2');
    assert.equal(inferGPT56SolEffortFromModelValue(legacy), effort);
    assert.equal(resolveAllowedInferenceModelOption(legacy, options).value, 'claude-fable-5.2' + (effort === 'xhigh' ? '-xhigh' : ''));
  }
});
