import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSourceSceneFields,
  captureSessionSceneReferences,
  getSourceSceneCatalog,
  resolveLayerSourceSceneReference,
} from './SceneIdentity.js';
import { recalculateLayerOffsetsAndConnectedAudio } from './ConnectedAudioTimeline.js';
import { generateBranchingNarrativeTree } from '../movie_session/branching/BranchingNarrativeTree.js';
import { buildBranchedVideoSessionPlan } from '../movie_session/branching/BranchedVideoSessionPlan.js';
import mongoose from 'mongoose';

function session(visuals = ['A lake', 'A harbor']) {
  return {
    _id: 'source-session',
    themeJson: { setting: 'travel' },
    movieResourceList: { scenes: visuals.map((visual) => ({ visual, duration: 2, type: 'scene' })), sounds: [] },
    layers: visuals.map((visual, index) => ({ _id: `layer-${index}`, originalImageGenerationPrompt: visual,
      prompt: visual, duration: 2, durationOffset: index * 2, imageSession: {} })),
    audioLayers: [],
  };
}

test('P2P source snapshots clone only the selected scene sounds and preserve index zero', () => {
  const scene = { visual: 'A lake', duration: 5 };
  const sounds = [{ sceneIndex: 0, audio: 'water' }, { sceneIndex: 1, audio: 'traffic' }];
  const theme = { setting: 'nature' };
  const result = buildSourceSceneFields({ sourceSessionId: 'original', sceneIndex: 0, scene,
    sounds, themeJson: theme });
  assert.equal(result.sourceSceneIndex, 0);
  assert.deepEqual(result.sourceSceneRef.sounds, [sounds[0]]);
  scene.visual = 'changed'; sounds[0].audio = 'changed'; theme.setting = 'changed';
  assert.equal(result.sourceSceneRef.scene.visual, 'A lake');
  assert.equal(result.sourceSceneRef.sounds[0].audio, 'water');
  assert.equal(result.sourceSceneRef.themeJson.setting, 'nature');
  assert.deepEqual(buildSourceSceneFields({ sceneIndex: '0oops', scene }), {});
});

test('a compacted current plan restores original identity without merging the old narrative by position', () => {
  const data = {
    _id: 'current-session',
    movieResourceList: { scenes: [
      { visual: 'Current second shot', duration: 121 / 24, timelineLayerId: 'second', sourceSessionId: 'origin', sourceSceneIndex: 7 },
      { visual: 'Current first shot', duration: 3, timelineLayerId: 'first', sourceSessionId: 'origin', sourceSceneIndex: 2 },
    ], sounds: [{ type: 'speech', sceneIndex: 0, audio: 'Second line', duration: 2 }] },
    narrativeJson: { scenes: [{ visual: 'Old first shot', duration: 10 }, { visual: 'Old second shot', duration: 10 }] },
    layers: [{ _id: 'second' }, { _id: 'first' }], audioLayers: [],
  };
  captureSessionSceneReferences(data);
  assert.equal(data.layers[0].sourceSceneRef.sourceSessionId, 'origin');
  assert.equal(data.layers[0].sourceSceneRef.sceneIndex, 7);
  assert.equal(data.layers[0].sourceSceneRef.scene.visual, 'Current second shot');
  assert.equal(data.layers[0].sourceSceneRef.scene.duration, 121 / 24);
  assert.equal(data.layers[0].sourceSceneRef.sounds[0].sceneIndex, 7);
  assert.equal(data.layers[1].sourceSceneRef.sceneIndex, 2);
});

test('F2P the production-shaped thirteen-scene SFX session resolves despite its separate outro', () => {
  const data = session(Array.from({ length: 13 }, (_, index) => `Expanded scene ${index}`));
  data.layers[0].layerBaseAiImageType = 'sound_effect';
  data.narrativeJson = { scenes: data.movieResourceList.scenes.map((scene, index) => ({ ...scene, visual: `Raw scene ${index}` })) };
  data.layers.push({ _id: 'outro', layerBaseAiImageType: 'none', skipAiVideoGeneration: true, imageSession: {} });
  data.audioLayers = [{ connectedLayerId: 'layer-0', generationType: 'sound_effect' }];
  const result = resolveLayerSourceSceneReference(data, data.layers[0], 0);
  assert.equal(result.sourceSceneIndex, 0);
  assert.equal(result.sourceSceneRef.scene.visual, 'Raw scene 0');
  assert.equal(result.sourceSceneRef.sourceSessionId, 'source-session');
  assert.equal(result.sourceSceneIndexSource, 'sourceLayer.originalPromptMatch');
  assert.equal(resolveLayerSourceSceneReference(data, data.layers.at(-1), 13).reason, 'non_narrative_layer');
});

test('F2P capture before reorder keeps original narrative identity when connected audio indexes move', () => {
  const data = session();
  data.audioLayers = [{ connectedLayerId: 'layer-1', connectedLayerIndex: 1, generationType: 'speech',
    startTime: 2, endTime: 4, duration: 2 }];
  captureSessionSceneReferences(data);
  data.layers.reverse();
  recalculateLayerOffsetsAndConnectedAudio(data.layers, data.audioLayers);
  assert.equal(data.audioLayers[0].connectedLayerIndex, 0);
  assert.equal(data.audioLayers[0].sourceSceneIndex, 1);
  const result = resolveLayerSourceSceneReference(data, data.layers[0], 0);
  assert.equal(result.sourceSceneIndex, 1);
  assert.equal(result.sourceSceneRef.scene.visual, 'A harbor');
});

test('F2P capturing a hydrated strict-false subdocument persists source metadata in its serialized document', () => {
  const child = new mongoose.Schema({ prompt: String, imageSession: new mongoose.Schema({}, { strict: false }) }, { strict: false });
  const schema = new mongoose.Schema({ layers: [child], audioLayers: [new mongoose.Schema({}, { strict: false })] }, { strict: false });
  const Model = mongoose.models.SceneIdentityPersistenceTest || mongoose.model('SceneIdentityPersistenceTest', schema);
  const layerId = new mongoose.Types.ObjectId();
  const data = Model.hydrate({ _id: new mongoose.Types.ObjectId(),
    movieResourceList: { scenes: [{ visual: 'A lake' }] },
    layers: [{ _id: layerId, prompt: 'A lake', imageSession: {} }],
    audioLayers: [{ _id: new mongoose.Types.ObjectId(), connectedLayerId: String(layerId) }],
  });
  captureSessionSceneReferences(data);
  const saved = data.toObject();
  assert.equal(saved.layers[0].sourceSceneIndex, 0);
  assert.equal(saved.layers[0].sourceSceneRef.scene.visual, 'A lake');
  assert.equal(saved.layers[0].imageSession.sourceSceneRef.scene.visual, 'A lake');
  assert.equal(saved.audioLayers[0].sourceSceneIndex, 0);
  assert.equal(data.layers[0].sourceSceneRef.scene.visual, 'A lake');
});

test('F2P a previously reordered legacy layer resolves by original prompt ahead of stale audio position', () => {
  const data = session();
  data.layers.reverse();
  data.audioLayers = [{ connectedLayerId: 'layer-1', connectedLayerIndex: 0 }];
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).sourceSceneIndex, 1);
});

test('F2P every linked audio row is inspected regardless of unindexed sound-effect row ordering', () => {
  const data = session(['One', 'Two', 'Three']);
  data.layers = [{ _id: 'only-layer', imageSession: {} }];
  data.audioLayers = [{ connectedLayerId: 'only-layer', generationType: 'sound_effect' },
    { connectedLayerId: 'only-layer', connectedLayerIndex: 2, generationType: 'speech' }];
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).sourceSceneIndex, 2);
  data.audioLayers.reverse();
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).sourceSceneIndex, 2);
});

test('ambiguous duplicate prompts and conflicting audio mappings return explicit reasons', () => {
  const duplicate = session(['Repeated shot', 'Repeated shot']);
  duplicate.layers.pop();
  assert.equal(resolveLayerSourceSceneReference(duplicate, duplicate.layers[0], 0).reason, 'ambiguous_original_prompt');
  const conflicting = session();
  conflicting.layers = [{ _id: 'only-layer', imageSession: {} }];
  conflicting.audioLayers = [{ connectedLayerId: 'only-layer', sourceSceneIndex: 0 },
    { connectedLayerId: 'only-layer', sourceSceneIndex: 1 }];
  assert.equal(resolveLayerSourceSceneReference(conflicting, conflicting.layers[0], 0).reason, 'conflicting_audio_scene_indexes');
  conflicting.audioLayers = [{ connectedLayerId: 'only-layer', connectedLayerIndex: 0 },
    { connectedLayerId: 'only-layer', connectedLayerIndex: 1 }];
  assert.equal(resolveLayerSourceSceneReference(conflicting, conflicting.layers[0], 0).reason, 'conflicting_connected_audio_indexes');
});

test('F2P repeated visuals cannot be disambiguated by a mutable connected-audio position', () => {
  const data = session(['Repeated shot', 'Repeated shot']);
  data.movieResourceList.scenes[0].speaker = 'First narrator';
  data.movieResourceList.scenes[1].speaker = 'Second narrator';
  data.layers.reverse();
  data.audioLayers = [{ connectedLayerId: 'layer-1', connectedLayerIndex: 0 }];
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).reason, 'ambiguous_original_prompt');
  data.audioLayers[0].sourceSceneIndex = 1;
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).sourceSceneIndex, 1,
    'a genuine immutable source index can disambiguate repeated visuals');
});

test('F2P a malformed snapshot sound collection is rejected before visual regeneration', () => {
  const data = session();
  const fields = buildSourceSceneFields({ sourceSessionId: 'original', sceneIndex: 0, scene: { visual: 'A valid shot' } });
  fields.sourceSceneRef.sounds = { unexpected: true };
  Object.assign(data.layers[0], fields);
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).reason, 'invalid_source_scene_reference');
  delete fields.sourceSceneRef.sounds;
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).sourceSceneIndex, 0,
    'an omitted optional sounds array remains valid');
});

test('contradictory order cannot silently use the equal-count positional fallback', () => {
  const data = session(['One', 'Two', 'Three']);
  data.layers = [{ _id: 'unknown', imageSession: {} }, data.layers[0], data.layers[2]];
  const result = resolveLayerSourceSceneReference(data, data.layers[0], 0);
  assert.equal(result.sourceSceneIndex, null);
  assert.equal(result.reason, 'scene_mapping_ambiguous');
});

test('unknown expanded original prompts do not validate a historical reorder or mutable audio indices', () => {
  const data = session(['Raw lake', 'Raw harbor']);
  data.layers.reverse();
  data.layers[0].originalImageGenerationPrompt = 'Expanded cinematic harbor';
  data.layers[0].prompt = 'Expanded cinematic harbor';
  data.layers[1].originalImageGenerationPrompt = 'Expanded cinematic lake';
  data.layers[1].prompt = 'Expanded cinematic lake';
  data.audioLayers = [{ connectedLayerId: 'layer-1', connectedLayerIndex: 0 }];
  const result = resolveLayerSourceSceneReference(data, data.layers[0], 0);
  assert.equal(result.sourceSceneIndex, null);
  assert.equal(result.reason, 'scene_mapping_ambiguous');
});

test('P2P generated orientation suffixes do not hide an exact original visual match after reordering', () => {
  const data = session();
  data.layers.reverse();
  data.layers[0].originalImageGenerationPrompt += ' Create the image upright in aspect ratio 9:16.';
  data.layers[0].prompt = data.layers[0].originalImageGenerationPrompt;
  data.audioLayers = [{ connectedLayerId: 'layer-1', connectedLayerIndex: 0 }];
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).sourceSceneIndex, 1);
});

test('malformed or conflicting immutable references never fall back to another scene', () => {
  const data = session();
  data.layers[0].sourceSceneRef = { version: 1, sceneIndex: 0 };
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).reason, 'invalid_source_scene_reference');
  Object.assign(data.layers[0], buildSourceSceneFields({ sourceSessionId: 'a', sceneIndex: 0, scene: { visual: 'One' } }));
  Object.assign(data.layers[0].imageSession, buildSourceSceneFields({ sourceSessionId: 'b', sceneIndex: 0, scene: { visual: 'Two' } }));
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).reason, 'conflicting_source_scene_references');
});

test('P2P a snapshot still resolves after cloning or joining into a different narrative context', () => {
  const data = session();
  captureSessionSceneReferences(data);
  const copied = JSON.parse(JSON.stringify(data));
  copied._id = 'joined-session'; copied.joinedSourceSessionIds = ['source-session', 'another-session'];
  copied.movieResourceList = { scenes: [{ visual: 'Unrelated first session' }] };
  copied.layers[1]._id = 'new-layer-id';
  const result = resolveLayerSourceSceneReference(copied, copied.layers[1], 1);
  assert.equal(result.sourceSceneIndex, 1);
  assert.equal(result.sourceSceneRef.sourceSessionId, 'source-session');
  assert.equal(result.sourceSceneRef.scene.visual, 'A harbor');
  delete copied.layers[1].sourceSceneRef; delete copied.layers[1].imageSession.sourceSceneRef;
  assert.equal(resolveLayerSourceSceneReference(copied, copied.layers[1], 1).reason, 'joined_scene_provenance_missing');
});

test('an immutable connected-audio snapshot can restore a missing layer reference without consulting a joined base narrative', () => {
  const data = session();
  data.joinedSourceSessionIds = ['first', 'second'];
  const fields = buildSourceSceneFields({ sourceSessionId: 'second', sceneIndex: 3, scene: { visual: 'Second session scene' } });
  data.audioLayers = [{ connectedLayerId: 'layer-0', ...fields }];
  const result = resolveLayerSourceSceneReference(data, data.layers[0], 0);
  assert.equal(result.sourceSceneIndex, 3);
  assert.equal(result.sourceSceneRef.sourceSessionId, 'second');
  assert.equal(result.sourceSceneRef.scene.visual, 'Second session scene');
  data.audioLayers.push({ connectedLayerId: 'layer-0', ...buildSourceSceneFields({ sourceSessionId: 'other', sceneIndex: 0, scene: { visual: 'Conflicting context' } }) });
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).reason, 'conflicting_audio_scene_references');
});

test('P2P ordinary equal-count and speech fallback sessions resolve without altering render fields', () => {
  const data = session();
  data.layers.forEach((layer) => { delete layer.originalImageGenerationPrompt; delete layer.prompt;
    layer.frames = ['0.png', '1.png']; layer.imageSession.activeItemList = [{ type: 'image', src: 'original.png' }]; });
  const before = structuredClone(data);
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[0], 0).sourceSceneIndexSource, 'layerIndexEqualSceneIndexFallback');
  captureSessionSceneReferences(data);
  for (let index = 0; index < data.layers.length; index++) {
    assert.equal(data.layers[index].duration, before.layers[index].duration);
    assert.equal(data.layers[index].durationOffset, before.layers[index].durationOffset);
    assert.deepEqual(data.layers[index].frames, before.layers[index].frames);
    assert.deepEqual(data.layers[index].imageSession.activeItemList, before.layers[index].imageSession.activeItemList);
  }
  const speech = session(['One', 'Two', 'Three', 'Four', 'Five']);
  speech.layers = [{ _id: 'speech-layer', imageSession: {} }];
  speech.audioLayers = [{ connectedLayerId: 'speech-layer', connectedLayerIndex: 4 }];
  assert.equal(resolveLayerSourceSceneReference(speech, speech.layers[0], 0).sourceSceneIndex, 4);
});

test('F2P narrative-only artifacts resolve, and unequal raw/movie scene arrays are not merged by position', () => {
  const data = session();
  data.narrativeJson = data.movieResourceList; delete data.movieResourceList;
  assert.equal(resolveLayerSourceSceneReference(data, data.layers[1], 1).sourceSceneIndex, 1);
  data.movieResourceList = { scenes: [{ visual: 'Canonical only' }], sounds: [] };
  assert.equal(getSourceSceneCatalog(data).scenes[0].visual, 'Canonical only');
});

test('F2P branch asset identity resolves the canonical pool scene instead of a repeated branch-local index', async () => {
  const resources = { scenes: Array.from({ length: 4 }, (_, index) => ({ visual: `Original ${index}`, type: 'base',
    duration: 5, startTime: index * 5, endTime: (index + 1) * 5, speaker: '' })), sounds: [] };
  const generated = await generateBranchingNarrativeTree({
    sourceMovieResourceList: resources, themeJson: {}, narrativeJson: {}, prompt: 'Branch test', numLevels: 1,
    generateDivergencePaths: async () => [{ path_name: 'Left', path_description: 'Left path' },
      { path_name: 'Right', path_description: 'Right path' }],
    generateBranchMovieResourceList: async ({ parentMovieResourceList, divergenceSceneIndex, divergence }) => {
      const child = structuredClone(parentMovieResourceList);
      for (let index = divergenceSceneIndex + 1; index < child.scenes.length; index++) child.scenes[index].visual = `${divergence.path_name} ${index}`;
      return child;
    },
    dependencies: { validateTextToVideoNarrative: (value) => ({ valid: true, errors: [], narrativeJson: structuredClone(value) }) },
  });
  const plan = buildBranchedVideoSessionPlan(generated.movieResourceList);
  const index = plan.canonicalMovieResourceList.scenes.findIndex((scene, candidate) => candidate !== scene.branchSourceSceneIndex);
  assert.ok(index >= 0);
  const scene = plan.canonicalMovieResourceList.scenes[index];
  const data = { _id: 'branch-source', movieResourceList: generated.movieResourceList, layers: [{
    _id: 'branch-layer', branchAssetKey: scene.branchAssetKey, branchSourceSceneIndex: scene.branchSourceSceneIndex,
    imageSession: {},
  }] };
  const result = resolveLayerSourceSceneReference(data, data.layers[0], 0);
  assert.equal(result.sourceSceneIndex, index);
  assert.equal(result.sourceSceneRef.scene.visual, scene.visual);
  assert.equal(result.sourceSceneIndexSource, 'sourceLayer.branchAssetKey');
});
