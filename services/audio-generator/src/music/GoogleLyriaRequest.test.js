import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
const { buildGoogleLyriaRequest, requestGoogleLyria3Audio } = await import('./GoogleLyriaNativeGenerator.js');

test('Gemini 3.5 uses Interactions with API-key auth and parses returned audio', async () => {
  let calls = 0;
  const result = await requestGoogleLyria3Audio({ prompt: 'Ambient score', duration: 75, isBackingTrack: true }, {
    env: { GEMINI_API_KEY: 'test-key' },
    getConfig: () => { throw new Error('Gemini must not need Cloud credentials'); },
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
      assert.equal(options.headers['x-goog-api-key'], 'test-key');
      assert.equal(options.headers.Authorization, undefined);
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'lyria-3.5');
      assert.equal(body.contents, undefined);
      assert.equal(body.response_modalities, undefined);
      assert.match(body.input[0].text, /Instrumental backing track only/);
      assert.match(body.input[0].text, /Target duration: 75 seconds/);
      return { ok: true, text: async () => JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/mpeg', data: 'bXAz' }] }] }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.model, 'lyria-3.5');
  assert.equal(result.data, 'bXAz');
});

test('Vertex keeps Cloud authentication and generateContent request format', async () => {
  const request = await buildGoogleLyriaRequest({ prompt: 'Jazz' }, {
    env: { GOOGLE_LYRIA_API_PROVIDER: 'vertex' }, getConfig: () => ({ projectId: 'test-project' }), getToken: async () => 'test-token',
  });
  assert.match(request.url, /publishers\/google\/models\/lyria-3-pro-preview:generateContent$/);
  assert.equal(request.headers.Authorization, 'Bearer test-token');
  assert.equal(request.headers['x-goog-api-key'], undefined);
  assert.deepEqual(request.body.generationConfig.responseModalities, ['AUDIO', 'TEXT']);
});

test('missing Gemini credentials fail before any provider submission', async () => {
  await assert.rejects(buildGoogleLyriaRequest({}, { env: { GOOGLE_LYRIA_API_PROVIDER: 'gemini' } }), /requires .*GEMINI_API_KEY/);
});

test('provider errors surface without resubmitting to another model', async () => {
  let calls = 0;
  await assert.rejects(requestGoogleLyria3Audio({}, {
    env: { GEMINI_API_KEY: 'test' },
    fetch: async () => { calls++; return { ok: false, status: 403, text: async () => JSON.stringify({ error: { message: 'Model access denied' } }) }; },
  }), /Model access denied/);
  assert.equal(calls, 1);
});
