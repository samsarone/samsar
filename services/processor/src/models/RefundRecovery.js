import ExternalUserRequest from '../schema/ExternalUserRequest.js';
import VideoSession from '../schema/VideoSession.js';
import { getDBConnectionString } from './DBString.js';
import { refundExternalRequestCredits } from './external/User.js';
import { refundLegacyProvisionalCredits } from './LegacyProvisionalRefund.js';

// Recovery only finishes already-persisted refund decisions. It never starts
// provider work or changes the price/refund policy of a completed request.
export async function recoverPendingRefunds(dependencies = {}) {
  await (dependencies.connect || getDBConnectionString)();
  const requests = dependencies.requests || await ExternalUserRequest.find({
    'refundSettlement.pendingOperation.id': { $exists: true },
  }).sort({ 'refundSettlement.recoveryAttemptedAt': 1, _id: 1 }).limit(25).lean();
  const sessions = dependencies.sessions || await VideoSession.find({
    'legacyProvisionalRefund.status': 'PENDING',
  }).sort({ 'legacyProvisionalRefund.recoveryAttemptedAt': 1, _id: 1 }).limit(25).lean();
  const results = [];
  for (const [kind, records, Model] of [['external', requests, ExternalUserRequest], ['legacy', sessions, VideoSession]]) {
    for (const record of records) {
      try {
        if (kind === 'external') {
          const operation = record.refundSettlement.pendingOperation;
          await (dependencies.refundExternal || refundExternalRequestCredits)({ externalRequestId: record.externalRequestId,
            creditsToRefund: operation.target, status: operation.fields?.status || record.status,
            reason: operation.fields?.errorMessage, responsePayload: operation.fields?.responsePayload });
        } else await (dependencies.refundLegacy || refundLegacyProvisionalCredits)(record._id);
        results.push({ kind, id: String(record._id), ok: true });
      } catch (error) {
        const path = kind === 'external' ? 'refundSettlement' : 'legacyProvisionalRefund';
        await (dependencies.markAttempt || ((id, update) => Model.updateOne({ _id: id }, update)))(record._id, {
          $set: { [`${path}.recoveryAttemptedAt`]: new Date() },
        }).catch(() => {});
        (dependencies.logger || console).error('[refund] Settlement pending', { kind, id: String(record._id), code: error.code });
        results.push({ kind, id: String(record._id), ok: false });
      }
    }
  }
  return results;
}

export function startRefundRecovery({ intervalMs = 60_000 } = {}) {
  let running = false;
  const recover = async () => {
    if (running) return;
    running = true;
    try { await recoverPendingRefunds(); }
    catch (error) { console.error('[refund] Recovery unavailable', { code: error.code }); }
    finally { running = false; }
  };
  const timer = setInterval(recover, intervalMs); timer.unref(); void recover();
  return () => clearInterval(timer);
}
