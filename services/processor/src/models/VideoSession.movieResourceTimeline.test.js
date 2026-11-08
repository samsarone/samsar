import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import mongoose from 'mongoose';
import VideoSession from '../schema/VideoSession.js';
import { captureMovieResourceTimeline, synchronizeMovieResourceTimeline } from '../utils/MovieResourceTimeline.js';
import { captureSessionSceneReferences, resolveLayerSourceSceneReference } from './video/SceneIdentity.js';
import {
  recalculateLayerOffsetsAndConnectedAudio,
  getConnectedAudioRelativeWindow,
  mapConnectedAudioWindowThroughEdgeTrim,
  applyConnectedAudioWindowToLayer,
} from './video/ConnectedAudioTimeline.js';

const source = fs.readFileSync(new URL('./VideoSession.js', import.meta.url), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const layerId = (index) => new mongoose.Types.ObjectId((index + 1).toString(16).padStart(24, '0'));

function fixture(durations = [10, 5, 10, 5], { hydrated = false } = {}) {
  let offset = 0;
  const movieResourceList = {
    title: 'A finalized film',
    scenes: durations.map((duration, i) => ({ visual: `Shot ${i}`, type: 'character', duration, metadata: { shot: i } })),
    sounds: durations.map((duration, i) => ({ type: 'character', sceneIndex: i, audio: `Line ${i}`, duration })),
  };
  const layers = durations.map((duration, i) => {
    const layer = {
      _id: layerId(i), duration, durationOffset: offset,
      layerBaseAiImageType: 'character', originalImageGenerationPrompt: `Shot ${i}`,
      imageSession: { activeItemList: [] },
    };
    offset += duration;
    return layer;
  });
  layers.push({ _id: layerId(100), duration: 8, durationOffset: offset,
    layerBaseAiImageType: 'none', imageSession: { activeItemList: [] } });
  const audioLayers = durations.map((duration, i) => ({
    _id: layerId(200 + i), connectedLayerId: String(layers[i]._id), connectedLayerIndex: i,
    generationType: 'speech', prompt: `Line ${i}`, duration,
    startTime: layers[i].durationOffset, endTime: layers[i].durationOffset + duration,
  }));
  const data = { _id: layerId(500), framesPerSecond: 24, movieResourceList, layers, audioLayers, totalDuration: offset + 8 };
  const session = hydrated ? new VideoSession(data) : data;
  if (!hydrated) {
    for (const layer of session.layers) layer.set = function (value) { Object.assign(this, value); };
  }
  const saves = [];
  session.save = async () => { saves.push(clone(session)); return session; };
  return { session, saves };
}

function harness(name, f, overrides = {}) {
  const writes = [];
  const context = {
    mongoose, fs: { existsSync: () => false }, path, process,
    captureMovieResourceTimeline, synchronizeMovieResourceTimeline,
    captureSessionSceneReferences, resolveLayerSourceSceneReference,
    recalculateLayerOffsetsAndConnectedAudio,
    getConnectedAudioRelativeWindow, mapConnectedAudioWindowThroughEdgeTrim, applyConnectedAudioWindowToLayer,
    getDBConnectionString: async () => {},
    getSessionFramesPerSecondWithLog: () => 24,
    normalizeAudioLayerArrayManualVolumeSettings: (rows) => rows,
    VideoSession: {
      findOne: () => Object.assign(Promise.resolve(f.session), { populate: async () => f.session }),
      findById: async () => f.session,
      updateOne: async (_query, update) => {
        writes.push(clone(update.$set));
        Object.assign(f.session, update.$set);
      },
    },
    deleteAllFramesForLayer: async () => {},
    deleteUnlockedStaleFrameGenerations: async () => {},
    ensureUnlockedFrameGenerations: async () => {},
    requestRealignConnectedAudioLayersToLayers: async () => {},
    generateTranscriptsForSessionAudioLayersAfterLayer: async () => {},
    removeTranscriptsForSessionAudioLayer: async () => {},
    generateTranscriptsForSessionAudioLayers: async () => {},
    ...overrides,
  };
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `Function ${name} exists`);
  const implementation = source.slice(start, source.indexOf('\n}', start) + 2).replace('export ', '');
  return { run: vm.runInNewContext(`${implementation}; ${name};`, context), writes };
}

test('manual sequential deletions persist only retained scenes and sounds, with immutable source provenance', async () => {
  const f = fixture([10, 5, 10, 5, 5, 5, 5, 5, 5, 10, 5, 10, 10], { hydrated: true });
  captureSessionSceneReferences(f.session);
  const retained = f.session.layers[3];
  const provenance = clone(retained.sourceSceneRef);
  const firstRemoved = String(f.session.layers[2]._id);
  const lastRemoved = String(f.session.layers[12]._id);
  f.session.layers[3].duration = 121 / 24;
  const { run } = harness('removeLayerInSession', f);
  await run('owner', { sessionId: String(f.session._id), layerId: firstRemoved });
  await run('owner', { sessionId: String(f.session._id), layerId: lastRemoved });
  assert.equal(f.saves.length, 2);
  const saved = f.saves.at(-1);
  assert.equal(saved.layers.length, 12);
  assert.equal(saved.movieResourceList.scenes.length, 11);
  assert.deepEqual(saved.movieResourceList.scenes.map((scene) => scene.visual),
    [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `Shot ${i}`));
  assert.equal(saved.movieResourceList.scenes[2].duration, 121 / 24);
  assert.equal(saved.layers.at(-1).duration, 8);
  assert.equal(saved.movieResourceList.sounds.length, 11);
  assert.deepEqual(saved.movieResourceList.sounds.map((sound) => sound.sceneIndex), [0,1,2,3,4,5,6,7,8,9,10]);
  assert.equal(saved.audioLayers.some((row) => [firstRemoved, lastRemoved].includes(row.connectedLayerId)), false);
  assert.deepEqual(clone(retained.sourceSceneRef), provenance);
  assert.equal(f.session.isModified('movieResourceList'), true);
});

test('manual duration finalization writes measured timing and current plan together', async () => {
  const f = fixture();
  const { run, writes } = harness('updateLayerForSession', f);
  await run({ sessionId: String(f.session._id), layer: { _id: f.session.layers[0]._id, duration: 121 / 24 } });
  const finalized = writes.find((write) => write.totalDuration != null);
  assert.ok(finalized.movieResourceList, 'Plan is included in the layer/audio update');
  assert.equal(finalized.layers[0].duration, 121 / 24);
  assert.equal(finalized.movieResourceList.scenes[0].duration, 121 / 24);
  assert.equal(finalized.layers[1].durationOffset, 121 / 24);
  assert.equal(finalized.movieResourceList.scenes.length, 4);
  assert.equal(finalized.movieResourceList.sounds[0].duration, Math.min(finalized.layers[0].duration, finalized.audioLayers[0].duration));
});

test('manual reorder projects current scene order and sounds without renumbering source snapshots', async () => {
  const f = fixture();
  captureSessionSceneReferences(f.session);
  const originalReference = clone(f.session.layers[2].sourceSceneRef);
  const order = [f.session.layers[2], f.session.layers[0], f.session.layers[1], f.session.layers[3], f.session.layers[4]];
  const { run } = harness('updateLayersOrder', f);
  await run({ sessionId: String(f.session._id), layers: order.map((layer) => String(layer._id)) });
  const saved = f.saves[0];
  assert.deepEqual(saved.movieResourceList.scenes.map((scene) => scene.visual), ['Shot 2', 'Shot 0', 'Shot 1', 'Shot 3']);
  assert.equal(saved.movieResourceList.sounds.find((sound) => sound.audio === 'Line 2').sceneIndex, 0);
  assert.deepEqual(saved.layers[0].sourceSceneRef, originalReference);
  assert.equal(saved.layers.at(-1).duration, 8);
});

test('copying a layer creates a distinct current plan entry while preserving its source scene', async () => {
  const f = fixture();
  const { run } = harness('copyLayerInSession', f);
  await run('owner', { sessionId: String(f.session._id), newLayer: clone(f.session.layers[1]), index: 3 });
  const saved = f.saves[0];
  assert.equal(saved.movieResourceList.scenes.length, 5);
  assert.deepEqual(saved.movieResourceList.scenes.map((scene) => scene.visual), ['Shot 0', 'Shot 1', 'Shot 2', 'Shot 1', 'Shot 3']);
  assert.notEqual(saved.movieResourceList.scenes[1].timelineLayerId, saved.movieResourceList.scenes[3].timelineLayerId);
  assert.equal(saved.layers[3].sourceSceneRef.sceneIndex, 1);
});

test('bulk Studio updates preserve provenance when client omits it and persist the new scene duration', async () => {
  const f = fixture();
  const nextLayers = clone([f.session.layers[2], f.session.layers[0], f.session.layers[1], f.session.layers[3], f.session.layers[4]]);
  nextLayers[0].duration = 121 / 24;
  const { run } = harness('updateSessionLayers', f);
  await run({ sessionId: String(f.session._id), layers: nextLayers, audioLayers: clone(f.session.audioLayers) });
  const saved = f.saves[0];
  assert.equal(saved.movieResourceList.scenes[0].visual, 'Shot 2');
  assert.equal(saved.movieResourceList.scenes[0].duration, 121 / 24);
  assert.equal(saved.movieResourceList.scenes[0].startTime, 0);
  assert.equal(saved.movieResourceList.scenes[1].startTime, 121 / 24);
  assert.equal(saved.layers[1].durationOffset, 121 / 24);
  assert.equal(saved.layers[0].sourceSceneRef.sceneIndex, 2);
  assert.equal(saved.layers[0].imageSession.sourceSceneRef.sceneIndex, 2);
});

test('blank scene insertion adds one current plan entry without changing retained scene identity', async () => {
  const f = fixture();
  const { run, writes } = harness('addNewLayerToSession', f);
  await run('owner', { sessionId: String(f.session._id), duration: 3, position: 'beginning' });
  const final = writes.find((write) => write.movieResourceList);
  assert.equal(final.movieResourceList.scenes.length, 5);
  assert.equal(final.movieResourceList.scenes[0].duration, 3);
  assert.deepEqual(final.movieResourceList.scenes.slice(1).map((scene) => scene.visual), ['Shot 0', 'Shot 1', 'Shot 2', 'Shot 3']);
  assert.equal(final.movieResourceList.scenes.at(-1).duration, 5);
  assert.equal(f.saves[0].audioLayers[0].startTime, 3, 'First save already moves retained speech');
  assert.equal(f.saves[0].movieResourceList.sounds.find((sound) => sound.audio === 'Line 0').startTime, 3);
  assert.equal(f.saves[0].totalDuration, f.session.totalDuration);
});

test('frame realignment saves actual media duration into the plan without touching an outro', async () => {
  const f = fixture([10, 5]);
  const { run } = harness('regenerateFramesForSession', f, {
    FrameGeneration: Object.assign(function FrameGeneration() { this.save = async () => {}; }, { deleteMany: async () => {} }),
    getProcessorAssetsRootCandidates: () => [],
    resolveFramesPerSecondOverride: () => null,
    hasAnyLayerVideoLink: (layer) => layer.layerBaseAiImageType !== 'none',
    resolveLayerDurationForRealign: async () => 121 / 24,
  });
  await run(String(f.session._id), true, { prepareAiVideoFrames: false });
  const saved = f.saves[0];
  assert.deepEqual(saved.movieResourceList.scenes.map((scene) => scene.duration), [121 / 24, 121 / 24]);
  assert.equal(saved.layers.at(-1).duration, 8);
  assert.equal(saved.totalDuration, (242 / 24) + 8);
});


test('speech duration realignment synchronizes scene budgets and sound offsets at its final save', async () => {
  const f = fixture([10, 5]);
  f.session.layers.pop(); // This operation only accepts one speech track per video layer.
  f.session.audioLayers[0].duration = 1.5;
  f.session.audioLayers[1].duration = 2.5;
  const { run } = harness('requestRealignLayersToSpeechAndRegenerateSubtitles', f);
  await run('owner', { sessionId: String(f.session._id) });
  const saved = f.saves[0];
  assert.deepEqual(saved.movieResourceList.scenes.map((scene) => scene.duration), [2.5, 4.5]);
  assert.deepEqual(saved.movieResourceList.sounds.map((sound) => sound.startTime), [1, 3.5]);
  assert.deepEqual(saved.movieResourceList.sounds.map((sound) => sound.duration), [1.5, 2.5]);
  assert.equal(saved.totalDuration, 7);
});


test('bulk Studio reorder keeps relative audio offsets when client omits audio, with IDs winning over stale indices', async () => {
  const f = fixture([10, 5]);
  f.session.audioLayers[1].startTime += 0.75;
  f.session.audioLayers[1].duration -= 0.75;
  // The ID remains authoritative even when this legacy position is wrong.
  f.session.audioLayers[1].connectedLayerIndex = 0;
  const nextLayers = clone([f.session.layers[1], f.session.layers[0], f.session.layers[2]]);
  nextLayers[0].durationOffset = 0;
  nextLayers[1].durationOffset = 5;
  const { run } = harness('updateSessionLayers', f);
  await run({ sessionId: String(f.session._id), layers: nextLayers });
  const saved = f.saves[0];
  assert.equal(saved.audioLayers[1].connectedLayerId, String(f.session.layers[0]._id));
  assert.equal(saved.audioLayers[1].connectedLayerIndex, 0);
  assert.equal(saved.audioLayers[1].startTime, 0.75);
  assert.equal(saved.audioLayers[1].duration, 4.25);
  const sound = saved.movieResourceList.sounds.find((row) => row.audio === 'Line 1');
  assert.equal(sound.sceneIndex, 0);
  assert.equal(sound.startTime, 0.75);
  assert.equal(sound.duration, 4.25);
});


test('bulk updates preserve branched asset-catalog offsets and topology', async () => {
  const f = fixture([10, 5]);
  const movie = { nodes: [{ id: 'root', scene: { visual: 'Root', duration: 10 }, children: ['left', 'right'] }], metadata: { topology: 'kept' } };
  f.session.movieResourceList = clone(movie);
  f.session.narrativeType = 'BRANCHED';
  const nextLayers = clone([f.session.layers[1], f.session.layers[0], f.session.layers[2]]);
  nextLayers[0].durationOffset = 0;
  nextLayers[1].durationOffset = 0;
  nextLayers[2].durationOffset = 10;
  const { run } = harness('updateSessionLayers', f);
  await run({ sessionId: String(f.session._id), layers: nextLayers });
  const saved = f.saves[0];
  assert.deepEqual(saved.layers.map((layer) => layer.durationOffset), [0, 0, 10]);
  assert.deepEqual(saved.movieResourceList, movie);
  assert.equal(saved.totalDuration, 23);
});

test('bulk updates retain existing no-plan behavior', async () => {
  const f = fixture([10, 5]);
  delete f.session.movieResourceList;
  const nextLayers = clone(f.session.layers);
  nextLayers[0].durationOffset = 2;
  const { run } = harness('updateSessionLayers', f);
  await run({ sessionId: String(f.session._id), layers: nextLayers });
  assert.equal(f.saves[0].layers[0].durationOffset, 2);
  assert.equal(f.saves[0].movieResourceList, undefined);
});
