import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canListVideoModel,
  isProviderBilledVideoPricing,
  isVideoModelAllowedForDeploymentScope,
  isVideoModelTemporarilyDisabled,
} from './videoModelAvailability.mjs';
import {
  getExpressVideoCreditsPerSecond,
} from '../constants/pricing/ExpressVideoPricingDistribution.js';

test('standalone-only video models are hidden outside standalone deployments', () => {
  const model = { key: 'STANDALONE_TEST_MODEL', standaloneOnly: true };

  assert.equal(isVideoModelAllowedForDeploymentScope(model, false), false);
  assert.equal(isVideoModelAllowedForDeploymentScope(model, true), true);
});

test('provider-billed models remain listable without Samsar credit prices', () => {
  const model = { key: 'STANDALONE_TEST_MODEL', standaloneOnly: true };
  const pricingEntry = { key: model.key, providerBilled: true, prices: [] };

  assert.equal(isProviderBilledVideoPricing(pricingEntry), true);
  assert.equal(canListVideoModel({ model, pricingEntry }), false);
  assert.equal(
    canListVideoModel({ model, pricingEntry, isStandaloneDeployment: true }),
    true,
  );
});

test('Seedance 2.0 image-to-video is listable for standalone deployments', () => {
  const model = { key: 'SEEDANCE2.0I2V', standaloneOnly: true };
  const pricingEntry = {
    key: model.key,
    providerBilled: true,
    isPerSecondPricing: true,
    prices: [
      { aspectRatio: '16:9', price: 150 },
      { aspectRatio: '9:16', price: 150 },
    ],
  };

  assert.equal(isVideoModelTemporarilyDisabled(model.key), false);
  assert.equal(isVideoModelAllowedForDeploymentScope(model, true), true);
  assert.equal(
    canListVideoModel({ model, pricingEntry, isStandaloneDeployment: true }),
    true,
  );
  assert.equal(isVideoModelAllowedForDeploymentScope(model, false), false);
  assert.equal(isVideoModelTemporarilyDisabled('SEEDANCEI2V'), false);
  assert.equal(getExpressVideoCreditsPerSecond(model.key), 40);
});

test('unpriced non-provider models are not listable', () => {
  assert.equal(
    canListVideoModel({
      model: { key: 'UNPRICED' },
      pricingEntry: { key: 'UNPRICED', prices: [] },
    }),
    false,
  );
});

test('regular priced models remain listable', () => {
  assert.equal(
    canListVideoModel({
      model: { key: 'RUNWAYML' },
      pricingEntry: {
        key: 'RUNWAYML',
        prices: [{ aspectRatio: '16:9', price: 90 }],
      },
    }),
    true,
  );
});
