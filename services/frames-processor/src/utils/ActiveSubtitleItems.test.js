import test from 'node:test';
import assert from 'node:assert/strict';

import { selectActiveItemsForFrame } from './ActiveSubtitleItems.js';

function translatedItem({ text, start, duration, audioLayerId = 'audio-1' }) {
  return {
    type: 'text',
    subType: 'subtitle',
    text,
    audioLayerId,
    audioLanguage: 'zh',
    subtitleLanguage: 'en',
    subtitleRenderMode: 'mapped',
    subtitleAlignmentMapped: true,
    config: { frameOffset: start, frameDuration: duration },
    words: [{ word: text, frameOffset: start, frameDuration: duration }],
  };
}

test('overlapping translated cues from one audio layer render only the latest cue', () => {
  const first = translatedItem({ text: 'FIRST', start: 0, duration: 20 });
  const second = translatedItem({ text: 'SECOND', start: 10, duration: 20 });

  assert.deepEqual(selectActiveItemsForFrame([first, second], 12), [second]);
});

test('translated cues from separate audio layers remain independently renderable', () => {
  const first = translatedItem({ text: 'FIRST', start: 0, duration: 20 });
  const second = translatedItem({
    text: 'SECOND',
    start: 0,
    duration: 20,
    audioLayerId: 'audio-2',
  });

  assert.deepEqual(selectActiveItemsForFrame([first, second], 5), [first, second]);
});

test('same-language subtitles retain the existing independent render behavior', () => {
  const first = {
    ...translatedItem({ text: 'FIRST', start: 0, duration: 20 }),
    audioLanguage: 'en',
    subtitleLanguage: 'en',
    subtitleRenderMode: undefined,
    subtitleAlignmentMapped: false,
  };
  const second = {
    ...first,
    text: 'SECOND',
    words: [{ word: 'SECOND', frameOffset: 0, frameDuration: 20 }],
  };

  assert.deepEqual(selectActiveItemsForFrame([first, second], 5), [first, second]);
});

test('translated cue boundaries are half-open before overlap arbitration', () => {
  const first = translatedItem({ text: 'FIRST', start: 0, duration: 10 });
  const second = translatedItem({ text: 'SECOND', start: 10, duration: 10 });

  assert.deepEqual(selectActiveItemsForFrame([first, second], 10), [second]);
});

