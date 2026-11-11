import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = path.resolve(process.env.SAMSAR_SOURCE_ROOT || fileURLToPath(new URL('..', import.meta.url)));
const services = [
  ['processor', 'src/consts/InferenceModels.js', 'src/models/ai_utils/SamsarExternalInferenceAdapter.js'],
  ['generator', 'src/inference/InferenceModels.js', 'src/inference/SamsarExternalInferenceAdapter.js'],
  ['audio-generator', 'src/inference/InferenceModels.js', 'src/inference/SamsarExternalInferenceAdapter.js'],
  ['assistant-query-processor', 'src/InferenceModels.js', 'src/SamsarExternalInferenceAdapter.js'],
  ['express-video-listener', 'src/ai_utils/GoogleGemini.js', 'src/ai_utils/SamsarExternalInferenceAdapter.js'],
  ['ai-video-layer-generator', 'src/utils/GoogleGemini.js', 'src/utils/SamsarExternalInferenceAdapter.js'],
];
const nativeFiles = {
  processor: 'src/models/ai_utils/OpenAICompat.js',
  generator: 'src/OpenAI.js',
  'audio-generator': 'src/inference/OpenAI.js',
  'assistant-query-processor': 'src/OpenAI.js',
  'express-video-listener': 'src/ai_utils/OpenAICompat.js',
  'ai-video-layer-generator': 'src/utils/OpenAI.js',
};

function servicePath(name, file) {
  return path.join(root, process.env.SAMSAR_SOURCE_ROOT ? `samsar_${name.replaceAll('-', '_')}` : `services/${name}`, file);
}

for (const [name, modelsFile, adapterFile] of services) {
  test(`${name}: defaults stay on Astra while Sol and Claude choices remain distinct`, async () => {
    const models = await import(pathToFileURL(servicePath(name, modelsFile)));
    for (const alias of [undefined, 'gpt-6-astra', 'GPT 6 Astra High', 'gpt-5.6-sol']) {
      assert.equal(models.normalizeInferenceModel(alias), 'gpt-6-astra', String(alias));
    }
    for (const alias of ['gpt-6.1-sol-xhigh', 'GPT 6.1 Sol Extra High', 'gpt-6-astra-xhigh']) {
      const effort = models.getReasoningEffortForInferenceModel || models.getGPT56SolReasoningEffort;
      assert.equal(effort(alias), 'xhigh', alias);
      assert.equal(effort(alias, 'high'), 'high', alias);
    }
    for (const model of ['gpt-6.1-sol', 'claude-fable-5.2', 'gemini-4-carbon', 'QWEN3.8', 'kimi-k3', 'claude-opus-5.5']) {
      assert.equal(models.normalizeInferenceModel(model), model);
    }
  });

  for (const vision of [false, true]) {
    test(`${name}: GenBlaze ${vision ? 'vision' : 'text'} uses the exact Astra mapping`, async (t) => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'samsar-astra-catalog-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const catalogPath = path.join(directory, 'catalog.json');
      writeFileSync(catalogPath, JSON.stringify({ version: 1, provider: 'gmicloud', models: {
        'gpt-6-astra': {
          text: { modelId: 'openai/gpt-6-astra', operation: 'chat.completions' },
          vision: { modelId: 'openai/gpt-6-astra', operation: 'chat.completions' },
        },
      } }));
      const overrides = { CURRENT_ENV: 'docker', MONGO_URL: 'mongodb://127.0.0.1/astra-test', SAMSAR_GENBLAZE_ENABLED: 'true', SAMSAR_GENBLAZE_MODEL_CATALOG_PATH: catalogPath };
      const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
      Object.assign(process.env, overrides);
      t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      });
      const adapterPath = servicePath(name, adapterFile);
      const require = createRequire(adapterPath);
      const { default: OpenAI } = await import(pathToFileURL(require.resolve('openai').replace(/\.js$/, '.mjs')));
      let captured;
      t.mock.method(OpenAI.prototype, 'post', async (_url, options) => {
        captured = options.body;
        return { model: 'gpt-6-astra', choices: [{ message: { content: 'seen' } }] };
      });
      const adapter = await import(pathToFileURL(adapterPath));
      const messages = [{ role: 'user', content: vision
        ? [{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }]
        : 'Plan this.' }];
      await adapter.createGenblazeChatCompletion({ model: 'gpt-6-astra-xhigh', messages, temperature: 0.5, max_tokens: 100, maxRetries: 0 });
      assert.equal(captured.model, 'gpt-6-astra');
      assert.equal(captured.reasoning_effort, 'xhigh');
      assert.equal(captured.temperature, undefined);
      assert.equal(captured.max_completion_tokens, name === 'generator' && vision ? undefined : 100);
      assert.deepEqual(captured.messages, messages);
    });

    test(`${name}: native ${vision ? 'vision' : 'text'} preserves the selected Sol model`, async (t) => {
      const overrides = { CURRENT_ENV: 'production', OPENAI_API_KEY: 'astra-native-test-key', MONGO_URL: 'mongodb://127.0.0.1/astra-test' };
      const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
      Object.assign(process.env, overrides);
      t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      });
      const nativePath = servicePath(name, nativeFiles[name]);
      const require = createRequire(nativePath);
      const { default: OpenAI } = await import(pathToFileURL(require.resolve('openai').replace(/\.js$/, '.mjs')));
      let captured;
      const post = async (url, options) => {
        captured = options.body;
        return url === '/responses'
          ? { model: 'gpt-6.1-sol', output_text: 'seen' }
          : { model: 'gpt-6.1-sol', choices: [{ message: { role: 'assistant', content: 'seen' } }] };
      };
      t.mock.method(OpenAI.prototype, 'post', post);
      const adapter = await import(pathToFileURL(nativePath));
      const content = vision
        ? [{ type: 'text', text: 'Describe this.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }]
        : 'Plan this.';
      const messages = [{ role: 'user', content }];
      const before = structuredClone(messages);
      const request = { model: 'gpt-6.1-sol-xhigh', messages, authorization: 'native', maxRetries: 0 };
      const client = { post, chat: { completions: { create: async (body) => post('/chat/completions', { body }) } } };
      if (name === 'processor' || name === 'express-video-listener') {
        await adapter.createCompatibleChatCompletion(client, request);
      } else if (name === 'generator' || name === 'audio-generator') {
        await adapter.createCompatibleInferenceChatCompletion(request, { openaiClient: client });
      } else if (name === 'assistant-query-processor') {
        await adapter.sendAssistantOpenAICompletionRequest(messages, request.model, undefined, { maxRetries: 0 }, { client });
      } else {
        await adapter.sendAssistantMessageRequest(messages, request.model, { authorization: 'native' });
      }
      assert.equal(captured.model, 'gpt-6.1-sol');
      assert.equal(captured.reasoning?.effort || captured.reasoning_effort, 'xhigh');
      if (vision) assert.ok(JSON.stringify(captured).includes('data:image/png;base64,QUJD'));
      assert.deepEqual(messages, before);
    });

    test(`${name}: OpenRouter ${vision ? 'vision' : 'text'} preserves the selected Sol model and xhigh`, async (t) => {
      const previous = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'astra-migration-test-key';
      t.after(() => {
        if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = previous;
      });
      const adapterPath = servicePath(name, adapterFile);
      const require = createRequire(adapterPath);
      const { default: OpenAI } = await import(pathToFileURL(require.resolve('openai').replace(/\.js$/, '.mjs')));
      let captured;
      t.mock.method(OpenAI.prototype, 'post', async (url, options) => {
        assert.equal(url, '/chat/completions');
        captured = options.body;
        return { model: 'openai/gpt-6.1-sol', choices: [{ message: { content: 'seen' } }] };
      });
      const adapter = await import(pathToFileURL(adapterPath));
      assert.equal(adapter.getOpenRouterModelForInferenceRequest({ model: 'gpt-6-astra' }, {
        OPENROUTER_GPT_56_SOL_MODEL: 'openai/gpt-6.1-sol',
      }), 'openai/gpt-6-astra');
      const content = vision
        ? [{ type: 'text', text: 'Describe this.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }]
        : 'Plan this.';
      const messages = [{ role: 'user', content }];
      const before = structuredClone(messages);
      await adapter.createOpenRouterChatCompletion({
        model: 'gpt-6.1-sol-xhigh', messages, maxRetries: 0, externalMaxRetries: 0,
      });
      assert.equal(captured.model, 'openai/gpt-6.1-sol');
      assert.equal(captured.reasoning.effort, 'xhigh');
      assert.deepEqual(captured.messages, messages);
      assert.deepEqual(messages, before);
    });
  }
}

for (const [name, file] of [
  ['processor', 'src/models/api/AssistantBilling.js'],
  ['assistant-query-processor', 'src/AssistantBilling.js'],
]) {
  test(`${name}: Astra uses its own cached-token tariff and the existing billing policy`, async () => {
    const { calculateAssistantCreditsFromUsage } = await import(pathToFileURL(servicePath(name, file)));
    for (const model of ['gpt-6-astra', 'openai/gpt-6-astra']) {
      const result = calculateAssistantCreditsFromUsage({
        model, usage: { input_tokens: 100_000, input_tokens_details: { cached_tokens: 20_000 }, output_tokens: 10_000 },
      });
      assert.equal(result.pricingModel, 'gpt-6-astra');
      assert.equal(result.costUsd, 1.32);
      assert.equal(result.credits, 158.4);
      assert.equal(result.pricingMultiplier, 1.2);
    }
  });
}
