import assert from 'node:assert/strict';
import test from 'node:test';
import { SamsarClient } from 'samsar-js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_EDITION',
  'SAMSAR_RUNTIME',
  'OPENAI_API_KEY',
  'SAMSAR_API_KEY',
  'SAMSAR_DEPLOYED_API_KEY',
  'SAMSAR_EXTERNAL_API_KEY',
  'SAMSAR_EXTERNAL_EMBEDDINGS_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_EMBEDDINGS',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const {
  createSamsarExternalEmbeddings,
  shouldUseSamsarExternalEmbeddings,
} = await import('./SamsarExternalEmbeddingAdapter.js');

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

test('Docker uses deployed embeddings only when the local OpenAI key is absent', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  assert.equal(shouldUseSamsarExternalEmbeddings(), true);

  process.env.OPENAI_API_KEY = 'local-openai-key';
  assert.equal(shouldUseSamsarExternalEmbeddings(), false);
});

test('production Docker does not enable standalone embedding forwarding implicitly', () => {
  clearEnv();
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  assert.equal(shouldUseSamsarExternalEmbeddings(), false);

  process.env.SAMSAR_EXTERNAL_EMBEDDINGS_ENABLED = 'true';
  assert.equal(shouldUseSamsarExternalEmbeddings(), true);
});

test('deployed embedding response is unwrapped into ordered vectors', async (t) => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-test-key';
  const first = new Array(1536).fill(0.1);
  const second = new Array(1536).fill(0.2);
  t.mock.method(SamsarClient.prototype, 'postV2', async (path, payload) => {
    assert.equal(path, 'external/embeddings');
    assert.deepEqual(payload.input, ['first', 'second']);
    return {
      data: {
        data: [
          { index: 1, embedding: second },
          { index: 0, embedding: first },
        ],
      },
    };
  });

  const vectors = await createSamsarExternalEmbeddings(['first', 'second']);
  assert.equal(vectors.length, 2);
  assert.equal(vectors[0][0], 0.1);
  assert.equal(vectors[1][0], 0.2);
});
