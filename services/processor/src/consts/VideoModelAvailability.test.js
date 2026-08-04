import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertVideoModelEnabled,
  isVideoModelTemporarilyDisabled,
} from './VideoModelAvailability.js';

test('Seedance 2.0 image-to-video is temporarily disabled', () => {
  assert.equal(isVideoModelTemporarilyDisabled('SEEDANCE2.0I2V'), true);
  assert.equal(isVideoModelTemporarilyDisabled('seedance2.0i2v'), true);
  assert.equal(isVideoModelTemporarilyDisabled('SEEDANCEI2V'), false);
});

test('disabled video models are rejected with a public request error', () => {
  assert.throws(
    () => assertVideoModelEnabled('SEEDANCE2.0I2V'),
    (error) => (
      error?.status === 400 &&
      error?.code === 'VIDEO_MODEL_TEMPORARILY_DISABLED'
    ),
  );
  assert.doesNotThrow(() => assertVideoModelEnabled('SEEDANCEI2V'));
});
