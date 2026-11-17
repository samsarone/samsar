import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleAuth } from 'google-auth-library';

import { createGoogleGeminiChatCompletion } from './GoogleGemini.js';
import { buildGoogleGeminiDeveloperUrl, resolveGoogleGeminiTransport } from './GoogleGeminiTransport.js';
import { resolveConfiguredInferenceProvider, shouldUseSamsarExternalInference } from './SamsarExternalInferenceAdapter.js';

const servicePath = import.meta.url;
const isExpress = /\/(?:samsar_express_video_listener|express-video-listener)\//.test(servicePath);
const isAiVideo = /\/(?:samsar_ai_video_layer_generator|ai-video-layer-generator)\//.test(servicePath);
const isAudio = /\/(?:samsar_audio_generator|audio-generator)\//.test(servicePath);

function withEnvironment(t, overrides = {}) {
  const values = {
    CURRENT_ENV: 'docker', SAMSAR_DEPLOYMENT_EDITION: 'production', SAMSAR_EDITION: '',
    SAMSAR_RUNTIME: 'docker', NODE_ENV: 'production',
    GOOGLE_GEMINI_API_KEY: 'server-test-key', GEMINI_API_KEY: 'fallback-test-key',
    GOOGLE_CLOUD_PROJECT: '', GOOGLE_PROJECT_ID: '', GCP_PROJECT: '', GCLOUD_PROJECT: '', PROJECT_ID: '',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '{invalid-credentials-must-not-be-read',
    GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: 'invalid-credentials',
    GOOGLE_APPLICATION_CREDENTIALS: '', GOOGLE_GEMINI_LOCATION: 'eu',
    GOOGLE_GEMINI_4_CARBON_MODEL: '', GOOGLE_GEMINI_4_ARGON_MODEL: '', GOOGLE_GEMINI_PRO_MODEL: '',
    GOOGLE_GEMINI_THINKING_LEVEL: 'HIGH',
    K_SERVICE: '', GAE_SERVICE: '', FUNCTION_TARGET: '', GCE_METADATA_HOST: '',
    OPENROUTER_API_KEY: 'test-openrouter-key', SAMSAR_API_KEY: '', SAMSAR_EXTERNAL_API_KEY: '',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false', SAMSAR_FORCE_EXTERNAL_INFERENCE: 'false',
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function callNative(messages, fetchImpl) {
  if (isExpress) {
    return createGoogleGeminiChatCompletion({
      model: 'gemini-4-carbon', messages,
      reasoning_effort: 'high',
    });
  }
  if (isAiVideo) return createGoogleGeminiChatCompletion(messages);
  return createGoogleGeminiChatCompletion(messages, 'gemini-4-carbon', isAudio ? { fetchImpl } : undefined);
}

test('Developer transport is limited to explicit production regular Carbon and key aliases', () => {
  const production = { SAMSAR_DEPLOYMENT_EDITION: 'production', SAMSAR_RUNTIME: 'docker',
    CURRENT_ENV: 'docker', GOOGLE_GEMINI_API_KEY: ' preferred ', GEMINI_API_KEY: 'alias' };
  for (const model of ['gemini-4-carbon', 'google/gemini-4-carbon', 'Gemini 4 Carbon High',
    'gemini-4-carbon-20261110', 'google/gemini-4-carbon-20261110', 'gemini-4-argon']) {
    const transport = resolveGoogleGeminiTransport(model, production);
    assert.equal(transport.kind, 'developer', model);
    assert.equal(transport.apiKey, 'preferred');
  }
  assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', {
    CURRENT_ENV: 'production', GEMINI_API_KEY: ' alias ',
  }).apiKey, 'alias');
  assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', {
    SAMSAR_DEPLOYMENT_EDITION: '  ', SAMSAR_EDITION: ' Production ', GOOGLE_GEMINI_API_KEY: 'test-key',
  }).kind, 'developer');
  for (const request of [{ model: 'gemini-4-carbon' }, { provider_options: { model: 'gemini-4-carbon' } },
    { providerOptions: { model: 'gemini-4-carbon' } }, { inference_model: 'gemini-4-carbon' },
    { inferenceModel: 'gemini-4-carbon' }]) {
    assert.equal(resolveGoogleGeminiTransport(request, production).kind, 'developer');
  }
  for (const model of ['gemini-3.8-flash', 'gemini-4-hydrogen', 'gpt-6.2-astra',
    'gemini-4-carbon-cyber-permissive', 'gemini-4-carbon-20261110-cyber-permissive',
    'google/gemini-4-carbon-cyber-permissive-20261110']) {
    assert.equal(resolveGoogleGeminiTransport(model, production).kind, 'vertex', model);
  }
  for (const env of [
    { CURRENT_ENV: 'docker', NODE_ENV: 'production' },
    { SAMSAR_DEPLOYMENT_EDITION: 'standalone', NODE_ENV: 'production' },
    { CURRENT_ENV: 'development' },
    { SAMSAR_DEPLOYMENT_EDITION: 'development', CURRENT_ENV: 'production' },
    { SAMSAR_DEPLOYMENT_EDITION: 'unknown', CURRENT_ENV: 'production' },
    { NODE_ENV: 'production' }, {},
  ]) {
    assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', {
      ...env, GOOGLE_GEMINI_API_KEY: 'test-key',
    }).kind, 'vertex', JSON.stringify(env));
  }
  assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', {
    CURRENT_ENV: 'production',
  }).kind, 'vertex');
});

test('Developer URLs support unary and streaming without putting API keys in the URL', () => {
  assert.equal(buildGoogleGeminiDeveloperUrl({ model: 'gemini-4-carbon' }),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:generateContent');
  assert.equal(buildGoogleGeminiDeveloperUrl({ model: 'gemini-4-carbon', stream: true }),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse');
});

test('production Carbon uses server key without OAuth or a Cloud project and keeps native payload and usage', async t => {
  withEnvironment(t);
  let capturedUrl;
  let capturedOptions;
  let capturedBody;
  t.mock.method(GoogleAuth.prototype, 'getClient', () => assert.fail('Developer transport must not request OAuth'));
  const usage = { promptTokenCount: 11, candidatesTokenCount: 3, thoughtsTokenCount: 7,
    totalTokenCount: 21, cachedContentTokenCount: 2 };
  const payload = { responseId: 'test-response', modelVersion: 'gemini-4-carbon',
    candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
    usageMetadata: usage };
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  t.mock.method(globalThis, 'fetch', fetchImpl);
  const completion = await callNative([
    { role: 'developer', content: 'Return accurate JSON.' },
    { role: 'user', content: 'Return ok true.' },
    { role: 'assistant', content: 'Drop trailing model turn.' },
  ], fetchImpl);
  assert.equal(capturedUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:generateContent');
  assert.equal(capturedOptions.headers['x-goog-api-key'], 'server-test-key');
  assert.equal(capturedOptions.headers.Authorization, undefined);
  assert.equal(capturedUrl.includes('server-test-key'), false);
  assert.equal(JSON.stringify(capturedBody).includes('server-test-key'), false);
  assert.deepEqual(capturedBody.contents.map(x => x.role), ['user']);
  assert.deepEqual(capturedBody.generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
  assert.deepEqual(completion.samsarBilling, { adapter: 'google', region: 'global', api: 'developer' });
  const responseText = completion.choices?.[0]?.message?.content || completion.content;
  assert.deepEqual(JSON.parse(responseText), { ok: true });
  if (isExpress) {
    assert.equal(completion.usage.completion_tokens, 3);
    assert.deepEqual(completion.usage.google_usage_metadata, usage);
  } else {
    assert.deepEqual(completion.usage, usage);
  }
});

test('a key-only production Carbon deployment remains on the native Google adapter', t => {
  withEnvironment(t, {
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '', GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: '',
  });
  assert.equal(resolveConfiguredInferenceProvider('gemini-4-carbon'), 'googleCloud');
  assert.equal(shouldUseSamsarExternalInference({ model: 'gemini-4-carbon' }), false);
});

test('Developer key failures do not trigger OAuth fallback or expose the key', async t => {
  withEnvironment(t);
  let fetchCalls = 0;
  t.mock.method(GoogleAuth.prototype, 'getClient', () => assert.fail('Do not fall back to OAuth after key failure'));
  const fetchImpl = async url => {
    fetchCalls += 1;
    assert.equal(url.includes('server-test-key'), false);
    return new Response(JSON.stringify({ error: { code: 403, message: 'Developer access denied' } }), { status: 403 });
  };
  t.mock.method(globalThis, 'fetch', fetchImpl);
  await assert.rejects(callNative([{ role: 'user', content: 'hello' }], fetchImpl), error => {
    assert.equal(error.message, 'Developer access denied');
    assert.equal(error.message.includes('server-test-key'), false);
    return true;
  });
  assert.equal(fetchCalls, 1);
});

test('standalone with a server key and production without a key retain Vertex OAuth', async t => {
  for (const scenario of [
    { name: 'standalone with key', overrides: { SAMSAR_DEPLOYMENT_EDITION: 'standalone' } },
    { name: 'production without key', overrides: { GOOGLE_GEMINI_API_KEY: '', GEMINI_API_KEY: '' } },
  ]) {
    await t.test(scenario.name, async child => {
      withEnvironment(child, {
        GOOGLE_CLOUD_PROJECT: 'vertex-test-project',
        GOOGLE_APPLICATION_CREDENTIALS_JSON: '', GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: '',
        ...scenario.overrides,
      });
      let oauthCalls = 0;
      let capturedUrl;
      let capturedOptions;
      child.mock.method(GoogleAuth.prototype, 'getClient', async () => {
        oauthCalls += 1;
        return { getAccessToken: async () => ({ token: 'vertex-test-token' }) };
      });
      const fetchImpl = async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 });
      };
      child.mock.method(globalThis, 'fetch', fetchImpl);
      const completion = await callNative([{ role: 'user', content: 'hello' }], fetchImpl);
      assert.equal(oauthCalls, 1);
      assert.match(capturedUrl, /^https:\/\/[^/]*aiplatform\.googleapis\.com\/v1\/projects\/vertex-test-project\//);
      assert.equal(capturedOptions.headers.Authorization, 'Bearer vertex-test-token');
      assert.equal(capturedOptions.headers['x-goog-api-key'], undefined);
      assert.equal(completion.samsarBilling, undefined);
    });
  }
});
