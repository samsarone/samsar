import test from 'node:test';
import assert from 'node:assert/strict';

import { resetLayerSoundEffectState } from './video/SoundEffectLayerState.js';

test('sound effect removal clears stale sound-effect render state and restores base ai video type', () => {
  const layer = {
    layerAiVideoType: 'sound_effect',
    aiVideoLayer: 'ai_video/generations/session/layer/base.mp4',
    hasAiVideoLayer: true,
    soundEffectVideoLayer: 'ai_video/generations/session/layer/sfx.mp4',
    soundEffectRemoteLink: 'https://cdn.example.com/sfx.mp4',
    hasSoundEffectVideoLayer: true,
    hasSoundEffect: true,
    soundEffectGenerationPending: true,
    soundEffectVideoGenerationStatus: 'COMPLETED',
    soundEffectVideoGenerationError: 'old error',
    soundEffectThumbnailPath: 'thumb-start.png',
    soundEffectEndThumbnailPath: 'thumb-end.png',
    soundEffectThumbnailVideo: 'thumb.mp4',
    layerAISoundEffectPrompt: 'Thunder crack',
  };

  resetLayerSoundEffectState(layer);

  assert.equal(layer.layerAiVideoType, 'ai_video');
  assert.equal(layer.soundEffectVideoLayer, null);
  assert.equal(layer.soundEffectRemoteLink, null);
  assert.equal(layer.hasSoundEffectVideoLayer, false);
  assert.equal(layer.hasSoundEffect, false);
  assert.equal(layer.soundEffectGenerationPending, false);
  assert.equal(layer.soundEffectVideoGenerationStatus, 'INIT');
  assert.equal(layer.soundEffectVideoGenerationError, null);
  assert.equal(layer.soundEffectThumbnailPath, null);
  assert.equal(layer.soundEffectEndThumbnailPath, null);
  assert.equal(layer.soundEffectThumbnailVideo, null);
  assert.equal(layer.layerAISoundEffectPrompt, '');
});

test('sound effect removal marks a layer without base ai video as none', () => {
  const layer = {
    layerAiVideoType: 'sound_effect',
    hasAiVideoLayer: false,
    aiVideoLayer: null,
    hasSoundEffectVideoLayer: true,
    soundEffectVideoLayer: 'ai_video/generations/session/layer/sfx.mp4',
  };

  resetLayerSoundEffectState(layer);

  assert.equal(layer.layerAiVideoType, 'none');
  assert.equal(layer.hasSoundEffectVideoLayer, false);
  assert.equal(layer.soundEffectVideoLayer, null);
});
