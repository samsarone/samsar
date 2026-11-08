import VideoSession from '../../schema/VideoSession.js';
import { deductGenerationCreditsIdempotently } from '../GenerationCredits.js';
import { postProcessingReceipt } from '../../billing/PostProcessingBilling.js';

// Admission is owned by the new session, before any media is copied. Fixed fees
// keep their existing policy; no original agent quote or allocation is reused.
export async function admitPostProcessing({ sessionId, userId, operation, priceCredits = 0,
  external = false, mode = 'fixed', metadata = {} }) {
  const billing = { version: 1, sessionId: String(sessionId), userId: String(userId), operation,
    mode: external ? 'external' : mode, priceCredits, creditsCharged: 0, creditsRefunded: 0,
    refundLimit: 0, status: 'PENDING', createdAt: new Date() };
  await VideoSession.updateOne({ _id: sessionId, userId: String(userId), postProcessingBilling: { $exists: false } }, { $set: {
    postProcessingBilling: billing, videoBillingPolicy: mode === 'adapter' ? 'adapter' : 'pipeline',
  } });
  const admitted = (await VideoSession.findById(sessionId))?.postProcessingBilling;
  if (!admitted || admitted.sessionId !== String(sessionId) || admitted.userId !== String(userId) ||
      admitted.operation !== operation || admitted.priceCredits !== priceCredits || admitted.mode !== billing.mode) {
    throw Object.assign(new Error('Post-processing billing does not match this request.'), {
      code: 'POST_PROCESSING_BILLING_CONFLICT', status: 409,
    });
  }
  const result = external || priceCredits <= 0 ? { remainingCredits: null }
    : await deductGenerationCreditsIdempotently(userId, priceCredits, {
      source: operation, idempotencyKey: `post-processing:${sessionId}:admission`,
      metadata: { ...metadata, sessionId: String(sessionId), billingType: 'post_processing' },
    });
  billing.creditsCharged = external ? 0 : priceCredits;
  billing.refundLimit = billing.creditsCharged;
  billing.transactionId = result.transactionId || null;
  billing.status = 'FUNDED';
  await VideoSession.updateOne({ _id: sessionId, 'postProcessingBilling.status': 'PENDING' }, { $set: {
    postProcessingBilling: billing, sessionReceipt: postProcessingReceipt(billing),
    expressGenerationCreditCharges: { version: 1, billingType: 'post_processing', stages: {},
      totalCharged: billing.creditsCharged, totalRefunded: 0 },
  } });
  return result;
}
