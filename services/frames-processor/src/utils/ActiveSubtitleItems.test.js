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

test('subtitles from separate audio layers remain independently renderable', () => {
  const first = translatedItem({ text: 'FIRST', start: 0, duration: 20 });
  const second = translatedItem({
    text: 'SECOND',
    start: 0,
    duration: 20,
    audioLayerId: 'audio-2',
  });

  assert.deepEqual(selectActiveItemsForFrame([first, second], 5), [first, second]);
});

test('same-language one-frame timing overlap selects only the later cue', () => {
  const first = {
    ...translatedItem({ text: 'FIRST', start: 0, duration: 11 }),
    audioLanguage: 'en',
    subtitleLanguage: 'en',
    subtitleRenderMode: undefined,
    subtitleAlignmentMapped: false,
    words: [{ word: 'FIRST', frameOffset: 0, frameDuration: 12 }],
  };
  const second = {
    ...first,
    text: 'SECOND',
    config: { frameOffset: 11, frameDuration: 11 },
    words: [{ word: 'SECOND', frameOffset: 11, frameDuration: 11 }],
  };

  assert.deepEqual(selectActiveItemsForFrame([first, second], 11), [second]);
});

test('session cue arbitration never suppresses the current caption for a future cue', () => {
  const first = {
    ...translatedItem({ text: 'FIRST', start: 10, duration: 20 }),
    audioLanguage: 'en',
    subtitleLanguage: 'en',
    subtitleRenderMode: undefined,
    subtitleAlignmentMapped: false,
    subtitleCueStartFrameSession: 100,
  };
  const second = {
    ...first,
    text: 'SECOND',
    config: { frameOffset: 0, frameDuration: 30 },
    words: [{ word: 'SECOND', frameOffset: 120, frameDuration: 20 }],
    subtitleCueStartFrameSession: 120,
  };

  assert.deepEqual(
    selectActiveItemsForFrame([first, second], 12, { durationOffsetFrames: 100 }),
    [first],
  );
  assert.deepEqual(
    selectActiveItemsForFrame([first, second], 22, { durationOffsetFrames: 100 }),
    [second],
  );
});

test('translated cue boundaries are half-open before overlap arbitration', () => {
  const first = translatedItem({ text: 'FIRST', start: 0, duration: 10 });
  const second = translatedItem({ text: 'SECOND', start: 10, duration: 10 });

  assert.deepEqual(selectActiveItemsForFrame([first, second], 10), [second]);
});
