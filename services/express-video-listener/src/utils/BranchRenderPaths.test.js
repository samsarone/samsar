import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allBranchFramesCompleted,
  allBranchVideosCompleted,
  BRANCHED_VIDEO_STATUS_SCHEMA,
  buildBranchDeliveryFields,
  buildBranchResults,
  buildBranchingStatusManifest,
  getBranchRenderFailure,
  getBranchFrameFailure,
  getDefaultBranchResult,
  isCompleteBranchDelivery,
  isBranchedVideoSession,
} from './BranchRenderPaths.js';

function buildSession() {
  return {
    narrativeType: 'branched',
    defaultBranchPathId: 'root.2',
    renderPlanVersion: 1,
    branchRenderCompletionFinalized: true,
    branchRenderCompletedAt: '2026-07-19T00:00:00.000Z',
    branchingMeta: {
      rootNodeId: 'root',
      numLevels: 1,
      branchingFactor: 2,
      nodeCount: 3,
      leafNodeIds: ['root.1', 'root.2'],
      branchSceneIndices: [3],
    },
    branchRenderPaths: [
      {
        pathId: 'root.1',
        leafNodeId: 'root.1',
        ordinal: 0,
        duration: 30,
        videoGenerationStatus: 'COMPLETED',
        videoLink: 'assets_v2/video/output/session/paths/root.1/video.mp4',
        frameGenerationStatus: 'COMPLETED',
        timeline: [{ layerId: 'layer-1', frameGenerationStatus: 'COMPLETED', frames: ['0.png'] }],
      },
      {
        pathId: 'root.2',
        leafNodeId: 'root.2',
        ordinal: 1,
        duration: 30,
        videoGenerationStatus: 'COMPLETED',
        remoteURL: 'https://cdn.example/root.2.mp4',
        frameGenerationStatus: 'COMPLETED',
        timeline: [{ layerId: 'layer-2', frameGenerationStatus: 'COMPLETED', frames: ['0.png'] }],
      },
    ],
  };
}

test('legacy sessions never opt into branch behavior implicitly', () => {
  assert.equal(isBranchedVideoSession({}), false);
  assert.equal(isBranchedVideoSession({ sourceNarrativeType: 'branched' }), false);
  assert.equal(isBranchedVideoSession({ narrativeType: 'branched' }), true);
});

test('branch completion requires explicit COMPLETED status and an output on every path', () => {
  const session = buildSession();
  assert.equal(allBranchVideosCompleted(session), true);
  session.branchRenderPaths[0].videoGenerationStatus = 'SUCCESS';
  assert.equal(allBranchVideosCompleted(session), false);
  session.branchRenderPaths[0].videoGenerationStatus = 'PENDING';
  assert.equal(allBranchVideosCompleted(session), false);
  session.branchRenderPaths[0].videoGenerationStatus = 'COMPLETED';
  session.branchRenderPaths[0].videoLink = '';
  assert.equal(allBranchVideosCompleted(session), false);
});

test('branch frame completion and failure are derived from path-local manifests', () => {
  const session = buildSession();
  assert.equal(allBranchFramesCompleted(session), true);
  session.branchRenderPaths[1].timeline[0].frameGenerationStatus = 'FAILED';
  session.branchRenderPaths[1].timeline[0].frameGenerationError = 'frame worker failed';
  assert.equal(allBranchFramesCompleted(session), false);
  assert.deepEqual(getBranchFrameFailure(session), {
    pathId: 'root.2',
    message: 'frame worker failed',
  });
});

test('branch results retain deterministic path mapping and default selection', () => {
  const session = buildSession();
  const results = buildBranchResults(session, { apiServer: 'https://api.example/' });
  assert.deepEqual(results.map((result) => result.path_id), ['root.1', 'root.2']);
  assert.equal(results[0].result_url, 'https://api.example/assets_v2/video/output/session/paths/root.1/video.mp4');
  assert.equal(getDefaultBranchResult(session)?.path_id, 'root.2');
});

test('legacy branch results are derived from sorted normalized paths', () => {
  const session = buildSession();
  session.branchRenderPaths[0].frameGenerationStatus = 'FAILED';
  session.branchRenderPaths[0].frameGenerationError = 'frame render failed';
  session.branchRenderPaths[0].videoGenerationStatus = 'INIT';
  session.branchRenderPaths[0].selectionTrail = [{
    branchPointId: 'choice-root',
    nodeId: 'root.1',
    switchAtSeconds: 15,
  }];
  session.branchRenderPaths.reverse();

  const results = buildBranchResults(session);
  assert.deepEqual(results.map((path) => path.path_id), ['root.1', 'root.2']);
  assert.equal(results[0].status, 'FAILED');
  assert.equal(results[0].error, 'frame render failed');
  assert.deepEqual(results[0].selection_trail, [{
    branch_point_id: 'choice-root',
    node_id: 'root.1',
    switch_at_seconds: 15,
  }]);
});

test('compact branching manifest exposes normalized tree, path, and output state', () => {
  const session = buildSession();
  const manifest = buildBranchingStatusManifest(session, { apiServer: 'https://api.example/' });

  assert.equal(manifest.schema, BRANCHED_VIDEO_STATUS_SCHEMA);
  assert.equal(manifest.status, 'COMPLETED');
  assert.equal(manifest.is_complete, true);
  assert.equal(manifest.default_path_id, 'root.2');
  assert.deepEqual(manifest.summary, {
    total_paths: 2,
    completed_paths: 2,
    pending_paths: 0,
    failed_paths: 0,
    cancelled_paths: 0,
    frame_paths_completed: 2,
    video_paths_completed: 2,
    progress_percent: 100,
  });
  assert.deepEqual(manifest.tree, {
    root_node_id: 'root',
    num_levels: 1,
    branching_factor: 2,
    node_count: 3,
    leaf_node_ids: ['root.1', 'root.2'],
    branch_scene_indices: [3],
  });
  assert.equal(manifest.paths[0].result_url,
    'https://api.example/assets_v2/video/output/session/paths/root.1/video.mp4');
  assert.equal(Object.hasOwn(manifest.paths[0], 'timeline'), false);
  assert.equal(Object.hasOwn(manifest.paths[0], 'audio_timeline'), false);
  assert.deepEqual(manifest.outputs, {
    ready: true,
    default_path_id: 'root.2',
    default_url: 'https://cdn.example/root.2.mp4',
    paths: [
      {
        path_id: 'root.1',
        leaf_node_id: 'root.1',
        ordinal: 0,
        is_default: false,
        url: 'https://api.example/assets_v2/video/output/session/paths/root.1/video.mp4',
        duration: 30,
      },
      {
        path_id: 'root.2',
        leaf_node_id: 'root.2',
        ordinal: 1,
        is_default: true,
        url: 'https://cdn.example/root.2.mp4',
        duration: 30,
      },
    ],
  });
});

test('branch delivery exposes divergence thumbnails and prefers persisted optimized timing', () => {
  const session = buildSession();
  session.branchRenderPaths[0].thumbnailPath =
    '/video/splash/session/paths/path-cm9vdC4x/thumbnail.png';
  session.branchRenderPaths[0].branchingHint = 'Enter the forest';
  session.branchRenderPaths[0].branchingDescription = 'The traveler follows the forest path.';
  session.branchRenderPaths[0].branchPointId = 'choice-root';
  session.branchRenderPaths[0].divergenceSceneIndex = 3;
  session.branchRenderPaths[0].switchAtSeconds = 12.5;
  session.branchingTimeline = {
    schemaVersion: 'branching_timeline.v1',
    timing: { origin: 'media', unit: 'seconds' },
    rootNodeId: 'root',
    defaultPathId: 'root.2',
    choicePoints: [{
      branchPointId: 'choice-root',
      parentNodeId: 'root',
      level: 1,
      divergenceSceneIndex: 3,
      switchAtSeconds: 12.5,
      options: [{
        childNodeId: 'root.1',
        branchOrdinal: 1,
        branchingHint: 'Enter the forest',
        description: 'The traveler follows the forest path.',
        leafPathIds: ['root.1'],
      }],
    }],
  };

  const manifest = buildBranchingStatusManifest(session, {
    apiServer: 'https://api.example/',
  });
  assert.equal(
    manifest.paths[0].thumbnail_url,
    'https://api.example/video/splash/session/paths/path-cm9vdC4x/thumbnail.png',
  );
  assert.equal(manifest.outputs.paths[0].branching_hint, 'Enter the forest');
  assert.equal(manifest.outputs.paths[0].branching_description,
    'The traveler follows the forest path.');
  assert.equal(manifest.outputs.paths[0].branch_point_id, 'choice-root');
  assert.equal(manifest.outputs.paths[0].switch_at_seconds, 12.5);
  assert.equal(manifest.tree.choice_points[0].switch_at_seconds, 12.5);
  assert.equal(manifest.tree.choice_points[0].options[0].path_name, 'Enter the forest');
});

test('compact branching manifest reports active paths as pending before any path completes', () => {
  const session = buildSession();
  delete session.expressGenerationStatus;
  session.branchRenderCompletionFinalized = false;
  session.branchRenderPaths.forEach((path) => {
    path.frameGenerationStatus = 'INIT';
    path.videoGenerationStatus = 'INIT';
    path.videoLink = null;
    path.remoteURL = null;
  });
  assert.equal(buildBranchingStatusManifest(session).status, 'INIT');

  session.branchRenderPaths[0].frameGenerationStatus = 'PENDING';
  assert.equal(buildBranchingStatusManifest(session).status, 'PENDING');
});

test('delivery payload retains legacy fields but withholds incomplete branch outputs', () => {
  const session = buildSession();
  assert.equal(isCompleteBranchDelivery(buildBranchDeliveryFields(session)), true);
  session.branchRenderPaths[0].videoGenerationStatus = 'PENDING';

  const payload = buildBranchDeliveryFields(session, { apiServer: 'https://api.example/' });
  assert.equal(payload.narrative_type, 'branched');
  assert.equal(payload.default_path_id, 'root.2');
  assert.equal(Object.hasOwn(payload, 'result_urls'), false);
  assert.equal(payload.branch_results[0].status, 'PENDING');
  assert.equal(Object.hasOwn(payload.branch_results[0], 'result_url'), false);
  assert.equal(payload.branching.is_complete, false);
  assert.equal(payload.branching.outputs.ready, false);
  assert.equal(isCompleteBranchDelivery(payload), false);
  assert.equal(Object.hasOwn(payload.branching.outputs, 'paths'), false);
  assert.equal(Object.hasOwn(payload.branching.outputs, 'default_url'), false);
  assert.equal(Object.hasOwn(payload.branching.paths[0], 'result_url'), false);
});

test('branch failure reports the failing path without hiding completed siblings', () => {
  const session = buildSession();
  session.branchRenderPaths[1].videoGenerationStatus = 'FAILED';
  session.branchRenderPaths[1].videoGenerationError = 'encoder failed';
  assert.deepEqual(getBranchRenderFailure(session), {
    pathId: 'root.2',
    message: 'encoder failed',
  });
});

test('aggregate failure withholds the final URL set even when every path has an output', () => {
  const session = buildSession();
  session.expressGenerationFailed = true;
  session.expressGenerationStatus = { status: 'FAILED' };

  const payload = buildBranchDeliveryFields(session, { apiServer: 'https://api.example/' });
  assert.equal(payload.branching.status, 'FAILED');
  assert.equal(payload.branching.is_complete, true);
  assert.equal(payload.branching.outputs.ready, false);
  assert.equal(Object.hasOwn(payload.branching.outputs, 'paths'), false);
  assert.equal(Object.hasOwn(payload, 'result_urls'), false);
  assert.equal(isCompleteBranchDelivery(payload), false);
  assert.equal(payload.branch_results.every((path) => path.result_url), true);
});
