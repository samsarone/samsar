import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stripDeprecatedVideoModelSubtypeOptions,
  validateExpressImageModelKey,
  validateMovieInput,
} from './PromptUtils.js';
import {
  IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS,
  TEXT_TO_VIDEO_IMAGE_MODEL_KEYS,
} from '../../consts/ExpressVideoModelOptions.js';
import { IMAGE_MODEL_PRICES } from '../../consts/ModelPrices.js';
import { IMAGE_GENERAITON_MODEL_TYPES } from '../../consts/ModelTypes.js';

function buildValidMoviePayload(overrides = {}) {
  return {
    prompt: 'A cinematic sunrise over a glass city.',
    image_model: 'GPTIMAGE2',
    video_model: 'RUNWAYML',
    duration: 10,
    ...overrides,
  };
}

test('text-to-video validation ignores removed video_model_sub_type payload values', () => {
  const validation = validateMovieInput(buildValidMoviePayload({
    video_model_sub_type: 'anime',
    videoModelSubType: 'cyberpunk',
  }));

  assert.equal(validation.status, true);
});

test('text-to-video validation accepts the shared express video model list', () => {
  const validation = validateMovieInput(buildValidMoviePayload({
    video_model: 'KLINGIMGTOVIDTURBO',
  }));

  assert.equal(validation.status, true);
});

test('Wan2.7 Pro is accepted for both express image stages', () => {
  const validation = validateMovieInput(buildValidMoviePayload({
    image_model: 'WAN2.7PRO',
  }));

  assert.equal(validation.status, true);
  assert.deepEqual(validateExpressImageModelKey('WAN2.7PRO'), {
    status: true,
    imageModel: 'WAN2.7PRO',
  });
  assert.equal(TEXT_TO_VIDEO_IMAGE_MODEL_KEYS.includes('WAN2.7PRO'), true);
  assert.equal(IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS.includes('WAN2.7PRO'), true);
  assert.deepEqual(
    IMAGE_GENERAITON_MODEL_TYPES.find((model) => model.key === 'WAN2.7PRO')?.supportedAspectRatios,
    ['1:1', '16:9', '9:16'],
  );
  assert.deepEqual(
    IMAGE_MODEL_PRICES.find((model) => model.key === 'WAN2.7PRO')?.prices,
    [
      { aspectRatio: '1:1', price: 15 },
      { aspectRatio: '16:9', price: 15 },
      { aspectRatio: '9:16', price: 15 },
    ],
  );
});

test('deprecated video subtype stripper removes public payload aliases only', () => {
  const payload = {
    video_model_sub_type: 'anime',
    videoModelSubType: 'comic',
    modelSubType: 'internal-session-value',
  };

  const result = stripDeprecatedVideoModelSubtypeOptions(payload);

  assert.equal(result, payload);
  assert.deepEqual(payload, {
    modelSubType: 'internal-session-value',
  });
});
