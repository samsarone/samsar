import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import catalog from '../docs/model-catalog.mjs';
import { DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL } from '../apps/setup-wizard/src/constants/dockerModelAvailability.js';
import { EXPRESS_VIDEO_IMAGE_MODEL_KEYS, EXPRESS_VIDEO_VIDEO_MODEL_KEYS } from '../services/processor/src/consts/ExpressVideoModelOptions.js';
import { BRANCHED_IMAGE_MODEL_KEYS, BRANCHED_VIDEO_MODEL_KEYS } from '../services/processor/src/consts/BranchedModelOptions.js';

test('documentation covers every deployment model exactly once without adding unsupported adapters', () => {
  const rows = catalog.models.filter(row => row.scope === 'deployment');
  assert.deepEqual(rows.map(row => row.setupKey).sort(), Object.keys(DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL).sort());
  assert.equal(new Set(catalog.models.map(row => row.key)).size, catalog.models.length);
  for (const row of rows) {
    assert.deepEqual([...row.adapters].sort(), [...DOCKER_MODEL_PROVIDER_PRIORITY_BY_MODEL[row.setupKey]].sort(), row.key);
    assert.ok(catalog.modalities.some(modality => modality.id === row.modality), row.key);
  }
});

test('workflow badges preserve the exact Express and branching allowlists', () => {
  for (const [modality, express, branching] of [
    ['image', EXPRESS_VIDEO_IMAGE_MODEL_KEYS, BRANCHED_IMAGE_MODEL_KEYS],
    ['video', EXPRESS_VIDEO_VIDEO_MODEL_KEYS, BRANCHED_VIDEO_MODEL_KEYS],
  ]) {
    const rows = catalog.models.filter(row => row.modality === modality);
    assert.deepEqual(rows.filter(row => row.express).map(row => row.key).sort(), [...express].sort());
    assert.deepEqual(rows.filter(row => row.branching).map(row => row.key).sort(), [...branching].sort());
  }
});

test('media documentation starts with Samsar while native inference may lead', () => {
  for (const row of catalog.models) {
    if (row.adapters.includes('samsar')) assert.equal(row.adapters[0], row.nativeAdapter || 'samsar', row.key);
    if (row.scope === 'studio') assert.equal(row.hosted, false, row.key);
  }
  assert.equal(catalog.models.find(row => row.key === 'QWENIMAGE3PRO').hosted, false);
  assert.equal(catalog.models.find(row => row.key === 'SEEDANCE2.0I2V').hosted, false);
  assert.equal(catalog.models.find(row => row.key === 'OPENAI_TTS').requestKey, 'OPENAI');
  assert.equal(catalog.models.find(row => row.key === 'KIMIK3').requestKey, 'kimi-k3');
});

test('the generated Markdown preserves every model key and provider reference', async () => {
  const markdown = await fs.readFile(new URL('../pages/model-matrix.md', import.meta.url), 'utf8');
  for (const row of catalog.models) assert.ok(markdown.includes(row.key), `Missing ${row.key}`);
  for (const provider of Object.values(catalog.providers)) assert.ok(markdown.includes(provider.url), `Missing ${provider.label}`);
});
