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
