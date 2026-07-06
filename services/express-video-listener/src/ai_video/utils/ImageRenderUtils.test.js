import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getSelectedFrameImageForImageSession } from './ImageRenderUtils.js';

test('selected frame resolver falls back to activeGeneratedImage for reroll image sessions', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-image-render-utils-'));
  const listenerDir = path.join(tmpDir, 'samsar_express_video_listener');
  const processorAssetDir = path.join(
    tmpDir,
    'samsar_processor',
    'assets_v2',
    'generations',
    'reroll-session',
  );
  await fs.promises.mkdir(listenerDir, { recursive: true });
  await fs.promises.mkdir(processorAssetDir, { recursive: true });
  const imagePath = path.join(processorAssetDir, 'scene.png');
  await fs.promises.writeFile(imagePath, 'image');

  const originalCwd = process.cwd();
  process.chdir(listenerDir);
  try {
    const resolvedPath = getSelectedFrameImageForImageSession(
      {
        activeGeneratedImage: 'assets_v2/generations/reroll-session/scene.png',
      },
      'reroll-session',
    );

    assert.equal(resolvedPath, imagePath);
  } finally {
    process.chdir(originalCwd);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

test('selected frame resolver maps signed static CDN URLs to local assets', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-image-render-utils-url-'));
  const listenerDir = path.join(tmpDir, 'samsar_express_video_listener');
  const processorAssetDir = path.join(
    tmpDir,
    'samsar_processor',
    'assets_v2',
    'generations',
    'reroll-session',
  );
  await fs.promises.mkdir(listenerDir, { recursive: true });
  await fs.promises.mkdir(processorAssetDir, { recursive: true });
  const imagePath = path.join(processorAssetDir, 'scene.png');
  await fs.promises.writeFile(imagePath, 'image');

  const originalCwd = process.cwd();
  process.chdir(listenerDir);
  try {
    const resolvedPath = getSelectedFrameImageForImageSession(
      {
        activeSelectedImage: 'https://static.samsar.one/assets_v2/generations/reroll-session/scene.png?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD',
      },
      'reroll-session',
    );

    assert.equal(resolvedPath, imagePath);
  } finally {
    process.chdir(originalCwd);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});
