import assert from 'node:assert/strict';
import test from 'node:test';

import { pollNanoBananaFalRequest } from './NanoBanana.js';

function createModelRecorder() {
  const updates = [];
  return {
    updates,
    model: {
      async findOneAndUpdate(filter, update) {
        updates.push({ filter, update });
      },
    },
  };
}

test('completed Fal Nano Banana polling retains the request lock', async () => {
  const recorder = createModelRecorder();
  const result = await pollNanoBananaFalRequest({
    _id: 'nano-row-completed',
    model: 'NANOBANANA2',
    apiRequestId: 'fal-nano-request',
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    queueStatus: async () => ({ status: 'COMPLETED' }),
    queueResult: async () => ({
      data: { images: [{ url: 'https://cdn.example/nano.png' }] },
    }),
    saveFile: async (url) => {
      assert.equal(url, 'https://cdn.example/nano.png');
      return 'nano-local.png';
    },
    logger: { error() {} },
  });

  assert.deepEqual(result, { image: 'nano-local.png' });
  assert.deepEqual(recorder.updates, [
    {
      filter: { _id: 'nano-row-completed' },
      update: { rowLocked: true },
    },
  ]);
});

test('pending Fal Nano Banana polling releases the request lock', async () => {
  const recorder = createModelRecorder();
  const result = await pollNanoBananaFalRequest({
    _id: 'nano-row-pending',
    model: 'NANOBANANA2',
    apiRequestId: 'fal-nano-pending',
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    queueStatus: async () => ({ status: 'IN_PROGRESS' }),
    logger: { error() {} },
  });

  assert.equal(result, null);
  assert.equal(recorder.updates.at(-1).update.rowLocked, false);
});

test('failed Fal Nano Banana polling retains ownership for the shared retry', async () => {
  const recorder = createModelRecorder();
  const result = await pollNanoBananaFalRequest({
    _id: 'nano-row-failed',
    model: 'NANOBANANA2',
    apiRequestId: 'fal-nano-failed',
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    queueStatus: async () => ({ status: 'FAILED' }),
    logger: { error() {} },
  });

  assert.deepEqual(result, {
    image: null,
    error: 'FAL Nano Banana request failed.',
  });
  assert.deepEqual(recorder.updates, [
    {
      filter: { _id: 'nano-row-failed' },
      update: { rowLocked: true },
    },
  ]);
});
