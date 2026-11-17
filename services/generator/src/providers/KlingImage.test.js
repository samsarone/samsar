import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildKlingImageInput, getKlingImageOutputDimensions, KLING_IMAGE_ASPECT_RATIOS, KLING_IMAGE_FAL_ENDPOINT } from '../consts/KlingImageModel.js';
import { deferAcceptedImagePoll } from '../utils/ImageSubmissionAttempt.js';
import { handleKlingImageRequest, pollKlingImageRequest, submitKlingImageRequest } from './KlingImage.js';

const pending = () => ({ _id: 'kling-image', model: 'KLINGIMAGE4', operationType: 'GENERATE',
  apiGenerationStatus: 'PENDING', apiRequestId: 'accepted-kling', submittedAdapter: 'fal',
  imageSubmissionAttempt: { state: 'ACCEPTED', token: 'original-call' } });

function dependencies(extra = {}) {
  const updates = [];
  return {
    updates,
    connect: async () => {},
    imageGenerationModel: {
      async findByIdAndUpdate(...args) { updates.push(args); },
      async findOneAndUpdate(...args) { updates.push(args); },
    },
    logger: { error() {} },
    ...extra,
  };
}

test('Kling Image 4 maps existing 1k jobs to 2K and emits only documented provider fields', () => {
  assert.deepEqual(buildKlingImageInput({ prompt: 'A heron', resolution: '1k', aspectRatio: '16:9',
    image_urls: ['https://example.com/ref.png'], output_format: 'png', result_type: 'series', series_amount: 9 }), {
    prompt: 'A heron', result_type: 'single', num_images: 1, resolution: '2K', aspect_ratio: '16:9',
  });
  for (const resolution of ['2K', '4K', '8K']) {
    assert.equal(buildKlingImageInput({ resolution: resolution.toLowerCase() }).resolution, resolution);
  }
  for (const aspectRatio of KLING_IMAGE_ASPECT_RATIOS) {
    assert.equal(buildKlingImageInput({ aspectRatio }).aspect_ratio, aspectRatio);
  }
  assert.equal(buildKlingImageInput({ aspectRatio: 'unsupported' }).aspect_ratio, '1:1');
});

test('Kling image jobs explicitly reject unsupported application batches', () => {
  for (const count of [0, 2, 9, 1.5, 'invalid']) {
    assert.throws(() => buildKlingImageInput({ numImages: count }), /one image per request/);
  }
});

test('Kling app 720p requests retain the requested ratio while Fal uses its native 2K minimum', () => {
  for (const aspectRatio of ['16:9', '9:16']) {
    assert.deepEqual(buildKlingImageInput({ resolution: '720p', aspectRatio, prompt: 'A heron' }), {
      prompt: 'A heron', result_type: 'single', num_images: 1, resolution: '2K', aspect_ratio: aspectRatio,
    });
  }
  assert.equal(buildKlingImageInput({ resolution: '720p' }).aspect_ratio, '16:9');
  assert.deepEqual(getKlingImageOutputDimensions({ resolution: '720p', aspectRatio: '16:9' }), { width: 1280, height: 720 });
  assert.deepEqual(getKlingImageOutputDimensions({ resolution: '720p', aspectRatio: '9:16' }), { width: 720, height: 1280 });
  assert.throws(() => buildKlingImageInput({ resolution: '720p', aspectRatio: '1:1' }), /16:9 or 9:16/);
});

test('Kling native API and accepted 2K/4K/8K jobs retain native output without app resizing', async () => {
  for (const resolution of ['2K', '4K', '8K']) {
    const result = await pollKlingImageRequest({ ...pending(), resolution, aspectRatio: '3:2', requestType: 'API' }, dependencies({
      queueStatus: async () => ({ status: 'COMPLETED' }),
      queueResult: async () => ({ data: { images: [{ url: 'https://media.example/native.png' }] } }),
      saveFile: async url => { assert.equal(url, 'https://media.example/native.png'); return 'native.png'; },
      resizeAndSaveFile: async () => assert.fail('native API and historical accepted work must retain its native dimensions'),
    }));
    assert.deepEqual(result, { image: 'native.png' });
  }
});

test('Kling app output files are resized to exact landscape and portrait 720p dimensions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'samsar-kling-720p-'));
  const previousRoot = process.env.SAMSAR_ASSETS_ROOT;
  const fixture = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: '#418cc5' } }).png().toBuffer();
  const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(fixture); });
  try {
    process.env.SAMSAR_ASSETS_ROOT = root;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const imageUrl = `http://127.0.0.1:${server.address().port}/native.png`;
    for (const [aspectRatio, dimensions] of [['16:9', { width: 1280, height: 720 }], ['9:16', { width: 720, height: 1280 }]]) {
      const result = await pollKlingImageRequest({ ...pending(), resolution: '720p', aspectRatio }, dependencies({
        queueStatus: async () => ({ status: 'COMPLETED' }),
        queueResult: async () => ({ data: { images: [{ url: imageUrl }] } }),
        saveFile: async () => assert.fail('app output must use resizing before saving'),
      }));
      assert.equal(result.width, dimensions.width);
      assert.equal(result.height, dimensions.height);
      assert.equal(result.resolution, '720p');
      const metadata = await sharp(await readFile(path.join(root, 'generations', result.image))).metadata();
      assert.equal(metadata.width, dimensions.width);
      assert.equal(metadata.height, dimensions.height);
      assert.equal(metadata.format, 'png');
    }
  } finally {
    if (previousRoot === undefined) delete process.env.SAMSAR_ASSETS_ROOT; else process.env.SAMSAR_ASSETS_ROOT = previousRoot;
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('Kling 720p resizing failures retain the accepted request for bounded read-only recovery', async () => {
  await assert.rejects(pollKlingImageRequest({ ...pending(), resolution: '720p', aspectRatio: '16:9' }, dependencies({
    queueStatus: async () => ({ status: 'COMPLETED' }),
    queueResult: async () => ({ images: [{ url: 'https://media.example/image.png' }] }),
    resizeAndSaveFile: async () => { throw new Error('local resize failed'); },
  })), error => error.providerPollFailure === true && error.providerPollPhase === 'download');
});

test('Kling INIT dispatch submits once and seals the accepted provider ID for later polling', async () => {
  const calls = [];
  const deps = dependencies({ async queueSubmit(endpoint, request) {
    calls.push({ endpoint, request }); return { request_id: 'accepted-kling' };
  } });
  assert.equal(await handleKlingImageRequest({ _id: 'new-kling', model: 'KLINGIMAGE4', apiGenerationStatus: 'INIT',
    prompt: 'A heron', aspectRatio: '9:16', resolution: '4k' }, deps), null);
  assert.deepEqual(calls, [{ endpoint: KLING_IMAGE_FAL_ENDPOINT, request: { input: {
    prompt: 'A heron', result_type: 'single', num_images: 1, resolution: '4K', aspect_ratio: '9:16',
  } } }]);
  const update = deps.updates[1][1];
  assert.equal(update.apiRequestId, 'accepted-kling');
  assert.equal(update.apiGenerationStatus, 'PENDING');
  assert.equal(update.submittedAdapter, 'fal');
  assert.equal(update.rowLocked, false);
  assert.ok(update.apiSubmittedAt instanceof Date);
});

test('Kling pending dispatch reads the same accepted endpoint and saves the documented nested result', async () => {
  const calls = [];
  const deps = dependencies({
    async queueSubmit() { assert.fail('accepted work must never submit again'); },
    async queueStatus(endpoint, request) { calls.push([endpoint, request]); return { status: 'COMPLETED' }; },
    async queueResult(endpoint, request) { calls.push([endpoint, request]); return { data: { images: [{ url: 'https://media.example/kling.png' }] } }; },
    async saveFile(url) { assert.equal(url, 'https://media.example/kling.png'); return 'kling.png'; },
  });
  assert.deepEqual(await handleKlingImageRequest(pending(), deps), { image: 'kling.png' });
  assert.deepEqual(calls, [
    [KLING_IMAGE_FAL_ENDPOINT, { requestId: 'accepted-kling', logs: true }],
    [KLING_IMAGE_FAL_ENDPOINT, { requestId: 'accepted-kling' }],
  ]);
});

test('Kling polling also accepts a direct images result', async () => {
  const result = await pollKlingImageRequest(pending(), dependencies({
    queueStatus: async () => ({ status: 'COMPLETED' }),
    queueResult: async () => ({ images: [{ url: 'https://media.example/kling.png' }] }),
    saveFile: async () => 'saved.png',
  }));
  assert.deepEqual(result, { image: 'saved.png' });
});

for (const state of ['IN_QUEUE', 'IN_PROGRESS']) {
  test(`Kling ${state} polling unlocks the row without changing its accepted identity`, async () => {
    const deps = dependencies({ queueStatus: async () => ({ status: state }),
      async queueResult() { assert.fail('pending request has no result yet'); } });
    assert.equal(await pollKlingImageRequest(pending(), deps), null);
    assert.deepEqual(deps.updates, [
      [{ _id: 'kling-image' }, { rowLocked: true }],
      [{ _id: 'kling-image' }, { rowLocked: false }],
    ]);
  });
}

test('Kling definitive rejection returns structured failure without marking the job completed', async () => {
  const result = await submitKlingImageRequest({ _id: 'rejected', prompt: 'A heron' }, dependencies({
    queueSubmit: async () => { throw Object.assign(new Error('Unprocessable Entity'), {
      status: 422, body: { detail: [{ msg: 'Prompt rejected by safety policy' }] },
    }); },
  }));
  assert.deepEqual(result, { image: null, error: 'Kling Image 4 submission failed: Prompt rejected by safety policy', status: 422 });
});

test('Kling submission with a lost acceptance response remains uncertain', async () => {
  for (const submit of [async () => { throw new Error('connection reset'); }, async () => ({})]) {
    const result = await submitKlingImageRequest({ _id: 'unknown' }, dependencies({ queueSubmit: submit }));
    assert.equal(result.image, null);
    assert.equal(result.submissionOutcomeUnknown, true);
  }
});

test('Kling explicit provider FAILED status returns to the shared failure policy', async () => {
  const result = await pollKlingImageRequest(pending(), dependencies({
    queueStatus: async () => ({ status: 'FAILED', error: { message: 'Image was rejected' } }),
  }));
  assert.deepEqual(result, { image: null, error: 'Image was rejected', definitiveAdapterFailure: true });
});

test('Kling result validation failures are definitive while preserving actual provider details', async () => {
  const result = await pollKlingImageRequest(pending(), dependencies({
    queueStatus: async () => ({ status: 'COMPLETED' }),
    queueResult: async () => { throw Object.assign(new Error('Unprocessable Entity'), {
      status: 422, body: { detail: [{ msg: 'Output rejected by safety policy' }] },
    }); },
  }));
  assert.deepEqual(result, { image: null, error: 'Kling Image 4 result failed (422): Output rejected by safety policy',
    status: 422, definitiveAdapterFailure: true });
});

for (const [phase, extra] of [
  ['status', { queueStatus: async () => { throw new Error('network unavailable'); } }],
  ['result', { queueResult: async () => { throw Object.assign(new Error('gateway unavailable'), { status: 503 }); } }],
  ['result', { queueResult: async () => ({ data: { images: [] } }) }],
  ['download', { saveFile: async () => { throw new Error('download failed'); } }],
]) {
  test(`Kling accepted ${phase} failure preserves read-only recovery instead of generating again`, async () => {
    const payload = pending();
    const deps = dependencies({
      queueStatus: async () => ({ status: 'COMPLETED' }),
      queueResult: async () => ({ data: { images: [{ url: 'https://media.example/image.png' }] } }),
      ...extra,
    });
    await assert.rejects(pollKlingImageRequest(payload, deps), error => {
      assert.equal(error.providerPollFailure, true);
      assert.equal(error.providerPollPhase, phase);
      assert.equal(error.nonPromptProviderFailure, true);
      return true;
    });
    const writes = [];
    assert.equal(await deferAcceptedImagePoll(payload, { now: 0, Model: {
      async updateOne(filter, update) { writes.push([filter, update]); return { matchedCount: 1 }; },
    } }), true);
    assert.equal(payload.apiRequestId, 'accepted-kling');
    assert.equal(payload.apiGenerationStatus, 'PENDING');
    assert.equal(writes[0][0].apiRequestId, 'accepted-kling');
    assert.equal(Object.hasOwn(writes[0][1].$set, 'apiGenerationStatus'), false);
  });
}
