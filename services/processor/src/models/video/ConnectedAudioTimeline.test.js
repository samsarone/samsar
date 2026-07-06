import test from 'node:test';
import assert from 'node:assert/strict';

import {
  annotateVideoEditSegmentsWithOutputTimeline,
  buildAudioEditSegmentsForConnectedAudio,
  mapConnectedAudioWindowThroughEdgeTrim,
  mapConnectedAudioWindowThroughVideoEditSegments,
  recalculateLayerOffsetsAndConnectedAudio,
} from './ConnectedAudioTimeline.js';

test('edge trim before connected audio starts shifts the audio window without trimming it', () => {
  const result = mapConnectedAudioWindowThroughEdgeTrim({
    relativeStart: 2,
    duration: 2,
    sourceTrimStartTime: 0.25,
    previousLayerDuration: 8,
    trimStartSeconds: 1,
    trimEndSeconds: 0,
  });

  assert.deepEqual(result, {
    relativeStart: 1,
    duration: 2,
    sourceTrimStartTime: 0.25,
  });
});

test('edge trim only shortens connected audio when the trim overlaps the audio window', () => {
  const result = mapConnectedAudioWindowThroughEdgeTrim({
    relativeStart: 1,
    duration: 4,
    sourceTrimStartTime: 0.5,
    previousLayerDuration: 8,
    trimStartSeconds: 3,
    trimEndSeconds: 0,
  });

  assert.deepEqual(result, {
    relativeStart: 0,
    duration: 2,
    sourceTrimStartTime: 2.5,
  });
});

test('recalculateLayerOffsetsAndConnectedAudio preserves connected audio relative windows when scene offsets move', () => {
  const layers = [
    { _id: 'layer-a', duration: 3, durationOffset: 0 },
    { _id: 'layer-b', duration: 4, durationOffset: 5 },
  ];
  const audioLayers = [
    {
      connectedLayerId: 'layer-b',
      connectedLayerIndex: 1,
      connectedLayerStartTimeOffset: 5,
      startTime: 6,
      endTime: 8,
      duration: 2,
      sourceTrimStartTime: 0.25,
    },
  ];

  const totalDuration = recalculateLayerOffsetsAndConnectedAudio(layers, audioLayers);

  assert.equal(totalDuration, 7);
  assert.equal(layers[1].durationOffset, 3);
  assert.equal(audioLayers[0].connectedLayerStartTimeOffset, 3);
  assert.equal(audioLayers[0].startTime, 4);
  assert.equal(audioLayers[0].endTime, 6);
  assert.equal(audioLayers[0].duration, 2);
  assert.equal(audioLayers[0].sourceTrimStartTime, 0.25);
});

test('recalculateLayerOffsetsAndConnectedAudio repairs stale default connected layer start offsets', () => {
  const layers = [
    { _id: 'layer-a', duration: 3, durationOffset: 0 },
    { _id: 'layer-b', duration: 4, durationOffset: 5 },
  ];
  const audioLayers = [
    {
      connectedLayerId: 'layer-b',
      connectedLayerIndex: 1,
      connectedLayerStartTimeOffset: 0,
      startTime: 5,
      endTime: 7,
      duration: 2,
      sourceTrimStartTime: 0.5,
    },
  ];

  const totalDuration = recalculateLayerOffsetsAndConnectedAudio(layers, audioLayers);

  assert.equal(totalDuration, 7);
  assert.equal(layers[1].durationOffset, 3);
  assert.equal(audioLayers[0].connectedLayerStartTimeOffset, 3);
  assert.equal(audioLayers[0].startTime, 3);
  assert.equal(audioLayers[0].endTime, 5);
  assert.equal(audioLayers[0].duration, 2);
  assert.equal(audioLayers[0].sourceTrimStartTime, 0.5);
});

test('recalculateLayerOffsetsAndConnectedAudio clamps overlong connected audio that starts at the layer', () => {
  const layers = [
    { _id: 'layer-a', duration: 63.31, durationOffset: 0 },
    { _id: 'layer-b', duration: 4.87, durationOffset: 63.31 },
    { _id: 'layer-c', duration: 4.87, durationOffset: 68.18 },
  ];
  const audioLayers = [
    {
      connectedLayerId: 'layer-b',
      connectedLayerIndex: 1,
      connectedLayerStartTimeOffset: 0,
      startTime: 63.31,
      endTime: 68.31,
      duration: 5,
      sourceTrimStartTime: 0,
    },
  ];

  recalculateLayerOffsetsAndConnectedAudio(layers, audioLayers);

  assert.equal(audioLayers[0].connectedLayerStartTimeOffset, 63.31);
  assert.equal(audioLayers[0].startTime, 63.31);
  assert.equal(audioLayers[0].endTime, 68.18);
  assert.equal(audioLayers[0].duration, 4.87);
});

test('recalculateLayerOffsetsAndConnectedAudio prefers the previous layer offset when stale zero offset still fits', () => {
  const layers = [
    { _id: 'layer-a', duration: 1, durationOffset: 0 },
    { _id: 'layer-b', duration: 8, durationOffset: 2 },
  ];
  const audioLayers = [
    {
      connectedLayerId: 'layer-b',
      connectedLayerIndex: 1,
      connectedLayerStartTimeOffset: 0,
      startTime: 2,
      endTime: 4,
      duration: 2,
    },
  ];

  recalculateLayerOffsetsAndConnectedAudio(layers, audioLayers);

  assert.equal(layers[1].durationOffset, 1);
  assert.equal(audioLayers[0].connectedLayerStartTimeOffset, 1);
  assert.equal(audioLayers[0].startTime, 1);
  assert.equal(audioLayers[0].endTime, 3);
  assert.equal(audioLayers[0].duration, 2);
});

test('recalculateLayerOffsetsAndConnectedAudio reattaches index-only audio layers', () => {
  const layers = [
    { _id: 'layer-a', duration: 3, durationOffset: 0 },
    { _id: 'layer-b', duration: 4, durationOffset: 5 },
  ];
  const audioLayers = [
    {
      connectedLayerIndex: 1,
      startTime: 6,
      endTime: 8,
      duration: 2,
    },
  ];

  recalculateLayerOffsetsAndConnectedAudio(layers, audioLayers);

  assert.equal(audioLayers[0].connectedLayerId, 'layer-b');
  assert.equal(audioLayers[0].connectedLayerIndex, 1);
  assert.equal(audioLayers[0].connectedLayerStartTimeOffset, 3);
  assert.equal(audioLayers[0].startTime, 4);
  assert.equal(audioLayers[0].endTime, 6);
});

test('video speed edits remap connected audio onto the edited output timeline', () => {
  const segments = annotateVideoEditSegmentsWithOutputTimeline([
    { visibleStart: 0, visibleEnd: 2, speedMultiplier: 1 },
    { visibleStart: 2, visibleEnd: 6, speedMultiplier: 2 },
    { visibleStart: 6, visibleEnd: 8, speedMultiplier: 1 },
  ]);

  const result = mapConnectedAudioWindowThroughVideoEditSegments({
    relativeStart: 1,
    duration: 6,
    segments,
  });

  assert.deepEqual(result, {
    relativeStart: 1,
    duration: 4,
  });
});

test('audio edit segments preserve connected audio source trim and window mapping', () => {
  const result = buildAudioEditSegmentsForConnectedAudio({
    relativeStart: 2,
    duration: 4,
    sourceTrimStartTime: 10,
    segments: [
      { visibleStart: 0, visibleEnd: 3, speedMultiplier: 1 },
      { visibleStart: 4, visibleEnd: 6, speedMultiplier: 2 },
    ],
  });

  assert.deepEqual(result, [
    {
      sourceStart: 10,
      sourceEnd: 11,
      speedMultiplier: 1,
    },
    {
      sourceStart: 12,
      sourceEnd: 14,
      speedMultiplier: 2,
    },
  ]);
});
