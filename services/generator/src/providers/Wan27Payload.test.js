import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALIBABA_WAN_27_PRO_MODEL,
  buildAlibabaWan27Request,
  buildFalWan27Input,
  getWan27OneKOutput,
  normalizeWan27AspectRatio,
} from './Wan27Payload.js';

test('normalizes the supported Wan2.7 Pro aspect ratios', () => {
  assert.equal(normalizeWan27AspectRatio('16x9'), '16:9');
  assert.equal(normalizeWan27AspectRatio('9:16'), '9:16');
  assert.equal(normalizeWan27AspectRatio('4:3'), '1:1');
});

test('maps Wan2.7 Pro ratios to the Samsar 1K canvas dimensions', () => {
  assert.deepEqual(getWan27OneKOutput('1:1'), {
    aspectRatio: '1:1',
    resolution: '1K',
    width: 1024,
    height: 1024,
    falImageSize: 'square_hd',
  });
  assert.deepEqual(getWan27OneKOutput('16:9'), {
    aspectRatio: '16:9',
    resolution: '1K',
    width: 1792,
    height: 1024,
    falImageSize: { width: 1792, height: 1024 },
  });
  assert.deepEqual(getWan27OneKOutput('9:16'), {
    aspectRatio: '9:16',
    resolution: '1K',
    width: 1024,
    height: 1792,
    falImageSize: { width: 1024, height: 1792 },
  });
});

test('builds the Fal Wan2.7 Pro request with explicit PNG output', () => {
  assert.deepEqual(buildFalWan27Input({
    prompt: 'A cinematic mountain road',
    aspectRatio: '16:9',
    negative_prompt: 'watermark',
    seed: 42,
  }), {
    prompt: 'A cinematic mountain road',
    image_size: { width: 1792, height: 1024 },
    num_images: 1,
    enable_safety_checker: true,
    output_format: 'png',
    negative_prompt: 'watermark',
    seed: 42,
  });
});

test('builds the native Alibaba Wan2.7 Pro request with a custom 1K ratio', () => {
  assert.deepEqual(buildAlibabaWan27Request({
    prompt: 'A portrait lit by neon signs',
    aspect_ratio: '9:16',
  }), {
    model: ALIBABA_WAN_27_PRO_MODEL,
    input: {
      messages: [{
        role: 'user',
        content: [{ text: 'A portrait lit by neon signs' }],
      }],
    },
    parameters: {
      size: '1024*1792',
      n: 1,
      watermark: false,
      thinking_mode: true,
    },
  });
});

test('rejects empty Wan2.7 Pro prompts', () => {
  assert.throws(() => buildFalWan27Input({ prompt: '   ' }), /non-empty prompt/);
  assert.throws(() => buildAlibabaWan27Request({}), /non-empty prompt/);
});
