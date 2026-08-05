import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const {
  buildGenBlazeSpeechRequest,
  generateGenBlazeSpeechAudioUrl,
  processGenBlazeSpeechRequest,
} = await import('./GenBlazeSpeech.js');

function createRecorders() {
  const audioUpdates = [];
  const videoUpdates = [];
  return {
    audioUpdates,
    videoUpdates,
    audioGenerationModel: {
      async findByIdAndUpdate(id, update) {
        audioUpdates.push({ id, update });
      },
    },
    videoSessionModel: {
      async findOneAndUpdate(filter, update) {
        videoUpdates.push({ filter, update });
      },
    },
  };
}

test('builds exact logical OpenAI and ElevenLabs GenBlaze speech envelopes', () => {
  assert.deepEqual(buildGenBlazeSpeechRequest({
    ttsProvider: 'OPENAI',
    prompt: 'Welcome aboard',
    speaker: 'alloy',
    generationMeta: {
      Affect: 'Warm',
      pace: 'relaxed',
    },
  }), {
    model: 'OPENAI_TTS',
    modality: 'audio',
    prompt: 'Welcome aboard',
    input_urls: [],
    params: {
      voice: 'alloy',
      output_format: 'mp3',
      instructions: 'Personality/affect: Warm\n\npace: relaxed',
    },
  });

  assert.deepEqual(buildGenBlazeSpeechRequest({
    ttsProvider: 'ELEVENLABS_FAL',
    prompt: 'Bonjour',
    speakerVoiceId: 'voice-123',
  }), {
    model: 'ELEVENLABS',
    modality: 'audio',
    prompt: 'Bonjour',
    input_urls: [],
    params: {
      voice: 'voice-123',
      output_format: 'mp3_44100_128',
    },
  });

  assert.throws(
    () => buildGenBlazeSpeechRequest({ ttsProvider: 'GOOGLE', prompt: 'hello' }),
    (error) => error.code === 'GENBLAZE_MODEL_UNSUPPORTED',
  );
});

test('submits once and persists a provider-sticky pending request', async () => {
  const recorders = createRecorders();
  const calls = [];
  await processGenBlazeSpeechRequest({
    _id: 'audio-row-1',
    sessionId: 'session-1',
    audioLayerId: 'layer-1',
    status: 'INIT',
    ttsProvider: 'ELEVENLABS',
    prompt: 'The opening line',
    speaker: 'voice-123',
  }, {
    connect: async () => {},
    ...recorders,
    request: async (pathname, options) => {
      calls.push({ pathname, options });
      return { request_id: 'sealed-job-token', status: 'pending' };
    },
    logger: { error() {} },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, '/media/requests');
  assert.equal(calls[0].options.body.model, 'ELEVENLABS');
  assert.deepEqual(recorders.audioUpdates[0], {
    id: 'audio-row-1',
    update: {
      apiRequestId: 'sealed-job-token',
      generationId: 'sealed-job-token',
      genblazeRequestId: 'sealed-job-token',
      genblazeModel: 'ELEVENLABS',
      submittedAdapter: 'gmicloud',
      audioAdapterProvider: 'gmicloud',
      externalProvider: 'gmicloud',
      externalAudioRoute: null,
      status: 'PENDING',
      rowLocked: false,
    },
  });
  assert.equal(
    recorders.videoUpdates[0].update.$set['audioLayers.$.generationStatus'],
    'PENDING',
  );
});

test('polls the same opaque request and delegates to the shared speech finalizer', async () => {
  const recorders = createRecorders();
  const finalized = [];
  const payload = {
    _id: 'audio-row-2',
    status: 'PENDING',
    ttsProvider: 'OPENAI',
    genblazeRequestId: 'sealed/job-token',
  };

  await processGenBlazeSpeechRequest(payload, {
    connect: async () => {},
    ...recorders,
    request: async (pathname) => {
      assert.equal(pathname, '/media/requests/sealed%2Fjob-token');
      return {
        status: 'succeeded',
        assets: [{ url: 'https://cdn.example/speech.mp3', media_type: 'audio/mpeg' }],
      };
    },
    finalizeSpeech: async (finalizePayload, audioUrl) => {
      finalized.push({ finalizePayload, audioUrl });
    },
    retryOrFail: async () => assert.fail('completed request must not retry'),
    logger: { error() {} },
  });

  assert.deepEqual(finalized, [{
    finalizePayload: payload,
    audioUrl: 'https://cdn.example/speech.mp3',
  }]);
});

test('unlocks pending polls and sends provider failures through shared retry handling', async () => {
  const pendingRecorders = createRecorders();
  await processGenBlazeSpeechRequest({
    _id: 'audio-row-3',
    status: 'PENDING',
    ttsProvider: 'ELEVENLABS',
    genblazeRequestId: 'pending-job',
  }, {
    connect: async () => {},
    ...pendingRecorders,
    request: async () => ({ status: 'running' }),
    retryOrFail: async () => assert.fail('pending request must not retry'),
    logger: { error() {} },
  });
  assert.deepEqual(pendingRecorders.audioUpdates, [{
    id: 'audio-row-3',
    update: { rowLocked: false },
  }]);

  const failed = [];
  await processGenBlazeSpeechRequest({
    _id: 'audio-row-4',
    status: 'PENDING',
    ttsProvider: 'ELEVENLABS',
    genblazeRequestId: 'failed-job',
  }, {
    connect: async () => {},
    ...createRecorders(),
    request: async () => ({ status: 'failed', error: 'quota exceeded' }),
    retryOrFail: async (payload, message) => failed.push({ payload, message }),
    logger: { error() {} },
  });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].message, 'quota exceeded');
});

test('avatar-style generation polls GenBlaze and returns its existing remote URL input', async () => {
  const calls = [];
  let pollCount = 0;
  const audioUrl = await generateGenBlazeSpeechAudioUrl({
    ttsProvider: 'ELEVENLABS',
    prompt: 'One timeline segment',
    speaker: 'voice-123',
  }, {
    request: async (pathname, options) => {
      calls.push({ pathname, options });
      if (options?.method === 'POST') {
        return { request_id: 'avatar/segment-job', status: 'pending' };
      }
      pollCount += 1;
      return pollCount === 1
        ? { status: 'pending' }
        : {
            status: 'succeeded',
            assets: [{ url: 'https://cdn.example/avatar-segment.mp3' }],
          };
    },
    wait: async () => {},
    now: () => 0,
    timeoutMs: 1_000,
  });

  assert.equal(audioUrl, 'https://cdn.example/avatar-segment.mp3');
  assert.equal(calls[0].pathname, '/media/requests');
  assert.equal(calls[1].pathname, '/media/requests/avatar%2Fsegment-job');
});
