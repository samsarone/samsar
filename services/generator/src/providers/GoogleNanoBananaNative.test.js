import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildGoogleNanoBananaImagePart,
  buildGoogleNanoBananaGenerateContentRequest,
  normalizeGoogleNanoBananaAspectRatio,
  normalizeGoogleNanoBananaRequestPayload,
  resolveGoogleNanoBananaModel,
  shouldUseGoogleNativeNanoBanana,
} from './GoogleNanoBananaNative.js';

const GOOGLE_PROVIDER_ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'FAL_API_KEY',
  'GOOGLE_NANOBANANA_USE_FAL',
  'GOOGLE_NANOBANANA_NATIVE_ENABLED',
];
const originalGoogleProviderEnv = Object.fromEntries(
  GOOGLE_PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]]),
);

test.afterEach(() => {
  GOOGLE_PROVIDER_ENV_KEYS.forEach((key) => {
    if (originalGoogleProviderEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalGoogleProviderEnv[key];
    }
  });
});

test('builds native Google inlineData from a mounted image without a public URL', async (t) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'samsar-google-inline-'));
  const imagePath = path.join(tempRoot, 'frame.png');
  await writeFile(imagePath, Buffer.from('mounted-image'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const part = await buildGoogleNanoBananaImagePart(imagePath);

  assert.deepEqual(part, {
    inlineData: {
      mimeType: 'image/png',
      data: Buffer.from('mounted-image').toString('base64'),
    },
  });
});

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

test('uses the stable Vertex Gemini Pro Image model for native NanoBanana Pro', () => {
  const previousModel = process.env.GOOGLE_NANOBANANA_PRO_MODEL;
  delete process.env.GOOGLE_NANOBANANA_PRO_MODEL;

  try {
    assert.equal(resolveGoogleNanoBananaModel('NANOBANANAPRO'), 'gemini-3-pro-image');

    process.env.GOOGLE_NANOBANANA_PRO_MODEL = 'gemini-3-pro-image';
    assert.equal(resolveGoogleNanoBananaModel('NANOBANANAPRO'), 'gemini-3-pro-image');
  } finally {
    if (previousModel === undefined) {
      delete process.env.GOOGLE_NANOBANANA_PRO_MODEL;
    } else {
      process.env.GOOGLE_NANOBANANA_PRO_MODEL = previousModel;
    }
  }
});

test('production starts NanoBanana Pro generations with Fal only', () => {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.FAL_API_KEY = 'fal-key';
  delete process.env.GOOGLE_NANOBANANA_USE_FAL;
  process.env.GOOGLE_NANOBANANA_NATIVE_ENABLED = 'true';

  assert.equal(shouldUseGoogleNativeNanoBanana('NANOBANANAPRO'), false);
  assert.equal(shouldUseGoogleNativeNanoBanana('NANOBANANA2'), true);

  delete process.env.FAL_API_KEY;
  assert.equal(shouldUseGoogleNativeNanoBanana('NANOBANANAPRO'), true);
  process.env.FAL_API_KEY = 'fal-key';

  process.env.CURRENT_ENV = 'staging';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'staging';
  assert.equal(shouldUseGoogleNativeNanoBanana('NANOBANANAPRO'), true);

  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  assert.equal(shouldUseGoogleNativeNanoBanana('NANOBANANAPRO'), true);
});

test('production continues an in-flight native Google NanoBanana Pro request', () => {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.FAL_API_KEY = 'fal-key';
  delete process.env.GOOGLE_NANOBANANA_USE_FAL;
  process.env.GOOGLE_NANOBANANA_NATIVE_ENABLED = 'true';

  assert.equal(shouldUseGoogleNativeNanoBanana({
    model: 'NANOBANANAPRO',
    apiGenerationStatus: 'PENDING',
    apiRequestId: 'google-native-nanobanana:existing-request',
  }), true);
  assert.equal(shouldUseGoogleNativeNanoBanana({
    model: 'NANOBANANAPRO',
    apiGenerationStatus: 'PENDING',
    apiRequestId: 'fal-request',
  }), false);
});
