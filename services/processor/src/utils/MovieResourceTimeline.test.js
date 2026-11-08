import test from 'node:test';
import assert from 'node:assert/strict';
import { captureMovieResourceTimeline, synchronizeMovieResourceTimeline } from './MovieResourceTimeline.js';

function fixture(durations = [10, 5, 10, 5]) {
  let offset = 0;
  const scenes = durations.map((duration, i) => ({ visual: `Scene ${i}`, type: 'character', duration,
    startTime: durations.slice(0, i).reduce((sum, n) => sum + n, 0), custom: `metadata ${i}` }));
  const sounds = scenes.map((scene, sceneIndex) => ({ sceneIndex, type: 'speech', audio: `Line ${sceneIndex}`, duration: scene.duration,
    startTime: scene.startTime, actor: 'Guide', voice: 'preserve' }));
  const layers = scenes.map((scene, i) => {
    const layer = { _id: `layer-${i}`, duration: scene.duration, durationOffset: offset, sourceSceneIndex: i,
      sourceSceneRef: { version: 1, sourceSessionId: 'original', sceneIndex: i, scene: structuredClone(scene),
        sounds: [structuredClone(sounds[i])] } };
    offset += scene.duration;
    return layer;
  });
  const audioLayers = layers.map((layer, i) => ({ _id: `audio-${i}`, connectedLayerId: layer._id,
    connectedLayerIndex: i, generationType: 'speech', prompt: `Line ${i}`, duration: layer.duration,
    startTime: layer.durationOffset, endTime: layer.durationOffset + layer.duration }));
  return { _id: 'original', layers, audioLayers, totalDuration: offset,
    movieResourceList: { title: 'Keep title', totalDuration: offset, duration: offset, scenes, sounds } };
}

function reflow(session) {
  let offset = 0;
  for (const [i, layer] of session.layers.entries()) {
    const delta = offset - layer.durationOffset;
    for (const audio of session.audioLayers.filter((audio) => audio.connectedLayerId === layer._id)) {
      audio.startTime += delta; audio.endTime += delta; audio.connectedLayerIndex = i;
    }
    layer.durationOffset = offset; offset += layer.duration;
  }
  session.totalDuration = offset;
}

test('13 planned scenes compact correctly across repeated deletions, preserve provenance and exclude outro', () => {
  const session = fixture([10, 5, 10, 5, 5, 5, 5, 5, 5, 10, 5, 10, 10]);
  const refs = session.layers.map((layer) => JSON.stringify(layer.sourceSceneRef));
  session.layers.push({ _id: 'outro', layerBaseAiImageType: 'none', duration: 8, durationOffset: 90 });
  captureMovieResourceTimeline(session);
  for (const sourceIndex of [2, 12]) {
    const removed = `layer-${sourceIndex}`;
    session.layers = session.layers.filter((layer) => layer._id !== removed);
    session.audioLayers = session.audioLayers.filter((audio) => audio.connectedLayerId !== removed);
    reflow(session);
    synchronizeMovieResourceTimeline(session);
  }
  assert.equal(session.movieResourceList.scenes.length, 11);
  assert.deepEqual(session.movieResourceList.scenes.map((scene) => scene.sourceSceneIndex), [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(session.movieResourceList.totalDuration, 78);
  assert.equal(session.movieResourceList.duration, 70);
  assert.equal(session.movieResourceList.title, 'Keep title');
  assert.deepEqual(session.movieResourceList.sounds.map((sound) => sound.sceneIndex), Array.from({ length: 11 }, (_, i) => i));
  assert.equal(session.movieResourceList.sounds[2].audio, 'Line 3');
  assert.equal(session.movieResourceList.scenes[2].custom, 'metadata 3');
  for (const layer of session.layers.slice(0, -1)) assert.equal(JSON.stringify(layer.sourceSceneRef), refs[layer.sourceSceneIndex]);
  assert.equal(synchronizeMovieResourceTimeline(session).changed, false, 'projection is idempotent');
});

test('measured fractional duration and retained connected audio offsets update the current plan exactly', () => {
  const session = fixture([10, 5]);
  captureMovieResourceTimeline(session);
  session.layers[0].duration = 121 / 24;
  session.audioLayers[0].duration = 3;
  session.audioLayers[0].startTime = 1;
  session.audioLayers[0].endTime = 4;
  session.audioLayers.push({ _id: 'second-speech', connectedLayerId: 'layer-0', generationType: 'speech',
    prompt: 'Another line', duration: 2, startTime: 4, endTime: 6 });
  session.audioLayers.push({ generationType: 'music', duration: 99, startTime: 0, endTime: 99 });
  reflow(session);
  synchronizeMovieResourceTimeline(session);
  assert.equal(session.movieResourceList.scenes[0].duration, 121 / 24);
  assert.equal(session.movieResourceList.scenes[1].startTime, 121 / 24);
  const speech = session.movieResourceList.sounds.filter((sound) => sound.sceneIndex === 0);
  assert.equal(speech.length, 2);
  assert.equal(speech[0].startTime, 1);
  assert.equal(speech[0].duration, 3);
  assert.equal(speech[0].voice, 'preserve');
  assert.equal(speech[1].duration, 121 / 24 - 4);
  assert.equal(speech[1].endTime, 121 / 24);
  assert.equal(session.audioLayers.at(-1).duration, 99, 'music asset length remains unchanged');
});

test('reordered and copied scenes keep distinct layer bindings even when source identities overlap', () => {
  const session = fixture([5, 10]);
  captureMovieResourceTimeline(session);
  const copied = structuredClone(session.layers[0]); copied._id = 'copy';
  session.layers = [session.layers[1], copied, session.layers[0]];
  reflow(session); synchronizeMovieResourceTimeline(session);
  assert.deepEqual(session.movieResourceList.scenes.map((scene) => scene.timelineLayerId), ['layer-1', 'copy', 'layer-0']);
  assert.deepEqual(session.movieResourceList.scenes.map((scene) => scene.duration), [10, 5, 5]);
  session.layers.splice(1, 1); reflow(session); synchronizeMovieResourceTimeline(session);
  assert.deepEqual(session.movieResourceList.scenes.map((scene) => scene.timelineLayerId), ['layer-1', 'layer-0']);
});

test('joined scenes with identical source indexes resolve by their source session as well', () => {
  const session = fixture([5, 10]);
  session.layers[1].sourceSceneRef.sourceSessionId = 'other';
  session.layers[1].sourceSceneRef.sceneIndex = 0;
  session.layers[1].sourceSceneIndex = 0;
  session.joinedSourceSessionIds = ['original', 'other'];
  synchronizeMovieResourceTimeline(session);
  assert.deepEqual(session.movieResourceList.scenes.map((scene) => [scene.sourceSessionId, scene.sourceSceneIndex, scene.duration]),
    [['original', 0, 5], ['other', 0, 10]]);
});

test('legacy mappings are captured before reorder; unresolved new layers gain current scenes', () => {
  const session = fixture([5, 10]);
  for (const layer of session.layers) { delete layer.sourceSceneIndex; delete layer.sourceSceneRef; }
  captureMovieResourceTimeline(session);
  session.layers.reverse();
  session.layers.push({ _id: 'new-layer', prompt: 'A new shot', duration: 3, durationOffset: 15 });
  reflow(session); synchronizeMovieResourceTimeline(session);
  assert.deepEqual(session.movieResourceList.scenes.map((scene) => scene.visual), ['Scene 1', 'Scene 0', 'A new shot']);
  assert.equal(session.movieResourceList.scenes[0].custom, 'metadata 1');
});

test('all narrative scenes can be removed without projecting the outro', () => {
  const session = fixture([5]); captureMovieResourceTimeline(session);
  session.layers = [{ _id: 'outro', duration: 8, durationOffset: 0, layerBaseAiImageType: 'none' }];
  session.audioLayers = []; synchronizeMovieResourceTimeline(session);
  assert.deepEqual(session.movieResourceList.scenes, []);
  assert.deepEqual(session.movieResourceList.sounds, []);
  assert.equal(session.movieResourceList.totalDuration, 8);
});

test('ambiguous legacy scenes and invalid durations leave the entire current plan unchanged', () => {
  const session = fixture([5, 5]);
  for (const layer of session.layers) { delete layer.sourceSceneRef; delete layer.sourceSceneIndex; layer.prompt = 'Repeated'; }
  for (const scene of session.movieResourceList.scenes) scene.visual = 'Repeated';
  session.layers.pop();
  const before = JSON.stringify(session.movieResourceList);
  assert.equal(synchronizeMovieResourceTimeline(session).reason, 'ambiguous_scene_mapping');
  assert.equal(JSON.stringify(session.movieResourceList), before);
  session.layers[0].duration = NaN;
  assert.equal(synchronizeMovieResourceTimeline(session).reason, 'invalid_layer_duration');
  assert.equal(JSON.stringify(session.movieResourceList), before);
});

test('malformed or conflicting immutable references never silently rewrite the current plan', () => {
  for (const malformed of [false, true]) {
    const session = fixture([5]);
    session.layers[0].imageSession = { sourceSceneRef: structuredClone(session.layers[0].sourceSceneRef) };
    if (malformed) session.layers[0].imageSession.sourceSceneRef.sounds = {};
    else session.layers[0].imageSession.sourceSceneRef.scene.visual = 'A different source shot';
    const before = JSON.stringify(session.movieResourceList);
    assert.equal(captureMovieResourceTimeline(session).changed, false);
    assert.equal(synchronizeMovieResourceTimeline(session).reason, 'ambiguous_scene_mapping');
    assert.equal(JSON.stringify(session.movieResourceList), before);
  }
});

test('unmatched legacy layers do not replace rich existing scenes with synthesized metadata', () => {
  const session = fixture([5, 5, 5]);
  session.layers.pop();
  for (const layer of session.layers) {
    delete layer.sourceSceneRef; delete layer.sourceSceneIndex;
    layer.originalImageGenerationPrompt = 'An unknown enriched visual';
  }
  const before = JSON.stringify(session.movieResourceList);
  assert.equal(captureMovieResourceTimeline(session).reason, 'ambiguous_scene_mapping');
  assert.equal(synchronizeMovieResourceTimeline(session).reason, 'ambiguous_scene_mapping');
  assert.equal(JSON.stringify(session.movieResourceList), before);
});

test('branch tree, canonical asset catalogs and absent plans remain unchanged', () => {
  for (const fields of [{ narrativeType: 'BRANCHED' }, { branchRenderPaths: [{ layerIds: ['layer-0'] }] },
    { branchingTimeline: { schema: 'v1' } }, { sourceNarrativeType: 'branched' }, { isBranchedVideo: true }]) {
    const session = Object.assign(fixture(), fields);
    const before = JSON.stringify(session);
    assert.equal(captureMovieResourceTimeline(session).changed, false);
    assert.equal(synchronizeMovieResourceTimeline(session).changed, false);
    assert.equal(JSON.stringify(session), before);
  }
  const session = fixture(); session.movieResourceList.nodes = [{ id: 'root' }];
  const before = JSON.stringify(session);
  synchronizeMovieResourceTimeline(session); assert.equal(JSON.stringify(session), before);
  assert.equal(synchronizeMovieResourceTimeline({ layers: [] }).changed, false);
});

test('pending audio templates retain relative timing when scenes move before generation', () => {
  const session = fixture([10, 5]); session.audioLayers = [];
  session.movieResourceList.sounds[1].startTime = 12;
  session.movieResourceList.sounds[1].duration = 2;
  captureMovieResourceTimeline(session);
  session.layers.reverse(); reflow(session); synchronizeMovieResourceTimeline(session);
  assert.equal(session.movieResourceList.sounds[0].startTime, 2);
  assert.equal(session.movieResourceList.sounds[0].endTime, 4);
});

test('identical dialogue from different actors retains the correct speaker and voice metadata', () => {
  const session = fixture([5]);
  session.movieResourceList.sounds = [
    { type: 'speech', sceneIndex: 0, actor: 'Alice', audio: 'Hello.', speakerVoiceId: 'alice', duration: 2 },
    { type: 'speech', sceneIndex: 0, actor: 'Bob', audio: 'Hello.', speakerVoiceId: 'bob', duration: 2 },
  ];
  session.audioLayers = [{ _id: 'bob-audio', connectedLayerId: 'layer-0', generationType: 'speech',
    speakerCharacterName: 'Bob', prompt: 'Hello.', duration: 2, startTime: 0 }];
  captureMovieResourceTimeline(session);
  synchronizeMovieResourceTimeline(session);
  assert.equal(session.movieResourceList.sounds.length, 1);
  assert.equal(session.movieResourceList.sounds[0].actor, 'Bob');
  assert.equal(session.movieResourceList.sounds[0].speakerVoiceId, 'bob');
  assert.equal(session.movieResourceList.sounds[0].timelineAudioId, 'bob-audio');
});
