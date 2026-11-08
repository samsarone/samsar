import test from 'node:test';
import assert from 'node:assert/strict';

import { buildActiveSoundEffectRequestQuery, buildSoundEffectGenerationPayload, generateSoundEffectsForLayer } from './SoundEffects.js';
import VideoSession from '../schema/VideoSession.js';
import AIVideoLayerGeneration from '../schema/AIVideoLayerGeneration.js';
import User from '../schema/User.js';

for (const model of ['MIRELOAI', 'MMAUDIOV2']) {
  test(`${model} enqueue reads persisted reroll billing policy and API-key usage`, async (t) => {
    const usage = { apiKeyId: 'key-1', requestId: 'reroll-request' };
    const session = VideoSession.hydrate({ videoBillingPolicy: 'adapter', videoBillingAPIKeyUsage: usage });
    t.mock.method(User, 'findById', async () => ({ agentSoundEffectModel: model }));
    t.mock.method(VideoSession, 'findById', () => ({ lean: async () => session.toObject() }));
    t.mock.method(VideoSession, 'updateOne', async () => ({}));
    t.mock.method(AIVideoLayerGeneration, 'findOne', filter => {
      assert.deepEqual(filter.$or[0], { generationType: 'sound_effect' });
      assert.equal(filter.layerId, 'layer-1');
      return { sort: async () => null };
    });
    t.mock.method(AIVideoLayerGeneration, 'create', async payload =>
      AIVideoLayerGeneration.hydrate(new AIVideoLayerGeneration(payload).toObject()));
    t.mock.method(console, 'log', () => {});
    const result = await generateSoundEffectsForLayer({ userId: 'owner', sessionId: 'reroll',
      currentLayer: { _id: 'layer-1', duration: 15, hasAiVideoLayer: true,
        aiVideoRemoteLink: 'https://assets.example/base.mp4' },
      audioPrompt: 'Ocean waves', aspectRatio: '16:9',
    });
    assert.equal(result.model, model);
    assert.equal(result.videoBillingPolicy, 'adapter');
    assert.deepEqual(result.videoBillingAPIKeyUsage, usage);
    assert.equal(result.duration, 15);
    assert.equal(result.expireAt, null);
    assert.equal(result.generationType, 'sound_effect');
  });
}

test('sound-effect lookup admits legacy dedicated jobs without reusing other operations', () => {
  const filter = buildActiveSoundEffectRequestQuery('session', 'layer');
  const matches = request => filter.$or.some(branch => (
    typeof branch.generationType === 'string'
      ? request.generationType === branch.generationType
      : branch.model.$in.includes(request.model) && branch.generationType.$in.includes(request.generationType ?? null)
  ));
  for (const request of [
    { model: 'MIRELOAI', generationType: 'generate' },
    { model: 'MMAUDIOV2' },
    { model: 'CUSTOM', generationType: 'sound_effect' },
  ]) assert.equal(matches(request), true);
  for (const request of [
    { model: 'SYNCLIPSYNC', generationType: 'lip_sync' },
    { model: 'SEEDANCE2.0I2V', generationType: 'generate' },
    { model: 'MIRELOAI', generationType: 'lip_sync' },
  ]) assert.equal(matches(request), false);
});

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

test('F2P: sound-effect queue carries the immutable source scene rather than a timeline index', () => {
  const sourceSceneRef = {
    version: 1, sourceSessionId: 'source-session', sceneIndex: 7,
    scene: { visual: 'A soldier approaches the gate.' }, sounds: [], themeJson: {},
  };
  const payload = buildSoundEffectGenerationPayload({
    userId: 'user-1', sessionId: 'copy-session',
    currentLayer: { _id: 'layer-1', duration: 5, sourceSceneIndex: 7, sourceSceneRef },
    audioPrompt: 'soft footsteps', aspectRatio: '9:16', model: 'MIRELOAI',
    videoUrl: '/assets_v2/video.mp4',
  });
  assert.equal(payload.sourceSceneIndex, 7);
  assert.deepEqual(payload.sourceSceneRef, sourceSceneRef);
  assert.notEqual(payload.sourceSceneRef, sourceSceneRef);
  assert.equal(payload.duration, 5);
  assert.equal(payload.videoLink, '/assets_v2/video.mp4');
  assert.equal(payload.retryOnFail, false);
});
