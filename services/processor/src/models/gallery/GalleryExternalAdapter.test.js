import assert from 'node:assert/strict';
import test from 'node:test';
import { SamsarClient } from 'samsar-js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_API_KEY',
  'SAMSAR_DEPLOYED_API_KEY',
  'SAMSAR_EXTERNAL_API_KEY',
  'SAMSAR_EXTERNAL_GALLERY_ENABLED',
  'SAMSAR_FORCE_EXTERNAL_GALLERY',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const {
  isConfiguredGalleryServiceRequest,
  listDeployedGalleryTaxonomy,
  searchDeployedGallery,
  shouldUseDeployedGallery,
  updateDeployedGalleryPublicationEmbeddings,
} = await import('./GalleryExternalAdapter.js');

function clearEnv() {
  ENV_KEYS.forEach((key) => delete process.env[key]);
}

function restoreEnv() {
  ENV_KEYS.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
}

test.afterEach(restoreEnv);

test('Docker gallery forwarding requires the configured Samsar service key', () => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-gallery-key';
  assert.equal(shouldUseDeployedGallery(), true);
  assert.equal(
    isConfiguredGalleryServiceRequest({ authorization: 'Bearer samsar-gallery-key' }),
    true,
  );
  assert.equal(
    isConfiguredGalleryServiceRequest({ authorization: 'Bearer incorrect-key' }),
    false,
  );
});

test('gallery search is forwarded through samsar-js to the deployed v2 endpoint', async (t) => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-gallery-key';
  t.mock.method(SamsarClient.prototype, 'postV2', async (path, payload) => {
    assert.equal(path, 'gallery/search');
    assert.equal(payload.query, 'ocean');
    return { data: { query: 'ocean', items: [], total: 0 } };
  });

  const result = await searchDeployedGallery({ query: 'ocean', limit: 10 });
  assert.deepEqual(result, { query: 'ocean', items: [], total: 0 });
});

test('publication-scoped embedding update is forwarded to the dedicated deployed endpoint', async (t) => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-gallery-key';
  t.mock.method(SamsarClient.prototype, 'postV2', async (path, payload) => {
    assert.equal(path, 'gallery/publications/update_embeddings');
    assert.deepEqual(payload, { publication_id: '6a51beb02064caf59bc8af37', force: false });
    return { data: { status: 'fresh', indexed: 0, refreshed: false } };
  });

  const result = await updateDeployedGalleryPublicationEmbeddings({
    publication_id: '6a51beb02064caf59bc8af37',
    force: false,
  });
  assert.deepEqual(result, { status: 'fresh', indexed: 0, refreshed: false });
});

test('taxonomy listing is forwarded with pagination and publication-id options', async (t) => {
  clearEnv();
  process.env.CURRENT_ENV = 'docker';
  process.env.SAMSAR_API_KEY = 'samsar-gallery-key';
  t.mock.method(SamsarClient.prototype, 'getV2', async (path, options) => {
    assert.equal(path, 'gallery/taxonomy/topics');
    assert.deepEqual(options.query, {
      limit: 50,
      offset: 10,
      include_publication_ids: true,
    });
    return { data: { kind: 'topic', items: [], total: 0 } };
  });

  const result = await listDeployedGalleryTaxonomy({
    kind: 'topics',
    limit: 50,
    offset: 10,
    includePublicationIds: true,
  });
  assert.deepEqual(result, { kind: 'topic', items: [], total: 0 });
});
