import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import NarrativeRequest from '../../schema/NarrativeRequest.js';
import GenerationCreditTransaction from '../../schema/GenerationCreditTransaction.js';
import User from '../../schema/User.js';
import { getDBConnectionString } from '../DBString.js';
import {
  assertAPIKeyUsageLimitForDebit,
  completeGenerationCreditDebitReservation,
  deductGenerationCreditsIdempotently,
} from '../GenerationCredits.js';
import { generateBranchingNarrativeTree } from '../movie_session/branching/BranchingNarrativeTree.js';
import { validateTextToVideoNarrative } from '../movie_session/utils/TranscriptUtils.js';
import { normalizeAPIKeyUsageContext } from './RequestAuthContext.js';
import {
  calculateNarrativeBilling,
  NARRATIVE_PRICING_MULTIPLIER,
  validateNarrativeBilling,
} from './NarrativeBilling.js';
import { buildNarrativeRequestPayload } from './NarrativeAPI.js';

const MAX_BRANCHING_LEVELS = 3;
const ABSOLUTE_MAX_BRANCHING_LEVELS = 6;
const BRANCHING_FACTOR = 2;
const DEFAULT_WORKER_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_RECOVERY_INTERVAL_MS = 60 * 1000;
const BILLING_SOURCE = 'external_narrative_create_branching';
const BILLING_OPERATION = 'create_branching';
const ADMISSION_CREDIT_FLOOR = 0.0001;
const LEASE_LOST_CODE = 'BRANCHING_NARRATIVE_WORKER_LEASE_LOST';
const REQUEST_KEY_PREFIX = 'narrative:create_branching';

let recoveryInterval = null;
let billingIndexesPromise = null;
const queuedRequestIds = new Set();

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

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepCloneJson(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function getRequestErrorStatus(error) {
  if (error?.code === 'INSUFFICIENT_CREDITS' ||
    error?.code === 'API_KEY_USAGE_LIMIT_EXCEEDED') {
    return 402;
  }
  const status = Number(error?.statusCode ?? error?.status ?? error?.response?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function getWorkerLeaseMs() {
  const configured = Number(process.env.NARRATIVE_REQUEST_WORKER_LEASE_MS);
  return Number.isFinite(configured) && configured >= 60_000
    ? Math.floor(configured)
    : DEFAULT_WORKER_LEASE_MS;
}

function getRecoveryIntervalMs() {
  const configured = Number(process.env.NARRATIVE_REQUEST_RECOVERY_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 10_000
    ? Math.floor(configured)
    : DEFAULT_RECOVERY_INTERVAL_MS;
}

function getMaxBranchingLevels() {
  const configured = Number(process.env.NARRATIVE_MAX_BRANCHING_LEVELS);
  return Number.isSafeInteger(configured) && configured >= 1 &&
    configured <= ABSOLUTE_MAX_BRANCHING_LEVELS
    ? configured
    : MAX_BRANCHING_LEVELS;
}

function createLeaseLostError() {
  return buildError(
    'Branching narrative request ownership changed while it was processing.',
    409,
    LEASE_LOST_CODE,
  );
}

function isLeaseLostError(error) {
  return error?.code === LEASE_LOST_CODE;
}

function getUpdateMatchedCount(result) {
  for (const value of [result?.matchedCount, result?.n, result?.modifiedCount, result?.nModified]) {
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function assertWorkerUpdateMatched(result) {
  if (getUpdateMatchedCount(result) === 0) throw createLeaseLostError();
  return result;
}

function buildOwnedFilter(requestId, workerLeaseId, extra = {}) {
  return {
    _id: requestId,
    requestType: 'create_branching',
    status: 'PROCESSING',
    workerLeaseId,
    ...extra,
  };
}

async function ensureBillingIndexes() {
  if (!billingIndexesPromise) {
    billingIndexesPromise = Promise.resolve()
      .then(() => Promise.all([
        GenerationCreditTransaction.createIndexes(),
        NarrativeRequest.createIndexes(),
      ]))
      .catch((error) => {
        billingIndexesPromise = null;
        throw buildError(
          `Branching narrative billing index is unavailable: ${error?.message || String(error)}`,
          503,
          'NARRATIVE_BILLING_INDEX_UNAVAILABLE',
        );
      });
  }
  return billingIndexesPromise;
}

function restoreGenerationError(request) {
  return buildError(
    normalizeString(request?.generationFailureMessage) || 'Branching narrative generation failed.',
    Number(request?.generationFailureStatus) || 500,
    normalizeString(request?.generationFailureCode) || 'BRANCHING_NARRATIVE_GENERATION_FAILED',
  );
}

function inferProvider(receipt = {}) {
  const explicitProvider = normalizeString(
    receipt.provider || receipt.response?.provider || receipt.response?.openrouter?.provider,
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

function getReceiptIdentity(receipt = {}) {
  return [
    normalizeString(receipt.requestKey),
    receipt.validationAttempt ?? '',
    receipt.attempt ?? '',
    normalizeString(receipt.model).toLowerCase(),
  ].join('|');
}

function getBillingIdempotencyKey(requestId) {
  return `${REQUEST_KEY_PREFIX}:${requestId?.toString?.() || requestId}`;
}

function assertChargeMatchesBilling(transaction, billing) {
  const charged = Number(transaction?.amount);
  const expected = Number(billing?.credits);
  if (Number.isFinite(charged) && Number.isFinite(expected) &&
    Math.abs(charged - expected) <= 0.0001) {
    return transaction;
  }
  throw buildError(
    'The existing branching narrative debit does not match the calculated usage.',
    409,
    'NARRATIVE_BILLING_IDEMPOTENCY_CONFLICT',
  );
}

async function recordInferenceReceipt(requestId, workerLeaseId, receipts, receipt = {}) {
  const normalized = normalizeInferenceReceipt(receipt);
  if (normalized.reused && receipts.some((existing) => (
    getReceiptIdentity(existing) === getReceiptIdentity(normalized)
  ))) {
    return;
  }

  receipts.push(normalized);
  const safeReceipt = calculateNarrativeBilling([normalized]).receipts[0];
  if (!safeReceipt) return;
  const result = await NarrativeRequest.updateOne(
    buildOwnedFilter(requestId, workerLeaseId),
    { $push: { inferenceReceipts: safeReceipt } },
  );
  assertWorkerUpdateMatched(result);
}

async function findExistingCharge(request) {
  return GenerationCreditTransaction.findOne({
    userId: request.userId,
    direction: 'debit',
    $or: [
      { idempotencyKey: getBillingIdempotencyKey(request._id) },
      {
        source: BILLING_SOURCE,
        'metadata.narrativeRequestId': request._id.toString(),
      },
    ],
  }).sort({ createdAt: -1 });
}

async function chargeUsage(request, billing, workerLeaseId) {
  if (!(billing.credits > 0)) {
    const result = await NarrativeRequest.updateOne(
      buildOwnedFilter(request._id, workerLeaseId),
      { $set: { billingStatus: 'WAIVED', creditsCharged: 0 } },
    );
    assertWorkerUpdateMatched(result);
    return { creditsCharged: 0, remainingCredits: null, transactionId: null };
  }

  const existingTransaction = await findExistingCharge(request);
  if (existingTransaction) {
    assertChargeMatchesBilling(existingTransaction, billing);
    await completeGenerationCreditDebitReservation(
      request.userId,
      getBillingIdempotencyKey(request._id),
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
    buildOwnedFilter(request._id, workerLeaseId, {
      billingStatus: { $in: ['PENDING', 'FAILED', 'CHARGING'] },
    }),
    {
      $set: {
        billingStatus: 'CHARGING',
        workerLeaseExpiresAt: new Date(Date.now() + getWorkerLeaseMs()),
      },
    },
  );
  if (getUpdateMatchedCount(billingClaim) === 0) {
    const recoveredTransaction = await findExistingCharge(request);
    if (recoveredTransaction) {
      assertChargeMatchesBilling(recoveredTransaction, billing);
      await completeGenerationCreditDebitReservation(
        request.userId,
        getBillingIdempotencyKey(request._id),
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
      'Branching narrative billing could not acquire an exclusive charge claim.',
      409,
      'NARRATIVE_BILLING_CLAIM_FAILED',
    );
  }

  const charge = await deductGenerationCreditsIdempotently(request.userId, billing.credits, {
    source: BILLING_SOURCE,
    apiKeyId: request.apiKeyId || undefined,
    idempotencyKey: getBillingIdempotencyKey(request._id),
    settleIncurredUsage: true,
    metadata: {
      requestType: 'API',
      category: 'narrative',
      operation: BILLING_OPERATION,
      narrativeRequestId: request._id.toString(),
      sourceNarrativeRequestId: request.sourceNarrativeRequestId?.toString?.() || null,
      inferenceModel: request.inferenceModel,
      numLevels: request.numLevels,
      branchingFactor: BRANCHING_FACTOR,
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
  const result = await NarrativeRequest.updateOne(
    buildOwnedFilter(requestId, workerLeaseId),
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
  assertWorkerUpdateMatched(result);
}

async function markFailed(requestId, workerLeaseId, error, billing = null, charge = null) {
  const failedAt = new Date();
  const update = {
    status: 'FAILED',
    failedAt,
    completedAt: failedAt,
    workerLeaseExpiresAt: null,
    workerLeaseId: null,
    meteringSlotActive: false,
    errorMessage: normalizeString(error?.message).slice(0, 2000) ||
      'Branching narrative generation failed.',
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
    buildOwnedFilter(requestId, workerLeaseId),
    { $set: update },
    { new: true },
  ).lean();
}

function startLeaseHeartbeat(requestId, workerLeaseId, leaseMs) {
  const heartbeat = setInterval(() => {
    void NarrativeRequest.updateOne(
      buildOwnedFilter(requestId, workerLeaseId),
      { $set: { workerLeaseExpiresAt: new Date(Date.now() + leaseMs) } },
    ).catch((error) => {
      console.error('[external_narrative_branching] worker heartbeat failed', {
        requestId,
        message: error?.message || String(error),
      });
    });
  }, Math.max(20_000, Math.floor(leaseMs / 3)));
  heartbeat.unref?.();
  return heartbeat;
}

export function normalizeCreateBranchingNarrativePayload(payload = {}) {
  const source = isObject(payload?.input) ? payload.input : payload;
  const sourceRequestId = normalizeString(
    source?.narrative_request_id ??
    source?.narrativeRequestId ??
    source?.request_id ??
    source?.requestId ??
    source?.id,
  );
  if (!mongoose.Types.ObjectId.isValid(sourceRequestId)) {
    throw buildError(
      'A valid narrative_request_id is required.',
      400,
      'INVALID_NARRATIVE_REQUEST_ID',
    );
  }

  const rawNumLevels = source?.num_levels ?? source?.numLevels;
  if (rawNumLevels === undefined || rawNumLevels === null || rawNumLevels === '') {
    throw buildError('num_levels is required.', 400, 'INVALID_NUM_LEVELS');
  }
  const isNumericPrimitive = typeof rawNumLevels === 'number' ||
    (typeof rawNumLevels === 'string' && /^\d+$/.test(rawNumLevels.trim()));
  const numLevels = isNumericPrimitive ? Number(rawNumLevels) : Number.NaN;
  const maxBranchingLevels = getMaxBranchingLevels();
  if (!Number.isSafeInteger(numLevels) || numLevels < 1 || numLevels > maxBranchingLevels) {
    throw buildError(
      `num_levels must be an integer between 1 and ${maxBranchingLevels}.`,
      400,
      'INVALID_NUM_LEVELS',
    );
  }

  return { sourceRequestId, numLevels };
}

export function validateBranchingSourceRequest(source, numLevels) {
  if (!source) throw buildError('Narrative request not found.', 404, 'NOT_FOUND');

  const narrativeType = source.narrativeType ||
    (source.requestType === 'create_single' ? 'singular' : null);
  if (source.requestType !== 'create_single' || narrativeType !== 'singular') {
    throw buildError(
      'The source NarrativeRequest must be a singular create_single request.',
      422,
      'SOURCE_NARRATIVE_NOT_SINGULAR',
    );
  }
  if (source.status !== 'COMPLETED') {
    throw buildError(
      'The source NarrativeRequest must be completed before it can be branched.',
      409,
      'SOURCE_NARRATIVE_NOT_COMPLETED',
    );
  }
  if (source.generationOutcome !== 'SUCCEEDED') {
    throw buildError(
      'The source NarrativeRequest must have a successful generation outcome.',
      422,
      'SOURCE_NARRATIVE_GENERATION_INVALID',
    );
  }
  if (!isObject(source.themeJson) || !isObject(source.narrativeJson) ||
    !Array.isArray(source.narrativeJson.scenes) ||
    !Array.isArray(source.narrativeJson.sounds) ||
    !isObject(source.movieResourceList)) {
    throw buildError(
      'The source NarrativeRequest does not contain complete narrative artifacts.',
      422,
      'SOURCE_NARRATIVE_ARTIFACTS_INVALID',
    );
  }

  const scenes = source.movieResourceList.scenes;
  const sounds = source.movieResourceList.sounds;
  if (!Array.isArray(scenes) || scenes.length < 2 || !Array.isArray(sounds)) {
    throw buildError(
      'The source movieResourceList must contain at least two scenes and a sounds list.',
      422,
      'SOURCE_MOVIE_RESOURCE_LIST_INVALID',
    );
  }
  if (numLevels > scenes.length - 1) {
    throw buildError(
      `num_levels cannot exceed ${scenes.length - 1} for a ${scenes.length}-scene narrative.`,
      400,
      'INVALID_NUM_LEVELS',
    );
  }
  const validation = validateTextToVideoNarrative(
    deepCloneJson(source.movieResourceList),
    source.videoGenerationModel || 'RUNWAYML',
    undefined,
    { requestedDuration: source.duration },
  );
  if (!validation.valid) {
    throw buildError(
      `The source movieResourceList is invalid: ${validation.errors.join(', ')}`,
      422,
      'SOURCE_MOVIE_RESOURCE_LIST_INVALID',
    );
  }
  return source;
}

function buildSourceSnapshot(source) {
  return {
    schemaVersion: 1,
    sourceNarrativeRequestId: source._id?.toString?.() || source._id,
    prompt: source.prompt,
    duration: source.duration,
    inferenceModel: source.inferenceModel,
    themeJson: deepCloneJson(source.themeJson),
    narrativeJson: deepCloneJson(source.narrativeJson),
    movieResourceList: deepCloneJson(source.movieResourceList),
  };
}

async function persistBranchingCheckpoint(requestId, workerLeaseId, checkpoint) {
  const result = await NarrativeRequest.updateOne(
    buildOwnedFilter(requestId, workerLeaseId),
    {
      $set: {
        branchingProgress: deepCloneJson(checkpoint),
        workerLeaseExpiresAt: new Date(Date.now() + getWorkerLeaseMs()),
      },
    },
  );
  assertWorkerUpdateMatched(result);
}

export async function processCreateBranchingNarrativeRequest(requestId, dependencies = {}) {
  await getDBConnectionString();
  const now = new Date();
  const leaseMs = getWorkerLeaseMs();
  const workerLeaseId = randomUUID();
  let request;

  try {
    request = await NarrativeRequest.findOneAndUpdate(
      {
        _id: requestId,
        requestType: 'create_branching',
        narrativeType: 'branched',
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
    if (error?.code === 11000) return null;
    throw error;
  }
  if (!request) return null;

  const heartbeat = startLeaseHeartbeat(requestId, workerLeaseId, leaseMs);
  const inferenceReceipts = Array.isArray(request.inferenceReceipts)
    ? [...request.inferenceReceipts]
    : [];
  let generationError = request.generationOutcome === 'FAILED'
    ? restoreGenerationError(request)
    : null;
  let generated = request.movieResourceList && request.branchingMeta &&
    request.narrativeJson && request.themeJson
    ? {
      themeJson: request.themeJson,
      narrativeJson: request.narrativeJson,
      movieResourceList: request.movieResourceList,
      branchingMeta: request.branchingMeta,
      validation: request.validation,
    }
    : null;
  let generationCheckpointNeeded = false;

  if (request.generationOutcome === 'SUCCEEDED' && !generated) {
    generationError = buildError(
      'Branching generation checkpoint is missing its persisted artifacts.',
      500,
      'BRANCHING_GENERATION_CHECKPOINT_INVALID',
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
      if (!creditOwner) throw buildError('Insufficient credits', 402, 'INSUFFICIENT_CREDITS');
      if (request.apiKeyId) {
        await assertAPIKeyUsageLimitForDebit(
          request.userId,
          ADMISSION_CREDIT_FLOOR,
          { apiKeyId: request.apiKeyId },
        );
      }

      const snapshot = request.sourceNarrativeSnapshot;
      if (!isObject(snapshot) || !isObject(snapshot.themeJson) ||
        !isObject(snapshot.narrativeJson) || !isObject(snapshot.movieResourceList)) {
        throw buildError(
          'The immutable source narrative snapshot is missing or invalid.',
          500,
          'SOURCE_NARRATIVE_SNAPSHOT_INVALID',
        );
      }

      // The source prompt already passed the singular narrative moderation stage.
      // This worker performs only the new branching inference calls.
      const checkpointHandler = (checkpoint) => persistBranchingCheckpoint(
        requestId,
        workerLeaseId,
        checkpoint,
      );
      const generateTree = dependencies.generateBranchingNarrativeTree ||
        generateBranchingNarrativeTree;
      const treeResult = await generateTree({
        sourceMovieResourceList: deepCloneJson(snapshot.movieResourceList),
        themeJson: deepCloneJson(snapshot.themeJson),
        narrativeJson: deepCloneJson(snapshot.narrativeJson),
        prompt: snapshot.prompt || request.prompt,
        numLevels: request.numLevels,
        maxLevels: Math.min(
          ABSOLUTE_MAX_BRANCHING_LEVELS,
          Math.max(getMaxBranchingLevels(), Number(request.numLevels) || 0),
        ),
        inferenceModel: request.inferenceModel,
        videoGenerationModel: request.videoGenerationModel || 'RUNWAYML',
        requestedDuration: request.duration,
        externalRequestContext: {
          sessionId: request._id.toString(),
          userId: request.userId,
        },
        requestKeyPrefix: REQUEST_KEY_PREFIX,
        existingCheckpoint: request.branchingProgress || null,
        onCheckpoint: checkpointHandler,
        onInferenceResponse: (receipt) => recordInferenceReceipt(
          requestId,
          workerLeaseId,
          inferenceReceipts,
          receipt,
        ),
      });

      if (!isObject(treeResult?.movieResourceList) || !isObject(treeResult?.branchingMeta)) {
        throw buildError(
          'Branching inference did not return a valid narrative tree.',
          502,
          'BRANCHING_TREE_INVALID',
        );
      }

      generated = {
        themeJson: deepCloneJson(snapshot.themeJson),
        narrativeJson: deepCloneJson(snapshot.narrativeJson),
        movieResourceList: treeResult.movieResourceList,
        branchingMeta: treeResult.branchingMeta,
        validation: treeResult.validation || null,
      };
      const artifactsUpdate = await NarrativeRequest.updateOne(
        buildOwnedFilter(requestId, workerLeaseId),
        {
          $set: {
            ...generated,
            branchingProgress: treeResult.checkpoint || treeResult.progress || null,
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
    generationCheckpointNeeded = !isLeaseLostError(error);
  }

  try {
    if (isLeaseLostError(generationError)) return null;
    if (generationCheckpointNeeded) {
      const finishedAt = new Date();
      const checkpoint = generationError
        ? {
          generationOutcome: 'FAILED',
          generationFinishedAt: finishedAt,
          generationFailureMessage: normalizeString(generationError.message).slice(0, 2000) ||
            'Branching narrative generation failed.',
          generationFailureCode: normalizeString(generationError.code) || null,
          generationFailureStatus: getRequestErrorStatus(generationError),
        }
        : {
          generationOutcome: 'SUCCEEDED',
          generationFinishedAt: finishedAt,
          generationFailureMessage: null,
          generationFailureCode: null,
          generationFailureStatus: null,
        };
      const result = await NarrativeRequest.updateOne(
        buildOwnedFilter(requestId, workerLeaseId),
        { $set: checkpoint },
      );
      assertWorkerUpdateMatched(result);
    }

    const recoveredBillingSnapshot = request.billingStatus === 'CHARGING' &&
      isObject(request.billingSnapshot)
      ? deepCloneJson(request.billingSnapshot)
      : null;
    const billing = recoveredBillingSnapshot || calculateNarrativeBilling(inferenceReceipts);
    await persistBilling(requestId, workerLeaseId, billing);
    const billingValidation = validateNarrativeBilling(billing, inferenceReceipts.length);
    const requiresBillableReceipts = Boolean(generated) || inferenceReceipts.length > 0;
    if (requiresBillableReceipts &&
      (billing.receipts.length === 0 || !billingValidation.valid)) {
      const usageError = buildError(
        [
          'Complete billable token usage was not available for every branching inference call.',
          ...billingValidation.errors,
        ].join(' '),
        502,
        'INFERENCE_USAGE_UNAVAILABLE',
      );
      const failed = await markFailed(
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
      charge = await chargeUsage(request, billing, workerLeaseId);
    } catch (billingError) {
      if (isLeaseLostError(billingError)) return null;
      if (getRequestErrorStatus(billingError) >= 500) {
        console.error('[external_narrative_branching] retryable billing failure', {
          requestId,
          code: billingError?.code || null,
          message: billingError?.message || String(billingError),
        });
        return null;
      }
      const failed = await markFailed(
        requestId,
        workerLeaseId,
        billingError,
        billing,
        null,
      );
      return failed ? buildNarrativeRequestPayload(failed) : null;
    }

    if (generationError) {
      const failed = await markFailed(
        requestId,
        workerLeaseId,
        generationError,
        billing,
        charge,
      );
      return failed ? buildNarrativeRequestPayload(failed) : null;
    }

    const completed = await NarrativeRequest.findOneAndUpdate(
      buildOwnedFilter(requestId, workerLeaseId),
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

export function queueCreateBranchingNarrativeRequest(requestId) {
  const normalizedRequestId = requestId?.toString?.() || String(requestId);
  if (queuedRequestIds.has(normalizedRequestId)) return false;
  queuedRequestIds.add(normalizedRequestId);
  setImmediate(() => {
    void ensureBillingIndexes()
      .then(() => processCreateBranchingNarrativeRequest(normalizedRequestId))
      .catch((error) => {
        console.error('[external_narrative_branching] async request worker failed', {
          requestId: normalizedRequestId,
          message: error?.message || String(error),
        });
      })
      .finally(() => {
        queuedRequestIds.delete(normalizedRequestId);
      });
  });
  return true;
}

export async function recoverCreateBranchingNarrativeRequests({ limit = 20 } = {}) {
  await getDBConnectionString();
  await ensureBillingIndexes();
  const now = new Date();
  const requests = await NarrativeRequest.find({
    requestType: 'create_branching',
    narrativeType: 'branched',
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
    queueCreateBranchingNarrativeRequest(request._id.toString());
  }
  return requests.length;
}

export function startCreateBranchingNarrativeRequestRecovery() {
  if (recoveryInterval) return () => {};
  const recover = () => {
    void recoverCreateBranchingNarrativeRequests().catch((error) => {
      console.error('[external_narrative_branching] recovery scan failed', {
        message: error?.message || String(error),
      });
    });
  };
  recover();
  recoveryInterval = setInterval(recover, getRecoveryIntervalMs());
  recoveryInterval.unref?.();

  return () => {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  };
}

export async function createBranchingNarrativeRequest({
  userId,
  payload = {},
  authContext = null,
  dependencies = {},
} = {}) {
  if (!userId) throw buildError('User ID is required.', 401, 'UNAUTHORIZED');
  const normalized = normalizeCreateBranchingNarrativePayload(payload);

  await getDBConnectionString();
  await ensureBillingIndexes();
  const user = await User.findById(userId)
    .select('generationCredits')
    .lean();
  if (!user) throw buildError('User not found.', 404, 'USER_NOT_FOUND');
  if (!(Number(user.generationCredits) > 0)) {
    throw buildError('Insufficient credits', 402, 'INSUFFICIENT_CREDITS');
  }

  const source = await NarrativeRequest.findOne({
    _id: normalized.sourceRequestId,
    userId: userId?.toString?.() || String(userId),
  }).lean();
  validateBranchingSourceRequest(source, normalized.numLevels);

  const apiKeyUsage = normalizeAPIKeyUsageContext(authContext);
  if (apiKeyUsage?.apiKeyId) {
    await assertAPIKeyUsageLimitForDebit(
      userId,
      ADMISSION_CREDIT_FLOOR,
      { apiKeyId: apiKeyUsage.apiKeyId },
    );
  }

  const created = await NarrativeRequest.create({
    userId: userId?.toString?.() || String(userId),
    requestType: 'create_branching',
    narrativeType: 'branched',
    sourceNarrativeRequestId: source._id,
    sourceNarrativeSnapshot: buildSourceSnapshot(source),
    numLevels: normalized.numLevels,
    status: 'PENDING',
    prompt: source.prompt,
    inputPrompt: source.inputPrompt || source.prompt,
    duration: source.duration,
    totalDuration: source.totalDuration || source.duration,
    inferenceModel: source.inferenceModel,
    videoGenerationModel: source.videoGenerationModel || 'RUNWAYML',
    videoTone: source.videoTone || 'grounded',
    speakerOptions: deepCloneJson(source.speakerOptions || null),
    pricingMultiplier: NARRATIVE_PRICING_MULTIPLIER,
    apiKeyId: apiKeyUsage?.apiKeyId || null,
    apiKeyUsage,
    meteringSlotActive: false,
  });
  const request = created.toObject();
  const queueRequest = dependencies.queueCreateBranchingNarrativeRequest ||
    queueCreateBranchingNarrativeRequest;
  queueRequest(request._id.toString());
  return buildNarrativeRequestPayload(request);
}

export const __testOnly__ = {
  ADMISSION_CREDIT_FLOOR,
  BILLING_OPERATION,
  BILLING_SOURCE,
  BRANCHING_FACTOR,
  LEASE_LOST_CODE,
  MAX_BRANCHING_LEVELS,
  REQUEST_KEY_PREFIX,
  ensureBillingIndexes,
  getBillingIdempotencyKey,
  getMaxBranchingLevels,
  getRequestErrorStatus,
  getWorkerLeaseMs,
  isLeaseLostError,
  queuedRequestIds,
};
