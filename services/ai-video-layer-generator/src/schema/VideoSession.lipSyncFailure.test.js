import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { fal } from '@fal-ai/client';

import VideoSession from './VideoSession.js';
import AIVideoLayerGeneration from './AIVideoLayerGeneration.js';
import { pollForAIVideoCompletion, processVideoGenerationFailed } from '../VideoGenerationListener.js';

test('terminal lip sync failure persists its reason and keeps the base AI video', async (t) => {
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
  t.after(() => { delete mongoose.connection.readyState; });
  t.mock.method(console, 'error', () => {});

  const sessionId = new mongoose.Types.ObjectId();
  const layerId = new mongoose.Types.ObjectId();
  const generationId = new mongoose.Types.ObjectId();
  const session = new VideoSession({
    _id: sessionId,
    layers: [{
      _id: layerId,
      layerAiVideoType: 'character',
      hasAiVideoLayer: true,
      aiVideoLayer: '/assets/base.mp4',
      aiVideoRemoteLink: 'https://static.example/base.mp4',
      aiVideoGenerationStatus: 'COMPLETED',
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'PENDING',
    }],
  });
  let savedSession;
  let deletedGenerationId;
  t.mock.method(VideoSession, 'findById', async () => session);
  t.mock.method(session, 'save', async () => {
    savedSession = session.toObject();
    return session;
  });
  t.mock.method(AIVideoLayerGeneration, 'findByIdAndDelete', async (id) => {
    deletedGenerationId = id;
  });

  await processVideoGenerationFailed({
    _id: generationId,
    sessionId: sessionId.toString(),
    layerId: layerId.toString(),
    model: 'HUMMINGBIRDLIPSYNC',
    generationType: 'lip_sync',
    numRetries: 3,
    retryOnFail: true,
    lastProviderFailureMessage: 'Fal rejected the lip sync request',
    createdAt: new Date(),
  });

  assert.equal(savedSession.layers.length, 1);
  assert.equal(savedSession.layers[0].lipSyncVideoGenerationStatus, 'FAILED');
  assert.equal(savedSession.layers[0].lipSyncGenerationPending, false);
  assert.equal(savedSession.layers[0].lipSyncVideoGenerationError, 'Fal rejected the lip sync request');
  assert.equal(savedSession.layers[0].hasAiVideoLayer, true);
  assert.equal(savedSession.layers[0].aiVideoGenerationStatus, 'COMPLETED');
  assert.equal(savedSession.layers[0].aiVideoLayer, '/assets/base.mp4');
  assert.equal(savedSession.layers[0].aiVideoRemoteLink, 'https://static.example/base.mp4');
  assert.equal(savedSession.layers[0].layerAiVideoType, 'character');
  assert.equal(deletedGenerationId.toString(), generationId.toString());
});

test('an expired accepted Sync job clears only its layer and leaves the express session able to continue', async (t) => {
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
  t.after(() => { delete mongoose.connection.readyState; });
  t.mock.method(console, 'error', () => {});

  const sessionId = new mongoose.Types.ObjectId();
  const layerId = new mongoose.Types.ObjectId();
  const generationId = new mongoose.Types.ObjectId();
  const session = new VideoSession({
    _id: sessionId,
    expressGenerationPending: true,
    expressGenerationFailed: false,
    expressGenerationStatus: { ai_video_generation: 'COMPLETED', lip_sync_generation: 'PENDING' },
    layers: [{
      _id: layerId,
      layerAiVideoType: 'character',
      hasAiVideoLayer: true,
      aiVideoLayer: '/assets/base.mp4',
      aiVideoGenerationStatus: 'COMPLETED',
      lipSyncGenerationPending: true,
      lipSyncVideoGenerationStatus: 'PENDING',
    }, ...Array.from({ length: 3 }, (_, index) => ({
      layerAiVideoType: 'character',
      hasAiVideoLayer: true,
      aiVideoLayer: `/assets/base-${index}.mp4`,
      aiVideoGenerationStatus: 'COMPLETED',
      hasLipSyncVideoLayer: true,
      lipSyncVideoLayer: `/assets/lip-${index}.mp4`,
      lipSyncVideoGenerationStatus: 'COMPLETED',
      lipSyncGenerationPending: false,
    }))],
  });
  const completedLayersBefore = JSON.stringify(session.toObject().layers.slice(1));
  let deletedGenerationId;
  t.mock.method(VideoSession, 'findById', async () => session);
  t.mock.method(session, 'save', async () => session);
  t.mock.method(AIVideoLayerGeneration, 'findByIdAndDelete', async (id) => { deletedGenerationId = id; });
  t.mock.method(AIVideoLayerGeneration, 'findByIdAndUpdate', async () => {
    assert.fail('An expired accepted request must not create another provider attempt');
  });
  t.mock.method(fal.queue, 'status', async () => {
    assert.fail('The deadline must stop polling the expired request');
  });

  await pollForAIVideoCompletion({ toObject: () => ({
    _id: generationId,
    sessionId: sessionId.toString(),
    layerId: layerId.toString(),
    model: 'SYNCLIPSYNC',
    generationType: 'lip_sync',
    submittedAdapter: 'fal',
    generationId: 'accepted-provider-request',
    requestSubmitAt: new Date(Date.now() - 20 * 60_000),
    numRetries: 0,
    retryOnFail: true,
  }) });

  assert.equal(session.layers[0].lipSyncVideoGenerationStatus, 'FAILED');
  assert.equal(session.layers[0].lipSyncGenerationPending, false);
  assert.match(session.layers[0].lipSyncVideoGenerationError, /10-minute lip-sync limit/);
  assert.equal(session.layers[0].aiVideoLayer, '/assets/base.mp4');
  assert.equal(session.expressGenerationPending, true);
  assert.equal(session.expressGenerationFailed, false);
  assert.equal(JSON.stringify(session.toObject().layers.slice(1)), completedLayersBefore);
  assert.equal(deletedGenerationId.toString(), generationId.toString());
});
