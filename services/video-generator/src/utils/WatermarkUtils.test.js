import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Jimp } from 'jimp';

import { embedMessageInPNG } from './WatermarkUtils.js';

function decodeEmbeddedMessage(image) {
  const bits = [];

  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (_x, _y, idx) => {
    for (let channel = 0; channel < 3; channel += 1) {
      bits.push(image.bitmap.data[idx + channel] & 1);
    }
  });

  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      bytes[byteIndex] = (bytes[byteIndex] << 1) | bits[(byteIndex * 8) + bitIndex];
    }
  }

  const messageLength = bytes.readUInt32BE(0);
  return bytes.subarray(4, 4 + messageLength).toString('utf8');
}

test('embedMessageInPNG writes a readable Jimp 1.x PNG with the encoded message', async (t) => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-watermark-'));
  t.after(() => fs.rm(tempDirectory, { recursive: true, force: true }));

  const pngPath = path.join(tempDirectory, 'frame.png');
  const image = new Jimp({ width: 32, height: 32, color: 0x336699ff });
  await fs.writeFile(pngPath, await image.getBuffer('image/png'));

  await embedMessageInPNG(pngPath, 'AI');

  const watermarkedImage = await Jimp.read(pngPath);
  assert.equal(decodeEmbeddedMessage(watermarkedImage), 'AI');
});
