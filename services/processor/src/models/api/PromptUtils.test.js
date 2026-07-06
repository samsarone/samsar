import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stripDeprecatedVideoModelSubtypeOptions,
  validateMovieInput,
} from './PromptUtils.js';

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
