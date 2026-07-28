import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeTextToImageRequestOptions,
  shouldUsePreferenceAwareImagePromptRouting,
} from './ImageAPI.js';

test('normalizes Wan2.7 Pro text-to-image requests to 1:1 at 1K by default', () => {
  assert.deepEqual(normalizeTextToImageRequestOptions({
    model: 'wan2.7pro',
  }), {
    model: 'WAN2.7PRO',
    aspectRatio: '1:1',
    resolution: '1K',
  });
});

test('accepts the three supported Wan2.7 Pro aspect ratios at 1K', () => {
  for (const aspectRatio of ['1:1', '16:9', '9:16']) {
    assert.deepEqual(normalizeTextToImageRequestOptions({
      model: 'WAN2.7PRO',
      aspect_ratio: aspectRatio,
      resolution: '1k',
    }), {
      model: 'WAN2.7PRO',
      aspectRatio,
      resolution: '1K',
    });
  }
});

test('rejects unsupported or malformed Wan2.7 Pro aspect ratios', () => {
  for (const aspectRatio of ['4:3', 'wide', 1.5]) {
    assert.throws(
      () => normalizeTextToImageRequestOptions({
        model: 'WAN2.7PRO',
        aspect_ratio: aspectRatio,
      }),
      (error) => error?.status === 400 && /aspect_ratio must be one of/.test(error.message),
    );
  }
});

test('rejects non-1K Wan2.7 Pro output resolution', () => {
  assert.throws(
    () => normalizeTextToImageRequestOptions({
      model: 'WAN2.7PRO',
      resolution: '2K',
    }),
    (error) => error?.status === 400 && /resolution must be 1K/.test(error.message),
  );
});

test('standalone image prompt inference uses saved adapter routing without changing production OpenAI routing', () => {
  assert.equal(
    shouldUsePreferenceAwareImagePromptRouting(
      'gpt-5.6-sol',
      { SAMSAR_DEPLOYMENT_EDITION: 'standalone' },
    ),
    true,
  );
  assert.equal(
    shouldUsePreferenceAwareImagePromptRouting(
      'gpt-5.6-sol',
      { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    ),
    false,
  );
  assert.equal(
    shouldUsePreferenceAwareImagePromptRouting(
      'qwen3.7',
      { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    ),
    true,
  );
});
