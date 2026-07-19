import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';

test('normalizes nested provider media aliases without changing unrelated metadata', async () => {
  const payload = {
    messages: [{
      role: 'user',
      content: [
        { type: 'input_image', source: 'local-image', urls: ['local-image-a', 'local-image-b'] },
        { type: 'input_video', sources: ['local-video', { uri: 'local-video-b' }] },
        { type: 'input_audio', audio_url: { url: 'local-audio' } },
      ],
    }],
    metadata: { outputUrl: 'leave-output-alone' },
  };

  const result = await normalizeProviderMediaPayload(
    payload,
    async (value, { mediaKind }) => `${mediaKind}:${value}`,
  );

  assert.equal(result.messages[0].content[0].source, 'image:local-image');
  assert.deepEqual(result.messages[0].content[0].urls, [
    'image:local-image-a',
    'image:local-image-b',
  ]);
  assert.deepEqual(result.messages[0].content[1].sources, [
    'video:local-video',
    { uri: 'video:local-video-b' },
  ]);
  assert.equal(result.messages[0].content[2].audio_url.url, 'audio:local-audio');
  assert.equal(result.metadata.outputUrl, 'leave-output-alone');
});
