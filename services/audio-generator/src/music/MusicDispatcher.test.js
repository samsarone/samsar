import assert from 'node:assert/strict';
import test from 'node:test';

process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
process.env.CURRENT_ENV = 'docker';
process.env.FAL_API_KEY = 'fal-test-key';
process.env.ELEVENLABS_API_KEY = 'elevenlabs-test-key';
delete process.env.SAMSAR_FORCE_EXTERNAL_AUDIO;
delete process.env.SAMSAR_DOCKER_AUDIO_PROVIDER_ROUTING_ENABLED;

const { resolveMusicProvider } = await import('./MusicProviderResolver.js');

test('keeps Docker ELEVENLABS_MUSIC routing ElevenLabs-first for external installs', () => {
  assert.equal(
    resolveMusicProvider({
      model: 'ELEVENLABS_MUSIC',
      status: 'INIT',
    }),
    'elevenlabs'
  );
});

test('routes internal Samsar external audio ELEVENLABS_MUSIC requests to Fal', () => {
  assert.equal(
    resolveMusicProvider({
      model: 'ELEVENLABS_MUSIC',
      status: 'INIT',
      generationMeta: {
        externalAudioApiRequest: true,
        externalAudioRoute: 'text_to_music',
      },
    }),
    'fal'
  );
});
