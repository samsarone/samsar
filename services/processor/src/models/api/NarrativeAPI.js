import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import { isGeminiInferenceModel } from '../../consts/InferenceModels.js';
import NarrativeRequest from '../../schema/NarrativeRequest.js';
import GenerationCreditTransaction from '../../schema/GenerationCreditTransaction.js';
import User from '../../schema/User.js';
import { getDBConnectionString } from '../DBString.js';
import {
  assertAPIKeyUsageLimitForDebit,
  completeGenerationCreditDebitReservation,
  deductGenerationCreditsIdempotently,
} from '../GenerationCredits.js';
import { getModerationForNarrative } from '../moderation/CreateModeration.js';
import { NARRATIVE_MODERATION_FAILURE_MESSAGE } from '../moderation/ModerationFailureState.js';
import {
  buildMovieResourceListVisualPrompts,
  buildVideoSessionMovieResourceList,
} from '../movie_session/TranscriptMovieGenerator.js';
import {
  generateValidatedTextToVideoNarrative,
} from '../movie_session/text_to_video/NarrativeGenerator.js';
import { validateTextToVideoNarrative } from '../movie_session/utils/TranscriptUtils.js';
import {
  MAX_MOVIE_PROMPT_LENGTH,
  validateExpressVideoModelKey,
} from './PromptUtils.js';
import { resolveEffectiveInferenceModel } from './RequestModelOverrides.js';
import { normalizeAPIKeyUsageContext } from './RequestAuthContext.js';
import {
  calculateNarrativeBilling,
  NARRATIVE_PRICING_MULTIPLIER,
  validateNarrativeBilling,
} from './NarrativeBilling.js';

const MIN_NARRATIVE_DURATION_SECONDS = 10;
const MAX_NARRATIVE_DURATION_SECONDS = 240;
const NARRATIVE_VIDEO_MODEL = 'RUNWAYML';
const NARRATIVE_VIDEO_TONE = 'grounded';
const NARRATIVE_POLL_PATH = '/v2/external/narrative/status';
const DEFAULT_NARRATIVE_WORKER_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_NARRATIVE_RECOVERY_INTERVAL_MS = 60 * 1000;
const NARRATIVE_BILLING_SOURCE = 'external_narrative_create_single';
const NARRATIVE_ADMISSION_CREDIT_FLOOR = 0.0001;
const NARRATIVE_LEASE_LOST_CODE = 'NARRATIVE_WORKER_LEASE_LOST';
export const NARRATIVE_BILLING_POLICIES = Object.freeze({
  STANDALONE: 'standalone',
  INCLUDED_IN_INTERACTIVE_VIDEO_RATE: 'included_in_interactive_video_rate',
});
let narrativeRequestRecoveryInterval = null;
let narrativeBillingIndexesPromise = null;

function buildError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

export function normalizeNarrativeVideoModel(
  source = {},
  { required = false, fallback = NARRATIVE_VIDEO_MODEL } = {},
) {
  const hasSnakeCase = hasOwn(source, 'video_model');
  const hasCamelCase = hasOwn(source, 'videoModel');
  const snakeCaseValue = hasSnakeCase ? normalizeString(source.video_model) : '';
  const camelCaseValue = hasCamelCase ? normalizeString(source.videoModel) : '';

  if ((hasSnakeCase && !snakeCaseValue) || (hasCamelCase && !camelCaseValue)) {
    throw buildError(
      'video_model must be a non-empty string when provided.',
      400,
      'INVALID_VIDEO_MODEL',
    );
  }
  if (snakeCaseValue && camelCaseValue && snakeCaseValue !== camelCaseValue) {
    throw buildError(
      'video_model and videoModel must match when both are provided.',
      400,
      'CONFLICTING_VIDEO_MODEL',
    );
  }

  const requestedModel = snakeCaseValue || camelCaseValue;
  const validation = validateExpressVideoModelKey(requestedModel, { required });
  if (!validation.status) {
    if (!requestedModel && !required) return fallback;
    throw buildError(
      validation.message || 'Invalid video model.',
      400,
      'INVALID_VIDEO_MODEL',
    );
  }
  return validation.videoModel || fallback;
}

function normalizeNarrativeBillingPolicy(value) {
  return value === NARRATIVE_BILLING_POLICIES.INCLUDED_IN_INTERACTIVE_VIDEO_RATE
    ? value
    : NARRATIVE_BILLING_POLICIES.STANDALONE;
}

function getRequestErrorStatus(error) {
  if (error?.code === 'INSUFFICIENT_CREDITS' ||
    error?.code === 'API_KEY_USAGE_LIMIT_EXCEEDED') {
    return 402;
  }
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function getNarrativeWorkerLeaseMs() {
  const configured = Number(process.env.NARRATIVE_REQUEST_WORKER_LEASE_MS);
  return Number.isFinite(configured) && configured >= 60_000
    ? Math.floor(configured)
    : DEFAULT_NARRATIVE_WORKER_LEASE_MS;
}

function getNarrativeRecoveryIntervalMs() {
  const configured = Number(process.env.NARRATIVE_REQUEST_RECOVERY_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 10_000
    ? Math.floor(configured)
    : DEFAULT_NARRATIVE_RECOVERY_INTERVAL_MS;
}

function createNarrativeLeaseLostError() {
  return buildError(
    'Narrative request ownership changed while it was processing.',
    409,
    NARRATIVE_LEASE_LOST_CODE,
  );
}

function isNarrativeLeaseLostError(error) {
  return error?.code === NARRATIVE_LEASE_LOST_CODE;
}

function getUpdateMatchedCount(result) {
  for (const value of [result?.matchedCount, result?.n, result?.modifiedCount, result?.nModified]) {
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function assertWorkerUpdateMatched(result) {
  if (getUpdateMatchedCount(result) === 0) {
    throw createNarrativeLeaseLostError();
  }
  return result;
}

function buildOwnedNarrativeFilter(requestId, workerLeaseId, extra = {}) {
  return {
    _id: requestId,
    status: 'PROCESSING',
    workerLeaseId,
    ...extra,
  };
}

async function ensureNarrativeBillingIndexes() {
  if (!narrativeBillingIndexesPromise) {
    narrativeBillingIndexesPromise = Promise.resolve()
      .then(() => Promise.all([
        GenerationCreditTransaction.createIndexes(),
        NarrativeRequest.createIndexes(),
      ]))
      .catch((error) => {
        narrativeBillingIndexesPromise = null;
        throw buildError(
          `Narrative billing index is unavailable: ${error?.message || String(error)}`,
          503,
          'NARRATIVE_BILLING_INDEX_UNAVAILABLE',
        );
      });
  }
  return narrativeBillingIndexesPromise;
}

function deepCloneJson(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function restoreGenerationError(request) {
  return buildError(
    normalizeString(request?.generationFailureMessage) || 'Narrative generation failed.',
    Number(request?.generationFailureStatus) || 500,
    normalizeString(request?.generationFailureCode) || 'NARRATIVE_GENERATION_FAILED',
  );
}

function inferProvider(receipt = {}) {
  const explicitProvider = normalizeString(
    receipt.provider ||
    receipt.response?.provider ||
    receipt.response?.openrouter?.provider,
  );
  if (explicitProvider) return explicitProvider;

  const qualifiedModel = normalizeString(receipt.model || receipt.response?.model).toLowerCase();
  const model = qualifiedModel.includes('/')
    ? qualifiedModel.slice(qualifiedModel.lastIndexOf('/') + 1)
    : qualifiedModel;
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('qwen')) return 'alibaba_or_openrouter';
  if (model.startsWith('gpt-')) return 'openai';
  return null;
}

export function normalizeCreateSingleNarrativePayload(payload = {}) {
  const source = payload?.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
    ? payload.input
    : payload;
  const prompt = normalizeString(source?.prompt);
  if (!prompt) {
    throw buildError('prompt is required.', 400, 'INVALID_PROMPT');
  }
  if (prompt.length > MAX_MOVIE_PROMPT_LENGTH) {
    throw buildError(
      `prompt must not exceed ${MAX_MOVIE_PROMPT_LENGTH} characters.`,
      400,
      'INVALID_PROMPT',
    );
  }

  if (source?.duration === undefined || source?.duration === null || source?.duration === '') {
    throw buildError('duration is required.', 400, 'INVALID_DURATION');
  }
  const duration = Number(source.duration);
  if (!Number.isFinite(duration)) {
    throw buildError('duration must be a number.', 400, 'INVALID_DURATION');
  }
  if (duration < MIN_NARRATIVE_DURATION_SECONDS || duration > MAX_NARRATIVE_DURATION_SECONDS) {
    throw buildError(
      `duration must be between ${MIN_NARRATIVE_DURATION_SECONDS} and ${MAX_NARRATIVE_DURATION_SECONDS} seconds.`,
      400,
      'INVALID_DURATION',
    );
  }

  const videoGenerationModel = normalizeNarrativeVideoModel(source);
  return {
    prompt,
    duration,
    inference_model: source?.inference_model ?? source?.inferenceModel,
    inferenceModel: source?.inference_model ?? source?.inferenceModel,
    video_model: videoGenerationModel,
    videoGenerationModel,
  };
}

export function resolveNarrativeInferenceModel(payload, selectedInferenceModel) {
  return resolveEffectiveInferenceModel(payload, selectedInferenceModel);
}

function buildBillingPayload(request) {
  const billing = {
    pricing_multiplier: Number(request.pricingMultiplier) || NARRATIVE_PRICING_MULTIPLIER,
    underlying_cost_usd: Number(request.underlyingCostUsd) || 0,
    underlying_credits: Number(request.underlyingCredits) || 0,
    credits_charged: Number(request.creditsCharged) || 0,
    remaining_credits: request.remainingCredits ?? null,
    usage: request.inferenceUsage || null,
  };
  if (request.billingPolicy ===
    NARRATIVE_BILLING_POLICIES.INCLUDED_IN_INTERACTIVE_VIDEO_RATE) {
    billing.policy = request.billingPolicy;
    billing.reason = request.billingReason || request.billingPolicy;
  }
  return billing;
}

export function buildNarrativeRequestPayload(request) {
  const requestId = request?._id?.toString?.() || request?._id;
  const narrativeType = request?.narrativeType ||
    (request?.requestType === 'create_branching' ? 'branched' : 'singular');
  const payload = {
    request_id: requestId,
    requestId,
    request_type: request.requestType || 'create_single',
    narrative_type: narrativeType,
    status: request.status,
    poll_url: `${NARRATIVE_POLL_PATH}?request_id=${encodeURIComponent(requestId)}`,
    prompt: request.prompt,
    duration: request.duration,
    inference_model: request.inferenceModel,
    video_model: request.videoGenerationModel || NARRATIVE_VIDEO_MODEL,
    created_at: request.createdAt,
    updated_at: request.updatedAt,
  };

  if (request.sourceNarrativeRequestId) {
    payload.source_narrative_request_id = request.sourceNarrativeRequestId.toString();
  }
  if (request.numLevels !== null && request.numLevels !== undefined &&
    Number.isSafeInteger(Number(request.numLevels))) {
    payload.num_levels = Number(request.numLevels);
  }

  if (request.status === 'COMPLETED') {
    payload.themeJson = request.themeJson;
    payload.movieResourceList = request.movieResourceList;
    payload.narrativeJson = request.narrativeJson;
    if (narrativeType === 'branched' && request.branchingMeta) {
      payload.branchingMeta = request.branchingMeta;
    }
    payload.billing = buildBillingPayload(request);
    payload.creditsCharged = Number(request.creditsCharged) || 0;
    payload.remainingCredits = request.remainingCredits ?? null;
    payload.completed_at = request.completedAt || null;
  } else if (request.status === 'FAILED') {
    payload.error = {
      message: request.errorMessage || 'Narrative generation failed.',
      code: request.errorCode || null,
      status: request.errorStatus || 500,
    };
    payload.billing = buildBillingPayload(request);
    payload.creditsCharged = Number(request.creditsCharged) || 0;
    payload.remainingCredits = request.remainingCredits ?? null;
    payload.failed_at = request.failedAt || null;
  }

  return payload;
}

function normalizeInferenceReceipt(receipt = {}) {
  return {
    stage: receipt.stage || 'inference',
    attempt: receipt.attempt ?? null,
    validationAttempt: receipt.validationAttempt ?? null,
    requestKey: receipt.requestKey || null,
    model: receipt.model || receipt.response?.model || null,
    provider: inferProvider(receipt),
    usage: receipt.usage || receipt.usageMetadata ||
      receipt.response?.usage || receipt.response?.usageMetadata || null,
    reused: receipt.response?.[Symbol.for('samsar.externalInferenceReused')] === true,
  };
}

function getInferenceReceiptIdentity(receipt = {}) {
  return [
    normalizeString(receipt.requestKey),
    receipt.validationAttempt ?? '',
    receipt.attempt ?? '',
    normalizeString(receipt.model).toLowerCase(),
  ].join('|');
}

function getNarrativeBillingIdempotencyKey(requestId) {
  return `narrative:create_single:${requestId?.toString?.() || requestId}`;
}

async function recordInferenceReceipt(requestId, workerLeaseId, receipts, receipt = {}) {
  const normalizedReceipt = normalizeInferenceReceipt(receipt);
  if (
    normalizedReceipt.reused &&
    receipts.some((existingReceipt) => (
      getInferenceReceiptIdentity(existingReceipt) === getInferenceReceiptIdentity(normalizedReceipt)
    ))
  ) {
    return;
  }
  receipts.push(normalizedReceipt);
  const safeReceipt = calculateNarrativeBilling([normalizedReceipt]).receipts[0];
  if (!safeReceipt) return;

  const updateResult = await NarrativeRequest.updateOne(
    buildOwnedNarrativeFilter(requestId, workerLeaseId),
    { $push: { inferenceReceipts: safeReceipt } },
  );
  assertWorkerUpdateMatched(updateResult);
}

async function findExistingNarrativeCharge(request) {
  return GenerationCreditTransaction.findOne({
    userId: request.userId,
    direction: 'debit',
    $or: [
      { idempotencyKey: getNarrativeBillingIdempotencyKey(request._id) },
      {
        source: NARRATIVE_BILLING_SOURCE,
        'metadata.narrativeRequestId': request._id.toString(),
      },
    ],
  }).sort({ createdAt: -1 });
}

async function chargeNarrativeUsage(request, billing, workerLeaseId) {
  if (request.billingPolicy ===
    NARRATIVE_BILLING_POLICIES.INCLUDED_IN_INTERACTIVE_VIDEO_RATE) {
    const updateResult = await NarrativeRequest.updateOne(
      buildOwnedNarrativeFilter(request._id, workerLeaseId),
      {
        $set: {
          billingStatus: 'WAIVED',
          billingReason: NARRATIVE_BILLING_POLICIES.INCLUDED_IN_INTERACTIVE_VIDEO_RATE,
          creditsCharged: 0,
          remainingCredits: null,
          billingTransactionId: null,
        },
      },
    );
    assertWorkerUpdateMatched(updateResult);
    return { creditsCharged: 0, remainingCredits: null, transactionId: null };
  }

  if (!(billing.credits > 0)) {
    const updateResult = await NarrativeRequest.updateOne(
      buildOwnedNarrativeFilter(request._id, workerLeaseId),
      {
        $set: {
          billingStatus: 'WAIVED',
          billingReason: 'no_billable_inference_usage',
          creditsCharged: 0,
        },
      },
    );
    assertWorkerUpdateMatched(updateResult);
    return { creditsCharged: 0, remainingCredits: null, transactionId: null };
  }

  const existingTransaction = await findExistingNarrativeCharge(request);
  if (existingTransaction) {
    await completeGenerationCreditDebitReservation(
      request.userId,
      getNarrativeBillingIdempotencyKey(request._id),
      {
        amount: existingTransaction.amount,
        transactionId: existingTransaction._id,
        balanceAfter: existingTransaction.balanceAfter,
      },
    );
    return {
      creditsCharged: Number(existingTransaction.amount) || billing.credits,
      remainingCredits: existingTransaction.balanceAfter ?? null,
      transactionId: existingTransaction._id,
    };
  }

  const billingClaim = await NarrativeRequest.updateOne(
    buildOwnedNarrativeFilter(request._id, workerLeaseId, {
      billingStatus: { $in: ['PENDING', 'FAILED', 'CHARGING'] },
    }),
    {
      $set: {
        billingStatus: 'CHARGING',
        workerLeaseExpiresAt: new Date(Date.now() + getNarrativeWorkerLeaseMs()),
      },
    },
  );
  if (getUpdateMatchedCount(billingClaim) === 0) {
    const recoveredTransaction = await findExistingNarrativeCharge(request);
    if (recoveredTransaction) {
      await completeGenerationCreditDebitReservation(
        request.userId,
        getNarrativeBillingIdempotencyKey(request._id),
        {
          amount: recoveredTransaction.amount,
          transactionId: recoveredTransaction._id,
          balanceAfter: recoveredTransaction.balanceAfter,
        },
      );
      return {
        creditsCharged: Number(recoveredTransaction.amount) || billing.credits,
        remainingCredits: recoveredTransaction.balanceAfter ?? null,
        transactionId: recoveredTransaction._id,
      };
    }
    throw buildError(
      'Narrative billing could not acquire an exclusive charge claim.',
      409,
      'NARRATIVE_BILLING_CLAIM_FAILED',
    );
  }
  const charge = await deductGenerationCreditsIdempotently(request.userId, billing.credits, {
    source: NARRATIVE_BILLING_SOURCE,
    apiKeyId: request.apiKeyId || undefined,
    idempotencyKey: getNarrativeBillingIdempotencyKey(request._id),
    settleIncurredUsage: true,
    metadata: {
      requestType: 'API',
      category: 'narrative',
      operation: 'create_single',
      narrativeRequestId: request._id.toString(),
      inferenceModel: request.inferenceModel,
      pricingMultiplier: NARRATIVE_PRICING_MULTIPLIER,
      underlyingCostUsd: billing.underlyingCostUsd,
      underlyingCredits: billing.underlyingCredits,
      usage: billing.usage,
      receipts: billing.receipts,
      ...(request.apiKeyUsage ? { apiKeyUsage: request.apiKeyUsage } : {}),
    },
  });
  return {
    creditsCharged: billing.credits,
    remainingCredits: charge?.remainingCredits ?? null,
    transactionId: charge?.transactionId ?? null,
  };
}

async function persistBilling(requestId, workerLeaseId, billing) {
  const updateResult = await NarrativeRequest.updateOne(
    buildOwnedNarrativeFilter(requestId, workerLeaseId),
    {
      $set: {
        inferenceUsage: billing.usage,
        inferenceReceipts: billing.receipts,
        billingSnapshot: billing,
        billingCalculatedAt: new Date(),
        pricingMultiplier: billing.pricingMultiplier,
        underlyingCostUsd: billing.underlyingCostUsd,
        underlyingCredits: billing.underlyingCredits,
      },
    },
  );
  assertWorkerUpdateMatched(updateResult);
}

async function markNarrativeRequestFailed(
  requestId,
  workerLeaseId,
  error,
  billing = null,
  charge = null,
) {
  const failedAt = new Date();
  const update = {
    status: 'FAILED',
    failedAt,
    completedAt: failedAt,
    workerLeaseExpiresAt: null,
    workerLeaseId: null,
    meteringSlotActive: false,
    errorMessage: normalizeString(error?.message).slice(0, 2000) || 'Narrative generation failed.',
    errorCode: normalizeString(error?.code) || null,
    errorStatus: getRequestErrorStatus(error),
  };
  if (billing) {
    Object.assign(update, {
      inferenceUsage: billing.usage,
      inferenceReceipts: billing.receipts,
      pricingMultiplier: billing.pricingMultiplier,
      underlyingCostUsd: billing.underlyingCostUsd,
      underlyingCredits: billing.underlyingCredits,
    });
  }
  if (charge) {
    Object.assign(update, {
      billingStatus: charge.creditsCharged > 0 ? 'CHARGED' : 'WAIVED',
      creditsCharged: charge.creditsCharged,
      remainingCredits: charge.remainingCredits,
      billingTransactionId: charge.transactionId,
    });
  } else if (billing) {
    update.billingStatus = 'FAILED';
  }

  return NarrativeRequest.findOneAndUpdate(
    buildOwnedNarrativeFilter(requestId, workerLeaseId),
    { $set: update },
    { new: true },
  ).lean();
}

function startNarrativeLeaseHeartbeat(requestId, workerLeaseId, leaseMs) {
  const heartbeat = setInterval(() => {
    void NarrativeRequest.updateOne(
      buildOwnedNarrativeFilter(requestId, workerLeaseId),
      { $set: { workerLeaseExpiresAt: new Date(Date.now() + leaseMs) } },
    ).catch((error) => {
      console.error('[external_narrative] worker heartbeat failed', {
        requestId,
        message: error?.message || String(error),
      });
    });
  }, Math.max(20_000, Math.floor(leaseMs / 3)));
  heartbeat.unref?.();
  return heartbeat;
}

export async function processCreateSingleNarrativeRequest(requestId) {
  await getDBConnectionString();
  const now = new Date();
  const leaseMs = getNarrativeWorkerLeaseMs();
  const workerLeaseId = randomUUID();
  let request;
  try {
    request = await NarrativeRequest.findOneAndUpdate(
      {
        _id: requestId,
        requestType: 'create_single',
        $or: [
          { status: 'PENDING' },
          {
            status: 'PROCESSING',
            $or: [
              { workerLeaseExpiresAt: null },
              { workerLeaseExpiresAt: { $lte: now } },
            ],
          },
        ],
      },
      {
        $set: {
          status: 'PROCESSING',
          startedAt: now,
          meteringSlotActive: true,
          workerLeaseId,
          workerLeaseExpiresAt: new Date(now.getTime() + leaseMs),
          errorMessage: null,
          errorCode: null,
          errorStatus: null,
        },
        $inc: { processingAttempts: 1 },
      },
      { new: true },
    ).lean();
  } catch (error) {
    if (error?.code === 11000) {
      // A different request for this user owns the unique metering slot. The
      // recovery scanner will retry this request after the active one settles.
      return null;
    }
    throw error;
  }
  if (!request) return null;

  const heartbeat = startNarrativeLeaseHeartbeat(requestId, workerLeaseId, leaseMs);
  const inferenceReceipts = Array.isArray(request.inferenceReceipts)
    ? [...request.inferenceReceipts]
    : [];
  let generationError = request.generationOutcome === 'FAILED'
    ? restoreGenerationError(request)
    : null;
  let generated = request.movieResourceList && request.narrativeJson && request.themeJson
    ? {
      themeJson: request.themeJson,
      narrativeJson: request.narrativeJson,
      movieResourceList: request.movieResourceList,
      validation: request.validation,
    }
    : null;
  let generationCheckpointNeeded = false;

  if (request.generationOutcome === 'SUCCEEDED' && !generated) {
    generationError = buildError(
      'Narrative generation checkpoint is missing its persisted artifacts.',
      500,
      'NARRATIVE_GENERATION_CHECKPOINT_INVALID',
    );
    generationCheckpointNeeded = true;
  } else if (!['SUCCEEDED', 'FAILED'].includes(request.generationOutcome)) {
    generationCheckpointNeeded = Boolean(generated);
  }

  try {
    if (!generated && !generationError && request.generationOutcome !== 'SUCCEEDED') {
      const creditOwner = await User.exists({
        _id: request.userId,
        generationCredits: { $gt: 0 },
      });
      if (!creditOwner) {
        throw buildError('Insufficient credits', 402, 'INSUFFICIENT_CREDITS');
      }
      if (request.apiKeyId) {
        await assertAPIKeyUsageLimitForDebit(
          request.userId,
          NARRATIVE_ADMISSION_CREDIT_FLOOR,
          { apiKeyId: request.apiKeyId },
        );
      }

      const moderationPassed = await getModerationForNarrative(request.prompt, {
        sessionId: request._id.toString(),
        inferenceModel: request.inferenceModel,
        routeType: 'text_to_video',
        onInferenceResponse: (receipt) => recordInferenceReceipt(
          requestId,
          workerLeaseId,
          inferenceReceipts,
          {
            ...receipt,
            requestKey: 'narrative:create_single:moderation',
          },
        ),
      });
      if (!moderationPassed) {
        throw buildError(
          NARRATIVE_MODERATION_FAILURE_MESSAGE,
          422,
          'CONTENT_MODERATION_FAILED',
        );
      }

      const narrative = await generateValidatedTextToVideoNarrative({
        prompt: request.prompt,
        duration: request.duration,
        videoGenerationModel: request.videoGenerationModel || NARRATIVE_VIDEO_MODEL,
        inferenceModel: request.inferenceModel,
        videoTone: request.videoTone || NARRATIVE_VIDEO_TONE,
        languageString: null,
        externalRequestContext: {
          sessionId: request._id.toString(),
          userId: request.userId,
        },
        requestKeyPrefix: 'narrative:create_single',
        onInferenceResponse: (receipt) => recordInferenceReceipt(
          requestId,
          workerLeaseId,
          inferenceReceipts,
          receipt,
        ),
      });
      const rawNarrativeJson = deepCloneJson(narrative.narrativeJson);
      const movieResourceListWithCharacters = await buildVideoSessionMovieResourceList({
        inputPrompt: request.prompt,
        narrativeJson: deepCloneJson(rawNarrativeJson),
        themeJson: narrative.themeJson,
        videoTone: request.videoTone || NARRATIVE_VIDEO_TONE,
        language: 'auto',
        speakerOptions: request.speakerOptions || null,
        inferenceModel: request.inferenceModel,
        onInferenceResponse: (receipt) => recordInferenceReceipt(
          requestId,
          workerLeaseId,
          inferenceReceipts,
          receipt,
        ),
      });
      const visualPromptResult = await buildMovieResourceListVisualPrompts({
        movieResourceList: movieResourceListWithCharacters,
        themeJson: narrative.themeJson,
        inferenceModel: request.inferenceModel,
        videoTone: request.videoTone || NARRATIVE_VIDEO_TONE,
        externalRequestContext: {
          sessionId: request._id.toString(),
          userId: request.userId,
        },
        requestKeyPrefix: 'narrative:create_single:visual',
        onInferenceResponse: (receipt) => recordInferenceReceipt(
          requestId,
          workerLeaseId,
          inferenceReceipts,
          receipt,
        ),
      });
      const movieResourceList = visualPromptResult.movieResourceList;
      const finalValidation = validateTextToVideoNarrative(
        movieResourceList,
        request.videoGenerationModel || NARRATIVE_VIDEO_MODEL,
        undefined,
        {
          repairAdjacentSceneIndex: isGeminiInferenceModel(request.inferenceModel),
          requestedDuration: request.duration,
        },
      );
      if (!finalValidation.valid) {
        throw buildError(
          `Final movieResourceList validation failed: ${finalValidation.errors.join(', ')}`,
          502,
          'MOVIE_RESOURCE_LIST_VALIDATION_FAILED',
        );
      }

      generated = {
        themeJson: narrative.themeJson,
        narrativeJson: rawNarrativeJson,
        movieResourceList: finalValidation.narrativeJson,
        validation: {
          narrative: narrative.validation,
          movieResourceList: finalValidation,
        },
      };
      const artifactsUpdate = await NarrativeRequest.updateOne(
        buildOwnedNarrativeFilter(requestId, workerLeaseId),
        {
          $set: {
            ...generated,
            generationOutcome: 'SUCCEEDED',
            generationFinishedAt: new Date(),
            generationFailureMessage: null,
            generationFailureCode: null,
            generationFailureStatus: null,
          },
        },
      );
      assertWorkerUpdateMatched(artifactsUpdate);
      generationCheckpointNeeded = false;
    }
  } catch (error) {
    generationError = error;
    generationCheckpointNeeded = !isNarrativeLeaseLostError(error);
  }

  try {
    if (isNarrativeLeaseLostError(generationError)) {
      return null;
    }
    if (generationCheckpointNeeded) {
      const checkpointFinishedAt = new Date();
      const generationCheckpoint = generationError
        ? {
          generationOutcome: 'FAILED',
          generationFinishedAt: checkpointFinishedAt,
          generationFailureMessage: normalizeString(generationError.message).slice(0, 2000) ||
            'Narrative generation failed.',
          generationFailureCode: normalizeString(generationError.code) || null,
          generationFailureStatus: getRequestErrorStatus(generationError),
        }
        : {
          generationOutcome: 'SUCCEEDED',
          generationFinishedAt: checkpointFinishedAt,
          generationFailureMessage: null,
          generationFailureCode: null,
          generationFailureStatus: null,
        };
      const checkpointUpdate = await NarrativeRequest.updateOne(
        buildOwnedNarrativeFilter(requestId, workerLeaseId),
        { $set: generationCheckpoint },
      );
      assertWorkerUpdateMatched(checkpointUpdate);
    }
    const recoveredBillingSnapshot = request.billingStatus === 'CHARGING' &&
      request.billingSnapshot &&
      typeof request.billingSnapshot === 'object' &&
      !Array.isArray(request.billingSnapshot)
      ? deepCloneJson(request.billingSnapshot)
      : null;
    const billing = recoveredBillingSnapshot || calculateNarrativeBilling(inferenceReceipts);
    await persistBilling(requestId, workerLeaseId, billing);
    const billingValidation = validateNarrativeBilling(
      billing,
      inferenceReceipts.length,
    );
    const requiresBillableReceipts = Boolean(generated) || inferenceReceipts.length > 0;
    if (requiresBillableReceipts &&
      (billing.receipts.length === 0 || !billingValidation.valid)) {
      const usageError = buildError(
        [
          'Complete billable token usage was not available for every inference call.',
          ...billingValidation.errors,
        ].join(' '),
        502,
        'INFERENCE_USAGE_UNAVAILABLE',
      );
      const failed = await markNarrativeRequestFailed(
        requestId,
        workerLeaseId,
        usageError,
        billing,
        null,
      );
      return failed ? buildNarrativeRequestPayload(failed) : null;
    }
    let charge = null;
    try {
      charge = await chargeNarrativeUsage(request, billing, workerLeaseId);
    } catch (billingError) {
      if (isNarrativeLeaseLostError(billingError)) return null;
      if (getRequestErrorStatus(billingError) >= 500) {
        // Keep completed artifacts and receipts recoverable. The scanner will
        // reclaim the request after its lease expires and the idempotent debit
        // path will either reuse the ledger or finish a reserved debit.
        console.error('[external_narrative] retryable billing failure', {
          requestId,
          code: billingError?.code || null,
          message: billingError?.message || String(billingError),
        });
        return null;
      }
      const failed = await markNarrativeRequestFailed(
        requestId,
        workerLeaseId,
        billingError,
        billing,
        null,
      );
      return failed ? buildNarrativeRequestPayload(failed) : null;
    }

    if (generationError) {
      const failed = await markNarrativeRequestFailed(
        requestId,
        workerLeaseId,
        generationError,
        billing,
        charge,
      );
      return failed ? buildNarrativeRequestPayload(failed) : null;
    }

    const completed = await NarrativeRequest.findOneAndUpdate(
      buildOwnedNarrativeFilter(requestId, workerLeaseId),
      {
        $set: {
          status: 'COMPLETED',
          ...generated,
          billingStatus: charge.creditsCharged > 0 ? 'CHARGED' : 'WAIVED',
          creditsCharged: charge.creditsCharged,
          remainingCredits: charge.remainingCredits,
          billingTransactionId: charge.transactionId,
          completedAt: new Date(),
          workerLeaseId: null,
          workerLeaseExpiresAt: null,
          meteringSlotActive: false,
          errorMessage: null,
          errorCode: null,
          errorStatus: null,
        },
      },
      { new: true },
    ).lean();
    return completed ? buildNarrativeRequestPayload(completed) : null;
  } finally {
    clearInterval(heartbeat);
  }
}

export function queueCreateSingleNarrativeRequest(requestId) {
  setImmediate(() => {
    void ensureNarrativeBillingIndexes()
      .then(() => processCreateSingleNarrativeRequest(requestId))
      .catch((error) => {
        console.error('[external_narrative] async request worker failed', {
          requestId,
          message: error?.message || String(error),
        });
      });
  });
}

export async function recoverCreateSingleNarrativeRequests({ limit = 20 } = {}) {
  await getDBConnectionString();
  await ensureNarrativeBillingIndexes();
  const now = new Date();
  const requests = await NarrativeRequest.find({
    requestType: 'create_single',
    $or: [
      { status: 'PENDING' },
      {
        status: 'PROCESSING',
        $or: [
          { workerLeaseExpiresAt: null },
          { workerLeaseExpiresAt: { $lte: now } },
        ],
      },
    ],
  })
    .select('_id')
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  for (const request of requests) {
    queueCreateSingleNarrativeRequest(request._id.toString());
  }
  return requests.length;
}

export function startCreateSingleNarrativeRequestRecovery() {
  if (narrativeRequestRecoveryInterval) return () => {};

  const recover = () => {
    void recoverCreateSingleNarrativeRequests().catch((error) => {
      console.error('[external_narrative] recovery scan failed', {
        message: error?.message || String(error),
      });
    });
  };
  recover();
  narrativeRequestRecoveryInterval = setInterval(
    recover,
    getNarrativeRecoveryIntervalMs(),
  );
  narrativeRequestRecoveryInterval.unref?.();

  return () => {
    clearInterval(narrativeRequestRecoveryInterval);
    narrativeRequestRecoveryInterval = null;
  };
}

export async function createSingleNarrativeRequest({
  userId,
  payload = {},
  authContext = null,
  billingPolicy = NARRATIVE_BILLING_POLICIES.STANDALONE,
  interactiveVideoRequestId = null,
  dependencies = {},
} = {}) {
  if (!userId) throw buildError('User ID is required.', 401, 'UNAUTHORIZED');
  const normalizedPayload = normalizeCreateSingleNarrativePayload(payload);

  await getDBConnectionString();
  await ensureNarrativeBillingIndexes();
  const user = await User.findById(userId)
    .select('selectedInferenceModel speakerOptions generationCredits')
    .lean();
  if (!user) throw buildError('User not found.', 404, 'USER_NOT_FOUND');
  if (!(Number(user.generationCredits) > 0)) {
    throw buildError('Insufficient credits', 402, 'INSUFFICIENT_CREDITS');
  }

  const inferenceModel = resolveNarrativeInferenceModel(
    normalizedPayload,
    user.selectedInferenceModel,
  );
  const apiKeyUsage = normalizeAPIKeyUsageContext(authContext);
  if (apiKeyUsage?.apiKeyId) {
    await assertAPIKeyUsageLimitForDebit(
      userId,
      NARRATIVE_ADMISSION_CREDIT_FLOOR,
      { apiKeyId: apiKeyUsage.apiKeyId },
    );
  }
  const created = await NarrativeRequest.create({
    userId: userId?.toString?.() || String(userId),
    requestType: 'create_single',
    narrativeType: 'singular',
    status: 'PENDING',
    prompt: normalizedPayload.prompt,
    inputPrompt: normalizedPayload.prompt,
    duration: normalizedPayload.duration,
    totalDuration: normalizedPayload.duration,
    inferenceModel,
    videoGenerationModel: normalizedPayload.videoGenerationModel,
    videoTone: NARRATIVE_VIDEO_TONE,
    speakerOptions: user.speakerOptions || null,
    pricingMultiplier: NARRATIVE_PRICING_MULTIPLIER,
    apiKeyId: apiKeyUsage?.apiKeyId || null,
    apiKeyUsage,
    billingPolicy: normalizeNarrativeBillingPolicy(billingPolicy),
    interactiveVideoRequestId: interactiveVideoRequestId || null,
    meteringSlotActive: false,
  });
  const request = created.toObject();
  const queueRequest = dependencies.queueCreateSingleNarrativeRequest ||
    queueCreateSingleNarrativeRequest;
  queueRequest(request._id.toString());
  return buildNarrativeRequestPayload(request);
}

export async function getSingleNarrativeRequest({ userId, requestId } = {}) {
  if (!userId) throw buildError('User ID is required.', 401, 'UNAUTHORIZED');
  const normalizedRequestId = normalizeString(requestId);
  if (!mongoose.Types.ObjectId.isValid(normalizedRequestId)) {
    throw buildError('A valid request_id is required.', 400, 'INVALID_REQUEST_ID');
  }

  await getDBConnectionString();
  const request = await NarrativeRequest.findOne({
    _id: normalizedRequestId,
    userId: userId?.toString?.() || String(userId),
    requestType: 'create_single',
  }).lean();
  if (!request) throw buildError('Narrative request not found.', 404, 'NOT_FOUND');

  if (request.status === 'PENDING') {
    queueCreateSingleNarrativeRequest(request._id.toString());
  } else if (
    request.status === 'PROCESSING' &&
    (!request.workerLeaseExpiresAt ||
      new Date(request.workerLeaseExpiresAt).getTime() <= Date.now())
  ) {
    queueCreateSingleNarrativeRequest(request._id.toString());
  }

  return buildNarrativeRequestPayload(request);
}

export const __testOnly__ = {
  getNarrativeWorkerLeaseMs,
  getRequestErrorStatus,
  ensureNarrativeBillingIndexes,
  isNarrativeLeaseLostError,
  MAX_NARRATIVE_DURATION_SECONDS,
  MIN_NARRATIVE_DURATION_SECONDS,
  NARRATIVE_LEASE_LOST_CODE,
  NARRATIVE_POLL_PATH,
};
