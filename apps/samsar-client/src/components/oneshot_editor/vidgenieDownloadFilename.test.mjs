import assert from 'node:assert/strict';
import test from 'node:test';

import { createVidgenieDownloadFilename } from './vidgenieDownloadFilename.mjs';

test('creates a filesystem-safe Vidgenie download filename with a random suffix', () => {
  const filename = createVidgenieDownloadFilename({
    now: new Date('2026-07-22T01:02:03.456Z'),
    randomSuffix: 'a1b2c3d4e5f6',
  });

  assert.equal(filename, 'Rendition_2026-07-22T01-02-03-456Z_a1b2c3d4e5f6.mp4');
});

test('creates a new random filename for each download', () => {
  const filenames = new Set(
    Array.from({ length: 20 }, () => createVidgenieDownloadFilename({
      now: new Date('2026-07-22T01:02:03.456Z'),
    })),
  );

  assert.equal(filenames.size, 20);
});
