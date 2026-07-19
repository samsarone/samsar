import test from 'node:test';
import assert from 'node:assert/strict';

import { __testOnly__ } from './main.js';

test('frame generation failure payload blocks final render and marks the layer failed', () => {
  const setPayload = __testOnly__.buildFrameGenerationFailureSet({
    layerIndex: 2,
    message: 'Missing ai_video video file for layer layer-1 in session session-1',
  });

  assert.equal(setPayload.frameGenerationPending, false);
  assert.equal(setPayload.videoGenerationPending, false);
  assert.equal(setPayload.expressGenerationPending, false);
  assert.equal(setPayload.expressGenerationFailed, true);
  assert.equal(setPayload.expressGenerationError, 'Missing ai_video video file for layer layer-1 in session session-1');
  assert.equal(setPayload.generationError, 'Missing ai_video video file for layer layer-1 in session session-1');
  assert.equal(setPayload['expressGenerationStatus.frame_generation'], 'FAILED');
  assert.equal(setPayload['expressGenerationStatus.video_generation'], 'FAILED');
  assert.equal(setPayload['expressGenerationStatus.status'], 'FAILED');
  assert.equal(setPayload['layers.2.frameGenerationPending'], false);
  assert.equal(setPayload['layers.2.frameGenerationError'], 'Missing ai_video video file for layer layer-1 in session session-1');
});

test('frame generation failure payload works without a resolved layer index', () => {
  const setPayload = __testOnly__.buildFrameGenerationFailureSet({
    layerIndex: -1,
    message: 'Frame generation failed',
  });

  assert.equal(setPayload['layers.-1.frameGenerationPending'], undefined);
  assert.equal(setPayload['expressGenerationStatus.frame_generation'], 'FAILED');
});

test('branched frame failure is scoped to one render path and preserves overall pending state', () => {
  const setPayload = __testOnly__.buildBranchFrameGenerationFailureSet({
    pathIndex: 1,
    pathSequenceIndex: 2,
    message: 'Branch frame failed',
    hasRemainingFrameGenerations: true,
    timeline: [
      {
        sequenceIndex: 0,
        frameGenerationPending: false,
        frameGenerationStatus: 'COMPLETED',
        frames: ['/frame-0.png'],
      },
      {
        sequenceIndex: 1,
        frameGenerationPending: true,
        frameGenerationStatus: 'GENERATING',
      },
      {
        sequenceIndex: 2,
        frameGenerationPending: true,
        frameGenerationStatus: 'GENERATING',
      },
    ],
  });

  assert.equal(setPayload.frameGenerationPending, true);
  assert.equal(setPayload['branchRenderPaths.1.frameGenerationStatus'], 'FAILED');
  assert.equal(setPayload['branchRenderPaths.1.frameGenerationPending'], false);
  assert.equal(setPayload['branchRenderPaths.1.timeline'][0].frameGenerationStatus, 'COMPLETED');
  assert.equal(setPayload['branchRenderPaths.1.timeline'][1].frameGenerationStatus, 'CANCELLED');
  assert.equal(setPayload['branchRenderPaths.1.timeline'][2].frameGenerationStatus, 'FAILED');
  assert.equal(setPayload['branchRenderPaths.1.timeline'][2].frameGenerationError, 'Branch frame failed');
  assert.equal(setPayload['branchRenderPaths.1.timeline'][2].error, 'Branch frame failed');
  assert.equal(setPayload['expressGenerationStatus.status'], 'FAILED');
});
