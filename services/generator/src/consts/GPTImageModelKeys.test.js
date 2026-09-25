import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStoredGPTImageModelKey } from './GPTImageModelKeys.js';
import { buildOpenAIGPTImageTwoInput, GPT_IMAGE_TWO_FAL_ENDPOINT } from '../providers/GPTImageTwoPayload.js';

test('queued historical jobs use current keys without changing their upstream model', () => {
  assert.equal(normalizeStoredGPTImageModelKey('GPTIMAGE2'), 'GPTIMAGE2.5');
  assert.equal(normalizeStoredGPTImageModelKey('GPTIMAGE2EDIT'), 'GPTIMAGE2.5EDIT');
  assert.equal(normalizeStoredGPTImageModelKey('GPTIMAGE2.5'), 'GPTIMAGE2.5');
  assert.equal(normalizeStoredGPTImageModelKey('NANOBANANAPRO'), 'NANOBANANAPRO');
  assert.equal(buildOpenAIGPTImageTwoInput({ aspectRatio: '16:9' }).model, 'gpt-image-2.5-sunburst');
  assert.equal(GPT_IMAGE_TWO_FAL_ENDPOINT, 'openai/gpt-image-2.5/sunburst/text-to-image');
});
