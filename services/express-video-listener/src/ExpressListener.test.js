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

test('AI video output predicate accepts remote-only reusable AI videos', () => {
  assert.equal(
    __testOnly__.hasGeneratedAiVideoOutput({
      hasAiVideoLayer: true,
      aiVideoRemoteLink: 'https://static.samsar.one/assets_v2/user_resources/user-1/ai_videos/session/layer/video.mp4',
    }),
    true,
  );
});

test('transcript result helper keeps in-memory generation status synchronized', () => {
  const status = {
    transcript_generation: 'PENDING',
    frame_generation: 'INIT',
  };

  assert.equal(
    __testOnly__.applyTranscriptGenerationResultToStatus(status, true),
    'COMPLETED',
  );
  assert.equal(status.transcript_generation, 'COMPLETED');

  assert.equal(
    __testOnly__.applyTranscriptGenerationResultToStatus(status, false),
    'FAILED',
  );
  assert.equal(status.transcript_generation, 'FAILED');
});
