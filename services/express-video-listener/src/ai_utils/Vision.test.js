import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveVisionImageReference, resolveVisionProviderImageUrl } from './Vision.js';

test('stable vision reference skips an unusable local URL and keeps the mounted fallback', (t) => {
  const previousEnv = process.env.CURRENT_ENV;
  const previousRoot = process.env.SAMSAR_ASSETS_V2_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'express-vision-mounted-'));
  const fallbackPath = path.join(root, 'generations', 'fallback.png');
  fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
  fs.writeFileSync(fallbackPath, 'image');
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_ASSETS_V2_ROOT = root;
  t.after(() => {
    if (previousEnv === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = previousEnv;
    if (previousRoot === undefined) delete process.env.SAMSAR_ASSETS_V2_ROOT;
    else process.env.SAMSAR_ASSETS_V2_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = resolveVisionImageReference(
    { activeSelectedImage: 'assets_v2/generations/fallback.png' },
    { src: 'http://localhost:3002/not-a-media-route/frame.png' },
  );
  assert.equal(result, 'assets_v2/generations/fallback.png');
});

test('vision resolves legacy image filenames as mounted assets through the canonical resolver', async () => {
  const references = [];
  const result = await resolveVisionProviderImageUrl(
    {},
    { src: 'session/frame.png' },
    async (reference) => {
      references.push(reference);
      return `https://media-tunnel.trycloudflare.com/${reference}`;
    },
  );

  assert.deepEqual(references, ['assets/images/session/frame.png']);
  assert.equal(
    result,
    'https://media-tunnel.trycloudflare.com/assets/images/session/frame.png',
  );
});

test('vision falls back from an unusable active item URL to the persisted mounted image', async () => {
  const references = [];
  const result = await resolveVisionProviderImageUrl(
    { activeSelectedImage: 'assets_v2/generations/session/frame.png' },
    { src: 'blob:browser-only-image' },
    async (reference) => {
      references.push(reference);
      if (reference.startsWith('blob:')) {
        throw new Error('Browser blob URLs are not provider-readable.');
      }
      return 'https://media-tunnel.trycloudflare.com/assets_v2/generations/session/frame.png';
    },
  );

  assert.deepEqual(references, [
    'blob:browser-only-image',
    'assets_v2/generations/session/frame.png',
  ]);
  assert.equal(
    result,
    'https://media-tunnel.trycloudflare.com/assets_v2/generations/session/frame.png',
  );
});

test('vision supports nested image_url objects without bypassing canonical normalization', async () => {
  const references = [];
  const result = await resolveVisionProviderImageUrl(
    {},
    { image_url: { url: '/generations/session/frame.png' } },
    async (reference) => {
      references.push(reference);
      return 'https://media-tunnel.trycloudflare.com/assets_v2/generations/session/frame.png';
    },
  );

  assert.deepEqual(references, ['/generations/session/frame.png']);
  assert.match(result, /^https:\/\//);
});
