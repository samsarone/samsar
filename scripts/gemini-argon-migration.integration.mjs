import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

// Run with installed service dependencies: npm run test:argon-migration.
// The dependency-light root CI suite runs separately from service integrations.
const root = path.resolve(process.env.SAMSAR_SOURCE_ROOT || fileURLToPath(new URL('..', import.meta.url)));
const services = [
  ['processor', 'src/consts/InferenceModels.js', 'src/inference/GoogleGemini.js'],
  ['generator', 'src/inference/InferenceModels.js', 'src/inference/GoogleGemini.js'],
  ['audio-generator', 'src/inference/InferenceModels.js', 'src/inference/GoogleGemini.js'],
  ['assistant-query-processor', 'src/InferenceModels.js', 'src/GoogleGemini.js'],
  ['express-video-listener', 'src/ai_utils/GoogleGemini.js', 'src/ai_utils/GoogleGemini.js'],
  ['ai-video-layer-generator', 'src/utils/GoogleGemini.js', 'src/utils/GoogleGemini.js'],
];
const aliases = ['gemini-4-carbon', 'Gemini 4 Carbon', 'google/gemini-4-carbon',
  'gemini-4', 'GEMINI4', 'Gemini 4', 'GEMINI4CARBON', 'Google Gemini 4 Carbon',
  'gemini-4-argon', 'Gemini 4 Argon', 'google/gemini-4-argon', 'GEMINI4ARGON'];

function servicePath(name, file) {
  return path.join(root, process.env.SAMSAR_SOURCE_ROOT ? `samsar_${name.replaceAll('-', '_')}` : `services/${name}`, file);
}

for (const [name, modelsFile, adapterFile] of services) {
  test(`${name}: Gemini 4 aliases resolve to Carbon`, async () => {
    const models = await import(pathToFileURL(servicePath(name, modelsFile)));
    for (const alias of aliases) {
      assert.equal(models.normalizeInferenceModel(alias), 'gemini-4-carbon', alias);
      const resolveModel = models.getProviderModelForInferenceModel || models.resolveGeminiModel;
      if (resolveModel) assert.equal(resolveModel(alias), 'gemini-4-carbon', alias);
    }
    assert.equal(models.normalizeInferenceModel('gpt-6-astra'), 'gpt-6-astra');
    assert.equal(models.normalizeInferenceModel('QWEN3.8'), 'QWEN3.8');
    assert.equal(models.normalizeInferenceModel('kimi-k3'), 'kimi-k3');
    assert.equal(models.normalizeInferenceModel('claude-opus-5.5'), 'claude-opus-5.5');
    assert.notEqual(models.normalizeInferenceModel('gemini-3.1-pro'), 'gemini-4-carbon');
  });

  for (const thinking of [undefined, 'MINIMAL']) {
  test(`${name}: native REST preserves text/vision contracts with ${thinking || 'default HIGH'} thinking`, async (t) => {
    const adapterPath = servicePath(name, adapterFile);
    const require = createRequire(adapterPath);
    const { GoogleAuth } = require('google-auth-library');
    t.mock.method(GoogleAuth.prototype, 'getClient', async () => ({
      getAccessToken: async () => ({ token: 'test-token' }),
    }));
    const envKeys = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_GEMINI_LOCATION', 'GOOGLE_VERTEX_AI_LOCATION',
      'GOOGLE_GEMINI_THINKING_LEVEL', 'GOOGLE_GEMINI_4_CARBON_MODEL', 'GOOGLE_GEMINI_4_ARGON_MODEL',
      'GOOGLE_GEMINI_PRO_MODEL', 'GOOGLE_APPLICATION_CREDENTIALS_JSON', 'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64'];
    const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    for (const key of envKeys) delete process.env[key];
    process.env.GOOGLE_CLOUD_PROJECT = 'argon-test-project';
    if (thinking) process.env.GOOGLE_GEMINI_THINKING_LEVEL = thinking;
    t.after(() => {
      for (const key of envKeys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
    let captured;
    const payload = {
      candidates: [{ content: { parts: [{ text: 'seen' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    };
    const fetchImpl = async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload };
    };
    t.mock.method(globalThis, 'fetch', fetchImpl);
    const adapter = await import(pathToFileURL(adapterPath));
    const vision = name !== 'ai-video-layer-generator';
    const messages = [
      { role: 'system', content: 'Describe the image.' },
      { role: 'assistant', content: 'Earlier response.' },
      { role: 'user', content: vision ? [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      ] : 'hello' },
      { role: 'assistant', content: 'Unsupported prefill' },
    ];
    const original = structuredClone(messages);
    const request = { model: 'GEMINI4', messages, temperature: 0, top_p: 0.5, max_tokens: 100000 };
    let result;
    if (name === 'processor') {
      result = await adapter.createGoogleGeminiChatCompletion(request, { fetch: fetchImpl, getAccessToken: async () => 'test-token' });
    } else if (name === 'assistant-query-processor') {
      result = await adapter.sendAssistantGeminiCompletionRequest(messages, request.model, request, {
        fetchImpl, getGoogleAccessToken: async () => 'test-token',
      });
    } else if (name === 'audio-generator') {
      result = await adapter.createGoogleGeminiChatCompletion(messages, request.model, { fetchImpl });
    } else if (name === 'generator') {
      result = await adapter.createGoogleGeminiChatCompletion(messages, request.model);
    } else if (name === 'express-video-listener') {
      result = await adapter.createGoogleGeminiChatCompletion(request);
    } else {
      result = await adapter.createGoogleGeminiChatCompletion(messages);
    }
    assert.match(captured.url, /\/locations\/global\/publishers\/google\/models\/gemini-4-carbon:generateContent$/);
    assert.deepEqual(captured.body.generationConfig.thinkingConfig, { thinkingLevel: thinking ? 'LOW' : 'HIGH' });
    assert.equal(captured.body.generationConfig.temperature, undefined);
    assert.equal(captured.body.generationConfig.topP, undefined);
    assert.equal(captured.body.contents.at(-1).role, 'user');
    assert.equal(captured.body.contents[0].role, 'model');
    if (vision) {
      assert.deepEqual(captured.body.contents.at(-1).parts.at(-1), {
        inlineData: { mimeType: 'image/png', data: 'QUJD' },
      });
    }
    if (['processor', 'assistant-query-processor', 'express-video-listener'].includes(name)) {
      assert.equal(captured.body.generationConfig.maxOutputTokens, 32768);
    }
    assert.deepEqual(messages, original);
    assert.equal(result.outputText || result.choices?.[0]?.message?.content || result.content, 'seen');
  });

  }

  test(`${name}: external Gemini 4 routing supports the configured override`, async () => {
    const externalPath = name === 'processor' ? 'src/models/ai_utils/SamsarExternalInferenceAdapter.js'
      : adapterFile.replace('GoogleGemini.js', 'SamsarExternalInferenceAdapter.js');
    const external = await import(pathToFileURL(servicePath(name, externalPath)));
    for (const model of ['gemini-4-carbon', 'GEMINI4', 'gemini-4-argon', 'GEMINI4ARGON']) {
      assert.equal(external.getOpenRouterModelForInferenceRequest({ model }, {}), 'google/gemini-4-carbon');
      assert.equal(external.getOpenRouterModelForInferenceRequest({ model }, {
        OPENROUTER_GEMINI_4_CARBON_MODEL: 'google/custom-gemini',
      }), 'google/custom-gemini');
      assert.equal(external.getOpenRouterModelForInferenceRequest({ model }, {
        OPENROUTER_GEMINI_4_ARGON_MODEL: 'google/gemini-4-argon',
      }), 'google/gemini-4-carbon');
      assert.equal(external.getOpenRouterModelForInferenceRequest({ model }, {
        OPENROUTER_GEMINI_4_ARGON_MODEL: 'google/custom-legacy-gemini',
      }), 'google/custom-legacy-gemini');
    }
    assert.equal(external.getOpenRouterModelForInferenceRequest({ model: 'QWEN3.8' }, {}), 'qwen/qwen3.8-max');
  });
}
