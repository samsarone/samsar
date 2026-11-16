import assert from 'node:assert/strict';
import test from 'node:test';
import { translateTextContent } from './OpenAI.js';
import { createCompatibleChatCompletion } from './ai_utils/OpenAICompat.js';
import { toAnthropicMessages } from '../inference/AnthropicChatAdapter.js';

for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.2']) {
  for (const reasoningEffort of ['high', 'xhigh']) {
    test(`translation forwards ${model} and ${reasoningEffort} to its adapter`, async () => {
      let request;
      const result = await translateTextContent(['Hello.', 'Welcome.'], 'French', model, {
        reasoningEffort,
        createChatCompletion: async (_client, payload) => {
          request = payload;
          return { choices: [{ message: { content: 'Bonjour.\nBienvenue.' } }] };
        },
      });
      assert.equal(request.model, model);
      assert.equal(request.reasoning_effort, reasoningEffort);
      assert.match(request.messages[0].content, /French/);
      assert.match(request.messages[1].content, /Hello\.\nWelcome\./);
      assert.deepEqual(result, ['Bonjour.', 'Bienvenue.']);
    });
  }
}

for (const model of ['gemini-4-carbon', 'kimi-k3', 'QWEN3.8']) {
  test(`translation forwards ${model} without unsupported generic reasoning effort`, async () => {
    let request;
    await translateTextContent(['Hello.'], 'French', model, {
      reasoningEffort: 'xhigh',
      createChatCompletion: async (_client, payload) => {
        request = payload;
        return { choices: [{ message: { content: 'Bonjour.' } }] };
      },
    });
    assert.equal(request.model, model);
    assert.equal(request.reasoning_effort, undefined);
  });
}

for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.2']) {
  test(`translation carries xhigh through the ${model} native adapter payload`, async (t) => {
    const previousEdition = process.env.SAMSAR_DEPLOYMENT_EDITION;
    process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
    t.after(() => {
      if (previousEdition === undefined) delete process.env.SAMSAR_DEPLOYMENT_EDITION;
      else process.env.SAMSAR_DEPLOYMENT_EDITION = previousEdition;
    });
    let providerRequest;
    const result = await translateTextContent(['Hello.'], 'French', `${model}-xhigh`, {
      reasoningEffort: 'xhigh',
      createChatCompletion: (_client, request) => createCompatibleChatCompletion({
        post: async (endpoint, { body }) => {
          assert.equal(endpoint, '/responses');
          providerRequest = body;
          return { output_text: 'Bonjour.' };
        },
      }, { ...request, bypassSamsarExternalInference: true }, {
        createAnthropicChatCompletion: async (payload) => {
          providerRequest = toAnthropicMessages(payload);
          return { choices: [{ message: { content: 'Bonjour.' } }] };
        },
      }),
    });
    if (model.startsWith('claude')) {
      assert.equal(providerRequest.model, model.replace(/(\d)\.(\d)/, '$1-$2'));
      assert.equal(providerRequest.output_config.effort, 'xhigh');
    } else {
      assert.equal(providerRequest.model, model);
      assert.equal(providerRequest.reasoning.effort, 'xhigh');
    }
    assert.deepEqual(result, ['Bonjour.']);
  });
}
