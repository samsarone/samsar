import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGoogleNanoBananaGenerateContentRequest,
  normalizeGoogleNanoBananaAspectRatio,
  normalizeGoogleNanoBananaRequestPayload,
  resolveGoogleNanoBananaModel,
} from './GoogleNanoBananaNative.js';

test('normalizes portrait aliases and API-style aspect ratio payload fields', () => {
  assert.equal(normalizeGoogleNanoBananaAspectRatio('portrait'), '9:16');
  assert.equal(normalizeGoogleNanoBananaAspectRatio('vertical'), '9:16');
  assert.equal(normalizeGoogleNanoBananaAspectRatio('9_16'), '9:16');

  const normalized = normalizeGoogleNanoBananaRequestPayload({
    prompt: 'A mobile portrait hero image',
    aspect_ratio: '9:16',
    resolution: '4k',
    num_images: 3,
  });

  assert.equal(normalized.aspectRatio, '9:16');
  assert.equal(normalized.resolution, '4K');
  assert.equal(normalized.numImages, 3);
});

test('infers Google-supported aspect ratio from image dimensions', () => {
  const normalized = normalizeGoogleNanoBananaRequestPayload({
    text: 'A tall social story image',
    targetWidth: 1080,
    targetHeight: 1920,
  });

  assert.equal(normalized.prompt, 'A tall social story image');
  assert.equal(normalized.aspectRatio, '9:16');
});

test('maps non-supported dimensions to nearest Google aspect ratio', () => {
  assert.equal(normalizeGoogleNanoBananaAspectRatio('1024x1792'), '9:16');
  assert.equal(normalizeGoogleNanoBananaAspectRatio('1792x1024'), '16:9');
});

test('builds Gemini image generation request with imageConfig aspectRatio', () => {
  const request = buildGoogleNanoBananaGenerateContentRequest({
    prompt: 'A portrait product photo',
    aspectRatio: '9:16',
    resolution: '2K',
  });

  assert.deepEqual(request.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.equal(request.generationConfig.imageConfig.aspectRatio, '9:16');
  assert.equal(request.generationConfig.imageConfig.imageSize, '2K');
  assert.equal(request.contents[0].parts[0].text, 'A portrait product photo');
});

test('uses Vertex Gemini Pro Image preview model for native NanoBanana Pro', () => {
  const previousModel = process.env.GOOGLE_NANOBANANA_PRO_MODEL;
  delete process.env.GOOGLE_NANOBANANA_PRO_MODEL;

  try {
    assert.equal(resolveGoogleNanoBananaModel('NANOBANANAPRO'), 'gemini-3-pro-image-preview');

    process.env.GOOGLE_NANOBANANA_PRO_MODEL = 'gemini-3-pro-image';
    assert.equal(resolveGoogleNanoBananaModel('NANOBANANAPRO'), 'gemini-3-pro-image-preview');
  } finally {
    if (previousModel === undefined) {
      delete process.env.GOOGLE_NANOBANANA_PRO_MODEL;
    } else {
      process.env.GOOGLE_NANOBANANA_PRO_MODEL = previousModel;
    }
  }
});
