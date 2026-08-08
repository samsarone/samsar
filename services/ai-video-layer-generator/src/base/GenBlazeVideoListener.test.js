import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenBlazeVideoRequest,
  generateGenBlazeVideoLayer,
  isGenBlazeVideoRequest,
  listenToPendingGenBlazeVideoRequest,
  requestGenBlazeVideo,
  shouldUseGenBlazeVideoProvider,
} from './GenBlazeVideoListener.js';

test('builds the generic GenBlaze I2V contract with start/end images and audio settings', () => {
  assert.deepEqual(
    buildGenBlazeVideoRequest({
      model: 'SEEDANCEI2V',
      prompt: 'camera drifts forward',
      startImage: 'https://media.example/start.png',
      endImage: 'https://media.example/end.png',
      aspectRatio: '9:16',
      duration: 7,
      generateAudio: true,
      seed: 42,
    }),
    {
      model: 'SEEDANCEI2V',
      modality: 'video',
      prompt: 'camera drifts forward',
      input_urls: [
        'https://media.example/start.png',
        'https://media.example/end.png',
      ],
      params: {
        duration: 7,
        aspect_ratio: '9:16',
        generate_audio: true,
        seed: 42,
      },
    },
  );
});

test('Veo 3.1 text-to-video keeps the logical Samsar model and needs no input image', () => {
  assert.deepEqual(
    buildGenBlazeVideoRequest({
      model: 'VEO3.1FAST',
      prompt: 'rain on glass',
      aspectRatio: '16:9',
      duration: '8s',
    }),
    {
      model: 'VEO3.1FAST',
      modality: 'video',
      prompt: 'rain on glass',
      input_urls: [],
      params: {
        duration: 8,
        aspect_ratio: '16:9',
        generate_audio: false,
      },
    },
  );
});

test('Veo normalizes native duration, aspect, resolution, and optional generation controls', () => {
  assert.deepEqual(
    buildGenBlazeVideoRequest({
      model: 'VEO3.1',
      prompt: 'rain on glass',
      aspectRatio: 'vertical',
      duration: 5,
      resolution: '4K',
      generateAudio: true,
      negativePrompt: 'text and logos',
      personGeneration: 'allow_adult',
      seed: '42.9',
    }),
    {
      model: 'VEO3.1',
      modality: 'video',
      prompt: 'rain on glass',
      input_urls: [],
      params: {
        duration: 6,
        aspect_ratio: '9:16',
        generate_audio: true,
        resolution: '4k',
        negative_prompt: 'text and logos',
        person_generation: 'allow_adult',
        seed: 42,
      },
    },
  );

  const invalidTextResolution = buildGenBlazeVideoRequest({
    model: 'VEO3.1FAST',
    prompt: 'rain on glass',
    aspect_ratio: 'not-a-ratio',
    duration: 20,
    resolution: '2k',
  });
  assert.equal(invalidTextResolution.params.duration, 8);
  assert.equal(invalidTextResolution.params.aspect_ratio, '16:9');
  assert.equal('resolution' in invalidTextResolution.params, false);
});

test('Veo 3.1 first/last-frame requests preserve both public frame inputs', () => {
  const request = buildGenBlazeVideoRequest({
    model: 'VEO3.1FLIV',
    prompt: 'move between the keyframes',
    startImage: 'https://media.example/first.png',
    endImage: 'https://media.example/last.png',
    resolution: '1080p',
  });

  assert.deepEqual(request.input_urls, [
    'https://media.example/first.png',
    'https://media.example/last.png',
  ]);
  assert.equal(request.params.duration, 8);
  assert.equal(request.params.resolution, '1080p');
  assert.throws(
    () => buildGenBlazeVideoRequest({
      model: 'VEO3.1FLIV',
      startImage: 'https://media.example/first.png',
    }),
    /requires a provider-readable end image/,
  );
});

test('Veo image-to-video keeps its single-frame contract outside the FLIV route', () => {
  const request = buildGenBlazeVideoRequest({
    model: 'VEO3.1I2V',
    prompt: 'animate this frame',
    startImage: 'https://media.example/first.png',
    endImage: 'https://media.example/not-applicable.png',
  });

  assert.deepEqual(request.input_urls, ['https://media.example/first.png']);
});

test('Seedance 1.5 applies its duration and aspect-ratio contract', () => {
  const v15 = buildGenBlazeVideoRequest({
    model: 'SEEDANCEI2V',
    startImage: 'https://media.example/first.png',
    duration: 14.8,
    aspectRatio: 'auto',
  });
  assert.deepEqual(v15.params, {
    duration: 12,
    generate_audio: false,
  });
});

test('Seedance 2.0 stays on the silent 720p GMICloud I2V contract by default', () => {
  const request = buildGenBlazeVideoRequest({
    model: 'SEEDANCE2.0I2V',
    prompt: 'camera eases between the keyframes',
    startImage: 'https://media.example/first.png',
    endImage: 'https://media.example/last.png',
    duration: 18,
    aspectRatio: '9:16',
    resolution: '1080p',
    seed: 7,
  });

  assert.deepEqual(request, {
    model: 'SEEDANCE2.0I2V',
    modality: 'video',
    prompt: 'camera eases between the keyframes',
    input_urls: [
      'https://media.example/first.png',
      'https://media.example/last.png',
    ],
    params: {
      duration: 15,
      aspect_ratio: '9:16',
      generate_audio: false,
      resolution: '720p',
      seed: 7,
    },
  });
});

test('GMICloud Seedance 2.0 enables audio for sound-effect generation', () => {
  const request = buildGenBlazeVideoRequest({
    model: 'SEEDANCE2.0I2V',
    prompt: 'Animate the frame with synchronized ambience.',
    startImage: 'https://media.example/first.png',
    isAudioVideoGeneration: true,
  });

  assert.equal(request.params.generate_audio, true);
  assert.equal(request.params.resolution, '720p');
});

test('GMICloud Seedance 2.5 lets framed generation derive ratio from the first image', () => {
  const soundEffectRequest = buildGenBlazeVideoRequest({
    model: 'SEEDANCE2.5I2V',
    prompt: 'Camera eases between the keyframes with synchronized ambience.',
    startImage: 'https://media.example/first.png',
    endImage: 'https://media.example/last.png',
    duration: 30,
    aspectRatio: '9:16',
    generationType: 'sound_effect',
    seed: 7,
  });

  assert.deepEqual(soundEffectRequest, {
    model: 'SEEDANCE2.5I2V',
    modality: 'video',
    prompt: 'Camera eases between the keyframes with synchronized ambience.',
    input_urls: [
      'https://media.example/first.png',
      'https://media.example/last.png',
    ],
    params: {
      duration: 15,
      generate_audio: true,
      resolution: '720p',
      seed: 7,
    },
  });

  const normalRequest = buildGenBlazeVideoRequest({
    model: 'SEEDANCE2.5I2V',
    startImage: 'https://media.example/first.png',
    duration: 7,
    generateAudio: true,
    isAudioVideoGeneration: true,
  });
  assert.equal(normalRequest.params.duration, 5);
  assert.equal(normalRequest.params.generate_audio, false);
});

test('Kling v3 Pro preserves its contract while Turbo uses its dedicated one-frame contract', () => {
  const pro = buildGenBlazeVideoRequest({
    model: 'KLINGIMGTOVID3PRO',
    startImage: 'https://media.example/start.png',
    endImage: 'https://media.example/end.png',
    duration: 10,
    aspectRatio: '9:16',
    generateAudio: true,
    seed: 42,
  });
  const turbo = buildGenBlazeVideoRequest({
    model: 'KLINGIMGTOVIDTURBO',
    startImage: 'https://media.example/start.png',
    endImage: 'https://media.example/ignored.png',
    duration: 16,
    resolution: '1080p',
    aspectRatio: '9:16',
    generateAudio: true,
    seed: 42,
  });
  assert.deepEqual(pro, {
    model: 'KLINGIMGTOVID3PRO',
    modality: 'video',
    prompt: '',
    input_urls: [
      'https://media.example/start.png',
      'https://media.example/end.png',
    ],
    params: {
      duration: 10,
      aspect_ratio: '9:16',
      generate_audio: true,
      mode: 'pro',
      seed: 42,
    },
  });
  assert.deepEqual(turbo, {
    model: 'KLINGIMGTOVIDTURBO',
    modality: 'video',
    prompt: '',
    input_urls: ['https://media.example/start.png'],
    params: {
      duration: '15',
      resolution: '720p',
    },
  });
});

test('exact legacy Kling routes and Hailuo keep their supported inputs and constraints', () => {
  for (const model of [
    'KLINGIMGTOVIDPRO',
    'KLINGIMGTOVID2.1MASTER',
    'KLINGIMGTOVID2.1PRO',
    'KLINGIMGTOVID2.1STANDARD',
  ]) {
    const request = buildGenBlazeVideoRequest({
      model,
      startImage: 'https://media.example/start.png',
      duration: 10,
    });
    assert.deepEqual(request.input_urls, ['https://media.example/start.png']);
    assert.equal(request.params.duration, 10);
  }

  const hailuo = buildGenBlazeVideoRequest({
    model: 'HAILUOPRO',
    prompt: 'a crane shot',
    duration: 10,
    resolution: '720P',
  });
  assert.deepEqual(hailuo.input_urls, []);
  assert.deepEqual(hailuo.params, {
    duration: 6,
    resolution: '1080P',
    prompt_optimizer: false,
  });

  const optimizedHailuo = buildGenBlazeVideoRequest({
    model: 'HAILUOPRO',
    usePromptOptimizer: true,
  });
  assert.equal(optimizedHailuo.params.prompt_optimizer, true);
});

test('Happy Horse matches native duration tiers and omits unsupported audio and aspect controls', () => {
  const request = buildGenBlazeVideoRequest({
    model: 'HAPPYHORSEI2V',
    prompt: 'the horse moves forward',
    startImage: 'https://media.example/start.png',
    duration: 8,
    resolution: '1080p',
    aspectRatio: '9:16',
    generateAudio: true,
  });

  assert.deepEqual(request.params, {
    duration: 10,
    resolution: '720P',
  });
});

test('rejects local image paths before they reach a public GMICloud adapter', () => {
  assert.throws(
    () => buildGenBlazeVideoRequest({
      model: 'HAPPYHORSEI2V',
      startImage: '/assets/start.png',
    }),
    (error) => error.code === 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE',
  );
});

test('submits and returns a provider-sticky opaque generation id', async () => {
  const calls = [];
  const generationId = await generateGenBlazeVideoLayer(
    {
      model: 'KLINGIMGTOVID3PRO',
      prompt: 'slow orbit',
      startImage: 'https://media.example/start.png',
    },
    {
      request: async (pathname, options) => {
        calls.push({ pathname, options });
        return { request_id: 'sealed-video-job', status: 'pending' };
      },
    },
  );

  assert.equal(generationId, 'genblaze-video:sealed-video-job');
  assert.equal(calls[0].pathname, '/media/requests');
  assert.equal(calls[0].options.body.model, 'KLINGIMGTOVID3PRO');
  assert.equal(isGenBlazeVideoRequest({ generationId }), true);
});

test('a prefixed request id stays on GenBlaze even after new-submit settings change', () => {
  const previousEnabled = process.env.SAMSAR_GENBLAZE_ENABLED;
  delete process.env.SAMSAR_GENBLAZE_ENABLED;
  try {
    assert.equal(
      shouldUseGenBlazeVideoProvider({
        model: 'NOT-A-CONFIGURED-MODEL',
        generationId: 'genblaze-video:sealed-video-job',
      }),
      true,
    );
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.SAMSAR_GENBLAZE_ENABLED;
    } else {
      process.env.SAMSAR_GENBLAZE_ENABLED = previousEnabled;
    }
  }
});

test('HTTP failures preserve the GenBlaze fallback message, status, and retry headers', async () => {
  await assert.rejects(
    requestGenBlazeVideo('/media/requests', {
      env: {
        SAMSAR_GENBLAZE_ENABLED: 'true',
        SAMSAR_GENBLAZE_BASE_URL: 'http://genblaze.test/v1',
      },
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        headers: { 'Retry-After': '12' },
        text: async () => '{}',
      }),
    }),
    (error) => {
      assert.equal(error.message, 'GenBlaze video request failed with status 503.');
      assert.equal(error.status, 503);
      assert.equal(error.headers['retry-after'], '12');
      assert.equal(error.response.status, 503);
      assert.equal(error.response.headers['retry-after'], '12');
      assert.deepEqual(error.response.data, {});
      return true;
    },
  );
});

test('poll response maps back to the existing listener result shape', async () => {
  const completed = await listenToPendingGenBlazeVideoRequest(
    { generationId: 'genblaze-video:sealed/video-job' },
    {
      request: async (pathname) => {
        assert.equal(pathname, '/media/requests/sealed%2Fvideo-job');
        return {
          status: 'succeeded',
          assets: [{ url: 'https://cdn.example/video.mp4', media_type: 'video/mp4' }],
        };
      },
    },
  );
  assert.deepEqual(completed, {
    responseStatus: 'COMPLETED',
    remoteUrl: 'https://cdn.example/video.mp4',
  });

  const failed = await listenToPendingGenBlazeVideoRequest(
    { generationId: 'genblaze-video:failed-job' },
    {
      request: async () => ({ status: 'failed', assets: [], error: 'quota exceeded' }),
    },
  );
  assert.equal(failed.responseStatus, 'FAILED');
  assert.equal(failed.providerFailureMessage, 'quota exceeded');
});
