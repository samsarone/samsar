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
