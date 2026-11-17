import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGoogleGeminiDeveloperUrl, resolveGoogleGeminiTransport } from './GoogleGeminiTransport.js';
import { sendAssistantGeminiCompletionRequest } from './GoogleGemini.js';

test('production regular Carbon accepts existing server key aliases and preserves provider model IDs', () => {
  for (const model of ['gemini-4-carbon', 'google/gemini-4-carbon-20261110', 'Gemini 4 Carbon', 'gemini-4-argon']) {
    const transport = resolveGoogleGeminiTransport({ model }, {
      SAMSAR_DEPLOYMENT_EDITION: 'production',
      GOOGLE_GEMINI_API_KEY: ' preferred-test-key ', GEMINI_API_KEY: 'legacy-test-key',
    });
    assert.equal(transport.kind, 'developer');
    assert.equal(transport.apiKey, 'preferred-test-key');
    assert.equal(transport.model, model.includes('20261110') ? 'gemini-4-carbon-20261110' : 'gemini-4-carbon');
  }
  assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', {
    CURRENT_ENV: 'production', GOOGLE_GEMINI_API_KEY: ' ', GEMINI_API_KEY: ' legacy-test-key ',
  }).apiKey, 'legacy-test-key');
});

test('Developer API selection requires production and excludes Cyber and other models', () => {
  const key = { GOOGLE_GEMINI_API_KEY: 'test-server-key' };
  for (const env of [key, { ...key, NODE_ENV: 'production' },
    { ...key, CURRENT_ENV: 'docker' },
    { ...key, CURRENT_ENV: 'production', SAMSAR_DEPLOYMENT_EDITION: 'standalone' },
    { ...key, SAMSAR_DEPLOYMENT_EDITION: 'development' }]) {
    assert.deepEqual(resolveGoogleGeminiTransport('gemini-4-carbon', env), { kind: 'vertex', model: 'gemini-4-carbon' });
  }
  for (const model of ['gemini-4-carbon-cyber', 'gemini-4-carbon-20261110-cyber',
    'gemini-4-carbon.cyber.20261110', 'gemini-3-pro', 'gpt-6.2-astra']) {
    assert.equal(resolveGoogleGeminiTransport(model, { ...key, CURRENT_ENV: 'production' }).kind, 'vertex');
  }
  assert.equal(resolveGoogleGeminiTransport('gemini-4-carbon', { CURRENT_ENV: 'production' }).kind, 'vertex');
  assert.equal(resolveGoogleGeminiTransport({ model: 'gemini-4-carbon', apiKey: 'caller-key' }, {
    CURRENT_ENV: 'production',
  }).kind, 'vertex');
});

test('Developer API URLs carry the model and streaming mode without credentials', () => {
  assert.equal(buildGoogleGeminiDeveloperUrl({ model: 'gemini-4-carbon-20261110' }),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon-20261110:generateContent');
  assert.equal(buildGoogleGeminiDeveloperUrl({ model: 'gemini-4-carbon', stream: true }),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:streamGenerateContent?alt=sse');
});

function useDeveloperEnvironment(t) {
  const values = { SAMSAR_DEPLOYMENT_EDITION: 'production', GOOGLE_GEMINI_API_KEY: 'test-server-key' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('Developer API bypasses ADC and preserves native media, thinking and output limits', async t => {
  useDeveloperEnvironment(t);
  let requests = 0;
  const response = await sendAssistantGeminiCompletionRequest([
    { role: 'system', content: 'Read the image.' },
    { role: 'user', content: [
      { type: 'text', text: 'Reply OK.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,dGVzdA==' } },
    ] },
    { role: 'assistant', content: 'Trailing assistant turn.' },
  ], 'gemini-4-carbon-20261110', {
    apiKey: 'ignored-caller-key', max_output_tokens: 50000, thinkingLevel: 'MEDIUM',
    temperature: 0.2, top_p: 0.5, maxRetries: 0,
  }, {
    getGoogleCloudConfig: () => assert.fail('Developer API must not read ADC configuration'),
    getGoogleAccessToken: () => assert.fail('Developer API must not request an OAuth token'),
    fetchImpl: async (url, options) => {
      requests += 1;
      assert.equal(url, buildGoogleGeminiDeveloperUrl({ model: 'gemini-4-carbon-20261110' }));
      assert.equal(options.headers['x-goog-api-key'], 'test-server-key');
      assert.equal(options.headers.Authorization, undefined);
      const body = JSON.parse(options.body);
      assert.equal(body.contents.length, 1);
      assert.equal(body.contents[0].role, 'user');
      assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'dGVzdA==' } });
      assert.deepEqual(body.systemInstruction, { parts: [{ text: 'Read the image.' }] });
      assert.equal(body.generationConfig.maxOutputTokens, 32768);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM');
      assert.equal(body.generationConfig.temperature, undefined);
      assert.equal(body.generationConfig.topP, undefined);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
    },
  });
  assert.equal(requests, 1);
  assert.equal(response.outputText, 'OK');
  assert.deepEqual(response.response.samsarBilling, { adapter: 'google', region: 'global', api: 'developer' });
});

test('Developer API authorization failure propagates without a Vertex fallback', async t => {
  useDeveloperEnvironment(t);
  let requests = 0;
  await assert.rejects(sendAssistantGeminiCompletionRequest([
    { role: 'user', content: 'Reply OK.' },
  ], 'gemini-4-carbon', { maxRetries: 0 }, {
    getGoogleCloudConfig: () => assert.fail('Authorization failures must not fall back to Vertex'),
    getGoogleAccessToken: () => assert.fail('Authorization failures must not request ADC'),
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ error: { message: 'API access denied' } }), { status: 403 });
    },
  }), { message: 'API access denied', status: 403 });
  assert.equal(requests, 1);
});
