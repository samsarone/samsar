import AssistantWorkspace from './schema/AssistantWorkspace.js';
import { createAssistantStreamPublisher } from './AssistantStreamPublisher.js';
import { getDBConnectionString } from './DBConnection.js';
import VideoSession from './schema/VideoSession.js';
import AssistantQueryGeneration from './schema/AssistantQueryGeneration.js';
import { sendAssistantCompletionRequest } from './OpenAI.js';
import { buildAssistantMessages } from './AssistantMessageBuilder.js';
import User from './schema/User.js'; // Import the User model
import AssistantBillingRequest from './schema/AssistantBillingRequest.js';
import GenerationCreditTransaction from './schema/GenerationCreditTransaction.js';
import { assistantRequestIdentity, createMongoAssistantRequestStore, debitAssistantOwnerOnce, runAssistantRequest } from './AssistantRequestBilling.js';
const receiptStore = createMongoAssistantRequestStore(AssistantBillingRequest);
const billingStore = {
  ...receiptStore,
  // Queued replies live in the conversation. Once billed, receipts only need
  // accounting metadata; retaining a second transcript would defeat clearing it.
  save: (id, fields, leaseToken) => receiptStore.save(id, fields.status === 'COMPLETED'
    ? { ...fields, providerResponse: null, result: {
      creditsCharged: fields.result?.creditsCharged,
      remainingCredits: fields.result?.remainingCredits,
    } }
    : fields, leaseToken),
};
import {
  isGeminiInferenceModel,
  isKimiK3InferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';
import { isStandaloneEdition } from './DeploymentEnvironment.js';

export async function listenToAssistantQueryRequests() {
  while (true) {
    await getTimeout(1000);

    try {
      await getDBConnectionString();
      await processPendingAssistantRequests();
      await recoverPendingAssistantBilling();
    } catch (error) {
      console.error('[assistant-query-processor] Worker loop failed:', error);
    }
  }
}

async function chargeQueuedAssistant(userId, credits, { idempotencyKey, billing, response }) {
  return debitAssistantOwnerOnce({ Owner: User, ownerId: userId, credits, idempotencyKey,
    Ledger: GenerationCreditTransaction, ledger: { userId,
      source: 'assistant_query_completion', metadata: { category: 'assistant',
        model: response?.model, costUsd: billing.costUsd, costSource: billing.costSource,
        pricingMultiplier: billing.pricingMultiplier, usage: billing.usage } } });
}

async function saveQueuedAssistantOutput(sessionId, queryId, response, billing, debit, requestId, Session = VideoSession) {
  const message = { role: 'assistant', id: queryId, timestamp: new Date(),
    content: response.assistantOutputContent || response.output_text || response.output || '',
    openaiResponseId: response.id || `assistant:${requestId}`, model: response.model,
    usage: response.usage || null, creditsCharged: billing.credits };
  await Session.updateOne({ _id: sessionId,
    sessionMessages: { $elemMatch: { role: 'user', id: queryId } },
    $nor: [{ sessionMessages: { $elemMatch: { role: 'assistant', id: queryId } } }],
  }, { $push: { sessionMessages: message } });
  await Session.updateOne(activeAssistantQueryFilter(sessionId, queryId), {
    $set: { sessionMessageGenerationPending: false, sessionMessageGenerationError: null,
      assistantStream: { queryId, status: 'completed', text: '', updatedAt: new Date().toISOString() } },
  });
  return { response, creditsCharged: billing.credits, remainingCredits: debit.remainingCredits ?? null };
}

async function processPendingAssistantRequests() {
  const now = new Date();
  const claimable = { status: { $ne: 'reconciliation_required' }, $or: [
    { rowLocked: false }, { rowLocked: true, workerLeaseExpiresAt: { $lte: now } },
    { rowLocked: true, workerLeaseExpiresAt: null, updatedAt: { $lte: new Date(Date.now() - 11 * 60 * 1000) } },
  ] };
  const pendingRequests = await AssistantQueryGeneration.find(claimable);
  for (const request of pendingRequests) {
    const { sessionId, queryId } = request;
    const Session = request.sessionStore === "workspace" ? AssistantWorkspace : VideoSession;
    const inferenceModel = getAssistantRequestInferenceModel(request.inferenceModel);
    const claim = await AssistantQueryGeneration.updateOne(
      { _id: request._id, ...claimable },
      { $set: { rowLocked: true, workerLeaseExpiresAt: new Date(Date.now() + 11 * 60 * 1000) } },
    );
    if (claim.modifiedCount !== 1) continue;
    let sessionData;
    const progress = createAssistantStreamPublisher(snapshot => Session.updateOne(
      { ...activeAssistantQueryFilter(sessionId, queryId),
        ...(request.assistantSessionVersion ? { assistantSessionVersion: request.assistantSessionVersion } : {}) },
      { $set: { assistantStream: snapshot } }),
    { queryId, sessionVersion: request.assistantSessionVersion || 0 });
    try {
      sessionData = await Session.findOne({ _id: sessionId });
      if (!sessionData) throw new Error('Session not found');
      if (!isCurrentAssistantRequest(sessionData, request)) {
        await AssistantQueryGeneration.deleteOne({ _id: request._id });
        continue;
      }
      progress.restore(sessionData.assistantStream);
      const userData = await User.findOne({ _id: sessionData.userId });
      if (!userData) throw new Error('User not found');
      const identity = assistantRequestIdentity(sessionData.userId, 'queued_assistant', {}, String(request._id));
      await runAssistantRequest({ ...identity, userId: sessionData.userId, scope: 'queued_assistant',
        context: { sessionId, queryId, sessionStore: request.sessionStore || "video" }, model: inferenceModel, store: billingStore,
        waived: isStandaloneEdition(),
        admit: async () => {
          if (!isStandaloneEdition() && !(Number(userData.generationCredits) > 0)) {
            throw Object.assign(new Error('Insufficient credits'), { code: 'INSUFFICIENT_CREDITS' });
          }
        },
        generate: async (requestId) => {
          // Recheck after the asynchronous claim/admission steps and use fresh
          // history. A cleared/deleted exchange must not invoke the provider.
          const currentSession = await Session.findOne({ _id: sessionId });
          if (!isCurrentAssistantRequest(currentSession, request)) {
            throw Object.assign(new Error('Assistant session was cleared.'), { code: 'ASSISTANT_SESSION_CLEARED' });
          }
          const messages = buildAssistantMessages({ request, session: currentSession, user: userData, inferenceModel });
          if (request.stream) await progress.finish('streaming');
          const result = await sendAssistantCompletionRequest(messages, inferenceModel, {
            ...(request.modelSettings || {}), ...(request.stream ? { onText: progress.onText } : {}), assistantBillingRequestId: requestId, maxRetries: 0, externalMaxRetries: 0, authorization: getAssistantModelAuthorization(userData, request),
          });
          if (request.stream) {
            await progress.onText(result.outputText || '');
            await progress.finish('billing_pending');
          }
          // Retain pending billed work even after the old queue TTL would expire.
          await AssistantQueryGeneration.updateOne({ _id: request._id }, { $unset: { expireAt: '' } });
          return { ...result.response, model: result.response?.model || result.model || inferenceModel,
            output_text: result.outputText || '',
            output: result.response?.output || [], assistantOutputContent: result.outputContent || [] };
        },
        charge: (credits, context) => chargeQueuedAssistant(sessionData.userId, credits, context),
        finalize: (...args) => saveQueuedAssistantOutput(sessionId, queryId, ...args, Session),
      });
      await AssistantQueryGeneration.deleteOne({ _id: request._id });
    } catch (e) {
      console.error('[assistant-query-processor] Request retained or failed:', e);
      const identity = sessionData
        ? assistantRequestIdentity(sessionData.userId, 'queued_assistant', {}, String(request._id)) : null;
      const receipt = identity ? await billingStore.get(identity.id).catch(() => null) : null;
      if (e.code === 'ASSISTANT_REQUEST_IN_PROGRESS') {
        await AssistantQueryGeneration.updateOne({ _id: request._id }, { $set: {
          rowLocked: true, workerLeaseExpiresAt: receipt?.leaseUntil || new Date(Date.now() + 60000),
        } });
        continue;
      }
      const requiresReconciliation = !receipt?.providerResponse || ['ASSISTANT_BILLING_USAGE_REQUIRED', 'ASSISTANT_BILLING_INVALID_USAGE', 'ASSISTANT_BILLING_TOOL_COST_REQUIRED'].includes(e.code);
      if (request.stream && e.code !== 'ASSISTANT_REQUEST_IN_PROGRESS') {
        await progress.finish(requiresReconciliation ? 'interrupted' : 'billing_pending', {
          error: e.message, code: e.code || 'ASSISTANT_REQUEST_FAILED',
        });
      }
      if (receipt?.providerResponse || receipt?.status === 'BILLING_PENDING' || e.code === 'ASSISTANT_REQUEST_IN_PROGRESS') {
        await AssistantQueryGeneration.updateOne({ _id: request._id }, { $set: {
          rowLocked: false, workerLeaseExpiresAt: null, status: requiresReconciliation ? 'reconciliation_required' : 'billing_pending',
        }, $unset: { expireAt: '' } });
        if (requiresReconciliation && e.code !== 'ASSISTANT_REQUEST_IN_PROGRESS') {
          await Session.updateOne(activeAssistantQueryFilter(sessionId, queryId), {
            $set: { sessionMessageGenerationPending: false, sessionMessageGenerationError: e.message },
          });
        }
      } else {
        if (sessionData) {
          // Never save the stale document read before inference: reset or a new
          // query may already have changed the conversation and pending state.
          await Session.updateOne(activeAssistantQueryFilter(sessionId, queryId), { $set: { sessionMessageGenerationPending: false, sessionMessageGenerationError: e.message } });
        }
        await AssistantQueryGeneration.deleteOne({ _id: request._id });
      }
    }
  }
}

async function recoverPendingAssistantBilling() {
  const receipts = await AssistantBillingRequest.find({ scope: 'queued_assistant', status: { $in: ['BILLING_PENDING', 'PROCESSING'] },
    providerResponse: { $ne: null }, errorCode: { $nin: ['ASSISTANT_BILLING_USAGE_REQUIRED', 'ASSISTANT_BILLING_INVALID_USAGE', 'ASSISTANT_BILLING_TOOL_COST_REQUIRED'] }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }] }).limit(25).lean();
  for (const receipt of receipts) {
    try {
      await runAssistantRequest({ id: receipt._id, fingerprint: receipt.fingerprint, userId: receipt.userId,
        scope: receipt.scope, store: billingStore, waived: isStandaloneEdition(),
        generate: async () => { throw new Error('Recovery must reuse the saved provider response'); },
        charge: (credits, context) => chargeQueuedAssistant(receipt.userId, credits, context),
        finalize: (...args) => saveQueuedAssistantOutput(receipt.context.sessionId, receipt.context.queryId, ...args, receipt.context.sessionStore === "workspace" ? AssistantWorkspace : VideoSession),
      });
      await AssistantQueryGeneration.deleteOne({ sessionId: receipt.context.sessionId, queryId: receipt.context.queryId });
    } catch (e) { console.error('[assistant-query-processor] Billing recovery pending:', e.message); }
  }
}


function isCurrentAssistantRequest(session, request) {
  return Boolean(session &&
    (session.assistantSessionVersion || 0) === (request.assistantSessionVersion || 0) &&
    session.sessionMessages?.some(message => message.role === 'user' && message.id === request.queryId));
}

function getAssistantRequestInferenceModel(inferenceModel) {
  if (isGeminiInferenceModel(inferenceModel) || isKimiK3InferenceModel(inferenceModel)) {
    return typeof inferenceModel === 'string' && inferenceModel.trim()
      ? inferenceModel.trim()
      : normalizeInferenceModel(inferenceModel);
  }

  return normalizeInferenceModel(inferenceModel);
}

function normalizeAuthorization(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
}

function getAssistantModelAuthorization(userData = {}, request = {}) {
  const modelSettings = request?.modelSettings && typeof request.modelSettings === 'object'
    ? request.modelSettings
    : {};
  const authorization = normalizeAuthorization(
    modelSettings.authorization ||
    modelSettings.modelAuthorization ||
    modelSettings.assistantModelAuthorization ||
    modelSettings.selectedAssistantModelAuthorization ||
    userData?.selectedAssistantModelAuthorization
  );

  return authorization || 'native';
}

async function getTimeout(timeout = 1000) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

function activeAssistantQueryFilter(sessionId, queryId) {
  return { _id: sessionId, sessionMessages: { $elemMatch: { role: 'user', id: queryId } },
    $or: [{ assistantStream: null }, { 'assistantStream.queryId': queryId }] };
}
