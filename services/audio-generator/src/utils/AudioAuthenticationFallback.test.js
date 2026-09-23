import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';

process.env.MONGO_URL ||= 'mongodb://localhost:27017/test-audio-fallback';
const { canFallbackAfterAudioAuthenticationRejection, withAudioAuthenticationFallback } = await import('./AudioAuthenticationFallback.js');
const { resolveDockerSpeechProvider, resolveDockerMusicProvider } = await import('../consts/DockerProviderPriority.js');
const keys = ['CURRENT_ENV', 'SAMSAR_DEPLOYMENT_EDITION', 'SAMSAR_API_KEY', 'FAL_API_KEY', 'SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED', 'SAMSAR_EXTERNAL_AUDIO_ENABLED'];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
beforeEach(() => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { CURRENT_ENV: 'standalone', SAMSAR_API_KEY: 'test-samsar', FAL_API_KEY: 'test-fal' });
});
afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});
const rejected = Object.assign(new Error('Fal key rejected'), { code: 'SAMSAR_FAL_AUDIO_AUTH_REJECTED' });
const payload = { _id: 'audio-1', status: 'INIT', submittedAdapter: 'fal', generationType: 'speech', ttsProvider: 'ELEVENLABS', prompt: 'Unchanged narration' };

test('falls back once after a confirmed rejection and persists the adapter before submitting', async () => {
  const calls = [];
  const result = await withAudioAuthenticationFallback(payload,
    async () => { calls.push('fal'); throw rejected; },
    async (next) => {
      calls.push('samsar');
      assert.equal(next.prompt, payload.prompt);
      assert.equal(next.submittedAdapter, 'samsar');
      assert.equal(resolveDockerSpeechProvider('ELEVENLABS', next), 'samsar');
      assert.equal(resolveDockerMusicProvider('ELEVENLABS_MUSIC', next), 'samsar');
      assert.equal(canFallbackAfterAudioAuthenticationRejection(next, rejected), false);
      return 'accepted';
    }, {
      audioGenerationModel: { async findOneAndUpdate(filter, update) {
        calls.push('persist');
        assert.equal(filter.status, 'INIT');
        assert.equal(filter.submittedAdapter, 'fal');
        assert.deepEqual(filter.apiRequestId, { $in: [null, ''] });
        return { ...payload, ...update.$set };
      } },
      recordUsage: async (entry) => { calls.push('audit'); assert.equal(entry.status, 'failed'); },
    });
  assert.equal(result, 'accepted');
  assert.deepEqual(calls, ['fal', 'persist', 'audit', 'samsar']);
});

test('a stale INIT payload cannot move a submitted or deleted job', async () => {
  await assert.rejects(withAudioAuthenticationFallback(payload,
    async () => { throw rejected; },
    async () => assert.fail('must not submit again'), {
      audioGenerationModel: { async findOneAndUpdate() { return null; } },
      recordUsage: async () => assert.fail('must not record a fallback'),
    }), (error) => error === rejected);
});

test('fallback handles absent or null metadata and retains existing audio instructions', async () => {
  for (const generationMeta of [undefined, null, { instructions: 'Speak softly' }]) {
    const initial = { ...payload, generationMeta };
    await withAudioAuthenticationFallback(initial,
      async () => { throw rejected; },
      async (next) => {
        assert.deepEqual(next.generationMeta, {
          ...generationMeta, audioAuthFallback: { from: 'fal', to: 'samsar', status: 401 },
        });
      }, {
        audioGenerationModel: { async findOneAndUpdate(_filter, update) { return { ...initial, ...update.$set }; } },
        recordUsage: async () => {},
      });
  }
});

test('does not retry or fall back again when the Samsar submission fails', async () => {
  const timeout = Object.assign(new Error('timeout'), { submissionOutcomeUnknown: true });
  let calls = 0;
  await assert.rejects(withAudioAuthenticationFallback(payload,
    async () => { throw rejected; },
    async () => { calls++; throw timeout; }, {
      audioGenerationModel: { async findOneAndUpdate() { return { ...payload, submittedAdapter: 'samsar' }; } },
      recordUsage: async () => {},
    }), (error) => error === timeout);
  assert.equal(calls, 1);
});

test('preserves submitted jobs, uncertain submissions, and hosted external API recursion boundaries', async () => {
  for (const override of [
    { status: 'PENDING' }, { submittedAdapter: 'samsar' },
    { apiRequestId: 'accepted' }, { generationId: 'accepted' }, { genblazeRequestId: 'accepted' },
    { submissionOutcomeUnknown: true }, { externalAudioApiRequest: true },
    { externalAudioRoute: 'text_to_speech' },
    { generationMeta: { externalAudioApiRequest: true } },
    { generationMeta: { externalAudioRoute: 'text_to_music' } },
    { generationMeta: { audioAuthFallback: { from: 'fal', to: 'samsar' } } },
  ]) {
    assert.equal(canFallbackAfterAudioAuthenticationRejection({ ...payload, ...override }, rejected), false, JSON.stringify(override));
  }
  for (const error of [new Error('timeout'), { status: 401 }, { status: 403 }, { status: 503 }, { submissionOutcomeUnknown: true }]) {
    assert.equal(canFallbackAfterAudioAuthenticationRejection(payload, error), false);
  }
});

test('requires an enabled standalone route and a Samsar credential', () => {
  assert.equal(canFallbackAfterAudioAuthenticationRejection(payload, rejected), true);
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'true';
  assert.equal(canFallbackAfterAudioAuthenticationRejection(payload, rejected), false);
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  assert.equal(canFallbackAfterAudioAuthenticationRejection(payload, rejected), true);
  process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED = 'false';
  assert.equal(canFallbackAfterAudioAuthenticationRejection(payload, rejected), false);
  delete process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED;
  process.env.SAMSAR_EXTERNAL_AUDIO_ENABLED = 'false';
  assert.equal(canFallbackAfterAudioAuthenticationRejection(payload, rejected), false);
  delete process.env.SAMSAR_EXTERNAL_AUDIO_ENABLED;
  delete process.env.SAMSAR_API_KEY;
  assert.equal(canFallbackAfterAudioAuthenticationRejection(payload, rejected), false);
});
