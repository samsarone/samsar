import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleSeedreamRequest,
  pollSeedreamRequest,
  submitSeedreamRequest,
} from './Seedream.js';

test('returns Seedream submit failures to the shared image retry pipeline', async () => {
  const providerFailure = {
    image: null,
    error: 'Seedream submission failed: 400 Input text data may contain inappropriate content.',
  };

  const result = await handleSeedreamRequest(
    { apiGenerationStatus: 'INIT' },
    {
      submitRequest: async () => providerFailure,
      pollRequest: async () => assert.fail('submit requests must not be polled'),
    },
  );

  assert.deepEqual(result, providerFailure);
});

test('does not mark a Seedream request terminal when FAL submission fails', async () => {
  const updates = [];
  const imageGenerationModel = {
    findByIdAndUpdate: async (...args) => {
      updates.push({ method: 'findByIdAndUpdate', args });
    },
    findOneAndUpdate: async (...args) => {
      updates.push({ method: 'findOneAndUpdate', args });
    },
  };

  const result = await submitSeedreamRequest(
    {
      _id: 'generation-1',
      model: 'SEEDREAM',
      prompt: 'A presenter beside a chart',
      aspectRatio: '16:9',
    },
    {
      connect: async () => {},
      imageGenerationModel,
      queueSubmit: async () => {
        throw new Error('400 Input text data may contain inappropriate content.');
      },
      logger: { error: () => {} },
    },
  );

  assert.deepEqual(result, {
    image: null,
    error: 'Seedream submission failed: 400 Input text data may contain inappropriate content.',
  });
  assert.deepEqual(updates, [
    {
      method: 'findByIdAndUpdate',
      args: ['generation-1', { rowLocked: true }],
    },
  ]);
});

test('Seedream provider failures return to the shared retry path without a terminal update', async () => {
  const updates = [];
  const imageGenerationModel = {
    findOneAndUpdate: async (...args) => {
      updates.push(args);
    },
  };

  const result = await pollSeedreamRequest({
    _id: 'generation-2',
    apiRequestId: 'fal-request-2',
    model: 'SEEDREAM',
  }, {
    connect: async () => {},
    imageGenerationModel,
    queueStatus: async () => ({
      status: 'FAILED',
      error: { message: '400 Input text data may contain inappropriate content.' },
    }),
  });

  assert.deepEqual(result, {
    image: null,
    error: '400 Input text data may contain inappropriate content.',
    definitiveAdapterFailure: true,
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1].rowLocked, true);
  for (const [, update] of updates) {
    assert.equal(Object.hasOwn(update, 'generationStatus'), false);
    assert.equal(Object.hasOwn(update, 'apiGenerationStatus'), false);
  }
});
