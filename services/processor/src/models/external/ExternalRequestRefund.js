import User from '../../schema/User.js';
import ExternalUser from '../../schema/ExternalUser.js';
import CustomerSubAccount from '../../schema/CustomerSubAccount.js';
import ExternalUserRequest from '../../schema/ExternalUserRequest.js';
import Ledger from '../../schema/GenerationCreditTransaction.js';
import ExternalLedger from '../../schema/ExternalUserGenerationCreditTransaction.js';
import { createCappedRefund } from '../../billing/CappedRefund.js';
import { mutateWalletOnce, recordCreditOperationOnce } from '../../billing/WalletMutation.js';

export function createExternalRequestRefund(isInternalBillingExternalUser) {
  return createCappedRefund({ Record: ExternalUserRequest,
    async initialize(record) {
      const externalUser = await ExternalUser.findById(record.externalUserId).lean();
      if (!externalUser) throw new Error('External refund account not found.');
      const account = record.billingAccount || {
        type: isInternalBillingExternalUser(externalUser) ? 'internal' : 'external',
        userId: String(externalUser.internalUserId), externalUserId: String(externalUser._id),
        subAccountId: externalUser.customerSubAccountId ? String(externalUser.customerSubAccountId) : null,
      };
      let refunded = Math.max(0, Number(record.creditsRefunded) || 0);
      let ceiling = Number(record.refundCeilingCredits);
      if (!Number.isFinite(ceiling)) {
        // Old helpers disagreed on gross versus net creditsCharged. Prefer the
        // actual request ledger, not a guessed addition of both receipt fields.
        const entries = await ExternalLedger.aggregate([
          { $match: { 'metadata.externalRequestId': record.externalRequestId } },
          { $group: { _id: '$direction', amount: { $sum: '$amount' } } },
        ]);
        const debited = entries.find(item => item._id === 'debit')?.amount;
        const credited = entries.find(item => item._id === 'credit')?.amount || 0;
        ceiling = debited ?? Math.max(Number(record.creditsCharged) || 0, refunded);
        refunded = Math.max(refunded, credited);
      }
      return { ceiling: Math.max(0, ceiling), refunded: Math.min(ceiling, refunded), account };
    },
    async applyRefund(record, operation) {
      const account = record.refundSettlement.account;
      const external = await ExternalUser.findById(account.externalUserId).lean();
      if (!external || String(record.externalUserId) !== account.externalUserId ||
          String(external.internalUserId) !== account.userId) throw new Error('Refund account ownership mismatch.');
      const metadata = { externalRequestId: record.externalRequestId, upstreamSessionId: record.upstreamSessionId,
        routeKey: record.routeKey, refundTarget: operation.target };
      const source = `external_request_${record.routeKey || 'unknown'}_refund`;
      let remainingCredits;
      if (account.type === 'internal') {
        const user = await mutateWalletOnce({ Model: User, id: account.userId,
          operationId: `${operation.id}:user`, delta: operation.delta });
        remainingCredits = user.generationCredits;
        await recordCreditOperationOnce(Ledger, `${operation.id}:user`, {
          userId: account.userId, direction: 'credit', amount: operation.delta, source, metadata, balanceAfter: remainingCredits,
        });
        const subLimit = account.subAccountRefundLimit ?? record.refundSettlement.ceiling;
        const subDelta = Math.max(0, Math.min(subLimit, operation.target) - Math.min(subLimit, operation.target - operation.delta));
        if (account.subAccountId && subDelta > 0) {
          const sub = await CustomerSubAccount.findById(account.subAccountId).lean();
          if (!sub || String(sub.internalUserId) !== account.userId) throw new Error('Refund allocation ownership mismatch.');
          if (sub.generationCredits != null && Number.isFinite(Number(sub.generationCredits))) {
            const updated = await mutateWalletOnce({ Model: CustomerSubAccount, id: account.subAccountId,
              operationId: `${operation.id}:allocation`, delta: subDelta,
              increments: { totalCreditsRefunded: subDelta } });
            remainingCredits = updated.generationCredits;
          }
        }
        await mutateWalletOnce({ Model: ExternalUser, id: account.externalUserId,
          operationId: `${operation.id}:mirror`, delta: 0,
          increments: { totalCreditsRefunded: operation.delta },
          set: { generationCredits: remainingCredits, lastActivityAt: new Date() } });
      } else {
        const updated = await mutateWalletOnce({ Model: ExternalUser, id: account.externalUserId,
          operationId: `${operation.id}:external`, delta: operation.delta,
          increments: { totalCreditsRefunded: operation.delta }, set: { lastActivityAt: new Date() } });
        remainingCredits = updated.generationCredits;
      }
      await recordCreditOperationOnce(ExternalLedger, `${operation.id}:external-ledger`, {
        internalUserId: account.userId, externalUserId: account.externalUserId,
        externalIdentityKey: external.externalIdentityKey, customerSubAccountId: account.subAccountId,
        direction: 'credit', amount: operation.delta, source, metadata, balanceAfter: remainingCredits,
      });
      return { remainingCredits };
    },
  });
}
