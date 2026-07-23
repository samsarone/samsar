import { spawn } from 'child_process';
import {
  createOnDemandWeightedPool,
  resolveCpuCeiling,
} from './CpuResources.js';

const AUDIO_NUMBER_PRECISION = 4;
const DEFAULT_ANALYSIS_NOISE_THRESHOLD_DB = -38;
const DEFAULT_MIN_SILENCE_DURATION_SECONDS = 0.12;
const DEFAULT_MIN_ACTIVE_WINDOW_SECONDS = 0.1;
const DEFAULT_ACTIVE_WINDOW_PRE_ROLL_SECONDS = 0.04;
const DEFAULT_ACTIVE_WINDOW_POST_ROLL_SECONDS = 0.12;
const DEFAULT_WINDOW_MERGE_GAP_SECONDS = 0.1;
const DEFAULT_ANALYSIS_FADE_DURATION_SECONDS = 0.18;
const DEFAULT_ANALYSIS_SAMPLE_RATE = 16000;
const DEFAULT_ANALYSIS_WINDOW_SECONDS = 0.05;
const DEFAULT_ACTIVE_FLOOR_PERCENTILE = 0.12;
const DEFAULT_ACTIVE_CEILING_PERCENTILE = 0.9;
const DEFAULT_ACTIVE_RANGE_FACTOR = 0.5;
const DEFAULT_MIN_THRESHOLD_ABOVE_FLOOR_DB = 4;
const DEFAULT_CEILING_GUARD_DB = 3;
const DEFAULT_LOW_DYNAMIC_RANGE_DB = 4;
const DEFAULT_ABSOLUTE_NOISE_GATE_DB = -58;
const DEFAULT_LEVEL_SMOOTHING_SAMPLE_RADIUS = 1;
const SPEECH_ANALYSIS_HIGHPASS_HZ = 120;
const SPEECH_ANALYSIS_LOWPASS_HZ = 4000;
const SYNTHETIC_SPEECH_ANALYSIS_HIGHPASS_HZ = 70;
const SYNTHETIC_SPEECH_ANALYSIS_LOWPASS_HZ = 7200;
const CONNECTED_SPEECH_DUCK_CURVE_EXPONENT = 0.55;
const CONNECTED_FOREGROUND_DUCK_CURVE_EXPONENT = 0.7;
const MIN_CONNECTED_SPEECH_ACTIVITY_STRENGTH = 0.72;
const MIN_CONNECTED_FOREGROUND_ACTIVITY_STRENGTH = 0.42;
const CONNECTED_SPEECH_WINDOW_ACTIVITY_STRENGTH = 1;
const CONNECTED_FOREGROUND_WINDOW_ACTIVITY_STRENGTH = 0.6;
const TARGET_FOREGROUND_DUCK_KEY_CEILING_DB = -18;
const TARGET_FOREGROUND_DUCK_KEY_PEAK_DB = -14;
const MAX_FOREGROUND_DUCK_KEY_GAIN_DB = 12;
const MAX_FOREGROUND_DUCK_KEY_WINDOW_GAIN = 3.9811;
const FOREGROUND_DUCK_KEY_WINDOW_GAIN_EXPONENT = 0.8;
const FOREGROUND_DUCK_KEY_PHASE_MERGE_GAP_SECONDS = 0.42;
const FOREGROUND_DUCK_KEY_SAME_SPEAKER_MAX_GAP_SECONDS = 0.85;
const FOREGROUND_DUCK_KEY_SAME_SPEAKER_MAX_CEILING_DELTA_DB = 3.5;
const FOREGROUND_DUCK_KEY_SAME_SPEAKER_MAX_STRENGTH_DELTA = 0.18;
const FOREGROUND_DUCK_KEY_PHASE_STRENGTH_PERCENTILE = 0.35;
const FOREGROUND_DUCK_KEY_PHASE_CEILING_PERCENTILE = 0.82;
const MIN_FOREGROUND_DUCK_KEY_PHASE_FADE_SECONDS = 0.16;

const foregroundAudioAnalysisPool = createOnDemandWeightedPool({
  getCapacity: () => resolveCpuCeiling({
    defaultCeiling: 8,
    envNames: [
      'SAMSAR_VIDEO_MAX_AUDIO_ANALYSIS_PROCESSES',
      'SAMSAR_MAX_AUDIO_ANALYSIS_PROCESSES',
    ],
  }),
});

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function roundAudioNumber(value, precision = AUDIO_NUMBER_PRECISION) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Number(numericValue.toFixed(precision));
}

function isPresentFiniteAudioNumber(value) {
  if (value == null) {
    return false;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return false;
  }

  return Number.isFinite(Number(value));
}

function formatFFmpegNumber(value) {
  return `${roundAudioNumber(value)}`;
}

function convertDecibelsToLinearGain(decibels) {
  const numericValue = Number(decibels);
  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Math.pow(10, numericValue / 20);
}

function normalizeAudioLayerType(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'music' ||
    normalized === 'background_music' ||
    normalized === 'background music' ||
    normalized === 'bgm' ||
    normalized === 'backing_track' ||
    normalized === 'backing track'
  ) {
    return 'music';
  }

  if (normalized === 'sound') {
    return 'sound_effect';
  }

  if (normalized === 'sfx') {
    return 'sound_effect';
  }

  if (normalized === 'lip sync') {
    return 'lip_sync';
  }

  if (
    normalized === 'recorded_speech' ||
    normalized === 'recorded speech'
  ) {
    return 'speech';
  }

  if (
    normalized === 'voice' ||
    normalized === 'voiceover' ||
    normalized === 'voice_over' ||
    normalized === 'voice over' ||
    normalized === 'narration' ||
    normalized === 'character' ||
    normalized === 'dialog' ||
    normalized === 'dialogue' ||
    normalized === 'tts' ||
    normalized === 'text_to_speech' ||
    normalized === 'text to speech'
  ) {
    return 'speech';
  }

  return normalized;
}

function isMusicLikeAudioType(value) {
  return normalizeAudioLayerType(value) === 'music';
}

function isSpeechLikeAudioType(value) {
  const normalized = normalizeAudioLayerType(value);
  return (
    normalized === 'speech' ||
    normalized === 'lip_sync' ||
    normalized === 'user_video'
  );
}

function hasConnectedLayerBinding(audioTrack = {}) {
  return Boolean(audioTrack?.connectedLayerId);
}

function isLikelySpeechProvider(providerValue) {
  if (typeof providerValue !== 'string') {
    return false;
  }

  const normalizedProvider = providerValue.trim().toUpperCase();
  return (
    normalizedProvider === 'OPENAI' ||
    normalizedProvider === 'ELEVENLABS' ||
    normalizedProvider === 'PLAYAI' ||
    normalizedProvider === 'AZURE'
  );
}

function resolveTrackClassificationType(audioTrack = {}) {
  const candidateTypes = [
    audioTrack?.generationType,
    audioTrack?.libraryType,
    audioTrack?.type,
    audioTrack?.audioType,
    audioTrack?.sourceType,
    audioTrack?.generationMeta?.sourceType,
    audioTrack?.connectedLayerType,
  ];

  for (const candidateType of candidateTypes) {
    const normalizedType = normalizeAudioLayerType(candidateType);
    if (normalizedType) {
      return normalizedType;
    }
  }

  if (
    audioTrack?.speaker ||
    audioTrack?.speakerCharacterName ||
    audioTrack?.addSubtitles ||
    audioTrack?.isHumanoid ||
    isLikelySpeechProvider(audioTrack?.provider)
  ) {
    return 'speech';
  }

  return '';
}

function isMusicDuckingTargetTrack(audioTrack = {}) {
  return isMusicLikeAudioType(resolveTrackClassificationType(audioTrack));
}

function isForegroundDuckingTrack(audioTrack = {}, { requireConnectedLayer = false } = {}) {
  const hasLayerBinding = hasConnectedLayerBinding(audioTrack);
  if (requireConnectedLayer && !hasLayerBinding) {
    return false;
  }

  const resolvedAudioType = resolveTrackClassificationType(audioTrack);
  if (isMusicLikeAudioType(resolvedAudioType)) {
    return false;
  }

  return (
    isSpeechLikeAudioType(resolvedAudioType) ||
    Boolean(audioTrack?.speaker) ||
    Boolean(audioTrack?.speakerCharacterName) ||
    Boolean(audioTrack?.isHumanoid) ||
    Boolean(audioTrack?.addSubtitles) ||
    (
      isLikelySpeechProvider(audioTrack?.provider)
    )
  );
}

function isConnectedForegroundTrack(audioTrack = {}) {
  return isForegroundDuckingTrack(audioTrack, { requireConnectedLayer: true });
}

export function isStudioForegroundDuckingTrack(audioTrack = {}) {
  return isForegroundDuckingTrack(audioTrack);
}

function isSyntheticSpeechTrack(audioTrack = {}) {
  return (
    isLikelySpeechProvider(audioTrack?.provider) ||
    (
      Boolean(audioTrack?.speakerCharacterName)
      && !Boolean(audioTrack?.isHumanoid)
    )
  );
}

function resolveAudioAnalysisProfile(audioType, audioTrack = {}) {
  if (isMusicLikeAudioType(audioType)) {
    return {
      noiseThresholdDb: -44,
      minSilenceDurationSeconds: 0.12,
      minimumWindowSeconds: 0.08,
      preRollSeconds: 0.03,
      postRollSeconds: 0.08,
      mergeGapSeconds: 0.08,
      fadeDurationSeconds: 0.12,
      analysisSampleRate: DEFAULT_ANALYSIS_SAMPLE_RATE,
      analysisWindowSeconds: DEFAULT_ANALYSIS_WINDOW_SECONDS,
      activeFloorPercentile: 0.2,
      activeCeilingPercentile: 0.92,
      activeRangeFactor: 0.3,
      minimumThresholdAboveFloorDb: 2.5,
      ceilingGuardDb: 2.5,
      lowDynamicRangeDb: 2.5,
      absoluteNoiseGateDb: -64,
      levelSmoothingSampleRadius: 1,
      focusBandHighpassHz: SPEECH_ANALYSIS_HIGHPASS_HZ,
      focusBandLowpassHz: SPEECH_ANALYSIS_LOWPASS_HZ,
    };
  }

  if (isSpeechLikeAudioType(audioType)) {
    if (isSyntheticSpeechTrack(audioTrack)) {
      return {
        noiseThresholdDb: -50,
        minSilenceDurationSeconds: 0.06,
        minimumWindowSeconds: 0.05,
        preRollSeconds: 0.04,
        postRollSeconds: 0.14,
        mergeGapSeconds: 0.08,
        fadeDurationSeconds: 0.18,
        analysisSampleRate: DEFAULT_ANALYSIS_SAMPLE_RATE,
        analysisWindowSeconds: 0.03,
        activeFloorPercentile: 0.03,
        activeCeilingPercentile: 0.99,
        activeRangeFactor: 0.16,
        minimumThresholdAboveFloorDb: 1.1,
        ceilingGuardDb: 1.2,
        lowDynamicRangeDb: 1.6,
        absoluteNoiseGateDb: -68,
        levelSmoothingSampleRadius: 1,
        focusBandHighpassHz: SYNTHETIC_SPEECH_ANALYSIS_HIGHPASS_HZ,
        focusBandLowpassHz: SYNTHETIC_SPEECH_ANALYSIS_LOWPASS_HZ,
        analysisGain: 1.7,
        profileKind: 'synthetic_speech',
      };
    }

    return {
      noiseThresholdDb: -46,
      minSilenceDurationSeconds: 0.08,
      minimumWindowSeconds: 0.06,
      preRollSeconds: 0.02,
      postRollSeconds: 0.08,
      mergeGapSeconds: 0.05,
      fadeDurationSeconds: 0.12,
      analysisSampleRate: DEFAULT_ANALYSIS_SAMPLE_RATE,
      analysisWindowSeconds: 0.04,
      activeFloorPercentile: 0.06,
      activeCeilingPercentile: 0.97,
      activeRangeFactor: 0.22,
      minimumThresholdAboveFloorDb: 1.6,
      ceilingGuardDb: 1.8,
      lowDynamicRangeDb: 2.2,
      absoluteNoiseGateDb: -64,
      levelSmoothingSampleRadius: 0,
      focusBandHighpassHz: SPEECH_ANALYSIS_HIGHPASS_HZ,
      focusBandLowpassHz: 6000,
      analysisGain: 1,
      profileKind: 'speech',
    };
  }

  return {
    noiseThresholdDb: DEFAULT_ANALYSIS_NOISE_THRESHOLD_DB,
    minSilenceDurationSeconds: DEFAULT_MIN_SILENCE_DURATION_SECONDS,
    minimumWindowSeconds: DEFAULT_MIN_ACTIVE_WINDOW_SECONDS,
    preRollSeconds: DEFAULT_ACTIVE_WINDOW_PRE_ROLL_SECONDS,
    postRollSeconds: DEFAULT_ACTIVE_WINDOW_POST_ROLL_SECONDS,
    mergeGapSeconds: DEFAULT_WINDOW_MERGE_GAP_SECONDS,
    fadeDurationSeconds: DEFAULT_ANALYSIS_FADE_DURATION_SECONDS,
    analysisSampleRate: DEFAULT_ANALYSIS_SAMPLE_RATE,
    analysisWindowSeconds: DEFAULT_ANALYSIS_WINDOW_SECONDS,
    activeFloorPercentile: 0.1,
    activeCeilingPercentile: 0.88,
    activeRangeFactor: 0.45,
    minimumThresholdAboveFloorDb: 3.5,
    ceilingGuardDb: DEFAULT_CEILING_GUARD_DB,
    lowDynamicRangeDb: 3,
    absoluteNoiseGateDb: -60,
    levelSmoothingSampleRadius: 0,
    focusBandHighpassHz: null,
    focusBandLowpassHz: null,
    analysisGain: 1,
    profileKind: 'default',
  };
}

function mergeDuckingWindows(windows = [], mergeGapSeconds = DEFAULT_WINDOW_MERGE_GAP_SECONDS) {
  const sortedWindows = windows
    .filter((window) => Number.isFinite(Number(window?.start)) && Number.isFinite(Number(window?.end)))
    .map((window) => ({
      start: Math.max(0, Number(window.start)),
      end: Math.max(0, Number(window.end)),
      fadeDuration: Math.max(0, Number(window?.fadeDuration) || 0),
    }))
    .filter((window) => window.end > window.start)
    .sort((leftWindow, rightWindow) => {
      if (leftWindow.start !== rightWindow.start) {
        return leftWindow.start - rightWindow.start;
      }
      return leftWindow.end - rightWindow.end;
    });

  if (sortedWindows.length === 0) {
    return [];
  }

  const mergedWindows = [sortedWindows[0]];
  for (let index = 1; index < sortedWindows.length; index += 1) {
    const currentWindow = sortedWindows[index];
    const previousWindow = mergedWindows[mergedWindows.length - 1];

    if (currentWindow.start <= previousWindow.end + mergeGapSeconds) {
      previousWindow.end = Math.max(previousWindow.end, currentWindow.end);
      previousWindow.fadeDuration = Math.max(previousWindow.fadeDuration, currentWindow.fadeDuration);
      continue;
    }

    mergedWindows.push(currentWindow);
  }

  return mergedWindows.map((window) => {
    const windowDuration = Math.max(0, window.end - window.start);
    return {
      start: roundAudioNumber(window.start),
      end: roundAudioNumber(window.end),
      fadeDuration: roundAudioNumber(Math.min(window.fadeDuration, windowDuration / 2)),
    };
  });
}

export function normalizeDuckingWindowsForExpression(duckingWindows = []) {
  const sortedWindows = duckingWindows
    .filter((window) => Number.isFinite(Number(window?.start)) && Number.isFinite(Number(window?.end)))
    .map((window) => ({
      start: Math.max(0, Number(window.start)),
      end: Math.max(0, Number(window.end)),
      fadeDuration: Math.max(0, Number(window?.fadeDuration) || 0),
    }))
    .filter((window) => window.end > window.start)
    .sort((leftWindow, rightWindow) => {
      if (leftWindow.start !== rightWindow.start) {
        return leftWindow.start - rightWindow.start;
      }
      return leftWindow.end - rightWindow.end;
    });

  if (sortedWindows.length === 0) {
    return [];
  }

  const normalizedWindows = [sortedWindows[0]];
  for (let index = 1; index < sortedWindows.length; index += 1) {
    const currentWindow = sortedWindows[index];
    const previousWindow = normalizedWindows[normalizedWindows.length - 1];
    const previousEffectiveEnd = previousWindow.end + previousWindow.fadeDuration;
    const currentEffectiveStart = currentWindow.start - currentWindow.fadeDuration;

    if (currentEffectiveStart <= previousEffectiveEnd) {
      previousWindow.end = Math.max(previousWindow.end, currentWindow.end);
      previousWindow.fadeDuration = Math.max(previousWindow.fadeDuration, currentWindow.fadeDuration);
      continue;
    }

    normalizedWindows.push(currentWindow);
  }

  return normalizedWindows.map((window) => {
    const duration = Math.max(0, window.end - window.start);
    return {
      start: roundAudioNumber(window.start),
      end: roundAudioNumber(window.end),
      fadeDuration: roundAudioNumber(Math.min(window.fadeDuration, duration / 2)),
    };
  });
}

export function buildSpeechAwareDuckingEnvelopeWindows(
  duckingWindows = [],
  {
    attackDurationSeconds = DEFAULT_ANALYSIS_FADE_DURATION_SECONDS,
    releaseDurationSeconds = DEFAULT_ANALYSIS_FADE_DURATION_SECONDS,
    minimumWindowSeconds = 0,
  } = {},
) {
  const resolvedAttackDuration = Math.max(0, Number(attackDurationSeconds) || 0);
  const resolvedReleaseDuration = Math.max(0, Number(releaseDurationSeconds) || 0);
  const resolvedMinimumWindowSeconds = Math.max(0, Number(minimumWindowSeconds) || 0);
  const sortedWindows = (Array.isArray(duckingWindows) ? duckingWindows : [])
    .filter((window) => Number.isFinite(Number(window?.start)) && Number.isFinite(Number(window?.end)))
    .map((window) => {
      const start = Math.max(0, Number(window.start));
      const end = Math.max(start, Number(window.end));
      const windowFadeDuration = Number.isFinite(Number(window?.fadeDuration))
        ? Math.max(0, Number(window.fadeDuration))
        : 0;
      const attackDuration = window?.attackDuration != null && Number.isFinite(Number(window.attackDuration))
        ? Math.max(resolvedAttackDuration, Number(window.attackDuration))
        : Math.max(resolvedAttackDuration, windowFadeDuration);
      const releaseDuration = window?.releaseDuration != null && Number.isFinite(Number(window.releaseDuration))
        ? Math.max(resolvedReleaseDuration, Number(window.releaseDuration))
        : Math.max(resolvedReleaseDuration, windowFadeDuration);

      return {
        start,
        end,
        fadeDuration: attackDuration,
        attackDuration,
        releaseDuration,
      };
    })
    .filter((window) => window.end > window.start && (window.end - window.start) >= resolvedMinimumWindowSeconds)
    .sort((leftWindow, rightWindow) => {
      if (leftWindow.start !== rightWindow.start) {
        return leftWindow.start - rightWindow.start;
      }
      return leftWindow.end - rightWindow.end;
    });

  if (sortedWindows.length === 0) {
    return [];
  }

  const mergedWindows = [sortedWindows[0]];
  for (let index = 1; index < sortedWindows.length; index += 1) {
    const currentWindow = sortedWindows[index];
    const previousWindow = mergedWindows[mergedWindows.length - 1];
    const previousEffectiveEnd = previousWindow.end + previousWindow.releaseDuration;
    const currentEffectiveStart = currentWindow.start - currentWindow.attackDuration;

    if (currentEffectiveStart <= previousEffectiveEnd) {
      previousWindow.end = Math.max(previousWindow.end, currentWindow.end);
      previousWindow.fadeDuration = Math.max(previousWindow.fadeDuration, currentWindow.fadeDuration);
      previousWindow.attackDuration = Math.max(previousWindow.attackDuration, currentWindow.attackDuration);
      previousWindow.releaseDuration = Math.max(previousWindow.releaseDuration, currentWindow.releaseDuration);
      continue;
    }

    mergedWindows.push(currentWindow);
  }

  return mergedWindows.map((window) => ({
    start: roundAudioNumber(window.start),
    end: roundAudioNumber(window.end),
    fadeDuration: roundAudioNumber(window.fadeDuration),
    attackDuration: roundAudioNumber(window.attackDuration),
    releaseDuration: roundAudioNumber(window.releaseDuration),
  }));
}

export function parseSilenceDetectOutput(output = '') {
  const silenceIntervals = [];
  let currentSilenceStart = null;

  const silenceStartRegex = /silence_start:\s*(-?\d+(?:\.\d+)?)/;
  const silenceEndRegex = /silence_end:\s*(-?\d+(?:\.\d+)?)(?:\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?))?/;

  String(output)
    .split(/\r?\n/)
    .forEach((line) => {
      const silenceStartMatch = line.match(silenceStartRegex);
      if (silenceStartMatch) {
        currentSilenceStart = Math.max(0, Number(silenceStartMatch[1]) || 0);
        return;
      }

      const silenceEndMatch = line.match(silenceEndRegex);
      if (!silenceEndMatch) {
        return;
      }

      const silenceEnd = Math.max(0, Number(silenceEndMatch[1]) || 0);
      const silenceDuration = Math.max(0, Number(silenceEndMatch[2]) || 0);
      const resolvedSilenceStart = currentSilenceStart != null
        ? currentSilenceStart
        : Math.max(0, silenceEnd - silenceDuration);

      if (silenceEnd > resolvedSilenceStart) {
        silenceIntervals.push({
          start: roundAudioNumber(resolvedSilenceStart),
          end: roundAudioNumber(silenceEnd),
        });
      }

      currentSilenceStart = null;
    });

  return {
    silenceIntervals,
    trailingSilenceStart: currentSilenceStart != null
      ? roundAudioNumber(currentSilenceStart)
      : null,
  };
}

export function buildDuckingWindowsFromSilenceAnalysis({
  durationSeconds = 0,
  silenceIntervals = [],
  trailingSilenceStart = null,
  timelineStartTime = 0,
  preRollSeconds = DEFAULT_ACTIVE_WINDOW_PRE_ROLL_SECONDS,
  postRollSeconds = DEFAULT_ACTIVE_WINDOW_POST_ROLL_SECONDS,
  mergeGapSeconds = DEFAULT_WINDOW_MERGE_GAP_SECONDS,
  minimumWindowSeconds = DEFAULT_MIN_ACTIVE_WINDOW_SECONDS,
  fadeDurationSeconds = DEFAULT_ANALYSIS_FADE_DURATION_SECONDS,
} = {}) {
  const resolvedDuration = Math.max(0, Number(durationSeconds) || 0);
  if (resolvedDuration <= 0) {
    return [];
  }

  const sortedSilenceIntervals = silenceIntervals
    .filter((interval) => Number.isFinite(Number(interval?.start)) && Number.isFinite(Number(interval?.end)))
    .map((interval) => ({
      start: clamp(interval.start, 0, resolvedDuration),
      end: clamp(interval.end, 0, resolvedDuration),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((leftInterval, rightInterval) => {
      if (leftInterval.start !== rightInterval.start) {
        return leftInterval.start - rightInterval.start;
      }
      return leftInterval.end - rightInterval.end;
    });

  const activeWindows = [];
  let cursor = 0;

  sortedSilenceIntervals.forEach((interval) => {
    if (interval.start > cursor) {
      activeWindows.push({
        start: cursor,
        end: interval.start,
      });
    }

    cursor = Math.max(cursor, interval.end);
  });

  const resolvedTrailingSilenceStart = Number.isFinite(Number(trailingSilenceStart))
    ? clamp(trailingSilenceStart, 0, resolvedDuration)
    : null;

  if (resolvedTrailingSilenceStart != null) {
    if (resolvedTrailingSilenceStart > cursor) {
      activeWindows.push({
        start: cursor,
        end: resolvedTrailingSilenceStart,
      });
    }
  } else if (cursor < resolvedDuration) {
    activeWindows.push({
      start: cursor,
      end: resolvedDuration,
    });
  }

  const expandedWindows = activeWindows
    .map((window) => ({
      start: clamp(window.start - preRollSeconds, 0, resolvedDuration) + timelineStartTime,
      end: clamp(window.end + postRollSeconds, 0, resolvedDuration) + timelineStartTime,
      fadeDuration: fadeDurationSeconds,
    }))
    .filter((window) => (window.end - window.start) >= minimumWindowSeconds);

  return mergeDuckingWindows(expandedWindows, mergeGapSeconds);
}

function resolvePercentileValue(values = [], percentile = 0.5) {
  const sortedValues = values
    .filter((value) => Number.isFinite(Number(value)))
    .map((value) => Number(value))
    .sort((leftValue, rightValue) => leftValue - rightValue);

  if (sortedValues.length === 0) {
    return null;
  }

  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const clampedPercentile = clamp(percentile, 0, 1);
  const exactIndex = clampedPercentile * (sortedValues.length - 1);
  const lowerIndex = Math.floor(exactIndex);
  const upperIndex = Math.ceil(exactIndex);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const interpolationFactor = exactIndex - lowerIndex;
  return (
    sortedValues[lowerIndex]
    + ((sortedValues[upperIndex] - sortedValues[lowerIndex]) * interpolationFactor)
  );
}

function smoothRmsSamples(samples = [], sampleRadius = 0) {
  const resolvedRadius = Math.max(0, Math.trunc(Number(sampleRadius) || 0));
  if (resolvedRadius <= 0) {
    return samples;
  }

  return samples.map((sample, index) => {
    let levelSum = 0;
    let levelCount = 0;

    for (let sampleIndex = Math.max(0, index - resolvedRadius); sampleIndex <= Math.min(samples.length - 1, index + resolvedRadius); sampleIndex += 1) {
      const levelValue = Number(samples[sampleIndex]?.rmsLevelDb);
      if (!Number.isFinite(levelValue)) {
        continue;
      }
      levelSum += levelValue;
      levelCount += 1;
    }

    return {
      ...sample,
      rmsLevelDb: levelCount > 0 ? (levelSum / levelCount) : sample.rmsLevelDb,
    };
  });
}

export function parseAstatsRmsMetadataOutput(output = '') {
  const rmsSamples = [];
  let currentFrameTime = null;

  String(output)
    .split(/\r?\n/)
    .forEach((line) => {
      const frameTimeMatch = line.match(/pts_time:\s*(-?\d+(?:\.\d+)?)/);
      if (frameTimeMatch) {
        currentFrameTime = Math.max(0, Number(frameTimeMatch[1]) || 0);
        return;
      }

      const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?(?:\d+(?:\.\d+)?)|inf|-inf|nan)/i);
      if (!rmsMatch || currentFrameTime == null) {
        return;
      }

      const rmsLevelDb = Number(rmsMatch[1]);
      if (!Number.isFinite(rmsLevelDb)) {
        return;
      }

      rmsSamples.push({
        time: roundAudioNumber(currentFrameTime),
        rmsLevelDb: roundAudioNumber(rmsLevelDb),
      });
    });

  return rmsSamples;
}

function resolveRmsActivityThresholdDb(rmsSamples = [], profile = {}) {
  const levels = rmsSamples
    .map((sample) => Number(sample?.rmsLevelDb))
    .filter((value) => Number.isFinite(value));

  if (levels.length === 0) {
    return null;
  }

  const floorValue = resolvePercentileValue(levels, profile.activeFloorPercentile ?? DEFAULT_ACTIVE_FLOOR_PERCENTILE);
  const ceilingValue = resolvePercentileValue(levels, profile.activeCeilingPercentile ?? DEFAULT_ACTIVE_CEILING_PERCENTILE);
  if (!Number.isFinite(floorValue) || !Number.isFinite(ceilingValue)) {
    return null;
  }

  if (ceilingValue <= (profile.absoluteNoiseGateDb ?? DEFAULT_ABSOLUTE_NOISE_GATE_DB)) {
    return null;
  }

  const dynamicRange = Math.max(0, ceilingValue - floorValue);
  if (dynamicRange < (profile.lowDynamicRangeDb ?? DEFAULT_LOW_DYNAMIC_RANGE_DB)) {
    return roundAudioNumber(floorValue - 0.001);
  }

  const thresholdFromFloor = floorValue + Math.max(
    profile.minimumThresholdAboveFloorDb ?? DEFAULT_MIN_THRESHOLD_ABOVE_FLOOR_DB,
    dynamicRange * (profile.activeRangeFactor ?? DEFAULT_ACTIVE_RANGE_FACTOR),
  );
  const thresholdFromCeiling = ceilingValue - (profile.ceilingGuardDb ?? DEFAULT_CEILING_GUARD_DB);

  return roundAudioNumber(Math.min(thresholdFromFloor, thresholdFromCeiling));
}

export function buildDuckingWindowsFromRmsAnalysis({
  durationSeconds = 0,
  rmsSamples = [],
  sampleDurationSeconds = DEFAULT_ANALYSIS_WINDOW_SECONDS,
  timelineStartTime = 0,
  preRollSeconds = DEFAULT_ACTIVE_WINDOW_PRE_ROLL_SECONDS,
  postRollSeconds = DEFAULT_ACTIVE_WINDOW_POST_ROLL_SECONDS,
  mergeGapSeconds = DEFAULT_WINDOW_MERGE_GAP_SECONDS,
  minimumWindowSeconds = DEFAULT_MIN_ACTIVE_WINDOW_SECONDS,
  fadeDurationSeconds = DEFAULT_ANALYSIS_FADE_DURATION_SECONDS,
  activeThresholdDb = null,
  profile = {},
} = {}) {
  const resolvedDuration = Math.max(0, Number(durationSeconds) || 0);
  if (resolvedDuration <= 0) {
    return [];
  }

  const resolvedSampleDuration = Math.max(0.01, Number(sampleDurationSeconds) || DEFAULT_ANALYSIS_WINDOW_SECONDS);
  const normalizedRmsSamples = smoothRmsSamples(
    (Array.isArray(rmsSamples) ? rmsSamples : [])
      .filter((sample) => Number.isFinite(Number(sample?.time)) && Number.isFinite(Number(sample?.rmsLevelDb)))
      .map((sample) => ({
        time: clamp(sample.time, 0, resolvedDuration),
        rmsLevelDb: Number(sample.rmsLevelDb),
      })),
    profile.levelSmoothingSampleRadius,
  );

  if (normalizedRmsSamples.length === 0) {
    return [];
  }

  const resolvedThresholdDb = activeThresholdDb != null && Number.isFinite(Number(activeThresholdDb))
    ? Number(activeThresholdDb)
    : resolveRmsActivityThresholdDb(normalizedRmsSamples, profile);
  if (!Number.isFinite(resolvedThresholdDb)) {
    return [];
  }

  const activeWindows = [];
  let currentWindow = null;

  normalizedRmsSamples.forEach((sample) => {
    const sampleStart = clamp(sample.time, 0, resolvedDuration);
    const sampleEnd = clamp(sample.time + resolvedSampleDuration, sampleStart, resolvedDuration);
    if (sampleEnd <= sampleStart) {
      return;
    }

    if (sample.rmsLevelDb >= resolvedThresholdDb) {
      if (!currentWindow) {
        currentWindow = {
          start: sampleStart,
          end: sampleEnd,
        };
        return;
      }

      currentWindow.end = sampleEnd;
      return;
    }

    if (currentWindow) {
      activeWindows.push(currentWindow);
      currentWindow = null;
    }
  });

  if (currentWindow) {
    activeWindows.push(currentWindow);
  }

  const expandedWindows = activeWindows
    .map((window) => ({
      start: clamp(window.start - preRollSeconds, 0, resolvedDuration) + timelineStartTime,
      end: clamp(window.end + postRollSeconds, 0, resolvedDuration) + timelineStartTime,
      fadeDuration: fadeDurationSeconds,
    }))
    .filter((window) => (window.end - window.start) >= minimumWindowSeconds);

  return mergeDuckingWindows(expandedWindows, mergeGapSeconds);
}

export function clipDuckingWindowsToTimeRange({
  duckingWindows = [],
  startTime = 0,
  endTime = 0,
  fallbackFadeDurationSeconds = DEFAULT_ANALYSIS_FADE_DURATION_SECONDS,
} = {}) {
  const rangeStart = Math.max(0, Number(startTime) || 0);
  const rangeEnd = Math.max(rangeStart, Number(endTime) || 0);
  if (rangeEnd <= rangeStart) {
    return [];
  }

  return duckingWindows
    .map((window) => {
      const overlapStart = Math.max(rangeStart, Number(window?.start) || 0);
      const overlapEnd = Math.min(rangeEnd, Number(window?.end) || 0);
      if (overlapEnd <= overlapStart) {
        return null;
      }

      const overlapDuration = overlapEnd - overlapStart;
      const fadeDuration = Number.isFinite(Number(window?.fadeDuration))
        ? Math.max(0, Number(window.fadeDuration))
        : fallbackFadeDurationSeconds;

      return {
        start: roundAudioNumber(overlapStart),
        end: roundAudioNumber(overlapEnd),
        fadeDuration: roundAudioNumber(Math.min(fadeDuration, overlapDuration / 2)),
      };
    })
    .filter(Boolean);
}

function runFFmpegSilenceDetect({
  audioPath,
  sourceTrimStartTime,
  sourceTrimDuration,
  audioType,
  audioTrack = {},
  spawnImpl = spawn,
} = {}) {
  const profile = resolveAudioAnalysisProfile(audioType, audioTrack);
  const filterParts = [];

  if (Number.isFinite(Number(profile.focusBandHighpassHz)) && Number(profile.focusBandHighpassHz) > 0) {
    filterParts.push(`highpass=f=${formatFFmpegNumber(profile.focusBandHighpassHz)}`);
  }

  if (Number.isFinite(Number(profile.focusBandLowpassHz)) && Number(profile.focusBandLowpassHz) > 0) {
    filterParts.push(`lowpass=f=${formatFFmpegNumber(profile.focusBandLowpassHz)}`);
  }

  if (Number.isFinite(Number(profile.analysisGain)) && Number(profile.analysisGain) > 1.0001) {
    filterParts.push(`volume=${formatFFmpegNumber(profile.analysisGain)}`);
  }

  filterParts.push(
    `silencedetect=noise=${formatFFmpegNumber(profile.noiseThresholdDb)}dB:d=${formatFFmpegNumber(profile.minSilenceDurationSeconds)}`,
  );

  return foregroundAudioAnalysisPool.run(1, () => new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostats', '-threads', '1'];

    if (sourceTrimStartTime > 0) {
      args.push('-ss', formatFFmpegNumber(sourceTrimStartTime));
    }

    args.push(
      '-t',
      formatFFmpegNumber(sourceTrimDuration),
      '-i',
      audioPath,
      '-vn',
      '-filter_threads',
      '1',
      '-af',
      filterParts.join(','),
      '-f',
      'null',
      '-',
    );

    const ffmpegProcess = spawnImpl(process.env.FFMPEG_PATH || 'ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';

    ffmpegProcess.stderr.on('data', (buffer) => {
      stderr += buffer.toString();
    });

    ffmpegProcess.on('error', (error) => {
      reject(error);
    });

    ffmpegProcess.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ output: stderr, profile });
        return;
      }

      reject(new Error(`ffmpeg silencedetect exited with code ${exitCode}`));
    });
  }));
}

function buildRmsMetadataFilterChain(profile = {}) {
  const filterParts = [];

  if (Number.isFinite(Number(profile.focusBandHighpassHz)) && Number(profile.focusBandHighpassHz) > 0) {
    filterParts.push(`highpass=f=${formatFFmpegNumber(profile.focusBandHighpassHz)}`);
  }

  if (Number.isFinite(Number(profile.focusBandLowpassHz)) && Number(profile.focusBandLowpassHz) > 0) {
    filterParts.push(`lowpass=f=${formatFFmpegNumber(profile.focusBandLowpassHz)}`);
  }

  if (Number.isFinite(Number(profile.analysisGain)) && Number(profile.analysisGain) > 1.0001) {
    filterParts.push(`volume=${formatFFmpegNumber(profile.analysisGain)}`);
  }

  const analysisSampleRate = Math.max(8000, Number(profile.analysisSampleRate) || DEFAULT_ANALYSIS_SAMPLE_RATE);
  const analysisWindowSeconds = Math.max(0.02, Number(profile.analysisWindowSeconds) || DEFAULT_ANALYSIS_WINDOW_SECONDS);
  const windowSampleCount = Math.max(1, Math.round(analysisSampleRate * analysisWindowSeconds));

  filterParts.push(`aresample=${analysisSampleRate}`);
  filterParts.push(`asetnsamples=n=${windowSampleCount}:p=0`);
  filterParts.push(
    `astats=metadata=1:reset=1:length=${formatFFmpegNumber(analysisWindowSeconds)}:` +
    `measure_perchannel=none:measure_overall=RMS_level`
  );
  filterParts.push('ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-');

  return filterParts.join(',');
}

function runFFmpegRmsMetadataAnalysis({
  audioPath,
  sourceTrimStartTime,
  sourceTrimDuration,
  audioType,
  audioTrack = {},
  spawnImpl = spawn,
} = {}) {
  const profile = resolveAudioAnalysisProfile(audioType, audioTrack);

  return foregroundAudioAnalysisPool.run(1, () => new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostats', '-threads', '1'];

    if (sourceTrimStartTime > 0) {
      args.push('-ss', formatFFmpegNumber(sourceTrimStartTime));
    }

    args.push(
      '-t',
      formatFFmpegNumber(sourceTrimDuration),
      '-i',
      audioPath,
      '-vn',
      '-filter_threads',
      '1',
      '-af',
      buildRmsMetadataFilterChain(profile),
      '-f',
      'null',
      '-',
    );

    const ffmpegProcess = spawnImpl(process.env.FFMPEG_PATH || 'ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    ffmpegProcess.stdout.on('data', (buffer) => {
      stdout += buffer.toString();
    });

    ffmpegProcess.stderr.on('data', (buffer) => {
      stderr += buffer.toString();
    });

    ffmpegProcess.on('error', (error) => {
      reject(error);
    });

    ffmpegProcess.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ output: stdout, stderr, profile });
        return;
      }

      reject(new Error(`ffmpeg rms metadata analysis exited with code ${exitCode}`));
    });
  }));
}

function buildNormalizedRmsStrengthSamples({
  rmsSamples = [],
  durationSeconds = 0,
  timelineStartTime = 0,
  sampleDurationSeconds = DEFAULT_ANALYSIS_WINDOW_SECONDS,
  profile = {},
} = {}) {
  const resolvedDuration = Math.max(0, Number(durationSeconds) || 0);
  const resolvedSampleDuration = Math.max(0.01, Number(sampleDurationSeconds) || DEFAULT_ANALYSIS_WINDOW_SECONDS);
  const normalizedRmsSamples = smoothRmsSamples(
    (Array.isArray(rmsSamples) ? rmsSamples : [])
      .filter((sample) => Number.isFinite(Number(sample?.time)) && Number.isFinite(Number(sample?.rmsLevelDb)))
      .map((sample) => ({
        time: clamp(sample.time, 0, resolvedDuration),
        rmsLevelDb: Number(sample.rmsLevelDb),
      })),
    profile.levelSmoothingSampleRadius,
  );

  if (normalizedRmsSamples.length === 0) {
    return {
      samples: [],
      thresholdDb: null,
      floorDb: null,
      ceilingDb: null,
      peakDb: null,
      sampleDurationSeconds: resolvedSampleDuration,
    };
  }

  const floorDb = resolvePercentileValue(normalizedRmsSamples.map((sample) => sample.rmsLevelDb), profile.activeFloorPercentile ?? DEFAULT_ACTIVE_FLOOR_PERCENTILE);
  const ceilingDb = resolvePercentileValue(normalizedRmsSamples.map((sample) => sample.rmsLevelDb), profile.activeCeilingPercentile ?? DEFAULT_ACTIVE_CEILING_PERCENTILE);
  const peakDb = Math.max(...normalizedRmsSamples.map((sample) => sample.rmsLevelDb));
  const thresholdDb = resolveRmsActivityThresholdDb(normalizedRmsSamples, profile);
  const denominator = Math.max(0.001, (Number(ceilingDb) || 0) - (Number(thresholdDb) || 0));

  return {
    samples: normalizedRmsSamples.map((sample) => ({
      time: roundAudioNumber(sample.time + timelineStartTime),
      rmsLevelDb: roundAudioNumber(sample.rmsLevelDb),
      strength: isPresentFiniteAudioNumber(thresholdDb)
        ? roundAudioNumber(clamp((sample.rmsLevelDb - thresholdDb) / denominator, 0, 1))
        : 0,
    })),
    thresholdDb: isPresentFiniteAudioNumber(thresholdDb) ? roundAudioNumber(thresholdDb) : null,
    floorDb: isPresentFiniteAudioNumber(floorDb) ? roundAudioNumber(floorDb) : null,
    ceilingDb: isPresentFiniteAudioNumber(ceilingDb) ? roundAudioNumber(ceilingDb) : null,
    peakDb: isPresentFiniteAudioNumber(peakDb) ? roundAudioNumber(peakDb) : null,
    sampleDurationSeconds: resolvedSampleDuration,
  };
}

function buildActivitySamplesFromWindows(windows = [], sampleDurationSeconds = DEFAULT_ANALYSIS_WINDOW_SECONDS) {
  const resolvedSampleDuration = Math.max(0.01, Number(sampleDurationSeconds) || DEFAULT_ANALYSIS_WINDOW_SECONDS);
  const samples = [];

  windows.forEach((window) => {
    const windowStart = Math.max(0, Number(window?.start) || 0);
    const windowEnd = Math.max(windowStart, Number(window?.end) || 0);
    for (let time = windowStart; time < windowEnd; time += resolvedSampleDuration) {
      samples.push({
        time: roundAudioNumber(time),
        strength: 1,
      });
    }
  });

  return samples;
}

export function boostForegroundActivitySamplesForDucking(activitySamples = [], { speechLike = false } = {}) {
  const curveExponent = speechLike
    ? CONNECTED_SPEECH_DUCK_CURVE_EXPONENT
    : CONNECTED_FOREGROUND_DUCK_CURVE_EXPONENT;
  const minimumActivityStrength = speechLike
    ? MIN_CONNECTED_SPEECH_ACTIVITY_STRENGTH
    : MIN_CONNECTED_FOREGROUND_ACTIVITY_STRENGTH;

  return (Array.isArray(activitySamples) ? activitySamples : []).map((sample) => {
    const rawStrength = clamp(sample?.strength, 0, 1);
    if (rawStrength <= 0.03) {
      return {
        ...sample,
        strength: 0,
      };
    }

    return {
      ...sample,
      strength: roundAudioNumber(Math.max(
        minimumActivityStrength,
        Math.pow(rawStrength, curveExponent),
      )),
    };
  });
}

export function buildWindowAnchoredForegroundActivitySamples(
  windows = [],
  sampleDurationSeconds = DEFAULT_ANALYSIS_WINDOW_SECONDS,
  { speechLike = false } = {},
) {
  const resolvedSampleDuration = Math.max(0.01, Number(sampleDurationSeconds) || DEFAULT_ANALYSIS_WINDOW_SECONDS);
  const anchoredStrength = speechLike
    ? CONNECTED_SPEECH_WINDOW_ACTIVITY_STRENGTH
    : CONNECTED_FOREGROUND_WINDOW_ACTIVITY_STRENGTH;

  return buildActivitySamplesFromWindows(windows, resolvedSampleDuration).map((sample) => ({
    ...sample,
    strength: anchoredStrength,
  }));
}

export function deriveForegroundDuckKeyGain({
  ceilingDb = null,
  peakDb = null,
  windowCount = 0,
  activeSampleCount = 0,
} = {}) {
  if (
    !isPresentFiniteAudioNumber(ceilingDb) ||
    Number(windowCount) <= 0 ||
    Number(activeSampleCount) <= 0
  ) {
      return 1;
  }

  const hasPeakDb = isPresentFiniteAudioNumber(peakDb);
  const referenceDb = hasPeakDb ? Number(peakDb) : Number(ceilingDb);
  const targetDb = hasPeakDb
    ? TARGET_FOREGROUND_DUCK_KEY_PEAK_DB
    : TARGET_FOREGROUND_DUCK_KEY_CEILING_DB;
  const gainBoostDb = clamp(
    targetDb - referenceDb,
    0,
    MAX_FOREGROUND_DUCK_KEY_GAIN_DB,
  );

  return roundAudioNumber(clamp(
    convertDecibelsToLinearGain(gainBoostDb),
    1,
    MAX_FOREGROUND_DUCK_KEY_WINDOW_GAIN,
  ));
}

function resolveForegroundDuckKeyPhaseFingerprint(phaseWindow = {}, activitySamples = []) {
  const phaseSamples = (Array.isArray(activitySamples) ? activitySamples : []).filter((sample) => (
    Number.isFinite(Number(sample?.time))
    && sample.time >= phaseWindow.start
    && sample.time <= phaseWindow.end
    && clamp(sample?.strength, 0, 1) > 0.03
  ));

  const phaseStrength = phaseSamples.length > 0
    ? clamp(resolvePercentileValue(
      phaseSamples.map((sample) => clamp(sample?.strength, 0, 1)),
      FOREGROUND_DUCK_KEY_PHASE_STRENGTH_PERCENTILE,
    ), 0, 1)
    : 1;

  const phaseCeilingDb = phaseSamples.length > 0
    ? resolvePercentileValue(
        phaseSamples
          .map((sample) => Number(sample?.rmsLevelDb))
          .filter((value) => Number.isFinite(value)),
        FOREGROUND_DUCK_KEY_PHASE_CEILING_PERCENTILE,
      )
    : null;
  const phasePeakDb = phaseSamples.length > 0
    ? Math.max(
        ...phaseSamples
          .map((sample) => Number(sample?.rmsLevelDb))
          .filter((value) => Number.isFinite(value)),
      )
    : null;

  return {
    phaseStrength,
    phaseCeilingDb: isPresentFiniteAudioNumber(phaseCeilingDb) ? Number(phaseCeilingDb) : null,
    phasePeakDb: isPresentFiniteAudioNumber(phasePeakDb) ? Number(phasePeakDb) : null,
    activeSampleCount: phaseSamples.length,
  };
}

function shouldMergeForegroundDuckKeyPhases(previousPhase = {}, nextPhase = {}) {
  const gapSeconds = Math.max(0, Number(nextPhase.start) - Number(previousPhase.end));
  if (gapSeconds > FOREGROUND_DUCK_KEY_SAME_SPEAKER_MAX_GAP_SECONDS) {
    return false;
  }

  const previousFingerprint = previousPhase.fingerprint || {};
  const nextFingerprint = nextPhase.fingerprint || {};
  const bothHaveCeiling = Number.isFinite(Number(previousFingerprint.phaseCeilingDb))
    && Number.isFinite(Number(nextFingerprint.phaseCeilingDb));
  const similarCeiling = bothHaveCeiling
    ? Math.abs(Number(previousFingerprint.phaseCeilingDb) - Number(nextFingerprint.phaseCeilingDb))
      <= FOREGROUND_DUCK_KEY_SAME_SPEAKER_MAX_CEILING_DELTA_DB
    : false;
  const similarStrength = Math.abs(
    clamp(previousFingerprint.phaseStrength, 0, 1) - clamp(nextFingerprint.phaseStrength, 0, 1),
  ) <= FOREGROUND_DUCK_KEY_SAME_SPEAKER_MAX_STRENGTH_DELTA;

  return similarCeiling || similarStrength;
}

function buildForegroundDuckKeyPhaseWindows(windows = [], activitySamples = []) {
  const seededPhaseWindows = mergeDuckingWindows(windows, FOREGROUND_DUCK_KEY_PHASE_MERGE_GAP_SECONDS)
    .map((window) => ({
      ...window,
      fadeDuration: roundAudioNumber(Math.max(
        MIN_FOREGROUND_DUCK_KEY_PHASE_FADE_SECONDS,
        Number(window?.fadeDuration) || 0,
      )),
      fingerprint: resolveForegroundDuckKeyPhaseFingerprint(window, activitySamples),
    }));

  if (seededPhaseWindows.length <= 1) {
    return normalizeDuckingWindowsForExpression(seededPhaseWindows.map(({ fingerprint, ...window }) => window));
  }

  const mergedPhaseWindows = [seededPhaseWindows[0]];
  for (let index = 1; index < seededPhaseWindows.length; index += 1) {
    const nextPhase = seededPhaseWindows[index];
    const previousPhase = mergedPhaseWindows[mergedPhaseWindows.length - 1];

    if (shouldMergeForegroundDuckKeyPhases(previousPhase, nextPhase)) {
      previousPhase.end = Math.max(previousPhase.end, nextPhase.end);
      previousPhase.fadeDuration = Math.max(previousPhase.fadeDuration, nextPhase.fadeDuration);
      previousPhase.fingerprint = resolveForegroundDuckKeyPhaseFingerprint(previousPhase, activitySamples);
      continue;
    }

    mergedPhaseWindows.push(nextPhase);
  }

  return normalizeDuckingWindowsForExpression(
    mergedPhaseWindows.map(({ fingerprint, ...window }) => window),
  );
}

export function buildForegroundDuckKeyAutomationPoints({
  windows = [],
  activitySamples = [],
  baseDuckKeyGain = 1,
} = {}) {
  const automationPoints = [{ time: 0, gain: 1 }];
  const phaseWindows = buildForegroundDuckKeyPhaseWindows(windows, activitySamples);
  const normalizedBaseGain = clamp(baseDuckKeyGain, 1, MAX_FOREGROUND_DUCK_KEY_WINDOW_GAIN);
  const normalizedActivitySamples = Array.isArray(activitySamples) ? activitySamples : [];

  phaseWindows.forEach((phaseWindow) => {
    const phaseSamples = normalizedActivitySamples.filter((sample) => (
      Number.isFinite(Number(sample?.time))
      && sample.time >= phaseWindow.start
      && sample.time <= phaseWindow.end
      && clamp(sample?.strength, 0, 1) > 0.03
    ));
    const phaseStrength = phaseSamples.length > 0
      ? clamp(resolvePercentileValue(
        phaseSamples.map((sample) => clamp(sample?.strength, 0, 1)),
        FOREGROUND_DUCK_KEY_PHASE_STRENGTH_PERCENTILE,
      ), 0, 1)
      : 1;
    const phaseCeilingDb = phaseSamples.length > 0
      ? resolvePercentileValue(
        phaseSamples
          .map((sample) => Number(sample?.rmsLevelDb))
          .filter((value) => Number.isFinite(value)),
        FOREGROUND_DUCK_KEY_PHASE_CEILING_PERCENTILE,
      )
      : null;
    const phasePeakDb = phaseSamples.length > 0
      ? Math.max(
        ...phaseSamples
          .map((sample) => Number(sample?.rmsLevelDb))
          .filter((value) => Number.isFinite(value)),
      )
      : null;
    const adaptivePhaseGain = roundAudioNumber(clamp(
      1 + (Math.pow(1 - phaseStrength, FOREGROUND_DUCK_KEY_WINDOW_GAIN_EXPONENT) * (MAX_FOREGROUND_DUCK_KEY_WINDOW_GAIN - 1)),
      1,
      MAX_FOREGROUND_DUCK_KEY_WINDOW_GAIN,
    ));
    const phaseCeilingGain = deriveForegroundDuckKeyGain({
      ceilingDb: phaseCeilingDb,
      peakDb: phasePeakDb,
      windowCount: 1,
      activeSampleCount: phaseSamples.length,
    });
    const resolvedPhaseGain = roundAudioNumber(Math.max(normalizedBaseGain, adaptivePhaseGain));
    const resolvedPhaseGainWithCeiling = roundAudioNumber(Math.max(resolvedPhaseGain, phaseCeilingGain));
    const fadeDuration = Math.max(
      MIN_FOREGROUND_DUCK_KEY_PHASE_FADE_SECONDS,
      Number(phaseWindow?.fadeDuration) || DEFAULT_ANALYSIS_FADE_DURATION_SECONDS,
    );

    automationPoints.push({
      time: roundAudioNumber(Math.max(0, phaseWindow.start - fadeDuration)),
      gain: 1,
    });
    automationPoints.push({
      time: roundAudioNumber(phaseWindow.start),
      gain: resolvedPhaseGainWithCeiling,
    });
    automationPoints.push({
      time: roundAudioNumber(phaseWindow.end),
      gain: resolvedPhaseGainWithCeiling,
    });
    automationPoints.push({
      time: roundAudioNumber(phaseWindow.end + fadeDuration),
      gain: 1,
    });
  });

  return automationPoints;
}

function buildAbsoluteTimeActivityMap(activitySamples = []) {
  const activityMap = new Map();

  (Array.isArray(activitySamples) ? activitySamples : []).forEach((sample) => {
    const timeValue = Number.isFinite(Number(sample?.time))
      ? roundAudioNumber(sample.time)
      : null;
    if (timeValue == null) {
      return;
    }

    const currentStrength = activityMap.get(timeValue) || 0;
    const nextStrength = clamp(sample?.strength, 0, 1);
    if (nextStrength > currentStrength) {
      activityMap.set(timeValue, roundAudioNumber(nextStrength));
    }
  });

  return activityMap;
}

function smoothGainSamples(gainSamples = [], sampleDurationSeconds = DEFAULT_ANALYSIS_WINDOW_SECONDS, duckedVolumeRatio = 0.08) {
  const resolvedSampleDuration = Math.max(0.01, Number(sampleDurationSeconds) || DEFAULT_ANALYSIS_WINDOW_SECONDS);
  const attackSeconds = 0.08;
  const releaseSeconds = 0.22;
  const maximumGainDelta = Math.max(0, 1 - Math.max(0, Number(duckedVolumeRatio) || 0));
  const attackStep = Math.max(0.02, maximumGainDelta * (resolvedSampleDuration / attackSeconds));
  const releaseStep = Math.max(0.02, maximumGainDelta * (resolvedSampleDuration / releaseSeconds));

  let currentGain = 1;
  return gainSamples.map((sample) => {
    const targetGain = clamp(sample?.gain, Math.max(0, Number(duckedVolumeRatio) || 0), 1);
    if (targetGain < currentGain) {
      currentGain = Math.max(targetGain, currentGain - attackStep);
    } else if (targetGain > currentGain) {
      currentGain = Math.min(targetGain, currentGain + releaseStep);
    }

    return {
      ...sample,
      gain: roundAudioNumber(currentGain),
    };
  });
}

function quantizeGain(gain, step = 0.025) {
  const resolvedStep = Math.max(0.005, Number(step) || 0.025);
  return roundAudioNumber(Math.round((Math.max(0, Number(gain) || 0)) / resolvedStep) * resolvedStep);
}

function buildAutomationPointsFromGainSamples(gainSamples = [], sampleDurationSeconds = DEFAULT_ANALYSIS_WINDOW_SECONDS) {
  if (!Array.isArray(gainSamples) || gainSamples.length === 0) {
    return [];
  }

  const resolvedSampleDuration = Math.max(0.01, Number(sampleDurationSeconds) || DEFAULT_ANALYSIS_WINDOW_SECONDS);
  const automationPoints = [{
    time: 0,
    gain: 1,
  }];

  let previousSample = null;
  let previousQuantizedGain = null;

  gainSamples.forEach((sample) => {
    const sampleTime = Number.isFinite(Number(sample?.time))
      ? Math.max(0, Number(sample.time))
      : null;
    if (sampleTime == null) {
      return;
    }

    const quantizedGain = quantizeGain(sample?.gain, 0.025);
    if (previousSample == null) {
      previousSample = { time: sampleTime, gain: quantizedGain };
      previousQuantizedGain = quantizedGain;
      automationPoints.push({
        time: sampleTime,
        gain: quantizedGain,
      });
      return;
    }

    if (Math.abs(quantizedGain - previousQuantizedGain) >= 0.02) {
      automationPoints.push(
        { time: sampleTime, gain: previousQuantizedGain },
        { time: sampleTime, gain: quantizedGain },
      );
      previousQuantizedGain = quantizedGain;
    }

    previousSample = { time: sampleTime, gain: quantizedGain };
  });

  if (previousSample) {
    automationPoints.push({
      time: roundAudioNumber(previousSample.time + resolvedSampleDuration),
      gain: previousSample.gain,
    });
  }

  const dedupedPoints = [];
  for (const point of automationPoints) {
    const normalizedTime = Number.isFinite(Number(point?.time))
      ? Math.max(0, Number(point.time))
      : 0;
    const normalizedGain = clamp(point?.gain, 0, 1);
    const previousPoint = dedupedPoints[dedupedPoints.length - 1];
    if (
      previousPoint
      && Math.abs(previousPoint.time - normalizedTime) < 0.0001
      && Math.abs(previousPoint.gain - normalizedGain) < 0.0001
    ) {
      continue;
    }

    dedupedPoints.push({
      time: roundAudioNumber(normalizedTime),
      gain: roundAudioNumber(normalizedGain),
    });
  }

  return dedupedPoints;
}

export function buildMusicDuckingAutomationFromActivity({
  foregroundActivitySamples = [],
  musicActivitySamples = [],
  sampleDurationSeconds = DEFAULT_ANALYSIS_WINDOW_SECONDS,
  duckedVolumeRatio = 0.08,
} = {}) {
  const resolvedSampleDuration = Math.max(0.01, Number(sampleDurationSeconds) || DEFAULT_ANALYSIS_WINDOW_SECONDS);
  const foregroundActivityMap = buildAbsoluteTimeActivityMap(foregroundActivitySamples);
  const gainSamples = smoothGainSamples(
    (Array.isArray(musicActivitySamples) ? musicActivitySamples : []).map((sample) => {
      const sampleTime = Number.isFinite(Number(sample?.time))
        ? roundAudioNumber(sample.time)
        : null;
      const foregroundStrength = sampleTime != null
        ? clamp(foregroundActivityMap.get(sampleTime) || 0, 0, 1)
        : 0;
      const duckStrength = clamp(foregroundStrength, 0, 1);
      const targetGain = 1 - (duckStrength * (1 - Math.max(0, Number(duckedVolumeRatio) || 0)));

      return {
        time: sample?.time,
        gain: duckStrength < 0.04 ? 1 : targetGain,
      };
    }),
    resolvedSampleDuration,
    duckedVolumeRatio,
  );
  const automationPoints = buildAutomationPointsFromGainSamples(gainSamples, resolvedSampleDuration);
  const minimumGain = gainSamples.reduce(
    (lowestGain, sample) => Math.min(lowestGain, Number(sample?.gain) || 1),
    1,
  );

  return {
    points: automationPoints,
    pointCount: automationPoints.length,
    minimumGain: roundAudioNumber(minimumGain),
    sampleDurationSeconds: resolvedSampleDuration,
  };
}

function buildMusicDuckingAutomationFromWindows({
  duckingWindows = [],
  duckedVolumeRatio = 0.08,
} = {}) {
  const normalizedDuckingWindows = normalizeDuckingWindowsForExpression(duckingWindows);
  if (!Array.isArray(normalizedDuckingWindows) || normalizedDuckingWindows.length === 0) {
    return {
      points: [],
      pointCount: 0,
      minimumGain: 1,
    };
  }

  const duckedRatio = clamp(duckedVolumeRatio, 0, 1);
  const automationPoints = [{
    time: 0,
    gain: 1,
  }];

  normalizedDuckingWindows.forEach((duckingWindow) => {
    const fadeDuration = Number.isFinite(Number(duckingWindow?.fadeDuration))
      ? Math.max(0, Number(duckingWindow.fadeDuration))
      : 0;
    const duckStart = Number.isFinite(Number(duckingWindow?.start))
      ? Math.max(0, Number(duckingWindow.start))
      : 0;
    const duckEnd = Number.isFinite(Number(duckingWindow?.end))
      ? Math.max(duckStart, Number(duckingWindow.end))
      : duckStart;

    if (duckEnd <= duckStart) {
      return;
    }

    if (fadeDuration > 0) {
      automationPoints.push(
        { time: Math.max(0, duckStart - fadeDuration), gain: 1 },
        { time: duckStart, gain: duckedRatio },
        { time: duckEnd, gain: duckedRatio },
        { time: duckEnd + fadeDuration, gain: 1 },
      );
      return;
    }

    automationPoints.push(
      { time: duckStart, gain: 1 },
      { time: duckStart, gain: duckedRatio },
      { time: duckEnd, gain: duckedRatio },
      { time: duckEnd, gain: 1 },
    );
  });

  const dedupedPoints = [];
  automationPoints.forEach((point) => {
    const normalizedTime = Number.isFinite(Number(point?.time))
      ? Math.max(0, Number(point.time))
      : 0;
    const normalizedGain = clamp(point?.gain, 0, 1);
    const previousPoint = dedupedPoints[dedupedPoints.length - 1];
    if (
      previousPoint
      && Math.abs(previousPoint.time - normalizedTime) < 0.0001
      && Math.abs(previousPoint.gain - normalizedGain) < 0.0001
    ) {
      return;
    }

    dedupedPoints.push({
      time: roundAudioNumber(normalizedTime),
      gain: roundAudioNumber(normalizedGain),
    });
  });

  return {
    points: dedupedPoints,
    pointCount: dedupedPoints.length,
    minimumGain: duckedRatio,
  };
}

async function analyzeSingleAudioTrackSignal(audioTrack = {}) {
  const timelineStartTime = Number.isFinite(Number(audioTrack?.startTime))
    ? Math.max(0, Number(audioTrack.startTime))
    : 0;
  const timelineEndTime = Number.isFinite(Number(audioTrack?.endTime))
    ? Math.max(timelineStartTime, Number(audioTrack.endTime))
    : timelineStartTime;
  const sourceTrimDuration = Math.max(0, timelineEndTime - timelineStartTime);
  if (sourceTrimDuration <= 0 || !audioTrack?.path) {
    return {
      windows: [],
      activitySamples: [],
      sampleDurationSeconds: DEFAULT_ANALYSIS_WINDOW_SECONDS,
      analysisMode: 'empty',
    };
  }

  const sourceTrimStartTime = Number.isFinite(Number(audioTrack?.sourceTrimStartTime))
    ? Math.max(0, Number(audioTrack.sourceTrimStartTime))
    : 0;

  try {
    const { output, profile } = await runFFmpegRmsMetadataAnalysis({
      audioPath: audioTrack.path,
      sourceTrimStartTime,
      sourceTrimDuration,
      audioType: audioTrack.type,
      audioTrack,
    });
    const rmsSamples = parseAstatsRmsMetadataOutput(output);
    const signalStrength = buildNormalizedRmsStrengthSamples({
      rmsSamples,
      durationSeconds: sourceTrimDuration,
      timelineStartTime,
      sampleDurationSeconds: profile.analysisWindowSeconds,
      profile,
    });

    const rmsWindows = buildDuckingWindowsFromRmsAnalysis({
      durationSeconds: sourceTrimDuration,
      rmsSamples,
      sampleDurationSeconds: profile.analysisWindowSeconds,
      timelineStartTime,
      preRollSeconds: profile.preRollSeconds,
      postRollSeconds: profile.postRollSeconds,
      mergeGapSeconds: profile.mergeGapSeconds,
      minimumWindowSeconds: profile.minimumWindowSeconds,
      fadeDurationSeconds: profile.fadeDurationSeconds,
      profile,
    });

    if (rmsWindows.length > 0) {
      return {
        windows: rmsWindows,
        activitySamples: signalStrength.samples,
        sampleDurationSeconds: signalStrength.sampleDurationSeconds,
        thresholdDb: signalStrength.thresholdDb,
        floorDb: signalStrength.floorDb,
        ceilingDb: signalStrength.ceilingDb,
        peakDb: signalStrength.peakDb,
        analysisMode: profile.profileKind === 'synthetic_speech' ? 'rms_activity_synthetic_speech' : 'rms_activity',
      };
    }

  } catch (error) {
    console.error('Granular RMS ducking analysis failed; trying silencedetect fallback', {
      audioPath: audioTrack?.path ?? null,
      audioType: audioTrack?.type ?? null,
      audioLayerId: audioTrack?.audioLayerId ?? null,
      error: error?.message || error,
    });
  }

  try {
    const { output, profile } = await runFFmpegSilenceDetect({
      audioPath: audioTrack.path,
      sourceTrimStartTime,
      sourceTrimDuration,
      audioType: audioTrack.type,
      audioTrack,
    });
    const { silenceIntervals, trailingSilenceStart } = parseSilenceDetectOutput(output);
    const fallbackWindows = buildDuckingWindowsFromSilenceAnalysis({
      durationSeconds: sourceTrimDuration,
      silenceIntervals,
      trailingSilenceStart,
      timelineStartTime,
      preRollSeconds: profile.preRollSeconds,
      postRollSeconds: profile.postRollSeconds,
      mergeGapSeconds: profile.mergeGapSeconds,
      minimumWindowSeconds: profile.minimumWindowSeconds,
      fadeDurationSeconds: profile.fadeDurationSeconds,
    });

    return {
      windows: fallbackWindows,
      activitySamples: buildActivitySamplesFromWindows(fallbackWindows, profile.analysisWindowSeconds),
      sampleDurationSeconds: profile.analysisWindowSeconds,
      analysisMode: profile.profileKind === 'synthetic_speech' ? 'silencedetect_synthetic_speech' : 'silencedetect',
    };
  } catch (error) {
    const fallbackProfile = resolveAudioAnalysisProfile(audioTrack?.type, audioTrack);
    const fallbackWindowDuration = timelineEndTime - timelineStartTime;
    if (fallbackWindowDuration <= 0) {
      return {
        windows: [],
        activitySamples: [],
        sampleDurationSeconds: fallbackProfile.analysisWindowSeconds,
        analysisMode: 'empty',
      };
    }

    console.error('Falling back to duration-based ducking for audio track analysis', {
      audioPath: audioTrack?.path ?? null,
      audioType: audioTrack?.type ?? null,
      audioLayerId: audioTrack?.audioLayerId ?? null,
      error: error?.message || error,
    });

    const fallbackWindows = [{
      start: roundAudioNumber(timelineStartTime),
      end: roundAudioNumber(timelineEndTime),
      fadeDuration: roundAudioNumber(Math.min(fallbackProfile.fadeDurationSeconds, fallbackWindowDuration / 2)),
    }];

    return {
      windows: fallbackWindows,
      activitySamples: buildActivitySamplesFromWindows(fallbackWindows, fallbackProfile.analysisWindowSeconds),
      sampleDurationSeconds: fallbackProfile.analysisWindowSeconds,
      analysisMode: 'duration_fallback',
    };
  }
}

export async function buildStudioAudioDuckingPlan(audioTracks = [], duckedVolumeRatio = 0.08) {
  const allTracks = Array.isArray(audioTracks) ? audioTracks : [];
  const foregroundTracks = allTracks.filter((audioTrack) => isForegroundDuckingTrack(audioTrack));
  const musicTrackIds = allTracks
    .filter((audioTrack) => isMusicDuckingTargetTrack(audioTrack))
    .map((audioTrack) => audioTrack?.audioLayerId?.toString?.() ?? audioTrack?.audioLayerId ?? null)
    .filter(Boolean);

  if (foregroundTracks.length === 0 && musicTrackIds.length === 0) {
    return {
      analysisMode: 'empty',
      windows: [],
      duckTargetTrackIds: [],
    };
  }

  const perTrackWindows = [];
  for (const foregroundTrack of foregroundTracks) {
    const trackAnalysis = await analyzeSingleAudioTrackSignal(foregroundTrack);
    if (trackAnalysis.windows.length > 0) {
      perTrackWindows.push(...trackAnalysis.windows);
    }
  }

  const mergedWindows = mergeDuckingWindows(perTrackWindows, DEFAULT_WINDOW_MERGE_GAP_SECONDS);

  return {
    analysisMode: 'speech_window_envelope',
    windows: mergedWindows,
    duckTargetTrackIds: musicTrackIds,
    duckedVolumeRatio: clamp(duckedVolumeRatio, 0, 1),
  };
}

export async function buildStudioAudioDuckingWindows(audioTracks = []) {
  const duckingPlan = await buildStudioAudioDuckingPlan(audioTracks);
  return duckingPlan.windows;
}

export async function buildStudioForegroundDuckKeyProfiles(audioTracks = []) {
  const foregroundTracks = (Array.isArray(audioTracks) ? audioTracks : [])
    .filter((audioTrack) => isForegroundDuckingTrack(audioTrack));

  if (foregroundTracks.length === 0) {
    return {
      analysisMode: 'empty',
      windows: [],
      tracks: [],
    };
  }

  const analyzedTracks = await Promise.all(
    foregroundTracks.map(async (foregroundTrack) => {
      const trackAnalysis = await analyzeSingleAudioTrackSignal(foregroundTrack);
      const activeSampleCount = (Array.isArray(trackAnalysis.activitySamples) ? trackAnalysis.activitySamples : [])
        .filter((sample) => clamp(sample?.strength, 0, 1) > 0.08)
        .length;

      return {
        audioLayerId: foregroundTrack?.audioLayerId?.toString?.() ?? foregroundTrack?.audioLayerId ?? null,
        windows: Array.isArray(trackAnalysis.windows) ? trackAnalysis.windows : [],
        duckKeyGain: deriveForegroundDuckKeyGain({
          ceilingDb: trackAnalysis.ceilingDb,
          peakDb: trackAnalysis.peakDb,
          windowCount: Array.isArray(trackAnalysis.windows) ? trackAnalysis.windows.length : 0,
          activeSampleCount,
        }),
        duckKeyAutomationPoints: buildForegroundDuckKeyAutomationPoints({
          windows: trackAnalysis.windows,
          activitySamples: trackAnalysis.activitySamples,
          baseDuckKeyGain: deriveForegroundDuckKeyGain({
            ceilingDb: trackAnalysis.ceilingDb,
            peakDb: trackAnalysis.peakDb,
            windowCount: Array.isArray(trackAnalysis.windows) ? trackAnalysis.windows.length : 0,
            activeSampleCount,
          }),
        }),
        ceilingDb: isPresentFiniteAudioNumber(trackAnalysis.ceilingDb) ? roundAudioNumber(trackAnalysis.ceilingDb) : null,
        peakDb: isPresentFiniteAudioNumber(trackAnalysis.peakDb) ? roundAudioNumber(trackAnalysis.peakDb) : null,
        thresholdDb: isPresentFiniteAudioNumber(trackAnalysis.thresholdDb) ? roundAudioNumber(trackAnalysis.thresholdDb) : null,
        windowCount: Array.isArray(trackAnalysis.windows) ? trackAnalysis.windows.length : 0,
        activeSampleCount,
        analysisMode: trackAnalysis.analysisMode ?? 'unknown',
      };
    }),
  );
  const mergedWindows = mergeDuckingWindows(
    analyzedTracks.flatMap((track) => Array.isArray(track?.windows) ? track.windows : []),
    DEFAULT_WINDOW_MERGE_GAP_SECONDS,
  );

  return {
    analysisMode: 'foreground_rms_sidechain',
    windows: mergedWindows,
    tracks: analyzedTracks
      .filter((track) => track.audioLayerId)
      .map(({ windows, ...track }) => track),
  };
}
