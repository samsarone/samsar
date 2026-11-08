import test from 'node:test';
import assert from 'node:assert/strict';

import { realignAudioVideoLayerToVideoLayer } from './VideoGenerationListener.js';
import VideoSession from './schema/VideoSession.js';

const sourceSceneRef = {
  version: 1,
  sourceSessionId: 'original-session',
  sceneIndex: 7,
  scene: { visual: 'A soldier approaches the gate.', type: 'sound_effect' },
  sounds: [{ type: 'sound_effect', sceneIndex: 7, audio: 'Footsteps in sand.' }],
  themeJson: { setting: 'Ancient coastal camp' },
};

function fixture({ audio = [], layer = {} } = {}) {
  const calls = { save: 0, updates: [] };
  const currentLayer = {
    _id: 'layer-1',
    duration: 10,
    durationOffset: 15,
    layerAiVideoType: 'sound_effect',
    layerBaseAiImageType: 'sound_effect',
    sourceSceneIndex: 7,
    sourceSceneRef: structuredClone(sourceSceneRef),
    ...layer,
  };
  const session = {
    layers: [currentLayer],
    audioLayers: audio,
    save: async () => { calls.save += 1; },
  };
  const dependencies = {
    getDBConnectionString: async () => {},
    VideoSession: {
      findById: async () => session,
      updateOne: async (...args) => { calls.updates.push(args); },
    },
  };
  return { session, currentLayer, calls, dependencies };
}

const payload = {
  sessionId: 'current-session',
  layerId: 'layer-1',
  model: 'MIRELOAI',
  generationType: 'sound_effect',
  audioVideoAudioLink: '/assets_v2/audio/footsteps.wav',
  prompt: 'Footsteps in sand.',
  duration: 12,
};

test('F2P: completed sound-effect audio retains the original scene independently of timeline position', async () => {
  const f = fixture();
  await realignAudioVideoLayerToVideoLayer(payload, f.dependencies);
  const audio = f.session.audioLayers[0];
  assert.equal(audio.sourceSceneIndex, 7);
  assert.deepEqual(audio.sourceSceneRef, sourceSceneRef);
  assert.equal(audio.connectedLayerIndex, 0);
  assert.equal(audio.connectedLayerId, 'layer-1');
  assert.equal(audio.startTime, 15);
  assert.equal(audio.duration, 10);
  assert.equal(audio.endTime, 25);
  assert.equal(audio.volume, 30);
  assert.equal(audio.fadeOnEdges, true);
  assert.equal(f.calls.save, 0);
  assert.equal(f.calls.updates.length, 1);
  assert.notEqual(audio.sourceSceneRef, f.currentLayer.sourceSceneRef);
});

test('F2P: an existing sound-effect audio row gains immutable scene metadata without changing user volume', async () => {
  const oldAudio = { _id: 'audio-1', connectedLayerId: 'layer-1', volume: 17 };
  const f = fixture({ audio: [oldAudio] });
  await realignAudioVideoLayerToVideoLayer(payload, f.dependencies);
  const saved = f.calls.updates[0][1].$set['audioLayers.$[audio]'];
  assert.deepEqual(f.calls.updates[0][2].arrayFilters, [{ 'audio._id': 'audio-1' }]);
  assert.equal(saved.sourceSceneIndex, 7);
  assert.deepEqual(saved.sourceSceneRef, sourceSceneRef);
  assert.equal(saved.connectedLayerIndex, 0);
  assert.equal(saved.volume, 17);
  assert.equal(saved.startTime, 15);
  assert.equal(saved.endTime, 25);
  assert.equal(saved.generationStatus, 'COMPLETED');
  assert.equal(f.calls.save, 0);
});

test('F2P: immutable metadata can be recovered from the image session when the outer layer has none', async () => {
  const f = fixture({ layer: {
    sourceSceneIndex: undefined,
    sourceSceneRef: undefined,
    imageSession: { sourceSceneIndex: 7, sourceSceneRef: structuredClone(sourceSceneRef) },
  } });
  await realignAudioVideoLayerToVideoLayer(payload, f.dependencies);
  assert.equal(f.session.audioLayers[0].sourceSceneIndex, 7);
  assert.deepEqual(f.session.audioLayers[0].sourceSceneRef, sourceSceneRef);
});

test('F2P: existing hydrated audio subdocuments serialize newly propagated source metadata', async () => {
  const layerId = '6adb894178799c2a5633f4f6';
  const session = new VideoSession({
    _id: '6adb8221479bd46b07ca73f0',
    layers: [{
      _id: layerId, duration: 10, durationOffset: 15,
      layerAiVideoType: 'sound_effect', layerBaseAiImageType: 'sound_effect',
      sourceSceneIndex: 7, sourceSceneRef: structuredClone(sourceSceneRef),
    }],
    audioLayers: [{
      _id: '6adb8f6098a1b8e098e9945b', connectedLayerId: layerId, volume: 17,
    }],
  });
  let updated;
  await realignAudioVideoLayerToVideoLayer({ ...payload, layerId }, {
    getDBConnectionString: async () => {},
    VideoSession: { findById: async () => session, updateOne: async (_query, update) => { updated = update; } },
  });
  const persistedAudio = updated.$set['audioLayers.$[audio]'].toObject();
  assert.equal(persistedAudio.sourceSceneIndex, 7);
  assert.deepEqual(persistedAudio.sourceSceneRef, sourceSceneRef);
  assert.equal(persistedAudio.volume, 17);
  assert.equal(persistedAudio.duration, 10);
});

test('P2P: ordinary speech alignment keeps centering, duration, volume and existing scene identity', async () => {
  const oldAudio = {
    _id: 'audio-1', connectedLayerId: 'layer-1', connectedLayerIndex: 0,
    sourceSceneIndex: 2, sourceSceneRef: { ...sourceSceneRef, sceneIndex: 2 }, volume: 43,
  };
  const f = fixture({ audio: [oldAudio], layer: {
    sourceSceneIndex: undefined, sourceSceneRef: undefined,
    layerAiVideoType: 'character', layerBaseAiImageType: 'character',
  } });
  await realignAudioVideoLayerToVideoLayer({ ...payload, model: 'SYNCLIPSYNC', generationType: 'lip_sync', duration: 6 }, f.dependencies);
  const saved = f.calls.updates[0][1].$set['audioLayers.$[audio]'];
  assert.equal(saved.sourceSceneIndex, 2);
  assert.equal(saved.sourceSceneRef.sceneIndex, 2);
  assert.equal(saved.connectedLayerIndex, 0);
  assert.equal(saved.startTime, 17);
  assert.equal(saved.endTime, 23);
  assert.equal(saved.duration, 6);
  assert.equal(saved.connectedLayerStartTimeOffset, 2);
  assert.equal(saved.volume, 43);
  assert.equal(saved.fadeOnEdges, false);
});

test('sound-effect delivery preserves an existing speech track and adds its own audio',async()=>{
 const speech={_id:'speech',generationType:'speech',connectedLayerId:'layer-1',startTime:15.2,endTime:19.2,duration:4,
   selectedLocalAudioLink:'/original-speech.mp3',volume:70};
 const original=structuredClone(speech);const f=fixture({audio:[speech]});
 await realignAudioVideoLayerToVideoLayer(payload,f.dependencies);
 assert.deepEqual(speech,original);assert.equal(f.session.audioLayers.length,2);
 assert.equal(f.session.audioLayers[1].generationType,'sound_effect');assert.equal(f.session.audioLayers[1].duration,10);
});

for (const existing of [false, true]) {
  test(`${existing ? 'existing' : 'new'} delivered sound-effect audio synchronizes the current narrative timing`, async () => {
    const f = fixture({ audio: existing ? [{
      _id: 'audio-1', connectedLayerId: 'layer-1', generationType: 'sound_effect', duration: 12,
    }] : [] });
    f.session.movieResourceList = {
      scenes: Array.from({ length: 8 }, (_, index) => ({
        visual: index === 7 ? sourceSceneRef.scene.visual : `Earlier scene ${index}`,
        duration: 12, type: 'sound_effect',
      })),
      sounds: [{ type: 'sound_effect', sceneIndex: 7, audio: 'Footsteps in sand.', duration: 12 }],
    };
    const originalReference = structuredClone(f.currentLayer.sourceSceneRef);

    await realignAudioVideoLayerToVideoLayer(payload, f.dependencies);

    const resourceList = f.calls.updates[0][1].$set.movieResourceList;
    assert.equal(resourceList.scenes.length, 1);
    assert.equal(resourceList.scenes[0].duration, 10);
    assert.equal(resourceList.sounds.length, 1);
    assert.equal(resourceList.sounds[0].sceneIndex, 0);
    assert.equal(resourceList.sounds[0].duration, 10);
    assert.equal(f.calls.updates.length, 1);
    assert.equal(f.calls.save, 0);
    assert.deepEqual(f.currentLayer.sourceSceneRef, originalReference);
  });
}

for (const existing of [false, true]) {
  test(`a stale ${existing ? 'existing audio' : 'new audio'} delivery never recreates a concurrently deleted target`, async () => {
    const f = fixture({ audio: existing ? [{ _id: 'old-audio', connectedLayerId: 'layer-1', generationType: 'sound_effect' }] : [] });
    f.session.updatedAt = new Date('2026-11-08T01:00:00Z');
    f.session.__v = 1;
    f.session.movieResourceList = { scenes: [{ visual: 'Scene', duration: 10 }], sounds: [] };
    const fresh = { layers: existing ? structuredClone(f.session.layers) : [], audioLayers: [],
      movieResourceList: { scenes: existing ? [{ visual: 'Scene', duration: 10 }] : [], sounds: [] },
      updatedAt: new Date('2026-11-08T01:00:01Z'), __v: 2 };
    let reads = 0;
    let writes = 0;
    f.dependencies.VideoSession.findById = async () => ++reads === 1 ? f.session : fresh;
    f.dependencies.VideoSession.updateOne = async (filter) => {
      writes++;
      assert.equal(filter.__v, 1);
      assert.equal(filter.updatedAt, f.session.updatedAt);
      assert.deepEqual(filter.layers, { $size: 1 });
      assert.equal(filter['layers.0._id'], 'layer-1');
      return { matchedCount: 0 };
    };

    await realignAudioVideoLayerToVideoLayer(payload, f.dependencies);

    assert.equal(reads, 2);
    assert.equal(writes, 1, 'the removed row or visual cannot receive a second write');
    assert.deepEqual(fresh.audioLayers, []);
    assert.equal(fresh.movieResourceList.scenes.length, existing ? 1 : 0);
    assert.equal(f.calls.save, 0);
  });
}
