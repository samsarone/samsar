import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleSeedreamRequest,
  pollSeedreamRequest,
  submitSeedreamRequest,
} from './Seedream.js';
import { LEGACY_SEEDREAM_FAL_ENDPOINT, SEEDREAM_FAL_ENDPOINT } from '../consts/SeedreamModel.js';

for (const [aspectRatio, imageSize] of [
  ['1:1', { width: 1024, height: 1024 }],
  ['16:9', { width: 1792, height: 1024 }],
  ['9:16', { width: 1024, height: 1792 }],
]) {
  test(`Seedream 5.5 submits and persists its exact endpoint and ${aspectRatio} PNG payload`, async () => {
    const calls = [];
    const updates = [];
    await submitSeedreamRequest({ _id: 'new-image', model: 'SEEDREAM', prompt: 'A clear title', aspectRatio }, {
      connect: async () => {},
      imageGenerationModel: {
        async findByIdAndUpdate() {},
        async findOneAndUpdate(filter, update) { updates.push(update); },
      },
      async queueSubmit(endpoint, request) { calls.push({ endpoint, request }); return { request_id: 'accepted-55' }; },
    });
    assert.deepEqual(calls, [{ endpoint: SEEDREAM_FAL_ENDPOINT,
      request: { input: { prompt: 'A clear title', image_size: imageSize, output_format: 'png', num_images: 1 } } }]);
    assert.equal(updates[0].seedreamFalEndpoint, SEEDREAM_FAL_ENDPOINT);
    assert.equal(updates[0].apiRequestId, 'accepted-55');
    assert.equal(updates[0].apiGenerationStatus, 'PENDING');
  });
}

for (const [name, extra, endpoint] of [
  ['historical unversioned accepted 5.0 request', {}, LEGACY_SEEDREAM_FAL_ENDPOINT],
  ['stored 5.5 request', { seedreamFalEndpoint: SEEDREAM_FAL_ENDPOINT }, SEEDREAM_FAL_ENDPOINT],
  ['sealed 5.0 request', { falImageBillingSnapshot: { model: 'SEEDREAM', endpoint: LEGACY_SEEDREAM_FAL_ENDPOINT } }, LEGACY_SEEDREAM_FAL_ENDPOINT],
]) {
  test(`polls the original endpoint for a ${name} and reads the documented data.images result`, async () => {
    const calls = [];
    const result = await pollSeedreamRequest({ _id: 'pending-image', model: 'SEEDREAM',
      apiGenerationStatus: 'PENDING', apiRequestId: 'accepted-original', ...extra }, {
      connect: async () => {}, imageGenerationModel: { async findOneAndUpdate() {} },
      async queueStatus(modelEndpoint, request) { calls.push({ modelEndpoint, request }); return { status: 'COMPLETED' }; },
      async queueResult(modelEndpoint, request) { calls.push({ modelEndpoint, request }); return { data: { images: [{ url: 'https://media.example/image.png' }] } }; },
      async saveFile(url) { assert.equal(url, 'https://media.example/image.png'); return 'saved.png'; },
    });
    assert.equal(result.image, 'saved.png');
    assert.deepEqual(calls.map((call) => call.modelEndpoint), [endpoint, endpoint]);
    assert.equal(calls[0].request.requestId, 'accepted-original');
    assert.equal(calls[1].request.requestId, 'accepted-original');
  });
}

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
