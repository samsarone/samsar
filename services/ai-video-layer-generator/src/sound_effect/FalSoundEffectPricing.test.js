import assert from 'node:assert/strict';
import test from 'node:test';

import { generateSoundEffectMireloVideo, listenToPendingSoundEffectMireloVideoRequest } from './MireloAIVideoListener.js';
import { generateSoundEffectSyncedMMVideo } from './SoundEffectSyncedMMVideoListener.js';

test('new Mirelo calls submit one billed sample and snapshot pricing before POST', async () => {
  const events = [];
  const payload = { _id: 'queue', model: 'MIRELOAI', duration: 5,
    videoLink: 'https://example.test/input.mp4', prompt: 'foley', videoBillingPolicy: 'adapter' };
  const id = await generateSoundEffectMireloVideo(payload, {
    env: { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    persistNativeReceipt: async (queueId, receipt) => {
      events.push('persist');
      assert.equal(queueId, 'queue');
      assert.deepEqual(receipt, { adapter: 'fal', model: 'MIRELOAI', requestedSeconds: 5,
        submittedSamples: 1 });
    },
    queue: { submit: async (endpoint, request) => {
      events.push('submit');
      assert.equal(endpoint, 'mirelo-ai/sfx1.6/video-to-video');
      assert.equal(request.input.duration, 5);
      assert.equal(request.input.num_samples, 1);
      return { request_id: 'provider-id' };
    } },
  });
  assert.equal(id, 'provider-id');
  assert.deepEqual(events, ['persist', 'submit']);
});

test('Mirelo completion captures every generated sample count while delivering the first', async () => {
  const result = await listenToPendingSoundEffectMireloVideoRequest({ generationId: 'existing' }, {
    queue: { status: async () => ({ status: 'COMPLETED' }),
      result: async () => ({ data: { video: [
        { url: 'https://example.test/first.mp4' }, { url: 'https://example.test/second.mp4' },
      ] } }) },
  });
  assert.equal(result.remoteUrl, 'https://example.test/first.mp4');
  assert.equal(result.videoBillingReceipt.sampleCount, 2);
});

test('MMAudio submits and bills the actual five-second scene duration', async () => {
  const payload = { _id: 'queue', model: 'MMAUDIOV2', duration: 5,
    videoLink: 'https://example.test/input.mp4', prompt: 'foley', videoBillingPolicy: 'adapter' };
  await generateSoundEffectSyncedMMVideo(payload, {
    env: { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    persistNativeReceipt: async (_id, receipt) => {
      assert.equal(receipt.requestedSeconds, 5);
      assert.equal(receipt.submittedSamples, 1);
    },
    queue: { submit: async (endpoint, request) => {
      assert.equal(endpoint, 'fal-ai/mmaudio-v2');
      assert.equal(request.input.duration, 5);
      return { request_id: 'provider-id' };
    } },
  });
});

for(const [duration,expected] of [[31/30,31/30],[0.5,1],[12,12]]) test(`MMAudio preserves the submitted duration budget for ${duration}s scenes`,async()=>{
 let calls=0;await generateSoundEffectSyncedMMVideo({model:'MMAUDIOV2',duration,videoLink:'https://example.test/source.mp4'},
 {env:{SAMSAR_DEPLOYMENT_EDITION:'production'},queue:{submit:async(_endpoint,{input})=>{calls++;assert.equal(input.duration,expected);return {request_id:'id'};}}});
 assert.equal(calls,1);
});
for(const duration of [0,NaN,31]) test(`MMAudio rejects unsupported duration ${duration} before provider submission`,async()=>{
 let called=false;await assert.rejects(generateSoundEffectSyncedMMVideo({duration},{queue:{submit:async()=>{called=true;}}}),/duration/);assert.equal(called,false);
});
