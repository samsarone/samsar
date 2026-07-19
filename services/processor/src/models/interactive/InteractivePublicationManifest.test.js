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
