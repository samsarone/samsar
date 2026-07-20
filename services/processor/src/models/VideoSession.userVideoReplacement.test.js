import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './VideoSession.js';

const { prepareLayerActiveItemsForVideoReplacement } = __testOnly__;

test('user video replacement removes stale full-canvas and padding images', () => {
  const stalePreviousSceneFrame = {
    id: 'item_0',
    type: 'image',
    src: '/generations/previous-layer-last-frame.png',
    x: 0,
    y: 0,
    width: 1792,
    height: 1024,
  };
  const stalePaddingFrame = {
    id: 'item_padding',
    type: 'image',
    src: '/generations/padding-frame.png',
    isAiVideoPaddingFrame: true,
  };
  const subtitle = {
    id: 'subtitle_0',
    type: 'text',
    subType: 'subtitle',
  };
  const configImage = {
    id: 'config_0',
    type: 'image',
    is_config_image: true,
  };
  const layer = {
    imageSession: {
      activeItemList: [stalePreviousSceneFrame, stalePaddingFrame, subtitle, configImage],
      previousActiveItemList: [],
    },
  };

  prepareLayerActiveItemsForVideoReplacement(layer);

  assert.deepEqual(layer.imageSession.activeItemList, [subtitle, configImage]);
  assert.deepEqual(
    layer.imageSession.previousActiveItemList,
    [stalePreviousSceneFrame, stalePaddingFrame, subtitle, configImage],
  );
});

test('video replacement does not overwrite an existing restoration snapshot', () => {
  const restorationSnapshot = [{ id: 'original', type: 'image' }];
  const layer = {
    imageSession: {
      activeItemList: [{ id: 'stale', type: 'image' }],
      previousActiveItemList: restorationSnapshot,
    },
  };

  prepareLayerActiveItemsForVideoReplacement(layer);

  assert.deepEqual(layer.imageSession.activeItemList, []);
  assert.equal(layer.imageSession.previousActiveItemList, restorationSnapshot);
});
