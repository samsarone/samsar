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
};
const standaloneOnlyImageModel = {
  key: 'CUSTOM_STANDALONE_IMAGE',
  standaloneOnly: true,
};

test('Qwen Image 3 Pro uses the canonical cross-service model key', () => {
  assert.equal(QWEN_IMAGE_3_PRO_MODEL_KEY, 'QWENIMAGE3PRO');
});

test('Qwen is hosted while genuinely standalone-only image models remain scoped', () => {
  const hostedModel = { key: 'GPTIMAGE2' };

  assert.equal(isImageModelAllowedForDeploymentScope(qwenImageModel, false), true);
  assert.equal(isImageModelAllowedForDeploymentScope(qwenImageModel, true), true);
  assert.equal(isImageModelAllowedForDeploymentScope(standaloneOnlyImageModel, false), false);
  assert.deepEqual(
    filterImageModelsForDeploymentScope(
      [hostedModel, qwenImageModel, standaloneOnlyImageModel],
      false,
    ),
    [hostedModel, qwenImageModel],
  );
  assert.deepEqual(
    filterImageModelsForDeploymentScope(
      [hostedModel, qwenImageModel, standaloneOnlyImageModel],
      true,
    ),
    [hostedModel, qwenImageModel, standaloneOnlyImageModel],
  );
});

test('provider-billed image pricing remains available for standalone BYOK catalogs', () => {
  assert.equal(isProviderBilledImagePricing({
    key: standaloneOnlyImageModel.key,
    providerBilled: true,
    prices: [
      { aspectRatio: '1:1', price: 0 },
      { aspectRatio: '16:9', price: 0 },
      { aspectRatio: '9:16', price: 0 },
    ],
  }), true);
});
