import assert from 'node:assert/strict';
import test from 'node:test';

import { __testOnly__ } from './GenericVideoGenerator.js';

test('image-to-video enqueue keeps the stable local start-image reference', () => {
  const localReference = '/assets_v2/generations/session-1/layer-1/start.png';

  assert.equal(
    __testOnly__.getImageToVideoStartImageReference(
      {
        imageSession: {
          videoRenderStartFrameImage: localReference,
        },
      },
      [],
      'layer-1',
    ),
    localReference,
  );
});

test('image-to-video enqueue still rejects a missing start image', () => {
  assert.throws(
    () => __testOnly__.getImageToVideoStartImageReference(
      { imageSession: {} },
      [],
      'layer-2',
    ),
    /requires a start image for layer layer-2/,
  );
});
