import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAssistantCreditsFromUsage, calculateAssistantRequestBilling } from './AssistantBilling.js';
for (const effort of ['high', 'xhigh']) for (const [model, input, output, cached, write, hour] of [
  ['claude-fable-5.1', 10, 50, 0.25, 12.5, 20],
  ['claude-opus-5.5', 4, 20, 0.2, 5, 8],
  ['gpt-6.1-sol', 2, 10, 0.1, 2.5, 4],
]) {
  test(`${model}/${effort} uses its own tariff and one 20% markup`, () => {
    const key = model + (effort === 'xhigh' ? '-xhigh' : '');
    const usage = { prompt_tokens: 100000, completion_tokens: 100000 };
    const bill = calculateAssistantRequestBilling({ model: key, usage });
    assert.equal(bill.credits, (input + output) * 12);
    assert.equal(bill.pricingMultiplier, 1.2);
    assert.equal(calculateAssistantCreditsFromUsage({ model: key, usage: { prompt_tokens: 100000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 100000 } } }).credits, Number((cached * 12).toFixed(4)));
    if (model.startsWith('claude')) {
      const cacheBill = calculateAssistantCreditsFromUsage({ model: key, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100000, cache_creation_input_tokens: 200000, cache_creation: { ephemeral_1h_input_tokens: 100000 } } });
      assert.equal(cacheBill.credits, Number(((cached + write + hour) * 12).toFixed(4)));
    }
  });
}
