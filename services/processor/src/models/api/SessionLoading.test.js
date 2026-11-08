import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import VideoSession from '../../schema/VideoSession.js';
import GeneratedImage from '../../schema/generations/GeneratedImage.js';
import GenerationCreditTransaction from '../../schema/GenerationCreditTransaction.js';
import {
  buildVideoStatusDetailedResponse, VIDEO_STATUS_SESSION_PROJECTION,
  VIDEO_STATUS_DETAILED_SESSION_PROJECTION,
} from './StatusAPI.js';
import { buildStepVideoDetailedStatus } from './StepVideoAPI.js';

const id = '507f1f77bcf86cd799439011';
function fixture(overrides = {}) {
  return {
    _id: id, userId: 'owner', isExpressGeneration: true, isStepVideoGeneration: true,
    expressGenerationPending: false, videoGenerationPending: false,
    expressGenerationStatus: { status: 'COMPLETED', video_generation: 'COMPLETED' },
    expressStepGeneration: { status: 'COMPLETED', currentStep: 'video_generation' },
    videoLink: 'https://media.example/final.mp4', aspectRatio: '9:16',
    expressGenerativeVideoModel: 'KLINGIMGTOVID4',
    layers: [{ _id: 'scene', duration: 5, durationOffset: 0, imageSession: { activeItemList: [] } }],
    audioLayers: [], ...overrides,
  };
}
function query(value, onSelect = () => {}) {
  return { select(fields) { onSelect(fields); return this; }, sort() { return this; }, async lean() { return value; } };
}
function mockReads(t, session) {
  t.mock.method(mongoose, 'connect', async () => mongoose);
  const reads = t.mock.method(VideoSession, 'findById', () => query(session));
  const history = t.mock.method(GeneratedImage, 'find', () => query([]));
  const ledger = t.mock.method(GenerationCreditTransaction, 'find', () => query([{ amount: 12.5 }]));
  return { reads, history, ledger };
}

test('detailed projection retains every compact-status field, including billing ownership', () => {
  const detailed = new Set(VIDEO_STATUS_DETAILED_SESSION_PROJECTION.split(' '));
  for (const field of VIDEO_STATUS_SESSION_PROJECTION.split(' ')) assert.ok(detailed.has(field), field);
});

test('detailed status reads one snapshot and retains result, model, and request-owned credit totals', async (t) => {
  const { reads, history, ledger } = mockReads(t, fixture({ videoBillingPolicy: 'adapter' }));
  const result = await buildVideoStatusDetailedResponse({ sessionId: id });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.result_url, 'https://media.example/final.mp4');
  assert.equal(result.provider, 'KLINGIMGTOVID4');
  assert.equal(result.credits_charged, 12.5);
  assert.equal(result.session.aspectRatio, '9:16');
  assert.equal(reads.mock.callCount(), 1);
  assert.equal(history.mock.callCount(), 1);
  assert.equal(ledger.mock.callCount(), 1);
  assert.equal(ledger.mock.calls[0].arguments[0].userId, 'owner');
});

for (const status of ['COMPLETED', 'PENDING', 'PAUSED', 'FAILED']) {
  test(`step detailed status reuses its authorized snapshot for ${status}`, async (t) => {
    const session = fixture({
      videoBillingPolicy: 'adapter',
      expressGenerationStatus: { status, video_generation: status },
      expressStepGeneration: { status, currentStep: 'video_generation' },
      expressGenerationPending: status === 'PENDING',
      expressGenerationPaused: status === 'PAUSED',
      expressGenerationFailed: status === 'FAILED',
      generationError: status === 'FAILED' ? 'Render failed' : undefined,
    });
    const { reads, ledger } = mockReads(t, session);
    const owned = t.mock.method(VideoSession, 'findOne', (filter) => {
      assert.deepEqual(filter, { _id: id, userId: 'owner' });
      return query(session, (projection) => assert.equal(projection, '-layers.frames'));
    });
    const result = await buildStepVideoDetailedStatus({ userId: 'owner', sessionId: id });
    // Step status historically exposes paused state via the pause flag while
    // its step enum normalizes an unrecognized PAUSED step to INIT.
    assert.equal(result.status, status === 'PAUSED' ? 'INIT' : status);
    assert.equal(result.expressGenerationPaused, status === 'PAUSED');
    assert.equal(result.credits_charged, 12.5);
    assert.equal(result.session.layers.length, 1);
    assert.equal(owned.mock.callCount(), 1);
    assert.equal(reads.mock.callCount(), 0);
    assert.equal(ledger.mock.callCount(), 1);
  });
}

test('step status rejects inaccessible sessions before any detail/history lookup', async (t) => {
  const { reads, history, ledger } = mockReads(t, fixture());
  t.mock.method(VideoSession, 'findOne', (filter) => {
    assert.equal(filter.userId, 'stranger');
    return query(null);
  });
  assert.equal(await buildStepVideoDetailedStatus({ userId: 'stranger', sessionId: id }), null);
  assert.equal(reads.mock.callCount() + history.mock.callCount() + ledger.mock.callCount(), 0);
});

test('standalone stage reconciliation still runs before the shared snapshot is serialized', async (t) => {
  const completed = fixture({
    videoLink: null,
    expressStepGeneration: { routeType: 'lip_sync', status: 'COMPLETED', currentStep: 'lip_sync_generation' },
    expressGenerationStatus: { lip_sync_generation: 'COMPLETED' },
    layers: [{ _id: 'scene', duration: 5, lipSyncRemoteLink: 'https://media.example/lipsync.mp4' }],
  });
  const { reads } = mockReads(t, completed);
  t.mock.method(VideoSession, 'findOne', () => query({
    ...completed, expressGenerationPending: true,
    expressStepGeneration: { ...completed.expressStepGeneration, status: 'PENDING' },
  }));
  const update = t.mock.method(VideoSession, 'findByIdAndUpdate', async () => null);
  const result = await buildStepVideoDetailedStatus({ userId: 'owner', sessionId: id });
  assert.equal(update.mock.callCount(), 1);
  assert.equal(update.mock.calls[0].arguments[1].$set['expressStepGeneration.status'], 'COMPLETED');
  assert.equal(reads.mock.callCount(), 1);
  assert.equal(result.step.status, 'COMPLETED');
});
