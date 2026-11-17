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

function pendingSeedream(overrides = {}) {
  return {
    _id: 'accepted-image', model: 'SEEDREAM', apiGenerationStatus: 'PENDING',
    apiRequestId: 'accepted-provider-request', seedreamFalEndpoint: SEEDREAM_FAL_ENDPOINT,
    imageSubmissionAttempt: { state: 'ACCEPTED', token: 'original-submission' },
    ...overrides,
  };
}

function pollingDependencies(overrides = {}) {
  const updates = [];
  return {
    updates,
    connect: async () => {},
    imageGenerationModel: {
      async findOneAndUpdate(filter, update) { updates.push({ filter, update }); },
    },
    queueStatus: async () => ({ status: 'COMPLETED' }),
    queueResult: async () => ({ data: { images: [{ url: 'https://media.example/generated.png' }] } }),
    queueSubmit: async () => assert.fail('polling an accepted request must not submit another generation'),
    saveFile: async () => 'saved.png',
    logger: { error() {} },
    ...overrides,
  };
}

for (const [status, body, detail] of [
  [422, { detail: [{ loc: ['body', 'prompt'], msg: 'Input text data may contain inappropriate content.', type: 'value_error' }] },
    'Input text data may contain inappropriate content.'],
  [422, { detail: { error: { message: 'Provider rejected the submitted scene.' } } },
    'Provider rejected the submitted scene.'],
  [400, { detail: 'Provider could not generate this image.' }, 'Provider could not generate this image.'],
]) {
  test(`completed Seedream result ${status} surfaces meaningful provider detail: ${detail}`, async () => {
    const payload = pendingSeedream();
    const failure = Object.assign(new Error('Unprocessable Entity'), { status, body });
    const dependencies = pollingDependencies({
      queueResult: async (endpoint, request) => {
        assert.equal(endpoint, SEEDREAM_FAL_ENDPOINT);
        assert.equal(request.requestId, payload.apiRequestId);
        throw failure;
      },
      saveFile: async () => assert.fail('failed provider results have no image to download'),
    });
    const result = await pollSeedreamRequest(payload, dependencies);
    assert.deepEqual(result, {
      image: null, error: `Seedream result failed (${status}): ${detail}`,
      status, definitiveAdapterFailure: true,
    });
    assert.equal(payload.apiRequestId, 'accepted-provider-request');
    assert.deepEqual(dependencies.updates, [{ filter: { _id: payload._id }, update: { rowLocked: true } }]);
  });
}

for (const phase of ['status', 'result']) {
  for (const [name, fields] of [
    ['network reset', { code: 'ECONNRESET' }],
    ['server error', { status: 503 }],
    ['throttled read', { status: 429 }],
    ['missing read endpoint', { status: 404 }],
  ]) {
    test(`Seedream ${phase} ${name} reaches bounded polling recovery with the accepted identity`, async () => {
      const payload = pendingSeedream();
      const failure = Object.assign(new Error(name), fields);
      const dependencies = pollingDependencies({
        [phase === 'status' ? 'queueStatus' : 'queueResult']: async () => { throw failure; },
        saveFile: async () => assert.fail('failed reads cannot download an image'),
      });
      await assert.rejects(pollSeedreamRequest(payload, dependencies), error => {
        assert.equal(error, failure);
        assert.equal(error.providerPollFailure, true);
        assert.equal(error.providerPollPhase, phase);
        assert.equal(error.nonPromptProviderFailure, true);
        assert.equal(error.preserveExpressImageLayer, true);
        assert.notEqual(error.definitiveAdapterFailure, true);
        assert.notEqual(error.submissionOutcomeUnknown, true);
        return true;
      });
      assert.equal(payload.apiRequestId, 'accepted-provider-request');
      assert.equal(payload.imageSubmissionAttempt.token, 'original-submission');
      // Shared recovery owns unlocking and nextAttemptAfter, instead of a
      // provider-local null result being polled again on the next one-second tick.
      assert.deepEqual(dependencies.updates, [{ filter: { _id: payload._id }, update: { rowLocked: true } }]);
    });
  }
}

test('a Seedream status read 422 is uncertain and cannot be treated as failed generation', async () => {
  const failure = Object.assign(new Error('Unprocessable Entity'), { status: 422 });
  await assert.rejects(pollSeedreamRequest(pendingSeedream(), pollingDependencies({
    queueStatus: async () => { throw failure; },
  })), error => error === failure && error.providerPollPhase === 'status' && !error.definitiveAdapterFailure);
});

for (const status of ['IN_QUEUE', 'IN_PROGRESS']) {
  test(`Seedream ${status} stays pending without consuming failure recovery`, async () => {
    const dependencies = pollingDependencies({
      queueStatus: async () => ({ status }),
      queueResult: async () => assert.fail('unfinished provider requests have no result'),
    });
    assert.equal(await pollSeedreamRequest(pendingSeedream(), dependencies), null);
    assert.deepEqual(dependencies.updates.map(entry => entry.update), [{ rowLocked: true }, { rowLocked: false }]);
  });
}

for (const [name, fields] of [
  ['download network failure', { code: 'ECONNRESET' }],
  ['download HTTP 422', { status: 422 }],
  ['local disk failure', { code: 'ENOSPC' }],
]) {
  test(`Seedream ${name} preserves the successful provider result without a generation retry`, async () => {
    const failure = Object.assign(new Error(name), fields);
    const dependencies = pollingDependencies({ saveFile: async () => { throw failure; } });
    await assert.rejects(pollSeedreamRequest(pendingSeedream(), dependencies), error => {
      assert.equal(error, failure);
      assert.equal(error.providerPollPhase, 'download');
      assert.equal(error.providerPollFailure, true);
      assert.notEqual(error.definitiveAdapterFailure, true);
      return true;
    });
    assert.deepEqual(dependencies.updates.map(entry => entry.update), [{ rowLocked: true }]);
  });
}

test('a completed Seedream response without an image URL cannot trigger another generation', async () => {
  await assert.rejects(pollSeedreamRequest(pendingSeedream(), pollingDependencies({
    queueResult: async () => ({ data: {} }),
  })), error => {
    assert.match(error.message, /did not include an image URL/);
    assert.equal(error.providerPollPhase, 'result');
    assert.equal(error.providerPollFailure, true);
    assert.notEqual(error.definitiveAdapterFailure, true);
    return true;
  });
});
