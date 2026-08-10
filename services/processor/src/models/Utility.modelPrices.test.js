import assert from 'node:assert/strict';
import test from 'node:test';

import { getModelPricesList } from './Utility.js';

function hasQwenImagePricing(env) {
  return getModelPricesList(env).IMAGE_MODEL_PRICES.some(
    (model) => model.key === 'QWENIMAGE3PRO',
  );
}

test('model-prices API exposes Qwen Image 3.0 Pro only for Alibaba PAYG', () => {
  assert.equal(hasQwenImagePricing({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    ALIBABA_API_KEY: 'alibaba-key',
  }), false);
  assert.equal(hasQwenImagePricing({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    ALIBABA_API_KEY: 'alibaba-key',
  }), true);
  assert.equal(hasQwenImagePricing({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    ALIBABA_API_KEY: 'alibaba-key',
    ALIBABA_API_ENDPOINT_TYPE: 'token_plan',
  }), false);
  assert.equal(hasQwenImagePricing({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    ALIBABA_API_KEY: 'alibaba-key',
    ALIBABA_API_KEY_TYPE: 'plan',
    ALIBABA_API_ENDPOINT_TYPE: 'pay_as_you_go',
  }), false);
  assert.equal(hasQwenImagePricing({
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    ALIBABA_API_KEY: 'alibaba-key',
    ALIBABA_API_ENDPOINT_TYPE: 'coding_plan',
  }), false);
});
