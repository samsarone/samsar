import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VIDEO_GENERATION_MODEL_TYPES, IMAGE_GENERAITON_MODEL_TYPES } from '../../consts/ModelTypes.js';
import { VIDEO_MODEL_PRICES, getVideoModelDurationUnitsForFramesPerSecond } from '../../consts/ModelPrices.js';
import { TEXT_TO_VIDEO_VIDEO_MODEL_KEYS, IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS } from '../../consts/ExpressVideoModelOptions.js';
import { normalizeImageListToVideoModel, getImageListToVideoCreditsPerSecond } from '../../consts/ImageListToVideoModels.js';
import { getExpressVideoCreditsPerSecondForRateClass } from '../../consts/pricing/ExpressVideoPricingDistribution.js';
import { getDockerVideoProviderPriority, getDockerImageProviderPriority, resolveDockerVideoProvider, hasGmiCloudSeedanceVideoRoute } from '../../consts/DockerProviderPriority.js';
import { getSpeechDurationStringForModel } from '../movie_session/utils/ModelUtils.js';
import { estimateExpressVideoCreditsForPreflight } from '../ExpressVideoStageBilling.js';
import { getInitialGenericVideoAdapter, resolveGenericVideoAudioContext } from '../ai_video/GenericVideoAdapter.js';
import { buildDirectExternalI2VGenerationDocument } from '../ai_video/DirectExternalI2V.js';
import { buildDirectExternalImageToVideoIdentity, buildDirectExternalImageToVideoSession } from './ExternalVideoAPI.js';
import { buildAvailableDeploymentModels } from './DeploymentProviderAPI.js';
import { mergeRuntimeInferenceDeploymentAvailability } from './DeploymentModelConfig.js';
import { buildModelAdapterSettings } from './ModelAdapterPreferences.js';
import { validateMovieInput } from './PromptUtils.js';
import { normalizeSeedanceFlashVideoOptions } from '../../utils/SeedanceFlash.js';

const FLASH = 'SEEDANCE2.5FLASHI2V';
const ENV_KEYS = ['CURRENT_ENV', 'SAMSAR_DEPLOYMENT_EDITION', 'SAMSAR_EDITION', 'SAMSAR_RUNTIME',
  'SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED', 'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  'SAMSAR_GENBLAZE_ENABLED', 'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH', 'FAL_API_KEY', 'SAMSAR_API_KEY',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'KIMI_K3_API_KEY',
  'ALIBABA_API_KEY', 'ALIBABA_CLOUD_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64', 'GOOGLE_APPLICATION_CREDENTIALS_JSON', 'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT', 'GOOGLE_PROJECT_ID', 'GCP_PROJECT', 'GCLOUD_PROJECT', 'PROJECT_ID'];
const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
test.beforeEach(() => { ENV_KEYS.forEach(key => delete process.env[key]); });
test.afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function oldGmiCatalog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-media-versions-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = path.join(directory, 'catalog.json');
  fs.writeFileSync(process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH, JSON.stringify({
    provider: 'gmicloud', models: {
      SEEDREAM: { image: { modelId: 'seedream-5-0-260128', operation: 'image.generate' } },
      [FLASH]: { video: { modelId: 'seedance-2-5-260628', operation: 'video.generate' } },
      'SEEDANCE2.5I2V': { video: { modelId: 'seedance-2-5-260628', operation: 'video.generate' } },
    },
  }));
}

test('Flash is registered for supported pipelines, clips and speech planning without replacing standard 2.5', () => {
  assert.equal(IMAGE_GENERAITON_MODEL_TYPES.find(model => model.key === 'SEEDREAM').name, 'Seedream 5.5');
  assert.equal(VIDEO_GENERATION_MODEL_TYPES.find(model => model.key === FLASH).isExpressModel, true);
  assert.equal(VIDEO_MODEL_PRICES.find(model => model.key === FLASH).name, 'Seedance 2.5 Flash I2V');
  assert.equal(TEXT_TO_VIDEO_VIDEO_MODEL_KEYS.includes(FLASH), true);
  assert.equal(IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS.includes(FLASH), true);
  assert.equal(normalizeImageListToVideoModel(FLASH), FLASH);
  assert.equal(validateMovieInput({ prompt: 'A lighthouse', image_model: 'SEEDREAM', video_model: FLASH, duration: 30 }).status, true);
  assert.deepEqual(getVideoModelDurationUnitsForFramesPerSecond(FLASH, 24), Array.from({ length: 27 }, (_, i) => i + 4));
  assert.deepEqual(getVideoModelDurationUnitsForFramesPerSecond('SEEDANCE2.5I2V', 24), [5, 10, 15, 20]);
  assert.match(getSpeechDurationStringForModel(FLASH, 'English'), /30-second scene/);
});

test('Flash retains existing Seedance-family Studio and Agent workflow quotes', () => {
  assert.equal(getImageListToVideoCreditsPerSecond(FLASH), 50);
  for (const [rateClass, rate] of [['studio', 50], ['agent', 60], ['vidgenie', 60]]) {
    assert.equal(getExpressVideoCreditsPerSecondForRateClass(FLASH, rateClass), rate);
    const estimate = estimateExpressVideoCreditsForPreflight({
      durationSeconds: 30, videoModel: FLASH, imageModel: 'GPTIMAGE2.5',
      expressGenerationType: 'TEXT_TO_VIDEO', pricingRateClass: rateClass,
    });
    assert.equal(estimate.totalCredits, 30 * rate);
  }
});

test('latest media cannot be advertised through old GMI mappings alone', t => {
  oldGmiCatalog(t);
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['gmicloud'], models: ['SEEDREAM', FLASH, 'SEEDANCE2.5I2V'],
    actions: ['image', 'video'], modelProviders: { SEEDREAM: 'gmicloud', [FLASH]: 'gmicloud', 'SEEDANCE2.5I2V': 'gmicloud' },
    modelProviderPriority: { SEEDREAM: ['gmicloud'], [FLASH]: ['gmicloud'], 'SEEDANCE2.5I2V': ['gmicloud'] },
  });
  assert.equal(result.models.includes('SEEDREAM'), false);
  assert.equal(result.models.includes(FLASH), false);
  assert.equal(result.models.includes('SEEDANCE2.5I2V'), true);
  assert.equal(hasGmiCloudSeedanceVideoRoute(FLASH), false);
  assert.equal(hasGmiCloudSeedanceVideoRoute('SEEDANCE2.5I2V'), true);
});

test('live Fal credentials recover latest media from stale GMI selections and remove GMI from settings', t => {
  oldGmiCatalog(t);
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.FAL_API_KEY = 'test-fal-key';
  const result = mergeRuntimeInferenceDeploymentAvailability({
    providers: ['gmicloud', 'fal'], models: ['SEEDREAM', FLASH],
    modelProviders: { SEEDREAM: 'gmicloud', [FLASH]: 'gmicloud' },
    modelProviderPriority: { SEEDREAM: ['gmicloud', 'fal'], [FLASH]: ['gmicloud', 'fal'] },
  });
  for (const key of ['SEEDREAM', FLASH]) {
    assert.equal(result.models.includes(key), true);
    assert.equal(result.modelProviders[key], 'fal');
    assert.deepEqual(result.modelProviderPriority[key], ['fal']);
  }
  const settings = buildModelAdapterSettings(result, { modelProviderPriority: {} });
  assert.equal(settings.stages.find(stage => stage.key === 'text_to_image').models.find(model => model.modelKey === 'SEEDREAM').label, 'Seedream 5.5');
  const flash = settings.stages.find(stage => stage.key === 'image_to_video').models.find(model => model.modelKey === FLASH);
  assert.deepEqual(flash.availableAdapters.map(adapter => adapter.key), ['fal']);
});

test('Flash uses verified Fal or Samsar while production standard 2.5 retains its GMI pin', t => {
  oldGmiCatalog(t);
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED = 'true';
  process.env.FAL_API_KEY = 'test-fal-key';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  assert.deepEqual(getDockerVideoProviderPriority(FLASH), ['fal', 'samsar']);
  assert.deepEqual(getDockerImageProviderPriority('SEEDREAM'), ['fal', 'samsar']);
  assert.equal(resolveDockerVideoProvider(FLASH), 'fal');
  assert.deepEqual(getDockerVideoProviderPriority('SEEDANCE2.5I2V'), ['gmicloud']);
  assert.equal(getInitialGenericVideoAdapter(FLASH, process.env), 'fal');
  const capabilities = buildAvailableDeploymentModels({ fal: { ok: true, status: 'valid' } });
  assert.equal(capabilities.models.includes(FLASH), true);
  assert.equal(capabilities.models.includes('SEEDREAM'), true);
});

test('Flash native sound effects follow the scene type and preserve explicit audio requests', () => {
  assert.equal(resolveGenericVideoAudioContext({ model: FLASH }, { layerAiVideoType: 'narration' }).generateAudio, false);
  assert.equal(resolveGenericVideoAudioContext({ model: FLASH, generateAudio: true }, { layerAiVideoType: 'ai_video' }).generateAudio, true);
  assert.equal(resolveGenericVideoAudioContext({ model: FLASH }, { layerAiVideoType: 'sound_effect' }).generateAudio, true);
});

test('Flash direct I2V preserves documented options, native audio and ending frame through the queue', () => {
  const options = { duration: 30, resolution: '480p', bitrate_mode: 'high', codec: 'H265', end_image_url: 'https://media.example/end.png' };
  const identity = buildDirectExternalImageToVideoIdentity('64b000000000000000000004', 'flash-direct');
  const session = buildDirectExternalImageToVideoSession({
    userId: '64b000000000000000000004', identity, startImage: 'https://media.example/start.png',
    payload: { video_model: FLASH, ...options, generate_audio: true },
  });
  assert.equal(session.layers[0].duration, 30);
  assert.equal(session.layers[0].isAudioVideoLayer, true);
  const document = buildDirectExternalI2VGenerationDocument({
    model: FLASH, ...options, generate_audio: true,
    generationRequestId: identity.generationRequestId.toString(), videoSessionId: identity.sessionId.toString(),
    currentLayerId: identity.layerId.toString(), startImage: 'https://media.example/start.png',
  });
  assert.equal(document.model, FLASH);
  assert.equal(document.duration, 30);
  assert.equal(document.endImage, options.end_image_url);
  assert.equal(document.useEndFrame, true);
  assert.equal(document.resolution, '480p');
  assert.equal(document.bitrate_mode, 'high');
  assert.equal(document.codec, 'H265');
  assert.equal(document.generateAudio, true);
});

test('Flash rejects out-of-contract options rather than silently rendering a different request', () => {
  for (const payload of [{ duration: 3 }, { duration: 31 }, { duration: 4.5 }, { duration: 'auto' },
    { resolution: '1080p' }, { bitrate_mode: 'low' }, { codec: 'vp9' }, { endImage: 'http://127.0.0.1/end.png' }]) {
    assert.throws(() => normalizeSeedanceFlashVideoOptions(payload), error => error.status === 400 && error.code === 'SEEDANCE_FLASH_INVALID_INPUT');
  }
});
