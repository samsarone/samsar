import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import User from '../schema/User.js';
import { SYSTEM_CREATE_DEFAULTS, resolveCreateDefaults } from '../consts/CreateDefaults.js';
import { formatPublicUserProfile, formatUserClientProfile } from './User.js';
import { getCreateDefaultModelValues, validateCreateDefaults } from './CreateDefaults.js';
import videoRouter from '../routes/api/video.js';

const available = {
  inferenceModel: ['claude-opus-5.5', 'gpt-6.2-astra', 'gemini-4-neon'],
  imageModel: ['GPTIMAGE2.5', 'SEEDREAM'],
  videoModel: ['KLINGIMGTOVID4', 'RUNWAYML'],
};

test('unsaved Create defaults inherit legacy model preferences without mutating the user', () => {
  assert.deepEqual(resolveCreateDefaults(), SYSTEM_CREATE_DEFAULTS);
  const user = { selectedInferenceModel: 'gpt-6.2-astra-xhigh', agentImageModel: 'GPTIMAGE2', agentVideoModel: 'KLINGIMGTOVID3PRO' };
  const before = structuredClone(user);
  assert.deepEqual(resolveCreateDefaults(user), { ...SYSTEM_CREATE_DEFAULTS, inferenceModel: 'gpt-6.2-astra', inferenceEffort: 'xhigh' });
  assert.deepEqual(user, before);
  const hydrated = User.hydrate({ selectedInferenceModel: 'gpt-6.2-astra-xhigh' });
  assert.equal(resolveCreateDefaults(hydrated).inferenceEffort, 'xhigh');
});

test('schema serializes Create defaults independently from other generation preferences', async () => {
  const user = new User({ selectedInferenceModel: 'gemini-4-neon', createDefaults: { ...SYSTEM_CREATE_DEFAULTS, duration: 90 } });
  await user.validate();
  assert.deepEqual(user.toObject().createDefaults, { ...SYSTEM_CREATE_DEFAULTS, duration: 90 });
  assert.equal(new User().createDefaults, undefined);
  assert.equal(resolveCreateDefaults(user).inferenceModel, SYSTEM_CREATE_DEFAULTS.inferenceModel);
  assert.equal(formatUserClientProfile(user).createDefaults.duration, 90);
  assert.equal(formatPublicUserProfile(user).createDefaults, undefined);
});

test('profile bootstrap exposes resolved defaults for legacy accounts without persisting them', () => {
  const user = User.hydrate({ selectedInferenceModel: 'gemini-4-neon', agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML' });
  assert.deepEqual(formatUserClientProfile(user).createDefaults, {
    ...SYSTEM_CREATE_DEFAULTS, inferenceModel: 'gemini-4-neon', imageModel: 'SEEDREAM', videoModel: 'RUNWAYML',
  });
  assert.equal(user.createDefaults, undefined);
  assert.equal(user.isModified(), false);
});

test('partial saves keep the other dedicated defaults and normalize supported model aliases', () => {
  const user = { createDefaults: { ...SYSTEM_CREATE_DEFAULTS, duration: 120, enableSubtitles: true } };
  assert.deepEqual(validateCreateDefaults({ inferenceModel: 'gpt-6.2-astra-xhigh', imageModel: 'GPTIMAGE2.6', videoModel: 'RUNWAYML' }, user, available), {
    ...SYSTEM_CREATE_DEFAULTS, inferenceModel: 'gpt-6.2-astra', inferenceEffort: 'xhigh', videoModel: 'RUNWAYML', duration: 120, enableSubtitles: true,
  });
});

test('invalid and unavailable Create defaults fail before touching input state', () => {
  const user = { createDefaults: { ...SYSTEM_CREATE_DEFAULTS } };
  for (const payload of [
    null, [], 'invalid', { arbitraryField: true },
    { inferenceModel: 'invented-model' }, { inferenceModel: 'QWEN3.8' },
    { imageModel: 'DALLE3' }, { videoModel: 'VEO3.1I2V' }, { imageModel: null },
    { inferenceEffort: 'low' }, { duration: 20 }, { duration: '30' },
    { aspectRatio: '4:3' }, { aspectRatio: '1:1', videoModel: 'RUNWAYML' }, { enableSubtitles: 'false' },
  ]) {
    assert.throws(() => validateCreateDefaults(payload, user, available), (error) => error.status === 400);
    assert.deepEqual(user.createDefaults, SYSTEM_CREATE_DEFAULTS);
  }
});

test('Create model validation follows the public text-to-video catalog in hosted and standalone editions', (t) => {
  const keys = ['SAMSAR_DEPLOYMENT_EDITION', 'SAMSAR_AVAILABLE_MODELS_PATH'];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-create-defaults-'));
  t.after(() => {
    for (const key of keys) old[key] === undefined ? delete process.env[key] : (process.env[key] = old[key]);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  process.env.SAMSAR_AVAILABLE_MODELS_PATH = path.join(directory, 'available.json');
  fs.writeFileSync(process.env.SAMSAR_AVAILABLE_MODELS_PATH, JSON.stringify({ models: ['claude-opus-5.5', 'GPTIMAGE2.5', 'KLINGIMGTOVID4'] }));
  const handler = videoRouter.stack.find((layer) => layer.route?.path === '/supported_models').route.stack[0].handle;
  for (const edition of ['production', 'standalone']) {
    process.env.SAMSAR_DEPLOYMENT_EDITION = edition;
    let catalog;
    handler({}, { status() { return this; }, json(value) { catalog = value.text_to_video; } });
    assert.deepEqual(getCreateDefaultModelValues(), {
      inferenceModel: catalog.inference_models.map((option) => option.value),
      imageModel: catalog.image_models.map((option) => option.value),
      videoModel: catalog.video_models.map((option) => option.value),
    });
  }
});
