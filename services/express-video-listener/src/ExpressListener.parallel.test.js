import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import VideoSession from './schema/VideoSession.js';
import FrameGeneration from './schema/FrameGeneration.js';
import AIVideoLayerGeneration from './schema/AIVideoLayerGeneration.js';
import User from './schema/User.js';
import { __testOnly__ } from './ExpressListener.js';

function setPath(target, path, value) {
  const keys = path.split('.');
  const leaf = keys.pop();
  const parent = keys.reduce((object, key) => object[key] ??= {}, target);
  parent[leaf] = structuredClone(value);
}

// Exercise the real listener tick with detached database snapshots and scripted
// provider completion. No network, media generation, or live credits are used.
function pipeline(t, overrides = {}) {
  const state = {
    _id: 'session', userId: 'user', createdAt: new Date(),
    isExpressGeneration: true, expressGenerationPending: true,
    expressGenerativeVideoRequired: true, enableSubtitles: true,
    transcriptGenerationPending: true,
    expressGenerationStatus: {
      image_generation: 'COMPLETED', speech_generation: 'COMPLETED',
      music_generation: 'COMPLETED', audio_generation: 'COMPLETED',
      ai_video_generation: 'COMPLETED', delete_reflow: 'COMPLETED',
      lip_sync_generation: 'INIT', sound_effect_generation: 'INIT',
      narrator_avatar_generation: 'INIT', transcript_generation: 'INIT',
      frame_generation: 'INIT', video_generation: 'INIT',
    },
    layers: ['character', 'sound_effect'].map((type, index) => ({
      _id: type, layerAiVideoType: type, layerBaseAiImageType: type,
      duration: 5, durationOffset: index * 5,
      imageSession: { generationStatus: 'COMPLETED', editStatus: 'INIT' },
      aiVideoGenerationStatus: 'COMPLETED', aiVideoGenerationPending: false,
      hasAiVideoLayer: true, aiVideoLayer: `${type}.mp4`,
      lipSyncVideoGenerationStatus: 'INIT', soundEffectVideoGenerationStatus: 'INIT',
    })),
    audioLayers: [{
      _id: 'speech', connectedLayerId: 'character', generationType: 'speech',
      generationStatus: 'COMPLETED', duration: 5, startTime: 0, endTime: 5,
    }],
    ...overrides,
  };
  const events = [];
  const billed = new Set();
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
  t.after(() => { delete mongoose.connection.readyState; });
  t.mock.method(VideoSession, 'findById', () => ({
    select() { return this; },
    lean: async () => structuredClone(state),
    then: (resolve, reject) => Promise.resolve(structuredClone(state)).then(resolve, reject),
  }));
  t.mock.method(VideoSession, 'updateOne', async (_filter, update) => {
    for (const [key, value] of Object.entries(update.$set || update)) {
      if (!key.startsWith('$')) setPath(state, key, value);
    }
    for (const key of Object.keys(update.$unset || {})) delete state[key];
    return { matchedCount: 1, modifiedCount: 1 };
  });
  let frameRequests = [];
  t.mock.method(FrameGeneration, 'find', async () => structuredClone(frameRequests));
  t.mock.method(User, 'findOne', async () => ({ isPremiumUser: false }));
  t.mock.method(AIVideoLayerGeneration, 'exists', async () => null);
  let avatarStatus = 'PENDING';
  const operations = {
    ensureGeneratedOutroTilesForSession: async () => ({ updated: false }),
    completeExpressStageForBillingAndStep: async (_id, stage, options) => {
      if (!billed.has(stage)) events.push(`bill:${stage}:${Boolean(options?.skipBilling)}`);
      billed.add(stage);
      return { ok: true, paused: false };
    },
    createGenerativeVideoAnimationsForFrames: async () => { events.push('base'); },
    generateLipSyncForSession: async () => {
      events.push('lip');
      state.layers[0].lipSyncGenerationPending = true;
      state.layers[0].lipSyncVideoGenerationStatus = 'PENDING';
    },
    generateSoundEffectsForSession: async () => {
      events.push('sound');
      state.layers[1].soundEffectGenerationPending = true;
      state.layers[1].soundEffectVideoGenerationStatus = 'PENDING';
    },
    ensureNarratorAvatarVideoForSession: async () => {
      events.push('avatar');
      return { status: avatarStatus };
    },
    generateTranscriptsForSessionAudioLayers: async () => { events.push('transcript'); },
    generateFramesForSession: async () => { events.push('frames'); },
    generateVideoForSession: async () => { events.push('video'); },
    processSessionCompletionFailure: async () => { events.push('failed'); },
    processSessionCompletionSuccess: async () => { events.push('delivered'); return { ok: true }; },
  };
  const finish = (stage, status = 'COMPLETED') => {
    const lip = stage === 'lip';
    const layer = state.layers[lip ? 0 : 1];
    layer[lip ? 'lipSyncGenerationPending' : 'soundEffectGenerationPending'] = false;
    layer[lip ? 'lipSyncVideoGenerationStatus' : 'soundEffectVideoGenerationStatus'] = status;
    if (status === 'COMPLETED') {
      layer[lip ? 'hasLipSyncVideoLayer' : 'hasSoundEffectVideoLayer'] = true;
      layer[lip ? 'lipSyncVideoLayer' : 'soundEffectVideoLayer'] = `${stage}-result.mp4`;
    }
  };
  return {
    state, events, billed, operations, finish,
    setAvatarStatus: value => { avatarStatus = value; },
    setFrameRequests: value => { frameRequests = value; },
    tick: () => __testOnly__.checkVideoRenderStatus({ _id: state._id }, operations),
  };
}

for (const order of [['lip', 'sound'], ['sound', 'lip']]) {
  test(`derivatives overlap and join correctly when ${order.join(' then ')} completes`, async t => {
    const f = pipeline(t);
    await f.tick();
    assert.deepEqual(f.events.filter(event => ['lip', 'sound'].includes(event)), ['lip', 'sound']);
    await f.tick();
    assert.equal(f.events.filter(event => event === 'lip').length, 1);
    assert.equal(f.events.filter(event => event === 'sound').length, 1);
    f.finish(order[0]);
    await f.tick();
    assert.equal(f.events.includes('frames'), false);
    if (order[0] === 'sound') assert.equal(f.billed.has('sound_effect_generation'), false);
    f.finish(order[1]);
    await f.tick();
    assert.equal(f.events.filter(event => event === 'frames').length, 1);
    assert.equal(f.events.filter(event => event === 'transcript').length, 1);
    assert.ok(f.events.indexOf('transcript') < f.events.indexOf('frames'));
    assert.deepEqual(f.state.layers.map(layer => layer.durationOffset), [0, 5]);
    f.setFrameRequests([{ _id: 'pending-frames' }]);
    await f.tick();
    assert.equal(f.events.includes('video'), false);
    f.setFrameRequests([]);
    await f.tick();
    assert.equal(f.events.filter(event => event === 'video').length, 1);
    await f.tick();
    assert.equal(f.events.includes('delivered'), false);
    f.state.videoGenerationPending = false;
    f.state.videoLink = 'final.mp4';
    await f.tick();
    assert.equal(f.events.filter(event => event === 'delivered').length, 1);
    assert.equal(f.state.expressGenerationPending, false);
    assert.equal(f.state.expressGenerationStatus.status, 'COMPLETED');
    assert.ok(f.events.indexOf('bill:lip_sync_generation:false') < f.events.indexOf('bill:sound_effect_generation:false'));
  });
}

test('manual step sessions retain the lip-sync barrier', async t => {
  const f = pipeline(t, { isStepVideoGeneration: true });
  await f.tick();
  assert.equal(f.events.includes('lip'), true);
  assert.equal(f.events.includes('sound'), false);
});

test('a legacy layer eligible for both derivatives keeps serial execution', async t => {
  const f = pipeline(t);
  f.state.layers[0].layerBaseAiImageType = 'sound_effect';
  await f.tick();
  assert.ok(f.events.includes('lip'));
  assert.equal(f.events.includes('sound'), false);
});

test('parallel stage opt-out preserves sequential behavior', async t => {
  const previous = process.env.EXPRESS_PIPELINE_PARALLEL_STAGES;
  process.env.EXPRESS_PIPELINE_PARALLEL_STAGES = 'false';
  t.after(() => {
    if (previous === undefined) delete process.env.EXPRESS_PIPELINE_PARALLEL_STAGES;
    else process.env.EXPRESS_PIPELINE_PARALLEL_STAGES = previous;
  });
  const f = pipeline(t);
  await f.tick();
  assert.ok(f.events.includes('lip'));
  assert.equal(f.events.includes('sound'), false);
});

test('a stale completed lip-sync stage with pending output cannot release frames or billing', async t => {
  const f = pipeline(t);
  await f.tick();
  f.state.expressGenerationStatus.lip_sync_generation = 'COMPLETED';
  f.finish('sound');
  await f.tick();
  assert.equal(f.billed.has('lip_sync_generation'), false);
  assert.equal(f.billed.has('sound_effect_generation'), false);
  assert.equal(f.events.includes('frames'), false);
});

test('lip-sync fallback keeps base video and waits for active sound effects', async t => {
  const f = pipeline(t);
  await f.tick();
  f.finish('lip', 'FAILED');
  await f.tick();
  assert.ok(f.events.includes('bill:lip_sync_generation:true'));
  assert.equal(f.events.includes('frames'), false);
  f.finish('sound');
  await f.tick();
  assert.equal(f.events.includes('frames'), true);
  assert.equal(f.state.layers[0].aiVideoLayer, 'character.mp4');
});

test('sound-effect fallback does not finalize while lip sync is pending', async t => {
  const f = pipeline(t);
  await f.tick();
  f.finish('sound', 'FAILED');
  await f.tick();
  assert.equal(f.events.includes('frames'), false);
  assert.equal(f.billed.has('sound_effect_generation'), false);
  f.finish('lip');
  await f.tick();
  assert.ok(f.events.includes('bill:sound_effect_generation:true'));
  assert.equal(f.events.includes('frames'), true);
});

test('an active sound request survives a stale layer snapshot without fallback or early rendering', async t => {
  const f = pipeline(t);
  await f.tick();
  f.finish('lip');
  // A concurrent media-worker array write can restore an older pending flag.
  f.state.layers[1].soundEffectGenerationPending = false;
  f.state.layers[1].soundEffectVideoGenerationStatus = 'INIT';
  let activeRequest = true;
  t.mock.method(AIVideoLayerGeneration, 'exists', async query => {
    assert.equal(query.sessionId, 'session');
    assert.deepEqual(query.layerId, { $in: ['sound_effect'] });
    assert.deepEqual(query.$or[0], { generationType: 'sound_effect' });
    return activeRequest ? { _id: 'sound-request' } : null;
  });
  await f.tick();
  assert.equal(f.state.soundEffectGenerationSkipped, false);
  assert.equal(f.events.includes('frames'), false);
  assert.equal(f.billed.has('sound_effect_generation'), false);
  assert.equal(f.events.filter(event => event === 'sound').length, 1);
  activeRequest = false;
  f.finish('sound');
  await f.tick();
  assert.ok(f.events.includes('bill:sound_effect_generation:false'));
  assert.equal(f.events.includes('frames'), true);
});

test('avatar provider wait overlaps transcripts but still blocks frames', async t => {
  const f = pipeline(t, { addNarratorAvatar: true });
  f.finish('lip'); f.finish('sound');
  await f.tick();
  assert.ok(f.events.includes('avatar'));
  assert.ok(f.events.includes('transcript'));
  assert.equal(f.events.includes('frames'), false);
  await f.tick();
  assert.equal(f.events.filter(event => event === 'transcript').length, 1);
  f.setAvatarStatus('COMPLETED');
  await f.tick();
  assert.equal(f.events.filter(event => event === 'frames').length, 1);
});

test('step-mode avatar waits retain transcript ordering', async t => {
  const f = pipeline(t, { addNarratorAvatar: true, expressStepGeneration: { enabled: true } });
  f.finish('lip'); f.finish('sound');
  await f.tick();
  assert.ok(f.events.includes('avatar'));
  assert.equal(f.events.includes('transcript'), false);
});

test('failed subtitle alignment remains optional while the avatar join is enforced', async t => {
  const f = pipeline(t, { addNarratorAvatar: true });
  f.finish('lip'); f.finish('sound');
  f.operations.generateTranscriptsForSessionAudioLayers = async () => {
    f.events.push('transcript');
    throw new Error('alignment unavailable');
  };
  await f.tick();
  assert.equal(f.state.expressGenerationStatus.transcript_generation, 'FAILED');
  assert.equal(f.events.includes('frames'), false);
  f.setAvatarStatus('COMPLETED');
  await f.tick();
  assert.equal(f.events.filter(event => event === 'transcript').length, 1);
  assert.equal(f.events.includes('frames'), true);
});

test('a narrator failure after early transcripts still prevents final rendering', async t => {
  const f = pipeline(t, { addNarratorAvatar: true });
  f.finish('lip'); f.finish('sound');
  await f.tick();
  f.setAvatarStatus('FAILED');
  await f.tick();
  assert.equal(f.state.expressGenerationFailed, true);
  assert.equal(f.events.includes('frames'), false);
  assert.equal(f.events.includes('delivered'), false);
  assert.ok(f.events.includes('failed'));
});

test('disabled subtitles do not start alignment or bypass a pending avatar', async t => {
  const f = pipeline(t, { addNarratorAvatar: true, enableSubtitles: false });
  f.finish('lip'); f.finish('sound');
  await f.tick();
  assert.equal(f.events.includes('transcript'), false);
  assert.equal(f.events.includes('frames'), false);
  f.setAvatarStatus('COMPLETED');
  await f.tick();
  assert.equal(f.events.includes('transcript'), false);
  assert.equal(f.events.includes('frames'), true);
});

test('billing failure after overlapping providers still blocks later settlement and rendering', async t => {
  const f = pipeline(t);
  await f.tick();
  f.finish('lip'); f.finish('sound');
  const completeStage = f.operations.completeExpressStageForBillingAndStep;
  f.operations.completeExpressStageForBillingAndStep = async (sessionId, stage, options) => (
    stage === 'lip_sync_generation' ? { ok: false } : completeStage(sessionId, stage, options)
  );
  await f.tick();
  assert.equal(f.billed.has('sound_effect_generation'), false);
  assert.equal(f.events.includes('avatar'), false);
  assert.equal(f.events.includes('frames'), false);
  assert.equal(f.events.includes('delivered'), false);
});

test('base video completion remains a barrier before derivatives', async t => {
  const f = pipeline(t);
  f.state.layers[1].aiVideoGenerationStatus = 'INIT';
  f.state.layers[1].hasAiVideoLayer = false;
  delete f.state.layers[1].aiVideoLayer;
  await f.tick();
  assert.equal(f.events.includes('lip'), false);
  assert.equal(f.events.includes('sound'), false);
});

for (const field of ['expressGenerationPaused', 'expressGenerationCancelled']) {
  test(`${field} prevents any new stage dispatch`, async t => {
    const f = pipeline(t, { [field]: true });
    // Cancellation cleanup is not part of this scheduler regression fixture.
    if (field === 'expressGenerationCancelled') {
      const { default: AIVideoLayerGeneration } = await import('./schema/AIVideoLayerGeneration.js');
      const { default: VideoGeneration } = await import('./schema/VideoGeneration.js');
      const { default: ImageGeneration } = await import('./schema/ImageGeneration.js');
      const { default: ImageBatchGeneration } = await import('./schema/ImageBatchGeneration.js');
      const { default: AudioGeneration } = await import('./schema/AudioGeneration.js');
      const { default: PendingUserMusicGeneration } = await import('./schema/PendingUserMusicGeneration.js');
      for (const Model of [AIVideoLayerGeneration, VideoGeneration, ImageGeneration,
        ImageBatchGeneration, AudioGeneration, PendingUserMusicGeneration, FrameGeneration]) {
        t.mock.method(Model, 'deleteMany', async () => ({}));
      }
    }
    await f.tick();
    assert.deepEqual(f.events, []);
  });
}
