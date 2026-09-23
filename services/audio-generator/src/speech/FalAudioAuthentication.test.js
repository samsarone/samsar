import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import mongoose from 'mongoose';
import axios from 'axios';
import { fal } from '@fal-ai/client';

Object.assign(process.env, {
  DOTENV_CONFIG_PATH: '/dev/null', MONGO_URL: 'mongodb://localhost:27017/mock-audio',
  AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
  SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: '/nonexistent-test-preferences.json',
});
const { dispatchSpeechRequest } = await import('./SpeechRequestDispatcher.js');
const { dispatchAndProcessMusicRequest } = await import('../music/MusicDispatcher.js');
const { default: AudioGeneration } = await import('../schema/AudioGeneration.js');
const { default: VideoSession } = await import('../schema/VideoSession.js');
const { processElevenLabsFalSpeechRequest } = await import('./ElevenLabsFal.js');
const { processPlayAISpeechRequest } = await import('./PlayAI.js');
const envKeys = ['CURRENT_ENV', 'SAMSAR_DEPLOYMENT_EDITION', 'FAL_API_KEY', 'SAMSAR_API_KEY', 'SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED', 'SAMSAR_FORCE_EXTERNAL_AUDIO', 'SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED', 'SAMSAR_EXTERNAL_AUDIO_ENABLED', 'ELEVENLABS_API_KEY', 'ELEVENLABS_API_TOKEN'];
const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, { CURRENT_ENV: 'standalone', FAL_API_KEY: 'test-fal', SAMSAR_API_KEY: 'test-samsar', SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED: 'false' });
});
afterEach(() => {
  for (const key of envKeys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function stubDatabase(t, overrides = {}) {
  const record = {
    _id: 'audio-1', sessionId: 'session-1', audioLayerId: 'layer-1',
    status: 'INIT', rowLocked: true, numRetries: 0,
    generationType: 'speech', ttsProvider: 'ELEVENLABS', model: 'ELEVENLABS',
    speaker: 'gOupLcAkjEnguROwi4oS', prompt: 'Original narration',
    ...overrides,
    async save() {},
  };
  const layerUpdates = [];
  const snapshot = () => Object.fromEntries(Object.entries(record).filter(([, value]) => typeof value !== 'function'));
  function apply(update) {
    for (const [key, value] of Object.entries(update.$set || update)) {
      if (key === 'generationMeta.audioAuthFallback') {
        record.generationMeta = { ...record.generationMeta, audioAuthFallback: value };
      } else record[key] = value;
    }
    return snapshot();
  }
  t.mock.method(mongoose, 'connect', async () => mongoose);
  t.mock.method(AudioGeneration, 'findById', async () => record);
  t.mock.method(AudioGeneration, 'findByIdAndUpdate', async (_id, update) => apply(update));
  t.mock.method(AudioGeneration, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter._id, record._id);
    if (filter.status) {
      assert.equal(filter.status, record.status);
      assert.equal(filter.submittedAdapter, record.submittedAdapter);
      assert.equal(Boolean(record.apiRequestId || record.generationId), false);
    }
    return apply(update);
  });
  t.mock.method(VideoSession, 'findOneAndUpdate', async (_filter, update) => { layerUpdates.push(update); return {}; });
  t.mock.method(console, 'error', () => {});
  return { record, snapshot, layerUpdates };
}

for (const ttsProvider of ['ELEVENLABS', 'PLAYAI', 'music']) {
  test(`${ttsProvider}: a healthy Fal submission keeps the existing direct provider path`, async (t) => {
    const music = ttsProvider === 'music';
    const state = stubDatabase(t, music
      ? { generationType: 'music', model: 'ELEVENLABS_MUSIC', duration: 15, isInstrumental: true }
      : { ttsProvider });
    const dispatch = music ? dispatchAndProcessMusicRequest : dispatchSpeechRequest;
    const submit = t.mock.method(fal.queue, 'submit', async () => ({ request_id: 'fal-accepted' }));
    t.mock.method(axios, 'post', async () => assert.fail('a healthy request must not use Samsar'));
    await dispatch(state.snapshot());
    assert.equal(submit.mock.callCount(), 1);
    if (ttsProvider === 'ELEVENLABS') {
      assert.equal(submit.mock.calls[0].arguments[1].input.voice, 'gOupLcAkjEnguROwi4oS');
    }
    assert.equal(state.record.submittedAdapter, 'fal');
    assert.equal(state.record.status, 'PENDING');
    assert.equal(state.record.apiRequestId || state.record.generationId, 'fal-accepted');
    assert.equal(state.record.prompt, 'Original narration');
  });

  if (ttsProvider === 'ELEVENLABS') continue;

  test(`${ttsProvider}: real dispatcher falls back after a rejected Fal submission and polls Samsar only`, { timeout: 2000 }, async (t) => {
    const music = ttsProvider === 'music';
    const state = stubDatabase(t, music
      ? { generationType: 'music', model: 'ELEVENLABS_MUSIC', duration: 15, isInstrumental: true }
      : { ttsProvider });
    const dispatch = music ? dispatchAndProcessMusicRequest : dispatchSpeechRequest;
    const submit = t.mock.method(fal.queue, 'submit', async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); });
    const post = t.mock.method(axios, 'post', async (url, body) => {
      assert.match(url, new RegExp(`/v2/external/audio/text_to_${music ? 'music' : 'speech'}$`));
      assert.ok(JSON.stringify(body).includes('Original narration'));
      return { data: { request_id: 'samsar-accepted' } };
    });
    await dispatch(state.snapshot());
    assert.equal(submit.mock.callCount(), 1);
    assert.equal(post.mock.callCount(), 1);
    assert.equal(state.record.prompt, 'Original narration');
    assert.equal(state.record.numRetries, 0);
    assert.equal(state.record.status, 'PENDING');
    assert.equal(state.record.submittedAdapter, 'samsar');
    assert.equal(state.record.apiRequestId, 'samsar-accepted');
    assert.equal(state.record.rowLocked, false);
    assert.equal(state.layerUpdates.at(-1).$set['audioLayers.$.generationStatus'], 'PENDING');

    const poll = t.mock.method(axios, 'get', async (_url, options) => {
      assert.equal(options.params.request_id, 'samsar-accepted');
      return { data: { status: 'PENDING' } };
    });
    t.mock.method(fal.queue, 'status', async () => assert.fail('must not poll Fal'));
    await dispatch(state.snapshot());
    assert.equal(poll.mock.callCount(), 1);
    assert.equal(post.mock.callCount(), 1);
    assert.equal(submit.mock.callCount(), 1);
  });
}

test('Docker ElevenLabs speech remains on Fal after an authentication rejection', async (t) => {
  const state = stubDatabase(t);
  const rejection = Object.assign(new Error('Unauthorized'), { status: 401 });
  const submit = t.mock.method(fal.queue, 'submit', async () => { throw rejection; });
  const post = t.mock.method(axios, 'post', async () => assert.fail('ElevenLabs speech must not use Samsar'));
  await assert.rejects(dispatchSpeechRequest(state.snapshot()), {
    code: 'SAMSAR_FAL_AUDIO_AUTH_REJECTED',
  });
  assert.equal(submit.mock.callCount(), 1);
  assert.equal(post.mock.callCount(), 0);
  assert.equal(state.record.submittedAdapter, 'fal');
  assert.equal(state.record.prompt, 'Original narration');
});

for (const [name, run] of [['ElevenLabs', processElevenLabsFalSpeechRequest], ['PlayAI', processPlayAISpeechRequest]]) {
  test(`${name}: automatic retries retain narration and never call text generation`, { timeout: 2000 }, async (t) => {
    const state = stubDatabase(t);
    const submit = t.mock.method(fal.queue, 'submit', async () => { throw Object.assign(new Error('Unprocessable request'), { status: 422 }); });
    const textGeneration = t.mock.method(axios, 'post', async () => assert.fail('an audio failure must not invoke narrative/text generation'));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const retry = run(state.snapshot());
    await new Promise(setImmediate);
    t.mock.timers.tick(5000);
    await retry;
    assert.equal(submit.mock.callCount(), 1);
    assert.equal(textGeneration.mock.callCount(), 0);
    assert.equal(state.record.numRetries, 1);
    assert.equal(state.record.status, 'INIT');
    assert.equal(state.record.prompt, 'Original narration');
    assert.deepEqual(state.layerUpdates.at(-1).$set, { 'audioLayers.$.generationStatus': 'INIT' });
  });

  test(`${name}: a Fal polling 401 keeps the accepted request and narration unchanged`, { timeout: 2000 }, async (t) => {
    const state = stubDatabase(t, { status: 'PENDING', submittedAdapter: 'fal', apiRequestId: 'fal-accepted' });
    const error = Object.assign(new Error('Unauthorized'), { status: 401 });
    t.mock.method(fal.queue, 'status', async () => { throw error; });
    const submit = t.mock.method(fal.queue, 'submit', async () => assert.fail('must not submit again'));
    await assert.rejects(run(state.snapshot()), (actual) => actual === error);
    assert.equal(state.record.status, 'PENDING');
    assert.equal(state.record.apiRequestId, 'fal-accepted');
    assert.equal(state.record.prompt, 'Original narration');
    assert.equal(state.record.numRetries, 0);
    assert.equal(submit.mock.callCount(), 0);
    assert.equal(state.layerUpdates.length, 0);
  });

  test(`${name}: a submission timeout cannot rewrite or resubmit speech`, { timeout: 2000 }, async (t) => {
    const state = stubDatabase(t);
    const submit = t.mock.method(fal.queue, 'submit', async () => { throw new Error('socket reset'); });
    await assert.rejects(run(state.snapshot()), { submissionOutcomeUnknown: true });
    assert.equal(submit.mock.callCount(), 1);
    assert.equal(state.record.prompt, 'Original narration');
    assert.equal(state.record.numRetries, 0);
  });
}

test('without a Samsar credential, the original 401 becomes an actionable failure without prompt rewrites', { timeout: 2000 }, async (t) => {
  delete process.env.SAMSAR_API_KEY;
  const state = stubDatabase(t);
  t.mock.method(fal.queue, 'submit', async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); });
  t.mock.method(axios, 'post', async () => assert.fail('no fallback credential'));
  await assert.rejects(dispatchSpeechRequest(state.snapshot()), { code: 'SAMSAR_FAL_AUDIO_AUTH_REJECTED' });
  assert.equal(state.record.prompt, 'Original narration');
  assert.equal(state.record.numRetries, 0);
});
