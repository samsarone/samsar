import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pollFalGPTImageTwoRequest,
  submitFalGPTImageTwoRequest,
} from './GPTImageTwoFal.js';

function createImageGenerationModel(updates) {
  return {
    findByIdAndUpdate: async (...args) => {
      updates.push({ method: 'findByIdAndUpdate', args });
    },
    findOneAndUpdate: async (...args) => {
      updates.push({ method: 'findOneAndUpdate', args });
    },
  };
}

test('submits the normalized ImageGeneration payload to the Fal GPT Image 2 endpoint', async () => {
  const updates = [];
  const submissions = [];
  const result = await submitFalGPTImageTwoRequest({
    _id: 'generation-1',
    model: 'GPTIMAGE2',
    prompt: 'A cinematic product launch stage',
    aspectRatio: '16:9',
  }, {
    connect: async () => {},
    imageGenerationModel: createImageGenerationModel(updates),
    queueSubmit: async (...args) => {
      submissions.push(args);
      return { request_id: 'fal-request-1' };
    },
    logger: { error: () => {} },
  });

  assert.equal(result, null);
  assert.deepEqual(submissions, [[
    'fal-ai/gpt-image-2',
    {
      input: {
        prompt: 'A cinematic product launch stage',
        image_size: { width: 1536, height: 864 },
        quality: 'high',
        num_images: 1,
        output_format: 'png',
      },
    },
  ]]);
  assert.equal(updates[0].method, 'findByIdAndUpdate');
  assert.deepEqual(updates[0].args, ['generation-1', { rowLocked: true }]);
  assert.equal(updates[1].method, 'findOneAndUpdate');
  assert.deepEqual(updates[1].args[0], { _id: 'generation-1' });
  assert.equal(updates[1].args[1].apiRequestId, 'fal-request-1');
  assert.equal(updates[1].args[1].apiGenerationStatus, 'PENDING');
  assert.equal(updates[1].args[1].externalProvider, 'fal');
  assert.equal(updates[1].args[1].rowLocked, false);
  assert.ok(updates[1].args[1].apiSubmittedAt instanceof Date);
});

test('normalizes a Fal result to the native GPT Image 2 response contract', async () => {
  const updates = [];
  const result = await pollFalGPTImageTwoRequest({
    _id: 'generation-2',
    apiRequestId: 'fal-request-2',
    model: 'GPTIMAGE2',
    aspectRatio: '9:16',
  }, {
    connect: async () => {},
    imageGenerationModel: createImageGenerationModel(updates),
    queueStatus: async () => ({ status: 'COMPLETED' }),
    queueResult: async () => ({
      data: {
        images: [{
          url: 'https://fal.media/generated.png',
          width: null,
          height: null,
        }],
      },
    }),
    saveFile: async (url) => {
      assert.equal(url, 'https://fal.media/generated.png');
      return 'generation.png';
    },
    logger: { error: () => {} },
  });

  assert.deepEqual(result, {
    image: 'generation.png',
    width: 864,
    height: 1536,
    preserveOriginalForAiVideo: true,
  });
  assert.deepEqual(updates.at(-1), {
    method: 'findOneAndUpdate',
    args: [{ _id: 'generation-2' }, { externalProvider: 'fal' }],
  });
});

test('returns Fal provider failures to the shared retry pipeline without terminal state', async () => {
  const updates = [];
  const result = await pollFalGPTImageTwoRequest({
    _id: 'generation-3',
    apiRequestId: 'fal-request-3',
    model: 'GPTIMAGE2',
  }, {
    connect: async () => {},
    imageGenerationModel: createImageGenerationModel(updates),
    queueStatus: async () => ({
      status: 'FAILED',
      error: { message: 'Prompt rejected by provider.' },
    }),
    logger: { error: () => {} },
  });

  assert.deepEqual(result, {
    image: null,
    error: 'Prompt rejected by provider.',
    definitiveAdapterFailure: true,
  });
  assert.deepEqual(updates.at(-1), {
    method: 'findOneAndUpdate',
    args: [{ _id: 'generation-3' }, { rowLocked: true }],
  });
  for (const update of updates) {
    assert.equal(Object.hasOwn(update.args[1], 'generationStatus'), false);
    assert.equal(Object.hasOwn(update.args[1], 'apiGenerationStatus'), false);
  }
});

test('keeps a rate-limited poll pinned to the existing Fal request', async () => {
  const updates = [];
  const result = await pollFalGPTImageTwoRequest({
    _id: 'generation-4',
    apiRequestId: 'fal-request-4',
    model: 'GPTIMAGE2',
  }, {
    connect: async () => {},
    imageGenerationModel: createImageGenerationModel(updates),
    queueStatus: async () => {
      const error = new Error('rate limited while polling');
      error.status = 429;
      throw error;
    },
    logger: { error: () => {} },
  });

  assert.equal(result, null);
  assert.deepEqual(updates.at(-1), {
    method: 'findOneAndUpdate',
    args: [{ _id: 'generation-4' }, { rowLocked: false }],
  });
});
