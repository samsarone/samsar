import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildStableDockerMediaUrl } from './DockerMediaDeliveryUrl.js';

test('uses configured processor URL for stable Docker UI media and rejects tunnel bases', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generator-runtime-media-'));
  const configPath = path.join(root, 'samsar.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    publicUrls: { processorApi: 'http://localhost:3999' },
  }));
  try {
    assert.equal(
      buildStableDockerMediaUrl('assets_v2/temp_images/frame one.png', {
        SAMSAR_RUNTIME_CONFIG_FILE: configPath,
        SAMSAR_PUBLIC_MEDIA_BASE_URL: 'https://temporary.trycloudflare.com',
      }),
      'http://localhost:3999/assets_v2/temp_images/frame%20one.png',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
