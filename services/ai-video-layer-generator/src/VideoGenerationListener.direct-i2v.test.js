import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import VideoSession from './schema/VideoSession.js';
import AIVideoLayerGeneration from './schema/AIVideoLayerGeneration.js';
import { processVideoGenerationFailed } from './VideoGenerationListener.js';

for (const layerAiVideoType of ['sound_effect', 'ai_video']) {
  test(`direct audio-enabled I2V failure terminates the base stage (${layerAiVideoType})`, async (t) => {
    // Stub persistence only; exercise the real failure dispatch and finalizer.
    Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
    t.after(() => { delete mongoose.connection.readyState; });
    const layer = {
      _id: 'failed-layer',
      layerAiVideoType,
      layerBaseAiImageType: 'image',
      isAudioVideoLayer: true,
      aiVideoGenerationPending: true,
      aiVideoGenerationStatus: 'PENDING',
      soundEffectVideoGenerationStatus: 'INIT',
    };
    const completedLayer = { _id: 'completed-layer', aiVideoGenerationStatus: 'COMPLETED', aiVideoLayer: 'completed.mp4' };
    const session = { layers: [completedLayer, layer] };
    const payload = {
      _id: 'failed-job', sessionId: 'session', layerId: 'failed-layer',
      model: 'SEEDANCE2.0I2V', generationType: 'generate',
      isExternalDirectImageToVideo: true, isAudioVideoGeneration: true,
      retryOnFail: false, numRetries: 0, dockerAdapterFailoverDisabled: true,
      lastProviderFailureMessage: 'GMICloud submit failed (500): Backend error (403). Please try again.',
    };
    const events = [];
    t.mock.method(VideoSession, 'findById', async () => session);
    t.mock.method(AIVideoLayerGeneration, 'findById', () => ({ lean: async () => payload }));
    t.mock.method(VideoSession, 'updateOne', async (filter, update) => {
      assert.deepEqual(filter, { _id: 'session', 'layers._id': 'failed-layer' });
      for (const [key, value] of Object.entries(update.$set)) {
        if (key.startsWith('layers.$.')) layer[key.slice('layers.$.'.length)] = value;
      }
      events.push('layer-failed');
    });
    t.mock.method(AIVideoLayerGeneration, 'findByIdAndUpdate', async (id, update) => {
      assert.equal(id, 'failed-job');
      assert.equal(update.status, 'FAILED');
    });
    t.mock.method(AIVideoLayerGeneration, 'findByIdAndDelete', async (id) => {
      assert.equal(id, 'failed-job');
      events.push('job-deleted');
    });

    await processVideoGenerationFailed(payload);

    assert.equal(layer.aiVideoGenerationPending, false);
    assert.equal(layer.aiVideoGenerationStatus, 'FAILED');
    assert.equal(layer.hasAiVideoLayer, false);
    assert.equal(layer.processVideoGenerationFailed, true);
    assert.match(layer.aiVideoGenerationError, /Backend error \(403\)/);
    assert.equal(layer.soundEffectVideoGenerationStatus, 'INIT');
    assert.deepEqual(completedLayer, { _id: 'completed-layer', aiVideoGenerationStatus: 'COMPLETED', aiVideoLayer: 'completed.mp4' });
    assert.deepEqual(events, ['layer-failed', 'job-deleted']);
  });
}
