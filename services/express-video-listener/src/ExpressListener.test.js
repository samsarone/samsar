import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__, removeLayerInSession } from './ExpressListener.js';
import { assessLipSyncFallback, assessLipSyncStage } from './ai_video/LipSyncStage.js';

function reflowFixture({ failed = [], failSave = false } = {}) {
  const scenes = Array.from({ length: 13 }, (_, i) => ({ visual: `Original scene ${i}`, duration: 10, type: 'narration' }));
  let offset = 0;
  const layers = scenes.map((scene, i) => {
    const duration = i === 1 ? 121 / 24 : 5;
    const layer = { _id: `layer-${i}`, duration, durationOffset: offset,
      sourceSceneIndex: i, sourceSceneRef: { version: 1, sourceSessionId: 'session', sceneIndex: i, scene: structuredClone(scene), sounds: [] },
      layerBaseAiImageType: 'scene', layerAiVideoType: 'narration',
      imageSession: { activeGeneratedImage: `scene-${i}.png` },
      hasAiVideoLayer: !failed.includes(i), aiVideoLayer: failed.includes(i) ? null : `scene-${i}.mp4`,
      aiVideoGenerationStatus: failed.includes(i) ? 'FAILED' : 'COMPLETED',
      processVideoGenerationFailed: failed.includes(i) };
    offset += duration;
    return layer;
  });
  layers.push({ _id: 'outro', layerBaseAiImageType: 'none', layerAiVideoType: 'none', duration: 8,
    durationOffset: offset, imageSession: { activeGeneratedImage: 'outro.png' }, sourceSceneIndex: null, sourceSceneRef: null });
  const speech = (name, scene, delta, duration = 1) => ({ _id: name, generationType: 'speech',
    connectedLayerId: `layer-${scene}`, connectedLayerIndex: scene, prompt: name,
    duration, startTime: layers[scene].durationOffset + delta,
    endTime: layers[scene].durationOffset + delta + duration, connectedLayerStartTimeOffset: delta });
  const audioLayers = [speech('removed-first', 2, 0), speech('removed-second', 2, 2),
    speech('removed-last', 12, 0), speech('retained-first', 3, 0.5), speech('retained-second', 3, 2.5),
    { ...speech('legacy-index-only', 4, 1), connectedLayerId: undefined },
    { _id: 'music', generationType: 'music', startTime: 0, endTime: offset + 8, duration: offset + 8 }];
  // Hydrated legacy documents can carry a default zero despite a real offset.
  audioLayers.find((audio) => audio._id === 'retained-first').connectedLayerStartTimeOffset = 0;
  let state = { _id: 'session', userId: 'user', layers, audioLayers, totalDuration: offset + 8,
    movieResourceList: { scenes, sounds: audioLayers.filter((audio) => audio.generationType === 'speech')
      .map((audio) => ({ sceneIndex: audio.connectedLayerIndex, type: 'speech', audio: audio.prompt, duration: audio.duration })) } };
  let saves = 0;
  const read = () => {
    const doc = structuredClone(state);
    doc.markModified = () => {};
    doc.save = async () => {
      if (failSave) throw new Error('database save unavailable');
      saves++;
      state = structuredClone(Object.fromEntries(Object.entries(doc).filter(([, value]) => typeof value !== 'function')));
      return doc;
    };
    return doc;
  };
  return { get state() { return state; }, get saves() { return saves; },
    dependencies: { connect: async () => {}, VideoSessionModel: { findOne: async () => read(), findById: async () => read() } } };
}

test('automatic delete/reflow saves the retained current narrative and every connected clip atomically', async () => {
  const f = reflowFixture({ failed: [2, 12] });
  const immutable = structuredClone(f.state.layers[3].sourceSceneRef);
  const musicDuration = f.state.audioLayers.find((audio) => audio._id === 'music').duration;
  await __testOnly__.deleteEmptyLayersAndReflowTimeLine('session', f.dependencies);
  const { state } = f;
  assert.deepEqual(state.layers.map((layer) => layer._id), ['layer-0', 'layer-1', ...Array.from({ length: 9 }, (_, i) => `layer-${i + 3}`), 'outro']);
  assert.equal(state.movieResourceList.scenes.length, 11);
  assert.deepEqual(state.movieResourceList.scenes.map((scene) => scene.timelineLayerId), state.layers.slice(0, -1).map((layer) => layer._id));
  assert.equal(state.movieResourceList.scenes[1].duration, 121 / 24);
  assert.deepEqual(state.layers[2].sourceSceneRef, immutable);
  assert.equal(f.saves, 2, 'each removed scene is persisted with its audio and current plan in one save');
  assert.equal(state.audioLayers.some((audio) => audio._id.startsWith('removed-')), false);
  const retained = state.audioLayers.filter((audio) => audio.connectedLayerId === 'layer-3');
  assert.deepEqual(retained.map((audio) => audio.connectedLayerStartTimeOffset), [0.5, 2.5]);
  assert.deepEqual(retained.map((audio) => audio.startTime - state.layers[2].durationOffset), [0.5, 2.5]);
  const legacy = state.audioLayers.find((audio) => audio._id === 'legacy-index-only');
  assert.equal(legacy.connectedLayerId, 'layer-4');
  assert.equal(legacy.connectedLayerIndex, 3);
  assert.equal(legacy.startTime, state.layers[3].durationOffset + 1);
  const music = state.audioLayers.find((audio) => audio._id === 'music');
  assert.equal(music.endTime, state.totalDuration);
  assert.equal(music.duration, musicDuration, 'source music asset duration is retained');
  assert.equal(state.movieResourceList.sounds.some((sound) => sound.audio.startsWith('removed-')), false);
  assert.deepEqual(state.movieResourceList.sounds.filter((sound) => sound.audio.startsWith('retained-')).map((sound) => sound.sceneIndex), [2, 2]);
});

test('a no-deletion reflow reconciles finalized durations without changing immutable provenance', async () => {
  const f = reflowFixture();
  const before = structuredClone(f.state.layers.map((layer) => layer.sourceSceneRef));
  await __testOnly__.deleteEmptyLayersAndReflowTimeLine('session', f.dependencies);
  assert.equal(f.state.layers.length, 14);
  assert.equal(f.state.movieResourceList.scenes.length, 13, 'the outro stays outside narrative scenes');
  assert.equal(f.state.movieResourceList.scenes[1].duration, 121 / 24);
  assert.deepEqual(f.state.layers.map((layer) => layer.sourceSceneRef), before);
  assert.equal(f.saves, 1);
});

test('legacy index-only audio is removed with its scene and a failed save propagates', async () => {
  const f = reflowFixture();
  // The legacy clip belongs to scene four without a connectedLayerId.
  await removeLayerInSession('user', { sessionId: 'session', layerId: 'layer-4' }, f.dependencies);
  assert.equal(f.state.audioLayers.some((audio) => audio._id === 'legacy-index-only'), false);
  assert.equal(f.state.movieResourceList.scenes.some((scene) => scene.timelineLayerId === 'layer-4'), false);
  const failing = reflowFixture({ failed: [2], failSave: true });
  await assert.rejects(__testOnly__.deleteEmptyLayersAndReflowTimeLine('session', failing.dependencies), /database save unavailable/);
  assert.equal(failing.saves, 0);
  assert.equal(failing.state.layers.length, 14);
});

test('branched delete/reflow leaves the shared media catalog and narrative tree unchanged', async () => {
  let saves = 0;
  const session = { _id: 'session', narrativeType: 'branched', layers: [], branchRenderPaths: [{ pathId: 'root.1' }],
    movieResourceList: { schema: 'branching_narrative.v1', nodes: [{ nodeId: 'root' }] }, save: async () => { saves++; } };
  const original = structuredClone(Object.fromEntries(Object.entries(session).filter(([, value]) => typeof value !== 'function')));
  await __testOnly__.deleteEmptyLayersAndReflowTimeLine('session', { VideoSessionModel: { findById: async () => session } });
  assert.equal(saves, 0);
  assert.deepEqual(Object.fromEntries(Object.entries(session).filter(([, value]) => typeof value !== 'function')), original);
});

test('audio failure keeps the actionable failed-layer error instead of replacing it with a generic message', () => {
  const message = 'Fal rejected the audio API key (HTTP 401). Update the Fal credential.';
  assert.equal(__testOnly__.resolveAudioGenerationFailureMessage({
    audioLayers: [
      { generationStatus: 'COMPLETED', generationError: 'stale error' },
      { generationStatus: 'FAILED', generationType: 'speech' },
      { generationStatus: 'FAILED', generationType: 'music', generationError: message },
    ],
    expressGenerationError: 'Audio generation failed',
  }), message);
  assert.equal(__testOnly__.resolveAudioGenerationFailureMessage({
    expressGenerationError: 'Audio provider timed out',
  }), 'Audio provider timed out');
  assert.equal(__testOnly__.resolveAudioGenerationFailureMessage({}), 'Audio generation failed');
});

test('delete/reflow visual predicate treats activeGeneratedImage as a valid still visual', () => {
  assert.equal(
    __testOnly__.hasLayerStillVisuals({
      imageSession: {
        activeItemList: [],
        activeGeneratedImage: 'assets_v2/generations/reroll-session/scene.png',
      },
      aiVideoGenerationStatus: 'FAILED',
    }),
    true,
  );
});

test('delete/reflow visual predicate ignores empty image items', () => {
  assert.equal(
    __testOnly__.hasLayerStillVisuals({
      imageSession: {
        activeItemList: [
          { type: 'image', src: '', is_base_image: true },
        ],
      },
    }),
    false,
  );
});

test('exhausted AI-video layers are removed during reflow even when a still image remains', () => {
  const exhaustedLayer = {
    layerAiVideoType: 'narration',
    aiVideoGenerationStatus: 'FAILED',
    processVideoGenerationFailed: true,
    hasAiVideoLayer: false,
    imageSession: {
      activeGeneratedImage: 'assets_v2/generations/session/scene.png',
    },
  };

  assert.equal(__testOnly__.hasLayerStillVisuals(exhaustedLayer), true);
  assert.equal(__testOnly__.shouldRemoveLayerDuringDeleteReflow(exhaustedLayer), true);
});

test('completed AI-video layers are preserved during delete/reflow', () => {
  assert.equal(__testOnly__.shouldRemoveLayerDuringDeleteReflow({
    layerAiVideoType: 'narration',
    aiVideoGenerationStatus: 'COMPLETED',
    hasAiVideoLayer: true,
    aiVideoRemoteLink: 'https://static.samsar.one/video.mp4',
  }), false);
});

test('managed individual AI-video failure continues to delete/reflow instead of failing the session', () => {
  const managedFailure = {
    layerAiVideoType: 'narration',
    aiVideoGenerationStatus: 'FAILED',
    processVideoGenerationFailed: true,
    hasAiVideoLayer: false,
  };
  const unmanagedFailure = {
    layerAiVideoType: 'narration',
    aiVideoGenerationStatus: 'FAILED',
    processVideoGenerationFailed: false,
    hasAiVideoLayer: false,
  };

  assert.equal(__testOnly__.isFailedAiVideoLayerQueuedForDeleteReflow(managedFailure), true);
  assert.equal(__testOnly__.getFailedRequiredAiVideoLayer([managedFailure]), null);
  assert.equal(__testOnly__.getFailedRequiredAiVideoLayer([unmanagedFailure]), unmanagedFailure);
});

test('AI video output predicate accepts remote-only reusable AI videos', () => {
  assert.equal(
    __testOnly__.hasGeneratedAiVideoOutput({
      hasAiVideoLayer: true,
      aiVideoRemoteLink: 'https://static.samsar.one/assets_v2/user_resources/user-1/ai_videos/session/layer/video.mp4',
    }),
    true,
  );
});

test('transcript result helper keeps in-memory generation status synchronized', () => {
  const status = {
    transcript_generation: 'PENDING',
    frame_generation: 'INIT',
  };

  assert.equal(
    __testOnly__.applyTranscriptGenerationResultToStatus(status, true),
    'COMPLETED',
  );
  assert.equal(status.transcript_generation, 'COMPLETED');

  assert.equal(
    __testOnly__.applyTranscriptGenerationResultToStatus(status, false),
    'FAILED',
  );
  assert.equal(status.transcript_generation, 'FAILED');
});

test('disabled and skipped narrator stages advance the step without billing', async () => {
  const calls = [];
  const completeStage = async (...args) => {
    calls.push(args);
    return { ok: true, paused: false };
  };

  await __testOnly__.completeNarratorAvatarStage('session-id', { completeStage });
  await __testOnly__.completeNarratorAvatarStage('session-id', {
    required: true,
    skipped: true,
    completeStage,
  });
  await __testOnly__.completeNarratorAvatarStage('session-id', {
    required: true,
    completeStage,
  });

  assert.deepEqual(calls, [
    ['session-id', 'narrator_avatar_generation', { skipBilling: true }],
    ['session-id', 'narrator_avatar_generation', { skipBilling: true }],
    ['session-id', 'narrator_avatar_generation', { skipBilling: false }],
  ]);
});

test('pipeline finalizer waits when its step charge is deferred or paused', () => {
  assert.equal(__testOnly__.canFinalizeExpressPipelineAfterStage({ ok: true, deferred: true }), false);
  assert.equal(__testOnly__.canFinalizeExpressPipelineAfterStage({ ok: true, paused: true }), false);
  assert.equal(__testOnly__.canFinalizeExpressPipelineAfterStage({ ok: false }), false);
  assert.equal(__testOnly__.canFinalizeExpressPipelineAfterStage({ ok: true, paused: false }), true);
});

test('skipped lip sync advances the step without charging its stage', async () => {
  const calls = [];
  const completeStage = async (...args) => {
    calls.push(args);
    return { ok: true, paused: false };
  };

  await __testOnly__.completeLipSyncStage('session-id', { skipped: true, completeStage });
  await __testOnly__.completeLipSyncStage('session-id', { skipped: false, completeStage });
  await __testOnly__.completeLipSyncStage('session-id', { requiredCount: 0, completeStage });

  assert.deepEqual(calls, [
    ['session-id', 'lip_sync_generation', { skipBilling: true }],
    ['session-id', 'lip_sync_generation', { skipBilling: false }],
    ['session-id', 'lip_sync_generation', { skipBilling: true }],
  ]);
  assert.equal(__testOnly__.isLipSyncStageReadyToComplete('FAILED', 'COMPLETE'), true);
  assert.equal(__testOnly__.isLipSyncStageReadyToComplete('FAILED', 'WAIT'), false);
});

test('INIT lip sync enqueues a preflagged character layer before any request exists', async () => {
  const assessment = assessLipSyncStage([{
    _id: 'character-1',
    layerAiVideoType: 'character',
    hasAiVideoLayer: true,
    aiVideoLayer: '/assets_v2/ai_video/character-1.mp4',
    aiVideoGenerationStatus: 'COMPLETED',
    lipSyncGenerationPending: true,
    lipSyncVideoGenerationStatus: 'INIT',
  }], [{
    _id: 'speech-1',
    generationType: 'speech',
    connectedLayerId: 'character-1',
  }]);
  assert.equal(assessment.state, 'PENDING');
  assert.equal(assessLipSyncFallback(assessment).state, 'WAIT');

  const calls = [];
  const generationStatus = { lip_sync_generation: 'INIT', sound_effect_generation: 'INIT' };
  const result = await __testOnly__.advanceInitialLipSyncStage(
    'session-1',
    'session-1',
    generationStatus,
    assessLipSyncFallback(assessment).state,
    {
      updateSession: async (...args) => calls.push(['update', ...args]),
      generateForSession: async (sessionId) => calls.push(['enqueue', sessionId]),
    },
  );

  assert.equal(result, 'PENDING');
  assert.equal(generationStatus.lip_sync_generation, 'PENDING');
  assert.deepEqual(calls.map(([operation]) => operation), ['update', 'enqueue']);
  assert.equal(calls[0][1]._id, 'session-1');
  assert.equal(calls[0][2].$set['expressGenerationStatus.lip_sync_generation'], 'PENDING');
  assert.equal(calls[1][1], 'session-1');
});

test('INIT lip sync completes without enqueue when all required outputs exist', async () => {
  const calls = [];
  const generationStatus = { lip_sync_generation: 'INIT' };
  const result = await __testOnly__.advanceInitialLipSyncStage(
    'session-1',
    'session-1',
    generationStatus,
    'COMPLETE',
    {
      updateSession: async (...args) => calls.push(['update', ...args]),
      generateForSession: async (sessionId) => calls.push(['enqueue', sessionId]),
    },
  );

  assert.equal(result, 'COMPLETED');
  assert.equal(generationStatus.lip_sync_generation, 'COMPLETED');
  assert.deepEqual(calls.map(([operation]) => operation), ['update']);
  assert.equal(calls[0][2].$set['expressGenerationStatus.lip_sync_generation'], 'COMPLETED');
});

test('lip-sync skip stores one reason without changing character or audio layers', async () => {
  let skipped = false;
  let recordedUpdate;
  const updateSession = async (query, update) => {
    assert.deepEqual(query, { _id: 'session-id', lipSyncGenerationSkipped: { $ne: true } });
    if (skipped) return { modifiedCount: 0 };
    skipped = true;
    recordedUpdate = update;
    return { modifiedCount: 1 };
  };
  const failedAssessment = {
    layerId: 'character-1',
    status: 'FAILED',
    audioLayer: { _id: 'speech-1' },
    layer: { _id: 'character-1', lipSyncVideoGenerationError: 'Provider rejected audio.' },
  };

  await __testOnly__.skipLipSyncGenerationStage(
    'session-id', { lip_sync_generation: 'PENDING', sound_effect_generation: 'INIT' },
    failedAssessment, { updateSession },
  );
  await __testOnly__.skipLipSyncGenerationStage(
    'session-id', { lip_sync_generation: 'PENDING', sound_effect_generation: 'INIT' },
    failedAssessment, { updateSession },
  );

  assert.equal(recordedUpdate.$set.expressGenerationStatus.lip_sync_generation, 'COMPLETED');
  assert.equal(recordedUpdate.$set.expressGenerationStatus.sound_effect_generation, 'INIT');
  assert.equal(recordedUpdate.$set.lipSyncGenerationSkipped, true);
  assert.equal(recordedUpdate.$set.lipSyncGenerationSkipReason, 'Provider rejected audio.');
  assert.equal(recordedUpdate.$set.lipSyncGenerationPending, false);
  assert.equal(recordedUpdate.$set.layers, undefined);
  assert.equal(recordedUpdate.$set.audioLayers, undefined);
});

test('concurrent INIT ticks claim lip-sync enqueue once', async () => {
  let currentStage = 'INIT';
  let generated = 0;
  const updateSession = async (_filter, update) => {
    if (currentStage !== 'INIT') return { matchedCount: 0, modifiedCount: 0 };
    currentStage = update.$set['expressGenerationStatus.lip_sync_generation'];
    return { matchedCount: 1, modifiedCount: 1 };
  };
  const results = await Promise.all([1, 2].map(() => __testOnly__.advanceInitialLipSyncStage(
    'session', 'session', { lip_sync_generation: 'INIT' }, 'WAIT',
    { updateSession, generateForSession: async () => { generated++; } },
  )));
  assert.equal(generated, 1);
  assert.deepEqual(results.sort(), ['DEFERRED', 'PENDING']);
});

test('terminal network failure settles only after an active guarded update wins', async () => {
  const session = {
    _id: 'session', expressGenerationPending: true,
    expressGenerationStatus: { audio_generation: 'FAILED' },
    audioLayers: [{ _id: 'speech', generationStatus: 'FAILED' }],
    providerNetworkFailure: { stage: 'audio_generation', audioLayerId: 'speech', requestId: 'request', code: 'PROVIDER_NETWORK_RETRY_EXHAUSTED', message: 'Connection recovery exhausted' },
  };
  let settled = 0;
  let recorded;
  const completeFailure = async () => { settled++; };
  assert.equal(await __testOnly__.failSessionForProviderNetworkFailure(session, {
    updateSession: async (filter, update) => { recorded = { filter, update }; return { modifiedCount: 0 }; }, completeFailure,
  }), true);
  assert.equal(settled, 0);
  await __testOnly__.failSessionForProviderNetworkFailure(session, {
    updateSession: async () => ({ modifiedCount: 1 }), completeFailure,
  });
  assert.equal(settled, 1);
  assert.equal(recorded.filter['providerNetworkFailure.requestId'], 'request');
  assert.equal(recorded.filter.audioLayers.$elemMatch._id, 'speech');
  assert.equal(recorded.update.$set['expressGenerationStatus.audio_generation'], 'FAILED');
  assert.equal(recorded.update.$set.expressGenerationPending, false);
  assert.equal(recorded.update.$set.audioGenerationPending, false);
  assert.equal(recorded.update.$set.undefined, undefined);
});
