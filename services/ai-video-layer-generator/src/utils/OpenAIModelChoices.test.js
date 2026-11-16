import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import { sendAssistantMessageRequest, sendAssistantStructuredMessageRequest } from './OpenAI.js';
import { sendAssistantMessageRequest as sendAlternatePromptRequest } from './AIUtils.js';

for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.2']) {
  for (const effort of ['high', 'xhigh']) {
    for (const stage of ['vision', 'structured', 'alternate']) {
      test(`${stage} preserves native ${model}/${effort}`, async (t) => {
        const overrides = {
          CURRENT_ENV: 'docker', SAMSAR_DEPLOYMENT_EDITION: 'standalone',
          OPENAI_API_KEY: 'test-openai', ANTHROPIC_API_KEY: 'test-anthropic',
          OPENROUTER_API_KEY: '', SAMSAR_API_KEY: '',
          SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: '/tmp/no-model-choice-preferences.json',
        };
        const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
        Object.assign(process.env, overrides);
        t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
        let sent;
        const content = '{"useEndFrame":true}';
        t.mock.method(OpenAI.prototype, 'post', async (_path, options) => {
          sent = options.body;
          return { model, output_text: content };
        });
        t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (body) => {
          sent = body;
          return { model, choices: [{ message: { content } }] };
        });
        t.mock.method(globalThis, 'fetch', async (_url, options) => {
          sent = JSON.parse(options.body);
          return new Response(JSON.stringify({ model: sent.model, content: [{ type: 'text', text: content }], usage: { input_tokens: 20, output_tokens: 10 } }));
        });
        const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/frame.png' } }] }];
        const alias = model + (effort === 'xhigh' ? '-xhigh' : '');
        const context = { inferenceEffort: effort, selectedInferenceModelAuthorization: 'native' };
        if (stage === 'structured') {
          assert.deepEqual(await sendAssistantStructuredMessageRequest(messages, model, context), { useEndFrame: true });
        } else {
          const result = stage === 'alternate'
            ? await sendAlternatePromptRequest(messages, alias, 'native')
            : await sendAssistantMessageRequest(messages, model, context);
          assert.equal(result.content, content);
        }
        assert.equal(sent.model, model.startsWith('claude') ? model.replace(/(\d)\.(\d)/, '$1-$2') : model);
        assert.equal(sent.output_config?.effort || sent.reasoning?.effort || sent.reasoning_effort, effort);
        const part = (sent.input || sent.messages)[0].content[0];
        assert.equal(part.source?.url || part.image_url?.url || part.image_url, 'https://example.com/frame.png');
      });
    }
  }
}

for (const stage of ['vision', 'structured', 'alternate']) {
  test(`${stage} sends mounted Docker images to native Claude without a public URL`, async (t) => {
    const assetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samsar-native-claude-'));
    t.after(() => fs.rm(assetsRoot, { recursive: true, force: true }));
    const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
    await fs.mkdir(path.join(assetsRoot, 'generations', 'session'), { recursive: true });
    await fs.writeFile(path.join(assetsRoot, 'generations', 'session', 'frame.png'), imageBytes);
    const overrides = {
      CURRENT_ENV: 'docker', SAMSAR_RUNTIME: 'docker', SAMSAR_DEPLOYMENT_EDITION: 'standalone',
      SAMSAR_MEDIA_DELIVERY_MODE: 'docker-local', SAMSAR_ASSETS_V2_ROOT: assetsRoot,
      ANTHROPIC_API_KEY: 'test-anthropic', ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      OPENROUTER_API_KEY: '', SAMSAR_API_KEY: '',
      SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: path.join(assetsRoot, 'no-preferences.json'),
    };
    const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const requests = [];
    let sent;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push(url);
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({
        model: sent.model, content: [{ type: 'text', text: '{"useEndFrame":true}' }],
        usage: { input_tokens: 20, output_tokens: 10 },
      }));
    });
    const messages = [{ role: 'user', content: [{
      type: 'image_url', image_url: { url: '/assets_v2/generations/session/frame.png' },
    }] }];
    const model = 'claude-fable-5.2';
    const context = { selectedInferenceModelAuthorization: 'native' };
    if (stage === 'structured') {
      assert.deepEqual(await sendAssistantStructuredMessageRequest(messages, model, context), { useEndFrame: true });
    } else {
      const result = stage === 'alternate'
        ? await sendAlternatePromptRequest(messages, model, 'native')
        : await sendAssistantMessageRequest(messages, model, context);
      assert.equal(result.content, '{"useEndFrame":true}');
    }
    assert.deepEqual(sent.messages[0].content[0].source, {
      type: 'base64', media_type: 'image/png', data: imageBytes.toString('base64'),
    });
    assert.deepEqual(requests, ['https://api.anthropic.com/v1/messages']);
  });
}
