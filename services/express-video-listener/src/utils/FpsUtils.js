const DEFAULT_FRAMES_PER_SECOND = 24;
const VALID_FRAMES_PER_SECOND = new Set([16, 24, 30]);

export function normalizeFramesPerSecond(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.round(parsed);
  if (!VALID_FRAMES_PER_SECOND.has(rounded)) {
    return null;
  }
  return rounded;
}

export function resolveFramesPerSecond(videoSession, userData) {
  return (
    normalizeFramesPerSecond(videoSession?.framesPerSecond) ??
    normalizeFramesPerSecond(userData?.videoFramesPerSecond) ??
    DEFAULT_FRAMES_PER_SECOND
  );
}

export function getFramesPerSecondFromValue(value) {
  return normalizeFramesPerSecond(value) ?? DEFAULT_FRAMES_PER_SECOND;
}

export { DEFAULT_FRAMES_PER_SECOND };
