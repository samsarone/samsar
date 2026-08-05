import assert from 'node:assert/strict';
import test from 'node:test';

import { getSeedanceImageToVideoLink } from './SeeDanceListener.js';

test('FAL Seedance adapter selects the exact endpoint for each supported I2V model', () => {
  assert.equal(
    getSeedanceImageToVideoLink('SEEDANCEI2V'),
    'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
  );
  assert.equal(
    getSeedanceImageToVideoLink('SEEDANCE2.0I2V'),
    'bytedance/seedance-2.0/image-to-video',
  );
});

test('FAL Seedance adapter rejects unknown model keys', () => {
  assert.throws(
    () => getSeedanceImageToVideoLink('SEEDANCE_FUTURE'),
    (error) => error?.code === 'FAL_MODEL_UNSUPPORTED',
  );
});
