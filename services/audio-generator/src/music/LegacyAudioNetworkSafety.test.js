import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { fal } from '@fal-ai/client';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED = 'false';
const { default: AudioGeneration } = await import('../schema/AudioGeneration.js');
const { default: VideoSession } = await import('../schema/VideoSession.js');
const { dispatchAndProcessCustomMusicRequest } = await import('./CustomMusicGenerator.js');
const { processCustomTextToSpeechRequest } = await import('../speech/CustomTextToSpeech.js');
const { listenToPendingLyriaAiRequest, dispatchAndProcessLyriaAIMusicRequest } = await import('./LyriaAIGenerator.js');
const { listenToPendingElevenLabsMusicRequest } = await import('./ElevenLabsMusicGenerator.js');
const { dispatchAndProcessLyriaNativeMusicRequest } = await import('./GoogleLyriaNativeGenerator.js');
const { submitCustomAudioRequest } = await import('../custom/CustomFalCompatibleAudio.js');

const disconnected = () => Object.assign(new Error('Network unavailable'), { code: 'ENETDOWN' });
const payload = { _id: 'audio', sessionId: 'session', audioLayerId: 'speech', generationId: 'accepted', apiRequestId: 'accepted', status: 'PENDING' };
function customConfig(t) {
  t.mock.method(VideoSession, 'findById', () => ({ select() { return this; }, lean: async () => ({ custom_adapters: { base_url: 'https://custom.example/', text_to_music: 'music', text_to_speech: 'speech' } }) }));
}

for (const [name, run] of [['custom music', dispatchAndProcessCustomMusicRequest], ['custom speech', processCustomTextToSpeechRequest]]) {
  test(`${name} polling outages preserve the accepted receipt without regeneration`, async t => {
    customConfig(t);
    const error = disconnected();
    t.mock.method(axios, 'get', async () => { throw error; });
    t.mock.method(AudioGeneration, 'findByIdAndUpdate', async () => assert.fail('must not reset accepted work'));
    await assert.rejects(run({ ...payload }), actual => actual === error);
  });
}

for (const [name, run] of [['Fal Lyria', listenToPendingLyriaAiRequest], ['Fal ElevenLabs Music', listenToPendingElevenLabsMusicRequest], ['Fal Lyria dispatch', dispatchAndProcessLyriaAIMusicRequest]]) {
  test(`${name} status transport errors reach the common bounded retry boundary`, async t => {
    const error = disconnected();
    t.mock.method(fal.queue, 'status', async () => { throw error; });
    t.mock.method(fal.queue, 'submit', async () => assert.fail('must not submit again'));
    t.mock.method(AudioGeneration, 'findByIdAndUpdate', async () => assert.fail('must not reset the receipt'));
    await assert.rejects(run({ ...payload }), actual => actual === error);
  });
}

test('Fal Lyria result outages reach the common boundary immediately with the same accepted ID', async t => {
  t.mock.method(fal.queue, 'status', async () => ({ status: 'COMPLETED' }));
  let reads = 0;
  const error = disconnected();
  t.mock.method(fal.queue, 'result', async (_endpoint, options) => { reads++; assert.equal(options.requestId, 'accepted'); throw error; });
  await assert.rejects(listenToPendingLyriaAiRequest({ ...payload }), actual => actual === error);
  assert.equal(reads, 1);
});

test('typed Fal media download failure never becomes prompt/model regeneration', async t => {
  t.mock.method(fal.queue, 'status', async () => ({ status: 'FAILED', detail: [{ type: 'file_download_error' }] }));
  t.mock.method(AudioGeneration, 'findByIdAndUpdate', async () => assert.fail('must not reset the receipt'));
  await assert.rejects(dispatchAndProcessLyriaAIMusicRequest({ ...payload }), { providerMediaUnavailable: true });
});

test('custom submission checkpoints its receipt and never repeats an ambiguous POST', async t => {
  customConfig(t);
  const writes = [];
  t.mock.method(AudioGeneration, 'findByIdAndUpdate', async (_id, update) => { writes.push(update); });
  let calls = 0;
  t.mock.method(axios, 'post', async () => { calls++; return { data: { request_id: 'new-receipt' } }; });
  assert.equal(await submitCustomAudioRequest({ ...payload, status: 'INIT' }, 'text_to_music'), 'new-receipt');
  assert.equal(writes[0].status, 'PENDING');
  assert.equal(writes[0].generationId, 'new-receipt');
  t.mock.method(axios, 'post', async () => { calls++; throw disconnected(); });
  await assert.rejects(dispatchAndProcessCustomMusicRequest({ ...payload, status: 'INIT' }), { submissionOutcomeUnknown: true });
  assert.equal(calls, 2);
  assert.equal(writes.length, 1);
});

test('native Google Lyria synthetic receipts never permit a second generation after an outage', async t => {
  t.mock.method(AudioGeneration, 'findByIdAndUpdate', async () => ({}));
  let generations = 0;
  const dependencies = { generateRemote: async () => { generations++; throw disconnected(); }, finalize: async () => assert.fail('no output'), retryFailure: async () => assert.fail('must not create replacement provider work') };
  await assert.rejects(dispatchAndProcessLyriaNativeMusicRequest({ ...payload, status: 'INIT' }, dependencies), { providerRequestUnpollable: true, submissionOutcomeUnknown: true });
  await assert.rejects(dispatchAndProcessLyriaNativeMusicRequest({ ...payload, generationId: 'google-native-lyria:old', status: 'PENDING' }, dependencies), { providerRequestUnpollable: true, submissionOutcomeUnknown: true });
  assert.equal(generations, 1);
});

test('native Google Lyria preserves ordinary provider content retry and healthy finalization', async t => {
  t.mock.method(AudioGeneration, 'findByIdAndUpdate', async () => ({}));
  const retries = [], completed = [];
  await dispatchAndProcessLyriaNativeMusicRequest({ ...payload, status: 'INIT' }, { generateRemote: async () => { throw Object.assign(new Error('Prompt rejected'), { status: 400 }); }, retryFailure: async (_payload, message) => retries.push(message) });
  await dispatchAndProcessLyriaNativeMusicRequest({ ...payload, status: 'INIT' }, { generateRemote: async () => 'https://cdn.example/audio.mp3', finalize: async options => completed.push(options.remoteAudioUrl) });
  assert.deepEqual(retries, ['Prompt rejected']);
  assert.deepEqual(completed, ['https://cdn.example/audio.mp3']);
});

test('native Google Lyria output delivery failure never reruns a completed synchronous generation', async t => {
  t.mock.method(AudioGeneration, 'findByIdAndUpdate', async () => ({}));
  await assert.rejects(dispatchAndProcessLyriaNativeMusicRequest({ ...payload, status: 'INIT' }, { generateRemote: async () => 'https://cdn.example/audio.mp3', finalize: async () => { throw new Error('Local delivery write failed'); }, retryFailure: async () => assert.fail('no new provider work') }), { providerRequestUnpollable: true, submissionOutcomeUnknown: true });
});
