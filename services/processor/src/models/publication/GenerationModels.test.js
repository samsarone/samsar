import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicationGenerationModelFields,
  buildPublicationModelBackfill,
} from './GenerationModels.js';
import { Publication } from '../../schema/Publication.js';

test('generation attribution uses persisted source models verbatim and records inference', () => {
  const fields = buildPublicationGenerationModelFields({
    expressGenerationImageModel: ' legacy-image-v1 ', imageModel: 'unused-image-selection',
    expressGenerativeVideoModel: 'legacy-video-v2', videoGenerationModel: 'unused-video-selection',
    expressGenerationInferenceModel: 'historical-llm', inferenceModel: 'other-selection',
  });
  assert.equal(fields.imageModel, 'legacy-image-v1');
  assert.equal(fields.videoModel, 'legacy-video-v2');
  assert.equal(fields.inferenceModel, 'historical-llm');
  assert.deepEqual(fields.generationModels.image, ['legacy-image-v1']);
  assert.deepEqual(fields.generationModels.video, ['legacy-video-v2']);
  assert.deepEqual(fields.generationModels.inference, ['historical-llm']);
  assert.deepEqual(fields.generationModels.evidence, { image: 'session', video: 'session', inference: 'session' });
  assert.deepEqual(fields.generationModels.missing, []);
});

test('actual asset and layer model identities capture mixed sessions before mutable selections', () => {
  const fields = buildPublicationGenerationModelFields({
    expressGenerationImageModel: 'unused-selection', expressGenerativeVideoModel: 'unused-video',
    layers: [
      { layerBaseAiImageType: 'character', layerAiVideoType: 'scene', imageSession: {
        activeItemList: [{ type: 'image', model: 'image-A' }, { type: 'image', model: 'hidden', hidden: true }],
      } },
      { imageModel: 'image-B', videoModel: 'video-A' },
    ],
    branchRenderPaths: [{ timeline: [{ imageModel: 'branch-image', aiVideoModel: 'branch-video' }] }],
  }, { image: ['asset-image'], video: ['asset-video'] });
  assert.deepEqual(fields.generationModels.image, ['asset-image', 'image-A', 'image-B', 'branch-image']);
  assert.deepEqual(fields.generationModels.video, ['asset-video', 'video-A', 'branch-video']);
  assert.deepEqual(fields.generationModels.missing, ['inference']);
  assert.equal(fields.imageModel, 'asset-image');
  assert.equal(fields.generationModels.evidence.image, 'generated-asset');
});

test('unknown source models stay explicitly unknown without current defaults or category labels', () => {
  const fields = buildPublicationGenerationModelFields({
    layers: [{ layerBaseAiImageType: 'character', layerAiVideoType: 'scene' }],
  });
  assert.equal(fields.imageModel, null);
  assert.equal(fields.videoModel, null);
  assert.equal(fields.inferenceModel, null);
  assert.deepEqual(fields.generationModels.missing, ['image', 'video', 'inference']);
  assert.deepEqual(fields.generationModels.evidence, { image: 'unavailable', video: 'unavailable', inference: 'unavailable' });
});

test('backfill preserves original saved model attribution and only fills missing source fields', () => {
  const publication = { imageModel: 'original-image', videoModel: 'original-video' };
  const update = buildPublicationModelBackfill(publication, {
    expressGenerationImageModel: 'changed-image', expressGenerativeVideoModel: 'changed-video',
    expressGenerationInferenceModel: 'source-llm',
  });
  assert.equal(update.imageModel, undefined);
  assert.equal(update.videoModel, undefined);
  assert.equal(update.inferenceModel, 'source-llm');
  assert.deepEqual(update.generationModels.image, ['original-image']);
  assert.deepEqual(update.generationModels.video, ['original-video']);
  assert.equal(update.generationModels.evidence.image, 'publication');
  assert.equal(update.generationModels.source, 'session-backfill');
  assert.deepEqual(buildPublicationModelBackfill({ ...publication, ...update }, {}), {});
});

test('backfill can be repeated after a partial snapshot without replacing populated categories', () => {
  const initial = buildPublicationModelBackfill({}, { imageModel: 'original-image' });
  assert.deepEqual(initial.generationModels.missing, ['video', 'inference']);
  assert.deepEqual(buildPublicationModelBackfill(initial, { imageModel: 'changed-image' }), {});
  const updated = buildPublicationModelBackfill(initial, {
    imageModel: 'changed-image', videoModel: 'newly-recorded-video', inferenceModel: 'old-llm',
  });
  assert.deepEqual(updated.generationModels.image, ['original-image']);
  assert.deepEqual(updated.generationModels.missing, []);
  assert.equal(updated.videoModel, 'newly-recorded-video');
  assert.equal(updated.inferenceModel, 'old-llm');
  assert.deepEqual(buildPublicationModelBackfill({ ...initial, ...updated }, {}), {});
});

test('publication snapshots use a typed whitelist and retain inference metadata', () => {
  const fields = buildPublicationGenerationModelFields({ inferenceModel: 'source-llm' });
  const publication = new Publication({ ...fields, generationModels: {
    ...fields.generationModels, secret: 'must-not-be-exposed',
  } });
  assert.equal(publication.inferenceModel, 'source-llm');
  assert.equal(publication.generationModels.toObject().secret, undefined);
  assert.equal(publication.validateSync(), undefined);
});
