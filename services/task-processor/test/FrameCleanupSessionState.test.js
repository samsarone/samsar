import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameCleanupStateLoader } from '../src/FrameCleanupSessionState.js';

const sessionId = '6aefc848cbfd3a1c802db831';

function fakeDatabase({ session = { _id: sessionId }, activeCollection, errorCollection } = {}) {
  const calls = [];
  const database = async () => ({
    collection(name) {
      return {
        async findOne(filter, options) {
          calls.push({ name, filter, options });
          if (name === errorCollection) throw new Error('database unavailable');
          return name === 'videosessions' ? session : name === activeCollection ? { _id: 'job' } : null;
        },
      };
    },
  });
  return { calls, load: createFrameCleanupStateLoader({ database }) };
}

test('cleanup state checks each queue using both session id field names and BSON forms', async () => {
  const { calls, load } = fakeDatabase();
  assert.equal((await load(sessionId)).hasActiveJobs, false);
  assert.deepEqual(calls.map((call) => call.name), [
    'videosessions', 'framegenerations', 'videogenerations',
    'audiogenerations', 'aivideolayergenerations',
  ]);
  assert.equal(calls[0].filter._id.toHexString(), sessionId);
  const projection = calls[0].options.projection;
  assert.equal(projection.layers, undefined);
  assert.equal(projection['layers.frames'], undefined);
  assert.equal(projection.audioGenerationPending, 1);
  assert.equal(projection['layers.aiVideoFrameGenerationPending'], 1);
  assert.equal(projection['branchRenderPaths.timeline.frameGenerationPending'], 1);
  assert.equal(projection['global_videos.framesGenerationPending'], 1);
  assert.equal(projection['global_videos.framesGenerationStatus'], 1);
  assert.equal(projection['globalVideos.isFrameGenerating'], 1);
  for (const call of calls.slice(1)) {
    for (const [index, field] of ['sessionId', 'videoSessionId'].entries()) {
      const ids = call.filter.$or[index][field].$in;
      assert.equal(ids[0], sessionId);
      assert.equal(ids[1].toHexString(), sessionId);
    }
    assert.deepEqual(call.options.projection, { _id: 1 });
  }
});

test('a queued final video protects its session and stops further queue reads', async () => {
  const { calls, load } = fakeDatabase({ activeCollection: 'videogenerations' });
  assert.equal((await load(sessionId)).hasActiveJobs, true);
  assert.deepEqual(calls.map((call) => call.name), ['videosessions', 'framegenerations', 'videogenerations']);
});

test('uppercase cache ids still check canonical string queue identifiers', async () => {
  const { calls, load } = fakeDatabase();
  await load(sessionId.toUpperCase());
  const identifiers = calls[1].filter.$or[0].sessionId.$in;
  assert.equal(identifiers[0], sessionId.toUpperCase());
  assert.equal(identifiers[1], sessionId);
  assert.equal(identifiers[2].toHexString(), sessionId);
});

test('missing sessions stay unknown without queue queries', async () => {
  const { calls, load } = fakeDatabase({ session: null });
  assert.deepEqual(await load(sessionId), { session: null, hasActiveJobs: false });
  assert.equal(calls.length, 1);
});

test('invalid ids and database errors fail closed', async () => {
  const { calls, load } = fakeDatabase({ errorCollection: 'audiogenerations' });
  await assert.rejects(load('../invalid'), /valid session identifier/);
  assert.equal(calls.length, 0);
  await assert.rejects(load(sessionId), /database unavailable/);
});
