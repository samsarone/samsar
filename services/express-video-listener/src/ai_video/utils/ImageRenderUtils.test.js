import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { createCanvas, loadImage } from 'canvas';

import {
  getFrameImageForLayer,
  getSelectedFrameImageForImageSession,
} from './ImageRenderUtils.js';

async function writePng(filePath) {
  const canvas = createCanvas(16, 16);
  const context = canvas.getContext('2d');
  context.fillStyle = '#57b9ff';
  context.fillRect(0, 0, 16, 16);
  await fs.promises.writeFile(filePath, canvas.toBuffer('image/png'));
}

test('mounted absolute asset references remain absolute', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-image-render-utils-absolute-'));
  const imagePath = path.join(tmpDir, 'mounted.png');
  await writePng(imagePath);
  const originalAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT;
  process.env.SAMSAR_ASSETS_V2_ROOT = tmpDir;

  try {
    const resolvedPath = getSelectedFrameImageForImageSession({
      activeSelectedImage: imagePath,
    });

    assert.equal(await fs.promises.realpath(resolvedPath), await fs.promises.realpath(imagePath));
  } finally {
    if (originalAssetsV2Root === undefined) delete process.env.SAMSAR_ASSETS_V2_ROOT;
    else process.env.SAMSAR_ASSETS_V2_ROOT = originalAssetsV2Root;
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

test('boundary frame rendering loads an existing absolute image source', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-image-render-utils-frame-'));
  const listenerDir = path.join(tmpDir, 'samsar_express_video_listener');
  const imagePath = path.join(tmpDir, 'mounted.png');
  await fs.promises.mkdir(listenerDir, { recursive: true });
  await writePng(imagePath);

  const originalCwd = process.cwd();
  const originalAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT;
  process.chdir(listenerDir);
  process.env.SAMSAR_ASSETS_V2_ROOT = tmpDir;
  try {
    const renderedPath = await getFrameImageForLayer(
      '6a5c777b1e38193473987f3f',
      '6a5c7b6f1e381934739882d3',
      '16:9',
      [{ type: 'image', src: imagePath, x: 0, y: 0, width: 16, height: 16 }],
    );

    assert.equal(fs.existsSync(renderedPath), true);
  } finally {
    process.chdir(originalCwd);
    if (originalAssetsV2Root === undefined) delete process.env.SAMSAR_ASSETS_V2_ROOT;
    else process.env.SAMSAR_ASSETS_V2_ROOT = originalAssetsV2Root;
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

test('boundary frame rendering resolves a missing relative source through protected provider media', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-image-render-utils-cdn-'));
  const listenerDir = path.join(tmpDir, 'samsar_express_video_listener');
  const imagePath = path.join(tmpDir, 'source.png');
  await fs.promises.mkdir(listenerDir, { recursive: true });
  await writePng(imagePath);

  const originalCwd = process.cwd();
  const originalCurrentEnv = process.env.CURRENT_ENV;
  process.chdir(listenerDir);
  process.env.CURRENT_ENV = 'test';
  const normalizedSources = [];
  const loadedSources = [];
  try {
    const renderedPath = await getFrameImageForLayer(
      '6a6201615943476697dbc22a',
      '6a6205748a7fec54292f1d80',
      '16:9',
      [{
        type: 'image',
        src: 'assets_v2/generations/6a6201615943476697dbc22a/source.png',
        x: 0,
        y: 0,
        width: 16,
        height: 16,
      }],
      {
        normalizeProviderMediaUrlImpl: async (source, options) => {
          normalizedSources.push({ source, options });
          return 'https://static.example.test/assets_v2/generations/6a6201615943476697dbc22a/source.png?Expires=123&Signature=signed&Key-Pair-Id=KTEST';
        },
        loadImageImpl: async (source) => {
          loadedSources.push(source);
          return loadImage(imagePath);
        },
      },
    );

    assert.equal(fs.existsSync(renderedPath), true);
    assert.deepEqual(normalizedSources, [{
      source: 'assets_v2/generations/6a6201615943476697dbc22a/source.png',
      options: { mediaKind: 'image' },
    }]);
    assert.match(loadedSources[0], /^https:\/\/static\.example\.test\//);
    assert.match(loadedSources[0], /Signature=signed/);
  } finally {
    process.chdir(originalCwd);
    if (originalCurrentEnv === undefined) delete process.env.CURRENT_ENV;
    else process.env.CURRENT_ENV = originalCurrentEnv;
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

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
  const originalCurrentEnv = process.env.CURRENT_ENV;
  process.chdir(listenerDir);
  process.env.CURRENT_ENV = 'test';
  try {
    const resolvedPath = getSelectedFrameImageForImageSession(
      {
        activeGeneratedImage: 'assets_v2/generations/reroll-session/scene.png',
      },
      'reroll-session',
    );

    assert.equal(await fs.promises.realpath(resolvedPath), await fs.promises.realpath(imagePath));
  } finally {
    process.chdir(originalCwd);
    if (originalCurrentEnv === undefined) {
      delete process.env.CURRENT_ENV;
    } else {
      process.env.CURRENT_ENV = originalCurrentEnv;
    }
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
  const originalCurrentEnv = process.env.CURRENT_ENV;
  process.chdir(listenerDir);
  process.env.CURRENT_ENV = 'test';
  try {
    const resolvedPath = getSelectedFrameImageForImageSession(
      {
        activeSelectedImage: 'https://static.samsar.one/assets_v2/generations/reroll-session/scene.png?Expires=123&Signature=oldsig&Key-Pair-Id=KOLD',
      },
      'reroll-session',
    );

    assert.equal(await fs.promises.realpath(resolvedPath), await fs.promises.realpath(imagePath));
  } finally {
    process.chdir(originalCwd);
    if (originalCurrentEnv === undefined) {
      delete process.env.CURRENT_ENV;
    } else {
      process.env.CURRENT_ENV = originalCurrentEnv;
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});
