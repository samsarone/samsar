import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { uploadImageToCDN } from './AWS.js';

test('Backblaze path-prefixed public URLs remain idempotent', async (t) => {
  const envKeys = [
    'CURRENT_ENV',
    'SAMSAR_MEDIA_DELIVERY_MODE',
    'MEDIA_DELIVERY_MODE',
    'SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED',
    'MEDIA_BUCKET_NAME',
    'STATIC_CDN_URL',
  ];
  const prior = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    MEDIA_DELIVERY_MODE: 'external-s3',
    SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED: 'true',
    MEDIA_BUCKET_NAME: 'my-bucket',
    STATIC_CDN_URL: 'https://f000.backblazeb2.com/file/my-bucket/',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const moduleUrl = new URL('./AWS.js', import.meta.url).href;
  const { buildSecureMediaDeliveryUrl } = await import(`${moduleUrl}?b2=${Date.now()}-${Math.random()}`);
  const publicUrl = 'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/image.png';
  assert.equal(buildSecureMediaDeliveryUrl(publicUrl), publicUrl);
  assert.equal(
    buildSecureMediaDeliveryUrl('assets_v2/session/image one.png'),
    'https://f000.backblazeb2.com/file/my-bucket/assets_v2/session/image%20one.png',
  );
});

test('Docker-local image persistence returns a stable processor URL, not the hosted CDN', async (t) => {
  const prior = Object.fromEntries([
    'CURRENT_ENV',
    'SAMSAR_MEDIA_DELIVERY_MODE',
    'MEDIA_DELIVERY_MODE',
    'SAMSAR_ASSETS_V2_ROOT',
    'SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL',
  ].map((key) => [key, process.env[key]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generator-local-upload-'));
  const source = path.join(root, 'source.png');
  fs.writeFileSync(source, 'png');
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.MEDIA_DELIVERY_MODE = 'docker-local';
  process.env.SAMSAR_ASSETS_V2_ROOT = path.join(root, 'assets_v2');
  process.env.SAMSAR_DOCKER_PUBLIC_PROCESSOR_BASE_URL = 'http://localhost:3002';
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const url = await uploadImageToCDN(source, 'frame.png');
  assert.equal(url, 'http://localhost:3002/assets_v2/temp_images/frame.png');
});
