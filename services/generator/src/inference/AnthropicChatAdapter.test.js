import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAnthropicChatCompletion,
  toAnthropicMessages,
} from './AnthropicChatAdapter.js';

test('native Claude translates vision, tools, structured output, and usage to the chat contract', async () => {
  const request = {
    model: 'claude-opus-5.5',
    messages: [
      { role: 'developer', content: 'Describe the frame.' },
      { role: 'user', content: [
        { type: 'text', text: 'What is visible?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } },
      ] },
    ],
    tools: [{ type: 'function', function: {
      name: 'report_scene', description: 'Report a scene',
      parameters: { type: 'object', properties: { subject: { type: 'string' } } },
    } }],
    response_format: { type: 'json_schema', json_schema: {
      name: 'scene', schema: { type: 'object', properties: { subject: { type: 'string' } } },
    } },
  };
  let sent;
  const completion = await createAnthropicChatCompletion(request, {
    env: { ANTHROPIC_API_KEY: 'test-key' },
    fetchImpl: async (url, options) => {
      sent = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        id: 'msg_test', content: [
          { type: 'thinking', thinking: '', signature: 'signed-test-block' },
          { type: 'text', text: '{"subject":"tree"}' },
          { type: 'tool_use', id: 'tool_test', name: 'report_scene', input: { subject: 'tree' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 20,
          cache_creation_input_tokens: 5, cache_read_input_tokens: 10 },
      }), { status: 200 });
    },
  });

  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.max_tokens, 128000);
  assert.equal(sent.body.output_config.effort, 'high');
  assert.deepEqual(sent.body.messages[0].content[1], {
    type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' },
  });
  assert.equal(sent.body.tools[0].name, 'report_scene');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.equal(completion.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(completion.choices[0].message.tool_calls[0].function, {
    name: 'report_scene', arguments: '{"subject":"tree"}',
  });
  assert.equal(completion.usage.prompt_tokens_details.cached_tokens, 10);
  assert.equal(completion.usage.prompt_tokens, 115);
  assert.equal(completion.usage.total_tokens, 135);
  const continuation = toAnthropicMessages({ messages: [
    completion.choices[0].message,
    { role: 'tool', tool_call_id: 'tool_test', content: 'accepted' },
  ] });
  assert.deepEqual(continuation.messages[0].content, completion.choices[0].message.anthropic_content);
  assert.equal(continuation.messages[1].content[0].tool_use_id, 'tool_test');
});

test('native Claude keeps signed image URLs and caps unsupported effort values at high', () => {
  const body = toAnthropicMessages({
    model: 'anthropic/claude-opus-5.5', reasoning: { effort: 'xhigh' },
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'https://example.com/frame.png' } },
    ] }],
  });
  assert.deepEqual(body.messages[0].content[0], {
    type: 'image', source: { type: 'url', url: 'https://example.com/frame.png' },
  });
  assert.equal(body.output_config.effort, 'high');
});
