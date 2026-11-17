import { randomUUID } from 'node:crypto';

// Queue recovery only after the ordinary render-control funding fence opens.
// Deterministic IDs make retries safe if a worker dies halfway through queuing.
export async function ensureExpressImageRecoveryRequests(session, { ImageGeneration, VideoSession }) {
  const recovery = session.expressImageRecovery;
  if (recovery?.version !== 1 || !['PENDING', 'QUEUING'].includes(recovery.status) || recovery.sessionId !== String(session._id) ||
      !session.expressGenerationPending || session.expressGenerationPaused || session.expressGenerationCancelled || session.expressGenerationFailed) return false;
  if (!session.postProcessingBilling && session.hostedAgentBilling?.version === 2 &&
      (session.hostedAgentBilling.state !== 'ACTIVE' || session.hostedAgentBilling.pendingOperation)) return false;
  const now = new Date(), token = randomUUID();
  const claimed = await VideoSession.findOneAndUpdate({ _id: session._id, 'expressImageRecovery.id': recovery.id,
    expressGenerationPending: true, expressGenerationPaused: { $ne: true }, expressGenerationFailed: { $ne: true },
    expressGenerationCancelled: { $ne: true },
    ...(!session.postProcessingBilling && session.hostedAgentBilling?.version === 2
      ? { 'hostedAgentBilling.state': 'ACTIVE', 'hostedAgentBilling.pendingOperation': null } : {}),
    $or: [{ 'expressImageRecovery.status': 'PENDING' },
      { 'expressImageRecovery.status': 'QUEUING', 'expressImageRecovery.leaseUntil': { $lte: now } }],
  }, { $set: { 'expressImageRecovery.status': 'QUEUING', 'expressImageRecovery.queueToken': token,
    'expressImageRecovery.leaseUntil': new Date(now.getTime() + 60000) } }, { new: true }).lean();
  if (!claimed) return false;
  const activeFilter = { _id: session._id, 'expressImageRecovery.id': recovery.id,
    'expressImageRecovery.status': 'QUEUING', 'expressImageRecovery.queueToken': token,
    expressGenerationPending: true, expressGenerationPaused: { $ne: true },
    expressGenerationCancelled: { $ne: true }, expressGenerationFailed: { $ne: true },
    ...(!claimed.postProcessingBilling && claimed.hostedAgentBilling?.version === 2 ? {
      'hostedAgentBilling.state': 'ACTIVE', 'hostedAgentBilling.pendingOperation': null,
      'hostedAgentBilling.controlRevision': claimed.hostedAgentBilling.controlRevision,
    } : {}),
  };
  for (const job of claimed.expressImageRecovery.jobs || []) {
    const latest = await VideoSession.findOne(activeFilter).lean();
    if (!latest) return false;
    const layer = (latest.layers || []).find(value => String(value?._id) === String(job.layerId));
    if (!layer || layer.imageSession?.generationStatus === 'COMPLETED') continue;
    const hasSelectedBaseImage = Array.isArray(layer.imageSession?.activeItemList) && layer.imageSession.activeItemList.some(item =>
      String(item?.type || '').trim().toLowerCase() === 'image' && item?.is_base_image === true &&
      typeof item?.src === 'string' && item.src.trim());
    const hasCompletedAsset = hasSelectedBaseImage || String(layer.aiVideoGenerationStatus || '').toUpperCase() === 'COMPLETED' ||
      [layer.aiVideoLayer, layer.aiVideoRemoteLink, layer.imageSession?.activeGeneratedImage, layer.imageSession?.activeSelectedImage]
        .some(value => typeof value === 'string' && value.trim());
    if (hasCompletedAsset) {
      await VideoSession.updateOne({ ...activeFilter, 'layers._id': layer._id }, { $set: {
        'layers.$.imageSession.generationStatus': 'COMPLETED', 'layers.$.imageSession.generationError': null,
      } });
      continue;
    }
    const existing = await ImageGeneration.findOne({ videoSessionId: String(session._id), layerId: String(layer._id),
      generationStatus: { $nin: ['COMPLETED', 'FAILED', 'CANCELLED'] } });
    if (existing) continue;
    await ImageGeneration.updateOne({ _id: job._id }, { $setOnInsert: { ...job, expireAt: new Date() } }, { upsert: true });
  }
  const marked = await VideoSession.updateOne(activeFilter, { $set: {
    'expressImageRecovery.status': 'QUEUED', 'expressImageRecovery.queuedAt': new Date(),
  } });
  return marked?.matchedCount !== 0;
}
