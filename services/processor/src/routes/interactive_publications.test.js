import assert from 'node:assert/strict';
import test from 'node:test';

import router, {
  buildPublicInteractivePublicationQuery,
  listPublicInteractivePublications,
  paginatePublicInteractivePublications,
} from './interactive_publications.js';
import { getPublicationsMediaConfig } from '../models/AWS.js';

const registeredRoutes = router.stack
  .filter((layer) => layer.route)
  .map((layer) => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods).sort(),
  }));

test('interactive publications router exposes unauthenticated list and detail reads only', () => {
  assert.deepEqual(registeredRoutes, [
    { path: '/', methods: ['get'] },
    { path: '/:publicationId', methods: ['get'] },
  ]);

  router.stack
    .filter((layer) => layer.route)
    .forEach((layer) => {
      assert.equal(layer.route.stack.length, 1);
    });
});

test('interactive publication pagination counts only committed renderable records', () => {
  const query = buildPublicInteractivePublicationQuery('cursor-id');
  assert.deepEqual(query.$and.slice(0, 2), [
    { isPublished: true },
    { isRenderable: true },
  ]);
  assert.deepEqual(query.$and[2], {
    publicRenderableVersion: 'interactive_publication.v1',
  });
  assert.deepEqual(query.$and.at(-1), { _id: { $lt: 'cursor-id' } });
});

const buildPublication = (
  id,
  contentUrl = `${getPublicationsMediaConfig().cdnUrl}/published/${id}.mp4`,
) => ({
  _id: id,
  type: 'InteractiveVideo',
  schemaVersion: 'interactive_publication.v1',
  publicRenderableVersion: 'interactive_publication.v1',
  isPublished: true,
  isRenderable: true,
  title: id,
  thumbnailUrl: `${getPublicationsMediaConfig().cdnUrl}/published/${id}.png`,
  manifest: {
    schemaVersion: 'interactive_video_manifest.v1',
    default_path_id: `path-${id}`,
    timing: { origin: 'media', unit: 'seconds' },
    tree: {
      root_node_id: 'root',
      choice_points: [{
        branch_point_id: `choice-${id}`,
        parent_node_id: 'root',
        switch_at_seconds: 1,
        options: [{ child_node_id: `path-${id}`, leaf_path_ids: [`path-${id}`] }],
      }],
    },
    outputs: {
      paths: [{
        path_id: `path-${id}`,
        contentUrl,
        thumbnailUrl: `${getPublicationsMediaConfig().cdnUrl}/published/${id}.png`,
        encodingFormat: 'video/mp4',
        duration: 2,
        is_default: true,
      }],
    },
  },
});

test('database-page pagination serializes limit records and retains exact metadata', () => {
  const newest = buildPublication('000000000000000000000003');
  const middle = buildPublication('000000000000000000000002');
  const oldest = buildPublication('000000000000000000000001');
  const firstPage = paginatePublicInteractivePublications(
    [newest, middle],
    { limit: 1, totalCount: 3 },
  );

  assert.deepEqual(firstPage.items.map((item) => item.id), [newest._id]);
  assert.equal(firstPage.totalCount, 3);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextCursor, newest._id);
  assert.equal(
    firstPage.items[0].mainVideoUrl,
    newest.manifest.outputs.paths[0].contentUrl,
  );
  assert.equal(firstPage.items[0].mainThumbnailUrl, newest.thumbnailUrl);

  const secondPage = paginatePublicInteractivePublications(
    [oldest],
    { limit: 1, totalCount: 3 },
  );
  assert.deepEqual(secondPage.items.map((item) => item.id), [oldest._id]);
  assert.equal(secondPage.totalCount, 3);
  assert.equal(secondPage.hasMore, false);
});

test('public list applies cursor and limit in the database', async () => {
  const observed = { countQuery: null, findQuery: null, sort: null, limit: null };
  const publications = [
    buildPublication('000000000000000000000003'),
    buildPublication('000000000000000000000002'),
  ];
  const publicationModel = {
    countDocuments(query) {
      observed.countQuery = query;
      return { exec: async () => 7 };
    },
    find(query) {
      observed.findQuery = query;
      return {
        sort(value) {
          observed.sort = value;
          return this;
        },
        limit(value) {
          observed.limit = value;
          return this;
        },
        lean() {
          return this;
        },
        exec: async () => publications,
      };
    },
  };

  const result = await listPublicInteractivePublications({
    cursorId: '000000000000000000000004',
    limit: 1,
    publicationModel,
  });

  assert.equal(observed.limit, 2);
  assert.deepEqual(observed.sort, { _id: -1 });
  assert.equal(observed.countQuery.$and.some((clause) => clause._id), false);
  assert.deepEqual(observed.findQuery.$and.at(-1), {
    _id: { $lt: '000000000000000000000004' },
  });
  assert.equal(result.totalCount, 7);
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.items.map((item) => item.id), [publications[0]._id]);
});
