import { getCanvasDimensionsForAspectRatio } from './CanvasUtils.js';

const SUPPORTED_TARGET_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16']);

export function getOrientationForDimensions(dimensions = {}) {
  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '';
  }

  const ratio = width / height;
  if (ratio > 1.05) return 'landscape';
  if (ratio < 0.95) return 'portrait';
  return 'square';
}

export function getAspectRatioMismatchDetails(dimensions = {}, requestedAspectRatio = '') {
  const targetAspectRatio = typeof requestedAspectRatio === 'string'
    ? requestedAspectRatio.trim()
    : '';
  if (!SUPPORTED_TARGET_ASPECT_RATIOS.has(targetAspectRatio)) {
    return null;
  }

  const targetDimensions = getCanvasDimensionsForAspectRatio(targetAspectRatio);
  const expectedOrientation = getOrientationForDimensions(targetDimensions);
  const actualOrientation = getOrientationForDimensions(dimensions);

  if (!expectedOrientation || !actualOrientation || expectedOrientation === actualOrientation) {
    return null;
  }

  return {
    requestedAspectRatio: targetAspectRatio,
    expectedOrientation,
    actualOrientation,
    width: Number(dimensions.width),
    height: Number(dimensions.height),
  };
}

export function formatAspectRatioMismatchMessage(details = {}) {
  return [
    `Generated image aspect ratio mismatch: requested ${details.requestedAspectRatio} ${details.expectedOrientation}`,
    `but provider returned ${details.width}x${details.height} ${details.actualOrientation}.`,
    'Rejecting this Google native NanoBanana Pro output and retrying instead of cropping or rotating it.',
  ].join(' ');
}
