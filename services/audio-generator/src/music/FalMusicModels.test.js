import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElevenLabsMusicInput } from './ElevenLabsMusicPayload.js';
import { buildMusicInputPayload } from '../external/SamsarExternalAudioPayloads.js';
import { FAL_LYRIA_MODEL, buildFalElevenLabsMusicRequest, buildFalLyriaMusicInput, resolvePendingFalMusicEndpoint } from './FalMusicModels.js';

test('native, Fal, and external ElevenLabs requests select v2.5 and remain instrumental', () => {
  const payload = { model: 'ELEVENLABS_MUSIC', prompt: 'Ambient score', duration: 94.5, isBackingTrack: true };
  const native = buildElevenLabsMusicInput(payload);
  assert.equal(native.model_id, 'music_v2_5');
  const fal = buildFalElevenLabsMusicRequest(payload);
  assert.equal(fal.endpoint, 'elevenlabs/music/v2.5');
  assert.equal(fal.input.model_id, undefined);
  assert.equal(fal.input.force_instrumental, true);
  assert.equal(fal.input.music_length_ms, 94500);
  assert.equal(buildMusicInputPayload(payload).generationMeta.modelId, 'music_v2_5');
});

test('explicit ElevenLabs overrides are respected across adapters', () => {
  const payload = { model: 'ELEVENLABS_MUSIC', generationMeta: { model_id: 'music_v2' } };
  assert.equal(buildElevenLabsMusicInput(payload).model_id, 'music_v2');
  assert.equal(buildFalElevenLabsMusicRequest(payload).endpoint, 'elevenlabs/music/v2');
  assert.equal(buildMusicInputPayload(payload).generationMeta.modelId, 'music_v2');
  assert.throws(() => buildFalElevenLabsMusicRequest({ generationMeta: { modelId: 'unknown' } }), /Unsupported/);
});

test('Lyria 3.5 uses supported prompt fields for duration and instrumental control', () => {
  const input = buildFalLyriaMusicInput({ prompt: 'Jazz score', duration: 240 });
  assert.deepEqual(Object.keys(input), ['prompt']);
  assert.match(input.prompt, /Jazz score/);
  assert.match(input.prompt, /no vocals/);
  assert.match(input.prompt, /180 seconds/);
  assert.match(buildFalLyriaMusicInput({ duration: -1 }).prompt, /10 seconds/);
});

test('polling preserves old queues while new jobs use their saved endpoints', () => {
  assert.equal(resolvePendingFalMusicEndpoint({ generationMeta: { falMusicEndpoint: 'fal-ai/lyria3/pro' } }, 'lyria'), 'fal-ai/lyria3/pro');
  assert.equal(resolvePendingFalMusicEndpoint({}, 'lyria'), 'fal-ai/lyria2');
  assert.equal(resolvePendingFalMusicEndpoint({}, 'elevenlabs'), 'fal-ai/elevenlabs/music');
  assert.equal(resolvePendingFalMusicEndpoint({ generationMeta: { falMusicEndpoint: FAL_LYRIA_MODEL } }, 'lyria'), 'google/lyria-3.5');
  assert.equal(resolvePendingFalMusicEndpoint({ generationMeta: { falMusicEndpoint: 'elevenlabs/music/v2.5' } }, 'elevenlabs'), 'elevenlabs/music/v2.5');
});
