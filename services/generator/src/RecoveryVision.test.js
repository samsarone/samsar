import test from 'node:test';
import assert from 'node:assert/strict';
import { assertManifestLayerMapping, parseArgs } from '../scripts/recovery/resume_failed_vision_session.js';

const session = {
  layers: [
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', originalImageGenerationPrompt: 'first scene' },
    { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', originalImageGenerationPrompt: 'second scene' },
  ],
};

const validManifest = {
  layers: [
    {
      index: 0,
      layerId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      requestId: 'cccccccccccccccccccccccc',
      savedImage: 'generation_1792496235226_me0eh.png',
    },
    { index: 1, layerId: 'bbbbbbbbbbbbbbbbbbbbbbbb', savedImage: null },
  ],
};

test('recovery manifest accounts for every layer with explicit saved-image mapping', () => {
  assert.doesNotThrow(() => assertManifestLayerMapping(validManifest, session));
  assert.throws(
    () => assertManifestLayerMapping({ layers: validManifest.layers.slice(0, 1) }, session),
    /every original session layer/,
  );
  assert.throws(
    () => assertManifestLayerMapping({ layers: [validManifest.layers[1], validManifest.layers[0]] }, session),
    /index\/ID mismatch/,
  );
});

test('recovery rejects guessed, duplicate, or unsafe image associations', () => {
  const mutate = (patch) => ({
    layers: [{ ...validManifest.layers[0], ...patch }, validManifest.layers[1]],
  });
  assert.throws(
    () => assertManifestLayerMapping(mutate({ requestId: undefined }), session),
    /mapping is missing/,
  );
  assert.throws(
    () => assertManifestLayerMapping(mutate({ savedImage: '../another-session.png' }), session),
    /mapping is missing/,
  );
  assert.throws(
    () => assertManifestLayerMapping(mutate({ savedImage: null }), session),
    /either an explicit saved image/,
  );
  assert.throws(
    () => assertManifestLayerMapping({ layers: [validManifest.layers[0], {
      ...validManifest.layers[1],
      requestId: validManifest.layers[0].requestId,
      savedImage: validManifest.layers[0].savedImage,
    }] }, session),
    /duplicated/,
  );
});

test('recovery preserves completed promptless outros while requiring prompts for unfinished images', () => {
  const completedOutro = { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', imageSession: { generationStatus: 'COMPLETED' } };
  const withOutro = { layers: [...session.layers, completedOutro] };
  const manifest = { layers: [...validManifest.layers, { index: 2, layerId: completedOutro._id, savedImage: null }] };
  assert.doesNotThrow(() => assertManifestLayerMapping(manifest, withOutro));
  assert.throws(() => assertManifestLayerMapping(manifest, {
    layers: [...session.layers, { ...completedOutro, imageSession: { generationStatus: 'PENDING' } }],
  }), /Original image prompt is missing/);
});

test('apply requires a reviewed dry-run hash and a backup destination', () => {
  const base = ['0123456789abcdef01234567', '--manifest=/tmp/reviewed.json'];
  assert.deepEqual(parseArgs(base), {
    sessionId: base[0],
    manifestPath: '/tmp/reviewed.json',
    apply: false,
  });
  assert.throws(() => parseArgs([...base, '--apply']), /plan-sha.*backup-dir/);
  assert.throws(() => parseArgs([...base, '--apply', '--plan-sha=abc']), /backup-dir/);
  assert.throws(
    () => parseArgs([...base, '--apply', '--plan-sha=abc', '--backup-dir=/tmp/recovery']),
    /durable \/persistent volume/,
  );
  assert.equal(parseArgs([...base, '--apply', '--plan-sha=abc', '--backup-dir=/persistent/recovery']).apply, true);
});
