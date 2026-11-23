import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveStudioSessionRefresh } from './studioSessionRefresh.mjs';

const imageLayer = (id, imageUrl, videoUrl = '') => ({
  _id: id,
  imageSession: {
    activeItemList: [{ id: `${id}-image`, type: 'image', src: imageUrl }],
  },
  ...(videoUrl ? { hasAiVideoLayer: true, aiVideoRemoteLink: videoUrl } : {}),
});

test('poll refresh exposes newly completed clips and preserves the selected layer', () => {
  const result = resolveStudioSessionRefresh({
    previousSessionDetails: {
      layers: [imageLayer('one', '/one.png'), imageLayer('two', '/two.png')],
    },
    incomingSessionDetails: {
      expressGenerationPending: true,
      layers: [
        imageLayer('one', '/one.png', 'https://static.example/one.mp4'),
        imageLayer('two', '/two.png'),
      ],
    },
    currentLayerId: 'two',
    selectedLayerIndex: 1,
  });

  assert.equal(result.layers[0].aiVideoRemoteLink, 'https://static.example/one.mp4');
  assert.equal(result.currentLayer._id, 'two');
  assert.equal(result.currentLayerIndex, 1);
});

test('an unhydrated poll payload does not erase the current canvas layers', () => {
  const previousLayers = [imageLayer('one', '/one.png')];
  const result = resolveStudioSessionRefresh({
    previousSessionDetails: { layers: previousLayers, aspectRatio: '16:9' },
    incomingSessionDetails: {
      expressGenerationPending: true,
      layers: [{ _id: 'one', imageSession: {} }],
    },
    currentLayerId: 'one',
  });

  assert.equal(result.layers, previousLayers);
  assert.equal(result.sessionDetails.expressGenerationPending, true);
});

test('a stale poll payload cannot erase a newly inserted layer', () => {
  const previousLayers = [
    imageLayer('inserted', '/inserted.png'),
    imageLayer('one', '/one.png'),
  ];
  const result = resolveStudioSessionRefresh({
    previousSessionDetails: { layers: previousLayers, totalDuration: 4 },
    incomingSessionDetails: {
      layers: [imageLayer('one', '/one.png')],
      totalDuration: 2,
      frameGenerationPending: true,
    },
    currentLayerId: 'inserted',
    selectedLayerIndex: 0,
    requiredLayerIds: ['inserted'],
  });

  assert.equal(result.layers, previousLayers);
  assert.equal(result.currentLayer._id, 'inserted');
  assert.equal(result.sessionDetails.frameGenerationPending, true);
});

test('a refresh takes ownership once it includes the newly inserted layer', () => {
  const incomingLayers = [
    imageLayer('inserted', '/inserted-refreshed.png'),
    imageLayer('one', '/one.png'),
  ];
  const result = resolveStudioSessionRefresh({
    previousSessionDetails: {
      layers: [imageLayer('inserted', '/inserted.png'), imageLayer('one', '/one.png')],
    },
    incomingSessionDetails: { layers: incomingLayers },
    currentLayerId: 'inserted',
    requiredLayerIds: ['inserted'],
  });

  assert.equal(result.layers, incomingLayers);
  assert.equal(result.currentLayer.imageSession.activeItemList[0].src, '/inserted-refreshed.png');
});

test('a refresh restores a selected layer after the session was temporarily empty', () => {
  const result = resolveStudioSessionRefresh({
    previousSessionDetails: { layers: [] },
    incomingSessionDetails: { layers: [imageLayer('restored', '/restored.png')] },
    currentLayerId: null,
    selectedLayerIndex: 0,
  });

  assert.equal(result.currentLayer._id, 'restored');
  assert.equal(result.currentLayerIndex, 0);
});

test('a replacement clip arrives while another scene still contains a sourceless image', () => {
  const rerolled = { _id: 'reroll', rerollPreview: { type: 'video', url: '/old.mp4' },
    imageSession: { activeItemList: [{ id: 'caption', type: 'text' }] } };
  const sibling = imageLayer('sibling', '');
  const clip = { _id: 'reroll', hasAiVideoLayer: true, aiVideoRemoteLink: '/new.mp4' };
  const result = resolveStudioSessionRefresh({
    previousSessionDetails: { layers: [rerolled, sibling] },
    incomingSessionDetails: { layers: [sibling, clip] },
    currentLayerId: 'reroll',
  });
  assert.equal(result.currentLayerIndex, 1);
  assert.equal(result.currentLayer.aiVideoRemoteLink, '/new.mp4');
  assert.equal(result.currentLayer.rerollPreview, undefined);
  assert.equal(result.currentLayer.imageSession.activeItemList, rerolled.imageSession.activeItemList);
  assert.equal(result.layers[0], sibling);
});

test('a partial image item can reuse its own media while accepting other scene edits and removals', () => {
  const previous = { _id: 'one', imageSession: { activeItemList: [
    { id: 'kept', type: 'image', previewUrl: '/still.png', x: 10 },
    { id: 'removed', type: 'image', src: '/delete.png' },
    { id: 'cleared', type: 'image', src: '/clear.png' },
  ] } };
  const updated = { _id: 'one', imageSession: { activeItemList: [
    { id: 'added', type: 'image', src: '/new.png' },
    { id: 'kept', type: 'image', x: 40 }, { id: 'cleared', type: 'image', src: '' },
  ] } };
  const result = resolveStudioSessionRefresh({
    previousSessionDetails: { layers: [previous] }, incomingSessionDetails: { layers: [updated] },
  });
  assert.deepEqual(result.currentLayer.imageSession.activeItemList, [
    updated.imageSession.activeItemList[0], { id: 'kept', type: 'image', x: 40, previewUrl: '/still.png' },
    updated.imageSession.activeItemList[2],
  ]);
});

test('an explicitly empty timeline clears its scenes, while an omitted timeline retains them', () => {
  const previous = { _id: 'session', layers: [imageLayer('one', '/one.png')] };
  const empty = resolveStudioSessionRefresh({ previousSessionDetails: previous, incomingSessionDetails: { layers: [] } });
  const partial = resolveStudioSessionRefresh({ previousSessionDetails: previous, incomingSessionDetails: { generationStatus: 'PENDING' } });
  assert.deepEqual(empty.layers, []);
  assert.equal(empty.currentLayer, null);
  assert.equal(partial.layers, previous.layers);
});

test('copied scene IDs never carry media between different sessions', () => {
  const source = { _id: 'source', layers: [imageLayer('copied', '/source.png')] };
  const target = { _id: 'target', layers: [{ _id: 'copied', imageSession: {} }] };
  const result = resolveStudioSessionRefresh({ previousSessionDetails: source, incomingSessionDetails: target });
  assert.equal(result.sessionDetails, target);
});
