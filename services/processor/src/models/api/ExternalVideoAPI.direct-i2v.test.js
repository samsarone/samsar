import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDirectExternalImageToVideoIdentity,
  getExternalVideoStageKey,
  decorateExternalStageStatus,
  buildDirectExternalImageToVideoSession,
} from './ExternalVideoAPI.js';

const USER_ID = '64b000000000000000000004';

test('direct external I2V identity is stable per logical attempt', () => {
  const first = buildDirectExternalImageToVideoIdentity(USER_ID, 'local-job:attempt:0');
  const repeated = buildDirectExternalImageToVideoIdentity(USER_ID, 'local-job:attempt:0');
  const retry = buildDirectExternalImageToVideoIdentity(USER_ID, 'local-job:attempt:1');

  assert.equal(first.sessionId.toString(), repeated.sessionId.toString());
  assert.equal(first.layerId.toString(), repeated.layerId.toString());
  assert.equal(first.generationRequestId.toString(), repeated.generationRequestId.toString());
  assert.notEqual(first.sessionId.toString(), retry.sessionId.toString());
  assert.notEqual(first.generationRequestId.toString(), retry.generationRequestId.toString());
});

test('direct external I2V session marks image stages complete and only queues AI video', () => {
  const identity = buildDirectExternalImageToVideoIdentity(
    USER_ID,
    'local-job:attempt:0',
  );
  const session = buildDirectExternalImageToVideoSession({
    userId: USER_ID,
    identity,
    payload: {
      video_model: 'COSMOS3SUPERI2V',
      prompt: 'Slow camera push',
      aspect_ratio: '9:16',
      duration: 8,
    },
    startImage: 'https://media.example.com/start.png',
  });

  assert.equal(session.externalVideoRoute, 'direct_image_to_video');
  assert.equal(session.externalVideoStage, 'ai_video_generation');
  assert.equal(session.expressGenerativeVideoModel, 'COSMOS3SUPERI2V');
  assert.equal(session.expressGenerationStatus.image_generation, 'COMPLETED');
  assert.equal(session.expressGenerationStatus.ai_video_generation, 'PENDING');
  assert.equal(session.layers[0].imageSession.generationStatus, 'COMPLETED');
  assert.equal(session.layers[0].imageSession.editStatus, 'COMPLETED');
  assert.equal(session.layers[0].imageSession.activeSelectedImage, 'https://media.example.com/start.png');
  assert.equal(session.layers[0].isAudioVideoLayer, false);
  assert.equal(Object.hasOwn(session, 'expressGenerationImageModel'), false);
  assert.equal(Object.hasOwn(session, 'imageModel'), false);
});

test('direct external Seedance 2.0 session preserves the requested audio contract', () => {
  const identity = buildDirectExternalImageToVideoIdentity(USER_ID, 'sound-effect:attempt:0');
  const session = buildDirectExternalImageToVideoSession({
    userId: USER_ID,
    identity,
    payload: {
      video_model: 'SEEDANCE2.0I2V',
      prompt: 'Animate the first frame with synchronized ambience',
      generate_audio: true,
    },
    startImage: 'https://media.example.com/start.png',
  });

  assert.equal(session.layers[0].isAudioVideoLayer, true);
});


test('direct text-to-video status resolves the generated clip and final charge', () => {
  const session = { externalVideoRoute: 'direct_text_to_video', videoBillingPolicy: 'adapter',
    videoCreditsCharged: 57.6, videoRemainingCredits: 100,
    layers: [{ aiVideoGenerationStatus: 'COMPLETED', aiVideoRemoteLink: 'https://cdn.example/video.mp4' }] };
  assert.equal(getExternalVideoStageKey(session), 'ai_video_generation');
  const status = decorateExternalStageStatus({ status: 'PENDING', credits_charged: 0 }, session);
  assert.equal(status.status, 'COMPLETED');
  assert.equal(status.result_url, 'https://cdn.example/video.mp4');
  assert.equal(status.creditsCharged, 57.6);
  assert.equal(status.credits_charged, 57.6);
  assert.equal(status.billingStatus, 'COMPLETED');
});


test('direct Kling requests use v4, preserve 30-second clips and suppress native audio', () => {
  const identity = buildDirectExternalImageToVideoIdentity(USER_ID, 'kling:attempt:0');
  for (const model of ['KLINGIMGTOVID4', 'KLINGIMGTOVID3PRO', 'KLINGIMGTOVIDTURBO']) {
    const session = buildDirectExternalImageToVideoSession({
      userId: USER_ID, identity, startImage: 'https://media.example.com/start.png',
      payload: { video_model: model, duration: 30, generate_audio: true },
    });
    assert.equal(session.expressGenerativeVideoModel, 'KLINGIMGTOVID4');
    assert.equal(session.layers[0].duration, 30);
    assert.equal(session.layers[0].isAudioVideoLayer, false);
  }
  assert.throws(() => buildDirectExternalImageToVideoSession({
    userId: USER_ID, identity, startImage: 'https://media.example.com/start.png',
    payload: { video_model: 'KLINGIMGTOVID4', duration: 7 },
  }), error => error.status === 400 && error.code === 'KLING_V4_INVALID_DURATION');
});
