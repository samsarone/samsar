import test from 'node:test';
import assert from 'node:assert/strict';

import {
  areAllBranchPathVideosComplete,
  getDefaultBranchRenderPath,
  getRepairableBranchRenderPaths,
  resolveBranchRenderContext,
  sanitizeBranchRenderPathSegment,
} from './BranchRenderPlan.js';

function buildSession() {
  return {
    narrativeType: 'branched',
    renderPlanVersion: 1,
    defaultBranchPathId: 'root.1',
    layers: [
      { _id: 'layer-shared', prompt: 'Shared', duration: 9, durationOffset: 99 },
      { _id: 'layer-a', prompt: 'A', duration: 9, durationOffset: 99 },
      { _id: 'layer-b', prompt: 'B', duration: 9, durationOffset: 99 },
    ],
    audioLayers: [
      { _id: 'audio-a', connectedLayerId: 'layer-a', generationType: 'speech', isEnabled: true },
      { _id: 'audio-b', connectedLayerId: 'layer-b', generationType: 'speech', isEnabled: true },
      { _id: 'music', generationType: 'music', defaultSelected: true },
    ],
    branchRenderPaths: [
      {
        pathId: 'root.1',
        duration: 6,
        timeline: [
          { sequenceIndex: 0, layerId: 'layer-shared', duration: 3, durationOffset: 0, frames: ['0.png'] },
          { sequenceIndex: 1, layerId: 'layer-a', duration: 3, durationOffset: 3, frames: ['0.png'] },
        ],
        audioTimeline: [
          { audioLayerId: 'audio-a', connectedLayerId: 'layer-a', startTime: 3, endTime: 6, duration: 3 },
        ],
        frameGenerationStatus: 'COMPLETED',
        videoGenerationStatus: 'PENDING',
      },
      {
        pathId: 'root.2',
        duration: 6,
        timeline: [
          { sequenceIndex: 0, layerId: 'layer-shared', duration: 3, durationOffset: 0, frames: ['0.png'] },
          { sequenceIndex: 1, layerId: 'layer-b', duration: 3, durationOffset: 3, frames: ['0.png'] },
        ],
        audioTimeline: [
          { audioLayerId: 'audio-b', connectedLayerId: 'layer-b', startTime: 3, endTime: 6, duration: 3 },
        ],
        frameGenerationStatus: 'COMPLETED',
        videoGenerationStatus: 'PENDING',
      },
    ],
  };
}

test('resolves only the selected path and overlays its effective timing', () => {
  const context = resolveBranchRenderContext(buildSession(), 'root.1');

  assert.equal(context.duration, 6);
  assert.deepEqual(context.layers.map((layer) => layer.prompt), ['Shared', 'A']);
  assert.deepEqual(context.layers.map((layer) => layer.durationOffset), [0, 3]);
  assert.deepEqual(context.audioLayers.map((layer) => layer.audioLayerId), ['audio-a', 'music']);
  assert.equal(context.audioLayers[0].startTime, 3);
});

test('rejects unknown paths and makes path ids filesystem-safe', () => {
  assert.throws(() => resolveBranchRenderContext(buildSession(), 'root.3'), /Unknown branch render path/);
  assert.equal(sanitizeBranchRenderPathSegment('root.1'), 'path-cm9vdC4x');
  assert.equal(sanitizeBranchRenderPathSegment('../root/1'), 'path-Li4vcm9vdC8x');
});

test('repairs every ready unfinished path without treating one result as aggregate completion', () => {
  const session = buildSession();
  session.branchRenderPaths[0].videoLink = 'assets_v2/video/root.1.mp4';
  session.branchRenderPaths[0].remoteURL = 'https://cdn/root.1.mp4';
  session.branchRenderPaths[0].videoGenerationStatus = 'COMPLETED';

  assert.deepEqual(
    getRepairableBranchRenderPaths(session).map((renderPath) => renderPath.pathId),
    ['root.2'],
  );
  assert.equal(areAllBranchPathVideosComplete(session), false);

  session.branchRenderPaths[1].videoLink = 'assets_v2/video/root.2.mp4';
  session.branchRenderPaths[1].videoGenerationStatus = 'COMPLETED';
  assert.equal(areAllBranchPathVideosComplete(session), true);
  assert.equal(getDefaultBranchRenderPath(session).pathId, 'root.1');
});
