import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GPT_56_SOL_REASONING_EFFORT,
  isGPT56SolInferenceModel,
} from './InferenceModels.js';

test('uses xhigh reasoning for GPT 5.6 Sol inference aliases', () => {
  assert.equal(GPT_56_SOL_REASONING_EFFORT, 'xhigh');
  assert.equal(isGPT56SolInferenceModel('gpt-5.6-sol'), true);
  assert.equal(isGPT56SolInferenceModel('gpt-5.6'), true);
  assert.equal(isGPT56SolInferenceModel('gpt-4o-mini'), false);
});
