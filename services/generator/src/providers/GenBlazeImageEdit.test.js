import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenBlazeImageEditRequest,
  handleGenBlazeImageEditRequest,
  isGenBlazeImageEditRequestId,
  shouldUseGenBlazeImageEditProvider,
} from './GenBlazeImageEdit.js';

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

const PUBLIC_URL_DEPENDENCIES = {
  resolveMediaUrls: async (values) => values.map((value) => `https://public.example/${value}`),
  resolveMediaUrl: async (value) => `https://public.example/${value}`,
};

test('builds GPT Image 2 edit with a required source and optional mask', async () => {
  assert.deepEqual(await buildGenBlazeImageEditRequest({
    model: 'GPTIMAGE2EDIT',
    prompt: 'paint a rainbow',
    image: 'source.png',
    aspectRatio: '16:9',
  }, PUBLIC_URL_DEPENDENCIES), {
    model: 'GPTIMAGE2EDIT',
    modality: 'image',
    prompt: 'paint a rainbow',
    input_urls: ['https://public.example/source.png'],
    params: {
      size: '1536x864',
      quality: 'high',
      number_of_images: 1,
    },
  });

  const withMask = await buildGenBlazeImageEditRequest({
    model: 'GPTIMAGE2EDIT',
    prompt: 'replace the sky',
    image: 'source.png',
    maskImage: 'mask.png',
  }, PUBLIC_URL_DEPENDENCIES);
  assert.deepEqual(withMask.input_urls, [
    'https://public.example/source.png',
    'https://public.example/mask.png',
  ]);
});

test('Nano edits publish at most fourteen references and bypass multi-output image sets', async () => {
  const request = await buildGenBlazeImageEditRequest({
    model: 'NANOBANANA2EDIT',
    prompt: 'combine the references',
    image_urls: Array.from({ length: 16 }, (_, index) => `${index}.png`),
    maskImage: 'not-a-nano-mask.png',
    resolution: '2K',
  }, PUBLIC_URL_DEPENDENCIES);

  assert.equal(request.input_urls.length, 14);
  assert.equal(request.input_urls.includes('https://public.example/not-a-nano-mask.png'), false);
  assert.deepEqual(request.params, {
    aspect_ratio: '1:1',
    resolution: '2K',
    output_format: 'png',
  });

  await assert.rejects(
    buildGenBlazeImageEditRequest({
      model: 'NANOBANANA2EDIT',
      case_type: 'image_list_to_image_set',
      image: 'source.png',
    }, PUBLIC_URL_DEPENDENCIES),
    /does not preserve Samsar multi-output image-set requests/,
  );
});

test('BRIA edit routes require source and mask and preserve supported GenFill controls', async () => {
  await assert.rejects(
    buildGenBlazeImageEditRequest({
      model: 'BRIA_ERASER',
      image: 'source.png',
    }, PUBLIC_URL_DEPENDENCIES),
    /requires a mask image/,
  );

  assert.deepEqual(await buildGenBlazeImageEditRequest({
    model: 'BRIA_GENFILL',
    image: 'source.png',
    maskImage: 'mask.png',
    prompt: 'fill with flowers',
    negativePrompt: 'text',
    guidanceScale: 5,
    numInferenceSteps: 30,
  }, PUBLIC_URL_DEPENDENCIES), {
    model: 'BRIA_GENFILL',
    modality: 'image',
    prompt: 'fill with flowers',
    input_urls: [
      'https://public.example/source.png',
      'https://public.example/mask.png',
    ],
    params: {
      negative_prompt: 'text',
      guidance_scale: 5,
      num_inference_steps: 30,
    },
  });
});

test('submits and polls an opaque image-edit job while preserving Samsar result shape', async () => {
  const recorder = createModelRecorder();
  const calls = [];
  const submitted = await handleGenBlazeImageEditRequest({
    _id: 'edit-row-1',
    model: 'GPTIMAGE2EDIT',
    prompt: 'edit',
    image: 'source.png',
    apiEditStatus: 'INIT',
  }, {
    ...PUBLIC_URL_DEPENDENCIES,
    connect: async () => {},
    imageGenerationModel: recorder.model,
    request: async (pathname, options) => {
      calls.push({ pathname, options });
      return { request_id: 'sealed-edit-job', status: 'pending' };
    },
    logger: { error() {} },
  });

  assert.equal(submitted, null);
  assert.equal(calls[0].pathname, '/media/requests');
  const persisted = recorder.updates.at(-1).update;
  assert.equal(persisted.apiRequestId, 'genblaze-image-edit:sealed-edit-job');
  assert.equal(persisted.apiEditStatus, 'PENDING');
  assert.equal(persisted.editStatus, 'PENDING');
  assert.equal(persisted.externalProvider, 'gmicloud');
  assert.equal(isGenBlazeImageEditRequestId(persisted.apiRequestId), true);

  const result = await handleGenBlazeImageEditRequest({
    _id: 'edit-row-1',
    model: 'GPTIMAGE2EDIT',
    apiEditStatus: 'PENDING',
    apiRequestId: persisted.apiRequestId,
  }, {
    connect: async () => {},
    imageGenerationModel: recorder.model,
    request: async () => ({
      status: 'succeeded',
      assets: [{ url: 'https://cdn.example/edited.png', media_type: 'image/png' }],
      error: null,
    }),
    saveFile: async () => 'edited-local.png',
    logger: { error() {} },
  });

  assert.deepEqual(result, {
    image: 'edited-local.png',
    resultUrl: 'https://cdn.example/edited.png',
    resultUrls: ['https://cdn.example/edited.png'],
  });
});

test('selects GenBlaze only for standalone compatible single-output edits', (t) => {
  const original = {
    currentEnv: process.env.CURRENT_ENV,
    edition: process.env.SAMSAR_DEPLOYMENT_EDITION,
    enabled: process.env.SAMSAR_GENBLAZE_ENABLED,
  };
  t.after(() => {
    if (original.currentEnv === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = original.currentEnv;
    if (original.edition === undefined) delete process.env.SAMSAR_DEPLOYMENT_EDITION;
    else process.env.SAMSAR_DEPLOYMENT_EDITION = original.edition;
    if (original.enabled === undefined) delete process.env.SAMSAR_GENBLAZE_ENABLED;
    else process.env.SAMSAR_GENBLAZE_ENABLED = original.enabled;
  });

  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  assert.equal(shouldUseGenBlazeImageEditProvider({
    model: 'NANOBANANAPROEDIT',
    adapterProviderOverride: 'gmicloud',
  }), true);
  assert.equal(shouldUseGenBlazeImageEditProvider({
    model: 'NANOBANANAPROEDIT',
    adapterProviderOverride: 'gmicloud',
    case_type: 'image_list_to_image_set',
  }), false);

  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  assert.equal(shouldUseGenBlazeImageEditProvider({
    model: 'GPTIMAGE2EDIT',
    adapterProviderOverride: 'gmicloud',
  }), false);
});
