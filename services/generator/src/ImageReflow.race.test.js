import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./Image.js', import.meta.url), 'utf8');
function workerFunction(name) {
  const start = source.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `real worker function ${name} exists`);
  const rest = source.slice(start);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return (next < 0 ? rest : rest.slice(0, next)).replace(/^export /, '');
}

function valuesAt(object, path) {
  if (!path.length) return [object];
  if (Array.isArray(object)) return object.flatMap(value => valuesAt(value, path));
  return valuesAt(object?.[path[0]], path.slice(1));
}
function same(actual, expected) {
  if (expected === null) return actual == null;
  if (actual instanceof Date || expected instanceof Date) return Number(actual) === Number(expected);
  if (expected && typeof expected === 'object') return JSON.stringify(actual) === JSON.stringify(expected);
  return actual === expected;
}
function matches(document, filter) {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === '$and') return expected.every(value => matches(document, value));
    if (field === '$or') return expected.some(value => matches(document, value));
    const values = valuesAt(document, field.split('.'));
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
      if ('$elemMatch' in expected) return values.some(value => Array.isArray(value) && value.some(item => matches(item, expected.$elemMatch)));
      if ('$exists' in expected) return values.some(value => value !== undefined) === expected.$exists;
      if ('$ne' in expected) return values.every(value => !same(value, expected.$ne));
      if ('$in' in expected) return values.some(value => expected.$in.some(option => same(value, option)));
    }
    return values.some(value => same(value, expected));
  });
}
function write(object, key, value) {
  const parts = key.split('.'), leaf = parts.pop();
  const parent = parts.reduce((current, part) => current[part] ??= {}, object);
  parent[leaf] = structuredClone(value);
}

function fixture(beforeFirstCompare) {
  const session = {
    _id: 'session', __v: 0, updatedAt: new Date('2026-11-18T00:00:00Z'),
    isExpressGeneration: true, expressGenerationPending: true,
    expressGenerationStatus: { status: 'PENDING', image_generation: 'PENDING', video_generation: 'INIT' },
    hostedAgentBilling: { version: 2, state: 'ACTIVE', controlIntent: 'ACTIVE' },
    layers: [
      { _id: 'kept-before', duration: 4, durationOffset: 0,
        imageSession: { generationStatus: 'COMPLETED', activeGeneratedImage: 'before.png' } },
      { _id: 'failed', duration: 6, durationOffset: 4,
        imageSession: { generationStatus: 'PENDING', activeGeneratedImage: '' } },
      { _id: 'kept-after', duration: 5, durationOffset: 10,
        imageSession: { generationStatus: 'PENDING', activeGeneratedImage: '' },
        aiVideoGenerationStatus: 'INIT', aiVideoLayer: '', sourceSceneIndex: 6,
        sourceSceneRef: { version: 1, sourceSessionId: 'canonical', sceneIndex: 6 } },
    ],
    audioLayers: [
      { _id: 'failed-speech', connectedLayerId: 'failed', startTime: 4, duration: 5, endTime: 9 },
      { _id: 'kept-speech', connectedLayerId: 'kept-after', startTime: 11, duration: 3, endTime: 14,
        generationStatus: 'PENDING', selectedLocalAudioLink: '' },
    ],
  };
  const stale = structuredClone(session);
  const attempts = [], deleted = [], removed = [];
  let reads = 0;
  const VideoSession = {
    findOne() { reads++; const snapshot = structuredClone(session); return { lean: async () => snapshot }; },
    async updateOne(filter, update) {
      if (attempts.length === 0) beforeFirstCompare?.(session);
      attempts.push({ filter: structuredClone(filter), update: structuredClone(update) });
      if (!matches(session, filter)) return { matchedCount: 0, modifiedCount: 0 };
      for (const [key, value] of Object.entries(update.$set || {})) write(session, key, value);
      for (const [key, value] of Object.entries(update.$inc || {})) write(session, key, valuesAt(session, key.split('.'))[0] + value);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const names = ['normalizeString', 'normalizeDocumentId', 'cloneDocumentObject', 'isBranchedVideoSession',
    'isPrunableExpressImageLayer', 'getImageLayerVisualState', 'hasCompletedLayerVisual',
    'isExpressImageFailureSessionStopped', 'findImageFailureVideoSession',
    'getConnectedAudioRelativeStart', 'getAudioLayerDuration', 'clampAudioLayersToTimeline',
    'reflowLayersAndConnectedAudio', 'buildExpressLayerPrunePlan', 'pruneExpressImageLayerAfterFailure'];
  const context = vm.createContext({ Date, VideoSession,
    ImageGeneration: { deleteMany: async filter => { deleted.push(structuredClone(filter)); } },
    removeTaskFromQueueById: id => removed.push(id),
  });
  const prune = vm.runInContext(`${names.map(workerFunction).join('\n')}\npruneExpressImageLayerAfterFailure`, context);
  return { session, stale, attempts, deleted, removed, reads: () => reads,
    run: () => prune({ sessionData: stale, videoSessionId: 'session', layerId: 'failed', requestId: 'request', message: 'Definitive provider retries exhausted' }) };
}

test('same-millisecond completion of another image and AI video rejects stale reflow and retains their assets', async () => {
  const f = fixture(session => {
    const layer = session.layers[2];
    layer.imageSession = { generationStatus: 'COMPLETED', activeGeneratedImage: 'late-image.png' };
    layer.aiVideoGenerationStatus = 'COMPLETED'; layer.aiVideoLayer = 'late-clip.mp4';
    session.audioLayers[1].generationStatus = 'COMPLETED'; session.audioLayers[1].selectedLocalAudioLink = 'late-speech.wav';
    // No __v/updatedAt increment: the actual media-state guard must catch this.
  });
  assert.equal((await f.run()).pruned, true);
  assert.equal(f.attempts.length, 2);
  assert.ok(f.reads() >= 2);
  assert.deepEqual(f.session.layers.map(layer => layer._id), ['kept-before', 'kept-after']);
  const kept = f.session.layers[1];
  assert.equal(kept.imageSession.activeGeneratedImage, 'late-image.png');
  assert.equal(kept.aiVideoLayer, 'late-clip.mp4');
  assert.equal(kept.sourceSceneRef.sceneIndex, 6);
  assert.equal(kept.durationOffset, 4);
  assert.equal(f.session.audioLayers[0].selectedLocalAudioLink, 'late-speech.wav');
  assert.equal(f.session.audioLayers[0].startTime, 5);
  assert.deepEqual(f.deleted, [{ videoSessionId: 'session', layerId: 'failed' }]);
  assert.equal(f.stale.layers[2].durationOffset, 10, 'planning must not mutate the caller snapshot');
});

test('a failed target that completes before the prune compare is never deleted or marked failed again', async () => {
  const f = fixture(session => {
    session.layers[1].imageSession = { generationStatus: 'COMPLETED', activeGeneratedImage: 'target-finished.png' };
  });
  const result = await f.run();
  assert.equal(result.pruned, false); assert.equal(result.handled, true); assert.equal(result.reason, 'completed_layer');
  assert.equal(f.session.layers.length, 3);
  assert.equal(f.session.layers[1].imageSession.activeGeneratedImage, 'target-finished.png');
  assert.equal(f.deleted.length, 0);
});

test('cancellation arriving at the prune compare cannot reopen the parent or reflow its timeline', async () => {
  const f = fixture(session => { session.expressGenerationCancelled = true; session.expressGenerationPending = false; });
  const result = await f.run();
  assert.equal(result.pruned, false); assert.equal(result.handled, true); assert.equal(result.reason, 'session_stopped');
  assert.equal(f.session.expressGenerationCancelled, true); assert.equal(f.session.expressGenerationPending, false);
  assert.equal(f.session.layers.length, 3); assert.equal(f.session.layers[2].durationOffset, 10);
  assert.equal(f.deleted.length, 0);
});

test('same-millisecond speech completion alone forces a fresh reflow and preserves the paid audio', async () => {
  const f = fixture(session => {
    session.audioLayers[1].generationStatus = 'COMPLETED';
    session.audioLayers[1].selectedLocalAudioLink = 'completed-speech.wav';
  });
  assert.equal((await f.run()).pruned, true);
  assert.equal(f.attempts.length, 2);
  assert.equal(f.session.audioLayers[0].generationStatus, 'COMPLETED');
  assert.equal(f.session.audioLayers[0].selectedLocalAudioLink, 'completed-speech.wav');
  assert.equal(f.session.audioLayers[0].startTime, 5);
});

test('a selected base image completed during the compare protects the scene despite stale generation status', async () => {
  const f = fixture(session => {
    session.layers[1].imageSession.activeItemList = [
      { type: 'image', is_base_image: true, src: 'selected-base.png' },
    ];
  });
  const result = await f.run();
  assert.equal(result.pruned, false); assert.equal(result.handled, true); assert.equal(result.reason, 'completed_layer');
  assert.equal(f.session.layers.length, 3);
  assert.equal(f.session.layers[1].imageSession.activeItemList[0].src, 'selected-base.png');
  assert.equal(f.deleted.length, 0);
});
