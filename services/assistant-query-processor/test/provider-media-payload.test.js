import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProviderMediaPayload } from '../src/ProviderMediaPayload.js';

test('typed recursive payload normalization covers image/video/audio and source/list aliases without mutation', async () => {
  const payload = {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Keep https://example.com/plain-text unchanged.' },
        {
          type: 'image_url',
          image_url: { url: '/assets_v2/generations/session/image.png', detail: 'high' },
        },
        { type: 'input_video', source: '/assets_v2/video/session/source.mp4' },
        {
          type: 'video',
          urls: [
            '/assets_v2/video/session/one.mp4',
            { uri: '/assets_v2/video/session/two.mp4' },
          ],
        },
        {
          type: 'input_audio',
          sources: [
            { source: '/assets_v2/video/audio/session/voice.mp3' },
            '/assets_v2/temp_images/music.wav',
          ],
        },
        { type: 'input_audio', input_audio: { data: 'QUJD', format: 'mp3' } },
        { type: 'input_image', image_url: 'data:image/png;base64,QUJD' },
        { type: 'input_image', src: '/assets_v2/generations/session/src.png' },
        { type: 'input_video', href: '/assets_v2/video/session/href.mp4' },
      ],
    }],
    metadata: {
      source: 'http://localhost:3002/not-media-metadata',
      urls: ['http://localhost:3002/not-media-list'],
    },
  };
  const original = JSON.parse(JSON.stringify(payload));
  const calls = [];

  const resolved = await resolveProviderMediaPayload(payload, {
    serviceName: 'assistant-payload-test',
    resolveMediaUrl: async (source, options) => {
      calls.push({ source, ...options });
      if (source.startsWith('data:')) return source;
      return `https://fresh.example/${options.mediaKind}/${calls.length}`;
    },
  });

  assert.deepEqual(payload, original);
  assert.deepEqual(calls.map(({ mediaKind }) => mediaKind), [
    'image', 'video', 'video', 'video', 'audio', 'audio', 'image', 'image', 'video',
  ]);
  assert.equal(calls.every(({ serviceName }) => serviceName === 'assistant-payload-test'), true);
  const content = resolved.messages[0].content;
  assert.deepEqual(content[1].image_url, {
    url: 'https://fresh.example/image/1',
    detail: 'high',
  });
  assert.equal(content[2].source, 'https://fresh.example/video/2');
  assert.deepEqual(content[3].urls, [
    'https://fresh.example/video/3',
    { uri: 'https://fresh.example/video/4' },
  ]);
  assert.deepEqual(content[4].sources, [
    { source: 'https://fresh.example/audio/5' },
    'https://fresh.example/audio/6',
  ]);
  assert.deepEqual(content[5], original.messages[0].content[5]);
  assert.equal(content[6].image_url, 'data:image/png;base64,QUJD');
  assert.equal(content[7].src, 'https://fresh.example/image/8');
  assert.equal(content[8].href, 'https://fresh.example/video/9');
  assert.deepEqual(resolved.metadata, original.metadata);
});
