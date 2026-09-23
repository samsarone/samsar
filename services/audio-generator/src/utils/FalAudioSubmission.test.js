import assert from 'node:assert/strict';
import test from 'node:test';
import { fal } from '@fal-ai/client';
import { isFalAudioAuthenticationRejection, submitFalAudioRequest } from './FalAudioSubmission.js';

test('returns an accepted Fal request without altering the input', async (t) => {
  const input = { input: { text: 'Original narration' } };
  const submit = t.mock.method(fal.queue, 'submit', async (endpoint, options) => {
    assert.equal(endpoint, 'fal-ai/elevenlabs/tts/eleven-v3');
    assert.equal(options, input);
    return { request_id: 'accepted-job' };
  });
  assert.deepEqual(await submitFalAudioRequest('fal-ai/elevenlabs/tts/eleven-v3', input), { request_id: 'accepted-job' });
  assert.equal(submit.mock.callCount(), 1);
});

test('tags only a confirmed submission 401 with an actionable credential error', async (t) => {
  const original = Object.assign(new Error('Unauthorized'), { status: 401 });
  const submit = t.mock.method(fal.queue, 'submit', async () => { throw original; });
  await assert.rejects(submitFalAudioRequest('endpoint', {}), (error) => {
    assert.equal(isFalAudioAuthenticationRejection(error), true);
    assert.equal(error.cause, original);
    assert.equal(error.retryable, false);
    assert.match(error.message, /Fal.*API key.*401/);
    return true;
  });
  assert.equal(submit.mock.callCount(), 1);
  assert.equal(isFalAudioAuthenticationRejection(original), false);
});

for (const status of [400, 402, 403, 422, 429]) {
  test(`does not turn HTTP ${status} into an authentication fallback`, async (t) => {
    const original = Object.assign(new Error('Rejected'), { status });
    t.mock.method(fal.queue, 'submit', async () => { throw original; });
    await assert.rejects(submitFalAudioRequest('endpoint', {}), (error) => error === original);
  });
}

for (const error of [new Error('socket reset'), Object.assign(new Error('timeout'), { status: 408 }), Object.assign(new Error('server error'), { status: 503 })]) {
  test(`blocks repeat submission after ${error.message}`, async (t) => {
    t.mock.method(fal.queue, 'submit', async () => { throw error; });
    await assert.rejects(submitFalAudioRequest('endpoint', {}), { submissionOutcomeUnknown: true, retryable: false });
  });
}

test('does not retry an accepted response missing its request ID', async (t) => {
  t.mock.method(fal.queue, 'submit', async () => ({}));
  await assert.rejects(submitFalAudioRequest('endpoint', {}), { submissionOutcomeUnknown: true });
});
