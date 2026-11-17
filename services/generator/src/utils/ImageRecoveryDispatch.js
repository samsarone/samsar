// Recovery queue insertion and cancellation happen in different services. Check
// current parent intent again immediately before starting a new provider call.
export async function prepareImageRecoveryDispatch(payload, {
  VideoSession, ImageGeneration, now = Date.now(),
}) {
  if (!payload?.imageRecoveryId || String(payload.apiGenerationStatus || '').toUpperCase() !== 'INIT') return true;

  const sessionId = payload.videoSessionId || payload.sessionId;
  const session = sessionId ? await VideoSession.findById(sessionId).select(
    '_id expressGenerationCancelled expressGenerationFailed expressGenerationPaused expressGenerationPending ' +
    'expressImageRecovery hostedAgentBilling postProcessingBilling layers',
  ).lean() : null;
  const layer = session?.layers?.find(value => String(value?._id) === String(payload.layerId));
  const image = layer?.imageSession;
  const hasAcceptedImage = [image?.activeGeneratedImage, image?.activeSelectedImage]
    .some(value => typeof value === 'string' && value.trim()) ||
    (Array.isArray(image?.activeItemList) && image.activeItemList.some(item =>
      item?.type === 'image' && item.is_base_image === true && typeof item.src === 'string' && item.src.trim()));
  const hasCompletedVideo = String(layer?.aiVideoGenerationStatus || '').toUpperCase() === 'COMPLETED' ||
    [layer?.aiVideoLayer, layer?.aiVideoRemoteLink].some(value => typeof value === 'string' && value.trim());
  const filter = { _id: payload._id, imageRecoveryId: payload.imageRecoveryId, apiGenerationStatus: 'INIT' };

  if (!session || session.expressGenerationCancelled || session.expressGenerationFailed ||
      session.expressImageRecovery?.id !== payload.imageRecoveryId || !layer ||
      String(image?.generationStatus || '').toUpperCase() === 'COMPLETED' || hasAcceptedImage || hasCompletedVideo) {
    // Never remove an accepted request if another dispatcher advanced this row
    // while the parent snapshot was being read.
    await ImageGeneration.deleteOne(filter);
    return false;
  }

  const billing = session.hostedAgentBilling;
  if (session.expressGenerationPaused || !session.expressGenerationPending ||
      (!session.postProcessingBilling && billing?.version === 2 && (billing.state !== 'ACTIVE' || billing.pendingOperation))) {
    await ImageGeneration.updateOne(filter, { $set: {
      rowLocked: false, nextAttemptAfter: new Date(Number(now) + 15000),
    } });
    return false;
  }
  return true;
}
