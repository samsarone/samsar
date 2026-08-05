import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertVideoModelEnabled,
  isVideoModelTemporarilyDisabled,
} from './VideoModelAvailability.js';

test('Seedance 2.0 image-to-video is enabled again', () => {
  assert.equal(isVideoModelTemporarilyDisabled('SEEDANCE2.0I2V'), false);
  assert.equal(isVideoModelTemporarilyDisabled('seedance2.0i2v'), false);
  assert.equal(isVideoModelTemporarilyDisabled('SEEDANCEI2V'), false);
});

test('enabled video models pass the public request guard', () => {
  assert.doesNotThrow(() => assertVideoModelEnabled('SEEDANCE2.0I2V'));
  assert.doesNotThrow(() => assertVideoModelEnabled('SEEDANCEI2V'));
});
