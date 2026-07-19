import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';

test('normalizes top-level aliases, lists, and nested provider media shapes', async () => {
  const calls = [];
  const normalize = async (value, options) => {
    calls.push([value, options.mediaKind]);
    return `public:${value}`;
  };
  const payload = {
    image: 'image-a',
    startImageUrl: 'image-b',
    video: 'video-a',
    audioLink: 'audio-a',
    image_urls: ['image-c', 'image-d'],
    promptImage: [{ uri: 'image-e', position: 'first' }],
    input: {
      media: [
        { type: 'first_frame', url: 'image-f' },
        { type: 'video', uri: 'video-b' },
        { type: 'audio', url: 'audio-b' },
      ],
    },
    messages: [{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'image-g' } }],
    }],
    typedAliases: [
      { type: 'input_image', source: 'image-h', urls: ['image-i', 'image-j'] },
      { type: 'input_video', sources: ['video-c', { url: 'video-d' }] },
    ],
  };

  const result = await normalizeProviderMediaPayload(payload, normalize);

  assert.equal(result.image, 'public:image-a');
  assert.equal(result.startImageUrl, 'public:image-b');
  assert.equal(result.video, 'public:video-a');
  assert.equal(result.audioLink, 'public:audio-a');
  assert.deepEqual(result.image_urls, ['public:image-c', 'public:image-d']);
  assert.equal(result.promptImage[0].uri, 'public:image-e');
  assert.equal(result.input.media[0].url, 'public:image-f');
  assert.equal(result.input.media[1].uri, 'public:video-b');
  assert.equal(result.input.media[2].url, 'public:audio-b');
  assert.equal(result.messages[0].content[0].image_url.url, 'public:image-g');
  assert.equal(result.typedAliases[0].source, 'public:image-h');
  assert.deepEqual(result.typedAliases[0].urls, ['public:image-i', 'public:image-j']);
  assert.deepEqual(result.typedAliases[1].sources, ['public:video-c', { url: 'public:video-d' }]);
  assert.deepEqual(calls.map(([, kind]) => kind), [
    'image', 'image', 'video', 'audio', 'image', 'image', 'image', 'image', 'video', 'audio', 'image',
    'image', 'image', 'image', 'video', 'video',
  ]);
});

test('does not normalize unselected fallback candidates or unrelated output metadata', async () => {
  const calls = [];
  const payload = {
    fallbackStartImages: ['candidate-a', 'candidate-b'],
    initialStartImageSources: ['candidate-c'],
    metadata: { outputUrl: 'completed-output' },
    prompt: 'describe https://example.com/image.png',
  };

  const result = await normalizeProviderMediaPayload(payload, async (value) => {
    calls.push(value);
    return `public:${value}`;
  });

  assert.deepEqual(result, payload);
  assert.deepEqual(calls, []);
});
