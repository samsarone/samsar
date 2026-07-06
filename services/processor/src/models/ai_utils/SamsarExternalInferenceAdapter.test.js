import assert from 'node:assert/strict';
import test from 'node:test';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_API_KEY',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'OPENAI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_PROJECT_ID',
  'GCP_PROJECT',
  'GCLOUD_PROJECT',
  'PROJECT_ID',
  'K_SERVICE',
  'GAE_SERVICE',
  'FUNCTION_TARGET',
  'GCE_METADATA_HOST',
];

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

const {
  shouldUseSamsarExternalInference,
  unwrapSamsarExternalChatCompletionResponse,
} = await import('./SamsarExternalInferenceAdapter.js');

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
}

function clearProviderEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

test.afterEach(() => {
  restoreEnv();
});

test('unwrapSamsarExternalChatCompletionResponse unwraps samsar-js response envelopes', () => {
  const chatCompletion = {
    id: 'chatcmpl-test',
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'ok',
        },
      },
    ],
  };

  assert.equal(unwrapSamsarExternalChatCompletionResponse({
    data: chatCompletion,
    status: 200,
    creditsCharged: 1.23,
  }), chatCompletion);
});

test('unwrapSamsarExternalChatCompletionResponse preserves raw OpenAI-compatible responses', () => {
  const chatCompletion = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'ok',
        },
      },
    ],
  };

  assert.equal(unwrapSamsarExternalChatCompletionResponse(chatCompletion), chatCompletion);
});

test('shouldUseSamsarExternalInference falls back for Gemini in docker without Google auth', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'hello' }],
  }), true);
});

test('shouldUseSamsarExternalInference keeps Gemini native when Google auth is configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
  process.env.K_SERVICE = 'processor';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'hello' }],
  }), false);
});

test('shouldUseSamsarExternalInference falls back for OpenAI models in docker without OpenAI auth', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: 'hello' }],
  }), true);
});

test('shouldUseSamsarExternalInference keeps OpenAI native when OpenAI auth is configured', () => {
  clearProviderEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'test-samsar-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';

  assert.equal(shouldUseSamsarExternalInference({
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: 'hello' }],
  }), false);
});
