import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './ExpressListener.js';

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
