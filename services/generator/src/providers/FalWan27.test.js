import assert from 'node:assert/strict';
import test from 'node:test';

import { pollFalWan27Request } from './FalWan27.js';

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

test('completed Fal Wan2.7 polling retains the request lock', async () => {
  const recorder = createModelRecorder();
  const result = await pollFalWan27Request({
    _id: 'wan-row-completed',
    apiRequestId: 'fal-wan-request',
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    queueStatus: async () => ({ status: 'COMPLETED' }),
    queueResult: async () => ({
      data: { images: [{ url: 'https://cdn.example/wan.png' }] },
    }),
    saveFile: async (url) => {
      assert.equal(url, 'https://cdn.example/wan.png');
      return 'wan-local.png';
    },
    logger: { error() {} },
  });

  assert.deepEqual(result, {
    image: 'wan-local.png',
    provider: 'fal',
    providerRequestId: 'fal-wan-request',
  });
  assert.equal(recorder.updates[0].update.rowLocked, true);
  assert.equal(
    recorder.updates.some(({ update }) => update.rowLocked === false),
    false,
  );
});

test('pending Fal Wan2.7 polling releases the request lock', async () => {
  const recorder = createModelRecorder();
  const result = await pollFalWan27Request({
    _id: 'wan-row-pending',
    apiRequestId: 'fal-wan-pending',
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    queueStatus: async () => ({ status: 'IN_PROGRESS' }),
    logger: { error() {} },
  });

  assert.equal(result, null);
  assert.equal(recorder.updates.at(-1).update.rowLocked, false);
});
