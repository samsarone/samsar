import mongoose from 'mongoose';

import NarrativeRequest from '../../schema/NarrativeRequest.js';
import { getDBConnectionString } from '../DBString.js';
import {
  queueCreateBranchingNarrativeRequest,
} from './BranchingNarrativeAPI.js';
import {
  buildNarrativeRequestPayload,
  queueCreateSingleNarrativeRequest,
} from './NarrativeAPI.js';

function buildError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function shouldRequeue(request) {
  if (request.status === 'PENDING') return true;
  if (request.status !== 'PROCESSING') return false;
  return !request.workerLeaseExpiresAt ||
    new Date(request.workerLeaseExpiresAt).getTime() <= Date.now();
}

function queueNarrativeRequest(request) {
  if (!shouldRequeue(request)) return;
  const requestId = request._id.toString();
  if (request.requestType === 'create_single') {
    queueCreateSingleNarrativeRequest(requestId);
    return;
  }
  if (request.requestType === 'create_branching') {
    queueCreateBranchingNarrativeRequest(requestId);
  }
}

export async function getNarrativeRequest({ userId, requestId } = {}) {
  if (!userId) throw buildError('User ID is required.', 401, 'UNAUTHORIZED');
  const normalizedRequestId = normalizeString(requestId);
  if (!mongoose.Types.ObjectId.isValid(normalizedRequestId)) {
    throw buildError('A valid request_id is required.', 400, 'INVALID_REQUEST_ID');
  }

  await getDBConnectionString();
  const request = await NarrativeRequest.findOne({
    _id: normalizedRequestId,
    userId: userId?.toString?.() || String(userId),
    requestType: { $in: ['create_single', 'create_branching'] },
  }).lean();
  if (!request) throw buildError('Narrative request not found.', 404, 'NOT_FOUND');

  queueNarrativeRequest(request);
  return buildNarrativeRequestPayload(request);
}

export const __testOnly__ = {
  queueNarrativeRequest,
  shouldRequeue,
};
