import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getStandaloneInitialEditorPath,
  hasConfiguredStandaloneTextToVideoPipeline,
} from './standaloneInitialRoute.mjs';

const completePipeline = {
  inferenceModelValues: ['gpt-5.6-sol'],
  textToVideoImageModelValues: ['GPTIMAGE2'],
  textToVideoVideoModelValues: ['SEEDANCE2.0I2V'],
};

test('standalone text-to-video readiness requires inference, image, and video models', () => {
  assert.equal(hasConfiguredStandaloneTextToVideoPipeline(completePipeline), true);

  for (const missingField of Object.keys(completePipeline)) {
    assert.equal(hasConfiguredStandaloneTextToVideoPipeline({
      ...completePipeline,
      [missingField]: [],
    }), false, missingField);
  }
});

test('standalone desktop opens Vidgenie only for a complete text-to-video pipeline', () => {
  assert.equal(getStandaloneInitialEditorPath({
    isStandaloneDeployment: true,
    hasTextToVideoPipeline: true,
  }), '/vidgenie');
  assert.equal(getStandaloneInitialEditorPath({
    isStandaloneDeployment: true,
    hasTextToVideoPipeline: false,
  }), '/video');
});

test('hosted and mobile entry behavior remains Vidgenie', () => {
  assert.equal(getStandaloneInitialEditorPath(), '/vidgenie');
  assert.equal(getStandaloneInitialEditorPath({
    isStandaloneDeployment: true,
    isMobile: true,
  }), '/vidgenie');
});
