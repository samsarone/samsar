import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QWEN_37_INFERENCE_MODEL,
  QWEN_37_MAX_MODEL,
  QWEN_37_PLUS_MODEL,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';
import { isResponsesOnlyModel } from './OpenAICompat.js';

test('normalizes Qwen 3.7 labels and provider model aliases to the canonical setting', () => {
  assert.equal(QWEN_37_INFERENCE_MODEL, 'QWEN3.7');
  assert.equal(QWEN_37_MAX_MODEL, 'qwen3.7-max');
  assert.equal(QWEN_37_PLUS_MODEL, 'qwen3.7-plus');
  assert.equal(normalizeInferenceModel('QWEN3.7'), QWEN_37_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Qwen 3.7'), QWEN_37_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('qwen3.7-max'), QWEN_37_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Alibaba Cloud Qwen 3.7'), QWEN_37_INFERENCE_MODEL);
  assert.equal(isQwenInferenceModel('qwen-3.7-plus'), true);
});

test('keeps Qwen out of the OpenAI Responses-only route without changing GPT or Gemini', () => {
  assert.equal(isResponsesOnlyModel('QWEN3.7'), false);
  assert.equal(isResponsesOnlyModel('gemini-3.1-pro'), false);
  assert.equal(isResponsesOnlyModel('gpt-5.6-sol'), true);
});
