import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import router from './publications.js';
import { Publication } from '../schema/Publication.js';
import { getPublicationsMediaConfig } from '../models/AWS.js';

test('publication feed and detail preserve the saved generation model snapshot without reading session defaults', async (t) => {
  const previousState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => { mongoose.connection.readyState = previousState; });
  // The gallery worker is unrelated to response serialization.
  t.mock.timers.enable({ apis: ['setImmediate'] });

  const generationModels = {
    version: 1,
    source: 'session',
    image: ['historical-image-model'],
    video: ['first-video-model', 'second-video-model'],
    inference: ['historical-inference-model'],
    evidence: { image: 'generated-asset', video: 'generated-asset', inference: 'session' },
    missing: [],
  };
  const publication = {
    _id: new mongoose.Types.ObjectId(),
    videoURL: `${getPublicationsMediaConfig().cdnUrl}/published/test/video.mp4`,
    aspectRatio: '16:9',
    imageModel: generationModels.image[0],
    videoModel: generationModels.video[0],
    inferenceModel: generationModels.inference[0],
    generationModels,
  };
  const query = {
    sort() { return this; }, limit() { return this; }, lean() { return this; },
    exec: async () => [publication],
  };
  t.mock.method(Publication, 'countDocuments', () => ({ exec: async () => 1 }));
  t.mock.method(Publication, 'find', () => query);
  t.mock.method(Publication, 'findOne', () => ({
    lean() { return this; }, exec: async () => publication,
  }));

  for (const routePath of ['/', '/:publicationId']) {
    const handler = router.stack.find((layer) => (
      layer.route?.path === routePath && layer.route.methods.get
    )).route.stack[0].handle;
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      json(data) { this.data = data; return this; },
    };
    await handler({
      query: {}, headers: {}, params: { publicationId: publication._id.toString() },
    }, res);
    assert.equal(res.code, 200);
    const result = routePath === '/' ? res.data.items[0] : res.data.publication;
    assert.equal(result.imageModel, 'historical-image-model');
    assert.equal(result.videoModel, 'first-video-model');
    assert.equal(result.inferenceModel, 'historical-inference-model');
    assert.deepEqual(result.generationModels, generationModels);
  }
});

test('the feed combines selected generation models and language before counting and paginating', async (t) => {
  const previousState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => { mongoose.connection.readyState = previousState; });
  const count = t.mock.method(Publication, 'countDocuments', () => ({ exec: async () => 0 }));
  const find = t.mock.method(Publication, 'find', () => ({
    sort() { return this; }, limit() { return this; }, lean() { return this; }, exec: async () => [],
  }));
  const handler = router.stack.find((layer) => layer.route?.path === '/' && layer.route.methods.get).route.stack[0].handle;
  const cursor = new mongoose.Types.ObjectId();
  const res = { json() {} };
  await handler({
    headers: {}, query: { inferenceModel: 'claude-opus-5.5', videoModel: 'historical-video', language: 'ja', limit: '2', cursor: cursor.toString() },
  }, res);
  const counted = count.mock.calls[0].arguments[0].$and;
  const found = find.mock.calls[0].arguments[0].$and;
  assert.deepEqual(found, [...counted, { _id: { $lt: cursor } }]);
  const [inference, video, language] = counted.slice(2);
  const efforts = { $in: ['claude-opus-5.5', 'claude-opus-5.5-xhigh'] };
  assert.deepEqual(inference.$or, [
    { 'generationModels.inference': efforts },
    { 'generationModels.inference.0': { $exists: false }, inferenceModel: efforts },
  ]);
  assert.deepEqual(video.$or, [
    { 'generationModels.video': 'historical-video' },
    { 'generationModels.video.0': { $exists: false }, videoModel: 'historical-video' },
  ]);
  for (const field of ['sessionLanguage', 'language', 'languageString']) {
    const values = language.$or.find((condition) => condition[field])[field].$in;
    const [codePattern, name] = values;
    assert.equal(name, 'Japanese');
    for (const variant of ['ja', 'JA-jp', 'JP', 'jpn']) assert.match(variant, codePattern);
    assert.doesNotMatch('th', codePattern);
  }

  await handler({ headers: {}, query: { language: 'auto' } }, res);
  assert.deepEqual(count.mock.calls[1].arguments[0].$and, counted.slice(0, 2));
  assert.deepEqual(find.mock.calls[1].arguments[0].$and, counted.slice(0, 2));
});
