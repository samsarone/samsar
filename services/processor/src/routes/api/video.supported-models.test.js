import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import videoRouter from './video.js';

const ENV_KEYS = [
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'CURRENT_ENV',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED',
  'SAMSAR_AVAILABLE_MODELS_PATH',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
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
    ['gpt-6-astra'],
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

  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.ALIBABA_API_KEY = 'test-alibaba-key';
  const nativeAlibabaProduction = invokeSupportedModels();
  const qwenImageModel = nativeAlibabaProduction.body.IMAGE_MODELS.find(
    (model) => model.value === 'QWENIMAGE3PRO',
  );
  assert.equal(qwenImageModel?.basePrice, 46);
  assert.equal(
    nativeAlibabaProduction.body.text_to_video.image_models.some(
      (model) => model.value === 'QWENIMAGE3PRO',
    ),
    true,
  );
  assert.equal(
    nativeAlibabaProduction.body.image_list_to_video.image_models.some(
      (model) => model.value === 'QWENIMAGE3PRO',
    ),
    true,
  );

  delete process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED;
  delete process.env.ALIBABA_API_KEY;
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  const standalone = invokeSupportedModels();
  assert.equal(standalone.statusCode, 200);
  assert.equal(standalone.body.deployment.edition, 'standalone');
  assert.deepEqual(standalone.body.INFERENCE_MODELS, []);
  assert.deepEqual(standalone.body.IMAGE_MODELS, []);
  assert.deepEqual(standalone.body.VIDEO_MODELS, []);
});

test('hosted supported models expose both Seedance routes from the GMICloud catalog', (t) => {
  const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-hosted-seedance-catalog-'));
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = path.join(directory, 'genblaze-model-catalog.json');
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = path.join(directory, 'available-models.json');
  fs.writeFileSync(process.env.SAMSAR_AVAILABLE_MODELS_PATH, JSON.stringify({
    providers: [], models: ['RUNWAYML'], actions: ['video'],
  }));
  fs.writeFileSync(process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH, JSON.stringify({
    provider: 'gmicloud',
    models: {
      'SEEDANCE2.0I2V': { video: { modelId: 'seedance-2-0-260128', operation: 'video.generate' } },
      'SEEDANCE2.5I2V': { video: { modelId: 'seedance-2-5-260628', operation: 'video.generate' } },
    },
  }));

  const response = invokeSupportedModels();
  assert.equal(response.statusCode, 200);
  for (const model of ['SEEDANCE2.0I2V', 'SEEDANCE2.5I2V']) {
    assert.equal(response.body.text_to_video.video_models.some((item) => item.value === model), true);
    assert.equal(response.body.image_list_to_video.video_models.some((item) => item.value === model), true);
    assert.equal(response.body.deployment.modelProviders[model], 'gmicloud');
  }
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
    ['gpt-6-astra'],
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
