import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_MODEL_PRICES, getVideoModelDurationUnitsForFramesPerSecond } from './ModelPrices.js';
import { getExpressVideoCreditsPerSecondForRateClass } from './pricing/ExpressVideoPricingDistribution.js';
import { getSpeechDurationStringForModel } from '../models/movie_session/utils/ModelUtils.js';
import { validateTextToVideoNarrative } from '../models/movie_session/utils/TranscriptUtils.js';
import { validateExpressVideoModelKey } from '../models/api/PromptUtils.js';

test('Kling 4 separates Studio per-call pricing from fixed agent workflow pricing', () => {
  for (const model of ['KLINGIMGTOVID4', 'KLINGTXTTOVID4']) {
    const pricing = VIDEO_MODEL_PRICES.find(entry => entry.key === model);
    assert.equal(pricing.isPerSecondPricing, true);
    assert.ok(pricing.prices.every(entry => entry.price === 18.84));
    for (const fps of [24, 30, 60]) {
      assert.deepEqual(getVideoModelDurationUnitsForFramesPerSecond(model, fps), [5, 10, 15, 20, 25, 30]);
    }
  }
  for (const rateClass of ['agent', 'vidgenie']) {
    assert.equal(getExpressVideoCreditsPerSecondForRateClass('KLINGIMGTOVID4', rateClass), 36);
  }
});

test('saved v3 and Turbo selections resolve to Kling 4 without losing workflow eligibility', () => {
  for (const model of ['KLINGIMGTOVID4', 'KLINGIMGTOVID3PRO', 'KLINGIMGTOVIDTURBO']) {
    assert.deepEqual(validateExpressVideoModelKey(model), { status: true, videoModel: 'KLINGIMGTOVID4' });
    assert.deepEqual(getVideoModelDurationUnitsForFramesPerSecond(model), [5, 10, 15, 20, 25, 30]);
  }
});

test('agent prompt and narrative validation retain long Kling scenes at five-second boundaries', () => {
  assert.match(getSpeechDurationStringForModel('KLINGIMGTOVID4', 'english'),
    /5, 10, 15, 20, 25, or 30 seconds/);
  let offset = 0;
  const scenes = [4, 8, 12, 18, 23, 29].map((duration, index) => {
    const scene = { visual: `Scene ${index}`, type: 'base', duration, startTime: offset, endTime: offset + duration };
    offset += duration;
    return scene;
  });
  const result = validateTextToVideoNarrative({ scenes, sounds: [] }, 'KLINGIMGTOVID4');
  assert.equal(result.valid, true, result.errors?.join(', '));
  assert.deepEqual(result.narrativeJson.scenes.map(scene => scene.duration), [5, 10, 15, 20, 25, 30]);
  assert.equal(result.narrativeJson.scenes.at(-1).endTime, 105);
});


test('Quick workflow estimates keep the prior Kling rate independently of Studio prices', async () => {
  const { getCreditsRequiredForQuickVideo } = await import('../utils/GenerationCreditUtils.js');
  const payload = { lineItems: ['Short scene', 'x'.repeat(80)], aspectRatio: '16:9', imageModel: 'SEEDREAM' };
  const baseline = getCreditsRequiredForQuickVideo(payload);
  for (const model of ['KLINGIMGTOVID4', 'KLINGIMGTOVID3PRO', 'KLINGIMGTOVIDTURBO']) {
    const credits = getCreditsRequiredForQuickVideo({ ...payload,
      generativeVideoRequired: true, videoGenerationModel: model });
    assert.equal(credits - baseline, 108);
  }
});
