import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import { IMAGE_GENERAITON_MODEL_TYPES } from './ModelTypes.js';
import { IMAGE_MODEL_PRICES } from './ModelPrices.js';
import { INFERENCE_MODEL_OPTIONS } from './InferenceModels.js';
import { BRANCHED_INFERENCE_MODEL_OPTIONS, BRANCHED_VIDEO_MODEL_KEYS, isBranchedImageModel } from './BranchedModelOptions.js';
import { TEXT_TO_VIDEO_IMAGE_MODEL_KEYS, TEXT_TO_VIDEO_VIDEO_MODEL_KEYS, IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS } from './ExpressVideoModelOptions.js';
import { getDockerImageProviderPriority, resolveDockerImageProvider } from './DockerProviderPriority.js';
import { KLING_IMAGE_V4_APP_ASPECT_RATIOS, KLING_IMAGE_V4_ASPECT_RATIOS, KLING_IMAGE_V4_RESOLUTIONS, KLING_IMAGE_V4_STUDIO_CREDITS } from './KlingImageModel.js';
import { generateTextToImage, normalizeTextToImageRequestOptions } from '../models/api/ImageAPI.js';
import { addImageGeneratorRequest } from '../models/Images.js';
import { validateMovieInput } from '../models/api/PromptUtils.js';
import { requestCreateMovie, requestCreateNarrative, requestCreateVideo, requestCreateVideoFromImageListAndMetadata } from '../models/api/MovieAPI.js';
import { requestStepTextToVideo, requestStepImageToVideo } from '../models/api/StepVideoAPI.js';
import { normalizeTextToInteractiveVideoPayload } from '../models/api/TextToInteractiveVideoAPI.js';
import { buildAvailableDeploymentModels } from '../models/api/DeploymentProviderAPI.js';
import { mergeRuntimeInferenceDeploymentAvailability } from '../models/api/DeploymentModelConfig.js';
import { buildModelAdapterSettings } from '../models/api/ModelAdapterPreferences.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import GlobalSession from '../schema/GlobalSession.js';
import User from '../schema/User.js';
import VideoSession from '../schema/VideoSession.js';
import Builder from '../schema/ExpressGenerationBuilderRequest.js';

const MODEL = 'KLINGIMAGE4';
const ENV_KEYS = ['CURRENT_ENV', 'SAMSAR_DEPLOYMENT_EDITION', 'SAMSAR_EDITION', 'SAMSAR_RUNTIME',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED', 'FAL_API_KEY', 'SAMSAR_API_KEY', 'ALIBABA_API_KEY',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH', 'SAMSAR_GENBLAZE_ENABLED'];

function isolateEnv(t, edition = 'production') {
  const original = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  ENV_KEYS.forEach(key => delete process.env[key]);
  process.env.SAMSAR_DEPLOYMENT_EDITION = edition;
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

function mockImageQueue(t) {
  const readyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => { mongoose.connection.readyState = readyState; });
  const documents = [];
  t.mock.method(ImageGeneration.prototype, 'save', async function () {
    documents.push(this.toObject());
    return this;
  });
  t.mock.method(GlobalSession, 'findOneAndUpdate', async () => ({}));
  return documents;
}

test('Kling Image 4 is additive across the agent inference/video matrix, including branched flows', () => {
  assert.equal(IMAGE_GENERAITON_MODEL_TYPES.find(model => model.key === MODEL).isExpressModel, true);
  assert.equal(isBranchedImageModel(MODEL), true);
  for (const keys of [TEXT_TO_VIDEO_IMAGE_MODEL_KEYS, IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS]) {
    assert.equal(keys.includes(MODEL), true);
    assert.equal(keys.includes('GPTIMAGE2.5'), true);
    assert.equal(keys.includes('SEEDREAM'), true);
  }
  for (const inference of INFERENCE_MODEL_OPTIONS) {
    for (const video of TEXT_TO_VIDEO_VIDEO_MODEL_KEYS) {
      const result = validateMovieInput({ prompt: 'A lighthouse at dawn.', duration: 30,
        inference_model: inference.value, image_model: MODEL, video_model: video });
      assert.equal(result.status, true, `${inference.value}/${video}: ${result.message}`);
    }
  }
  for (const inference of BRANCHED_INFERENCE_MODEL_OPTIONS) {
    for (const video of BRANCHED_VIDEO_MODEL_KEYS) {
      const normalized = normalizeTextToInteractiveVideoPayload({ prompt: 'A branching river journey.',
        duration: 40, num_levels: 2, inference_model: inference.value, image_model: MODEL, video_model: video });
      assert.equal(normalized.imageModel, MODEL);
      assert.equal(normalized.videoModel, video);
    }
  }
});

test('agent preflight rejects unsupported Kling canvas ratios and accepts video ratios or the landscape default', () => {
  const payload = { prompt: 'A lighthouse at dawn.', duration: 30, image_model: MODEL, video_model: 'RUNWAYML' };
  for (const field of ['aspect_ratio', 'aspectRatio']) {
    for (const aspectRatio of ['1:1', '4:3', 'auto', 'invalid']) {
      const result = validateMovieInput({ ...payload, [field]: aspectRatio });
      assert.equal(result.status, false);
      assert.match(result.message, /720p aspect_ratio/);
    }
    for (const aspectRatio of ['16:9', '9:16']) {
      assert.equal(validateMovieInput({ ...payload, [field]: aspectRatio }).status, true);
    }
  }
  assert.equal(validateMovieInput(payload).status, true);
  assert.equal(validateMovieInput({ ...payload, image_model: 'SEEDREAM', aspect_ratio: '1:1' }).status, true);
});

test('direct MovieAPI and Vidgenie step admission reject invalid Kling canvases before DB, billing or queue work', async t => {
  const unexpected = () => { throw new Error('Invalid request must not reach admission'); };
  const connect = t.mock.method(mongoose, 'connect', unexpected);
  const owner = t.mock.method(User, 'findById', unexpected);
  const session = t.mock.method(VideoSession, 'findOne', unexpected);
  const builder = t.mock.method(Builder, 'findOneAndUpdate', unexpected);
  const image = t.mock.method(ImageGeneration.prototype, 'save', unexpected);
  for (const imageModelField of ['image_model', 'imageModel']) {
    for (const ratioField of ['aspect_ratio', 'aspectRatio']) {
      const payload = { prompt: 'A lighthouse.', duration: 30, [imageModelField]: MODEL,
        video_model: 'RUNWAYML', [ratioField]: '1:1' };
      for (const request of [requestCreateMovie, requestCreateNarrative, requestCreateVideo, requestCreateVideoFromImageListAndMetadata]) {
        await assert.rejects(request('507f1f77bcf86cd799439011', payload), error => error.status === 400 && /720p aspect_ratio/.test(error.message));
      }
      for (const request of [requestStepTextToVideo, requestStepImageToVideo]) {
        await assert.rejects(request({ userId: '507f1f77bcf86cd799439011', payload }),
          error => error.status === 400 && /720p aspect_ratio/.test(error.message));
      }
    }
  }
  for (const operation of [connect, owner, session, builder, image]) assert.equal(operation.mock.callCount(), 0);
});

test('Studio advertises Kling Image 4 at 720p landscape and portrait with 20 percent markup', () => {
  assert.equal(KLING_IMAGE_V4_STUDIO_CREDITS, 7.56);
  const entry = IMAGE_MODEL_PRICES.find(model => model.key === MODEL);
  assert.equal(entry.isBranchedImageModel, true);
  assert.deepEqual(entry.prices, KLING_IMAGE_V4_APP_ASPECT_RATIOS.map(aspectRatio => ({ aspectRatio, price: 7.56 })));
  const definition = IMAGE_GENERAITON_MODEL_TYPES.find(model => model.key === MODEL);
  assert.deepEqual(definition.supportedAspectRatios, ['16:9', '9:16']);
  assert.deepEqual(definition.resolutions, ['720p']);
});

test('direct API accepts explicit 720p delivery only in video canvas aspect ratios', () => {
  assert.deepEqual(normalizeTextToImageRequestOptions({ model: MODEL, resolution: '720p' }), {
    model: MODEL, aspectRatio: '16:9', resolution: '720p',
  });
  for (const aspectRatio of KLING_IMAGE_V4_APP_ASPECT_RATIOS) {
    assert.deepEqual(normalizeTextToImageRequestOptions({ model: MODEL, resolution: '720P', aspect_ratio: aspectRatio }), {
      model: MODEL, aspectRatio, resolution: '720p',
    });
  }
  for (const aspectRatio of ['1:1', '4:3', '3:4', '3:2', '2:3', '21:9', 'auto']) {
    assert.throws(() => normalizeTextToImageRequestOptions({ model: MODEL, resolution: '720p', aspect_ratio: aspectRatio }),
      error => error.status === 400 && /720p aspect_ratio/.test(error.message));
  }
});

test('direct API preserves all documented Kling ratios and resolutions and defaults to 2K', () => {
  assert.deepEqual(normalizeTextToImageRequestOptions({ model: ' klingimage4 ' }), {
    model: MODEL, aspectRatio: '1:1', resolution: '2K',
  });
  for (const aspectRatio of [...KLING_IMAGE_V4_ASPECT_RATIOS, 'auto']) {
    for (const resolution of KLING_IMAGE_V4_RESOLUTIONS) {
      assert.deepEqual(normalizeTextToImageRequestOptions({ mode: MODEL, aspect_ratio: aspectRatio,
        resolution: resolution.toLowerCase() }), { model: MODEL, aspectRatio, resolution });
    }
  }
});

test('out-of-contract Kling requests are rejected before billing or queue persistence', async t => {
  isolateEnv(t);
  const persisted = t.mock.method(ImageGeneration.prototype, 'save', async () => { throw new Error('Must not enqueue'); });
  for (const invalid of [{ resolution: '1K' }, { resolution: '16K' }, { aspect_ratio: '5:4' },
    { aspect_ratio: 1.5 }, { resolution: '720p', aspect_ratio: '1:1' },
    { num_images: 2 }, { numImages: 1.5 }, { prompt: 'a'.repeat(50001) }]) {
    await assert.rejects(generateTextToImage({ userId: '507f1f77bcf86cd799439011',
      prompt: 'A lighthouse.', model: MODEL, ...invalid }), error => error.status === 400);
  }
  assert.equal(persisted.mock.callCount(), 0);
});

test('API queues Kling selections, resolution and one output with completion billing', async t => {
  isolateEnv(t, 'standalone');
  const documents = mockImageQueue(t);
  const response = await generateTextToImage({ userId: '507f1f77bcf86cd799439011', prompt: ' A lighthouse. ',
    model: MODEL, aspect_ratio: '21:9', resolution: '8K', num_images: 1 });
  assert.equal(documents.length, 1);
  assert.equal(documents[0].model, MODEL);
  assert.equal(documents[0].aspectRatio, '21:9');
  assert.equal(documents[0].resolution, '8K');
  assert.equal(documents[0].numImages, 1);
  assert.equal(documents[0].imageBillingPolicy, 'adapter');
  assert.equal(response.resolution, '8K');
  assert.equal(response.creditsCharged, 0);
});

test('Studio and agent queues persist explicit 720p for landscape and portrait', async t => {
  isolateEnv(t, 'standalone');
  const documents = mockImageQueue(t);
  for (const aspectRatio of KLING_IMAGE_V4_APP_ASPECT_RATIOS) {
    for (const appResolution of [undefined, '720p', '1K', '2K', '4K', '8K']) {
      const request = { model: MODEL, prompt: 'A lighthouse.', aspectRatio, resolution: appResolution };
      await addImageGeneratorRequest('507f1f77bcf86cd799439011', request);
      await addImageGeneratorRequest('507f1f77bcf86cd799439011', request, false);
      assert.deepEqual(documents.slice(-2).map(doc => [doc.model, doc.aspectRatio, doc.resolution, doc.imageBillingPolicy]), [
        [MODEL, aspectRatio, '720p', 'adapter'], [MODEL, aspectRatio, '720p', 'pipeline'],
      ]);
    }
  }
  await addImageGeneratorRequest('507f1f77bcf86cd799439011', { model: MODEL, prompt: 'A lighthouse.' });
  assert.equal(documents.at(-1).aspectRatio, '16:9');
  assert.equal(documents.at(-1).resolution, '720p');
});

test('Studio and agent reject unsupported Kling canvas ratios before enqueuing', async t => {
  isolateEnv(t);
  const persisted = t.mock.method(ImageGeneration.prototype, 'save', async () => { throw new Error('Must not enqueue'); });
  for (const aspectRatio of ['1:1', '4:3', '3:4', 'auto', 'invalid']) {
    await assert.rejects(addImageGeneratorRequest('507f1f77bcf86cd799439011', {
      model: MODEL, prompt: 'A lighthouse.', aspectRatio,
    }), error => error.status === 400 && /720p aspect_ratio/.test(error.message));
  }
  assert.equal(persisted.mock.callCount(), 0);
});

test('API 720p jobs preserve landscape and portrait delivery requests for the Samsar adapter', async t => {
  isolateEnv(t, 'standalone');
  const documents = mockImageQueue(t);
  for (const aspectRatio of KLING_IMAGE_V4_APP_ASPECT_RATIOS) {
    const response = await generateTextToImage({ userId: '507f1f77bcf86cd799439011', prompt: 'A lighthouse.',
      model: MODEL, aspect_ratio: aspectRatio, resolution: '720p' });
    assert.equal(response.resolution, '720p');
    assert.equal(documents.at(-1).aspectRatio, aspectRatio);
    assert.equal(documents.at(-1).resolution, '720p');
    assert.equal(documents.at(-1).metadata.resolution, '720p');
  }
});

test('Fal and Samsar credentials expose Kling in runtime availability and adapter settings', t => {
  isolateEnv(t, 'standalone');
  assert.deepEqual(getDockerImageProviderPriority(MODEL), ['fal', 'samsar']);
  assert.equal(resolveDockerImageProvider(MODEL), '');
  assert.equal(mergeRuntimeInferenceDeploymentAvailability({}).models.includes(MODEL), false);
  for (const [key, provider] of [['FAL_API_KEY', 'fal'], ['SAMSAR_API_KEY', 'samsar']]) {
    process.env[key] = 'test-key';
    assert.equal(resolveDockerImageProvider(MODEL), provider);
    const available = mergeRuntimeInferenceDeploymentAvailability({});
    assert.equal(available.models.includes(MODEL), true);
    assert.deepEqual(available.modelProviderPriority[MODEL], [provider]);
    const settings = buildModelAdapterSettings(available, { modelProviderPriority: {} });
    const model = settings.stages.find(stage => stage.key === 'text_to_image').models.find(model => model.modelKey === MODEL);
    assert.equal(model.label, 'Kling Image 4');
    assert.deepEqual(model.availableAdapters.map(adapter => adapter.key), [provider]);
    assert.equal(buildAvailableDeploymentModels({ [provider]: { ok: true } }).models.includes(MODEL), true);
    delete process.env[key];
  }
});
