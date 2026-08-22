import assert from 'node:assert/strict';
import test from 'node:test';

import { IMAGE_MODEL_PRICES } from '../consts/ModelPrices.js';
import { getModelPricesList } from './Utility.js';

function hasQwenImagePricing(env) {
  return getModelPricesList(env).IMAGE_MODEL_PRICES.some(
    (model) => model.key === 'QWENIMAGE3PRO',
  );
}

test('model-prices API exposes Qwen Image 3.0 Pro only for Alibaba PAYG', () => {
  assert.equal(hasQwenImagePricing({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED: 'true',
    ALIBABA_API_KEY: 'alibaba-key',
  }), true);
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

test('hosted Qwen Image 3.0 Pro pricing exactly matches GPT Image 2', () => {
  const qwen = IMAGE_MODEL_PRICES.find((model) => model.key === 'QWENIMAGE3PRO');
  const gptImageTwo = IMAGE_MODEL_PRICES.find((model) => model.key === 'GPTIMAGE2');
  assert.deepEqual(qwen?.prices, gptImageTwo?.prices);
  assert.deepEqual(qwen?.prices, [
    { aspectRatio: '1:1', price: 46 },
    { aspectRatio: '16:9', price: 46 },
    { aspectRatio: '9:16', price: 46 },
  ]);
});
