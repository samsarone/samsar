import assert from 'node:assert/strict';
import test from 'node:test';

import { createCompatibleChatCompletion } from './OpenAICompat.js';

function productionEnvironment(t, runtime) {
  const values = {
    SAMSAR_DEPLOYMENT_EDITION: 'production', SAMSAR_EDITION: '',
    CURRENT_ENV: runtime === 'docker' ? 'docker' : 'production', SAMSAR_RUNTIME: runtime,
    GOOGLE_CLOUD_PROJECT: 'native-carbon-test-project', GOOGLE_GEMINI_LOCATION: 'global',
    GOOGLE_GEMINI_API_KEY: '', GEMINI_API_KEY: '',
    GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: Buffer.from(JSON.stringify({
      type: 'service_account', project_id: 'native-carbon-test-project',
      client_email: 'native-carbon@example.invalid', private_key: 'test-only',
    })).toString('base64'),
    OPENROUTER_API_KEY: 'test-openrouter-key',
    SAMSAR_GENBLAZE_ENABLED: 'false', SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false',
    SAMSAR_FORCE_EXTERNAL_INFERENCE: 'false',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: '/nonexistent/native-carbon-test-preferences.json',
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

function forbiddenOpenRouter() {
  return { chat: { completions: { create: async () => assert.fail('Production Carbon must use native Google.') } } };
}

for (const runtime of ['host', 'docker']) {
  test(`production ${runtime} Carbon generation uses native Google with JSON output and reasoning`, async t => {
    productionEnvironment(t, runtime);
    let calls = 0;
    const result = await createCompatibleChatCompletion({}, {
      model: 'gemini-4-carbon',
      messages: [{ role: 'user', content: 'Return JSON with ok set to true.' }],
      reasoning: { effort: 'high' },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'native_carbon_probe', schema: {
          type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'],
        } },
      },
    }, {
      openRouterClient: forbiddenOpenRouter(),
      getAccessToken: async () => 'test-google-token',
      fetch: async (url, options) => {
        calls += 1;
        assert.match(url, /^https:\/\/aiplatform\.googleapis\.com\/.*\/gemini-4-carbon:generateContent$/);
        const body = JSON.parse(options.body);
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        assert.equal(body.generationConfig.responseSchema.properties.ok.type, 'BOOLEAN');
        assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
        return new Response(JSON.stringify({
          responseId: 'native-carbon-generation',
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2, totalTokenCount: 17 },
        }), { status: 200 });
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(result.choices[0].message.content), { ok: true });
    assert.equal(result.samsarBilling.adapter, 'google');
    assert.equal(result.usage.completion_tokens, 7);
  });
}

test('production Carbon assistant streams through native Google and retains final usage', async t => {
  productionEnvironment(t, 'docker');
  const published = [];
  const result = await createCompatibleChatCompletion({}, {
    model: 'gemini-4-carbon',
    messages: [{ role: 'user', content: 'Reply CARBON_OK.' }],
    onText: async text => published.push(text),
  }, {
    openRouterClient: forbiddenOpenRouter(),
    getAccessToken: async () => 'test-google-token',
    fetch: async url => {
      assert.match(url, /gemini-4-carbon:streamGenerateContent\?alt=sse$/);
      const events = [
        { responseId: 'native-carbon-stream', candidates: [{ content: { parts: [{ text: 'CARBON_' }] } }] },
        { responseId: 'native-carbon-stream', candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 15 } },
      ];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        status: 200, headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  });
  assert.deepEqual(published, ['CARBON_', 'CARBON_OK']);
  assert.equal(result.choices[0].message.content, 'CARBON_OK');
  assert.equal(result.samsarBilling.adapter, 'google');
  assert.equal(result.usage.completion_tokens, 5);
});
