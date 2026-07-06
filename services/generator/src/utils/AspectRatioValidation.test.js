import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatAspectRatioMismatchMessage,
  getAspectRatioMismatchDetails,
  getOrientationForDimensions,
} from './AspectRatioValidation.js';

test('detects clear portrait versus landscape aspect ratio mismatch', () => {
  const details = getAspectRatioMismatchDetails({ width: 1792, height: 1024 }, '9:16');

  assert.equal(details.requestedAspectRatio, '9:16');
  assert.equal(details.expectedOrientation, 'portrait');
  assert.equal(details.actualOrientation, 'landscape');
  assert.match(formatAspectRatioMismatchMessage(details), /Rejecting this Google native NanoBanana Pro output/);
});

test('allows matching orientation even when dimensions are not exact canvas dimensions', () => {
  assert.equal(getAspectRatioMismatchDetails({ width: 1024, height: 1536 }, '9:16'), null);
  assert.equal(getAspectRatioMismatchDetails({ width: 1536, height: 1024 }, '16:9'), null);
});

test('classifies square, portrait, and landscape dimensions', () => {
  assert.equal(getOrientationForDimensions({ width: 1024, height: 1024 }), 'square');
  assert.equal(getOrientationForDimensions({ width: 1024, height: 1792 }), 'portrait');
  assert.equal(getOrientationForDimensions({ width: 1792, height: 1024 }), 'landscape');
});
