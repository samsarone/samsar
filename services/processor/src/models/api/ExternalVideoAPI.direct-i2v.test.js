import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDirectExternalImageToVideoIdentity,
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
  assert.equal(Object.hasOwn(session, 'expressGenerationImageModel'), false);
  assert.equal(Object.hasOwn(session, 'imageModel'), false);
});
