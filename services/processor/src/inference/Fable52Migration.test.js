import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeReasoningModel, getClaudeProviderModel, getClaudeOpenRouterModel,
} from './ReasoningModels.js';
import { toAnthropicMessages, createAnthropicChatCompletion } from './AnthropicChatAdapter.js';
import { normalizeInferenceModel } from '../consts/InferenceModels.js';

for (const effort of ['high', 'xhigh']) {
  const suffix = effort === 'xhigh' ? '-xhigh' : '';
  for (const model of ['claude-fable-5.2', 'claude-fable-5-2', 'anthropic/claude-fable-5.2', 'claude-fable-5.1', 'claude-fable-5-1']) {
    test(`${model}/${effort} normalizes to Fable 5.2 without changing effort`, () => {
      assert.equal(normalizeReasoningModel(model + suffix), 'claude-fable-5.2' + suffix);
      assert.equal(normalizeInferenceModel(model + suffix), 'claude-fable-5.2' + suffix);
      assert.equal(getClaudeProviderModel(model + suffix), 'claude-fable-5-2');
      assert.equal(getClaudeOpenRouterModel(model + suffix, {}), 'anthropic/claude-fable-5.2');
    });
  }
  for (const vision of [false, true]) {
    test(`Fable 5.2 native ${vision ? 'vision' : 'text'}/${effort} preserves the completion contract`, async () => {
      const content = vision ? [
        { type: 'text', text: 'Describe this frame' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      ] : 'Write a scene';
      const request = { model: 'claude-fable-5.1' + suffix, messages: [{ role: 'user', content }],
        temperature: 0.7, top_p: 0.5, top_k: 2 };
      const original = structuredClone(request);
      const response = await createAnthropicChatCompletion(request, {
        env: { ANTHROPIC_API_KEY: 'fixture-only' },
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          assert.equal(body.model, 'claude-fable-5-2');
          assert.equal(body.output_config.effort, effort);
          for (const key of ['temperature', 'top_p', 'top_k']) assert.equal(body[key], undefined);
          if (vision) assert.deepEqual(body.messages[0].content[1], {
            type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
          });
          return new Response(JSON.stringify({ id: 'fixture', model: body.model,
            content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'end_turn' }));
        },
      });
      assert.equal(response.model, 'claude-fable-5.2');
      assert.equal(response.choices[0].message.content, 'done');
      assert.deepEqual(request, original);
    });
  }
  test(`Opus 5.5 retains its existing native and OpenRouter IDs at ${effort}`, () => {
    const request = { model: 'claude-opus-5.5' + suffix, messages: [{ role: 'user', content: 'hello' }] };
    assert.equal(getClaudeProviderModel(request.model), 'claude-opus-5-5');
    assert.equal(getClaudeOpenRouterModel(request.model, {}), 'anthropic/claude-opus-5.5');
    assert.equal(getClaudeOpenRouterModel(request.model, { OPENROUTER_CLAUDE_OPUS_55_MODEL: 'custom-opus' }), 'custom-opus');
    assert.equal(toAnthropicMessages(request).output_config.effort, effort);
  });
}

test('legacy Fable provider settings upgrade while custom mappings and new configuration take precedence', () => {
  assert.equal(getClaudeOpenRouterModel('claude-fable-5.1', {
    OPENROUTER_CLAUDE_FABLE_51_MODEL: 'anthropic/claude-fable-5.1',
  }), 'anthropic/claude-fable-5.2');
  assert.equal(getClaudeOpenRouterModel('claude-fable-5.2', {
    OPENROUTER_CLAUDE_FABLE_51_MODEL: 'custom-fable',
  }), 'custom-fable');
  assert.equal(getClaudeOpenRouterModel('claude-fable-5.2', {
    OPENROUTER_CLAUDE_FABLE_51_MODEL: 'custom-old-fable', OPENROUTER_CLAUDE_FABLE_52_MODEL: 'custom-new-fable',
  }), 'custom-new-fable');
});

test('Fable 5.2 preserves signed thinking and tool blocks without mutating conversation history', () => {
  const blocks = [{ type: 'thinking', thinking: 'fixture', signature: 'fixture-signature' },
    { type: 'tool_use', id: 'call', name: 'lookup', input: {} }];
  const request = { model: 'claude-fable-5.2', messages: [
    { role: 'user', content: 'hello' }, { role: 'assistant', anthropic_content: blocks },
    { role: 'tool', tool_call_id: 'call', content: 'result' },
  ] };
  const original = structuredClone(request);
  assert.deepEqual(toAnthropicMessages(request).messages[1].content, blocks);
  assert.deepEqual(request, original);
});
