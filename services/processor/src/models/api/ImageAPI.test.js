import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTextToImageRequestPricing,
  normalizeTextToImageRequestOptions,
  shouldUsePreferenceAwareImagePromptRouting,
} from './ImageAPI.js';

test('standalone text-to-image requests preserve per-user custom adapter model keys', () => {
  const previousEdition = process.env.SAMSAR_DEPLOYMENT_EDITION;
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  try {
    assert.deepEqual(normalizeTextToImageRequestOptions({
      model: 'CUSTOM_TEXT_TO_IMAGE:flux2-klein',
      aspect_ratio: '16:9',
    }), {
      model: 'CUSTOM_TEXT_TO_IMAGE:flux2-klein',
      aspectRatio: '16:9',
      resolution: null,
    });
  } finally {
    if (previousEdition === undefined) {
      delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    } else {
      process.env.SAMSAR_DEPLOYMENT_EDITION = previousEdition;
    }
  }
});

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

test('normalizes Qwen Image 3.0 Pro only with standalone Alibaba PAYG credentials', () => {
  const envKeys = [
    'CURRENT_ENV',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_RUNTIME',
    'ALIBABA_API_KEY',
    'ALIBABA_API_KEY_TYPE',
    'ALIBABA_API_ENDPOINT_TYPE',
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    envKeys.forEach((key) => delete process.env[key]);
    assert.throws(
      () => normalizeTextToImageRequestOptions({ model: 'QWENIMAGE3PRO' }),
      (error) => error?.status === 400 && /pay-as-you-go credentials/i.test(error.message),
    );

    process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
    process.env.SAMSAR_RUNTIME = 'docker';
    process.env.ALIBABA_API_KEY = 'alibaba-key';
    assert.deepEqual(normalizeTextToImageRequestOptions({
      model: 'qwenimage3pro',
      aspect_ratio: '16:9',
    }), {
      model: 'QWENIMAGE3PRO',
      aspectRatio: '16:9',
      resolution: null,
    });
    assert.throws(
      () => normalizeTextToImageRequestOptions({
        model: 'QWENIMAGE3PRO',
        aspect_ratio: '4:3',
      }),
      (error) => error?.status === 400 && /aspect_ratio must be one of/i.test(error.message),
    );

    process.env.ALIBABA_API_ENDPOINT_TYPE = 'token_plan';
    assert.throws(
      () => normalizeTextToImageRequestOptions({ model: 'QWENIMAGE3PRO' }),
      (error) => error?.status === 400 && /pay-as-you-go credentials/i.test(error.message),
    );

    process.env.ALIBABA_API_ENDPOINT_TYPE = 'coding_plan';
    assert.throws(
      () => normalizeTextToImageRequestOptions({ model: 'QWENIMAGE3PRO' }),
      (error) => error?.status === 400 && /pay-as-you-go credentials/i.test(error.message),
    );
  } finally {
    envKeys.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
  }
});

test('Qwen Image 3.0 Pro direct API requests are billed by Alibaba, not Samsar credits', () => {
  assert.deepEqual(getTextToImageRequestPricing('QWENIMAGE3PRO', 3), {
    key: 'textToImage',
    credits: 0,
    providerBilled: true,
    distribution: {
      provider: 'alibabaCloud',
      providerBilled: true,
      requestedImages: 3,
      totalCredits: 0,
    },
  });
  assert.equal(getTextToImageRequestPricing('NANOBANANA2', 1).credits > 0, true);
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
      'qwen3.8',
      { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    ),
    true,
  );
});
