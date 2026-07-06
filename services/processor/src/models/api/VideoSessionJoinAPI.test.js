import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';

import { __testOnly__ } from './VideoSessionJoinAPI.js';

function createObjectIdString() {
  return new Types.ObjectId().toString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('buildJoinedLayersAndAudioLayers appends sessions and shifts timings', () => {
  const session1Layer1Id = createObjectIdString();
  const session1Layer2Id = createObjectIdString();
  const session1SpeechAudioLayerId = createObjectIdString();
  const session1ActiveItemId = createObjectIdString();
  const session1FilterPassId = createObjectIdString();

  const session2Layer1Id = createObjectIdString();
  const session2MusicAudioLayerId = createObjectIdString();

  const session1 = {
    totalDuration: 5,
    layers: [
      {
        _id: session1Layer1Id,
        duration: 2,
        durationOffset: 0,
        frames: ['old-frame.png'],
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [
            { _id: session1ActiveItemId, type: 'image', src: '/video/a/temp/1.png' },
          ],
        },
        filterPasses: [
          { _id: session1FilterPassId, score: 1, src: '/video/a/temp/x.png' },
        ],
      },
      {
        _id: session1Layer2Id,
        duration: 3,
        durationOffset: 2,
        frames: [],
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [],
        },
      },
    ],
    audioLayers: [
      {
        _id: session1SpeechAudioLayerId,
        generationType: 'speech',
        duration: 2,
        connectedLayerId: session1Layer1Id,
        connectedLayerIndex: 0,
        connectedLayerStartTimeOffset: 1,
        startTime: 1,
        endTime: 3,
        generationStatus: 'COMPLETED',
      },
    ],
  };

  const session2 = {
    totalDuration: 4,
    layers: [
      {
        _id: session2Layer1Id,
        duration: 4,
        durationOffset: 0,
        frames: ['old-frame-2.png'],
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [],
        },
      },
    ],
    audioLayers: [
      {
        _id: session2MusicAudioLayerId,
        generationType: 'music',
        duration: 4,
        startTime: 0,
        endTime: 4,
        generationStatus: 'COMPLETED',
      },
    ],
  };

  const { layers, audioLayers, totalDuration } = __testOnly__.buildJoinedLayersAndAudioLayers([
    deepClone(session1),
    deepClone(session2),
  ]);

  assert.equal(totalDuration, 9);
  assert.equal(layers.length, 3);
  assert.equal(audioLayers.length, 2);

  assert.equal(layers[0].durationOffset, 0);
  assert.equal(layers[1].durationOffset, 2);
  assert.equal(layers[2].durationOffset, 5);

  assert.notEqual(layers[0]._id.toString(), session1Layer1Id);
  assert.notEqual(layers[1]._id.toString(), session1Layer2Id);
  assert.notEqual(layers[2]._id.toString(), session2Layer1Id);

  assert.deepEqual(layers[0].frames, []);
  assert.notEqual(
    layers[0].imageSession.activeItemList[0]._id.toString(),
    session1ActiveItemId,
  );
  assert.notEqual(layers[0].filterPasses[0]._id.toString(), session1FilterPassId);

  const speechLayer = audioLayers.find((layer) => layer.generationType === 'speech');
  assert.ok(speechLayer);
  assert.equal(speechLayer.startTime, 1);
  assert.equal(speechLayer.endTime, 3);
  assert.equal(speechLayer.connectedLayerId, layers[0]._id.toString());
  assert.equal(speechLayer.connectedLayerIndex, 0);

  const musicLayer = audioLayers.find((layer) => layer.generationType === 'music');
  assert.ok(musicLayer);
  assert.equal(musicLayer.startTime, 5);
  assert.equal(musicLayer.endTime, 9);
  assert.equal(musicLayer.duration, 4);
});

test('buildJoinedLayersAndAudioLayers blends outro scene and adjusts music boundaries when enabled', () => {
  const session1Layer1Id = createObjectIdString();
  const session1Layer2Id = createObjectIdString();
  const session1MusicId = createObjectIdString();
  const session2Layer1Id = createObjectIdString();
  const session2MusicId = createObjectIdString();

  const session1 = {
    totalDuration: 5,
    framesPerSecond: 24,
    hasOutroImage: true,
    outroImageURL: '/video/outro/session1/outro.png',
    layers: [
      {
        _id: session1Layer1Id,
        duration: 3,
        durationOffset: 0,
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [
            { type: 'image', src: '/video/scene/session1/base.png', is_base_image: true, x: 0, y: 0 },
          ],
        },
      },
      {
        _id: session1Layer2Id,
        duration: 2,
        durationOffset: 3,
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [
            {
              type: 'image',
              src: '/video/outro/session1/outro.png',
              image: 'https://cdn.example.com/outro.png',
              is_base_image: true,
              x: 12,
              y: 16,
              width: 512,
              height: 512,
              currentTransform: {
                scale: 1.2,
                translateX: 20,
                translateY: 30,
                rotateAngle: 4,
              },
            },
          ],
        },
      },
    ],
    audioLayers: [
      {
        _id: session1MusicId,
        generationType: 'background_music',
        duration: 5,
        startTime: 0,
        endTime: 5,
        generationStatus: 'COMPLETED',
      },
    ],
  };

  const session2 = {
    totalDuration: 4,
    framesPerSecond: 24,
    layers: [
      {
        _id: session2Layer1Id,
        duration: 4,
        durationOffset: 0,
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [
            { type: 'image', src: '/video/scene/session2/base.png', is_base_image: true, x: 0, y: 0 },
          ],
        },
      },
    ],
    audioLayers: [
      {
        _id: session2MusicId,
        generationType: 'music',
        duration: 4,
        startTime: 0,
        endTime: 4,
        generationStatus: 'COMPLETED',
      },
    ],
  };

  const { layers, audioLayers, totalDuration } = __testOnly__.buildJoinedLayersAndAudioLayers(
    [deepClone(session1), deepClone(session2)],
    { blendScenes: true },
  );

  assert.equal(totalDuration, 9);
  assert.equal(layers.length, 3);
  assert.equal(audioLayers.length, 2);

  const nextSessionFirstLayer = layers[2];
  const carryOverOutro = nextSessionFirstLayer.imageSession.activeItemList.find(
    (item) => item && item.isBlendCarryOver === true,
  );
  assert.ok(carryOverOutro);
  assert.equal(carryOverOutro.type, 'image');
  assert.equal(carryOverOutro.src, '/video/outro/session1/outro.png');
  assert.equal(carryOverOutro.currentTransform.scale, 1.2);
  assert.equal(carryOverOutro.currentTransform.translateX, 20);
  assert.equal(carryOverOutro.currentTransform.translateY, 30);

  const fadeAnimation = Array.isArray(carryOverOutro.animations) ? carryOverOutro.animations[0] : null;
  assert.ok(fadeAnimation);
  assert.equal(fadeAnimation.type, 'fade');
  assert.equal(fadeAnimation.params.startFade, 100);
  assert.equal(fadeAnimation.params.endFade, 0);
  assert.equal(fadeAnimation.frameOffset, 0);
  assert.equal(fadeAnimation.frameDuration, 24);

  const firstMusicLayer = audioLayers.find((layer) => layer.generationType === 'background_music');
  assert.ok(firstMusicLayer);
  assert.equal(firstMusicLayer.startTime, 0);
  assert.equal(firstMusicLayer.endTime, 5.5);
  assert.equal(firstMusicLayer.duration, 5.5);

  const secondMusicLayer = audioLayers.find((layer) => layer.generationType === 'music');
  assert.ok(secondMusicLayer);
  assert.equal(secondMusicLayer.startTime, 5.5);
  assert.equal(secondMusicLayer.endTime, 9);
  assert.equal(secondMusicLayer.duration, 3.5);
});

test('buildJoinedLayersAndAudioLayers normalizes character lip sync layer duration from rendered frames', () => {
  const lipSyncLayerId = createObjectIdString();

  const session = {
    totalDuration: 5,
    framesPerSecond: 24,
    layers: [
      {
        _id: lipSyncLayerId,
        duration: 5,
        durationOffset: 0,
        hasLipSyncVideoLayer: true,
        layerAiVideoType: 'lip_sync',
        layerBaseAiImageType: 'character',
        clipEnd: true,
        clipEndFrames: 24,
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [
            { type: 'image', src: '/video/scene/lipsync/base.png', is_base_image: true },
          ],
        },
        // Source session already rendered 4 seconds worth of frames (96 @ 24fps).
        frames: Array.from({ length: 96 }, (_, i) => `/video/frames/src/${lipSyncLayerId}/${i}.png`),
      },
    ],
    audioLayers: [],
  };

  const { layers, totalDuration } = __testOnly__.buildJoinedLayersAndAudioLayers([
    deepClone(session),
  ]);

  assert.equal(layers.length, 1);
  assert.equal(layers[0].duration, 4);
  assert.equal(totalDuration, 4);
  assert.equal(layers[0].startFrame, 0);
  assert.equal(layers[0].endFrame, 96);
  assert.equal(layers[0].clipEnd, false);
  assert.equal(layers[0].clipEndFrames, 0);
});

test('buildJoinedLayersAndAudioLayers strips legacy lip-sync padding items and derives duration from ai frame paths', () => {
  const lipSyncLayerId = createObjectIdString();

  const session = {
    totalDuration: 5,
    framesPerSecond: 24,
    layers: [
      {
        _id: lipSyncLayerId,
        duration: 5,
        durationOffset: 0,
        hasLipSyncVideoLayer: true,
        layerAiVideoType: 'character',
        layerBaseAiImageType: 'character',
        aiLayerStartFrame: '/ai_video/frames/src/layer/0.png',
        aiLayerEndFrame: '/ai_video/frames/src/layer/95.png',
        clipEnd: true,
        clipEndFrames: 16,
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [
            { type: 'image', id: 'item_0', src: '/video/scene/base.png', is_base_image: true },
            {
              type: 'image',
              id: `item_padding_${lipSyncLayerId}`,
              is_config_image: true,
              src: '/video/frames/last.png',
              config: {
                frameOffset: 96,
                frameDuration: 24,
              },
              animations: [],
            },
          ],
        },
        frames: [],
      },
    ],
    audioLayers: [],
  };

  const { layers, totalDuration } = __testOnly__.buildJoinedLayersAndAudioLayers([
    deepClone(session),
  ]);

  assert.equal(layers.length, 1);
  assert.equal(layers[0].duration, 4);
  assert.equal(totalDuration, 4);
  assert.equal(layers[0].startFrame, 0);
  assert.equal(layers[0].endFrame, 96);
  assert.equal(layers[0].clipEnd, false);
  assert.equal(layers[0].clipEndFrames, 0);

  const remainingItemIds = layers[0].imageSession.activeItemList.map((item) => item?.id).filter(Boolean);
  assert.deepEqual(remainingItemIds, ['item_0']);
});

test('buildJoinedLayersAndAudioLayers floors ai-backed durations and avoids one-frame cross-session gaps', () => {
  const session1LayerId = createObjectIdString();
  const session2LayerId = createObjectIdString();

  const session1 = {
    totalDuration: 5,
    framesPerSecond: 24,
    layers: [
      {
        _id: session1LayerId,
        duration: 97 / 24, // Stale +1 frame duration
        durationOffset: 0,
        hasAiVideoLayer: true,
        aiVideoLayer: '/ai_video/generations/session1/layer.mp4',
        aiLayerStartFrame: '/ai_video/frames/session1/layer/0.png',
        aiLayerEndFrame: '/ai_video/frames/session1/layer/95.png',
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [
            { type: 'image', id: 'item_0', src: '/video/scene/session1/base.png', is_base_image: true },
          ],
        },
      },
    ],
    audioLayers: [],
  };

  const session2 = {
    totalDuration: 5,
    framesPerSecond: 24,
    layers: [
      {
        _id: session2LayerId,
        duration: 97 / 24, // Stale +1 frame duration
        durationOffset: 0,
        hasAiVideoLayer: true,
        aiVideoLayer: '/ai_video/generations/session2/layer.mp4',
        aiLayerStartFrame: '/ai_video/frames/session2/layer/0.png',
        aiLayerEndFrame: '/ai_video/frames/session2/layer/95.png',
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [
            { type: 'image', id: 'item_0', src: '/video/scene/session2/base.png', is_base_image: true },
          ],
        },
      },
    ],
    audioLayers: [],
  };

  const { layers, totalDuration } = __testOnly__.buildJoinedLayersAndAudioLayers([
    deepClone(session1),
    deepClone(session2),
  ]);

  assert.equal(layers.length, 2);
  assert.equal(layers[0].duration, 4);
  assert.equal(layers[1].duration, 4);
  assert.equal(layers[1].durationOffset, 4);
  assert.equal(totalDuration, 8);
});

test('buildJoinedLayersAndAudioLayers carries per-source narrator avatar overlays', () => {
  const session1LayerId = createObjectIdString();
  const session2LayerId = createObjectIdString();

  const session1 = {
    _id: createObjectIdString(),
    totalDuration: 3,
    framesPerSecond: 16,
    add_narrator_avatar: true,
    narratorAvatarVideoStatus: 'COMPLETED',
    narratorAvatarVideoAssetPath: 'video/narrator_avatar/video/source1/narrator_avatar.mp4',
    layers: [
      {
        _id: session1LayerId,
        duration: 3,
        durationOffset: 0,
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [],
        },
      },
    ],
    audioLayers: [],
  };

  const session2 = {
    _id: createObjectIdString(),
    totalDuration: 4,
    framesPerSecond: 16,
    addNarratorAvatar: true,
    narratorAvatarVideoStatus: 'COMPLETED',
    narratorAvatarVideoAssetPath: 'video/narrator_avatar/video/source2/narrator_avatar.mp4',
    layers: [
      {
        _id: session2LayerId,
        duration: 4,
        durationOffset: 0,
        imageSession: {
          generationStatus: 'COMPLETED',
          editStatus: 'COMPLETED',
          activeItemList: [],
        },
      },
    ],
    audioLayers: [],
  };

  const { joinedNarratorAvatarOverlays, totalDuration } = __testOnly__.buildJoinedLayersAndAudioLayers([
    deepClone(session1),
    deepClone(session2),
  ]);

  assert.equal(totalDuration, 7);
  assert.equal(joinedNarratorAvatarOverlays.length, 2);
  assert.equal(joinedNarratorAvatarOverlays[0].startTime, 0);
  assert.equal(joinedNarratorAvatarOverlays[0].endTime, 3);
  assert.equal(joinedNarratorAvatarOverlays[0].assetPath, session1.narratorAvatarVideoAssetPath);
  assert.equal(joinedNarratorAvatarOverlays[1].startTime, 3);
  assert.equal(joinedNarratorAvatarOverlays[1].endTime, 7);
  assert.equal(joinedNarratorAvatarOverlays[1].assetPath, session2.narratorAvatarVideoAssetPath);
});

test('joined title helpers collect source titles and build fallback title', () => {
  const titles = __testOnly__.resolveSourceVideoTitles([
    { publishedTitle: 'Bangkok Street Food' },
    { sessionName: 'Travel Reels' },
    { title: 'Bangkok Street Food' },
    { metadata: { title: 'Island Hopping' } },
    { expressInputPrompt: 'Prompt should not be treated as a title' },
  ]);

  assert.deepEqual(titles, ['Bangkok Street Food', 'Travel Reels', 'Island Hopping']);
  assert.equal(
    __testOnly__.buildFallbackJoinedVideoTitle(titles),
    'Joined reel: Bangkok Street Food + Travel Reels + Island Hopping',
  );
});
