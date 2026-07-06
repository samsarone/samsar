import { Types } from 'mongoose';

import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';

const CANCELLED_STATUS = 'CANCELLED';
const PAUSED_STATUS = 'PAUSED';
const PENDING_STATUS = 'PENDING';
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function resolveSessionId(payload = {}) {
  return (
    payload.videoSessionId ||
    payload.video_session_id ||
    payload.videoSessionID ||
    payload.session_id ||
    payload.sessionId ||
    payload.sessionID ||
    null
  );
}

function buildCancelledExpressGenerationStatus(rawStatus) {
  const currentStatus = rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus)
    ? { ...rawStatus }
    : {};

  const topLevelStatus = typeof currentStatus.status === 'string'
    ? currentStatus.status.trim().toUpperCase()
    : '';
  if (!TERMINAL_STATUSES.has(topLevelStatus)) {
    currentStatus.status = CANCELLED_STATUS;
  }

  const videoGenerationStatus = typeof currentStatus.video_generation === 'string'
    ? currentStatus.video_generation.trim().toUpperCase()
    : '';
  if (!TERMINAL_STATUSES.has(videoGenerationStatus)) {
    currentStatus.video_generation = CANCELLED_STATUS;
  }

  const frameGenerationStatus = typeof currentStatus.frame_generation === 'string'
    ? currentStatus.frame_generation.trim().toUpperCase()
    : '';
  if (!TERMINAL_STATUSES.has(frameGenerationStatus)) {
    currentStatus.frame_generation = CANCELLED_STATUS;
  }

  return currentStatus;
}

export async function cancelVideoSessionRender(userId, payload = {}) {
  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  const rawSessionId = resolveSessionId(payload);
  if (!rawSessionId || typeof rawSessionId !== 'string' || !rawSessionId.trim()) {
    const error = new Error('videoSessionId (or session_id) must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  const sessionId = rawSessionId.trim();
  if (!Types.ObjectId.isValid(sessionId)) {
    const error = new Error('videoSessionId must be a valid id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();

  const userIdString = userId.toString();
  const videoSession = await VideoSession.findOne({
    _id: sessionId,
    userId: userIdString,
  })
    .select('_id expressGenerationStatus')
    .lean();

  if (!videoSession) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  const cancelledExpressGenerationStatus = buildCancelledExpressGenerationStatus(
    videoSession.expressGenerationStatus,
  );

  await VideoSession.updateOne(
    { _id: sessionId, userId: userIdString },
    {
      $set: {
        expressGenerationPending: false,
        expressGenerationPaused: false,
        expressGenerationCancelled: true,
        frameGenerationPending: false,
        videoGenerationPending: false,
        audioGenerationPending: false,
        transcriptGenerationPending: false,
        aiVideoGenerationPending: false,
        lipSyncGenerationPending: false,
        soundEffectGenerationPending: false,
        expressGenerationStatus: cancelledExpressGenerationStatus,
      },
    },
  );

  return {
    request_id: sessionId,
    session_id: sessionId,
    status: CANCELLED_STATUS,
    cancelled: true,
    message: 'Render cancellation requested.',
  };
}

async function getOwnedVideoSessionForRenderControl(userId, payload = {}) {
  if (!userId) {
    const error = new Error('userId is required.');
    error.status = 400;
    throw error;
  }

  const rawSessionId = resolveSessionId(payload);
  if (!rawSessionId || typeof rawSessionId !== 'string' || !rawSessionId.trim()) {
    const error = new Error('videoSessionId (or session_id) must be a non-empty string.');
    error.status = 400;
    throw error;
  }

  const sessionId = rawSessionId.trim();
  if (!Types.ObjectId.isValid(sessionId)) {
    const error = new Error('videoSessionId must be a valid id.');
    error.status = 400;
    throw error;
  }

  await getDBConnectionString();

  const userIdString = userId.toString();
  const videoSession = await VideoSession.findOne({
    _id: sessionId,
    userId: userIdString,
  }).select(
    '_id isExpressGeneration expressGenerationPending expressGenerationPaused ' +
    'expressGenerationStatus expressGenerationCancelled expressGenerationFailed ' +
    'videoGenerationPending videoLink remoteURL',
  );

  if (!videoSession) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  return { sessionId, userIdString, videoSession };
}

function assertRenderCanBePaused(videoSession) {
  if (videoSession.expressGenerationCancelled) {
    const error = new Error('Cannot pause a cancelled render.');
    error.status = 409;
    throw error;
  }

  if (videoSession.expressGenerationFailed) {
    const error = new Error('Cannot pause a failed render.');
    error.status = 409;
    throw error;
  }

  if (videoSession.videoLink || videoSession.remoteURL) {
    const error = new Error('Cannot pause a completed render.');
    error.status = 409;
    throw error;
  }

  if (!videoSession.isExpressGeneration) {
    const error = new Error('Pause is only supported for express video generations.');
    error.status = 409;
    throw error;
  }
}

function buildPausedExpressGenerationStatus(rawStatus) {
  const currentStatus = rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus)
    ? { ...rawStatus }
    : {};

  const topLevelStatus = typeof currentStatus.status === 'string'
    ? currentStatus.status.trim().toUpperCase()
    : '';
  if (!TERMINAL_STATUSES.has(topLevelStatus)) {
    currentStatus.status = PAUSED_STATUS;
  }

  return currentStatus;
}

function buildResumedExpressGenerationStatus(rawStatus) {
  const currentStatus = rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus)
    ? { ...rawStatus }
    : {};

  const topLevelStatus = typeof currentStatus.status === 'string'
    ? currentStatus.status.trim().toUpperCase()
    : '';
  if (!TERMINAL_STATUSES.has(topLevelStatus)) {
    currentStatus.status = PENDING_STATUS;
  }

  return currentStatus;
}

export async function pauseVideoSessionRender(userId, payload = {}) {
  const { sessionId, userIdString, videoSession } = await getOwnedVideoSessionForRenderControl(userId, payload);
  assertRenderCanBePaused(videoSession);

  const pausedExpressGenerationStatus = buildPausedExpressGenerationStatus(
    videoSession.expressGenerationStatus,
  );
  const now = new Date();

  await VideoSession.updateOne(
    { _id: sessionId, userId: userIdString },
    {
      $set: {
        expressGenerationPending: false,
        videoGenerationPending: false,
        expressGenerationPaused: true,
        expressGenerationPausedAt: now,
        expressGenerationStatus: pausedExpressGenerationStatus,
      },
    },
  );

  return {
    request_id: sessionId,
    session_id: sessionId,
    status: PAUSED_STATUS,
    paused: true,
    expressGenerationPaused: true,
    expressGenerationPending: false,
    expressGenerationStatus: pausedExpressGenerationStatus,
    message: 'Render paused.',
  };
}

export async function resumeVideoSessionRender(userId, payload = {}) {
  const { sessionId, userIdString, videoSession } = await getOwnedVideoSessionForRenderControl(userId, payload);

  if (videoSession.expressGenerationCancelled) {
    const error = new Error('Cannot resume a cancelled render.');
    error.status = 409;
    throw error;
  }

  if (videoSession.expressGenerationFailed) {
    const error = new Error('Cannot resume a failed render.');
    error.status = 409;
    throw error;
  }

  if (videoSession.videoLink || videoSession.remoteURL) {
    const error = new Error('Cannot resume a completed render.');
    error.status = 409;
    throw error;
  }

  if (!videoSession.isExpressGeneration) {
    const error = new Error('Resume is only supported for express video generations.');
    error.status = 409;
    throw error;
  }

  const resumedExpressGenerationStatus = buildResumedExpressGenerationStatus(
    videoSession.expressGenerationStatus,
  );
  const now = new Date();

  await VideoSession.updateOne(
    { _id: sessionId, userId: userIdString },
    {
      $set: {
        expressGenerationPending: true,
        videoGenerationPending: true,
        expressGenerationPaused: false,
        expressGenerationResumedAt: now,
        expressGenerationStatus: resumedExpressGenerationStatus,
        expressGenerationCancelled: false,
      },
    },
  );

  return {
    request_id: sessionId,
    session_id: sessionId,
    status: PENDING_STATUS,
    paused: false,
    resumed: true,
    expressGenerationPaused: false,
    expressGenerationPending: true,
    expressGenerationStatus: resumedExpressGenerationStatus,
    message: 'Render resumed.',
  };
}
