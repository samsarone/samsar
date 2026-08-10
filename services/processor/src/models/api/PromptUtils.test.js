import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stripDeprecatedVideoModelSubtypeOptions,
  validateExpressImageModelKey,
  validateExpressVideoModelKey,
  validateMovieInput,
} from './PromptUtils.js';
import {
  IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS,
  IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS,
  TEXT_TO_VIDEO_IMAGE_MODEL_KEYS,
  TEXT_TO_VIDEO_VIDEO_MODEL_KEYS,
} from '../../consts/ExpressVideoModelOptions.js';
import { IMAGE_MODEL_PRICES, VIDEO_MODEL_PRICES } from '../../consts/ModelPrices.js';
import { getExpressVideoCreditsPerSecond } from '../../consts/pricing/ExpressVideoPricingDistribution.js';
import {
  IMAGE_GENERAITON_MODEL_TYPES,
  VIDEO_GENERATION_MODEL_TYPES,
} from '../../consts/ModelTypes.js';

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

test('Seedance 2.0 is an express provider-billed model on standalone video surfaces', () => {
  assert.deepEqual(validateExpressVideoModelKey('SEEDANCE2.0I2V'), {
    status: true,
    videoModel: 'SEEDANCE2.0I2V',
  });
  assert.equal(
    validateMovieInput(buildValidMoviePayload({ video_model: 'SEEDANCE2.0I2V' })).status,
    true,
  );
  assert.equal(TEXT_TO_VIDEO_VIDEO_MODEL_KEYS.includes('SEEDANCE2.0I2V'), true);
  assert.equal(IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS.includes('SEEDANCE2.0I2V'), true);
  assert.equal(
    VIDEO_GENERATION_MODEL_TYPES.find((model) => model.key === 'SEEDANCE2.0I2V')?.isExpressModel,
    true,
  );
  const pricing = VIDEO_MODEL_PRICES.find((model) => model.key === 'SEEDANCE2.0I2V');
  assert.equal(pricing?.providerBilled, true);
  assert.equal(pricing?.isPerSecondPricing, true);
  assert.deepEqual(pricing?.prices, [
    { aspectRatio: '16:9', price: 150 },
    { aspectRatio: '9:16', price: 150 },
  ]);
  assert.equal(pricing?.pricingDistribution?.total, 40);
  assert.equal(getExpressVideoCreditsPerSecond('SEEDANCE2.0I2V'), 40);
});

test('Seedance 2.5 is accepted by external express video routes', () => {
  assert.deepEqual(validateExpressVideoModelKey('SEEDANCE2.5I2V'), {
    status: true,
    videoModel: 'SEEDANCE2.5I2V',
  });
  assert.equal(
    validateMovieInput(buildValidMoviePayload({ video_model: 'SEEDANCE2.5I2V' })).status,
    true,
  );
  assert.equal(TEXT_TO_VIDEO_VIDEO_MODEL_KEYS.includes('SEEDANCE2.5I2V'), true);
  assert.equal(IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS.includes('SEEDANCE2.5I2V'), true);
  assert.equal(
    VIDEO_GENERATION_MODEL_TYPES.find((model) => model.key === 'SEEDANCE2.5I2V')?.isExpressModel,
    true,
  );
  const pricing = VIDEO_MODEL_PRICES.find((model) => model.key === 'SEEDANCE2.5I2V');
  assert.equal(pricing?.providerBilled, true);
  assert.equal(pricing?.isPerSecondPricing, true);
  assert.deepEqual(pricing?.units, [5, 10, 15]);
  assert.equal(pricing?.pricingDistribution?.total, 50);
  assert.equal(getExpressVideoCreditsPerSecond('SEEDANCE2.5I2V'), 50);
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

test('Qwen Image 3.0 Pro is a zero-credit, provider-billed standalone Express image model', () => {
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
    assert.equal(validateExpressImageModelKey('QWENIMAGE3PRO').status, false);

    process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
    process.env.SAMSAR_RUNTIME = 'docker';
    process.env.ALIBABA_API_KEY = 'alibaba-key';
    assert.deepEqual(validateExpressImageModelKey('QWENIMAGE3PRO'), {
      status: true,
      imageModel: 'QWENIMAGE3PRO',
    });
    assert.equal(
      validateMovieInput(buildValidMoviePayload({ image_model: 'QWENIMAGE3PRO' })).status,
      true,
    );
    assert.equal(TEXT_TO_VIDEO_IMAGE_MODEL_KEYS.includes('QWENIMAGE3PRO'), true);
    assert.equal(IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS.includes('QWENIMAGE3PRO'), true);
    const modelType = IMAGE_GENERAITON_MODEL_TYPES.find(
      (model) => model.key === 'QWENIMAGE3PRO',
    );
    assert.equal(modelType?.standaloneOnly, true);
    assert.equal(modelType?.providerBilled, true);
    assert.deepEqual(modelType?.supportedAspectRatios, ['1:1', '16:9', '9:16']);
    const pricing = IMAGE_MODEL_PRICES.find((model) => model.key === 'QWENIMAGE3PRO');
    assert.equal(pricing?.standaloneOnly, true);
    assert.equal(pricing?.providerBilled, true);
    assert.deepEqual(pricing?.prices, [
      { aspectRatio: '1:1', price: 0 },
      { aspectRatio: '16:9', price: 0 },
      { aspectRatio: '9:16', price: 0 },
    ]);

    process.env.ALIBABA_API_KEY_TYPE = 'token_plan';
    process.env.ALIBABA_API_ENDPOINT_TYPE = 'token_plan';
    assert.equal(validateExpressImageModelKey('QWENIMAGE3PRO').status, false);

    process.env.ALIBABA_API_KEY_TYPE = 'plan';
    process.env.ALIBABA_API_ENDPOINT_TYPE = 'pay_as_you_go';
    assert.equal(validateExpressImageModelKey('QWENIMAGE3PRO').status, false);

    process.env.ALIBABA_API_KEY_TYPE = 'coding_plan';
    assert.equal(validateExpressImageModelKey('QWENIMAGE3PRO').status, false);
  } finally {
    envKeys.forEach((key) => {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
  }
});

test('NanoBanana 2 is excluded from every express image surface', () => {
  assert.deepEqual(validateExpressImageModelKey('NANOBANANA2'), {
    status: false,
    message: 'Image model is not supported for this type',
  });
  assert.equal(
    validateMovieInput(buildValidMoviePayload({ image_model: 'NANOBANANA2' })).status,
    false,
  );
  assert.equal(TEXT_TO_VIDEO_IMAGE_MODEL_KEYS.includes('NANOBANANA2'), false);
  assert.equal(IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS.includes('NANOBANANA2'), false);
  assert.equal(
    IMAGE_GENERAITON_MODEL_TYPES.find((model) => model.key === 'NANOBANANA2')?.isExpressModel,
    false,
  );
  assert.equal(
    IMAGE_MODEL_PRICES.find((model) => model.key === 'NANOBANANA2')?.isExpressModel,
    false,
  );
});

test('per-user custom text-to-image model keys are accepted for express generation', () => {
  const modelKey = 'CUSTOM_TEXT_TO_IMAGE:text_to_image_flux2';
  const previousEdition = process.env.SAMSAR_DEPLOYMENT_EDITION;
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  try {
    assert.deepEqual(validateExpressImageModelKey(modelKey), {
      status: true,
      imageModel: modelKey,
    });
    assert.equal(
      validateMovieInput(buildValidMoviePayload({ image_model: modelKey })).status,
      true,
    );
  } finally {
    if (previousEdition === undefined) {
      delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    } else {
      process.env.SAMSAR_DEPLOYMENT_EDITION = previousEdition;
    }
  }
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
