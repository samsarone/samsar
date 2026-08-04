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

import { createCompatibleInferenceChatCompletion } from './OpenAI.js';
import {
  sendAssistantMessageRequest as sendGPTImageAssistantMessageRequest,
} from './providers/GPTImageOne.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'DASHSCOPE_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_INFERENCE_MAX_RETRIES',
  'OPENROUTER_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_EXTERNAL_INFERENCE_MAX_RETRIES',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
];

async function withEnvironment(overrides, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);
  try {
    return await callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function createPreferenceFile(t, modelProviderPriority) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'samsar-openai-order-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  writeFileSync(preferencePath, JSON.stringify({ modelProviderPriority }));
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));
  return preferencePath;
}

function createResponse(content = 'ok') {
  return {
    choices: [{
      message: { role: 'assistant', content },
    }],
  };
}

function createStatusError(status, message = `status ${status}`) {
  const error = new Error(message);
  error.status = status;
  return error;
}

test('standalone automatic calls retry configured adapters in saved preference order', async (t) => {
  const preferencePath = createPreferenceFile(t, {
    'gpt-5.6-sol': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    const response = await createCompatibleInferenceChatCompletion({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
    }, {
      createSamsarExternalChatCompletion: async (request) => {
        calls.push(`samsar:${request.authorization}`);
        throw createStatusError(429, 'temporary Samsar limit');
      },
      openaiClient: {
        chat: {
          completions: {
            create: async (request, options) => {
              calls.push(`openai:${request.model}`);
              assert.equal(options.maxRetries, 0);
              return createResponse('openai fallback');
            },
          },
        },
      },
    });

    assert.deepEqual(calls, ['samsar:deployed', 'openai:gpt-5.6-sol']);
    assert.equal(response.choices[0].message.content, 'openai fallback');
  });
});

test('standalone automatic calls dispatch an OpenRouter preference to OpenRouter before fallback', async (t) => {
  const preferencePath = createPreferenceFile(t, {
    'gpt-5.6-sol': ['openrouter', 'samsar'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    const response = await createCompatibleInferenceChatCompletion({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
    }, {
      createSamsarExternalChatCompletion: async (request) => {
        calls.push(request.authorization);
        if (request.authorization === 'openrouter') {
          throw createStatusError(429, 'temporary OpenRouter limit');
        }
        return createResponse('samsar fallback');
      },
      openaiClient: {
        post: async () => assert.fail('OpenRouter preference reached native OpenAI'),
      },
    });

    assert.deepEqual(calls, ['openrouter', 'deployed']);
    assert.equal(response.choices[0].message.content, 'samsar fallback');
  });
});

test('explicit deployed and OpenRouter authorizations remain pinned', async (t) => {
  const preferencePath = createPreferenceFile(t, {
    'gpt-5.6-sol': ['openai', 'samsar', 'openrouter'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    for (const authorization of ['deployed', 'openrouter']) {
      const calls = [];
      await assert.rejects(
        createCompatibleInferenceChatCompletion({
          model: 'gpt-5.6-sol',
          authorization,
          messages: [{ role: 'user', content: 'hello' }],
        }, {
          createSamsarExternalChatCompletion: async (request) => {
            calls.push(request.authorization);
            throw createStatusError(503, `${authorization} unavailable`);
          },
          openaiClient: {
            chat: {
              completions: {
                create: async () => {
                  calls.push('openai');
                  return createResponse();
                },
              },
            },
          },
        }),
        { status: 503 },
      );
      assert.deepEqual(calls, [authorization]);
    }
  });
});

test('the external inference bypass remains pinned to the native adapter', async (t) => {
  const preferencePath = createPreferenceFile(t, {
    'gpt-5.6-sol': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    const response = await createCompatibleInferenceChatCompletion({
      model: 'gpt-5.6-sol',
      bypassSamsarExternalInference: true,
      messages: [{ role: 'user', content: 'hello' }],
    }, {
      createSamsarExternalChatCompletion: async () => {
        calls.push('samsar');
        return createResponse();
      },
      openaiClient: {
        chat: {
          completions: {
            create: async () => {
              calls.push('openai');
              return createResponse('native');
            },
          },
        },
      },
    });

    assert.deepEqual(calls, ['openai']);
    assert.equal(response.choices[0].message.content, 'native');
  });
});

test('automatic retry metadata does not leak into a native Qwen request', async () => {
  await withEnvironment({
    CURRENT_ENV: 'docker',
    DASHSCOPE_API_KEY: 'qwen-key',
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
  }, async () => {
    let capturedRequest;
    await createCompatibleInferenceChatCompletion({
      model: 'QWEN3.8',
      messages: [{ role: 'user', content: 'hello' }],
      bypassSamsarExternalInference: true,
      externalMaxRetries: 9,
      maxRetries: 0,
    }, {
      createQwenChatCompletion: async (request) => {
        capturedRequest = request;
        return createResponse('qwen');
      },
    });

    assert.equal(Object.hasOwn(capturedRequest, 'externalMaxRetries'), false);
    assert.equal(capturedRequest.maxRetries, 0);
  });
});

test('non-retryable adapter failures do not advance to the next provider', async (t) => {
  const preferencePath = createPreferenceFile(t, {
    'gpt-5.6-sol': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    await assert.rejects(
      createCompatibleInferenceChatCompletion({
        model: 'gpt-5.6-sol',
        messages: [{ role: 'user', content: 'hello' }],
      }, {
        createSamsarExternalChatCompletion: async () => {
          calls.push('samsar');
          throw createStatusError(400, 'invalid request');
        },
        openaiClient: {
          chat: {
            completions: {
              create: async () => {
                calls.push('openai');
                return createResponse();
              },
            },
          },
        },
      }),
      { status: 400 },
    );
    assert.deepEqual(calls, ['samsar']);
  });
});

test('production calls ignore standalone preferences and do not cross adapters', async (t) => {
  const preferencePath = createPreferenceFile(t, {
    'gpt-5.6-sol': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'production',
    OPENAI_API_KEY: 'openai-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    const response = await createCompatibleInferenceChatCompletion({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
    }, {
      createSamsarExternalChatCompletion: async () => {
        calls.push('samsar');
        return createResponse();
      },
      openaiClient: {
        chat: {
          completions: {
            create: async () => {
              calls.push('openai');
              return createResponse('production');
            },
          },
        },
      },
    });

    assert.deepEqual(calls, ['openai']);
    assert.equal(response.choices[0].message.content, 'production');
  });
});

test('GPT image prompt retries use the shared standalone adapter order', async (t) => {
  const preferencePath = createPreferenceFile(t, {
    'gpt-5.6-sol': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
    t.mock.method(
      SamsarClient.prototype,
      'createV2ExternalChatCompletion',
      async () => {
        calls.push('samsar');
        throw createStatusError(429, 'temporary Samsar limit');
      },
    );
    t.mock.method(
      OpenAI.Chat.Completions.prototype,
      'create',
      async (request, options) => {
        calls.push('openai');
        assert.equal(request.model, 'gpt-5.6-sol');
        assert.equal(options.maxRetries, 0);
        return createResponse('rewritten image prompt');
      },
    );

    const response = await sendGPTImageAssistantMessageRequest(
      [{ role: 'user', content: 'rewrite this image prompt' }],
      'gpt-5.6-sol',
    );

    assert.deepEqual(calls, ['samsar', 'openai']);
    assert.equal(response.content, 'rewritten image prompt');
  });
});
