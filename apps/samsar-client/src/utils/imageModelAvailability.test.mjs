import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QWEN_IMAGE_3_PRO_MODEL_KEY,
  filterImageModelsForDeploymentScope,
  isImageModelAllowedForDeploymentScope,
  isProviderBilledImagePricing,
} from './imageModelAvailability.mjs';

const qwenImageModel = {
  key: QWEN_IMAGE_3_PRO_MODEL_KEY,
  standaloneOnly: true,
};

test('Qwen Image 3 Pro uses the canonical cross-service model key', () => {
  assert.equal(QWEN_IMAGE_3_PRO_MODEL_KEY, 'QWENIMAGE3PRO');
});

test('standalone-only image models are hidden from hosted model catalogs', () => {
  const hostedModel = { key: 'GPTIMAGE2' };

  assert.equal(isImageModelAllowedForDeploymentScope(qwenImageModel, false), false);
  assert.equal(isImageModelAllowedForDeploymentScope(qwenImageModel, true), true);
  assert.deepEqual(
    filterImageModelsForDeploymentScope([hostedModel, qwenImageModel], false),
    [hostedModel],
  );
  assert.deepEqual(
    filterImageModelsForDeploymentScope([hostedModel, qwenImageModel], true),
    [hostedModel, qwenImageModel],
  );
});

test('Qwen Image 3 Pro pricing is recognized as provider billed', () => {
  assert.equal(isProviderBilledImagePricing({
    key: QWEN_IMAGE_3_PRO_MODEL_KEY,
    providerBilled: true,
    prices: [
      { aspectRatio: '1:1', price: 0 },
      { aspectRatio: '16:9', price: 0 },
      { aspectRatio: '9:16', price: 0 },
    ],
  }), true);
});
