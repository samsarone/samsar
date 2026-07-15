import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLayerListRecord,
  isSessionListRecord,
  normalizeSessionListData,
} from './sessionListUtils.js';

const buildSession = (overrides = {}) => ({
  id: '6a573a3fb530bc6f473657ec',
  recordType: 'session',
  sessionType: 'video',
  layerCount: 14,
  name: 'Express project',
  isExpressGeneration: true,
  ...overrides,
});

test('explicit pending and failed video sessions are not mistaken for layer rows', () => {
  for (const record of [
    buildSession({ status: 'PENDING', expressGenerationPending: true }),
    buildSession({ status: 'FAILED', expressGenerationFailed: true }),
  ]) {
    assert.equal(isLayerListRecord(record), false);
    assert.equal(isSessionListRecord(record), true);
    assert.deepEqual(normalizeSessionListData([record]), [record]);
  }
});

test('one-layer express projects remain visible while their scenes are expanding', () => {
  const record = buildSession({ layerCount: 1, status: 'PENDING' });

  assert.equal(isSessionListRecord(record), true);
  assert.deepEqual(normalizeSessionListData([record]), [record]);
});

test('ordinary one-layer and explicit layer records are still excluded', () => {
  const oneLayerStudioSession = buildSession({
    layerCount: 1,
    isExpressGeneration: false,
  });
  const layerRecord = {
    id: 'layer-1',
    recordType: 'layer',
    sessionType: 'video',
    sessionId: '6a573a3fb530bc6f473657ec',
    status: 'PENDING',
  };

  assert.equal(isSessionListRecord(oneLayerStudioSession), false);
  assert.equal(isLayerListRecord(layerRecord), true);
  assert.deepEqual(normalizeSessionListData([oneLayerStudioSession, layerRecord]), []);
});

test('duplicate session rows are collapsed by project id', () => {
  const first = buildSession();
  const duplicate = buildSession({ name: 'Duplicate' });

  assert.deepEqual(normalizeSessionListData([first, duplicate]), [first]);
});
