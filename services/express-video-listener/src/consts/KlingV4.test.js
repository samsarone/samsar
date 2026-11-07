import test from 'node:test';
import assert from 'node:assert/strict';
import { getVideoModelDurationUnitsForFramesPerSecond } from './ModelPrices.js';
import { getExpressVideoCreditsPerSecond } from './ExpressVideoPricingDistribution.js';

test('Kling 4 agent rendering retains fixed pricing and all six five-second clip boundaries', () => {
  for (const key of ['KLINGIMGTOVID4', 'KLINGIMGTOVID3PRO', 'KLINGIMGTOVIDTURBO']) {
    assert.deepEqual(getVideoModelDurationUnitsForFramesPerSecond(key, 30), [5, 10, 15, 20, 25, 30]);
    assert.equal(getExpressVideoCreditsPerSecond(key), 36);
  }
});
