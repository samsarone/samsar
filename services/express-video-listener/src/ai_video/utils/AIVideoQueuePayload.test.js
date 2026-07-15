import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRetryableImageToVideoQueuePayload } from './AIVideoQueuePayload.js';

const retryContext = {
  startImageDescription: '  The selected frame description.  ',
  initialStartImageSources: [
    'generations/selected.png',
    'generations/selected.png',
  ],
  fallbackStartImages: [{
    src: 'generations/fallback.png',
    description: '  The fallback frame description.  ',
    score: null,
    rank: 0,
  }],
  promptSeedContext: {
    sceneAction: 'A presenter points at a chart.',
    cameraTransition: 'Slow pan right.',
  },
  userInferenceModel: 'QWEN3.7',
  selectedInferenceModelAuthorization: 'native',
};

const retryableImageToVideoModels = [
  'CUSTOM_IMAGE_TO_VIDEO',
  'HAILUO',
  'KLINGIMGTOVID3PRO',
  'LUMA',
  'PIKA2.2I2V',
  'PIXVERSEI2V',
  'RUNWAYML',
  'SEEDANCEI2V',
  'SKYREELSI2V',
  'SORA2',
  'VEOI2V',
  'VIDUI2V',
  'WANI2V',
  'COSMOS3SUPERI2V',
  'VEO3.1I2V',
  'HAPPYHORSEI2V',
];

for (const model of retryableImageToVideoModels) {
  test(`${model} queue payload serializes fallback retry context`, () => {
    const queuePayload = buildRetryableImageToVideoQueuePayload({
      videoSessionId: 'session-1',
      layerId: 'layer-1',
      prompt: 'Animate this frame.',
      model,
      useStartFrame: true,
      useEndFrame: false,
      ...retryContext,
    }, {
      startImage: 'https://static.example.com/selected.png',
    });

    assert.equal(queuePayload.model, model);
    assert.equal(queuePayload.retryOnFail, true);
    assert.equal(queuePayload.startImageDescription, 'The selected frame description.');
    assert.deepEqual(queuePayload.initialStartImageSources, ['generations/selected.png']);
    assert.deepEqual(queuePayload.fallbackStartImages, [{
      src: 'generations/fallback.png',
      description: 'The fallback frame description.',
      score: null,
      rank: 0,
    }]);
    assert.deepEqual(queuePayload.promptSeedContext, retryContext.promptSeedContext);
    assert.equal(queuePayload.userInferenceModel, 'QWEN3.7');
    assert.equal(queuePayload.selectedInferenceModelAuthorization, 'native');
  });
}

test('queue payload preserves model-specific image and generation overrides', () => {
  const queuePayload = buildRetryableImageToVideoQueuePayload({
    videoSessionId: 'session-1',
    layerId: 'layer-1',
    prompt: 'Animate this frame.',
    model: 'MODEL_WITH_SPECIAL_OPTIONS',
    useStartFrame: true,
    useEndFrame: true,
    combineLayers: true,
    duration: 9,
    ...retryContext,
  }, {
    startImage: 'https://static.example.com/start.png',
    endImage: 'https://static.example.com/end.png',
    useEndFrame: false,
    combineLayers: false,
    duration: 5,
    animationType: 'small',
    generateAudio: true,
    isAudioVideoGeneration: true,
    isAudioVideoLayer: true,
    audioPrompt: 'Quiet footsteps on wood.',
  });

  assert.equal(queuePayload.startImage, 'https://static.example.com/start.png');
  assert.equal(queuePayload.endImage, 'https://static.example.com/end.png');
  assert.equal(queuePayload.useEndFrame, false);
  assert.equal(queuePayload.combineLayers, false);
  assert.equal(queuePayload.duration, 5);
  assert.equal(queuePayload.animationType, 'small');
  assert.equal(queuePayload.generateAudio, true);
  assert.equal(queuePayload.isAudioVideoGeneration, true);
  assert.equal(queuePayload.isAudioVideoLayer, true);
  assert.equal(queuePayload.audioPrompt, 'Quiet footsteps on wood.');
});
