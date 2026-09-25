import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import SamsarClient from 'samsar-js';

import {
  __testOnly__,
  assignScoreForTheImage,
  runVisionInferenceWithRetry,
} from './VisionUtils.js';

const silentLogger = {
  error() {},
  warn() {},
};

test('OpenRouter vision models use operation-specific reasoning-safe output limits', () => {
  assert.equal(__testOnly__.getExternalVisionMaxTokens('QWEN3.8', 'description'), 16384);
  assert.equal(__testOnly__.getExternalVisionMaxTokens('QWEN3.8', 'score'), 8192);
  assert.equal(__testOnly__.getExternalVisionMaxTokens('gpt-6-astra', 'description'), 16384);
  assert.equal(__testOnly__.getExternalVisionMaxTokens('gemini-3.1-pro', 'score'), 8192);
  assert.equal(__testOnly__.getExternalVisionMaxTokens('kimi-k3', 'description'), undefined);
});

test('native GPT vision omits external-only completion limits', async (t) => {
  const environmentKeys = [
    'CURRENT_ENV',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_EDITION',
    'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
    'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  ];
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, {
    CURRENT_ENV: 'production',
    OPENAI_API_KEY: 'native-openai-key',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
  });

  const payloads = [];
  t.mock.method(
    OpenAI.Chat.Completions.prototype,
    'create',
    async (payload, options) => {
      payloads.push(payload);
      assert.equal(options.maxRetries, 0);
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: payloads.length === 1 ? 'Native GPT image description.' : '{"score":95}',
          },
        }],
      };
    },
  );

  const description = await __testOnly__.getDescriptionForImage(
    'data:image/png;base64,AQID',
    'cinematic',
    'gpt-6-astra',
    '16:9',
    'cinematic theme',
    'native',
  );
  const score = await assignScoreForTheImage(
    'A cinematic image',
    description,
    'cinematic',
    'gpt-6-astra',
    '16:9',
    'cinematic theme',
    '',
    'native',
  );

  assert.equal(description, 'Native GPT image description.');
  assert.equal(score, 95);
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.model, 'gpt-6-astra');
    assert.equal(Object.hasOwn(payload, 'externalMaxTokens'), false);
    assert.equal(Object.hasOwn(payload, 'max_tokens'), false);
    assert.equal(Object.hasOwn(payload, 'max_completion_tokens'), false);
    assert.equal(Object.hasOwn(payload, 'max_output_tokens'), false);
  }
});

test('Qwen 3.8 Max drives both native vision description and scoring', async (t) => {
  const environmentKeys = [
    'ALIBABA_QWEN_38_MAX_MODEL',
    'ALIBABA_QWEN_TEXT_MODEL',
    'CURRENT_ENV',
    'DASHSCOPE_API_KEY',
    'QWEN_38_MAX_MODEL',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_EDITION',
    'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
    'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  ];
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    DASHSCOPE_API_KEY: 'native-qwen-key',
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
  });

  const payloads = [];
  t.mock.method(
    OpenAI.Chat.Completions.prototype,
    'create',
    async (payload) => {
      payloads.push(payload);
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: payloads.length === 1 ? 'Qwen image description.' : '{"score":94}',
          },
        }],
      };
    },
  );

  const description = await __testOnly__.getDescriptionForImage(
    'data:image/png;base64,AQID',
    'cinematic',
    'Qwen 3.8 Max',
    '16:9',
    'cinematic theme',
    'native',
  );
  const score = await assignScoreForTheImage(
    'A cinematic image',
    description,
    'cinematic',
    'Qwen 3.8 Max',
    '16:9',
    'cinematic theme',
    '',
    'native',
  );

  assert.equal(description, 'Qwen image description.');
  assert.equal(score, 94);
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.model, 'qwen3.8-max');
    assert.equal(payload.enable_thinking, true);
  }
  assert.equal(payloads[0].messages[1].content[1].type, 'image_url');
  assert.equal(
    payloads[0].messages[1].content[1].image_url.url,
    'data:image/png;base64,AQID',
  );
});

test('Kimi K3 drives both native describe and judge stages in high mode', async (t) => {
  const environmentKeys = [
    'CURRENT_ENV',
    'KIMI_K3_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_EDITION',
    'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
    'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  ];
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    KIMI_K3_API_KEY: 'native-kimi-key',
  });

  const payloads = [];
  t.mock.method(
    OpenAI.Chat.Completions.prototype,
    'create',
    async (payload) => {
      payloads.push(payload);
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: payloads.length === 1 ? 'Detailed image description.' : '{"score":93}',
          },
        }],
      };
    },
  );

  const description = await __testOnly__.getDescriptionForImage(
    'data:image/png;base64,AQID',
    'cinematic',
    'Kimi K3',
    '16:9',
    'cinematic theme',
    'native',
  );
  const score = await assignScoreForTheImage(
    'A cinematic image',
    description,
    'cinematic',
    'Kimi K3',
    '16:9',
    'cinematic theme',
    '',
    'native',
  );

  assert.equal(description, 'Detailed image description.');
  assert.equal(score, 93);
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.model, 'kimi-k3');
    assert.equal(payload.reasoning_effort, 'high');
    assert.equal(payload.messages[0].role, 'system');
  }
  assert.equal(Array.isArray(payloads[0].messages[1].content), true);
  assert.equal(payloads[0].messages[1].content[1].type, 'image_url');
  assert.equal(
    payloads[0].messages[1].content[1].image_url.url,
    'data:image/png;base64,AQID',
  );
});

test('Kimi K3 describe and judge stages use the Samsar-js fallback without a native key', async (t) => {
  const environmentKeys = [
    'CURRENT_ENV',
    'KIMI_K3_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_EDITION',
    'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
    'SAMSAR_FORCE_EXTERNAL_INFERENCE',
  ];
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    SAMSAR_API_KEY: 'samsar-fallback-key',
  });

  const payloads = [];
  t.mock.method(
    SamsarClient.prototype,
    'createV2ExternalChatCompletion',
    async (payload) => {
      payloads.push(payload);
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: payloads.length === 1 ? 'Fallback image description.' : '{"score":88}',
          },
        }],
      };
    },
  );

  const description = await __testOnly__.getDescriptionForImage(
    'data:image/png;base64,AQID',
    'cinematic',
    'kimi-k3',
    '16:9',
    '',
    'native',
  );
  const score = await assignScoreForTheImage(
    'A cinematic image',
    description,
    'cinematic',
    'kimi-k3',
    '16:9',
    '',
    '',
    'native',
  );

  assert.equal(description, 'Fallback image description.');
  assert.equal(score, 88);
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.model, 'kimi-k3');
    assert.equal(payload.reasoning_effort, 'high');
  }
  assert.equal(
    payloads[0].messages[1].content[1].image_url.url,
    'data:image/png;base64,AQID',
  );
});

test('vision describe and judge stages advance through the saved adapter order', async (t) => {
  const environmentKeys = [
    'CURRENT_ENV',
    'KIMI_K3_API_KEY',
    'SAMSAR_API_KEY',
    'SAMSAR_DEPLOYMENT_EDITION',
    'SAMSAR_EDITION',
    'SAMSAR_EXTERNAL_INFERENCE_ENABLED',
    'SAMSAR_FORCE_EXTERNAL_INFERENCE',
    'SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH',
  ];
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'samsar-vision-order-'));
  const preferencePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  writeFileSync(preferencePath, JSON.stringify({
    modelProviderPriority: {
      KIMIK3: ['samsar', 'kimi'],
    },
  }));
  t.after(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of environmentKeys) delete process.env[key];
  Object.assign(process.env, {
    CURRENT_ENV: 'docker',
    KIMI_K3_API_KEY: 'native-kimi-key',
    SAMSAR_API_KEY: 'samsar-key',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'true',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: preferencePath,
  });

  const calls = [];
  let kimiCalls = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(
    SamsarClient.prototype,
    'createV2ExternalChatCompletion',
    async () => {
      calls.push('samsar');
      const error = new Error('temporary Samsar limit');
      error.status = 429;
      throw error;
    },
  );
  t.mock.method(
    OpenAI.Chat.Completions.prototype,
    'create',
    async (payload, options) => {
      calls.push('kimi');
      kimiCalls += 1;
      assert.equal(payload.model, 'kimi-k3');
      assert.equal(options.maxRetries, 0);
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: kimiCalls === 1 ? 'Ordered image description.' : '{"score":91}',
          },
        }],
      };
    },
  );

  const description = await __testOnly__.getDescriptionForImage(
    'data:image/png;base64,AQID',
    'cinematic',
    'Kimi K3',
    '16:9',
    '',
  );
  const score = await assignScoreForTheImage(
    'A cinematic image',
    description,
    'cinematic',
    'Kimi K3',
    '16:9',
  );

  assert.equal(description, 'Ordered image description.');
  assert.equal(score, 91);
  assert.deepEqual(calls, ['samsar', 'kimi', 'samsar', 'kimi']);
});

test('vision inference retries a 429 three times with exponential backoff', async () => {
  let calls = 0;
  const observedDelays = [];

  const result = await runVisionInferenceWithRetry(async () => {
    calls += 1;
    if (calls <= 3) {
      const error = new Error('Provider returned error');
      error.status = 429;
      throw error;
    }
    return 'ok';
  }, {
    maxRetries: 3,
    sleep: async (delayMs) => observedDelays.push(delayMs),
    logger: silentLogger,
  });

  assert.equal(result, 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(observedDelays, [
    __testOnly__.getVisionInferenceRetryDelayMs(1),
    __testOnly__.getVisionInferenceRetryDelayMs(2),
    __testOnly__.getVisionInferenceRetryDelayMs(3),
  ]);
  assert.ok(observedDelays[1] >= observedDelays[0]);
  assert.ok(observedDelays[2] >= observedDelays[1]);
});

function mockClaudeScoring(t, responses) {
  const environment = {
    CURRENT_ENV: 'docker',
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_EXTERNAL_INFERENCE_ENABLED: 'false',
    SAMSAR_MODEL_ADAPTER_PREFERENCES_PATH: path.join(os.tmpdir(), `missing-scoring-preferences-${process.pid}.json`),
    ANTHROPIC_API_KEY: 'test-scoring-key',
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const payloads = [];
  const delays = [];
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    delays.push(delay);
    queueMicrotask(callback);
    return 0;
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    const result = responses[Math.min(payloads.length - 1, responses.length - 1)];
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: result.text }],
      stop_reason: result.stopReason || 'end_turn',
    }), { status: 200 });
  });
  return { payloads, delays, errors };
}

function scoreWithClaude() {
  return assignScoreForTheImage(
    'An upright anime frame', 'Existing detailed image description.',
    'grounded', 'claude-opus-5.5', '16:9', '', '', 'native',
  );
}

test('Claude scoring enforces a Zod schema and retries the same description three times', async (t) => {
  const { payloads, delays, errors } = mockClaudeScoring(t, [
    { text: 'Score: 72' },
    { text: '{"score":"72"}' },
    { text: '{"score":101}' },
    { text: '{"score":72}' },
  ]);

  assert.equal(await scoreWithClaude(), 72, JSON.stringify(errors));
  assert.equal(payloads.length, 4);
  assert.deepEqual(delays, [1, 2, 3].map(__testOnly__.getVisionInferenceRetryDelayMs));
  for (const payload of payloads) {
    assert.deepEqual(payload, payloads[0]);
    assert.match(payload.messages[0].content[0].text, /Existing detailed image description\./);
    assert.match(payload.system[0].text, /Return only a JSON object containing "score"/);
  }
  const format = payloads[0].output_config.format;
  assert.equal(format.type, 'json_schema');
  assert.equal(format.schema.properties.score.type, 'integer');
  assert.equal(format.schema.additionalProperties, false);
  assert.deepEqual(format.schema.required, ['score']);
  assert.equal(Object.hasOwn(format.schema.properties.score, 'minimum'), false);
  assert.equal(Object.hasOwn(format.schema.properties.score, 'maximum'), false);
});

test('invalid or incomplete scoring returns zero only after three retries', async (t) => {
  for (const response of [
    { text: '' },
    { text: '72' },
    { text: '{"score":null}' },
    { text: '{"score":-1}' },
    { text: '{"score":72.5}' },
    { text: '{"score":72,"reason":"extra"}' },
    { text: '{"score":72}', stopReason: 'max_tokens' },
    new Error('Provider unavailable'),
  ]) {
    await t.test(JSON.stringify(response), async (t) => {
      const { payloads, delays, errors } = mockClaudeScoring(t, [response]);
      assert.equal(await scoreWithClaude(), 0);
      assert.equal(payloads.length, 4);
      assert.equal(delays.length, 3);
      assert.match(errors.at(-1)[0], /returning 0 for image regeneration/);
    });
  }
});

test('valid boundary and low scores return immediately for the existing image filter', async (t) => {
  for (const score of [0, 12, 100]) {
    await t.test(`score ${score}`, async (t) => {
      const { payloads, delays } = mockClaudeScoring(t, [{ text: JSON.stringify({ score }) }]);
      assert.equal(await scoreWithClaude(), score);
      assert.equal(payloads.length, 1);
      assert.deepEqual(delays, []);
    });
  }
});

test('vision inference fails immediately for non-retryable authentication errors', async () => {
  let calls = 0;
  const observedDelays = [];

  await assert.rejects(
    runVisionInferenceWithRetry(async () => {
      calls += 1;
      const error = new Error('Unauthorized');
      error.status = 401;
      throw error;
    }, {
      maxRetries: 3,
      sleep: async (delayMs) => observedDelays.push(delayMs),
      logger: silentLogger,
    }),
    (error) => error.status === 401 &&
      error.nonPromptProviderFailure === true &&
      error.preserveExpressImageLayer === true,
  );

  assert.equal(calls, 1);
  assert.deepEqual(observedDelays, []);
});

test('vision inference marks the final exhausted provider error for image recovery', async () => {
  let calls = 0;

  await assert.rejects(
    runVisionInferenceWithRetry(async () => {
      calls += 1;
      const error = new Error('Rate limited');
      error.status = 429;
      throw error;
    }, {
      maxRetries: 3,
      sleep: async () => {},
      logger: silentLogger,
    }),
    (error) => error.status === 429 &&
      error.nonPromptProviderFailure === true &&
      error.preserveExpressImageLayer === true,
  );

  assert.equal(calls, 4);
});
