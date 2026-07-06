import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBackingTrackGenerationMeta,
  resolveBackingTrackTargetDurationSeconds,
} from './BackingTrackDuration.js';

test('resolves backing track duration from full timeline including outro layer', () => {
  const targetDuration = resolveBackingTrackTargetDurationSeconds({
    requestedDuration: 60,
    requestedStartTime: 0,
    requestedEndTime: 60,
    sessionData: {
      layers: [
        { duration: 30, durationOffset: 0 },
        { duration: 30, durationOffset: 30 },
        { duration: 8, durationOffset: 60, isGeneratedOutroLayer: true },
      ],
      audioLayers: [
        { _id: 'music-layer', duration: 60, endTime: 60 },
      ],
    },
    audioLayerId: 'music-layer',
  });

  assert.equal(targetDuration, 68);
});

test('marks backing generation metadata as full-timeline duration including outro', () => {
  const generationMeta = buildBackingTrackGenerationMeta({ musicLengthMs: 60000 }, 68);

  assert.deepEqual(generationMeta, {
    musicLengthMs: 60000,
    isBackingTrack: true,
    targetDurationSeconds: 68,
    fullTimelineDurationSeconds: 68,
    durationIncludesOutro: true,
  });
});
