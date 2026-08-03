import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExternalImageEditPayload,
  buildExternalImageIdempotencyKey,
  pollSamsarExternalImageEditRequest,
  pollSamsarExternalTextToImageRequest,
} from './SamsarExternalImage.js';

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

test('external image retries use a new idempotency key without splitting the same attempt', () => {
  const initialPayload = {
    _id: 'image-row-1',
    failureRetryCount: 0,
    filterRetryCount: 0,
  };
  assert.equal(
    buildExternalImageIdempotencyKey(initialPayload),
    'image-row-1:failure-0:filter-0',
  );
  assert.equal(
    buildExternalImageIdempotencyKey({ ...initialPayload }),
    buildExternalImageIdempotencyKey(initialPayload),
  );
  assert.notEqual(
    buildExternalImageIdempotencyKey({ ...initialPayload, filterRetryCount: 1 }),
    buildExternalImageIdempotencyKey(initialPayload),
  );
});

test('completed external image generation retains its lock for downstream finalization', async () => {
  const recorder = createModelRecorder();
  const result = await pollSamsarExternalTextToImageRequest({
    _id: 'image-row-2',
    apiRequestId: 'samsar-external-image:provider-request-2',
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    client: {
      async getV2ExternalImageStatus(requestId) {
        assert.equal(requestId, 'provider-request-2');
        return {
          data: {
            status: 'COMPLETED',
            result_url: 'https://cdn.example/final.png',
          },
        };
      },
    },
    saveFile: async (url) => {
      assert.equal(url, 'https://cdn.example/final.png');
      return 'final-local.png';
    },
    logger: { error() {} },
  });

  assert.deepEqual(result, {
    image: 'final-local.png',
    resultUrl: 'https://cdn.example/final.png',
    resultUrls: ['https://cdn.example/final.png'],
  });
  assert.deepEqual(recorder.updates, [
    { filter: { _id: 'image-row-2' }, update: { rowLocked: true } },
  ]);
});

test('pending and failed external image generation release the request lock', async () => {
  const pendingRecorder = createModelRecorder();
  const pendingResult = await pollSamsarExternalTextToImageRequest({
    _id: 'image-row-pending',
    apiRequestId: 'samsar-external-image:provider-request-pending',
  }, {
    connect: async () => {},
    imageGenerationModel: pendingRecorder.model,
    client: {
      async getV2ExternalImageStatus() {
        return { data: { status: 'PROCESSING' } };
      },
    },
    logger: { error() {} },
  });

  assert.equal(pendingResult, null);
  assert.equal(pendingRecorder.updates.at(-1).update.rowLocked, false);

  const failedRecorder = createModelRecorder();
  const failedResult = await pollSamsarExternalTextToImageRequest({
    _id: 'image-row-failed',
    apiRequestId: 'samsar-external-image:provider-request-failed',
  }, {
    connect: async () => {},
    imageGenerationModel: failedRecorder.model,
    client: {
      async getV2ExternalImageStatus() {
        return { data: { status: 'FAILED', message: 'provider rejected request' } };
      },
    },
    logger: { error() {} },
  });

  assert.deepEqual(failedResult, { image: null, error: 'provider rejected request' });
  assert.equal(failedRecorder.updates.at(-1).update.apiGenerationStatus, 'FAILED');
  assert.equal(failedRecorder.updates.at(-1).update.rowLocked, false);
});

test('malformed external request state stays owned until shared recovery is persisted', async () => {
  const recorder = createModelRecorder();
  const result = await pollSamsarExternalTextToImageRequest({
    _id: 'image-row-missing-provider-id',
    apiRequestId: '',
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    client: {},
    logger: { error() {} },
  });

  assert.deepEqual(result, {
    image: null,
    error: 'Samsar external image request is missing its external request id.',
  });
  assert.deepEqual(recorder.updates, []);
});

test('completed external image edit retains its lock for downstream persistence', async () => {
  const recorder = createModelRecorder();
  const result = await pollSamsarExternalImageEditRequest({
    _id: 'edit-row-1',
    apiRequestId: 'samsar-external-image:provider-edit-1',
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    client: {
      async getV2ExternalImageStatus() {
        return {
          data: {
            status: 'COMPLETED',
            result_url: 'https://cdn.example/edit.png',
          },
        };
      },
    },
    saveFile: async () => 'edit-local.png',
    logger: { error() {} },
  });

  assert.deepEqual(result, {
    image: 'edit-local.png',
    resultUrl: 'https://cdn.example/edit.png',
    resultUrls: ['https://cdn.example/edit.png'],
  });
  assert.deepEqual(recorder.updates, [
    { filter: { _id: 'edit-row-1' }, update: { rowLocked: true } },
  ]);
});

test('external image edit sends only freshly resolved media aliases', async () => {
  const result = await buildExternalImageEditPayload({
    model: 'NANOBANANAEDIT',
    prompt: 'edit',
    image: 'http://localhost:3002/assets_v2/generations/frame.png',
    imageUrl: 'http://localhost:3002/assets_v2/generations/stale.png',
    input_image_urls: ['http://localhost:3002/assets_v2/generations/stale-2.png'],
    maskImage: 'http://localhost:3002/assets_v2/generations/mask.png',
    input: {
      source_image_url: 'http://localhost:3002/assets_v2/generations/nested-stale.png',
      strength: 0.5,
    },
  }, 'custom-edit', {
    resolveMediaUrls: async () => ['https://fresh.example/frame.png'],
    resolveMediaUrl: async () => 'https://fresh.example/mask.png',
  });

  assert.equal(result.input.image_url, 'https://fresh.example/frame.png');
  assert.deepEqual(result.input.image_urls, ['https://fresh.example/frame.png']);
  assert.equal(result.input.mask_url, 'https://fresh.example/mask.png');
  assert.equal('image' in result.input, false);
  assert.equal('imageUrl' in result.input, false);
  assert.equal('input_image_urls' in result.input, false);
  assert.equal('maskImage' in result.input, false);
  assert.equal('source_image_url' in result.input.input, false);
  assert.equal(result.input.input.strength, 0.5);
});
