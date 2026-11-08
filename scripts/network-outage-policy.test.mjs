import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalPath = 'services/processor/src/utils/NetworkOutagePolicy.js';
const copies = [
  'services/ai-video-layer-generator/src/utils/NetworkOutagePolicy.js',
  'services/audio-generator/src/utils/NetworkOutagePolicy.js',
  'services/express-video-listener/src/utils/NetworkOutagePolicy.js',
];

// Source projects synchronize these independent service packages. Fail if a
// partial sync/release lets classification or retry safety drift between them.
test('central provider workers ship byte-identical common network outage policy', async () => {
  const canonical = await fs.readFile(path.join(root, canonicalPath), 'utf8');
  assert.match(canonical, /NETWORK_OUTAGE_POLICY_VERSION = 1/);
  for (const relativePath of copies) {
    const mirrored = await fs.readFile(path.join(root, relativePath), 'utf8');
    assert.equal(mirrored, canonical, `${relativePath} must match ${canonicalPath}; update canonical source and resync every consuming source project`);
  }
});
