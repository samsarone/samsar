import VideoSession from '../schema/VideoSession.js';
import ExternalUserRequest from '../schema/ExternalUserRequest.js';
import User from '../schema/User.js';
import Ledger from '../schema/GenerationCreditTransaction.js';
import { getDBConnectionString } from './DBString.js';
import { applyExternalRequestRefundBySessionId } from './external/User.js';
import { mutateWalletOnce, recordCreditOperationOnce } from '../billing/WalletMutation.js';

export async function refundLegacyProvisionalCredits(sessionId, reason = 'prompt_generation_failed') {
  await getDBConnectionString();
  let session = await VideoSession.findById(sessionId).lean();
  if (!session || session.hostedAgentBilling || session.postProcessingBilling) return;
  if (!session.legacyProvisionalRefund) {
    const amount = Number(session.provisionalCredits) || 0;
    if (amount <= 0) return;
    await VideoSession.updateOne({ _id: sessionId, provisionalCredits: amount,
      legacyProvisionalRefund: { $exists: false }, hostedAgentBilling: { $exists: false },
      postProcessingBilling: { $exists: false },
    }, { $set: { legacyProvisionalRefund: { amount, sessionId: String(sessionId),
      userId: String(session.userId), status: 'PENDING', reason } } });
    session = await VideoSession.findById(sessionId).lean();
  }
  const refund = session.legacyProvisionalRefund;
  if (!refund || refund.status === 'COMPLETED') return;
  if (refund.sessionId !== String(sessionId) || refund.userId !== String(session.userId)) {
    throw new Error('Legacy refund belongs to another session.');
  }
  const external = await ExternalUserRequest.findOne({ internalUserId: refund.userId,
    upstreamSessionId: String(sessionId),
    ...(session.externalRequestUserId ? { externalUserId: session.externalRequestUserId } : {}),
  }).lean();
  if (external) {
    // The external settlement resolves either the external wallet or its parent
    // and allocation. Never also credit the internal wallet directly.
    await applyExternalRequestRefundBySessionId({ internalUserId: refund.userId,
      sessionId: String(sessionId), externalUserId: external.externalUserId,
      creditsRefunded: refund.amount, reason: refund.reason });
  } else {
    const operationId = `legacy-provisional-refund:${sessionId}`;
    const account = await mutateWalletOnce({ Model: User, id: refund.userId, operationId, delta: refund.amount });
    await recordCreditOperationOnce(Ledger, operationId, { userId: refund.userId,
      direction: 'credit', amount: refund.amount, source: 'video_generation_refund',
      metadata: { sessionId: String(sessionId), reason: refund.reason }, balanceAfter: account.generationCredits });
  }
  await VideoSession.updateOne({ _id: sessionId, 'legacyProvisionalRefund.sessionId': String(sessionId) }, { $set: {
    provisionalCredits: 0, 'legacyProvisionalRefund.status': 'COMPLETED',
  } });
}
