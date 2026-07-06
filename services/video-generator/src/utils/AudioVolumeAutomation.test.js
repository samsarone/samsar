import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAudioVolumeExpression,
  buildLayerEdgeDuckingAutomationPoints,
  buildResolvedAudioVolumeAutomationPoints,
  hasManualAudioVolumeAutomation,
} from './AudioVolumeAutomation.js';

test('buildResolvedAudioVolumeAutomationPoints preserves start/end and inner points', () => {
  const points = buildResolvedAudioVolumeAutomationPoints(
    {
      volume: 100,
      startVolume: 100,
      endVolume: 100,
      timestampedVolumes: [
        { id: 'duck', time: 2.5, volume: 24 },
      ],
    },
    {
      duration: 5,
      mapVolume: (value) => value / 100,
    },
  );

  assert.deepEqual(points, [
    { id: 'start', time: 0, volume: 100, kind: 'start', fixed: true, gain: 1 },
    { id: 'duck', time: 2.5, volume: 24, kind: 'point', fixed: false, gain: 0.24 },
    { id: 'end', time: 5, volume: 100, kind: 'end', fixed: true, gain: 1 },
  ]);
});

test('buildAudioVolumeExpression creates a piecewise linear ffmpeg expression', () => {
  const expression = buildAudioVolumeExpression([
    { time: 0, gain: 1 },
    { time: 2.5, gain: 0.24 },
    { time: 5, gain: 1 },
  ]);

  assert.equal(
    expression,
    'if(lt(t,2.5),1+((-0.76)*((t-0)/2.5)),if(lt(t,5),0.24+((0.76)*((t-2.5)/2.5)),1))',
  );
});

test('buildAudioVolumeExpression preserves same-time point order for step changes', () => {
  const expression = buildAudioVolumeExpression([
    { time: 0, gain: 1 },
    { time: 2, gain: 1 },
    { time: 2, gain: 0.2 },
    { time: 4, gain: 0.2 },
    { time: 4, gain: 1 },
  ]);

  assert.equal(
    expression,
    'if(lt(t,2),1+((0)*((t-0)/2)),if(lt(t,2),1,if(lt(t,4),0.2+((0)*((t-2)/2)),if(lt(t,4),0.2,1))))',
  );
});

test('hasManualAudioVolumeAutomation only activates when the manual flag is enabled', () => {
  assert.equal(
    hasManualAudioVolumeAutomation({
      manualVolumeAdjustmentEnabled: false,
      volume: 100,
      duration: 4,
      timestampedVolumes: [{ time: 2, volume: 35 }],
    }, 4),
    false,
  );

  assert.equal(
    hasManualAudioVolumeAutomation({
      manualVolumeAdjustmentEnabled: true,
      volume: 100,
      duration: 4,
      timestampedVolumes: [{ time: 2, volume: 35 }],
    }, 4),
    true,
  );
});

test('buildLayerEdgeDuckingAutomationPoints creates smooth layer-local edge ramps', () => {
  const points = buildLayerEdgeDuckingAutomationPoints({
    duration: 10,
    fadeRatio: 0.05,
  });

  assert.deepEqual(points, [
    { time: 0, gain: 0 },
    { time: 0.1, gain: 0.104 },
    { time: 0.2, gain: 0.352 },
    { time: 0.3, gain: 0.648 },
    { time: 0.4, gain: 0.896 },
    { time: 0.5, gain: 1 },
    { time: 9.5, gain: 1 },
    { time: 9.6, gain: 0.896 },
    { time: 9.7, gain: 0.648 },
    { time: 9.8, gain: 0.352 },
    { time: 9.9, gain: 0.104 },
    { time: 10, gain: 0 },
  ]);
});
