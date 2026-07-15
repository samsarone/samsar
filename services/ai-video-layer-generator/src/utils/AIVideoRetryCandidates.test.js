import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeterministicRetryVideoPrompt,
  getRetryStartImageDescription,
  normalizeImageCandidateSource,
  normalizeNullableScore,
  prepareRankedFallbackImage,
  selectRankedFallbackImage,
} from './AIVideoRetryCandidates.js';

test('retry selection excludes the active image and advances through unique scores', () => {
  const candidates = [
    { src: 'generations/current.png', score: 99, description: 'current' },
    { src: 'assets/generations/second.png', score: 80, description: 'second' },
    { src: '/generations/third.png', score: 60, description: 'third' },
    { src: 'https://cdn.example.com/generations/second.png?sig=1', score: 40, description: 'duplicate' },
  ];
  const options = { excludeSources: ['/generations/current.png'] };

  assert.deepEqual(selectRankedFallbackImage(candidates, 0, options).pass, {
    src: 'assets/generations/second.png', score: 80, description: 'second', rank: 1,
  });
  assert.deepEqual(selectRankedFallbackImage(candidates, 1, options).pass, {
    src: '/generations/third.png', score: 60, description: 'third', rank: 2,
  });
  assert.equal(selectRankedFallbackImage(candidates, 2, options), null);
});

test('candidate source normalization ignores host, assets prefix, and query signature', () => {
  assert.equal(
    normalizeImageCandidateSource('https://cdn.example.com/assets_v2/generations/a.png?Expires=1'),
    'generations/a.png',
  );
  assert.equal(normalizeImageCandidateSource('/assets/generations/a.png'), 'generations/a.png');
});

test('candidate scores preserve missing values and numeric zero', () => {
  assert.equal(normalizeNullableScore(null), null);
  assert.equal(normalizeNullableScore(''), null);
  assert.equal(normalizeNullableScore(0), 0);
});

test('fallback with no description never inherits the active image description', () => {
  assert.equal(getRetryStartImageDescription({
    src: 'generations/fallback.png',
    description: '',
  }, {
    imageSession: { activeImageDescription: 'Description for the original image' },
  }), '');
});

test('fallback preparation skips an unusable highest candidate and never reuses it', async () => {
  const candidates = [
    { src: 'generations/missing.png', score: 90, description: 'missing' },
    { src: 'generations/usable.png', score: 80, description: 'usable' },
  ];
  const prepared = await prepareRankedFallbackImage({
    candidates,
    prepareImage: async (candidate) => {
      if (candidate.src.includes('missing')) throw new Error('missing file');
      return 'https://cdn.example.com/usable.png';
    },
  });

  assert.equal(prepared.selection.pass.src, 'generations/usable.png');
  assert.equal(prepared.selection.pass.rank, 1);
  assert.deepEqual(prepared.attemptedSources, [
    'generations/missing.png',
    'generations/usable.png',
  ]);

  const exhausted = await prepareRankedFallbackImage({
    candidates,
    excludeSources: prepared.attemptedSources,
    prepareImage: async () => 'should-not-run',
  });
  assert.equal(exhausted.selection, null);
  assert.deepEqual(exhausted.attemptedSources, []);
});

test('deterministic retry prompt pairs the fallback description with the scene seed', () => {
  const prompt = buildDeterministicRetryVideoPrompt({
    sceneAction: 'The presenter points at the chart',
    startImageDescription: 'A presenter stands beside a blue bar chart',
    cameraTransition: 'Slow push in',
  });
  assert.match(prompt, /presenter points at the chart/);
  assert.match(prompt, /presenter stands beside a blue bar chart/);
  assert.match(prompt, /Slow push in/);
});
