import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryableMediaPreparationError, publishLipSyncAudioWithRecovery } from './LipSyncMediaPreparation.js';

const disconnected = () => Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });

test('media publication retries only network errors and preserves the same object and file', async () => {
  const calls = [], waits = [];
  const result = await publishLipSyncAudioWithRecovery(async (...args) => {
    calls.push(args);
    if (calls.length < 3) throw new Error('Upload failed', { cause: disconnected() });
    return 'https://cdn.example/same-object.wav';
  }, '/speech.wav', 'same-object.wav', { wait: async ms => waits.push(ms) });
  assert.equal(result, 'https://cdn.example/same-object.wav');
  assert.deepEqual(calls.map(args => args.slice(0, 2)), Array(3).fill(['/speech.wav', 'same-object.wav']));
  assert.ok(calls.every(args => args[2].signal instanceof AbortSignal));
  assert.deepEqual(waits, [1000, 2000]);
});

test('repeated publication failures terminate after three attempts with a mandatory infrastructure marker', async () => {
  let calls = 0;
  await assert.rejects(publishLipSyncAudioWithRecovery(async () => { calls++; throw disconnected(); }, '/speech.wav', 'same-object.wav', { wait: async () => {} }), error => {
    assert.equal(error.code, 'PROVIDER_MEDIA_PREPARATION_FAILED');
    assert.equal(error.lipSyncInfrastructureFailure, true);
    return true;
  });
  assert.equal(calls, 3);
});

test('hung uploads are aborted and bounded without any provider or queue submission', async () => {
  const signals = [];
  await assert.rejects(publishLipSyncAudioWithRecovery(async (_file, _key, { signal }) => {
    signals.push(signal);
    return new Promise(() => {});
  }, '/speech.wav', 'same-object.wav', { wait: async () => {}, timeoutMs: 5 }), { code: 'PROVIDER_MEDIA_PREPARATION_FAILED' });
  assert.equal(signals.length, 3);
  assert.ok(signals.every(signal => signal.aborted));
});

test('configuration and content failures keep their existing optional-fallback semantics', async () => {
  const expected = new Error('File missing');
  let calls = 0;
  await assert.rejects(publishLipSyncAudioWithRecovery(async () => { calls++; throw expected; }, '/speech.wav', 'same-object.wav'), error => error === expected);
  assert.equal(calls, 1);
  assert.equal(isRetryableMediaPreparationError({ response: { status: 403 } }), false);
  assert.equal(isRetryableMediaPreparationError({ response: { status: 503 } }), true);
});
