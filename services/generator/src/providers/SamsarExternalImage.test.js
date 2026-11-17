import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExternalImageEditPayload,
  buildExternalImageIdempotencyKey,
  pollSamsarExternalImageEditRequest,
  pollSamsarExternalTextToImageRequest,
  submitSamsarExternalTextToImageRequest,
  shouldUseSamsarExternalImageProvider,
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

test('Kling Image 4 preserves its canonical model and normalized resolution through the Samsar fallback', async () => {
  for (const [requested, expected] of [['1k', '2K'], ['2K', '2K'], ['4k', '4K'], ['8K', '8K']]) {
    let observed;
    await submitSamsarExternalTextToImageRequest({ _id: 'kling-image', model: 'KLINGIMAGE4',
      prompt: 'A tree', aspectRatio: '3:2', resolution: requested }, {
      connect: async () => {}, recordProviderUsageLog: async () => {},
      imageGenerationModel: { async findByIdAndUpdate() {}, async findOneAndUpdate() {} },
      client: { async requestV2ExternalImage(route, request) {
        observed = { route, request }; return { data: { request_id: 'hosted-kling' } };
      } },
    });
    assert.equal(observed.route, 'text_to_image');
    assert.equal(observed.request.input.model, 'KLINGIMAGE4');
    assert.equal(observed.request.input.aspect_ratio, '3:2');
    assert.equal(observed.request.input.resolution, expected);
    assert.equal(observed.request.input.num_images, 1);
  }
});

test('Kling app 720p intent survives Samsar fallback submission and accepted-result polling', async () => {
  for (const aspectRatio of ['16:9', '9:16']) {
    const updates = [];
    const payload = { _id: 'kling-app', model: 'KLINGIMAGE4', prompt: 'A tree', resolution: '720p', aspectRatio };
    const dependencies = {
      connect: async () => {}, recordProviderUsageLog: async () => {},
      imageGenerationModel: { async findByIdAndUpdate() {}, async findOneAndUpdate(filter, update) { updates.push(update); } },
      client: {
        async requestV2ExternalImage(route, request) {
          assert.equal(request.input.model, 'KLINGIMAGE4');
          assert.equal(request.input.resolution, '720p');
          assert.equal(request.input.aspect_ratio, aspectRatio);
          return { data: { request_id: 'hosted-720p' } };
        },
        async getV2ExternalImageStatus(id) {
          assert.equal(id, 'hosted-720p');
          return { data: { status: 'COMPLETED', result_url: 'https://cdn.example/kling-720p.png' } };
        },
      },
      async saveFile(url) { assert.equal(url, 'https://cdn.example/kling-720p.png'); return 'kling-720p.png'; },
    };
    await submitSamsarExternalTextToImageRequest(payload, dependencies);
    assert.equal(updates[0].apiRequestId, 'samsar-external-image:hosted-720p');
    const result = await pollSamsarExternalTextToImageRequest({ ...payload, apiGenerationStatus: 'PENDING', apiRequestId: updates[0].apiRequestId }, dependencies);
    assert.deepEqual(result, { image: 'kling-720p.png', resultUrl: 'https://cdn.example/kling-720p.png', resultUrls: ['https://cdn.example/kling-720p.png'],
      ...(aspectRatio === '16:9' ? { width: 1280, height: 720 } : { width: 720, height: 1280 }), resolution: '720p' });
  }
});

test('Samsar wrapper retains existing completion metadata for native Kling jobs and other image models', async () => {
  for (const payload of [
    { model: 'KLINGIMAGE4', resolution: '2K', aspectRatio: '16:9' },
    { model: 'KLINGIMAGE4', resolution: '4K', aspectRatio: '3:2' },
    { model: 'KLINGIMAGE4', resolution: '8K', aspectRatio: '9:16' },
    { model: 'SEEDREAM', resolution: '720p', aspectRatio: '16:9' },
  ]) {
    const result = await pollSamsarExternalTextToImageRequest({ ...payload, _id: 'native-image',
      apiRequestId: 'samsar-external-image:accepted-native' }, {
      connect: async () => {}, imageGenerationModel: { async findOneAndUpdate() {} },
      client: { async getV2ExternalImageStatus() { return { data: { status: 'COMPLETED', result_url: 'https://cdn.example/native.png' } }; } },
      saveFile: async () => 'native.png',
    });
    assert.deepEqual(result, { image: 'native.png', resultUrl: 'https://cdn.example/native.png', resultUrls: ['https://cdn.example/native.png'] });
  }
});

test('Kling Image 4 chooses Samsar when selected and retains hosted request polling affinity', () => {
  const keys = ['SAMSAR_DEPLOYMENT_EDITION', 'SAMSAR_API_KEY', 'SAMSAR_EXTERNAL_PROVIDERS_ENABLED'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
    process.env.SAMSAR_API_KEY = 'test-key';
    process.env.SAMSAR_EXTERNAL_PROVIDERS_ENABLED = 'true';
    assert.equal(shouldUseSamsarExternalImageProvider({ model: 'KLINGIMAGE4', adapterProvider: 'samsar' }), true);
    assert.equal(shouldUseSamsarExternalImageProvider({ model: 'KLINGIMAGE4', adapterProvider: 'fal' }), false);
    assert.equal(shouldUseSamsarExternalImageProvider({ model: 'KLINGIMAGE4', apiGenerationStatus: 'PENDING',
      apiRequestId: 'samsar-external-image:accepted-kling', adapterProvider: 'fal' }), true);
    assert.equal(shouldUseSamsarExternalImageProvider({ model: 'KLINGIMAGE4', apiGenerationStatus: 'PENDING',
      apiRequestId: 'fal-accepted-kling', adapterProvider: 'samsar' }), false);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test('Seedream 5.5 keeps the canonical SEEDREAM key through the Samsar image adapter', async () => {
  let observed;
  await submitSamsarExternalTextToImageRequest({ _id: 'seedream-image', model: 'SEEDREAM',
    prompt: 'A tree', aspectRatio: '16:9' }, {
    connect: async () => {}, recordProviderUsageLog: async () => {},
    imageGenerationModel: { async findByIdAndUpdate() {}, async findOneAndUpdate() {} },
    client: { async requestV2ExternalImage(route, request) {
      observed = { route, request }; return { data: { request_id: 'hosted-seedream' } };
    } },
  });
  assert.equal(observed.route, 'text_to_image');
  assert.equal(observed.request.input.model, 'SEEDREAM');
  assert.equal(observed.request.input.aspect_ratio, '16:9');
});

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

test('a lost hosted submission response retries the same Samsar.js image call without a second job', async () => {
  const jobs = new Map();
  const keys = [];
  const updates = [];
  const payload = { _id: 'local-agent-image', model: 'GPTIMAGE2.5', prompt: 'A tree',
    imageBillingPolicy: 'pipeline', userId: 'local-user' };
  let loseResponse = true;
  const dependencies = {
    connect: async () => {}, recordProviderUsageLog: async () => {},
    imageGenerationModel: {
      async findByIdAndUpdate() {},
      async findOneAndUpdate(filter, update) { updates.push(update); },
    },
    client: { async requestV2ExternalImage(route, request, options) {
      assert.equal(route, 'text_to_image');
      assert.equal(request.input.imageBillingPolicy, undefined);
      keys.push(options.idempotencyKey);
      jobs.set(options.idempotencyKey, 'hosted-image-id');
      if (loseResponse) {
        loseResponse = false;
        throw Object.assign(new Error('submission response lost'), { status: 504 });
      }
      return { data: { request_id: jobs.get(options.idempotencyKey) }, creditsCharged: 0 };
    } },
  };
  assert.equal(await submitSamsarExternalTextToImageRequest(payload, dependencies), null);
  await submitSamsarExternalTextToImageRequest(payload, dependencies);
  assert.equal(jobs.size, 1);
  assert.equal(keys[0], keys[1]);
  assert.equal(updates[0].apiGenerationStatus, 'INIT');
  assert.equal(updates.at(-1).apiRequestId, 'samsar-external-image:hosted-image-id');
});

test('a hosted image polling timeout leaves the original request pending', async () => {
  const recorder = createModelRecorder();
  const result = await pollSamsarExternalTextToImageRequest({
    _id: 'local-image', apiRequestId: 'samsar-external-image:original-hosted-job',
  }, { connect: async () => {}, imageGenerationModel: recorder.model,
    client: { async getV2ExternalImageStatus() { throw new Error('timeout'); } }, logger: { error() {} } });
  assert.equal(result, null);
  assert.deepEqual(recorder.updates.at(-1).update, { rowLocked: false });
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
