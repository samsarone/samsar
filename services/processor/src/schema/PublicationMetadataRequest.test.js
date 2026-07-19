import assert from 'node:assert/strict';
import test from 'node:test';

import PublicationMetadataRequest from './PublicationMetadataRequest.js';

const BASE_REQUEST = Object.freeze({
  userId: '507f1f77bcf86cd799439011',
  sessionId: '507f1f77bcf86cd799439012',
  requestKeyHash: 'request-key-hash',
  payloadHash: 'payload-hash',
  defaultPathId: 'root.1',
});

test('publication metadata request schema accepts every durable workflow state', () => {
  for (const status of ['PROCESSING', 'BILLABLE', 'COMPLETED', 'FAILED']) {
    const document = new PublicationMetadataRequest({ ...BASE_REQUEST, status });
    assert.equal(document.validateSync(), undefined, `${status} should be valid`);
  }
});

test('publication metadata request schema rejects removed intermediate states', () => {
  const document = new PublicationMetadataRequest({
    ...BASE_REQUEST,
    status: 'GENERATED',
  });
  const validationError = document.validateSync();

  assert.equal(validationError?.errors?.status?.kind, 'enum');
});
