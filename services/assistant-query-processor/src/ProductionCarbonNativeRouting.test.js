import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { GoogleAuth } from 'google-auth-library';
import { sendAssistantCompletionRequest } from './OpenAI.js';

function useProductionEnvironment(t, deployment) {
  const values = {
    CURRENT_ENV: '', SAMSAR_DEPLOYMENT_EDITION: 'production', SAMSAR_EDITION: '',
    SAMSAR_RUNTIME: '', GOOGLE_CLOUD_PROJECT: 'native-carbon-project',
    GOOGLE_PROJECT_ID: '', GCP_PROJECT: '', GCLOUD_PROJECT: '', PROJECT_ID: '',
    K_SERVICE: '', GAE_SERVICE: '', FUNCTION_TARGET: '', GCE_METADATA_HOST: '',
    GOOGLE_GEMINI_LOCATION: 'global', GOOGLE_GEMINI_4_CARBON_MODEL: '',
    GOOGLE_GEMINI_API_KEY: '', GEMINI_API_KEY: '',
    GOOGLE_GEMINI_4_ARGON_MODEL: '', GOOGLE_GEMINI_PRO_MODEL: '',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '', GOOGLE_APPLICATION_CREDENTIALS: '',
    GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: Buffer.from(JSON.stringify({
      type: 'service_account', project_id: 'native-carbon-project',
      client_email: 'native-carbon@example.invalid', private_key: 'test-key',
    })).toString('base64'),
    OPENROUTER_API_KEY: 'test-openrouter-key', SAMSAR_API_KEY: 'test-samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false', SAMSAR_FORCE_EXTERNAL_INFERENCE: 'false',
    SAMSAR_GENBLAZE_ENABLED: 'false', SAMSAR_DOCKER_ADAPTER_ROUTING_ENABLED: 'false',
    ...deployment,
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

for (const deployment of [
  { CURRENT_ENV: 'production', SAMSAR_RUNTIME: 'host' },
  { CURRENT_ENV: 'docker', SAMSAR_RUNTIME: 'docker' },
]) {
  for (const api of ['vertex', 'developer']) {
  for (const stream of [false, true]) {
    test(`production Carbon assistant uses native Google ${api} with runtime ${deployment.SAMSAR_RUNTIME} and stream ${stream}`, async t => {
      useProductionEnvironment(t, {
        ...deployment,
        ...(api === 'developer' ? {
          GOOGLE_GEMINI_API_KEY: 'test-google-api-key', GEMINI_API_KEY: 'test-lower-priority-key',
          GOOGLE_CLOUD_PROJECT: '', GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: '',
          GOOGLE_GEMINI_LOCATION: 'eu',
        } : {}),
      });
      t.mock.method(GoogleAuth.prototype, 'getClient', async () => {
        assert.equal(api, 'vertex', 'Developer API must not request ADC credentials');
        return { getAccessToken: async () => ({ token: 'test-google-token' }) };
      });
      t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async () => {
        assert.fail('Production Carbon must not call the OpenRouter transport');
      });
      const requests = [];
      const deltas = [];
      const usageMetadata = { promptTokenCount: 5, candidatesTokenCount: 3, thoughtsTokenCount: 7, totalTokenCount: 15 };
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        if (api === 'developer') {
          assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-4-carbon:/);
          assert.equal(options.headers['x-goog-api-key'], 'test-google-api-key');
          assert.equal(options.headers.Authorization, undefined);
          assert.ok(!url.includes('test-google-api-key'));
          assert.ok(!url.includes('key='));
        } else {
          assert.match(url, /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/native-carbon-project\/locations\/global\/publishers\/google\/models\/gemini-4-carbon:/);
          assert.equal(options.headers.Authorization, 'Bearer test-google-token');
          assert.equal(options.headers['x-goog-api-key'], undefined);
        }
        if (!stream) return new Response(JSON.stringify({
          responseId: 'native-carbon', modelVersion: 'gemini-4-carbon', usageMetadata,
          candidates: [{ content: { role: 'model', parts: [{ text: 'CARBON_ACCESS_OK' }] }, finishReason: 'STOP' }],
        }));
        const events = [
          { responseId: 'native-carbon', candidates: [{ content: { role: 'model', parts: [{ text: 'CARBON_' }] } }] },
          { modelVersion: 'gemini-4-carbon', usageMetadata, candidates: [{ content: { role: 'model', parts: [{ text: 'ACCESS_OK' }] }, finishReason: 'STOP' }] },
        ];
        return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });

      const response = await sendAssistantCompletionRequest(
        [{ role: 'user', content: 'Reply CARBON_ACCESS_OK.' }],
        'gemini-4-carbon',
        { maxRetries: 0, externalMaxRetries: 0, ...(stream ? { onText: text => deltas.push(text) } : {}) },
      );

      assert.equal(requests.length, 1);
      assert.ok(requests[0].url.endsWith(stream ? ':streamGenerateContent?alt=sse' : ':generateContent'));
      assert.equal(response.model, 'gemini-4-carbon');
      assert.equal(response.outputText, 'CARBON_ACCESS_OK');
      assert.deepEqual(response.response.samsarBilling, {
        adapter: 'google', region: 'global', ...(api === 'developer' ? { api: 'developer' } : {}),
      });
      assert.equal(response.response.usage.input_tokens, 5);
      assert.equal(response.response.usage.output_tokens, 10);
      if (stream) assert.deepEqual(deltas, ['CARBON_', 'CARBON_ACCESS_OK']);
    });
  }
  }
}
