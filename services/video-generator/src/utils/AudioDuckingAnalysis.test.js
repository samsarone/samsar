import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildForegroundDuckKeyAutomationPoints,
  buildMusicDuckingAutomationFromActivity,
  buildStudioAudioDuckingPlan,
  boostForegroundActivitySamplesForDucking,
  buildWindowAnchoredForegroundActivitySamples,
  buildDuckingWindowsFromSilenceAnalysis,
  buildDuckingWindowsFromRmsAnalysis,
  buildSpeechAwareDuckingEnvelopeWindows,
  clipDuckingWindowsToTimeRange,
  deriveForegroundDuckKeyGain,
  isStudioForegroundDuckingTrack,
  normalizeDuckingWindowsForExpression,
  parseAstatsRmsMetadataOutput,
  parseSilenceDetectOutput,
} from './AudioDuckingAnalysis.js';

test('parseSilenceDetectOutput captures silence ranges and trailing silence', () => {
  const parsed = parseSilenceDetectOutput(`
[silencedetect @ 0x0] silence_start: 0
[silencedetect @ 0x0] silence_end: 0.42 | silence_duration: 0.42
[silencedetect @ 0x0] silence_start: 1.1
[silencedetect @ 0x0] silence_end: 1.6 | silence_duration: 0.5
[silencedetect @ 0x0] silence_start: 4.2
  `);

  assert.deepEqual(parsed, {
    silenceIntervals: [
      { start: 0, end: 0.42 },
      { start: 1.1, end: 1.6 },
    ],
    trailingSilenceStart: 4.2,
  });
});

test('buildDuckingWindowsFromSilenceAnalysis creates merged timeline windows around active speech', () => {
  const duckingWindows = buildDuckingWindowsFromSilenceAnalysis({
    durationSeconds: 5,
    silenceIntervals: [
      { start: 0, end: 0.4 },
      { start: 1.2, end: 1.5 },
      { start: 3.4, end: 3.55 },
    ],
    trailingSilenceStart: 4.6,
    timelineStartTime: 10,
    preRollSeconds: 0.05,
    postRollSeconds: 0.1,
    mergeGapSeconds: 0.08,
    minimumWindowSeconds: 0.1,
    fadeDurationSeconds: 0.2,
  });

  assert.deepEqual(duckingWindows, [
    { start: 10.35, end: 11.3, fadeDuration: 0.2 },
    { start: 11.45, end: 14.7, fadeDuration: 0.2 },
  ]);
});

test('parseAstatsRmsMetadataOutput captures fixed-window RMS samples', () => {
  const rmsSamples = parseAstatsRmsMetadataOutput(`
frame:0    pts:0       pts_time:0
lavfi.astats.Overall.RMS_level=-55.4
frame:1    pts:800     pts_time:0.05
lavfi.astats.Overall.RMS_level=-27.2
frame:2    pts:1600    pts_time:0.1
lavfi.astats.Overall.RMS_level=-26.8
  `);

  assert.deepEqual(rmsSamples, [
    { time: 0, rmsLevelDb: -55.4 },
    { time: 0.05, rmsLevelDb: -27.2 },
    { time: 0.1, rmsLevelDb: -26.8 },
  ]);
});

test('buildDuckingWindowsFromRmsAnalysis creates granular windows from RMS activity slices', () => {
  const duckingWindows = buildDuckingWindowsFromRmsAnalysis({
    durationSeconds: 1,
    sampleDurationSeconds: 0.05,
    timelineStartTime: 20,
    preRollSeconds: 0.05,
    postRollSeconds: 0.1,
    mergeGapSeconds: 0.08,
    minimumWindowSeconds: 0.1,
    fadeDurationSeconds: 0.18,
    profile: {
      activeFloorPercentile: 0.1,
      activeCeilingPercentile: 0.9,
      activeRangeFactor: 0.5,
      minimumThresholdAboveFloorDb: 4,
      ceilingGuardDb: 3,
      lowDynamicRangeDb: 4,
      absoluteNoiseGateDb: -58,
      levelSmoothingSampleRadius: 0,
    },
    rmsSamples: [
      { time: 0, rmsLevelDb: -59 },
      { time: 0.05, rmsLevelDb: -57 },
      { time: 0.1, rmsLevelDb: -28 },
      { time: 0.15, rmsLevelDb: -26 },
      { time: 0.2, rmsLevelDb: -29 },
      { time: 0.25, rmsLevelDb: -58 },
      { time: 0.3, rmsLevelDb: -57 },
      { time: 0.35, rmsLevelDb: -31 },
      { time: 0.4, rmsLevelDb: -30 },
      { time: 0.45, rmsLevelDb: -58 },
    ],
  });

  assert.deepEqual(duckingWindows, [
    { start: 20.05, end: 20.55, fadeDuration: 0.18 },
  ]);
});

test('clipDuckingWindowsToTimeRange trims ducking windows for a music layer', () => {
  const clippedWindows = clipDuckingWindowsToTimeRange({
    duckingWindows: [
      { start: 0.5, end: 2.5, fadeDuration: 0.2 },
      { start: 3.2, end: 5.4, fadeDuration: 0.18 },
    ],
    startTime: 1,
    endTime: 4,
  });

  assert.deepEqual(clippedWindows, [
    { start: 1, end: 2.5, fadeDuration: 0.2 },
    { start: 3.2, end: 4, fadeDuration: 0.18 },
  ]);
});

test('normalizeDuckingWindowsForExpression merges windows when fade ramps would overlap', () => {
  const normalizedWindows = normalizeDuckingWindowsForExpression([
    { start: 9.2125, end: 9.8283, fadeDuration: 0.2 },
    { start: 10.2245, end: 12.5356, fadeDuration: 0.2 },
    { start: 17.9314, end: 23.869, fadeDuration: 0.2 },
  ]);

  assert.deepEqual(normalizedWindows, [
    { start: 9.2125, end: 12.5356, fadeDuration: 0.2 },
    { start: 17.9314, end: 23.869, fadeDuration: 0.2 },
  ]);
});

test('buildSpeechAwareDuckingEnvelopeWindows creates smooth uniform windows from speech activity', () => {
  const envelopeWindows = buildSpeechAwareDuckingEnvelopeWindows([
    { start: 1, end: 2, fadeDuration: 0.12 },
    { start: 2.7, end: 3, fadeDuration: 0.12 },
    { start: 5, end: 5.3, fadeDuration: 0.12 },
  ], {
    attackDurationSeconds: 0.45,
    releaseDurationSeconds: 1.2,
  });

  assert.deepEqual(envelopeWindows, [
    {
      start: 1,
      end: 3,
      fadeDuration: 0.45,
      attackDuration: 0.45,
      releaseDuration: 1.2,
    },
    {
      start: 5,
      end: 5.3,
      fadeDuration: 0.45,
      attackDuration: 0.45,
      releaseDuration: 1.2,
    },
  ]);
});

test('buildMusicDuckingAutomationFromActivity produces internal ducking automation within a music layer', () => {
  const automation = buildMusicDuckingAutomationFromActivity({
    duckedVolumeRatio: 0.08,
    sampleDurationSeconds: 0.05,
    foregroundActivitySamples: [
      { time: 10, strength: 0 },
      { time: 10.05, strength: 1 },
      { time: 10.1, strength: 1 },
      { time: 10.15, strength: 0.3 },
      { time: 10.2, strength: 0 },
    ],
    musicActivitySamples: [
      { time: 10, strength: 0.6 },
      { time: 10.05, strength: 0.9 },
      { time: 10.1, strength: 0.95 },
      { time: 10.15, strength: 0.8 },
      { time: 10.2, strength: 0.5 },
    ],
  });

  assert.equal(automation.points[0]?.time, 0);
  assert.equal(automation.points[0]?.gain, 1);
  assert.ok(automation.pointCount > 2);
  assert.ok(automation.minimumGain < 0.7);
  assert.ok(
    automation.points.some((point) => point.time >= 10.05 && point.gain < 1),
    'expected at least one ducked point inside the active speech range',
  );
});

test('buildMusicDuckingAutomationFromActivity does not depend on strong music-band energy to duck during connected speech', () => {
  const automation = buildMusicDuckingAutomationFromActivity({
    duckedVolumeRatio: 0.08,
    sampleDurationSeconds: 0.05,
    foregroundActivitySamples: [
      { time: 30, strength: 0 },
      { time: 30.05, strength: 0.9 },
      { time: 30.1, strength: 1 },
      { time: 30.15, strength: 0.8 },
      { time: 30.2, strength: 0 },
    ],
    musicActivitySamples: [
      { time: 30, strength: 0.05 },
      { time: 30.05, strength: 0.02 },
      { time: 30.1, strength: 0.01 },
      { time: 30.15, strength: 0.03 },
      { time: 30.2, strength: 0.02 },
    ],
  });

  assert.ok(automation.minimumGain < 0.5);
  assert.ok(
    automation.points.some((point) => point.time >= 30.05 && point.gain < 1),
    'expected ducking even when the music-band activity is weak',
  );
});

test('boostForegroundActivitySamplesForDucking raises connected speech activity into a stronger ducking range', () => {
  const boostedSamples = boostForegroundActivitySamplesForDucking([
    { time: 12, strength: 0.18 },
    { time: 12.05, strength: 0.34 },
    { time: 12.1, strength: 0.78 },
  ], { speechLike: true });

  assert.deepEqual(boostedSamples, [
    { time: 12, strength: 0.72 },
    { time: 12.05, strength: 0.72 },
    { time: 12.1, strength: 0.8723 },
  ]);
});

test('buildWindowAnchoredForegroundActivitySamples enforces strong ducking across confirmed connected speech windows', () => {
  const anchoredSamples = buildWindowAnchoredForegroundActivitySamples([
    { start: 4.0, end: 4.12, fadeDuration: 0.08 },
    { start: 5.0, end: 5.08, fadeDuration: 0.08 },
  ], 0.04, { speechLike: true });

  assert.deepEqual(anchoredSamples, [
    { time: 4, strength: 1 },
    { time: 4.04, strength: 1 },
    { time: 4.08, strength: 1 },
    { time: 5, strength: 1 },
    { time: 5.04, strength: 1 },
  ]);
});

test('deriveForegroundDuckKeyGain boosts quieter connected speech more than louder speech', () => {
  assert.equal(deriveForegroundDuckKeyGain({
    ceilingDb: -15.5,
    windowCount: 4,
    activeSampleCount: 28,
  }), 1);

  assert.equal(deriveForegroundDuckKeyGain({
    ceilingDb: -24,
    windowCount: 3,
    activeSampleCount: 21,
  }), 1.9953);

  assert.equal(deriveForegroundDuckKeyGain({
    ceilingDb: null,
    windowCount: 0,
    activeSampleCount: 0,
  }), 1);
});

test('buildForegroundDuckKeyAutomationPoints boosts quieter speech windows more than louder ones', () => {
  const automationPoints = buildForegroundDuckKeyAutomationPoints({
    baseDuckKeyGain: 1.2,
    windows: [
      { start: 10, end: 11, fadeDuration: 0.12 },
      { start: 12, end: 13, fadeDuration: 0.12 },
    ],
    activitySamples: [
      { time: 10.05, strength: 0.95, rmsLevelDb: -15.5 },
      { time: 10.35, strength: 0.9, rmsLevelDb: -15.8 },
      { time: 10.7, strength: 0.92, rmsLevelDb: -15.2 },
      { time: 12.05, strength: 0.78, rmsLevelDb: -26.5 },
      { time: 12.35, strength: 0.82, rmsLevelDb: -27.2 },
      { time: 12.7, strength: 0.76, rmsLevelDb: -26.8 },
    ],
  });

  const loudWindowGain = automationPoints.find((point) => point.time === 10)?.gain;
  const quietWindowGain = automationPoints.find((point) => point.time === 12)?.gain;

  assert.ok(loudWindowGain >= 1.2);
  assert.ok(quietWindowGain > loudWindowGain);
  assert.ok(quietWindowGain <= 3.9811);
});

test('buildForegroundDuckKeyAutomationPoints keeps nearby similar peaks in one ducked speech turn', () => {
  const automationPoints = buildForegroundDuckKeyAutomationPoints({
    baseDuckKeyGain: 1.3,
    windows: [
      { start: 20, end: 20.35, fadeDuration: 0.12 },
      { start: 20.92, end: 21.25, fadeDuration: 0.12 },
    ],
    activitySamples: [
      { time: 20.05, strength: 0.54, rmsLevelDb: -23.8 },
      { time: 20.2, strength: 0.58, rmsLevelDb: -24.1 },
      { time: 21.0, strength: 0.52, rmsLevelDb: -24.4 },
      { time: 21.18, strength: 0.56, rmsLevelDb: -24.0 },
    ],
  });

  const duckedPoints = automationPoints.filter((point) => point.gain > 1);
  assert.equal(duckedPoints.length, 2);
  assert.equal(duckedPoints[0]?.time, 20);
  assert.equal(duckedPoints[1]?.time, 21.25);
});

test('isStudioForegroundDuckingTrack includes free-standing speech but excludes music', () => {
  assert.equal(
    isStudioForegroundDuckingTrack({
      generationType: 'speech',
      provider: 'ELEVENLABS',
      startTime: 42,
      endTime: 45,
    }),
    true,
  );

  assert.equal(
    isStudioForegroundDuckingTrack({
      generationType: 'music',
      provider: 'ELEVENLABS_MUSIC',
      startTime: 0,
      endTime: 60,
    }),
    false,
  );
});

test('buildStudioAudioDuckingPlan treats connected music as a duck target', async () => {
  const duckingPlan = await buildStudioAudioDuckingPlan([
    {
      audioLayerId: 'music-1',
      generationType: 'music',
      connectedLayerId: 'layer-1',
      startTime: 0,
      endTime: 30,
    },
  ]);

  assert.deepEqual(duckingPlan.duckTargetTrackIds, ['music-1']);
});
