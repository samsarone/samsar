import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProviderMediaPayload } from './ProviderMediaPayload.js';

test('provider media payload resolves nested typed image, video, and audio without mutation', async () => {
  const payload = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Keep http://localhost:3002/plain-text unchanged.' },
          {
            type: 'image_url',
            image_url: {
              url: 'http://localhost:3002/assets_v2/generations/session/image.png',
              detail: 'high',
            },
          },
          {
            type: 'input_video',
            videoUrl: '/assets_v2/video/session/source.mp4',
          },
          {
            type: 'input_image',
            source: '/assets_v2/generations/session/source-alias.png',
          },
          {
            type: 'input_video',
            urls: [
              '/assets_v2/video/session/list-one.mp4',
              { uri: '/assets_v2/video/session/list-two.mp4' },
            ],
          },
          {
            type: 'input_audio',
            source: {
              type: 'url',
              url: '/assets/audio/session/speech.mp3',
            },
          },
          {
            type: 'input_audio',
            input_audio: { data: 'QUJD', format: 'mp3' },
          },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,QUJD',
          },
          {
            type: 'input_image',
            image_url: 'https://images.example.com/public.png',
          },
        ],
      },
    ],
  };
  const originalPayload = JSON.parse(JSON.stringify(payload));
  const calls = [];

  const resolved = await resolveProviderMediaPayload(payload, {
    serviceName: 'nested-provider-test',
    resolveMediaUrl: async (source, options) => {
      calls.push({ source, ...options });
      if (source.startsWith('data:') || source.startsWith('https://images.example.com/')) {
        return source;
      }
      return `https://fresh.example/${options.mediaKind}/${calls.length}`;
    },
  });

  assert.deepEqual(payload, originalPayload);
  assert.deepEqual(calls.map(({ mediaKind }) => mediaKind), [
    'image',
    'video',
    'image',
    'video',
    'video',
    'audio',
    'image',
    'image',
  ]);
  assert.equal(calls.every(({ serviceName }) => serviceName === 'nested-provider-test'), true);
  const content = resolved.messages[0].content;
  assert.equal(content[0].text, payload.messages[0].content[0].text);
  assert.deepEqual(content[1].image_url, {
    url: 'https://fresh.example/image/1',
    detail: 'high',
  });
  assert.equal(content[2].videoUrl, 'https://fresh.example/video/2');
  assert.equal(content[3].source, 'https://fresh.example/image/3');
  assert.deepEqual(content[4].urls, [
    'https://fresh.example/video/4',
    { uri: 'https://fresh.example/video/5' },
  ]);
  assert.deepEqual(content[5].source, {
    type: 'url',
    url: 'https://fresh.example/audio/6',
  });
  assert.deepEqual(content[6], payload.messages[0].content[6]);
  assert.equal(content[7].image_url, 'data:image/png;base64,QUJD');
  assert.equal(content[8].image_url, 'https://images.example.com/public.png');
});

test('provider media payload resolves typed src and href aliases', async () => {
  const payload = [
    { type: 'input_image', src: '/assets_v2/generations/session/src.png' },
    { type: 'input_audio', href: '/assets/audio/session/href.mp3' },
  ];
  const originalPayload = JSON.parse(JSON.stringify(payload));
  const calls = [];

  const resolved = await resolveProviderMediaPayload(payload, {
    resolveMediaUrl: async (source, options) => {
      calls.push({ source, ...options });
      return `https://fresh.example/${options.mediaKind}/${calls.length}`;
    },
  });

  assert.deepEqual(payload, originalPayload);
  assert.deepEqual(calls.map(({ source, mediaKind }) => ({ source, mediaKind })), [
    { source: payload[0].src, mediaKind: 'image' },
    { source: payload[1].href, mediaKind: 'audio' },
  ]);
  assert.equal(resolved[0].src, 'https://fresh.example/image/1');
  assert.equal(resolved[1].href, 'https://fresh.example/audio/2');
});
