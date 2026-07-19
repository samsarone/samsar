import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';

test('normalizes nested image, video, and audio provider inputs only', async () => {
  const payload = {
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'local-image' } },
        { type: 'video_url', video_url: 'local-video' },
      ],
    }],
    input: { media: [{ type: 'audio', uri: 'local-audio' }] },
    typedAliases: [
      { type: 'input_image', source: 'local-source-image', uris: ['local-image-a', 'local-image-b'] },
      { type: 'input_video', sources: ['local-video-a', { url: 'local-video-b' }] },
    ],
    metadata: { outputUrl: 'do-not-touch' },
  };
  const result = await normalizeProviderMediaPayload(
    payload,
    async (value, { mediaKind }) => `${mediaKind}:${value}`,
  );

  assert.equal(result.messages[0].content[0].image_url.url, 'image:local-image');
  assert.equal(result.messages[0].content[1].video_url, 'video:local-video');
  assert.equal(result.input.media[0].uri, 'audio:local-audio');
  assert.equal(result.typedAliases[0].source, 'image:local-source-image');
  assert.deepEqual(result.typedAliases[0].uris, ['image:local-image-a', 'image:local-image-b']);
  assert.deepEqual(result.typedAliases[1].sources, [
    'video:local-video-a',
    { url: 'video:local-video-b' },
  ]);
  assert.equal(result.metadata.outputUrl, 'do-not-touch');
});
