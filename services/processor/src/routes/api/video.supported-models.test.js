import assert from 'node:assert/strict';
import test from 'node:test';

import videoRouter from './video.js';

const ENV_KEYS = [
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'CURRENT_ENV',
  'SAMSAR_AVAILABLE_MODELS_PATH',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'SAMSAR_API_KEY',
  'FAL_API_KEY',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'KIMI_K3_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

function supportedModelsHandler() {
  return videoRouter.stack.find((layer) => layer.route?.path === '/supported_models')
    ?.route?.stack?.[0]?.handle;
}

function invokeSupportedModels() {
  let statusCode = null;
  let body = null;
  supportedModelsHandler()({}, {
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  });
  return { statusCode, body };
}

test('supported models exposes additive branched metadata without narrowing production catalogs', (t) => {
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = '/tmp/samsar-no-supported-models-file.json';

  const production = invokeSupportedModels();
  assert.equal(production.statusCode, 200);
  assert.equal(production.body.deployment.edition, 'production');
  assert.deepEqual(
    production.body.INFERENCE_MODELS
      .filter((model) => model.isBranchedInferenceModel)
      .map((model) => model.value),
    ['gpt-5.6-sol'],
  );
  assert.deepEqual(
    production.body.IMAGE_MODELS
      .filter((model) => model.isBranchedImageModel)
      .map((model) => model.value),
    ['GPTIMAGE2', 'NANOBANANAPRO'],
  );
  assert.deepEqual(
    new Set(production.body.VIDEO_MODELS
      .filter((model) => model.isBranchedVideoModel)
      .map((model) => model.value)),
    new Set(['COSMOS3SUPERI2V', 'VEO3.1I2V', 'VEO3.1I2VFAST', 'SEEDANCE2.0I2V']),
  );
  assert.equal(
    production.body.IMAGE_MODELS.every(
      (model) => typeof model.isBranchedImageModel === 'boolean',
    ),
    true,
  );
  assert.equal(
    production.body.VIDEO_MODELS.every(
      (model) => typeof model.isBranchedVideoModel === 'boolean',
    ),
    true,
  );

  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  const standalone = invokeSupportedModels();
  assert.equal(standalone.statusCode, 200);
  assert.equal(standalone.body.deployment.edition, 'standalone');
  assert.deepEqual(standalone.body.INFERENCE_MODELS, []);
  assert.deepEqual(standalone.body.IMAGE_MODELS, []);
  assert.deepEqual(standalone.body.VIDEO_MODELS, []);
});

test('standalone supported models derives branched options from raw provider credentials', (t) => {
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = '/tmp/samsar-no-runtime-supported-models-file.json';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.FAL_API_KEY = 'test-fal-key';

  const standalone = invokeSupportedModels();
  assert.equal(standalone.statusCode, 200);
  assert.deepEqual(
    standalone.body.INFERENCE_MODELS
      .filter((model) => model.isBranchedInferenceModel)
      .map((model) => model.value),
    ['gpt-5.6-sol'],
  );
  assert.deepEqual(
    standalone.body.IMAGE_MODELS
      .filter((model) => model.isBranchedImageModel)
      .map((model) => model.value),
    ['GPTIMAGE2', 'NANOBANANAPRO'],
  );
  assert.deepEqual(
    standalone.body.VIDEO_MODELS
      .filter((model) => model.isBranchedVideoModel)
      .map((model) => model.value),
    ['SEEDANCE2.0I2V'],
  );
});
