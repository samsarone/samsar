import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIMI_K3_INFERENCE_MODEL,
  QWEN_37_INFERENCE_MODEL,
  QWEN_37_MAX_MODEL,
  QWEN_37_PLUS_MODEL,
  QWEN_38_MAX_PREVIEW_MODEL,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';
import { isResponsesOnlyModel } from './OpenAICompat.js';

test('normalizes Qwen 3.7 labels and provider model aliases to the canonical setting', () => {
  assert.equal(QWEN_37_INFERENCE_MODEL, 'QWEN3.7');
  assert.equal(QWEN_37_MAX_MODEL, 'qwen3.7-max');
  assert.equal(QWEN_37_PLUS_MODEL, 'qwen3.7-plus');
  assert.equal(QWEN_38_MAX_PREVIEW_MODEL, 'qwen3.8-max-preview');
  assert.equal(normalizeInferenceModel('QWEN3.7'), QWEN_37_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Qwen 3.7'), QWEN_37_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('qwen3.7-max'), QWEN_37_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Alibaba Cloud Qwen 3.7'), QWEN_37_INFERENCE_MODEL);
  assert.equal(isQwenInferenceModel('qwen-3.7-plus'), true);
  assert.equal(normalizeInferenceModel('qwen3.8-max-preview'), QWEN_37_INFERENCE_MODEL);
});

test('normalizes Kimi K3 labels to the canonical multimodal setting', () => {
  assert.equal(KIMI_K3_INFERENCE_MODEL, 'kimi-k3');
  assert.equal(normalizeInferenceModel('KIMIK3'), KIMI_K3_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Kimi K3'), KIMI_K3_INFERENCE_MODEL);
  assert.equal(normalizeInferenceModel('Moonshot K3'), KIMI_K3_INFERENCE_MODEL);
  assert.equal(isKimiInferenceModel('kimi-k3-latest'), true);
});

test('keeps Qwen out of the OpenAI Responses-only route without changing GPT or Gemini', () => {
  assert.equal(isResponsesOnlyModel('QWEN3.7'), false);
  assert.equal(isResponsesOnlyModel('gemini-3.1-pro'), false);
  assert.equal(isResponsesOnlyModel('kimi-k3'), false);
  assert.equal(isResponsesOnlyModel('gpt-5.6-sol'), true);
});
