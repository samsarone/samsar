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

export function resolveFramesPerSecond(value) {
  return normalizeFramesPerSecond(value) ?? DEFAULT_FRAMES_PER_SECOND;
}

export function getFramesPerSecondFromValue(value) {
  return resolveFramesPerSecond(value);
}

export function getSessionFramesPerSecond(sessionData, source = 'unknown') {
  const rawValue = sessionData?.framesPerSecond;
  const resolved = resolveFramesPerSecond(rawValue);
  const sessionId = sessionData?._id?.toString?.() ?? sessionData?._id ?? null;
  return resolved;
}

export { DEFAULT_FRAMES_PER_SECOND };
