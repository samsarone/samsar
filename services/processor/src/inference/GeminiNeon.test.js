import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProviderModelForInferenceModel,
  INFERENCE_MODEL_OPTIONS,
  normalizeInferenceModel,
  normalizeSupportedInferenceModel,
} from '../consts/InferenceModels.js';
import { ASSISTANT_MODEL_TYPES, INFERENCE_MODEL_TYPES } from '../consts/ModelTypes.js';
import { ASSISTANT_MODEL_PRICES } from '../consts/ModelPrices.js';
import { createGoogleGeminiChatCompletion } from './GoogleGemini.js';
import { resolveGoogleGeminiTransport } from './GoogleGeminiTransport.js';
import { createCompatibleChatCompletion } from '../models/ai_utils/OpenAICompat.js';
import { getOpenRouterModelForInferenceRequest } from '../models/ai_utils/SamsarExternalInferenceAdapter.js';
import { calculateAssistantRequestBilling } from '../models/api/AssistantBilling.js';
import { mergeRuntimeInferenceDeploymentAvailability } from '../models/api/DeploymentModelConfig.js';
import { normalizeModelAdapterModelKey } from '../models/api/ModelAdapterPreferences.js';
import { resolveEffectiveInferenceSettings } from '../models/api/RequestModelOverrides.js';
import { resolvePublicationMetadataInferenceModel } from '../models/publication/InferenceModel.js';
import NarrativeRequest from '../schema/NarrativeRequest.js';

function withGoogleKey(t) {
  const overrides = {
    SAMSAR_DEPLOYMENT_EDITION: 'production', SAMSAR_RUNTIME: 'docker', CURRENT_ENV: 'docker',
    GOOGLE_GEMINI_API_KEY: 'neon-test-server-key',
    SAMSAR_GENBLAZE_ENABLED: 'false', SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: '/nonexistent/gemini-neon-preferences.json',
  };
  const keys = new Set([
    ...Object.keys(process.env).filter(key => /^(?:SAMSAR|CURRENT_ENV|OPENAI|ANTHROPIC|GOOGLE|GEMINI|GCP|GCLOUD|PROJECT_ID|ALIBABA|DASHSCOPE|QWEN|FAL|OPENROUTER|KIMI)/.test(key)),
    ...Object.keys(overrides),
  ]);
  const previous = Object.fromEntries([...keys].map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('Neon aliases and explicit requests retain their identity independently of Carbon and account defaults', () => {
  for (const alias of ['gemini-4-neon', 'Gemini 4 Neon', 'Google Gemini 4 Neon', 'google/gemini-4-neon', 'Gemini 4 Neon High']) {
    assert.equal(normalizeInferenceModel(alias), 'gemini-4-neon');
    assert.equal(getProviderModelForInferenceModel(alias, { env: { GOOGLE_GEMINI_4_CARBON_MODEL: 'gemini-4-carbon-20261110' } }), 'gemini-4-neon');
    assert.equal(resolveEffectiveInferenceSettings({ inference_model: alias }, 'claude-opus-5.5', 'xhigh').inferenceModel, 'gemini-4-neon');
  }
  assert.equal(normalizeSupportedInferenceModel('gemini-4-neonish'), null);
  assert.equal(normalizeInferenceModel('gemini-4-argon'), 'gemini-4-carbon');
  assert.equal(normalizeModelAdapterModelKey('google/gemini-4-neon'), 'gemini-4-neon');
  assert.equal(resolvePublicationMetadataInferenceModel({ expressGenerationInferenceModel: 'gemini-4-neon' }), 'gemini-4-neon');
  assert.ok(NarrativeRequest.schema.path('inferenceModel').enumValues.includes('gemini-4-neon'));
  for (const options of [INFERENCE_MODEL_OPTIONS, INFERENCE_MODEL_TYPES, ASSISTANT_MODEL_TYPES]) {
    assert.ok(options.some(option => option.value === 'gemini-4-carbon'));
    assert.ok(options.some(option => option.value === 'gemini-4-neon'));
  }
});

test('Neon uses its own native and OpenRouter overrides instead of Carbon overrides', () => {
  assert.equal(getProviderModelForInferenceModel('gemini-4-neon', { env: {
    GOOGLE_GEMINI_4_CARBON_MODEL: 'gemini-4-carbon-20261110',
    GOOGLE_GEMINI_4_NEON_MODEL: 'gemini-4-neon-20261118',
  } }), 'gemini-4-neon-20261118');
  assert.equal(getOpenRouterModelForInferenceRequest({ model: 'gemini-4-neon' }, {
    OPENROUTER_GEMINI_4_CARBON_MODEL: 'google/gemini-4-carbon',
  }), 'google/gemini-4-neon');
  assert.equal(getOpenRouterModelForInferenceRequest({ model: 'gemini-4-neon' }, {
    OPENROUTER_GEMINI_4_NEON_MODEL: 'google/gemini-4-neon-20261118',
  }), 'google/gemini-4-neon-20261118');
});

test('key-only production availability includes both Gemini models with native Google routing', t => {
  withGoogleKey(t);
  const available = mergeRuntimeInferenceDeploymentAvailability({});
  assert.deepEqual(available.models, ['gemini-4-carbon', 'gemini-4-neon']);
  for (const model of available.models) {
    assert.equal(available.modelProviders[model], 'googleCloud');
    assert.equal(resolveGoogleGeminiTransport(model).kind, 'developer');
  }
  for (const model of ['gemini-4-neon-cyber-permissive', 'gemini-4-neonish', 'gemini-3.8-flash']) {
    assert.equal(resolveGoogleGeminiTransport(model).kind, 'vertex');
  }
});

test('Neon native JSON uses the production key, high thinking and its own 64K output cap', async t => {
  withGoogleKey(t);
  const response = await createGoogleGeminiChatCompletion({
    model: 'gemini-4-neon', temperature: 0.2, top_p: 0.3, max_tokens: 100_000,
    messages: [{ role: 'user', content: 'Return valid scene JSON.' }, { role: 'assistant', content: '{' }],
    response_format: { type: 'json_schema', json_schema: { schema: {
      type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'],
    } } },
  }, {
    getAccessToken: async () => assert.fail('Neon must not switch to Vertex OAuth.'),
    fetch: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-neon:generateContent');
      assert.equal(options.headers['x-goog-api-key'], 'neon-test-server-key');
      assert.equal(options.headers.Authorization, undefined);
      const body = JSON.parse(options.body);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
      assert.equal(body.generationConfig.maxOutputTokens, 65536);
      assert.equal(body.generationConfig.temperature, undefined);
      assert.equal(body.generationConfig.topP, undefined);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.equal(body.contents.at(-1).role, 'user');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2 } }));
    },
  });
  assert.equal(response.model, 'gemini-4-neon');
  assert.equal(response.choices[0].message.content, '{"ok":true}');
  assert.equal(response.usage.completion_tokens, 7);
  assert.deepEqual(response.samsarBilling, { adapter: 'google', region: 'global', api: 'developer' });
});

test('Neon dispatcher streams natively and preserves cumulative output and thinking usage', async t => {
  withGoogleKey(t);
  const texts = [];
  const response = await createCompatibleChatCompletion({}, {
    model: 'gemini-4-neon', messages: [{ role: 'user', content: 'Reply OK.' }], onText: text => texts.push(text),
  }, {
    getAccessToken: async () => assert.fail('Neon streaming must not request OAuth.'),
    openRouterClient: { chat: { completions: { create: async () => assert.fail('Neon must not silently use Carbon or OpenRouter.') } } },
    fetch: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-neon:streamGenerateContent?alt=sse');
      assert.equal(options.headers['x-goog-api-key'], 'neon-test-server-key');
      const frames = [
        { candidates: [{ content: { parts: [{ text: 'NEON_' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 15 } },
      ];
      return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''));
    },
  });
  assert.deepEqual(texts, ['NEON_', 'NEON_OK']);
  assert.equal(response.model, 'gemini-4-neon');
  assert.equal(response.usage.completion_tokens, 5);
});

test('Neon cached input and thinking use Neon rates across the Carbon promotion boundary', () => {
  const usage = { google_usage_metadata: {
    promptTokenCount: 1_000_000, cachedContentTokenCount: 200_000,
    candidatesTokenCount: 100_000, thoughtsTokenCount: 400_000, totalTokenCount: 1_500_000,
  } };
  for (const pricingTimestampMs of [Date.UTC(2026, 10, 30), Date.UTC(2026, 11, 1)]) {
    for (const model of ['gemini-4-neon', 'google/gemini-4-neon', 'gemini-4-neon-20261118']) {
      const billed = calculateAssistantRequestBilling({ model, usage }, { pricingTimestampMs });
      assert.equal(billed.pricingModel, 'gemini-4-neon');
      assert.equal(billed.costUsd, 9.93);
      assert.equal(billed.credits, 1191.6);
      assert.equal(billed.usage.outputTokens, 500_000);
    }
  }
  assert.deepEqual(ASSISTANT_MODEL_PRICES.find(model => model.key === 'gemini-4-neon').prices.map(price => price.price), [360, 18, 1800]);
});
