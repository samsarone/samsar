import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSoundEffectGenerationPayload } from './SoundEffects.js';

test('sound-effect queue explicitly identifies its route and provider stage', () => {
  const payload = buildSoundEffectGenerationPayload({
    userId: 'user-1',
    sessionId: 'session-1',
    currentLayer: { _id: 'layer-1', duration: 5 },
    audioPrompt: 'soft rain',
    aspectRatio: '16:9',
    model: 'CUSTOM_SOUND_EFFECT_MODEL',
    videoUrl: '/assets_v2/user_resources/user-1/ai_videos/session-1/layer-1/video.mp4',
  });

  assert.equal(payload.generationType, 'sound_effect');
  assert.equal(payload.samsarExternalProviderStage, 'sound_effect_generation');
  assert.equal(payload.samsarExternalVideoRoute, 'sound_effect');
  assert.equal(payload.videoLink, '/assets_v2/user_resources/user-1/ai_videos/session-1/layer-1/video.mp4');
});
