import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extendSessionTimelineToCustomSpeechEnd,
  extendSessionTimelineToEndTime,
  isCustomSpeechAudioLayer,
} from './SessionTimelineExtension.js';

test('custom speech can extend the last video layer to the audio end', () => {
  const session = {
    layers: [
      { _id: 'layer-a', duration: 3, durationOffset: 0 },
      { _id: 'layer-b', duration: 2, durationOffset: 3 },
    ],
    audioLayers: [],
    global_audio_layers: [
      {
        generationType: 'recorded_speech',
        isEnabled: true,
        startTime: 1,
        duration: 7,
        endTime: 8,
      },
    ],
  };

  const result = extendSessionTimelineToCustomSpeechEnd(session);

  assert.equal(result.extended, true);
  assert.equal(result.currentEndTime, 5);
  assert.equal(result.targetEndTime, 8);
  assert.equal(session.layers[1].duration, 5);
  assert.equal(session.layers[1].frameGenerationPending, true);
  assert.equal(session.frameGenerationPending, true);
  assert.equal(session.totalDuration, 8);
});

test('non-custom audio does not extend the video session', () => {
  const session = {
    layers: [
      { _id: 'layer-a', duration: 5, durationOffset: 0 },
    ],
    audioLayers: [
      {
        generationType: 'music',
        isEnabled: true,
        startTime: 0,
        duration: 8,
        endTime: 8,
      },
    ],
  };

  const result = extendSessionTimelineToCustomSpeechEnd(session);

  assert.equal(result.extended, false);
  assert.equal(session.layers[0].duration, 5);
  assert.equal(session.frameGenerationPending, undefined);
});

test('timeline extension is a no-op when there are no video layers to extend', () => {
  const session = {
    layers: [],
    audioLayers: [],
  };

  const result = extendSessionTimelineToEndTime(session, 12);

  assert.equal(result.extended, false);
  assert.equal(result.currentEndTime, 0);
  assert.equal(result.targetEndTime, 12);
});

test('custom speech detection includes recorded and custom speech metadata', () => {
  assert.equal(isCustomSpeechAudioLayer({ generationType: 'recorded_speech' }), true);
  assert.equal(isCustomSpeechAudioLayer({ generationType: 'custom speech' }), true);
  assert.equal(isCustomSpeechAudioLayer({ generationMeta: { uploadType: 'recorded_speech' } }), true);
  assert.equal(isCustomSpeechAudioLayer({ generationType: 'speech' }), false);
});
