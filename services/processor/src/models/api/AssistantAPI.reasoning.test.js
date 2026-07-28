import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResponsesRequest,
  getCompatibleAssistantResponseFormat,
  getAssistantCompletionTimeoutMs,
  resolveAssistantProviderMediaInput,
  shouldUseCompatibleAssistantRouting,
} from './AssistantAPI.js';

test('forces high reasoning for GPT 5.6 Sol assistant requests', () => {
  const request = buildResponsesRequest({
    model: 'gpt-5.6-sol',
    inputMessages: [{ role: 'user', content: 'hello' }],
    payload: { reasoning: { effort: 'low' } },
  });

  assert.deepEqual(request.reasoning, { effort: 'high' });
});

test('translates Responses structured output into strict chat JSON schema for Kimi-compatible adapters', () => {
  const schema = {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
    additionalProperties: false,
  };
  const request = buildResponsesRequest({
    model: 'kimi-k3',
    inputMessages: [{ role: 'user', content: 'Return JSON' }],
    payload: {
      text: {
        format: {
          type: 'json_schema',
          name: 'assistant_result',
          strict: false,
          schema,
        },
      },
    },
  });

  assert.deepEqual(getCompatibleAssistantResponseFormat(request), {
    type: 'json_schema',
    json_schema: {
      name: 'assistant_result',
      schema,
      strict: true,
    },
  });
});

test('assistant completions default to a ten-minute timeout', () => {
  assert.equal(getAssistantCompletionTimeoutMs({}), 10 * 60 * 1000);
  assert.equal(getAssistantCompletionTimeoutMs({ timeout: 4321 }), 4321);
});

test('standalone assistant requests use preference-aware routing without changing production OpenAI routing', () => {
  assert.equal(
    shouldUseCompatibleAssistantRouting(
      'gpt-5.6-sol',
      '',
      { SAMSAR_DEPLOYMENT_EDITION: 'standalone' },
    ),
    true,
  );
  assert.equal(
    shouldUseCompatibleAssistantRouting(
      'gpt-5.6-sol',
      '',
      { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    ),
    false,
  );
  assert.equal(
    shouldUseCompatibleAssistantRouting(
      'gemini-3.1-pro',
      '',
      { SAMSAR_DEPLOYMENT_EDITION: 'production' },
    ),
    true,
  );
});

test('assistant provider dispatch resolves every URL-backed media item without mutating session input', async () => {
  const input = [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Keep https://example.com in ordinary text.' },
        {
          type: 'input_image',
          image_url: 'http://localhost:3002/assets_v2/generations/session/image.png',
        },
        {
          type: 'video_url',
          video_url: {
            url: '/assets_v2/video/session/video.mp4',
            detail: 'high',
          },
        },
        {
          type: 'input_audio',
          audio_url: '/assets/audio/session/speech.mp3',
        },
        {
          type: 'input_audio',
          input_audio: { data: 'QUJD', format: 'mp3' },
        },
      ],
    },
    {
      type: 'input_image',
      image_url: {
        url: '/assets_v2/generations/session/top-level.png',
        detail: 'low',
      },
    },
  ];
  const originalInput = JSON.parse(JSON.stringify(input));
  const calls = [];

  const resolved = await resolveAssistantProviderMediaInput(input, {
    serviceName: 'assistant-provider-test',
    resolveMediaUrl: async (source, options) => {
      calls.push({ source, ...options });
      return `https://fresh.example/${options.mediaKind}/${calls.length}`;
    },
  });

  assert.deepEqual(input, originalInput);
  assert.deepEqual(calls.map(({ mediaKind }) => mediaKind), [
    'image',
    'video',
    'audio',
    'image',
  ]);
  assert.equal(calls.every(({ serviceName }) => serviceName === 'assistant-provider-test'), true);
  assert.equal(resolved[0].content[1].image_url, 'https://fresh.example/image/1');
  assert.deepEqual(resolved[0].content[2].video_url, {
    url: 'https://fresh.example/video/2',
    detail: 'high',
  });
  assert.equal(resolved[0].content[3].audio_url, 'https://fresh.example/audio/3');
  assert.deepEqual(resolved[0].content[4], input[0].content[4]);
  assert.deepEqual(resolved[1].image_url, {
    url: 'https://fresh.example/image/4',
    detail: 'low',
  });
});
