import { createHash } from 'node:crypto';
import { calculateHostedAgentUsage, hasHostedAgentProviderOverrides, HOSTED_AGENT_BILLING_VERSION } from './HostedAgentUsage.js';

const failure = (message, code = 'AGENT_BILLING_PENDING') => Object.assign(new Error(message), { code, status: 409 });
const terminal = state => ['FAILED', 'CANCELLED', 'COMPLETED'].includes(state);

// A durable session operation serializes funding/refunds. Its wallet mutation
// and permanent identity are one atomic write on the account document. Ledger
// and session writes can then be retried without moving money a second time.
export function createHostedAgentSettlement({ VideoSession, resolveAccount, Ledger, bypass, beforeDebit = async () => {}, afterSettlement = async () => {} }) {
  async function assertOwnership(session) {
    const billing = session.hostedAgentBilling;
    if (!billing) return;
    if ((billing.sessionId && billing.sessionId !== String(session._id)) ||
        (billing.userId && billing.userId !== String(session.userId))) {
      throw failure('Agent billing belongs to another session or account.', 'AGENT_BILLING_OWNER_MISMATCH');
    }
    // Older v2 records did not store an owner. Accept them only when this
    // session's original funding is proven by its permanent wallet marker.
    if (!billing.sessionId && (billing.totalDebited > 0 || billing.netFunded > 0)) {
      const { Model, id } = await resolveAccount(session);
      const account = await Model.findById(id).select('+hostedAgentCreditMutations').lean();
      const prefix = `hosted-agent:${session._id}:`;
      if (!Object.values(account?.hostedAgentCreditMutations || {}).some(marker =>
        marker.operationId?.startsWith(prefix) && marker.delta > 0)) {
        throw failure('Agent funding cannot be attributed to this session.', 'AGENT_BILLING_OWNER_MISMATCH');
      }
    }
  }

  async function recover(session, { cancelFunding = false } = {}) {
    await assertOwnership(session);
    const billing = session.hostedAgentBilling;
    const operation = billing.pendingOperation;
    if (!operation) return;
    if (operation.id !== `hosted-agent:${session._id}:${billing.revision}`) {
      throw failure('Agent operation belongs to another session.', 'AGENT_BILLING_OWNER_MISMATCH');
    }
    const { Model, id, accountType = 'user' } = await resolveAccount(session);
    const markerKey = createHash('sha256').update(operation.id).digest('hex');
    const markerPath = `hostedAgentCreditMutations.${markerKey}`;
    let account = await Model.findById(id).select(`generationCredits +hostedAgentCreditMutations`).lean();
    let marker = account?.hostedAgentCreditMutations?.[markerKey];
    if (cancelFunding && operation.delta > 0 && !marker) {
      await Model.updateOne({ _id: id, [markerPath]: { $exists: false } }, { $set: {
        [markerPath]: { operationId: operation.id, delta: 0, cancelled: true },
      } });
      account = await Model.findById(id).select(`generationCredits +hostedAgentCreditMutations`).lean();
      marker = account?.hostedAgentCreditMutations?.[markerKey];
    }
    if (!marker && operation.delta !== 0) {
      if (operation.delta > 0) {
        try { await beforeDebit(session, operation.delta); } catch (error) {
          // Another recovery worker may have paid this operation while the
          // limit check ran. Its ledger entry must not make this retry fail.
          account = await Model.findById(id).select('generationCredits +hostedAgentCreditMutations').lean();
          marker = account?.hostedAgentCreditMutations?.[markerKey];
          if (!marker) throw error;
        }
      }
      if (!marker) account = await Model.findOneAndUpdate({ _id: id, [markerPath]: { $exists: false },
        ...(operation.delta > 0 ? { generationCredits: { $gte: operation.delta } } : {}) }, {
        $inc: { generationCredits: -operation.delta },
        $set: { [markerPath]: { operationId: operation.id, delta: operation.delta, createdAt: operation.createdAt } },
      }, { new: true }).select('generationCredits +hostedAgentCreditMutations').lean();
      if (!account) {
        account = await Model.findById(id).select(`generationCredits +hostedAgentCreditMutations`).lean();
        marker = account?.hostedAgentCreditMutations?.[markerKey];
        if (!marker) throw failure('Insufficient credits to fund the remaining agent request.', 'INSUFFICIENT_CREDITS');
      }
      marker = account.hostedAgentCreditMutations?.[markerKey];
    }
    if (marker?.cancelled) {
      await VideoSession.updateOne({ _id: session._id, 'hostedAgentBilling.pendingOperation.id': operation.id }, {
        $set: { 'hostedAgentBilling.pendingOperation': null },
      });
      return;
    }
    if (marker && marker.delta !== operation.delta) throw failure('Agent billing mutation conflicts with its saved amount.');
    if (operation.delta !== 0) {
      // A deterministic document ID also works in deployments without a newly
      // built unique secondary index. Never insert an unkeyed ledger entry.
      const ledgerId = createHash('sha256').update(operation.id).digest('hex').slice(0, 24);
      try { await Ledger.updateOne({ _id: ledgerId }, { $setOnInsert: {
        userId: id, amount: Math.abs(operation.delta), direction: operation.delta > 0 ? 'debit' : 'credit',
        source: operation.delta > 0 ? 'hosted_agent_funding' : 'hosted_agent_refund',
        idempotencyKey: operation.id, apiKeyId: session.apiKeyUsage?.apiKeyId || session.apiKeyId || null,
        balanceAfter: account?.generationCredits,
        metadata: { sessionId: String(session._id), accountType, outcome: operation.outcome, revision: operation.revision },
      } }, { upsert: true }); } catch (error) {
        if (error.code !== 11000) throw error;
        const saved = await Ledger.findById(ledgerId).lean();
        if (saved?.idempotencyKey !== operation.id || saved?.amount !== Math.abs(operation.delta) ||
            saved?.direction !== (operation.delta > 0 ? 'debit' : 'credit')) throw error;
      }
    }
    const totalDebited = billing.totalDebited + Math.max(0, operation.delta);
    const totalRefunded = billing.totalRefunded + Math.max(0, -operation.delta);
    const now = new Date();
    const earnedCredits = operation.usage?.totalCharged ?? billing.usage?.totalCharged ?? 0;
    const { layerAllocations, audioIntervals, ...publicUsage } = operation.usage || {};
    const receipt = { version: 2, durationSeconds: billing.quote.durationSeconds, stages: {}, ...publicUsage, totalCharged: operation.target, earnedCredits,
      prepaidCredits: Math.max(0, operation.target - earnedCredits), totalDebited, totalRefunded,
      remainingCredits: account?.generationCredits ?? null, updatedAt: now };
    const set = {
      'hostedAgentBilling.state': operation.outcome,
      'hostedAgentBilling.netFunded': operation.target,
      'hostedAgentBilling.totalDebited': totalDebited,
      'hostedAgentBilling.totalRefunded': totalRefunded,
      'hostedAgentBilling.usage': operation.usage || billing.usage || null,
      'hostedAgentBilling.pendingOperation': null,
      'hostedAgentBilling.updatedAt': now,
      expressGenerationCreditCharges: receipt,
      'sessionReceipt.stageBilling': true,
      'sessionReceipt.billingVersion': 2,
      'sessionReceipt.status': operation.outcome,
      'sessionReceipt.finalChargedCredits': receipt.totalCharged,
      'sessionReceipt.totalCharged': receipt.totalCharged,
      'sessionReceipt.refunded': totalRefunded,
      'sessionReceipt.totalDebited': totalDebited,
      'sessionReceipt.expressGenerationCreditCharges': receipt,
    };
    await VideoSession.updateOne({ _id: session._id, 'hostedAgentBilling.pendingOperation.id': operation.id }, { $set: set });
    await afterSettlement(session._id);
  }

  async function transition(sessionId, outcome, { controlRevision } = {}) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const session = await VideoSession.findById(sessionId).lean();
      const billing = session?.hostedAgentBilling;
      if (session?.postProcessingBilling?.version === 1) return { ok: true, legacy: true, postProcessing: true };
      if (bypass() || billing?.version !== HOSTED_AGENT_BILLING_VERSION) return { ok: true, legacy: true };
      await assertOwnership(session);
      if (controlRevision !== undefined && billing.controlRevision !== controlRevision) {
        throw failure('A newer render control request superseded this request.', 'AGENT_CONTROL_SUPERSEDED');
      }
      if (billing.pendingOperation) { await recover(session, { cancelFunding: outcome !== 'ACTIVE' }); continue; }
      if (terminal(billing.state)) {
        await afterSettlement(sessionId);
        if (outcome === 'ACTIVE') throw failure('A terminal agent request cannot be resumed.');
        return { ok: billing.state === outcome, blocked: billing.state !== outcome, alreadySettled: true, billing };
      }
      if (outcome === 'COMPLETED' && (session.expressGenerationPaused || session.expressGenerationFailed ||
          session.expressGenerationCancelled || billing.controlIntent === 'PAUSED')) {
        return { ok: false, blocked: true, billing };
      }
      if (outcome === 'ACTIVE' && billing.state === 'ACTIVE') return { ok: true, billing };
      if (outcome === 'PAUSED' && billing.state === 'PAUSED') return { ok: true, alreadySettled: true, billing };
      if (outcome === 'ACTIVE' && (session.expressGenerationFailed || session.expressGenerationCancelled)) {
        throw failure('A terminal agent request cannot be funded again.');
      }
      // Closing an already-paused request cannot bill late worker results.
      const usage = outcome === 'ACTIVE' ? billing.usage
        : billing.state === 'PAUSED' && ['FAILED', 'CANCELLED'].includes(outcome)
          ? { ...billing.usage, outcome } : calculateHostedAgentUsage(session, outcome);
      const target = outcome === 'ACTIVE' ? billing.quote.credits : usage.totalCharged;
      const revision = billing.revision + 1;
      const operation = { id: `hosted-agent:${sessionId}:${revision}`, revision, target, delta: target - billing.netFunded,
        outcome, usage, createdAt: new Date() };
      const claimed = await VideoSession.findOneAndUpdate({ _id: sessionId,
        'hostedAgentBilling.controlRevision': billing.controlRevision,
        ...(outcome === 'COMPLETED' ? { expressGenerationPaused: { $ne: true },
          expressGenerationFailed: { $ne: true }, expressGenerationCancelled: { $ne: true } } : {}),
        'hostedAgentBilling.revision': billing.revision, 'hostedAgentBilling.pendingOperation': null }, {
        $set: { 'hostedAgentBilling.pendingOperation': operation, 'hostedAgentBilling.revision': revision },
      }, { new: true }).lean();
      if (claimed) await recover(claimed);
    }
    throw failure('Agent billing changed concurrently; retry settlement.');
  }

  async function begin(sessionId, quote) {
    if (bypass()) return { ok: true, bypassed: true };
    const existing = await VideoSession.findById(sessionId).lean();
    if (!existing) throw failure('Agent session not found.');
    if (existing.postProcessingBilling?.version === 1) {
      throw failure('Full agent generation requires a new session after post-processing.', 'POST_PROCESSING_BILLING_CONFLICT');
    }
    await assertOwnership(existing);
    if (existing.videoBillingPolicy === 'adapter' || existing.isExternalUserRequest ||
        hasHostedAgentProviderOverrides(existing)) return { ok: true, bypassed: true };
    if (existing.hostedAgentBilling && existing.hostedAgentBilling.state !== 'UNFUNDED') {
      // Admission retries must not resume a paused request or replace its quote.
      if (existing.hostedAgentBilling.state === 'ACTIVE') return transition(sessionId, 'ACTIVE');
      return { ok: true, existing: true, billing: existing.hostedAgentBilling };
    }
    if (!existing.hostedAgentBilling && Number(existing.expressGenerationCreditCharges?.totalCharged) > 0) {
      // Existing charges cannot be safely inferred from a potentially incomplete
      // historical receipt. Do not silently charge or migrate old requests.
      return { ok: true, legacy: true };
    }
    await VideoSession.updateOne({ _id: sessionId, hostedAgentBilling: { $exists: false } }, { $set: {
      hostedAgentBilling: { version: 2, sessionId: String(sessionId), userId: String(existing.userId), quote, state: 'UNFUNDED', revision: 0, netFunded: 0,
        totalDebited: 0, totalRefunded: 0, completedStages: {}, pendingOperation: null, controlRevision: 0 },
    } });
    return transition(sessionId, 'ACTIVE');
  }

  async function completeStage(sessionId, stage) {
    const session = await VideoSession.findById(sessionId).lean();
    if (session?.postProcessingBilling?.version === 1) return { ok: true, postProcessing: true, creditsCharged: 0 };
    if (bypass() || session?.hostedAgentBilling?.version !== 2) return null;
    await assertOwnership(session);
    if (session.hostedAgentBilling.state === 'PAUSED' || session.hostedAgentBilling.controlIntent === 'PAUSED') {
      return { ok: true, paused: true, deferred: true, creditsCharged: 0 };
    }
    if (session.hostedAgentBilling.state !== 'ACTIVE' || session.hostedAgentBilling.pendingOperation) {
      throw failure('Agent request must be funded and active before stage advancement.');
    }
    const saved = await VideoSession.updateOne({ _id: sessionId, 'hostedAgentBilling.state': 'ACTIVE',
      'hostedAgentBilling.pendingOperation': null }, { $set: { [`hostedAgentBilling.completedStages.${stage}`]: true } });
    if (!saved.matchedCount) throw failure('Agent billing changed before stage advancement.');
    return { ok: true, allocated: true, creditsCharged: 0 };
  }

  async function control(sessionId, outcome, fields = {}) {
    const session = await VideoSession.findById(sessionId).lean();
    if (session?.postProcessingBilling?.version === 1) return { legacy: true, postProcessing: true };
    if (bypass() || session?.hostedAgentBilling?.version !== 2) return { legacy: true };
    await assertOwnership(session);
    if (terminal(session.hostedAgentBilling.pendingOperation?.outcome)) {
      await transition(sessionId, session.hostedAgentBilling.pendingOperation.outcome);
      throw failure('Agent completion is already being settled.');
    }
    if (terminal(session.hostedAgentBilling.state)) {
      if (session.hostedAgentBilling.state === outcome) return transition(sessionId, outcome);
      throw failure('A terminal agent request cannot be controlled.');
    }
    // Persist intent before moving money. A newer intent fences the older
    // caller, including its final write that makes generation runnable again.
    const claimed = await VideoSession.findOneAndUpdate({ _id: sessionId,
      'hostedAgentBilling.revision': session.hostedAgentBilling.revision,
      'hostedAgentBilling.controlRevision': session.hostedAgentBilling.controlRevision,
    }, { $inc: { 'hostedAgentBilling.controlRevision': 1 }, $set: {
      'hostedAgentBilling.controlIntent': outcome, 'hostedAgentBilling.controlFields': fields, ...fields,
      expressGenerationPending: false, videoGenerationPending: false,
      ...(outcome === 'ACTIVE' ? { expressGenerationPaused: true } : {}),
    } }, { new: true }).lean();
    if (!claimed) throw failure('Render control changed concurrently; retry.', 'AGENT_CONTROL_SUPERSEDED');
    return recoverControl(claimed);
  }

  async function recoverControl(claimed) {
    const sessionId = claimed._id;
    const outcome = claimed.hostedAgentBilling.controlIntent;
    const fields = claimed.hostedAgentBilling.controlFields || {};
    const controlRevision = claimed.hostedAgentBilling.controlRevision;
    let result;
    try {
      result = await transition(sessionId, outcome, { controlRevision });
    } catch (error) {
      if (outcome === 'ACTIVE' && ['INSUFFICIENT_CREDITS', 'API_KEY_USAGE_LIMIT_EXCEEDED'].includes(error.code)) {
        await transition(sessionId, 'PAUSED', { controlRevision });
        await VideoSession.updateOne({ _id: sessionId, 'hostedAgentBilling.controlRevision': controlRevision }, {
          $set: { 'hostedAgentBilling.controlIntent': 'PAUSED' },
        });
      }
      throw error;
    }
    if (outcome === 'ACTIVE') {
      const activated = await VideoSession.updateOne({ _id: sessionId,
        'hostedAgentBilling.controlRevision': controlRevision, 'hostedAgentBilling.state': 'ACTIVE',
        'hostedAgentBilling.pendingOperation': null,
        expressGenerationCancelled: { $ne: true }, expressGenerationFailed: { $ne: true },
      }, { $set: { ...fields, expressGenerationPending: true,
        videoGenerationPending: Boolean(fields.videoGenerationPending) && !(claimed.videoLink || claimed.remoteURL), expressGenerationPaused: false } });
      if (!activated.matchedCount) throw failure('Render control changed before resume.', 'AGENT_CONTROL_SUPERSEDED');
    }
    return result;
  }
  return { begin, transition, completeStage, recover, control, recoverControl };
}
