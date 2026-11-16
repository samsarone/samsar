import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAssistantRequestBilling, normalizeAssistantResponseUsage } from './AssistantBilling.js';

const nativeUsage = {
  input_tokens: 1000, output_tokens: 300,
  cache_read_input_tokens: 200, cache_creation_input_tokens: 100,
  cache_creation: { ephemeral_1h_input_tokens: 50 },
  output_tokens_details: { thinking_tokens: 100 },
};
const routerUsage = {
  prompt_tokens: 1300, completion_tokens: 300,
  input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100,
    cache_write_tokens_details: { ttl_1h_tokens: 50 } },
  completion_tokens_details: { reasoning_tokens: 100 }, cost: 999,
};

for (const effort of ['high', 'xhigh']) {
  for (const [adapter, usage] of [
    ['anthropic', nativeUsage],
    ['anthropic', normalizeAssistantResponseUsage({ anthropic_usage: nativeUsage, prompt_tokens: 1300, completion_tokens: 300 })],
    ['openrouter', routerUsage],
  ]) {
    test(`Fable 5.2/${effort}/${adapter} bills cache reads, both cache writes, and thinking at the new tariff plus 20%`, () => {
      const model = 'claude-fable-5.2' + (effort === 'xhigh' ? '-xhigh' : '');
      const bill = calculateAssistantRequestBilling({ model, usage,
        samsarBilling: { adapter, costUsd: 999 } });
      assert.equal(bill.pricingModel, 'claude-fable-5.2');
      assert.equal(bill.costUsd, 0.02134);
      assert.equal(bill.credits, 2.5608);
      assert.equal(bill.pricingMultiplier, 1.2);
      assert.equal(bill.usage.outputTokens, 300);
    });
  }
}

test('native and OpenRouter Fable 5.2 provider IDs resolve to the same tariff', () => {
  for (const model of ['claude-fable-5-2', 'anthropic/claude-fable-5.2']) {
    assert.equal(calculateAssistantRequestBilling({ model, usage: routerUsage }).credits, 2.5608);
  }
});

test('historical Fable 5.1 receipts retain their original rates', () => {
  for (const model of ['claude-fable-5.1', 'claude-fable-5-1', 'anthropic/claude-fable-5.1-xhigh']) {
    const bill = calculateAssistantRequestBilling({ model, usage: nativeUsage });
    assert.equal(bill.pricingModel, 'claude-fable-5.1');
    assert.equal(bill.costUsd, 0.026675);
    assert.equal(bill.credits, 3.201);
  }
});

test('Opus 5.5 keeps its original price and markup', () => {
  const bill = calculateAssistantRequestBilling({ model: 'claude-opus-5.5', usage: nativeUsage });
  assert.equal(bill.pricingModel, 'claude-opus-5.5');
  assert.equal(bill.costUsd, 0.01069);
  assert.equal(bill.credits, 1.2828);
  assert.equal(bill.pricingMultiplier, 1.2);
});


for (const effort of ['high', 'xhigh']) {
  test(`Fable 5.2/${effort} streamed native usage settles exactly once including thinking and caches`, async () => {
    const { createAnthropicChatCompletion } = await import('./AnthropicChatAdapter.js');
    const text = [];
    const result = await createAnthropicChatCompletion({
      model: 'claude-fable-5.2', effort,
      messages: [{ role: 'user', content: 'hello' }], onText: chunk => text.push(chunk),
    }, {
      env: { ANTHROPIC_API_KEY: 'fixture-only' },
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        assert.equal(request.model, 'claude-fable-5-2');
        assert.equal(request.output_config.effort, effort);
        assert.equal(request.stream, true);
        const events = [
          { type: 'message_start', message: { id: 'fixture', model: 'claude-fable-5-2', usage: { ...nativeUsage, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 300 } },
          { type: 'message_stop' },
        ];
        return new Response(events.map(data => `data: ${JSON.stringify(data)}\n\n`).join(''));
      },
    });
    assert.deepEqual(text, ['done']);
    assert.equal(result.model, 'claude-fable-5.2');
    assert.equal(result.usage.completion_tokens, 300);
    assert.equal(calculateAssistantRequestBilling(result).credits, 2.5608);
  });
}
