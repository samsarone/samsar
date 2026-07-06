export const FINAL_RENDER_AUDIO_GAIN = 1.5;
export const FINAL_RENDER_AUDIO_PEAK_LIMIT = 0.95;
export const FINAL_RENDER_AUDIO_LIMIT_ATTACK_MS = 5;
export const FINAL_RENDER_AUDIO_LIMIT_RELEASE_MS = 50;

function defaultFormatFFmpegNumber(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }
  return `${Number(numericValue.toFixed(4))}`;
}

function resolvePositiveFiniteNumber(value, fallbackValue) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallbackValue;
  }
  return numericValue;
}

export function buildFinalAudioMixFilter({
  inputLabels = [],
  duration,
  outputLabel = 'aout',
  formatNumber = defaultFormatFFmpegNumber,
  finalRenderAudioGain = FINAL_RENDER_AUDIO_GAIN,
  finalRenderAudioPeakLimit = FINAL_RENDER_AUDIO_PEAK_LIMIT,
} = {}) {
  const labels = Array.isArray(inputLabels)
    ? inputLabels
      .filter((label) => typeof label === 'string' && label.trim())
      .map((label) => label.trim())
    : [];

  if (labels.length === 0) {
    return '';
  }

  const resolvedDuration = Math.max(0, Number(duration) || 0);
  const resolvedOutputLabel = typeof outputLabel === 'string' && outputLabel.trim()
    ? outputLabel.trim()
    : 'aout';
  const resolvedFinalRenderAudioGain = resolvePositiveFiniteNumber(
    finalRenderAudioGain,
    FINAL_RENDER_AUDIO_GAIN
  );
  const resolvedFinalRenderAudioPeakLimit = resolvePositiveFiniteNumber(
    finalRenderAudioPeakLimit,
    FINAL_RENDER_AUDIO_PEAK_LIMIT
  );

  return (
    `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
    `volume=${formatNumber(resolvedFinalRenderAudioGain)},` +
    `alimiter=limit=${formatNumber(resolvedFinalRenderAudioPeakLimit)}:` +
    `attack=${formatNumber(FINAL_RENDER_AUDIO_LIMIT_ATTACK_MS)}:` +
    `release=${formatNumber(FINAL_RENDER_AUDIO_LIMIT_RELEASE_MS)}:level=0:latency=1,` +
    `aresample=async=1:first_pts=0,apad,atrim=duration=${formatNumber(resolvedDuration)},` +
    `asetpts=N/SR/TB[${resolvedOutputLabel}]`
  );
}
