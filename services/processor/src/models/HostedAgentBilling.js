import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';
import Ledger from '../schema/GenerationCreditTransaction.js';
import { shouldBypassGenerationCredits } from '../utils/EnvironmentUtils.js';
import { getDBConnectionString } from './DBString.js';
import { assertHostedAgentLimit } from '../billing/HostedAgentLimits.js';
import { buildHostedAgentQuote, hasHostedAgentProviderOverrides } from '../billing/HostedAgentUsage.js';
import { createHostedAgentRuntime } from '../billing/HostedAgentRuntime.js';

const runtime = createHostedAgentRuntime({ VideoSession, User, Ledger,
  bypass: shouldBypassGenerationCredits,
  beforeDebit: (session, amount) => assertHostedAgentLimit({ session, amount, User, Ledger }),
});

export async function beginHostedAgentBilling(sessionId, estimate, metadata = {}) {
  if (shouldBypassGenerationCredits() || metadata.isExternalUserRequest) return { ok: true, bypassed: true };
  await getDBConnectionString();
  try {
    return await runtime.begin(sessionId, buildHostedAgentQuote(estimate, metadata));
  } catch (error) {
    if (!['AGENT_CONTROL_SUPERSEDED', 'POST_PROCESSING_BILLING_CONFLICT'].includes(error.code)) {
      await VideoSession.updateOne({ _id: sessionId }, { $set: {
        expressGenerationFailed: true, expressGenerationPending: false, 'expressGenerationStatus.status': 'FAILED',
      } });
      await runtime.transition(sessionId, 'FAILED');
    }
    throw error;
  }
}

export async function fundHostedAgentRequest(userId, payload) {
  if (shouldBypassGenerationCredits() || payload.isExternalUserRequest ||
      hasHostedAgentProviderOverrides(payload)) return;
  const sessionId = payload.sessionID || payload.sessionId;
  const session = await VideoSession.findById(sessionId).lean();
  if (!session || String(session.userId) !== String(userId)) throw new Error('Agent session does not belong to user.');
  if (session.hostedAgentBilling) {
    const result = await runtime.begin(sessionId, session.hostedAgentBilling.quote);
    if (result.billing && result.billing.state !== 'ACTIVE') {
      throw Object.assign(new Error('Agent request is paused or terminal; use its resume endpoint.'), { code: 'AGENT_BILLING_PENDING' });
    }
    return result;
  }
  const { estimateExpressVideoCreditsForPreflight } = await import('./ExpressVideoStageBilling.js');
  const model = payload.videoGenerationModel || payload.video_model || session.expressGenerativeVideoModel || 'RUNWAYML';
  const duration = Math.min(240, Math.max(10, Number(payload.duration) || 10)) +
    (payload.generateOutroImage || payload.outroImageUrl ? 8 : 0);
  const estimate = estimateExpressVideoCreditsForPreflight({ durationSeconds: duration, videoModel: model,
    imageModel: payload.imageModel, pricingRateClass: 'agent', customAdapters: payload.custom_adapters,
    customAdapterOperationUsage: payload.customAdapterOperationUsage, samsarExternalProviderStages: session.samsarExternalProviderStages,
    expressCtaGeneration: payload.expressCtaGeneration, addNarratorAvatar: payload.addNarratorAvatar,
    expressGenerationNarrativeReused: Boolean(payload.preparedNarrativeArtifacts),
    excludedStageKeys: payload.preparedNarrativeArtifacts ? ['narrative_inference'] : [],
  });
  return beginHostedAgentBilling(sessionId, estimate, { model, pricingRateClass: 'agent' });
}

export async function settleHostedAgentBilling(sessionId, outcome, options) {
  if (shouldBypassGenerationCredits()) return { ok: true, legacy: true };
  await getDBConnectionString();
  return runtime.transition(sessionId, outcome, options);
}

export const completeHostedAgentStage = (sessionId, stage) => runtime.completeStage(sessionId, stage);

export async function controlHostedAgentBilling(sessionId, outcome, fields) {
  await getDBConnectionString();
  return runtime.control(sessionId, outcome, fields);
}

// Called after validated narrative generation, before downstream asset setup.
// A late completion is retained for a future resume, never charged while paused.
export async function recordHostedAgentNarrativeCompletion(sessionId) {
  if (shouldBypassGenerationCredits()) return;
  await VideoSession.updateOne({ _id: sessionId, 'hostedAgentBilling.version': 2,
    'hostedAgentBilling.state': { $nin: ['FAILED', 'CANCELLED', 'COMPLETED'] },
  }, { $set: { 'hostedAgentBilling.completedStages.narrative_inference': true } });
}
