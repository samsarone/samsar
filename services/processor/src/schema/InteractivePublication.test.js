import assert from 'node:assert/strict';
import test from 'node:test';

import InteractivePublication, {
  INTERACTIVE_PUBLICATION_SCHEMA,
  INTERACTIVE_VIDEO_MANIFEST_SCHEMA,
} from './InteractivePublication.js';

test('InteractivePublication uses explicit render-focused manifest fields', () => {
  const paths = InteractivePublication.schema.paths;

  assert.equal(paths.schemaVersion.defaultValue, INTERACTIVE_PUBLICATION_SCHEMA);
  assert.equal(paths.type.defaultValue, 'InteractiveVideo');
  assert.equal(paths.sessionId.isRequired, true);
  assert.equal(paths.mediaRevision.isRequired, true);
  assert.equal(paths.publicationId, undefined);
  assert.equal(paths.thumbnailUrl.isRequired, true);
  assert.equal(paths.mainVideoUrl.defaultValue, null);
  assert.equal(paths.mainThumbnailUrl.defaultValue, null);
  assert.deepEqual(paths.categories.defaultValue(), []);
  assert.deepEqual(paths.topics.defaultValue(), []);
  assert.equal(paths.publicRenderableVersion.defaultValue, null);
  assert.equal(paths.isPublished.defaultValue, false);
  assert.equal(paths.isRenderable.defaultValue, false);
  assert.equal(
    paths.manifest.schema.paths.schemaVersion.defaultValue,
    INTERACTIVE_VIDEO_MANIFEST_SCHEMA,
  );
  assert.equal(paths.manifest.schema.paths.default_path_id.isRequired, true);
  assert.equal(
    paths.manifest.schema.paths.outputs.schema.paths.paths.schema.paths.contentUrl.isRequired,
    true,
  );
  assert.equal(
    paths.manifest.schema.paths.outputs.schema.paths.paths.schema.paths.thumbnailUrl.isRequired,
    true,
  );
  assert.equal(
    paths.manifest.schema.paths.tree.schema.paths.choice_points.schema.paths.switch_at_seconds.isRequired,
    true,
  );
});

test('InteractivePublication has one companion per video session', () => {
  const indexes = InteractivePublication.schema.indexes();
  const sessionIndex = indexes.find(([fields]) => fields.sessionId === 1);

  assert.ok(sessionIndex);
  assert.equal(sessionIndex[1].unique, true);
});

test('InteractivePublication preserves status-compatible graph keys and standard media keys', () => {
  const publication = new InteractivePublication({
    sessionId: 'session-1',
    mediaRevision: 'revision-1',
    createdBy: '507f191e810c19729de860ea',
    title: 'Choose a path',
    mainVideoUrl: 'https://static.samsar.one/published/session-1/interactive/paths/root.1/video.mp4',
    mainThumbnailUrl: 'https://static.samsar.one/published/session-1/interactive/main/thumbnail.png',
    duration: 20,
    thumbnailUrl: 'https://static.samsar.one/published/session-1/interactive/main/thumbnail.png',
    manifest: {
      default_path_id: 'root.1',
      tree: {
        root_node_id: 'root',
        choice_points: [{
          branch_point_id: 'choice-root',
          parent_node_id: 'root',
          switch_at_seconds: 8,
          options: [{
            child_node_id: 'root.1',
            path_name: 'Left',
            leaf_path_ids: ['root.1'],
          }],
        }],
      },
      outputs: {
        paths: [{
          path_id: 'root.1',
          contentUrl: 'https://static.samsar.one/published/session-1/interactive/paths/root.1/video.mp4',
          thumbnailUrl: 'https://static.samsar.one/published/session-1/interactive/paths/root.1/thumbnail.png',
          duration: 20,
          is_default: true,
        }],
      },
    },
  });
  const validationError = publication.validateSync();

  assert.equal(validationError, undefined);
  assert.equal(publication.manifest.timing.origin, 'media');
  assert.equal(publication.manifest.timing.unit, 'seconds');
  assert.equal(publication.manifest.outputs.paths[0].encodingFormat, 'video/mp4');

  publication.mediaRevision = '../unsafe';
  assert.match(
    publication.validateSync()?.errors?.mediaRevision?.message || '',
    /invalid/i,
  );
});
