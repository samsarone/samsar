import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';

test('normalizes typed nested media aliases without rewriting unrelated URLs', async () => {
  const calls = [];
  const payload = {
    callback_url: 'http://localhost:9999/callback',
    messages: [{
      role: 'user',
      content: [
        { type: 'input_image', source: '/assets_v2/frame.png' },
        { imageUrl: '/assets_v2/camel.png' },
        { type: 'video_url', video_url: { uris: ['/assets_v2/a.mp4', '/assets_v2/b.mp4'] } },
        { type: 'input_audio', sources: [{ url: '/assets_v2/music.mp3' }] },
      ],
    }],
  };

  const normalized = await normalizeProviderMediaPayload(payload, async (value, options) => {
    calls.push([value, options.mediaKind]);
    return `https://media.example/${options.mediaKind}/${value.split('/').pop()}`;
  });

  assert.equal(normalized.callback_url, payload.callback_url);
  assert.equal(
    normalized.messages[0].content[0].source,
    'https://media.example/image/frame.png',
  );
  assert.equal(
    normalized.messages[0].content[1].imageUrl,
    'https://media.example/image/camel.png',
  );
  assert.deepEqual(
    normalized.messages[0].content[2].video_url.uris,
    ['https://media.example/video/a.mp4', 'https://media.example/video/b.mp4'],
  );
  assert.equal(
    normalized.messages[0].content[3].sources[0].url,
    'https://media.example/audio/music.mp3',
  );
  assert.deepEqual(calls, [
    ['/assets_v2/frame.png', 'image'],
    ['/assets_v2/camel.png', 'image'],
    ['/assets_v2/a.mp4', 'video'],
    ['/assets_v2/b.mp4', 'video'],
    ['/assets_v2/music.mp3', 'audio'],
  ]);
  assert.notEqual(normalized, payload);
});

test('normalizes string arrays inherited from typed image keys', async () => {
  const normalized = await normalizeProviderMediaPayload({
    images: ['/assets_v2/one.png', '/assets_v2/two.png'],
  }, async (value, { mediaKind }) => `${mediaKind}:${value}`);

  assert.deepEqual(normalized.images, [
    'image:/assets_v2/one.png',
    'image:/assets_v2/two.png',
  ]);
});
