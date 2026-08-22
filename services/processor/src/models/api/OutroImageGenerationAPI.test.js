import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import axios from 'axios';
import sharp from 'sharp';

const ENV_KEYS = [
  'CLOUDFRONT_KEY_PAIR_ID',
  'CLOUDFRONT_PRIVATE_KEY',
  'CLOUDFRONT_PRIVATE_KEY_BASE64',
  'CLOUDFRONT_PRIVATE_KEY_PATH',
  'CURRENT_ENV',
  'MEDIA_BUCKET_NAME',
  'MEDIA_DELIVERY_MODE',
  'SAMSAR_MEDIA_DELIVERY_MODE',
  'STATIC_CDN_URL',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

for (const key of ENV_KEYS) {
  delete process.env[key];
}
Object.assign(process.env, {
  MEDIA_BUCKET_NAME: 'samsar-test-media',
  SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
  STATIC_CDN_URL: 'https://static.samsar.one/',
});

const { generateOutroCompositionAssetsFromImageList } = await import('./OutroImageGenerationAPI.js');

test.after(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
});

test('refreshes an expired managed CTA image URL before generating the outro', async (t) => {
  const assetsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-outro-refresh-'));
  t.after(() => fs.promises.rm(assetsRoot, { recursive: true, force: true }));

  const sourceImage = await sharp({
    create: {
      width: 32,
      height: 20,
      channels: 4,
      background: { r: 31, g: 41, b: 55, alpha: 1 },
    },
  }).png().toBuffer();
  const staleUrl = 'https://static.samsar.one/assets_v2/temp_images/cta.png?Expires=1&Signature=stale&Key-Pair-Id=stale';
  let requestedUrl = null;

  t.mock.method(axios, 'get', async (url) => {
    requestedUrl = url;
    return { data: sourceImage };
  });

  const result = await generateOutroCompositionAssetsFromImageList({
    aspectRatio: '9:16',
    assetsRoot,
    imageListPayload: [],
    imageUrls: [],
    outroCtaImage: { middle_image: { url: staleUrl } },
    sessionId: 'session-with-expired-upload',
  });

  assert.equal(
    requestedUrl,
    'https://static.samsar.one/assets_v2/temp_images/cta.png',
  );
  assert.equal(result.centerType, 'cta_image');
  assert.equal(result.tileCount, 0);
  await fs.promises.access(path.join(
    assetsRoot,
    'video',
    'outro',
    'session-with-expired-upload',
    'outro_cta_image.png',
  ));
});

test('leaves third-party CTA image URLs unchanged', async (t) => {
  const assetsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-outro-third-party-'));
  t.after(() => fs.promises.rm(assetsRoot, { recursive: true, force: true }));

  const sourceImage = await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 4,
      background: { r: 59, g: 130, b: 246, alpha: 1 },
    },
  }).png().toBuffer();
  const thirdPartyUrl = 'https://images.example.com/cta.png?token=keep-me';
  let requestedUrl = null;

  t.mock.method(axios, 'get', async (url) => {
    requestedUrl = url;
    return { data: sourceImage };
  });

  await generateOutroCompositionAssetsFromImageList({
    aspectRatio: '16:9',
    assetsRoot,
    imageListPayload: [],
    imageUrls: [],
    outroCtaImage: { middle_image: { url: thirdPartyUrl } },
    sessionId: 'session-with-third-party-upload',
  });

  assert.equal(requestedUrl, thirdPartyUrl);
});
