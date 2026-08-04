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

test('exhausted AI-video layers are removed during reflow even when a still image remains', () => {
  const exhaustedLayer = {
    layerAiVideoType: 'narration',
    aiVideoGenerationStatus: 'FAILED',
    processVideoGenerationFailed: true,
    hasAiVideoLayer: false,
    imageSession: {
      activeGeneratedImage: 'assets_v2/generations/session/scene.png',
    },
  };

  assert.equal(__testOnly__.hasLayerStillVisuals(exhaustedLayer), true);
  assert.equal(__testOnly__.shouldRemoveLayerDuringDeleteReflow(exhaustedLayer), true);
});

test('completed AI-video layers are preserved during delete/reflow', () => {
  assert.equal(__testOnly__.shouldRemoveLayerDuringDeleteReflow({
    layerAiVideoType: 'narration',
    aiVideoGenerationStatus: 'COMPLETED',
    hasAiVideoLayer: true,
    aiVideoRemoteLink: 'https://static.samsar.one/video.mp4',
  }), false);
});

test('managed individual AI-video failure continues to delete/reflow instead of failing the session', () => {
  const managedFailure = {
    layerAiVideoType: 'narration',
    aiVideoGenerationStatus: 'FAILED',
    processVideoGenerationFailed: true,
    hasAiVideoLayer: false,
  };
  const unmanagedFailure = {
    layerAiVideoType: 'narration',
    aiVideoGenerationStatus: 'FAILED',
    processVideoGenerationFailed: false,
    hasAiVideoLayer: false,
  };

  assert.equal(__testOnly__.isFailedAiVideoLayerQueuedForDeleteReflow(managedFailure), true);
  assert.equal(__testOnly__.getFailedRequiredAiVideoLayer([managedFailure]), null);
  assert.equal(__testOnly__.getFailedRequiredAiVideoLayer([unmanagedFailure]), unmanagedFailure);
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
