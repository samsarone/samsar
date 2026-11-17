import test from 'node:test';
import assert from 'node:assert/strict';
import { canRetryVidgenieImageStage } from './vidgenieImageRetry.mjs';

const failedSession = () => ({
  _id: 'saved-project', isExpressGeneration: true, expressGenerationFailed: true,
  expressGenerationPending: false,
  expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'FAILED',
    audio_generation: 'COMPLETED', music_generation: 'COMPLETED' },
  layers: [{ imageSession: { generationStatus: 'COMPLETED', activeGeneratedImage: 'saved.png' } },
    { imageSession: { generationStatus: 'FAILED' } }],
  audioLayers: [{ audio: 'speech.mp3' }, { audio: 'music.mp3' }],
});

test('failed image stage with completed prompts exposes recovery without changing saved media', () => {
  const session = failedSession();
  const before = structuredClone(session);
  assert.equal(canRetryVidgenieImageStage({ session }), true);
  assert.deepEqual(session, before);
});

for (const [name, patch] of [
  ['non-express session', { isExpressGeneration: false }],
  ['cancelled session', { expressGenerationCancelled: true }],
  ['paused session', { expressGenerationPaused: true }],
  ['completed video', { videoLink: 'https://media.example/final.mp4' }],
  ['failed prompt stage', { expressGenerationStatus: { prompt_generation: 'FAILED', image_generation: 'FAILED' } }],
  ['failed audio stage only', { expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'COMPLETED', audio_generation: 'FAILED' } }],
  ['image stage still pending', { expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'PENDING' } }],
]) {
  test(`${name} does not expose failed-image recovery`, () => {
    assert.equal(canRetryVidgenieImageStage({ session: { ...failedSession(), ...patch } }), false);
  });
}

test('one failed image layer cannot expose recovery when the image stage has not failed', () => {
  const session = failedSession();
  delete session.expressGenerationStatus.image_generation;
  assert.equal(canRetryVidgenieImageStage({ session }), false);
});

test('active delivery and newer pending or completed snapshots suppress a stale failure', () => {
  assert.equal(canRetryVidgenieImageStage({ session: failedSession(), isPending: true }), false);
  for (const currentStatus of ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
    assert.equal(canRetryVidgenieImageStage({ session: failedSession(), statusDetails: { status: currentStatus } }), false);
  }
  assert.equal(canRetryVidgenieImageStage({ session: failedSession(), statusDetails: {
    expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'PENDING' },
  } }), false);
});

test('latest detailed failure can expose recovery after a pending session stops', () => {
  const session = { ...failedSession(), expressGenerationFailed: false,
    expressGenerationPending: true,
    expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'PENDING' } };
  assert.equal(canRetryVidgenieImageStage({ session, statusDetails: {
    status: 'FAILED', expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'FAILED' },
  } }), true);
});
