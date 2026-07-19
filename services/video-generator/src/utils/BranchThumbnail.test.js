import assert from 'node:assert/strict';
import test from 'node:test';

import { uploadBranchThumbnailBestEffort } from './BranchThumbnail.js';

test('branch thumbnail upload succeeds without changing its render artifact', async () => {
  let calls = 0;
  const result = await uploadBranchThumbnailBestEffort({
    artifact: { absoluteThumbnailPath: '/assets/thumbnail.png' },
    sessionId: 'session-1',
    renderPathId: 'root.1',
    uploadThumbnail: async (filePath, sessionId, renderPathId) => {
      calls += 1;
      assert.deepEqual([filePath, sessionId, renderPathId], [
        '/assets/thumbnail.png',
        'session-1',
        'root.1',
      ]);
      return 'https://static.samsar.one/published/thumbnail.png';
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    thumbnailUrl: 'https://static.samsar.one/published/thumbnail.png',
    error: null,
  });
});

test('branch thumbnail upload failure is returned without throwing or retrying the video', async () => {
  let calls = 0;
  const result = await uploadBranchThumbnailBestEffort({
    artifact: { absoluteThumbnailPath: '/assets/thumbnail.png' },
    existingThumbnailUrl: 'https://static.samsar.one/published/previous.png',
    sessionId: 'session-1',
    renderPathId: 'root.1',
    uploadThumbnail: async () => {
      calls += 1;
      throw new Error('temporary thumbnail upload failure');
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    thumbnailUrl: 'https://static.samsar.one/published/previous.png',
    error: 'temporary thumbnail upload failure',
  });
});
