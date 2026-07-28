import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import OpenAI from 'openai';
import SamsarClient from 'samsar-js';

import {
  DOCKER_INFERENCE_PROVIDER,
  createOpenRouterChatCompletion,
  createSamsarExternalChatCompletion,
  getConfiguredInferenceProviders,
  resolveConfiguredInferenceProvider,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'ALIBABA_CLOUD_API_KEY',
  'ALIBABA_API_KEY',
  'CURRENT_ENV',
  'DASHSCOPE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'KIMI_K3_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'QWEN_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
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

test('Qwen routing prefers a native Alibaba key before Samsar fallback', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    DASHSCOPE_API_KEY: 'dashscope-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'native',
    }), false);
  });
});

test('ALIBABA_API_KEY is detected as native Qwen credentials', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    ALIBABA_API_KEY: 'alibaba-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), false);
  });
});

test('Qwen routing falls back to Samsar in Docker when no native key exists', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
  });
});

test('standalone inference routing honors saved provider order and appends omitted defaults', () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'samsar-inference-order-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'QWEN3.7': ['samsar', 'alibabaCloud'],
    },
  }));

  try {
    withEnvironment({
      CURRENT_ENV: 'docker',
      SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
      SAMSAR_API_KEY: 'samsar-key',
      DASHSCOPE_API_KEY: 'dashscope-key',
      OPENROUTER_API_KEY: 'openrouter-key',
    }, () => {
      assert.deepEqual(
        getConfiguredInferenceProviders('QWEN3.7'),
        [
          DOCKER_INFERENCE_PROVIDER.SAMSAR,
          DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD,
          DOCKER_INFERENCE_PROVIDER.OPENROUTER,
        ],
      );
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('hosted inference ignores saved preferences and keeps Qwen OpenRouter-only', () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'samsar-hosted-order-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      'gpt-5.6-sol': ['samsar', 'openrouter', 'openai'],
      'QWEN3.7': ['samsar', 'alibabaCloud', 'openrouter'],
    },
  }));

  try {
    for (const environment of ['production', 'staging']) {
      withEnvironment({
        CURRENT_ENV: environment,
        SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
        SAMSAR_API_KEY: 'samsar-key',
        OPENAI_API_KEY: 'openai-key',
        OPENROUTER_API_KEY: 'openrouter-key',
        DASHSCOPE_API_KEY: 'dashscope-key',
      }, () => {
        assert.deepEqual(
          getConfiguredInferenceProviders('gpt-5.6-sol'),
          [
            DOCKER_INFERENCE_PROVIDER.OPENAI,
            DOCKER_INFERENCE_PROVIDER.OPENROUTER,
            DOCKER_INFERENCE_PROVIDER.SAMSAR,
          ],
        );
        assert.deepEqual(
          getConfiguredInferenceProviders('QWEN3.7'),
          [DOCKER_INFERENCE_PROVIDER.OPENROUTER],
        );
      });
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Kimi K3 routing prefers its native key and falls back to Samsar-js', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    KIMI_K3_API_KEY: 'kimi-key',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(
      resolveConfiguredInferenceProvider('Kimi K3'),
      DOCKER_INFERENCE_PROVIDER.KIMI,
    );
    assert.equal(shouldUseSamsarExternalInference({
      model: 'Kimi K3',
      authorization: 'native',
    }), false);
  });

  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(
      resolveConfiguredInferenceProvider('kimi-k3'),
      DOCKER_INFERENCE_PROVIDER.SAMSAR,
    );
    assert.equal(shouldUseSamsarExternalInference({
      model: 'kimi-k3',
      authorization: 'native',
    }), true);
  });
});

test('Kimi K3 Samsar-js fallback preserves the model and forces high reasoning', async (t) => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'kimi-fallback-key',
  });

  let capturedPayload;
  t.mock.method(
    SamsarClient.prototype,
    'createV2ExternalChatCompletion',
    async (payload) => {
      capturedPayload = payload;
      return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    },
  );

  const response = await createSamsarExternalChatCompletion({
    model: 'Kimi K3',
    reasoning_effort: 'low',
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(response.choices[0].message.content, 'ok');
  assert.equal(capturedPayload.model, 'kimi-k3');
  assert.equal(capturedPayload.reasoning_effort, 'high');
});

test('OpenRouter enables every inference model while preserving native-first routing', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    for (const model of ['QWEN3.7', 'gemini-3.1-pro', 'gpt-5.6-sol']) {
      assert.equal(resolveConfiguredInferenceProvider(model), DOCKER_INFERENCE_PROVIDER.OPENROUTER);
    }
    process.env.OPENAI_API_KEY = 'openai-key';
    assert.equal(resolveConfiguredInferenceProvider('gpt-5.6-sol'), DOCKER_INFERENCE_PROVIDER.OPENAI);
  });
});

test('hosted and external Qwen always use OpenRouter instead of native adapters', () => {
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

test('explicit deployed authorization overrides native credentials for every inference provider', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
    DASHSCOPE_API_KEY: 'dashscope-key',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '{}',
    KIMI_K3_API_KEY: 'kimi-key',
    OPENAI_API_KEY: 'openai-key',
  }, () => {
    for (const model of ['QWEN3.7', 'gemini-3.1-pro', 'kimi-k3', 'gpt-5.6-sol']) {
      assert.equal(shouldUseSamsarExternalInference({
        model,
        authorization: 'deployed',
      }), true);
    }
  });
});

test('explicit native authorization preserves Samsar fallback while provider credentials are absent', () => {
  withEnvironment({
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-key',
  }, () => {
    assert.equal(shouldUseSamsarExternalInference({
      model: 'QWEN3.7',
      authorization: 'native',
    }), true);
    for (const model of ['gemini-3.1-pro', 'kimi-k3', 'gpt-5.6-sol']) {
      assert.equal(shouldUseSamsarExternalInference({
        model,
        authorization: 'native',
      }), true);
    }
  });
});

test('Qwen OpenRouter uses Max for text and Plus for vision with bounded settings', async (t) => {
  const keys = [
    'CURRENT_ENV',
    'OPENROUTER_API_KEY',
    'OPENROUTER_QWEN_MAX_TOKENS',
    'OPENROUTER_QWEN_REASONING_EFFORT',
  ];
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
  delete process.env.OPENROUTER_QWEN_REASONING_EFFORT;

  const payloads = [];
  const options = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload, requestOptions) => {
    payloads.push(payload);
    options.push(requestOptions);
    return { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
  });

  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'hello' }],
    reasoning: { effort: 'xhigh' },
    max_completion_tokens: 20000,
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/frame.png' } }],
    }],
  });
  await createOpenRouterChatCompletion({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'return JSON' }],
    reasoning: { effort: 'high' },
    max_tokens: 8192,
    response_format: { type: 'json_object' },
    provider: { data_collection: 'deny' },
    plugins: [{ id: 'existing-plugin' }],
  });

  assert.equal(payloads[0].model, 'qwen/qwen3.7-max');
  assert.equal(payloads[0].max_tokens, 20000);
  assert.equal(payloads[0].reasoning.effort, 'high');
  assert.equal(Object.hasOwn(payloads[0], 'max_completion_tokens'), false);
  assert.equal(payloads[1].model, 'qwen/qwen3.7-plus');
  assert.equal(payloads[1].max_tokens, 16384);
  assert.equal(payloads[2].model, 'qwen/qwen3.7-max');
  assert.equal(payloads[2].reasoning.effort, 'high');
  assert.equal(payloads[2].max_tokens, 8192);
  assert.deepEqual(payloads[2].provider, { data_collection: 'deny', require_parameters: true });
  assert.deepEqual(payloads[2].plugins, [{ id: 'existing-plugin' }, { id: 'response-healing' }]);
  assert.equal(options[0].maxRetries, 0);
  assert.equal(options[0].signal instanceof AbortSignal, true);
});
