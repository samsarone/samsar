import assert from 'node:assert/strict';
import test from 'node:test';

import VideoSession from './VideoSession.js';

test('VideoSession declares reusable NarrativeRequest source artifacts', () => {
  const paths = VideoSession.schema.paths;

  assert.equal(paths.sourceNarrativeRequestId.instance, 'ObjectId');
  assert.equal(paths.sourceNarrativeRequestId.options.ref, 'NarrativeRequest');
  assert.deepEqual(paths.sourceNarrativeType.enumValues, ['singular', 'branched']);
  assert.deepEqual(paths.narrativeType.enumValues, ['singular', 'branched']);
  assert.equal(paths.narrativeType.defaultValue, 'singular');
  assert.equal(paths.themeJson.instance, 'Mixed');
  assert.equal(paths.narrativeJson.instance, 'Mixed');
  assert.equal(paths.movieResourceList.instance, 'Mixed');
  assert.equal(paths.branchingMeta.instance, 'Mixed');
  assert.equal(paths.renderPlanVersion.instance, 'Number');
  assert.equal(paths.defaultBranchPathId.instance, 'String');
  assert.equal(paths.branchRenderPaths.instance, 'Array');
  assert.equal(paths.branchRenderCompletionFinalized.instance, 'Boolean');
  assert.equal(paths.branchRenderCompletionFinalized.defaultValue, false);
  assert.equal(paths.branchRenderCompletedAt.instance, 'Date');
});

test('VideoSession preserves branched render metadata and canonical asset keys', () => {
  const session = new VideoSession({
    userId: '507f191e810c19729de860ea',
    narrativeType: 'branched',
    sourceNarrativeType: 'branched',
    renderPlanVersion: 1,
    defaultBranchPathId: 'root.1',
    branchingMeta: { numLevels: 1, leafNodeIds: ['root.1', 'root.2'] },
    layers: [{ branchAssetKey: 'scene:0:key', duration: 5 }],
    audioLayers: [{
      branchAssetKey: 'scene:0:key',
      branchAudioAssetKey: 'audio:key',
      generationType: 'speech',
    }],
    branchRenderPaths: [{
      pathId: 'root.1',
      timeline: [{ layerId: 'layer-1', durationOffset: 0, duration: 5 }],
      audioTimeline: [{ audioLayerId: 'audio-1', startTime: 0, endTime: 5 }],
    }],
  }).toObject();

  assert.equal(session.narrativeType, 'branched');
  assert.equal(session.layers[0].branchAssetKey, 'scene:0:key');
  assert.equal(session.audioLayers[0].branchAudioAssetKey, 'audio:key');
  assert.equal(session.branchRenderPaths[0].pathId, 'root.1');
});
