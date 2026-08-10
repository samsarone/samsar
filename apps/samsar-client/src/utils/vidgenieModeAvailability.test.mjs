import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIDGENIE_I2V_REQUIRED_IMAGE_EDIT_MODEL,
  VIDGENIE_I2V_STANDALONE_ADAPTER_KEYS,
  isVidgenieImageToVideoModeAvailable,
} from './vidgenieModeAvailability.mjs';

test('hosted Vidgenie preserves image-to-video availability', () => {
  assert.equal(isVidgenieImageToVideoModeAvailable(), true);
  assert.equal(isVidgenieImageToVideoModeAvailable({
    isStandaloneDeployment: false,
    imageEditModelValues: [],
    primaryAdapterByModel: {},
  }), true);
});

test('standalone Vidgenie requires NanoBanana Pro Edit and an allowed adapter', () => {
  assert.equal(VIDGENIE_I2V_REQUIRED_IMAGE_EDIT_MODEL, 'NANOBANANAPROEDIT');
  assert.deepEqual(VIDGENIE_I2V_STANDALONE_ADAPTER_KEYS, [
    'googleCloud',
    'fal',
    'gmicloud',
    'samsar',
  ]);

  for (const adapter of ['googleCloud', 'fal', 'gmicloud', 'samsar']) {
    assert.equal(isVidgenieImageToVideoModeAvailable({
      isStandaloneDeployment: true,
      imageEditModelValues: ['NANOBANANAPROEDIT'],
      primaryAdapterByModel: { NANOBANANAPROEDIT: adapter },
    }), true, adapter);
  }
});

test('standalone Vidgenie accepts native adapter presentation aliases', () => {
  for (const adapter of ['Google Cloud', 'fal.ai', 'GenBlaze', 'Samsar-js']) {
    assert.equal(isVidgenieImageToVideoModeAvailable({
      isStandaloneDeployment: true,
      imageEditModelValues: [{ key: 'nano-banana-pro-edit' }],
      primaryAdapterByModel: { 'nano-banana-pro-edit': adapter },
    }), true, adapter);
  }
});

test('standalone Vidgenie fails closed for missing or unsupported edit adapters', () => {
  assert.equal(isVidgenieImageToVideoModeAvailable({
    isStandaloneDeployment: true,
    imageEditModelValues: [],
    primaryAdapterByModel: { NANOBANANAPROEDIT: 'googleCloud' },
  }), false);

  for (const adapter of ['', 'alibabaCloud', 'openai', 'custom']) {
    assert.equal(isVidgenieImageToVideoModeAvailable({
      isStandaloneDeployment: true,
      imageEditModelValues: ['NANOBANANAPROEDIT'],
      primaryAdapterByModel: adapter ? { NANOBANANAPROEDIT: adapter } : {},
    }), false, adapter || 'missing adapter');
  }
});
