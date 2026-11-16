import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicMusicPrompt, buildMusicRetryMessages } from './MusicPromptFallback.js';

test('retry messages retain the original seed and explicit music instructions separately', () => {
  const theme = { mood: 'somber', music: { instrumentation: ['cello'], tempo: 'slow' } };
  const options = {
    originalPrompt: 'A reunion beside a river. Music should use cello, with no drums.',
    musicInstructions: 'Somber cello, slow tempo; no drums or vocals.',
    originalMusicPrompt: 'Somber cello accompaniment.',
  };
  const snapshot = structuredClone({ theme, options });
  const messages = buildMusicRetryMessages(JSON.stringify(theme), options, 1, 'invalid output');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /smallest useful correction/);
  assert.match(messages[0].content, /Explicit user music instructions take precedence/);
  assert.deepEqual(JSON.parse(messages[1].content), { ...options, theme, retryCount: 1, failureHint: 'invalid output' });
  assert.deepEqual({ theme, options }, snapshot);
});

test('later retry instructions broaden wording without replacing the original context', () => {
  const options = { originalPrompt: 'A quiet family reunion.', musicInstructions: 'Solo piano; no percussion.' };
  const first = buildMusicRetryMessages({ mood: 'reflective' }, options, 1);
  const later = buildMusicRetryMessages({ mood: 'reflective' }, options, 2);
  assert.match(later[0].content, /Rebuild from the original music direction/);
  assert.match(later[0].content, /Preserve the same musical intent/);
  assert.equal(JSON.parse(first[1].content).musicInstructions, JSON.parse(later[1].content).musicInstructions);
});

test('deterministic fallback preserves explicit exclusions instead of conflicting inferred music', () => {
  const prompt = buildDeterministicMusicPrompt({ music: { instruments: 'drums', mood: 'upbeat' } }, {
    musicInstructions: 'Somber cello, slow tempo; no drums or vocals.',
    originalMusicPrompt: 'Upbeat drums and singing.',
  });
  assert.match(prompt, /Somber cello, slow tempo; no drums or vocals\./);
  assert.doesNotMatch(prompt, /upbeat|singing|travel|social video ad/i);
});

test('deterministic fallback extracts musical instructions without copying unrelated story sentences', () => {
  const prompt = buildDeterministicMusicPrompt({}, {
    originalPrompt: 'A dragon lands beside a castle. Music should be dark ambient cello. No drums or vocals.',
  });
  assert.match(prompt, /dark ambient cello/);
  assert.match(prompt, /No drums or vocals/);
  assert.doesNotMatch(prompt, /dragon|castle/);
});

test('deterministic fallback uses a supplied original music prompt when direct requirements are absent', () => {
  const prompt = buildDeterministicMusicPrompt({}, {
    originalPrompt: 'A quiet reunion beside a river.',
    originalMusicPrompt: 'Slow acoustic guitar with soft strings; no percussion.',
  });
  assert.match(prompt, /Slow acoustic guitar with soft strings; no percussion\./);
});

test('musical directions survive without an explicit music prefix', () => {
  const prompt = buildDeterministicMusicPrompt({}, { originalPrompt: 'Slow cello; no percussion; no vocals.' });
  assert.match(prompt, /Slow cello/);
  assert.match(prompt, /no percussion/);
  assert.match(prompt, /no vocals/);
});

test('deterministic fallback retains connected direction clauses', () => {
  const prompt = buildDeterministicMusicPrompt({}, {
    originalPrompt: 'A reunion at a station. Use somber cello; slow and restrained; no percussion.',
  });
  assert.match(prompt, /Use somber cello; slow and restrained; no percussion\./);
  assert.doesNotMatch(prompt, /reunion|station/);
});

test('theme-based fallback preserves available musical anchors and does not invent an ad or genre', () => {
  const prompt = buildDeterministicMusicPrompt(JSON.stringify({
    music: { instrumentation: ['piano', 'cello'], tempo: '70 BPM', exclusions: ['no drums'] },
    mood: 'reflective',
    style: ['minimal', 'acoustic'],
    general: ['gentle pacing'],
    actors: [{ name: 'Mira' }],
  }));
  for (const anchor of ['piano', 'cello', '70 BPM', 'no drums', 'reflective', 'minimal', 'acoustic', 'gentle pacing']) {
    assert.ok(prompt.includes(anchor), anchor);
  }
  assert.doesNotMatch(prompt, /Mira|travel|social video ad|cinematic/i);
});

test('neutral fallback is reserved for absent or malformed musical context', () => {
  for (const value of [undefined, null, 'invalid JSON', [], { actors: [{ name: 'Mira' }] }]) {
    assert.equal(buildDeterministicMusicPrompt(value),
      'Unobtrusive instrumental background music with balanced dynamics; no vocals or lyrics.');
  }
});

test('deterministic fallback does not truncate an explicit negative requirement', () => {
  const instructions = `${'Sparse sustained cello textures with spacious pauses. '.repeat(7)}No drums, no vocals, and no lyrics.`;
  assert.ok(buildDeterministicMusicPrompt({}, { musicInstructions: instructions }).endsWith('No drums, no vocals, and no lyrics.'));
});
