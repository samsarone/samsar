import VideoSession from './schema/VideoSession.js';
import User from './schema/User.js';
import Ledger from './schema/GenerationCreditTransaction.js';
import { shouldBypassGenerationCredits } from './utils/EnvironmentUtils.js';
import { getDBConnectionString } from './DBString.js';
import { assertHostedAgentLimit } from './billing/HostedAgentLimits.js';
import { createHostedAgentRuntime } from './billing/HostedAgentRuntime.js';

const runtime = createHostedAgentRuntime({ VideoSession, User, Ledger, bypass: shouldBypassGenerationCredits,
  beforeDebit: (session, amount) => assertHostedAgentLimit({ session, amount, User, Ledger }),
});
export const completeHostedAgentStage = (sessionId, stage) => runtime.completeStage(sessionId, stage);
export async function settleHostedAgentBilling(sessionId, outcome) {
  if (shouldBypassGenerationCredits()) return { ok: true, legacy: true };
  await getDBConnectionString();
  return runtime.transition(sessionId, outcome);
}

export async function recoverHostedAgentSettlements() {
  if (shouldBypassGenerationCredits()) return;
  const sessions = await VideoSession.find({
    'hostedAgentBilling.version': 2,
    'hostedAgentBilling.state': { $in: ['ACTIVE', 'PAUSED', 'UNFUNDED'] },
    $or: [
      { 'hostedAgentBilling.pendingOperation.id': { $exists: true } },
      { expressGenerationFailed: true }, { expressGenerationCancelled: true },
      { expressGenerationPaused: true, 'hostedAgentBilling.state': { $ne: 'PAUSED' } },
      { 'hostedAgentBilling.controlIntent': 'ACTIVE', expressGenerationPaused: true },
      { 'hostedAgentBilling.controlIntent': 'PAUSED', 'hostedAgentBilling.state': { $ne: 'PAUSED' } },
    ],
  }).sort({ 'hostedAgentBilling.recoveryAttemptedAt': 1, _id: 1 }).limit(25).lean();
  for (const session of sessions) {
    try {
      if (session.hostedAgentBilling.controlIntent && !session.expressGenerationCancelled && !session.expressGenerationFailed) {
        await runtime.recoverControl(session);
        continue;
      }
      const outcome = session.expressGenerationCancelled ? 'CANCELLED' : session.expressGenerationFailed ? 'FAILED'
        : session.expressGenerationPaused ? 'PAUSED' : session.hostedAgentBilling.pendingOperation.outcome;
      await runtime.transition(session._id, outcome);
    } catch (error) {
      // Rotate persistent failures so one bad account cannot starve other refunds.
      await VideoSession.updateOne({ _id: session._id }, { $set: {
        'hostedAgentBilling.recoveryAttemptedAt': new Date(),
      } }).catch(() => {});
      console.error('[hosted_agent_billing] settlement remains pending', { sessionId: String(session._id), code: error.code || 'SETTLEMENT_FAILED' });
    }
  }
}

export async function controlHostedAgentBilling(sessionId, outcome, fields) {
  await getDBConnectionString();
  return runtime.control(sessionId, outcome, fields);
}
