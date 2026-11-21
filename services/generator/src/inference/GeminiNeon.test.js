import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import SamsarClient from 'samsar-js';
import { normalizeInferenceModel, isGeminiInferenceModel } from './InferenceModels.js';
import { buildGoogleGeminiDeveloperUrl, resolveGoogleGeminiTransport } from './GoogleGeminiTransport.js';
import { createSamsarExternalChatCompletion, getConfiguredInferenceProviders, getOpenRouterModelForInferenceRequest, resolveConfiguredInferenceProvider } from './SamsarExternalInferenceAdapter.js';
import * as google from './GoogleGemini.js';

const model = 'gemini-4-neon';
const production = { SAMSAR_DEPLOYMENT_EDITION: 'production', GOOGLE_GEMINI_API_KEY: 'neon-test-key' };

function environment(t) {
  const values = {
    ...production, CURRENT_ENV: 'docker', SAMSAR_EDITION: '', SAMSAR_RUNTIME: 'docker',
    GOOGLE_GEMINI_4_CARBON_MODEL: 'gemini-4-carbon', GOOGLE_GEMINI_4_ARGON_MODEL: '',
    GOOGLE_GEMINI_PRO_MODEL: '', GOOGLE_GEMINI_THINKING_LEVEL: 'HIGH',
    GOOGLE_CLOUD_PROJECT: '', GOOGLE_PROJECT_ID: '', GOOGLE_APPLICATION_CREDENTIALS: '',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '', GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: '',
    OPENROUTER_GEMINI_4_CARBON_MODEL: 'google/gemini-4-carbon',
    OPENROUTER_GEMINI_4_NEON_MODEL: '',
  };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('Neon aliases retain distinct inference, native, and OpenRouter model identities', () => {
  for (const value of [model, 'google/gemini-4-neon', 'Gemini 4 Neon', 'Gemini 4 Neon High']) {
    assert.equal(normalizeInferenceModel(value), model, value);
    assert.equal(isGeminiInferenceModel(value), true, value);
    assert.equal(resolveGoogleGeminiTransport(value, production).model, model);
    assert.equal(resolveGoogleGeminiTransport(value, production).kind, 'developer');
    assert.equal(getOpenRouterModelForInferenceRequest({ model: value }, {
      OPENROUTER_GEMINI_4_CARBON_MODEL: 'google/gemini-4-carbon',
    }), 'google/gemini-4-neon');
  }
  assert.equal(normalizeInferenceModel('gemini-4-argon'), 'gemini-4-carbon');
  assert.equal(normalizeInferenceModel('claude-opus-5.5-xhigh'), 'claude-opus-5.5-xhigh');
  assert.equal(normalizeInferenceModel('gpt-6.1-sol'), 'gpt-6.1-sol');
  assert.equal(getOpenRouterModelForInferenceRequest({ model }, {
    OPENROUTER_GEMINI_4_NEON_MODEL: 'google/gemini-4-neon-custom',
  }), 'google/gemini-4-neon-custom');
});

test('Neon hosted key routing preserves standalone and unrelated Gemini transport boundaries', () => {
  for (const edition of ['standalone', 'development']) {
    assert.equal(resolveGoogleGeminiTransport(model, { ...production, SAMSAR_DEPLOYMENT_EDITION: edition }).kind, 'vertex');
  }
  assert.equal(resolveGoogleGeminiTransport(model, { SAMSAR_DEPLOYMENT_EDITION: 'production' }).kind, 'vertex');
  for (const other of ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-4-neon-cyber', 'gemini-4-carbon-cyber']) {
    assert.equal(resolveGoogleGeminiTransport(other, production).kind, 'vertex', other);
  }
  assert.equal(buildGoogleGeminiDeveloperUrl({ model, stream: true }),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-neon:streamGenerateContent?alt=sse');
});

test('Neon native inference keeps its URL, server key, HIGH thinking, output and usage', async t => {
  environment(t);
  assert.equal(resolveConfiguredInferenceProvider(model), 'googleCloud');
  t.mock.method(GoogleAuth.prototype, 'getClient', () => assert.fail('Neon Developer API must bypass OAuth'));
  const usage = { promptTokenCount: 11, candidatesTokenCount: 3, thoughtsTokenCount: 7,
    totalTokenCount: 21, cachedContentTokenCount: 2 };
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-neon:generateContent');
    assert.equal(options.headers['x-goog-api-key'], production.GOOGLE_GEMINI_API_KEY);
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
    assert.deepEqual(body.contents.map(item => item.role), ['user']);

    return new Response(JSON.stringify({ modelVersion: model, responseId: 'neon-test-response',
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
      usageMetadata: usage,
    }));
  };
  t.mock.method(globalThis, 'fetch', fetchImpl);
  const messages = [
    { role: 'system', content: 'Return JSON.' },
    { role: 'user', content: 'Return ok true.' },
    { role: 'assistant', content: 'Drop the trailing model turn.' },
  ];
  const result = await google.createGoogleGeminiChatCompletion(messages, model);
  const completion = result;
  assert.equal(calls, 1);
  assert.equal(completion.choices[0].message.content, '{"ok":true}');
  assert.equal(completion.model, model);
  assert.deepEqual(completion.samsarBilling, { adapter: 'google', region: 'global', api: 'developer' });
  assert.deepEqual(completion.usage.google_usage_metadata || completion.usage, usage);
});


test('Neon stays Neon when forwarded through the Samsar adapter', async t => {
  environment(t);
  const previous = process.env.SAMSAR_API_KEY;
  process.env.SAMSAR_API_KEY = 'neon-forwarding-test-key';
  t.after(() => {
    if (previous === undefined) delete process.env.SAMSAR_API_KEY;
    else process.env.SAMSAR_API_KEY = previous;
  });
  let sent;
  t.mock.method(SamsarClient.prototype, 'createV2ExternalChatCompletion', async payload => {
    sent = payload;
    return { model, choices: [{ message: { role: 'assistant', content: 'ok' } }] };
  });
  await createSamsarExternalChatCompletion({ model, authorization: 'deployed',
    messages: [{ role: 'user', content: 'Return ok.' }],
  });
  assert.equal(sent.model, model);
});


test('Neon GenBlaze routes reject Carbon substitutions for text and vision', t => {
  environment(t);
  const values = { SAMSAR_DEPLOYMENT_EDITION: 'standalone', SAMSAR_GENBLAZE_ENABLED: 'true',
    SAMSAR_GENBLAZE_MODEL_CATALOG_PATH: '/test/neon-model-catalog.json' };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const readFileSync = fs.readFileSync;
  let providerModel;
  t.mock.method(fs, 'readFileSync', (file, ...args) => file === values.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH
    ? JSON.stringify({ models: { [model]: {
      text: { modelId: providerModel, operation: 'chat.completions' },
      vision: { modelId: providerModel, operation: 'chat.completions' },
    } } }) : readFileSync(file, ...args));
  for (const [mapping, available] of [['google/gemini-4-carbon', false], ['google/gemini-4-neon', true]]) {
    providerModel = mapping;
    for (const messages of [
      [{ role: 'user', content: 'Describe the scene.' }],
      [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/scene.png' } }] }],
    ]) {
      assert.equal(getConfiguredInferenceProviders(model, { messages }).includes('gmicloud'), available, mapping);
    }
  }
});
