import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyModelAdapterPreferenceOrder,
  buildModelAdapterSettings,
  readModelAdapterPreferences,
  validateModelAdapterPreferenceUpdate,
  writeModelAdapterPreferences,
} from './ModelAdapterPreferences.js';

const STANDALONE_ENV = Object.freeze({
  SAMSAR_DEPLOYMENT_EDITION: 'standalone',
  SAMSAR_RUNTIME: 'docker',
});

const AVAILABILITY = Object.freeze({
  providers: ['alibabaCloud', 'fal', 'samsar'],
  models: [
    'QWEN3.7',
    'WAN2.7PRO',
    'HAPPYHORSEI2V',
    'GPTIMAGE2',
  ],
  modelProviderPriority: {
    'QWEN3.7': ['alibabaCloud', 'openrouter', 'samsar'],
    'WAN2.7PRO': ['alibabaCloud', 'fal', 'samsar'],
    HAPPYHORSEI2V: ['alibabaCloud', 'fal', 'samsar'],
    GPTIMAGE2: ['openai', 'samsar'],
  },
});

test('saved adapters lead while missing default adapters retain their relative order', () => {
  assert.deepEqual(
    applyModelAdapterPreferenceOrder(
      ['alibabaCloud', 'fal', 'samsar'],
      ['samsar', 'alibabaCloud'],
    ),
    ['samsar', 'alibabaCloud', 'fal'],
  );
});

test('settings expose only installed compatible adapters in stage order', () => {
  const result = buildModelAdapterSettings(AVAILABILITY, {
    modelProviderPriority: {
      'QWEN3.7': ['samsar', 'alibabaCloud'],
      'WAN2.7PRO': ['fal', 'samsar', 'alibabaCloud'],
    },
    updatedAt: '2026-07-28T00:00:00.000Z',
  });

  const inference = result.stages.find((stage) => stage.key === 'inference');
  const textToImage = result.stages.find((stage) => stage.key === 'text_to_image');
  const imageToVideo = result.stages.find((stage) => stage.key === 'image_to_video');

  assert.deepEqual(inference.models[0].preference, ['samsar', 'alibabaCloud']);
  assert.deepEqual(
    textToImage.models.find((model) => model.modelKey === 'WAN2.7PRO').preference,
    ['fal', 'samsar', 'alibabaCloud'],
  );
  assert.deepEqual(
    textToImage.models.find((model) => model.modelKey === 'GPTIMAGE2').preference,
    ['samsar'],
  );
  assert.deepEqual(
    imageToVideo.models.find((model) => model.modelKey === 'HAPPYHORSEI2V').preference,
    ['alibabaCloud', 'fal', 'samsar'],
  );
});

test('updates must be exact permutations of installed adapters', () => {
  assert.throws(
    () => validateModelAdapterPreferenceUpdate(
      { 'WAN2.7PRO': ['samsar', 'alibabaCloud'] },
      AVAILABILITY,
      { modelProviderPriority: {} },
    ),
    /every available adapter exactly once/,
  );

  assert.throws(
    () => validateModelAdapterPreferenceUpdate(
      { UNKNOWN: ['samsar'] },
      AVAILABILITY,
      { modelProviderPriority: {} },
    ),
    /not configurable/,
  );
});

test('standalone preferences are written atomically and production ignores the file', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-model-adapters-'));
  const filePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  const written = writeModelAdapterPreferences(
    {
      'QWEN3.7': ['samsar', 'alibabaCloud'],
      'WAN2.7PRO': ['fal', 'samsar', 'alibabaCloud'],
    },
    AVAILABILITY,
    {
      env: STANDALONE_ENV,
      filePath,
      now: new Date('2026-07-28T01:02:03.000Z'),
    },
  );

  assert.equal(written.settings.updatedAt, '2026-07-28T01:02:03.000Z');
  assert.deepEqual(
    readModelAdapterPreferences({ env: STANDALONE_ENV, filePath }).modelProviderPriority,
    {
      'QWEN3.7': ['samsar', 'alibabaCloud'],
      'WAN2.7PRO': ['fal', 'samsar', 'alibabaCloud'],
    },
  );
  assert.deepEqual(
    readModelAdapterPreferences({
      env: {
        SAMSAR_DEPLOYMENT_EDITION: 'production',
        SAMSAR_RUNTIME: 'docker',
      },
      filePath,
    }).modelProviderPriority,
    {},
  );
});

test('saving the default installed order removes a stale override', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-model-adapters-reset-'));
  const filePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(filePath, JSON.stringify({
    modelProviderPriority: {
      'QWEN3.7': ['samsar', 'alibabaCloud'],
    },
  }));

  writeModelAdapterPreferences(
    { 'QWEN3.7': ['alibabaCloud', 'samsar'] },
    AVAILABILITY,
    {
      env: STANDALONE_ENV,
      filePath,
      now: new Date('2026-07-28T02:00:00.000Z'),
    },
  );

  assert.deepEqual(
    readModelAdapterPreferences({ env: STANDALONE_ENV, filePath }).modelProviderPriority,
    {},
  );
});

test('saving current installation settings removes overrides for unavailable models', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'samsar-model-adapters-prune-'));
  const filePath = path.join(temporaryDirectory, 'model-adapter-preferences.json');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(filePath, JSON.stringify({
    modelProviderPriority: {
      'QWEN3.7': ['samsar', 'alibabaCloud'],
      'UNAVAILABLE-MODEL': ['samsar'],
    },
  }));

  writeModelAdapterPreferences(
    { 'QWEN3.7': ['alibabaCloud', 'samsar'] },
    AVAILABILITY,
    {
      env: STANDALONE_ENV,
      filePath,
      now: new Date('2026-07-28T02:30:00.000Z'),
    },
  );

  assert.deepEqual(
    readModelAdapterPreferences({ env: STANDALONE_ENV, filePath }).modelProviderPriority,
    {},
  );
});
