import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';

import {
  sendAssistantMessageRequest as sendAlternatePromptRequest,
} from './AIUtils.js';
import {
  sendAssistantMessageRequest,
  sendAssistantStructuredMessageRequest,
} from './OpenAI.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  'SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED',
  'SAMSAR_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'KIMI_K3_API_KEY',
];
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

test.afterEach(restoreEnv);

test('both direct dispatchers and structured inference use native Kimi K3', async (t) => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_PROVIDER_USAGE_AUDIT_ENABLED = 'false';
  process.env.KIMI_K3_API_KEY = 'kimi-test-key';

  const payloads = [];
  t.mock.method(OpenAI.Chat.Completions.prototype, 'create', async (payload) => {
    payloads.push(payload);
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: payload.response_format
            ? JSON.stringify({ useEndFrame: true })
            : 'Kimi response',
        },
      }],
    };
  });

  const messages = [
    { role: 'developer', content: 'Follow the instructions.' },
    { role: 'user', content: 'Generate a prompt.' },
  ];
  const alternateResponse = await sendAlternatePromptRequest(
    messages,
    'Kimi K3',
  );
  const assistantResponse = await sendAssistantMessageRequest(
    messages,
    'KIMIK3',
  );
  const structuredResponse = await sendAssistantStructuredMessageRequest(
    messages,
    'kimi-k3',
  );

  assert.equal(alternateResponse.content, 'Kimi response');
  assert.equal(assistantResponse.content, 'Kimi response');
  assert.deepEqual(structuredResponse, { useEndFrame: true });
  assert.equal(payloads.length, 3);

  for (const payload of payloads) {
    assert.equal(payload.model, 'kimi-k3');
    assert.equal(payload.reasoning_effort, 'high');
    assert.equal(payload.messages[0].role, 'system');
  }
  assert.equal(
    payloads[2].response_format.json_schema.strict,
    true,
  );
});
