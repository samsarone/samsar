import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExpressVideoCreditsPerSecondForRateClass,
  getAgentVideoCreditsPerSecond,
  getExpressVideoCreditsPerSecond,
  getExpressVideoStageCreditsPerSecond,
  normalizeExpressVideoPricingRateClass,
} from './ExpressVideoPricingDistribution.js';

test('Seedance 2.5 keeps Agent and Studio pricing contracts separate', () => {
  assert.equal(getAgentVideoCreditsPerSecond('SEEDANCE2.5I2V'), 60);
  assert.equal(getExpressVideoCreditsPerSecond('SEEDANCE2.5I2V'), 50);
  assert.equal(
    getExpressVideoStageCreditsPerSecond('ai_video_generation', 'SEEDANCE2.5I2V'),
    34,
  );
  assert.equal(
    getExpressVideoCreditsPerSecondForRateClass('SEEDANCE2.5I2V', 'vidgenie'),
    60,
  );
  assert.equal(
    getExpressVideoStageCreditsPerSecond('ai_video_generation', 'SEEDANCE2.5I2V', 'agent'),
    44,
  );
  assert.equal(normalizeExpressVideoPricingRateClass('unknown'), 'studio');
});
