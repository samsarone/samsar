import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenBlazeImageRequest,
  handleGenBlazeImageRequest,
  isGenBlazeImageRequestApplicable,
  isGenBlazeImageRequestId,
} from './GenBlazeImage.js';

function createModelRecorder() {
  const updates = [];
  return {
    updates,
    model: {
      async findByIdAndUpdate(id, update) {
        updates.push({ method: 'findByIdAndUpdate', id, update });
      },
      async findOneAndUpdate(filter, update) {
        updates.push({ method: 'findOneAndUpdate', filter, update });
      },
    },
  };
}

test('builds exact Samsar-model gateway requests without exposing a GMI credential', () => {
  assert.deepEqual(
    buildGenBlazeImageRequest({
      model: 'GPTIMAGE2',
      prompt: 'a lighthouse',
      aspectRatio: '16:9',
    }),
    {
      model: 'GPTIMAGE2',
      modality: 'image',
      prompt: 'a lighthouse',
      input_urls: [],
      params: {
        aspect_ratio: '16:9',
        number_of_images: 1,
        size: '1536x864',
        quality: 'high',
        output_format: 'png',
      },
    },
  );

  assert.throws(
    () => buildGenBlazeImageRequest({ model: 'WAN2.7PRO', prompt: 'a quiet forest' }),
    /not supported by the GenBlaze image adapter/,
  );
});

test('preserves each GPT Image 2 aspect ratio as a GMI-compatible exact size', () => {
  const cases = [
    ['1:1', '1024x1024'],
    ['16:9', '1536x864'],
    ['9:16', '864x1536'],
  ];

  for (const [aspectRatio, size] of cases) {
    const request = buildGenBlazeImageRequest({
      model: 'GPTIMAGE2',
      prompt: 'a lighthouse',
      aspect_ratio: aspectRatio,
    });
    assert.deepEqual(request.params, {
      aspect_ratio: aspectRatio,
      number_of_images: 1,
      size,
      quality: 'high',
      output_format: 'png',
    });
  }
});

test('preserves Nano Banana 2 and Pro settings for gateway normalization', () => {
  assert.deepEqual(
    buildGenBlazeImageRequest({
      model: 'NANOBANANA2',
      prompt: 'an ultra-wide valley',
      aspectRatio: '21:9',
      resolution: '0.5K',
    }),
    {
      model: 'NANOBANANA2',
      modality: 'image',
      prompt: 'an ultra-wide valley',
      input_urls: [],
      params: {
        aspect_ratio: '21:9',
        number_of_images: 1,
        output_format: 'png',
        resolution: '0.5K',
      },
    },
  );

  assert.deepEqual(
    buildGenBlazeImageRequest({
      model: 'NANOBANANAPRO',
      prompt: 'a portrait',
      aspect_ratio: '4:5',
      imageResolution: '2K',
    }),
    {
      model: 'NANOBANANAPRO',
      modality: 'image',
      prompt: 'a portrait',
      input_urls: [],
      params: {
        aspect_ratio: '4:5',
        number_of_images: 1,
        output_format: 'png',
        resolution: '2K',
      },
    },
  );
});

test('keeps both Nano models on GMICloud only for exact supported contracts', () => {
  assert.equal(isGenBlazeImageRequestApplicable({
    model: 'NANOBANANA2',
    aspectRatio: '3:2',
  }), true);
  assert.equal(isGenBlazeImageRequestApplicable({
    model: 'NANOBANANAPRO',
    aspectRatio: '4:5',
  }), true);
  assert.equal(isGenBlazeImageRequestApplicable({
    model: 'NANOBANANAPRO',
    aspectRatio: '3:2',
  }), false);
  assert.equal(isGenBlazeImageRequestApplicable({
    model: 'NANOBANANAPRO',
    aspect_ratio: '2:3',
  }), false);
  assert.equal(isGenBlazeImageRequestApplicable({
    model: 'NANOBANANAPRO',
    aspectRatio: '3:2',
    apiRequestId: 'genblaze-image:already-submitted',
  }), true);
});

test('submits once, stores an opaque prefixed id, and unlocks the row', async () => {
  const recorder = createModelRecorder();
  const calls = [];
  const result = await handleGenBlazeImageRequest(
    {
      _id: 'image-row-1',
      model: 'NANOBANANA2',
      prompt: 'paper sculpture',
      aspectRatio: '1:1',
      apiGenerationStatus: 'INIT',
    },
    {
      connect: async () => {},
      imageGenerationModel: recorder.model,
      request: async (pathname, options) => {
        calls.push({ pathname, options });
        return { request_id: 'sealed-job-token', status: 'pending' };
      },
      logger: { error() {} },
    },
  );

  assert.equal(result, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, '/media/requests');
  assert.equal(calls[0].options.body.model, 'NANOBANANA2');
  const persisted = recorder.updates.at(-1).update;
  assert.equal(persisted.apiRequestId, 'genblaze-image:sealed-job-token');
  assert.equal(persisted.apiGenerationStatus, 'PENDING');
  assert.equal(persisted.externalProvider, 'gmicloud');
  assert.equal(persisted.rowLocked, false);
  assert.equal(isGenBlazeImageRequestId(persisted.apiRequestId), true);
});

test('polls the same job and preserves the existing image result shape', async () => {
  const recorder = createModelRecorder();
  const calls = [];
  const result = await handleGenBlazeImageRequest(
    {
      _id: 'image-row-2',
      model: 'GPTIMAGE2',
      aspectRatio: '16:9',
      apiGenerationStatus: 'PENDING',
      apiRequestId: 'genblaze-image:sealed/job',
    },
    {
      connect: async () => {},
      imageGenerationModel: recorder.model,
      request: async (pathname) => {
        calls.push(pathname);
        return {
          status: 'succeeded',
          assets: [{ url: 'https://cdn.example/generated.png', media_type: 'image/png' }],
          error: null,
        };
      },
      saveFile: async (url) => {
        assert.equal(url, 'https://cdn.example/generated.png');
        return 'generated-local.png';
      },
      logger: { error() {} },
    },
  );

  assert.deepEqual(calls, ['/media/requests/sealed%2Fjob']);
  assert.deepEqual(result, {
    image: 'generated-local.png',
    width: 1536,
    height: 864,
    preserveOriginalForAiVideo: true,
  });
  assert.equal(recorder.updates.at(-1).update.externalProvider, 'gmicloud');
  assert.equal(recorder.updates.at(-1).update.rowLocked, false);
});

test('GPT Image 2 polling honors the same snake-case ratio accepted at submission', async () => {
  const recorder = createModelRecorder();
  const result = await handleGenBlazeImageRequest(
    {
      _id: 'image-row-snake-case',
      model: 'GPTIMAGE2',
      aspect_ratio: '9:16',
      apiGenerationStatus: 'PENDING',
      apiRequestId: 'genblaze-image:snake-case-job',
    },
    {
      connect: async () => {},
      imageGenerationModel: recorder.model,
      request: async () => ({
        status: 'succeeded',
        assets: [{ url: 'https://cdn.example/vertical.png' }],
      }),
      saveFile: async () => 'vertical-local.png',
      logger: { error() {} },
    },
  );

  assert.deepEqual(result, {
    image: 'vertical-local.png',
    width: 864,
    height: 1536,
    preserveOriginalForAiVideo: true,
  });
});

test('returns a structured provider failure so shared failover can rotate adapters', async () => {
  const recorder = createModelRecorder();
  const result = await handleGenBlazeImageRequest(
    {
      _id: 'image-row-3',
      model: 'SEEDREAM',
      apiGenerationStatus: 'PENDING',
      apiRequestId: 'genblaze-image:sealed-job',
    },
    {
      connect: async () => {},
      imageGenerationModel: recorder.model,
      request: async () => ({ status: 'failed', assets: [], error: 'quota exceeded' }),
      logger: { error() {} },
    },
  );

  assert.deepEqual(result, { image: null, error: 'quota exceeded' });
  assert.equal(recorder.updates.at(-1).update.rowLocked, false);
});
