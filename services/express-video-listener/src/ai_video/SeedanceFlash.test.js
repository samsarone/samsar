import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import { VIDEO_MODEL_PRICES, getVideoModelDurationUnitsForFramesPerSecond } from '../consts/ModelPrices.js';
import { getExpressVideoCreditsPerSecond, getExpressVideoCreditsPerSecondForRateClass } from '../consts/ExpressVideoPricingDistribution.js';
import { buildRetryableImageToVideoQueuePayload, getInitialVideoAdapter } from './utils/AIVideoQueuePayload.js';
import { shouldRequestAudioVideoLayer } from './SoundEffectStage.js';

const FLASH_MODEL = 'SEEDANCE2.5FLASHI2V';
const production = { CURRENT_ENV: 'production', SAMSAR_DEPLOYMENT_EDITION: 'production' };

test('Flash queues preserve the distinct model, fal adapter and immutable retry context', () => {
  const payload = buildRetryableImageToVideoQueuePayload({
    model: FLASH_MODEL,
    originalVideoModel: FLASH_MODEL,
    videoSessionId: 'flash-session',
    layerId: 'flash-layer',
    sourceSceneIndex: 0,
    sourceSceneRef: { version: 1, scene: { visual: 'A coastal watchtower.' } },
    prompt: 'Animate the coastal watchtower.',
    duration: 30,
    useStartFrame: true,
    fallbackStartImages: [{ src: 'generations/alternate.png', description: 'Alternate watchtower.' }],
  }, { startImage: 'https://media.example/watchtower.png' }, production);
  const persisted = new AIVideoLayerGeneration(payload).toObject();
  assert.equal(persisted.model, FLASH_MODEL);
  assert.equal(persisted.originalVideoModel, FLASH_MODEL);
  assert.equal(persisted.dockerVideoProvider, 'fal');
  assert.equal(persisted.duration, 30);
  assert.equal(persisted.startImage, 'https://media.example/watchtower.png');
  assert.equal(persisted.sourceSceneIndex, 0);
  assert.equal(persisted.sourceSceneRef.scene.visual, 'A coastal watchtower.');
  assert.equal(persisted.retryOnFail, true);
  assert.equal(persisted.fallbackStartImages[0].src, 'generations/alternate.png');
});

test('Flash is routed to fal without changing historical Seedance GMICloud queues', () => {
  assert.equal(getInitialVideoAdapter(FLASH_MODEL, production), 'fal');
  assert.equal(getInitialVideoAdapter(FLASH_MODEL, { CURRENT_ENV: 'docker' }), '');
  assert.equal(getInitialVideoAdapter('SEEDANCE2.5I2V', production), 'gmicloud');
  assert.equal(getInitialVideoAdapter('SEEDANCE2.0I2V', production), 'gmicloud');
  assert.equal(getInitialVideoAdapter('SEEDANCE2.5I2V', { CURRENT_ENV: 'docker' }), '');
});

test('Flash supports every documented 4–30 second clip and preserves family workflow pricing', () => {
  const model = VIDEO_MODEL_PRICES.find(entry => entry.key === FLASH_MODEL);
  assert.equal(model.providerBilled, true);
  assert.equal(model.isImageToVideoModel, true);
  assert.equal(model.isExpressModel, true);
  assert.deepEqual(getVideoModelDurationUnitsForFramesPerSecond(FLASH_MODEL, 24),
    Array.from({ length: 27 }, (_, index) => index + 4));
  assert.deepEqual(model.prices, [
    { aspectRatio: '16:9', price: 50 },
    { aspectRatio: '9:16', price: 50 },
  ]);
  assert.equal(getExpressVideoCreditsPerSecond(FLASH_MODEL), 50);
  assert.equal(getExpressVideoCreditsPerSecondForRateClass(FLASH_MODEL, 'agent'), 60);
  assert.equal(getExpressVideoCreditsPerSecondForRateClass(FLASH_MODEL, 'vidgenie'), 60);
  assert.deepEqual(getVideoModelDurationUnitsForFramesPerSecond('SEEDANCE2.5I2V', 24), [5, 10, 15]);
  assert.equal(getExpressVideoCreditsPerSecond('SEEDANCE2.5I2V'), 50);
});

test('the express dispatcher and native audio classification recognize the distinct Flash key', async () => {
  // Exercise the production dispatch function without loading unrelated native
  // canvas dependencies or contacting the database and inference providers.
  const source = fs.readFileSync(new URL('./AIVideoGenerator.js', import.meta.url), 'utf8');
  const dispatch = source.slice(source.indexOf('async function dispatchAiVideo('),
    source.indexOf('\n\nexport async function setSessionLayerAiVideoGenerationPending'));
  const audioModels = source.slice(source.indexOf('const AUDIO_VIDEO_SOUND_EFFECT_MODELS = ['),
    source.indexOf('];', source.indexOf('const AUDIO_VIDEO_SOUND_EFFECT_MODELS = [')) + 2);
  const calls = [];
  const context = vm.createContext({ requestRenderSeeDanceVideo: async payload => { calls.push(payload); } });
  const run = vm.runInContext(`${dispatch}\ndispatchAiVideo`, context);
  const payload = { model: FLASH_MODEL, prompt: 'Animate the watchtower.' };
  await run(payload, FLASH_MODEL, 'grounded');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], payload);
  assert.equal(calls[0].model, FLASH_MODEL);
  const models = vm.runInNewContext(`${audioModels}\nAUDIO_VIDEO_SOUND_EFFECT_MODELS`);
  assert.equal(shouldRequestAudioVideoLayer({ layerAiVideoType: 'sound_effect' }, FLASH_MODEL, models), true);
  assert.equal(shouldRequestAudioVideoLayer({ layerAiVideoType: 'narration' }, FLASH_MODEL, models), false);
});
