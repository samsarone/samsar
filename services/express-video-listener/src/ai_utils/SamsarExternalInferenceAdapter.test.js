import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';

import {
  DOCKER_INFERENCE_PROVIDER,
  DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL,
  createOpenRouterChatCompletion,
  getOpenRouterModelForInferenceRequest,
  resolveConfiguredInferenceProvider,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'ALIBABA_CLOUD_API_KEY',
  'ALIBABA_API_KEY',
  'CURRENT_ENV',
  'DASHSCOPE_API_KEY',
  'KIMI_K3_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'QWEN_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'SAMSAR_QWEN_OPENROUTER_ONLY',
];

function withEnvironment(overrides, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, overrides);
  try {
    return callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('Qwen routing prefers a native Alibaba key before the Samsar Docker fallback', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    DASHSCOPE_API_KEY: 'dashscope-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), false);
  });
});

test('Qwen routing falls back to Samsar in Docker when no Alibaba key exists', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    OPENAI_API_KEY: 'openai-key-does-not-authorize-qwen',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
  });
});

test('OpenRouter is the Docker fallback for all inference and Qwen vision models', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    for (const model of ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol']) {
      assert.equal(resolveConfiguredInferenceProvider(model), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
    }
    assert.equal(getOpenRouterModelForInferenceRequest({
      model: 'QWEN3.7',
      messages: [{ role: 'user', content: 'hello' }],
    }), 'qwen/qwen3.7-max');
    assert.equal(getOpenRouterModelForInferenceRequest({
      model: 'QWEN3.7',
      messages: [{ role: 'user', content: [{ type: 'input_image', image_url: 'frame' }] }],
    }), 'qwen/qwen3.7-plus');
  });
});

test('hosted and external Qwen always use OpenRouter even with Alibaba credentials', () => {
  for (const environment of ['production', 'external-production', 'staging']) {
    withEnvironment({
      CURRENT_ENV: environment,
      OPENROUTER_API_KEY: 'openrouter-key',
      ALIBABA_API_KEY: 'alibaba-key',
    }, () => {
      const request = { model: 'QWEN3.7', authorization: 'deployed' };
      assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
      assert.equal(shouldUseOpenRouterInference(request), true);
      assert.equal(shouldUseSamsarExternalInference(request), true);
    });
  }
});

test('the existing GPT and Gemini native-credential decisions are unchanged', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    OPENAI_API_KEY: 'openai-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'gpt-5.6-sol' }), false);
    assert.equal(shouldUseSamsarExternalInference({ model: 'gemini-3.1-pro' }), true);
  });
});

test('Kimi K3 uses the native Kimi key first and Samsar as its only fallback', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(resolveConfiguredInferenceProvider('KIMIK3'), DOCKER_INFERENCE_PROVIDER.SAMSAR);
    assert.equal(shouldUseSamsarExternalInference({ model: 'kimi-k3' }), true);
  });

  withEnvironment({
    CURRENT_ENV: 'docker',
    KIMI_K3_API_KEY: 'kimi-key',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(resolveConfiguredInferenceProvider('Kimi K3'), DOCKER_INFERENCE_PROVIDER.KIMI);
    assert.equal(shouldUseOpenRouterInference({ model: 'kimi-k3' }), false);
    assert.equal(shouldUseSamsarExternalInference({ model: 'kimi-k3' }), false);
    assert.deepEqual(DOCKER_INFERENCE_PROVIDER_PRIORITY_BY_MODEL['kimi-k3'], [
      DOCKER_INFERENCE_PROVIDER.KIMI,
      DOCKER_INFERENCE_PROVIDER.SAMSAR,
    ]);
  });
});

test('an explicit deployed authorization uses Samsar even when a native key exists', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    ALIBABA_API_KEY: 'alibaba-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'deployed',
    }), true);
  });
});

test('an explicit native authorization falls back to Samsar when its provider key is absent', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'native',
    }), true);
    assert.equal(shouldUseSamsarExternalInference({
      model: 'gemini-3.1-pro',
      authorization: 'native',
    }), true);
    assert.equal(shouldUseSamsarExternalInference({
      model: 'gpt-5.6-sol',
      authorization: 'native',
    }), true);
  });
});

test('the ALIBABA_API_KEY alias authorizes explicit native Qwen routing', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    ALIBABA_API_KEY: 'alibaba-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'native',
    }), false);
  });
});

test('Qwen OpenRouter applies Max text and Plus vision routing with bounded settings', async (t) => {
  const keys = ['CURRENT_ENV', 'OPENROUTER_API_KEY', 'OPENROUTER_QWEN_MAX_TOKENS'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.CURRENT_ENV = 'production';
  process.env.OPENROUTER_API_KEY = 'openrouter-key';
  process.env.OPENROUTER_QWEN_MAX_TOKENS = '50000';
  const payloads = [];
  const options = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload, requestOptions) => {
    payloads.push(payload);
    options.push(requestOptions);
    return { choices: [{ message: { content: 'ok' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'xhigh' },
    max_completion_tokens: 20000,
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'return JSON' }],
    reasoning: { effort: 'low' },
    max_tokens: 16384,
    response_format: { type: 'json_object' },
    provider: { data_collection: 'deny' },
    plugins: [{ id: 'existing-plugin' }],
  });

  assert.equal(payloads[0].model, 'qwen/qwen3.7-max');
  assert.equal(payloads[0].reasoning.effort, 'high');
  assert.equal(payloads[0].max_tokens, 20000);
  assert.equal(payloads[1].model, 'qwen/qwen3.7-plus');
  assert.equal(payloads[1].max_tokens, 16384);
  assert.equal(payloads[2].model, 'qwen/qwen3.7-max');
  assert.equal(payloads[2].reasoning.effort, 'high');
  assert.equal(payloads[2].max_tokens, 16384);
  assert.deepEqual(payloads[2].provider, { data_collection: 'deny', require_parameters: true });
  assert.deepEqual(payloads[2].plugins, [{ id: 'existing-plugin' }, { id: 'response-healing' }]);
  assert.equal(options[0].maxRetries, 0);
  assert.equal(options[0].signal instanceof AbortSignal, true);
});
