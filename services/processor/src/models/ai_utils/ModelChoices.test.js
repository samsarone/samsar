import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import SamsarClient from 'samsar-js';
import { toAnthropicMessages, createAnthropicChatCompletion } from '../../inference/AnthropicChatAdapter.js';
import { createSamsarExternalChatCompletion, createOpenRouterChatCompletion, getOpenRouterModelForInferenceRequest, getConfiguredInferenceProviders } from './SamsarExternalInferenceAdapter.js';
import { normalizeInferenceModel } from '../../consts/InferenceModels.js';

const models = ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.1'];
const messages = [{ role: 'user', content: [{ type: 'text', text: 'Describe this image' }, { type: 'image_url', image_url: { url: 'https://example.com/frame.png' } }] }];
for (const model of models) for (const effort of ['high', 'xhigh']) {
  test(`${model}/${effort} preserves model and effort through normalization and OpenRouter vision`, async (t) => {
    const previous = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-model-options';
    t.after(() => { if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous; });
    let sent;
    t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
      sent = payload; return { id: 'test', model: payload.model, choices: [{ message: { role: 'assistant', content: 'Image' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
    });
    assert.equal(normalizeInferenceModel(model), model);
    const alias = model + (effort === 'xhigh' ? '-xhigh' : '');
    assert.equal(normalizeInferenceModel(alias), alias);
    const expected = (model.startsWith('claude') ? 'anthropic/' : 'openai/') + model;
    assert.equal(getOpenRouterModelForInferenceRequest({ model: alias }), expected);
    for (const request of [{ model, effort }, { model: alias }]) {
      await createOpenRouterChatCompletion({ ...request, messages, temperature: 0.5 });
      assert.equal(sent.model, expected);
      assert.equal(sent.reasoning.effort, effort);
      assert.equal(sent.messages[0].content[1].image_url.url, 'https://example.com/frame.png');
      assert.equal(sent.temperature, undefined);
    }
    if (model.startsWith('claude')) {
      const native = toAnthropicMessages({ model, effort, messages });
      assert.equal(native.model, model.replace(/(\d)\.(\d)/, '$1-$2'));
      assert.equal(native.output_config.effort, effort);
      assert.equal(native.messages[0].content[1].source.url, 'https://example.com/frame.png');
      const response = await createAnthropicChatCompletion({ model: alias, messages }, {
        env: { ANTHROPIC_API_KEY: 'test-only' },
        fetchImpl: async (_url, options) => {
          assert.equal(JSON.parse(options.body).output_config.effort, effort);
          return new Response(JSON.stringify({ id: 'test', model: native.model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } }));
        },
      });
      assert.equal(response.model, model);
    }
  });
}

for (const model of models) {
  test(`${model} keeps its model and effort when forwarded through Samsar`, async (t) => {
    const overrides = {
      SAMSAR_DEPLOYMENT_EDITION: 'standalone', CURRENT_ENV: 'docker',
      SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true', SAMSAR_API_KEY: 'test-forwarding',
      OPENROUTER_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '',
      SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: '/tmp/no-model-choice-preferences.json',
    };
    const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    let sent;
    t.mock.method(SamsarClient.prototype, 'createV2ExternalChatCompletion', async (payload) => {
      sent = payload;
      return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    });
    for (const effort of ['high', 'xhigh']) {
      await createSamsarExternalChatCompletion({ model: model + (effort === 'xhigh' ? '-xhigh' : ''), authorization: 'deployed', messages });
      assert.equal(sent.model, model);
      assert.equal(sent.reasoning_effort, effort);
      assert.equal(sent.messages[0].content[1].image_url.url, 'https://example.com/frame.png');
    }
    process.env.OPENAI_API_KEY = 'test-native';
    process.env.ANTHROPIC_API_KEY = 'test-native';
    process.env.OPENROUTER_API_KEY = 'test-openrouter';
    const providers = getConfiguredInferenceProviders(model);
    assert.equal(providers[0], model.startsWith('claude') ? 'anthropic' : 'openai');
    assert.ok(providers.includes('openrouter'));
    assert.ok(providers.includes('samsar'));
  });
}
