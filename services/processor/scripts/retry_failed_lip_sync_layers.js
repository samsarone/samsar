import crypto from 'crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: '.env', override: true });
dotenv.config({ path: '.env.production', override: true });

const [sessionId, ...args] = process.argv.slice(2);
const apply = args.includes('--apply');
const expectedCountArg = args.find((arg) => arg.startsWith('--expected-count='));
const expectedPathCountArg = args.find((arg) => arg.startsWith('--expected-path-count='));
const expectedCount = Number(expectedCountArg?.split('=')[1]);
const expectedPathCount = Number(expectedPathCountArg?.split('=')[1]);

if (!sessionId) {
  console.error(
    'Usage: node scripts/retry_failed_lip_sync_layers.js <sessionId> ' +
    '[--apply --expected-count=<count> --expected-path-count=<count>]',
  );
  process.exit(1);
}

const { default: VideoSession } = await import('../src/schema/VideoSession.js');
const { default: AIVideoLayerGeneration } = await import('../src/schema/AIVideoLayerGeneration.js');
const { default: FrameGeneration } = await import('../src/schema/FrameGeneration.js');
const { default: VideoGeneration } = await import('../src/schema/VideoGeneration.js');
const { getDBConnectionString } = await import('../src/models/DBString.js');

const normalize = (value) => typeof value === 'string' ? value.trim() : '';
const status = (value) => normalize(value).toUpperCase();
const id = (value) => value?.toString?.() || value || null;
const hasLipOutput = (layer) => Boolean(
  normalize(layer?.lipSyncVideoLayer) || normalize(layer?.lipSyncRemoteLink),
);
const hasBaseVideo = (layer) => Boolean(
  layer?.hasAiVideoLayer || normalize(layer?.aiVideoLayer) || normalize(layer?.aiVideoRemoteLink),
);
const isCharacter = (layer) => (
  normalize(layer?.layerBaseAiImageType).toLowerCase() === 'character' ||
  normalize(layer?.layerAiVideoType).toLowerCase() === 'character'
);

let claimToken = null;

try {
  await getDBConnectionString();
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }
  if (apply && (!Number.isInteger(expectedCount) || !Number.isInteger(expectedPathCount))) {
    throw new Error('--apply requires integer expected counts for layers and branch paths.');
  }

  const session = await VideoSession.findById(sessionId).lean();
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const layers = Array.isArray(session.layers) ? session.layers : [];
  const audioLayers = Array.isArray(session.audioLayers) ? session.audioLayers : [];
  const speechByLayerId = new Map(
    audioLayers
      .filter((audio) => normalize(audio?.generationType).toLowerCase() === 'speech')
      .map((audio) => [id(audio?.connectedLayerId), audio]),
  );
  const requiredLayers = layers.filter((layer) => isCharacter(layer) && speechByLayerId.has(id(layer?._id)));
  const targets = requiredLayers.filter((layer) => (
    status(layer?.lipSyncVideoGenerationStatus) === 'FAILED' && !hasLipOutput(layer)
  ));
  const targetIds = targets.map((layer) => id(layer._id));
  const targetIdSet = new Set(targetIds);
  const branchPaths = Array.isArray(session.branchRenderPaths) ? session.branchRenderPaths : [];

  const upstreamStages = [
    'prompt_generation',
    'image_generation',
    'audio_generation',
    'ai_video_generation',
    'sound_effect_generation',
    'transcript_generation',
    'delete_reflow',
    'timeline_reflowed',
    'narrator_avatar_generation',
  ];
  const incompleteUpstreamStages = upstreamStages.filter(
    (stage) => status(session?.expressGenerationStatus?.[stage]) !== 'COMPLETED',
  );
  const invalidRequiredLayers = requiredLayers.filter((layer) => {
    const audio = speechByLayerId.get(id(layer?._id));
    return !hasBaseVideo(layer) || status(layer?.aiVideoGenerationStatus) !== 'COMPLETED' ||
      status(audio?.generationStatus) !== 'COMPLETED' ||
      !(normalize(audio?.selectedLocalAudioLink) || normalize(audio?.selectedRemoteAudioLink)) ||
      (!targetIdSet.has(id(layer?._id)) &&
        !(status(layer?.lipSyncVideoGenerationStatus) === 'COMPLETED' && hasLipOutput(layer)));
  });

  const [aiRequests, frameRequests, videoRequests] = await Promise.all([
    AIVideoLayerGeneration.find({ sessionId }).select('_id layerId generationType status rowLocked').lean(),
    FrameGeneration.find({ sessionId }).select('_id rowLocked').lean(),
    VideoGeneration.find({ videoSessionId: sessionId }).select('_id rowLocked').lean(),
  ]);
  const blockingAiRequests = aiRequests.filter((request) => (
    request?.rowLocked === true || ['INIT', 'PENDING'].includes(status(request?.status))
  ));
  const lockedFrameRequests = frameRequests.filter((request) => request?.rowLocked === true);
  const lockedVideoRequests = videoRequests.filter((request) => request?.rowLocked === true);

  const summary = {
    sessionId,
    apply,
    sessionUpdatedAt: session.updatedAt,
    sessionActive: Boolean(session.expressGenerationPending || session.videoGenerationPending),
    sessionCancelled: Boolean(session.expressGenerationCancelled),
    targetCount: targets.length,
    targetLayerIds: targetIds,
    requiredLipSyncCount: requiredLayers.length,
    invalidRequiredLayerIds: invalidRequiredLayers.map((layer) => id(layer._id)),
    incompleteUpstreamStages,
    branchPathCount: branchPaths.length,
    branchPathIds: branchPaths.map((path) => path?.pathId || null),
    queueCounts: {
      aiVideo: aiRequests.length,
      frame: frameRequests.length,
      video: videoRequests.length,
      blockingAi: blockingAiRequests.length,
      lockedFrame: lockedFrameRequests.length,
      lockedVideo: lockedVideoRequests.length,
    },
  };
  console.log(JSON.stringify({ before: summary }, null, 2));

  if (!apply) {
    process.exitCode = 0;
  } else {
    if (session.expressGenerationPending || session.videoGenerationPending) {
      throw new Error('Session is already active; refusing duplicate recovery.');
    }
    if (session.expressGenerationCancelled) {
      throw new Error('Cancelled sessions cannot be recovered by this command.');
    }
    if (targets.length !== expectedCount || requiredLayers.length !== expectedCount) {
      throw new Error(
        `Expected exactly ${expectedCount} failed required lip-sync layers; found ${targets.length}/${requiredLayers.length}.`,
      );
    }
    if (branchPaths.length !== expectedPathCount || branchPaths.some((path) => !Array.isArray(path?.timeline) || !path.timeline.length)) {
      throw new Error(`Expected exactly ${expectedPathCount} non-empty branch render paths.`);
    }
    if (invalidRequiredLayers.length || incompleteUpstreamStages.length) {
      throw new Error('Required inputs or an upstream stage are incomplete; refusing selective recovery.');
    }
    if (blockingAiRequests.length || lockedFrameRequests.length || lockedVideoRequests.length) {
      throw new Error('Active or locked queue rows prevent safe selective recovery.');
    }

    claimToken = crypto.randomUUID();
    const claimTime = new Date();
    const claimResult = await VideoSession.collection.updateOne(
      {
        _id: session._id,
        updatedAt: session.updatedAt,
        expressGenerationPending: { $ne: true },
        videoGenerationPending: { $ne: true },
        'lipSyncRecoveryClaim.token': { $exists: false },
      },
      {
        $set: {
          lipSyncRecoveryClaim: {
            token: claimToken,
            targetLayerIds: targetIds,
            createdAt: claimTime,
          },
          updatedAt: claimTime,
        },
      },
    );
    if (claimResult.modifiedCount !== 1) {
      throw new Error('Session changed before the recovery claim could be acquired.');
    }

    const [postClaimAi, postClaimFrame, postClaimVideo] = await Promise.all([
      AIVideoLayerGeneration.find({ sessionId }).select('_id status rowLocked').lean(),
      FrameGeneration.find({ sessionId }).select('_id rowLocked').lean(),
      VideoGeneration.find({ videoSessionId: sessionId }).select('_id rowLocked').lean(),
    ]);
    if (
      postClaimAi.some((request) => request?.rowLocked || ['INIT', 'PENDING'].includes(status(request?.status))) ||
      postClaimFrame.some((request) => request?.rowLocked) ||
      postClaimVideo.some((request) => request?.rowLocked)
    ) {
      throw new Error('Queue state changed after the recovery claim was acquired.');
    }

    const [deletedLip, deletedFrames, deletedVideos] = await Promise.all([
      AIVideoLayerGeneration.deleteMany({
        sessionId,
        layerId: { $in: targetIds },
        generationType: 'lip_sync',
        status: 'FAILED',
        rowLocked: { $ne: true },
      }),
      FrameGeneration.deleteMany({ sessionId, rowLocked: { $ne: true } }),
      VideoGeneration.deleteMany({ videoSessionId: sessionId, rowLocked: { $ne: true } }),
    ]);

    const now = new Date();
    const set = {
      expressGenerationPending: true,
      expressGenerationPaused: false,
      expressGenerationPausedAt: null,
      expressGenerationResumedAt: now,
      expressGenerationCancelled: false,
      expressGenerationFailed: false,
      expressGenerationError: null,
      generationError: null,
      generationStatus: 'PENDING',
      lastLipSyncGenerationError: null,
      lipSyncGenerationPending: false,
      frameGenerationPending: false,
      videoGenerationPending: false,
      videoLink: null,
      remoteURL: null,
      videoVideoLink: null,
      branchRenderCompletionFinalized: false,
      branchRenderCompletedAt: null,
      'expressGenerationStatus.status': 'PENDING',
      'expressGenerationStatus.lip_sync_generation': 'INIT',
      'expressGenerationStatus.frame_generation': 'INIT',
      'expressGenerationStatus.video_generation': 'INIT',
      updatedAt: now,
    };

    layers.forEach((layer, layerIndex) => {
      if (!targetIdSet.has(id(layer?._id))) return;
      const prefix = `layers.${layerIndex}`;
      set[`${prefix}.lipSyncGenerationPending`] = false;
      set[`${prefix}.lipSyncVideoGenerationStatus`] = 'INIT';
      set[`${prefix}.lipSyncVideoGenerationError`] = null;
      set[`${prefix}.lipSyncGenerationError`] = null;
      set[`${prefix}.hasLipSyncVideoLayer`] = false;
      set[`${prefix}.lipSyncVideoLayer`] = null;
      set[`${prefix}.lipSyncRemoteLink`] = null;
    });

    branchPaths.forEach((branchPath, pathIndex) => {
      const prefix = `branchRenderPaths.${pathIndex}`;
      set[`${prefix}.frameGenerationStatus`] = 'INIT';
      set[`${prefix}.frameGenerationPending`] = false;
      set[`${prefix}.frameGenerationError`] = null;
      set[`${prefix}.videoGenerationStatus`] = 'INIT';
      set[`${prefix}.videoGenerationPending`] = false;
      set[`${prefix}.videoGenerationError`] = null;
      set[`${prefix}.videoGenerationCompletedAt`] = null;
      set[`${prefix}.videoLink`] = null;
      set[`${prefix}.remoteURL`] = null;
      branchPath.timeline.forEach((entry, timelineIndex) => {
        const entryPrefix = `${prefix}.timeline.${timelineIndex}`;
        set[`${entryPrefix}.frameGenerationStatus`] = 'INIT';
        set[`${entryPrefix}.frameGenerationPending`] = false;
        set[`${entryPrefix}.frameGenerationError`] = null;
        set[`${entryPrefix}.error`] = null;
        set[`${entryPrefix}.frames`] = [];
      });
    });

    const activateResult = await VideoSession.collection.updateOne(
      {
        _id: session._id,
        'lipSyncRecoveryClaim.token': claimToken,
        expressGenerationPending: { $ne: true },
      },
      {
        $set: set,
        $unset: { lipSyncRecoveryClaim: '' },
      },
    );
    if (activateResult.modifiedCount !== 1) {
      throw new Error('Recovery claim was lost before session reactivation.');
    }
    claimToken = null;

    const after = await VideoSession.findById(sessionId)
      .select('expressGenerationPending expressGenerationStatus lipSyncGenerationPending frameGenerationPending videoGenerationPending branchRenderCompletionFinalized layers branchRenderPaths')
      .lean();
    console.log(JSON.stringify({
      applied: true,
      deletedQueueRows: {
        lipSync: deletedLip.deletedCount,
        frame: deletedFrames.deletedCount,
        video: deletedVideos.deletedCount,
      },
      after: {
        expressGenerationPending: after?.expressGenerationPending,
        expressGenerationStatus: after?.expressGenerationStatus,
        lipSyncGenerationPending: after?.lipSyncGenerationPending,
        frameGenerationPending: after?.frameGenerationPending,
        videoGenerationPending: after?.videoGenerationPending,
        branchRenderCompletionFinalized: after?.branchRenderCompletionFinalized,
        targetStatuses: (after?.layers || [])
          .filter((layer) => targetIdSet.has(id(layer?._id)))
          .map((layer) => ({
            layerId: id(layer._id),
            status: layer.lipSyncVideoGenerationStatus,
            pending: layer.lipSyncGenerationPending,
            hasOutput: hasLipOutput(layer),
          })),
        branchStatuses: (after?.branchRenderPaths || []).map((path) => ({
          pathId: path.pathId,
          frame: path.frameGenerationStatus,
          video: path.videoGenerationStatus,
        })),
      },
    }, null, 2));
  }
} catch (error) {
  if (claimToken) {
    try {
      await VideoSession.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(sessionId), 'lipSyncRecoveryClaim.token': claimToken },
        { $unset: { lipSyncRecoveryClaim: '' }, $set: { updatedAt: new Date() } },
      );
    } catch {
      // Preserve the original recovery error.
    }
  }
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
