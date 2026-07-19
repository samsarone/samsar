import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { __testOnly__ } from './GoogleVeo3NativeListener.js';

test('Google Veo inline input reads Docker mounted images without a public URL', async (t) => {
  const originalRoot = process.env.SAMSAR_ASSETS_V2_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'google-veo-mounted-'));
  const imagePath = path.join(root, 'generations', 'session', 'frame.png');
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  fs.writeFileSync(imagePath, pngHeader);
  process.env.SAMSAR_ASSETS_V2_ROOT = root;

  t.after(() => {
    if (originalRoot === undefined) delete process.env.SAMSAR_ASSETS_V2_ROOT;
    else process.env.SAMSAR_ASSETS_V2_ROOT = originalRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const payload = await __testOnly__.buildVeoImagePayload(
    'http://localhost:3002/assets_v2/generations/session/frame.png',
  );
  assert.equal(payload.mimeType, 'image/png');
  assert.equal(payload.bytesBase64Encoded, pngHeader.toString('base64'));
});
