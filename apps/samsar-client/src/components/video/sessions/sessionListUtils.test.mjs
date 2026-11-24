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

test('a listed video project stays visible before it has scenes; legacy blank rows and non-project records stay excluded', () => {
  const blank = buildSession({ layerCount: 0, isExpressGeneration: false });
  const draft = { ...blank, isListedProject: true };
  assert.equal(isSessionListRecord(draft), true);
  assert.equal(isSessionListRecord({ ...draft, layerCount: 1 }), true);
  assert.equal(isSessionListRecord({ ...draft, isExpressGeneration: true, renderStatus: 'pending' }), true);
  for (const record of [
    blank, { ...draft, isListedProject: 'true' }, { ...draft, sessionType: 'image' },
    { ...draft, recordType: 'layer' }, { ...draft, id: null },
  ]) assert.equal(isSessionListRecord(record), false);
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
