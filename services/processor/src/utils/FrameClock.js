// Keep the default frame-clock contract compatible with independently deployed workers.
// Seconds are an interchange value; only integer frame boundaries are rounded.
export function secondsToFrameCount(seconds, framesPerSecond = 24) {
  const value = Number(seconds);
  const rate = Number(framesPerSecond);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.max(0, Math.round(value * rate));
}

export function frameCountToSeconds(frameCount, framesPerSecond = 24) {
  const count = Number(frameCount);
  const rate = Number(framesPerSecond);
  if (!Number.isFinite(count) || count < 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(count) / rate;
}

export function getLayerFrameRange(layer = {}, framesPerSecond = 24) {
  const offset = Math.max(0, Number(layer.durationOffset) || 0);
  const duration = Math.max(0, Number(layer.duration) || 0);
  const startFrame = secondsToFrameCount(offset, framesPerSecond);
  // Quantize absolute boundaries, so fractional scene durations cannot accumulate drift.
  const endFrame = Math.max(startFrame + (duration > 0 ? 1 : 0),
    secondsToFrameCount(offset + duration, framesPerSecond));
  return { startFrame, endFrame, frameCount: endFrame - startFrame };
}

export function buildFrameExtractionFilter(framesPerSecond, scaleFilter) {
  const rate = Number(framesPerSecond);
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError('A positive frame rate is required');
  // The EOF uses the same nearest-frame boundary as duration metadata everywhere.
  return `setpts=PTS-STARTPTS,fps=${rate}:start_time=0:round=near:eof_action=round${scaleFilter ? `,${scaleFilter}` : ''}`;
}
