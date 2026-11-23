import VideoSession from '../../schema/VideoSession.js';
import VideoGeneration from '../../schema/VideoGeneration.js';
import { getDBConnectionString } from '../DBString.js';

const completedStatuses = ['COMPLETED', 'DONE', 'SUCCESS', 'SUCCEEDED'];
const failedStatuses = ['FAILED', 'ERROR', 'TIMEOUT'];
const cancelledStatuses = ['CANCELLED', 'CANCELED'];
const activeStatuses = ['QUEUED', 'PENDING', 'RUNNING', 'IN_PROGRESS', 'PROCESSING'];
const renderStatuses = [...completedStatuses, ...failedStatuses, ...cancelledStatuses, ...activeStatuses, 'PAUSED'];

function normalizeStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function renderStatus(session) {
  const finalStage = normalizeStatus(session.expressGenerationStatus?.video_generation);
  const overall = normalizeStatus(session.expressGenerationStatus?.status);
  const builder = normalizeStatus(session.expressGenerationBuilder?.status);
  const step = session.expressStepGeneration || {};
  if (session.expressGenerationCancelled) return 'cancelled';
  if (session.expressGenerationFailed || session.hasError) return 'failed';

  // Studio clears both the previous output and explicit failure flags on resubmission,
  // but historical pipeline stages can retain the previous run's terminal state.
  const legacyStages = [overall, finalStage];
  const active = session.videoGenerationPending || session.expressGenerationPending;
  if ((!active || session.expressGenerationCancelled !== false) && legacyStages.some(s => cancelledStatuses.includes(s))) return 'cancelled';
  if ((!active || session.expressGenerationFailed !== false) && legacyStages.some(s => failedStatuses.includes(s))) return 'failed';
  if (session.expressGenerationPaused || overall === 'PAUSED') return 'paused';
  if (session.postProcessingPreparationPending || overall === 'QUEUED') return 'pending';
  if (session.branches?.length) {
    const stages = session.branches.flatMap(path => [normalizeStatus(path.frame), normalizeStatus(path.video)]);
    if (stages.some(s => cancelledStatuses.includes(s))) return 'cancelled';
    if (stages.some(s => failedStatuses.includes(s))) return 'failed';
    return session.branches.every(path => completedStatuses.includes(normalizeStatus(path.video)) && path.hasOutput)
      ? 'completed' : 'pending';
  }
  if (session.hasOutput && !session.videoGenerationPending) return 'completed';
  if ((step.nextStep || step.next_step) && (step.waitingForProcessNext || step.waiting_for_process_next ||
    step.canProcessNext || step.can_process_next || step.requiresUserAction || step.requires_user_action)) return 'paused';
  if (session.videoGenerationPending) return 'pending';
  if (completedStatuses.includes(finalStage) || completedStatuses.includes(overall)) return 'completed';
  if (failedStatuses.includes(builder)) return 'failed';
  if (session.expressGenerationPending || (session.expressGenerationPending !== false &&
    [builder, overall, finalStage].some(s => activeStatuses.includes(s)))) return 'pending';
  // Studio's legacy cancel operation clears pending flags without setting a cancel flag.
  return 'cancelled';
}

export async function getLatestRender(userId) {
  await getDBConnectionString();
  const expressSubmission = [
    '$expressGenerationBuilder.queuedAt', '$expressStepGeneration.createdAt', '$renderRequestedAt', '$quickSessionCreatedAt',
  ].reduceRight((fallback, field) => ({ $ifNull: [field, fallback] }), '$expressGenerationCreated');
  const [session] = await VideoSession.aggregate([
    { $match: {
      userId: String(userId),
      isGuestSession: { $ne: true },
      isExternalUserRequest: { $ne: true },
      externalRequestUserId: { $in: [null, ''] },
      $nor: [
        { 'postProcessingBilling.operation': 'copy_studio', renderRequestedAt: null, videoGenerationPending: { $ne: true } },
        { builderStatus: 'DRAFT', builderSessionSubType: 'interactive_video_draft',
          expressGenerationPending: { $ne: true }, videoGenerationPending: { $ne: true }, renderRequestedAt: null },
      ],
      // A blank session defaults expressGenerationPending to true. That flag alone
      // (or the INIT/PENDING state of an individual preparation stage) is insufficient.
      $or: [
        { renderRequestedAt: { $type: 'date' } },
        { 'expressGenerationBuilder.queuedAt': { $type: 'date' } },
        { 'expressStepGeneration.createdAt': { $type: 'date' } },
        { expressGenerationCreated: { $type: 'date' } }, { quickSessionCreatedAt: { $type: 'date' } },
        { isExpressGeneration: true, expressGenerationPending: true }, { videoGenerationPending: true },
        { postProcessingPreparationPending: true }, { expressGenerationPaused: true },
        { expressGenerationCancelled: true }, { expressGenerationFailed: true },
        { generationError: { $gt: '' } }, { expressGenerationError: { $gt: '' } },
        { videoLink: { $gt: '' } }, { remoteURL: { $gt: '' } },
        { 'expressGenerationStatus.status': { $in: renderStatuses } },
        { 'expressGenerationStatus.video_generation': { $in: renderStatuses } },
      ],
    } },
    // Pre-timestamp Studio renders can still have their indexed, short-lived queue
    // record. An express pipeline's final encoding job is part of its original run.
    { $addFields: {
      legacyStudioId: { $cond: [
        { $and: [
          { $eq: ['$videoGenerationPending', true] }, { $eq: [{ $ifNull: ['$renderRequestedAt', null] }, null] },
          { $or: [{ $ne: ['$isExpressGeneration', true] }, { $ne: ['$expressGenerationPending', true] }] },
        ] },
        { $toString: '$_id' }, false,
      ] },
    } },
    { $lookup: {
      from: VideoGeneration.collection.name, localField: 'legacyStudioId', foreignField: 'videoSessionId', as: 'legacyStudioJobs',
    } },
    { $addFields: {
      submittedAt: { $max: ['$createdAt', '$renderRequestedAt', '$postProcessingBilling.createdAt', expressSubmission,
        { $max: '$legacyStudioJobs.createdAt' }] },
    } },
    { $sort: { submittedAt: -1, _id: -1 } },
    { $limit: 1 },
    { $project: {
      hasOutput: { $or: [{ $gt: ['$videoLink', ''] }, { $gt: ['$remoteURL', ''] }] },
      hasError: { $or: [{ $gt: ['$generationError', ''] }, { $gt: ['$expressGenerationError', ''] }] },
      branches: { $map: {
        input: { $ifNull: ['$branchRenderPaths', []] }, as: 'path',
        in: {
          frame: '$$path.frameGenerationStatus', video: '$$path.videoGenerationStatus',
          hasOutput: { $or: [{ $gt: ['$$path.videoLink', ''] }, { $gt: ['$$path.remoteURL', ''] }] },
        },
      } },
      videoGenerationPending: 1, expressGenerationPending: 1, postProcessingPreparationPending: 1,
      expressGenerationCancelled: 1, expressGenerationFailed: 1, expressGenerationPaused: 1,
      'expressGenerationBuilder.status': 1,
      'expressGenerationStatus.status': 1, 'expressGenerationStatus.video_generation': 1,
      'expressStepGeneration.nextStep': 1, 'expressStepGeneration.next_step': 1,
      'expressStepGeneration.canProcessNext': 1, 'expressStepGeneration.can_process_next': 1,
      'expressStepGeneration.waitingForProcessNext': 1, 'expressStepGeneration.waiting_for_process_next': 1,
      'expressStepGeneration.requiresUserAction': 1, 'expressStepGeneration.requires_user_action': 1,
    } },
  ]);
  return session ? { sessionId: String(session._id), status: renderStatus(session) } : null;
}
