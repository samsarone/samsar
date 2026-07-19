import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createCanvas } from 'canvas';

import { getFrameImageForLayer } from './ImageRenderUtils.js';

test('boundary frame rendering loads an existing absolute image source', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'samsar-processor-image-frame-'));
  const processorDir = path.join(tmpDir, 'samsar_processor');
  const imagePath = path.join(tmpDir, 'mounted.png');
  await fs.promises.mkdir(processorDir, { recursive: true });

  const canvas = createCanvas(16, 16);
  const context = canvas.getContext('2d');
  context.fillStyle = '#57b9ff';
  context.fillRect(0, 0, 16, 16);
  await fs.promises.writeFile(imagePath, canvas.toBuffer('image/png'));

  const originalCwd = process.cwd();
  const originalAssetsV2Root = process.env.SAMSAR_ASSETS_V2_ROOT;
  process.chdir(processorDir);
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
