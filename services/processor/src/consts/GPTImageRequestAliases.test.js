import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeGPTImageRequestModelKey, getRetiredGPTImageModelError } from './GPTImageModelKeys.js';
import { normalizeTextToImageRequestOptions } from '../models/api/ImageAPI.js';
import { validateExpressImageModelKey, validateMovieInput } from '../models/api/PromptUtils.js';
import { resolveNarrativeToVideoModels } from '../models/api/NarrativeToVideoAPI.js';
import { addImageGeneratorRequest, addImageEditRequest } from '../models/Images.js';
import ImageGeneration from '../schema/ImageGeneration.js';

const generationKeys = ['GPTIMAGE2.5', 'GPTIMAGE2.6', ' gptimage2.6 '];
const editKeys = ['GPTIMAGE2.5EDIT', 'GPTIMAGE2.6EDIT', ' gptimage2.6edit '];

test('2.5 and 2.6 generation requests share validation, Express and narrative routes', () => {
  for (const key of generationKeys) {
    assert.equal(getRetiredGPTImageModelError(key), null);
    for (const field of ['model', 'mode']) {
      assert.equal(normalizeTextToImageRequestOptions({ [field]: key }).model, 'GPTIMAGE2.5');
    }
    assert.deepEqual(validateExpressImageModelKey(key), { status: true, imageModel: 'GPTIMAGE2.5' });
    assert.equal(validateMovieInput({ prompt: 'A landscape', image_model: key, video_model: 'RUNWAYML', duration: 30 }).status, true);
    assert.equal(resolveNarrativeToVideoModels({ requestedImageModel: key }).imageModel, 'GPTIMAGE2.5');
    assert.equal(resolveNarrativeToVideoModels({ requestedImageModel: key, branched: true }).imageModel, 'GPTIMAGE2.5');
  }
  for (const key of editKeys) {
    assert.equal(normalizeGPTImageRequestModelKey(key), 'GPTIMAGE2.5EDIT');
    assert.equal(getRetiredGPTImageModelError(key), null);
    assert.throws(() => normalizeTextToImageRequestOptions({ model: key }), /model must be one of/);
    assert.equal(validateExpressImageModelKey(key).status, false);
  }
  for (const key of ['GPTIMAGE2', 'GPTIMAGE2EDIT']) {
    assert.match(getRetiredGPTImageModelError(key), /^Invalid model:/);
  }
});

test('generation and edit queue boundaries persist both versions under the existing routing keys', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'samsar-image-alias-'));
  const envKeys = ['SAMSAR_DEPLOYMENT_EDITION', 'SAMSAR_ASSETS_V2_ROOT'];
  const env = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_ASSETS_V2_ROOT = directory;
  const readyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
  t.after(() => {
    if (readyState) Object.defineProperty(mongoose.connection, 'readyState', readyState);
    else delete mongoose.connection.readyState;
    for (const key of envKeys) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const saved = [];
  t.mock.method(ImageGeneration.prototype, 'save', async function () { saved.push(this.toObject()); return this; });
  const userId = new mongoose.Types.ObjectId().toString();
  for (const model of generationKeys) {
    const job = await addImageGeneratorRequest(userId, { model, prompt: 'A landscape', aspectRatio: '16:9' });
    assert.equal(job.model, 'GPTIMAGE2.5');
    assert.equal(job.operationType, 'GENERATE');
  }
  for (const model of editKeys) {
    const job = await addImageEditRequest(userId, { model, image: 'https://example.test/input.png', prompt: 'A blue sky', aspectRatio: '16:9' });
    assert.equal(job.model, 'GPTIMAGE2.5EDIT');
    assert.equal(job.operationType, 'EDIT');
  }
  assert.equal(saved.length, generationKeys.length + editKeys.length);
});
