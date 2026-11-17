import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAssistantReasoningEffort,
  sendAssistantOpenAICompletionRequest,
} from './OpenAI.js';

test('standalone native OpenAI assistant preserves canonical GPT 6.2 Astra XHigh effort', async () => {
  let capturedBody;
  const client = {
    async post(path, options) {
      assert.equal(path, '/responses');
      capturedBody = options.body;
      return { model: 'gpt-6.2-astra', output_text: 'ok' };
    },
  };

  const effort = getAssistantReasoningEffort('gpt-6.2-astra', {
    reasoning_effort: 'xhigh',
  });
  const response = await sendAssistantOpenAICompletionRequest(
    [{ role: 'user', content: 'analyze deeply' }],
    'gpt-6.2-astra',
    effort,
    { maxRetries: 0 },
    { client },
  );

  assert.equal(effort, 'xhigh');
  assert.equal(capturedBody.model, 'gpt-6.2-astra');
  assert.deepEqual(capturedBody.reasoning, { effort: 'xhigh' });
  assert.equal(response.outputText, 'ok');
});

test('legacy GPT 6.2 Astra model suffixes infer effort unless explicitly overridden', () => {
  assert.equal(getAssistantReasoningEffort('gpt-6.2-astra-high'), 'high');
  assert.equal(getAssistantReasoningEffort('gpt-6.2-astra-xhigh'), 'xhigh');
  assert.equal(
    getAssistantReasoningEffort('gpt-6.2-astra-xhigh', { effort: 'high' }),
    'high',
  );
});

for (const model of ['gpt-6.2-astra', 'gpt-6-astra', 'gpt-5.6-sol']) {
  for (const effort of ['high', 'xhigh']) {
    for (const vision of [false, true]) {
      test(`${model} upgrades native assistant ${vision ? 'vision' : 'text'} to Astra 6.2 at ${effort}`, async () => {
        let captured;
        const messages = [{ role: 'user', content: vision
          ? [{ type: 'text', text: 'Describe this.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }]
          : 'Plan this.' }];
        const before = structuredClone(messages);
        await sendAssistantOpenAICompletionRequest(messages, `${model}${effort === 'xhigh' ? '-xhigh' : ''}`, undefined,
          { maxRetries: 0 }, { client: { post: async (_url, options) => {
            captured = options.body;
            return { model: 'gpt-6.2-astra', output_text: 'ok' };
          } } });
        assert.equal(captured.model, 'gpt-6.2-astra');
        assert.deepEqual(captured.reasoning, { effort });
        if (vision) assert.ok(JSON.stringify(captured.input).includes('data:image/png;base64,QUJD'));
        assert.deepEqual(messages, before);
      });
    }
  }
}

for (const effort of ['high', 'xhigh']) {
  test(`Astra 6.2 chat fallback preserves ${effort} reasoning and vision`, async () => {
    let captured;
    const client = {
      post: async () => { throw Object.assign(new Error('Responses unavailable'), { status: 404 }); },
      chat: { completions: { create: async (body) => {
        captured = body;
        return { model: 'gpt-6.2-astra', choices: [{ message: { content: 'ok' } }] };
      } } },
    };
    await sendAssistantOpenAICompletionRequest(
      [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }] }],
      'gpt-6-astra', effort, { maxRetries: 0 }, { client, shouldFallbackToChatCompletions: () => true },
    );
    assert.equal(captured.model, 'gpt-6.2-astra');
    assert.equal(captured.reasoning_effort, effort);
    assert.equal(captured.messages[0].content[0].image_url.url, 'data:image/png;base64,QUJD');
  });
}
