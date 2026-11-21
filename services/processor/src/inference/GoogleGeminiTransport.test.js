import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleGeminiChatCompletion } from './GoogleGemini.js';
import { buildGoogleGeminiDeveloperUrl, resolveGoogleGeminiTransport } from './GoogleGeminiTransport.js';
import { createCompatibleChatCompletion } from '../models/ai_utils/OpenAICompat.js';
import { createGoogleModerationForNarrative } from '../models/moderation/GoogleModeration.js';

const TEST_KEY = 'test-server-gemini-key';
function withEnvironment(t, overrides = {}) {
  const values = {
    SAMSAR_DEPLOYMENT_EDITION: 'production', SAMSAR_EDITION: '', CURRENT_ENV: 'docker',
    SAMSAR_RUNTIME: 'docker', GOOGLE_GEMINI_API_KEY: TEST_KEY, GEMINI_API_KEY: '',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '', GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: '',
    GOOGLE_APPLICATION_CREDENTIALS: '', GOOGLE_CLOUD_PROJECT: '', GOOGLE_PROJECT_ID: '',
    GCP_PROJECT: '', GCLOUD_PROJECT: '', PROJECT_ID: '', GOOGLE_GEMINI_LOCATION: 'eu',
    SAMSAR_GENBLAZE_ENABLED: 'false', SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false',
    SAMSAR_FORCE_EXTERNAL_INFERENCE: 'false', OPENROUTER_API_KEY: 'test-openrouter-key',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: '/nonexistent/google-key-test-preferences.json',
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

test('Developer API key selection is limited to explicit production regular Carbon and Neon', () => {
  for (const env of [
    { SAMSAR_DEPLOYMENT_EDITION: 'production', CURRENT_ENV: 'docker' },
    { SAMSAR_EDITION: 'production' }, { CURRENT_ENV: 'production' },
  ]) {
    for (const model of ['gemini-4-carbon', 'google/gemini-4-carbon', 'Gemini 4 Carbon High', 'gemini-4-carbon-20261110',
      'gemini-4-neon', 'google/gemini-4-neon', 'Gemini 4 Neon High', 'gemini-4-neon-20261118']) {
      assert.equal(resolveGoogleGeminiTransport(model, { ...env, GOOGLE_GEMINI_API_KEY: TEST_KEY }).kind, 'developer');
    }
  }
  for (const model of ['gemini-3.8-flash', 'gpt-6.2-astra', 'gemini-4-carbon-cyber-permissive', 'gemini-4-carbon-20261110-cyber-permissive']) {
    assert.equal(resolveGoogleGeminiTransport(model, { CURRENT_ENV: 'production', GOOGLE_GEMINI_API_KEY: TEST_KEY }).kind, 'vertex');
  }
  for (const env of [{}, { CURRENT_ENV: 'development' }, { CURRENT_ENV: 'docker', NODE_ENV: 'production' },
    { SAMSAR_DEPLOYMENT_EDITION: 'standalone', CURRENT_ENV: 'production' },
    { SAMSAR_DEPLOYMENT_EDITION: 'development', CURRENT_ENV: 'production' },
    { SAMSAR_EDITION: 'unrecognized', CURRENT_ENV: 'production' }]) {
    assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', { ...env, GOOGLE_GEMINI_API_KEY: TEST_KEY }).kind, 'vertex');
  }
});

test('dedicated Gemini key takes precedence; generic Google keys and caller keys are not selected', () => {
  const env = { CURRENT_ENV: 'production', GOOGLE_GEMINI_API_KEY: TEST_KEY, GEMINI_API_KEY: 'fallback-test-key' };
  assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', env).apiKey, TEST_KEY);
  assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', { ...env, GOOGLE_GEMINI_API_KEY: ' ' }).apiKey, 'fallback-test-key');
  assert.equal(resolveGoogleGeminiTransport({ model: 'gemini-4-carbon', apiKey: 'caller-key' }, {
    CURRENT_ENV: 'production', GOOGLE_API_KEY: 'maps-test-key',
  }).kind, 'vertex');
  for (const stream of [false, true]) {
    const url = buildGoogleGeminiDeveloperUrl({ model: 'gemini-4-carbon', stream });
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-4-carbon:/);
    assert.equal(new URL(url).searchParams.has('key'), false);
    assert.equal(url.includes(TEST_KEY), false);
  }
});

test('production Carbon JSON and inline media use native key auth without ADC or a project', async t => {
  withEnvironment(t, { GOOGLE_APPLICATION_CREDENTIALS_JSON: 'invalid ADC JSON must not be parsed' });
  const response = await createGoogleGeminiChatCompletion({
    model: 'gemini-4-carbon', reasoning: { effort: 'high' }, apiKey: 'caller-key',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON.' }, {
      type: 'image_url', image_url: { url: '/assets_v2/generations/test.png' },
    }] }],
    response_format: { type: 'json_schema', json_schema: { schema: {
      type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'],
    } } },
  }, {
    getAccessToken: async () => assert.fail('Developer API mode must not request OAuth.'),
    readLocalMediaBuffer: async () => Buffer.from('image-test'),
    fetch: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:generateContent');
      assert.equal(options.headers['x-goog-api-key'], TEST_KEY);
      assert.equal(options.headers.Authorization, undefined);
      const body = JSON.parse(options.body);
      assert.equal(JSON.stringify(body).includes(TEST_KEY), false);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
      assert.deepEqual(body.contents[0].parts[1].inlineData, { mimeType: 'image/png', data: Buffer.from('image-test').toString('base64') });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2, totalTokenCount: 17 } }), { status: 200 });
    },
  });
  assert.deepEqual(JSON.parse(response.choices[0].message.content), { ok: true });
  assert.deepEqual(response.samsarBilling, { adapter: 'google', region: 'global', api: 'developer' });
  assert.equal(response.usage.completion_tokens, 7);
  assert.equal(JSON.stringify(response).includes(TEST_KEY), false);
});

test('the production dispatcher recognizes key-only Google Carbon and preserves incremental streaming usage', async t => {
  withEnvironment(t);
  const published = [];
  const response = await createCompatibleChatCompletion({}, {
    model: 'gemini-4-carbon', messages: [{ role: 'user', content: 'Reply OK.' }],
    onText: async text => published.push(text),
  }, {
    openRouterClient: { chat: { completions: { create: async () => assert.fail('Native key mode must not use OpenRouter.') } } },
    getAccessToken: async () => assert.fail('Developer API mode must not request OAuth.'),
    fetch: async (url, options) => {
      assert.match(url, /generativelanguage\.googleapis\.com\/.*gemini-4-carbon:streamGenerateContent\?alt=sse$/);
      assert.equal(options.headers['x-goog-api-key'], TEST_KEY);
      const frames = [
        { candidates: [{ content: { parts: [{ text: 'CARBON_' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 15 } },
      ];
      return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''), { status: 200 });
    },
  });
  assert.deepEqual(published, ['CARBON_', 'CARBON_OK']);
  assert.equal(response.choices[0].message.content, 'CARBON_OK');
  assert.equal(response.usage.completion_tokens, 5);
});

test('Google moderation uses only the server Gemini key and retains its safety decision', async t => {
  withEnvironment(t, { GOOGLE_APPLICATION_CREDENTIALS_JSON: 'invalid ADC JSON must not be parsed' });
  const result = await createGoogleModerationForNarrative('Aquarium shrimp care', {
    model: 'gemini-4-carbon', apiKey: 'caller-key', GOOGLE_GEMINI_API_KEY: 'caller-key',
    env: { CURRENT_ENV: 'production', GOOGLE_GEMINI_API_KEY: 'caller-key' },
  }, {
    getAccessToken: async () => assert.fail('Key moderation must not request OAuth.'),
    fetch: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:generateContent');
      assert.equal(options.headers['x-goog-api-key'], TEST_KEY);
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(JSON.stringify(options.body).includes(TEST_KEY), false);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{
        text: '{"flagged":false,"reason":"safe","categories":[]}',
      }] }, finishReason: 'STOP' }] }), { status: 200 });
    },
  });
  assert.equal(result.results[0].flagged, false);
  assert.equal(JSON.stringify(result).includes(TEST_KEY), false);
});

test('a Developer API eligibility error propagates without a Vertex or OpenRouter fallback', async t => {
  withEnvironment(t);
  let calls = 0;
  await assert.rejects(createCompatibleChatCompletion({}, {
    model: 'gemini-4-carbon', messages: [{ role: 'user', content: 'Reply OK.' }],
  }, {
    openRouterClient: { chat: { completions: { create: async () => assert.fail('Do not fall back to OpenRouter.') } } },
    getAccessToken: async () => assert.fail('Do not fall back to Vertex OAuth.'),
    fetch: async (url, options) => {
      calls += 1;
      assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
      assert.equal(new URL(url).searchParams.has('key'), false);
      assert.equal(options.headers['x-goog-api-key'], TEST_KEY);
      return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Eligibility denied.' } }), { status: 403 });
    },
  }), error => {
    assert.equal(error.status, 403);
    assert.equal(error.message, 'Eligibility denied.');
    assert.equal(JSON.stringify(error).includes(TEST_KEY), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('missing server API key preserves Vertex even when caller supplies moderation keys', async t => {
  withEnvironment(t, { GOOGLE_GEMINI_API_KEY: '', GOOGLE_CLOUD_PROJECT: 'vertex-project', GOOGLE_GEMINI_LOCATION: 'global' });
  let oauthCalls = 0;
  const result = await createGoogleModerationForNarrative('Aquarium shrimp care', {
    model: 'gemini-4-carbon', apiKey: 'caller-key',
    env: { CURRENT_ENV: 'production', GEMINI_API_KEY: 'caller-key' },
  }, {
    getAccessToken: async () => { oauthCalls += 1; return 'test-oauth-token'; },
    fetch: async (url, options) => {
      assert.match(url, /aiplatform\.googleapis\.com\/.*vertex-project\/.*gemini-4-carbon:generateContent$/);
      assert.equal(options.headers['x-goog-api-key'], undefined);
      assert.equal(options.headers.Authorization, 'Bearer test-oauth-token');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{
        text: '{"flagged":true,"reason":"unsafe","categories":[{"name":"unsafe","flagged":true,"score":1}]}',
      }] }, finishReason: 'STOP' }] }), { status: 200 });
    },
  });
  assert.equal(oauthCalls, 1);
  assert.equal(result.results[0].flagged, true);
});
