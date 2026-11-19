import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import GeneratedImage from './GeneratedImage.js';
import GeneratedAIVideo from './GeneratedAIVideo.js';

test('publication asset lookups declare session indexes without connecting to a database', () => {
  assert.equal(mongoose.connection.readyState, 0);
  for (const model of [GeneratedImage, GeneratedAIVideo]) {
    assert.ok(model.schema.indexes().some(([keys]) => (
      Object.keys(keys).length === 1 && keys.sessionId === 1
    )), `${model.modelName} must bound publication asset lookups by sessionId`);
  }
  assert.equal(mongoose.connection.readyState, 0);
});
