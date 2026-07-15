import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: '.env', override: true });
dotenv.config({ path: '.env.production', override: true });

const [sessionId, ...args] = process.argv.slice(2);
const apply = args.includes('--apply');
const expectedCountArgument = args.find((argument) => argument.startsWith('--expected-count='));
const expectedCount = expectedCountArgument
  ? Number(expectedCountArgument.slice('--expected-count='.length))
  : null;

if (!sessionId) {
  console.error(
    'Usage: node scripts/retry_failed_ai_video_layers.js <sessionId> [--apply --expected-count=<count>]',
  );
  process.exit(1);
}

const { default: VideoSession } = await import('../src/schema/VideoSession.js');
const { default: AIVideoLayerGeneration } = await import('../src/schema/AIVideoLayerGeneration.js');
const { default: GlobalSession } = await import('../src/schema/GlobalSession.js');
const { getDBConnectionString } = await import('../src/models/DBString.js');

const ACTIVE_AI_VIDEO_REQUEST_STATUSES = new Set(['INIT', 'PENDING']);
const AI_VIDEO_ALLOWED_BASE_TYPES = new Set(['character', 'narration', 'base', 'sound_effect']);
const AI_VIDEO_ALLOWED_LAYER_TYPES = new Set(['character', 'narration', 'base', 'scene', 'sound_effect']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectIdString(value) {
  return value?.toString?.() || value || null;
}

function normalizeStatus(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeBaseAiImageType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'scene' ? 'base' : normalized;
}

function isAiVideoCandidateLayer(layer = {}) {
  const layerType = normalizeString(layer?.layerAiVideoType).toLowerCase();
  const baseType = normalizeBaseAiImageType(layer?.layerBaseAiImageType);

  if (layer?.skipAiVideoGeneration === true || layer?.skipAiVideoGeneration === 'true') {
    return false;
  }
  if (layerType === 'none' || baseType === 'none') {
    return false;
  }
  if (baseType) {
    return AI_VIDEO_ALLOWED_BASE_TYPES.has(baseType);
  }
  return AI_VIDEO_ALLOWED_LAYER_TYPES.has(layerType);
}

function hasAiVideoOutput(layer = {}) {
  return Boolean(normalizeString(layer?.aiVideoLayer) || normalizeString(layer?.aiVideoRemoteLink));
}

function hasLipSyncOutput(layer = {}) {
  return Boolean(normalizeString(layer?.lipSyncVideoLayer) || normalizeString(layer?.lipSyncRemoteLink));
}

function compactLayer(layer, index) {
  return {
    index,
    id: objectIdString(layer?._id),
    layerAiVideoType: layer?.layerAiVideoType || null,
    layerBaseAiImageType: layer?.layerBaseAiImageType || null,
    aiVideoGenerationStatus: layer?.aiVideoGenerationStatus || null,
    aiVideoGenerationPending: Boolean(layer?.aiVideoGenerationPending),
    hasAiVideoOutput: hasAiVideoOutput(layer),
    hasAiVideoLayer: Boolean(layer?.hasAiVideoLayer),
  };
}

function compactRequest(request = {}) {
  return {
    id: objectIdString(request?._id),
    layerId: objectIdString(request?.layerId),
    status: request?.status || null,
    rowLocked: Boolean(request?.rowLocked),
    numRetries: Number(request?.numRetries) || 0,
    updatedAt: request?.updatedAt || null,
  };
}

function layerRecoveryFingerprint(layer = {}) {
  return JSON.stringify({
    id: objectIdString(layer?._id),
    aiVideoGenerationStatus: layer?.aiVideoGenerationStatus ?? null,
    aiVideoGenerationPending: layer?.aiVideoGenerationPending ?? null,
    hasAiVideoLayer: layer?.hasAiVideoLayer ?? null,
    aiVideoLayer: layer?.aiVideoLayer ?? null,
    aiVideoRemoteLink: layer?.aiVideoRemoteLink ?? null,
    lipSyncGenerationPending: layer?.lipSyncGenerationPending ?? null,
    lipSyncVideoGenerationStatus: layer?.lipSyncVideoGenerationStatus ?? null,
    lipSyncVideoLayer: layer?.lipSyncVideoLayer ?? null,
    lipSyncRemoteLink: layer?.lipSyncRemoteLink ?? null,
  });
}

async function run() {
  await getDBConnectionString();

  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new Error(`Session id must be a valid ObjectId: ${sessionId}`);
  }
  if (apply && (!Number.isInteger(expectedCount) || expectedCount < 1)) {
    throw new Error('--apply requires --expected-count=<positive integer>.');
  }

  const session = await VideoSession.findById(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const layers = Array.isArray(session.layers) ? session.layers : [];
  const targetLayers = layers.filter((layer) => (
    isAiVideoCandidateLayer(layer) &&
    normalizeStatus(layer?.aiVideoGenerationStatus) === 'FAILED' &&
    !hasAiVideoOutput(layer)
  ));
  const targetLayerIds = targetLayers.map((layer) => objectIdString(layer._id));
  const targetObjectIds = targetLayers.map((layer) => layer._id);
  const targetLayerIdSet = new Set(targetLayerIds);
  const nonTargetLayerFingerprints = new Map(
    layers
      .filter((layer) => !targetLayerIdSet.has(objectIdString(layer?._id)))
      .map((layer) => [objectIdString(layer?._id), layerRecoveryFingerprint(layer)]),
  );
  const completedLayers = layers.filter((layer) => (
    normalizeStatus(layer?.aiVideoGenerationStatus) === 'COMPLETED' || hasAiVideoOutput(layer)
  ));
  const unexpectedRetryableLayers = layers.filter((layer) => (
    isAiVideoCandidateLayer(layer) &&
    !targetLayerIdSet.has(objectIdString(layer?._id)) &&
    normalizeStatus(layer?.aiVideoGenerationStatus) !== 'COMPLETED' &&
    !hasAiVideoOutput(layer)
  ));

  const sessionRequests = await AIVideoLayerGeneration.find({
    sessionId: sessionId.toString(),
  }).select('_id layerId status rowLocked numRetries updatedAt').lean();
  const existingRequests = sessionRequests.filter((request) => (
    targetLayerIdSet.has(objectIdString(request?.layerId))
  ));
  const blockingRequests = existingRequests.filter((request) => (
    request?.rowLocked === true ||
    ACTIVE_AI_VIDEO_REQUEST_STATUSES.has(normalizeStatus(request?.status)) ||
    normalizeStatus(request?.status) !== 'FAILED'
  ));
  const activeSessionRequests = sessionRequests.filter((request) => (
    request?.rowLocked === true ||
    ACTIVE_AI_VIDEO_REQUEST_STATUSES.has(normalizeStatus(request?.status))
  ));

  console.log(JSON.stringify({
    before: {
      sessionId,
      apply,
      expectedCount,
      expressGenerationPending: Boolean(session.expressGenerationPending),
      expressGenerationFailed: Boolean(session.expressGenerationFailed),
      expressGenerationError: session.expressGenerationError || null,
      generationStatus: session.generationStatus || null,
      expressGenerationStatus: session.expressGenerationStatus || {},
      targetLayerCount: targetLayers.length,
      targetLayers: targetLayers.map((layer) => compactLayer(layer, layers.indexOf(layer))),
      unexpectedRetryableLayerCount: unexpectedRetryableLayers.length,
      unexpectedRetryableLayers: unexpectedRetryableLayers.map((layer) => compactLayer(
        layer,
        layers.indexOf(layer),
      )),
      completedLayerCount: completedLayers.length,
      completedLayers: completedLayers.map((layer) => compactLayer(layer, layers.indexOf(layer))),
      targetRequestCount: existingRequests.length,
      targetRequests: existingRequests.map(compactRequest),
      blockingRequestCount: blockingRequests.length,
      activeSessionRequestCount: activeSessionRequests.length,
    },
  }, null, 2));

  if (!apply) {
    return;
  }
  if (targetLayers.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} failed output-less AI-video layers, found ${targetLayers.length}.`,
    );
  }
  if (!session.expressGenerationFailed || session.expressGenerationPending) {
    throw new Error('Session must be terminal-failed and inactive before failed AI-video recovery.');
  }
  if (session.expressGenerativeVideoRequired !== true) {
    throw new Error('Session does not require express AI-video generation.');
  }
  if (session.expressGenerationCancelled) {
    throw new Error('Cancelled sessions cannot be resumed by this recovery command.');
  }
  if (normalizeStatus(session?.expressGenerationStatus?.ai_video_generation) !== 'FAILED') {
    throw new Error('Session must be failed specifically at the AI-video generation stage.');
  }
  if (normalizeStatus(session?.expressGenerationStatus?.image_generation) !== 'COMPLETED') {
    throw new Error('Image generation must be completed before AI-video-only recovery.');
  }
  if (normalizeStatus(session?.expressGenerationStatus?.audio_generation) !== 'COMPLETED') {
    throw new Error('Audio generation must be completed before AI-video-only recovery.');
  }
  if (blockingRequests.length) {
    throw new Error('Active, locked, completed, or unknown target request rows prevent safe recovery.');
  }
  if (activeSessionRequests.length) {
    throw new Error('Active or locked AI-video request rows elsewhere in the session prevent safe recovery.');
  }
  if (unexpectedRetryableLayers.length) {
    throw new Error('Non-target candidate layers could be requeued; refusing AI-video recovery.');
  }

  const claimToken = new mongoose.Types.ObjectId().toString();
  let claimHeld = false;
  let deleteResult;
  try {
    const claimResult = await VideoSession.updateOne(
      {
        _id: session._id,
        updatedAt: session.updatedAt,
        expressGenerationFailed: true,
        expressGenerationPending: { $ne: true },
        'aiVideoRecoveryClaim.token': { $exists: false },
      },
      {
        $set: {
          aiVideoRecoveryClaim: {
            token: claimToken,
            targetLayerIds,
            createdAt: new Date(),
          },
        },
      },
    );
    if (claimResult.matchedCount !== 1 || claimResult.modifiedCount !== 1) {
      throw new Error('Session changed before recovery could acquire its claim.');
    }
    claimHeld = true;

    const claimedSession = await VideoSession.findOne({
      _id: session._id,
      'aiVideoRecoveryClaim.token': claimToken,
    }).select('updatedAt').lean();
    if (!claimedSession) {
      throw new Error('Recovery claim disappeared before request cleanup.');
    }

    const claimedSessionRequests = await AIVideoLayerGeneration.find({
      sessionId: sessionId.toString(),
    }).select('_id layerId status rowLocked numRetries updatedAt').lean();
    const claimedActiveRequests = claimedSessionRequests.filter((request) => (
      request?.rowLocked === true ||
      ACTIVE_AI_VIDEO_REQUEST_STATUSES.has(normalizeStatus(request?.status))
    ));
    const claimedTargetRequests = claimedSessionRequests.filter((request) => (
      targetLayerIdSet.has(objectIdString(request?.layerId))
    ));
    const claimedInvalidTargetRequests = claimedTargetRequests.filter((request) => (
      request?.rowLocked === true || normalizeStatus(request?.status) !== 'FAILED'
    ));
    if (claimedActiveRequests.length || claimedInvalidTargetRequests.length) {
      throw new Error('AI-video request state changed after recovery acquired its claim.');
    }

    deleteResult = await AIVideoLayerGeneration.deleteMany({
      sessionId: sessionId.toString(),
      layerId: { $in: targetLayerIds },
      status: 'FAILED',
      rowLocked: { $ne: true },
    });
    if (deleteResult.deletedCount !== claimedTargetRequests.length) {
      throw new Error(
        `Deleted ${deleteResult.deletedCount} of ${claimedTargetRequests.length} stale target requests; session was not reactivated.`,
      );
    }

    const postDeleteActiveRequest = await AIVideoLayerGeneration.findOne({
      sessionId: sessionId.toString(),
      $or: [
        { rowLocked: true },
        { status: { $in: ['INIT', 'PENDING'] } },
      ],
    }).select('_id').lean();
    if (postDeleteActiveRequest) {
      throw new Error('AI-video request state changed during stale-row cleanup.');
    }

    const now = new Date();
    const setPayload = {
      expressGenerationPending: true,
      expressGenerationPaused: false,
      expressGenerationFailed: false,
      expressGenerationError: null,
      generationError: null,
      generationStatus: 'PENDING',
      aiVideoGenerationPending: false,
      lastAiVideoLayerGenerationError: null,
      'expressGenerationStatus.status': 'PENDING',
      'expressGenerationStatus.ai_video_generation': 'INIT',
      'expressStepGeneration.status': 'PENDING',
      'expressStepGeneration.currentStep': 'ai_video_generation',
      'expressStepGeneration.current_step': 'ai_video_generation',
      'expressStepGeneration.currentStepLabel': 'AI video',
      'expressStepGeneration.current_step_label': 'AI video',
      'expressStepGeneration.nextStep': null,
      'expressStepGeneration.next_step': null,
      'expressStepGeneration.error': null,
      'expressStepGeneration.waiting': false,
      'expressStepGeneration.waitingForProcessNext': false,
      'expressStepGeneration.waiting_for_process_next': false,
      'expressStepGeneration.requiresUserAction': false,
      'expressStepGeneration.requires_user_action': false,
      'expressStepGeneration.canProcessNext': false,
      'expressStepGeneration.can_process_next': false,
      'expressStepGeneration.updatedAt': now,
      'expressStepGeneration.updated_at': now,
      'layers.$[target].aiVideoGenerationPending': false,
      'layers.$[target].aiVideoGenerationStatus': 'INIT',
      'layers.$[target].hasAiVideoLayer': false,
      'layers.$[target].aiVideoGenerationError': null,
      'layers.$[target].processVideoGenerationFailed': false,
    };
    if (normalizeStatus(session?.expressGenerationStatus?.delete_reflow) !== 'COMPLETED') {
      setPayload['expressGenerationStatus.delete_reflow'] = 'INIT';
    }
    if (normalizeStatus(session?.expressGenerationStatus?.timeline_reflowed) !== 'COMPLETED') {
      setPayload['expressGenerationStatus.timeline_reflowed'] = 'INIT';
    }
    if (session.isStepVideoGeneration || session?.expressStepGeneration?.enabled) {
      setPayload['expressStepGeneration.enabled'] = true;
    }
    const arrayFilters = [{
      'target._id': { $in: targetObjectIds },
      'target.aiVideoGenerationStatus': 'FAILED',
      'target.aiVideoGenerationPending': { $ne: true },
      'target.aiVideoLayer': { $in: [null, ''] },
      'target.aiVideoRemoteLink': { $in: [null, ''] },
    }];
    const characterTargetIds = targetLayers
      .filter((layer) => (
        normalizeString(layer?.layerAiVideoType).toLowerCase() === 'character' &&
        normalizeStatus(layer?.lipSyncVideoGenerationStatus) !== 'COMPLETED' &&
        !hasLipSyncOutput(layer)
      ))
      .map((layer) => layer._id);
    if (characterTargetIds.length) {
      setPayload['layers.$[characterTarget].lipSyncGenerationPending'] = true;
      setPayload['layers.$[characterTarget].lipSyncVideoGenerationStatus'] = 'INIT';
      arrayFilters.push({
        'characterTarget._id': { $in: characterTargetIds },
        'characterTarget.lipSyncVideoGenerationStatus': { $ne: 'COMPLETED' },
        'characterTarget.lipSyncVideoLayer': { $in: [null, ''] },
        'characterTarget.lipSyncRemoteLink': { $in: [null, ''] },
      });
    }

    const targetGuards = targetObjectIds.map((targetId) => ({
      layers: {
        $elemMatch: {
          _id: targetId,
          aiVideoGenerationStatus: 'FAILED',
          aiVideoGenerationPending: { $ne: true },
          aiVideoLayer: { $in: [null, ''] },
          aiVideoRemoteLink: { $in: [null, ''] },
        },
      },
    }));
    const updateResult = await VideoSession.updateOne(
      {
        _id: session._id,
        updatedAt: claimedSession.updatedAt,
        'aiVideoRecoveryClaim.token': claimToken,
        expressGenerationFailed: true,
        expressGenerationPending: { $ne: true },
        $and: targetGuards,
      },
      {
        $set: setPayload,
        $unset: {
          'layers.$[target].aiVideoGenerationStartedAt': '',
          aiVideoRecoveryClaim: '',
        },
      },
      { arrayFilters },
    );
    if (updateResult.matchedCount !== 1 || updateResult.modifiedCount !== 1) {
      throw new Error(
        'Session or target layers changed during recovery; stale rows were removed but the session was not reactivated.',
      );
    }
    claimHeld = false;
  } catch (error) {
    if (claimHeld) {
      await VideoSession.updateOne(
        { _id: session._id, 'aiVideoRecoveryClaim.token': claimToken },
        { $unset: { aiVideoRecoveryClaim: '' } },
      );
    }
    throw error;
  }

  const globalSessionResult = await GlobalSession.updateMany(
    {
      $or: [
        { sessionId: sessionId.toString() },
        { requestId: sessionId.toString() },
        { apiSessionId: sessionId.toString() },
      ],
    },
    {
      $set: {
        status: 'PENDING',
        errorMessage: null,
      },
    },
  );

  const afterSession = await VideoSession.findById(sessionId)
    .select('expressGenerationPending expressGenerationFailed expressGenerationError generationStatus expressGenerationStatus expressStepGeneration layers')
    .lean();
  const afterTargets = (afterSession?.layers || []).filter((layer) => targetLayerIds.includes(objectIdString(layer?._id)));
  const preservedCompletedLayers = (afterSession?.layers || []).filter((layer) => (
    normalizeStatus(layer?.aiVideoGenerationStatus) === 'COMPLETED' || hasAiVideoOutput(layer)
  ));
  const invalidAfterTargets = afterTargets.filter((layer) => (
    !['INIT', 'PENDING', 'COMPLETED'].includes(normalizeStatus(layer?.aiVideoGenerationStatus))
  ));
  const changedNonTargetLayerIds = (afterSession?.layers || [])
    .filter((layer) => {
      const layerId = objectIdString(layer?._id);
      return nonTargetLayerFingerprints.has(layerId) &&
        nonTargetLayerFingerprints.get(layerId) !== layerRecoveryFingerprint(layer);
    })
    .map((layer) => objectIdString(layer?._id));
  if (
    afterTargets.length !== expectedCount ||
    invalidAfterTargets.length ||
    changedNonTargetLayerIds.length
  ) {
    throw new Error(
      `Recovery postcondition failed (targets=${afterTargets.length}, invalidTargets=${invalidAfterTargets.length}, changedNonTargets=${changedNonTargetLayerIds.length}).`,
    );
  }

  console.log(JSON.stringify({
    after: {
      deletedStaleTargetRequests: deleteResult.deletedCount,
      globalSessionsReset: globalSessionResult.modifiedCount || 0,
      expressGenerationPending: Boolean(afterSession?.expressGenerationPending),
      expressGenerationFailed: Boolean(afterSession?.expressGenerationFailed),
      expressGenerationError: afterSession?.expressGenerationError || null,
      generationStatus: afterSession?.generationStatus || null,
      expressGenerationStatus: afterSession?.expressGenerationStatus || {},
      targetLayers: afterTargets.map((layer) => compactLayer(
        layer,
        (afterSession?.layers || []).findIndex((item) => objectIdString(item?._id) === objectIdString(layer?._id)),
      )),
      preservedCompletedLayerCount: preservedCompletedLayers.length,
      changedNonTargetLayerCount: changedNonTargetLayerIds.length,
    },
  }, null, 2));
}

try {
  await run();
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
