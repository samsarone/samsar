import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFalGPTImageTwoInput,
  buildOpenAIGPTImageTwoInput,
  getGPTImageTwoOutput,
  normalizeGPTImageTwoResult,
} from './GPTImageTwoPayload.js';

const EXPECTED_OUTPUTS = [
  ['1:1', 1024, 1024],
  ['16:9', 1536, 864],
  ['9:16', 864, 1536],
];

test('maps every GPT Image 2 aspect ratio to identical native and Fal dimensions', () => {
  for (const [aspectRatio, width, height] of EXPECTED_OUTPUTS) {
    const imageGenerationPayload = {
      prompt: 'A presenter beside a clean product diagram',
      aspectRatio,
    };

    assert.deepEqual(buildOpenAIGPTImageTwoInput(imageGenerationPayload), {
      model: 'gpt-image-2.6-sunburst',
      prompt: imageGenerationPayload.prompt,
      size: `${width}x${height}`,
      quality: 'high',
      output_format: 'png',
      n: 1,
    });
    assert.deepEqual(buildFalGPTImageTwoInput(imageGenerationPayload), {
      prompt: imageGenerationPayload.prompt,
      image_size: { width, height },
      quality: 'high',
      num_images: 1,
      output_format: 'png',
    });
  }
});

test('keeps the native square default for unsupported or missing aspect ratios', () => {
  assert.deepEqual(getGPTImageTwoOutput('unsupported'), {
    aspectRatio: '1:1',
    width: 1024,
    height: 1024,
    openAIImageSize: '1024x1024',
    falImageSize: { width: 1024, height: 1024 },
  });
  assert.equal(buildOpenAIGPTImageTwoInput({ prompt: 'test' }).size, '1024x1024');
  assert.deepEqual(
    buildFalGPTImageTwoInput({ prompt: 'test' }).image_size,
    { width: 1024, height: 1024 },
  );
});

test('a queued native request keeps the provider model sealed before the upgrade', () => {
  const request = buildOpenAIGPTImageTwoInput({
    prompt: 'A product diagram',
    imageAdapterTariffSnapshot: { adapter: 'openai', providerModel: 'gpt-image-2.5-sunburst' },
  });
  assert.equal(request.model, 'gpt-image-2.5-sunburst');
  assert.equal(request.quality, 'high');
  assert.equal(buildOpenAIGPTImageTwoInput({
    imageAdapterTariffSnapshot: { adapter: 'gmicloud', providerModel: 'gpt-image-2.5-sunburst' },
  }).model, 'gpt-image-2.6-sunburst');
});

test('normalizes native and Fal results to one shared response contract', () => {
  assert.deepEqual(normalizeGPTImageTwoResult({
    image: 'generation.png',
    width: 1536,
    height: 864,
  }), {
    image: 'generation.png',
    width: 1536,
    height: 864,
    preserveOriginalForAiVideo: true,
  });
});


test('native image usage survives output normalization for completion billing', () => {
  const imageBillingReceipt = { adapter: 'openai', model: 'gpt-image-2.6-sunburst',
    usage: { input_tokens: 10, input_tokens_details: { text_tokens: 10, image_tokens: 0 }, output_tokens: 1000 } };
  const output = normalizeGPTImageTwoResult({ image: 'generated.png', width: 1024, height: 1024, imageBillingReceipt });
  assert.deepEqual(output.imageBillingReceipt, imageBillingReceipt);
});
