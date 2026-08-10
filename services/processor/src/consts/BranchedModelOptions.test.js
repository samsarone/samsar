import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRANCHED_IMAGE_MODEL_KEYS,
  BRANCHED_INFERENCE_MODEL_OPTIONS,
  BRANCHED_VIDEO_MODEL_KEYS,
  isBranchedImageModel,
  isBranchedInferenceModel,
  isBranchedVideoModel,
} from './BranchedModelOptions.js';
import { IMAGE_MODEL_PRICES, VIDEO_MODEL_PRICES } from './ModelPrices.js';

test('defines the exact branched inference, image, and video capability sets', () => {
  assert.deepEqual(
    BRANCHED_INFERENCE_MODEL_OPTIONS.map((model) => model.value),
    ['gpt-5.6-sol', 'gpt-5.6-sol-xhigh'],
  );
  assert.deepEqual(BRANCHED_IMAGE_MODEL_KEYS, ['GPTIMAGE2', 'NANOBANANAPRO']);
  assert.deepEqual(BRANCHED_VIDEO_MODEL_KEYS, [
    'SEEDANCE2.0I2V',
    'VEO3.1I2V',
    'VEO3.1I2VFAST',
    'COSMOS3SUPERI2V',
  ]);

  assert.equal(isBranchedInferenceModel('GPT 5.6 Sol Extra High'), true);
  assert.equal(isBranchedInferenceModel('GPT 5.6 Sol High'), true);
  assert.equal(isBranchedInferenceModel(undefined), false);
  assert.equal(isBranchedInferenceModel('definitely-not-a-model'), false);
  assert.equal(isBranchedInferenceModel('QWEN3.8'), false);
  assert.equal(isBranchedImageModel('GPTIMAGE2'), true);
  assert.equal(isBranchedImageModel('SEEDREAM'), false);
  assert.equal(isBranchedVideoModel('VEO3.1I2VFAST'), true);
  assert.equal(isBranchedVideoModel('RUNWAYML'), false);
});

test('every Express media definition carries an explicit branched capability boolean', () => {
  for (const model of IMAGE_MODEL_PRICES.filter((item) => item.isExpressModel === true)) {
    assert.equal(typeof model.isBranchedImageModel, 'boolean', model.key);
  }
  for (const model of VIDEO_MODEL_PRICES.filter((item) => item.isExpressModel === true)) {
    assert.equal(typeof model.isBranchedVideoModel, 'boolean', model.key);
  }
});
