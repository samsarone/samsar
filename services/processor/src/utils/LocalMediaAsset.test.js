import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import {
  readLocalMediaBufferIfAvailable,
  resolveLocalMediaFilePath,
} from './LocalMediaAsset.js';

test('resolves Docker-local assets_v2 URLs to mounted media files', async () => {
  const assetsV2Root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-assets-v2-'));
  const imagePath = path.join(assetsV2Root, 'temp_images', 'outro.png');
  await fs.promises.mkdir(path.dirname(imagePath), { recursive: true });
  await fs.promises.writeFile(imagePath, Buffer.from('image-bytes'));

  const source = 'http://localhost:8080/assets_v2/temp_images/outro.png';
  assert.equal(resolveLocalMediaFilePath(source, { assetsV2Root }), imagePath);

  const buffer = await readLocalMediaBufferIfAvailable(source, { assetsV2Root });
  assert.equal(buffer.toString(), 'image-bytes');
});

test('resolves media-gateway URLs and relative assets_v2 paths', () => {
  const assetsV2Root = path.join(os.tmpdir(), 'samsar-assets-v2');

  assert.equal(
    resolveLocalMediaFilePath('http://media-gateway/assets_v2/video/outro/session/outro.png', { assetsV2Root }),
    path.join(assetsV2Root, 'video', 'outro', 'session', 'outro.png'),
  );
  assert.equal(
    resolveLocalMediaFilePath('/assets_v2/temp_images/outro.png?cache=1', { assetsV2Root }),
    path.join(assetsV2Root, 'temp_images', 'outro.png'),
  );
});

test('does not localize external URLs or traversal paths', () => {
  const assetsV2Root = path.join(os.tmpdir(), 'samsar-assets-v2');

  assert.equal(
    resolveLocalMediaFilePath('https://example.com/assets_v2/temp_images/outro.png', { assetsV2Root }),
    null,
  );
  assert.equal(
    resolveLocalMediaFilePath('http://localhost:8080/assets_v2/temp_images/%2e%2e/outro.png', { assetsV2Root }),
    null,
  );
});
