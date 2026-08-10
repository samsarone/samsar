import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAlibabaQwenImage3Request,
  getQwenImage3Output,
  normalizeQwenImage3AspectRatio,
  QWEN_IMAGE_3_SUPPORTED_ASPECT_RATIOS,
} from './QwenImage3Payload.js';

test('maps supported Qwen Image 3 aspect ratios to valid concrete sizes', () => {
  assert.deepEqual(QWEN_IMAGE_3_SUPPORTED_ASPECT_RATIOS, ['1:1', '16:9', '9:16']);
  assert.deepEqual(getQwenImage3Output('1:1'), {
    aspectRatio: '1:1',
    width: 1024,
    height: 1024,
  });
  assert.deepEqual(getQwenImage3Output('16x9'), {
    aspectRatio: '16:9',
    width: 1792,
    height: 1024,
  });
  assert.deepEqual(getQwenImage3Output('9:16'), {
    aspectRatio: '9:16',
    width: 1024,
    height: 1792,
  });
  assert.equal(normalizeQwenImage3AspectRatio('unsupported'), '1:1');
});

test('builds the Alibaba Qwen Image 3 synchronous text-to-image request', () => {
  assert.deepEqual(buildAlibabaQwenImage3Request({
    prompt: 'A typographic travel poster',
    aspectRatio: '16:9',
    resolution: '1k',
    negativePrompt: 'blurred lettering',
    seed: 42,
  }), {
    model: 'qwen-image-3.0-pro',
    input: {
      messages: [{
        role: 'user',
        content: [{ text: 'A typographic travel poster' }],
      }],
    },
    parameters: {
      size: '1792*1024',
      n: 1,
      prompt_extend: true,
      watermark: false,
      negative_prompt: 'blurred lettering',
      seed: 42,
    },
  });
});

test('Qwen Image 3 ignores legacy resolution and omits invalid optional values', () => {
  const request = buildAlibabaQwenImage3Request({
    prompt: 'A square image',
    aspect_ratio: 'not-supported',
    resolution: '4k',
    seed: -1,
    prompt_extend: false,
  });

  assert.equal(request.parameters.size, '1024*1024');
  assert.equal(request.parameters.prompt_extend, false);
  assert.equal('seed' in request.parameters, false);
  assert.equal('negative_prompt' in request.parameters, false);
});

test('Qwen Image 3 requires a prompt', () => {
  assert.throws(
    () => buildAlibabaQwenImage3Request({ prompt: '   ' }),
    /requires a non-empty prompt/i,
  );
});
