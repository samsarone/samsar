import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSubtitleAlignmentMapCoverage,
  repairSubtitleAlignmentMapTranslationCoverage,
} from './SubtitleAlignmentMapping.js';

test('translation coverage repair preserves source phrases and re-slices immutable translation', () => {
  const sourceSpeechText = '天气 很 好';
  const translatedSubtitleText = 'The weather is very pleasant today.';
  const mismatchedMap = [
    { sourceText: '天气', translatedText: 'The weather weather' },
    { sourceText: '很', translatedText: 'is' },
    { sourceText: '好', translatedText: 'today.' },
  ];

  const repairedMap = repairSubtitleAlignmentMapTranslationCoverage(
    mismatchedMap,
    sourceSpeechText,
    translatedSubtitleText,
  );

  assert.deepEqual(repairedMap, [
    { sourceText: '天气', translatedText: 'The weather is very' },
    { sourceText: '很', translatedText: 'pleasant' },
    { sourceText: '好', translatedText: 'today.' },
  ]);
  assert.deepEqual(
    repairedMap.map((entry) => entry.sourceText),
    mismatchedMap.map((entry) => entry.sourceText),
  );
  assert.equal(
    getSubtitleAlignmentMapCoverage(
      repairedMap,
      sourceSpeechText,
      translatedSubtitleText,
    ).isComplete,
    true,
  );
});

test('translation coverage repair refuses to rewrite invalid source segmentation', () => {
  const repairedMap = repairSubtitleAlignmentMapTranslationCoverage(
    [{ sourceText: '天气', translatedText: 'The weather is pleasant.' }],
    '天气 很 好',
    'The weather is pleasant.',
  );

  assert.deepEqual(repairedMap, []);
});

test('translation coverage repair leaves an already complete map unchanged', () => {
  const completeMap = [
    { sourceText: 'Hello', translatedText: 'Bonjour' },
    { sourceText: 'world.', translatedText: 'le monde.' },
  ];

  assert.deepEqual(
    repairSubtitleAlignmentMapTranslationCoverage(
      completeMap,
      'Hello world.',
      'Bonjour le monde.',
    ),
    completeMap,
  );
});
