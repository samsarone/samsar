import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildQwenChatRequest,
  getAlibabaQwenApiKey,
  getAlibabaQwenBaseURL,
} from '../src/Qwen.js';
import {
  DOCKER_INFERENCE_PROVIDER,
  resolveConfiguredInferenceProvider,
  shouldUseSamsarExternalInference,
} from '../src/SamsarExternalInferenceAdapter.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_API_KEY',
  'ALIBABA_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_API_KEY',
  'QWEN_API_KEY',
  'OPENROUTER_API_KEY',
  'SAMSAR_GENBLAZE_ENABLED',
  'SAMSAR_GENBLAZE_BASE_URL',
  'SAMSAR_GENBLAZE_MODEL_CATALOG_PATH',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearEnv() {
  ENV_KEYS.forEach((key) => delete process.env[key]);
}

function restoreEnv() {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
}

test.afterEach(restoreEnv);

test('uses Qwen 3.7 Plus for text assistant history and normalizes Responses content', () => {
  const { payload } = buildQwenChatRequest({
    model: 'QWEN3.7',
    messages: [
      { role: 'developer', content: 'Be concise.' },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Prior reply.' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Continue.' }] },
    ],
  });

  assert.equal(payload.model, 'qwen3.7-plus');
  assert.equal(payload.enable_thinking, true);
  assert.equal(payload.messages[0].role, 'system');
  assert.deepEqual(payload.messages[1].content[0], { type: 'text', text: 'Prior reply.' });
});

test('uses the Docker Alibaba text-model constant for Token Plan inference', () => {
  const text = buildQwenChatRequest({
    messages: [{ role: 'user', content: 'Continue.' }],
  }, { ALIBABA_QWEN_TEXT_MODEL: 'qwen3.8-max-preview' });
  assert.equal(text.payload.model, 'qwen3.8-max-preview');
});

test('builds the OpenAI-compatible endpoint from ALIBABA_API_HOST', () => {
  assert.equal(
    getAlibabaQwenBaseURL({
      ALIBABA_API_HOST: 'ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com',
    }),
    'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaQwenBaseURL({
      ALIBABA_API_HOST: 'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/',
    }),
    'https://ws-sj16tbvm14xuk9x1.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaQwenBaseURL({ ALIBABA_API_HOST: 'workspace.example.com/compatible-mode' }),
    'https://workspace.example.com/compatible-mode/v1',
  );
  assert.equal(
    getAlibabaQwenBaseURL({
      ALIBABA_CLOUD_BASE_URL: 'https://custom.example.com/v1/',
      ALIBABA_API_HOST: 'ignored.example.com',
    }),
    'https://custom.example.com/v1',
  );
});

test('uses Qwen 3.7 Plus for a nonempty assistant frame image', () => {
  const vision = buildQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Describe the frame.' },
        { type: 'input_image', image_url: 'data:image/png;base64,abc' },
      ],
    }],
  });
  const emptyImage = buildQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: [{ type: 'input_image', image_url: '' }] }],
  });

  assert.equal(vision.payload.model, 'qwen3.7-plus');
  assert.equal(emptyImage.payload.model, 'qwen3.7-plus');
  assert.deepEqual(vision.payload.messages[0].content[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,abc' },
  });
});

test('expands every array-valued Qwen image and video reference into its own provider part', () => {
  const { payload } = buildQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'input_image',
          sources: [
            'https://media.example/one.png',
            { uri: 'https://media.example/two.png' },
          ],
        },
        {
          type: 'input_video',
          urls: [
            'https://media.example/one.mp4',
            { url: 'https://media.example/two.mp4', detail: 'high' },
          ],
        },
        {
          type: 'input_image',
          src: 'https://media.example/three.png',
        },
        {
          type: 'input_video',
          href: 'https://media.example/three.mp4',
        },
      ],
    }],
  });

  assert.equal(payload.model, 'qwen3.7-plus');
  assert.deepEqual(payload.messages[0].content, [
    { type: 'image_url', image_url: { url: 'https://media.example/one.png' } },
    { type: 'image_url', image_url: { url: 'https://media.example/two.png' } },
    { type: 'video_url', video_url: { url: 'https://media.example/one.mp4' } },
    { type: 'video_url', video_url: { url: 'https://media.example/two.mp4' } },
    { type: 'image_url', image_url: { url: 'https://media.example/three.png' } },
    { type: 'video_url', video_url: { url: 'https://media.example/three.mp4' } },
  ]);
});

test('converts JSON Schema output to Qwen JSON mode while retaining the schema instruction', () => {
  const { payload } = buildQwenChatRequest({
    model: 'QWEN3.7',
    messages: [{ role: 'user', content: 'Return the narrative as JSON.' }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'narrative',
        schema: {
          type: 'object',
          properties: { narrative: { type: 'string' } },
          required: ['narrative'],
        },
      },
    },
  });

  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.match(payload.messages[0].content, /JSON Schema/);
  assert.match(payload.messages[0].content, /"narrative"/);
});

test('uses native Alibaba credentials first and Samsar fallback when they are absent', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  assert.equal(shouldUseSamsarExternalInference({ model: 'QWEN3.7' }), true);
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

  process.env.ALIBABA_API_KEY = 'alibaba-test-key';
  assert.equal(getAlibabaQwenApiKey(), 'alibaba-test-key');
  assert.equal(shouldUseSamsarExternalInference({
    model: 'QWEN3.7',
    authorization: 'native',
  }), false);
});

test('uses Samsar and GMICloud before OpenRouter after native Alibaba in Docker', (t) => {
  clearEnv();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-qwen-genblaze-'));
  const catalogPath = path.join(directory, 'genblaze-model-catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({
    version: 1,
    provider: 'gmicloud',
    models: {
      'QWEN3.7': {
        text: { modelId: 'Qwen/Qwen3.7-Max', operation: 'chat.completions' },
      },
    },
  }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  process.env.CURRENT_ENV = 'docker';
  process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.SAMSAR);

  delete process.env.SAMSAR_API_KEY;
  process.env.SAMSAR_GENBLAZE_ENABLED = 'true';
  process.env.SAMSAR_GENBLAZE_BASE_URL = 'http://genblaze:8080/v1';
  process.env.SAMSAR_GENBLAZE_MODEL_CATALOG_PATH = catalogPath;
  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.GMICLOUD);

  process.env.ALIBABA_API_KEY = 'alibaba-test-key';
  assert.equal(resolveConfiguredInferenceProvider('QWEN3.7'), DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD);
});
