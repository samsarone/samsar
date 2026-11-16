import { describe, expect, it } from 'vitest';
import { IMAGE_GENERAITON_MODEL_TYPES, VIDEO_GENERATION_MODEL_TYPES } from '../../src/constants/Types.ts';
import { VIDEO_MODEL_PRICES } from '../../src/constants/ModelPrices.jsx';
import { getExpressVideoCreditsPerSecondForRateClass } from '../../src/constants/pricing/ExpressVideoPricingDistribution.js';

describe('current Seed model choices', () => {
  it('labels the stable Seedream request key with the current version', () => {
    expect(IMAGE_GENERAITON_MODEL_TYPES.find(model => model.key === 'SEEDREAM').name).toBe('Seedream 5.5');
  });
  it('offers Flash separately while preserving the standard 2.5 model', () => {
    const flash = VIDEO_GENERATION_MODEL_TYPES.find(model => model.key === 'SEEDANCE2.5FLASHI2V');
    expect(flash).toMatchObject({ name: 'Seedance 2.5 Flash I2V', isExpressModel: true, isBranchedVideoModel: false });
    expect(VIDEO_GENERATION_MODEL_TYPES.find(model => model.key === 'SEEDANCE2.5I2V').name).toBe('Seedance 2.5 I2V');
    expect(VIDEO_MODEL_PRICES.find(model => model.key === flash.key).units).toContain(30);
  });
  it.each(['studio', 'agent', 'vidgenie'])('preserves the Seedance 2.5 family workflow rate for %s', rateClass => {
    expect(getExpressVideoCreditsPerSecondForRateClass('SEEDANCE2.5FLASHI2V', rateClass))
      .toBe(getExpressVideoCreditsPerSecondForRateClass('SEEDANCE2.5I2V', rateClass));
  });
});
