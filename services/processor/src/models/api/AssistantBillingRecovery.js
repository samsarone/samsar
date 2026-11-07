import AssistantBillingRequest from '../../schema/AssistantBillingRequest.js';
import ExternalUser from '../../schema/ExternalUser.js';
import VideoSession from '../../schema/VideoSession.js';
import { getDBConnectionString } from '../DBString.js';
import { assistantBillingStore, chargeAssistantRequest } from './AssistantBillingStore.js';
import { runAssistantRequest } from './AssistantRequestBilling.js';
import { finalizeAssistantSession } from './AssistantAPI.js';

// Settlement resumes from saved provider responses, including after a restart
// without a client retry. It never makes another provider request.
export async function recoverAssistantBilling(dependencies = {}) {
  await (dependencies.connect || getDBConnectionString)();
  const receipts = dependencies.receipts || await AssistantBillingRequest.find({
    scope: { $in: ['assistant_completion', 'external_chat'] },
    status: { $in: ['BILLING_PENDING', 'PROCESSING'] },
    providerResponse: { $ne: null },
    errorCode: { $nin: ['ASSISTANT_BILLING_USAGE_REQUIRED', 'ASSISTANT_BILLING_INVALID_USAGE', 'ASSISTANT_BILLING_TOOL_COST_REQUIRED'] },
    $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
  }).limit(25).lean();
  const results = [];
  for (const receipt of receipts) {
    try {
      const context = receipt.context || {};
      const externalUser = context.externalUserId
        ? await (dependencies.ExternalUser || ExternalUser).findById(context.externalUserId).lean() : null;
      if (context.externalUserId && !externalUser) throw new Error('Assistant billing account no longer exists.');
      const result = await runAssistantRequest({
        id: receipt._id, fingerprint: receipt.fingerprint, userId: receipt.userId, scope: receipt.scope,
        store: dependencies.store || assistantBillingStore,
        generate: async () => { throw new Error('Billing recovery requires a saved provider response.'); },
        charge: (credits, options) => (dependencies.charge || chargeAssistantRequest)(receipt.userId, credits, {
          ...options, externalUser,
          source: receipt.scope === 'external_chat' ? 'external_chat_completion' : 'assistant_api_completion',
          metadata: { sessionId: context.sessionId, apiKeyUsage: context.apiKeyUsage },
        }),
        ...(receipt.scope === 'assistant_completion' ? {
          finalize: (...args) => finalizeAssistantSession(dependencies.VideoSession || VideoSession, context.sessionId, ...args),
        } : {}),
      });
      results.push({ id: receipt._id, result });
    } catch (error) {
      if (error.code !== 'ASSISTANT_REQUEST_IN_PROGRESS') {
        (dependencies.logger || console).error('[assistant-billing] Settlement pending', {
          requestId: receipt._id, code: error.code, message: error.message,
        });
      }
    }
  }
  return results;
}

export function startAssistantBillingRecovery({ intervalMs = 60_000 } = {}) {
  let running = false;
  const recover = async () => {
    if (running) return;
    running = true;
    try { await recoverAssistantBilling(); }
    catch (error) { console.error('[assistant-billing] Recovery unavailable:', error.message); }
    finally { running = false; }
  };
  const timer = setInterval(recover, intervalMs);
  timer.unref();
  void recover();
  return () => clearInterval(timer);
}
