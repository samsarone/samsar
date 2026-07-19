import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertInteractiveSessionReadyForPublication,
  assertInteractivePublicationManifestRenderable,
  buildInteractivePublicationManifest,
  isBranchedVideoSession,
  isInteractiveSessionReadyForPublication,
  serializeInteractivePublicationManifest,
} from './InteractivePublicationManifest.js';

const completedBranching = {
  schema: 'branched_video_status.v1',
  status: 'COMPLETED',
  completed_at: '2026-07-19T00:00:00.000Z',
  default_path_id: 'root.1',
  tree: {
    root_node_id: 'root',
    choice_points: [{
      branch_point_id: 'choice-root',
      parent_node_id: 'root',
      switch_at_seconds: 8,
      options: [
        {
          child_node_id: 'root.1',
          path_name: 'Left',
          path_description: 'Take the left path',
          leaf_path_ids: ['root.1'],
        },
        {
          child_node_id: 'root.2',
          path_name: 'Right',
          leaf_path_ids: ['root.2'],
        },
      ],
    }],
  },
  outputs: {
    ready: true,
    default_path_id: 'root.1',
    default_url: 'private://root.1',
    paths: [
      { path_id: 'root.1', url: 'private://root.1', duration: 20, is_default: true },
      { path_id: 'root.2', url: 'private://root.2', duration: 21, is_default: false },
    ],
  },
};

const publicMedia = [
  {
    pathId: 'root.1',
    videoUrl: 'https://static.samsar.one/published/session/interactive/root.1/video.mp4',
    thumbnailUrl: 'https://static.samsar.one/published/session/interactive/root.1/thumbnail.png',
  },
  {
    pathId: 'root.2',
    videoUrl: 'https://static.samsar.one/published/session/interactive/root.2/video.mp4',
    thumbnailUrl: 'https://static.samsar.one/published/session/interactive/root.2/thumbnail.png',
  },
];

test('branched session detection accepts either persisted narrative discriminator', () => {
  assert.equal(isBranchedVideoSession({ narrativeType: 'branched' }), true);
  assert.equal(isBranchedVideoSession({ sourceNarrativeType: 'BRANCHED' }), true);
  assert.equal(isBranchedVideoSession({ narrativeType: 'singular' }), false);
});

test('interactive publication manifest keeps the completed status graph and standardizes media', () => {
  const manifest = buildInteractivePublicationManifest({ completedBranching, publicMedia });
  const serialized = serializeInteractivePublicationManifest(manifest);

  assert.equal(serialized.schema, 'interactive_video_manifest.v1');
  assert.equal(serialized.default_path_id, 'root.1');
  assert.deepEqual(serialized.timing, { origin: 'media', unit: 'seconds' });
  assert.deepEqual(serialized.tree.choice_points, completedBranching.tree.choice_points);
  assert.deepEqual(serialized.outputs.paths[0], {
    path_id: 'root.1',
    contentUrl: publicMedia[0].videoUrl,
    thumbnailUrl: publicMedia[0].thumbnailUrl,
    encodingFormat: 'video/mp4',
    duration: 20,
    is_default: true,
  });
  assert.equal('url' in serialized.outputs.paths[0], false);
});

test('interactive publication manifest persists canonical hints and optimized path timing', () => {
  const branchingTimeline = {
    schemaVersion: 'branching_timeline.v1',
    timing: { origin: 'media', unit: 'seconds' },
    rootNodeId: 'root',
    defaultPathId: 'root.1',
    choicePoints: [{
      branchPointId: 'choice-root',
      parentNodeId: 'root',
      level: 1,
      divergenceSceneIndex: 2,
      switchAtSeconds: 8,
      options: [{
        childNodeId: 'root.1',
        branchOrdinal: 1,
        branchingHint: 'Enter the forest',
        description: 'Follow the lanterns beneath the trees.',
        leafPathIds: ['root.1'],
      }, {
        childNodeId: 'root.2',
        branchOrdinal: 2,
        branchingHint: 'Stay on the road',
        description: 'Continue toward the distant town.',
        leafPathIds: ['root.2'],
      }],
    }],
  };
  const pathMetadata = [{
    pathId: 'root.1',
    leafNodeId: 'root.1',
    ordinal: 0,
    selectionTrail: [{
      branchPointId: 'choice-root',
      nodeId: 'root.1',
      parentNodeId: 'root',
      level: 1,
      branchOrdinal: 1,
      divergenceSceneIndex: 2,
      switchAtSeconds: 8,
      branchingHint: 'Enter the forest',
      description: 'Follow the lanterns beneath the trees.',
    }],
  }, {
    pathId: 'root.2',
    leafNodeId: 'root.2',
    ordinal: 1,
    selectionTrail: [{
      branchPointId: 'choice-root',
      nodeId: 'root.2',
      parentNodeId: 'root',
      level: 1,
      branchOrdinal: 2,
      divergenceSceneIndex: 2,
      switchAtSeconds: 8,
      branchingHint: 'Stay on the road',
      description: 'Continue toward the distant town.',
    }],
  }];

  const manifest = buildInteractivePublicationManifest({
    completedBranching,
    publicMedia,
    pathMetadata,
    branchingTimeline,
  });

  assert.deepEqual(manifest.tree.choice_points[0], {
    branch_point_id: 'choice-root',
    parent_node_id: 'root',
    level: 1,
    divergence_scene_index: 2,
    switch_at_seconds: 8,
    options: [{
      child_node_id: 'root.1',
      branch_ordinal: 1,
      path_name: 'Enter the forest',
      path_description: 'Follow the lanterns beneath the trees.',
      branching_hint: 'Enter the forest',
      description: 'Follow the lanterns beneath the trees.',
      leaf_path_ids: ['root.1'],
    }, {
      child_node_id: 'root.2',
      branch_ordinal: 2,
      path_name: 'Stay on the road',
      path_description: 'Continue toward the distant town.',
      branching_hint: 'Stay on the road',
      description: 'Continue toward the distant town.',
      leaf_path_ids: ['root.2'],
    }],
  });
  assert.equal(manifest.outputs.paths[0].leaf_node_id, 'root.1');
  assert.equal(manifest.outputs.paths[0].branch_point_id, 'choice-root');
  assert.equal(manifest.outputs.paths[0].branching_hint, 'Enter the forest');
  assert.equal(manifest.outputs.paths[0].description, 'Follow the lanterns beneath the trees.');
  assert.equal(manifest.outputs.paths[0].switch_at_seconds, 8);
  assert.equal('selection_trail' in manifest.outputs.paths[0], false);

  const stalePathTiming = structuredClone(manifest);
  stalePathTiming.outputs.paths[0].switch_at_seconds = 9;
  assert.throws(
    () => assertInteractivePublicationManifestRenderable(stalePathTiming),
    /inconsistent branch timing/i,
  );
});

test('interactive publication manifest refuses partial public media', () => {
  assert.throws(
    () => buildInteractivePublicationManifest({
      completedBranching,
      publicMedia: publicMedia.slice(0, 1),
    }),
    /every interactive video path/i,
  );
});

test('renderable manifest validation rejects inconsistent defaults and graph references', () => {
  const manifest = buildInteractivePublicationManifest({ completedBranching, publicMedia });
  const inconsistentDefault = structuredClone(manifest);
  inconsistentDefault.outputs.paths[1].is_default = true;
  assert.throws(
    () => assertInteractivePublicationManifestRenderable(inconsistentDefault),
    /default path/i,
  );

  const missingReference = structuredClone(manifest);
  missingReference.tree.choice_points[0].options[0].leaf_path_ids = ['missing-path'];
  assert.throws(
    () => assertInteractivePublicationManifestRenderable(missingReference),
    /missing path/i,
  );

  const orphanedChoice = structuredClone(manifest);
  orphanedChoice.tree.choice_points.push({
    branch_point_id: 'choice-orphan',
    parent_node_id: 'orphan-node',
    switch_at_seconds: 2,
    options: [{ child_node_id: 'root.1', leaf_path_ids: ['root.1'] }],
  });
  assert.throws(
    () => assertInteractivePublicationManifestRenderable(orphanedChoice),
    /orphaned choice point/i,
  );
});

test('interactive publication refuses a persisted timeline that omits a nested choice', () => {
  const nestedCompleted = {
    ...completedBranching,
    default_path_id: 'root.1.1',
    tree: {
      root_node_id: 'root',
      choice_points: [{
        branch_point_id: 'choice-root',
        parent_node_id: 'root',
        switch_at_seconds: 4,
        options: [{
          child_node_id: 'root.1',
          leaf_path_ids: ['root.1.1', 'root.1.2'],
        }, {
          child_node_id: 'root.2',
          leaf_path_ids: ['root.2'],
        }],
      }, {
        branch_point_id: 'choice-root.1',
        parent_node_id: 'root.1',
        switch_at_seconds: 8,
        options: [{ child_node_id: 'root.1.1', leaf_path_ids: ['root.1.1'] }, {
          child_node_id: 'root.1.2',
          leaf_path_ids: ['root.1.2'],
        }],
      }],
    },
    outputs: {
      ready: true,
      default_path_id: 'root.1.1',
      default_url: 'private://root.1.1',
      paths: [
        { path_id: 'root.1.1', url: 'private://root.1.1', duration: 20, is_default: true },
        { path_id: 'root.1.2', url: 'private://root.1.2', duration: 20, is_default: false },
        { path_id: 'root.2', url: 'private://root.2', duration: 20, is_default: false },
      ],
    },
  };
  const nestedPublicMedia = nestedCompleted.outputs.paths.map((path) => ({
    pathId: path.path_id,
    videoUrl: `https://static.samsar.one/published/session/${path.path_id}/video.mp4`,
    thumbnailUrl: `https://static.samsar.one/published/session/${path.path_id}/thumbnail.png`,
  }));
  const rootChoice = (nodeId) => ({
    branchPointId: 'choice-root',
    nodeId,
    parentNodeId: 'root',
    level: 1,
    divergenceSceneIndex: 0,
    switchAtSeconds: 4,
    pathName: nodeId,
  });
  const nestedChoice = (nodeId) => ({
    branchPointId: 'choice-root.1',
    nodeId,
    parentNodeId: 'root.1',
    level: 2,
    divergenceSceneIndex: 1,
    switchAtSeconds: 8,
    pathName: nodeId,
  });
  const pathMetadata = [{
    pathId: 'root.1.1',
    selectionTrail: [rootChoice('root.1'), nestedChoice('root.1.1')],
  }, {
    pathId: 'root.1.2',
    selectionTrail: [rootChoice('root.1'), nestedChoice('root.1.2')],
  }, {
    pathId: 'root.2',
    selectionTrail: [rootChoice('root.2')],
  }];
  const incompleteTimeline = {
    timing: { origin: 'media', unit: 'seconds' },
    rootNodeId: 'root',
    defaultPathId: 'root.1.1',
    choicePoints: [{
      branchPointId: 'choice-root',
      parentNodeId: 'root',
      switchAtSeconds: 4,
      options: [{
        childNodeId: 'root.1',
        leafPathIds: ['root.1.1', 'root.1.2'],
      }, {
        childNodeId: 'root.2',
        leafPathIds: ['root.2'],
      }],
    }],
  };

  const completeManifest = buildInteractivePublicationManifest({
    completedBranching: nestedCompleted,
    publicMedia: nestedPublicMedia,
    pathMetadata,
  });
  assert.equal(completeManifest.tree.choice_points.length, 2);

  assert.throws(
    () => buildInteractivePublicationManifest({
      completedBranching: nestedCompleted,
      publicMedia: nestedPublicMedia,
      pathMetadata,
      branchingTimeline: incompleteTimeline,
    }),
    /does not match the rendered branch-path topology/i,
  );
});

test('interactive publication readiness requires finalized and completed branch paths', () => {
  const session = {
    narrativeType: 'branched',
    branchRenderCompletionFinalized: true,
    branchRenderPaths: completedBranching.outputs.paths.map((path) => ({
      pathId: path.path_id,
      videoGenerationStatus: 'COMPLETED',
      remoteURL: path.url,
    })),
  };

  const ready = assertInteractiveSessionReadyForPublication(session, completedBranching);
  assert.equal(ready.outputs.paths.length, 2);
  assert.equal(isInteractiveSessionReadyForPublication(session), true);
  assert.equal(isInteractiveSessionReadyForPublication({
    ...session,
    branchRenderPaths: session.branchRenderPaths.map((path, index) => (
      index === 0 ? { ...path, videoGenerationStatus: 'PENDING' } : path
    )),
  }), false);
  assert.throws(
    () => assertInteractiveSessionReadyForPublication({
      ...session,
      branchRenderCompletionFinalized: false,
    }, completedBranching),
    /not finalized/i,
  );
});
