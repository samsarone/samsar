import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCompatibleInferenceChatCompletion, sendAssistantMessageRequest } from './OpenAI.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'DASHSCOPE_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
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
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'samsar-audio-openai-order-'));
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
    'gpt-6-astra': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_INFERENCE_MAX_RETRIES: '0',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    const response = await createCompatibleInferenceChatCompletion({
      model: 'gpt-6-astra',
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

    assert.deepEqual(calls, ['samsar:deployed', 'openai:gpt-6-astra']);
    assert.equal(response.choices[0].message.content, 'openai fallback');
  });
});

test('standalone automatic calls dispatch an OpenRouter preference to OpenRouter before fallback', async (t) => {
  const preferencePath = createPreferenceFile(t, {
    'gpt-6-astra': ['openrouter', 'samsar'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_INFERENCE_MAX_RETRIES: '0',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    const response = await createCompatibleInferenceChatCompletion({
      model: 'gpt-6-astra',
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
    'gpt-6-astra': ['openai', 'samsar', 'openrouter'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_INFERENCE_MAX_RETRIES: '0',
    OPENROUTER_API_KEY: 'openrouter-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    for (const authorization of ['deployed', 'openrouter']) {
      const calls = [];
      await assert.rejects(
        createCompatibleInferenceChatCompletion({
          model: 'gpt-6-astra',
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
    'gpt-6-astra': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_INFERENCE_MAX_RETRIES: '0',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    const response = await createCompatibleInferenceChatCompletion({
      model: 'gpt-6-astra',
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
    'gpt-6-astra': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'docker',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_INFERENCE_MAX_RETRIES: '0',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    await assert.rejects(
      createCompatibleInferenceChatCompletion({
        model: 'gpt-6-astra',
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
    'gpt-6-astra': ['samsar', 'openai'],
  });

  await withEnvironment({
    CURRENT_ENV: 'production',
    OPENAI_API_KEY: 'openai-key',
    OPENAI_INFERENCE_MAX_RETRIES: '0',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  }, async () => {
    const calls = [];
    const response = await createCompatibleInferenceChatCompletion({
      model: 'gpt-6-astra',
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

for (const effort of ['high', 'xhigh']) {
  test(`native Sol ${effort} uses Responses for vision and round-trips tool calls`, async () => {
    await withEnvironment({ OPENAI_API_KEY: 'test-only', SAMSAR_DEPLOYMENT_EDITION: 'production' }, async () => {
      let sent;
      const result = await createCompatibleInferenceChatCompletion({
        authorization: 'native', model: 'gpt-6.1-sol', effort, temperature: 0.5, max_tokens: 200,
        messages: [
          { role: 'system', content: 'Describe the image' },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/frame.png' } }] },
          { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
          { role: 'tool', tool_call_id: 'call-1', content: 'Found' },
        ],
        tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }],
      }, { openaiClient: {
        post: async (url, options) => {
          assert.equal(url, '/responses');
          assert.equal(options.maxRetries, 0);
          sent = options.body;
          return { model: 'gpt-6.1-sol', status: 'completed', output: [{ type: 'function_call', call_id: 'call-2', name: 'lookup', arguments: '{}' }], usage: { input_tokens: 20, output_tokens: 10, input_tokens_details: { cached_tokens: 5 } } };
        },
      } });
      assert.equal(sent.model, 'gpt-6.1-sol');
      assert.equal(sent.reasoning.effort, effort);
      assert.equal(sent.max_output_tokens, 200);
      assert.equal(sent.temperature, undefined);
      assert.equal(sent.input[0].role, 'developer');
      assert.equal(sent.input[1].content[0].image_url, 'https://example.com/frame.png');
      assert.equal(sent.input[2].call_id, 'call-1');
      assert.deepEqual(sent.input[3], { type: 'function_call_output', call_id: 'call-1', output: 'Found' });
      assert.equal(sent.tools[0].name, 'lookup');
      assert.equal(result.choices[0].message.tool_calls[0].id, 'call-2');
      assert.equal(result.choices[0].finish_reason, 'tool_calls');
      assert.equal(result.usage.prompt_tokens, 20);
      assert.equal(result.usage.prompt_tokens_details.cached_tokens, 5);
    });
  });
}

for (const model of ['claude-opus-5.5', 'claude-fable-5.2']) {
  test(`speech prompt entry point forwards explicit ${model} effort`, async (t) => {
    await withEnvironment({ CURRENT_ENV: 'docker', SAMSAR_DEPLOYMENT_EDITION: 'standalone', ANTHROPIC_API_KEY: 'test-only' }, async () => {
      let sent;
      t.mock.method(globalThis, 'fetch', async (_url, options) => {
        sent = JSON.parse(options.body);
        return new Response(JSON.stringify({ model: sent.model, content: [{ type: 'text', text: 'ok' }] }));
      });
      for (const effort of ['high', 'xhigh']) {
        await sendAssistantMessageRequest([{ role: 'user', content: 'Plan speech.' }],
          model + (effort === 'high' ? '-xhigh' : ''), 'native', effort);
        assert.equal(sent.model, model.replace(/(\d)\.(\d)/, '$1-$2'));
        assert.equal(sent.output_config.effort, effort);
      }
    });
  });
}
