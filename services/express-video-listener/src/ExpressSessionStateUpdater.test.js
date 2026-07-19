import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExternalRequestIdentityFields,
  buildExternalSettlementResponsePayload,
  normalizeBranchDeliveryFieldsForTerminalStatus,
} from './ExpressSessionStateUpdater.js';

test('external completion identities use the public request id and retain upstream correlation', () => {
  assert.deepEqual(
    buildExternalRequestIdentityFields(
      { externalRequestId: 'extreq_123' },
      'video-session-456',
    ),
    {
      request_id: 'extreq_123',
      session_id: 'extreq_123',
      external_request_id: 'extreq_123',
      external_session_id: 'extreq_123',
      upstream_session_id: 'video-session-456',
    },
  );

  assert.deepEqual(
    buildExternalRequestIdentityFields({}, 'video-session-456'),
    {
      request_id: 'video-session-456',
      session_id: 'video-session-456',
    },
  );
});

test('failed branched settlements remove stale aggregate URLs but retain path diagnostics', () => {
  const branchDeliveryFields = {
    narrative_type: 'branched',
    default_path_id: 'root.1',
    result_urls: ['https://cdn.example.com/root.1.mp4'],
    branch_results: [{
      path_id: 'root.1',
      status: 'COMPLETED',
      result_url: 'https://cdn.example.com/root.1.mp4',
    }],
    branching: {
      status: 'FAILED',
      outputs: { ready: false },
    },
  };
  const payload = buildExternalSettlementResponsePayload({
    previousResponsePayload: {
      result_url: 'https://cdn.example.com/stale.mp4',
      result_urls: ['https://cdn.example.com/stale.mp4'],
      videoLink: 'assets_v2/video/stale.mp4',
      remoteURL: 'https://cdn.example.com/stale.mp4',
    },
    status: 'FAILED',
    resolvedErrorMessage: 'encoder failed',
    branchDeliveryFields,
    branchedSession: true,
  });

  assert.equal(payload.status, 'FAILED');
  assert.equal(payload.message, 'encoder failed');
  assert.equal(Object.hasOwn(payload, 'result_url'), false);
  assert.equal(Object.hasOwn(payload, 'result_urls'), false);
  assert.equal(Object.hasOwn(payload, 'videoLink'), false);
  assert.equal(Object.hasOwn(payload, 'remoteURL'), false);
  assert.equal(payload.branch_results[0].result_url, 'https://cdn.example.com/root.1.mp4');
  assert.equal(branchDeliveryFields.result_urls.length, 1);
});

test('successful branched settlements publish the final URL set and clear stale errors', () => {
  const payload = buildExternalSettlementResponsePayload({
    previousResponsePayload: {
      message: 'old failure',
      error: { message: 'old failure' },
    },
    status: 'COMPLETED',
    resolvedResultUrl: 'https://cdn.example.com/root.1.mp4',
    branchDeliveryFields: {
      narrative_type: 'branched',
      result_urls: [
        'https://cdn.example.com/root.1.mp4',
        'https://cdn.example.com/root.2.mp4',
      ],
      branching: {
        status: 'COMPLETED',
        outputs: { ready: true },
      },
    },
    branchedSession: true,
  });

  assert.equal(payload.status, 'COMPLETED');
  assert.equal(payload.result_url, 'https://cdn.example.com/root.1.mp4');
  assert.equal(payload.result_urls.length, 2);
  assert.equal(Object.hasOwn(payload, 'message'), false);
  assert.equal(Object.hasOwn(payload, 'error'), false);
});

test('non-success webhook branch fields never expose aggregate result_urls', () => {
  const fields = {
    result_urls: ['https://cdn.example.com/root.1.mp4'],
    branch_results: [{ path_id: 'root.1' }],
  };
  const normalized = normalizeBranchDeliveryFieldsForTerminalStatus(fields, 'FAILED');

  assert.equal(Object.hasOwn(normalized, 'result_urls'), false);
  assert.deepEqual(normalized.branch_results, [{ path_id: 'root.1' }]);
  assert.deepEqual(fields.result_urls, ['https://cdn.example.com/root.1.mp4']);
});
