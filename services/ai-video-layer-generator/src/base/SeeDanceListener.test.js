import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSeedanceInputPayload,
  getSeedanceImageToVideoLink,
} from './SeeDanceListener.js';

test('FAL Seedance adapter selects the exact endpoint for each supported I2V model', () => {
  assert.equal(
    getSeedanceImageToVideoLink('SEEDANCEI2V'),
    'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
  );
  assert.equal(
    getSeedanceImageToVideoLink('SEEDANCE2.0I2V'),
    'bytedance/seedance-2.0/image-to-video',
  );
  assert.equal(
    getSeedanceImageToVideoLink('SEEDANCE2.5I2V'),
    'bytedance/seedance-2.5/image-to-video',
  );
});

test('FAL Seedance adapter rejects unknown model keys', () => {
  assert.throws(
    () => getSeedanceImageToVideoLink('SEEDANCE_FUTURE'),
    (error) => error?.code === 'FAL_MODEL_UNSUPPORTED',
  );
});

test('FAL Seedance 2.0 defaults to silent 720p generation', () => {
  assert.deepEqual(
    buildSeedanceInputPayload({
      model: 'SEEDANCE2.0I2V',
      prompt: 'Animate the frame.',
      startImage: 'https://media.example/start.png',
      endImage: 'https://media.example/end.png',
      aspectRatio: '9:16',
      duration: 15,
      userId: 'user-1',
      resolution: '1080p',
    }),
    {
      prompt: 'Animate the frame.',
      image_url: 'https://media.example/start.png',
      end_image_url: 'https://media.example/end.png',
      aspect_ratio: '9:16',
      duration: 15,
      generate_audio: false,
      end_user_id: 'user-1',
      resolution: '720p',
    },
  );
});

test('FAL Seedance 2.0 enables audio for sound-effect generation', () => {
  const input = buildSeedanceInputPayload({
    model: 'SEEDANCE2.0I2V',
    prompt: 'Animate the frame with synchronized ambience.',
    startImage: 'https://media.example/start.png',
    isAudioVideoGeneration: true,
  });

  assert.equal(input.generate_audio, true);
  assert.equal(input.resolution, '720p');
});

test('FAL Seedance 2.5 uses five-second duration units, 720p, and sound-effect audio', () => {
  assert.deepEqual(
    buildSeedanceInputPayload({
      model: 'SEEDANCE2.5I2V',
      prompt: 'Animate the frame with synchronized ambience.',
      startImage: 'https://media.example/start.png',
      duration: 30,
      generationType: 'sound_effect',
    }),
    {
      prompt: 'Animate the frame with synchronized ambience.',
      image_url: 'https://media.example/start.png',
      duration: 30,
      generate_audio: true,
      end_user_id: undefined,
      resolution: '720p',
    },
  );

  assert.equal(
    buildSeedanceInputPayload({
      model: 'SEEDANCE2.5I2V',
      prompt: 'Animate the frame.',
      startImage: 'https://media.example/start.png',
      duration: 7,
    }).duration,
    5,
  );
});
